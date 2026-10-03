// The period rules of the phone app (stage-10.md §2, FROZEN): 1W · 2W · 1M · 3M · 6M · 12M · ALL
// (D158). 1W–12M measure the units held at the start from the close of the start date, the units
// bought within the period from their purchase price, and nothing for units sold within it (D160);
// a holding held at the start without a start close shows "—" for those units while its in-period
// buys still count (D165). ALL is the web's unrealised + realised, sold instruments included, as a
// share of the cost of every unit ever bought (D161), with a "Sold holdings" figure (D162). Totals
// are exact sums; the period lines are built from daily closes and end at the total (D164), except
// ALL's, which draws today's holdings only and ends at their unrealised gain (D167).
// Pure and zone-free: every input is a calendar date (the server turns every instant into a date in
// the right zone), so nothing here calls Intl or reads the process zone. `dayChange.ts` is not
// imported: `downsample` is re-implemented locally.
import {
  BULLION_HOLDINGS,
  LINE_MAX_POINTS,
  PERIOD_HOLDING_POINTS,
  PERIOD_SPANS,
  PERIOD_START_MAX_GAP_DAYS,
  SERVER_PERIODS,
  SOLD_HOLDINGS_KEY,
  addMonthsIso,
  holdingKey,
  type DecimalString,
  type InstrumentKind,
  type IsoDate,
  type Metal,
  type MobilePeriodDto,
  type MobilePeriodFigureDto,
  type MobilePeriodLineDto,
  type PeriodStatus,
  type ServerPeriod,
} from '@joinr/schema';
import {
  ZERO,
  addDaysIso,
  centsOf,
  daysBetween,
  dec,
  decN,
  decimalString,
  priceString,
  ratioString,
  type Dec,
} from './num';
import type { Cents, HoldingResult, LotResult, OtherAssetResult } from './types';

export type { ServerPeriod } from '@joinr/schema';

// ─── Inputs (FROZEN, §2.8) ──────────────────────────────────────────────────────────────────────

/** Ascending, unique dates. */
export type DatedValues = ReadonlyArray<readonly [IsoDate, DecimalString]>;

export interface PeriodCloseSeries {
  /** The closes' native currency (instrument_closes.currency). */
  currency: string;
  /** Native closes in the instrument's date system (§2.1). */
  closes: DatedValues;
  /** AUD per native unit by date (§2.1); null for AUD (factor 1). Built by the server from series_closes. */
  audPerUnit: DatedValues | null;
  splits: readonly IsoDate[];
}

export interface PeriodBullionRowInput {
  /** Held AND sold rows. */
  asset: OtherAssetResult;
  ozPerUnit: DecimalString;
  purchaseDate: IsoDate | null;
  /** Per unit of the row (unitCost × purchase FX); null → unknown. */
  unitCostAud: DecimalString | null;
  /** units − legacySoldUnits. */
  boughtUnits: DecimalString;
}

export interface PeriodBullionInput {
  metal: Metal;
  /** Every bullion row priced with this metal. */
  rows: readonly PeriodBullionRowInput[];
  /** P per ounce, exactly as /today's bullion holding (§2.1). */
  price: DecimalString | null;
  /** p (§2.1): the spot's as-of date in the server's zone. */
  priceDate: IsoDate | null;
  /** XAG_AUD_OZ / XAU_AUD_OZ by Melbourne date. */
  closes: DatedValues;
}

export interface PeriodChangeInput {
  localDate: IsoDate;
  /** EVERY instrument of the four kinds (held, watching, exited). */
  holdings: readonly HoldingResult[];
  kinds: ReadonlyMap<number, InstrumentKind>;
  /** Every lot, fully sold ones included. */
  lots: readonly LotResult[];
  // No disposals: the ALL figure takes realisedCents from HoldingResult and the ALL line has no
  // sale steps (D167).
  /** By instrument id; absent → no closes. */
  closes: ReadonlyMap<number, PeriodCloseSeries>;
  /** p (§2.1) by instrument id; absent or null → no check. */
  priceDates: ReadonlyMap<number, IsoDate | null>;
  /** One per metal with any bullion row (silver, then gold). */
  bullion: readonly PeriodBullionInput[];
}

export const PERIOD_ENGINE_VERSION = 1;

// ─── Outputs: exactly the §4.2 DTO shapes ───────────────────────────────────────────────────────

/** One figure: exactly `MobilePeriodFigureDto`'s fields. */
export type PeriodFigureResult = MobilePeriodFigureDto;
/** The portfolio line of one period (≤ LINE_MAX_POINTS). */
export type PeriodLineResult = MobilePeriodLineDto;
export type PeriodTotalsResult = MobilePeriodDto['totals'];
/** `{ period, startDate, totals, line, figures }`: exactly `MobilePeriodDto`. */
export type PeriodResult = MobilePeriodDto;

export interface PeriodsResult {
  /** SERVER_PERIODS order. */
  periods: PeriodResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

/** S for 1W–12M (§2.1): days back, or EDATE months back (the day clamped); null for ALL. */
export function periodStartDate(localDate: IsoDate, period: ServerPeriod): IsoDate | null {
  if (period === 'ALL') return null;
  const span: { days?: number; months?: number } = PERIOD_SPANS[period];
  if (span.days !== undefined) return addDaysIso(localDate, -span.days);
  return addMonthsIso(localDate, -(span.months ?? 0));
}

/** The first and last always kept, duplicates removed (the Stage 9 rule, copied). */
function downsample<T>(points: readonly T[], max: number): T[] {
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

/** A parsed, ascending dated series. */
interface Series {
  dates: IsoDate[];
  values: Dec[];
}

function seriesOf(values: DatedValues, what: string): Series {
  const dates: IsoDate[] = [];
  const out: Dec[] = [];
  for (const [date, value] of values) {
    const last = dates.at(-1);
    if (last !== undefined && date <= last)
      throw new RangeError(`engine: ${what} dates must ascend: ${last} then ${date}`);
    daysBetween(date, date); // validates the date
    dates.push(date);
    out.push(dec(value, what));
  }
  return { dates, values: out };
}

/** The index of the last entry dated on or before `date`; −1 when none. */
function lastAtOrBefore(dates: readonly IsoDate[], date: IsoDate): number {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ─── The internal holding shape (instruments and bullion run one code path) ────────────────────

interface Lot {
  /** Remaining units (bullion: ounces). */
  units: Dec;
  /** Null → held before any start (bullion without a purchase date). */
  date: IsoDate | null;
  /** AUD per unit without the fee; null → unknown cost (bullion only). */
  price: Dec | null;
  /** fee × remaining ÷ units, in dollars (instruments; 0 for bullion). */
  feeShare: Dec;
}

interface AllPart {
  status: PeriodStatus;
  unrealisedCents: Cents | null;
  realisedCents: Cents;
  costEverCents: Cents;
  /** The line's dashed base (engine averagePrice; bullion: the average cost per ounce). */
  averagePrice: Dec | null;
  /** Bullion: every held row has a purchase date and a known cost (§2.6). */
  rowsComplete: boolean;
}

interface Inner {
  key: string;
  /** P (AUD; bullion: AUD per ounce). */
  price: Dec | null;
  valueCents: Cents | null;
  /** p (§2.1). */
  priceDate: IsoDate | null;
  /** The remaining lots (bullion: the held rows). */
  lots: Lot[];
  /** Native closes (bullion: AUD per ounce). */
  closes: Series;
  /** AUD per native unit; null → factor 1. */
  fx: Series | null;
  /** The closes in AUD where the FX factor is known (any age): the lines' C(d). */
  aud: Series;
  splits: IsoDate[];
  all: AllPart;
}

function audSeriesOf(closes: Series, fx: Series | null): Series {
  if (fx === null) return closes;
  const dates: IsoDate[] = [];
  const values: Dec[] = [];
  closes.dates.forEach((date, i) => {
    const j = lastAtOrBefore(fx.dates, date);
    if (j < 0) return;
    dates.push(date);
    values.push(closes.values[i]!.times(fx.values[j]!));
  });
  return { dates, values };
}

const EMPTY_SERIES: Series = { dates: [], values: [] };

function lotsByInstrument(lots: readonly LotResult[]): Map<number, LotResult[]> {
  const out = new Map<number, LotResult[]>();
  for (const lot of lots) {
    const list = out.get(lot.instrumentId) ?? [];
    list.push(lot);
    out.set(lot.instrumentId, list);
  }
  return out;
}

/** Σ every lot's units × price + Σ fees, rounded once (§2.3). */
function costEverOf(lots: readonly LotResult[]): Cents {
  let total = ZERO;
  for (const l of lots) {
    total = total
      .plus(dec(l.units, 'lot units').times(dec(l.price, 'lot price')))
      .plus(decN(l.feeCents).div(100));
  }
  return centsOf(total);
}

function instrumentInner(
  h: HoldingResult,
  lots: readonly LotResult[],
  input: PeriodChangeInput,
): Inner {
  const series = input.closes.get(h.instrumentId);
  const closes = series === undefined ? EMPTY_SERIES : seriesOf(series.closes, 'close');
  const fx =
    series === undefined || series.audPerUnit === null
      ? null
      : seriesOf(series.audPerUnit, 'audPerUnit');
  const remaining: Lot[] = [];
  for (const l of lots) {
    const units = dec(l.remainingUnits, 'remainingUnits');
    if (!units.greaterThan(0)) continue;
    const original = dec(l.units, 'lot units');
    remaining.push({
      units,
      date: l.tradeDate,
      price: dec(l.price, 'lot price'),
      feeShare: original.greaterThan(0)
        ? decN(l.feeCents).div(100).times(units).div(original)
        : ZERO,
    });
  }
  const unrealised = h.unrealisedCents;
  return {
    key: holdingKey(h.instrumentId),
    price: h.price === null ? null : dec(h.price, 'price'),
    valueCents: h.valueCents,
    priceDate: input.priceDates.get(h.instrumentId) ?? null,
    lots: remaining,
    closes,
    fx,
    aud: audSeriesOf(closes, fx),
    splits: [...(series?.splits ?? [])].sort(),
    all: {
      status: unrealised === null ? 'unpriced' : 'ok',
      unrealisedCents: unrealised,
      realisedCents: h.realisedCents,
      costEverCents: costEverOf(lots),
      averagePrice: h.averagePrice === null ? null : dec(h.averagePrice, 'averagePrice'),
      rowsComplete: true,
    },
  };
}

interface BullionRow {
  input: PeriodBullionRowInput;
  oz: Dec;
  held: boolean;
}

function bullionRows(b: PeriodBullionInput): BullionRow[] {
  return b.rows.map((input) => ({
    input,
    oz: dec(input.ozPerUnit, 'ozPerUnit'),
    held: dec(input.asset.remainingUnits, 'remainingUnits').greaterThan(0),
  }));
}

/** Σ rows' centsOf(boughtUnits × unitCostAud) over the rows with a known cost (§2.3). */
function bullionCostEver(rows: readonly BullionRow[]): Cents {
  let total = 0;
  for (const r of rows) {
    if (r.input.unitCostAud === null) continue;
    total += centsOf(
      dec(r.input.boughtUnits, 'boughtUnits').times(dec(r.input.unitCostAud, 'unitCostAud')),
    );
  }
  return total;
}

function bullionRealised(rows: readonly BullionRow[]): Cents {
  return rows.reduce((a, r) => a + r.input.asset.realisedCents, 0);
}

function bullionInner(b: PeriodBullionInput): Inner | null {
  const rows = bullionRows(b);
  const held = rows.filter((r) => r.held);
  if (held.length === 0) return null;
  const lots: Lot[] = [];
  let valueCents: Cents | null = null;
  let costOz = ZERO;
  let costValue = ZERO;
  let rowsComplete = true;
  for (const r of held) {
    const rowOz = dec(r.input.asset.remainingUnits, 'remainingUnits').times(r.oz);
    const price =
      r.input.unitCostAud === null || !r.oz.greaterThan(0)
        ? null
        : dec(r.input.unitCostAud, 'unitCostAud').div(r.oz);
    lots.push({ units: rowOz, date: r.input.purchaseDate, price, feeShare: ZERO });
    if (r.input.asset.valueCents !== null)
      valueCents = (valueCents ?? 0) + r.input.asset.valueCents;
    if (price === null || r.input.purchaseDate === null) rowsComplete = false;
    if (price !== null) {
      costOz = costOz.plus(rowOz);
      costValue = costValue.plus(rowOz.times(price));
    }
  }
  const price = b.price === null ? null : dec(b.price, 'bullion price');
  // ALL (§2.3): any held row without a gain leaves the metal out ("—").
  let status: PeriodStatus = 'ok';
  if (price === null || valueCents === null) status = 'unpriced';
  else if (held.some((r) => r.input.asset.gainCents === null)) {
    status = held.some(
      (r) => r.input.asset.gainCents === null && r.input.asset.unitPriceAud !== null,
    )
      ? 'no_cost'
      : 'unpriced';
  }
  const closes = seriesOf(b.closes, 'bullion close');
  return {
    key: BULLION_HOLDINGS[b.metal].key,
    price,
    valueCents,
    priceDate: b.priceDate,
    lots,
    closes,
    fx: null,
    aud: closes,
    splits: [],
    all: {
      status,
      unrealisedCents:
        status === 'ok' ? held.reduce((a, r) => a + r.input.asset.gainCents!, 0) : null,
      realisedCents: bullionRealised(rows),
      costEverCents: bullionCostEver(rows),
      averagePrice: costOz.greaterThan(0) ? costValue.div(costOz) : null,
      rowsComplete,
    },
  };
}

// ─── 1W–12M (§2.2, §2.4, §2.5) ──────────────────────────────────────────────────────────────────

/** What one holding brings to the totals and the period line. */
interface Contribution {
  cents: Cents;
  base: Cents;
  /** Null → flat (its cents at every point). */
  drawn: {
    inner: Inner;
    startUnits: Dec;
    /** B (0 when there are no start units). */
    base: Dec;
    within: Lot[];
    /** The AUD closes' indices in the line's window. */
    indices: number[];
  } | null;
}

function emptyFigure(key: string, status: PeriodStatus): PeriodFigureResult {
  return {
    key,
    status,
    cents: null,
    ratio: null,
    startClose: null,
    startCloseDate: null,
    changePerUnit: null,
    priceRatio: null,
    startUnits: '0',
    newUnits: '0',
    laterUnits: '0',
    newCostCents: null,
    unrealisedCents: null,
    realisedCents: null,
    costEverCents: null,
    soldCount: null,
    line: null,
  };
}

/** The line's points of one drawn holding: its AUD closes in the window, then [localDate, P]. */
function holdingLine(
  inner: Inner,
  indices: readonly number[],
  base: Dec | null,
  localDate: IsoDate,
): PeriodFigureResult['line'] {
  const points: Array<[IsoDate, DecimalString]> = indices.map((i) => [
    inner.aud.dates[i]!,
    priceString(inner.aud.values[i]!),
  ]);
  points.push([localDate, decimalString(inner.price!)]);
  return {
    base: base === null ? null : priceString(base),
    points: downsample(points, PERIOD_HOLDING_POINTS),
  };
}

/** The AUD close indices dated in [from, localDate). */
function windowIndices(inner: Inner, from: IsoDate, localDate: IsoDate): number[] {
  const out: number[] = [];
  inner.aud.dates.forEach((d, i) => {
    if (d >= from && d < localDate) out.push(i);
  });
  return out;
}

function evaluateDated(
  inner: Inner,
  S: IsoDate,
  localDate: IsoDate,
): { figure: PeriodFigureResult; contribution: Contribution | null } {
  const start: Lot[] = [];
  const within: Lot[] = [];
  let startUnits = ZERO;
  let newUnits = ZERO;
  let laterUnits = ZERO;
  for (const lot of inner.lots) {
    if (lot.date !== null && lot.date > localDate) laterUnits = laterUnits.plus(lot.units);
    else if (lot.date === null || lot.date <= S || lot.price === null) {
      start.push(lot);
      startUnits = startUnits.plus(lot.units);
    } else {
      within.push(lot);
      newUnits = newUnits.plus(lot.units);
    }
  }
  const figure = emptyFigure(inner.key, 'ok');
  figure.startUnits = decimalString(startUnits);
  figure.newUnits = decimalString(newUnits);
  figure.laterUnits = decimalString(laterUnits);

  // Rule 1.
  if (inner.price === null || inner.valueCents === null) {
    figure.status = 'unpriced';
    return { figure, contribution: null };
  }
  const P = inner.price;
  const hasStart = startUnits.greaterThan(0);

  // The start close: the last close on or before S, at most PERIOD_START_MAX_GAP_DAYS before it.
  let b: IsoDate | null = null;
  let B: Dec | null = null;
  const ci = lastAtOrBefore(inner.closes.dates, S);
  if (ci >= 0 && daysBetween(inner.closes.dates[ci]!, S) <= PERIOD_START_MAX_GAP_DAYS) {
    b = inner.closes.dates[ci]!;
    let factor: Dec | null = decN(1);
    if (inner.fx !== null) {
      const fi = lastAtOrBefore(inner.fx.dates, b);
      factor =
        fi >= 0 && daysBetween(inner.fx.dates[fi]!, b) <= PERIOD_START_MAX_GAP_DAYS
          ? inner.fx.values[fi]!
          : null;
    }
    if (factor !== null) {
      const value = inner.closes.values[ci]!.times(factor);
      if (value.greaterThan(0)) B = value;
    }
  }

  // Rule 2: a split the start units or a within lot straddle.
  const splitFrom = b ?? S;
  const splitIn = (after: IsoDate) => inner.splits.some((d) => d > after && d <= localDate);
  if ((hasStart && splitIn(splitFrom)) || within.some((lot) => splitIn(lot.date!))) {
    figure.status = 'split';
    return { figure, contribution: null };
  }

  // Rule 3: a price older than the start.
  const reference = hasStart && b !== null ? b : S;
  if (inner.priceDate !== null && inner.priceDate < reference) {
    figure.status = 'no_start';
    return { figure, contribution: null };
  }

  let withinSum = ZERO;
  let withinCost = ZERO;
  for (const lot of within) {
    withinSum = withinSum.plus(lot.units.times(P.minus(lot.price!)));
    withinCost = withinCost.plus(lot.units.times(lot.price!));
  }
  const newCostCents = within.length === 0 ? null : centsOf(withinCost);
  figure.newCostCents = newCostCents;
  const firstWithin = within.reduce<IsoDate | null>(
    (a, lot) => (a === null || lot.date! < a ? lot.date! : a),
    null,
  );
  const withinBase = newUnits.greaterThan(0) ? withinCost.div(newUnits) : null;

  // Rule 4 (D165): start units without a start close; the bought-within part still counts.
  if (hasStart && B === null) {
    figure.status = 'no_start';
    if (within.length === 0) return { figure, contribution: null };
    const cents = centsOf(withinSum);
    figure.cents = cents;
    figure.ratio = newCostCents! > 0 ? ratioString(decN(cents).div(newCostCents!)) : null;
    const indices = windowIndices(inner, firstWithin!, localDate);
    const drawn =
      indices.length === 0 ? null : { inner, startUnits: ZERO, base: ZERO, within, indices };
    if (drawn !== null) figure.line = holdingLine(inner, indices, withinBase, localDate);
    return { figure, contribution: { cents, base: newCostCents!, drawn } };
  }

  // Rule 5: ok.
  const startBase = hasStart ? B! : ZERO;
  const period = startUnits.times(P.minus(startBase)).plus(withinSum);
  const cents = centsOf(period);
  const laterCents = centsOf(laterUnits.times(P));
  const base = inner.valueCents - cents - laterCents;
  figure.cents = cents;
  figure.ratio = base > 0 ? ratioString(decN(cents).div(base)) : null;
  if (hasStart) {
    figure.startClose = decimalString(B!);
    figure.startCloseDate = b;
    figure.changePerUnit = decimalString(P.minus(B!));
    figure.priceRatio = ratioString(P.minus(B!).div(B!));
  }
  const from = hasStart ? b! : firstWithin;
  const indices = from === null ? [] : windowIndices(inner, from, localDate);
  const drawn =
    indices.length === 0 ? null : { inner, startUnits, base: startBase, within, indices };
  if (drawn !== null)
    figure.line = holdingLine(inner, indices, hasStart ? B! : withinBase, localDate);
  return { figure, contribution: { cents, base, drawn } };
}

/** A drawn holding's cents at a grid date d < localDate (§2.5). */
function datedValueAt(d: NonNullable<Contribution['drawn']>, date: IsoDate): Cents {
  const { inner } = d;
  const i = lastAtOrBefore(inner.aud.dates, date);
  if (i < 0) return 0;
  const C = inner.aud.values[i]!;
  const closeDate = inner.aud.dates[i]!;
  let sum = d.startUnits.greaterThan(0) ? d.startUnits.times(C.minus(d.base)) : ZERO;
  for (const lot of d.within)
    if (closeDate >= lot.date!) sum = sum.plus(lot.units.times(C.minus(lot.price!)));
  return centsOf(sum);
}

function datedLine(
  contributions: readonly Contribution[],
  S: IsoDate,
  localDate: IsoDate,
  totalCents: Cents | null,
): PeriodLineResult | null {
  const drawn = contributions.flatMap((c) => (c.drawn === null ? [] : [c.drawn]));
  if (drawn.length === 0 || totalCents === null) return null;
  const flat = contributions.reduce((a, c) => (c.drawn === null ? a + c.cents : a), 0);
  const dates = new Set<IsoDate>();
  for (const d of drawn)
    for (const i of d.indices) {
      const date = d.inner.aud.dates[i]!;
      if (date > S && date < localDate) dates.add(date);
    }
  const grid = [S, ...[...dates].sort()];
  const points: Array<[IsoDate, Cents]> = grid.map((date) => [
    date,
    drawn.reduce((a, d) => a + datedValueAt(d, date), flat),
  ]);
  points.push([localDate, totalCents]);
  return { from: S, to: localDate, points: downsample(points, LINE_MAX_POINTS) };
}

function datedPeriod(
  inners: readonly Inner[],
  period: ServerPeriod,
  S: IsoDate,
  localDate: IsoDate,
): PeriodResult {
  const figures: PeriodFigureResult[] = [];
  const contributions: Contribution[] = [];
  let cents: Cents | null = null;
  let baseCents: Cents | null = null;
  let up = 0;
  let down = 0;
  let flat = 0;
  let missing = 0;
  for (const inner of inners) {
    const { figure, contribution } = evaluateDated(inner, S, localDate);
    figures.push(figure);
    if (figure.status === 'ok') {
      if (figure.cents! > 0) up += 1;
      else if (figure.cents! < 0) down += 1;
      else flat += 1;
    } else missing += 1;
    if (contribution !== null) {
      contributions.push(contribution);
      cents = (cents ?? 0) + contribution.cents;
      baseCents = (baseCents ?? 0) + contribution.base;
    }
  }
  return {
    period,
    startDate: S,
    totals: {
      cents,
      ratio:
        cents !== null && baseCents !== null && baseCents > 0
          ? ratioString(decN(cents).div(baseCents))
          : null,
      baseCents,
      up,
      down,
      flat,
      missing,
      holdings: inners.length,
      partial: missing > 0,
      unrealisedCents: null,
      realisedCents: null,
    },
    line: datedLine(contributions, S, localDate, cents),
    figures,
  };
}

// ─── ALL (§2.3, §2.4, §2.6) ─────────────────────────────────────────────────────────────────────

interface AllDrawn {
  inner: Inner;
  /** The earliest remaining lot's date. */
  first: IsoDate;
  /** The AUD close indices dated in [first, localDate). */
  indices: number[];
}

/** §2.6: drawn when the closes reach back to the earliest remaining lot and no split follows it. */
function allDrawn(inner: Inner, localDate: IsoDate): AllDrawn | null {
  if (inner.all.status !== 'ok' || !inner.all.rowsComplete || inner.lots.length === 0) return null;
  let first: IsoDate | null = null;
  for (const lot of inner.lots) {
    if (lot.date === null || lot.price === null) return null;
    if (first === null || lot.date < first) first = lot.date;
  }
  if (first === null || first >= localDate) return null;
  const firstClose = inner.aud.dates[0];
  if (firstClose === undefined || daysBetween(first, firstClose) > PERIOD_START_MAX_GAP_DAYS)
    return null;
  if (inner.splits.some((d) => d > first && d <= localDate)) return null;
  // No close since the earliest lot (a holding bought after the last stored close): flat, so its
  // unrealised part is not a jump at the last point.
  const indices = windowIndices(inner, first, localDate);
  return indices.length === 0 ? null : { inner, first, indices };
}

/** A drawn holding's unrealised gain of today's lots as at d < localDate (§2.6). */
function allValueAt(d: AllDrawn, date: IsoDate): Cents {
  const { inner } = d;
  const i = lastAtOrBefore(inner.aud.dates, date);
  const C = i < 0 ? null : inner.aud.values[i]!;
  const closeDate = i < 0 ? null : inner.aud.dates[i]!;
  let sum = ZERO;
  for (const lot of inner.lots) {
    if (lot.date! > date) continue;
    if (C !== null && closeDate! >= lot.date!) sum = sum.plus(lot.units.times(C.minus(lot.price!)));
    sum = sum.minus(lot.feeShare);
  }
  return centsOf(sum);
}

function allFigure(inner: Inner): PeriodFigureResult {
  const a = inner.all;
  const figure = emptyFigure(inner.key, a.status);
  figure.unrealisedCents = a.unrealisedCents;
  figure.realisedCents = a.realisedCents;
  figure.costEverCents = a.costEverCents;
  if (a.status === 'ok') {
    const cents = a.unrealisedCents! + a.realisedCents;
    figure.cents = cents;
    figure.ratio = a.costEverCents > 0 ? ratioString(decN(cents).div(a.costEverCents)) : null;
  }
  return figure;
}

interface Sold {
  cents: Cents;
  costEverCents: Cents;
  count: number;
}

function soldOf(input: PeriodChangeInput, lotsById: ReadonlyMap<number, LotResult[]>): Sold {
  let cents = 0;
  let costEverCents = 0;
  let count = 0;
  for (const h of input.holdings) {
    if (dec(h.openUnits, 'openUnits').greaterThan(0)) continue;
    const lots = lotsById.get(h.instrumentId) ?? [];
    if (lots.length === 0) continue;
    cents += h.realisedCents;
    costEverCents += costEverOf(lots);
    count += 1;
  }
  for (const b of input.bullion) {
    const rows = bullionRows(b);
    if (rows.length === 0 || rows.some((r) => r.held)) continue;
    cents += bullionRealised(rows);
    costEverCents += bullionCostEver(rows);
    count += 1;
  }
  return { cents, costEverCents, count };
}

function allPeriod(inners: readonly Inner[], sold: Sold, localDate: IsoDate): PeriodResult {
  const figures = inners.map(allFigure);
  const ok = inners.filter((i) => i.all.status === 'ok');
  const any = ok.length > 0 || sold.count > 0;
  let cents = 0;
  let baseCents = 0;
  let unrealised = 0;
  let realised = 0;
  for (const inner of ok) {
    cents += inner.all.unrealisedCents! + inner.all.realisedCents;
    baseCents += inner.all.costEverCents;
    unrealised += inner.all.unrealisedCents!;
    realised += inner.all.realisedCents;
  }
  if (sold.count > 0) {
    cents += sold.cents;
    baseCents += sold.costEverCents;
    realised += sold.cents;
    const figure = emptyFigure(SOLD_HOLDINGS_KEY, 'ok');
    figure.cents = sold.cents;
    figure.ratio =
      sold.costEverCents > 0 ? ratioString(decN(sold.cents).div(sold.costEverCents)) : null;
    figure.unrealisedCents = 0;
    figure.realisedCents = sold.cents;
    figure.costEverCents = sold.costEverCents;
    figure.soldCount = sold.count;
    figures.push(figure);
  }
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const f of figures.slice(0, inners.length)) {
    if (f.status !== 'ok') continue;
    if (f.cents! > 0) up += 1;
    else if (f.cents! < 0) down += 1;
    else flat += 1;
  }

  // The line (D167): today's holdings' unrealised gain over time, ending at Σ unrealised.
  let line: PeriodLineResult | null = null;
  const drawn: AllDrawn[] = [];
  let flatCents = 0;
  ok.forEach((inner) => {
    const d = allDrawn(inner, localDate);
    if (d === null) flatCents += inner.all.unrealisedCents!;
    else {
      drawn.push(d);
      const figure = figures[inners.indexOf(inner)]!;
      figure.line = holdingLine(inner, d.indices, inner.all.averagePrice, localDate);
    }
  });
  if (drawn.length > 0) {
    const F = drawn.reduce((a, d) => (d.first < a ? d.first : a), drawn[0]!.first);
    const dates = new Set<IsoDate>();
    for (const d of drawn)
      for (const date of d.inner.aud.dates) if (date > F && date < localDate) dates.add(date);
    const grid = [F, ...[...dates].sort()];
    const points: Array<[IsoDate, Cents]> = grid.map((date) => [
      date,
      drawn.reduce((a, d) => a + allValueAt(d, date), flatCents),
    ]);
    points.push([localDate, unrealised]);
    line = { from: F, to: localDate, points: downsample(points, LINE_MAX_POINTS) };
  }

  return {
    period: 'ALL',
    startDate: null,
    totals: {
      cents: any ? cents : null,
      ratio: any && baseCents > 0 ? ratioString(decN(cents).div(baseCents)) : null,
      baseCents: any ? baseCents : null,
      up,
      down,
      flat,
      missing: inners.length - ok.length,
      holdings: inners.length,
      partial: inners.length - ok.length > 0,
      unrealisedCents: any ? unrealised : null,
      realisedCents: any ? realised : null,
    },
    line,
    figures,
  };
}

// ─── The whole computation ──────────────────────────────────────────────────────────────────────

export function computePeriods(input: PeriodChangeInput): PeriodsResult {
  daysBetween(input.localDate, input.localDate); // validates the date
  const lotsById = lotsByInstrument(input.lots);
  const inners: Inner[] = [];
  for (const h of input.holdings) {
    if (!dec(h.openUnits, 'openUnits').greaterThan(0)) continue;
    if (!input.kinds.has(h.instrumentId))
      throw new RangeError(`engine: no kind for instrument ${h.instrumentId}`);
    inners.push(instrumentInner(h, lotsById.get(h.instrumentId) ?? [], input));
  }
  for (const b of input.bullion) {
    const inner = bullionInner(b);
    if (inner !== null) inners.push(inner);
  }
  const sold = soldOf(input, lotsById);
  const periods = SERVER_PERIODS.map((period): PeriodResult => {
    const S = periodStartDate(input.localDate, period);
    return S === null
      ? allPeriod(inners, sold, input.localDate)
      : datedPeriod(inners, period, S, input.localDate);
  });
  return { periods };
}
