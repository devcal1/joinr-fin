// The dividend-events market data (stage-3.md §4.6, D50): Yahoo chart events (ex-date + per-unit
// amount) and the close before each ex-date, cached in `dividend_events` by a daily `dividends`
// job. The interface, the options type and the two factory signatures are FROZEN.
//
// The job is registered in modes `live` and `fake` (interval 24 h, or 0 = manual only when
// PRICE_REFRESH_MINUTES is 0; first scheduled run 60 s after start()). A run first waits while the
// `prices` job runs, shares the price job's Yahoo cool-down and its run deadline, and writes in one
// transaction (run.ts). Mode `off` registers nothing and refresh() throws.
import type {
  DividendEventsRefreshSummary,
  DividendEventsStatusDto,
  JobName,
  JobTrigger,
} from '@joinr/schema';
import { jobRuns, type JoinrDb } from '@joinr/schema/db';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { systemClock } from '../../scheduler/index';
import type { JobContext, JobResult, Scheduler } from '../../scheduler/types';
import { clockSleep } from '../providers/http';
import { Cooldowns, RUN_DEADLINE_MS } from '../refresh';
import { PRICES_JOB } from '../service';
import { MarketDataDisabledError, type Clock } from '../types';
import { createFakeEventsClient, createYahooEventsClient } from './client';
import { runDividendEvents, type EventsRunOutcome } from './run';

export { parseYahooDividends } from './parse';
export type { ParsedDividendEvent, YahooDividendsParse } from './parse';

export interface DividendEventsService {
  /** Off → MarketDataDisabledError. Joins a run in flight; works whatever the refresh interval. */
  refresh(opts?: {
    instrumentIds?: number[];
    trigger?: JobTrigger;
  }): Promise<DividendEventsRefreshSummary>;
  status(): Omit<DividendEventsStatusDto, 'eventCount' | 'instrumentsCovered' | 'lastError'>;
}

/** Mirrors MarketDataServiceOptions (market/service.ts). */
export interface DividendEventsServiceOptions {
  db: JoinrDb;
  config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'>;
  log: FastifyBaseLogger;
  scheduler: Scheduler;
  /** The price service's instance, so both jobs share the Yahoo cool-down (§4.6). */
  cooldowns?: Cooldowns;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  /** Test knobs. */
  runDeadlineMs?: number;
  yahooSpacingMs?: number;
  requestTimeoutMs?: number;
}

export const DIVIDENDS_JOB = 'dividends' as const satisfies JobName;
/** First scheduled run after start(). */
export const DIVIDENDS_INITIAL_DELAY_MS = 60_000;
/** The daily timer (only when PRICE_REFRESH_MINUTES > 0). */
export const DIVIDENDS_INTERVAL_MS = 24 * 60 * 60_000;
/** How often a run checks whether the `prices` job has finished. */
export const PRICES_WAIT_POLL_MS = 1_000;

function numberField(detail: Record<string, unknown> | undefined, key: string): number {
  const v = detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * `succeeded` when every target was fetched (instruments that vanished mid-run do not count);
 * `failed` when every attempted target failed and nothing was interrupted; otherwise `partial`
 * (some failed, or a rate limit, the cool-down, the deadline or shutdown skipped targets).
 */
function jobStatus(outcome: EventsRunOutcome): JobResult['status'] {
  if (outcome.failed === 0 && outcome.interrupted === 0) return 'succeeded';
  if (outcome.ok === 0 && outcome.interrupted === 0) return 'failed';
  return 'partial';
}

/** The run's error text for `job_runs` (short, never a URL or body); undefined when clean. */
function jobError(
  outcome: EventsRunOutcome,
  why: { deadlineHit: boolean; shutdown: boolean },
): string | undefined {
  if (outcome.interrupted > 0) {
    if (why.deadlineHit) return 'Run deadline reached';
    if (why.shutdown) return 'Run aborted';
    if (outcome.rateLimited) return 'Rate limited by Yahoo; the remaining holdings were skipped';
    if (outcome.cooling) return 'Yahoo is cooling down after a rate limit; holdings were skipped';
    return 'Run interrupted';
  }
  if (outcome.failed > 0) {
    const n = outcome.failed;
    return `${n} of ${outcome.requested} holding${outcome.requested === 1 ? '' : 's'} failed: ${outcome.firstError ?? 'unknown error'}`;
  }
  return undefined;
}

/** The service in the config's market data mode (`off` → the off service). */
export function createDividendEventsService(
  o: DividendEventsServiceOptions,
): DividendEventsService {
  const mode = o.config.marketDataMode;
  if (mode === 'off') return createOffDividendEventsService();

  const { db, log, scheduler } = o;
  const clock = o.clock ?? systemClock;
  const cooldowns = o.cooldowns ?? new Cooldowns();
  const deadlineMs = o.runDeadlineMs ?? RUN_DEADLINE_MS;
  const sleep = clockSleep(clock);
  const now = () => clock.now();
  const client =
    mode === 'fake'
      ? createFakeEventsClient({ now })
      : createYahooEventsClient({
          // Resolved at call time, so a test's global fetch guard applies.
          fetchImpl: o.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
          now,
          spacingMs: o.yahooSpacingMs,
          timeoutMs: o.requestTimeoutMs,
        });

  /** Options for the next run; consumed synchronously when the job starts. */
  let nextRunOptions: { instrumentIds?: number[] } | null = null;

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const options = nextRunOptions ?? {};
    nextRunOptions = null;

    const deadline = new AbortController();
    const deadlineHandle = clock.setTimeout(() => deadline.abort(), deadlineMs);
    const signal = AbortSignal.any([ctx.signal, deadline.signal]);
    const started = clock.now().getTime();
    try {
      // Share Yahoo politely: wait (bounded by the deadline) while the price job runs.
      let waitedForPrices = false;
      while (scheduler.isRunning(PRICES_JOB) && !signal.aborted) {
        waitedForPrices = true;
        await sleep(PRICES_WAIT_POLL_MS, signal);
      }

      const outcome = await runDividendEvents(
        { db, client, cooldowns, now, sleep, signal },
        options,
      );
      const durationMs = Math.max(0, clock.now().getTime() - started);
      const status = jobStatus(outcome);
      const deadlineHit = deadline.signal.aborted;
      const error = jobError(outcome, { deadlineHit, shutdown: ctx.signal.aborted });
      log.info(
        {
          job: DIVIDENDS_JOB,
          trigger: ctx.trigger,
          status,
          requested: outcome.requested,
          ok: outcome.ok,
          failed: outcome.failed,
          skipped: outcome.skipped,
          events: outcome.events,
          durationMs,
        },
        'dividend events refresh finished',
      );
      const result: JobResult = {
        status,
        detail: {
          requested: outcome.requested,
          ok: outcome.ok,
          failed: outcome.failed,
          skipped: outcome.skipped,
          events: outcome.events,
          source: client.source,
          rateLimited: outcome.rateLimited,
          cooling: outcome.cooling,
          waitedForPrices,
          deadlineHit,
          durationMs,
        },
      };
      if (error !== undefined) result.error = error;
      return result;
    } finally {
      clock.clearTimeout(deadlineHandle);
    }
  }

  scheduler.register({
    name: DIVIDENDS_JOB,
    // As the price job: an interval of 0 schedules no timer, but manual runs still work.
    intervalMs: o.config.priceRefreshMinutes > 0 ? DIVIDENDS_INTERVAL_MS : 0,
    initialDelayMs: DIVIDENDS_INITIAL_DELAY_MS,
    run: runJob,
  });

  async function refresh(
    opts: { instrumentIds?: number[]; trigger?: JobTrigger } = {},
  ): Promise<DividendEventsRefreshSummary> {
    if (!scheduler.isRunning(DIVIDENDS_JOB)) {
      nextRunOptions = opts.instrumentIds ? { instrumentIds: [...opts.instrumentIds] } : {};
    }
    try {
      const { jobRunId, result } = await scheduler.run(DIVIDENDS_JOB, opts.trigger ?? 'manual');
      return {
        jobRunId,
        requested: numberField(result.detail, 'requested'),
        ok: numberField(result.detail, 'ok'),
        failed: numberField(result.detail, 'failed'),
        skipped: numberField(result.detail, 'skipped'),
        events: numberField(result.detail, 'events'),
        durationMs: numberField(result.detail, 'durationMs'),
      };
    } finally {
      nextRunOptions = null;
    }
  }

  function lastRefreshAt(): string | null {
    const row = db
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.job, DIVIDENDS_JOB),
          inArray(jobRuns.status, ['succeeded', 'partial']),
          isNotNull(jobRuns.finishedAt),
        ),
      )
      .orderBy(desc(jobRuns.finishedAt), desc(jobRuns.id))
      .limit(1)
      .get();
    return row?.finishedAt ?? null;
  }

  return {
    refresh,
    status: () => ({
      mode,
      running: scheduler.isRunning(DIVIDENDS_JOB),
      lastRefreshAt: lastRefreshAt(),
      nextRefreshAt: scheduler.nextRunAt(DIVIDENDS_JOB)?.toISOString() ?? null,
    }),
  };
}

/** Market data off: refresh() throws MarketDataDisabledError; nothing is registered or fetched. */
export function createOffDividendEventsService(): DividendEventsService {
  return {
    refresh: () => Promise.reject(new MarketDataDisabledError()),
    status: () => ({ mode: 'off', running: false, lastRefreshAt: null, nextRefreshAt: null }),
  };
}
