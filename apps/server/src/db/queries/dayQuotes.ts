// Stage 9 day caches (stage-9.md §3.1, §3.1a, §3.2, §5.4; the signatures are FROZEN): each
// instrument's stored session (`day_quotes`), bullion's day by series id (`series_day_quotes`) and
// the FX series' own previous closes (`market_quotes.previous_close[_date]`). Reads only; the
// writes (the newer-session rule and the merges) live in market/refresh.ts.
import {
  NORMALISED_DECIMAL_RE,
  type DayGranularity,
  type DayQuoteSource,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import { dayQuotes, marketQuotes, seriesDayQuotes } from '@joinr/schema/db';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../database';

/** A stored day, points parsed (unix seconds, native decimal strings, ascending). */
export interface DayQuoteRow {
  sessionDate: IsoDate;
  timeZone: string;
  granularity: DayGranularity;
  nativeCurrency: string;
  previousClose: DecimalString | null;
  regularStart: string | null;
  regularEnd: string | null;
  points: Array<[number, DecimalString]>;
  source: DayQuoteSource;
  fetchedAt: string;
}

type Warn = Pick<FastifyBaseLogger, 'warn'>;

/** The stored `points` JSON, or null when it is not `[[unixSeconds, "price"], …]`. */
export function parseDayPoints(text: string): Array<[number, DecimalString]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const points: Array<[number, DecimalString]> = [];
  for (const item of parsed as unknown[]) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [t, p] = item as [unknown, unknown];
    if (typeof t !== 'number' || !Number.isSafeInteger(t) || t <= 0) return null;
    if (typeof p !== 'string' || !NORMALISED_DECIMAL_RE.test(p)) return null;
    points.push([t, p]);
  }
  return points;
}

type StoredRow = Omit<DayQuoteRow, 'points'> & { points: string };

function toRow(r: StoredRow, onMalformed: () => void): DayQuoteRow {
  const points = parseDayPoints(r.points);
  if (points === null) onMalformed();
  return { ...r, points: points ?? [] };
}

const COLUMNS = {
  sessionDate: dayQuotes.sessionDate,
  timeZone: dayQuotes.timeZone,
  granularity: dayQuotes.granularity,
  nativeCurrency: dayQuotes.nativeCurrency,
  previousClose: dayQuotes.previousClose,
  regularStart: dayQuotes.regularStart,
  regularEnd: dayQuotes.regularEnd,
  points: dayQuotes.points,
  source: dayQuotes.source,
  fetchedAt: dayQuotes.fetchedAt,
};

/** Every instrument's stored day; a malformed `points` value reads as `[]` with a warning (the id only). */
export function loadDayQuotes(db: Db, log?: Warn): Map<number, DayQuoteRow> {
  const rows = db
    .select({ instrumentId: dayQuotes.instrumentId, ...COLUMNS })
    .from(dayQuotes)
    .all();
  const out = new Map<number, DayQuoteRow>();
  for (const { instrumentId, ...r } of rows) {
    out.set(
      instrumentId,
      toRow(r, () =>
        log?.warn({ instrumentId }, 'day_quotes row has malformed points; read as none'),
      ),
    );
  }
  return out;
}

/** Bullion's stored days by series id (`XAU_AUD_OZ`, `GC_USD_OZ`, …), read like `loadDayQuotes`. */
export function loadSeriesDayQuotes(db: Db, log?: Warn): Map<string, DayQuoteRow> {
  const rows = db
    .select({
      seriesId: seriesDayQuotes.seriesId,
      sessionDate: seriesDayQuotes.sessionDate,
      timeZone: seriesDayQuotes.timeZone,
      granularity: seriesDayQuotes.granularity,
      nativeCurrency: seriesDayQuotes.nativeCurrency,
      previousClose: seriesDayQuotes.previousClose,
      regularStart: seriesDayQuotes.regularStart,
      regularEnd: seriesDayQuotes.regularEnd,
      points: seriesDayQuotes.points,
      source: seriesDayQuotes.source,
      fetchedAt: seriesDayQuotes.fetchedAt,
    })
    .from(seriesDayQuotes)
    .all();
  const out = new Map<string, DayQuoteRow>();
  for (const { seriesId, ...r } of rows) {
    out.set(
      seriesId,
      toRow(r, () =>
        log?.warn({ seriesId }, 'series_day_quotes row has malformed points; read as none'),
      ),
    );
  }
  return out;
}

/** The FX series' own previous closes (`AUDUSD`, `FX_<CCY>AUD`): only rows with both a value and a date. */
export function loadFxPreviousCloses(db: Db): Map<string, { value: DecimalString; date: IsoDate }> {
  const rows = db
    .select({
      seriesId: marketQuotes.seriesId,
      value: marketQuotes.previousClose,
      date: marketQuotes.previousCloseDate,
    })
    .from(marketQuotes)
    .all();
  const out = new Map<string, { value: DecimalString; date: IsoDate }>();
  for (const { seriesId, value, date } of rows) {
    if (value !== null && date !== null) out.set(seriesId, { value, date });
  }
  return out;
}
