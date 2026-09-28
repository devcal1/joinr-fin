// The rsync runner (stage-8.md §5.4, §5.13). The real runner, with a Node child standing in for
// rsync (through the test-only spawn seam: there is no rsync on the dev PC): the child sees
// EXACTLY PATH, LC_ALL=C and RSYNC_PASSWORD (plus SystemRoot on win32) even with RSYNC_RSH,
// RSYNC_PROXY, RSYNC_PASSWORD and HOME planted in the parent; argv verbatim with shell: false;
// the exit code resolved; stdout capped; ENOENT → RsyncMissingError with no cause, spawnargs or
// path. The kill escalation runs on a fake ChildProcess and a fake clock (on win32 a real child
// cannot ignore SIGTERM).
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RSYNC_EXECUTABLE,
  RSYNC_FLAGS,
  RSYNC_KILL_GRACE_MS,
  RSYNC_LIST_FLAG,
} from '../../src/nascopy/constants';
import {
  NasCopyDeadline,
  RsyncAbortError,
  RsyncMissingError,
  RsyncStartError,
  rsyncEnv,
  runRsync,
  type SpawnImpl,
} from '../../src/nascopy/runner';
import { PLANTED, PLANTED_URL } from './helpers';

const REPORT = `process.stdout.write(JSON.stringify({ env: process.env, argv: process.argv.slice(1) }));`;

/** A spawn that runs Node with `script` in place of rsync, recording what the runner asked for. */
function nodeChild(
  script: string,
  seen: { command?: string; options?: SpawnOptions } = {},
): SpawnImpl {
  return (command, args, options) => {
    seen.command = command;
    seen.options = options;
    return spawn(process.execPath, ['-e', script, '--', ...args], options);
  };
}

const never = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('runRsync with a real child', () => {
  it('hands the child exactly PATH, LC_ALL=C and RSYNC_PASSWORD, and argv verbatim', async () => {
    vi.stubEnv('RSYNC_RSH', 'planted-rsh');
    vi.stubEnv('RSYNC_PROXY', 'planted-proxy:1');
    vi.stubEnv('RSYNC_PASSWORD', 'planted-stray-password');
    vi.stubEnv('RSYNC_CONNECT_PROG', 'planted-connect');
    vi.stubEnv('HOME', join(tmpdir(), 'planted-home'));
    const seen: { command?: string; options?: SpawnOptions } = {};
    const args = [...RSYNC_FLAGS, RSYNC_LIST_FLAG, '--', PLANTED_URL, 'a b', '$HOME', '"q"'];
    const result = await runRsync(
      args,
      { password: PLANTED.password, signal: never(), outputLimit: 1_000_000 },
      nodeChild(REPORT, seen),
    );
    expect(result.code).toBe(0);
    expect(result.outTruncated).toBe(false);
    const report = JSON.parse(result.out) as { env: Record<string, string>; argv: string[] };
    const expectedKeys = ['LC_ALL', 'PATH', 'RSYNC_PASSWORD'];
    if (process.platform === 'win32') expectedKeys.push('SystemRoot');
    // What the runner hands to spawn: exactly these keys, on every platform.
    expect(Object.keys(seen.options?.env ?? {}).sort()).toEqual([...expectedKeys].sort());
    if (process.platform === 'win32') {
      // libuv fills in its required Windows variables when a child's environment lacks them;
      // none of them is an rsync variable or HOME. On Linux the child sees exactly our keys.
      const LIBUV_WIN = [
        'HOMEDRIVE',
        'HOMEPATH',
        'LOGONSERVER',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'USERDOMAIN',
        'USERNAME',
        'USERPROFILE',
        'WINDIR',
      ];
      const extra = Object.keys(report.env).filter((k) => !expectedKeys.includes(k));
      expect(extra.filter((k) => !LIBUV_WIN.includes(k.toUpperCase()))).toEqual([]);
    } else {
      expect(Object.keys(report.env).sort()).toEqual([...expectedKeys].sort());
    }
    for (const key of Object.keys(report.env)) {
      expect(['HOME', 'RSYNC_RSH', 'RSYNC_PROXY', 'RSYNC_CONNECT_PROG']).not.toContain(
        key.toUpperCase(),
      );
    }
    expect(report.env['RSYNC_PASSWORD']).toBe(PLANTED.password);
    expect(report.env['LC_ALL']).toBe('C');
    expect(report.argv).toEqual(args);
    expect(seen.command).toBe(RSYNC_EXECUTABLE);
    expect(seen.options?.shell).toBe(false);
    expect(seen.options?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('leaves RSYNC_PASSWORD out when no password is given', () => {
    expect(Object.keys(rsyncEnv()).sort()).toEqual(
      process.platform === 'win32' ? ['LC_ALL', 'PATH', 'SystemRoot'] : ['LC_ALL', 'PATH'],
    );
    expect(rsyncEnv()).not.toHaveProperty('HOME');
  });

  it('resolves on a non-zero exit with stdout and stderr', async () => {
    const result = await runRsync(
      ['x'],
      { signal: never(), outputLimit: 1000 },
      nodeChild(
        `process.stdout.write('out'); process.stderr.write('@ERROR: auth failed'); process.exit(5);`,
      ),
    );
    expect(result).toEqual({
      code: 5,
      out: 'out',
      err: '@ERROR: auth failed',
      outTruncated: false,
    });
  });

  it('caps stdout at the limit and says so', async () => {
    const result = await runRsync(
      ['x'],
      { signal: never(), outputLimit: 1000 },
      nodeChild(`process.stdout.write('a'.repeat(200000));`),
    );
    expect(result.outTruncated).toBe(true);
    expect(result.out.length).toBe(1000);
  });

  it('rejects a missing executable with a fresh RsyncMissingError (no cause, spawnargs or path)', async () => {
    const missing = join(tmpdir(), 'no-such-rsync-binary-here');
    const err: unknown = await runRsync(
      [...RSYNC_FLAGS, RSYNC_LIST_FLAG, '--', PLANTED_URL],
      { password: PLANTED.password, signal: never(), outputLimit: 1000 },
      (_command, args, options) => spawn(missing, args, options),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RsyncMissingError);
    const e = err as Error & Record<string, unknown>;
    expect(e.cause).toBeUndefined();
    expect(e['spawnargs']).toBeUndefined();
    expect(e['path']).toBeUndefined();
    expect(e.message).toBe('rsync could not be started: it is not installed');
    const everything = JSON.stringify({ ...e, message: e.message, stack: e.stack });
    expect(everything).not.toContain(PLANTED.host);
    expect(everything).not.toContain('no-such-rsync');
  });

  it('turns a synchronous spawn throw into an RsyncStartError with the code only', async () => {
    const err: unknown = await runRsync(['x'], { signal: never(), outputLimit: 1 }, () => {
      throw Object.assign(
        new TypeError(`The argument 'options.env' is invalid: ${PLANTED.password}`),
        {
          code: 'ERR_INVALID_ARG_VALUE',
          cause: new Error(PLANTED.password),
        },
      );
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RsyncStartError);
    expect((err as RsyncStartError).code).toBe('ERR_INVALID_ARG_VALUE');
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify({ ...(err as object), m: (err as Error).message })).not.toContain(
      PLANTED.password,
    );
  });

  it('rejects at once when the signal is already aborted, without spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnImpl = vi.fn<SpawnImpl>();
    await expect(
      runRsync(['x'], { signal: controller.signal, outputLimit: 1 }, spawnImpl),
    ).rejects.toBeInstanceOf(RsyncAbortError);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

// ─── The kill escalation (fake child, fake clock) ───────────────────────────────────────────────

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true);
}

function fakeSpawn(child: FakeChild): SpawnImpl {
  return () => child as unknown as ChildProcess;
}

describe('the kill escalation', () => {
  it('sends SIGTERM, SIGKILL after the grace, and rejects by grace + 500 ms though the child never closes', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const controller = new AbortController();
    const settled = vi.fn();
    const p = runRsync(['x'], { signal: controller.signal, outputLimit: 10 }, fakeSpawn(child));
    p.then(settled, settled);
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RSYNC_KILL_GRACE_MS - 1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    const err: unknown = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RsyncAbortError);
    expect((err as RsyncAbortError).why).toBe('stopped');
  });

  it('tells a deadline from a stop', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const controller = new AbortController();
    const p = runRsync(['x'], { signal: controller.signal, outputLimit: 10 }, fakeSpawn(child));
    controller.abort(new NasCopyDeadline());
    child.emit('close', null);
    const err: unknown = await p.catch((e: unknown) => e);
    expect((err as RsyncAbortError).why).toBe('deadline');
    // Also AbortSignal.timeout's reason.
    const timeout = new AbortController();
    const q = runRsync(
      ['x'],
      { signal: timeout.signal, outputLimit: 10 },
      fakeSpawn(new FakeChild()),
    );
    const caught = q.catch((e: unknown) => e);
    timeout.abort(new DOMException('timed out', 'TimeoutError'));
    await vi.advanceTimersByTimeAsync(RSYNC_KILL_GRACE_MS + 500);
    expect(((await caught) as RsyncAbortError).why).toBe('deadline');
  });

  it('rejects as soon as a killed child closes', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });
    const controller = new AbortController();
    const p = runRsync(['x'], { signal: controller.signal, outputLimit: 10 }, fakeSpawn(child));
    controller.abort();
    const err: unknown = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RsyncAbortError);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('keeps stderr to 64 KiB and resolves a child killed by a signal with code -1', async () => {
    const child = new FakeChild();
    const p = runRsync(['x'], { signal: never(), outputLimit: 10 }, fakeSpawn(child));
    child.stderr.write('e'.repeat(70 * 1024));
    child.stdout.write('0123456789abc');
    await new Promise((r) => setImmediate(r));
    child.emit('close', null, 'SIGKILL');
    const result = await p;
    expect(result.code).toBe(-1);
    expect(result.err.length).toBe(64 * 1024);
    expect(result.out).toBe('0123456789');
    expect(result.outTruncated).toBe(true);
  });
});
