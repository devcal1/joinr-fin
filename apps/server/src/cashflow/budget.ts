// `GET /api/budget` (stage-3.md §4.2, §4.4, §6.5): the live Budget (D53, D54, D61): income, items,
// the yearly fund, the emergency fund, the automatic or manual split, payday transfers and the
// breakdowns, plus the actual spend from the Cash KPIs. Every figure comes from the engine.
import type { BudgetRowResult, BudgetTransferResult } from '@joinr/engine';
import {
  parseReviewFlags,
  type BudgetPageResponse,
  type BudgetRowDto,
  type BudgetSummaryDto,
  type BudgetTransferDto,
  type ReviewFlag,
  type YearlyExpenseDto,
} from '@joinr/schema';
import {
  aggressivenessSetting,
  numberSetting,
  payFrequencySetting,
  stringSetting,
} from '../db/queries/settings';
import type {
  BudgetItemRow,
  CashAccountRow,
  InvestmentData,
  YearlyExpenseRow,
} from '../investments/load';
import { sortAccounts } from './cash';
import { BUDGET_PAGE_SETTING_KEYS } from './constants';
import type { FinanceContext } from './context';
import { includeSideIncomeOf } from './inputs';
import { settingsSliceDto } from './settings';

function safeFlags(stored: string | null): ReviewFlag[] {
  try {
    return parseReviewFlags(stored);
  } catch {
    return []; // a malformed column should not break the page
  }
}

/** An engine budget row with its stored row's display fields (a missing auto row has none). */
export function budgetRowDto(
  r: BudgetRowResult,
  stored: BudgetItemRow | undefined,
  accounts: ReadonlyMap<number, CashAccountRow>,
): BudgetRowDto {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    storedMonthlyCents: stored?.monthlyCents ?? null,
    monthlyCents: r.monthlyCents,
    incomeShareRatio: r.incomeShareRatio,
    weeklyCents: r.weeklyCents,
    yearlyCents: r.yearlyCents,
    category: r.category,
    accountId: r.accountId,
    accountName: r.accountName,
    accountLinked: r.accountId !== null && accounts.has(r.accountId),
    savingsLine: r.savingsLine,
    derived: r.derived,
    manual: r.manual,
    flags: stored ? safeFlags(stored.reviewFlags) : [],
    sortOrder: stored?.sortOrder ?? null,
    origin: stored?.origin ?? null,
    sheetRef: stored?.sheetRef ?? null,
  };
}

export function yearlyExpenseDto(y: YearlyExpenseRow, monthlyCents: number): YearlyExpenseDto {
  return {
    id: y.id,
    name: y.name,
    annualCents: y.annualCents,
    monthlyCents,
    sortOrder: y.sortOrder,
    origin: y.origin,
    sheetRef: y.sheetRef,
  };
}

export function transferDto(
  t: BudgetTransferResult,
  accounts: ReadonlyMap<number, CashAccountRow>,
): BudgetTransferDto {
  return {
    accountId: t.accountId,
    accountName: t.accountName,
    linked: t.accountId !== null && accounts.has(t.accountId),
    perPayCents: t.perPayCents,
    monthlyCents: t.monthlyCents,
    rows: t.rows,
  };
}

/** Every budget row DTO in the engine's (display) order. */
export function budgetRowDtos(ctx: FinanceContext): BudgetRowDto[] {
  const stored = new Map(ctx.data.budgetItems.map((r) => [r.id, r]));
  const accounts = new Map(ctx.data.cashAccounts.map((a) => [a.id, a]));
  return ctx
    .budget()
    .rows.map((r) => budgetRowDto(r, r.id === null ? undefined : stored.get(r.id), accounts));
}

/** Every account for the row form's Select (the Cash page order). */
export function budgetAccounts(data: InvestmentData): BudgetPageResponse['accounts'] {
  return sortAccounts(data.cashAccounts).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
}

export function budgetSummaryDto(ctx: FinanceContext): BudgetSummaryDto {
  const s = ctx.data.settings;
  const result = ctx.budget();
  const invest = result.invest;
  const input = ctx.budgetInput();
  return {
    payFrequency: payFrequencySetting(s),
    netPayCents: numberSetting(s, 'pay.netPayCents'),
    monthlyIncomeCents: invest.monthlyIncomeCents,
    annualIncomeCents: result.annualIncomeCents,
    sideIncomeIncluded: includeSideIncomeOf(s),
    sideIncomeAvgCents: ctx.sideIncome().avg365Cents,
    yearlyFundCents: invest.yearlyFundCents,
    plannedSpendCents: invest.plannedSpendCents,
    leftoverCents: invest.leftoverCents,
    yearlySavingsCents: result.yearlySavingsCents,
    emergencyFundCents: invest.emergencyFundCents,
    emergencyFundBasisCents: result.emergencyFundBasisCents,
    // The emergency-fund test (§2.4): the budget's cash is below the fund.
    belowEmergencyFund:
      invest.emergencyFundCents !== null && input.cashCents < invest.emergencyFundCents,
    cashShareRatio: invest.cashShareRatio,
    investShareRatio: invest.investShareRatio,
    investmentRowCents: invest.investmentRowCents,
    cashRowCents: invest.cashRowCents,
    investManual: result.investManual,
    unallocatedCents: result.unallocatedCents,
    plannedSavingsRatio: result.plannedSavingsRatio,
    cashTargetRatio: stringSetting(s, 'allocation.cash'),
    aggressiveness: aggressivenessSetting(s),
    monthlyInvestCents: invest.monthlyInvestCents,
    sideIncomeInvestCents: invest.sideIncomeInvestCents,
  };
}

export function buildBudgetPage(ctx: FinanceContext): BudgetPageResponse {
  const { data } = ctx;
  const result = ctx.budget();
  const kpis = ctx.kpis();
  const accounts = new Map(data.cashAccounts.map((a) => [a.id, a]));
  const yearlyMonthly = new Map(result.yearlyExpenses.map((y) => [y.id, y.monthlyCents]));
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    summary: budgetSummaryDto(ctx),
    rows: budgetRowDtos(ctx),
    yearlyExpenses: data.yearlyExpenses.map((y) =>
      yearlyExpenseDto(y, yearlyMonthly.get(y.id) ?? 0),
    ),
    transfers: result.transfers.map((t) => transferDto(t, accounts)),
    unassigned: {
      perPayCents: result.unassigned.perPayCents,
      monthlyCents: result.unassigned.monthlyCents,
      rows: result.unassigned.rows,
    },
    perPayTotalCents: result.perPayTotalCents,
    byCategory: result.byCategory.map((c) => ({
      category: c.category,
      monthlyCents: c.monthlyCents,
    })),
    actual: {
      plannedCents: result.invest.plannedSpendCents,
      actualCents: kpis.spend6mCents,
      actualRawCents: kpis.spend6mRawCents,
      periods: kpis.spend6mPeriods,
    },
    accounts: budgetAccounts(data),
    settings: settingsSliceDto(data.settings, data.settingOrigins, BUDGET_PAGE_SETTING_KEYS),
    missing: [...result.invest.missing],
  };
}
