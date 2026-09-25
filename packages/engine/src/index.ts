// `@joinr/engine`: the pure investment engine (stage-2.md §2). No I/O, no clock: every "today" is
// an `asOf` input. The public API is frozen (§2.2); the implementation lives in internal modules:
// lots.ts (FIFO, the D36 seam), realised.ts (the FY table), xirr.ts (the solver), investments.ts
// (holdings, summary, allocation, dividends), history.ts and timing.ts.
import type { IsoDate } from '@joinr/schema';
import { contributionsAt, compressSeries, netPurchases, purchaseWindows } from './history';
import { computeInvestments } from './investments';
import { realisedByFinancialYear } from './realised';
import {
  assetClassOfKind,
  budgetInvestment,
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
  budgetInvestment,
  compressSeries,
  computeInvestments,
  considerNext,
  contributionsAt,
  investCountdown,
  netPurchases,
  nextBuyHint,
  parcelOptimiser,
  purchaseWindows,
  realisedByFinancialYear,
  sheetDate,
};

/** D36: the matching seam; only FIFO exists. */
export const MATCHING_STRATEGIES: readonly MatchingStrategy[] = ['fifo'];

/**
 * True once the engine's full unit suite passes (§7.3 step 10). It gates the server's
 * engine-dependent route, integration and golden tests; never fake it.
 */
export const ENGINE_IMPLEMENTED: boolean = true;

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
} satisfies EngineApi;
