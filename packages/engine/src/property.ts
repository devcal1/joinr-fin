// Property and loans (stage-4.md §2.6; D66–D68; spec 04 §3.3): the valuation history, gain (net rent
// included) and CAGR, the D66 balance log (the loan's start fields give its first point; repayments
// default to the regular payment × the payments due on the loan's grid; interest and fees =
// repayments − principal), the amortisation schedule with and without the linked offsets, equity
// and LVR net of offsets, the totals of the loans that have a property, the History X–AE of the
// live row, the savings engine's live parts and the chart.
import {
  isoMonthOf,
  LOAN_ENTRY_FLAGS,
  LOAN_FLAGS,
  paymentDatesBetween,
  type IsoDate,
  type LoanEntryFlag,
  type LoanFlag,
} from '@joinr/schema';
import { amortise, paymentsPerYear } from './amortise';
import {
  annualise,
  byAsOf,
  groupChart,
  latestAtAsOf,
  negateCents,
  orderedFlags,
} from './assetsCommon';
import { checkCents, dayNumber, daysBetween, decN, ratioString, sumCents } from './num';
import { monthsBetween, provisionalMonth, sortByRunDate } from './periods';
import type {
  AmortisationResult,
  Cents,
  EngineLoan,
  EngineProperty,
  LoanEntryResult,
  LoanResult,
  PropertiesResult,
  PropertyChartPoint,
  PropertyInput,
  PropertyResultRow,
} from './types';

/** A ratio of two cents figures; null when the denominator is 0. */
function centsRatio(numerator: Cents, denominator: Cents): string | null {
  return denominator === 0 ? null : ratioString(decN(numerator).div(denominator));
}

/** One point of a loan's balance log before its derived figures. */
interface LogPoint {
  id: number | null;
  start: boolean;
  asOf: IsoDate;
  balanceCents: Cents;
  typedRepaymentsCents: Cents | null;
}

/** §2.6 steps 2–6: one loan's balance, log, totals and schedules. */
function loanResult(loan: EngineLoan, asOf: IsoDate): LoanResult {
  paymentsPerYear(loan.paymentFrequency);
  const stored = byAsOf(loan.entries);
  const first = stored[0];
  if (first === undefined) throw new RangeError(`engine: loan ${loan.id} has no balance entry`);
  const latest = latestAtAsOf(stored, asOf)!;
  const startBalanceCents =
    loan.startBalanceCents === null
      ? checkCents(first.balanceCents, `loan ${loan.id} balance`)
      : checkCents(loan.startBalanceCents, `loan ${loan.id} startBalance`);
  if (loan.startDate !== null) dayNumber(loan.startDate);
  const anchor = loan.startDate ?? first.asOf;

  // Step 3: the log, its start point from the loan's start fields (never stored).
  const points: LogPoint[] = [];
  if (loan.startDate !== null && loan.startBalanceCents !== null && loan.startDate < first.asOf) {
    points.push({
      id: null,
      start: true,
      asOf: loan.startDate,
      balanceCents: loan.startBalanceCents,
      typedRepaymentsCents: null,
    });
  }
  for (const e of stored) {
    points.push({
      id: e.id,
      start: false,
      asOf: e.asOf,
      balanceCents: checkCents(e.balanceCents, `loan entry ${e.id}`),
      typedRepaymentsCents:
        e.repaymentsCents === null
          ? null
          : checkCents(e.repaymentsCents, `loan entry ${e.id} repayments`),
    });
  }
  const payment =
    loan.paymentCents === null ? null : checkCents(loan.paymentCents, `loan ${loan.id} payment`);
  let cumulativeInterest = 0;
  const entries: LoanEntryResult[] = points.map((pt, k) => {
    const row = {
      id: pt.id,
      start: pt.start,
      asOf: pt.asOf,
      balanceCents: pt.balanceCents,
      cumulativePrincipalCents: startBalanceCents - pt.balanceCents,
    };
    if (k === 0) {
      return {
        ...row,
        paymentsCounted: null,
        repaymentsCents: null,
        repaymentsTyped: false,
        principalCents: null,
        interestFeesCents: null,
        cumulativeInterestFeesCents: 0,
        flags: [],
      };
    }
    const prev = points[k - 1]!;
    const counted = paymentDatesBetween(anchor, loan.paymentFrequency, prev.asOf, pt.asOf).length;
    const estimate = payment === null ? null : counted * payment;
    const repayments = pt.typedRepaymentsCents ?? estimate;
    const principal = prev.balanceCents - pt.balanceCents;
    const interest = repayments === null ? null : repayments - principal;
    if (interest !== null) cumulativeInterest += interest;
    const flags = new Set<LoanEntryFlag>();
    if (interest !== null && interest < 0) flags.add('repayments_below_principal');
    if (principal < 0) flags.add('balance_increased');
    return {
      ...row,
      paymentsCounted: counted,
      repaymentsCents: repayments,
      repaymentsTyped: pt.typedRepaymentsCents !== null,
      principalCents: principal,
      interestFeesCents: interest,
      cumulativeInterestFeesCents: cumulativeInterest,
      flags: orderedFlags(LOAN_ENTRY_FLAGS, flags),
    };
  });

  // Step 2: the balance at asOf, offsets (D67).
  const balanceCents = latest.balanceCents;
  const offsetCents = sumCents(
    loan.offsets.map((o) => checkCents(o.balanceCents, `offset ${o.accountId}`)),
  );
  // Step 4: totals over the log up to the balance in force at asOf.
  const counted = entries.filter((e) => e.asOf <= latest.asOf);

  // Step 5: the schedules on the loan's grid, from the latest balance.
  const flags = new Set<LoanFlag>();
  if (loan.propertyId === null) flags.add('no_property');
  if (loan.annualRate === null) flags.add('no_rate');
  const compounding = loan.compoundingPerYear;
  if (compounding === null || !(compounding >= 1)) flags.add('no_compounding');
  if (payment === null) flags.add('no_payment');
  let schedule: AmortisationResult | null = null;
  let scheduleWithoutOffset: AmortisationResult | null = null;
  if (loan.annualRate !== null && compounding !== null && compounding >= 1 && payment !== null) {
    const base = {
      balanceCents,
      annualRate: loan.annualRate,
      compoundingPerYear: compounding,
      paymentCents: payment,
      paymentFrequency: loan.paymentFrequency,
      anchorDate: anchor,
      balanceDate: latest.asOf,
    };
    schedule = amortise({ ...base, offsetCents });
    if (schedule.flag !== null) flags.add(schedule.flag);
    if (offsetCents > 0) scheduleWithoutOffset = amortise({ ...base, offsetCents: 0 });
  }
  const interestSavedCents =
    schedule?.totalInterestCents != null && scheduleWithoutOffset?.totalInterestCents != null
      ? scheduleWithoutOffset.totalInterestCents - schedule.totalInterestCents
      : null;
  const monthsSaved =
    schedule?.payoffDate != null && scheduleWithoutOffset?.payoffDate != null
      ? monthsBetween(schedule.payoffDate, scheduleWithoutOffset.payoffDate)
      : null;

  return {
    id: loan.id,
    propertyId: loan.propertyId,
    balanceCents,
    balanceAsOf: latest.asOf,
    startBalanceCents,
    paymentAnchorDate: anchor,
    offsetCents,
    netBalanceCents: Math.max(0, balanceCents - offsetCents),
    excessOffsetCents: Math.max(0, offsetCents - balanceCents),
    entries,
    repaymentsCents: sumCents(counted.map((e) => e.repaymentsCents ?? 0)),
    principalPaidCents: startBalanceCents - balanceCents,
    interestFeesCents: sumCents(counted.map((e) => e.interestFeesCents ?? 0)),
    nextPeriodInterestCents: schedule?.firstPeriodInterestCents ?? null,
    schedule,
    scheduleWithoutOffset,
    interestSavedCents,
    monthsSaved,
    flags: orderedFlags(LOAN_FLAGS, flags),
  };
}

/** §2.6 steps 1 and 7: one property's value, gain, CAGR and its loans' debt, equity and LVR. */
function propertyRow(
  p: EngineProperty,
  loans: readonly LoanResult[],
  asOf: IsoDate,
): PropertyResultRow {
  const valuations = byAsOf(p.valuations);
  const valuation = latestAtAsOf(valuations, asOf);
  if (valuation === null) throw new RangeError(`engine: property ${p.id} has no valuation`);
  const valueCents = checkCents(valuation.valueCents, `valuation ${valuation.id}`);
  const purchase = checkCents(p.purchaseValueCents, `property ${p.id} purchase`);
  const netRent = checkCents(p.netRentToDateCents, `property ${p.id} net rent`);
  const gainCents = valueCents + netRent - purchase;
  const heldDays = p.purchaseDate === null ? null : daysBetween(p.purchaseDate, asOf);
  const cagr =
    heldDays !== null && purchase > 0
      ? annualise(decN(valueCents + netRent).div(purchase), heldDays)
      : null;
  const own = loans.filter((l) => l.propertyId === p.id);
  const debtCents = sumCents(own.map((l) => l.netBalanceCents));
  return {
    id: p.id,
    isPrimaryResidence: p.isPrimaryResidence,
    valueCents,
    valuationDate: valuation.asOf,
    purchaseValueCents: purchase,
    netRentCents: netRent,
    gainCents,
    gainRatio: centsRatio(gainCents, purchase),
    cagrRatio: cagr === null ? null : ratioString(cagr),
    heldDays,
    loanIds: own.map((l) => l.id),
    debtCents,
    equityCents:
      valueCents -
      sumCents(own.map((l) => l.balanceCents)) +
      sumCents(own.map((l) => l.offsetCents)),
    lvrRatio: centsRatio(debtCents, valueCents),
  };
}

export function computeProperty(input: PropertyInput): PropertiesResult {
  const asOf = input.asOf;
  dayNumber(asOf);
  const loans = input.loans.map((l) => loanResult(l, asOf));
  const properties = input.properties.map((p) => propertyRow(p, loans, asOf));

  // Step 8: totals over the properties and the loans that have one (D2: other loans count nowhere).
  const propertyLoans = loans.filter((l) => l.propertyId !== null);
  const sum = (f: (l: LoanResult) => Cents) => sumCents(propertyLoans.map(f));
  const purchaseCents = sumCents(properties.map((p) => p.purchaseValueCents));
  const valueCents = sumCents(properties.map((p) => p.valueCents));
  const gainCents = sumCents(properties.map((p) => p.gainCents));
  const mortgageCents = sum((l) => l.balanceCents);
  const offsetCents = sum((l) => l.offsetCents);
  const netMortgageCents = sum((l) => l.netBalanceCents);
  const totals: PropertiesResult['totals'] = {
    purchaseCents,
    valueCents,
    gainCents,
    gainRatio: centsRatio(gainCents, purchaseCents),
    mortgageCents,
    offsetCents,
    netMortgageCents,
    principalPaidCents: sum((l) => l.principalPaidCents),
    interestFeesCents: sum((l) => l.interestFeesCents),
    repaymentsCents: sum((l) => l.repaymentsCents),
    startBalanceCents: sum((l) => l.startBalanceCents),
    lvrRatio: centsRatio(netMortgageCents, valueCents),
    equityCents: valueCents - mortgageCents + offsetCents,
  };

  // Step 11: the chart: the stored History per snapshot (gross LVR) and the live totals (net LVR).
  const snapshots = sortByRunDate(input.snapshots);
  const points: PropertyChartPoint[] = snapshots.map((s) => {
    const x = s.propertyValueCents;
    const ab = s.mortgageBalanceCents;
    const mortgage = ab === null ? null : Math.abs(ab);
    return {
      label: '',
      period: s.periodMonth,
      date: s.runDate,
      live: false,
      valueCents: x,
      purchaseCents: s.propertyPurchaseCents,
      mortgageCents: mortgage,
      equityCents: x === null || ab === null ? null : x + ab,
      lvrRatio: x === null || mortgage === null ? null : centsRatio(mortgage, x),
      interestFeesCents: s.mortgageInterestFeesCents,
      principalPaidCents: s.mortgagePrincipalPaidCents,
    };
  });
  points.push({
    label: '',
    period: snapshots.length === 0 ? isoMonthOf(asOf) : provisionalMonth(snapshots, asOf),
    date: asOf,
    live: true,
    valueCents,
    purchaseCents,
    mortgageCents,
    equityCents: totals.equityCents,
    lvrRatio: totals.lvrRatio,
    interestFeesCents: totals.interestFeesCents,
    principalPaidCents: totals.principalPaidCents,
  });
  const chart = groupChart(points, input.chart.unit, input.chart.count).map((g) => ({
    ...g.last,
    label: g.label,
  }));

  const hasProperty = properties.length > 0;
  const hasLoan = propertyLoans.length > 0;
  return {
    properties,
    loans,
    totals,
    chart,
    // Step 9: History X–AE of the live row (AE: the sheet's IFERROR 0).
    snapshot: {
      propertyValueCents: valueCents,
      propertyPurchaseCents: purchaseCents,
      propertyEquityCents: totals.equityCents,
      propertyGainCents: gainCents,
      mortgageBalanceCents: negateCents(mortgageCents),
      mortgageInterestFeesCents: totals.interestFeesCents,
      mortgagePrincipalPaidCents: totals.principalPaidCents,
      propertyGainRatio: centsRatio(gainCents, valueCents - gainCents) ?? '0',
      mortgageOffsetCents: offsetCents,
    },
    // Step 10: the savings engine's live parts.
    savingsLive: {
      propertyPurchaseCents: hasProperty ? purchaseCents : null,
      mortgageBalanceCents: hasLoan ? negateCents(mortgageCents) : null,
      mortgagePrincipalPaidCents: hasLoan ? totals.principalPaidCents : null,
    },
  };
}
