// `pnpm umbrel:smoke start | check | nas | remove [--image <ref>] [--dry-run]` (stage-7.md §7.6,
// §9 step S; stage-8.md §9.2).
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
  'Usage: node tools/deploy/smoke.mjs (start | check | nas | remove) [--image <ref>] [--dry-run]';

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
  if (positional.length !== 1 || !['start', 'check', 'nas', 'remove'].includes(command))
    throw new DeployError(USAGE, 2);
  const ctx = createContext(deps, { dryRun: flags['dry-run'] === true, dryRunReply });
  const explicit =
    flags.image !== undefined ? validate('imageRef', flags.image, '--image') : undefined;
  const image =
    explicit ?? imageRef(ctx.config, (deps.readVersion ?? readAppVersion)(ctx.repoRoot));
  resolveBinaries(ctx, { needGit: false });
  await preflight(ctx);
  const home = await remoteHome(ctx);
  if (command === 'start') return start(ctx, home, image);
  if (command === 'check') return check(ctx, home);
  if (command === 'nas') return nas(ctx, home, explicit);
  return removeSmoke(ctx, home);
}

if (isEntry(import.meta.url)) {
  process.exitCode = await runMain(() => main(process.argv.slice(2)));
}
