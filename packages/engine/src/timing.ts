// Investment timing (stage-2.md §2.12, D39, D40): the Budget investment amount, the parcel
// optimiser (an inferred formula), the countdown to the next buy, "consider next" and the next-buy
// hint. Every template constant below is the template's own (spec 02 §0.5, spec 01 §5.4).
import {
  ASSET_CLASSES,
  JoinrDecimal,
  type AllocationAggressiveness,
  type AssetClass,
  type DecimalString,
  type InstrumentKind,
  type IsoDate,
  type PayFrequency,
} from '@joinr/schema';
import {
  addDaysIso,
  centsOf,
  dayNumber,
  dec,
  decN,
  dollarsOf,
  maxDec,
  minDec,
  ONE,
  ratioString,
  roundDownToward,
  roundUpAway,
  sheetWeekday,
  sum,
  ZERO,
  type Dec,
} from './num';
import type {
  BudgetInvestInput,
  BudgetInvestResult,
  Cents,
  ConsiderNextResult,
  ConsiderNextRow,
  Countdown,
  HoldingResult,
  NextBuyHintResult,
  ParcelPlan,
  TimingInput,
} from './types';

/** Monthly pay factors (spec 02 §0.5, exact template constants). */
const PAY_FACTORS: Readonly<Record<PayFrequency, Dec>> = {
  monthly: new JoinrDecimal(1),
  four_weekly: new JoinrDecimal('1.0833333333'),
  fortnightly: new JoinrDecimal('4.34523783659').times('0.5'),
  weekly: new JoinrDecimal('4.34523783659'),
  twice_monthly: new JoinrDecimal(2),
};

/** The allocation step k: light 1, normal 2, aggressive 3 (null → aggressive, the else branch). */
const AGGRESSIVENESS_K: Readonly<Record<AllocationAggressiveness, number>> = {
  light: 1,
  normal: 2,
  aggressive: 3,
};

const DAYS_PER_YEAR = 365;
const MAX_PARCEL_MONTHS = 12;

function mean(values: readonly Dec[]): Dec | null {
  return values.length === 0 ? null : sum(values).div(values.length);
}

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
 * The Budget investment row and the D40 monthly amount to invest (Budget B2, C24, J4, L7, D3, C28,
 * C29; SheetOptions H41–H43, H2), in the twelve steps of §2.12.
 */
export function budgetInvestment(input: BudgetInvestInput): BudgetInvestResult {
  const asOfDay = dayNumber(input.asOf);
  const missing: TimingInput[] = [];
  const need = (isMissing: boolean, key: TimingInput) => {
    if (isMissing && !missing.includes(key)) missing.push(key);
  };
  const items = input.items.filter((i) => i.kind === 'item');

  // 1. Monthly income (Budget B2): pay × frequency factor, plus the 365-day side-income mean.
  const periodTotal = (p: { amountCents: Cents }) => dollarsOf(p.amountCents, 'side income');
  const side365 =
    mean(
      input.sideIncomePeriods
        .filter((p) => dayNumber(p.periodStart) > asOfDay - DAYS_PER_YEAR)
        .map(periodTotal),
    ) ?? ZERO;
  const monthlyIncome =
    input.netPayCents === null || input.payFrequency === null
      ? null
      : dollarsOf(input.netPayCents, 'net pay')
          .times(PAY_FACTORS[input.payFrequency])
          .plus(input.includeSideIncome ? side365 : ZERO);

  // 2. Yearly fund (C24): ROUNDUP(Σ annual / 60) × 5 dollars.
  const annual = sum(input.yearlyExpenseAnnualCents.map((c) => dollarsOf(c, 'yearly expense')));
  const yearlyFund = roundUpAway(annual.div(60), 0).times(5);

  // 3–4. Planned spend (J4) and leftover (L7).
  const plannedSpend = sum(
    items.map((i) => (i.monthlyCents === null ? ZERO : dollarsOf(i.monthlyCents, 'budget item'))),
  ).plus(yearlyFund);
  const leftover = monthlyIncome === null ? null : monthlyIncome.minus(plannedSpend);

  // 5. Emergency fund (D3): the override, else ROUNDUP(months × planned / 1000) × 1000 dollars.
  const emergencyFund =
    input.emergencyFundOverrideCents !== null
      ? dollarsOf(input.emergencyFundOverrideCents, 'emergency fund override')
      : input.emergencyFundMonths === null
        ? null
        : roundUpAway(decN(input.emergencyFundMonths).times(plannedSpend).div(1000), 0).times(1000);

  // 6–8. The cash share (H41) and the invest share (H42).
  const k = AGGRESSIVENESS_K[input.aggressiveness ?? 'aggressive'];
  const share =
    input.lastSnapshotCashShare !== null
      ? dec(input.lastSnapshotCashShare, 'last snapshot cash share')
      : input.currentCashShare !== null
        ? dec(input.currentCashShare, 'current cash share')
        : ZERO;
  const cash = dollarsOf(input.cashCents, 'cash');
  const belowEmergency =
    input.useBudgetForInvest === true && emergencyFund !== null && cash.lessThan(emergencyFund);
  let cashShare: Dec | null = null;
  if (input.cashTargetRatio !== null) {
    const target = dec(input.cashTargetRatio, 'cash target');
    const stepped = roundUpAway(target.plus(target.minus(share).times(k)), 2);
    cashShare = maxDec(minDec(stepped, ONE), belowEmergency ? ONE : ZERO);
  }
  const investShare = cashShare === null ? null : ONE.minus(cashShare);

  // 9–10. The investment row (C28) and the cash row (C29), whole tens of dollars.
  let investmentRow: Dec | null = null;
  let cashRow: Dec | null = null;
  if (input.autoInvestSplit === false) {
    investmentRow = ZERO;
    cashRow = leftover === null ? null : roundDownToward(leftover.div(10), 0).times(10);
  } else if (input.autoInvestSplit === true && leftover !== null) {
    if (investShare !== null) {
      investmentRow = roundDownToward(leftover.div(10).times(investShare), 0).times(10);
    }
    if (cashShare !== null)
      cashRow = roundDownToward(leftover.div(10).times(cashShare), 0).times(10);
  }

  // 11. After-tax side income since the last ETF or stock buy, at the invest share.
  const tax =
    input.marginalTaxRate === null ? null : dec(input.marginalTaxRate, 'marginal tax rate');
  const lastPurchase = input.lastPurchaseDate;
  const sinceLastBuy =
    lastPurchase === null
      ? null
      : mean(
          input.sideIncomePeriods
            .filter((p) => dayNumber(p.periodEnd) > dayNumber(lastPurchase))
            .map(periodTotal),
        );
  const sideIncomeInvest =
    sinceLastBuy === null || tax === null || investShare === null
      ? ZERO
      : investShare.times(ONE.minus(tax)).times(sinceLastBuy);

  // 12. D40: the monthly amount to invest.
  const useBudget = input.useBudgetForInvest;
  let monthlyInvest: Dec | null = null;
  if (
    monthlyIncome !== null &&
    investShare !== null &&
    input.autoInvestSplit !== null &&
    useBudget !== null
  ) {
    const base = useBudget ? investmentRow : monthlyIncome.times(investShare);
    if (base !== null) monthlyInvest = base.plus(sideIncomeInvest);
  }

  need(input.netPayCents === null, 'pay.netPayCents');
  need(input.payFrequency === null, 'pay.frequency');
  need(items.length === 0, 'budget.items');
  need(input.useBudgetForInvest === null, 'budget.useForInvestAmount');
  need(input.autoInvestSplit === null, 'budget.autoInvestSplit');
  need(input.cashTargetRatio === null, 'allocation.cash');
  need(input.aggressiveness === null, 'investing.allocationAggressiveness');
  need(emergencyFund === null, 'budget.emergencyFundMonths');
  need(input.lastSnapshotCashShare === null, 'snapshots');
  need(input.marginalTaxRate === null, 'tax.marginalRate');
  need(input.lastPurchaseDate === null, 'investments.lastPurchaseDate');

  return {
    monthlyIncomeCents: monthlyIncome === null ? null : centsOf(monthlyIncome),
    yearlyFundCents: centsOf(yearlyFund),
    plannedSpendCents: centsOf(plannedSpend),
    leftoverCents: leftover === null ? null : centsOf(leftover),
    emergencyFundCents: emergencyFund === null ? null : centsOf(emergencyFund),
    cashShareRatio: cashShare === null ? null : ratioString(cashShare),
    investShareRatio: investShare === null ? null : ratioString(investShare),
    investmentRowCents: investmentRow === null ? null : centsOf(investmentRow),
    cashRowCents: cashRow === null ? null : centsOf(cashRow),
    sideIncomeInvestCents: centsOf(sideIncomeInvest),
    monthlyInvestCents: monthlyInvest === null ? null : centsOf(monthlyInvest),
    missing,
  };
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
 * The countdown to the next buy (SheetOptions H14–H18, ETFs I18): the last ETF or stock buy's
 * month at pay day + 2, plus 30 days per parcel month, rolled forward to a Thursday (+365 days
 * when growth is 0, the template quirk). Calendar days; the half-day offset is dropped (§11 fix 16).
 * Nothing to invest is `cash_first`, or `split_off` when the budget drives the amount and its
 * automatic investment split is off (D46).
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
}): Countdown {
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
  const periodDays = 30 * i.plan.months;
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
