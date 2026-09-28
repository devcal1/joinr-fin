// The copy (stage-8.md §5.5): read the NAS files, list the far side, send what the NAS lacks (or
// holds at another size) newest first in ONE rsync invocation, list again and prove every file
// arrived at the right size. It only adds: the only flags are RSYNC_FLAGS (test-pinned), rsync
// writes each file to a hidden temporary and renames it into place, nothing is ever deleted.
//
// `copyToNas` NEVER THROWS: every outcome is `succeeded` or `failed` with one fixed sentence.
// The password lives in this function's local scope only: read once, handed to the runner's
// child environment, never logged, returned or stored. Nothing rsync printed is ever returned.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkNasUrl,
  NAS_COPY_REFUSAL_REASONS,
  type NasCopyFailureReason,
  type NasCopyJobDetail,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { backupsDir, listBackupFiles } from '../backups/list';
import { isBackupFileName } from '../backups/names';
import { RSYNC_FLAGS, RSYNC_LIST_FLAG, RSYNC_OUTPUT_LIMIT } from './constants';
import { safeErrorCode } from './errorCode';
import { parseListing, type RemoteFile } from './listing';
import { planCopy, type PlannedFile } from './plan';
import {
  abortWhy,
  RsyncAbortError,
  RsyncMissingError,
  runRsync,
  type RsyncResult,
  type RsyncRunner,
} from './runner';
import { createSecretsReader, type SecretsReader } from './secrets';
import { classify, listingMeansEmpty, sentenceFor } from './sentences';
import { decideConfiguration } from './status';

/** The copy's own detail (the service adds `slot` and `attempt`). */
export type NasCopyCoreDetail = Omit<NasCopyJobDetail, 'slot' | 'attempt'>;

export interface NasCopyOutcome {
  status: 'succeeded' | 'failed';
  detail: NasCopyCoreDetail;
  /** The §4.4 sentence, on a failure only. */
  error?: string;
}

export interface CopyToNasOptions {
  dataDir: string;
  /** The combined signal: the scheduler's, the service's stop, and the deadline (§5.5 step 8). */
  signal: AbortSignal;
  runner?: RsyncRunner;
  now?: () => Date;
  log?: FastifyBaseLogger;
  /** The NAS files reader (the service passes its own; default: a fresh one). */
  secrets?: SecretsReader;
}

/** The argv of a listing (§5.5 step 3; pinned). */
export function listArgs(url: string): string[] {
  return [...RSYNC_FLAGS, RSYNC_LIST_FLAG, '--', url];
}

/** The argv of the send (§5.5 step 5; pinned). */
export function sendArgs(sources: readonly string[], url: string): string[] {
  return [...RSYNC_FLAGS, '--', ...sources, url];
}

/** A failure found on the way: the reason and, when rsync gave one, its exit code. */
class Stop extends Error {
  constructor(
    readonly reason: NasCopyFailureReason,
    readonly exitCode?: number,
  ) {
    super('nas-copy: stopped at a failure');
    this.name = 'NasCopyStop';
  }
}

const errorName = safeErrorCode;

/** The size of a local backup file now, or null when it is gone (a prune). */
function localSize(dir: string, name: string): number | null {
  try {
    const st = lstatSync(join(dir, name));
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

export async function copyToNas(o: CopyToNasOptions): Promise<NasCopyOutcome> {
  const now = o.now ?? (() => new Date());
  const runner: RsyncRunner = o.runner ?? ((args, opts) => runRsync(args, opts));
  const startedMs = now().getTime();
  const detail: NasCopyCoreDetail = {
    configured: 'off',
    attempted: false,
    localFiles: 0,
    alreadyThere: 0,
    sent: 0,
    missingAfter: null,
    vanished: 0,
    onNas: null,
    bytes: 0,
    durationMs: 0,
  };

  const finish = (status: 'succeeded' | 'failed', stop?: Stop): NasCopyOutcome => {
    const end = now().getTime();
    detail.durationMs = Number.isFinite(end - startedMs) ? Math.max(0, end - startedMs) : 0;
    if (status === 'succeeded' || stop === undefined) return { status: 'succeeded', detail };
    detail.reason = stop.reason;
    if (stop.exitCode !== undefined && Number.isInteger(stop.exitCode)) {
      detail.exitCode = stop.exitCode;
    }
    return { status: 'failed', detail, error: sentenceFor(detail) };
  };

  try {
    const signal = o.signal;
    const abortStop = (): Stop => new Stop(abortWhy(signal) === 'deadline' ? 'timeout' : 'stopped');

    // 1. The NAS files (the password's control-character check is part of this step).
    const secrets = o.secrets ?? createSecretsReader({ dataDir: o.dataDir, log: o.log });
    const read = secrets.readForCopy();
    const config = decideConfiguration(read.files);
    detail.configured = config.configured;
    if (signal.aborted) return finish('failed', abortStop());
    if (config.configured !== 'ready') {
      return finish('failed', new Stop(config.configReason ?? 'url_missing'));
    }
    const check =
      read.files.url.state === 'present'
        ? checkNasUrl(read.files.url.line)
        : ({ ok: false } as const);
    const password = read.password;
    if (!check.ok || password === null) {
      return finish('failed', new Stop(check.ok ? 'password_invalid' : 'url_invalid'));
    }
    const url = check.url;
    const startMtimes = {
      url: read.files.url.state === 'absent' ? null : read.files.url.mtimeMs,
      password: read.files.password.state === 'absent' ? null : read.files.password.mtimeMs,
    };

    // A refusal while the helper replaced the files is recorded `other` (§5.5 step 3).
    const refusalOrOther = (reason: NasCopyFailureReason): NasCopyFailureReason => {
      if (!NAS_COPY_REFUSAL_REASONS.includes(reason)) return reason;
      const m = secrets.mtimes();
      return m.url !== startMtimes.url || m.password !== startMtimes.password ? 'other' : reason;
    };

    const run = async (args: string[]): Promise<RsyncResult> => {
      if (signal.aborted) throw abortStop();
      detail.attempted = true;
      try {
        return await runner(args, { password, signal, outputLimit: RSYNC_OUTPUT_LIMIT });
      } catch (err) {
        if (err instanceof RsyncMissingError) throw new Stop('no_rsync');
        if (err instanceof RsyncAbortError) {
          throw new Stop(err.why === 'deadline' ? 'timeout' : 'stopped');
        }
        if (signal.aborted) throw abortStop();
        o.log?.error({ code: errorName(err) }, 'nas-copy: rsync could not run');
        throw new Stop('other');
      }
    };

    // 2. The local files (future-dated ones included: they are verified files).
    const local = listBackupFiles(o.dataDir);
    detail.localFiles = local.length;
    if (signal.aborted) return finish('failed', abortStop());

    // 3. The far side.
    const first = await run(listArgs(url));
    let remote: RemoteFile[];
    if (first.code === 0) {
      if (first.outTruncated) return finish('failed', new Stop('other', first.code));
      remote = parseListing(first.out);
    } else if (listingMeansEmpty(first.code, first.err, check.hasSubfolder)) {
      remote = [];
    } else {
      return finish(
        'failed',
        new Stop(refusalOrOther(classify('list', first.code, first.err)), first.code),
      );
    }

    // 4. The plan.
    const plan = planCopy(local, remote);
    detail.alreadyThere = plan.alreadyThere;
    if (plan.toSend.length === 0) {
      detail.missingAfter = 0;
      detail.onNas = remote.length;
      return finish('succeeded');
    }

    // 5. Send, in one invocation. Every source is re-validated by the name rule.
    const dir = backupsDir(o.dataDir);
    const intended: PlannedFile[] = plan.toSend.filter((f) => isBackupFileName(f.name));
    const sources = intended.map((f) => join(dir, f.name));
    const send = await run(sendArgs(sources, url));
    if (send.code !== 0 && send.code !== 23 && send.code !== 24) {
      return finish(
        'failed',
        new Stop(refusalOrOther(classify('send', send.code, send.err)), send.code),
      );
    }

    // 6. Prove: list again and compare each intended name with its planned size.
    const again = await run(listArgs(url));
    if (again.code !== 0 || again.outTruncated) {
      return finish('failed', new Stop('readback_failed', again.code));
    }
    const after = parseListing(again.out);
    const afterSizes = new Map(after.map((f) => [f.name, f.bytes]));
    let sent = 0;
    let bytes = 0;
    let vanished = 0;
    let missing = 0;
    for (const f of intended) {
      if (afterSizes.get(f.name) === f.bytes) {
        sent += 1;
        bytes += f.bytes;
      } else if (localSize(dir, f.name) === null) {
        vanished += 1;
      } else {
        missing += 1;
      }
    }
    detail.sent = sent;
    detail.bytes = bytes;
    detail.vanished = vanished;
    detail.missingAfter = missing;
    detail.onNas = after.length;

    // 7. Decide.
    if (missing > 0) {
      return finish('failed', send.code === 23 ? new Stop('nas_io', 23) : new Stop('not_verified'));
    }
    return finish('succeeded');
  } catch (err) {
    if (err instanceof Stop) return finish('failed', err);
    // Anything unexpected: `other`, logged by its code or name only (never `{ err }`).
    o.log?.error({ code: errorName(err) }, 'nas-copy: the copy failed unexpectedly');
    return finish('failed', new Stop('other'));
  }
}
