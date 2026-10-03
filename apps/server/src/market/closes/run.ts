// One `closes` run (stage-10.md §5.7): the series (FX, `AUDUSD`, the futures), the Yahoo-priced
// instruments, the series their answers newly revealed (a currency not stored yet), the coins
// (CoinGecko, sequential and spaced), then the derived bullion spot and the midnight capture. Each
// target is written in its own IMMEDIATE transaction as soon as it is fetched, so a deadline keeps
// what was done. The caller (index.ts) owns the deadline, the pauses and the timers.
import { dateInZone, PERIOD_START_MAX_GAP_DAYS, type IsoDate } from '@joinr/schema';
import type { JoinrDb } from '@joinr/schema/db';
import type { FastifyBaseLogger } from 'fastify';
import { loadSeriesCloses } from '../../db/queries/closes';
import { addDaysIso } from '../../lib/dates';
import type { JobResult } from '../../scheduler/types';
import type { CoinHistoryClient, Sleep, YahooHistoryClient } from '../providers/types';
import type { Cooldowns } from '../refresh';
import { runCoinTarget } from './coins';
import { captureMidnight, deriveSpotCloses, writeDerivedSpot } from './derive';
import { runSeriesTarget, runYahooInstrument } from './history';
import {
  instrumentCloseTargets,
  metalCloseNeeds,
  seriesCloseTargets,
  storedInstrumentRanges,
  storedSeriesRanges,
  type ClosesMemory,
} from './targets';

export interface ClosesClients {
  yahoo: YahooHistoryClient;
  coins: CoinHistoryClient;
}

export interface ClosesRunContext {
  db: JoinrDb;
  clients: ClosesClients;
  cooldowns: Cooldowns;
  now: () => Date;
  sleep: Sleep;
  /** The run's signal: the scheduler's abort combined with the run deadline. */
  signal: AbortSignal;
  log: FastifyBaseLogger;
  /** The server's IANA zone (localDate, crypto's and bullion's midnights). */
  timeZone: string;
  memory: ClosesMemory;
  /**
   * Waits (bounded by the signal) before every request: the pause while `prices`, `intraday` or
   * `dividends` runs and, before a CoinGecko call, the intraday crypto-slot guard (index.ts).
   */
  beforeRequest(provider: 'yahoo' | 'coingecko'): Promise<void>;
  /** The least time between two CoinGecko call starts (CLOSES_COIN_SPACING_MS). */
  coinSpacingMs: number;
}

export interface ClosesDetail {
  yahoo: { ok: number; failed: number; skipped: number };
  coingecko: { ok: number; failed: number; skipped: number; beyondReach: number };
  backfills: number;
  topUps: number;
  /** Closes written for the fetched instruments and series (not the derived spot). */
  rows: number;
  splits: number;
  derived: number;
  midnight: number;
  /** Targets left by a cool-down or the deadline (a follow-up run picks them up). */
  left: number;
}

/** A run in progress (shared with history.ts and coins.ts). */
export interface ClosesRun {
  ctx: ClosesRunContext;
  detail: ClosesDetail;
  localDate: IsoDate;
  /** The run's clock as UTC ISO (`fetched_at`). */
  fetchedAt: string;
  errors: string[];
  /** Waits for the next CoinGecko call: the spacing since the last one, then `beforeRequest`. */
  coinGate(): Promise<void>;
}

export function emptyClosesDetail(): ClosesDetail {
  return {
    yahoo: { ok: 0, failed: 0, skipped: 0 },
    coingecko: { ok: 0, failed: 0, skipped: 0, beyondReach: 0 },
    backfills: 0,
    topUps: 0,
    rows: 0,
    splits: 0,
    derived: 0,
    midnight: 0,
    left: 0,
  };
}

/** The Stage 4 status rules over the run's own counts. */
export function closesStatus(detail: ClosesDetail, aborted: boolean): JobResult['status'] {
  const failed = detail.yahoo.failed + detail.coingecko.failed;
  const ok = detail.yahoo.ok + detail.coingecko.ok;
  const skipped = detail.yahoo.skipped + detail.coingecko.skipped;
  const incomplete = failed > 0 || (aborted && skipped > 0);
  if (!incomplete) return 'succeeded';
  return ok > 0 ? 'partial' : 'failed';
}

export async function runCloses(
  ctx: ClosesRunContext,
): Promise<{ detail: ClosesDetail; aborted: boolean; errors: string[] }> {
  const detail = emptyClosesDetail();
  const nowMs = ctx.now().getTime();
  const localDate = dateInZone(nowMs, ctx.timeZone);
  if (localDate === null) throw new Error('Unknown server time zone');
  let lastCoinStartMs: number | null = null;
  const run: ClosesRun = {
    ctx,
    detail,
    localDate,
    fetchedAt: new Date(nowMs).toISOString(),
    errors: [],
    async coinGate() {
      if (lastCoinStartMs !== null && ctx.coinSpacingMs > 0) {
        const wait = lastCoinStartMs + ctx.coinSpacingMs - ctx.now().getTime();
        if (wait > 0) await ctx.sleep(wait, ctx.signal);
      }
      await ctx.beforeRequest('coingecko');
      lastCoinStartMs = ctx.now().getTime();
    },
  };

  const instruments = instrumentCloseTargets(ctx.db, localDate);
  const metals = metalCloseNeeds(ctx.db, localDate);
  const series = seriesCloseTargets(instruments, metals);
  const seriesStored = storedSeriesRanges(
    ctx.db,
    series.map((s) => s.seriesId),
  );
  const instrumentStored = storedInstrumentRanges(
    ctx.db,
    instruments.map((t) => t.instrumentId),
  );

  // 1. The series, then the Yahoo-priced instruments.
  for (const s of series) await runSeriesTarget(run, s, seriesStored.get(s.seriesId) ?? null);
  const learned = new Map<number, string>();
  for (const t of instruments) {
    if (t.provider !== 'yahoo') continue;
    const currency = await runYahooInstrument(run, t, instrumentStored.get(t.instrumentId) ?? null);
    if (currency !== null) learned.set(t.instrumentId, currency);
  }
  // 2. A currency first seen in this run's answers (no stored price yet) needs its FX now.
  const done = new Set(series.map((s) => s.seriesId));
  const extra = seriesCloseTargets(
    instruments,
    metals,
    (t) => learned.get(t.instrumentId) ?? t.nativeCurrency,
  ).filter((s) => !done.has(s.seriesId));
  if (extra.length > 0) {
    const stored = storedSeriesRanges(
      ctx.db,
      extra.map((s) => s.seriesId),
    );
    for (const s of extra) await runSeriesTarget(run, s, stored.get(s.seriesId) ?? null);
  }
  // 3. The coins, one at a time.
  for (const t of instruments) {
    if (t.provider !== 'coingecko') continue;
    await runCoinTarget(run, t, instrumentStored.get(t.instrumentId) ?? null);
  }
  // 4. The derived AUD spot and the midnight capture (database only; done even after a deadline).
  const yesterday = addDaysIso(localDate, -1);
  for (const m of metals) {
    const inputs = loadSeriesCloses(
      ctx.db,
      [m.futuresSeries, 'AUDUSD'],
      addDaysIso(m.needFrom, -PERIOD_START_MAX_GAP_DAYS),
    );
    const rows = deriveSpotCloses(
      inputs.get(m.futuresSeries) ?? [],
      inputs.get('AUDUSD') ?? [],
      m.needFrom,
      yesterday,
    );
    ctx.db.transaction(
      (tx) => {
        detail.derived += writeDerivedSpot(tx, m.spotSeries, rows, run.fetchedAt);
        detail.midnight += captureMidnight(tx, m.spotSeries, localDate, run.fetchedAt);
      },
      { behavior: 'immediate' },
    );
  }
  return { detail, aborted: ctx.signal.aborted, errors: run.errors };
}
