// `pnpm umbrel:smoke start | check | nas | mobile | remove [--image <ref>] [--dry-run]`
// (stage-7.md §7.6, §9 step S; stage-8.md §9.2; stage-9.md §7.3).
//
// The coordinator's live smoke on the Umbrel, before any version is installed: runs an image on a
// loopback-only port with a scratch data folder under the build root, checks it from the host,
// then removes the container and the folder.
//   start   mkdir <build root>/smoke/data/backups; docker run -d joinr-smoke on 127.0.0.1:4939
//   check   health and version, the container's time zone, market-data egress from inside the
//           container, back up now + list, a download, a planted symlink → 404, a foreign Origin → 403
//   nas     (Stage 8) the real rsync end to end: a scratch rsync daemon (the smoke image's own
//           rsync) on a private Docker network, then copies, the proof, a second copy sending
//           nothing, a foreign file, a wrong password and the refusal lock, a stopped NAS, a
//           subfolder, and leak counts. Never contacts a real NAS.
//   mobile  (Stage 9) the phone API: migrations 7, no key → 401, a made-up crypto holding seeded
//           through the API and a restart, so the start-up intraday run fetches its day chart;
//           then open → pair → today → POST → revoke → today as ONE host script (the code and
//           the key live only in shell variables on the host; the key reaches curl on stdin),
//           the traversal corpus with curl --path-as-is, the devices/ modes, and leak counts
//   remove  both containers, the network and the smoke folder (the scratch NAS's included)
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
  isEntry,
  listeners,
  parseFlags,
  preflight,
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
  'Usage: node tools/deploy/smoke.mjs (start --image <ref> | check | nas [--image <ref>] | mobile | remove) [--dry-run]';

/** The name of the symlink planted by `check` (a valid backup name dated 2030). */
export const SYMLINK_PROBE = 'nightly-20300101-023000+1100.db';
/**
 * The market-data hosts the server calls (reachable = any HTTP status), and since Stage 9 the
 * day charts' paths: Yahoo's one-day five-minute chart and CoinGecko's market_chart.
 */
export const EGRESS_URLS = [
  'https://query1.finance.yahoo.com/',
  'https://api.coingecko.com/',
  'https://query1.finance.yahoo.com/v8/finance/chart/AUDUSD=X?range=1d&interval=5m',
  'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=aud&days=1',
];
/** The database level of this release (`/api/health` `db.migrations`; Stage 9 adds 0006). */
export const EXPECTED_MIGRATIONS = 7;

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
      // The weekly NAS copy's schedule off, so its start-up catch-up cannot race the `nas` probes.
      '-e WEEKLY_NAS_COPY=false',
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
  // A dry run judges nothing: every command was printed, none was run.
  const tag = ctx.dryRun ? 'DRY ' : ok ? 'PASS' : 'FAIL';
  ctx.out(`${tag}  ${name}${detail && !ctx.dryRun ? ` — ${detail}` : ''}`);
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
    health?.status === 'ok' && health?.db?.migrations === EXPECTED_MIGRATIONS,
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
    const u = new URL(url);
    const label = u.pathname === '/' ? u.host : `${u.host} ${u.pathname.split('/').at(-1)}`;
    report(ctx, results, `egress ${label}`, r.code === 0, r.stdout.trim().slice(0, 40));
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

// ─── nas: the real rsync end to end, against a scratch rsync daemon (stage-8.md §9.2) ──────────

/** The scratch NAS: a container of the smoke's own image running `rsync --daemon`. */
export const SMOKE_NAS_CONTAINER = 'joinr-smoke-nas';
/** The private Docker network the smoke app and the scratch NAS share (no host port). */
export const SMOKE_NET = 'joinr-smoke-net';
export const SMOKE_NAS_PORT = 8873;
export const SMOKE_NAS_MODULE = 'smoke';
export const SMOKE_NAS_USER = 'smoke';
/** The smoke app's address of the scratch NAS: a Docker name that resolves inside the network. */
export const SMOKE_NAS_URL = `rsync://${SMOKE_NAS_USER}@${SMOKE_NAS_CONTAINER}:${SMOKE_NAS_PORT}/${SMOKE_NAS_MODULE}`;
/** A foreign file planted on the scratch NAS, and a hidden temporary planted in backups/. */
export const NAS_FOREIGN_PROBE = 'notes.txt';
export const LOCAL_PARTIAL_PROBE = '.x.partial';
/** How long a copy may take before its probe fails. */
export const NAS_COPY_WAIT_MS = 60_000;
const POLL_MS = 2_000;

/**
 * The scratch daemon's configuration (fixed text, sent on stdin). `refuse options` makes the
 * daemon reject any of those flags, a live proof that the copy never sends one. The daemon runs
 * as uid 1000, so there is no `max connections` (it needs a lock file under /var/run), no
 * `pid file` and no `uid`/`gid`; `use chroot = no` is required for a non-root daemon.
 */
export const RSYNCD_CONF = [
  'use chroot = no',
  `[${SMOKE_NAS_MODULE}]`,
  '  path = /nas',
  '  read only = no',
  '  list = yes',
  `  auth users = ${SMOKE_NAS_USER}`,
  '  secrets file = /conf/rsyncd.secrets',
  '  strict modes = yes',
  '  refuse options = delete remove-source-files partial inplace append',
  '',
].join('\n');

function nasSmokePaths(ctx, home) {
  const p = smokePaths(ctx, home);
  const nas = `${p.root}/nas`;
  return {
    ...p,
    nas,
    nasData: `${nas}/data`,
    nasConf: `${nas}/conf`,
    secrets: `${p.data}/secrets`,
  };
}

/** A generated password, as a shell expression (host side; never printed or sent back). */
const GENERATE_PW = `$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)`;

/** `curl` on the host printing the body, then the HTTP status on a last line of its own. */
function curlJson(method, url) {
  return `curl -s -w '\\n%{http_code}' ${method === 'POST' ? '-X POST ' : ''}${shq(url)}`;
}

/** Runs `curlJson` and parses: `{ status, body }` (body undefined when not JSON). */
async function api(ctx, purpose, method, path) {
  const r = await remote(ctx, purpose, curlJson(method, `${base}${path}`));
  const text = r.stdout.replace(/\n$/, '');
  const at = text.lastIndexOf('\n');
  const status = Number(at < 0 ? text : text.slice(at + 1));
  let body;
  try {
    body = JSON.parse(at < 0 ? '' : text.slice(0, at));
  } catch {
    body = undefined;
  }
  return {
    status: Number.isInteger(status) ? status : 0,
    body,
    raw: at < 0 ? '' : text.slice(0, at),
  };
}

/** `{ type, name, size, mtime }` of each entry directly inside `dir` on the host. */
async function listDir(ctx, purpose, dir) {
  const r = await remote(
    ctx,
    purpose,
    `find ${shq(dir)} -mindepth 1 -maxdepth 1 -printf '%y %s %T@ %f\\n' 2>/dev/null`,
  );
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(\S) (\d+) (\d+(?:\.\d+)?) (.+)$/.exec(line.trim());
    if (m) out.push({ type: m[1], size: Number(m[2]), mtime: m[3], name: m[4] });
  }
  return out;
}

/** Only the backup-named regular files, sorted by name. */
const backupFiles = (entries) =>
  entries
    .filter((e) => e.type === 'f' && BACKUP_FILE_NAME_RE.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

/**
 * "Copy to NAS now", then follow the run (the §8.1 rule: the 202 body's `lastRun.id` is the run;
 * it is done when a later GET shows that id not running, or a newer id). Returns
 * `{ status, run, nasCopy, bodies }`.
 */
async function copyAndWait(ctx, label) {
  const post = await api(ctx, `smoke-nas-copy-${label}`, 'POST', '/api/backups/nas-copy');
  const bodies = [post.raw];
  const followId = post.body?.nasCopy?.lastRun?.id;
  if (post.status !== 202 || typeof followId !== 'number') {
    return { status: post.status, run: undefined, nasCopy: post.body?.nasCopy, bodies, post };
  }
  const deadline = ctx.now().getTime() + NAS_COPY_WAIT_MS;
  for (;;) {
    const g = await api(ctx, `smoke-nas-poll-${label}`, 'GET', '/api/backups');
    bodies.push(g.raw);
    const run = g.body?.nasCopy?.lastRun;
    const done = run && ((run.id === followId && run.status !== 'running') || run.id > followId);
    if (done || ctx.dryRun)
      return { status: post.status, run, nasCopy: g.body?.nasCopy, bodies, post };
    if (ctx.now().getTime() >= deadline) {
      return { status: post.status, run: undefined, nasCopy: g.body?.nasCopy, bodies, post };
    }
    await ctx.sleep(POLL_MS);
  }
}

const detailOf = (run) => (run?.detail && typeof run.detail === 'object' ? run.detail : {});
const describeRun = (run) => {
  if (!run) return 'no finished run';
  const d = detailOf(run);
  return `${run.status}${d.reason ? ` (${d.reason})` : ''}: ${d.sent ?? '?'} sent, ${d.alreadyThere ?? '?'} already there, ${d.onNas ?? '?'} on the NAS`;
};

async function nas(ctx, home, explicitImage) {
  const paths = nasSmokePaths(ctx, home);
  const results = [];
  const judge = (ok) => ctx.dryRun || ok;
  const bodies = [];

  // 0. The smoke app must be running (`smoke start`), and the scratch NAS must not exist yet.
  const appState = await containerState(ctx, SMOKE_CONTAINER);
  if (appState !== 'running' && !ctx.dryRun) {
    throw new DeployError(
      `${SMOKE_CONTAINER} is not running (${appState}): run \`smoke start\` first`,
      1,
    );
  }
  const nasState = await containerState(ctx, SMOKE_NAS_CONTAINER);
  if (nasState !== 'missing') {
    throw new DeployError(
      `${SMOKE_NAS_CONTAINER} already exists (${nasState}): run \`smoke remove\` first`,
      3,
    );
  }
  let image = explicitImage;
  if (image === undefined) {
    const r = await remoteOk(
      ctx,
      'smoke-nas-image',
      `docker inspect -f '{{.Config.Image}}' ${SMOKE_CONTAINER}`,
      `Could not read the image of ${SMOKE_CONTAINER}`,
    );
    image =
      ctx.dryRun && r.stdout.trim() === ''
        ? '<the smoke image>'
        : validate('imageRef', r.stdout.trim(), 'smoke image');
  }

  // 1. The scratch NAS folders and its configuration (fixed text on stdin).
  await remoteOk(
    ctx,
    'smoke-nas-mkdir',
    `mkdir -p ${shq(paths.nasData)} ${shq(paths.nasConf)}`,
    'Could not create the scratch NAS folders',
  );
  await remoteOk(
    ctx,
    'smoke-nas-conf',
    `umask 077 && cat > ${shq(`${paths.nasConf}/rsyncd.conf`)}`,
    'Could not write the scratch NAS configuration',
    { input: RSYNCD_CONF, publicInput: true },
  );
  // 2. The scratch password: generated on the host, never printed or sent back.
  await remoteOk(
    ctx,
    'smoke-nas-password',
    `umask 077 && pw=${GENERATE_PW} && printf 'smoke:%s\\n' "$pw" > ${shq(`${paths.nasConf}/rsyncd.secrets`)} && ` +
      `mkdir -p ${shq(paths.secrets)} && chmod 700 ${shq(paths.secrets)} && ` +
      `printf '%s\\n' "$pw" > ${shq(`${paths.secrets}/nas-password`)}`,
    'Could not generate the scratch password',
  );
  // 3. The network, the daemon (the image's own rsync plays the NAS; no host port), the app on it.
  await remoteOk(
    ctx,
    'smoke-nas-network',
    `docker network inspect ${SMOKE_NET} >/dev/null 2>&1 || docker network create ${SMOKE_NET}`,
    'Could not create the smoke network',
  );
  await remoteOk(
    ctx,
    'smoke-nas-run',
    [
      'docker run -d',
      `--name ${SMOKE_NAS_CONTAINER}`,
      `--network ${SMOKE_NET}`,
      '--no-healthcheck',
      '--restart no',
      '--user 1000:1000',
      `-v ${shq(`${paths.nasData}:/nas`)}`,
      `-v ${shq(`${paths.nasConf}:/conf:ro`)}`,
      '--entrypoint rsync',
      shq(image),
      `--daemon --no-detach --port=${SMOKE_NAS_PORT} --config=/conf/rsyncd.conf`,
    ].join(' '),
    'Could not start the scratch NAS',
  );
  await remoteOk(
    ctx,
    'smoke-nas-connect',
    `docker network connect ${SMOKE_NET} ${SMOKE_CONTAINER} 2>/dev/null || docker inspect -f '{{json .NetworkSettings.Networks}}' ${SMOKE_CONTAINER} | grep -q '"${SMOKE_NET}"'`,
    `Could not connect ${SMOKE_CONTAINER} to ${SMOKE_NET}`,
  );
  // 4. nas-url (written after the password: the app never sees an address without its password).
  const writeUrl = (url) =>
    remoteOk(
      ctx,
      'smoke-nas-url',
      `umask 077 && echo ${shq(url)} > ${shq(`${paths.secrets}/nas-url`)}`,
      'Could not write nas-url',
    );
  await writeUrl(SMOKE_NAS_URL);

  // 5. Probes.
  const v = await remote(ctx, 'smoke-nas-rsync', `docker exec ${SMOKE_CONTAINER} rsync --version`);
  report(
    ctx,
    results,
    'rsync in the image',
    judge(v.code === 0),
    v.stdout.split('\n')[0].trim().slice(0, 60),
  );

  const ready = await api(ctx, 'smoke-nas-ready', 'GET', '/api/backups');
  bodies.push(ready.raw);
  report(
    ctx,
    results,
    'nasCopy.configured ready',
    judge(ready.body?.nasCopy?.configured === 'ready'),
    String(ready.body?.nasCopy?.configured),
  );

  const backup = await api(ctx, 'smoke-nas-backup', 'POST', '/api/backups');
  report(
    ctx,
    results,
    'POST /api/backups (a fresh backup)',
    judge(backup.status === 201),
    `HTTP ${backup.status}`,
  );

  // The first copy: everything sent, proved.
  const first = await copyAndWait(ctx, 'first');
  bodies.push(...first.bodies);
  const d1 = detailOf(first.run);
  report(
    ctx,
    results,
    'first copy',
    judge(
      first.status === 202 &&
        first.run?.status === 'succeeded' &&
        d1.sent === d1.localFiles &&
        d1.alreadyThere === 0 &&
        d1.sent > 0,
    ),
    `HTTP ${first.status}, ${describeRun(first.run)}`,
  );

  // On the host: the NAS holds every local backup at the same size, and no dot-file.
  const local1 = backupFiles(await listDir(ctx, 'smoke-nas-ls-local', paths.backups));
  const nas1 = await listDir(ctx, 'smoke-nas-ls', paths.nasData);
  const nasByName = new Map(nas1.map((e) => [e.name, e]));
  const sameSizes =
    local1.length > 0 && local1.every((f) => nasByName.get(f.name)?.size === f.size);
  const dotFiles = nas1.filter((e) => e.name.startsWith('.'));
  report(
    ctx,
    results,
    'the NAS folder matches the backups (names, sizes), no dot-file',
    judge(sameSizes && dotFiles.length === 0),
    `${local1.length} local, ${backupFiles(nas1).length} on the NAS, ${dotFiles.length} dot-file(s)`,
  );

  // A second copy sends nothing and changes nothing on the NAS.
  const second = await copyAndWait(ctx, 'second');
  bodies.push(...second.bodies);
  const d2 = detailOf(second.run);
  const nas2 = await listDir(ctx, 'smoke-nas-ls', paths.nasData);
  const unchanged =
    nas2.length === nas1.length &&
    nas2.every((e) => {
      const before = nasByName.get(e.name);
      return before && before.size === e.size && before.mtime === e.mtime;
    });
  report(
    ctx,
    results,
    'second copy sends nothing',
    judge(
      second.run?.status === 'succeeded' &&
        d2.sent === 0 &&
        d2.alreadyThere === d2.localFiles &&
        unchanged,
    ),
    `${describeRun(second.run)}; NAS folder ${unchanged ? 'unchanged' : 'CHANGED'}`,
  );

  // A foreign file on the NAS and a hidden temporary here: neither is touched nor copied.
  await remoteOk(
    ctx,
    'smoke-nas-plant',
    `echo foreign > ${shq(`${paths.nasData}/${NAS_FOREIGN_PROBE}`)} && echo partial > ${shq(`${paths.backups}/${LOCAL_PARTIAL_PROBE}`)}`,
    'Could not plant the probe files',
  );
  const foreignBefore = (await listDir(ctx, 'smoke-nas-ls', paths.nasData)).find(
    (e) => e.name === NAS_FOREIGN_PROBE,
  );
  const third = await copyAndWait(ctx, 'foreign');
  bodies.push(...third.bodies);
  const nas3 = await listDir(ctx, 'smoke-nas-ls', paths.nasData);
  const foreignAfter = nas3.find((e) => e.name === NAS_FOREIGN_PROBE);
  await remote(
    ctx,
    'smoke-nas-unplant',
    `rm -f -- ${shq(`${paths.backups}/${LOCAL_PARTIAL_PROBE}`)}`,
  );
  report(
    ctx,
    results,
    'a foreign file untouched, a hidden temporary not copied',
    judge(
      third.run?.status === 'succeeded' &&
        foreignBefore !== undefined &&
        foreignAfter?.size === foreignBefore.size &&
        foreignAfter?.mtime === foreignBefore.mtime &&
        !nas3.some((e) => e.name === LOCAL_PARTIAL_PROBE),
    ),
    describeRun(third.run),
  );

  // A wrong password: refused, the backups untouched, then the refusal lock.
  const beforeWrong = await api(ctx, 'smoke-nas-before-wrong', 'GET', '/api/backups');
  bodies.push(beforeWrong.raw);
  await remoteOk(
    ctx,
    'smoke-nas-wrong-password',
    `umask 077 && pw=${GENERATE_PW} && printf '%s\\n' "$pw" > ${shq(`${paths.secrets}/nas-password`)}`,
    'Could not write the wrong password',
  );
  const wrong = await copyAndWait(ctx, 'wrong');
  bodies.push(...wrong.bodies);
  const afterWrong = await api(ctx, 'smoke-nas-after-wrong', 'GET', '/api/backups');
  bodies.push(afterWrong.raw);
  const names = (b) => JSON.stringify((b?.backups ?? []).map((x) => x.name));
  report(
    ctx,
    results,
    'wrong password → auth, the backups untouched',
    judge(
      wrong.run?.status === 'failed' &&
        detailOf(wrong.run).reason === 'auth' &&
        names(afterWrong.body) === names(beforeWrong.body) &&
        afterWrong.body?.lastRun?.id === beforeWrong.body?.lastRun?.id,
    ),
    describeRun(wrong.run),
  );
  const lockedPost = await api(ctx, 'smoke-nas-locked', 'POST', '/api/backups/nas-copy');
  bodies.push(lockedPost.raw);
  const afterLock = await api(ctx, 'smoke-nas-after-lock', 'GET', '/api/backups');
  bodies.push(afterLock.raw);
  report(
    ctx,
    results,
    'the refusal lock: 409 NAS_COPY_FIX_FIRST, no new run',
    judge(
      afterWrong.body?.nasCopy?.blockedUntilFilesChange === true &&
        lockedPost.status === 409 &&
        lockedPost.body?.error?.code === 'NAS_COPY_FIX_FIRST' &&
        afterLock.body?.nasCopy?.lastRun?.id === wrong.run?.id,
    ),
    `HTTP ${lockedPost.status} ${String(lockedPost.body?.error?.code ?? '')}`,
  );
  // The right password again (a fresh write: a new mtime) unlocks it.
  await remoteOk(
    ctx,
    'smoke-nas-right-password',
    `umask 077 && pw=$(sed -n 's/^smoke://p' ${shq(`${paths.nasConf}/rsyncd.secrets`)}) && test -n "$pw" && ` +
      `printf '%s\\n' "$pw" > ${shq(`${paths.secrets}/nas-password`)}`,
    'Could not restore the password',
  );
  const unlocked = await api(ctx, 'smoke-nas-unlocked', 'GET', '/api/backups');
  bodies.push(unlocked.raw);
  const again = await copyAndWait(ctx, 'unlocked');
  bodies.push(...again.bodies);
  report(
    ctx,
    results,
    'placed again → unlocked, the copy succeeds',
    judge(
      unlocked.body?.nasCopy?.blockedUntilFilesChange === false &&
        again.run?.status === 'succeeded',
    ),
    describeRun(again.run),
  );

  // The NAS stopped.
  await remoteOk(
    ctx,
    'smoke-nas-stop',
    `docker stop ${SMOKE_NAS_CONTAINER}`,
    'Could not stop the scratch NAS',
  );
  const off = await copyAndWait(ctx, 'stopped');
  bodies.push(...off.bodies);
  await remoteOk(
    ctx,
    'smoke-nas-start',
    `docker start ${SMOKE_NAS_CONTAINER}`,
    'Could not start the scratch NAS again',
  );
  report(
    ctx,
    results,
    'NAS stopped → unreachable',
    judge(off.run?.status === 'failed' && detailOf(off.run).reason === 'unreachable'),
    describeRun(off.run),
  );

  // A subfolder that does not exist yet: created by the send, the files in it.
  await writeUrl(`${SMOKE_NAS_URL}/sub`);
  const sub = await copyAndWait(ctx, 'subfolder');
  bodies.push(...sub.bodies);
  const inSub = backupFiles(await listDir(ctx, 'smoke-nas-ls-sub', `${paths.nasData}/sub`));
  report(
    ctx,
    results,
    'a subfolder',
    judge(
      sub.run?.status === 'succeeded' &&
        inSub.length === detailOf(sub.run).localFiles &&
        inSub.length > 0,
    ),
    `${describeRun(sub.run)}; ${inSub.length} in sub/`,
  );

  // Leaks: counted on the host (the password never leaves it); the printed count must be 0.
  const pwVar = `pw=$(sed -n 's/^smoke://p' ${shq(`${paths.nasConf}/rsyncd.secrets`)})`;
  const needles = [
    ['password', '"$pw"'],
    ['rsync://', shq('rsync://')],
    [SMOKE_NAS_CONTAINER, shq(SMOKE_NAS_CONTAINER)],
  ];
  for (const [label, needle] of needles) {
    const logs = await remote(
      ctx,
      'smoke-nas-leak-logs',
      `${pwVar}; docker logs ${SMOKE_CONTAINER} 2>&1 | grep -c -F -- ${needle} || true`,
    );
    const bodiesCount = await remote(
      ctx,
      'smoke-nas-leak-bodies',
      `${pwVar}; { curl -s ${shq(`${base}/api/backups`)}; echo; curl -s ${shq(`${base}/api/status`)}; } | grep -c -F -- ${needle} || true`,
    );
    const n = logs.stdout.trim();
    const m = bodiesCount.stdout.trim();
    report(
      ctx,
      results,
      `no ${label} in the logs or the API bodies`,
      judge(n === '0' && m === '0'),
      `logs ${n || '?'}, bodies ${m || '?'}`,
    );
  }
  // The bodies saved during this run (PC side): no address in any of them.
  const saved = bodies.join('\n');
  report(
    ctx,
    results,
    'no address in the saved bodies',
    judge(saved.length > 0 && !saved.includes('rsync://') && !saved.includes(SMOKE_NAS_CONTAINER)),
    `${bodies.length} bodies`,
  );

  const failed = results.filter((r) => !r.ok).length;
  ctx.out(
    ctx.dryRun
      ? '(dry run: nothing was run, so no probe was judged)'
      : failed === 0
        ? `All ${results.length} NAS probes passed.`
        : `${failed} of ${results.length} NAS probes failed.`,
  );
  return failed === 0 ? 0 : 1;
}

// ─── mobile: the phone API on the rc container (stage-9.md §7.3) ──────────────────────────────

/** The made-up holding the `mobile` probe seeds (a generic coin; never the owner's data). */
export const SEED_INSTRUMENT = Object.freeze({
  kind: 'crypto',
  symbol: 'BTC',
  name: 'Smoke test coin',
  quoteCurrency: 'AUD',
  watched: false,
  targetRatio: null,
  sector: null,
  location: null,
  mgmtFeeRatio: null,
  regions: null,
  dividendFreqMonths: null,
  drp: null,
  defaultFee: null,
  note: null,
});
/** Its buy (made-up units and price), dated a week before the smoke runs. */
export function seedTrade(instrumentId, tradeDate) {
  return {
    instrumentId,
    side: 'buy',
    tradeDate,
    quantity: { mode: 'units', units: '0.01' },
    price: '50000',
    fee: { kind: 'flat', cents: 0 },
  };
}
/** How long the probe waits for the start-up intraday run and its day row after the restart. */
export const MOBILE_INTRADAY_WAIT_MS = 120_000;
const MOBILE_POLL_MS = 5_000;
/** Strings that must never reach the container's log (stage-9.md §11 step 18). */
export const MOBILE_LEAK_NEEDLES = ['jfk_', 'Bearer ', 'X-Joinr-Key', 'pair?v='];
/** A valid-looking backup name for the traversal corpus when none is listed. */
const CORPUS_BACKUP_FALLBACK = 'manual-20300101-000000+1100.db';

/** The §6.10 traversal corpus (raw paths, sent with `curl --path-as-is`). */
export function traversalCorpus(backupName) {
  return [
    '/api/mobile/../backups',
    '/api/mobile/%2e%2e/backups',
    '/api/mobile/%2E%2E%2Fbackups',
    '/api/mobile/..%2fbackups',
    '/api/mobile/today/../../backups',
    '/api/mobile//../backups',
    '/api/mobile/./today',
    '/api/mobile/;/../backups',
    '/api/mobile/today%00',
    '/api/mobile\\..\\backups',
    '/api/mobile/../status',
    '/api/mobile/../phone',
    `/api/mobile/../backups/${encodeURIComponent(backupName)}`,
  ];
}
export const CORPUS_METHODS = ['GET', 'HEAD', 'POST', 'DELETE'];
/** The only answers the corpus may get: the mobile hook's 401, or a 404/405 (never 200, never the SPA). */
const CORPUS_ALLOWED = new Set(['401', '404', '405']);

/**
 * The corpus as one host script (no secret in it): one line per request, `METHOD STATUS TYPE`
 * followed by the path's index, so the PC can judge every answer.
 */
export function corpusScript(paths) {
  const lines = ['exec 2>/dev/null'];
  paths.forEach((p, i) => {
    for (const m of CORPUS_METHODS) {
      const how = m === 'HEAD' ? '--head' : `-X ${m}`;
      lines.push(
        `printf '%s %s ' ${m} ${i}; curl --path-as-is -s -o /dev/null ${how} -w '%{http_code} %{content_type}\\n' ${shq(`${base}${p}`)}`,
      );
    }
  });
  return `${lines.join('\n')}\n`;
}

/**
 * The secret part as ONE host shell script (stage-9.md §7.3; the Stage 8 `pw=$(…)` pattern): the
 * pairing code and the device key live only in shell variables on the host; the key reaches curl
 * on stdin (`--config -`), never in argv; only status lines and shape checks are printed.
 */
export function mobileScript() {
  return `exec 2>/dev/null
set -u
B=${shq(base)}
split() { st=$(printf '%s' "$resp" | tail -n 1); body=$(printf '%s' "$resp" | sed '$d'); }
errcode() { printf '%s' "$body" | sed -n 's/.*"code":"\\([A-Z_]*\\)".*/\\1/p' | head -n 1; }
okword() { if [ -n "$1" ]; then echo ok; else echo missing; fi; }
today() { resp=$(printf 'header = "Authorization: Bearer %s"\\n' "$key" | curl -s --config - -w '\\n%{http_code}' "$B/api/mobile/today"); split; }
key=''
id=''
resp=$(curl -s -X POST -w '\\n%{http_code}' "$B/api/phone/pairing"); split
code=$(printf '%s' "$body" | sed -n 's/.*"code":"\\([0-9A-HJKMNP-TV-Z]\\{10\\}\\)".*/\\1/p' | head -n 1)
echo "open $st code=$(okword "$code")"
if [ -n "$code" ]; then
  resp=$(printf '{"code":"%s","deviceName":"Smoke test","appVersion":"smoke"}' "$code" | curl -s -X POST -H 'content-type: application/json' --data-binary @- -w '\\n%{http_code}' "$B/api/mobile/pair"); split
  key=$(printf '%s' "$body" | sed -n 's/.*"key":"\\(jfk_[A-Za-z0-9_-]\\{43\\}\\)".*/\\1/p' | head -n 1)
  id=$(printf '%s' "$body" | sed -n 's/.*"deviceId":"\\(d_[0-9a-f]\\{16\\}\\)".*/\\1/p' | head -n 1)
  echo "pair $st key=$(okword "$key") device=$(okword "$id")"
fi
code=''
if [ -n "$key" ]; then
  today
  if [ "$st" = 200 ]; then
    body=$(printf '%s' "$body" | tr -d ' \\t\\r\\n')
    n=$(printf '%s' "$body" | grep -o '"dayStatus":"' | wc -l | tr -d ' ')
    s=$(printf '%s' "$body" | grep -o '"session":{' | wc -l | tr -d ' ')
    v=missing
    if printf '%s' "$body" | grep -q '"apiVersion":1[,}]'; then v=1; fi
    shape=ok
    for f in '"serverVersion":"' '"generatedAt":"' '"timeZone":"' '"localDate":"' '"market":{' '"freshness":{' '"totals":{' '"portfolioLine":' '"holdings":['; do
      if ! printf '%s' "$body" | grep -qF "$f"; then shape=missing; fi
    done
    echo "today $st apiVersion=$v holdings=$n sessions=$s shape=$shape"
  else
    echo "today $st $(errcode)"
  fi
fi
resp=$(curl -s -X POST -w '\\n%{http_code}' "$B/api/mobile/today"); split
echo "post $st $(errcode)"
if [ -n "$id" ]; then
  resp=$(curl -s -X POST -w '\\n%{http_code}' "$B/api/phone/devices/$id/revoke"); split
  echo "revoke $st"
  if [ -n "$key" ]; then today; echo "revoked-today $st $(errcode)"; fi
else
  curl -s -o /dev/null -X DELETE "$B/api/phone/pairing"
  echo "revoke skipped"
fi
key=''
id=''
`;
}

/** The script as `--dry-run` prints it: every variable expansion shown as <redacted>. */
export function redactScript(script) {
  // sed's own `'$d'` (delete the last line) is not a shell expansion.
  return script.replace(
    /"\$[A-Za-z_][A-Za-z0-9_]*"|\$\{[A-Za-z_][A-Za-z0-9_]*\}|(?<!')\$[A-Za-z_][A-Za-z0-9_]*/g,
    '<redacted>',
  );
}

/** Parses the host script's status lines into `{ word: [fields…] }`. */
export function parseScriptLines(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0]) out[parts[0]] = parts.slice(1);
  }
  return out;
}

/** `key=value` fields of one status line. */
const fieldsOf = (parts = []) =>
  Object.fromEntries(parts.filter((p) => p.includes('=')).map((p) => p.split('=', 2)));

/** A curl call on the host sending a JSON body on stdin (fixed, public text). */
async function apiSend(ctx, purpose, method, path, body) {
  const r = await remote(
    ctx,
    purpose,
    `curl -s -w '\\n%{http_code}' -X ${method} -H 'content-type: application/json' --data-binary @- ${shq(`${base}${path}`)}`,
    { input: JSON.stringify(body), publicInput: true },
  );
  const text = r.stdout.replace(/\n$/, '');
  const at = text.lastIndexOf('\n');
  const status = Number(at < 0 ? text : text.slice(at + 1));
  let parsed;
  try {
    parsed = JSON.parse(at < 0 ? '' : text.slice(0, at));
  } catch {
    parsed = undefined;
  }
  return { status: Number.isInteger(status) ? status : 0, body: parsed };
}

/** The date `days` before `now` in the server's zone (YYYY-MM-DD). */
export function zoneDate(now, days = 0, timeZone = DEFAULT_TZ) {
  const d = new Date(now.getTime() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Counts read from the container's database (read-only; node:sqlite in the image's Node). */
const DB_COUNTS_JS = [
  "const { DatabaseSync } = require('node:sqlite');",
  "const db = new DatabaseSync('/data/finance.db', { readOnly: true });",
  'const n = (s) => db.prepare(s).get().n;',
  'console.log(JSON.stringify({',
  '  intraday: n("SELECT count(*) AS n FROM job_runs WHERE job = \'intraday\'"),',
  '  dayRows: n("SELECT count(*) AS n FROM day_quotes d JOIN instruments i ON i.id = d.instrument_id WHERE i.symbol = \'BTC\'"),',
  '}));',
].join(' ');

async function mobile(ctx, home) {
  const paths = smokePaths(ctx, home);
  const results = [];
  const judge = (ok) => ctx.dryRun || ok;

  // 0. The smoke app must be running (`smoke start`).
  const appState = await containerState(ctx, SMOKE_CONTAINER);
  if (appState !== 'running' && !ctx.dryRun) {
    throw new DeployError(
      `${SMOKE_CONTAINER} is not running (${appState}): run \`smoke start\` first`,
      1,
    );
  }

  // 1. The database level (0006 applied).
  const h = await api(ctx, 'smoke-mobile-health', 'GET', '/api/health');
  report(
    ctx,
    results,
    `/api/health migrations ${EXPECTED_MIGRATIONS}`,
    judge(h.body?.status === 'ok' && h.body?.db?.migrations === EXPECTED_MIGRATIONS),
    `migrations ${String(h.body?.db?.migrations)}`,
  );

  // 2. No key → 401 DEVICE_KEY_MISSING.
  const nokey = await api(ctx, 'smoke-mobile-nokey', 'GET', '/api/mobile/today');
  report(
    ctx,
    results,
    'GET /api/mobile/today without a key → 401 DEVICE_KEY_MISSING',
    judge(nokey.status === 401 && nokey.body?.error?.code === 'DEVICE_KEY_MISSING'),
    `HTTP ${nokey.status} ${String(nokey.body?.error?.code ?? '')}`,
  );

  // 3. Seed a made-up crypto holding (once; a re-run finds it there), resolve its coin id with a
  //    price refresh, then restart: the start-up intraday run (30 s after start) fetches its day.
  const inst = await apiSend(ctx, 'smoke-mobile-seed', 'POST', '/api/instruments', SEED_INSTRUMENT);
  let seeded = inst.status === 409;
  if (inst.status === 201 && Number.isInteger(inst.body?.id)) {
    const trade = await apiSend(
      ctx,
      'smoke-mobile-seed-trade',
      'POST',
      '/api/trades',
      seedTrade(inst.body.id, zoneDate(ctx.now(), 7)),
    );
    seeded = trade.status === 201;
  }
  report(
    ctx,
    results,
    'a made-up crypto holding seeded',
    judge(seeded),
    inst.status === 409 ? 'already there' : `HTTP ${inst.status}`,
  );
  const refresh = await apiSend(ctx, 'smoke-mobile-refresh', 'POST', '/api/prices/refresh', {});
  report(
    ctx,
    results,
    'POST /api/prices/refresh',
    judge(refresh.status === 200),
    `HTTP ${refresh.status}`,
  );
  await remoteOk(
    ctx,
    'smoke-mobile-restart',
    `docker restart ${SMOKE_CONTAINER}`,
    `Could not restart ${SMOKE_CONTAINER}`,
  );
  const healthy = await waitHealthy(ctx, SMOKE_CONTAINER);
  report(ctx, results, 'healthy after the restart', judge(healthy), healthy ? '' : 'not healthy');

  // 4. The start-up intraday run and the seeded holding's day row (the database, read-only).
  let counts;
  const deadline = ctx.now().getTime() + MOBILE_INTRADAY_WAIT_MS;
  for (;;) {
    const r = await remote(
      ctx,
      'smoke-mobile-db',
      `docker exec ${SMOKE_CONTAINER} node -e ${shq(DB_COUNTS_JS)}`,
    );
    try {
      counts = JSON.parse(r.stdout);
    } catch {
      counts = undefined;
    }
    if (ctx.dryRun || (counts?.intraday > 0 && counts?.dayRows > 0)) break;
    if (ctx.now().getTime() >= deadline) break;
    await ctx.sleep(MOBILE_POLL_MS);
  }
  report(
    ctx,
    results,
    'an intraday run in job_runs (the start-up run)',
    judge(counts?.intraday > 0),
    `${String(counts?.intraday ?? '?')} run(s)`,
  );
  report(
    ctx,
    results,
    'a day row for the seeded holding',
    judge(counts?.dayRows > 0),
    `${String(counts?.dayRows ?? '?')} row(s)`,
  );

  // 5. open → pair → today → POST → revoke → today: one host script, secrets in host variables.
  const script = mobileScript();
  if (ctx.dryRun) {
    ctx.out(
      '[dry-run] the host script for open → pair → today → POST → revoke (secrets redacted):',
    );
    for (const line of redactScript(script).replace(/\n$/, '').split('\n')) ctx.out(`  ${line}`);
  }
  const s = await remote(ctx, 'smoke-mobile-script', 'sh -s', { input: script });
  const lines = parseScriptLines(s.stdout);
  const open = lines.open ?? [];
  report(
    ctx,
    results,
    'POST /api/phone/pairing → 201 with a code',
    judge(open[0] === '201' && fieldsOf(open).code === 'ok'),
    open.join(' ') || 'no answer',
  );
  const pair = lines.pair ?? [];
  const pf = fieldsOf(pair);
  report(
    ctx,
    results,
    'POST /api/mobile/pair (no Origin) → 201 with a key',
    judge(pair[0] === '201' && pf.key === 'ok' && pf.device === 'ok'),
    pair.join(' ') || 'no answer',
  );
  const today = lines.today ?? [];
  const tf = fieldsOf(today);
  report(
    ctx,
    results,
    'GET /api/mobile/today with the key → 200 and the shape',
    judge(
      today[0] === '200' &&
        tf.apiVersion === '1' &&
        tf.shape === 'ok' &&
        Number(tf.holdings) > 0 &&
        Number(tf.sessions) > 0,
    ),
    today.join(' ') || 'no answer',
  );
  const post = lines.post ?? [];
  report(
    ctx,
    results,
    'POST /api/mobile/today → 405 MOBILE_READ_ONLY',
    judge(post[0] === '405' && post[1] === 'MOBILE_READ_ONLY'),
    post.join(' ') || 'no answer',
  );
  const revoke = lines.revoke ?? [];
  report(ctx, results, 'revoke → 200', judge(revoke[0] === '200'), revoke.join(' ') || 'no answer');
  const after = lines['revoked-today'] ?? [];
  report(
    ctx,
    results,
    'the revoked key → 401 DEVICE_KEY_REVOKED',
    judge(after[0] === '401' && after[1] === 'DEVICE_KEY_REVOKED'),
    after.join(' ') || 'no answer',
  );

  // 6. The traversal corpus, raw (curl --path-as-is), every path with GET, HEAD, POST and DELETE.
  const list = await api(ctx, 'smoke-mobile-backups', 'GET', '/api/backups');
  const listed = list.body?.backups?.[0]?.name;
  const backupName =
    typeof listed === 'string' && BACKUP_FILE_NAME_RE.test(listed)
      ? listed
      : CORPUS_BACKUP_FALLBACK;
  const corpus = traversalCorpus(backupName);
  const c = await remote(ctx, 'smoke-mobile-corpus', 'sh -s', {
    input: corpusScript(corpus),
    publicInput: true,
  });
  const answers = c.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 3 && CORPUS_METHODS.includes(p[0]));
  const bad = answers.filter(
    ([, , status, type = '']) => !CORPUS_ALLOWED.has(status) || type.startsWith('text/html'),
  );
  const expected = corpus.length * CORPUS_METHODS.length;
  report(
    ctx,
    results,
    `the traversal corpus (${expected} raw requests) → 401/404/405 only`,
    judge(answers.length === expected && bad.length === 0),
    bad.length > 0
      ? bad
          .slice(0, 4)
          .map(([m, i, st, ty]) => `${m} ${corpus[Number(i)] ?? '?'} → ${st} ${ty ?? ''}`)
          .join('; ')
      : `${answers.length} answers`,
  );

  // 7. The device store's folder and file modes (0700, 0600, uid 1000), read on the host.
  const st = await remote(
    ctx,
    'smoke-mobile-modes',
    `stat -c '%a %u' ${shq(`${paths.data}/devices`)} ${shq(`${paths.data}/devices/devices.json`)}`,
  );
  const [dirMode, fileMode] = st.stdout.trim().split('\n');
  report(
    ctx,
    results,
    'devices/ 0700 and devices.json 0600, uid 1000',
    judge(dirMode === '700 1000' && fileMode === '600 1000'),
    `${dirMode ?? '?'} / ${fileMode ?? '?'}`,
  );

  // 8. Leaks: counts only come back.
  for (const needle of MOBILE_LEAK_NEEDLES) {
    const r = await remote(
      ctx,
      'smoke-mobile-leak',
      `docker logs ${SMOKE_CONTAINER} 2>&1 | grep -c -F -- ${shq(needle)} || true`,
    );
    const n = r.stdout.trim();
    report(
      ctx,
      results,
      `no ${JSON.stringify(needle)} in the logs`,
      judge(n === '0'),
      `count ${n || '?'}`,
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  ctx.out(
    ctx.dryRun
      ? '(dry run: nothing was run, so no probe was judged)'
      : failed === 0
        ? `All ${results.length} mobile probes passed.`
        : `${failed} of ${results.length} mobile probes failed.`,
  );
  return failed === 0 ? 0 : 1;
}

async function removeSmoke(ctx, home) {
  const paths = smokePaths(ctx, home);
  for (const name of [SMOKE_NAS_CONTAINER, SMOKE_CONTAINER]) {
    const state = await containerState(ctx, name);
    if (state !== 'missing') {
      await remoteOk(
        ctx,
        name === SMOKE_CONTAINER ? 'smoke-rm' : 'smoke-nas-rm',
        `docker rm -f ${name}`,
        `Could not remove ${name}`,
      );
    }
  }
  await remoteOk(
    ctx,
    'smoke-net-rm',
    `if docker network inspect ${SMOKE_NET} >/dev/null 2>&1; then docker network rm ${SMOKE_NET}; fi`,
    `Could not remove the network ${SMOKE_NET}`,
  );
  // The whole smoke folder: data/ and the scratch NAS's nas/ (a validated absolute path).
  await remoteOk(
    ctx,
    'smoke-rmdir',
    `rm -rf -- ${shq(paths.root)}`,
    'Could not remove the smoke folder',
  );
  ctx.out(
    `Removed ${SMOKE_CONTAINER}, ${SMOKE_NAS_CONTAINER}, the network ${SMOKE_NET} and the smoke folder (the scratch NAS included).`,
  );
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
  if (positional.length !== 1 || !['start', 'check', 'nas', 'mobile', 'remove'].includes(command))
    throw new DeployError(USAGE, 2);
  // start never guesses its image: the runbook always names the rc tag, and a bare
  // `smoke start` must fail before anything is spawned (no binaries, no preflight, no ssh).
  if (command === 'start' && flags.image === undefined)
    throw new DeployError('smoke start needs --image <ref>', 2);
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  const explicit =
    flags.image !== undefined ? validate('imageRef', flags.image, '--image') : undefined;
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  if (command === 'start') return start(ctx, home, explicit);
  if (command === 'check') return check(ctx, home);
  if (command === 'nas') return nas(ctx, home, explicit);
  if (command === 'mobile') return mobile(ctx, home);
  return removeSmoke(ctx, home);
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
