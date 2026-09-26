// The market series history read helper (stage-4.md §4.6 item 6, FROZEN signature). The daily
// `market_quote_history` rows (bullion spot, FX; written by the `prices` job, fxHistory.ts) feed the
// Other Assets price charts.
import { isIsoDateString, type DecimalString, type IsoDate } from '@joinr/schema';
import { marketQuoteHistory, type JoinrDb } from '@joinr/schema/db';
import { and, asc, gte, inArray } from 'drizzle-orm';

/**
 * The history of each requested series from `fromDate` on (inclusive), in date order. Every
 * requested id is a key; an unknown series (or one with no row since `fromDate`) → an empty list.
 * A malformed `fromDate` is a programmer error (RangeError).
 */
export function readQuoteHistory(
  db: JoinrDb,
  seriesIds: readonly string[],
  fromDate: IsoDate,
): Record<string, { date: IsoDate; value: DecimalString }[]> {
  if (!isIsoDateString(fromDate)) {
    throw new RangeError('readQuoteHistory: fromDate must be YYYY-MM-DD');
  }
  const ids = [...new Set(seriesIds)];
  const out: Record<string, { date: IsoDate; value: DecimalString }[]> = Object.fromEntries(
    ids.map((id) => [id, []]),
  );
  if (ids.length === 0) return out;
  const rows = db
    .select({
      seriesId: marketQuoteHistory.seriesId,
      date: marketQuoteHistory.date,
      value: marketQuoteHistory.value,
    })
    .from(marketQuoteHistory)
    .where(and(inArray(marketQuoteHistory.seriesId, ids), gte(marketQuoteHistory.date, fromDate)))
    .orderBy(asc(marketQuoteHistory.seriesId), asc(marketQuoteHistory.date))
    .all();
  for (const r of rows) out[r.seriesId]?.push({ date: r.date, value: r.value });
  return out;
}
