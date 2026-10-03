// The AUD bullion spot by server-local date (stage-10.md §5.5; D153). Before 1.3.0 each date's spot
// is derived from the futures' New York daily close and `AUDUSD`'s London daily close of that date
// (`deriveSpotCloses`, pure); from 1.3.0 on the exact 00:00 value is captured from the Stage 9
// midnight base (`series_day_quotes`), and a `midnight` row is never replaced by a `derived` one.
import {
  JoinrDecimal,
  PERIOD_START_MAX_GAP_DAYS,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import { seriesCloses, seriesDayQuotes } from '@joinr/schema/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Tx } from '../../db/queries/domain';
import { addDaysIso } from '../../lib/dates';
import { isWeekday, weekdayOfIso } from '../day';
import { roundDerived } from '../fx';

export type DatedValue = readonly [IsoDate, DecimalString];

/** The last value dated on or before `date` and at most `maxGapDays` before it (values ascending). */
function lastWithin(
  values: readonly DatedValue[],
  date: IsoDate,
  maxGapDays: number,
): DecimalString | null {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]![0] <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const [d, v] = values[found]!;
  return d >= addDaysIso(date, -maxGapDays) ? v : null;
}

/**
 * §5.5 (pure): for every weekday `d` from `from` to `to` (inclusive), `spot(d) =
 * roundDerived(F(last ≤ d) ÷ X(last ≤ d))` with `F` the futures' close (USD/oz) and `X` the
 * `AUDUSD` close (USD per AUD), each at most PERIOD_START_MAX_GAP_DAYS before `d`; a date missing
 * either has no value. Inputs ascending by date.
 */
export function deriveSpotCloses(
  futures: readonly DatedValue[],
  audUsd: readonly DatedValue[],
  from: IsoDate,
  to: IsoDate,
): Array<[IsoDate, DecimalString]> {
  const out: Array<[IsoDate, DecimalString]> = [];
  if (futures.length === 0 || audUsd.length === 0) return out;
  // Nothing can be derived before the first input.
  const first = futures[0]![0] > audUsd[0]![0] ? futures[0]![0] : audUsd[0]![0];
  for (let d = from > first ? from : first; d <= to; d = addDaysIso(d, 1)) {
    if (!isWeekday(weekdayOfIso(d))) continue;
    const f = lastWithin(futures, d, PERIOD_START_MAX_GAP_DAYS);
    const x = lastWithin(audUsd, d, PERIOD_START_MAX_GAP_DAYS);
    if (f === null || x === null) continue;
    const den = new JoinrDecimal(x);
    if (den.isZero()) continue;
    out.push([d, roundDerived(new JoinrDecimal(f).div(den))]);
  }
  return out;
}

/**
 * Writes the derived spot rows (source `derived`) inside the caller's transaction: never over a
 * `midnight` row, and only rows that are new or changed. Returns the rows written.
 */
export function writeDerivedSpot(
  tx: Tx,
  spotSeries: string,
  rows: ReadonlyArray<readonly [IsoDate, DecimalString]>,
  fetchedAt: string,
): number {
  if (rows.length === 0) return 0;
  const from = rows[0]![0];
  const to = rows.at(-1)![0];
  const existing = new Map(
    tx
      .select({ date: seriesCloses.date, value: seriesCloses.value, source: seriesCloses.source })
      .from(seriesCloses)
      .where(
        and(
          eq(seriesCloses.seriesId, spotSeries),
          gte(seriesCloses.date, from),
          lte(seriesCloses.date, to),
        ),
      )
      .all()
      .map((r) => [r.date, r]),
  );
  let written = 0;
  for (const [date, value] of rows) {
    const cur = existing.get(date);
    if (cur?.source === 'midnight') continue;
    if (cur?.source === 'derived' && cur.value === value) continue;
    const set = { value, source: 'derived' as const, fetchedAt };
    tx.insert(seriesCloses)
      .values({ seriesId: spotSeries, date, ...set })
      .onConflictDoUpdate({ target: [seriesCloses.seriesId, seriesCloses.date], set })
      .run();
    written += 1;
  }
  return written;
}

/**
 * The midnight capture (§5.5): when `series_day_quotes` holds the AUD spot's day for
 * `session_date = localDate` with a previous close (the spot at 00:00 on `localDate`, Stage 9's
 * midnight base), that value is the close of `localDate − 1`, written with source `midnight`
 * (replacing a `derived` row). Returns 1 when a row was written or changed, else 0.
 */
export function captureMidnight(
  tx: Tx,
  spotSeries: string,
  localDate: IsoDate,
  fetchedAt: string,
): number {
  const day = tx
    .select({
      sessionDate: seriesDayQuotes.sessionDate,
      previousClose: seriesDayQuotes.previousClose,
    })
    .from(seriesDayQuotes)
    .where(eq(seriesDayQuotes.seriesId, spotSeries))
    .get();
  if (!day || day.sessionDate !== localDate || day.previousClose === null) return 0;
  const date = addDaysIso(localDate, -1);
  const cur = tx
    .select({ value: seriesCloses.value, source: seriesCloses.source })
    .from(seriesCloses)
    .where(and(eq(seriesCloses.seriesId, spotSeries), eq(seriesCloses.date, date)))
    .get();
  if (cur?.source === 'midnight' && cur.value === day.previousClose) return 0;
  const set = { value: day.previousClose, source: 'midnight' as const, fetchedAt };
  tx.insert(seriesCloses)
    .values({ seriesId: spotSeries, date, ...set })
    .onConflictDoUpdate({ target: [seriesCloses.seriesId, seriesCloses.date], set })
    .run();
  return 1;
}
