// Price provider contract (stage-1.md §5.2). Every provider takes an injected `fetchImpl`, so unit
// tests never touch the network.
import type { DecimalString, IsoDate } from '@joinr/schema';

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

/**
 * Stage 4 (stage-4.md §4.6, FEAS-3): daily FX closes for the purchase-date FX backfill. `ccy` is the
 * foreign currency (`USD`, `GBP`; `GBX` is fetched as `GBP`) and each close is AUD per one unit of
 * it (the `<CCY>AUD=X` pair), dated in the exchange's time zone, oldest first, one per date.
 * `period1` and `period2` bound the request (calendar dates). A client rejects only with an
 * `FxClosesError`, whose message is short and never carries a URL or a response body.
 */
export interface FxClosesClient {
  fetchCloses(
    ccy: string,
    period1: IsoDate,
    period2: IsoDate,
    signal: AbortSignal,
  ): Promise<{ date: IsoDate; close: DecimalString }[]>;
}

/**
 * Why `FxClosesClient.fetchCloses` rejected: `rate_limited` (429/403: the backfill stops and starts
 * the shared Yahoo cool-down), `skipped` (aborted by the run: deadline or shutdown) or `failed`.
 */
export type FxClosesErrorKind = 'rate_limited' | 'skipped' | 'failed';

export class FxClosesError extends Error {
  readonly kind: FxClosesErrorKind;
  /** From `Retry-After` on a rate-limited response, when the provider sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(kind: FxClosesErrorKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'FxClosesError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}
