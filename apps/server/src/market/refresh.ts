// The `prices` job (stage-1.md §5.3–5.4): pick targets, resolve CoinGecko ids, fetch the built-in
// series, the instruments per provider and any extra FX, convert to AUD, then write everything in
// one synchronous transaction. Rate-limited, backed-off, cooled-down and deadline-aborted
// instruments count as skipped; failures keep the last good price.
// Stage 4 (stage-4.md §4.6): the other assets' currencies join the extra FX, the purchase-date FX
// backfill runs after the instruments (fxHistory.ts), and every series written `ok` also lands in
// the daily `market_quote_history`.
// Stage 9 (stage-9.md §5.4): lite runs (the `intraday` scopes: only the given instruments, or only
// the bullion series, with no other series, cross FX, backfill or id search, and a failure writes
// nothing), the day rows (the newer-session rule), the FX series' previous closes, bullion's day
// since 00:00 (`bullionDayFrom`) and a price write that never goes backwards.
import {
  BULLION_HOLDINGS,
  MARKET_SERIES,
  type InstrumentKind,
  type MarketSeriesId,
  type PriceSource,
} from '@joinr/schema';
import {
  instruments,
  marketQuotes,
  otherAssets,
  prices,
  priceSources,
  type JoinrDb,
} from '@joinr/schema/db';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { heldUnitsByInstrument, isHeld as isHeldUnits } from '../db/queries/holdings';
import { bullionDayFrom, serverTimeZone, type DayPoint } from './day';
import {
  writeFxPreviousCloses,
  writeInstrumentDays,
  writeSeriesDays,
  type InstrumentDayWrite,
  type SeriesDayWrite,
} from './dayWrites';
import {
  convertToAud,
  deriveSeries,
  fxCurrencyOfSeries,
  fxNeedFor,
  fxSeriesId,
  fxYahooSymbol,
  type SeriesPoint,
} from './fx';
import {
  emptyFxBackfillCounts,
  fetchFxBackfill,
  writeFxBackfill,
  writeSeriesHistory,
  type FxBackfillCounts,
  type FxBackfillFetch,
} from './fxHistory';
import { effectiveSource, loadInstrumentPriceRows, type InstrumentPriceRow } from './items';
import { truncateError } from './providers/http';
import type {
  CoinDayChartClient,
  CoinIdResolver,
  FxClosesClient,
  PriceProviderClient,
  Quote,
  QuoteDay,
  QuoteFailure,
  QuoteRequest,
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
  /** Stage 9: `fetchDayChart` (crypto's day chart, §5.2); without it the charts are skipped. */
  coingecko: PriceProviderClient & CoinIdResolver & Partial<CoinDayChartClient>;
  /**
   * Stage 4 (stage-4.md §4.6): the daily FX closes for the purchase-date FX backfill (Yahoo in
   * mode live, the fake in mode fake). Absent → the backfill is skipped.
   */
  fxCloses?: FxClosesClient;
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
  /** Stage 4: the purchase-date FX backfill (all 0 when `providers.fxCloses` is absent). */
  fxBackfill: FxBackfillCounts;
  /** Stage 9: day rows written (`day_quotes` and `series_day_quotes`). */
  dayRows: number;
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
  /** Stage 9: the server's IANA zone for bullion's 00:00 (default: Intl's resolved zone). */
  timeZone?: string;
}

/** Stage 9 (§5.4): the series a lite bullion run may fetch. */
export const BULLION_INPUT_SERIES: readonly MarketSeriesId[] = ['AUDUSD', 'SI_USD_OZ', 'GC_USD_OZ'];

export interface RefreshOptions {
  instrumentIds?: number[];
  force?: boolean;
  /**
   * Stage 9 (stage-9.md §5.4): a lite run (the `intraday` scopes): only `instrumentIds`, or only
   * `seriesIds` (the bullion inputs, with their derived spot and `bullionDayFrom`); no other
   * series, cross FX, derived bullion, FX backfill or id search; conversion uses the stored FX.
   * Backoff is read but never advanced: a failure writes nothing.
   */
  lite?: true;
  /** Lite only: the bullion inputs to fetch (`AUDUSD` and the futures of the metals in use). */
  seriesIds?: MarketSeriesId[];
}

interface Target {
  id: number;
  provider: ProviderKey;
  providerSymbol: string | null;
  /** The instrument's identity when the run chose it (ids can be reused after a delete). */
  kind: InstrumentKind;
  symbol: string;
}

/** A metal's futures series and its derived AUD spot (§5.4a). */
const BULLION_SERIES = Object.values(BULLION_HOLDINGS).map((h) => ({
  futures: h.futuresSeries,
  spot: h.spotSeries,
}));

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
  // A lite run touches only the instruments it names (none for the bullion scope).
  const wanted = opts.instrumentIds
    ? new Set(opts.instrumentIds)
    : opts.lite
      ? new Set<number>()
      : null;
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
        kind: row.instrument.kind,
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
  /** Stage 9: this run's series quotes (their `day` and two-day `bars`). */
  const seriesQuotes = new Map<string, Quote>();
  /** Stage 9: the `day` of each instrument quote converted ok this run. */
  const quoteDays = new Map<number, QuoteDay>();
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

  // 4. Resolve missing CoinGecko ids (≤ maxSearches per run, spaced; never in a lite run).
  for (const target of active) {
    if (target.provider !== 'coingecko' || target.providerSymbol !== null) continue;
    if (
      opts.lite ||
      signal.aborted ||
      cooldowns.isCooling('coingecko', ctx.now()) ||
      searches >= maxSearches
    ) {
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
      seriesQuotes.set(q.key, q);
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
  // A lite run fetches only the bullion inputs it was given (none for an instrument scope).
  const seriesToFetch = opts.lite
    ? BUILT_IN_FETCHED.filter((id) => opts.seriesIds?.includes(id) === true)
    : BUILT_IN_FETCHED;
  await fetchSeries(
    seriesToFetch.map((id) => ({ seriesId: id, symbol: MARKET_SERIES[id].yahoo! })),
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
    // Stage 9 (§5.1, O8): a managed fund on Yahoo is a daily request (the five-day daily chart).
    const batch = await client.fetchQuotes(
      targets.map((t): QuoteRequest => {
        const req: QuoteRequest = { key: String(t.id), symbol: t.providerSymbol! };
        if (key === 'yahoo' && t.kind === 'managed_fund') req.daily = true;
        return req;
      }),
      signal,
    );
    for (const f of batch.failures) handleFailure(key, Number(f.key), f);
    return batch.quotes;
  };
  const [yahooQuotes, coinQuotes] = await Promise.all([
    fetchProvider('yahoo', providers.yahoo, yahooTargets),
    fetchProvider('coingecko', providers.coingecko, coinTargets),
  ]);

  // 5c. Extra FX for currencies other than AUD/USD: the quotes' currencies and (Stage 4) every
  //     other asset's currency (`GBX` → `GBP`; USD uses AUDUSD), so `FX_<CCY>AUD` stays current
  //     while an asset uses it.
  //     A lite run fetches no cross FX (conversion uses the stored rates).
  const crossNeeded = new Set<string>();
  const otherAssetCurrencies = opts.lite
    ? []
    : db
        .selectDistinct({ currency: otherAssets.currency })
        .from(otherAssets)
        .all()
        .map((r) => r.currency);
  for (const currency of [
    ...yahooQuotes.map((q) => q.currency),
    ...coinQuotes.map((q) => q.currency),
    ...otherAssetCurrencies,
  ]) {
    const need = fxNeedFor(currency);
    if (need?.kind === 'cross' && !opts.lite) crossNeeded.add(need.ccy);
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
  // value simply ages into stale). A lite run derives only the metals whose futures it fetched.
  for (const id of DERIVED) {
    const [num, den] = MARKET_SERIES[id].derivedFrom!;
    if (opts.lite && !seriesToFetch.includes(num as MarketSeriesId)) continue;
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
      if (q.day) quoteDays.set(id, q.day);
    }
  };
  record(yahooQuotes, providers.yahoo.id);
  // CoinGecko quotes carry no day: crypto's day comes from its own chart (§5.5).
  record(coinQuotes, providers.coingecko.id);
  for (const q of coinQuotes) quoteDays.delete(Number(q.key));

  // Anything neither fetched nor failed (e.g. aborted mid-flight) is skipped.
  for (const t of active) if (!results.has(t.id)) skipped.add(t.id);

  // 6a. Stage 9 (§5.4a): bullion's day since 00:00 for each metal whose futures were fetched.
  const timeZone = ctx.timeZone ?? serverTimeZone();
  const seriesDays: SeriesDayWrite[] = [];
  const audUsdBars: DayPoint[] = seriesQuotes.get('AUDUSD')?.bars ?? [];
  for (const { futures, spot } of BULLION_SERIES) {
    const futuresQuote = seriesQuotes.get(futures);
    if (futuresQuote === undefined) continue;
    const spotResult = seriesResults.get(spot);
    const day = bullionDayFrom({
      futuresBars: futuresQuote.bars ?? [],
      audUsdBars,
      futures: { price: futuresQuote.price, asOf: futuresQuote.asOf },
      spot: spotResult?.kind === 'ok' ? { value: spotResult.value, asOf: spotResult.asOf } : null,
      now: ctx.now(),
      timeZone,
    });
    const source = providers.yahoo.id;
    if (day.aud) seriesDays.push({ seriesId: spot, row: day.aud, source });
    if (day.usd) seriesDays.push({ seriesId: futures, row: day.usd, source });
  }
  // The FX series' own previous closes (D143; §3.2): `AUDUSD` and `FX_<CCY>AUD` only.
  const fxCloses: Array<{ seriesId: string; value: string; date: string }> = [];
  for (const [seriesId, q] of seriesQuotes) {
    if (seriesId !== 'AUDUSD' && fxCurrencyOfSeries(seriesId) === null) continue;
    if (q.day?.previousClose) {
      fxCloses.push({ seriesId, value: q.day.previousClose, date: q.day.sessionDate });
    }
  }

  // 6b. Stage 4: the purchase-date FX backfill (after the instruments; shares the Yahoo cool-down
  //     and the run deadline). Skipped when the providers have no FX-closes client, and in a lite
  //     run.
  const backfill: FxBackfillFetch | null =
    providers.fxCloses && !opts.lite
      ? await fetchFxBackfill({
          db,
          client: providers.fxCloses,
          cooldowns,
          now: ctx.now,
          signal,
        })
      : null;
  let fxBackfill = emptyFxBackfillCounts();

  // 7. One synchronous write transaction. IMMEDIATE takes the write lock up front: a deferred
  //    transaction that reads first fails with SQLITE_BUSY at once (busy_timeout is not applied)
  //    while another connection, e.g. a CLI import, holds the write lock.
  const nowIso = ctx.now().toISOString();
  const touched = [...new Set([...results.keys(), ...resolvedIds.keys()])];
  const instrumentDays: InstrumentDayWrite[] = [];
  let dayRows = 0;
  db.transaction(
    (tx) => {
      // Only instruments that still exist with the kind and symbol captured when the run chose
      // them: instrument ids have no AUTOINCREMENT, so a delete and a create during the fetch can
      // reuse an id for another instrument (stage-2.md §4.5).
      const existing = new Set(
        touched.length === 0
          ? []
          : tx
              .select({ id: instruments.id, kind: instruments.kind, symbol: instruments.symbol })
              .from(instruments)
              .where(inArray(instruments.id, touched))
              .all()
              .filter((r) => {
                const t = targetOf.get(r.id);
                return t !== undefined && t.kind === r.kind && t.symbol === r.symbol;
              })
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
          const attempt = {
            lastAttemptAt: nowIso,
            lastStatus: 'ok' as const,
            lastError: null,
            consecutiveFailures: 0,
          };
          const priceColumns = {
            price: result.price,
            nativePrice: result.nativePrice,
            nativeCurrency: result.nativeCurrency,
            fxRate: result.fxRate,
            asOf: result.asOf,
            fetchedAt: nowIso,
            source: result.source,
          };
          // Stage 9 (§5.4): the price never goes backwards. A stored price with a later as-of (a
          // fresher intraday run committed first) is kept; only the attempt columns move.
          const stored = tx
            .select({ asOf: prices.asOf })
            .from(prices)
            .where(eq(prices.instrumentId, id))
            .get();
          const keep = stored?.asOf != null && Date.parse(stored.asOf) > Date.parse(result.asOf);
          const values = keep ? attempt : { ...priceColumns, ...attempt };
          tx.insert(prices)
            .values({ instrumentId: id, ...priceColumns, ...attempt })
            .onConflictDoUpdate({ target: prices.instrumentId, set: values })
            .run();
          byProvider[provider].ok += 1;
          const day = quoteDays.get(id);
          if (day) {
            instrumentDays.push({
              instrumentId: id,
              row: day,
              rule: 'session',
              source: providers.yahoo.id,
            });
          }
        } else if (opts.lite) {
          // A lite failure writes nothing (backoff is never advanced by the intraday job).
          byProvider[provider].failed += 1;
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
        } else if (opts.lite) {
          seriesCounts.failed += 1;
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

      // Stage 4: the backfill's rates and closes, then the daily history of every series written
      // ok this run (after the closes, so today's row holds this run's live value).
      if (backfill) {
        fxBackfill = writeFxBackfill(tx, backfill, {
          fetchedAt: nowIso,
          source: providers.yahoo.id,
        });
      }
      const okSeries: Array<{ seriesId: string; value: string; asOf: string; source: string }> = [];
      for (const [seriesId, result] of seriesResults) {
        if (result.kind === 'ok') {
          okSeries.push({
            seriesId,
            value: result.value,
            asOf: result.asOf,
            source: result.source,
          });
        }
      }
      writeSeriesHistory(tx, okSeries, nowIso);

      // Stage 9: the day rows (the newer-session rule, §5.4) and the FX previous closes.
      dayRows += writeInstrumentDays(tx, instrumentDays, nowIso);
      dayRows += writeSeriesDays(tx, seriesDays, nowIso);
      writeFxPreviousCloses(tx, fxCloses);
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
    fxBackfill,
    dayRows,
  };
}
