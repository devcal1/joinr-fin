// Price and series status (stage-1.md §5.6): computed per request from stored rows, never stored.
// Pure; the clock is passed in.
import {
  previousWeekdayStart,
  type FetchStatus,
  type MarketQuoteStatus,
  type PriceSource,
  type PriceStatus,
} from '@joinr/schema';

/** A manual price older than this (in days) shows as stale. */
export const MANUAL_FRESH_DAYS = 31;
/** A crypto price older than this shows as stale. */
export const CRYPTO_FRESH_MS = 3 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/** Whole local calendar days from the IsoDate `asOf` to `now`'s local date (negative = future). */
export function localDaysSince(asOf: string, now: Date): number {
  const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
  const then = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / DAY_MS);
}

export type FreshnessRule = 'crypto' | 'market';

/**
 * crypto: `now − asOf ≤ 3 h`; market (Yahoo instruments and series): `asOf ≥ 00:00 local on the
 * previous weekday` (public holidays ignored).
 */
export function isFresh(asOf: string, rule: FreshnessRule, now: Date): boolean {
  const at = Date.parse(asOf);
  if (Number.isNaN(at)) return false;
  if (rule === 'crypto') return now.getTime() - at <= CRYPTO_FRESH_MS;
  return at >= previousWeekdayStart(now).getTime();
}

export interface PriceStatusInput {
  manual: { asOf: string } | null;
  /** The `prices` row, or null when there is none. */
  fetched: {
    price: string | null;
    asOf: string | null;
    source: PriceSource | null;
    lastStatus: FetchStatus;
  } | null;
  rule: FreshnessRule;
}

export function priceStatus(input: PriceStatusInput, now: Date): PriceStatus {
  if (input.manual) {
    return localDaysSince(input.manual.asOf, now) <= MANUAL_FRESH_DAYS ? 'manual' : 'stale';
  }
  const row = input.fetched;
  const failed = row?.lastStatus === 'error';
  if (row === null || row.price === null) return failed ? 'failed' : 'none';
  if (row.source === 'sheet') return 'stale';
  if (row.asOf !== null && isFresh(row.asOf, input.rule, now)) return 'fresh';
  return failed ? 'failed' : 'stale';
}

export function quoteStatus(
  row: { value: string | null; asOf: string | null; lastStatus: FetchStatus } | null,
  now: Date,
): MarketQuoteStatus {
  const failed = row?.lastStatus === 'error';
  if (row === null || row.value === null) return failed ? 'failed' : 'none';
  if (row.asOf !== null && isFresh(row.asOf, 'market', now)) return 'fresh';
  return failed ? 'failed' : 'stale';
}
