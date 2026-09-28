// `pnpm umbrel:smoke start | check | remove [--image <ref>] [--dry-run]` (stage-7.md §7.6, §9 step S).
//
// The coordinator's live smoke on the Umbrel, before any version is installed: runs an image on a
// loopback-only port with a scratch data folder under the build root, checks it from the host,
// then removes the container and the folder.
//   start   mkdir <build root>/smoke/data/backups; docker run -d joinr-smoke on 127.0.0.1:4939
//   check   health and version, the container's time zone, market-data egress from inside the
//           container, back up now + list, a download, a planted symlink → 404, a foreign Origin → 403
//   remove  the container and the smoke folder
//
// Exit codes: 0 done / every check passed · 1 a check failed · 2 usage · 3 port or container in the way.
import {
  BACKUP_FILE_NAME_RE,
  DEFAULT_TZ,
  DeployError,
  SMOKE_CONTAINER,
  SMOKE_DIR,
  SMOKE_PORT,
  commonDryRunReply,
  containerState,
  createContext,
  imageRef,
  isEntry,
  listeners,
  parseFlags,
  preflight,
  readAppVersion,
  remote,
  remoteHome,
  remoteOk,
  remotePath,
  resolveBinaries,
  runMain,
  shq,
  validate,
  waitHealthy,
} from './lib.mjs';

const USAGE =
  'Usage: node tools/deploy/smoke.mjs (start | check | remove) [--image <ref>] [--dry-run]';

/** The name of the symlink planted by `check` (a valid backup name dated 2030). */
export const SYMLINK_PROBE = 'nightly-20300101-023000+1100.db';
/** The market-data hosts the server calls (reachable = any HTTP status). */
export const EGRESS_URLS = ['https://query1.finance.yahoo.com/', 'https://api.coingecko.com/'];

function smokePaths(ctx, home) {
  const root = remotePath(home, ctx.config.remoteBuildRoot, SMOKE_DIR);
  return { root, data: `${root}/data`, backups: `${root}/data/backups` };
}

async function start(ctx, home, image) {
  const paths = smokePaths(ctx, home);
  if ((await listeners(ctx)).some((l) => l.port === SMOKE_PORT)) {
    throw new DeployError(`Port ${SMOKE_PORT} is already in use on the host`, 3);
  }
  const state = await containerState(ctx, SMOKE_CONTAINER);
  if (state !== 'missing')
    throw new DeployError(
      `${SMOKE_CONTAINER} already exists (${state}): run \`smoke remove\` first, or docker rm it`,
      3,
    );
  await remoteOk(
    ctx,
    'smoke-mkdir',
    `mkdir -p ${shq(paths.backups)}`,
    'Could not create the smoke folder',
  );
  await remoteOk(
    ctx,
    'smoke-run',
    [
      'docker run -d',
      `--name ${SMOKE_CONTAINER}`,
      '--user 1000:1000',
      `-e TZ=${DEFAULT_TZ}`,
      '-e NIGHTLY_BACKUPS=true',
      `-e PUBLIC_PORT=${SMOKE_PORT}`,
      `-p 127.0.0.1:${SMOKE_PORT}:3001`,
      `-v ${shq(`${paths.data}:/data`)}`,
      shq(image),
    ].join(' '),
    'Could not start the smoke container',
  );
  const healthy = await waitHealthy(ctx, SMOKE_CONTAINER);
  if (!healthy)
    throw new DeployError(
      `${SMOKE_CONTAINER} did not become healthy within 120 s (docker logs ${SMOKE_CONTAINER})`,
      1,
    );
  ctx.out(`${SMOKE_CONTAINER} is healthy on 127.0.0.1:${SMOKE_PORT} (${image}).`);
  return 0;
}

/** One check's outcome, printed as a line of the report. */
function report(ctx, results, name, ok, detail) {
  results.push({ name, ok });
  ctx.out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const base = `http://127.0.0.1:${SMOKE_PORT}`;

/** `curl` on the host printing only the HTTP status (and optionally more `-w` fields). */
function curlStatus(extra, url, format = '%{http_code}') {
  return ['curl -s -o /dev/null -w', shq(format), extra, shq(url)].filter(Boolean).join(' ');
}

async function check(ctx, home) {
  const paths = smokePaths(ctx, home);
  const results = [];

  // 1. Health and version.
  const h = await remote(ctx, 'smoke-health', `curl -fsS ${shq(`${base}/api/health`)}`);
  let health;
  try {
    health = JSON.parse(h.stdout);
  } catch {
    health = undefined;
  }
  report(
    ctx,
    results,
    '/api/health',
    health?.status === 'ok' && health?.db?.migrations === 6,
    health
      ? `version ${String(health.version).slice(0, 30)}, migrations ${health.db?.migrations}`
      : 'no answer',
  );

  // 2. The container's time zone.
  const tz = await remote(
    ctx,
    'smoke-tz',
    `docker exec ${SMOKE_CONTAINER} node -e ${shq(
      'console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date().getTimezoneOffset() }))',
    )}`,
  );
  let zone;
  try {
    zone = JSON.parse(tz.stdout);
  } catch {
    zone = undefined;
  }
  report(
    ctx,
    results,
    'time zone',
    zone?.zone === DEFAULT_TZ && (zone?.offset === -600 || zone?.offset === -660),
    zone ? `${zone.zone}, offset ${zone.offset} min` : 'no answer',
  );

  // 3. Market-data egress from inside the container (any HTTP status = reachable).
  for (const url of EGRESS_URLS) {
    const r = await remote(
      ctx,
      'smoke-egress',
      `docker exec ${SMOKE_CONTAINER} node -e ${shq(
        `fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(10000) }).then((r) => console.log(r.status), (e) => { console.log('error ' + (e.cause?.code ?? e.name)); process.exit(1); })`,
      )}`,
    );
    report(ctx, results, `egress ${new URL(url).host}`, r.code === 0, r.stdout.trim().slice(0, 40));
  }

  // 4. Back up now, then the list.
  const post = await remote(ctx, 'smoke-post', curlStatus('-X POST', `${base}/api/backups`));
  report(
    ctx,
    results,
    'POST /api/backups',
    post.stdout.trim() === '201',
    `HTTP ${post.stdout.trim()}`,
  );
  const list = await remote(ctx, 'smoke-list', `curl -fsS ${shq(`${base}/api/backups`)}`);
  let manual;
  try {
    manual = JSON.parse(list.stdout).backups?.find((b) => b.kind === 'manual')?.name;
  } catch {
    manual = undefined;
  }
  const manualOk = typeof manual === 'string' && BACKUP_FILE_NAME_RE.test(manual);
  report(ctx, results, 'GET /api/backups', manualOk, manualOk ? manual : 'no manual backup listed');

  // 5. A download.
  if (manualOk) {
    const d = await remote(
      ctx,
      'smoke-download',
      curlStatus(
        '',
        `${base}/api/backups/${encodeURIComponent(manual)}`,
        '%{http_code} %{content_type} %{size_download}',
      ),
    );
    const [code, type, bytes] = d.stdout.trim().split(' ');
    report(
      ctx,
      results,
      'download',
      code === '200' && type === 'application/vnd.sqlite3' && Number(bytes) > 0,
      d.stdout.trim(),
    );
  }

  // 6. A symlink planted in data/backups → 404 (lstat + realpath on Linux).
  const link = `${paths.backups}/${SYMLINK_PROBE}`;
  await remote(ctx, 'smoke-symlink', `ln -sfn ../finance.db ${shq(link)}`);
  const s = await remote(
    ctx,
    'smoke-symlink-get',
    curlStatus('', `${base}/api/backups/${encodeURIComponent(SYMLINK_PROBE)}`),
  );
  await remote(ctx, 'smoke-symlink-rm', `rm -f -- ${shq(link)}`);
  report(
    ctx,
    results,
    'symlink in backups/ → 404',
    s.stdout.trim() === '404',
    `HTTP ${s.stdout.trim()}`,
  );

  // 7. A write with a foreign Origin → 403 (the production write guard, §5.8).
  const o = await remote(
    ctx,
    'smoke-origin',
    curlStatus(`-X POST -H ${shq('Origin: http://example.test:1')}`, `${base}/api/backups`),
  );
  report(
    ctx,
    results,
    'foreign Origin POST → 403',
    o.stdout.trim() === '403',
    `HTTP ${o.stdout.trim()}`,
  );

  const failed = results.filter((r) => !r.ok).length;
  ctx.out(
    failed === 0
      ? `All ${results.length} checks passed.`
      : `${failed} of ${results.length} checks failed.`,
  );
  return failed === 0 ? 0 : 1;
}

async function removeSmoke(ctx, home) {
  const paths = smokePaths(ctx, home);
  const state = await containerState(ctx, SMOKE_CONTAINER);
  if (state !== 'missing') {
    await remoteOk(
      ctx,
      'smoke-rm',
      `docker rm -f ${SMOKE_CONTAINER}`,
      'Could not remove the smoke container',
    );
  }
  await remoteOk(
    ctx,
    'smoke-rmdir',
    `rm -rf -- ${shq(paths.root)}`,
    'Could not remove the smoke folder',
  );
  ctx.out(`Removed ${SMOKE_CONTAINER} and the smoke folder.`);
  return 0;
}

function dryRunReply(spec) {
  if (spec.purpose === 'container-state') return { code: 1, stderr: 'Error: No such object' };
  return commonDryRunReply(spec);
}

export async function main(argv, deps = {}) {
  const { flags, positional } = parseFlags(argv, {
    image: 'string',
    'dry-run': 'boolean',
    help: 'boolean',
  });
  if (flags.help) {
    (deps.out ?? console.log)(USAGE);
    return 0;
  }
  const command = positional[0];
  if (positional.length !== 1 || !['start', 'check', 'remove'].includes(command))
    throw new DeployError(USAGE, 2);
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  const image =
    flags.image !== undefined
      ? validate('imageRef', flags.image, '--image')
      : imageRef(ctx.config, (deps.readVersion ?? readAppVersion)(ctx.repoRoot));
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  if (command === 'start') return start(ctx, home, image);
  if (command === 'check') return check(ctx, home);
  return removeSmoke(ctx, home);
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
