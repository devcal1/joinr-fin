// The market data service (stage-1.md §5): registers the `prices` job on the scheduler (mode
// live/fake), runs refreshes through it (so runs never overlap and every run is logged), and
// serves prices, series, manual overrides and source edits. `createMarketDataService` (index.ts)
// is the frozen entry point; this module adds test-only knobs (deadline, spacing, delays).
import {
  derivePriceSource,
  type JobTrigger,
  type ManualPriceInput,
  type MarketDataMode,
  type PriceItem,
  type PriceSourceInput,
  type RefreshSummary,
} from '@joinr/schema';
import { instruments, jobRuns, prices, priceSources, type JoinrDb } from '@joinr/schema/db';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../errors';
import { SchedulerStoppedError, systemClock } from '../scheduler/index';
import type { JobContext, JobResult, Scheduler } from '../scheduler/types';
import { listPriceItems, listSeries, priceItemFor } from './items';
import { createCoinGeckoProvider } from './providers/coingecko';
import { createFakeProvider } from './providers/fake';
import { clockSleep } from './providers/http';
import { createYahooProvider } from './providers/yahoo';
import {
  Cooldowns,
  RUN_DEADLINE_MS,
  runRefresh,
  type Providers,
  type RefreshOptions,
  type RefreshOutcome,
} from './refresh';
import { MarketDataDisabledError, type Clock, type MarketDataService } from './types';

export const PRICES_JOB = 'prices' as const;
/** First scheduled refresh after start(). */
export const PRICES_INITIAL_DELAY_MS = 15_000;
/** notifyInstrumentsChanged() refreshes this long after the last call (coalesced). */
export const NOTIFY_DELAY_MS = 5_000;

export interface MarketDataServiceOptions {
  db: JoinrDb;
  config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'>;
  log: FastifyBaseLogger;
  scheduler: Scheduler;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  /** Test knobs. */
  runDeadlineMs?: number;
  yahooSpacingMs?: number;
  searchSpacingMs?: number;
  requestTimeoutMs?: number;
  notifyDelayMs?: number;
  providers?: Providers;
}

function buildProviders(
  mode: MarketDataMode,
  o: MarketDataServiceOptions,
  clock: Clock,
): Providers {
  const now = () => clock.now();
  if (mode === 'fake') {
    const fake = createFakeProvider({ now });
    return { yahoo: fake, coingecko: fake };
  }
  // Resolved at call time, so a test's global fetch guard (or a later polyfill) applies.
  const fetchImpl: typeof fetch = o.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return {
    yahoo: createYahooProvider({
      fetchImpl,
      sleep: clockSleep(clock),
      now,
      spacingMs: o.yahooSpacingMs,
      timeoutMs: o.requestTimeoutMs,
    }),
    coingecko: createCoinGeckoProvider({ fetchImpl, now, timeoutMs: o.requestTimeoutMs }),
  };
}

function jobStatus(outcome: RefreshOutcome): JobResult['status'] {
  const failed = outcome.failed + outcome.series.failed;
  const ok = outcome.ok + outcome.series.ok;
  const incomplete = failed > 0 || (outcome.aborted && outcome.skipped > 0);
  if (!incomplete) return 'succeeded';
  return ok > 0 ? 'partial' : 'failed';
}

function numberField(detail: Record<string, unknown> | undefined, key: string): number {
  const v = detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function createService(o: MarketDataServiceOptions): MarketDataService {
  const { db, log, scheduler } = o;
  const mode = o.config.marketDataMode;
  const clock = o.clock ?? systemClock;
  const deadlineMs = o.runDeadlineMs ?? RUN_DEADLINE_MS;
  const notifyDelayMs = o.notifyDelayMs ?? NOTIFY_DELAY_MS;
  const cooldowns = new Cooldowns();
  const providers = mode === 'off' ? null : (o.providers ?? buildProviders(mode, o, clock));
  const sleep = clockSleep(clock);

  /** Options for the next run; consumed synchronously when the job starts. */
  let nextRunOptions: RefreshOptions | null = null;
  let notifyHandle: unknown = null;

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const options = nextRunOptions ?? {};
    nextRunOptions = null;
    if (!providers) return { status: 'failed', error: 'Market data is switched off' };

    const deadline = new AbortController();
    const deadlineHandle = clock.setTimeout(() => deadline.abort(), deadlineMs);
    const signal = AbortSignal.any([ctx.signal, deadline.signal]);
    const started = clock.now().getTime();
    try {
      const outcome = await runRefresh(
        {
          db,
          providers,
          cooldowns,
          now: () => clock.now(),
          sleep,
          signal,
          log,
          searchSpacingMs: o.searchSpacingMs,
        },
        options,
      );
      const durationMs = Math.max(0, clock.now().getTime() - started);
      const status = jobStatus(outcome);
      log.info(
        {
          job: PRICES_JOB,
          trigger: ctx.trigger,
          status,
          requested: outcome.requested,
          ok: outcome.ok,
          failed: outcome.failed,
          skipped: outcome.skipped,
          durationMs,
        },
        'price refresh finished',
      );
      const result: JobResult = {
        status,
        detail: {
          requested: outcome.requested,
          ok: outcome.ok,
          failed: outcome.failed,
          skipped: outcome.skipped,
          byProvider: outcome.byProvider,
          series: outcome.series,
          searches: outcome.searches,
          deadlineHit: deadline.signal.aborted,
          durationMs,
        },
      };
      if (deadline.signal.aborted) result.error = 'Run deadline reached';
      else if (ctx.signal.aborted) result.error = 'Run aborted';
      return result;
    } finally {
      clock.clearTimeout(deadlineHandle);
    }
  }

  if (mode !== 'off') {
    scheduler.register({
      name: PRICES_JOB,
      intervalMs: Math.max(0, o.config.priceRefreshMinutes) * 60_000,
      initialDelayMs: PRICES_INITIAL_DELAY_MS,
      run: runJob,
    });
  }

  async function refresh(
    opts: { instrumentIds?: number[]; force?: boolean; trigger?: JobTrigger } = {},
  ): Promise<RefreshSummary> {
    if (mode === 'off') throw new MarketDataDisabledError();
    if (!scheduler.isRunning(PRICES_JOB)) {
      const next: RefreshOptions = {};
      if (opts.instrumentIds) next.instrumentIds = opts.instrumentIds;
      if (opts.force) next.force = true;
      nextRunOptions = next;
    }
    try {
      const { jobRunId, result } = await scheduler.run(PRICES_JOB, opts.trigger ?? 'manual');
      return {
        jobRunId,
        requested: numberField(result.detail, 'requested'),
        ok: numberField(result.detail, 'ok'),
        failed: numberField(result.detail, 'failed'),
        skipped: numberField(result.detail, 'skipped'),
        durationMs: numberField(result.detail, 'durationMs'),
      };
    } finally {
      nextRunOptions = null;
    }
  }

  function requireInstrument(instrumentId: number) {
    const instrument = db.select().from(instruments).where(eq(instruments.id, instrumentId)).get();
    if (!instrument) throw new HttpError(404, `No instrument ${instrumentId}`, 'NOT_FOUND');
    return instrument;
  }

  function itemOrThrow(instrumentId: number): PriceItem {
    const item = priceItemFor(db, instrumentId, clock.now());
    if (!item) throw new HttpError(404, `No instrument ${instrumentId}`, 'NOT_FOUND');
    return item;
  }

  /** Updates the instrument's `price_sources` row, creating it from the derived default. */
  function upsertSource(
    instrumentId: number,
    patch: Partial<typeof priceSources.$inferInsert>,
  ): void {
    // Read-then-write: IMMEDIATE so a concurrent writer (a CLI import) is waited for via
    // busy_timeout instead of failing at once with SQLITE_BUSY.
    db.transaction(
      (tx) => {
        const instrument = tx
          .select()
          .from(instruments)
          .where(eq(instruments.id, instrumentId))
          .get();
        if (!instrument) throw new HttpError(404, `No instrument ${instrumentId}`, 'NOT_FOUND');
        const updatedAt = clock.now().toISOString();
        const existing = tx
          .select({ id: priceSources.instrumentId })
          .from(priceSources)
          .where(eq(priceSources.instrumentId, instrumentId))
          .get();
        if (existing) {
          tx.update(priceSources)
            .set({ ...patch, updatedAt })
            .where(eq(priceSources.instrumentId, instrumentId))
            .run();
        } else {
          tx.insert(priceSources)
            .values({
              instrumentId,
              ...derivePriceSource(instrument),
              symbolOrigin: 'derived',
              ...patch,
              updatedAt,
            })
            .run();
        }
      },
      { behavior: 'immediate' },
    );
  }

  function lastRefreshAt(): string | null {
    const row = db
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.job, PRICES_JOB),
          inArray(jobRuns.status, ['succeeded', 'partial']),
          isNotNull(jobRuns.finishedAt),
        ),
      )
      .orderBy(desc(jobRuns.finishedAt), desc(jobRuns.id))
      .limit(1)
      .get();
    return row?.finishedAt ?? null;
  }

  function nextRefreshAt(): string | null {
    if (mode === 'off') return null;
    return scheduler.nextRunAt(PRICES_JOB)?.toISOString() ?? null;
  }

  return {
    refresh,

    getPrices() {
      const now = clock.now();
      return {
        mode,
        refreshIntervalMinutes: mode === 'off' ? 0 : o.config.priceRefreshMinutes,
        running: mode !== 'off' && scheduler.isRunning(PRICES_JOB),
        lastRun: scheduler.lastRun(PRICES_JOB),
        nextRefreshAt: nextRefreshAt(),
        items: listPriceItems(db, now),
        series: listSeries(db, now),
      };
    },

    getSeries() {
      return listSeries(db, clock.now());
    },

    setManualPrice(instrumentId, input: ManualPriceInput) {
      requireInstrument(instrumentId);
      const note = input.note?.trim();
      upsertSource(instrumentId, {
        manualPrice: input.price,
        manualPriceAsOf: input.asOf,
        manualOrigin: 'user',
        manualNote: note ? note : null,
      });
      return itemOrThrow(instrumentId);
    },

    clearManualPrice(instrumentId) {
      requireInstrument(instrumentId);
      upsertSource(instrumentId, {
        manualPrice: null,
        manualPriceAsOf: null,
        manualOrigin: null,
        manualNote: null,
      });
      return itemOrThrow(instrumentId);
    },

    setPriceSource(instrumentId, input: PriceSourceInput) {
      requireInstrument(instrumentId);
      upsertSource(instrumentId, {
        provider: input.provider,
        providerSymbol: input.provider === 'none' ? null : input.providerSymbol,
        symbolOrigin: 'user',
      });
      // A new source gets a fresh start: clear the backoff (the last good price is kept).
      db.update(prices)
        .set({ consecutiveFailures: 0 })
        .where(eq(prices.instrumentId, instrumentId))
        .run();
      return itemOrThrow(instrumentId);
    },

    notifyInstrumentsChanged() {
      if (mode === 'off' || notifyHandle !== null) return;
      notifyHandle = clock.setTimeout(() => {
        notifyHandle = null;
        void (async () => {
          try {
            // A run already in flight may predate the change: let it finish, then run again.
            if (scheduler.isRunning(PRICES_JOB)) await scheduler.run(PRICES_JOB, 'import');
            await refresh({ trigger: 'import' });
          } catch (err) {
            // After shutdown the scheduler refuses new runs; nothing to report.
            if (!(err instanceof SchedulerStoppedError))
              log.warn({ err }, 'price refresh after an instrument change failed');
          }
        })();
      }, notifyDelayMs);
    },

    status() {
      return {
        mode,
        running: mode !== 'off' && scheduler.isRunning(PRICES_JOB),
        lastRefreshAt: lastRefreshAt(),
        nextRefreshAt: nextRefreshAt(),
      };
    },
  };
}
