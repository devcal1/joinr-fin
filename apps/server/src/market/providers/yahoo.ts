// Yahoo Finance chart provider (stage-1.md §5.2): one GET per symbol on a fixed host, concurrency
// 2, 250 ms spacing, 10 s per request. A 429/403 stops the batch: the remaining symbols are
// returned as rate-limited (skipped) and the service starts a cool-down.
// Stage 4 (stage-4.md §4.6) adds the daily FX closes for the purchase-date FX backfill
// (`parseYahooCloses`, `createYahooFxClosesClient`).
// Stage 9 (stage-9.md §5.1): every quote is a one-day five-minute chart (the bullion inputs a
// two-day one) carrying the session's `day`; managed funds are daily requests on the five-day
// daily chart; and a refused five-minute request falls back once to the five-day daily chart.
// Stage 10 (stage-10.md §5.2) adds the daily history of the `closes` job (`yahooHistoryUrl`,
// `parseYahooSplits`, `parseYahooHistory`, `createYahooHistoryClient`); the Stage 4 FX client is
// unchanged.
import {
  CLOSES_REQUEST_TIMEOUT_MS,
  CLOSES_YAHOO_SPACING_MS,
  decimalFromNumber,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import {
  chartResultOf,
  isKnownTimeZone,
  isWeekday,
  parseYahooBars,
  parseYahooDailyDay,
  parseYahooDay,
  weekdayOfIso,
} from '../day';
import { currencyFromSymbol, localDateResolver, timeZoneFromSymbol } from './exchangeTime';
import {
  BROWSER_USER_AGENT,
  failureFor,
  finitePositive,
  getJson,
  isRecord,
  unixToIso,
} from './http';
import {
  FxClosesError,
  type FxClosesClient,
  type PriceProviderClient,
  type Quote,
  type QuoteBatch,
  type QuoteFailure,
  type QuoteRequest,
  type Sleep,
  type SplitEvent,
  type YahooHistory,
  type YahooHistoryClient,
  type YahooHistoryResult,
} from './types';

// Moved to ./exchangeTime.ts (CODE-8); re-exported so existing imports keep working.
export {
  currencyFromSymbol,
  timeZoneFromSymbol,
  YAHOO_SUFFIX_CURRENCIES,
  YAHOO_SUFFIX_TIME_ZONES,
} from './exchangeTime';

export const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
export const YAHOO_CONCURRENCY = 2;
export const YAHOO_SPACING_MS = 250;

/**
 * Stage 9 (D153): the bullion inputs, fetched with a two-day five-minute chart so the bars reach
 * back to 00:00 Melbourne at any hour.
 */
export const YAHOO_TWO_DAY_SYMBOLS: ReadonlySet<string> = new Set(['AUDUSD=X', 'SI=F', 'GC=F']);

/**
 * Stage 9 (§5.1): the price request: a one-day five-minute chart (price, previous close and today's
 * bars in one call); the bullion inputs a two-day one. Daily requests use `yahooDailyChartUrl`.
 */
export function yahooChartUrl(symbol: string): string {
  const range = YAHOO_TWO_DAY_SYMBOLS.has(symbol) ? '2d' : '1d';
  return `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=${range}&interval=5m`;
}

/** The five-day daily chart: a managed fund's daily request and the five-minute fallback (§5.1). */
export function yahooDailyChartUrl(symbol: string): string {
  return `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

/**
 * Which day a parsed chart carries (§5.1): `intraday` (a one-day five-minute chart), `twoDay` (the
 * bullion inputs: `previousClose` read first, plus every bar), `daily` (a fund's five-day chart:
 * the last two NAVs) or `none` (the five-day fallback: no day).
 */
export type YahooDayMode = 'intraday' | 'twoDay' | 'daily' | 'none';

/** Parse failures of a five-minute answer that send the request to the five-day fallback. */
const FALLBACK_ERRORS: ReadonlySet<string> = new Set(['No price in response', 'Symbol not found']);

/**
 * Stage 3 (stage-3.md §4.6): the chart request for dividend events and daily closes between two
 * unix times (seconds), on the same fixed host as prices.
 */
export function yahooDividendsUrl(symbol: string, period1: number, period2: number): string {
  if (!Number.isSafeInteger(period1) || !Number.isSafeInteger(period2)) {
    throw new RangeError('yahooDividendsUrl: periods must be whole unix seconds');
  }
  return `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div`;
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
 * Parses a chart response. Price: `meta.regularMarketPrice` (finite > 0), trusted only together
 * with a valid `regularMarketTime`; otherwise the last non-null daily close with its timestamp.
 * A degraded `meta` (no currency, market time 0, a stale or wrong price) therefore falls back to
 * the daily bars, with the currency inferred from the exchange suffix.
 */
export function parseYahooChart(
  key: string,
  body: unknown,
  mode: YahooDayMode = 'intraday',
): Quote | QuoteFailure {
  const parsed = parseYahooPrice(key, body);
  if (!isQuote(parsed) || mode === 'none') return parsed;
  const result = chartResultOf(body);
  if (result === null) return parsed;
  const day =
    mode === 'daily'
      ? parseYahooDailyDay(result, parsed.currency)
      : parseYahooDay(result, parsed.currency, { previousCloseFirst: mode === 'twoDay' });
  const quote: Quote = { ...parsed };
  if (day !== null) quote.day = day;
  if (mode === 'twoDay') quote.bars = parseYahooBars(result);
  return quote;
}

/** The price rules (Stage 1, unchanged). */
function parseYahooPrice(key: string, body: unknown): Quote | QuoteFailure {
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

  const get = (url: string, signal: AbortSignal) =>
    getJson({
      fetchImpl: o.fetchImpl,
      url,
      headers,
      runSignal: signal,
      timeoutMs: o.timeoutMs,
      now: o.now,
    });

  async function fetchOne(
    req: QuoteRequest,
    signal: AbortSignal,
    isLimited: () => QuoteFailure | null,
  ): Promise<Quote | QuoteFailure> {
    if (req.daily) {
      const outcome = await get(yahooDailyChartUrl(req.symbol), signal);
      if (outcome.kind !== 'ok') return failureFor(req.key, outcome);
      return parseYahooChart(req.key, outcome.body, 'daily');
    }
    const outcome = await get(yahooChartUrl(req.symbol), signal);
    if (outcome.kind === 'ok') {
      const mode = YAHOO_TWO_DAY_SYMBOLS.has(req.symbol) ? 'twoDay' : 'intraday';
      const parsed = parseYahooChart(req.key, outcome.body, mode);
      if (isQuote(parsed) || !FALLBACK_ERRORS.has(parsed.error)) return parsed;
    } else if (outcome.kind !== 'http' || outcome.status === 429 || outcome.status === 403) {
      return failureFor(req.key, outcome);
    }
    // The five-day fallback (§5.1): once, with the same spacing and cool-down, one attempt; only
    // its failure is recorded. Its quote carries no day.
    if (spacingMs > 0 && !signal.aborted) await o.sleep(spacingMs, signal);
    const limited = isLimited();
    if (limited) return { ...limited, key: req.key };
    if (signal.aborted) return { key: req.key, error: 'Aborted', retryable: true, skipped: true };
    const fallback = await get(yahooDailyChartUrl(req.symbol), signal);
    if (fallback.kind !== 'ok') return failureFor(req.key, fallback);
    return parseYahooChart(req.key, fallback.body, 'none');
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
          const result = await fetchOne(req, signal, () => limited);
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

// ─── Stage 4: daily FX closes for the purchase-date FX backfill (stage-4.md §4.6) ──────────────

/** The Yahoo pair quoting AUD per one unit of `ccy`: `USD` → `USDAUD=X`, `GBX` → `GBPAUD=X`. */
export function yahooFxPairSymbol(ccy: string): string {
  const code = ccy.toUpperCase();
  return `${code === 'GBX' ? 'GBP' : code}AUD=X`;
}

/** The daily chart request for `ccy`'s AUD pair between two unix times (seconds). */
export function yahooFxClosesUrl(ccy: string, period1: number, period2: number): string {
  if (!Number.isSafeInteger(period1) || !Number.isSafeInteger(period2)) {
    throw new RangeError('yahooFxClosesUrl: periods must be whole unix seconds');
  }
  const symbol = encodeURIComponent(yahooFxPairSymbol(ccy));
  return `${YAHOO_CHART_BASE}${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
}

export interface DailyClose {
  date: IsoDate;
  /** 12 significant digits. */
  close: DecimalString;
}

export type YahooClosesParse =
  { ok: true; closes: DailyClose[] } | { ok: false; error: string; retryable: boolean };

/**
 * Parses a daily `v8/finance/chart` response into its closes (pure):
 * - not a chart → "Malformed response"; `chart.error` or no result → "Symbol not found";
 * - each non-null, finite, positive `indicators.quote[0].close` with a usable timestamp becomes
 *   `{ date, close }`, the date being the bar's calendar date in `meta.exchangeTimezoneName`
 *   (else `meta.gmtoffset`, else the symbol suffix's zone: the Stage 3 resolver), never the raw UTC
 *   date (Yahoo stamps FX bars at 00:00 London time, which is 23:00 UTC the day before in summer);
 * - oldest first, one close per date (the later bar of a date wins);
 * - no bars → a success with none; bars but no usable time zone → "No exchange time zone in
 *   response".
 */
export function parseYahooCloses(body: unknown): YahooClosesParse {
  if (!isRecord(body) || !isRecord(body.chart)) {
    return { ok: false, error: 'Malformed response', retryable: true };
  }
  const chart = body.chart;
  if (chart.error !== null && chart.error !== undefined) {
    return { ok: false, error: 'Symbol not found', retryable: false };
  }
  const result: unknown = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isRecord(result) || !isRecord(result.meta)) {
    return { ok: false, error: 'Symbol not found', retryable: false };
  }

  const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const quote: unknown = Array.isArray(indicators?.quote) ? indicators.quote[0] : undefined;
  const rawCloses: unknown[] = isRecord(quote) && Array.isArray(quote.close) ? quote.close : [];
  const bars: Array<{ unix: number; close: number }> = [];
  const n = Math.min(timestamps.length, rawCloses.length);
  for (let i = 0; i < n; i += 1) {
    const close = finitePositive(rawCloses[i]);
    const ts = timestamps[i];
    if (close !== null && typeof ts === 'number') bars.push({ unix: ts, close });
  }
  if (bars.length === 0) return { ok: true, closes: [] };

  const localDate = localDateResolver(result.meta);
  if (localDate === null) {
    return { ok: false, error: 'No exchange time zone in response', retryable: false };
  }
  const byDate = new Map<IsoDate, DecimalString>();
  for (const bar of bars) {
    const date = localDate(bar.unix);
    // Array order: a later bar of the same date replaces an earlier one.
    if (date !== null) byDate.set(date, decimalFromNumber(bar.close));
  }
  const closes = [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ok: true, closes };
}

export interface YahooFxClosesOptions {
  fetchImpl: typeof fetch;
  sleep: Sleep;
  now: () => Date;
  timeoutMs?: number;
  /** The least time between two request starts (the provider's spacing). */
  spacingMs?: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date → unix seconds at 00:00 UTC. */
function unixOfIsoDate(date: IsoDate, name: string): number {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new RangeError(`fetchCloses: ${name} must be YYYY-MM-DD`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000);
}

/**
 * The live FX-closes client (stage-4.md §4.6): one GET per call on the fixed Yahoo host, with the
 * provider's spacing (measured from the previous request's start), per-request timeout and
 * User-Agent. `period1`/`period2` become unix seconds at 00:00 UTC. The caller (the backfill) owns
 * the cool-down, the deadline and the retry policy.
 */
export function createYahooFxClosesClient(o: YahooFxClosesOptions): FxClosesClient {
  const spacingMs = Math.max(0, o.spacingMs ?? YAHOO_SPACING_MS);
  const headers = { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' };
  let lastStartMs: number | null = null;

  return {
    async fetchCloses(ccy, period1, period2, signal) {
      const url = yahooFxClosesUrl(
        ccy,
        unixOfIsoDate(period1, 'period1'),
        unixOfIsoDate(period2, 'period2'),
      );
      if (signal.aborted) throw new FxClosesError('skipped', 'Aborted');
      if (lastStartMs !== null && spacingMs > 0) {
        const wait = Math.min(spacingMs, lastStartMs + spacingMs - o.now().getTime());
        if (wait > 0) await o.sleep(wait, signal);
        if (signal.aborted) throw new FxClosesError('skipped', 'Aborted');
      }
      lastStartMs = o.now().getTime();
      const outcome = await getJson({
        fetchImpl: o.fetchImpl,
        url,
        headers,
        runSignal: signal,
        timeoutMs: o.timeoutMs,
        now: o.now,
      });
      if (outcome.kind === 'aborted') throw new FxClosesError('skipped', 'Aborted');
      if (outcome.kind !== 'ok') {
        const failure = failureFor(ccy, outcome);
        if (failure.rateLimited) {
          throw new FxClosesError('rate_limited', failure.error, failure.retryAfterMs);
        }
        throw new FxClosesError('failed', failure.error);
      }
      const parsed = parseYahooCloses(outcome.body);
      if (!parsed.ok) throw new FxClosesError('failed', parsed.error);
      return parsed.closes;
    },
  };
}

// ─── Stage 10: the daily history of the `closes` job (stage-10.md §5.2) ────────────────────────

/**
 * The daily history request: `period1`/`period2` in unix seconds, daily bars and the split events.
 * Never `range=max`: Yahoo silently downgrades it to monthly or quarterly bars.
 */
export function yahooHistoryUrl(symbol: string, period1: number, period2: number): string {
  if (!Number.isSafeInteger(period1) || !Number.isSafeInteger(period2)) {
    throw new RangeError('yahooHistoryUrl: periods must be whole unix seconds');
  }
  return `${YAHOO_CHART_BASE}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=split`;
}

/**
 * `events.splits` of a chart body (pure): each event with a finite numerator and denominator
 * greater than 0 and a ratio other than 1, dated in the exchange's zone (the Stage 4 resolver),
 * one per date, oldest first. A body without `events` (or without a usable zone) → none.
 */
export function parseYahooSplits(body: unknown): SplitEvent[] {
  const result = chartResultOf(body);
  if (result === null || !isRecord(result.meta) || !isRecord(result.events)) return [];
  const splits = result.events.splits;
  if (!isRecord(splits)) return [];
  const localDate = localDateResolver(result.meta);
  if (localDate === null) return [];
  const byDate = new Map<IsoDate, SplitEvent>();
  for (const event of Object.values(splits)) {
    if (!isRecord(event) || typeof event.date !== 'number') continue;
    const numerator = finitePositive(event.numerator);
    const denominator = finitePositive(event.denominator);
    if (numerator === null || denominator === null || numerator === denominator) continue;
    const date = localDate(event.date);
    if (date === null) continue;
    byDate.set(date, {
      date,
      numerator: decimalFromNumber(numerator),
      denominator: decimalFromNumber(denominator),
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The FROZEN filter (§5.2): keep a close only when its date is a weekday and earlier than `today`
 * (today's date in the same zone). Drops the live partial bar, the weekend FX bar and today's
 * session; a gap stays a gap.
 */
export function filterHistoryCloses<T extends { date: IsoDate }>(
  closes: readonly T[],
  today: IsoDate,
): T[] {
  return closes.filter((c) => c.date < today && isWeekday(weekdayOfIso(c.date)));
}

/**
 * A daily history body → its closes (`parseYahooCloses`: `close`, not `adjclose`, so dividends are
 * not counted; nulls skipped; then the §5.2 filter against `now` in the exchange's zone), splits,
 * zone, currency and listing date (pure).
 */
export function parseYahooHistory(
  body: unknown,
  now: Date,
): { ok: true; history: YahooHistory } | { ok: false; error: string } {
  const parsed = parseYahooCloses(body);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = chartResultOf(body);
  const meta = result !== null && isRecord(result.meta) ? result.meta : {};
  const localDate = localDateResolver(meta);
  const today = localDate?.(Math.floor(now.getTime() / 1000)) ?? null;
  if (today === null && parsed.closes.length > 0) {
    return { ok: false, error: 'No exchange time zone in response' };
  }
  const zoneName = meta.exchangeTimezoneName;
  const timeZone = isKnownTimeZone(zoneName) ? zoneName : timeZoneFromSymbol(meta.symbol);
  const currency =
    typeof meta.currency === 'string' && /^[A-Za-z]{3}$/.test(meta.currency)
      ? meta.currency
      : currencyFromSymbol(meta.symbol);
  const first = meta.firstTradeDate;
  const firstTradeDate = typeof first === 'number' && localDate !== null ? localDate(first) : null;
  return {
    ok: true,
    history: {
      closes: today === null ? [] : filterHistoryCloses(parsed.closes, today),
      splits: parseYahooSplits(body),
      timeZone,
      currency,
      firstTradeDate,
    },
  };
}

export interface YahooHistoryOptions {
  fetchImpl: typeof fetch;
  sleep: Sleep;
  now: () => Date;
  /** Default CLOSES_REQUEST_TIMEOUT_MS (a history answer can be over 1 MB). */
  timeoutMs?: number;
  /** The least time between two request starts; default CLOSES_YAHOO_SPACING_MS. */
  spacingMs?: number;
}

/**
 * The live daily-history client (§5.2): any symbol, on the fixed Yahoo host, with the browser
 * User-Agent, spaced from the previous request's start; `period1` = the request's date at
 * 00:00 UTC and `period2` = now. A sibling of the Stage 4 FX client, which it leaves unchanged.
 */
export function createYahooHistoryClient(o: YahooHistoryOptions): YahooHistoryClient {
  const spacingMs = Math.max(0, o.spacingMs ?? CLOSES_YAHOO_SPACING_MS);
  const timeoutMs = o.timeoutMs ?? CLOSES_REQUEST_TIMEOUT_MS;
  const headers = { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' };
  let lastStartMs: number | null = null;
  const skipped: YahooHistoryResult = { ok: false, kind: 'skipped', error: 'Aborted' };

  return {
    id: 'yahoo',
    async fetchHistory(req, signal): Promise<YahooHistoryResult> {
      const period1 = unixOfIsoDate(req.from, 'from');
      if (signal.aborted) return skipped;
      if (lastStartMs !== null && spacingMs > 0) {
        const wait = Math.min(spacingMs, lastStartMs + spacingMs - o.now().getTime());
        if (wait > 0) await o.sleep(wait, signal);
        if (signal.aborted) return skipped;
      }
      const startMs = o.now().getTime();
      lastStartMs = startMs;
      const period2 = Math.max(period1, Math.floor(startMs / 1000));
      const outcome = await getJson({
        fetchImpl: o.fetchImpl,
        url: yahooHistoryUrl(req.symbol, period1, period2),
        headers,
        runSignal: signal,
        timeoutMs,
        now: o.now,
      });
      if (outcome.kind === 'aborted') return skipped;
      if (outcome.kind !== 'ok') {
        const failure = failureFor(req.symbol, outcome);
        if (!failure.rateLimited) return { ok: false, kind: 'failed', error: failure.error };
        const limited: YahooHistoryResult = {
          ok: false,
          kind: 'rate_limited',
          error: failure.error,
        };
        if (failure.retryAfterMs !== undefined) limited.retryAfterMs = failure.retryAfterMs;
        return limited;
      }
      const parsed = parseYahooHistory(outcome.body, o.now());
      return parsed.ok
        ? { ok: true, history: parsed.history }
        : { ok: false, kind: 'failed', error: parsed.error };
    },
  };
}
