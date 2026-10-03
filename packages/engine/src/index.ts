// `@joinr/engine`: the pure investment, cash-flow, assets and history engine (stage-2.md §2,
// stage-3.md §2, stage-4.md §2, stage-5.md §2). No I/O, no clock: every "today" is an `asOf`
// input. The public API is frozen (stage-2.md §2.2, stage-3.md §2.2, stage-4.md §2.2, stage-5.md
// §2.2, stage-6.md §2.2); the implementation lives in internal modules: lots.ts (FIFO, the D36 seam), realised.ts
// (the FY table), xirr.ts (the solver), investments.ts (holdings, summary, allocation, dividends),
// history.ts, timing.ts, and for Stage 3 periods.ts (windows and years), cash.ts, savings.ts,
// kpis.ts, goals.ts, sideIncome.ts, budget.ts, dividends.ts, suggestions.ts and charts.ts, and for
// Stage 4 otherAssets.ts, super.ts, property.ts, amortise.ts and assetsSnapshot.ts (shared helpers
// in assetsCommon.ts), and for Stage 5 snapshot.ts (the composer and checks), netWorth.ts,
// aggregate.ts, trend.ts, recording.ts and tax.ts, and for Stage 6 (stage-6.md §2.2) fire.ts (the FIRE
// planner: deriveFireInputs, projectFire) and fireSheet.ts (the template's FIRE tab, sheet mode), and
// for Stage 9 (stage-9.md §2.8) dayChange.ts (the phone app's day-change rules: computeDayChange,
// portfolioLine, downsample).
import type { IsoDate } from '@joinr/schema';
import { aggregateSnapshots } from './aggregate';
import { amortise } from './amortise';
import { assetsSnapshotColumns } from './assetsSnapshot';
import { budgetInvestInputOf, budgetInvestment, computeBudget } from './budget';
import { cashTotals, monthlyPayCents } from './cash';
import { compressCashflow } from './charts';
import { computeDayChange, downsample, FUND_DAY_MAX_WEEKDAYS, portfolioLine } from './dayChange';
import { computeDividends } from './dividends';
import { deriveFireInputs, projectFire } from './fire';
import { fireSheet } from './fireSheet';
import { savingsGoals } from './goals';
import { contributionsAt, compressSeries, netPurchases, purchaseWindows } from './history';
import { computeInvestments } from './investments';
import { netWorthDashboard, netWorthOf, rollingNetWorth } from './netWorth';
import { cashKpis } from './kpis';
import { computeOtherAssets, otherAssetsCostHeldAt } from './otherAssets';
import { yearWindow } from './periods';
import { computeProperty } from './property';
import { realisedByFinancialYear } from './realised';
import { nextRecordMonth, recordableMonths, recordingsDue } from './recording';
import { computeSavings } from './savings';
import { computeSideIncome } from './sideIncome';
import { checkSnapshots, composeSnapshot, deriveSnapshotColumns } from './snapshot';
import { dividendSuggestions } from './suggestions';
import { computeSuper } from './super';
import { suggestMarginalRate } from './tax';
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
import { linearTrend } from './trend';
import { xirrRate } from './xirr';

export type * from './types';
export type * from './dayChange';

// Stage 9 (stage-9.md §2.8): exported beside the frozen EngineApi value, not inside it.
export { computeDayChange, downsample, FUND_DAY_MAX_WEEKDAYS, portfolioLine };

export {
  aggregateSnapshots,
  amortise,
  assetClassOfKind,
  assetsSnapshotColumns,
  budgetInvestInputOf,
  budgetInvestment,
  cashDeficitMonths,
  cashKpis,
  cashTotals,
  checkSnapshots,
  composeSnapshot,
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
  deriveSnapshotColumns,
  deriveFireInputs,
  dividendSuggestions,
  fireSheet,
  investCountdown,
  linearTrend,
  monthlyPayCents,
  netPurchases,
  netWorthDashboard,
  netWorthOf,
  nextBuyHint,
  nextRecordMonth,
  otherAssetsCostHeldAt,
  parcelOptimiser,
  projectFire,
  purchaseWindows,
  realisedByFinancialYear,
  recordableMonths,
  recordingsDue,
  rollingNetWorth,
  savingsGoals,
  sheetDate,
  suggestMarginalRate,
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

/**
 * True once the engine's full Stage 5 unit suite (goldens included) passes (stage-5.md §7.3 step
 * 10). It gates the server's Stage 5 integration, route and golden tests and the Stage 2–4
 * real-engine server suites (§7.4 step 8); never fake it.
 */
export const HISTORY_ENGINE_IMPLEMENTED: boolean = true;

/**
 * True once the engine's full Stage 6 unit suite (goldens included) passes (stage-6.md §7.3 step 7).
 * It gates the server's FIRE integration, route and golden tests and the fixture-consistency test;
 * never fake it.
 */
export const FIRE_ENGINE_IMPLEMENTED: boolean = true;

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
  // Stage 5.
  composeSnapshot,
  deriveSnapshotColumns,
  checkSnapshots,
  netWorthOf,
  netWorthDashboard,
  rollingNetWorth,
  aggregateSnapshots,
  linearTrend,
  nextRecordMonth,
  recordableMonths,
  recordingsDue,
  suggestMarginalRate,
  // Stage 6.
  deriveFireInputs,
  projectFire,
  fireSheet,
} satisfies EngineApi;
