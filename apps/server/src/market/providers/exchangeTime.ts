// Exchange time for Yahoo responses (moved here in Stage 4, Fixer round 1, so that
// providers/yahoo.ts and dividends/parse.ts no longer import each other): the quote currency and
// the time zone implied by a Yahoo exchange suffix, and how a response's unix timestamps become
// calendar dates in the exchange's time zone (stage-3.md §4.6; stage-4.md §4.6). Pure. This module
// imports neither yahoo.ts nor dividends/parse.ts.
import type { IsoDate } from '@joinr/schema';

/**
 * Quote currency implied by a Yahoo exchange suffix. Used only when `meta.currency` is missing
 * (Yahoo sometimes returns a degraded `meta` for thinly traded ASX listings).
 */
export const YAHOO_SUFFIX_CURRENCIES: Readonly<Record<string, string>> = {
  '.AX': 'AUD',
  '.NZ': 'NZD',
  '.TO': 'CAD',
};

/**
 * Stage 3 (stage-3.md §4.6): the exchange time zone implied by a Yahoo suffix. The dividend-events
 * parser uses it only when `meta` has neither `exchangeTimezoneName` nor `gmtoffset`.
 */
export const YAHOO_SUFFIX_TIME_ZONES: Readonly<Record<string, string>> = {
  '.AX': 'Australia/Sydney',
  '.NZ': 'Pacific/Auckland',
  '.TO': 'America/Toronto',
};

function suffixOf(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null;
  return /\.[A-Z]{1,3}$/.exec(symbol.toUpperCase())?.[0] ?? null;
}

export function currencyFromSymbol(symbol: unknown): string | null {
  const suffix = suffixOf(symbol);
  return suffix === null ? null : (YAHOO_SUFFIX_CURRENCIES[suffix] ?? null);
}

export function timeZoneFromSymbol(symbol: unknown): string | null {
  const suffix = suffixOf(symbol);
  return suffix === null ? null : (YAHOO_SUFFIX_TIME_ZONES[suffix] ?? null);
}

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
