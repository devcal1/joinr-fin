// The day-change rules of the phone app (stage-9.md §2, FROZEN): per holding in AUD integer cents,
// the currency move included; bullion as its own class (D148, D153); lots bought in the session
// measured from their trade price, after-session lots outside the day; hand-priced, stale and
// unpriced holdings without a day figure; totals that are exact sums; a portfolio line that ends at
// the day total. Pure: every "today" is an input, and the date of an instant is always taken in an
// explicit IANA zone (`dateInZone` from @joinr/schema; the engine itself never calls Intl and never
// reads the process zone).
import {
  BULLION_HOLDINGS,
  LINE_MAX_POINTS,
  PORTFOLIO_LINE_STEP_MIN,
  dateInZone,
  holdingKey,
  type DayStatus,
  type DecimalString,
  type InstrumentKind,
  type IsoDate,
  type Metal,
  type MobileHoldingKind,
  type PriceStatus,
} from '@joinr/schema';
import {
  ZERO,
  centsOf,
  dayNumber,
  dec,
  decN,
  decimalString,
  isoOfDayNumber,
  priceString,
  ratioString,
  type Dec,
} from './num';
import type { Cents, HoldingResult, LotResult, OtherAssetResult } from './types';

// ─── Inputs (FROZEN, §2.8) ──────────────────────────────────────────────────────────────────────

export interface DayRowInput {
  sessionDate: IsoDate;
  timeZone: string;
  granularity: '5m' | '1d';
  /** day_quotes.native_currency. */
  nativeCurrency: string;
  previousCloseNative: DecimalString | null;
  /** AUD per native unit at the previous close (1 for AUD; null when unknown or the FX close is > 7 days old). */
  fxPrev: DecimalString | null;
  points: ReadonlyArray<readonly [number, DecimalString]>;
}

export interface DayChangeInput {
  /** The server's IANA zone; every "today" question uses it (Intl, through @joinr/schema). */
  timeZone: string;
  /** The server's date (generatedAt in timeZone). */
  localDate: IsoDate;
  /** UTC ISO. */
  generatedAt: string;
  /** The four kinds' engine holdings. */
  holdings: readonly HoldingResult[];
  kinds: ReadonlyMap<number, InstrumentKind>;
  /** The four kinds' lots. */
  lots: readonly LotResult[];
  /** Every fetched, non-manual price (AUD ones too): native currency and price, AUD per unit now (1 for AUD), and its as-of (UTC ISO). */
  fetched: ReadonlyMap<
    number,
    { currency: string; price: DecimalString; fxNow: DecimalString; asOf: string }
  >;
  days: ReadonlyMap<number, DayRowInput>;
  /** D148: one entry per metal with at least one held bullion row (silver, then gold). */
  bullion: readonly BullionInput[];
}

export interface BullionRowInput {
  /** The engine's row: remainingUnits, valueCents, costCents, priceStatus. */
  asset: OtherAssetResult;
  ozPerUnit: DecimalString;
  /** A Melbourne date; null → old. */
  purchaseDate: IsoDate | null;
  /** unitCost × purchase FX (1 for AUD); null → measured from B. */
  unitCostAud: DecimalString | null;
}

export interface BullionInput {
  metal: Metal;
  /** The held rows (remainingUnits > 0) priced with this metal. */
  rows: readonly BullionRowInput[];
  /** The spot the web used (AUD/oz), the futures' price (USD/oz), AUD per USD now, and the spot's as-of (UTC ISO). */
  spot: {
    audPerOz: DecimalString;
    nativePerOz: DecimalString;
    fxNow: DecimalString;
    asOf: string;
  } | null;
  /** The AUD spot's series_day_quotes row (D153: Melbourne day, base at 00:00, fxPrev '1'). */
  day: DayRowInput | null;
  /** The futures' USD row (base = USD/oz at 00:00), for `native` only. */
  nativeDay: DayRowInput | null;
}

/** §2.2 rule 3 (D150): a daily fund's NAV keeps its day figure while at most this many weekdays old. */
export const FUND_DAY_MAX_WEEKDAYS = 2;

// ─── Outputs ────────────────────────────────────────────────────────────────────────────────────

/** A holding's own line (§2.6): its stored points plus a final price point; not downsampled. */
export interface DayLineResult {
  sessionDate: IsoDate;
  timeZone: string;
  /** The previous close in its own currency (crypto and bullion: the 00:00 price). */
  base: DecimalString | null;
  /** Unix seconds, own currency, ascending. */
  points: Array<[number, DecimalString]>;
}

/** One held holding: the §4.3 fields the engine knows (the server adds code, symbol, name, position). */
export interface DayHoldingResult {
  /** holdingKey(id) or BULLION_HOLDINGS[metal].key. */
  key: string;
  /** Null for bullion. */
  instrumentId: number | null;
  kind: MobileHoldingKind;
  /** Bullion only. */
  metal: Metal | null;
  /** Bullion: the rows summed; else null. */
  items: number | null;
  /** openUnits; bullion: troy ounces. */
  units: DecimalString;
  priceStatus: PriceStatus;
  /** P (AUD; bullion: AUD per ounce). */
  price: DecimalString | null;
  /** The fetched price's as-of (bullion: the spot's); null for a hand price. */
  priceAsOf: string | null;
  valueCents: Cents | null;
  weightRatio: DecimalString | null;
  dayStatus: DayStatus;
  /** B (AUD), `ok` only. */
  previousClose: DecimalString | null;
  changePerUnit: DecimalString | null;
  dayRatio: DecimalString | null;
  dayCents: Cents | null;
  /** Units bought in the session (`ok` only; '0' otherwise). */
  newUnits: DecimalString;
  /** Units bought after the session (`ok` only; '0' otherwise). */
  laterUnits: DecimalString;
  native: {
    currency: string;
    price: DecimalString;
    previousClose: DecimalString | null;
    dayRatio: DecimalString | null;
  } | null;
  session: { date: IsoDate; timeZone: string; daily: boolean } | null;
  line: DayLineResult | null;
}

export interface DayTotalsResult {
  valueCents: Cents;
  dayCents: Cents | null;
  /** Σ (valueCents − dayCents − laterCents) of the `ok` holdings; null when none is `ok`. */
  baseCents: Cents | null;
  dayRatio: DecimalString | null;
  up: number;
  down: number;
  flat: number;
  noChange: number;
  holdings: number;
}

export interface PortfolioLineResult {
  /** UTC ISO. */
  from: string;
  to: string;
  sessionDate: IsoDate;
  /** Unix seconds, day change in cents; the last = totals.dayCents; ≤ LINE_MAX_POINTS. */
  points: Array<[number, Cents]>;
}

export interface DayChangeResult {
  /** Instruments in input order, then bullion (silver, then gold). */
  holdings: DayHoldingResult[];
  totals: DayTotalsResult;
  portfolioLine: PortfolioLineResult | null;
}

/** What one `ok` holding brings to the portfolio line (§2.5). */
export interface PortfolioLineHolding {
  dayCents: Cents;
  /** Null for a holding without a line (a daily fund): it contributes `dayCents` throughout. */
  line: {
    sessionDate: IsoDate;
    points: ReadonlyArray<readonly [number, DecimalString]>;
    /** AUD per native unit now (1 for AUD and bullion). */
    fxNow: DecimalString;
    oldUnits: DecimalString;
    newLots: ReadonlyArray<{ units: DecimalString; price: DecimalString }>;
    /** B (AUD). */
    base: DecimalString;
  } | null;
}

export interface PortfolioLineInput {
  timeZone: string;
  localDate: IsoDate;
  generatedAt: string;
  holdings: readonly PortfolioLineHolding[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** A UTC ISO instant → epoch ms (a malformed value is a programmer error). */
function instantMs(iso: string, what: string): number {
  const m = ISO_INSTANT_RE.exec(iso);
  if (!m) throw new RangeError(`engine: ${what} is not a UTC ISO instant: ${JSON.stringify(iso)}`);
  const n = (i: number) => Number(m[i] ?? '0');
  const ms = Number((m[7] ?? '0').padEnd(3, '0'));
  return Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6), ms);
}

function isoOfSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** The date of unix seconds in `timeZone` (through @joinr/schema's Intl helper). */
function dateOfSeconds(seconds: number, timeZone: string): IsoDate | null {
  return dateInZone(seconds * 1000, timeZone);
}

/** The `n`-th weekday (Mon–Fri) before `date`: Monday, 2 → the previous Thursday. */
function weekdaysBefore(date: IsoDate, n: number): IsoDate {
  let day = dayNumber(date);
  let left = n;
  while (left > 0) {
    day -= 1;
    const weekday = new Date(day * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return isoOfDayNumber(day);
}

const STEP_SECONDS = PORTFOLIO_LINE_STEP_MIN * 60;

/** `downsample(points, max)` (§2.6): the first and last always kept, duplicates removed. */
export function downsample<T>(points: readonly T[], max: number): T[] {
  const n = points.length;
  if (n <= max) return [...points];
  if (max <= 0) return [];
  if (max === 1) return [points[n - 1]!];
  const out: T[] = [];
  let previous = -1;
  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i * (n - 1)) / (max - 1));
    if (index === previous) continue;
    previous = index;
    out.push(points[index]!);
  }
  return out;
}

// ─── The internal holding shape (instruments and bullion run one code path) ────────────────────

interface Lot {
  units: Dec;
  /** Null → old (bullion without a purchase date). */
  date: IsoDate | null;
  /** AUD per unit; null → measured from B (bullion without a known cost). */
  price: Dec | null;
}

interface Inner {
  key: string;
  instrumentId: number | null;
  kind: MobileHoldingKind;
  metal: Metal | null;
  items: number | null;
  units: Dec;
  price: Dec | null;
  priceStatus: PriceStatus;
  priceAsOf: string | null;
  valueCents: Cents | null;
  lots: Lot[];
  /** The fetched price (bullion: the spot as an AUD price). */
  fetched: { currency: string; price: Dec; fxNow: Dec; asOf: string } | null;
  day: DayRowInput | null;
  /** Bullion: the futures' row and price, for `native`. */
  bullionNative: { day: DayRowInput | null; price: Dec | null } | null;
}

function instrumentInners(input: DayChangeInput): Inner[] {
  const lotsById = new Map<number, LotResult[]>();
  for (const lot of input.lots) {
    const list = lotsById.get(lot.instrumentId) ?? [];
    list.push(lot);
    lotsById.set(lot.instrumentId, list);
  }
  const out: Inner[] = [];
  for (const h of input.holdings) {
    const units = dec(h.openUnits, 'openUnits');
    if (!units.greaterThan(0)) continue;
    const kind = input.kinds.get(h.instrumentId);
    if (kind === undefined)
      throw new RangeError(`engine: no kind for instrument ${h.instrumentId}`);
    const f = h.priceStatus === 'manual' ? undefined : input.fetched.get(h.instrumentId);
    out.push({
      key: holdingKey(h.instrumentId),
      instrumentId: h.instrumentId,
      kind,
      metal: null,
      items: null,
      units,
      price: h.price === null ? null : dec(h.price, 'price'),
      priceStatus: h.priceStatus,
      priceAsOf: f?.asOf ?? null,
      valueCents: h.valueCents,
      lots: (lotsById.get(h.instrumentId) ?? [])
        .filter((l) => dec(l.remainingUnits, 'remainingUnits').greaterThan(0))
        .map((l) => ({
          units: dec(l.remainingUnits, 'remainingUnits'),
          date: l.tradeDate,
          price: dec(l.price, 'lot price'),
        })),
      fetched:
        f === undefined
          ? null
          : {
              currency: f.currency,
              price: dec(f.price, 'fetched price'),
              fxNow: dec(f.fxNow, 'fxNow'),
              asOf: f.asOf,
            },
      day: input.days.get(h.instrumentId) ?? null,
      bullionNative: null,
    });
  }
  return out;
}

function bullionInner(b: BullionInput): Inner | null {
  const rows = b.rows.filter((r) => dec(r.asset.remainingUnits, 'remainingUnits').greaterThan(0));
  if (rows.length === 0) return null;
  let units = ZERO;
  const lots: Lot[] = [];
  let valueCents: Cents | null = null;
  for (const r of rows) {
    const oz = dec(r.ozPerUnit, 'ozPerUnit');
    const rowOz = dec(r.asset.remainingUnits, 'remainingUnits').times(oz);
    units = units.plus(rowOz);
    lots.push({
      units: rowOz,
      date: r.purchaseDate,
      price:
        r.unitCostAud === null || !oz.greaterThan(0)
          ? null
          : dec(r.unitCostAud, 'unitCostAud').div(oz),
    });
    if (r.asset.valueCents !== null) valueCents = (valueCents ?? 0) + r.asset.valueCents;
  }
  const statuses = rows.map((r) => r.asset.priceStatus);
  const anyPriced = rows.some((r) => r.asset.unitPriceAud !== null);
  const priceStatus: PriceStatus = statuses.every((s) => s === 'fresh')
    ? 'fresh'
    : anyPriced
      ? 'stale'
      : 'none';
  let price: Dec | null = null;
  if (b.spot !== null) price = dec(b.spot.audPerOz, 'spot');
  else {
    const priced = rows.find((r) => r.asset.unitPriceAud !== null);
    if (priced !== undefined) {
      const oz = dec(priced.ozPerUnit, 'ozPerUnit');
      if (oz.greaterThan(0))
        price = dec(priceString(dec(priced.asset.unitPriceAud!, 'unitPriceAud').div(oz)), 'price');
    }
  }
  if (priceStatus === 'none') price = null;
  const def = BULLION_HOLDINGS[b.metal];
  return {
    key: def.key,
    instrumentId: null,
    kind: 'bullion',
    metal: b.metal,
    items: rows.length,
    units,
    price,
    priceStatus,
    priceAsOf: b.spot?.asOf ?? null,
    valueCents,
    lots,
    fetched:
      b.spot === null
        ? null
        : {
            currency: 'AUD',
            price: dec(b.spot.audPerOz, 'spot'),
            fxNow: decN(1),
            asOf: b.spot.asOf,
          },
    day: b.day,
    bullionNative: {
      day: b.nativeDay,
      price: b.spot === null ? null : dec(b.spot.nativePerOz, 'nativePerOz'),
    },
  };
}

// ─── Per holding (§2.2) ─────────────────────────────────────────────────────────────────────────

interface Evaluated {
  result: DayHoldingResult;
  /** `ok` only: what the totals and the portfolio line need. */
  ok: {
    dayCents: Cents;
    laterCents: Cents;
    line: PortfolioLineHolding['line'];
  } | null;
}

function dayStatusOf(h: Inner, input: DayChangeInput): { status: DayStatus; base: Dec | null } {
  if (h.price === null || h.valueCents === null) return { status: 'unpriced', base: null };
  if (h.priceStatus === 'manual') return { status: 'manual', base: null };
  if (h.priceStatus !== 'fresh') {
    const dailyFund =
      h.kind === 'managed_fund' &&
      h.priceStatus === 'stale' &&
      h.day !== null &&
      h.day.granularity === '1d' &&
      h.day.sessionDate >= weekdaysBefore(input.localDate, FUND_DAY_MAX_WEEKDAYS);
    if (!dailyFund) return { status: 'stale', base: null };
  }
  const day = h.day;
  if (day === null || day.previousCloseNative === null || day.fxPrev === null)
    return { status: 'no_base', base: null };
  const base = dec(day.previousCloseNative, 'previousClose').times(dec(day.fxPrev, 'fxPrev'));
  if (!base.greaterThan(0)) return { status: 'no_base', base: null };
  if ((h.kind === 'crypto' || h.kind === 'bullion') && day.sessionDate !== input.localDate)
    return { status: 'no_base', base: null };
  if (h.kind !== 'bullion') {
    const f = h.fetched;
    if (f === null || f.currency !== day.nativeCurrency) return { status: 'no_base', base: null };
    const asOfDate = dateInZone(instantMs(f.asOf, 'asOf'), day.timeZone);
    if (asOfDate !== day.sessionDate) return { status: 'no_base', base: null };
  }
  return { status: 'ok', base };
}

function nativeOf(h: Inner, status: DayStatus): DayHoldingResult['native'] {
  if (status !== 'ok' && status !== 'no_base') return null;
  if (h.bullionNative !== null) {
    const { day, price } = h.bullionNative;
    if (day === null || day.previousCloseNative === null || price === null) return null;
    const prev = dec(day.previousCloseNative, 'previousClose');
    return {
      currency: 'USD',
      price: decimalString(price),
      previousClose: decimalString(prev),
      dayRatio: prev.greaterThan(0) ? ratioString(price.minus(prev).div(prev)) : null,
    };
  }
  const f = h.fetched;
  if (f === null || f.currency === 'AUD') return null;
  const prevText =
    h.day !== null && h.day.nativeCurrency === f.currency ? h.day.previousCloseNative : null;
  const prev = prevText === null ? null : dec(prevText, 'previousClose');
  return {
    currency: f.currency,
    price: decimalString(f.price),
    previousClose: prev === null ? null : decimalString(prev),
    dayRatio:
      prev !== null && prev.greaterThan(0) ? ratioString(f.price.minus(prev).div(prev)) : null,
  };
}

function sessionOf(h: Inner, input: DayChangeInput): DayHoldingResult['session'] {
  if (h.kind === 'bullion')
    return { date: input.localDate, timeZone: input.timeZone, daily: false };
  if (h.day === null) return null;
  return {
    date: h.day.sessionDate,
    timeZone: h.day.timeZone,
    daily: h.day.granularity === '1d' || h.kind === 'managed_fund',
  };
}

/** §2.6: stored points plus `[priceAsOf, price]` when later than the last point and in the session. */
function lineOf(h: Inner): DayLineResult | null {
  const day = h.day;
  if (day === null || day.granularity !== '5m' || h.kind === 'managed_fund') return null;
  const points: Array<[number, DecimalString]> = day.points.map(([t, p]) => [t, p]);
  const f = h.fetched;
  if (f !== null) {
    const asOfSeconds = Math.floor(instantMs(f.asOf, 'asOf') / 1000);
    const last = points.at(-1);
    if (
      (last === undefined || asOfSeconds > last[0]) &&
      dateOfSeconds(asOfSeconds, day.timeZone) === day.sessionDate
    )
      points.push([asOfSeconds, decimalString(f.price)]);
  }
  return {
    sessionDate: day.sessionDate,
    timeZone: day.timeZone,
    base: day.previousCloseNative,
    points,
  };
}

function evaluate(h: Inner, input: DayChangeInput): Evaluated {
  const { status, base } = dayStatusOf(h, input);
  const result: DayHoldingResult = {
    key: h.key,
    instrumentId: h.instrumentId,
    kind: h.kind,
    metal: h.metal,
    items: h.items,
    units: decimalString(h.units),
    priceStatus: h.priceStatus,
    price: h.price === null ? null : decimalString(h.price),
    priceAsOf: h.priceAsOf,
    valueCents: status === 'unpriced' ? null : h.valueCents,
    weightRatio: null,
    dayStatus: status,
    previousClose: null,
    changePerUnit: null,
    dayRatio: null,
    dayCents: null,
    newUnits: '0',
    laterUnits: '0',
    native: nativeOf(h, status),
    session: sessionOf(h, input),
    line: null,
  };
  if (status !== 'ok' || base === null || h.price === null || h.day === null)
    return { result, ok: null };

  const P = h.price;
  const session = h.day.sessionDate;
  let newUnits = ZERO;
  let laterUnits = ZERO;
  const newLots: { units: Dec; price: Dec }[] = [];
  for (const lot of h.lots) {
    if (lot.date === null || lot.date < session) continue;
    if (lot.date > session) laterUnits = laterUnits.plus(lot.units);
    else if (lot.price !== null) {
      newUnits = newUnits.plus(lot.units);
      newLots.push({ units: lot.units, price: lot.price });
    }
  }
  let oldUnits = h.units.minus(newUnits).minus(laterUnits);
  if (oldUnits.lessThan(0)) oldUnits = ZERO;
  let day = oldUnits.times(P.minus(base));
  for (const lot of newLots) day = day.plus(lot.units.times(P.minus(lot.price)));
  const dayCents = centsOf(day);
  const change = P.minus(base);
  result.previousClose = decimalString(base);
  result.changePerUnit = decimalString(change);
  result.dayRatio = ratioString(change.div(base));
  result.dayCents = dayCents;
  result.newUnits = decimalString(newUnits);
  result.laterUnits = decimalString(laterUnits);
  result.line = lineOf(h);

  const line = result.line;
  return {
    result,
    ok: {
      dayCents,
      laterCents: centsOf(laterUnits.times(P)),
      line:
        line === null || line.points.length === 0
          ? null
          : {
              sessionDate: line.sessionDate,
              points: line.points,
              fxNow: decimalString(h.fetched?.fxNow ?? decN(1)),
              oldUnits: decimalString(oldUnits),
              newLots: newLots.map((l) => ({
                units: decimalString(l.units),
                price: decimalString(l.price),
              })),
              base: decimalString(base),
            },
    },
  };
}

// ─── The portfolio line (§2.5) ──────────────────────────────────────────────────────────────────

interface PreparedLine {
  times: number[];
  prices: Dec[];
  fxNow: Dec;
  oldUnits: Dec;
  newLots: { units: Dec; price: Dec }[];
  base: Dec;
  sessionDate: IsoDate;
}

function contribution(l: PreparedLine, p: Dec): Cents {
  const aud = p.times(l.fxNow);
  let day = l.oldUnits.times(aud.minus(l.base));
  for (const lot of l.newLots) day = day.plus(lot.units.times(aud.minus(lot.price)));
  return centsOf(day);
}

export function portfolioLine(input: PortfolioLineInput): PortfolioLineResult | null {
  const lines: { prepared: PreparedLine; dayCents: Cents }[] = [];
  const flat: Cents[] = [];
  for (const h of input.holdings) {
    if (h.line === null || h.line.points.length === 0) {
      flat.push(h.dayCents);
      continue;
    }
    lines.push({
      dayCents: h.dayCents,
      prepared: {
        times: h.line.points.map(([t]) => t),
        prices: h.line.points.map(([, p]) => dec(p, 'line point')),
        fxNow: dec(h.line.fxNow, 'fxNow'),
        oldUnits: dec(h.line.oldUnits, 'oldUnits'),
        newLots: h.line.newLots.map((l) => ({
          units: dec(l.units, 'units'),
          price: dec(l.price, 'lot price'),
        })),
        base: dec(h.line.base, 'base'),
        sessionDate: h.line.sessionDate,
      },
    });
  }
  if (lines.length === 0) return null;

  // The window.
  const generatedSeconds = Math.floor(instantMs(input.generatedAt, 'generatedAt') / 1000);
  let earliestToday: number | null = null;
  for (const { prepared } of lines) {
    for (const t of prepared.times) {
      if (earliestToday !== null && t >= earliestToday) continue;
      if (dateOfSeconds(t, input.timeZone) === input.localDate) earliestToday = t;
    }
  }
  let from: number;
  let to: number;
  let sessionDate: IsoDate;
  if (earliestToday !== null) {
    from = Math.floor(earliestToday / STEP_SECONDS) * STEP_SECONDS;
    to = generatedSeconds;
    sessionDate = input.localDate;
  } else {
    let pick = lines[0]!.prepared;
    for (const { prepared } of lines) {
      const last = prepared.times.at(-1)!;
      const pickLast = pick.times.at(-1)!;
      if (last > pickLast || (last === pickLast && prepared.times[0]! < pick.times[0]!))
        pick = prepared;
    }
    from = pick.times[0]!;
    to = pick.times.at(-1)!;
    sessionDate = pick.sessionDate;
  }

  const grid: number[] = [];
  for (let t = from; t < to; t += STEP_SECONDS) grid.push(t);
  grid.push(to);

  const flatCents = flat.reduce((a, b) => a + b, 0);
  const totalDay = flatCents + lines.reduce((a, l) => a + l.dayCents, 0);
  const finals = lines.map(({ prepared }) =>
    prepared.times.at(-1)! < from ? contribution(prepared, prepared.prices.at(-1)!) : null,
  );
  const cursors = lines.map(() => -1);
  const points: Array<[number, Cents]> = [];
  for (const t of grid) {
    if (t >= to) {
      points.push([t, totalDay]);
      continue;
    }
    let sum = flatCents;
    lines.forEach(({ prepared }, i) => {
      const final = finals[i];
      if (final !== null && final !== undefined) {
        sum += final;
        return;
      }
      let c = cursors[i]!;
      while (c + 1 < prepared.times.length && prepared.times[c + 1]! <= t) c += 1;
      cursors[i] = c;
      if (c >= 0) sum += contribution(prepared, prepared.prices[c]!);
    });
    points.push([t, sum]);
  }

  return {
    from: isoOfSeconds(from),
    to: isoOfSeconds(to),
    sessionDate,
    points: downsample(points, LINE_MAX_POINTS),
  };
}

// ─── The whole computation ──────────────────────────────────────────────────────────────────────

export function computeDayChange(input: DayChangeInput): DayChangeResult {
  const inners = instrumentInners(input);
  for (const b of input.bullion) {
    const inner = bullionInner(b);
    if (inner !== null) inners.push(inner);
  }
  const evaluated = inners.map((h) => evaluate(h, input));

  let valueCents = 0;
  for (const { result } of evaluated)
    if (result.valueCents !== null) valueCents += result.valueCents;

  let dayCents: Cents | null = null;
  let baseCents: Cents | null = null;
  let up = 0;
  let down = 0;
  let flatCount = 0;
  let noChange = 0;
  for (const { result, ok } of evaluated) {
    if (result.valueCents !== null && valueCents !== 0)
      result.weightRatio = ratioString(decN(result.valueCents).div(valueCents));
    if (ok === null) {
      noChange += 1;
      continue;
    }
    dayCents = (dayCents ?? 0) + ok.dayCents;
    baseCents = (baseCents ?? 0) + (result.valueCents ?? 0) - ok.dayCents - ok.laterCents;
    if (ok.dayCents > 0) up += 1;
    else if (ok.dayCents < 0) down += 1;
    else flatCount += 1;
  }

  const line = portfolioLine({
    timeZone: input.timeZone,
    localDate: input.localDate,
    generatedAt: input.generatedAt,
    holdings: evaluated.flatMap(({ ok }) =>
      ok === null ? [] : [{ dayCents: ok.dayCents, line: ok.line }],
    ),
  });

  return {
    holdings: evaluated.map((e) => e.result),
    totals: {
      valueCents,
      dayCents,
      baseCents,
      dayRatio:
        dayCents !== null && baseCents !== null && baseCents > 0
          ? ratioString(decN(dayCents).div(baseCents))
          : null,
      up,
      down,
      flat: flatCount,
      noChange,
      holdings: evaluated.length,
    },
    portfolioLine: line,
  };
}
