// What the fixtures cover, so a schema test can assert that every state the pages render appears
// somewhere (stage-1.md §7.6, stage-2.md §3.4).
import type {
  ConsiderReason,
  CountdownState,
  HoldingFlag,
  HoldingStatus,
  PriceStatus,
  RunStatus,
} from '../enums';
import { allInvestmentPageFixtures } from './investments';
import { importRunDetails, priceItems } from './sampleDtos';

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Every PriceStatus appears in `priceItems`; every RunStatus in `importRunDetails`; every
 * HoldingStatus, HoldingFlag, countdown state and ConsiderReason in the investment page fixtures.
 */
export const FIXTURE_COVERAGE: {
  priceStatuses: PriceStatus[];
  runStatuses: RunStatus[];
  holdingStatuses: HoldingStatus[];
  holdingFlags: HoldingFlag[];
  countdownStates: CountdownState[];
  considerReasons: ConsiderReason[];
} = {
  priceStatuses: unique(priceItems.map((i) => i.status)),
  runStatuses: unique(Object.values(importRunDetails).map((r) => r.status)),
  holdingStatuses: unique(
    allInvestmentPageFixtures.flatMap((p) => p.holdings.map((h) => h.status)),
  ),
  holdingFlags: unique(
    allInvestmentPageFixtures.flatMap((p) => p.holdings.flatMap((h) => h.flags)),
  ),
  countdownStates: unique(allInvestmentPageFixtures.map((p) => p.timing.countdown.state)),
  considerReasons: unique(allInvestmentPageFixtures.map((p) => p.timing.considerNext.reason)),
};
