// Parsing Yahoo's chart response for dividend events (stage-3.md §4.6): the ex-dates and per-unit
// amounts of `events.dividends`, and the close before each ex-date from the daily bars. Pure.
//
// Every unix timestamp becomes a calendar date in the exchange's time zone. Yahoo stamps ASX bars
// and events at 10:00 local time, so under daylight saving the UTC date is one day early: the raw
// UTC date is never used.
import { decimalFromNumber, sumDecimals, type DecimalString, type IsoDate } from '@joinr/schema';
import { finitePositive, isRecord } from '../providers/http';
import { currencyFromSymbol, timeZoneFromSymbol } from '../providers/yahoo';

export interface ParsedDividendEvent {
  exDate: IsoDate;
  /** Per unit, in `currency` (12 significant digits). */
  amountPerUnit: DecimalString;
  /** As Yahoo reports it (`AUD`, `USD`, `GBp`). */
  currency: string;
  /** The last daily close dated before the ex-date (never the adjusted close); null when none. */
  closeBeforeEx: DecimalString | null;
  closeDate: IsoDate | null;
}

export type YahooDividendsParse =
  { ok: true; events: ParsedDividendEvent[] } | { ok: false; error: string; retryable: boolean };

/** Unix seconds → the local calendar date, or null for a timestamp that is not usable. */
export type LocalDateFn = (unixSeconds: number) => IsoDate | null;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The largest offset any time zone uses is 14 h; anything beyond is not a real offset. */
const MAX_OFFSET_SECONDS = 18 * 3600;
/** 10000-01-01T00:00:00Z: later timestamps cannot be written as YYYY-MM-DD. */
const MAX_UNIX_SECONDS = 253_402_300_800;

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** A cached `en-CA` year-month-day formatter for an IANA zone; null when the zone is unknown. */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = zoneFormatters.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

function usableUnix(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < MAX_UNIX_SECONDS;
}

function formatInZone(formatter: Intl.DateTimeFormat, unixSeconds: number): IsoDate | null {
  if (!usableUnix(unixSeconds)) return null;
  const parts = formatter.formatToParts(new Date(unixSeconds * 1000));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const iso = `${part('year')}-${part('month')}-${part('day')}`;
  return ISO_DATE_RE.test(iso) ? iso : null;
}

/** The calendar date of `unixSeconds` in an IANA time zone; null for an unknown zone. */
export function localDateInZone(unixSeconds: number, timeZone: string): IsoDate | null {
  const formatter = zoneFormatter(timeZone);
  return formatter ? formatInZone(formatter, unixSeconds) : null;
}

/** The calendar date of `unixSeconds` shifted by a fixed UTC offset (seconds). */
export function localDateWithOffset(unixSeconds: number, offsetSeconds: number): IsoDate | null {
  const shifted = unixSeconds + offsetSeconds;
  if (!usableUnix(unixSeconds) || !usableUnix(shifted)) return null;
  const iso = new Date(shifted * 1000).toISOString().slice(0, 10);
  return ISO_DATE_RE.test(iso) ? iso : null;
}

/**
 * How the response's timestamps become local dates: `meta.exchangeTimezoneName` (IANA, DST-aware);
 * else `meta.gmtoffset` (the exchange's offset at request time); else the zone implied by the
 * symbol's suffix. Null when none is usable.
 */
export function localDateResolver(meta: Record<string, unknown>): LocalDateFn | null {
  const zoneName = meta.exchangeTimezoneName;
  const formatter = typeof zoneName === 'string' ? zoneFormatter(zoneName) : null;
  if (formatter) return (u) => formatInZone(formatter, u);
  const offset = meta.gmtoffset;
  if (
    typeof offset === 'number' &&
    Number.isFinite(offset) &&
    Math.abs(offset) <= MAX_OFFSET_SECONDS
  )
    return (u) => localDateWithOffset(u, offset);
  const suffixZone = timeZoneFromSymbol(meta.symbol);
  const suffixFormatter = suffixZone === null ? null : zoneFormatter(suffixZone);
  if (suffixFormatter) return (u) => formatInZone(suffixFormatter, u);
  return null;
}

interface Bar {
  date: IsoDate;
  close: DecimalString;
}

/** Non-null daily closes with their local dates, oldest first (array order kept within a date). */
function dailyCloses(result: Record<string, unknown>, localDate: LocalDateFn): Bar[] {
  const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const quote: unknown = Array.isArray(indicators?.quote) ? indicators.quote[0] : undefined;
  const closes: unknown[] = isRecord(quote) && Array.isArray(quote.close) ? quote.close : [];
  const bars: Bar[] = [];
  const n = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < n; i += 1) {
    const close = finitePositive(closes[i]);
    const ts = timestamps[i];
    if (close === null || typeof ts !== 'number') continue;
    const date = localDate(ts);
    if (date !== null) bars.push({ date, close: decimalFromNumber(close) });
  }
  // Stable: bars of the same date keep their order, so the later one wins below.
  return bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The last bar dated strictly before `exDate` (bars sorted oldest first). */
function barBefore(bars: readonly Bar[], exDate: IsoDate): Bar | null {
  let found: Bar | null = null;
  for (const bar of bars) {
    if (bar.date >= exDate) break;
    found = bar;
  }
  return found;
}

/**
 * Parses a `v8/finance/chart` response requested with `events=div`:
 * - `chart.error` or no result → "Symbol not found" (as prices); not a chart → "Malformed response".
 * - `events.dividends` values `{ amount, date }` → one event per local ex-date (amounts on the same
 *   local date are added); non-finite or ≤ 0 amounts and unusable dates are skipped.
 * - `closeBeforeEx`: the last non-null `indicators.quote[0].close` dated before the ex-date (the
 *   "last close on or before ex-date minus one trading day" of spec 02 §4.4), with its date.
 * - The currency is `meta.currency` as reported (`GBp` included), else the symbol suffix's.
 * Events come back oldest first. A response without events is a success with none.
 */
export function parseYahooDividends(body: unknown): YahooDividendsParse {
  if (!isRecord(body) || !isRecord(body.chart)) {
    return { ok: false, error: 'Malformed response', retryable: true };
  }
  const chart = body.chart;
  if (chart.error !== null && chart.error !== undefined) {
    return { ok: false, error: 'Symbol not found', retryable: false };
  }
  const result: unknown = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isRecord(result) || !isRecord(result.meta)) {
    return { ok: false, error: 'Symbol not found', retryable: false };
  }
  const meta = result.meta;

  const container = isRecord(result.events) ? result.events.dividends : undefined;
  const raw: unknown[] = Array.isArray(container)
    ? container
    : isRecord(container)
      ? Object.values(container)
      : [];
  const candidates = raw.filter(
    (e): e is { amount: number; date: number } =>
      isRecord(e) && finitePositive(e.amount) !== null && typeof e.date === 'number',
  );
  if (candidates.length === 0) return { ok: true, events: [] };

  const localDate = localDateResolver(meta);
  if (localDate === null) {
    return { ok: false, error: 'No exchange time zone in response', retryable: false };
  }
  const currency =
    typeof meta.currency === 'string' && /^[A-Za-z]{3}$/.test(meta.currency)
      ? meta.currency
      : currencyFromSymbol(meta.symbol);
  if (currency === null) return { ok: false, error: 'No currency in response', retryable: false };

  const amountsByDate = new Map<IsoDate, string[]>();
  for (const e of candidates) {
    const exDate = localDate(e.date);
    if (exDate === null) continue;
    const amounts = amountsByDate.get(exDate) ?? [];
    amounts.push(decimalFromNumber(e.amount));
    amountsByDate.set(exDate, amounts);
  }

  const bars = dailyCloses(result, localDate);
  const events: ParsedDividendEvent[] = [...amountsByDate.keys()].sort().map((exDate) => {
    const bar = barBefore(bars, exDate);
    return {
      exDate,
      amountPerUnit: sumDecimals(amountsByDate.get(exDate)!),
      currency,
      closeBeforeEx: bar?.close ?? null,
      closeDate: bar?.date ?? null,
    };
  });
  return { ok: true, events };
}
