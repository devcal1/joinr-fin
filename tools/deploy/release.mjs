// `pnpm umbrel:release [--allow-dirty] [--skip-store] [--prerelease <id>] [--reuse-existing]
//  [--force-build] [--dry-run]` (stage-7.md §7.2, §7.4).
//
// Ships the build context to the Umbrel as a git tree over SSH, builds the image there, pushes it
// to the loopback registry, and writes `tag@digest` and `version:` into the local store clone
// (never committed here: the store is reviewed, committed and pushed by hand).
//
// Order: binaries → the tree to ship → the privacy guard → SSH preflight → remote home → registry
// → tag check (`--reuse-existing`) → memory guard → transfer → build → push → digest → old
// contexts → release log → store checks → store write.
//
// Exit codes: 0 done (or nothing to change) · 1 failed · 2 usage, dirty tree, guard, store or host
// check · 3 registry not usable · 4 version already in the registry / image changed without a
// version bump · 5 not enough free memory on the host.
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APP_PORT,
  DeployError,
  IMAGE_NAME,
  KEEP_BUILD_CONTEXTS,
  MANIFEST_ACCEPT,
  MIN_MEM_AVAILABLE_KB,
  PLACEHOLDER_DIGEST,
  REGISTRY_APP_ID,
  commonDryRunReply,
  containerState,
  createContext,
  imageRef,
  isEntry,
  listeners,
  local,
  manifestStatus,
  parseFlags,
  preflight,
  readAppVersion,
  readStoreApp,
  remote,
  remoteHome,
  remoteOk,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
  tsxCliPath,
  validate,
} from './lib.mjs';
import { ensureRegistry, registryDryRunReply } from './registry.mjs';

const USAGE = `Usage: node tools/deploy/release.mjs [--allow-dirty] [--skip-store] [--prerelease <id>]
                                     [--reuse-existing] [--force-build] [--dry-run]
  --allow-dirty      ship the working copy (tracked + untracked, not ignored) instead of HEAD
  --skip-store       build and push only; do not write the store clone
  --prerelease <id>  tag the image <version>-<id> (e.g. rc.1); needs --skip-store
  --reuse-existing   the tag is already in the registry from this same tree: write the store only
  --force-build      build even when the host has less than 2.5 GiB of free memory
  --dry-run          print every command and file change; run nothing remote, write nothing`;

/** A build-context folder name: <version>-<tree first 12>. */
export const CONTEXT_NAME_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?-[0-9a-f]{12}$/;

// ─── The tree to ship ──────────────────────────────────────────────────────────────────────────

/**
 * The git tree to ship: `HEAD^{tree}` when clean; with `--allow-dirty` the tree of the working
 * copy, built in a temporary index (`GIT_INDEX_FILE`) seeded from HEAD, so the real index is never
 * touched and no commit is made. The set equals what `pnpm guard:all` scans (tracked files plus
 * untracked files that are not ignored). Returns { tree, head, dirty }.
 */
export async function selectTree(ctx, { allowDirty }) {
  const git = ctx.bins.git;
  const st = await local(ctx, 'git-status', git, ['status', '--porcelain'], { readOnly: true });
  if (st.code !== 0) throw new DeployError('git status failed (is this a git checkout?)', 2);
  const dirty = st.stdout.trim() !== '';
  const headR = await local(ctx, 'git-head', git, ['rev-parse', 'HEAD'], { readOnly: true });
  const head = validate('treeId', headR.stdout.trim(), 'HEAD commit');
  if (dirty && !allowDirty) {
    throw new DeployError(
      'The working tree has changes: commit them, or pass --allow-dirty to ship the working copy',
      2,
    );
  }
  let tree;
  if (!dirty) {
    const r = await local(ctx, 'git-tree', git, ['rev-parse', 'HEAD^{tree}'], { readOnly: true });
    tree = r.stdout.trim();
  } else {
    const indexFile = join(tmpdir(), `joinr-release-index-${process.pid}-${ctx.now().getTime()}`);
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      for (const [purpose, args] of [
        ['git-read-tree', ['read-tree', 'HEAD']],
        ['git-add', ['add', '-A']],
      ]) {
        const r = await local(ctx, purpose, git, args, { readOnly: true, env });
        if (r.code !== 0)
          throw new DeployError(`git ${args.join(' ')} (temporary index) failed`, 1);
      }
      const r = await local(ctx, 'git-write-tree', git, ['write-tree'], { readOnly: true, env });
      if (r.code !== 0) throw new DeployError('git write-tree (temporary index) failed', 1);
      tree = r.stdout.trim();
    } finally {
      rmSync(indexFile, { force: true });
      rmSync(`${indexFile}.lock`, { force: true });
    }
  }
  validate('treeId', tree, 'tree id');
  ctx.out(`Tree: ${tree} (${dirty ? 'dirty working copy' : 'clean'}; HEAD ${head})`);
  return { tree, head, dirty };
}

/** The privacy guard over the same set, as `node <tsx cli> …` (never pnpm or a .cmd shim). */
export async function runGuard(ctx, tsxCli = tsxCliPath()) {
  ctx.out('Running the privacy guard (pnpm guard:all)…');
  const r = await local(
    ctx,
    'guard',
    process.execPath,
    [tsxCli, 'tools/privacy-guard/src/cli.ts', '--all'],
    {
      stream: true,
    },
  );
  if (r.code !== 0)
    throw new DeployError('The privacy guard found something: nothing was shipped', 2);
}

// ─── Host checks ───────────────────────────────────────────────────────────────────────────────

/** Parses `MemAvailable` (kB) from /proc/meminfo. */
export function parseMemAvailable(text) {
  const m = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text);
  return m ? Number(m[1]) : undefined;
}

export async function memoryGuard(ctx, { forceBuild }) {
  const r = await remoteOk(ctx, 'meminfo', 'cat /proc/meminfo', 'Could not read /proc/meminfo');
  const kb = parseMemAvailable(r.stdout);
  if (kb === undefined) throw new DeployError('MemAvailable missing from /proc/meminfo', 1);
  const gib = (kb / 1024 / 1024).toFixed(1);
  if (kb < MIN_MEM_AVAILABLE_KB) {
    if (!forceBuild) {
      throw new DeployError(
        `Not enough free memory on the Umbrel to build safely (${gib} GiB available; 2.5 needed; --force-build overrides)`,
        5,
      );
    }
    ctx.out(`Memory: ${gib} GiB available (below 2.5 GiB; --force-build).`);
  } else {
    ctx.out(`Memory: ${gib} GiB available.`);
  }
}

/**
 * The port check of §7.4: no other app manifest on the device claims the app port or the registry
 * port, and no host listener holds them — except the app's own app_proxy on the app port (after
 * the first install) and the registry's own `127.0.0.1:<registry port>`. Returns a list of
 * problems (empty = fine).
 */
export async function portProblems(ctx) {
  const home = await remoteHome(ctx);
  const regPort = ctx.config.registryPort;
  const problems = [];
  const stores = remotePath(home, 'umbrel', 'app-stores');
  const g = await remote(
    ctx,
    'manifest-ports',
    `grep -H '^port:' ${shq(stores)}/*/*/umbrel-app.yml`,
  );
  if (g.code > 1) problems.push('could not read the app manifests on the device');
  for (const line of g.stdout.split('\n')) {
    const m = /^(.*)\/([^/]+)\/umbrel-app\.yml:port:\s*(\d+)\s*$/.exec(line.trim());
    if (!m) continue;
    const [, , folder, port] = m;
    if (folder === ctx.config.appId || folder === REGISTRY_APP_ID) continue;
    if (Number(port) === APP_PORT || Number(port) === regPort) {
      problems.push(
        `another app manifest (${folder.replace(/[^A-Za-z0-9._-]/g, '?')}) uses port ${port}`,
      );
    }
  }
  const ls = await listeners(ctx);
  const proxyUp = ls.some((l) => l.port === APP_PORT)
    ? (await containerState(ctx, `${ctx.config.appId}_app_proxy_1`)) === 'running'
    : false;
  for (const l of ls) {
    if (l.port === APP_PORT && !proxyUp)
      problems.push(`something else listens on port ${APP_PORT} (${l.address})`);
    if (l.port === regPort && l.address !== '127.0.0.1') {
      problems.push(
        `something listens on port ${regPort} on ${l.address} (the registry must be loopback only)`,
      );
    }
  }
  return problems;
}

// ─── Registry tag, build, push, digest ─────────────────────────────────────────────────────────

/** Picks this registry's `sha256:` digest from `docker inspect --format '{{json .RepoDigests}}'`. */
export function parseRepoDigests(text, registryPort) {
  let list;
  try {
    list = JSON.parse(text.trim());
  } catch {
    throw new DeployError('Could not parse the image RepoDigests', 1);
  }
  const prefix = `127.0.0.1:${registryPort}/${IMAGE_NAME}@`;
  const hit = Array.isArray(list)
    ? list.find((d) => typeof d === 'string' && d.startsWith(prefix))
    : undefined;
  if (!hit) throw new DeployError('The pushed image has no digest for the loopback registry', 1);
  return validate('digest', hit.slice(prefix.length), 'image digest');
}

/** The `Docker-Content-Digest` header of a registry answer. */
export function parseDigestHeader(text) {
  const m = /^docker-content-digest:\s*(sha256:[0-9a-f]{64})\s*$/im.exec(text);
  return m ? m[1] : undefined;
}

async function repoDigest(ctx, ref) {
  const r = await remoteOk(
    ctx,
    'repo-digests',
    `docker inspect --format '{{json .RepoDigests}}' ${shq(ref)}`,
    'docker inspect of the image failed',
  );
  return parseRepoDigests(r.stdout, ctx.config.registryPort);
}

/** Cross-checks the digest with the registry's own header for the tag. */
async function crossCheckDigest(ctx, version, digest) {
  const url = `http://127.0.0.1:${ctx.config.registryPort}/v2/${IMAGE_NAME}/manifests/${validate('version', version)}`;
  const r = await remoteOk(
    ctx,
    'digest-header',
    `curl -fsSI -H ${shq(`Accept: ${MANIFEST_ACCEPT}`)} ${shq(url)}`,
    'The registry did not answer for the pushed tag',
  );
  const header = parseDigestHeader(r.stdout);
  if (header !== digest) {
    throw new DeployError(
      `The registry's digest for ${version} (${header ?? 'none'}) differs from the pushed image's (${digest})`,
      1,
    );
  }
}

/** Keeps the newest build contexts; removes the rest by validated absolute path. */
export async function pruneContexts(ctx, home, keep = KEEP_BUILD_CONTEXTS) {
  const root = remotePath(home, ctx.config.remoteBuildRoot);
  const r = await remote(ctx, 'list-contexts', `ls -1t -- ${shq(root)}`);
  if (r.code !== 0) return [];
  const names = r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((n) => CONTEXT_NAME_RE.test(n));
  const removed = [];
  for (const name of names.slice(keep)) {
    await remote(ctx, 'remove-context', `rm -rf -- ${shq(`${root}/${name}`)}`);
    removed.push(name);
  }
  if (removed.length > 0) ctx.out(`Removed old build contexts: ${removed.join(', ')}`);
  return removed;
}

// ─── The store ─────────────────────────────────────────────────────────────────────────────────

/**
 * Plans the store edit (§7.4): `{ action: 'write', compose, manifest }`, `{ action: 'none' }`, or a
 * refusal (exit 4 when the image changed but the version did not). The placeholder digest counts
 * as "no release yet", so the first release may keep the manifest's version.
 */
export function planStoreEdit(app, { version, digest, registryPort }) {
  if (app.version === version) {
    if (app.image.digest === digest) return { action: 'none' };
    if (app.image.digest !== PLACEHOLDER_DIGEST) {
      throw new DeployError(
        'The image changed but the version did not: bump the version (Umbrel only offers an update when `version:` changes)',
        4,
      );
    }
  }
  const imageLine = `    image: 127.0.0.1:${registryPort}/${IMAGE_NAME}:${validate('version', version)}@${validate('digest', digest)}`;
  const lineRe =
    /^[ \t]*image:[ \t]*127\.0\.0\.1:\d+\/joinr-finance:\S+@sha256:[0-9a-f]{64}[ \t]*$/gm;
  const verRe = /^version: '[^']*'$/gm;
  if (
    (app.compose.match(lineRe) ?? []).length !== 1 ||
    (app.manifest.match(verRe) ?? []).length !== 1
  ) {
    throw new DeployError(
      'The store files do not have exactly one image line and one version line',
      2,
    );
  }
  return {
    action: 'write',
    imageLine: imageLine.trim(),
    compose: app.compose.replace(lineRe, imageLine),
    manifest: app.manifest.replace(verRe, `version: '${version}'`),
  };
}

async function writeStore(ctx, { version, digest }, deps) {
  const app = readStoreApp(ctx.config.storeDir, ctx.config.appId);
  const plan = planStoreEdit(app, { version, digest, registryPort: ctx.config.registryPort });
  if (plan.action === 'none') {
    ctx.out(`Nothing to change: the store already pins ${version}@${digest}.`);
    return;
  }
  // Host checks before writing (read-only): the pinned manifest exists, and the ports are free.
  const status = await manifestStatus(ctx, digest);
  if (status !== 200) {
    throw new DeployError(
      `The registry does not hold ${IMAGE_NAME}@${digest} (HTTP ${status || 'no answer'}): nothing written`,
      2,
    );
  }
  const problems = await portProblems(ctx);
  if (problems.length > 0)
    throw new DeployError(`Port check failed, nothing written: ${problems.join('; ')}`, 2);

  if (ctx.dryRun) {
    ctx.out(`[dry-run] would write ${app.composePath}: ${plan.imageLine}`);
    ctx.out(`[dry-run] would write ${app.manifestPath}: version: '${version}'`);
  } else {
    (deps.writeFile ?? writeFileSync)(app.composePath, plan.compose);
    (deps.writeFile ?? writeFileSync)(app.manifestPath, plan.manifest);
    ctx.out(`Wrote the store: ${plan.imageLine}; version: '${version}'.`);
  }
  const diff = await local(
    ctx,
    'store-diff',
    ctx.bins.git,
    ['-C', ctx.config.storeDir, 'diff', '--stat'],
    { readOnly: true },
  );
  if (diff.stdout.trim()) ctx.out(diff.stdout.trimEnd());
  const st = await local(
    ctx,
    'store-status',
    ctx.bins.git,
    ['-C', ctx.config.storeDir, 'status', '--short'],
    { readOnly: true },
  );
  if (st.stdout.trim()) ctx.out(st.stdout.trimEnd());
  ctx.out(
    `Remember: releaseNotes: in ${ctx.config.appId}/umbrel-app.yml must describe ${version}.`,
  );
  ctx.out(
    'Next: review the store diff → the owner\'s OK → commit and push the store → `pnpm umbrel:status` prints "Safe to click Update" → Update (or Install) in Umbrel.',
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────────────────────

const DRY_RUN_DIGEST = `sha256:${'d'.repeat(64)}`;

function dryRunReply(spec) {
  switch (spec.purpose) {
    case 'meminfo':
      return { stdout: 'MemAvailable:    4194304 kB\n' };
    case 'manifest-head':
      // The version tag is free (so the build prints); the new digest is present afterwards.
      return { stdout: spec.args.at(-1).includes('/manifests/sha256:') ? '200' : '404' };
    case 'repo-digests':
      return {
        stdout: JSON.stringify([
          `${/127\.0\.0\.1:\d+/.exec(spec.args.at(-1))?.[0] ?? '127.0.0.1:4930'}/${IMAGE_NAME}@${DRY_RUN_DIGEST}`,
        ]),
      };
    case 'digest-header':
      return { stdout: `HTTP/1.1 200 OK\r\nDocker-Content-Digest: ${DRY_RUN_DIGEST}\r\n` };
    default:
      return registryDryRunReply(spec) ?? commonDryRunReply(spec);
  }
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, {
    'allow-dirty': 'boolean',
    'skip-store': 'boolean',
    prerelease: 'string',
    'reuse-existing': 'boolean',
    'force-build': 'boolean',
    'dry-run': 'boolean',
    help: 'boolean',
  });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  if (positional.length > 0) throw new DeployError(USAGE, 2);
  if (flags.prerelease !== undefined && !flags['skip-store']) {
    throw new DeployError(
      '--prerelease needs --skip-store (a prerelease never goes into the store)',
      2,
    );
  }
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  let version = (deps.readVersion ?? readAppVersion)(ctx.repoRoot);
  if (flags.prerelease !== undefined) {
    version = `${version}-${validate('prerelease', flags.prerelease, '--prerelease')}`;
  }
  validate('version', version);
  const ref = imageRef(ctx.config, version);
  ctx.out(`Release ${version} → ${ref}${ctx.dryRun ? ' (dry run)' : ''}`);

  resolveBinaries(ctx);
  if (!flags['skip-store']) readStoreApp(ctx.config.storeDir, ctx.config.appId); // fail early
  const { tree, head, dirty } = await selectTree(ctx, {
    allowDirty: flags['allow-dirty'] === true,
  });
  await runGuard(ctx, deps.tsxCli);

  await preflight(ctx);
  const home = await remoteHome(ctx);
  await ensureRegistry(ctx);

  let digest;
  const tagStatus = await manifestStatus(ctx, version);
  if (tagStatus === 200) {
    if (!flags['reuse-existing']) {
      throw new DeployError(
        `Version ${version} is already in the registry: bump the version in package.json`,
        4,
      );
    }
    const label = await remote(
      ctx,
      'image-revision',
      `docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' ${shq(ref)}`,
    );
    if (label.code !== 0 || label.stdout.trim() !== tree) {
      throw new DeployError(
        `Version ${version} is already in the registry from a different tree (${label.stdout.trim().slice(0, 40) || 'unknown'}): bump the version in package.json`,
        4,
      );
    }
    digest = await repoDigest(ctx, ref);
    await crossCheckDigest(ctx, version, digest);
    ctx.out(`Reusing ${ref}@${digest} (same tree): no build, no push.`);
  } else if (tagStatus === 404) {
    await memoryGuard(ctx, { forceBuild: flags['force-build'] === true });
    const contextDir = remotePath(
      home,
      ctx.config.remoteBuildRoot,
      `${version}-${tree.slice(0, 12)}`,
    );
    ctx.out(`Shipping the tree to ${ctx.config.host}…`);
    await remoteOk(
      ctx,
      'transfer',
      `mkdir -p ${shq(contextDir)} && tar -x -C ${shq(contextDir)}`,
      'Could not ship the build context',
      {
        pipeFrom: { cmd: ctx.bins.git, args: ['archive', '--format=tar', tree], cwd: ctx.repoRoot },
      },
    );
    ctx.out('Building on the host (the first build takes several minutes)…');
    await remoteOk(
      ctx,
      'docker-build',
      [
        'docker build --provenance=false',
        `--build-arg APP_VERSION=${version}`,
        `--build-arg APP_REVISION=${tree}`,
        `-t ${shq(ref)}`,
        shq(contextDir),
      ].join(' '),
      'The build failed: nothing was pushed, so the version is still free (fix and re-run)',
      { stream: true },
    );
    await remoteOk(ctx, 'docker-push', `docker push ${shq(ref)}`, 'The push failed', {
      stream: true,
    });
    digest = await repoDigest(ctx, ref);
    await crossCheckDigest(ctx, version, digest);
    await pruneContexts(ctx, home);
  } else {
    throw new DeployError(
      `The registry did not answer the tag check (HTTP ${tagStatus || 'no answer'})`,
      3,
    );
  }
  ctx.out(`Image: ${ref}@${digest}${ctx.dryRun ? ' (dry run: a stand-in digest)' : ''}`);

  const logLine = `${ctx.now().toISOString()} version=${version} tree=${tree} head=${head} ${dirty ? 'dirty' : 'clean'} digest=${digest}`;
  if (ctx.dryRun) {
    ctx.out(`[dry-run] would append to artifacts/releases.log: ${logLine}`);
  } else {
    (deps.appendReleaseLog ?? defaultAppendReleaseLog)(ctx.repoRoot, logLine);
    ctx.out(`Logged: ${logLine}`);
  }

  if (flags['skip-store']) {
    ctx.out('--skip-store: the store clone was not touched.');
    return 0;
  }
  await writeStore(ctx, { version, digest }, deps);
  return 0;
}

function defaultAppendReleaseLog(repoRoot, line) {
  const dir = join(repoRoot, 'artifacts');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'releases.log'), `${line}\n`);
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
