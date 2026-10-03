// Deterministic offline provider (MARKET_DATA_MODE=fake; e2e and demos without network, §5.2).
// AUD price = 1 + (fnv1a(symbol) % 99900) / 100; SI=F / GC=F in USD; AUDUSD=X = 0.65;
// `<CCY>AUD=X` in AUD; search returns the symbol in lower case; asOf = the clock's now.
// Stage 3 adds deterministic quarterly dividend events (`fakeDividendEvents`, stage-3.md §4.6).
// Stage 4 adds the fake FX closes for the purchase-date backfill (`fakeFxClose`, stage-4.md §4.6).
// Stage 9 (stage-9.md §5.3) gives every Yahoo-style quote a deterministic `day` (the session's
// five-minute bars, a fund's NAV, the bullion inputs' two-day bars with the weekend gap) and its
// `asOf` the time of its last point; `EXUS` is quoted in USD; and `fetchDayChart` fakes CoinGecko's
// day chart. A lower-case symbol is a CoinGecko id (the fake search lower-cases): it keeps
// `asOf` = now (the last point of its day chart) and has no `day`.
// Stage 10 (stage-10.md §5.4) adds the fake daily histories of the `closes` job: Yahoo-style
// weekday closes anchored to the fake day's previous close, CoinGecko-style hourly or daily points
// anchored to the fake day's 00:00 base (with the keyless 401 past 365 days), flat FX.
import {
  BULLION_FEEDS,
  dateInZone,
  JoinrDecimal,
  normaliseDecimal,
  wallTimeInZone,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import { isoDayBefore, localIsoDate } from '../../lib/dates';
import {
  addDays,
  cryptoDayFrom,
  isWeekday,
  midnightOf,
  normalisePoints,
  previousWeekday,
  weekdayOfIso,
  zonedTimeToEpoch,
  type DayPoint,
} from '../day';
import { timeZoneFromSymbol } from './exchangeTime';
import {
  FxClosesError,
  type CoinDayChartClient,
  type CoinHistoryClient,
  type CoinHistoryResult,
  type CoinIdResolver,
  type CoinSearchResult,
  type DayChartResult,
  type FxClosesClient,
  type PriceProviderClient,
  type Quote,
  type QuoteBatch,
  type QuoteDay,
  type QuoteFailure,
  type QuoteRequest,
  type SplitEvent,
  type YahooHistory,
  type YahooHistoryClient,
} from './types';
import { YAHOO_TWO_DAY_SYMBOLS } from './yahoo';

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

/** The made-up US listing the fake quotes in USD (stage-9.md §3.6; M4's FX path end to end). */
export const FAKE_USD_LISTING = 'EXUS';

/** The currency the fake quotes a symbol in (USD: `AUDUSD=X`, `EXUS`, the futures; else AUD). */
export function fakeCurrency(symbol: string): string {
  if (symbol === 'AUDUSD=X' || symbol === FAKE_USD_LISTING || Object.hasOwn(BULLION_FEEDS, symbol))
    return 'USD';
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

/**
 * Mode `fake` (stage-4.md §4.6): one close, `fakeFxClose(ccy)`, dated the day before `period2`
 * (the purchase date in the backfill's request window) but never after the clock's local date or
 * before `period1`. Never touches the network; an aborted run rejects as skipped.
 */
export function createFakeFxClosesClient(o: { now: () => Date }): FxClosesClient {
  return {
    async fetchCloses(ccy, period1, period2, signal) {
      if (signal.aborted) throw new FxClosesError('skipped', 'Aborted');
      const today = localIsoDate(o.now());
      let date = isoDayBefore(period2);
      if (date > today) date = today;
      if (date < period1) date = period1;
      return [{ date, close: fakeFxClose(ccy) }];
    },
  };
}

// ─── Stage 9: the fake day (stage-9.md §5.3) ────────────────────────────────────────────────────

const STEP_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const NEW_YORK = 'America/New_York';
/** The fake listed session, local to the listing's zone. */
export const FAKE_SESSION_OPEN = { hour: 10, minute: 0 } as const;
export const FAKE_SESSION_CLOSE = { hour: 16, minute: 10 } as const;
/** A fund's fake NAV time, local. */
export const FAKE_NAV_TIME = { hour: 16, minute: 0 } as const;

/** A CoinGecko id (the fake search lower-cases the symbol); Yahoo symbols are upper-case. */
export function isFakeCoinId(symbol: string): boolean {
  return /[a-z]/.test(symbol) && symbol === symbol.toLowerCase();
}

/** `d = ((fnv1a(symbol + ':prev') % 401) − 200) ÷ 10000`: the fake day's move. */
export function fakeDayMove(symbol: string): InstanceType<typeof JoinrDecimal> {
  return new JoinrDecimal((fnv1a(`${symbol}:prev`) % 401) - 200).div(10000);
}

/** `price × (1 − d)` (6 dp); FX series (`…=X`) have no move: the price itself. */
export function fakePreviousClose(symbol: string, price: string): DecimalString {
  if (/=X$/.test(symbol)) return normaliseDecimal(new JoinrDecimal(price));
  const prev = new JoinrDecimal(price).times(new JoinrDecimal(1).minus(fakeDayMove(symbol)));
  return normaliseDecimal(prev.toDecimalPlaces(6));
}

/** From the previous close to the price over `times` (ascending), wiggling ±0.1 %; the last = price. */
function fakePath(symbol: string, prev: string, price: string, times: number[]): DayPoint[] {
  const from = new JoinrDecimal(prev);
  const to = new JoinrDecimal(price);
  return times.map((t, i): DayPoint => {
    if (i === times.length - 1) return [t, normaliseDecimal(to)];
    const frac = i / (times.length - 1);
    const wiggle = new JoinrDecimal((fnv1a(`${symbol}:${t}`) % 21) - 10).div(10000);
    const v = from.plus(to.minus(from).times(frac)).times(new JoinrDecimal(1).plus(wiggle));
    return [t, normaliseDecimal(v.toDecimalPlaces(6))];
  });
}

const floorStep = (ms: number): number => Math.floor(ms / STEP_MS) * STEP_MS;

interface FakeDay {
  day: QuoteDay | null;
  bars?: DayPoint[];
  asOfMs: number;
}

/** A listing's session: 10:00 to min(now, 16:10) today, else the previous weekday's full session. */
function fakeSessionDay(symbol: string, price: string, currency: string, nowMs: number): FakeDay {
  const zone = timeZoneFromSymbol(symbol) ?? 'Australia/Sydney';
  const w = wallTimeInZone(nowMs, zone);
  if (w === null) return { day: null, asOfMs: nowMs };
  const minutes = w.hour * 60 + w.minute;
  const openMinutes = FAKE_SESSION_OPEN.hour * 60 + FAKE_SESSION_OPEN.minute;
  const today = isWeekday(w.weekday) && minutes >= openMinutes;
  const date = today ? w.date : previousWeekday(w.date);
  const open = zonedTimeToEpoch(date, FAKE_SESSION_OPEN.hour, FAKE_SESSION_OPEN.minute, zone);
  const close = zonedTimeToEpoch(date, FAKE_SESSION_CLOSE.hour, FAKE_SESSION_CLOSE.minute, zone);
  if (open === null || close === null) return { day: null, asOfMs: nowMs };
  const end = today ? Math.min(floorStep(nowMs), close) : close;
  const times: number[] = [];
  for (let t = open; t <= end; t += STEP_MS) times.push(Math.floor(t / 1000));
  const last = times.at(-1);
  if (last === undefined) return { day: null, asOfMs: nowMs };
  const prev = fakePreviousClose(symbol, price);
  return {
    day: {
      sessionDate: date,
      timeZone: zone,
      granularity: '5m',
      nativeCurrency: currency,
      previousClose: prev,
      regularStart: new Date(open).toISOString(),
      regularEnd: new Date(close).toISOString(),
      points: fakePath(symbol, prev, price, times),
    },
    asOfMs: last * 1000,
  };
}

/** A fund's NAV: one point at 16:00 local on the latest weekday whose 16:00 is not after now. */
function fakeDailyDay(symbol: string, price: string, currency: string, nowMs: number): FakeDay {
  const zone = timeZoneFromSymbol(symbol) ?? 'Australia/Sydney';
  const w = wallTimeInZone(nowMs, zone);
  if (w === null) return { day: null, asOfMs: nowMs };
  const navToday = zonedTimeToEpoch(w.date, FAKE_NAV_TIME.hour, FAKE_NAV_TIME.minute, zone);
  const date =
    isWeekday(w.weekday) && navToday !== null && navToday <= nowMs
      ? w.date
      : previousWeekday(w.date);
  const nav = zonedTimeToEpoch(date, FAKE_NAV_TIME.hour, FAKE_NAV_TIME.minute, zone);
  if (nav === null) return { day: null, asOfMs: nowMs };
  return {
    day: {
      sessionDate: date,
      timeZone: zone,
      granularity: '1d',
      nativeCurrency: currency,
      previousClose: fakePreviousClose(symbol, price),
      regularStart: null,
      regularEnd: null,
      points: [[Math.floor(nav / 1000), normaliseDecimal(new JoinrDecimal(price))]],
    },
    asOfMs: nav,
  };
}

/**
 * The bullion inputs' two-day bars: five-minute points from 00:00 New York on the second-latest
 * weekday to now, none from Friday 17:00 to Sunday 18:00 New York (the futures' weekend; `AUDUSD`
 * reopens at Sunday 17:00). The futures move from the previous close to the price; `AUDUSD` is
 * flat. The `day` is the last trading day's bars (New York for the futures, London for `AUDUSD`).
 */
function fakeTwoDay(symbol: string, price: string, currency: string, nowMs: number): FakeDay {
  const w = wallTimeInZone(nowMs, NEW_YORK);
  if (w === null) return { day: null, asOfMs: nowMs };
  const latest = isWeekday(w.weekday) ? w.date : previousWeekday(w.date);
  const startMs = zonedTimeToEpoch(previousWeekday(latest), 0, 0, NEW_YORK);
  if (startMs === null) return { day: null, asOfMs: nowMs };
  const fx = symbol === 'AUDUSD=X';
  const reopen = (fx ? 17 : 18) * 60;
  const times: number[] = [];
  for (let t = floorStep(startMs); t <= nowMs; t += STEP_MS) {
    const nw = wallTimeInZone(t, NEW_YORK);
    if (nw === null) continue;
    const m = nw.hour * 60 + nw.minute;
    const closed =
      (nw.weekday === 5 && m >= 17 * 60) || nw.weekday === 6 || (nw.weekday === 0 && m < reopen);
    if (!closed) times.push(Math.floor(t / 1000));
  }
  const prev = fakePreviousClose(symbol, price);
  const bars = fx
    ? times.map((t): DayPoint => [t, normaliseDecimal(new JoinrDecimal(price))])
    : fakePath(symbol, prev, price, times);
  const last = bars.at(-1);
  if (last === undefined) return { day: null, bars, asOfMs: nowMs };
  const zone = fx ? 'Europe/London' : NEW_YORK;
  const dateOf = (t: number): string | null => wallTimeInZone(t * 1000, zone)?.date ?? null;
  const lastDate = dateOf(last[0]);
  if (lastDate === null) return { day: null, bars, asOfMs: last[0] * 1000 };
  return {
    day: {
      sessionDate: lastDate,
      timeZone: zone,
      granularity: '5m',
      nativeCurrency: currency,
      previousClose: prev,
      regularStart: null,
      regularEnd: null,
      points: normalisePoints(bars.filter(([t]) => dateOf(t) === lastDate)),
    },
    bars,
    asOfMs: last[0] * 1000,
  };
}

/** The fake quote of one request at `nowMs` (stage-9.md §5.3). */
export function fakeQuote(req: QuoteRequest, nowMs: number): Quote {
  const symbol = req.symbol;
  const price = symbol === 'AUDUSD=X' ? FAKE_AUDUSD : fakePrice(symbol);
  const currency = fakeCurrency(symbol);
  if (isFakeCoinId(symbol)) {
    return { key: req.key, price, currency, asOf: new Date(nowMs).toISOString() };
  }
  const fake = req.daily
    ? fakeDailyDay(symbol, price, currency, nowMs)
    : YAHOO_TWO_DAY_SYMBOLS.has(symbol)
      ? fakeTwoDay(symbol, price, currency, nowMs)
      : fakeSessionDay(symbol, price, currency, nowMs);
  const quote: Quote = { key: req.key, price, currency, asOf: new Date(fake.asOfMs).toISOString() };
  if (fake.day !== null) quote.day = fake.day;
  if (fake.bars !== undefined) quote.bars = fake.bars;
  return quote;
}

/**
 * The fake CoinGecko day chart: five-minute points on UTC marks over the last 24 hours, moving from
 * `fakePreviousClose(id)` to the price; the last point is now, at the price.
 */
export function fakeDayChart(id: string, nowMs: number): Array<[number, number]> {
  const price = fakePrice(id);
  const times: number[] = [];
  for (let t = floorStep(nowMs - DAY_MS) + STEP_MS; t < nowMs; t += STEP_MS) times.push(t);
  times.push(nowMs);
  return fakePath(id, fakePreviousClose(id, price), price, times).map(([t, p]) => [t, Number(p)]);
}

export function createFakeProvider(o: {
  now: () => Date;
}): PriceProviderClient & CoinIdResolver & CoinDayChartClient {
  return {
    id: 'fake',
    async fetchQuotes(reqs, signal): Promise<QuoteBatch> {
      const quotes: Quote[] = [];
      const failures: QuoteFailure[] = [];
      const nowMs = o.now().getTime();
      for (const req of reqs) {
        if (signal.aborted) {
          failures.push({ key: req.key, error: 'Aborted', retryable: true, skipped: true });
          continue;
        }
        quotes.push(fakeQuote(req, nowMs));
      }
      return { quotes, failures };
    },
    async fetchDayChart(id, signal): Promise<DayChartResult> {
      if (signal.aborted) return { ok: false, error: 'Aborted', skipped: true };
      return { ok: true, prices: fakeDayChart(id, o.now().getTime()) };
    },
    async searchId(symbol): Promise<CoinSearchResult> {
      return { ok: true, id: symbol.trim().toLowerCase() };
    },
  };
}

// ─── Stage 10: the fake daily histories (stage-10.md §5.4) ──────────────────────────────────────

const LONDON = 'Europe/London';
/** The per-weekday drift of the fake history (multiplicative, so a close stays > 0 forever). */
export const FAKE_HISTORY_DRIFT = '0.9996';
/** The keyless CoinGecko reach the fake enforces (a 401 beyond it). */
const FAKE_COIN_MAX_DAYS = 365;
const HOUR_MS = 3_600_000;

/** The zone of a symbol's fake bars: the futures in New York, FX in London, else the suffix's. */
export function fakeHistoryZone(symbol: string): string {
  if (Object.hasOwn(BULLION_FEEDS, symbol)) return NEW_YORK;
  if (/=X$/.test(symbol)) return LONDON;
  return timeZoneFromSymbol(symbol) ?? 'Australia/Sydney';
}

/**
 * The date of the fake session at `nowMs` (the Stage 9 fake's rules): a listing's session is today
 * from 10:00 on a weekday, else the previous weekday; a fund's NAV day is today from 16:00 on a
 * weekday; the futures' latest New York weekday.
 */
export function fakeSessionDate(symbol: string, nowMs: number, daily = false): IsoDate | null {
  if (Object.hasOwn(BULLION_FEEDS, symbol)) {
    const w = wallTimeInZone(nowMs, NEW_YORK);
    if (w === null) return null;
    return isWeekday(w.weekday) ? w.date : previousWeekday(w.date);
  }
  const zone = timeZoneFromSymbol(symbol) ?? 'Australia/Sydney';
  const w = wallTimeInZone(nowMs, zone);
  if (w === null) return null;
  if (daily) {
    const nav = zonedTimeToEpoch(w.date, FAKE_NAV_TIME.hour, FAKE_NAV_TIME.minute, zone);
    return isWeekday(w.weekday) && nav !== null && nav <= nowMs ? w.date : previousWeekday(w.date);
  }
  const minutes = w.hour * 60 + w.minute;
  const open = FAKE_SESSION_OPEN.hour * 60 + FAKE_SESSION_OPEN.minute;
  return isWeekday(w.weekday) && minutes >= open ? w.date : previousWeekday(w.date);
}

/** `((fnv1a(key) % 401) − 200) ÷ 40000`: the fake history's daily wiggle (±0.5 %). */
function fakeWiggle(key: string): number {
  return ((fnv1a(key) % 401) - 200) / 40000;
}

/**
 * The fake Yahoo-style daily history of `symbol` from `from` (§5.4): weekday bars in the symbol's
 * zone dated before today there. `close(d) = prev × 0.9996^n × (1 + w)` with `prev` the fake day's
 * previous close, `n` the weekdays from `d` to the weekday before the fake session and
 * `w = ((fnv1a(symbol + ':' + d) % 401) − 200) ÷ 40000`, taken as 0 at `n = 0`, so the close of the
 * weekday before the session is `prev` exactly (the fake 1D base and the period closes agree); the
 * session's own date, once it is before today, closes at the fake price. FX is flat: `AUDUSD` =
 * FAKE_AUDUSD, `<CCY>AUD` the Stage 4 fake rate. No splits but the ones given.
 */
export function fakeYahooHistory(
  symbol: string,
  from: IsoDate,
  nowMs: number,
  o: { daily?: boolean; splits?: readonly SplitEvent[] } = {},
): YahooHistory {
  const zone = fakeHistoryZone(symbol);
  const today = dateInZone(nowMs, zone);
  const history: YahooHistory = {
    closes: [],
    splits: [...(o.splits ?? [])],
    timeZone: zone,
    currency: fakeCurrency(symbol),
    firstTradeDate: null,
  };
  if (today === null) return history;
  const dates: IsoDate[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (isWeekday(weekdayOfIso(d))) dates.push(d);
  }
  const fx = /^([A-Z]{3})AUD=X$/.exec(symbol);
  if (symbol === 'AUDUSD=X' || fx) {
    const value = symbol === 'AUDUSD=X' ? FAKE_AUDUSD : fakeFxClose(fx![1]!);
    history.closes = dates.map((date) => ({ date, close: value }));
    return history;
  }
  const price = fakePrice(symbol);
  const prev = new JoinrDecimal(fakePreviousClose(symbol, price));
  const session = fakeSessionDate(symbol, nowMs, o.daily === true);
  const anchor = session === null ? today : previousWeekday(session);
  const drift = new JoinrDecimal(FAKE_HISTORY_DRIFT);
  const closes: Array<{ date: IsoDate; close: DecimalString }> = [];
  let n = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const date = dates[i]!;
    if (date > anchor) {
      closes.push({ date, close: price });
      continue;
    }
    const w = n === 0 ? 0 : fakeWiggle(`${symbol}:${date}`);
    const close = prev.times(drift.pow(n)).times(new JoinrDecimal(1).plus(w));
    closes.push({ date, close: normaliseDecimal(close.toSignificantDigits(12)) });
    n += 1;
  }
  history.closes = closes.reverse();
  return history;
}

/**
 * The fake CoinGecko `market_chart` history (§5.4): a 401 (`beyond_reach`) past 365 days; daily
 * points at 00:00 UTC from UTC-today − (days − 1), or hourly points on the hour over the last
 * `days` days; then the price now. Anchored so the point at 00:00 today in `timeZone` is the fake
 * day's base (the last point of the fake day chart at or before midnight), with a multiplicative
 * drift and a wiggle before it.
 */
export function fakeCoinHistory(
  id: string,
  days: number,
  daily: boolean,
  nowMs: number,
  timeZone: string,
): CoinHistoryResult {
  if (days > FAKE_COIN_MAX_DAYS) {
    return { ok: false, kind: 'beyond_reach', error: 'Beyond the keyless reach' };
  }
  const now = new Date(nowMs);
  const price = Number(fakePrice(id));
  const midnight = midnightOf(now, timeZone);
  const base = Number(
    cryptoDayFrom(fakeDayChart(id, nowMs), now, timeZone)?.previousClose ??
      fakePreviousClose(id, fakePrice(id)),
  );
  const midnightMs = midnight?.ms ?? nowMs;
  const times: number[] = [];
  if (daily) {
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let k = days - 1; k >= 0; k -= 1) {
      const t = todayUtc - k * DAY_MS;
      if (t < nowMs) times.push(t);
    }
  } else {
    for (let t = Math.ceil((nowMs - days * DAY_MS) / HOUR_MS) * HOUR_MS; t < nowMs; t += HOUR_MS) {
      times.push(t);
    }
  }
  times.push(nowMs);
  const value = (t: number): number => {
    if (t >= nowMs) return price;
    if (t > midnightMs) return base;
    const w = t === midnightMs ? 0 : fakeWiggle(`${id}:${t}`);
    return base * Math.pow(Number(FAKE_HISTORY_DRIFT), (midnightMs - t) / DAY_MS) * (1 + w);
  };
  return { ok: true, prices: times.map((t): [number, number] => [t, value(t)]) };
}

/**
 * The fake history clients of the `closes` job (MARKET_DATA_MODE=fake): never the network; an
 * aborted run gets `skipped`. `splits` lists the split events of a symbol (tests only).
 */
export function createFakeHistoryClients(o: {
  now: () => Date;
  timeZone: string;
  splits?: Readonly<Record<string, readonly SplitEvent[]>>;
}): { yahoo: YahooHistoryClient; coins: CoinHistoryClient } {
  return {
    yahoo: {
      id: 'fake',
      async fetchHistory(req, signal) {
        if (signal.aborted) return { ok: false, kind: 'skipped', error: 'Aborted' };
        const history = fakeYahooHistory(req.symbol, req.from, o.now().getTime(), {
          daily: req.daily === true,
          splits: o.splits?.[req.symbol] ?? [],
        });
        return { ok: true, history };
      },
    },
    coins: {
      id: 'fake',
      async fetchHistory(id, days, daily, signal) {
        if (signal.aborted) return { ok: false, kind: 'skipped', error: 'Aborted' };
        return fakeCoinHistory(id, days, daily, o.now().getTime(), o.timeZone);
      },
    },
  };
}
