// `smoke nas` (stage-8.md §9.2) and the NAS lines of `status` (§9.3), on the fake host: no ssh,
// no docker, no rsync. The scratch NAS is a Docker name; no address or real value appears here.
import { afterEach, describe, expect, it } from 'vitest';
import { NAS_COPY_WAIT_MS, RSYNCD_CONF, SMOKE_NAS_URL, main as smoke } from '../smoke.mjs';
import { main as status } from '../status.mjs';
import { DIGEST, HOME, fakeHost, makeStore, remoteCommand, remoteCommands } from './helpers.mjs';

const ROOT = `${HOME}/joinr-build/smoke`;
const IMAGE = '127.0.0.1:4930/joinr-finance:1.1.0-rc.1';
const LOCAL = [
  { name: 'nightly-20300314-023000+1100.db', size: 4_200_000 },
  { name: 'manual-20300315-143200+1100.db', size: 4_300_000 },
];
const listing = (files) =>
  files.map((f) => `f ${f.size} ${f.mtime ?? '1900000000.5'} ${f.name}`).join('\n');
const json = (body, code) => ({ stdout: `${JSON.stringify(body)}\n${code}` });

/** The runs the fake app finishes, by probe label. */
const RUNS = {
  first: { status: 'succeeded', detail: { localFiles: 2, sent: 2, alreadyThere: 0, onNas: 2 } },
  second: { status: 'succeeded', detail: { localFiles: 2, sent: 0, alreadyThere: 2, onNas: 2 } },
  foreign: { status: 'succeeded', detail: { localFiles: 2, sent: 0, alreadyThere: 2, onNas: 2 } },
  wrong: { status: 'failed', detail: { reason: 'auth', exitCode: 5 } },
  unlocked: { status: 'succeeded', detail: { localFiles: 2, sent: 0, alreadyThere: 2, onNas: 2 } },
  stopped: { status: 'failed', detail: { reason: 'unreachable', exitCode: 10 } },
  subfolder: { status: 'succeeded', detail: { localFiles: 2, sent: 2, alreadyThere: 0, onNas: 2 } },
};
const LABELS = Object.keys(RUNS);
const idOf = (label) => LABELS.indexOf(label) + 1;
const BACKUPS = { backups: LOCAL.map((f) => ({ name: f.name })), lastRun: { id: 90 } };

/** A fake Umbrel where the smoke app and its scratch NAS behave; `over` replaces replies. */
function nasHost(over = {}) {
  const polls = {};
  let nasListings = 0;
  const withForeign = [...LOCAL, { name: 'notes.txt', size: 8, mtime: '1900000001.0' }];
  const replies = {
    'container-state': (s) =>
      remoteCommand(s).includes("'joinr-smoke-nas'")
        ? { code: 1, stderr: 'Error: No such object: joinr-smoke-nas' }
        : { stdout: 'running\n' },
    'smoke-nas-image': { stdout: `${IMAGE}\n` },
    'smoke-nas-rsync': { stdout: 'rsync  version 3.2.7  protocol version 31\n' },
    'smoke-nas-ready': json({ nasCopy: { configured: 'ready' } }, 200),
    'smoke-nas-backup': json({ backup: {} }, 201),
    'smoke-nas-ls-local': {
      stdout: `${listing(LOCAL)}\nf 7 1900000000.0 .x.partial\nf 3 1900000000.0 stray.txt`,
    },
    'smoke-nas-ls': () => {
      nasListings += 1;
      return { stdout: listing(nasListings <= 2 ? LOCAL : withForeign) };
    },
    'smoke-nas-ls-sub': { stdout: listing(LOCAL) },
    'smoke-nas-before-wrong': json(
      { ...BACKUPS, nasCopy: { blockedUntilFilesChange: false } },
      200,
    ),
    'smoke-nas-after-wrong': json({ ...BACKUPS, nasCopy: { blockedUntilFilesChange: true } }, 200),
    'smoke-nas-locked': json({ error: { code: 'NAS_COPY_FIX_FIRST', message: 'x' } }, 409),
    'smoke-nas-after-lock': json({ ...BACKUPS, nasCopy: { lastRun: { id: idOf('wrong') } } }, 200),
    'smoke-nas-unlocked': json({ ...BACKUPS, nasCopy: { blockedUntilFilesChange: false } }, 200),
    'smoke-nas-leak-logs': { stdout: '0\n' },
    'smoke-nas-leak-bodies': { stdout: '0\n' },
  };
  for (const label of LABELS) {
    replies[`smoke-nas-copy-${label}`] = json(
      {
        joined: false,
        nasCopy: { running: true, lastRun: { id: idOf(label), status: 'running' } },
      },
      202,
    );
    // The first poll still sees the run in flight; the second sees it finished.
    replies[`smoke-nas-poll-${label}`] = () => {
      polls[label] = (polls[label] ?? 0) + 1;
      const run =
        polls[label] === 1
          ? { id: idOf(label), status: 'running', detail: null }
          : { id: idOf(label), ...RUNS[label] };
      return json({ nasCopy: { running: polls[label] === 1, lastRun: run } }, 200);
    };
  }
  return fakeHost({ ...replies, ...over });
}

describe('smoke nas', () => {
  it('every probe passes against a behaving scratch NAS', async () => {
    const h = nasHost();
    expect(await smoke(['nas'], h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).not.toMatch(/^FAIL/m);
    expect(h.out.at(-1)).toMatch(/^All \d+ NAS probes passed\.$/);
    for (const name of [
      'rsync in the image',
      'nasCopy.configured ready',
      'first copy',
      'the NAS folder matches the backups (names, sizes), no dot-file',
      'second copy sends nothing',
      'a foreign file untouched, a hidden temporary not copied',
      'wrong password → auth, the backups untouched',
      'the refusal lock: 409 NAS_COPY_FIX_FIRST, no new run',
      'placed again → unlocked, the copy succeeds',
      'NAS stopped → unreachable',
      'a subfolder',
      'no password in the logs or the API bodies',
      'no rsync:// in the logs or the API bodies',
      'no joinr-smoke-nas in the logs or the API bodies',
      'no address in the saved bodies',
    ]) {
      expect(text).toContain(`PASS  ${name}`);
    }
  });

  it('sets up the scratch NAS with the exact commands (the image reused, no host port)', async () => {
    const h = nasHost();
    await smoke(['nas'], h.deps());
    const cmd = (p) => remoteCommand(h.callsFor(p)[0]);
    expect(cmd('smoke-nas-mkdir')).toBe(`mkdir -p '${ROOT}/nas/data' '${ROOT}/nas/conf'`);
    const conf = h.callsFor('smoke-nas-conf')[0];
    expect(remoteCommand(conf)).toBe(`umask 077 && cat > '${ROOT}/nas/conf/rsyncd.conf'`);
    expect(conf.input).toBe(RSYNCD_CONF);
    expect(conf.publicInput).toBe(true);
    expect(RSYNCD_CONF).toContain(
      '  refuse options = delete remove-source-files partial inplace append\n',
    );
    expect(RSYNCD_CONF).toMatch(/^use chroot = no\n\[smoke\]\n/);
    expect(RSYNCD_CONF).not.toMatch(/max connections|pid file|^\s*(uid|gid)\s*=/m);
    expect(cmd('smoke-nas-password')).toBe(
      `umask 077 && pw=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20) && printf 'smoke:%s\\n' "$pw" > '${ROOT}/nas/conf/rsyncd.secrets' && ` +
        `mkdir -p '${ROOT}/data/secrets' && chmod 700 '${ROOT}/data/secrets' && printf '%s\\n' "$pw" > '${ROOT}/data/secrets/nas-password'`,
    );
    expect(cmd('smoke-nas-network')).toBe(
      'docker network inspect joinr-smoke-net >/dev/null 2>&1 || docker network create joinr-smoke-net',
    );
    expect(cmd('smoke-nas-run')).toBe(
      `docker run -d --name joinr-smoke-nas --network joinr-smoke-net --no-healthcheck --restart no --user 1000:1000 ` +
        `-v '${ROOT}/nas/data:/nas' -v '${ROOT}/nas/conf:/conf:ro' --entrypoint rsync '${IMAGE}' ` +
        '--daemon --no-detach --port=8873 --config=/conf/rsyncd.conf',
    );
    expect(cmd('smoke-nas-run')).not.toMatch(/ -p /);
    expect(cmd('smoke-nas-connect')).toMatch(
      /^docker network connect joinr-smoke-net joinr-smoke /,
    );
    expect(h.callsFor('smoke-nas-url').map(remoteCommand)).toEqual([
      `umask 077 && echo '${SMOKE_NAS_URL}' > '${ROOT}/data/secrets/nas-url'`,
      `umask 077 && echo '${SMOKE_NAS_URL}/sub' > '${ROOT}/data/secrets/nas-url'`,
    ]);
    expect(SMOKE_NAS_URL).toBe('rsync://smoke@joinr-smoke-nas:8873/smoke');
    // The password is written before the address, and the PC never holds it: the only stdin
    // is the fixed configuration.
    const order = h.purposes();
    expect(order.indexOf('smoke-nas-password')).toBeLessThan(order.indexOf('smoke-nas-url'));
    expect(h.calls.filter((c) => c.input !== undefined).map((c) => c.purpose)).toEqual([
      'smoke-nas-conf',
    ]);
  });

  it('the wrong-password and lock probes: a fresh password, then the right one again', async () => {
    const h = nasHost();
    await smoke(['nas'], h.deps());
    expect(remoteCommand(h.callsFor('smoke-nas-wrong-password')[0])).toBe(
      `umask 077 && pw=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20) && printf '%s\\n' "$pw" > '${ROOT}/data/secrets/nas-password'`,
    );
    expect(remoteCommand(h.callsFor('smoke-nas-right-password')[0])).toBe(
      `umask 077 && pw=$(sed -n 's/^smoke://p' '${ROOT}/nas/conf/rsyncd.secrets') && test -n "$pw" && printf '%s\\n' "$pw" > '${ROOT}/data/secrets/nas-password'`,
    );
    expect(remoteCommand(h.callsFor('smoke-nas-locked')[0])).toBe(
      "curl -s -w '\\n%{http_code}' -X POST 'http://127.0.0.1:4939/api/backups/nas-copy'",
    );
    expect(remoteCommand(h.callsFor('smoke-nas-stop')[0])).toBe('docker stop joinr-smoke-nas');
    expect(remoteCommand(h.callsFor('smoke-nas-start')[0])).toBe('docker start joinr-smoke-nas');
  });

  it('every leak probe counts with grep -c … || true, on the host', async () => {
    const h = nasHost();
    await smoke(['nas'], h.deps());
    const leaks = [
      ...h.callsFor('smoke-nas-leak-logs'),
      ...h.callsFor('smoke-nas-leak-bodies'),
    ].map(remoteCommand);
    expect(leaks).toHaveLength(6);
    for (const c of leaks) {
      expect(c).toMatch(/\| grep -c -F -- \S+ \|\| true$/);
      expect(c.startsWith(`pw=$(sed -n 's/^smoke://p' '${ROOT}/nas/conf/rsyncd.secrets'); `)).toBe(
        true,
      );
    }
    expect(leaks.filter((c) => c.includes('docker logs joinr-smoke 2>&1'))).toHaveLength(3);
    for (const needle of ['"$pw"', "'rsync://'", "'joinr-smoke-nas'"])
      expect(leaks.filter((c) => c.includes(`-- ${needle} ||`))).toHaveLength(2);
  });

  it.each([
    ['a leak count of 2', { 'smoke-nas-leak-logs': { stdout: '2\n' } }, 'no password in the logs'],
    ['an empty count', { 'smoke-nas-leak-bodies': { stdout: '' } }, 'no password in the logs'],
    [
      'a failed first copy',
      {
        'smoke-nas-poll-first': json(
          { nasCopy: { lastRun: { id: 1, status: 'failed', detail: { reason: 'other' } } } },
          200,
        ),
      },
      'first copy',
    ],
    [
      'a second copy that sent something',
      {
        'smoke-nas-poll-second': json(
          {
            nasCopy: {
              lastRun: {
                id: 2,
                status: 'succeeded',
                detail: { localFiles: 2, sent: 1, alreadyThere: 1 },
              },
            },
          },
          200,
        ),
      },
      'second copy sends nothing',
    ],
    [
      'a dot-file on the NAS',
      { 'smoke-nas-ls': { stdout: `${listing(LOCAL)}\nf 3 1900000000.0 .nightly.tmp` } },
      'the NAS folder matches',
    ],
    [
      'a lock that does not hold',
      { 'smoke-nas-locked': json({ joined: false, nasCopy: {} }, 202) },
      'the refusal lock',
    ],
    [
      'a NAS that answers when stopped',
      {
        'smoke-nas-poll-stopped': json(
          { nasCopy: { lastRun: { id: 6, status: 'succeeded', detail: {} } } },
          200,
        ),
      },
      'NAS stopped → unreachable',
    ],
    [
      'an address in a body',
      {
        'smoke-nas-ready': json(
          { nasCopy: { configured: 'ready', x: 'rsync://smoke@joinr-smoke-nas:8873/smoke' } },
          200,
        ),
      },
      'no address in the saved bodies',
    ],
  ])('fails (exit 1) on %s', async (_l, over, probe) => {
    const h = nasHost(over);
    expect(await smoke(['nas'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toContain(`FAIL  ${probe}`);
    expect(h.out.at(-1)).toMatch(/NAS probes failed\.$/);
  });

  it('a copy that never finishes fails its probe after the wait, polling every 2 s', async () => {
    const h = nasHost({
      'smoke-nas-poll-first': json({ nasCopy: { lastRun: { id: 1, status: 'running' } } }, 200),
    });
    expect(await smoke(['nas'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toContain('FAIL  first copy');
    expect(h.callsFor('smoke-nas-poll-first').length).toBe(NAS_COPY_WAIT_MS / 2_000 + 1);
  });

  it('refuses when the smoke app is not running (exit 1) or the scratch NAS exists (exit 3)', async () => {
    const stopped = nasHost({ 'container-state': { code: 1, stderr: 'No such object' } });
    await expect(smoke(['nas'], stopped.deps())).rejects.toMatchObject({ exitCode: 1 });
    const exists = nasHost({ 'container-state': { stdout: 'running\n' } });
    await expect(smoke(['nas'], exists.deps())).rejects.toMatchObject({ exitCode: 3 });
    expect(exists.callsFor('smoke-nas-run')).toHaveLength(0);
  });

  it('--image overrides the image read from the smoke container', async () => {
    const h = nasHost();
    await smoke(['nas', '--image', '127.0.0.1:4930/joinr-finance:9.9.9-rc.2'], h.deps());
    expect(h.callsFor('smoke-nas-image')).toHaveLength(0);
    expect(remoteCommand(h.callsFor('smoke-nas-run')[0])).toContain(
      "'127.0.0.1:4930/joinr-finance:9.9.9-rc.2'",
    );
  });

  it('--dry-run prints the conf on stdin and every command, runs nothing, judges nothing', async () => {
    const h = nasHost();
    expect(await smoke(['--dry-run', 'nas'], h.deps())).toBe(0);
    expect(h.calls).toHaveLength(0);
    const text = h.out.join('\n');
    expect(text).toContain(`<<'STDIN'\n${RSYNCD_CONF}STDIN`);
    expect(text).toContain('--no-healthcheck --restart no');
    expect(text).not.toMatch(/^(PASS|FAIL)/m);
    expect(h.out.at(-1)).toBe('(dry run: nothing was run, so no probe was judged)');
  });

  it('no remote command of the whole run carries an address other than the scratch name', async () => {
    const h = nasHost();
    await smoke(['nas'], h.deps());
    const all = remoteCommands(h.calls).join('\n');
    for (const m of all.matchAll(/rsync:\/\/[^'\s]+/g)) {
      expect(m[0].startsWith(SMOKE_NAS_URL)).toBe(true);
    }
  });
});

describe('status: the NAS files (§9.3)', () => {
  let store;
  afterEach(() => {
    store?.cleanup();
    store = undefined;
  });
  const released = () => ({
    compose: `  app:\n    image: 127.0.0.1:4930/joinr-finance:1.0.0@${DIGEST}\n`,
    manifest: "version: '1.0.0'\n",
  });

  it('reports presence, mode and owner, and the derived state; never a size', async () => {
    store = makeStore(released());
    const h = fakeHost(
      {
        'container-state': { stdout: 'running' },
        'manifest-head': { stdout: '200' },
        'nas-files': {
          stdout:
            'secrets 700 1000 nonempty dir\nnas-url 600 1000 nonempty file\nnas-password 600 1000 nonempty file\n',
        },
      },
      { JOINR_STORE_DIR: store.dir },
    );
    expect(await status([], h.deps())).toBe(0);
    const text = h.out.join('\n');
    expect(text).toContain('NAS copy files: ready');
    expect(text).toContain('  nas-url: present (600, uid 1000)');
    expect(text).toContain('  nas-password: present (600, uid 1000)');
    expect(text).toContain('  secrets folder: present (700, uid 1000)');
    const cmd = remoteCommand(h.callsFor('nas-files')[0]);
    expect(cmd).toContain(
      `c 'nas-password' '${HOME}/umbrel/app-data/tenon-joinr-finance/data/secrets/nas-password'`,
    );
    expect(cmd).toContain("stat -c '%a %u'");
    expect(cmd).not.toContain('%s');
    expect(cmd).not.toMatch(/\bcat\b/);
  });

  it('a planted size in the reply never appears in the output', async () => {
    store = makeStore(released());
    const h = fakeHost(
      {
        'container-state': { stdout: 'running' },
        'manifest-head': { stdout: '200' },
        'nas-files': { stdout: 'nas-url 600 1000 987654 nonempty file\nnas-password missing\n' },
      },
      { JOINR_STORE_DIR: store.dir },
    );
    await status([], h.deps());
    const text = h.out.join('\n');
    expect(text).not.toContain('987654');
    expect(text).toContain('  nas-password: missing');
    expect(text).toContain('  nas-url: could not be checked');
  });

  it('partial and off', async () => {
    for (const [reply, state] of [
      [
        'secrets 700 1000 nonempty dir\nnas-url 600 1000 nonempty file\nnas-password missing',
        'partial (nas-password is missing',
      ],
      ['secrets missing\nnas-url missing\nnas-password missing', 'off'],
    ]) {
      store?.cleanup();
      store = makeStore(released());
      const h = fakeHost(
        {
          'container-state': { stdout: 'running' },
          'manifest-head': { stdout: '200' },
          'nas-files': { stdout: reply },
        },
        { JOINR_STORE_DIR: store.dir },
      );
      await status([], h.deps());
      expect(h.out.join('\n')).toContain(`NAS copy files: ${state}`);
    }
  });
});
