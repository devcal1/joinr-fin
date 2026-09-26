// Stage 3 server constants (stage-3.md §4.5, D59). Each owner-confirmed choice is one constant, so
// a change of mind is a one-line edit; the engine contract, the DTOs and the web copy follow them.
import { EDITABLE_SETTING_KEYS, type BudgetAutoKind, type EditableSettingKey } from '@joinr/schema';

/**
 * D59 (owner-confirmed; §11 fix 20): loans you've made do not count toward the emergency-fund
 * test. `cashTotals` gets it as `loansCountForEmergencyFund`; `CashTotalsDto.emergencyFund
 * .loansIncluded` and `CashAccountDto.countsForEmergencyFund` report it.
 */
export const LOANS_COUNT_FOR_EMERGENCY_FUND = false;

/**
 * D59 (owner-confirmed): the savings goals' cash base. `'available'` passes available cash (total
 * cash minus loans you've made) as `goalsCashCents`; `'total'` would pass Total Cash. The Cash page
 * DTO reports it as `goals.cashBasis`.
 */
export const GOALS_CASH_BASIS: 'total' | 'available' = 'available';

/** The settings the Budget page edits (EDITABLE_SETTING_KEYS' first nine, §3.3). */
export const BUDGET_PAGE_SETTING_KEYS = [
  'pay.frequency',
  'pay.netPayCents',
  'pay.dayOfMonth',
  'pay.jobStartDate',
  'budget.includeSideIncome',
  'budget.emergencyFundMonths',
  'budget.emergencyFundOverrideCents',
  'budget.autoInvestSplit',
  'budget.useForInvestAmount',
] as const satisfies readonly EditableSettingKey[];

/** The settings the Cash page edits (the rest of EDITABLE_SETTING_KEYS, §3.3). */
export const CASH_PAGE_SETTING_KEYS: readonly EditableSettingKey[] = EDITABLE_SETTING_KEYS.filter(
  (k) => !(BUDGET_PAGE_SETTING_KEYS as readonly string[]).includes(k),
);

/** The name an automatic budget row gets when the app creates it (the template's labels). */
export const BUDGET_AUTO_ROW_NAMES: Readonly<Record<BudgetAutoKind, string>> = {
  auto_yearly: 'Yearly Expenses - Automatic',
  auto_invest: 'Investment Savings - Automatic',
  auto_cash: 'Cash Savings - Automatic',
};
