// The copy (stage-8.md §5.5, §5.13, §5.15): the worked examples C1–C24 on a fake NAS (counts,
// status, reason, exit code, attempted, onNas and the sentence), a refusal while the NAS files
// change, the argv pins (the password only in the child env, never in argv), the local files that
// are never sources, and the never-throws table. Every outcome is free of the planted values.
process.env.TZ = 'Australia/Melbourne';

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nasCopyFailureMessage,
  NAS_COPY_SAFE_TAIL,
  type NasCopyFailureReason,
} from '@joinr/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBackupName } from '../../src/backups/names';
import { RSYNC_FLAGS, RSYNC_LIST_FLAG } from '../../src/nascopy/constants';
import { copyToNas, type NasCopyOutcome } from '../../src/nascopy/copy';
import {
  NasCopyDeadline,
  RsyncMissingError,
  RsyncStartError,
  type RsyncRunner,
} from '../../src/nascopy/runner';
import { createSecretsReader } from '../../src/nascopy/secrets';
import { recordingLogger } from '../backups/helpers';
import { makeTempDir, removeDir } from '../helpers';
import {
  expectNoLeak,
  FakeNas,
  fileLine,
  localBackupsDir,
  passwordFile,
  PLANTED,
  PLANTED_SUB_URL,
  PLANTED_URL,
  plantBackup,
  plantNasFiles,
  plantTypical,
  writeSecret,
  type PlantedBackup,
} from './helpers';

// `listBackupFiles` throwing (the never-throws table): a switch on the real module.
const listControl = vi.hoisted(() => ({ throwNext: false }));
vi.mock('../../src/backups/list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/backups/list')>();
  return {
    ...actual,
    listBackupFiles: (dataDir: string) => {
      if (listControl.throwNext) {
        listControl.throwNext = false;
        throw Object.assign(new Error(`planted ${PLANTED_URL} ${PLANTED.password}`), {
          code: 'EIO',
          cause: new Error(PLANTED.host),
        });
      }
      return actual.listBackupFiles(dataDir);
    },
  };
});

const canSymlink = ((): boolean => {
  try {
    const dir = join(
      process.env.TEMP ?? process.env.TMPDIR ?? '/tmp',
      `joinr-probe-${process.pid}`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 't'), 'x');
    try {
      symlinkSync(join(dir, 't'), join(dir, 'l'));
      return true;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
})();

let dataDir: string;
let nas: FakeNas;
let local: PlantedBackup[];
let log: ReturnType<typeof recordingLogger>;

beforeEach(async () => {
  dataDir = await makeTempDir('joinr-nas-copy-test-');
  plantNasFiles(dataDir, { at: new Date('2030-09-01T00:00:00.000Z') });
  local = plantTypical(dataDir);
  nas = new FakeNas(dataDir);
  log = recordingLogger();
});

afterEach(async () => {
  expect(nas.violations).toEqual([]);
  expectNoLeak(JSON.stringify(log.calls), 'log');
  for (const call of nas.calls) expect(call.args.join(' ')).not.toContain(PLANTED.password);
  await removeDir(dataDir);
});

async function copy(
  o: { signal?: AbortSignal; runner?: RsyncRunner } = {},
): Promise<NasCopyOutcome> {
  const outcome = await copyToNas({
    dataDir,
    signal: o.signal ?? new AbortController().signal,
    runner: o.runner ?? nas.runner,
    now: () => new Date(),
    log,
  });
  expectNoLeak(JSON.stringify(outcome), 'outcome');
  return outcome;
}

const newest = (n: number): PlantedBackup[] => local.slice(0, n);
const sent = (n: FakeNas): string[] =>
  (n.calls.find((c) => c.phase === 'send')?.args.slice(RSYNC_FLAGS.length + 1, -1) ?? []).map((s) =>
    s.slice(localBackupsDir(dataDir).length + 1),
  );

function expectFailed(
  outcome: NasCopyOutcome,
  reason: NasCopyFailureReason,
  n: { code?: number; missing?: number; total?: number } = {},
): void {
  expect(outcome.status).toBe('failed');
  expect(outcome.detail.reason).toBe(reason);
  expect(outcome.detail.exitCode).toBe(n.code);
  expect(outcome.error).toBe(nasCopyFailureMessage(reason, n));
  expect(outcome.error?.endsWith(NAS_COPY_SAFE_TAIL)).toBe(true);
}

describe('the worked examples (§5.15)', () => {
  it('C1: the first copy to an empty module sends all 27 newest first in one call', async () => {
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.error).toBeUndefined();
    expect(outcome.detail).toMatchObject({
      configured: 'ready',
      attempted: true,
      localFiles: 27,
      alreadyThere: 0,
      sent: 27,
      missingAfter: 0,
      vanished: 0,
      onNas: 27,
      bytes: local.reduce((s, f) => s + f.bytes, 0),
    });
    expect(nas.phases()).toEqual(['list', 'send', 'relist']);
    expect(sent(nas)).toEqual(local.map((f) => f.name));
  });

  it('C2: a week later, 7 new here and 7 pruned here: 7 sent, the NAS keeps all 34', async () => {
    nas.hold(local.slice(7));
    for (let i = 0; i < 7; i++)
      nas.files.set(formatBackupName('nightly', new Date(2030, 7, 10 + i, 2, 30)), 5);
    const outcome = await copy();
    expect(outcome.detail).toMatchObject({ alreadyThere: 20, sent: 7, onNas: 34, missingAfter: 0 });
    expect(sent(nas)).toEqual(newest(7).map((f) => f.name));
  });

  it('C3: nothing new: one invocation only', async () => {
    nas.hold(local);
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ alreadyThere: 27, sent: 0, missingAfter: 0, onNas: 27 });
    expect(nas.phases()).toEqual(['list']);
  });

  it('C4: a wrong-sized namesake on the NAS is sent again and proved', async () => {
    nas.hold(local);
    const damaged = local[3]!;
    nas.files.set(damaged.name, damaged.bytes - 100);
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ alreadyThere: 26, sent: 1, bytes: damaged.bytes });
    expect(sent(nas)).toEqual([damaged.name]);
    expect(nas.files.get(damaged.name)).toBe(damaged.bytes);
  });

  it('C5: a prune during the send (exit 24): the pruned file is vanished, not a failure', async () => {
    nas.hold(local.slice(7));
    const pruned = newest(7)[6]!;
    nas.steps[1] = {
      code: 24,
      before: () => rmSync(join(localBackupsDir(dataDir), pruned.name)),
    };
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ sent: 6, vanished: 1, missingAfter: 0 });
  });

  it('C6: rsync says 0 but the proof lacks one of 7 → not_verified, 1 of 7', async () => {
    nas.hold(local.slice(7));
    const lost = newest(7)[2]!.name;
    nas.steps[1] = { only: (name) => name !== lost };
    const outcome = await copy();
    expectFailed(outcome, 'not_verified', { missing: 1, total: 7 });
    expect(outcome.error).toContain('1 of 7 files');
    expect(outcome.detail).toMatchObject({ sent: 6, missingAfter: 1 });
  });

  it('C7: the NAS is off (exit 35) → unreachable, attempted', async () => {
    nas.steps[0] = { code: 35, err: `rsync: failed to connect to ${PLANTED.host}` };
    const outcome = await copy();
    expectFailed(outcome, 'unreachable', { code: 35 });
    expect(outcome.detail).toMatchObject({ attempted: true, missingAfter: null, onNas: null });
  });

  it('C8: a wrong password (exit 5, auth failed) → auth', async () => {
    nas.steps[0] = { code: 5, err: `@ERROR: auth failed on module ${PLANTED.module}` };
    expectFailed(await copy(), 'auth', { code: 5 });
    expect(nas.phases()).toEqual(['list']);
  });

  it('C9: a subfolder that does not exist yet: an empty remote, then the send creates it', async () => {
    writeSecret(join(dataDir, 'secrets', 'nas-url'), `${PLANTED_SUB_URL}\n`);
    nas.steps[0] = {
      code: 23,
      err: `rsync: change_dir "/${PLANTED.subfolder}" (in ${PLANTED.module}) failed: No such file or directory (2)`,
    };
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ sent: 27, alreadyThere: 0, onNas: 27 });
    expect(nas.calls[0]?.args.at(-1)).toBe(PLANTED_SUB_URL);
  });

  it('C9b: exit 23 on the first listing without a subfolder is `other`', async () => {
    nas.steps[0] = { code: 23, err: 'No such file or directory (2)' };
    expectFailed(await copy(), 'other', { code: 23 });
  });

  it('C10: foreign files, a folder and a hidden temporary on the NAS are ignored', async () => {
    nas.hold(local);
    nas.extra = [
      '-rw-r--r--            311 2030/09/12 10:00:00 notes.txt',
      'drwxr-xr-x          4,096 2030/09/12 10:00:00 older',
      fileLine(`.${local[0]!.name}.Ab12Cd`, 99),
      fileLine(`copy of ${local[0]!.name}`, 99),
    ];
    const outcome = await copy();
    expect(outcome.detail).toMatchObject({ alreadyThere: 27, sent: 0, onNas: 27 });
  });

  it('C11: the share is full (send exit 11) → nas_io, nothing claimed', async () => {
    nas.steps[1] = { code: 11, noEffect: true };
    const outcome = await copy();
    expectFailed(outcome, 'nas_io', { code: 11 });
    expect(outcome.detail).toMatchObject({ sent: 0, missingAfter: null });
  });

  it('C12: no rsync in the image (ENOENT) → no_rsync, attempted', async () => {
    const outcome = await copy({ runner: () => Promise.reject(new RsyncMissingError()) });
    expectFailed(outcome, 'no_rsync');
    expect(outcome.detail.attempted).toBe(true);
    expect(outcome.error).toBe(
      `rsync is missing from the app image, so nothing can be copied. ${NAS_COPY_SAFE_TAIL}`,
    );
  });

  it('C13: the module does not exist → unknown_module, exit 5', async () => {
    nas.steps[0] = { code: 5, err: `@ERROR: Unknown module '${PLANTED.module}'` };
    const outcome = await copy();
    expectFailed(outcome, 'unknown_module', { code: 5 });
    expect(outcome.detail.attempted).toBe(true);
  });

  it('C14: another exit-5 refusal → refused', async () => {
    nas.steps[0] = { code: 5, err: '@ERROR: access denied to module from host' };
    expectFailed(await copy(), 'refused', { code: 5 });
  });

  it('C15: connection refused (list exit 10) → unreachable', async () => {
    nas.steps[0] = { code: 10 };
    expectFailed(await copy(), 'unreachable', { code: 10 });
  });

  it('C16: the connection breaks during the send (exit 10) → broken', async () => {
    nas.steps[1] = { code: 10, noEffect: true };
    const outcome = await copy();
    expectFailed(outcome, 'broken', { code: 10 });
    expect(outcome.detail.missingAfter).toBeNull();
  });

  it('C17: the NAS stalls (exit 30) → timeout with the code', async () => {
    nas.steps[0] = { code: 30 };
    const outcome = await copy();
    expectFailed(outcome, 'timeout', { code: 30 });
    expect(outcome.error).toContain('(rsync exit code 30)');
  });

  it('C18: the 15-minute ceiling during the send → timeout without a code', async () => {
    const controller = new AbortController();
    nas.steps[1] = {
      hang: true,
      before: () => queueMicrotask(() => controller.abort(new NasCopyDeadline())),
    };
    const outcome = await copy({ signal: controller.signal });
    expectFailed(outcome, 'timeout');
    expect(outcome.error).not.toContain('exit code');
  });

  it('C19: the app stops during the send → stopped', async () => {
    const controller = new AbortController();
    nas.steps[1] = { hang: true, before: () => queueMicrotask(() => controller.abort()) };
    const outcome = await copy({ signal: controller.signal });
    expectFailed(outcome, 'stopped');
    expect(outcome.detail.attempted).toBe(true);
  });

  it('C20: the share fills during the send (exit 23, 2 of 7 missing) → nas_io 23', async () => {
    nas.hold(local.slice(7));
    const lost = new Set([newest(7)[0]!.name, newest(7)[4]!.name]);
    nas.steps[1] = { code: 23, only: (name) => !lost.has(name) };
    const outcome = await copy();
    expectFailed(outcome, 'nas_io', { code: 23 });
    expect(outcome.detail).toMatchObject({ sent: 5, missingAfter: 2 });
  });

  it('C21: a protocol error during the send (exit 12) → broken', async () => {
    nas.steps[1] = { code: 12, noEffect: true };
    expectFailed(await copy(), 'broken', { code: 12 });
  });

  it('C22: the proof listing fails (exit 23) → readback_failed', async () => {
    nas.steps[2] = { code: 23 };
    expectFailed(await copy(), 'readback_failed', { code: 23 });
  });

  it('C23: a listing over the output cap is never read as "missing"', async () => {
    nas.steps[0] = { outTruncated: true };
    expectFailed(await copy(), 'other', { code: 0 });
    expect(nas.phases()).toEqual(['list']);
    const second = new FakeNas(dataDir);
    second.steps[2] = { outTruncated: true };
    const outcome = await copy({ runner: second.runner });
    expectFailed(outcome, 'readback_failed', { code: 0 });
    expect(outcome.detail.missingAfter).toBeNull();
    expect(second.violations).toEqual([]);
  });

  it('C24: 600 backup names on the NAS (27 of ours, 7 wrong-sized) plus foreign files', async () => {
    nas.hold(local);
    for (const f of newest(7)) nas.files.set(f.name, f.bytes + 1);
    let added = 0;
    for (let d = 0; added < 573; d++) {
      const name = formatBackupName('nightly', new Date(2027, 0, 1 + d, 2, 30));
      if (!nas.files.has(name)) {
        nas.files.set(name, 4096);
        added += 1;
      }
    }
    nas.extra = ['-rw-r--r--            311 2030/09/12 10:00:00 notes.txt'];
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ sent: 7, alreadyThere: 20, onNas: 600 });
  });
});

describe('a refusal while the NAS files change (§5.5 step 3)', () => {
  it('is recorded `other` when nas-password was replaced during the run', async () => {
    nas.steps[0] = {
      code: 5,
      err: '@ERROR: auth failed',
      before: () =>
        writeSecret(passwordFile(dataDir), 'new-planted-value\n', new Date('2030-09-20T00:00:00Z')),
    };
    expectFailed(await copy(), 'other', { code: 5 });
  });

  it('stays a refusal when the files did not change', async () => {
    nas.steps[0] = { code: 5, err: '@ERROR: auth failed' };
    expectFailed(await copy(), 'auth', { code: 5 });
  });

  it('applies to a refusal at the send too', async () => {
    nas.steps[1] = {
      code: 5,
      err: "@ERROR: Unknown module 'x'",
      noEffect: true,
      before: () =>
        writeSecret(
          join(dataDir, 'secrets', 'nas-url'),
          `${PLANTED_URL}\n`,
          new Date('2030-09-21T00:00:00Z'),
        ),
    };
    expectFailed(await copy(), 'other', { code: 5 });
  });
});

describe('the argv pins and the sources', () => {
  it('lists with exactly the flags, --list-only, -- and the URL; sends the sources after --', async () => {
    await copy();
    const [list, send, relist] = nas.calls;
    expect(list?.args).toEqual([...RSYNC_FLAGS, RSYNC_LIST_FLAG, '--', PLANTED_URL]);
    expect(relist?.args).toEqual(list?.args);
    expect(send?.args).toEqual([
      ...RSYNC_FLAGS,
      '--',
      ...local.map((f) => join(localBackupsDir(dataDir), f.name)),
      PLANTED_URL,
    ]);
    for (const call of nas.calls) {
      expect(call.password).toBe(PLANTED.password);
      expect(call.args.join('\n')).not.toContain(PLANTED.password);
    }
  });

  it('never sends a hidden partial, a folder, a symlink or a foreign file', async () => {
    const dir = localBackupsDir(dataDir);
    const name = formatBackupName('nightly', new Date(2030, 8, 16, 2, 30));
    writeFileSync(join(dir, `.${name}.partial`), 'x');
    writeFileSync(join(dir, 'foreign.db'), 'x');
    writeFileSync(join(dir, `-${name}`), 'x');
    mkdirSync(join(dir, formatBackupName('manual', new Date(2030, 8, 16, 9, 0))));
    mkdirSync(join(dir, '.unverified-pre-restore-20300916'));
    if (canSymlink)
      symlinkSync(
        join(dir, local[0]!.name),
        join(dir, formatBackupName('manual', new Date(2030, 8, 16, 10, 0))),
      );
    await copy();
    expect(sent(nas).sort()).toEqual(local.map((f) => f.name).sort());
  });

  it('includes a future-dated local file (a verified file)', async () => {
    const future = plantBackup(dataDir, 'manual', new Date(2031, 0, 1, 9, 0), 77);
    const outcome = await copy();
    expect(outcome.detail.localFiles).toBe(28);
    expect(sent(nas)[0]).toBe(future);
  });
});

describe('the configuration step (no rsync)', () => {
  it.each([
    ['url_missing', { url: null }],
    ['password_missing', { password: null }],
    ['url_invalid', { url: 'rsync://u:pw@h/m' }],
    ['password_invalid', { password: `${PLANTED.password}\u0000` }],
  ] as const)('%s → failed, attempted false, the runner never called', async (reason, files) => {
    plantNasFiles(dataDir, files);
    const outcome = await copy();
    expectFailed(outcome, reason);
    expect(outcome.detail.attempted).toBe(false);
    expect(nas.calls).toEqual([]);
  });

  it('a signal already aborted records stopped without running rsync', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await copy({ signal: controller.signal });
    expectFailed(outcome, 'stopped');
    expect(nas.calls).toEqual([]);
  });
});

describe('never throws (§5.5 step 9)', () => {
  const hostile = (): Error =>
    Object.assign(new Error(`planted ${PLANTED_URL} ${PLANTED.password}`), {
      code: 'EPLANTED',
      spawnargs: [PLANTED_URL],
      path: PLANTED.host,
      cause: new Error(PLANTED.password),
    });

  it('the secrets folder unreadable → off (url_missing), no rsync', async () => {
    const secrets = createSecretsReader({
      dataDir,
      lstat: () => {
        throw Object.assign(new Error(PLANTED.password), { code: 'EACCES' });
      },
    });
    const outcome = await copyToNas({
      dataDir,
      signal: new AbortController().signal,
      runner: nas.runner,
      secrets,
    });
    expectNoLeak(JSON.stringify(outcome));
    expect(outcome.status).toBe('failed');
    expect(outcome.detail.configured).toBe('off');
    expect(nas.calls).toEqual([]);
  });

  it('a runner throwing synchronously → other', async () => {
    nas.steps[0] = { throws: hostile(), sync: true };
    const outcome = await copy();
    expectFailed(outcome, 'other');
    expect(log.calls.some((c) => JSON.stringify(c.obj) === '{"code":"EPLANTED"}')).toBe(true);
  });

  it('a runner rejecting → other', async () => {
    nas.steps[1] = { throws: hostile() };
    expectFailed(await copy(), 'other');
  });

  it('a start error (not ENOENT) → other', async () => {
    expectFailed(
      await copy({ runner: () => Promise.reject(new RsyncStartError('EACCES')) }),
      'other',
    );
  });

  it('a runner resolving garbage → other', async () => {
    for (const raw of [null, 42, 'x', {}, { code: 'zero' }]) {
      const n = new FakeNas(dataDir);
      n.steps[0] = { raw };
      const outcome = await copy({ runner: n.runner });
      expect(outcome.status).toBe('failed');
      expect(outcome.detail.reason).toBe('other');
    }
  });

  it('a file vanishing between the local list and the send is vanished (not a failure)', async () => {
    nas.steps[0] = { before: () => rmSync(join(localBackupsDir(dataDir), local[5]!.name)) };
    nas.steps[1] = { code: 23 };
    const outcome = await copy();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail).toMatchObject({ sent: 26, vanished: 1 });
  });

  it('listBackupFiles throwing → other, logged by its code only', async () => {
    listControl.throwNext = true;
    const outcome = await copy();
    expectFailed(outcome, 'other');
    expect(log.calls.at(-1)?.obj).toEqual({ code: 'EIO' });
  });
});
