// A coin's daily closes from CoinGecko's `market_chart` points (stage-10.md §5.3; D142). The close
// of a server-local date D is the coin's AUD price at 00:00 on D + 1 in the server's zone (the end
// of the day D, the instant Stage 9 uses as the next day's base). Pure: the zone is a parameter and
// every midnight comes from `startOfDayInZone`, never the process TZ.
import {
  CLOSES_COIN_DAILY_WINDOW_MS,
  CLOSES_COIN_POINT_MAX_AGE_MS,
  CLOSES_LEAD_DAYS,
  COINGECKO_HISTORY_DAYS,
  COINGECKO_HOURLY_DAYS,
  decimalFromNumber,
  startOfDayInZone,
  type IsoDate,
} from '@joinr/schema';
import { addDaysIso } from '../../lib/dates';
import type { HistoryClose } from '../providers/types';
import type { ClosesRun } from './run';
import {
  instrumentCoveredFrom,
  planTarget,
  type InstrumentCloseTarget,
  type StoredRange,
} from './targets';
import { writeInstrumentCloses } from './writes';

/** The index of the last point with `t ≤ at` (points ascending), or -1. */
function lastAtOrBefore(points: ReadonlyArray<readonly [number, number]>, at: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= at) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The closes of the server-local dates `fromDate` … `localDate − 1` (§5.3), for each date `D` with
 * `T` = 00:00 on `D + 1` in `timeZone`:
 * - **hourly** points: the last point with `t ≤ T` and `t > T − 36 h` (offsets are whole hours, so
 *   that is exactly the 00:00 price);
 * - **daily** points (at 00:00 UTC): the point nearest to `T` within ± 14 h, ties to the earlier —
 *   the 00:00 UTC point of `D + 1`, about 10–11 hours after `T` (an accepted approximation, §15
 *   item 9); so the first point of a `days=365` answer is the close of the date before it.
 * A date with no such point has no close. Points need not be sorted; unusable ones are ignored.
 */
export function coinClosesFrom(
  points: ReadonlyArray<readonly [number, number]>,
  timeZone: string,
  fromDate: IsoDate,
  localDate: IsoDate,
  daily: boolean,
): HistoryClose[] {
  const usable = points
    .filter(([t, p]) => Number.isFinite(t) && t > 0 && Number.isFinite(p) && p > 0)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  if (usable.length === 0) return [];
  // No date before the points can have a close: start two days before the first point at most.
  const firstDate = new Date(usable[0]![0] - 2 * 86_400_000).toISOString().slice(0, 10);
  let d = fromDate > firstDate ? fromDate : firstDate;
  const out: HistoryClose[] = [];
  for (; d < localDate; d = addDaysIso(d, 1)) {
    const T = startOfDayInZone(addDaysIso(d, 1), timeZone);
    if (T === null) continue;
    let value: number | null = null;
    if (daily) {
      const i = lastAtOrBefore(usable, T);
      const before = i >= 0 ? usable[i]! : null;
      const after = i + 1 < usable.length ? usable[i + 1]! : null;
      const dBefore = before ? T - before[0] : Infinity;
      const dAfter = after ? after[0] - T : Infinity;
      const best = dBefore <= dAfter ? before : after;
      if (best && Math.abs(best[0] - T) <= CLOSES_COIN_DAILY_WINDOW_MS) value = best[1];
    } else {
      const i = lastAtOrBefore(usable, T);
      if (i >= 0 && usable[i]![0] > T - CLOSES_COIN_POINT_MAX_AGE_MS) value = usable[i]![1];
    }
    if (value !== null) out.push({ date: d, close: decimalFromNumber(value) });
  }
  return out;
}

// ─── The CoinGecko part of a run (§5.3) ─────────────────────────────────────────────────────────

/** The days a backfill asks for: the keyless reach (`COINGECKO_HISTORY_DAYS + 1`), daily points. */
export const COIN_BACKFILL_DAYS = COINGECKO_HISTORY_DAYS + 1;

/**
 * Plans, fetches and writes one coin. A backfill asks for `days=365&interval=daily` (00:00 UTC
 * points), then `days=90` (hourly), whose closes win on the dates both cover; a top-up asks for
 * `min(90, localDate − newest + 3)` days, hourly. Every call waits for `run.coinGate()` (the
 * spacing, the job pause and the intraday slot guard). A 429/403 starts the CoinGecko cool-down
 * (`Retry-After` honoured) and leaves the rest for a follow-up; whatever was fetched is written in
 * one IMMEDIATE transaction.
 */
export async function runCoinTarget(
  run: ClosesRun,
  t: InstrumentCloseTarget,
  stored: StoredRange | null,
): Promise<void> {
  const { ctx, detail, localDate } = run;
  const counts = detail.coingecko;
  const action = planTarget({
    stored,
    coveredFrom: instrumentCoveredFrom(t, ctx.memory, localDate),
    triedToday: ctx.memory.triedOn(t.key, localDate),
    complete: ctx.memory.isComplete(t.key),
    coinLocalDate: localDate,
  });
  if (action === 'skip') {
    counts.skipped += 1;
    return;
  }
  const calls: Array<{ days: number; daily: boolean }> =
    action === 'backfill' || stored === null
      ? [
          { days: COIN_BACKFILL_DAYS, daily: true },
          { days: COINGECKO_HOURLY_DAYS, daily: false },
        ]
      : [
          {
            days: Math.min(
              COINGECKO_HOURLY_DAYS,
              Math.max(2, daysBetween(stored.latest, localDate) + 3),
            ),
            daily: false,
          },
        ];
  const closes = new Map<IsoDate, HistoryClose['close']>();
  let fetched = 0;
  let dailyOk = false;
  /** Work left by a cool-down or the deadline (a follow-up retries it); a failure leaves none. */
  let unfinished = false;
  const blocked = (): boolean =>
    ctx.signal.aborted || ctx.cooldowns.isCooling('coingecko', ctx.now());
  for (const call of calls) {
    if (blocked()) {
      unfinished = true;
      break;
    }
    await run.coinGate();
    if (blocked()) {
      unfinished = true;
      break;
    }
    if (fetched === 0) {
      if (action === 'backfill') detail.backfills += 1;
      else detail.topUps += 1;
    }
    const result = await ctx.clients.coins.fetchHistory(
      t.providerSymbol,
      call.days,
      call.daily,
      ctx.signal,
    );
    // The once-a-day rule counts a backfill that got an answer (not a cool-down or the deadline).
    if (action === 'backfill' && (result.ok || result.kind === 'failed')) {
      ctx.memory.markTried(t.key, localDate);
    }
    if (result.ok) {
      fetched += 1;
      if (call.daily) dailyOk = true;
      const from = call.daily
        ? addDaysIso(t.earliestTrade, -CLOSES_LEAD_DAYS)
        : addDaysIso(localDate, -call.days);
      for (const c of coinClosesFrom(result.prices, ctx.timeZone, from, localDate, call.daily)) {
        closes.set(c.date, c.close);
      }
      continue;
    }
    if (result.kind === 'beyond_reach') {
      counts.beyondReach += 1;
      continue;
    }
    if (result.kind === 'failed') {
      counts.failed += 1;
      run.errors.push(result.error);
      if (fetched === 0) return;
      break;
    }
    if (result.kind === 'rate_limited') {
      ctx.cooldowns.start('coingecko', ctx.now(), result.retryAfterMs);
    }
    unfinished = true;
    break;
  }
  if (fetched === 0) {
    counts.skipped += 1;
    if (unfinished) detail.left += 1;
    return;
  }
  const rows = [...closes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
  const written = writeInstrumentCloses(
    ctx.db,
    { target: t, closes: rows, currency: 'AUD', splits: [], source: ctx.clients.coins.id },
    run.fetchedAt,
  );
  if (written === null) {
    counts.skipped += 1;
    return;
  }
  counts.ok += 1;
  detail.rows += written.rows;
  // A backfill whose daily answer arrived is complete; an unfinished one (cool-down, deadline)
  // leaves the rest for a follow-up.
  if (action === 'backfill' && dailyOk) ctx.memory.markComplete(t.key);
  if (unfinished) detail.left += 1;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
