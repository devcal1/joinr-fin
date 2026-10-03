// Stage 10 daily closes (stage-10.md §3.1–§3.3, §5.9; the signatures are FROZEN): each instrument's
// stored closes and split events, the market series' closes, and how far the stored history
// reaches (`closesThrough`). Reads only; the writes live in market/closes/**. Dates ascend; an
// empty id list reads nothing.
import type { DecimalString, IsoDate } from '@joinr/schema';
import { instrumentCloses, instrumentSplits, seriesCloses } from '@joinr/schema/db';
import { and, asc, gte, inArray, max } from 'drizzle-orm';
import type { Db } from '../database';
import type { Tx } from './domain';

type Reader = Db | Tx;

/**
 * Each instrument's closes dated on or after `from`, ascending, in the currency of its newest
 * row: a row whose currency differs from the newest row's is skipped (a listing that changed
 * currency). Instruments with no row are absent.
 */
export function loadInstrumentCloses(
  db: Reader,
  ids: readonly number[],
  from: IsoDate,
): Map<number, { currency: string; closes: Array<[IsoDate, DecimalString]> }> {
  const out = new Map<number, { currency: string; closes: Array<[IsoDate, DecimalString]> }>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      instrumentId: instrumentCloses.instrumentId,
      date: instrumentCloses.date,
      close: instrumentCloses.close,
      currency: instrumentCloses.currency,
    })
    .from(instrumentCloses)
    .where(and(inArray(instrumentCloses.instrumentId, [...ids]), gte(instrumentCloses.date, from)))
    .orderBy(asc(instrumentCloses.instrumentId), asc(instrumentCloses.date))
    .all();
  const byId = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byId.get(row.instrumentId) ?? [];
    list.push(row);
    byId.set(row.instrumentId, list);
  }
  for (const [instrumentId, list] of byId) {
    const currency = list.at(-1)!.currency;
    out.set(instrumentId, {
      currency,
      closes: list.filter((r) => r.currency === currency).map((r) => [r.date, r.close]),
    });
  }
  return out;
}

/** Each instrument's split dates, ascending; instruments with none are absent. */
export function loadInstrumentSplits(db: Reader, ids: readonly number[]): Map<number, IsoDate[]> {
  const out = new Map<number, IsoDate[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({ instrumentId: instrumentSplits.instrumentId, date: instrumentSplits.date })
    .from(instrumentSplits)
    .where(inArray(instrumentSplits.instrumentId, [...ids]))
    .orderBy(asc(instrumentSplits.instrumentId), asc(instrumentSplits.date))
    .all();
  for (const { instrumentId, date } of rows) {
    const list = out.get(instrumentId) ?? [];
    list.push(date);
    out.set(instrumentId, list);
  }
  return out;
}

/** Each series' closes dated on or after `from`, ascending; series with no row are absent. */
export function loadSeriesCloses(
  db: Reader,
  seriesIds: readonly string[],
  from: IsoDate,
): Map<string, Array<[IsoDate, DecimalString]>> {
  const out = new Map<string, Array<[IsoDate, DecimalString]>>();
  if (seriesIds.length === 0) return out;
  const rows = db
    .select({ seriesId: seriesCloses.seriesId, date: seriesCloses.date, value: seriesCloses.value })
    .from(seriesCloses)
    .where(and(inArray(seriesCloses.seriesId, [...seriesIds]), gte(seriesCloses.date, from)))
    .orderBy(asc(seriesCloses.seriesId), asc(seriesCloses.date))
    .all();
  for (const { seriesId, date, value } of rows) {
    const list = out.get(seriesId) ?? [];
    list.push([date, value]);
    out.set(seriesId, list);
  }
  return out;
}

/**
 * The oldest of the per-series newest stored dates over the instruments and the series given (one
 * with no row is ignored); null when none has a row. One failing series therefore shows (§4.2).
 */
export function closesThrough(
  db: Reader,
  ids: readonly number[],
  seriesIds: readonly string[],
): IsoDate | null {
  const newest: IsoDate[] = [];
  if (ids.length > 0) {
    const rows = db
      .select({ newest: max(instrumentCloses.date) })
      .from(instrumentCloses)
      .where(inArray(instrumentCloses.instrumentId, [...ids]))
      .groupBy(instrumentCloses.instrumentId)
      .all();
    for (const r of rows) if (r.newest !== null) newest.push(r.newest);
  }
  if (seriesIds.length > 0) {
    const rows = db
      .select({ newest: max(seriesCloses.date) })
      .from(seriesCloses)
      .where(inArray(seriesCloses.seriesId, [...seriesIds]))
      .groupBy(seriesCloses.seriesId)
      .all();
    for (const r of rows) if (r.newest !== null) newest.push(r.newest);
  }
  if (newest.length === 0) return null;
  return newest.reduce((a, b) => (b < a ? b : a));
}
