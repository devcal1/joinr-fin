// Deterministic offline provider (MARKET_DATA_MODE=fake; e2e and demos without network, §5.2).
// AUD price = 1 + (fnv1a(symbol) % 99900) / 100; SI=F / GC=F in USD; AUDUSD=X = 0.65;
// `<CCY>AUD=X` in AUD; search returns the symbol in lower case; asOf = the clock's now.
import { BULLION_FEEDS, JoinrDecimal, normaliseDecimal } from '@joinr/schema';
import type {
  CoinIdResolver,
  CoinSearchResult,
  PriceProviderClient,
  Quote,
  QuoteBatch,
  QuoteFailure,
} from './types';

export const FAKE_AUDUSD = '0.65';

/** 32-bit FNV-1a over the UTF-16 code units of `text`. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fakePrice(symbol: string): string {
  return normaliseDecimal(new JoinrDecimal(fnv1a(symbol) % 99900).div(100).plus(1));
}

function fakeCurrency(symbol: string): string {
  if (symbol === 'AUDUSD=X' || Object.hasOwn(BULLION_FEEDS, symbol)) return 'USD';
  return 'AUD';
}

export function createFakeProvider(o: { now: () => Date }): PriceProviderClient & CoinIdResolver {
  return {
    id: 'fake',
    async fetchQuotes(reqs, signal): Promise<QuoteBatch> {
      const quotes: Quote[] = [];
      const failures: QuoteFailure[] = [];
      const asOf = o.now().toISOString();
      for (const req of reqs) {
        if (signal.aborted) {
          failures.push({ key: req.key, error: 'Aborted', retryable: true, skipped: true });
          continue;
        }
        const price = req.symbol === 'AUDUSD=X' ? FAKE_AUDUSD : fakePrice(req.symbol);
        quotes.push({ key: req.key, price, currency: fakeCurrency(req.symbol), asOf });
      }
      return { quotes, failures };
    },
    async searchId(symbol): Promise<CoinSearchResult> {
      return { ok: true, id: symbol.trim().toLowerCase() };
    },
  };
}
