// CoinGecko provider (stage-1.md §5.2): one batched /simple/price call (≤ 100 ids) in AUD, and a
// /search call to resolve a coin symbol to an id (lowest market-cap rank among exact symbol matches).
// Stage 9 (stage-9.md §5.2): a per-coin day chart (`/coins/<id>/market_chart?days=1`) for crypto's
// day since 00:00 (D142; `cryptoDayFrom` in ../day.ts turns it into a row).
import { decimalFromNumber } from '@joinr/schema';
import { failureFor, finitePositive, getJson, isRecord, unixToIso } from './http';
import type {
  CoinDayChartClient,
  CoinIdResolver,
  CoinSearchResult,
  DayChartResult,
  PriceProviderClient,
  Quote,
  QuoteBatch,
  QuoteFailure,
  QuoteRequest,
} from './types';

export const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
export const COINGECKO_BATCH_SIZE = 100;

export function coinGeckoPriceUrl(ids: readonly string[]): string {
  const list = ids.map((id) => encodeURIComponent(id)).join(',');
  return `${COINGECKO_API_BASE}/simple/price?ids=${list}&vs_currencies=aud&include_last_updated_at=true`;
}

export function coinGeckoSearchUrl(query: string): string {
  return `${COINGECKO_API_BASE}/search?query=${encodeURIComponent(query)}`;
}

/** Stage 9: one coin's AUD prices over the last day (five-minute points on UTC marks). */
export function coinGeckoDayChartUrl(id: string): string {
  return `${COINGECKO_API_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=aud&days=1`;
}

/** The `prices` of a /market_chart body: `[epochMs, aud]` pairs with finite values; null when malformed. */
export function parseMarketChart(body: unknown): Array<[number, number]> | null {
  if (!isRecord(body) || !Array.isArray(body.prices)) return null;
  const out: Array<[number, number]> = [];
  for (const item of body.prices as unknown[]) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [t, p] = item as [unknown, unknown];
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue;
    if (finitePositive(p) === null) continue;
    out.push([t, p as number]);
  }
  return out;
}

export interface CoinGeckoOptions {
  fetchImpl: typeof fetch;
  now: () => Date;
  timeoutMs?: number;
}

const HEADERS = { Accept: 'application/json' };

/** Quotes for the requested ids from a /simple/price body; a missing id is a failure. */
export function parseSimplePrice(
  reqs: readonly QuoteRequest[],
  body: unknown,
  now: Date,
): QuoteBatch {
  const quotes: Quote[] = [];
  const failures: QuoteFailure[] = [];
  if (!isRecord(body)) {
    for (const req of reqs)
      failures.push({ key: req.key, error: 'Malformed response', retryable: true });
    return { quotes, failures };
  }
  for (const req of reqs) {
    const entry = Object.hasOwn(body, req.symbol) ? body[req.symbol] : undefined;
    const aud = isRecord(entry) ? finitePositive(entry.aud) : null;
    if (!isRecord(entry) || aud === null) {
      failures.push({ key: req.key, error: 'Unknown CoinGecko id', retryable: false });
      continue;
    }
    quotes.push({
      key: req.key,
      price: decimalFromNumber(aud),
      currency: 'AUD',
      asOf: unixToIso(entry.last_updated_at) ?? now.toISOString(),
    });
  }
  return { quotes, failures };
}

/**
 * Picks the coin id for `symbol` from a /search body: exact symbol matches (case-insensitive),
 * lowest non-null `market_cap_rank`; when no match is ranked, the first match.
 */
export function pickCoinId(symbol: string, body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.coins)) return null;
  const wanted = symbol.trim().toLowerCase();
  let best: { id: string; rank: number | null } | null = null;
  for (const coin of body.coins as unknown[]) {
    if (!isRecord(coin) || typeof coin.id !== 'string' || typeof coin.symbol !== 'string') continue;
    if (coin.id === '' || coin.symbol.toLowerCase() !== wanted) continue;
    const rank =
      typeof coin.market_cap_rank === 'number' && Number.isFinite(coin.market_cap_rank)
        ? coin.market_cap_rank
        : null;
    if (best === null) {
      best = { id: coin.id, rank };
    } else if (rank !== null && (best.rank === null || rank < best.rank)) {
      best = { id: coin.id, rank };
    }
  }
  return best?.id ?? null;
}

export function createCoinGeckoProvider(
  o: CoinGeckoOptions,
): PriceProviderClient & CoinIdResolver & CoinDayChartClient {
  return {
    id: 'coingecko',

    async fetchQuotes(reqs, signal): Promise<QuoteBatch> {
      const quotes: Quote[] = [];
      const failures: QuoteFailure[] = [];
      let limited: QuoteFailure | null = null;
      for (let i = 0; i < reqs.length; i += COINGECKO_BATCH_SIZE) {
        const chunk = reqs.slice(i, i + COINGECKO_BATCH_SIZE);
        if (limited || signal.aborted) {
          for (const req of chunk) {
            failures.push(
              limited
                ? { ...limited, key: req.key }
                : { key: req.key, error: 'Aborted', retryable: true, skipped: true },
            );
          }
          continue;
        }
        const ids = [...new Set(chunk.map((r) => r.symbol))];
        const outcome = await getJson({
          fetchImpl: o.fetchImpl,
          url: coinGeckoPriceUrl(ids),
          headers: HEADERS,
          runSignal: signal,
          timeoutMs: o.timeoutMs,
          now: o.now,
        });
        if (outcome.kind !== 'ok') {
          for (const req of chunk) {
            const failure = failureFor(req.key, outcome, 'Unknown CoinGecko id');
            failures.push(failure);
            if (failure.rateLimited) limited ??= failure;
          }
          continue;
        }
        const batch = parseSimplePrice(chunk, outcome.body, o.now());
        quotes.push(...batch.quotes);
        failures.push(...batch.failures);
      }
      return { quotes, failures };
    },

    async fetchDayChart(id, signal): Promise<DayChartResult> {
      const outcome = await getJson({
        fetchImpl: o.fetchImpl,
        url: coinGeckoDayChartUrl(id),
        headers: HEADERS,
        runSignal: signal,
        timeoutMs: o.timeoutMs,
        now: o.now,
      });
      if (outcome.kind !== 'ok') {
        const failure = failureFor(id, outcome, 'Unknown CoinGecko id');
        const result: DayChartResult = { ok: false, error: failure.error };
        if (failure.rateLimited) result.rateLimited = true;
        if (failure.retryAfterMs !== undefined) result.retryAfterMs = failure.retryAfterMs;
        if (failure.skipped) result.skipped = true;
        return result;
      }
      const prices = parseMarketChart(outcome.body);
      return prices === null ? { ok: false, error: 'Malformed response' } : { ok: true, prices };
    },

    async searchId(symbol, signal): Promise<CoinSearchResult> {
      const outcome = await getJson({
        fetchImpl: o.fetchImpl,
        url: coinGeckoSearchUrl(symbol),
        headers: HEADERS,
        runSignal: signal,
        timeoutMs: o.timeoutMs,
        now: o.now,
      });
      if (outcome.kind !== 'ok') {
        const failure = failureFor(symbol, outcome, `No CoinGecko match for ${symbol}`);
        const result: CoinSearchResult = { ok: false, error: failure.error };
        if (failure.rateLimited) result.rateLimited = true;
        if (failure.retryAfterMs !== undefined) result.retryAfterMs = failure.retryAfterMs;
        if (failure.skipped) result.skipped = true;
        return result;
      }
      const id = pickCoinId(symbol, outcome.body);
      return id === null
        ? { ok: false, error: `No CoinGecko match for ${symbol}` }
        : { ok: true, id };
    },
  };
}
