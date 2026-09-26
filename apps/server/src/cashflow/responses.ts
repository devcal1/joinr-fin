// Mutation responses (stage-3.md §4.5 step 5): after the commit, the changed row's DTO is rebuilt
// from a fresh request context, so every figure in it comes from the engine. A row that vanished in
// between (only a concurrent CLI import can do that) answers 404.
import type {
  BudgetItemMutationResponse,
  CashAccountMutationResponse,
  CashBalancesResponse,
  DepositMutationResponse,
  DividendMutationResponse,
  EditableSettingKey,
  IncomeStreamMutationResponse,
  SavingsGoalMutationResponse,
  SettingsPatchResponse,
  YearlyExpenseMutationResponse,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { hasAppData } from '../db/queries/domain';
import { HttpError } from '../errors';
import { budgetRowDtos, yearlyExpenseDto } from './budget';
import { buildGoals, cashAccountDtos } from './cash';
import { BUDGET_PAGE_SETTING_KEYS, CASH_PAGE_SETTING_KEYS } from './constants';
import { createFinanceContext, type FinanceDeps } from './context';
import { dividendRowDtos } from './dividends';
import { settingsSliceDto } from './settings';
import { depositDtos, incomeStreamDtos } from './sideIncome';

function gone(what: string, id: number): HttpError {
  return new HttpError(404, `${what} ${id} not found`, 'NOT_FOUND');
}

export function accountResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): CashAccountMutationResponse {
  const ctx = createFinanceContext(deps, log);
  const account = cashAccountDtos(ctx.data).find((a) => a.id === id);
  if (!account) throw gone('Account', id);
  return { account };
}

/** The accounts a balances body named, in the page order. */
export function balancesResponse(
  deps: FinanceDeps,
  ids: readonly number[],
  log?: FastifyBaseLogger,
): CashBalancesResponse {
  const ctx = createFinanceContext(deps, log);
  const want = new Set(ids);
  return { accounts: cashAccountDtos(ctx.data).filter((a) => want.has(a.id)) };
}

export function goalResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): SavingsGoalMutationResponse {
  const goal = buildGoals(createFinanceContext(deps, log)).items.find((g) => g.id === id);
  if (!goal) throw gone('Goal', id);
  return { goal };
}

export function depositResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): DepositMutationResponse {
  const ctx = createFinanceContext(deps, log);
  const deposit = depositDtos(ctx.data, ctx.sideIncome()).find((d) => d.id === id);
  if (!deposit) throw gone('Deposit', id);
  return { deposit };
}

export function streamResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): IncomeStreamMutationResponse {
  const ctx = createFinanceContext(deps, log);
  const stream = incomeStreamDtos(ctx.data, ctx.sideIncome()).find((s) => s.id === id);
  if (!stream) throw gone('Stream', id);
  return { stream };
}

export function budgetRowResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): BudgetItemMutationResponse {
  const row = budgetRowDtos(createFinanceContext(deps, log)).find((r) => r.id === id);
  if (!row) throw gone('Budget row', id);
  return { row };
}

export function yearlyExpenseResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): YearlyExpenseMutationResponse {
  const ctx = createFinanceContext(deps, log);
  const stored = ctx.data.yearlyExpenses.find((y) => y.id === id);
  if (!stored) throw gone('Yearly expense', id);
  const monthly = ctx.budget().yearlyExpenses.find((y) => y.id === id)?.monthlyCents ?? 0;
  return { expense: yearlyExpenseDto(stored, monthly) };
}

export function dividendResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): DividendMutationResponse {
  const dividend = dividendRowDtos(createFinanceContext(deps, log)).find((d) => d.id === id);
  if (!dividend) throw gone('Dividend', id);
  return { dividend };
}

/**
 * The settings slice of the page(s) whose keys the patch named (the Budget page's nine, the Cash
 * page's six, or both), and `hasAppData` after the write.
 */
export function settingsResponse(
  deps: FinanceDeps,
  keys: readonly EditableSettingKey[],
  log?: FastifyBaseLogger,
): SettingsPatchResponse {
  const ctx = createFinanceContext(deps, log);
  const named = new Set<string>(keys);
  const slice = [
    ...(BUDGET_PAGE_SETTING_KEYS.some((k) => named.has(k)) ? BUDGET_PAGE_SETTING_KEYS : []),
    ...(CASH_PAGE_SETTING_KEYS.some((k) => named.has(k)) ? CASH_PAGE_SETTING_KEYS : []),
  ];
  return {
    settings: settingsSliceDto(ctx.data.settings, ctx.data.settingOrigins, slice),
    hasAppData: hasAppData(deps.database.db),
  };
}
