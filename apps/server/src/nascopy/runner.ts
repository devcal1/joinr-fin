// The rsync runner (stage-8.md §5.4, frozen env, argv shape and return type).
//
// - The child's environment is built from scratch: PATH, LC_ALL=C and, when given, RSYNC_PASSWORD
//   (plus SystemRoot on win32 only, so a test's Node child can start). Never `process.env` spread:
//   RSYNC_RSH, RSYNC_PROXY, RSYNC_CONNECT_PROG, a stray RSYNC_PASSWORD or HOME (popt aliases in
//   `$HOME/.popt`) can never reach the child.
// - The password is never an argument and never a file.
// - `shell: false`; the argv is handed over verbatim.
// - It resolves on any exit code and rejects only when the child cannot start
//   (RsyncMissingError / RsyncStartError, built fresh from the error's code: no cause, no
//   spawnargs, no path, no original message) or when the signal aborts (SIGTERM, SIGKILL after
//   RSYNC_KILL_GRACE_MS; the rejection comes by grace + 500 ms whatever the child does).
// - stdout is kept up to `outputLimit` bytes (then `outTruncated`), stderr up to 64 KiB.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  RSYNC_ABORT_SETTLE_MS,
  RSYNC_EXECUTABLE,
  RSYNC_KILL_GRACE_MS,
  RSYNC_STDERR_LIMIT,
} from './constants';
import { safeSystemCode } from './errorCode';

export interface RsyncResult {
  code: number;
  out: string;
  err: string;
  outTruncated: boolean;
}

export interface RsyncRunOptions {
  password?: string;
  signal: AbortSignal;
  outputLimit: number;
}

/** The runner as the copy sees it (tests pass a fake). */
export type RsyncRunner = (args: readonly string[], opts: RsyncRunOptions) => Promise<RsyncResult>;

/** The spawn seam (tests only; production never passes it). */
export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** rsync is not on PATH (spawn ENOENT). */
export class RsyncMissingError extends Error {
  readonly code = 'ENOENT';
  constructor() {
    super('rsync could not be started: it is not installed');
    this.name = 'RsyncMissingError';
  }
}

/** The child could not start for another reason; only the error's code is kept. */
export class RsyncStartError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('rsync could not be started');
    this.name = 'RsyncStartError';
    this.code = code;
  }
}

/** Why an abort happened: the app stopping, or the copy's own deadline. */
export type AbortWhy = 'stopped' | 'deadline';

/** The runner was aborted. */
export class RsyncAbortError extends Error {
  readonly why: AbortWhy;
  constructor(why: AbortWhy) {
    super(why === 'deadline' ? 'rsync was stopped at the deadline' : 'rsync was stopped');
    this.name = 'AbortError';
    this.why = why;
  }
}

/** The reason the service aborts the copy's deadline signal with. */
export class NasCopyDeadline extends Error {
  constructor() {
    super('The copy reached its deadline');
    this.name = 'TimeoutError';
  }
}

/** A deadline (ours, or AbortSignal.timeout's TimeoutError), else a stop. */
export function abortWhy(signal: AbortSignal): AbortWhy {
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason instanceof NasCopyDeadline || reason?.name === 'TimeoutError'
    ? 'deadline'
    : 'stopped';
}

/** The child's whole environment (§5.4, exact keys). */
export function rsyncEnv(password?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', LC_ALL: 'C' };
  if (password !== undefined) env.RSYNC_PASSWORD = password;
  if (process.platform === 'win32' && process.env.SystemRoot !== undefined) {
    env.SystemRoot = process.env.SystemRoot;
  }
  return env;
}

/** The error's system code, allowlisted (a free-form `code` becomes UNKNOWN, §5.12). */
const codeOf = (err: unknown): string => safeSystemCode(err);

/** A fresh start error from the original's code only (the original is dropped). */
function startError(err: unknown): Error {
  const code = codeOf(err);
  return code === 'ENOENT' ? new RsyncMissingError() : new RsyncStartError(code);
}

/** Runs rsync once (see the header). */
export function runRsync(
  args: readonly string[],
  opts: RsyncRunOptions,
  spawnImpl: SpawnImpl = spawn,
): Promise<RsyncResult> {
  return new Promise<RsyncResult>((resolve, reject) => {
    const { signal, outputLimit } = opts;
    if (signal.aborted) {
      reject(new RsyncAbortError(abortWhy(signal)));
      return;
    }

    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cleanup = (): void => {
      settled = true;
      for (const t of timers) clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      cleanup();
      reject(err);
    };

    let child: ChildProcess;
    try {
      child = spawnImpl(RSYNC_EXECUTABLE, [...args], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: rsyncEnv(opts.password),
        windowsHide: true,
      });
    } catch (err) {
      reject(startError(err));
      return;
    }

    const out: Buffer[] = [];
    let outBytes = 0;
    let outTruncated = false;
    const errChunks: Buffer[] = [];
    let errBytes = 0;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (outBytes >= outputLimit) {
        outTruncated = true;
        return;
      }
      const room = outputLimit - outBytes;
      if (chunk.length > room) {
        out.push(chunk.subarray(0, room));
        outBytes += room;
        outTruncated = true;
      } else {
        out.push(chunk);
        outBytes += chunk.length;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errBytes >= RSYNC_STDERR_LIMIT) return;
      const part = chunk.subarray(0, RSYNC_STDERR_LIMIT - errBytes);
      errChunks.push(part);
      errBytes += part.length;
    });
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});

    let aborted: AbortWhy | null = null;
    function onAbort(): void {
      if (settled || aborted !== null) return;
      aborted = abortWhy(signal);
      const why = aborted;
      try {
        child.kill('SIGTERM');
      } catch {
        // Already gone.
      }
      timers.push(
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
        }, RSYNC_KILL_GRACE_MS),
      );
      timers.push(setTimeout(() => fail(new RsyncAbortError(why)), RSYNC_ABORT_SETTLE_MS));
    }
    signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err: unknown) => {
      if (aborted !== null) return;
      fail(startError(err));
    });
    child.on('close', (code: number | null) => {
      if (settled) return;
      if (aborted !== null) {
        fail(new RsyncAbortError(aborted));
        return;
      }
      cleanup();
      resolve({
        code: typeof code === 'number' ? code : -1,
        out: Buffer.concat(out).toString('utf8'),
        err: Buffer.concat(errChunks).toString('utf8'),
        outTruncated,
      });
    });
  });
}
