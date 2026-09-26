// Deterministic offline provider (MARKET_DATA_MODE=fake; e2e and demos without network, §5.2).
// AUD price = 1 + (fnv1a(symbol) % 99900) / 100; SI=F / GC=F in USD; AUDUSD=X = 0.65;
// `<CCY>AUD=X` in AUD; search returns the symbol in lower case; asOf = the clock's now.
// Stage 3 adds deterministic quarterly dividend events (`fakeDividendEvents`, stage-3.md §4.6).
// Stage 4 adds the fake FX closes for the purchase-date backfill (`fakeFxClose`, stage-4.md §4.6).
import {
  BULLION_FEEDS,
  JoinrDecimal,
  normaliseDecimal,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import {
  FxClosesError,
  type CoinIdResolver,
  type CoinSearchResult,
  type FxClosesClient,
  type PriceProviderClient,
  type Quote,
  type QuoteBatch,
  type QuoteFailure,
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

/** Stage 3 fake dividend events (stage-3.md §4.6): quarters start in these months. */
export const FAKE_DIVIDEND_MONTHS = [1, 4, 7, 10] as const;

export interface FakeDividendEvent {
  exDate: string;
  amountPerUnit: string;
  currency: string;
  closeBeforeEx: string;
  closeDate: string;
}

/** AUD per unit: 0.1 + (fnv1a(symbol) % 50) / 100. */
export function fakeDividendAmount(symbol: string): string {
  return normaliseDecimal(new JoinrDecimal(fnv1a(symbol) % 50).div(100).plus('0.1'));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function utcIso(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isWeekendUtc(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Deterministic quarterly events (MARKET_DATA_MODE=fake): an ex-date on the first weekday of
 * January, April, July and October, from two years before `now` to `now` (UTC calendar dates),
 * `fakeDividendAmount(symbol)` AUD per unit, and `fakePrice(symbol)` as the close on the weekday
 * before the ex-date.
 */
export function fakeDividendEvents(symbol: string, now: Date): FakeDividendEvent[] {
  const today = utcIso(now.getTime());
  const year = now.getUTCFullYear();
  const from = `${String(year - 2).padStart(4, '0')}${today.slice(4)}`;
  const amountPerUnit = fakeDividendAmount(symbol);
  const closeBeforeEx = fakePrice(symbol);
  const out: FakeDividendEvent[] = [];
  for (let y = year - 2; y <= year; y += 1) {
    for (const month of FAKE_DIVIDEND_MONTHS) {
      let ms = Date.UTC(y, month - 1, 1);
      while (isWeekendUtc(ms)) ms += 86_400_000;
      const exDate = utcIso(ms);
      if (exDate < from || exDate > today) continue;
      let closeMs = ms - 86_400_000;
      while (isWeekendUtc(closeMs)) closeMs -= 86_400_000;
      out.push({
        exDate,
        amountPerUnit,
        currency: 'AUD',
        closeBeforeEx,
        closeDate: utcIso(closeMs),
      });
    }
  }
  return out;
}

function fakeCurrency(symbol: string): string {
  if (symbol === 'AUDUSD=X' || Object.hasOwn(BULLION_FEEDS, symbol)) return 'USD';
  return 'AUD';
}

/** Significant digits of a stored FX rate (stage-4.md §4.6). */
const FX_SIGNIFICANT_DIGITS = 12;

/**
 * The fake FX close (stage-4.md §4.6): AUD per one unit of `ccy` (`GBX` is quoted as `GBP`, per
 * pound). `USD` → 1 ÷ `FAKE_AUDUSD`; any other code → `fakePrice('<CCY>AUD=X')`, the live fake's
 * own cross rate. 12 significant digits.
 */
export function fakeFxClose(ccy: string): DecimalString {
  const code = ccy.toUpperCase() === 'GBX' ? 'GBP' : ccy.toUpperCase();
  const rate =
    code === 'USD'
      ? new JoinrDecimal(1).div(FAKE_AUDUSD)
      : new JoinrDecimal(fakePrice(`${code}AUD=X`));
  return normaliseDecimal(rate.toSignificantDigits(FX_SIGNIFICANT_DIGITS));
}

function localIso(d: Date): IsoDate {
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoDayBefore(date: IsoDate): IsoDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError('fetchCloses: period2 must be YYYY-MM-DD');
  return utcIso(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 86_400_000);
}

/**
 * Mode `fake` (stage-4.md §4.6): one close, `fakeFxClose(ccy)`, dated the day before `period2`
 * (the purchase date in the backfill's request window) but never after the clock's local date or
 * before `period1`. Never touches the network; an aborted run rejects as skipped.
 */
export function createFakeFxClosesClient(o: { now: () => Date }): FxClosesClient {
  return {
    async fetchCloses(ccy, period1, period2, signal) {
      if (signal.aborted) throw new FxClosesError('skipped', 'Aborted');
      const today = localIso(o.now());
      let date = isoDayBefore(period2);
      if (date > today) date = today;
      if (date < period1) date = period1;
      return [{ date, close: fakeFxClose(ccy) }];
    },
  };
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
