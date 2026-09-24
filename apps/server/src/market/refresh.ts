// The `prices` job (stage-1.md §5.3–5.4): pick targets, resolve CoinGecko ids, fetch the built-in
// series, the instruments per provider and any extra FX, convert to AUD, then write everything in
// one synchronous transaction. Rate-limited, backed-off, cooled-down and deadline-aborted
// instruments count as skipped; failures keep the last good price.
import { MARKET_SERIES, type MarketSeriesId, type PriceSource } from '@joinr/schema';
import { instruments, marketQuotes, prices, priceSources, type JoinrDb } from '@joinr/schema/db';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { heldUnitsByInstrument, isHeld as isHeldUnits } from '../db/queries/holdings';
import {
  convertToAud,
  deriveSeries,
  fxNeedFor,
  fxSeriesId,
  fxYahooSymbol,
  type SeriesPoint,
} from './fx';
import { effectiveSource, loadInstrumentPriceRows, type InstrumentPriceRow } from './items';
import { truncateError } from './providers/http';
import type {
  CoinIdResolver,
  PriceProviderClient,
  Quote,
  QuoteFailure,
  Sleep,
} from './providers/types';

/** A run gives up (aborting pending requests) after this long; what succeeded is still written. */
export const RUN_DEADLINE_MS = 90_000;
/** Provider cool-down after a 429/403 without `Retry-After`. */
export const COOLDOWN_MS = 15 * 60_000;
export const MAX_SEARCHES_PER_RUN = 5;
export const SEARCH_SPACING_MS = 2_000;
/** Per-instrument backoff starts at this many consecutive failures. */
export const BACKOFF_MIN_FAILURES = 3;
const HOUR_MS = 3_600_000;
const MAX_BACKOFF_MS = 24 * HOUR_MS;
/** The longest provider cool-down a `Retry-After` header can ask for. */
export const RETRY_AFTER_MAX_MS = 24 * HOUR_MS;

export type ProviderKey = 'yahoo' | 'coingecko';

export interface Providers {
  /** Instruments with provider `yahoo`, the built-in series and FX. */
  yahoo: PriceProviderClient;
  coingecko: PriceProviderClient & CoinIdResolver;
}

/** In-memory provider cool-downs (§5.4 step 8). */
export class Cooldowns {
  private readonly until = new Map<ProviderKey, number>();

  isCooling(key: ProviderKey, now: Date): boolean {
    const t = this.until.get(key);
    return t !== undefined && now.getTime() < t;
  }

  start(key: ProviderKey, now: Date, retryAfterMs?: number): void {
    // A provider's Retry-After is honoured, but never for longer than a day.
    const ms =
      retryAfterMs !== undefined && retryAfterMs > 0
        ? Math.min(retryAfterMs, RETRY_AFTER_MAX_MS)
        : COOLDOWN_MS;
    const t = now.getTime() + ms;
    this.until.set(key, Math.max(this.until.get(key) ?? 0, t));
  }

  untilIso(key: ProviderKey): string | null {
    const t = this.until.get(key);
    return t === undefined ? null : new Date(t).toISOString();
  }
}

/** `consecutive_failures ≥ 3` and `now − last_attempt_at < min(2^(n−3) h, 24 h)`. */
export function inBackoff(
  row: { consecutiveFailures: number; lastAttemptAt: string | null } | null,
  now: Date,
): boolean {
  if (row === null || row.consecutiveFailures < BACKOFF_MIN_FAILURES || row.lastAttemptAt === null)
    return false;
  const last = Date.parse(row.lastAttemptAt);
  if (Number.isNaN(last)) return false;
  const wait = Math.min(
    2 ** (row.consecutiveFailures - BACKOFF_MIN_FAILURES) * HOUR_MS,
    MAX_BACKOFF_MS,
  );
  return now.getTime() - last < wait;
}

export interface Counts {
  requested: number;
  ok: number;
  failed: number;
  skipped: number;
}

export interface RefreshOutcome extends Counts {
  byProvider: Record<ProviderKey, Counts>;
  series: { ok: number; failed: number; skipped: number };
  searches: number;
  /** The run signal was aborted (deadline or shutdown) before the fetches finished. */
  aborted: boolean;
}

export interface RefreshContext {
  db: JoinrDb;
  providers: Providers;
  cooldowns: Cooldowns;
  now: () => Date;
  sleep: Sleep;
  signal: AbortSignal;
  log: FastifyBaseLogger;
  maxSearches?: number;
  searchSpacingMs?: number;
}

export interface RefreshOptions {
  instrumentIds?: number[];
  force?: boolean;
}

interface Target {
  id: number;
  provider: ProviderKey;
  providerSymbol: string | null;
  symbol: string;
}

type InstrumentResult =
  | {
      kind: 'ok';
      source: PriceSource;
      price: string;
      nativePrice: string;
      nativeCurrency: string;
      fxRate: string;
      asOf: string;
    }
  | { kind: 'failed'; error: string };

type SeriesResult =
  { kind: 'ok'; value: string; asOf: string; source: string } | { kind: 'failed'; error: string };

const BUILT_IN_FETCHED: MarketSeriesId[] = ['AUDUSD', 'SI_USD_OZ', 'GC_USD_OZ'];
const DERIVED: MarketSeriesId[] = ['XAG_AUD_OZ', 'XAU_AUD_OZ'];

function emptyCounts(): Counts {
  return { requested: 0, ok: 0, failed: 0, skipped: 0 };
}

function selectTargets(
  rows: InstrumentPriceRow[],
  held: Map<number, string>,
  opts: RefreshOptions,
): Array<{ target: Target; row: InstrumentPriceRow }> {
  const wanted = opts.instrumentIds ? new Set(opts.instrumentIds) : null;
  const out: Array<{ target: Target; row: InstrumentPriceRow }> = [];
  for (const row of rows) {
    const src = effectiveSource(row);
    if (src.provider === 'none') continue;
    const id = row.instrument.id;
    if (wanted ? !wanted.has(id) : !(isHeldUnits(held.get(id)) || row.instrument.isWatched))
      continue;
    out.push({
      row,
      target: {
        id,
        provider: src.provider,
        providerSymbol: src.providerSymbol,
        symbol: row.instrument.symbol,
      },
    });
  }
  return out;
}

export async function runRefresh(
  ctx: RefreshContext,
  opts: RefreshOptions = {},
): Promise<RefreshOutcome> {
  const { db, providers, cooldowns, signal } = ctx;
  const maxSearches = ctx.maxSearches ?? MAX_SEARCHES_PER_RUN;
  const searchSpacingMs = ctx.searchSpacingMs ?? SEARCH_SPACING_MS;

  const byProvider: Record<ProviderKey, Counts> = {
    yahoo: emptyCounts(),
    coingecko: emptyCounts(),
  };
  const seriesCounts = { ok: 0, failed: 0, skipped: 0 };
  const results = new Map<number, InstrumentResult>();
  const skipped = new Set<number>();
  const resolvedIds = new Map<number, string>();
  const seriesResults = new Map<string, SeriesResult>();
  let searches = 0;

  const startedAt = ctx.now();
  const rows = loadInstrumentPriceRows(db);
  const held = heldUnitsByInstrument(db);
  const selected = selectTargets(rows, held, opts);
  const targetOf = new Map(selected.map((s) => [s.target.id, s.target]));

  // Backoff and cool-down.
  const active: Target[] = [];
  for (const { target, row } of selected) {
    byProvider[target.provider].requested += 1;
    if (!opts.force && inBackoff(row.price, startedAt)) skipped.add(target.id);
    else if (cooldowns.isCooling(target.provider, startedAt)) skipped.add(target.id);
    else active.push(target);
  }

  const fail = (id: number, error: string): void => {
    results.set(id, { kind: 'failed', error: truncateError(error) });
  };
  const handleFailure = (provider: ProviderKey, id: number, f: QuoteFailure): void => {
    if (f.rateLimited) {
      cooldowns.start(provider, ctx.now(), f.retryAfterMs);
      skipped.add(id);
    } else if (f.skipped) {
      skipped.add(id);
    } else {
      fail(id, f.error);
    }
  };

  // 4. Resolve missing CoinGecko ids (≤ maxSearches per run, spaced).
  for (const target of active) {
    if (target.provider !== 'coingecko' || target.providerSymbol !== null) continue;
    if (signal.aborted || cooldowns.isCooling('coingecko', ctx.now()) || searches >= maxSearches) {
      skipped.add(target.id);
      continue;
    }
    if (searches > 0) await ctx.sleep(searchSpacingMs, signal);
    if (signal.aborted) {
      skipped.add(target.id);
      continue;
    }
    searches += 1;
    const found = await providers.coingecko.searchId(target.symbol, signal);
    if (found.ok) {
      resolvedIds.set(target.id, found.id);
      target.providerSymbol = found.id;
    } else if (found.rateLimited) {
      cooldowns.start('coingecko', ctx.now(), found.retryAfterMs);
      skipped.add(target.id);
    } else if (found.skipped) {
      skipped.add(target.id);
    } else {
      fail(target.id, found.error);
    }
  }

  // 5a. The built-in series.
  const fetchSeries = async (reqs: Array<{ seriesId: string; symbol: string }>): Promise<void> => {
    if (reqs.length === 0) return;
    if (cooldowns.isCooling('yahoo', ctx.now()) || signal.aborted) {
      seriesCounts.skipped += reqs.length;
      return;
    }
    const batch = await providers.yahoo.fetchQuotes(
      reqs.map((r) => ({ key: r.seriesId, symbol: r.symbol })),
      signal,
    );
    for (const q of batch.quotes) {
      seriesResults.set(q.key, {
        kind: 'ok',
        value: q.price,
        asOf: q.asOf,
        source: providers.yahoo.id,
      });
    }
    for (const f of batch.failures) {
      if (f.rateLimited) {
        cooldowns.start('yahoo', ctx.now(), f.retryAfterMs);
        seriesCounts.skipped += 1;
      } else if (f.skipped) {
        seriesCounts.skipped += 1;
      } else {
        seriesResults.set(f.key, { kind: 'failed', error: truncateError(f.error) });
      }
    }
  };
  await fetchSeries(
    BUILT_IN_FETCHED.map((id) => ({ seriesId: id, symbol: MARKET_SERIES[id].yahoo! })),
  );

  // 5b. Instruments by provider (different hosts, so in parallel).
  const pending = (provider: ProviderKey): Target[] =>
    active.filter((t) => t.provider === provider && !results.has(t.id) && !skipped.has(t.id));
  const yahooTargets = pending('yahoo').filter((t) => {
    if (t.providerSymbol !== null) return true;
    fail(t.id, 'No provider symbol');
    return false;
  });
  const coinTargets = pending('coingecko').filter((t) => t.providerSymbol !== null);

  const fetchProvider = async (
    key: ProviderKey,
    client: PriceProviderClient,
    targets: Target[],
  ): Promise<Quote[]> => {
    if (targets.length === 0) return [];
    if (cooldowns.isCooling(key, ctx.now()) || signal.aborted) {
      for (const t of targets) skipped.add(t.id);
      return [];
    }
    const batch = await client.fetchQuotes(
      targets.map((t) => ({ key: String(t.id), symbol: t.providerSymbol! })),
      signal,
    );
    for (const f of batch.failures) handleFailure(key, Number(f.key), f);
    return batch.quotes;
  };
  const [yahooQuotes, coinQuotes] = await Promise.all([
    fetchProvider('yahoo', providers.yahoo, yahooTargets),
    fetchProvider('coingecko', providers.coingecko, coinTargets),
  ]);

  // 5c. Extra FX for currencies other than AUD/USD.
  const crossNeeded = new Set<string>();
  for (const q of [...yahooQuotes, ...coinQuotes]) {
    const need = fxNeedFor(q.currency);
    if (need?.kind === 'cross') crossNeeded.add(need.ccy);
  }
  await fetchSeries(
    [...crossNeeded]
      .sort()
      .map((ccy) => ({ seriesId: fxSeriesId(ccy), symbol: fxYahooSymbol(ccy) })),
  );

  // Stored values back up series that were not fetched this run.
  const storedSeries = new Map(
    db
      .select()
      .from(marketQuotes)
      .all()
      .map((r) => [r.seriesId, r]),
  );
  const point = (seriesId: string): SeriesPoint | null => {
    const fresh = seriesResults.get(seriesId);
    if (fresh?.kind === 'ok') return { value: fresh.value, asOf: fresh.asOf };
    const stored = storedSeries.get(seriesId);
    return stored?.value != null && stored.asOf != null
      ? { value: stored.value, asOf: stored.asOf }
      : null;
  };

  // 5d. Derived bullion series (only when an input was fetched this run; otherwise the stored
  // value simply ages into stale).
  for (const id of DERIVED) {
    const [num, den] = MARKET_SERIES[id].derivedFrom!;
    if (seriesResults.get(num)?.kind !== 'ok' && seriesResults.get(den)?.kind !== 'ok') continue;
    const derived = deriveSeries(point(num), point(den));
    seriesResults.set(
      id,
      derived
        ? { kind: 'ok', value: derived.value, asOf: derived.asOf, source: 'derived' }
        : { kind: 'failed', error: 'Missing input series' },
    );
  }

  // 6. Convert to AUD.
  const rates = {
    audUsd: point('AUDUSD')?.value ?? null,
    cross: (ccy: string) => point(fxSeriesId(ccy))?.value ?? null,
  };
  const record = (quotes: Quote[], source: PriceSource): void => {
    for (const q of quotes) {
      const id = Number(q.key);
      const conversion = convertToAud(q.price, q.currency, rates);
      if ('error' in conversion) {
        fail(id, conversion.error);
        continue;
      }
      results.set(id, {
        kind: 'ok',
        source,
        price: conversion.price,
        nativePrice: q.price,
        nativeCurrency: q.currency,
        fxRate: conversion.fxRate,
        asOf: q.asOf,
      });
    }
  };
  record(yahooQuotes, providers.yahoo.id);
  record(coinQuotes, providers.coingecko.id);

  // Anything neither fetched nor failed (e.g. aborted mid-flight) is skipped.
  for (const t of active) if (!results.has(t.id)) skipped.add(t.id);

  // 7. One synchronous write transaction. IMMEDIATE takes the write lock up front: a deferred
  //    transaction that reads first fails with SQLITE_BUSY at once (busy_timeout is not applied)
  //    while another connection, e.g. a CLI import, holds the write lock.
  const nowIso = ctx.now().toISOString();
  const touched = [...new Set([...results.keys(), ...resolvedIds.keys()])];
  db.transaction(
    (tx) => {
      const existing = new Set(
        touched.length === 0
          ? []
          : tx
              .select({ id: instruments.id })
              .from(instruments)
              .where(inArray(instruments.id, touched))
              .all()
              .map((r) => r.id),
      );

      for (const [id, coinId] of resolvedIds) {
        if (!existing.has(id)) continue;
        const current = tx
          .select()
          .from(priceSources)
          .where(eq(priceSources.instrumentId, id))
          .get();
        if (!current) {
          tx.insert(priceSources)
            .values({
              instrumentId: id,
              provider: 'coingecko',
              providerSymbol: coinId,
              symbolOrigin: 'search',
              updatedAt: nowIso,
            })
            .run();
        } else if (current.provider === 'coingecko' && current.providerSymbol === null) {
          tx.update(priceSources)
            .set({ providerSymbol: coinId, symbolOrigin: 'search', updatedAt: nowIso })
            .where(eq(priceSources.instrumentId, id))
            .run();
        }
      }

      for (const [id, result] of results) {
        const provider = targetOf.get(id)!.provider;
        if (!existing.has(id)) {
          skipped.add(id);
          continue;
        }
        if (result.kind === 'ok') {
          const values = {
            price: result.price,
            nativePrice: result.nativePrice,
            nativeCurrency: result.nativeCurrency,
            fxRate: result.fxRate,
            asOf: result.asOf,
            fetchedAt: nowIso,
            source: result.source,
            lastAttemptAt: nowIso,
            lastStatus: 'ok' as const,
            lastError: null,
            consecutiveFailures: 0,
          };
          tx.insert(prices)
            .values({ instrumentId: id, ...values })
            .onConflictDoUpdate({ target: prices.instrumentId, set: values })
            .run();
          byProvider[provider].ok += 1;
        } else {
          tx.insert(prices)
            .values({
              instrumentId: id,
              lastAttemptAt: nowIso,
              lastStatus: 'error',
              lastError: result.error,
              consecutiveFailures: 1,
            })
            .onConflictDoUpdate({
              target: prices.instrumentId,
              set: {
                lastAttemptAt: nowIso,
                lastStatus: 'error',
                lastError: result.error,
                consecutiveFailures: sql`${prices.consecutiveFailures} + 1`,
              },
            })
            .run();
          byProvider[provider].failed += 1;
        }
      }

      for (const [seriesId, result] of seriesResults) {
        const unit =
          (MARKET_SERIES as Record<string, { unit: string } | undefined>)[seriesId]?.unit ??
          `AUD per ${seriesId.slice(3, 6)}`;
        if (result.kind === 'ok') {
          const values = {
            value: result.value,
            unit,
            asOf: result.asOf,
            fetchedAt: nowIso,
            source: result.source,
            lastAttemptAt: nowIso,
            lastStatus: 'ok' as const,
            lastError: null,
            consecutiveFailures: 0,
          };
          tx.insert(marketQuotes)
            .values({ seriesId, ...values })
            .onConflictDoUpdate({ target: marketQuotes.seriesId, set: values })
            .run();
          seriesCounts.ok += 1;
        } else {
          tx.insert(marketQuotes)
            .values({
              seriesId,
              unit,
              lastAttemptAt: nowIso,
              lastStatus: 'error',
              lastError: result.error,
              consecutiveFailures: 1,
            })
            .onConflictDoUpdate({
              target: marketQuotes.seriesId,
              set: {
                lastAttemptAt: nowIso,
                lastStatus: 'error',
                lastError: result.error,
                consecutiveFailures: sql`${marketQuotes.consecutiveFailures} + 1`,
              },
            })
            .run();
          seriesCounts.failed += 1;
        }
      }
    },
    { behavior: 'immediate' },
  );

  for (const id of skipped) {
    const t = targetOf.get(id);
    if (t && !results.has(id)) byProvider[t.provider].skipped += 1;
  }
  // Results for instruments deleted mid-run were moved to skipped inside the transaction.
  for (const [id] of results) {
    const t = targetOf.get(id)!;
    if (skipped.has(id)) byProvider[t.provider].skipped += 1;
  }

  const total = (k: keyof Counts): number => byProvider.yahoo[k] + byProvider.coingecko[k];
  return {
    requested: total('requested'),
    ok: total('ok'),
    failed: total('failed'),
    skipped: total('skipped'),
    byProvider,
    series: seriesCounts,
    searches,
    aborted: signal.aborted,
  };
}
