// Yahoo Finance chart provider (stage-1.md §5.2): one GET per symbol on a fixed host, concurrency
// 2, 250 ms spacing, 10 s per request. A 429/403 stops the batch: the remaining symbols are
// returned as rate-limited (skipped) and the service starts a cool-down.
import { decimalFromNumber } from '@joinr/schema';
import {
  BROWSER_USER_AGENT,
  failureFor,
  finitePositive,
  getJson,
  isRecord,
  unixToIso,
} from './http';
import type {
  PriceProviderClient,
  Quote,
  QuoteBatch,
  QuoteFailure,
  QuoteRequest,
  Sleep,
} from './types';

export const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
export const YAHOO_CONCURRENCY = 2;
export const YAHOO_SPACING_MS = 250;

export function yahooChartUrl(symbol: string): string {
  return `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

export interface YahooOptions {
  fetchImpl: typeof fetch;
  sleep: Sleep;
  now: () => Date;
  concurrency?: number;
  spacingMs?: number;
  timeoutMs?: number;
}

/**
 * Quote currency implied by a Yahoo exchange suffix. Used only when `meta.currency` is missing
 * (Yahoo sometimes returns a degraded `meta` for thinly traded ASX listings).
 */
export const YAHOO_SUFFIX_CURRENCIES: Readonly<Record<string, string>> = {
  '.AX': 'AUD',
  '.NZ': 'NZD',
  '.TO': 'CAD',
};

function currencyFromSymbol(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null;
  const suffix = /\.[A-Z]{1,3}$/.exec(symbol.toUpperCase())?.[0];
  return suffix === undefined ? null : (YAHOO_SUFFIX_CURRENCIES[suffix] ?? null);
}

/**
 * Parses a chart response. Price: `meta.regularMarketPrice` (finite > 0), trusted only together
 * with a valid `regularMarketTime`; otherwise the last non-null daily close with its timestamp.
 * A degraded `meta` (no currency, market time 0, a stale or wrong price) therefore falls back to
 * the daily bars, with the currency inferred from the exchange suffix.
 */
export function parseYahooChart(key: string, body: unknown): Quote | QuoteFailure {
  if (!isRecord(body) || !isRecord(body.chart)) {
    return { key, error: 'Malformed response', retryable: true };
  }
  const chart = body.chart;
  if (chart.error !== null && chart.error !== undefined) {
    return { key, error: 'Symbol not found', retryable: false };
  }
  const result: unknown = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isRecord(result) || !isRecord(result.meta)) {
    return { key, error: 'Symbol not found', retryable: false };
  }
  const meta = result.meta;
  const currency =
    typeof meta.currency === 'string' && /^[A-Za-z]{3}$/.test(meta.currency)
      ? meta.currency
      : currencyFromSymbol(meta.symbol);
  if (currency === null) return { key, error: 'No currency in response', retryable: false };

  const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];

  const marketPrice = finitePositive(meta.regularMarketPrice);
  const marketTime = unixToIso(meta.regularMarketTime);
  if (marketPrice !== null && marketTime !== null) {
    return { key, price: decimalFromNumber(marketPrice), currency, asOf: marketTime };
  }

  // Fallback: the last non-null close.
  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const quoteSeries: unknown = Array.isArray(indicators?.quote) ? indicators.quote[0] : undefined;
  const closes: unknown[] =
    isRecord(quoteSeries) && Array.isArray(quoteSeries.close) ? quoteSeries.close : [];
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const close = finitePositive(closes[i]);
    const asOf = unixToIso(timestamps[i]);
    if (close !== null && asOf !== null) {
      return { key, price: decimalFromNumber(close), currency, asOf };
    }
  }
  return { key, error: 'No price in response', retryable: true };
}

function isQuote(value: Quote | QuoteFailure): value is Quote {
  return 'price' in value;
}

export function createYahooProvider(o: YahooOptions): PriceProviderClient {
  const concurrency = Math.max(1, o.concurrency ?? YAHOO_CONCURRENCY);
  const spacingMs = o.spacingMs ?? YAHOO_SPACING_MS;
  const headers = { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' };

  async function fetchOne(req: QuoteRequest, signal: AbortSignal): Promise<Quote | QuoteFailure> {
    const outcome = await getJson({
      fetchImpl: o.fetchImpl,
      url: yahooChartUrl(req.symbol),
      headers,
      runSignal: signal,
      timeoutMs: o.timeoutMs,
      now: o.now,
    });
    if (outcome.kind !== 'ok') return failureFor(req.key, outcome);
    return parseYahooChart(req.key, outcome.body);
  }

  return {
    id: 'yahoo',
    async fetchQuotes(reqs, signal): Promise<QuoteBatch> {
      const quotes: Quote[] = [];
      const failures: QuoteFailure[] = [];
      let next = 0;
      let started = 0;
      let limited: QuoteFailure | null = null;

      const skip = (req: QuoteRequest): void => {
        if (limited) {
          const failure: QuoteFailure = { ...limited, key: req.key };
          failures.push(failure);
        } else {
          failures.push({ key: req.key, error: 'Aborted', retryable: true, skipped: true });
        }
      };

      const worker = async (): Promise<void> => {
        while (next < reqs.length) {
          const req = reqs[next++]!;
          if (limited || signal.aborted) {
            skip(req);
            continue;
          }
          if (started++ > 0 && spacingMs > 0) await o.sleep(spacingMs, signal);
          if (limited || signal.aborted) {
            skip(req);
            continue;
          }
          const result = await fetchOne(req, signal);
          if (isQuote(result)) {
            quotes.push(result);
          } else {
            failures.push(result);
            if (result.rateLimited) limited ??= result;
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, reqs.length) }, worker));
      return { quotes, failures };
    },
  };
}
