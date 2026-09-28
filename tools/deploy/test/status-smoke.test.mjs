import { afterEach, describe, expect, it } from 'vitest';
import { main as smoke, SYMLINK_PROBE } from '../smoke.mjs';
import { digestOf, main as status } from '../status.mjs';
import { DIGEST, HOME, fakeHost, makeStore, remoteCommand, remoteCommands } from './helpers.mjs';

let store;
afterEach(() => {
  store?.cleanup();
  store = undefined;
});

const released = (d = DIGEST) => ({
  compose: `  app:\n    image: 127.0.0.1:4930/joinr-finance:1.0.0@${d}\n`,
  manifest: "version: '1.0.0'\n",
});

describe('status', () => {
  const registryUp = (s) => ({
    stdout: remoteCommand(s).includes('tenon-joinr-registry_registry_1') ? 'running' : 'running',
  });

  it('"Safe to click Update" when the registry holds the store and installed digests', async () => {
    store = makeStore(released());
    const h = fakeHost(
      {
        'container-state': registryUp,
        'yq-image': { stdout: `127.0.0.1:4930/joinr-finance:1.0.0@${DIGEST}\n` },
        'manifest-head': { stdout: '200' },
      },
      { JOINR_STORE_DIR: store.dir },
    );
    expect(await status([], h.deps())).toBe(0);
    expect(h.out.at(-1)).toBe('Safe to click Update in Umbrel (or Install, the first time).');
    expect(remoteCommands(h.calls).join('\n')).not.toMatch(
      /docker (start|run|stop|rm|pull)|mkdir|rm -|cat >/,
    );
  });

  it('"Do NOT click Update" when the pinned digest is missing from the registry', async () => {
    store = makeStore(released());
    const h = fakeHost(
      { 'container-state': registryUp, 'manifest-head': { stdout: '404' } },
      { JOINR_STORE_DIR: store.dir },
    );
    expect(await status([], h.deps())).toBe(1);
    expect(h.out.at(-1)).toMatch(
      /^Do NOT click Update: .*store compose pins a digest the registry does not hold/,
    );
  });

  it('"Do NOT click Update" when the registry is down, or the store has the placeholder', async () => {
    store = makeStore(released(`sha256:${'0'.repeat(64)}`));
    const h = fakeHost(
      { 'container-state': { code: 1, stderr: 'No such object' } },
      { JOINR_STORE_DIR: store.dir },
    );
    expect(await status([], h.deps())).toBe(1);
    expect(h.out.at(-1)).toContain('the registry is not answering');
    expect(h.out.at(-1)).toContain('placeholder digest');
  });

  it('lists only backup-named files, with sizes', async () => {
    store = makeStore(released());
    const h = fakeHost(
      {
        'container-state': registryUp,
        'manifest-head': { stdout: '200' },
        'backups-list': {
          stdout:
            'nightly-20300315-023000+1100.db 4200000\nstray.db 10\n.x.partial 5\nmanual-20300316-101500+1100.db 4300000\n',
        },
      },
      { JOINR_STORE_DIR: store.dir },
    );
    await status([], h.deps());
    const text = h.out.join('\n');
    expect(text).toContain('Backups: 2 file(s)');
    expect(text).toContain('manual-20300316-101500+1100.db  4.1 MB');
    expect(text).not.toContain('stray.db');
  });

  it('digestOf', () => {
    expect(digestOf(`x:1@${DIGEST}`)).toBe(DIGEST);
    expect(digestOf('x:1')).toBeUndefined();
    expect(digestOf(undefined)).toBeUndefined();
  });
});

describe('smoke', () => {
  const IMAGE = '127.0.0.1:4930/joinr-finance:1.0.0-rc.1';
  const DATA = `${HOME}/joinr-build/smoke/data`;

  it('start: creates the folder as the user, then a loopback-only run', async () => {
    const h = fakeHost();
    expect(await smoke(['start', '--image', IMAGE], h.deps())).toBe(0);
    expect(remoteCommand(h.callsFor('smoke-mkdir')[0])).toBe(`mkdir -p '${DATA}/backups'`);
    expect(remoteCommand(h.callsFor('smoke-run')[0])).toBe(
      `docker run -d --name joinr-smoke --user 1000:1000 -e TZ=Australia/Melbourne -e NIGHTLY_BACKUPS=true -e WEEKLY_NAS_COPY=false -e PUBLIC_PORT=4939 -p 127.0.0.1:4939:3001 -v '${DATA}:/data' '${IMAGE}'`,
    );
    expect(h.purposes().indexOf('listeners')).toBeLessThan(h.purposes().indexOf('smoke-run'));
  });

  it('start refuses when 4939 is taken or the container exists (exit 3)', async () => {
    const taken = fakeHost({ listeners: { stdout: 'LISTEN 0 4096 127.0.0.1:4939 0.0.0.0:*\n' } });
    await expect(smoke(['start', '--image', IMAGE], taken.deps())).rejects.toMatchObject({
      exitCode: 3,
    });
    const exists = fakeHost({ 'container-state': { stdout: 'exited' } });
    await expect(smoke(['start', '--image', IMAGE], exists.deps())).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  it('start defaults the image to the package version in the loopback registry', async () => {
    const h = fakeHost();
    await smoke(['start'], h.deps());
    expect(remoteCommand(h.callsFor('smoke-run')[0])).toContain(
      "'127.0.0.1:4930/joinr-finance:1.2.3'",
    );
  });

  it('check: every probe passes on a good container', async () => {
    const h = fakeHost({
      'smoke-health': {
        stdout: JSON.stringify({ status: 'ok', version: '1.0.0-rc.1', db: { migrations: 6 } }),
      },
      'smoke-tz': { stdout: '{"zone":"Australia/Melbourne","offset":-600}\n' },
      'smoke-egress': { stdout: '404\n' },
      'smoke-post': { stdout: '201' },
      'smoke-list': {
        stdout: JSON.stringify({
          backups: [{ name: 'manual-20300315-143200+1100.db', kind: 'manual' }],
        }),
      },
      'smoke-download': { stdout: '200 application/vnd.sqlite3 4096' },
      'smoke-symlink-get': { stdout: '404' },
      'smoke-origin': { stdout: '403' },
    });
    expect(await smoke(['check'], h.deps())).toBe(0);
    expect(h.out.at(-1)).toBe('All 9 checks passed.');
    expect(remoteCommand(h.callsFor('smoke-download')[0])).toContain(
      '/api/backups/manual-20300315-143200%2B1100.db',
    );
    expect(remoteCommand(h.callsFor('smoke-symlink')[0])).toBe(
      `ln -sfn ../finance.db '${DATA}/backups/${SYMLINK_PROBE}'`,
    );
    expect(remoteCommand(h.callsFor('smoke-symlink-rm')[0])).toBe(
      `rm -f -- '${DATA}/backups/${SYMLINK_PROBE}'`,
    );
    expect(remoteCommand(h.callsFor('smoke-origin')[0])).toContain(
      "-X POST -H 'Origin: http://example.test:1'",
    );
    expect(h.callsFor('smoke-egress').map(remoteCommand).join('\n')).toMatch(
      /query1\.finance\.yahoo\.com[\s\S]*api\.coingecko\.com/,
    );
  });

  it('check fails (exit 1) when a probe fails, e.g. the symlink is served', async () => {
    const h = fakeHost({ 'smoke-symlink-get': { stdout: '200' } });
    expect(await smoke(['check'], h.deps())).toBe(1);
    expect(h.out.join('\n')).toMatch(/FAIL {2}symlink in backups\/ → 404/);
  });

  it('remove: both containers, the network and the validated absolute folder only', async () => {
    const h = fakeHost({ 'container-state': { stdout: 'running' } });
    expect(await smoke(['remove'], h.deps())).toBe(0);
    expect(remoteCommand(h.callsFor('smoke-nas-rm')[0])).toBe('docker rm -f joinr-smoke-nas');
    expect(remoteCommand(h.callsFor('smoke-rm')[0])).toBe('docker rm -f joinr-smoke');
    expect(remoteCommand(h.callsFor('smoke-net-rm')[0])).toBe(
      'if docker network inspect joinr-smoke-net >/dev/null 2>&1; then docker network rm joinr-smoke-net; fi',
    );
    // The network goes after both containers, the folder (the scratch NAS's included) last.
    const order = h.purposes();
    expect(order.indexOf('smoke-net-rm')).toBeGreaterThan(order.indexOf('smoke-rm'));
    expect(order.indexOf('smoke-net-rm')).toBeGreaterThan(order.indexOf('smoke-nas-rm'));
    expect(order.at(-1)).toBe('smoke-rmdir');
    expect(remoteCommand(h.callsFor('smoke-rmdir')[0])).toBe(
      `rm -rf -- '${HOME}/joinr-build/smoke'`,
    );
  });

  it('--dry-run start prints the loopback-only run and runs nothing', async () => {
    const h = fakeHost();
    expect(await smoke(['--dry-run', 'start', '--image', IMAGE], h.deps())).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(h.out.join('\n')).toContain('-p 127.0.0.1:4939:3001');
  });

  it('refuses a bad image reference or command (exit 2)', async () => {
    await expect(smoke(['start', '--image', "x'y"], fakeHost().deps())).rejects.toMatchObject({
      exitCode: 2,
    });
    await expect(smoke(['boom'], fakeHost().deps())).rejects.toMatchObject({ exitCode: 2 });
  });
});
