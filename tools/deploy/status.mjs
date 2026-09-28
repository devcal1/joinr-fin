// `pnpm umbrel:status [--dry-run]` (stage-7.md §7.6). Read-only.
//
// The app container's state, health and image; the registry; whether the digest pinned in the
// store compose (and in the app-data compose, once installed) is in the registry, ending with
// "Safe to click Update in Umbrel" or "Do NOT click Update: <reason>"; the device port check; the
// backup files (names and sizes only) and the free space in app-data.
//
// Exit codes: 0 safe to click Update/Install · 1 not safe (the reason is printed) · 2 usage.
import {
  BACKUP_FILE_NAME_RE,
  DeployError,
  PLACEHOLDER_DIGEST,
  commonDryRunReply,
  containerState,
  createContext,
  isEntry,
  manifestStatus,
  parseFlags,
  preflight,
  readStoreApp,
  remote,
  remoteHome,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
} from './lib.mjs';
import { registryDryRunReply, registryStatus } from './registry.mjs';
import { portProblems } from './release.mjs';
import { parseYqScalar } from './restore-remote.mjs';

const USAGE = 'Usage: node tools/deploy/status.mjs [--dry-run]';

/** The pinned `sha256:` digest of an image reference, if any. */
export function digestOf(ref) {
  return /@(sha256:[0-9a-f]{64})$/.exec(ref ?? '')?.[1];
}

/** Formats a byte count for the listing. */
function size(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function dryRunReply(spec) {
  if (spec.purpose === 'manifest-head') return { stdout: '200' };
  return registryDryRunReply(spec) ?? commonDryRunReply(spec);
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, { 'dry-run': 'boolean', help: 'boolean' });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  if (positional.length > 0) throw new DeployError(USAGE, 2);
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  const appId = ctx.config.appId;
  const reasons = [];

  // The app.
  const container = `${appId}_app_1`;
  const state = await containerState(ctx, container);
  ctx.out(
    `App (${container}): ${state === 'missing' ? 'no container (not installed, or stopped in Umbrel)' : state}`,
  );
  if (state !== 'missing') {
    const r = await remote(
      ctx,
      'app-inspect',
      `docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}} {{.Config.Image}}' ${shq(container)}`,
    );
    ctx.out(`  health and image: ${r.stdout.trim() || '(unknown)'}`);
  }
  const appCompose = remotePath(home, 'umbrel', 'app-data', appId, 'docker-compose.yml');
  const installed = await remote(ctx, 'yq-image', `yq '.services.app.image' ${shq(appCompose)}`);
  const installedRef = installed.code === 0 ? parseYqScalar(installed.stdout) : undefined;
  ctx.out(`  installed compose pins: ${installedRef ?? '(not installed)'}`);

  // The registry.
  const registryUp = await registryStatus(ctx);
  if (!registryUp) reasons.push('the registry is not answering (start the Joinr Registry app)');

  // The pinned digests.
  let storeDigest;
  try {
    const app = readStoreApp(ctx.config.storeDir, appId);
    storeDigest = app.image.digest;
    ctx.out(`Store clone pins: ${app.image.ref} (manifest version ${app.version})`);
    if (storeDigest === PLACEHOLDER_DIGEST)
      reasons.push('the store compose still has the placeholder digest (no release yet)');
  } catch (err) {
    reasons.push(
      `the store clone cannot be read (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (registryUp) {
    for (const [label, digest] of [
      ['store', storeDigest !== PLACEHOLDER_DIGEST ? storeDigest : undefined],
      ['installed', digestOf(installedRef)],
    ]) {
      if (!digest) continue;
      const s = await manifestStatus(ctx, digest);
      ctx.out(
        `  ${label} digest in the registry: ${s === 200 ? 'yes' : `NO (HTTP ${s || 'no answer'})`}`,
      );
      if (s !== 200) reasons.push(`the ${label} compose pins a digest the registry does not hold`);
    }
  }

  // Ports.
  const problems = await portProblems(ctx);
  ctx.out(`Ports: ${problems.length === 0 ? 'no conflicts' : problems.join('; ')}`);
  if (problems.length > 0) reasons.push('a port conflict on the device');

  // Backups (names and sizes only) and free space.
  const dataDir = remotePath(home, 'umbrel', 'app-data', appId, 'data');
  const ls = await remote(
    ctx,
    'backups-list',
    `find ${shq(`${dataDir}/backups`)} -maxdepth 1 -type f -name '*.db' -printf '%f %s\\n' 2>/dev/null`,
  );
  const files = ls.stdout
    .split('\n')
    .map((l) => l.trim().split(' '))
    .filter(([n, s]) => n && BACKUP_FILE_NAME_RE.test(n) && /^\d+$/.test(s ?? ''))
    .sort(([a], [b]) => (a < b ? 1 : -1));
  ctx.out(`Backups: ${files.length} file(s)`);
  for (const [n, s] of files.slice(0, 20)) ctx.out(`  ${n}  ${size(Number(s))}`);
  if (files.length > 20) ctx.out(`  … and ${files.length - 20} more`);
  const df = await remote(ctx, 'df', `df -Pk ${shq(dataDir)} 2>/dev/null | tail -1`);
  const free = Number(df.stdout.trim().split(/\s+/)[3]);
  if (Number.isFinite(free) && free > 0)
    ctx.out(`Free space in app-data: ${(free / 1024 / 1024).toFixed(1)} GiB`);

  if (reasons.length === 0) {
    ctx.out('Safe to click Update in Umbrel (or Install, the first time).');
    return 0;
  }
  ctx.out(`Do NOT click Update: ${reasons.join('; ')}.`);
  return 1;
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
