// Stage 4 additions to the `prices` job (stage-4.md §4.6): the purchase-date FX backfill for other
// assets and the daily market series history.
//
// The backfill fills `other_assets.purchase_fx_*` for foreign-currency assets with a purchase date
// and no rate: at most FX_BACKFILL_MAX_PER_RUN assets per run, least recently attempted first, one
// request per distinct (currency, date) pair, each pair retried at most once a day. It shares the
// Yahoo cool-down and the run deadline with the rest of the job; a 429/403 stops it. The fetch runs
// before the job's write transaction; `writeFxBackfill` then writes inside it, only to rows whose
// currency and purchase date are unchanged and whose rate is still null (never a `user` rate), and
// never touches `origin`. The fetched closes go to `market_quote_history` as `FX_<CCY>AUD`.
import {
  isIsoDateString,
  JoinrDecimal,
  normaliseDecimal,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import { marketQuoteHistory, otherAssets, type JoinrDb } from '@joinr/schema/db';
import { and, asc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { Tx } from '../db/queries/domain';
import { addDaysIso, localIsoDate } from '../lib/dates';
import { fxNeedFor, fxSeriesId } from './fx';
import { truncateError } from './providers/http';
import { FxClosesError, type FxClosesClient } from './providers/types';
import type { Cooldowns } from './refresh';

/** Assets the backfill handles per run (stage-4.md §4.6). */
export const FX_BACKFILL_MAX_PER_RUN = 10;
/** The request window starts this many days before the purchase date and ends the day after. */
export const FX_BACKFILL_LOOKBACK_DAYS = 10;
/** A (currency, date) pair is retried at most once in this long (FEAS-9). */
export const FX_BACKFILL_RETRY_MS = 24 * 3_600_000;
/** Significant digits of a stored purchase FX rate. */
export const FX_RATE_SIGNIFICANT_DIGITS = 12;

export interface FxBackfillCounts {
  /** Assets the run chose (≤ FX_BACKFILL_MAX_PER_RUN). */
  requested: number;
  /** Assets whose rate was written. */
  filled: number;
  /** Assets whose pair failed this run (a request error, or no close on or before the date). */
  failed: number;
  /**
   * Assets not attempted (pair tried within the last day, cool-down, rate limit, deadline,
   * shutdown) or whose row changed while the run was fetching.
   */
  skipped: number;
}

export function emptyFxBackfillCounts(): FxBackfillCounts {
  return { requested: 0, filled: 0, failed: 0, skipped: 0 };
}

// ─── Small pure helpers ─────────────────────────────────────────────────────────────────────────

// The server-local calendar date (the series history's date rule) and the day arithmetic are the
// shared server helpers (CODE-9); re-exported for the callers and tests that import them here.
export { addDaysIso, localIsoDate };

/**
 * The currency whose `<CCY>AUD=X` closes an asset's purchase rate needs: `GBX` → `GBP`, a 3-letter
 * code as itself (USD included: the backfill reads `USDAUD=X`), null for AUD or an unusable code.
 */
export function fxFetchCurrency(currency: string): string | null {
  const need = fxNeedFor(currency);
  if (need === null || need.kind === 'aud') return null;
  return need.kind === 'usd' ? 'USD' : need.ccy;
}

/** The last close dated on or before `date` (closes in any order); null when none. */
export function lastCloseOnOrBefore<T extends { date: IsoDate }>(
  closes: readonly T[],
  date: IsoDate,
): T | null {
  let found: T | null = null;
  for (const c of closes) {
    if (c.date <= date && (found === null || c.date >= found.date)) found = c;
  }
  return found;
}

/**
 * The stored purchase rate from a close (AUD per unit of the fetched currency): `GBX` rows store the
 * per-penny rate (÷ 100); 12 significant digits.
 */
export function purchaseFxRateFrom(close: DecimalString, currency: string): DecimalString {
  const perUnit = new JoinrDecimal(close).div(currency.toUpperCase() === 'GBX' ? 100 : 1);
  return normaliseDecimal(perUnit.toSignificantDigits(FX_RATE_SIGNIFICANT_DIGITS));
}

// ─── Attempt times (in memory, like the cool-downs) ─────────────────────────────────────────────

const pairKey = (ccy: string, date: IsoDate): string => `${ccy}|${date}`;

/**
 * When each (currency, date) pair was last attempted without a rate; such a pair is retried at most
 * once a day. A pair that answered with a rate is forgotten, so another asset bought in the same
 * currency on the same date is filled on the next run (integration fix, stage-4.md Scaffold notes).
 */
export class FxBackfillAttempts {
  private readonly at = new Map<string, number>();

  lastAttempt(ccy: string, date: IsoDate): number | null {
    return this.at.get(pairKey(ccy, date)) ?? null;
  }

  record(ccy: string, date: IsoDate, now: Date): void {
    this.at.set(pairKey(ccy, date), now.getTime());
  }

  /** The pair answered with a rate: nothing to wait for. */
  forget(ccy: string, date: IsoDate): void {
    this.at.delete(pairKey(ccy, date));
  }

  /** Attempted less than FX_BACKFILL_RETRY_MS ago. */
  isRecent(ccy: string, date: IsoDate, now: Date): boolean {
    const t = this.lastAttempt(ccy, date);
    return t !== null && now.getTime() - t < FX_BACKFILL_RETRY_MS;
  }
}

/**
 * The attempt times live as long as the FX-closes client they were made with (one per market data
 * service, built once in `buildProviders`), so they survive between runs without widening the
 * frozen `Providers` or `RefreshContext` shapes.
 */
const attemptsByClient = new WeakMap<FxClosesClient, FxBackfillAttempts>();

export function fxBackfillAttemptsFor(client: FxClosesClient): FxBackfillAttempts {
  let attempts = attemptsByClient.get(client);
  if (!attempts) {
    attempts = new FxBackfillAttempts();
    attemptsByClient.set(client, attempts);
  }
  return attempts;
}

// ─── Target selection ───────────────────────────────────────────────────────────────────────────

export interface FxBackfillTarget {
  id: number;
  /** As stored when the run chose it (the identity check compares it again before writing). */
  currency: string;
  purchaseDate: IsoDate;
  /** The pair's currency (`GBX` → `GBP`). */
  fetchCcy: string;
}

/**
 * Assets with a non-AUD currency, a purchase date, a null `purchase_fx_rate` and a source other
 * than `user`; least recently attempted first (never attempted first, then id order); at most
 * `max` of them.
 */
export function selectFxBackfillTargets(
  db: JoinrDb,
  attempts: FxBackfillAttempts,
  max = FX_BACKFILL_MAX_PER_RUN,
): FxBackfillTarget[] {
  const rows = db
    .select({ id: otherAssets.id, currency: otherAssets.currency, date: otherAssets.purchaseDate })
    .from(otherAssets)
    .where(
      and(
        ne(otherAssets.currency, 'AUD'),
        isNotNull(otherAssets.purchaseDate),
        isNull(otherAssets.purchaseFxRate),
        or(isNull(otherAssets.purchaseFxSource), ne(otherAssets.purchaseFxSource, 'user')),
      ),
    )
    .orderBy(asc(otherAssets.id))
    .all();
  const candidates: Array<FxBackfillTarget & { attemptedAt: number }> = [];
  for (const r of rows) {
    if (r.date === null || !isIsoDateString(r.date)) continue;
    const fetchCcy = fxFetchCurrency(r.currency);
    if (fetchCcy === null) continue;
    const attemptedAt = attempts.lastAttempt(fetchCcy, r.date) ?? -Infinity;
    candidates.push({
      id: r.id,
      currency: r.currency,
      purchaseDate: r.date,
      fetchCcy,
      attemptedAt,
    });
  }
  // Stable sort: never attempted (−∞) first, then the oldest attempt; ties keep id order.
  candidates.sort((a, b) => a.attemptedAt - b.attemptedAt || a.id - b.id);
  return candidates
    .slice(0, Math.max(0, max))
    .map(({ id, currency, purchaseDate, fetchCcy }) => ({ id, currency, purchaseDate, fetchCcy }));
}

// ─── The fetch (before the job's write transaction) ─────────────────────────────────────────────

export type FxPairResult =
  | {
      kind: 'ok';
      closes: { date: IsoDate; close: DecimalString }[];
      /** The last close on or before the purchase date. */
      rate: { date: IsoDate; close: DecimalString };
    }
  /** A request error, or closes without one on or before the date (the closes are still kept). */
  | { kind: 'failed'; error: string; closes: { date: IsoDate; close: DecimalString }[] }
  | { kind: 'skipped' };

export interface FxBackfillFetch {
  targets: FxBackfillTarget[];
  /** By `fetchCcy|purchaseDate`. */
  pairs: Map<string, FxPairResult>;
  /** A 429/403 stopped the backfill and started the shared Yahoo cool-down. */
  rateLimited: boolean;
}

export interface FxBackfillContext {
  db: JoinrDb;
  client: FxClosesClient;
  cooldowns: Cooldowns;
  now: () => Date;
  /** The job's signal combined with the run deadline. */
  signal: AbortSignal;
  /** Defaults to the attempt times kept with `client`. */
  attempts?: FxBackfillAttempts;
  /** Defaults to FX_BACKFILL_MAX_PER_RUN. */
  maxPerRun?: number;
}

/** Fetches the closes for the run's targets, one request per distinct (currency, date), in order. */
export async function fetchFxBackfill(ctx: FxBackfillContext): Promise<FxBackfillFetch> {
  const attempts = ctx.attempts ?? fxBackfillAttemptsFor(ctx.client);
  const targets = selectFxBackfillTargets(ctx.db, attempts, ctx.maxPerRun);
  const pairs = new Map<string, FxPairResult>();
  let rateLimited = false;

  for (const t of targets) {
    const key = pairKey(t.fetchCcy, t.purchaseDate);
    if (pairs.has(key)) continue;
    const now = ctx.now();
    if (
      rateLimited ||
      ctx.signal.aborted ||
      attempts.isRecent(t.fetchCcy, t.purchaseDate, now) ||
      ctx.cooldowns.isCooling('yahoo', now)
    ) {
      pairs.set(key, { kind: 'skipped' });
      continue;
    }
    let closes: { date: IsoDate; close: DecimalString }[];
    try {
      closes = await ctx.client.fetchCloses(
        t.fetchCcy,
        addDaysIso(t.purchaseDate, -FX_BACKFILL_LOOKBACK_DAYS),
        addDaysIso(t.purchaseDate, 1),
        ctx.signal,
      );
    } catch (err) {
      if (err instanceof FxClosesError && err.kind === 'rate_limited') {
        // Not recorded as an attempt: the provider asked us to wait, the date is not at fault.
        rateLimited = true;
        ctx.cooldowns.start('yahoo', ctx.now(), err.retryAfterMs);
        pairs.set(key, { kind: 'skipped' });
      } else if (err instanceof FxClosesError && err.kind === 'skipped') {
        pairs.set(key, { kind: 'skipped' });
      } else {
        // A client never throws anything else for a response; this guards the run against a bug.
        const error = err instanceof FxClosesError ? err.message : 'Unexpected error';
        attempts.record(t.fetchCcy, t.purchaseDate, ctx.now());
        pairs.set(key, { kind: 'failed', error: truncateError(error), closes: [] });
      }
      continue;
    }
    const rate = lastCloseOnOrBefore(closes, t.purchaseDate);
    // Only a pair without a rate spends the day's attempt; one with a rate is forgotten.
    if (rate === null) attempts.record(t.fetchCcy, t.purchaseDate, ctx.now());
    else attempts.forget(t.fetchCcy, t.purchaseDate);
    pairs.set(
      key,
      rate === null
        ? { kind: 'failed', error: 'No FX close on or before the purchase date', closes }
        : { kind: 'ok', closes, rate },
    );
  }
  return { targets, pairs, rateLimited };
}

// ─── The writes (inside the job's write transaction) ────────────────────────────────────────────

function upsertHistory(
  tx: Tx,
  row: { seriesId: string; date: IsoDate; value: DecimalString; source: string; fetchedAt: string },
): void {
  const set = { value: row.value, source: row.source, fetchedAt: row.fetchedAt };
  tx.insert(marketQuoteHistory)
    .values(row)
    .onConflictDoUpdate({ target: [marketQuoteHistory.seriesId, marketQuoteHistory.date], set })
    .run();
}

/**
 * Writes the backfill: the fetched closes into `market_quote_history` (`FX_<CCY>AUD`), then each
 * target's rate (`purchase_fx_rate` ÷ 100 for `GBX`, 12 significant digits; source `market`; the
 * close's date) only when the row still has the currency and purchase date the run chose, a null
 * rate and a source other than `user`. `origin` is never touched.
 */
export function writeFxBackfill(
  tx: Tx,
  fetched: FxBackfillFetch,
  o: { fetchedAt: string; source: string },
): FxBackfillCounts {
  const counts = emptyFxBackfillCounts();
  counts.requested = fetched.targets.length;

  for (const [key, result] of fetched.pairs) {
    if (result.kind === 'skipped') continue;
    const seriesId = fxSeriesId(key.slice(0, key.indexOf('|')));
    for (const c of result.closes) {
      upsertHistory(tx, {
        seriesId,
        date: c.date,
        value: c.close,
        source: o.source,
        fetchedAt: o.fetchedAt,
      });
    }
  }

  for (const t of fetched.targets) {
    const result = fetched.pairs.get(pairKey(t.fetchCcy, t.purchaseDate));
    if (result === undefined || result.kind === 'skipped') {
      counts.skipped += 1;
      continue;
    }
    if (result.kind === 'failed') {
      counts.failed += 1;
      continue;
    }
    const changes = tx
      .update(otherAssets)
      .set({
        purchaseFxRate: purchaseFxRateFrom(result.rate.close, t.currency),
        purchaseFxSource: 'market',
        purchaseFxDate: result.rate.date,
      })
      .where(
        and(
          eq(otherAssets.id, t.id),
          eq(otherAssets.currency, t.currency),
          eq(otherAssets.purchaseDate, t.purchaseDate),
          isNull(otherAssets.purchaseFxRate),
          or(isNull(otherAssets.purchaseFxSource), ne(otherAssets.purchaseFxSource, 'user')),
        ),
      )
      .run().changes;
    // A row edited, deleted or replaced while the run was fetching is left alone.
    if (changes > 0) counts.filled += 1;
    else counts.skipped += 1;
  }
  return counts;
}

/**
 * The daily series history (stage-4.md §4.6 item 3): one row per series per server-local day of
 * its as-of; a later write for the same day replaces it. Returns the rows written.
 */
export function writeSeriesHistory(
  tx: Tx,
  series: ReadonlyArray<{ seriesId: string; value: DecimalString; asOf: string; source: string }>,
  fetchedAt: string,
): number {
  let written = 0;
  for (const s of series) {
    const at = Date.parse(s.asOf);
    if (Number.isNaN(at)) continue;
    upsertHistory(tx, {
      seriesId: s.seriesId,
      date: localIsoDate(new Date(at)),
      value: s.value,
      source: s.source,
      fetchedAt,
    });
    written += 1;
  }
  return written;
}
