// The NAS copy service (stage-8.md §5.9–§5.11): the weekly `nas-copy` job at Sunday 03:00 local
// (D128) with its own timer on the injectable clock, one start-up catch-up, bounded retries for
// transient failures, the refusal lock, "Copy to NAS now" (202, in the background) and the status
// blocks. Every run is one `nas-copy` scheduler job (intervalMs 0: the service decides when), so
// each writes a `job_runs` row and a click joins a copy in flight. A timer wake never joins: it
// starts nothing while a copy runs and re-plans when that run ends.
//
// The job never throws (a second wrapper around `copyToNas`, which never throws either), so the
// scheduler's own `{ err }` log and its `err.message` → `job_runs.error` path are never reached.
// Log lines carry only words this app wrote, counts, durations, the reason, the exit code and an
// error's code or name: never the address, the password, rsync's output or a path.
import {
  NAS_COPY_CONFIG_REASONS,
  NAS_COPY_FIX_FIRST_MESSAGE,
  NAS_COPY_OFF_MESSAGE,
  NAS_COPY_RETRYABLE_REASONS,
  nasCopyFailureMessage,
  type AppStatus,
  type JobTrigger,
  type NasCopyConfigState,
  type NasCopyJobDetail,
  type NasCopyStatusDto,
} from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { BackupService } from '../backups/service';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { HttpError } from '../errors';
import { systemClock } from '../scheduler/index';
import type { Clock, JobContext, JobResult, Scheduler } from '../scheduler/types';
import {
  NAS_COPY_MAX_ATTEMPTS,
  NAS_COPY_RETRY_DELAYS_MS,
  NAS_COPY_STARTUP_DELAY_MS,
  NAS_COPY_STOP_BUDGET_MS,
  NAS_COPY_TIMEOUT_MS,
  NAS_COPY_WAKE_MAX_MS,
} from './constants';
import { copyToNas, type NasCopyOutcome } from './copy';
import { safeErrorCode } from './errorCode';
import { NasCopyDeadline, type RsyncRunner } from './runner';
import {
  attemptsFor,
  isBlocked,
  isSettled,
  isStale,
  lastSuccess,
  nextSlotAfter,
  planNext,
  readDetail,
  slotAt,
  slotIso,
  type NasPlan,
  type NasRun,
} from './schedule';
import { createSecretsReader, type NasFiles, type SecretsReader } from './secrets';
import {
  buildNasCopyProblem,
  buildNasCopyStatus,
  decideConfiguration,
  type NasConfiguration,
} from './status';

export const NAS_COPY_JOB = 'nas-copy';

export interface NasCopyService {
  /** Registers the job and, when the schedule is on, arms the timer and the start-up catch-up. */
  start(): void;
  /** Stops the timer, aborts a copy in flight and waits for it (at most 4 s). */
  stop(): Promise<void>;
  /** "Copy to NAS now": starts a copy in the background, or joins one. Throws a 409 HttpError. */
  copyNow(): { joined: boolean };
  /** The `nasCopy` block of `GET /api/backups`. Never starts a copy. */
  status(): NasCopyStatusDto;
  /** The `nasCopy` block of `GET /api/status`. */
  problem(): NonNullable<AppStatus['nasCopy']>;
}

export interface NasCopyServiceDeps {
  database: AppDatabase;
  config: Pick<Config, 'dataDir' | 'weeklyNasCopy'>;
  scheduler: Scheduler;
  backups: Pick<BackupService, 'whenIdle'>;
  log: FastifyBaseLogger;
  /** Timers (default `systemClock`). */
  clock?: Clock;
  /** Dates and times (default `clock.now()`). */
  now?: () => Date;
  /** The rsync runner (tests pass a fake; default the real one). */
  runner?: RsyncRunner;
  /** The copy itself (tests only: the job's own never-throws wrapper). */
  copy?: typeof copyToNas;
}

/** The server's zone (the schedule block). */
function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const errorName = safeErrorCode;

function parseDetail(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const mtimesOf = (files: NasFiles): { url: number | null; password: number | null } => ({
  url: files.url.state === 'absent' ? null : files.url.mtimeMs,
  password: files.password.state === 'absent' ? null : files.password.mtimeMs,
});

interface PlanState {
  config: NasConfiguration;
  runs: NasRun[];
  slot: Date;
  blocked: boolean;
  due: boolean;
  plan: NasPlan;
}

export function createNasCopyService(deps: NasCopyServiceDeps): NasCopyService {
  const { database, config, scheduler, backups, log } = deps;
  const db = database.db;
  const clock = deps.clock ?? systemClock;
  const now = deps.now ?? (() => clock.now());
  const copy = deps.copy ?? copyToNas;
  const enabled = config.weeklyNasCopy;
  const secrets: SecretsReader = createSecretsReader({ dataDir: config.dataDir, log });

  let registered = false;
  let started = false;
  let stopping = false;
  let serviceStop = new AbortController();
  let timer: unknown = null;
  let armedAt: Date | null = null;
  let retryAt: Date | null = null;
  let retrySlot: string | null = null;
  let catchUpAt: Date | null = null;
  /**
   * Slot runs that failed without being a real attempt (§5.9 rule d) and settle nothing: the job
   * could not start, or failed before rsync ran. Their retry delay grows 1 h, 2 h, 4 h, 4 h, … so
   * such a failure can never re-run the slot at once, over and over.
   */
  let quietFailures: { slot: string; count: number } = { slot: '', count: 0 };
  /** When start() ran: only a slot before it waits for the catch-up delay. */
  let startedAt: Date | null = null;
  /** The slot and attempt of the run the timer is starting (read by the job synchronously). */
  let pendingTag: { slot: string; attempt: number } | null = null;
  const tracked = new Set<Promise<unknown>>();

  // ── Reads ──

  function readRuns(): NasRun[] {
    return db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, NAS_COPY_JOB))
      .all()
      .map((r) => {
        const t = Date.parse(r.startedAt);
        return {
          id: r.id,
          trigger: r.trigger,
          startedMs: Number.isNaN(t) ? NaN : t,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          status: r.status,
          detail: readDetail(parseDetail(r.detailJson)),
        };
      });
  }

  function planState(at: Date): PlanState {
    const files = secrets.read();
    const cfg = decideConfiguration(files);
    const runs = readRuns();
    const slot = slotAt(at);
    const blocked = cfg.configured === 'ready' && isBlocked(runs, at, mtimesOf(files));
    const due =
      enabled && cfg.configured !== 'off' && !blocked && !isSettled(runs, slot, at, cfg.configured);
    const plan = planNext(at, {
      enabled,
      due,
      retryAt: retryAt !== null && retrySlot === slotIso(slot) ? retryAt : null,
      // The catch-up delay holds back a slot missed while the app was down, not one that comes
      // round after the start (that one runs on time).
      catchUpAt:
        catchUpAt !== null && startedAt !== null && slot.getTime() < startedAt.getTime()
          ? catchUpAt
          : null,
    });
    return { config: cfg, runs, slot, blocked, due, plan };
  }

  // ── The job ──

  function untilIdleOrAborted(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      signal.addEventListener('abort', done, { once: true });
      let idle: Promise<void>;
      try {
        idle = backups.whenIdle();
      } catch {
        idle = Promise.resolve();
      }
      idle.then(done, done);
    });
  }

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const tag = ctx.trigger === 'manual' ? null : pendingTag;
    pendingTag = null;
    const deadline = new AbortController();
    let deadlineTimer: unknown = null;
    /** The configuration at the start of the run (§4.3), for the wrapper's own failure row. */
    let configuredAtStart: NasCopyConfigState | null = null;
    try {
      configuredAtStart = decideConfiguration(secrets.read()).configured;
      deadlineTimer = clock.setTimeout(
        () => deadline.abort(new NasCopyDeadline()),
        NAS_COPY_TIMEOUT_MS,
      );
      const signal = AbortSignal.any([ctx.signal, serviceStop.signal, deadline.signal]);
      await untilIdleOrAborted(signal);
      const outcome: NasCopyOutcome = await copy({
        dataDir: config.dataDir,
        signal,
        runner: deps.runner,
        now,
        log,
        secrets,
      });
      const detail: NasCopyJobDetail = { ...outcome.detail };
      if (tag !== null) {
        detail.slot = tag.slot;
        detail.attempt = tag.attempt;
      }
      const line = {
        trigger: ctx.trigger,
        configured: detail.configured,
        status: outcome.status,
        attempt: detail.attempt,
        localFiles: detail.localFiles,
        alreadyThere: detail.alreadyThere,
        sent: detail.sent,
        missingAfter: detail.missingAfter,
        vanished: detail.vanished,
        onNas: detail.onNas,
        bytes: detail.bytes,
        durationMs: detail.durationMs,
        reason: detail.reason,
        exitCode: detail.exitCode,
      };
      if (outcome.status === 'succeeded') log.info(line, 'nas-copy: copied and proved');
      else log.warn(line, 'nas-copy: failed');
      return {
        status: outcome.status,
        detail: detail as unknown as Record<string, unknown>,
        error: outcome.error,
      };
    } catch (err) {
      // Never `{ err }`: pino's err serializer would print the message, the stack and `cause`.
      log.error({ code: errorName(err) }, 'nas-copy: the job failed unexpectedly');
      const detail: NasCopyJobDetail = {
        configured: configuredAtStart ?? configuredNow(),
        attempted: false,
        localFiles: 0,
        alreadyThere: 0,
        sent: 0,
        missingAfter: null,
        vanished: 0,
        onNas: null,
        bytes: 0,
        durationMs: 0,
        reason: 'other',
      };
      if (tag !== null) {
        detail.slot = tag.slot;
        detail.attempt = tag.attempt;
      }
      return {
        status: 'failed',
        detail: detail as unknown as Record<string, unknown>,
        error: nasCopyFailureMessage('other'),
      };
    } finally {
      if (deadlineTimer !== null) clock.clearTimeout(deadlineTimer);
    }
  }

  /** The configuration now, for a failure row whose start could not be read ('ready' if unreadable). */
  function configuredNow(): NasCopyConfigState {
    try {
      return decideConfiguration(secrets.read()).configured;
    } catch {
      return 'ready';
    }
  }

  function ensureRegistered(): void {
    if (registered) return;
    scheduler.register({ name: NAS_COPY_JOB, intervalMs: 0, run: (ctx) => runJob(ctx) });
    registered = true;
  }

  // ── Timer ──

  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    armedAt = null;
  }

  function arm(at: Date | null): void {
    clearTimer();
    if (!started || stopping || at === null) return;
    const ms = Math.max(0, at.getTime() - now().getTime());
    armedAt = at;
    timer = clock.setTimeout(() => {
      timer = null;
      armedAt = null;
      wake();
    }, ms);
  }

  function replan(): void {
    if (!started || stopping) return;
    try {
      arm(planState(now()).plan.wakeAt);
    } catch (err) {
      log.error({ code: errorName(err) }, 'nas-copy: planning failed');
      arm(new Date(now().getTime() + NAS_COPY_WAKE_MAX_MS));
    }
  }

  function track<T>(p: Promise<T>): Promise<T> {
    tracked.add(p);
    const drop = (): void => {
      tracked.delete(p);
    };
    p.then(drop, drop);
    return p;
  }

  function retryIn(delayMs: number, slot: string): void {
    retryAt = new Date(now().getTime() + delayMs);
    retrySlot = slot;
  }

  /**
   * A slot run that settled nothing and was not a real attempt (the job could not start, or it
   * failed before rsync ran): hold the slot back, 1 h, then 2 h, then 4 h (§5.9's delays), so it
   * is never re-run at once. The attempt number does not move (rule d counts real attempts only).
   */
  function holdBackQuietFailure(slot: string): void {
    const count = quietFailures.slot === slot ? quietFailures.count + 1 : 1;
    quietFailures = { slot, count };
    const delays = NAS_COPY_RETRY_DELAYS_MS;
    retryIn(delays[Math.min(count, delays.length) - 1] ?? NAS_COPY_WAKE_MAX_MS, slot);
  }

  /** After a scheduled or start-up run: the retry, if any (§5.9 "Retries"). */
  function afterSlotRun(result: JobResult, slot: string): void {
    retryAt = null;
    retrySlot = null;
    const d = readDetail(result.detail ?? null);
    const reason = d?.reason;
    const quiet =
      result.status === 'failed' &&
      d?.attempted !== true &&
      // A stop: the process is exiting (the next start's catch-up decides). A configuration
      // failure settles the slot by rule (c) while not ready, no_rsync by rule (b).
      reason !== 'stopped' &&
      reason !== 'no_rsync' &&
      !(reason !== undefined && NAS_COPY_CONFIG_REASONS.includes(reason));
    if (quiet) {
      holdBackQuietFailure(slot);
      return;
    }
    quietFailures = { slot: '', count: 0 };
    const attempt = d?.attempt ?? NAS_COPY_MAX_ATTEMPTS;
    if (
      result.status === 'failed' &&
      d?.attempted === true &&
      reason !== undefined &&
      reason !== 'stopped' &&
      NAS_COPY_RETRYABLE_REASONS.includes(reason) &&
      attempt < NAS_COPY_MAX_ATTEMPTS
    ) {
      retryIn(NAS_COPY_RETRY_DELAYS_MS[attempt - 1] ?? NAS_COPY_WAKE_MAX_MS, slot);
    }
  }

  function wake(): void {
    if (!started || stopping) return;
    // A wake never joins a copy in flight (a click): that run re-plans when it ends.
    if (scheduler.isRunning(NAS_COPY_JOB)) return;
    let at: Date;
    let state: PlanState;
    let trigger: JobTrigger = 'schedule';
    try {
      at = now();
      if (catchUpAt !== null && at.getTime() >= catchUpAt.getTime()) {
        catchUpAt = null;
        if (startedAt !== null && slotAt(at).getTime() < startedAt.getTime()) trigger = 'startup';
      }
      state = planState(at);
    } catch (err) {
      log.error({ code: errorName(err) }, 'nas-copy: planning failed');
      arm(new Date(now().getTime() + NAS_COPY_WAKE_MAX_MS));
      return;
    }
    if (!state.plan.runNow) {
      arm(state.plan.wakeAt);
      return;
    }
    const slot = slotIso(state.slot);
    pendingTag = { slot, attempt: attemptsFor(state.runs, state.slot) + 1 };
    let run: Promise<unknown>;
    try {
      run = scheduler.run(NAS_COPY_JOB, trigger).then(
        ({ result }) => afterSlotRun(result, slot),
        (err: unknown) => {
          if (stopping) return;
          log.error({ code: errorName(err) }, 'nas-copy: the job could not run');
          // No row may exist (the insert itself failed): hold the slot back all the same.
          holdBackQuietFailure(slot);
        },
      );
    } finally {
      pendingTag = null;
    }
    void track(run).finally(() => replan());
  }

  // ── The API ──

  function copyNow(): { joined: boolean } {
    ensureRegistered();
    const at = now();
    const files = secrets.read();
    const cfg = decideConfiguration(files);
    if (cfg.configured !== 'ready') {
      const message =
        cfg.configured === 'off' || cfg.configReason === null
          ? NAS_COPY_OFF_MESSAGE
          : nasCopyFailureMessage(cfg.configReason);
      throw new HttpError(409, message, 'NAS_COPY_NOT_READY');
    }
    if (scheduler.isRunning(NAS_COPY_JOB)) return { joined: true };
    if (isBlocked(readRuns(), at, mtimesOf(files))) {
      throw new HttpError(409, NAS_COPY_FIX_FIRST_MESSAGE, 'NAS_COPY_FIX_FIRST');
    }
    const run = scheduler.run(NAS_COPY_JOB, 'manual').then(
      () => replan(),
      () => replan(),
    );
    void track(run);
    return { joined: false };
  }

  function statusParts(): {
    state: PlanState;
    at: Date;
    running: boolean;
    stale: boolean;
    lastSuccessAt: string | null;
  } {
    const at = now();
    const state = planState(at);
    const running = scheduler.isRunning(NAS_COPY_JOB);
    const stale = isStale({
      runs: state.runs,
      now: at,
      enabled,
      configured: state.config.configured,
    });
    const success = lastSuccess(state.runs);
    return { state, at, running, stale, lastSuccessAt: success?.finishedAt ?? null };
  }

  return {
    start() {
      if (started && !stopping) return;
      ensureRegistered();
      started = true;
      stopping = false;
      if (serviceStop.signal.aborted) serviceStop = new AbortController();
      retryAt = null;
      quietFailures = { slot: '', count: 0 };
      retrySlot = null;
      if (!enabled) {
        catchUpAt = null;
        clearTimer();
        return;
      }
      startedAt = now();
      catchUpAt = new Date(startedAt.getTime() + NAS_COPY_STARTUP_DELAY_MS);
      replan();
    },

    async stop() {
      stopping = true;
      clearTimer();
      serviceStop.abort();
      if (tracked.size === 0) return;
      let budgetTimer: unknown = null;
      const outcome = await Promise.race([
        Promise.allSettled([...tracked]).then(() => 'done' as const),
        new Promise<'budget'>((resolve) => {
          budgetTimer = clock.setTimeout(() => resolve('budget'), NAS_COPY_STOP_BUDGET_MS);
        }),
      ]);
      if (budgetTimer !== null) clock.clearTimeout(budgetTimer);
      if (outcome === 'budget') {
        log.warn(
          { budgetMs: NAS_COPY_STOP_BUDGET_MS },
          'nas-copy: the copy did not stop within its budget',
        );
      }
    },

    copyNow,

    status() {
      const { state, at, running, stale, lastSuccessAt } = statusParts();
      let nextRunAt: Date | null = null;
      if (enabled && state.config.configured === 'ready' && !state.blocked) {
        if (running) {
          // While a copy runs its slot counts as settled: "Next" is the run after it.
          nextRunAt = nextSlotAfter(at);
        } else {
          nextRunAt = state.plan.nextRunAt;
          if (state.due && nextRunAt !== null && armedAt !== null && armedAt > nextRunAt) {
            nextRunAt = armedAt;
          }
        }
      }
      return buildNasCopyStatus({
        config: state.config,
        enabled,
        timeZone: serverTimeZone(),
        blocked: state.blocked,
        running,
        nextRunAt,
        lastRun: scheduler.lastRun(NAS_COPY_JOB),
        lastSuccessAt,
        stale,
      });
    },

    problem() {
      const { state, stale, lastSuccessAt } = statusParts();
      return buildNasCopyProblem({
        config: state.config,
        blocked: state.blocked,
        stale,
        lastSuccessAt,
      });
    },
  };
}
