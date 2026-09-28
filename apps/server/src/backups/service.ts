// The backup service (stage-7.md §5.4): the nightly backup at 02:30 server-local (D115) with its
// own timer on the injectable clock, a start-up catch-up, retries, and "Back up now". Every run is
// one `backup` scheduler job (intervalMs 0: the service decides when), so each writes a `job_runs`
// row with its trigger and a click joins a run in flight.
//
// The slot of a date is `new Date(y, m, d, 2, 30)` in server-local time: on the October change
// (02:00 → 03:00) that is 03:30; on the April change (03:00 → 02:00) the first 02:30. `S(now)` is
// the latest slot ≤ now. A nightly run is due when the schedule is on and `S(now)` is not settled:
// (a) a nightly file dated in [S(now), now + BACKUP_DUE_SLACK_MS], (b) a succeeded `backup` run
// with `detail.slot` = S(now) (the empty-database skip, a restart after the run), or (c) this
// process gave up on it after 3 failed attempts.
import {
  BACKUP_DUE_SLACK_MS,
  BACKUP_FAILURE_MESSAGES,
  BACKUP_NIGHTLY_HOUR,
  BACKUP_NIGHTLY_MINUTE,
  type BackupFailureReason,
  type BackupFileDto,
  type BackupJobDetail,
  type BackupKind,
  type JobRunSummary,
  type JobTrigger,
} from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { hasAppData, hasDomainData } from '../db/queries/domain';
import { HttpError } from '../errors';
import { IMPORT_IN_PROGRESS_MESSAGE } from '../investments/mutations';
import { importLock } from '../routes/import';
import { systemClock } from '../scheduler/index';
import type { Clock, JobContext, JobResult, Scheduler } from '../scheduler/types';
import {
  BackupError,
  cleanLeftovers,
  errorCode,
  writeVerifiedBackupWith,
  type CopyFn,
  type StatfsFn,
} from './copy';
import { backupDtoFor, computeStaleness, listBackupFiles, type Staleness } from './list';
import { localIsoWithOffset } from './names';

/** The start-up catch-up check runs this long after start (after the recorder's 60 s check). */
export const BACKUP_STARTUP_DELAY_MS = 2 * 60_000;
/** The timer never sleeps longer (DST changes, clock corrections, setTimeout's limit). */
export const BACKUP_WAKE_MAX_MS = 6 * 3_600_000;
/** A failed (or import-skipped) nightly run is retried after this long. */
export const BACKUP_RETRY_MS = 15 * 60_000;
/** Failed attempts per slot before the service waits for the next slot. */
export const BACKUP_MAX_ATTEMPTS = 3;

export interface BackupServiceStatus {
  enabled: boolean;
  nextRunAt: string | null;
  running: boolean;
  lastRun: JobRunSummary | null;
}

export interface BackupService {
  /** Registers the job, deletes stale partials, arms the start-up check. */
  start(): void;
  /** Clears the timer, waits for an in-flight run. */
  stop(): Promise<void>;
  backupNow(): Promise<{ file: BackupFileDto; joined: boolean }>;
  status(): BackupServiceStatus;
  /** §5.4 stale flag and the newest nightly or manual file's createdAt (`/api/status`). */
  staleness(): Staleness;
  /**
   * Stage 8 (stage-8.md §5.10, additive): resolves once no tracked backup attempt is in flight
   * (at once when none is), so a NAS copy never starts in the middle of one.
   */
  whenIdle(): Promise<void>;
}

export interface BackupServiceDeps {
  database: AppDatabase;
  config: Pick<Config, 'dataDir' | 'nightlyBackups'>;
  scheduler: Scheduler;
  log: FastifyBaseLogger;
  /** Timers (default `systemClock`). */
  clock?: Clock;
  /** Dates and times (default `clock.now()`). */
  now?: () => Date;
  /** The copy seam (§5.3 step 2; tests pass an async fake). */
  copy?: CopyFn;
  statfs?: StatfsFn;
}

// ─── Slots and planning (pure) ──────────────────────────────────────────────────────────────────

/** The nightly slot of `date`'s local calendar day. */
export function slotOf(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    BACKUP_NIGHTLY_HOUR,
    BACKUP_NIGHTLY_MINUTE,
  );
}

/** The slot `days` calendar days after `date`'s (local calendar arithmetic). */
function slotPlusDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    BACKUP_NIGHTLY_HOUR,
    BACKUP_NIGHTLY_MINUTE,
  );
}

/** `S(now)`: today's slot when `now` has reached it, else yesterday's. */
export function currentSlot(now: Date): Date {
  const today = slotOf(now);
  return now.getTime() >= today.getTime() ? today : slotPlusDays(now, -1);
}

/** The first slot strictly after `now`. */
export function nextSlotAfter(now: Date): Date {
  const today = slotOf(now);
  return now.getTime() < today.getTime() ? today : slotPlusDays(now, 1);
}

export interface BackupPlanState {
  enabled: boolean;
  /** `S(now)` is settled (a file, a succeeded run, or given up). */
  settled: boolean;
  /** Nothing runs before this after a failure or an import skip. */
  retryAt: Date | null;
  /** The armed start-up catch-up (nothing runs before it). */
  catchUpAt: Date | null;
}

export interface BackupPlan {
  /** Run a nightly backup now. */
  runNow: boolean;
  /** When the timer should wake next; null when disabled. */
  wakeAt: Date | null;
  /** The actual next due run (§4.3): min(pending retry, armed catch-up, next slot); null when off. */
  nextRunAt: Date | null;
}

/** The plan at `now` (pure; §5.4 "Timer"). */
export function planNext(now: Date, state: BackupPlanState): BackupPlan {
  if (!state.enabled) return { runNow: false, wakeAt: null, nextRunAt: null };
  const t = now.getTime();
  const nextSlot = nextSlotAfter(now);
  const due = !state.settled;
  const retry = due && state.retryAt !== null && t < state.retryAt.getTime() ? state.retryAt : null;
  const catchUp =
    state.catchUpAt !== null && t < state.catchUpAt.getTime() ? state.catchUpAt : null;
  const runNow = due && retry === null && catchUp === null;

  // A due slot runs once every gate (a pending retry, the armed catch-up) has passed.
  const gate = Math.max(t, retry?.getTime() ?? t, catchUp?.getTime() ?? t);
  let wake = Math.min(nextSlot.getTime(), t + BACKUP_WAKE_MAX_MS);
  // The catch-up is re-checked when it comes due even when nothing is due now (the check, §5.4).
  if (catchUp) wake = Math.min(wake, catchUp.getTime());
  if (due) wake = Math.min(wake, gate);
  const next = due ? Math.min(nextSlot.getTime(), gate) : nextSlot.getTime();
  return { runNow, wakeAt: new Date(wake), nextRunAt: new Date(next) };
}

// ─── The service ────────────────────────────────────────────────────────────────────────────────

function importInProgress(): HttpError {
  return new HttpError(409, IMPORT_IN_PROGRESS_MESSAGE, 'IMPORT_IN_PROGRESS');
}

const FAILURE_REASONS = new Set<string>(['no_space', 'verify_failed', 'io']);

function failureReasonOf(detail: Record<string, unknown> | undefined): BackupFailureReason {
  const reason = detail?.['reason'];
  return typeof reason === 'string' && FAILURE_REASONS.has(reason)
    ? (reason as BackupFailureReason)
    : 'io';
}

const CATEGORY_MESSAGES = new Set<string>(Object.values(BACKUP_FAILURE_MESSAGES));

/**
 * §4.3: `lastRun.error` is always one of the three category messages, never raw text. A run the
 * job did not finish itself (`interrupted`: marked at start after a crash, or in a copy's settle
 * step) carries another word; it reads as "The copy could not be written" (Fixer SPEC-4).
 */
export function withCategoryError(run: JobRunSummary | null): JobRunSummary | null {
  if (run === null || run.error === null || CATEGORY_MESSAGES.has(run.error)) return run;
  return { ...run, error: BACKUP_FAILURE_MESSAGES.io };
}

export function createBackupService(deps: BackupServiceDeps): BackupService {
  const { database, config, scheduler, log } = deps;
  const db = database.db;
  const clock = deps.clock ?? systemClock;
  const now = deps.now ?? (() => clock.now());
  const enabled = config.nightlyBackups;

  let registered = false;
  let started = false;
  let stopped = false;
  let timer: unknown = null;
  let retryAt: Date | null = null;
  let catchUpAt: Date | null = null;
  /** When start() ran: only a slot before it waits for the catch-up delay. */
  let startedAt: Date | null = null;
  /** Failed attempts per slot (local ISO). */
  const failures = new Map<string, number>();
  /** The slot this process gave up on (after BACKUP_MAX_ATTEMPTS failures). */
  let doneSlot: string | null = null;
  /** The attempt number the next nightly run records. */
  let nextAttempt = 1;
  const attempts = new Set<Promise<unknown>>();

  // ── Settled? ──

  /**
   * Rule (b) of the due rule: a `succeeded` run recorded for the slot. A run that copied settles
   * it; an empty-database skip settles it only while the database is still empty, so data that
   * arrives later the same day (the first import on install day) still gets that slot's copy at
   * the next check or start (Fixer SPEC-3; the D82-style catch-up intent).
   */
  function succeededRunForSlot(slotIso: string): boolean {
    const rows = db
      .select({ skipped: sql<string | null>`json_extract(${jobRuns.detailJson}, '$.skipped')` })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.job, 'backup'),
          eq(jobRuns.status, 'succeeded'),
          sql`json_extract(${jobRuns.detailJson}, '$.slot') = ${slotIso}`,
        ),
      )
      .all();
    if (rows.length === 0) return false;
    if (rows.some((r) => r.skipped !== 'empty')) return true;
    return !hasDomainData(db) && !hasAppData(db);
  }

  function isSettled(at: Date): boolean {
    const slot = currentSlot(at);
    const slotIso = localIsoWithOffset(slot);
    if (doneSlot === slotIso) return true;
    const from = slot.getTime();
    const to = at.getTime() + BACKUP_DUE_SLACK_MS;
    const fileSettles = listBackupFiles(config.dataDir).some(
      (f) => f.kind === 'nightly' && f.instant.getTime() >= from && f.instant.getTime() <= to,
    );
    return fileSettles || succeededRunForSlot(slotIso);
  }

  function planAt(at: Date): BackupPlan {
    return planNext(at, {
      enabled,
      settled: enabled ? isSettled(at) : true,
      retryAt,
      // The catch-up delay holds back a slot missed while the server was down, not one that
      // comes round after the start (that one runs on time).
      catchUpAt:
        catchUpAt !== null && startedAt !== null && currentSlot(at).getTime() < startedAt.getTime()
          ? catchUpAt
          : null,
    });
  }

  // ── The job ──

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const at = now();
    const kind: BackupKind = ctx.trigger === 'manual' ? 'manual' : 'nightly';
    const detail: BackupJobDetail = { kind };
    if (kind === 'nightly') {
      detail.slot = localIsoWithOffset(currentSlot(at));
      detail.attempt = nextAttempt;
    }
    if (importLock.held) {
      log.info({ kind, trigger: ctx.trigger }, 'backup: an import is running; skipped');
      return { status: 'partial', detail: { ...detail, skipped: 'import_in_progress' } };
    }
    try {
      if (kind === 'nightly' && !hasDomainData(db) && !hasAppData(db)) {
        return { status: 'succeeded', detail: { ...detail, skipped: 'empty' } };
      }
      const pending = writeVerifiedBackupWith(database, config.dataDir, kind, at, {
        jobRunId: ctx.jobRunId,
        slot: detail.slot,
        copy: deps.copy,
        statfs: deps.statfs,
        log,
      });
      const written = pending instanceof Promise ? await pending : pending;
      log.info(
        { kind, name: written.name, sizeBytes: written.sizeBytes, durationMs: written.durationMs },
        'backup written',
      );
      return {
        status: 'succeeded',
        detail: {
          ...detail,
          name: written.name,
          sizeBytes: written.sizeBytes,
          durationMs: written.durationMs,
          verified: true,
          pruned: written.pruned,
        },
      };
    } catch (err) {
      const reason: BackupFailureReason = err instanceof BackupError ? err.reason : 'io';
      const code = err instanceof BackupError ? err.causeCode : errorCode(err);
      // The raw error's code only: never its message or a path.
      log.error({ kind, reason, code }, 'backup failed');
      return {
        status: 'failed',
        error: BACKUP_FAILURE_MESSAGES[reason],
        detail: { ...detail, reason },
      };
    }
  }

  function ensureRegistered(): void {
    if (registered) return;
    scheduler.register({ name: 'backup', intervalMs: 0, run: (ctx) => runJob(ctx) });
    registered = true;
  }

  // ── Timer ──

  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function arm(at: Date | null): void {
    clearTimer();
    if (!started || stopped || at === null) return;
    timer = clock.setTimeout(
      () => {
        timer = null;
        wake();
      },
      Math.max(0, at.getTime() - now().getTime()),
    );
  }

  function replan(): void {
    if (!started || stopped) return;
    try {
      arm(planAt(now()).wakeAt);
    } catch (err) {
      log.error({ code: errorCode(err) }, 'backup: planning failed');
      arm(new Date(now().getTime() + BACKUP_RETRY_MS));
    }
  }

  function track<T>(p: Promise<T>): Promise<T> {
    attempts.add(p);
    void p.then(
      () => attempts.delete(p),
      () => attempts.delete(p),
    );
    return p;
  }

  function wake(): void {
    if (!started || stopped) return;
    const at = now();
    let trigger: JobTrigger = 'schedule';
    if (catchUpAt !== null && at.getTime() >= catchUpAt.getTime()) {
      catchUpAt = null;
      if (startedAt !== null && currentSlot(at).getTime() < startedAt.getTime()) {
        trigger = 'startup';
      }
    }
    let plan: BackupPlan;
    try {
      plan = planAt(at);
    } catch (err) {
      log.error({ code: errorCode(err) }, 'backup: planning failed');
      arm(new Date(at.getTime() + BACKUP_RETRY_MS));
      return;
    }
    if (!plan.runNow) {
      arm(plan.wakeAt);
      return;
    }
    const slotIso = localIsoWithOffset(currentSlot(at));
    nextAttempt = (failures.get(slotIso) ?? 0) + 1;
    const run = scheduler.run('backup', trigger).then(
      ({ result }) => {
        const d = result.detail as Partial<BackupJobDetail> | undefined;
        if (result.status === 'failed' && d?.kind === 'nightly') {
          const n = (failures.get(slotIso) ?? 0) + 1;
          failures.set(slotIso, n);
          if (n >= BACKUP_MAX_ATTEMPTS) {
            doneSlot = slotIso;
            retryAt = null;
            log.warn({ slot: slotIso }, 'backup: giving up on this night; next slot');
          } else {
            retryAt = new Date(now().getTime() + BACKUP_RETRY_MS);
          }
        } else if (d?.skipped === 'import_in_progress') {
          retryAt = new Date(now().getTime() + BACKUP_RETRY_MS);
        } else {
          retryAt = null;
        }
      },
      (err: unknown) => {
        retryAt = new Date(now().getTime() + BACKUP_RETRY_MS);
        if (!stopped) log.error({ code: errorCode(err) }, 'backup: the backup job could not run');
      },
    );
    void track(run).finally(() => replan());
  }

  // ── The API ──

  async function backupNow(): Promise<{ file: BackupFileDto; joined: boolean }> {
    ensureRegistered();
    if (importLock.held) throw importInProgress();
    const joined = scheduler.isRunning('backup');
    let { result } = await track(scheduler.run('backup', 'manual'));
    let wasJoined = joined;
    // A joined nightly run that had nothing to copy: take the copy that was asked for.
    if (joined && result.status === 'succeeded' && result.detail?.['name'] === undefined) {
      ({ result } = await track(scheduler.run('backup', 'manual')));
      wasJoined = false;
    }
    if (started && !stopped) replan();
    if (result.status === 'failed') throw new BackupError(failureReasonOf(result.detail));
    if (result.detail?.['skipped'] === 'import_in_progress') throw importInProgress();
    const name = result.detail?.['name'];
    if (typeof name !== 'string') throw new BackupError('io');
    const file = backupDtoFor(config.dataDir, name, now());
    if (file === null) throw new BackupError('io');
    return { file, joined: wasJoined };
  }

  return {
    start() {
      if (started && !stopped) return;
      ensureRegistered();
      started = true;
      stopped = false;
      retryAt = null;
      try {
        const removed = cleanLeftovers(config.dataDir);
        if (removed.length > 0) log.info({ files: removed }, 'backup: removed leftover partials');
      } catch (err) {
        log.warn({ code: errorCode(err) }, 'backup: leftover cleanup failed');
      }
      if (!enabled) {
        catchUpAt = null;
        clearTimer();
        return;
      }
      startedAt = now();
      catchUpAt = new Date(startedAt.getTime() + BACKUP_STARTUP_DELAY_MS);
      replan();
    },

    async stop() {
      stopped = true;
      clearTimer();
      await Promise.allSettled([...attempts]);
    },

    backupNow,

    status() {
      let nextRunAt: string | null = null;
      const running = scheduler.isRunning('backup');
      if (enabled) {
        try {
          const at = now();
          // While a run is in flight its slot counts as settled: "Next" is the run after it.
          const next = running
            ? planNext(at, { enabled, settled: true, retryAt: null, catchUpAt: null }).nextRunAt
            : planAt(at).nextRunAt;
          nextRunAt = next === null ? null : localIsoWithOffset(next);
        } catch (err) {
          log.warn({ code: errorCode(err) }, 'backup: planning failed for the status');
        }
      }
      return {
        enabled,
        nextRunAt,
        running,
        lastRun: withCategoryError(scheduler.lastRun('backup')),
      };
    },

    staleness() {
      return computeStaleness(db, listBackupFiles(config.dataDir), now(), enabled);
    },

    async whenIdle() {
      while (attempts.size > 0) await Promise.allSettled([...attempts]);
    },
  };
}
