// `pnpm umbrel:registry ensure | status [--mode app|container] [--dry-run]` (stage-7.md §7.3).
//
// The loopback image registry on the Umbrel that the app installs and updates from (D112, D118).
// Mode `app` (the default, JOINR_REGISTRY_MODE): the Joinr Registry store app, which umbreld starts
// at every boot; `ensure` only checks it (it never starts an app's container behind umbreld).
// Mode `container` (fallback (a), and a bootstrap): a plain `joinr-registry` container, which
// umbreld removes at every boot, so `ensure` must run before every Install or Update.
import {
  DeployError,
  IMAGE_NAME,
  REGISTRY_APP_CONTAINER,
  REGISTRY_APP_ID,
  REGISTRY_CONTAINER,
  REGISTRY_IMAGE,
  commonDryRunReply,
  containerState,
  createContext,
  isEntry,
  listeners,
  manifestStatus,
  parseFlags,
  preflight,
  readStoreApp,
  remote,
  remoteHome,
  remoteOk,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
} from './lib.mjs';

const USAGE = `Usage: node tools/deploy/registry.mjs (ensure | status) [--mode app|container] [--dry-run]
  ensure   app mode: check the Joinr Registry app is running and answers; container mode: start
           (or create) the joinr-registry container, loopback only
  status   the mode, state, image, bindings, tags, storage size and the store's pinned digest`;

/** The registry's `/v2/` answer on the host: the HTTP status (0 = no answer). */
async function v2Status(ctx) {
  const r = await remote(
    ctx,
    'registry-v2',
    `curl -s -o /dev/null -w '%{http_code}' ${shq(`http://127.0.0.1:${ctx.config.registryPort}/v2/`)}`,
  );
  return Number(r.stdout.trim()) || 0;
}

/** The container's published bindings (`docker port`), one per line. */
async function portBindings(ctx, name) {
  const r = await remote(ctx, 'registry-port', `docker port ${shq(name)}`);
  return r.code === 0 ? r.stdout.trim().split('\n').filter(Boolean) : [];
}

/** True when every binding is the loopback registry port (`5000/tcp -> 127.0.0.1:<port>`). */
export function loopbackOnly(bindings, port) {
  return (
    bindings.length > 0 &&
    bindings.every((b) => new RegExp(`^5000/tcp -> 127\\.0\\.0\\.1:${port}$`).test(b.trim()))
  );
}

/** The registry container for the mode. */
export function registryContainer(mode) {
  return mode === 'app' ? REGISTRY_APP_CONTAINER : REGISTRY_CONTAINER;
}

/** Where the registry keeps its blobs on the host. */
export function registryStoragePath(ctx, home) {
  return ctx.config.registryMode === 'app'
    ? remotePath(home, 'umbrel', 'app-data', REGISTRY_APP_ID, 'data')
    : remotePath(home, ctx.config.registryData);
}

/**
 * `ensure` (used by `release.mjs` too). Needs ctx.bins and a passed preflight.
 * Exit 3 when the registry is not usable.
 */
export async function ensureRegistry(ctx) {
  const port = ctx.config.registryPort;
  if (ctx.config.registryMode === 'app') {
    const state = await containerState(ctx, REGISTRY_APP_CONTAINER);
    const status = state === 'running' ? await v2Status(ctx) : 0;
    if (state !== 'running' || status !== 200) {
      throw new DeployError(
        `Start (or install) the Joinr Registry app in Umbrel (container ${state}, /v2/ ${status || 'no answer'})`,
        3,
      );
    }
    ctx.out(`Registry: the Joinr Registry app is running; 127.0.0.1:${port}/v2/ answers 200.`);
    return;
  }

  // Fallback (a): the plain container.
  const home = await remoteHome(ctx);
  const storage = remotePath(home, ctx.config.registryData);
  const state = await containerState(ctx, REGISTRY_CONTAINER);
  if (state !== 'running') {
    const taken = (await listeners(ctx)).filter((l) => l.port === port);
    if (taken.length > 0) {
      throw new DeployError(`Port ${port} is already bound on the host by something else`, 3);
    }
    if (state === 'missing') {
      await remoteOk(
        ctx,
        'registry-mkdir',
        `mkdir -p ${shq(storage)}`,
        'Could not create the registry folder',
      );
      await remoteOk(
        ctx,
        'registry-run',
        [
          'docker run -d',
          `--name ${REGISTRY_CONTAINER}`,
          '--restart always',
          '--user 1000:1000',
          `-p 127.0.0.1:${port}:5000`,
          `-v ${shq(`${storage}:/var/lib/registry`)}`,
          REGISTRY_IMAGE,
        ].join(' '),
        'Could not start the registry container',
      );
      ctx.out(`Registry: created the ${REGISTRY_CONTAINER} container.`);
    } else {
      await remoteOk(
        ctx,
        'registry-start',
        `docker start ${REGISTRY_CONTAINER}`,
        'Could not start the registry container',
      );
      ctx.out(`Registry: started the ${REGISTRY_CONTAINER} container (it was ${state}).`);
    }
  }
  const bindings = await portBindings(ctx, REGISTRY_CONTAINER);
  if (!ctx.dryRun && !loopbackOnly(bindings, port)) {
    throw new DeployError(
      `The registry container must publish only 127.0.0.1:${port} (found: ${bindings.join(', ') || 'none'})`,
      3,
    );
  }
  const status = await v2Status(ctx);
  if (!ctx.dryRun && status !== 200) {
    throw new DeployError(
      `The registry does not answer on 127.0.0.1:${port}/v2/ (${status || 'no answer'})`,
      3,
    );
  }
  ctx.out(`Registry: ${REGISTRY_CONTAINER} is running; 127.0.0.1:${port}/v2/ answers 200.`);
}

/** `status`: read-only. Returns true when the registry is up. */
export async function registryStatus(ctx) {
  const port = ctx.config.registryPort;
  const name = registryContainer(ctx.config.registryMode);
  const home = await remoteHome(ctx);
  ctx.out(`Registry mode: ${ctx.config.registryMode} (container ${name})`);
  const state = await containerState(ctx, name);
  ctx.out(`  state: ${state}`);
  if (state !== 'missing') {
    const img = await remote(
      ctx,
      'registry-image',
      `docker inspect -f '{{.Config.Image}}' ${shq(name)}`,
    );
    ctx.out(`  image: ${img.stdout.trim() || '(unknown)'}`);
    const bindings = await portBindings(ctx, name);
    ctx.out(
      `  bindings: ${bindings.join(', ') || '(none)'}${loopbackOnly(bindings, port) ? ' (loopback only)' : ''}`,
    );
  }
  const v2 = state === 'running' ? await v2Status(ctx) : 0;
  ctx.out(`  /v2/: ${v2 || 'no answer'}`);
  if (v2 === 200) {
    const tags = await remote(
      ctx,
      'registry-tags',
      `curl -s ${shq(`http://127.0.0.1:${port}/v2/${IMAGE_NAME}/tags/list`)}`,
    );
    let list;
    try {
      list = (JSON.parse(tags.stdout).tags ?? []).filter((t) => /^[0-9A-Za-z._-]+$/.test(t));
    } catch {
      list = [];
    }
    ctx.out(`  ${IMAGE_NAME} tags: ${list.join(', ') || '(none)'}`);
  }
  const du = await remote(
    ctx,
    'registry-du',
    `du -sh ${shq(registryStoragePath(ctx, home))} 2>/dev/null | cut -f1`,
  );
  ctx.out(`  storage: ${du.stdout.trim() || '(unknown)'}`);

  // The store's pinned digest (§7.6).
  try {
    const app = readStoreApp(ctx.config.storeDir, ctx.config.appId);
    if (app.image.digest === `sha256:${'0'.repeat(64)}`) {
      ctx.out('  store pin: the placeholder digest (no release yet)');
    } else if (v2 === 200) {
      const s = await manifestStatus(ctx, app.image.digest);
      ctx.out(
        `  store pin: ${app.image.version}@${app.image.digest} ${s === 200 ? 'present' : `MISSING (${s})`}`,
      );
    }
  } catch (err) {
    ctx.out(`  store pin: unknown (${err instanceof Error ? err.message : String(err)})`);
  }
  return v2 === 200;
}

/**
 * Dry-run stand-ins: the Joinr Registry app looks running; the fallback container looks missing
 * (so every create step prints).
 */
export function registryDryRunReply(spec) {
  if (spec.purpose === 'container-state') {
    return spec.args.at(-1).includes(REGISTRY_APP_CONTAINER)
      ? { stdout: 'running' }
      : { code: 1, stderr: 'Error: No such object' };
  }
  if (spec.purpose === 'registry-v2') return { stdout: '200' };
  if (spec.purpose === 'listeners') return { stdout: '' };
  return commonDryRunReply(spec);
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, {
    'dry-run': 'boolean',
    mode: 'string',
    help: 'boolean',
  });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  const command = positional[0];
  if (positional.length !== 1 || (command !== 'ensure' && command !== 'status')) {
    throw new DeployError(USAGE, 2);
  }
  const ctx = createContext(deps, {
    dryRun: flags['dry-run'] === true,
    dryRunReply: registryDryRunReply,
  });
  if (flags.mode !== undefined) {
    if (flags.mode !== 'app' && flags.mode !== 'container')
      throw new DeployError('--mode must be app or container', 2);
    ctx.config = { ...ctx.config, registryMode: flags.mode };
  }
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  if (command === 'ensure') {
    await ensureRegistry(ctx);
    return 0;
  }
  return (await registryStatus(ctx)) ? 0 : 1;
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
