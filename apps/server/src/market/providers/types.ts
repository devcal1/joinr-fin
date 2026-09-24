// Price provider contract (stage-1.md §5.2). Every provider takes an injected `fetchImpl`, so unit
// tests never touch the network.

export interface QuoteRequest {
  /** The caller's key (an instrument id, a series id); echoed back on the quote or failure. */
  key: string;
  /** The provider's symbol: `ABC.AX`, `SI=F`, `AUDUSD=X`, `bitcoin`. */
  symbol: string;
}

export interface Quote {
  key: string;
  /** Normalised decimal string, in `currency`. */
  price: string;
  /** As the provider reports it: `AUD`, `USD`, `GBp`. */
  currency: string;
  /** Market time of the price (ISO-8601 UTC). */
  asOf: string;
}

export interface QuoteFailure {
  key: string;
  /** Short, safe to store and show (≤ 200 chars; no URLs, no stack). */
  error: string;
  retryable: boolean;
  /** 429/403: the provider asked us to slow down (counted as skipped, starts a cool-down). */
  rateLimited?: boolean;
  /** From `Retry-After`, when the provider sent one. */
  retryAfterMs?: number;
  /** Not attempted, or aborted by the run (deadline, shutdown): counted as skipped. */
  skipped?: boolean;
}

export interface QuoteBatch {
  quotes: Quote[];
  failures: QuoteFailure[];
}

export interface PriceProviderClient {
  id: 'yahoo' | 'coingecko' | 'fake';
  fetchQuotes(reqs: QuoteRequest[], signal: AbortSignal): Promise<QuoteBatch>;
}

/** A CoinGecko id search (§5.2 id resolution). */
export type CoinSearchResult =
  | { ok: true; id: string }
  | { ok: false; error: string; rateLimited?: boolean; retryAfterMs?: number; skipped?: boolean };

export interface CoinIdResolver {
  searchId(symbol: string, signal: AbortSignal): Promise<CoinSearchResult>;
}

/** Waits `ms`; resolves early (never rejects) when `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
