// Stage 9 day data (stage-9.md §5.1, §5.2, §5.4, §5.4a): the pure parts. Yahoo's one-day (or
// two-day) five-minute chart and the five-day daily chart become a `QuoteDay`; a CoinGecko day
// chart becomes crypto's day since 00:00 (D142); the bullion futures' and `AUDUSD`'s two-day bars
// become bullion's day since 00:00 (D153); and the newer-session rule with its merges (FROZEN).
// Every date of an instant is taken in an explicit IANA zone through Intl (`@joinr/schema`'s zone
// helpers), never the process TZ. Nothing here reads the clock, the network or the database.
import {
  DAY_POINTS_MAX,
  dateInZone,
  decimalFromNumber,
  JoinrDecimal,
  startOfDayInZone,
  wallTimeInZone,
  type DecimalString,
  type IsoDate,
} from '@joinr/schema';
import { roundDerived } from './fx';
import { timeZoneFromSymbol } from './providers/exchangeTime';
import { isRecord } from './providers/http';
import type { QuoteDay } from './providers/types';

/** A stored or incoming day row (the `day_quotes` / `series_day_quotes` columns we compare). */
export type DayRow = QuoteDay;

/** A point: unix seconds and a native decimal string. */
export type DayPoint = [number, DecimalString];

/** The server's IANA zone (Intl's resolved zone; `TZ` sets it). */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** True when Intl knows `zone`. */
export function isKnownTimeZone(zone: unknown): zone is string {
  return typeof zone === 'string' && zone !== '' && dateInZone(0, zone) !== null;
}

/** Sorted ascending, one point per time (the later one in input order wins), the last `max` kept. */
export function normalisePoints(points: readonly DayPoint[], max = DAY_POINTS_MAX): DayPoint[] {
  const byTime = new Map<number, DecimalString>();
  for (const [t, p] of points) byTime.set(t, p);
  const out = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  return out.length > max ? out.slice(out.length - max) : out;
}

const isoOfUnix = (seconds: number): string => new Date(seconds * 1000).toISOString();

/** Date#getDay() of a `YYYY-MM-DD` date (0 = Sunday). */
export function weekdayOfIso(date: IsoDate): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True for Monday–Friday (Date#getDay() numbering). */
export const isWeekday = (weekday: number): boolean => weekday >= 1 && weekday <= 5;

/** `date` + `days` calendar days (UTC arithmetic on the date string). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The weekday strictly before `date`. */
export function previousWeekday(date: IsoDate): IsoDate {
  let d = addDays(date, -1);
  while (!isWeekday(weekdayOfIso(d))) d = addDays(d, -1);
  return d;
}

/**
 * The instant (epoch ms) of the wall time `hour:minute` on `date` in `timeZone` (DST-aware: a
 * whole-hour change before that time is accounted for); null for an unknown zone or date.
 */
export function zonedTimeToEpoch(
  date: IsoDate,
  hour: number,
  minute: number,
  timeZone: string,
): number | null {
  const start = startOfDayInZone(date, timeZone);
  if (start === null) return null;
  const target = hour * 60 + minute;
  let guess = start + target * 60_000;
  for (let i = 0; i < 3; i += 1) {
    const w = wallTimeInZone(guess, timeZone);
    if (w === null) return null;
    const dayShift = w.date > date ? 1440 : w.date < date ? -1440 : 0;
    const diff = target - (w.hour * 60 + w.minute + dayShift);
    if (diff === 0) break;
    guess += diff * 60_000;
  }
  return guess;
}

// ─── Yahoo (§5.1) ──────────────────────────────────────────────────────────────────────────────

/** The first chart result of a `v8/finance/chart` body, or null. */
export function chartResultOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.chart)) return null;
  const result: unknown = Array.isArray(body.chart.result) ? body.chart.result[0] : undefined;
  return isRecord(result) ? result : null;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Every bar with a usable time and a finite close > 0, ascending, one per time. */
export function parseYahooBars(result: Record<string, unknown>): DayPoint[] {
  const timestamps: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = isRecord(result.indicators) ? result.indicators : null;
  const quote: unknown = Array.isArray(indicators?.quote) ? indicators.quote[0] : undefined;
  const closes: unknown[] = isRecord(quote) && Array.isArray(quote.close) ? quote.close : [];
  const bars: DayPoint[] = [];
  const n = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < n; i += 1) {
    const t = timestamps[i];
    const close = finitePositiveNumber(closes[i]);
    if (typeof t !== 'number' || !Number.isSafeInteger(t) || t <= 0 || close === null) continue;
    bars.push([t, decimalFromNumber(close)]);
  }
  return normalisePoints(bars, Number.MAX_SAFE_INTEGER);
}

/** The zone of the chart: `exchangeTimezoneName` when Intl knows it, else the suffix's, else UTC. */
export function chartTimeZone(meta: Record<string, unknown>): string {
  if (isKnownTimeZone(meta.exchangeTimezoneName)) return meta.exchangeTimezoneName;
  const bySuffix = timeZoneFromSymbol(meta.symbol);
  return bySuffix !== null && isKnownTimeZone(bySuffix) ? bySuffix : 'UTC';
}

/**
 * The last regular trading period of `meta.tradingPeriods` (an array of arrays, flattened; or the
 * `{ regular: [[…]] }` form), as unix seconds. Never `currentTradingPeriod` (after a close it points
 * at the next session).
 */
export function lastTradingPeriod(
  meta: Record<string, unknown>,
): { start: number; end: number } | null {
  let raw: unknown = meta.tradingPeriods;
  if (isRecord(raw)) raw = raw.regular;
  if (!Array.isArray(raw)) return null;
  const flat = (raw as unknown[]).flat(2);
  for (let i = flat.length - 1; i >= 0; i -= 1) {
    const period = flat[i];
    if (!isRecord(period)) continue;
    const { start, end } = period;
    if (
      typeof start === 'number' &&
      typeof end === 'number' &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start > 0 &&
      end >= start
    ) {
      return { start, end };
    }
  }
  return null;
}

const DAILY_GRANULARITIES = new Set(['1d', '5d', '1wk', '1mo', '3mo']);

/**
 * The day of a one-day (or two-day) five-minute chart (§5.1; pure). `previousClose` is read from
 * `meta.chartPreviousClose`, else `meta.previousClose` (the two-day requests read `previousClose`
 * first: at 2d `chartPreviousClose` is the close before the window). For `5m`, only the bars of the
 * last trading period are kept when it is known. No points → null (no `day`).
 */
export function parseYahooDay(
  result: Record<string, unknown>,
  nativeCurrency: string,
  opts: { previousCloseFirst?: boolean } = {},
): QuoteDay | null {
  const meta = isRecord(result.meta) ? result.meta : null;
  if (meta === null) return null;
  const timeZone = chartTimeZone(meta);
  const granularity =
    typeof meta.dataGranularity === 'string' && DAILY_GRANULARITIES.has(meta.dataGranularity)
      ? '1d'
      : '5m';
  const period = lastTradingPeriod(meta);
  let points = parseYahooBars(result);
  if (granularity === '5m' && period !== null) {
    points = points.filter(([t]) => t >= period.start && t <= period.end);
  }
  points = normalisePoints(points);
  const last = points.at(-1);
  if (last === undefined) return null;
  const sessionDate = dateInZone(last[0] * 1000, timeZone);
  if (sessionDate === null) return null;
  const chartPrev = finitePositiveNumber(meta.chartPreviousClose);
  const prev = finitePositiveNumber(meta.previousClose);
  const previous = opts.previousCloseFirst ? (prev ?? chartPrev) : (chartPrev ?? prev);
  return {
    sessionDate,
    timeZone,
    granularity,
    nativeCurrency,
    previousClose: previous === null ? null : decimalFromNumber(previous),
    regularStart: period === null ? null : isoOfUnix(period.start),
    regularEnd: period === null ? null : isoOfUnix(period.end),
    points,
  };
}

/**
 * The day of a five-day daily chart (a managed fund's daily request, §5.1; pure): the last finite
 * close > 0 is the NAV (one point, dated in the chart's zone), the one before it the previous close
 * (null when the window has only one). `meta.chartPreviousClose` is never read (at 5d it is the
 * close before the window). No finite close → null.
 */
export function parseYahooDailyDay(
  result: Record<string, unknown>,
  nativeCurrency: string,
): QuoteDay | null {
  const meta = isRecord(result.meta) ? result.meta : null;
  if (meta === null) return null;
  const timeZone = chartTimeZone(meta);
  const bars = parseYahooBars(result);
  const nav = bars.at(-1);
  if (nav === undefined) return null;
  const sessionDate = dateInZone(nav[0] * 1000, timeZone);
  if (sessionDate === null) return null;
  return {
    sessionDate,
    timeZone,
    granularity: '1d',
    nativeCurrency,
    previousClose: bars.length >= 2 ? bars[bars.length - 2]![1] : null,
    regularStart: null,
    regularEnd: null,
    points: [nav],
  };
}

// ─── Midnight-based days (crypto §5.2, bullion §5.4a) ───────────────────────────────────────────

/** 00:00 of `now`'s date in `timeZone` (epoch ms) and that date; null for an unknown zone. */
export function midnightOf(now: Date, timeZone: string): { date: IsoDate; ms: number } | null {
  const date = dateInZone(now.getTime(), timeZone);
  if (date === null) return null;
  const ms = startOfDayInZone(date, timeZone);
  return ms === null ? null : { date, ms };
}

function hasContent(row: Pick<DayRow, 'previousClose' | 'points'>): boolean {
  return row.previousClose !== null || row.points.length > 0;
}

/**
 * Crypto's day since 00:00 in `timeZone` (D142; pure). `prices` are CoinGecko's `[epochMs, aud]`.
 * `base` = the last point at or before midnight (null when none: the 25-hour day's `days=1` starts
 * after midnight); points = `[midnight, base]` (when known) then every point after midnight. An empty
 * series, or one with neither a base nor a point after midnight → null (no row).
 */
export function cryptoDayFrom(
  prices: ReadonlyArray<readonly [number, number]>,
  now: Date,
  timeZone: string,
): DayRow | null {
  const midnight = midnightOf(now, timeZone);
  if (midnight === null) return null;
  const usable = prices
    .filter(([t, p]) => Number.isFinite(t) && t > 0 && finitePositiveNumber(p) !== null)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  let base: DecimalString | null = null;
  const after: DayPoint[] = [];
  for (const [t, p] of usable) {
    if (t <= midnight.ms) base = decimalFromNumber(p);
    else after.push([Math.floor(t / 1000), decimalFromNumber(p)]);
  }
  const midnightSec = Math.floor(midnight.ms / 1000);
  const points = normalisePoints(base === null ? after : [[midnightSec, base], ...after]);
  const row: DayRow = {
    sessionDate: midnight.date,
    timeZone,
    granularity: '5m',
    nativeCurrency: 'AUD',
    previousClose: base,
    regularStart: null,
    regularEnd: null,
    points,
  };
  return hasContent(row) ? row : null;
}

/** The last bar at or before `t` (unix seconds), by binary search over ascending bars. */
function lastAtOrBefore(bars: readonly DayPoint[], t: number): DayPoint | null {
  let lo = 0;
  let hi = bars.length - 1;
  let found: DayPoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bar = bars[mid]!;
    if (bar[0] <= t) {
      found = bar;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface BullionDayInput {
  /** The futures' two-day bars (USD/oz). */
  futuresBars: readonly DayPoint[];
  /** `AUDUSD=X`'s two-day bars (USD per AUD). */
  audUsdBars: readonly DayPoint[];
  /** The futures' quote now (USD/oz) and its as-of (UTC ISO). */
  futures: { price: DecimalString; asOf: string };
  /** The derived AUD spot now (AUD/oz) and its as-of; null when it could not be derived. */
  spot: { value: DecimalString; asOf: string } | null;
  now: Date;
  timeZone: string;
}

/**
 * Bullion's day since 00:00 in `timeZone` (§5.4a, D153; pure): the AUD spot row (`XAx_AUD_OZ`) and
 * the futures' USD row. When the futures' quote is from at or before midnight (no trade since:
 * Sunday, a Monday before the reopen, a Saturday after the close, a holiday) both rows are the one
 * point `[midnight, base]` with base = the spot (AUD) and the futures' price (USD): flat since
 * midnight. Otherwise base = the futures' last bar at or before midnight ÷ `AUDUSD`'s last bar at or
 * before midnight (null when either is missing; a later fetch fills it), and each futures bar after
 * midnight ÷ the `AUDUSD` bar at or before it. A row with neither base nor points → null.
 */
export function bullionDayFrom(o: BullionDayInput): { aud: DayRow | null; usd: DayRow | null } {
  const midnight = midnightOf(o.now, o.timeZone);
  const asOf = Date.parse(o.futures.asOf);
  if (midnight === null || Number.isNaN(asOf)) return { aud: null, usd: null };
  const midnightSec = Math.floor(midnight.ms / 1000);
  const row = (
    nativeCurrency: string,
    previousClose: DecimalString | null,
    after: DayPoint[],
  ): DayRow | null => {
    const points = normalisePoints(
      previousClose === null ? after : [[midnightSec, previousClose], ...after],
    );
    const r: DayRow = {
      sessionDate: midnight.date,
      timeZone: o.timeZone,
      granularity: '5m',
      nativeCurrency,
      previousClose,
      regularStart: null,
      regularEnd: null,
      points,
    };
    return hasContent(r) ? r : null;
  };

  if (asOf <= midnight.ms) {
    return {
      aud: row('AUD', o.spot?.value ?? null, []),
      usd: row('USD', o.futures.price, []),
    };
  }

  const futures = normalisePoints(o.futuresBars, Number.MAX_SAFE_INTEGER);
  const fx = normalisePoints(o.audUsdBars, Number.MAX_SAFE_INTEGER);
  const divide = (f: DecimalString, x: DecimalString): DecimalString | null => {
    const d = new JoinrDecimal(x);
    return d.isZero() ? null : roundDerived(new JoinrDecimal(f).div(d));
  };
  const f0 = lastAtOrBefore(futures, midnightSec);
  const x0 = lastAtOrBefore(fx, midnightSec);
  const audBase = f0 !== null && x0 !== null ? divide(f0[1], x0[1]) : null;
  const audAfter: DayPoint[] = [];
  const usdAfter: DayPoint[] = [];
  for (const [t, f] of futures) {
    if (t <= midnightSec) continue;
    usdAfter.push([t, f]);
    const x = lastAtOrBefore(fx, t);
    const spot = x === null ? null : divide(f, x[1]);
    if (spot !== null) audAfter.push([t, spot]);
  }
  return {
    aud: row('AUD', audBase, audAfter),
    usd: row('USD', f0?.[1] ?? null, usdAfter),
  };
}

// ─── The newer-session rule and the merges (§5.4, FROZEN) ───────────────────────────────────────

/**
 * `session` (Yahoo rows): on the same session the incoming previous close wins when known.
 * `midnight` (crypto and bullion, owner review O14): the first non-null base of a session is kept.
 */
export type MergeRule = 'session' | 'midnight';

/**
 * What to write for an incoming day row against the stored one (FROZEN): an older session → nothing
 * (null); a newer one → the incoming row; the same → merged (`previous_close` by `rule`; the points'
 * union by time, the incoming value winning on equal times, ascending, the last DAY_POINTS_MAX; the
 * other columns from the incoming row). A row with neither a previous close nor a point → null.
 */
export function mergeDayRow(
  stored: DayRow | null,
  incoming: DayRow,
  rule: MergeRule,
): DayRow | null {
  if (stored === null || incoming.sessionDate > stored.sessionDate) {
    const row = { ...incoming, points: normalisePoints(incoming.points) };
    return hasContent(row) ? row : null;
  }
  if (incoming.sessionDate < stored.sessionDate) return null;
  const previousClose =
    rule === 'midnight'
      ? (stored.previousClose ?? incoming.previousClose)
      : (incoming.previousClose ?? stored.previousClose);
  let incomingPoints = incoming.points;
  // A midnight row starts with [midnight, base]: when the stored base is kept, the incoming row's
  // own base point carries the kept base too, so the line still starts at its base.
  if (
    rule === 'midnight' &&
    stored.previousClose !== null &&
    incoming.previousClose !== null &&
    incoming.points[0]?.[1] === incoming.previousClose
  ) {
    incomingPoints = [[incoming.points[0][0], stored.previousClose], ...incoming.points.slice(1)];
  }
  const merged: DayRow = {
    ...incoming,
    previousClose,
    points: normalisePoints([...stored.points, ...incomingPoints]),
  };
  return hasContent(merged) ? merged : null;
}
