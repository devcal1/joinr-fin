import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main, parseYqScalar, resolveDataDir, uploadFileName } from '../restore-remote.mjs';
import { HOME, IMAGE_ID, fakeHost, remoteCommand } from './helpers.mjs';

const NAME = 'nightly-20300315-023000+1100.db';
const APP_IMAGE = `127.0.0.1:4930/joinr-finance:1.0.0@sha256:${'d'.repeat(64)}`;
const DATA = `${HOME}/umbrel/app-data/tenon-joinr-finance/data`;

/** A host where the app's compose names APP_IMAGE and the container has `state`. */
function host(state, overrides = {}) {
  return fakeHost({
    'yq-image': { stdout: `${APP_IMAGE}\n` },
    'yq-tz': { stdout: 'Australia/Melbourne\n' },
    'container-state':
      state === 'missing'
        ? { code: 1, stderr: 'Error: No such object: x' }
        : { stdout: `${state}\n` },
    ...overrides,
  });
}

const RUN = `docker run --rm --network none --user 1000:1000 -e TZ='Australia/Melbourne' -v '${DATA}:/data' ${IMAGE_ID} node dist/cli/restore.js '${NAME}' --yes --force`;

describe('restore-remote: container states', () => {
  it('missing (stopped in Umbrel): restores and prints "Start the app in Umbrel"', async () => {
    const h = host('missing');
    expect(await main([NAME], h.deps())).toBe(0);
    expect(remoteCommand(h.callsFor('restore-run')[0])).toBe(RUN);
    expect(h.callsFor('docker-start')).toHaveLength(0);
    expect(h.callsFor('docker-stop')).toHaveLength(0);
    expect(h.out).toContain('Start the app in Umbrel.');
  });

  it('exited: restores and never starts what umbreld stopped', async () => {
    const h = host('exited');
    expect(await main([NAME], h.deps())).toBe(0);
    expect(h.callsFor('docker-start')).toHaveLength(0);
    expect(h.out).toContain('Start the app in Umbrel.');
  });

  it.each(['running', 'restarting'])('%s without --stop → exit 3, nothing run', async (state) => {
    const h = host(state);
    await expect(main([NAME], h.deps())).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringContaining('Stop the app first'),
    });
    expect(h.callsFor('restore-run')).toHaveLength(0);
  });

  it.each(['running', 'restarting'])(
    '%s with --stop: stop -t 30, restore, start, wait for healthy',
    async (state) => {
      const h = host(state);
      expect(await main([NAME, '--stop'], h.deps())).toBe(0);
      expect(remoteCommand(h.callsFor('docker-stop')[0])).toBe(
        "docker stop -t 30 'tenon-joinr-finance_app_1'",
      );
      expect(remoteCommand(h.callsFor('docker-start')[0])).toBe(
        "docker start 'tenon-joinr-finance_app_1'",
      );
      const order = h.purposes();
      expect(order.indexOf('docker-stop')).toBeLessThan(order.indexOf('restore-run'));
      expect(order.indexOf('restore-run')).toBeLessThan(order.indexOf('docker-start'));
      expect(h.callsFor('health').length).toBeGreaterThan(0);
    },
  );

  it('--stop --no-start leaves it stopped', async () => {
    const h = host('running');
    expect(await main([NAME, '--stop', '--no-start'], h.deps())).toBe(0);
    expect(h.callsFor('docker-start')).toHaveLength(0);
  });

  it('the health wait times out after 120 s → exit 1', async () => {
    const h = host('running', { health: { stdout: 'starting\n' } });
    expect(await main([NAME, '--stop'], h.deps())).toBe(1);
    expect(h.err.join('\n')).toContain('did not report healthy within 120 s');
    expect(h.callsFor('health').length).toBeGreaterThan(30);
  });

  it("passes the restore CLI's exit code through", async () => {
    for (const code of [1, 5, 6]) {
      const h = host('exited', { 'restore-run': { code } });
      expect(await main([NAME], h.deps())).toBe(code);
    }
  });
});

describe('restore-remote: the image and the paths', () => {
  it('reads the image and TZ with yq from the app-data compose and runs by image ID (never pulls)', async () => {
    const h = host('missing');
    await main([NAME], h.deps());
    const compose = `${HOME}/umbrel/app-data/tenon-joinr-finance/docker-compose.yml`;
    expect(remoteCommand(h.callsFor('yq-image')[0])).toBe(`yq '.services.app.image' '${compose}'`);
    expect(remoteCommand(h.callsFor('yq-tz')[0])).toBe(
      `yq '.services.app.environment.TZ' '${compose}'`,
    );
    expect(remoteCommand(h.callsFor('image-id')[0])).toBe(
      `docker image inspect -f '{{.Id}}' '${APP_IMAGE}'`,
    );
    const run = remoteCommand(h.callsFor('restore-run')[0]);
    expect(run).toContain('--network none');
    expect(run).toContain(IMAGE_ID);
    expect(run).not.toContain(APP_IMAGE);
    expect(h.calls.map(remoteCommand).join('\n')).not.toMatch(/docker pull|~/);
  });

  it('the image missing on the host → exit 2', async () => {
    const h = host('missing', { 'image-id': { code: 1, stderr: 'Error: No such image' } });
    await expect(main([NAME], h.deps())).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('not on the host'),
    });
  });

  it('the smoke flags: --container, --data-dir (relative to home) and --image (TZ defaults to Melbourne)', async () => {
    const h = host('running');
    const image = '127.0.0.1:4930/joinr-finance:1.0.0-rc.1';
    await main(
      [
        NAME,
        '--container',
        'joinr-smoke',
        '--data-dir',
        'joinr-build/smoke/data',
        '--image',
        image,
        '--stop',
      ],
      h.deps(),
    );
    expect(h.callsFor('yq-image')).toHaveLength(0);
    expect(remoteCommand(h.callsFor('image-id')[0])).toContain(`'${image}'`);
    expect(remoteCommand(h.callsFor('container-state')[0])).toContain("'joinr-smoke'");
    expect(remoteCommand(h.callsFor('restore-run')[0])).toContain(
      `-v '${HOME}/joinr-build/smoke/data:/data'`,
    );
    expect(remoteCommand(h.callsFor('restore-run')[0])).toContain("-e TZ='Australia/Melbourne'");
  });

  it.each([
    ['../x.db'],
    ['finance.db'],
    ["nightly-20300315-023000+1100.db'; rm -rf /"],
    ['--container', 'bad name', NAME],
    ['--data-dir', '../../etc', NAME],
    ['--data-dir', '/a/../b', NAME],
    ['--image', "x'y", NAME],
  ])('refuses %j before any command (exit 2)', async (...argv) => {
    const h = host('missing');
    await expect(main(argv, h.deps())).rejects.toMatchObject({ exitCode: 2 });
    expect(h.calls).toHaveLength(0);
  });

  it('accepts a downloaded "joinr-finance-" name', async () => {
    const h = host('missing');
    await main([`joinr-finance-${NAME}`], h.deps());
    expect(remoteCommand(h.callsFor('restore-run')[0])).toContain(`'${NAME}'`);
  });

  it('resolveDataDir and parseYqScalar', () => {
    expect(resolveDataDir(HOME, 'tenon-joinr-finance')).toBe(DATA);
    expect(resolveDataDir(HOME, 'x', '/srv/data/')).toBe('/srv/data');
    expect(resolveDataDir(HOME, 'x', 'joinr-build/smoke/data')).toBe(
      `${HOME}/joinr-build/smoke/data`,
    );
    expect(() => resolveDataDir(HOME, 'x', 'C:/Program Files/Git/srv/data')).toThrow(
      /MSYS_NO_PATHCONV=1/,
    );
    expect(parseYqScalar('"a:b"\n')).toBe('a:b');
    expect(parseYqScalar('null\n')).toBeUndefined();
    expect(parseYqScalar('plain\n')).toBe('plain');
  });

  it('a missing data folder → exit 2', async () => {
    const h = host('missing', { 'data-dir': { code: 1 } });
    await expect(main([NAME], h.deps())).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('restore-remote --from-file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-deploy-upload-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const good = join(dir, 'joinr-finance-manual-20300315-143200+1100.db');
  writeFileSync(
    good,
    Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4096)]),
  );
  const bad = join(dir, 'not-a-db.db');
  writeFileSync(bad, Buffer.alloc(4096, 1));

  const UPLOAD_DIR = `${DATA}/.restore-upload-20300315T030000Z`;
  const UPLOAD_NAME = 'manual-20300315-143200+1100.db';

  it('uploads as the ssh user into a hidden folder under the backup name, restores it, then deletes it', async () => {
    const h = host('missing');
    expect(await main(['--from-file', good], h.deps())).toBe(0);
    expect(remoteCommand(h.callsFor('upload-dir')[0])).toBe(`mkdir -p -- '${UPLOAD_DIR}'`);
    const up = h.callsFor('upload')[0];
    expect(up.inputFile).toBe(good);
    // The prefix is stripped, so the CLI records the backup's own name (restore.last, About).
    expect(remoteCommand(up)).toBe(`cat > '${UPLOAD_DIR}/${UPLOAD_NAME}'`);
    expect(remoteCommand(h.callsFor('restore-run')[0])).toContain(
      `node dist/cli/restore.js '/data/.restore-upload-20300315T030000Z/${UPLOAD_NAME}' --yes --force`,
    );
    expect(remoteCommand(h.callsFor('upload-cleanup')[0])).toBe(`rm -rf -- '${UPLOAD_DIR}'`);
    const order = h.purposes();
    expect(order.indexOf('upload')).toBeLessThan(order.indexOf('container-state'));
    expect(order.indexOf('restore-run')).toBeLessThan(order.indexOf('upload-cleanup'));
  });

  it('a file whose name is not a backup name is uploaded under a generic name', async () => {
    const other = join(dir, 'my copy.db');
    writeFileSync(
      other,
      Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4096)]),
    );
    const h = host('missing');
    expect(await main(['--from-file', other], h.deps())).toBe(0);
    expect(remoteCommand(h.callsFor('upload')[0])).toBe(`cat > '${UPLOAD_DIR}/restore-upload.db'`);
    expect(uploadFileName('C:\\x\\joinr-finance-nightly-20300315-023000+1100.db')).toBe(NAME);
    expect(uploadFileName('/x/../x.db')).toBe('restore-upload.db');
  });

  it('deletes the upload when the restore fails', async () => {
    const h = host('missing', { 'restore-run': { code: 5 } });
    expect(await main(['--from-file', good], h.deps())).toBe(5);
    expect(h.callsFor('upload-cleanup')).toHaveLength(1);
  });

  it('with --stop, uploads before stopping; a failed upload never stops the app and is removed', async () => {
    const h = host('running', { upload: { code: 1, stderr: 'No space left on device' } });
    await expect(main(['--from-file', good, '--stop'], h.deps())).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('The upload failed'),
    });
    expect(h.callsFor('docker-stop')).toHaveLength(0);
    expect(h.callsFor('container-state')).toHaveLength(0);
    expect(h.callsFor('restore-run')).toHaveLength(0);
    expect(remoteCommand(h.callsFor('upload-cleanup')[0])).toBe(`rm -rf -- '${UPLOAD_DIR}'`);
  });

  it('when the one-off run cannot start after --stop, starts the app again and removes the upload', async () => {
    const h = host('running', {
      'restore-run': () => {
        throw new Error('ssh: connection lost');
      },
    });
    await expect(main(['--from-file', good, '--stop'], h.deps())).rejects.toThrow(
      'connection lost',
    );
    expect(h.callsFor('docker-stop')).toHaveLength(1);
    expect(h.callsFor('upload-cleanup')).toHaveLength(1);
    expect(remoteCommand(h.callsFor('docker-start')[0])).toBe(
      "docker start 'tenon-joinr-finance_app_1'",
    );
    expect(h.err.join('\n')).toContain('starting tenon-joinr-finance_app_1 again');
  });

  it('refuses a file without the SQLite header (exit 5) before any command', async () => {
    const h = host('missing');
    await expect(main(['--from-file', bad], h.deps())).rejects.toMatchObject({ exitCode: 5 });
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a missing file (exit 2), and a name together with --from-file', async () => {
    const h = host('missing');
    await expect(main(['--from-file', join(dir, 'nope.db')], h.deps())).rejects.toMatchObject({
      exitCode: 2,
    });
    await expect(main([NAME, '--from-file', good], h.deps())).rejects.toMatchObject({
      exitCode: 2,
    });
  });
});

describe('restore-remote --dry-run', () => {
  it('prints the state check, the yq reads and the one-off run; runs nothing', async () => {
    const h = host('missing');
    expect(await main(['--dry-run', NAME], h.deps())).toBe(0);
    expect(h.calls).toHaveLength(0);
    const printed = h.out.join('\n');
    for (const needle of [
      "docker inspect -f '{{.State.Status}}'",
      "yq '.services.app.image'",
      'docker run --rm --network none --user 1000:1000',
    ]) {
      expect(printed).toContain(needle);
    }
  });
});
