// The Budget (stage-2.md §2.12 steps 1–12; stage-3.md §2.9; D40, D53, D54, D61). One chain,
// `budgetChain`, feeds both `budgetInvestment` (the timing chain's D40 amount, its Stage 2
// signature) and `computeBudget` (the live Budget page), so the page and the investment pages agree.
import {
  BUDGET_AUTO_KINDS,
  type AllocationAggressiveness,
  type BudgetAutoKind,
  type BudgetItemKind,
} from '@joinr/schema';
import { PAY_FACTORS, WEEKS_PER_MONTH } from './cash';
import {
  centsOf,
  checkCents,
  dayNumber,
  dec,
  decN,
  dollarsOf,
  maxDec,
  mean,
  minDec,
  ONE,
  ratioString,
  roundDownToward,
  roundUpAway,
  sum,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import type {
  BudgetInput,
  BudgetInvestInput,
  BudgetInvestResult,
  BudgetResult,
  BudgetRowResult,
  BudgetTransferResult,
  Cents,
  TimingInput,
} from './types';

/** The allocation step k: light 1, normal 2, aggressive 3 (null → aggressive, the else branch). */
const AGGRESSIVENESS_K: Readonly<Record<AllocationAggressiveness, number>> = {
  light: 1,
  normal: 2,
  aggressive: 3,
};

const DAYS_PER_YEAR = 365;

/** The chain's figures before rounding, with the rounded result. */
interface BudgetChain {
  result: BudgetInvestResult;
  monthlyIncome: Dec | null;
  leftover: Dec | null;
  investmentRow: Dec | null;
  cashRow: Dec | null;
}

/**
 * The Budget investment row and the D40 monthly amount to invest (Budget B2, C24, J4, L7, D3, C28,
 * C29; SheetOptions H41–H43, H2), in the twelve steps of stage-2.md §2.12. Stage 3 changes step 9
 * only (D54): with the automatic split off, the investment row is the `auto_invest` row's typed
 * amount (null → 0). Step 5 keeps the sheet's emergency-fund basis, savings lines included (D61).
 */
function budgetChain(input: BudgetInvestInput): BudgetChain {
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
  // The basis is every item row (savings lines included) plus the yearly fund (D61).
  const emergencyFund =
    input.emergencyFundOverrideCents !== null
      ? dollarsOf(input.emergencyFundOverrideCents, 'emergency fund override')
      : input.emergencyFundMonths === null
        ? null
        : roundUpAway(decN(input.emergencyFundMonths).times(plannedSpend).div(1000), 0).times(1000);

  // 6–8. The cash share (H42) and the invest share (H41).
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

  // 9–10. The investment row (C28) and the cash row (C29), whole tens of dollars. D54: with the
  // automatic split off the investment row is the typed amount and the cash row takes the rest
  // (negative when the typed amount exceeds the leftover).
  let investmentRow: Dec | null = null;
  let cashRow: Dec | null = null;
  if (input.autoInvestSplit === false) {
    const typed = input.items.find((i) => i.kind === 'auto_invest')?.monthlyCents ?? null;
    investmentRow = typed === null ? ZERO : dollarsOf(typed, 'manual investment amount');
    cashRow =
      leftover === null
        ? null
        : roundDownToward(leftover.minus(investmentRow).div(10), 0).times(10);
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
    result: {
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
    },
    monthlyIncome,
    leftover,
    investmentRow,
    cashRow,
  };
}

/** The Budget investment row and the D40 amount (stage-2.md §2.12; D54 step 9, stage-3.md §2.9). */
export function budgetInvestment(input: BudgetInvestInput): BudgetInvestResult {
  return budgetChain(input).result;
}

/** §2.9: the timing chain's exact `budgetInvestment` input for a Budget page input. */
export function budgetInvestInputOf(input: BudgetInput): BudgetInvestInput {
  return {
    asOf: input.asOf,
    payFrequency: input.payFrequency,
    netPayCents: input.netPayCents,
    includeSideIncome: input.includeSideIncome,
    sideIncomePeriods: input.sideIncomePeriods,
    items: input.rows.map((r) => ({ kind: r.kind, monthlyCents: r.monthlyCents })),
    yearlyExpenseAnnualCents: input.yearlyExpenses.map((y) => y.annualCents),
    autoInvestSplit: input.autoInvestSplit,
    useBudgetForInvest: input.useBudgetForInvest,
    cashTargetRatio: input.cashTargetRatio,
    aggressiveness: input.aggressiveness,
    lastSnapshotCashShare: input.lastSnapshotCashShare,
    currentCashShare: input.currentCashShare,
    cashCents: input.cashCents,
    emergencyFundMonths: input.emergencyFundMonths,
    emergencyFundOverrideCents: input.emergencyFundOverrideCents,
    marginalTaxRate: input.marginalTaxRate,
    lastPurchaseDate: input.lastPurchaseDate,
  };
}

/** The category's display key: trimmed, and '' is none. */
function categoryOf(category: string | null): string | null {
  const c = category?.trim() ?? '';
  return c === '' ? null : c;
}

/** The account a row is paid into: its linked id, else its (stale) name, else none. */
function accountKey(r: { accountId: number | null; accountName: string | null }): string | null {
  if (r.accountId !== null) return `id:${r.accountId}`;
  const name = r.accountName?.trim() ?? '';
  return name === '' ? null : `name:${name}`;
}

/**
 * §2.9: the live Budget page. Rows in input order (a missing automatic row is appended with no id
 * or name); the auto rows carry the chain's values; payday transfers group the rows by account in
 * first-appearance order (rows with no account are unassigned, §11 fix 17).
 */
export function computeBudget(input: BudgetInput): BudgetResult {
  const chain = budgetChain(budgetInvestInputOf(input));
  const invest = chain.result;
  const investManual = input.autoInvestSplit === false;
  const income = chain.monthlyIncome;

  const autoMonthly: Readonly<Record<BudgetAutoKind, Cents>> = {
    auto_yearly: invest.yearlyFundCents,
    auto_invest: invest.investmentRowCents ?? 0,
    auto_cash: invest.cashRowCents ?? 0,
  };
  const rowOf = (r: {
    id: number | null;
    kind: BudgetItemKind;
    name: string | null;
    monthlyCents: Cents | null;
    category: string | null;
    accountId: number | null;
    accountName: string | null;
  }): BudgetRowResult => {
    const monthlyCents =
      r.kind === 'item'
        ? checkCents(r.monthlyCents ?? 0, `budget row ${r.id}`)
        : autoMonthly[r.kind];
    const monthly = dollarsOf(monthlyCents);
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      monthlyCents,
      incomeShareRatio:
        income === null || income.isZero() ? null : ratioString(monthly.div(income)),
      weeklyCents: centsOf(monthly.div(WEEKS_PER_MONTH)),
      yearlyCents: monthlyCents * 12,
      category: r.category,
      accountId: r.accountId,
      accountName: r.accountName,
      savingsLine: r.kind === 'item' && categoryOf(r.category)?.toLowerCase() === 'savings',
      derived: r.kind !== 'item',
      manual: r.kind === 'auto_invest' && investManual,
    };
  };
  const rows = input.rows.map(rowOf);
  for (const kind of BUDGET_AUTO_KINDS) {
    if (input.rows.some((r) => r.kind === kind)) continue;
    rows.push(
      rowOf({
        id: null,
        kind,
        name: null,
        monthlyCents: null,
        category: null,
        accountId: null,
        accountName: null,
      }),
    );
  }

  // Payday transfers (A35:B): per pay from each group's Σ monthly, rounded once.
  const perPay = (monthlyCents: Cents): Cents => {
    if (input.payFrequency === null) return 0;
    const m = dollarsOf(monthlyCents);
    const w = m.div(WEEKS_PER_MONTH);
    switch (input.payFrequency) {
      case 'monthly':
        return centsOf(m);
      case 'twice_monthly':
        return centsOf(m.times('0.5'));
      case 'weekly':
        return centsOf(w);
      case 'fortnightly':
        return centsOf(w.times(2));
      case 'four_weekly':
        return centsOf(w.times(4));
    }
  };
  const groups: {
    key: string;
    accountId: number | null;
    accountName: string | null;
    monthly: Cents;
    rows: number;
  }[] = [];
  const unassigned = { monthly: 0, rows: 0 };
  for (const r of rows) {
    const key = accountKey(r);
    if (key === null) {
      unassigned.monthly += r.monthlyCents;
      unassigned.rows += 1;
      continue;
    }
    let g = groups.find((x) => x.key === key);
    if (g === undefined) {
      g = { key, accountId: r.accountId, accountName: r.accountName, monthly: 0, rows: 0 };
      groups.push(g);
    }
    g.monthly += r.monthlyCents;
    g.rows += 1;
  }
  const transfers: BudgetTransferResult[] = groups.map((g) => ({
    accountId: g.accountId,
    accountName: g.accountName,
    perPayCents: perPay(g.monthly),
    monthlyCents: g.monthly,
    rows: g.rows,
  }));
  const unassignedResult = {
    perPayCents: perPay(unassigned.monthly),
    monthlyCents: unassigned.monthly,
    rows: unassigned.rows,
  };

  // byCategory: Σ monthly over rows with monthly > 0, amount descending, no category last.
  const categories = new Map<string | null, Cents>();
  for (const r of rows) {
    if (r.monthlyCents <= 0) continue;
    const c = categoryOf(r.category);
    categories.set(c, (categories.get(c) ?? 0) + r.monthlyCents);
  }
  const byCategory = [...categories.entries()]
    .map(([category, monthlyCents]) => ({ category, monthlyCents }))
    .sort((a, b) =>
      (a.category === null) !== (b.category === null)
        ? a.category === null
          ? 1
          : -1
        : b.monthlyCents - a.monthlyCents,
    );

  const investCents = invest.investmentRowCents;
  const cashCents = invest.cashRowCents;
  return {
    invest,
    annualIncomeCents: income === null ? null : centsOf(income.times(12)),
    yearlySavingsCents: chain.leftover === null ? null : centsOf(chain.leftover.times(12)),
    plannedSavingsRatio:
      income === null || income.isZero() || chain.investmentRow === null || chain.cashRow === null
        ? null
        : ratioString(chain.investmentRow.plus(chain.cashRow).div(income)),
    unallocatedCents:
      invest.leftoverCents === null
        ? null
        : invest.leftoverCents - (investCents ?? 0) - (cashCents ?? 0),
    emergencyFundBasisCents: invest.plannedSpendCents,
    rows,
    yearlyExpenses: input.yearlyExpenses.map((y) => ({
      id: y.id,
      name: y.name,
      annualCents: y.annualCents,
      monthlyCents: centsOf(dollarsOf(y.annualCents, `yearly expense ${y.id}`).div(12)),
    })),
    transfers,
    unassigned: unassignedResult,
    perPayTotalCents:
      input.payFrequency === null
        ? null
        : sumCents(transfers.map((t) => t.perPayCents)) + unassignedResult.perPayCents,
    byCategory,
    investManual,
  };
}
