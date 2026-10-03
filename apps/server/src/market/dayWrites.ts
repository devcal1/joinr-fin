// Stage 9 day-row writes (stage-9.md §5.4, §5.5; the rule is FROZEN): inside the caller's IMMEDIATE
// transaction, each incoming day row is merged with the stored one by `mergeDayRow` (an older
// session ignored, a newer one replacing, the same one merged; Yahoo rows keep `incoming ?? stored`
// as the previous close, midnight-based rows (crypto, bullion) the first non-null base) and the FX
// series' own previous closes land in `market_quotes`. Synchronous; nothing is logged.
import { DAY_POINTS_MAX, type DayQuoteSource } from '@joinr/schema';
import { dayQuotes, marketQuotes, seriesDayQuotes } from '@joinr/schema/db';
import { eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/queries/domain';
import { parseDayPoints } from '../db/queries/dayQuotes';
import { mergeDayRow, type DayRow, type MergeRule } from './day';

type StoredColumns = typeof dayQuotes.$inferSelect;

function toDayRow(r: Omit<StoredColumns, 'instrumentId'>): DayRow {
  return {
    sessionDate: r.sessionDate,
    timeZone: r.timeZone,
    granularity: r.granularity,
    nativeCurrency: r.nativeCurrency,
    previousClose: r.previousClose,
    regularStart: r.regularStart,
    regularEnd: r.regularEnd,
    // A malformed stored value merges as no points (the read side warns about it).
    points: parseDayPoints(r.points) ?? [],
  };
}

function columns(row: DayRow, source: DayQuoteSource, fetchedAt: string) {
  return {
    sessionDate: row.sessionDate,
    timeZone: row.timeZone,
    granularity: row.granularity,
    nativeCurrency: row.nativeCurrency,
    previousClose: row.previousClose,
    regularStart: row.regularStart,
    regularEnd: row.regularEnd,
    points: JSON.stringify(row.points.slice(-DAY_POINTS_MAX)),
    source,
    fetchedAt,
  };
}

export interface InstrumentDayWrite {
  instrumentId: number;
  row: DayRow;
  rule: MergeRule;
  source: DayQuoteSource;
}

/** Merges and upserts instrument day rows; returns how many rows were written. */
export function writeInstrumentDays(
  tx: Tx,
  writes: readonly InstrumentDayWrite[],
  fetchedAt: string,
): number {
  if (writes.length === 0) return 0;
  const stored = new Map(
    tx
      .select()
      .from(dayQuotes)
      .where(
        inArray(
          dayQuotes.instrumentId,
          writes.map((w) => w.instrumentId),
        ),
      )
      .all()
      .map(({ instrumentId, ...r }) => [instrumentId, toDayRow(r)]),
  );
  let written = 0;
  for (const w of writes) {
    const merged = mergeDayRow(stored.get(w.instrumentId) ?? null, w.row, w.rule);
    if (merged === null) continue;
    const values = columns(merged, w.source, fetchedAt);
    tx.insert(dayQuotes)
      .values({ instrumentId: w.instrumentId, ...values })
      .onConflictDoUpdate({ target: dayQuotes.instrumentId, set: values })
      .run();
    stored.set(w.instrumentId, merged);
    written += 1;
  }
  return written;
}

export interface SeriesDayWrite {
  seriesId: string;
  row: DayRow;
  source: DayQuoteSource;
}

/** Merges (midnight rule: bullion's base at 00:00) and upserts `series_day_quotes` rows. */
export function writeSeriesDays(
  tx: Tx,
  writes: readonly SeriesDayWrite[],
  fetchedAt: string,
): number {
  let written = 0;
  for (const w of writes) {
    const current = tx
      .select()
      .from(seriesDayQuotes)
      .where(eq(seriesDayQuotes.seriesId, w.seriesId))
      .get();
    const stored = current === undefined ? null : toDayRow({ ...current });
    const merged = mergeDayRow(stored, w.row, 'midnight');
    if (merged === null) continue;
    const values = columns(merged, w.source, fetchedAt);
    tx.insert(seriesDayQuotes)
      .values({ seriesId: w.seriesId, ...values })
      .onConflictDoUpdate({ target: seriesDayQuotes.seriesId, set: values })
      .run();
    written += 1;
  }
  return written;
}

/**
 * The FX series' own previous close and its session date (§3.2; `AUDUSD` and `FX_<CCY>AUD` only).
 * Only rows that exist (the caller writes the series first); an older session never replaces a
 * newer stored date.
 */
export function writeFxPreviousCloses(
  tx: Tx,
  closes: ReadonlyArray<{ seriesId: string; value: string; date: string }>,
): void {
  for (const c of closes) {
    const current = tx
      .select({ date: marketQuotes.previousCloseDate })
      .from(marketQuotes)
      .where(eq(marketQuotes.seriesId, c.seriesId))
      .get();
    if (current === undefined) continue;
    if (current.date !== null && current.date > c.date) continue;
    tx.update(marketQuotes)
      .set({ previousClose: c.value, previousCloseDate: c.date })
      .where(eq(marketQuotes.seriesId, c.seriesId))
      .run();
  }
}
