// `@joinr/engine`: the pure investment, cash-flow and assets engine (stage-2.md §2, stage-3.md §2,
// stage-4.md §2). No I/O, no clock: every "today" is an `asOf` input. The public API is frozen
// (stage-2.md §2.2, stage-3.md §2.2, stage-4.md §2.2); the implementation lives in internal
// modules: lots.ts (FIFO, the D36 seam), realised.ts (the FY table), xirr.ts (the solver),
// investments.ts (holdings, summary, allocation, dividends), history.ts, timing.ts, and for Stage 3
// periods.ts (windows and years), cash.ts, savings.ts, kpis.ts, goals.ts, sideIncome.ts,
// budget.ts, dividends.ts, suggestions.ts and charts.ts, and for Stage 4 otherAssets.ts, super.ts,
// property.ts, amortise.ts and assetsSnapshot.ts (shared helpers in assetsCommon.ts).
import type { IsoDate } from '@joinr/schema';
import { amortise } from './amortise';
import { assetsSnapshotColumns } from './assetsSnapshot';
import { budgetInvestInputOf, budgetInvestment, computeBudget } from './budget';
import { cashTotals, monthlyPayCents } from './cash';
import { compressCashflow } from './charts';
import { computeDividends } from './dividends';
import { savingsGoals } from './goals';
import { contributionsAt, compressSeries, netPurchases, purchaseWindows } from './history';
import { computeInvestments } from './investments';
import { cashKpis } from './kpis';
import { computeOtherAssets, otherAssetsCostHeldAt } from './otherAssets';
import { yearWindow } from './periods';
import { computeProperty } from './property';
import { realisedByFinancialYear } from './realised';
import { computeSavings } from './savings';
import { computeSideIncome } from './sideIncome';
import { dividendSuggestions } from './suggestions';
import { computeSuper } from './super';
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
  amortise,
  assetClassOfKind,
  assetsSnapshotColumns,
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
  computeOtherAssets,
  computeProperty,
  computeSavings,
  computeSideIncome,
  computeSuper,
  considerNext,
  contributionsAt,
  dividendSuggestions,
  investCountdown,
  monthlyPayCents,
  netPurchases,
  nextBuyHint,
  otherAssetsCostHeldAt,
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

/**
 * True once the engine's full Stage 4 unit suite (goldens included) passes (stage-4.md §7.3 step
 * 7). It gates the server's Stage 4 integration, route and golden tests and the four Stage 2–3
 * real-engine server suites (§7.4); never fake it.
 */
export const ASSETS_ENGINE_IMPLEMENTED: boolean = true;

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
  computeOtherAssets,
  otherAssetsCostHeldAt,
  computeSuper,
  computeProperty,
  amortise,
  assetsSnapshotColumns,
} satisfies EngineApi;
