// The `intraday` job (stage-9.md §5.6, D144, D153): every 5 minutes on weekdays from 10:00 to 16:25
// the ASX-listed holdings, every 15 minutes the crypto holdings (then their day charts) and, from
// Monday 06:00 to Saturday 10:00 while a bullion row is held, the bullion inputs, each as a lite
// refresh (refresh.ts). Registered on the scheduler with no interval: its own timer sleeps to the
// next slot and calls `scheduler.run('intraday', 'schedule')`. A slot that finds a run in flight is
// skipped; a slot with nothing to do starts no run; the ASX and bullion scopes are skipped while
// the hourly `prices` job runs (both use Yahoo), which in turn waits for an in-flight run.
import {
  COIN_CHART_SPACING_MS,
  INTRADAY_RUN_DEADLINE_MS,
  INTRADAY_STARTUP_DELAY_MS,
  JoinrDecimal,
  type Metal,
  type MarketSeriesId,
  BULLION_HOLDINGS,
} from '@joinr/schema';
import { instruments, otherAssets, otherAssetSales, type JoinrDb } from '@joinr/schema/db';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { heldUnitsByInstrument, isHeld } from '../../db/queries/holdings';
import { SchedulerStoppedError } from '../../scheduler/index';
import type { Clock, JobContext, JobResult, Scheduler } from '../../scheduler/types';
import { cryptoDayFrom } from '../day';
import { writeInstrumentDays, type InstrumentDayWrite } from '../dayWrites';
import { effectiveSource, loadInstrumentPriceRows } from '../items';
import {
  runRefresh,
  type Cooldowns,
  type Counts,
  type Providers,
  type RefreshContext,
  type RefreshOutcome,
} from '../refresh';
import type { Sleep } from '../providers/types';
import {
  isSlotLate,
  manualScopes,
  nextSlot,
  scopesForSlot,
  startupScopes,
  wakeDelay,
  type IntradayScopes,
} from './schedule';

export const INTRADAY_JOB = 'intraday' as const;

export interface IntradayDetail {
  asx: Counts | null;
  crypto: Counts | null;
  bullion: Counts | null;
  charts: { ok: number; failed: number; skipped: number };
  dayRows: number;
}

export interface IntradayService {
  /** Clears the timers (idempotent); a run in flight is the scheduler's to abort. */
  stop(): void;
  /** The run in flight, or null (the `prices` job waits for it). */
  inFlight(): Promise<void> | null;
}

export interface IntradayOptions {
  db: JoinrDb;
  scheduler: Scheduler;
  providers: Providers;
  cooldowns: Cooldowns;
  clock: Clock;
  sleep: Sleep;
  log: FastifyBaseLogger;
  /** The server's IANA zone (slots, scopes and the 00:00 of crypto and bullion). */
  timeZone: string;
  /** INTRADAY_REFRESH: arm the timer and the start-up run. Off: manual runs only. */
  timerEnabled: boolean;
  /** True while the hourly `prices` job runs. */
  isPricesRunning: () => boolean;
  /** Test knobs. */
  runDeadlineMs?: number;
  coinChartSpacingMs?: number;
  startupDelayMs?: number;
}

/** A held instrument that is fetched (no hand price), with its provider symbol. */
interface IntradayTarget {
  id: number;
  providerSymbol: string;
}

/** §5.6 Targets: held, not hand-priced; ASX = Yahoo `.AX` and not a fund; crypto = CoinGecko with an id. */
export function intradayTargets(db: JoinrDb): { asx: IntradayTarget[]; crypto: IntradayTarget[] } {
  const held = heldUnitsByInstrument(db);
  const asx: IntradayTarget[] = [];
  const crypto: IntradayTarget[] = [];
  for (const row of loadInstrumentPriceRows(db)) {
    if (!isHeld(held.get(row.instrument.id))) continue;
    if (row.source?.manualPrice != null) continue;
    const src = effectiveSource(row);
    if (src.providerSymbol === null) continue;
    const target = { id: row.instrument.id, providerSymbol: src.providerSymbol };
    if (
      src.provider === 'yahoo' &&
      src.providerSymbol.toUpperCase().endsWith('.AX') &&
      row.instrument.kind !== 'managed_fund'
    ) {
      asx.push(target);
    } else if (src.provider === 'coingecko') {
      crypto.push(target);
    }
  }
  return { asx, crypto };
}

/**
 * The metals of the held bullion rows (`price_source = 'bullion'`, remaining units > 0), grouped as
 * the web prices them (`metal ?? 'silver'`), silver first.
 */
export function heldBullionMetals(db: JoinrDb): Metal[] {
  const rows = db
    .select({
      id: otherAssets.id,
      units: otherAssets.units,
      soldUnits: otherAssets.soldUnits,
      metal: otherAssets.metal,
    })
    .from(otherAssets)
    .where(eq(otherAssets.priceSource, 'bullion'))
    .all();
  if (rows.length === 0) return [];
  const sold = new Map<number, InstanceType<typeof JoinrDecimal>>();
  for (const s of db
    .select({ id: otherAssetSales.otherAssetId, units: otherAssetSales.units })
    .from(otherAssetSales)
    .where(
      inArray(
        otherAssetSales.otherAssetId,
        rows.map((r) => r.id),
      ),
    )
    .all()) {
    sold.set(s.id, (sold.get(s.id) ?? new JoinrDecimal(0)).plus(s.units));
  }
  const metals = new Set<Metal>();
  for (const r of rows) {
    const remaining = new JoinrDecimal(r.units)
      .minus(r.soldUnits)
      .minus(sold.get(r.id) ?? new JoinrDecimal(0));
    if (remaining.greaterThan(0)) metals.add(r.metal ?? 'silver');
  }
  return (Object.keys(BULLION_HOLDINGS) as Metal[]).filter((m) => metals.has(m));
}

/** The bullion scope's series: `AUDUSD` and the futures of the metals in use. */
export function bullionSeriesFor(metals: readonly Metal[]): MarketSeriesId[] {
  return metals.length === 0
    ? []
    : ['AUDUSD', ...metals.map((m) => BULLION_HOLDINGS[m].futuresSeries as MarketSeriesId)];
}

function zeroCounts(): Counts {
  return { requested: 0, ok: 0, failed: 0, skipped: 0 };
}

function skippedCounts(n: number): Counts {
  return { requested: n, ok: 0, failed: 0, skipped: n };
}

function instrumentCounts(o: RefreshOutcome): Counts {
  return { requested: o.requested, ok: o.ok, failed: o.failed, skipped: o.skipped };
}

function seriesCounts(o: RefreshOutcome): Counts {
  const s = o.series;
  return { requested: s.ok + s.failed + s.skipped, ok: s.ok, failed: s.failed, skipped: s.skipped };
}

/** The Stage 4 status rules over the run's own counts. */
export function intradayStatus(detail: IntradayDetail, aborted: boolean): JobResult['status'] {
  const scopes = [detail.asx, detail.crypto, detail.bullion].filter((c): c is Counts => c !== null);
  const sum = (k: keyof Counts): number => scopes.reduce((a, c) => a + c[k], 0);
  const failed = sum('failed') + detail.charts.failed;
  const ok = sum('ok') + detail.charts.ok;
  const skipped = sum('skipped') + detail.charts.skipped;
  const incomplete = failed > 0 || (aborted && skipped > 0);
  if (!incomplete) return 'succeeded';
  return ok > 0 ? 'partial' : 'failed';
}

export function createIntraday(o: IntradayOptions): IntradayService {
  const { db, scheduler, providers, cooldowns, clock, log, timeZone } = o;
  const deadlineMs = o.runDeadlineMs ?? INTRADAY_RUN_DEADLINE_MS;
  const chartSpacingMs = o.coinChartSpacingMs ?? COIN_CHART_SPACING_MS;

  let stopped = false;
  let slotTimer: unknown = null;
  let startupTimer: unknown = null;
  /** The scopes for the next run, set synchronously just before `scheduler.run`. */
  let pendingScopes: IntradayScopes | null = null;
  let current: Promise<void> | null = null;

  /** Crypto's day charts, sequential and spaced; the rows written in one transaction (§5.5). */
  async function fetchCharts(
    targets: readonly IntradayTarget[],
    signal: AbortSignal,
    charts: IntradayDetail['charts'],
  ): Promise<number> {
    const writes: InstrumentDayWrite[] = [];
    const fetchDayChart = providers.coingecko.fetchDayChart?.bind(providers.coingecko);
    let started = 0;
    for (const t of targets) {
      if (!fetchDayChart || signal.aborted || cooldowns.isCooling('coingecko', clock.now())) {
        charts.skipped += 1;
        continue;
      }
      if (started++ > 0 && chartSpacingMs > 0) await o.sleep(chartSpacingMs, signal);
      if (signal.aborted || cooldowns.isCooling('coingecko', clock.now())) {
        charts.skipped += 1;
        continue;
      }
      const result = await fetchDayChart(t.providerSymbol, signal);
      if (result.ok) {
        charts.ok += 1;
        const row = cryptoDayFrom(result.prices, clock.now(), timeZone);
        if (row) {
          writes.push({
            instrumentId: t.id,
            row,
            rule: 'midnight',
            source: providers.coingecko.id,
          });
        }
      } else if (result.rateLimited) {
        cooldowns.start('coingecko', clock.now(), result.retryAfterMs);
        charts.skipped += 1;
      } else if (result.skipped) {
        charts.skipped += 1;
      } else {
        charts.failed += 1;
      }
    }
    if (writes.length === 0) return 0;
    const fetchedAt = clock.now().toISOString();
    return db.transaction(
      (tx) => {
        // Only instruments that still exist (an id may have gone during the fetch).
        const existing = new Set(
          tx
            .select({ id: instruments.id })
            .from(instruments)
            .where(
              inArray(
                instruments.id,
                writes.map((w) => w.instrumentId),
              ),
            )
            .all()
            .map((r) => r.id),
        );
        return writeInstrumentDays(
          tx,
          writes.filter((w) => existing.has(w.instrumentId)),
          fetchedAt,
        );
      },
      { behavior: 'immediate' },
    );
  }

  async function runJob(ctx: JobContext): Promise<JobResult> {
    const scopes =
      pendingScopes ??
      manualScopes(clock.now().getTime(), timeZone, heldBullionMetals(db).length > 0);
    pendingScopes = null;
    let release!: () => void;
    current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deadline = new AbortController();
    const deadlineHandle = clock.setTimeout(() => deadline.abort(), deadlineMs);
    const signal = AbortSignal.any([ctx.signal, deadline.signal]);
    const detail: IntradayDetail = {
      asx: null,
      crypto: null,
      bullion: null,
      charts: { ok: 0, failed: 0, skipped: 0 },
      dayRows: 0,
    };
    let aborted = false;
    try {
      const refreshCtx: RefreshContext = {
        db,
        providers,
        cooldowns,
        now: () => clock.now(),
        sleep: o.sleep,
        signal,
        log,
        timeZone,
      };
      const targets = intradayTargets(db);
      const pricesRunning = o.isPricesRunning();

      if (scopes.asx) {
        const ids = targets.asx.map((t) => t.id);
        if (ids.length === 0) {
          detail.asx = zeroCounts();
        } else if (pricesRunning) {
          detail.asx = skippedCounts(ids.length);
        } else {
          const out = await runRefresh(refreshCtx, { lite: true, instrumentIds: ids });
          detail.asx = instrumentCounts(out);
          detail.dayRows += out.dayRows;
          aborted ||= out.aborted;
        }
      }

      if (scopes.bullion) {
        const seriesIds = bullionSeriesFor(heldBullionMetals(db));
        if (seriesIds.length === 0) {
          detail.bullion = zeroCounts();
        } else if (pricesRunning) {
          detail.bullion = skippedCounts(seriesIds.length);
        } else {
          const out = await runRefresh(refreshCtx, { lite: true, seriesIds });
          detail.bullion = seriesCounts(out);
          detail.dayRows += out.dayRows;
          aborted ||= out.aborted;
        }
      }

      if (scopes.crypto) {
        const ids = targets.crypto.map((t) => t.id);
        if (ids.length === 0) {
          detail.crypto = zeroCounts();
        } else {
          const out = await runRefresh(refreshCtx, { lite: true, instrumentIds: ids });
          detail.crypto = instrumentCounts(out);
          detail.dayRows += out.dayRows;
          aborted ||= out.aborted;
          detail.dayRows += await fetchCharts(targets.crypto, signal, detail.charts);
        }
      }
      aborted ||= signal.aborted;

      const status = intradayStatus(detail, aborted);
      log.info(
        { job: INTRADAY_JOB, trigger: ctx.trigger, status, dayRows: detail.dayRows },
        'intraday refresh finished',
      );
      const result: JobResult = { status, detail: { ...detail } };
      if (deadline.signal.aborted) result.error = 'Run deadline reached';
      else if (ctx.signal.aborted) result.error = 'Run aborted';
      return result;
    } finally {
      clock.clearTimeout(deadlineHandle);
      current = null;
      release();
    }
  }

  scheduler.register({ name: INTRADAY_JOB, intervalMs: 0, run: runJob });

  /** Starts a run for `scopes` unless one is in flight or nothing is due. */
  function trigger(scopes: IntradayScopes): void {
    if (stopped || scheduler.isRunning(INTRADAY_JOB)) return;
    const targets = intradayTargets(db);
    const due: IntradayScopes = {
      asx: scopes.asx && targets.asx.length > 0,
      crypto: scopes.crypto && targets.crypto.length > 0,
      bullion: scopes.bullion,
    };
    if (!due.asx && !due.crypto && !due.bullion) return;
    pendingScopes = due;
    scheduler.run(INTRADAY_JOB, 'schedule').catch((err: unknown) => {
      pendingScopes = null;
      if (!(err instanceof SchedulerStoppedError)) {
        log.error({ job: INTRADAY_JOB }, 'scheduled intraday run failed');
      }
    });
  }

  function armSlot(slot?: { slotMs: number; fireAtMs: number }): void {
    if (stopped) return;
    const now = clock.now().getTime();
    const next = slot ?? nextSlot(now);
    slotTimer = clock.setTimeout(
      () => {
        slotTimer = null;
        if (stopped) return;
        const firedAt = clock.now().getTime();
        // Woken early by the wake cap: sleep on towards the same slot.
        if (firedAt < next.fireAtMs) {
          armSlot(next);
          return;
        }
        if (!isSlotLate(next.slotMs, firedAt)) {
          try {
            const bullionHeld = heldBullionMetals(db).length > 0;
            trigger(scopesForSlot(next.slotMs, timeZone, bullionHeld));
          } catch {
            log.error({ job: INTRADAY_JOB }, 'could not start an intraday slot');
          }
        }
        armSlot();
      },
      wakeDelay(now, next.fireAtMs),
    );
  }

  if (o.timerEnabled) {
    startupTimer = clock.setTimeout(() => {
      startupTimer = null;
      if (stopped) return;
      try {
        trigger(startupScopes(clock.now().getTime(), timeZone));
      } catch {
        log.error({ job: INTRADAY_JOB }, 'could not start the start-up intraday run');
      }
    }, o.startupDelayMs ?? INTRADAY_STARTUP_DELAY_MS);
    armSlot();
  }

  return {
    stop() {
      stopped = true;
      if (slotTimer !== null) clock.clearTimeout(slotTimer);
      if (startupTimer !== null) clock.clearTimeout(startupTimer);
      slotTimer = null;
      startupTimer = null;
    },
    inFlight: () => current,
  };
}
