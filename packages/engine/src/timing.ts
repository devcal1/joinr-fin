// Investment timing (stage-2.md §2.12, D39, D40; stage-3.md §2.12): the parcel optimiser (an
// inferred formula), the cash-deficit wait (SheetOptions H12), the countdown to the next buy,
// "consider next" and the next-buy hint. The Budget chain lives in budget.ts. Every template
// constant below is the template's own (spec 02 §0.5, spec 01 §5.4).
import {
  ASSET_CLASSES,
  JoinrDecimal,
  type AssetClass,
  type DecimalString,
  type InstrumentKind,
  type IsoDate,
} from '@joinr/schema';
import {
  addDaysIso,
  centsOf,
  dayNumber,
  dec,
  dollarsOf,
  floorWhole,
  ratioString,
  sheetWeekday,
  sum,
  ZERO,
  type Dec,
} from './num';
import type {
  Cents,
  ConsiderNextResult,
  ConsiderNextRow,
  Countdown,
  HoldingResult,
  NextBuyHintResult,
  ParcelPlan,
  TimingInput,
} from './types';

const DAYS_PER_YEAR = 365;
const MAX_PARCEL_MONTHS = 12;

/** Sheets DATE(year, month, day) for whole numbers: a day or month outside its range rolls over. */
export function sheetDate(year: number, month: number, day: number): IsoDate {
  if (![year, month, day].every(Number.isInteger)) {
    throw new RangeError(`sheetDate: whole numbers expected: ${year}, ${month}, ${day}`);
  }
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  const y = d.getUTCFullYear();
  if (y < 1 || y > 9999) throw new RangeError(`sheetDate: year out of range: ${y}`);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(y, 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** stock→'stock', etf→'etf', managed_fund→'managed_fund', crypto→'crypto'. */
export function assetClassOfKind(kind: InstrumentKind): AssetClass {
  const classes: Readonly<Record<InstrumentKind, AssetClass>> = {
    stock: 'stock',
    etf: 'etf',
    managed_fund: 'managed_fund',
    crypto: 'crypto',
  };
  return classes[kind];
}

/**
 * The parcel optimiser (spec 01 §5.4; inferred, the script is not in the export): the classic
 * order-size trade-off sqrt(2 × brokerage × yearly amount / (growth − cash rate)), in whole months
 * clamped to 1–12. Null when the amount is missing or not positive, or an input is missing.
 */
export function parcelOptimiser(i: {
  monthlyInvestCents: Cents | null;
  brokerageCents: Cents | null;
  growthRatio: DecimalString | null;
  cashRateRatio: DecimalString | null;
}): ParcelPlan | null {
  if (i.monthlyInvestCents === null || i.monthlyInvestCents <= 0) return null;
  if (i.brokerageCents === null || i.growthRatio === null || i.cashRateRatio === null) return null;
  const monthly = dollarsOf(i.monthlyInvestCents, 'monthly amount');
  const plan = (months: number, optimal: Dec): ParcelPlan => ({
    months,
    parcelCents: months * i.monthlyInvestCents!,
    optimalParcelCents: centsOf(optimal),
  });
  // No brokerage: buy every month. No return edge over cash: wait the longest period.
  if (i.brokerageCents <= 0) return plan(1, monthly);
  const edge = dec(i.growthRatio, 'growth').minus(dec(i.cashRateRatio, 'cash rate'));
  if (!edge.greaterThan(0)) return plan(MAX_PARCEL_MONTHS, monthly.times(MAX_PARCEL_MONTHS));
  const brokerage = dollarsOf(i.brokerageCents, 'brokerage');
  const optimal = brokerage.times(2).times(12).times(monthly).div(edge).sqrt();
  const months = Math.min(
    MAX_PARCEL_MONTHS,
    Math.max(1, optimal.div(monthly).toDecimalPlaces(0, JoinrDecimal.ROUND_CEIL).toNumber()),
  );
  return plan(months, optimal);
}

/**
 * The cash-deficit wait (SheetOptions H12, stage-3.md §2.12, §11 fix 16): with cash below its
 * target share of the liquid total, the months of average savings that top it up,
 * floor((target × liquid total − cash) / average savings) + 1. Null when there is no target, the
 * cash share is at or above it (the sheet's "-"), the liquid total is not positive or the average
 * savings is missing or not positive (the sheet's IFERROR branch).
 */
export function cashDeficitMonths(i: {
  cashCents: Cents;
  liquidTotalCents: Cents;
  targetRatio: DecimalString | null;
  avgMonthlySavingsCents: Cents | null;
}): number | null {
  const cash = dollarsOf(i.cashCents, 'cash');
  const liquid = dollarsOf(i.liquidTotalCents, 'liquid total');
  if (i.targetRatio === null || i.avgMonthlySavingsCents === null) return null;
  const savings = dollarsOf(i.avgMonthlySavingsCents, 'average savings');
  if (!savings.greaterThan(0) || !liquid.greaterThan(0)) return null;
  const target = dec(i.targetRatio, 'cash target');
  if (cash.div(liquid).greaterThanOrEqualTo(target)) return null;
  return floorWhole(target.times(liquid).minus(cash).div(savings)) + 1;
}

/**
 * The countdown to the next buy (SheetOptions H14–H18, ETFs I18): the last ETF or stock buy's
 * month at pay day + 2, plus 30 days per parcel month, rolled forward to a Thursday (+365 days
 * when growth is 0, the template quirk). Calendar days; the half-day offset is dropped (§11 fix 16).
 * The wait is the longer of the parcel plan and the cash-deficit wait (H14 = MAX(H12:H13),
 * stage-3.md §2.12). Nothing to invest is `cash_first`, or `split_off` when the budget drives the
 * amount and its automatic investment split is off (D46).
 */
export function investCountdown(i: {
  asOf: IsoDate;
  monthlyInvestCents: Cents | null;
  plan: ParcelPlan | null;
  lastPurchaseDate: IsoDate | null;
  payDayOfMonth: number | null;
  growthRatio: DecimalString | null;
  useBudgetForInvest?: boolean | null;
  autoInvestSplit?: boolean | null;
  cashDeficitMonths?: number | null;
}): Countdown {
  const deficit = i.cashDeficitMonths ?? 0;
  if (!Number.isSafeInteger(deficit) || deficit < 0) {
    throw new RangeError(`engine: cash-deficit months must be a whole number: ${deficit}`);
  }
  if (i.monthlyInvestCents === null) return { state: 'unavailable', missing: [] };
  if (i.monthlyInvestCents <= 0) {
    // D46: with the budget driving the amount and its automatic split off, the investment row is
    // $0 by design (the whole leftover goes to cash): say so rather than a bare cash first.
    const splitOff = i.useBudgetForInvest === true && i.autoInvestSplit === false;
    return splitOff ? { state: 'split_off' } : { state: 'cash_first' };
  }
  const missing: TimingInput[] = [];
  if (i.plan === null && i.growthRatio === null) missing.push('returns.marketReturn');
  if (i.lastPurchaseDate === null) missing.push('investments.lastPurchaseDate');
  if (i.payDayOfMonth === null) missing.push('pay.dayOfMonth');
  if (i.plan === null || i.lastPurchaseDate === null || i.payDayOfMonth === null) {
    return { state: 'unavailable', missing };
  }
  const periodDays = 30 * Math.max(i.plan.months, deficit);
  const last = i.lastPurchaseDate;
  const base = sheetDate(Number(last.slice(0, 4)), Number(last.slice(5, 7)), i.payDayOfMonth + 2);
  let next = addDaysIso(base, periodDays);
  const w = sheetWeekday(next);
  next = addDaysIso(next, w <= 5 ? 5 - w : 12 - w);
  if (i.growthRatio !== null && dec(i.growthRatio, 'growth').isZero()) {
    next = addDaysIso(next, DAYS_PER_YEAR);
  }
  const days = dayNumber(next) - dayNumber(i.asOf);
  if (days <= 0) return { state: 'invest', nextPurchaseDate: next, periodDays };
  return { state: 'wait', days, nextPurchaseDate: next, periodDays };
}

/**
 * "Consider next" (Net Worth B36:E45): cash when it is below a known emergency fund, else the
 * class with the minimum current − target (ties in ASSET_CLASSES order), else no targets.
 */
export function considerNext(i: {
  classes: Readonly<Record<AssetClass, { valueCents: Cents; targetRatio: DecimalString | null }>>;
  cashCents: Cents;
  emergencyFundCents: Cents | null;
}): ConsiderNextResult {
  const total = sum(ASSET_CLASSES.map((c) => dollarsOf(i.classes[c].valueCents, `${c} value`)));
  const rows: ConsiderNextRow[] = [];
  let best: { assetClass: AssetClass; delta: Dec } | null = null;
  for (const assetClass of ASSET_CLASSES) {
    const cls = i.classes[assetClass];
    const value = dollarsOf(cls.valueCents);
    const current = total.isZero() ? ZERO : value.div(total);
    const target = cls.targetRatio === null ? null : dec(cls.targetRatio, `${assetClass} target`);
    const delta = target === null ? null : current.minus(target);
    if (delta !== null && (best === null || delta.lessThan(best.delta)))
      best = { assetClass, delta };
    rows.push({
      assetClass,
      valueCents: cls.valueCents,
      currentRatio: ratioString(current),
      targetRatio: target === null ? null : ratioString(target),
      deltaRatio: delta === null ? null : ratioString(delta),
    });
  }
  if (i.emergencyFundCents !== null && i.cashCents < i.emergencyFundCents) {
    return { assetClass: 'cash', reason: 'below_emergency_fund', rows };
  }
  if (best === null) return { assetClass: null, reason: 'no_targets', rows };
  return { assetClass: best.assetClass, reason: 'most_underweight', rows };
}

/** Watched: a watching instrument, or a held one without the `unwatched_held` flag. */
function isWatched(h: HoldingResult): boolean {
  return h.status === 'watching' || (h.status === 'held' && !h.flags.includes('unwatched_held'));
}

/**
 * The next-buy hint (Stocks H19, ETFs I17, Crypto H12): when "consider next" names this kind's
 * class, the watched holding with a target and a current allocation whose difference is the
 * lowest (held unpriced ones are skipped; ties in holding order).
 */
export function nextBuyHint(i: {
  kind: InstrumentKind;
  considerNext: ConsiderNextResult;
  holdings: readonly HoldingResult[];
  parcelCents: Cents | null;
}): NextBuyHintResult {
  const assetClass = i.considerNext.assetClass;
  if (assetClass === null || assetClass !== assetClassOfKind(i.kind)) {
    return { assetClass, instrumentId: null, parcelCents: null };
  }
  let best: { id: number; diff: Dec } | null = null;
  for (const h of i.holdings) {
    if (!isWatched(h) || h.differenceRatio === null || h.targetRatio === null) continue;
    if (!dec(h.targetRatio, 'target').greaterThan(0)) continue;
    const diff = dec(h.differenceRatio, 'difference');
    if (best === null || diff.lessThan(best.diff)) best = { id: h.instrumentId, diff };
  }
  if (best === null) return { assetClass, instrumentId: null, parcelCents: null };
  return { assetClass, instrumentId: best.id, parcelCents: i.parcelCents };
}
