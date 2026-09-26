// The snapshot recorder (stage-5.md §4.6, FROZEN interface): the month-end auto-record (D81, D89)
// with an injectable clock, the start-up catch-up (D82), the auto-record switch (the setting or
// `AUTO_RECORD`, off by default, D84) and one record at a time (the mutex that corrections and
// deletes share).
//
// Time has one source: `now` (default `clock.now()`) decides every date and hour (today, the record
// time, `since`, `recorded_at`, `nextRunAt`); only the timers use `clock`. The recorder never holds
// the import lock: it checks it before an attempt and again, synchronously, right before the write.
import type { EngineApi, RecordingPlan } from '@joinr/engine';
import {
  isoMonthOf,
  monthEndOf,
  SNAPSHOT_RECORD_HOUR,
  type IsoDate,
  type IsoMonth,
  type JobRunSummary,
  type JobTrigger,
  type RecorderStatusDto,
  type RecordTrigger,
} from '@joinr/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { getMeta, setMeta } from '../db/meta';
import { booleanSetting, readSettings } from '../db/queries/settings';
import { appMeta, jobRuns, snapshots } from '../db/schema';
import { HttpError } from '../errors';
import { IMPORT_IN_PROGRESS_MESSAGE } from '../investments/mutations';
import { localIsoDate } from '../investments/format';
import { MarketDataDisabledError, type MarketDataService } from '../market/types';
import { importLock } from '../routes/import';
import { systemClock } from '../scheduler/index';
import type { Clock, JobContext, JobResult, Scheduler } from '../scheduler/types';
import { writeRecordedMonths, type RecordDetail, type RecordedMonth } from './record';

export type { RecordDetail, RecordedMonth } from './record';

/** The recorder's status (= the DTO, §4.4). */
export type RecorderStatus = RecorderStatusDto;

/** The first check after start-up (after the price job's first run). */
export const SNAPSHOT_STARTUP_DELAY_MS = 60_000;
/** The timer never sleeps longer (setTimeout's limit and DST changes). */
export const SNAPSHOT_WAKE_MAX_MS = 6 * 3_600_000;
/** A failed attempt is retried after this long. */
export const SNAPSHOT_RETRY_MS = 15 * 60_000;
/** A second caller waits this long for the mutex, then 409 RECORD_IN_PROGRESS. */
export const SNAPSHOT_LOCK_WAIT_MS = 30_000;
/** The bound on a record's price refresh. */
export const SNAPSHOT_PRICE_WAIT_MS = 120_000;
/** Prices refreshed this recently are not refreshed again. */
export const SNAPSHOT_PRICE_FRESH_MS = 5 * 60_000;

/** The `app_meta` key holding the date auto-record was last switched on (§4.6 item 2). */
export const AUTO_RECORD_SINCE_META_KEY = 'snapshot.autoRecordSince';

export const RECORD_IN_PROGRESS_MESSAGE = 'A month is being recorded; try again in a moment';
export const RECORDER_STOPPING_MESSAGE = 'The server is stopping; nothing was recorded';

/** Why a due month was not recorded by an automatic attempt (the job's `detail.skipped`). */
export type SnapshotSkipReason =
  'already_recorded' | 'import_in_progress' | 'earlier_month_missing' | 'stopped';

/** The `snapshot` job's `detail` (§4.6 item 3). */
// A type alias (not an interface) so it fits the scheduler's `Record<string, unknown>` detail.
export type SnapshotJobDetail = {
  due: IsoMonth[];
  recorded: IsoMonth[];
  skipped: { month: IsoMonth; reason: SnapshotSkipReason }[];
  pricesRefreshed: boolean;
  pricesAsOf: string | null;
};

export interface SnapshotRecorder {
  /** Registers the `snapshot` job, schedules the start-up catch-up and the timer. */
  start(): void;
  /** Aborts an in-flight price wait, clears the timer, waits for the attempt. */
  stop(): Promise<void>;
  /** A manual record (the routes). */
  record(req: { periodMonths: readonly IsoMonth[]; note: string | null }): Promise<RecordedMonth[]>;
  /** Corrections and deletes run inside the same mutex. */
  withLock<T>(fn: () => T): Promise<T>;
  /** Re-reads the switch, stamps `since`, re-plans. */
  settingsChanged(): void;
  status(): RecorderStatus;
}

export interface SnapshotRecorderDeps {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  scheduler: Scheduler;
  engine: EngineApi;
  log: FastifyBaseLogger;
  now?: () => Date;
  clock?: Clock;
}

/**
 * The recorder's replaceable collaborators. Production uses `writeRecordedMonths`; the timing
 * tests pass a fake writer (stage-5.md §7.1, "a fake writeRecordedMonths through a module seam").
 */
export interface SnapshotRecorderSeams {
  writeMonths: typeof writeRecordedMonths;
}

export function createSnapshotRecorder(deps: SnapshotRecorderDeps): SnapshotRecorder {
  return createSnapshotRecorderWith(deps, { writeMonths: writeRecordedMonths });
}

// ─── Planning (pure) ────────────────────────────────────────────────────────────────────────────

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0');

/** A Date → local `YYYY-MM-DDTHH:mm:ss±HH:MM` (the status's `nextRunAt`). */
export function localIsoWithOffset(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

/** SNAPSHOT_RECORD_HOUR local on the last day of `now`'s month. */
function monthEndRecordTime(year: number, monthIndex: number): Date {
  // Day 0 of the next month is this month's last day; 23:00 exists on every day (DST changes
  // happen at 02:00–03:00 in the owner's zone).
  return new Date(year, monthIndex + 1, 0, SNAPSHOT_RECORD_HOUR, 0, 0, 0);
}

/**
 * The next month-end record time: this month's when `now` is before it, else next month's. (With
 * the current month due at `now`, the attempt runs now; the status names the next month end.)
 */
export function nextMonthEndRecordTime(now: Date): Date {
  const thisMonth = monthEndRecordTime(now.getFullYear(), now.getMonth());
  if (now.getTime() < thisMonth.getTime()) return thisMonth;
  return monthEndRecordTime(now.getFullYear(), now.getMonth() + 1);
}

/** Local hour ≥ SNAPSHOT_RECORD_HOUR on the last day of the month (§4.6 item 4). */
export function recordTimeReachedAt(now: Date): boolean {
  const today = localIsoDate(now);
  return today === monthEndOf(isoMonthOf(today)) && now.getHours() >= SNAPSHOT_RECORD_HOUR;
}

export interface PlanState {
  /** Every snapshot's month (the table's rows). */
  snapshots: readonly { periodMonth: IsoMonth }[];
  /** The effective auto-record switch. */
  enabled: boolean;
  /** `snapshot.autoRecordSince`. */
  since: IsoDate | null;
  /**
   * Set after an attempt failed (or skipped for the import lock): nothing runs before this time
   * (the last attempt + SNAPSHOT_RETRY_MS).
   */
  retryAt: Date | null;
  /** The month the last `snapshot` run already reported as blocked (not repeated, D94). */
  reportedBlocked: IsoMonth | null;
  recordingsDue: EngineApi['recordingsDue'];
}

export interface PlanNextResult {
  today: IsoDate;
  recordTimeReached: boolean;
  plan: RecordingPlan;
  /** Run an automatic attempt now (something is due, or a new blocked month to report). */
  runNow: boolean;
  /** When the timer should wake next; null while auto-record is off (no timer). */
  wakeAt: Date | null;
  /** The next month-end record time while the switch is on (the status). */
  nextRunAt: Date | null;
}

/**
 * The scheduler's plan at `now` (§4.6 item 4): the engine's `recordingsDue` with the recorder's
 * switch, then the next wake-up: now when something is due, else the earliest of the next month
 * end at SNAPSHOT_RECORD_HOUR and now + SNAPSHOT_WAKE_MAX_MS; after a failure, the retry time
 * (the failed attempt + SNAPSHOT_RETRY_MS) instead of now.
 */
export function planNext(now: Date, state: PlanState): PlanNextResult {
  const today = localIsoDate(now);
  const recordTimeReached = recordTimeReachedAt(now);
  const plan: RecordingPlan = state.enabled
    ? state.recordingsDue({
        snapshots: state.snapshots,
        today,
        recordTimeReached,
        autoRecordSince: state.since,
      })
    : { due: [], blocked: null };
  if (!state.enabled) {
    return { today, recordTimeReached, plan, runNow: false, wakeAt: null, nextRunAt: null };
  }
  const pending =
    plan.due.length > 0 ||
    (plan.blocked !== null && plan.blocked.periodMonth !== state.reportedBlocked);
  const monthEnd = nextMonthEndRecordTime(now);
  const t = now.getTime();
  let wake = Math.min(monthEnd.getTime(), t + SNAPSHOT_WAKE_MAX_MS);
  let runNow = false;
  if (pending && state.retryAt !== null && t < state.retryAt.getTime()) {
    wake = Math.min(wake, state.retryAt.getTime());
  } else if (pending) {
    wake = t;
    runNow = true;
  }
  return { today, recordTimeReached, plan, runNow, wakeAt: new Date(wake), nextRunAt: monthEnd };
}

// ─── The mutex ──────────────────────────────────────────────────────────────────────────────────

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: unknown;
}

/** One holder at a time; a waiter gives up after `waitMs` on the clock with RECORD_IN_PROGRESS. */
function createMutex(clock: Clock) {
  let held = false;
  const waiters: Waiter[] = [];
  return {
    get held() {
      return held;
    },
    acquire(waitMs: number): Promise<void> {
      if (!held) {
        held = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve,
          reject,
          timer: clock.setTimeout(() => {
            const i = waiters.indexOf(waiter);
            if (i >= 0) waiters.splice(i, 1);
            reject(new HttpError(409, RECORD_IN_PROGRESS_MESSAGE, 'RECORD_IN_PROGRESS'));
          }, waitMs),
        };
        waiters.push(waiter);
      });
    },
    release(): void {
      const next = waiters.shift();
      if (next) {
        clock.clearTimeout(next.timer);
        next.resolve(); // `held` stays true: ownership passes to the waiter
      } else {
        held = false;
      }
    },
  };
}

// ─── The recorder ───────────────────────────────────────────────────────────────────────────────

class AbortedError extends Error {
  constructor() {
    super('The recorder is stopping');
    this.name = 'AbortedError';
  }
}

function importInProgress(): HttpError {
  return new HttpError(409, IMPORT_IN_PROGRESS_MESSAGE, 'IMPORT_IN_PROGRESS');
}

function stopping(): HttpError {
  return new HttpError(503, RECORDER_STOPPING_MESSAGE, 'INTERNAL_SERVER_ERROR', { expose: true });
}

/** The month reported as `earlier_month_missing` by a job run, if any. */
function blockedMonthOf(run: JobRunSummary | null): IsoMonth | null {
  const skipped = run?.detail?.['skipped'];
  if (!Array.isArray(skipped)) return null;
  for (const s of skipped as unknown[]) {
    if (typeof s !== 'object' || s === null) continue;
    const { month, reason } = s as { month?: unknown; reason?: unknown };
    if (reason === 'earlier_month_missing' && typeof month === 'string') return month;
  }
  return null;
}

export function createSnapshotRecorderWith(
  deps: SnapshotRecorderDeps,
  seams: SnapshotRecorderSeams,
): SnapshotRecorder {
  const { database, config, market, scheduler, engine, log } = deps;
  const db = database.db;
  const clock = deps.clock ?? systemClock;
  const now = deps.now ?? (() => clock.now());
  const mutex = createMutex(clock);

  let registered = false;
  let started = false;
  let stopped = false;
  let controller = new AbortController();
  let timer: unknown = null;
  let retryAt: Date | null = null;
  let running = false;
  const attempts = new Set<Promise<unknown>>();

  // ── State ──

  function effective(): { enabled: boolean; source: 'setting' | 'env' } {
    if (config.autoRecord !== null) return { enabled: config.autoRecord, source: 'env' };
    const setting = booleanSetting(readSettings(db, log), 'history.autoRecord');
    return { enabled: setting ?? false, source: 'setting' };
  }

  function readSince(): IsoDate | null {
    return getMeta(db, AUTO_RECORD_SINCE_META_KEY) ?? null;
  }

  /** Writes `since` when the switch is on without one; deletes it when the switch is off. */
  function syncSince(enabled: boolean): void {
    const since = readSince();
    if (enabled && since === null) {
      const at = now();
      setMeta(db, AUTO_RECORD_SINCE_META_KEY, localIsoDate(at), at);
    } else if (!enabled && since !== null) {
      db.delete(appMeta).where(eq(appMeta.key, AUTO_RECORD_SINCE_META_KEY)).run();
    }
  }

  function snapshotMonths(): { periodMonth: IsoMonth }[] {
    return db.select({ periodMonth: snapshots.periodMonth }).from(snapshots).all();
  }

  function planAt(at: Date): PlanNextResult {
    const { enabled } = effective();
    return planNext(at, {
      snapshots: snapshotMonths(),
      enabled,
      since: enabled ? readSince() : null,
      retryAt,
      reportedBlocked: blockedMonthOf(scheduler.lastRun('snapshot')),
      recordingsDue: engine.recordingsDue,
    });
  }

  // ── Timer ──

  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function arm(delayMs: number, trigger: JobTrigger): void {
    clearTimer();
    if (!started || stopped) return;
    timer = clock.setTimeout(
      () => {
        timer = null;
        wake(trigger);
      },
      Math.max(0, delayMs),
    );
  }

  /** Plans at `now` and arms the timer (no timer while auto-record is off). */
  function replan(): void {
    if (!started || stopped) return;
    let next: PlanNextResult;
    try {
      next = planAt(now());
    } catch (err) {
      log.error({ err }, 'snapshot recorder: planning failed');
      arm(SNAPSHOT_RETRY_MS, 'schedule');
      return;
    }
    if (next.wakeAt === null) {
      clearTimer();
      return;
    }
    arm(next.wakeAt.getTime() - now().getTime(), 'schedule');
  }

  function track<T>(p: Promise<T>): Promise<T> {
    attempts.add(p);
    void p.then(
      () => attempts.delete(p),
      () => attempts.delete(p),
    );
    return p;
  }

  /** A wake-up: runs one `snapshot` job when something is due (or newly blocked), then re-plans. */
  function wake(trigger: JobTrigger): void {
    if (!started || stopped) return;
    let next: PlanNextResult;
    try {
      next = planAt(now());
    } catch (err) {
      log.error({ err }, 'snapshot recorder: planning failed');
      arm(SNAPSHOT_RETRY_MS, 'schedule');
      return;
    }
    if (!next.runNow) {
      replan();
      return;
    }
    const run = scheduler.run('snapshot', trigger).then(
      ({ result }) => {
        const skippedForImport =
          (result.detail as SnapshotJobDetail | undefined)?.skipped.some(
            (s) => s.reason === 'import_in_progress',
          ) === true;
        retryAt =
          result.status === 'failed' || skippedForImport
            ? new Date(now().getTime() + SNAPSHOT_RETRY_MS)
            : null;
      },
      (err: unknown) => {
        retryAt = new Date(now().getTime() + SNAPSHOT_RETRY_MS);
        if (!stopped) log.error({ err }, 'snapshot recorder: the snapshot job could not run');
      },
    );
    void track(run).finally(() => replan());
  }

  // ── Prices (§4.6 item 6.2) ──

  /** Rejects with AbortedError when any signal aborts. */
  function abortPromise(signals: readonly AbortSignal[]): {
    promise: Promise<never>;
    dispose: () => void;
  } {
    let dispose = (): void => {};
    const promise = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(new AbortedError());
      if (signals.some((s) => s.aborted)) {
        reject(new AbortedError());
        return;
      }
      for (const s of signals) s.addEventListener('abort', onAbort, { once: true });
      dispose = () => {
        for (const s of signals) s.removeEventListener('abort', onAbort);
      };
    });
    promise.catch(() => {});
    return { promise, dispose };
  }

  /**
   * Fresh prices first: reuses a refresh within SNAPSHOT_PRICE_FRESH_MS, otherwise
   * `market.refresh` (it joins a run in flight), bounded by SNAPSHOT_PRICE_WAIT_MS and raced with
   * the stop signal. Market off or a failed or timed-out refresh records with the cached prices.
   */
  async function refreshPrices(
    trigger: JobTrigger,
    signals: readonly AbortSignal[],
  ): Promise<{ pricesRefreshed: boolean }> {
    const aborted = abortPromise(signals);
    try {
      if (signals.some((s) => s.aborted)) throw new AbortedError();
      const last = market.status().lastRefreshAt;
      if (last !== null && now().getTime() - Date.parse(last) <= SNAPSHOT_PRICE_FRESH_MS) {
        return { pricesRefreshed: true };
      }
      let timeoutHandle: unknown = null;
      const timeout = new Promise<'timeout'>((resolve) => {
        timeoutHandle = clock.setTimeout(() => resolve('timeout'), SNAPSHOT_PRICE_WAIT_MS);
      });
      const refresh = market.refresh({ trigger }).then(
        () => 'refreshed' as const,
        (err: unknown) => {
          if (err instanceof MarketDataDisabledError) return 'off' as const;
          log.warn({ err }, 'snapshot recorder: the price refresh failed; using cached prices');
          return 'failed' as const;
        },
      );
      try {
        const outcome = await Promise.race([refresh, timeout, aborted.promise]);
        if (outcome === 'timeout')
          log.warn('snapshot recorder: the price refresh timed out; using cached prices');
        return { pricesRefreshed: outcome === 'refreshed' };
      } finally {
        if (timeoutHandle !== null) clock.clearTimeout(timeoutHandle);
      }
    } finally {
      aborted.dispose();
    }
  }

  function recordDetail(pricesRefreshed: boolean, jobRunId: number | null): RecordDetail {
    const status = market.status();
    const pricesAsOf = status.lastRefreshAt;
    const parsed = pricesAsOf === null ? NaN : Date.parse(pricesAsOf);
    return {
      pricesAsOf,
      marketMode: status.mode,
      pricesRefreshed,
      pricesAgeMs: Number.isNaN(parsed) ? null : Math.max(0, now().getTime() - parsed),
      jobRunId,
    };
  }

  function write(
    periodMonths: readonly IsoMonth[],
    source: 'recorded' | 'lookback' | 'late',
    trigger: RecordTrigger,
    note: string | null,
    detail: RecordDetail,
  ): RecordedMonth[] {
    return seams.writeMonths(
      { database, market, engine, now },
      { periodMonths, source, trigger, note, now: now(), detail },
    );
  }

  /** The `job_runs` row of the `snapshot` run in flight (the scheduler inserted it). */
  function runningJobRunId(): number | null {
    return (
      db
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, 'snapshot'), eq(jobRuns.status, 'running')))
        .orderBy(desc(jobRuns.id))
        .limit(1)
        .get()?.id ?? null
    );
  }

  // ── The automatic attempt (the `snapshot` job) ──

  async function automaticAttempt(ctx: JobContext): Promise<JobResult> {
    const trigger: RecordTrigger = ctx.trigger === 'startup' ? 'startup' : 'schedule';
    const first = planAt(now()).plan;
    const due = first.due.map((d) => d.periodMonth);
    const detail: SnapshotJobDetail = {
      due,
      recorded: [],
      skipped: [],
      pricesRefreshed: false,
      pricesAsOf: null,
    };
    const finish = (status: JobResult['status'], error?: string): JobResult => {
      detail.pricesAsOf ??= market.status().lastRefreshAt;
      return error === undefined ? { status, detail } : { status, detail, error };
    };

    if (due.length === 0) {
      if (first.blocked) {
        detail.skipped.push({ month: first.blocked.periodMonth, reason: 'earlier_month_missing' });
        log.info(
          { due: [], blocked: first.blocked.periodMonth, missing: first.blocked.missing, trigger },
          'snapshot recorder: an earlier month is missing; nothing recorded',
        );
        return finish('partial');
      }
      return finish('succeeded');
    }

    if (importLock.held) {
      for (const month of due) detail.skipped.push({ month, reason: 'import_in_progress' });
      log.info({ due, trigger }, 'snapshot recorder: an import is running; retrying later');
      return finish('partial');
    }

    try {
      await mutex.acquire(SNAPSHOT_LOCK_WAIT_MS);
    } catch (err) {
      log.warn({ due, trigger }, 'snapshot recorder: another record is running; retrying later');
      return finish('failed', err instanceof Error ? err.message : String(err));
    }
    running = true;
    try {
      if (stopped) throw new AbortedError();
      const prices = await refreshPrices(ctx.trigger, [controller.signal, ctx.signal]);
      detail.pricesRefreshed = prices.pricesRefreshed;
      detail.pricesAsOf = market.status().lastRefreshAt;

      // Synchronously from here (§4.6 item 6.3): the lock re-check, the months and the source
      // re-derived from `now` (an attempt that crossed midnight records the ended month `late`),
      // then the write. Nothing awaits between them.
      if (stopped) throw new AbortedError();
      if (importLock.held) {
        for (const month of due) detail.skipped.push({ month, reason: 'import_in_progress' });
        log.info({ due, trigger }, 'snapshot recorder: an import started; retrying later');
        return finish('partial');
      }
      const again = planAt(now()).plan;
      const months = again.due.map((d) => d.periodMonth);
      const recordedNow = new Set(snapshotMonths().map((s) => s.periodMonth));
      for (const month of due) {
        if (!months.includes(month) && recordedNow.has(month))
          detail.skipped.push({ month, reason: 'already_recorded' });
      }
      if (months.length === 0) {
        if (again.blocked) {
          detail.skipped.push({
            month: again.blocked.periodMonth,
            reason: 'earlier_month_missing',
          });
          return finish('partial');
        }
        return finish('succeeded');
      }
      const source = again.due.some((d) => d.source === 'late') ? 'late' : 'recorded';
      log.info({ months, source, trigger }, 'snapshot recorder: recording');
      const written = write(
        months,
        source,
        trigger,
        null,
        recordDetail(prices.pricesRefreshed, runningJobRunId()),
      );
      detail.recorded = written.map((r) => r.periodMonth);
      const partial = detail.skipped.some((s) => s.reason !== 'already_recorded');
      return finish(partial ? 'partial' : 'succeeded');
    } catch (err) {
      if (err instanceof AbortedError || stopped) {
        for (const month of due) {
          if (!detail.recorded.includes(month)) detail.skipped.push({ month, reason: 'stopped' });
        }
        return finish('failed', 'stopped');
      }
      log.error({ err, due, trigger }, 'snapshot recorder: the record failed');
      return finish('failed', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
      mutex.release();
    }
  }

  // ── The manual attempt ──

  async function manualAttempt(req: {
    periodMonths: readonly IsoMonth[];
    note: string | null;
  }): Promise<RecordedMonth[]> {
    if (stopped) throw stopping();
    if (importLock.held) throw importInProgress();
    await mutex.acquire(SNAPSHOT_LOCK_WAIT_MS);
    running = true;
    try {
      if (stopped) throw stopping();
      if (importLock.held) throw importInProgress();
      let prices: { pricesRefreshed: boolean };
      try {
        prices = await refreshPrices('manual', [controller.signal]);
      } catch (err) {
        if (err instanceof AbortedError) throw stopping();
        throw err;
      }
      // Synchronously from here (§4.6 item 6.3).
      if (stopped) throw stopping();
      if (importLock.held) throw importInProgress();
      const current = isoMonthOf(localIsoDate(now()));
      // The current month is `recorded`; an ended month recorded by hand is `lookback` (§4.5).
      const source = req.periodMonths.every((m) => m === current) ? 'recorded' : 'lookback';
      return write(
        req.periodMonths,
        source,
        'manual',
        req.note,
        recordDetail(prices.pricesRefreshed, null),
      );
    } finally {
      running = false;
      mutex.release();
      replan();
    }
  }

  return {
    start() {
      if (started && !stopped) return;
      if (!registered) {
        scheduler.register({
          name: 'snapshot',
          intervalMs: 0, // manual-only in the scheduler; the recorder's own timer decides when
          run: (ctx) => automaticAttempt(ctx),
        });
        registered = true;
      }
      started = true;
      stopped = false;
      retryAt = null;
      if (controller.signal.aborted) controller = new AbortController();
      try {
        syncSince(effective().enabled);
      } catch (err) {
        log.error({ err }, 'snapshot recorder: could not read the auto-record switch');
      }
      arm(SNAPSHOT_STARTUP_DELAY_MS, 'startup');
    },

    async stop() {
      stopped = true;
      controller.abort();
      clearTimer();
      await Promise.allSettled([...attempts]);
    },

    record(req) {
      return track(manualAttempt(req));
    },

    async withLock<T>(fn: () => T): Promise<T> {
      await mutex.acquire(SNAPSHOT_LOCK_WAIT_MS);
      try {
        return await fn();
      } finally {
        mutex.release();
      }
    },

    settingsChanged() {
      syncSince(effective().enabled);
      retryAt = null;
      replan();
    },

    status(): RecorderStatus {
      const switchState = effective();
      const at = now();
      let blocked: RecorderStatus['blocked'] = null;
      if (switchState.enabled) {
        try {
          blocked = planAt(at).plan.blocked;
        } catch (err) {
          log.warn({ err }, 'snapshot recorder: planning failed for the status');
        }
      }
      return {
        autoRecord: switchState,
        since: readSince(),
        recordHour: SNAPSHOT_RECORD_HOUR,
        nextRunAt: switchState.enabled ? localIsoWithOffset(nextMonthEndRecordTime(at)) : null,
        running,
        lastRun: scheduler.lastRun('snapshot'),
        blocked,
      };
    },
  };
}
