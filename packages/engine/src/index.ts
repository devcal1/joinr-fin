// `@joinr/engine`: the pure investment and cash-flow engine (stage-2.md §2, stage-3.md §2). No
// I/O, no clock: every "today" is an `asOf` input. The public API is frozen (stage-2.md §2.2,
// stage-3.md §2.2); the implementation lives in internal modules: lots.ts (FIFO, the D36 seam),
// realised.ts (the FY table), xirr.ts (the solver), investments.ts (holdings, summary, allocation,
// dividends), history.ts, timing.ts, and for Stage 3 periods.ts (windows and years), cash.ts,
// savings.ts, kpis.ts, goals.ts, sideIncome.ts, budget.ts, dividends.ts, suggestions.ts and
// charts.ts.
import type { IsoDate } from '@joinr/schema';
import { budgetInvestInputOf, budgetInvestment, computeBudget } from './budget';
import { cashTotals, monthlyPayCents } from './cash';
import { compressCashflow } from './charts';
import { computeDividends } from './dividends';
import { savingsGoals } from './goals';
import { contributionsAt, compressSeries, netPurchases, purchaseWindows } from './history';
import { computeInvestments } from './investments';
import { cashKpis } from './kpis';
import { yearWindow } from './periods';
import { realisedByFinancialYear } from './realised';
import { computeSavings } from './savings';
import { computeSideIncome } from './sideIncome';
import { dividendSuggestions } from './suggestions';
import {
  assetClassOfKind,
  cashDeficitMonths,
  considerNext,
  investCountdown,
  nextBuyHint,
  parcelOptimiser,
  sheetDate,
} from './timing';
import type { EngineApi, MatchingStrategy } from './types';
import { xirrRate } from './xirr';

export type * from './types';

export {
  assetClassOfKind,
  budgetInvestInputOf,
  budgetInvestment,
  cashDeficitMonths,
  cashKpis,
  cashTotals,
  compressCashflow,
  compressSeries,
  computeBudget,
  computeDividends,
  computeInvestments,
  computeSavings,
  computeSideIncome,
  considerNext,
  contributionsAt,
  dividendSuggestions,
  investCountdown,
  monthlyPayCents,
  netPurchases,
  nextBuyHint,
  parcelOptimiser,
  purchaseWindows,
  realisedByFinancialYear,
  savingsGoals,
  sheetDate,
  yearWindow,
};

/** D36: the matching seam; only FIFO exists. */
export const MATCHING_STRATEGIES: readonly MatchingStrategy[] = ['fifo'];

/**
 * True once the engine's full unit suite passes (§7.3 step 10). It gates the server's
 * engine-dependent route, integration and golden tests; never fake it.
 */
export const ENGINE_IMPLEMENTED: boolean = true;

/**
 * True once the engine's full Stage 3 unit suite (goldens included) passes (stage-3.md §7.3 step
 * 12). It gates the server's Stage 3 integration, route and golden tests; never fake it.
 */
export const CASHFLOW_ENGINE_IMPLEMENTED: boolean = true;

/** Amounts in dollars; null when there is no root (§2.7). */
export function xirr(flows: readonly { amount: number; date: IsoDate }[]): number | null {
  return xirrRate(flows);
}

/** The whole function set as one value (server injection, §4.5). */
export const engine = {
  computeInvestments,
  xirr,
  realisedByFinancialYear,
  contributionsAt,
  netPurchases,
  purchaseWindows,
  compressSeries,
  budgetInvestment,
  parcelOptimiser,
  investCountdown,
  considerNext,
  nextBuyHint,
  assetClassOfKind,
  sheetDate,
  cashTotals,
  monthlyPayCents,
  computeSavings,
  cashKpis,
  savingsGoals,
  computeSideIncome,
  computeBudget,
  budgetInvestInputOf,
  computeDividends,
  dividendSuggestions,
  cashDeficitMonths,
  compressCashflow,
  yearWindow,
} satisfies EngineApi;
