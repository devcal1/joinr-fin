import { describe, expect, it } from 'vitest';
import { REGISTRY_IMAGE } from '../lib.mjs';
import { loopbackOnly, main } from '../registry.mjs';
import { HOME, fakeHost, remoteCommand, remoteCommands } from './helpers.mjs';

const running = (s) => ({ stdout: remoteCommand(s).includes('joinr-registry') ? 'running' : '' });
const missing = { code: 1, stderr: 'Error: No such object: joinr-registry' };

describe('registry ensure — app mode (default)', () => {
  it('passes when the Joinr Registry app runs and /v2/ answers 200', async () => {
    const host = fakeHost({ 'container-state': running });
    expect(await main(['ensure'], host.deps())).toBe(0);
    expect(host.purposes()).toEqual(['preflight', 'container-state', 'registry-v2']);
    expect(remoteCommand(host.callsFor('container-state')[0])).toBe(
      "docker inspect -f '{{.State.Status}}' 'tenon-joinr-registry_registry_1'",
    );
    expect(remoteCommand(host.callsFor('registry-v2')[0])).toBe(
      "curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:4930/v2/'",
    );
  });

  it('never starts the app behind umbreld: missing → exit 3', async () => {
    const host = fakeHost({ 'container-state': missing });
    await expect(main(['ensure'], host.deps())).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringContaining('Start (or install) the Joinr Registry app in Umbrel'),
    });
    expect(remoteCommands(host.calls).join('\n')).not.toMatch(/docker (start|run)/);
  });

  it('running but not answering → exit 3', async () => {
    const host = fakeHost({ 'container-state': running, 'registry-v2': { stdout: '000' } });
    await expect(main(['ensure'], host.deps())).rejects.toMatchObject({ exitCode: 3 });
  });
});

describe('registry ensure — container mode (fallback)', () => {
  const env = { JOINR_REGISTRY_MODE: 'container' };
  const ok = { 'registry-port': { stdout: '5000/tcp -> 127.0.0.1:4930\n' } };

  it('running → checks the bindings and /v2/', async () => {
    const host = fakeHost({ ...ok, 'container-state': running }, env);
    expect(await main(['ensure'], host.deps())).toBe(0);
    expect(host.callsFor('registry-run')).toHaveLength(0);
    expect(host.callsFor('registry-start')).toHaveLength(0);
  });

  it('stopped → docker start', async () => {
    const host = fakeHost({ ...ok, 'container-state': { stdout: 'exited' } }, env);
    expect(await main(['ensure'], host.deps())).toBe(0);
    expect(remoteCommand(host.callsFor('registry-start')[0])).toBe('docker start joinr-registry');
  });

  it('missing → mkdir as the user, then a loopback-only run with --user 1000:1000 and an absolute volume', async () => {
    const host = fakeHost({ ...ok, 'container-state': missing }, env);
    expect(await main(['ensure'], host.deps())).toBe(0);
    expect(remoteCommand(host.callsFor('registry-mkdir')[0])).toBe(
      `mkdir -p '${HOME}/joinr-registry'`,
    );
    const run = remoteCommand(host.callsFor('registry-run')[0]);
    expect(run).toBe(
      `docker run -d --name joinr-registry --restart always --user 1000:1000 -p 127.0.0.1:4930:5000 -v '${HOME}/joinr-registry:/var/lib/registry' ${REGISTRY_IMAGE}`,
    );
    expect(run).not.toMatch(/DELETE|~/);
    expect(host.purposes().indexOf('registry-mkdir')).toBeLessThan(
      host.purposes().indexOf('registry-run'),
    );
  });

  it('refuses when the port is bound by something else (exit 3)', async () => {
    const host = fakeHost(
      {
        'container-state': missing,
        listeners: { stdout: 'LISTEN 0 4096 0.0.0.0:4930 0.0.0.0:*\n' },
      },
      env,
    );
    await expect(main(['ensure'], host.deps())).rejects.toMatchObject({ exitCode: 3 });
    expect(host.callsFor('registry-run')).toHaveLength(0);
  });

  it('refuses a registry published beyond loopback (exit 3)', async () => {
    const host = fakeHost(
      { 'container-state': running, 'registry-port': { stdout: '5000/tcp -> 0.0.0.0:4930\n' } },
      env,
    );
    await expect(main(['ensure'], host.deps())).rejects.toMatchObject({ exitCode: 3 });
  });

  it('--mode overrides the environment', async () => {
    const host = fakeHost({ ...ok, 'container-state': running });
    expect(await main(['ensure', '--mode', 'container'], host.deps())).toBe(0);
    expect(remoteCommand(host.callsFor('container-state')[0])).toContain("'joinr-registry'");
  });
});

describe('registry status and dry run', () => {
  it('status lists the state, bindings and tags (read-only)', async () => {
    const host = fakeHost({
      'container-state': running,
      'registry-image': { stdout: 'registry:2.8.3@sha256:x\n' },
      'registry-port': { stdout: '5000/tcp -> 127.0.0.1:4930\n' },
      'registry-tags': { stdout: '{"name":"joinr-finance","tags":["1.0.0","1.0.0-rc.1"]}' },
      'registry-du': { stdout: '812M\n' },
    });
    expect(
      await main(
        ['status'],
        host.deps({ env: { JOINR_SSH: '/usr/bin/ssh', JOINR_STORE_DIR: '/no/such/store' } }),
      ),
    ).toBe(0);
    const text = host.out.join('\n');
    expect(text).toContain('joinr-finance tags: 1.0.0, 1.0.0-rc.1');
    expect(text).toContain('(loopback only)');
    expect(text).toContain('storage: 812M');
    expect(remoteCommands(host.calls).join('\n')).not.toMatch(
      /docker (start|run|stop|rm)|mkdir|rm -/,
    );
  });

  it('--dry-run prints and runs nothing remote, in both modes', async () => {
    for (const env of [{}, { JOINR_REGISTRY_MODE: 'container' }]) {
      const host = fakeHost({}, env);
      expect(await main(['--dry-run', 'ensure'], host.deps())).toBe(0);
      expect(host.calls).toHaveLength(0);
      expect(host.out.some((l) => l.startsWith('[dry-run] /usr/bin/ssh'))).toBe(true);
    }
  });

  it('loopbackOnly', () => {
    expect(loopbackOnly(['5000/tcp -> 127.0.0.1:4930'], 4930)).toBe(true);
    expect(loopbackOnly(['5000/tcp -> 127.0.0.1:4930', '5000/tcp -> [::]:4930'], 4930)).toBe(false);
    expect(loopbackOnly([], 4930)).toBe(false);
  });

  it('usage errors exit 2', async () => {
    await expect(main([], fakeHost().deps())).rejects.toMatchObject({ exitCode: 2 });
    await expect(main(['start'], fakeHost().deps())).rejects.toMatchObject({ exitCode: 2 });
  });
});
