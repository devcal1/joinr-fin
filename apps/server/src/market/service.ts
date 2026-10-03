// The market data service (stage-1.md §5): registers the `prices` job on the scheduler (mode
// live/fake), runs refreshes through it (so runs never overlap and every run is logged), and
// serves prices, series, manual overrides and source edits. `createMarketDataService` (index.ts)
// is the frozen entry point; this module adds test-only knobs (deadline, spacing, delays).
// Stage 9 (stage-9.md §5.6): it also registers the `intraday` job (intraday/service.ts) and arms its
// timer when INTRADAY_REFRESH is on; `stop()` clears that timer; the `prices` job waits for an
// in-flight intraday run before it selects its targets.
import {
  derivePriceSource,
  INTRADAY_RUN_DEADLINE_MS,
  type JobTrigger,
  type ManualPriceInput,
  type MarketDataMode,
  type PriceItem,
  type PriceSourceInput,
  type RefreshSummary,
} from '@joinr/schema';
import {
  dayQuotes,
  instruments,
  jobRuns,
  prices,
  priceSources,
  type JoinrDb,
} from '@joinr/schema/db';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../errors';
import { SchedulerStoppedError, systemClock } from '../scheduler/index';
import type { JobContext, JobResult, Scheduler } from '../scheduler/types';
import { serverTimeZone } from './day';
import { createIntraday, type IntradayService } from './intraday/service';
import { listPriceItems, listSeries, priceItemFor } from './items';
import { createCoinGeckoProvider } from './providers/coingecko';
import { createFakeFxClosesClient, createFakeProvider } from './providers/fake';
import { clockSleep } from './providers/http';
import { createYahooFxClosesClient, createYahooProvider } from './providers/yahoo';
import {
  Cooldowns,
  RUN_DEADLINE_MS,
  runRefresh,
  type Providers,
  type RefreshOptions,
  type RefreshOutcome,
} from './refresh';
import { MarketDataDisabledError, type Clock, type MarketDataService } from './types';

type Tx = Parameters<Parameters<JoinrDb['transaction']>[0]>[0];
/** An instrument's effective price source (the stored row, else the derived default). */
type SourcePair = { provider: PriceSourceInput['provider']; providerSymbol: string | null };

export const PRICES_JOB = 'prices' as const;
/** First scheduled refresh after start(). */
export const PRICES_INITIAL_DELAY_MS = 15_000;
/** notifyInstrumentsChanged() refreshes this long after the last call (coalesced). */
export const NOTIFY_DELAY_MS = 5_000;

export interface MarketDataServiceOptions {
  db: JoinrDb;
  /** Stage 9: `intradayRefresh` arms the intraday timer (absent → off, as under NODE_ENV=test). */
  config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'> &
    Partial<Pick<Config, 'intradayRefresh'>>;
  log: FastifyBaseLogger;
  scheduler: Scheduler;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  /** Stage 9: the server's IANA zone (default: Intl's resolved zone). */
  timeZone?: string;
  /**
   * Stage 3 (stage-3.md §4.6): provider cool-downs shared with the dividend-events service, so a
   * 429/403 seen by either job pauses Yahoo for both. Omitted → a private instance (as before).
   */
  cooldowns?: Cooldowns;
  /** Test knobs. */
  runDeadlineMs?: number;
  yahooSpacingMs?: number;
  searchSpacingMs?: number;
  requestTimeoutMs?: number;
  notifyDelayMs?: number;
  providers?: Providers;
  intradayDeadlineMs?: number;
  coinChartSpacingMs?: number;
  intradayStartupDelayMs?: number;
}

function buildProviders(
  mode: MarketDataMode,
  o: MarketDataServiceOptions,
  clock: Clock,
): Providers {
  const now = () => clock.now();
  if (mode === 'fake') {
    const fake = createFakeProvider({ now });
    // Stage 4 (stage-4.md §4.6): the fake FX closes for the purchase-date backfill.
    return { yahoo: fake, coingecko: fake, fxCloses: createFakeFxClosesClient({ now }) };
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
    // Stage 4: Yahoo's daily FX closes, with the provider's spacing, timeout and User-Agent.
    fxCloses: createYahooFxClosesClient({
      fetchImpl,
      sleep: clockSleep(clock),
      now,
      spacingMs: o.yahooSpacingMs,
      timeoutMs: o.requestTimeoutMs,
    }),
  };
}

/**
 * Stage 1 rules; Stage 4 counts the FX backfill beside the instruments and series: a backfill
 * failure alone makes the run `partial`, a filled rate counts as a success, and a deadline that
 * left backfill assets unattempted makes the run incomplete.
 */
function jobStatus(outcome: RefreshOutcome): JobResult['status'] {
  const fx = outcome.fxBackfill;
  const failed = outcome.failed + outcome.series.failed + fx.failed;
  const ok = outcome.ok + outcome.series.ok + fx.filled;
  const incomplete = failed > 0 || (outcome.aborted && outcome.skipped + fx.skipped > 0);
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
  const cooldowns = o.cooldowns ?? new Cooldowns();
  const providers = mode === 'off' ? null : (o.providers ?? buildProviders(mode, o, clock));
  const sleep = clockSleep(clock);
  const timeZone = o.timeZone ?? serverTimeZone();

  /** Stage 9: the intraday job (modes live and fake; its timer only with INTRADAY_REFRESH). */
  const intraday: IntradayService | null = providers
    ? createIntraday({
        db,
        scheduler,
        providers,
        cooldowns,
        clock,
        sleep,
        log,
        timeZone,
        timerEnabled: o.config.intradayRefresh === true,
        isPricesRunning: () => scheduler.isRunning(PRICES_JOB),
        runDeadlineMs: o.intradayDeadlineMs,
        coinChartSpacingMs: o.coinChartSpacingMs,
        startupDelayMs: o.intradayStartupDelayMs,
      })
    : null;

  /** Waits (bounded) for an intraday run in flight, so two runs never fetch the same ids. */
  async function awaitIntraday(signal: AbortSignal): Promise<void> {
    const flight = intraday?.inFlight();
    if (!flight) return;
    const wait = new AbortController();
    const both = AbortSignal.any([signal, wait.signal]);
    try {
      await Promise.race([flight, sleep(INTRADAY_RUN_DEADLINE_MS, both)]);
    } finally {
      wait.abort();
    }
  }

  /** Options for the next run; consumed synchronously when the job starts. */
  let nextRunOptions: RefreshOptions | null = null;
  let notifyHandle: unknown = null;

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const options = nextRunOptions ?? {};
    nextRunOptions = null;
    if (!providers) return { status: 'failed', error: 'Market data is switched off' };
    await awaitIntraday(ctx.signal);

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
          timeZone,
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
          fxBackfill: outcome.fxBackfill,
          dayRows: outcome.dayRows,
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

  /**
   * Updates the instrument's `price_sources` row, creating it from the derived default. `after`
   * runs in the same transaction with the effective (provider, providerSymbol) from before the
   * write (the stored row's, else the derived default).
   */
  function upsertSource(
    instrumentId: number,
    patch: Partial<typeof priceSources.$inferInsert>,
    after?: (tx: Tx, before: SourcePair) => void,
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
          .select({ provider: priceSources.provider, providerSymbol: priceSources.providerSymbol })
          .from(priceSources)
          .where(eq(priceSources.instrumentId, instrumentId))
          .get();
        const before: SourcePair = existing ?? derivePriceSource(instrument);
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
        after?.(tx, before);
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
      const next: SourcePair = {
        provider: input.provider,
        providerSymbol: input.provider === 'none' ? null : input.providerSymbol,
      };
      upsertSource(instrumentId, { ...next, symbolOrigin: 'user' }, (tx, before) => {
        // A new source gets a fresh start: clear the backoff (the last good price is kept).
        tx.update(prices)
          .set({ consecutiveFailures: 0 })
          .where(eq(prices.instrumentId, instrumentId))
          .run();
        if (before.provider === next.provider && before.providerSymbol === next.providerSymbol)
          return;
        // A real change (another symbol, provider or none): the kept price belongs to the old
        // source, so its as-of is cleared (status stale until the next fetch, which the
        // never-backwards write then always accepts), and the old source's day row is dropped
        // so it never merges with the new one's (Stage 9, §5.4).
        tx.update(prices).set({ asOf: null }).where(eq(prices.instrumentId, instrumentId)).run();
        tx.delete(dayQuotes).where(eq(dayQuotes.instrumentId, instrumentId)).run();
      });
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

    stop() {
      // Stage 9 (stage-9.md §5.6): clears the intraday timer; idempotent.
      intraday?.stop();
    },
  };
}
