// What the fixtures cover, so a schema test can assert that every state the pages render appears
// somewhere (stage-1.md §7.6, stage-2.md §3.4).
import type {
  CashAccountKind,
  ConsiderReason,
  CountdownState,
  DividendSuggestionStatus,
  DrpAdvice,
  FxRateSource,
  HoldingFlag,
  HoldingStatus,
  KpiTrend,
  LoanEntryFlag,
  LoanFlag,
  OtherAssetFlag,
  PriceStatus,
  RunStatus,
  SavingsPeriodStatus,
  SuperCapStatus,
  SuperFlag,
  YearBasis,
} from '../enums';
import { otherAssetsPages, propertyPages, superPages } from './assets';
import { cashPages, dividendsPages } from './cashflow';
import { allInvestmentPageFixtures } from './investments';
import { importRunDetails, priceItems } from './sampleDtos';

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Every PriceStatus appears in `priceItems`; every RunStatus in `importRunDetails`; every
 * HoldingStatus, HoldingFlag, countdown state and ConsiderReason in the investment page fixtures;
 * every cash account kind, savings period status, year basis and KPI trend in the Cash page
 * fixtures; every suggestion status and DRP advice in the Dividends page fixtures (stage-3.md §3.6);
 * every other-asset flag, price status (the four the engine gives) and FX source in the Other
 * Assets fixtures, every super flag and cap status in the Super fixtures, and every loan and
 * loan-entry flag in the Property fixtures (stage-4.md §3.6).
 */
export const FIXTURE_COVERAGE: {
  priceStatuses: PriceStatus[];
  runStatuses: RunStatus[];
  holdingStatuses: HoldingStatus[];
  holdingFlags: HoldingFlag[];
  countdownStates: CountdownState[];
  considerReasons: ConsiderReason[];
  cashAccountKinds: CashAccountKind[];
  savingsPeriodStatuses: SavingsPeriodStatus[];
  yearBases: YearBasis[];
  kpiTrends: KpiTrend[];
  suggestionStatuses: DividendSuggestionStatus[];
  drpAdvice: DrpAdvice[];
  otherAssetFlags: OtherAssetFlag[];
  otherAssetPriceStatuses: PriceStatus[];
  superFlags: SuperFlag[];
  superCapStatuses: SuperCapStatus[];
  loanFlags: LoanFlag[];
  loanEntryFlags: LoanEntryFlag[];
  fxRateSources: FxRateSource[];
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
  cashAccountKinds: unique(Object.values(cashPages).flatMap((p) => p.accounts.map((a) => a.kind))),
  savingsPeriodStatuses: unique(
    Object.values(cashPages).flatMap((p) => p.periods.map((x) => x.status)),
  ),
  yearBases: unique(Object.values(cashPages).map((p) => p.kpis.year.basis)),
  kpiTrends: unique(
    Object.values(cashPages).flatMap((p) => (p.kpis.trend === null ? [] : [p.kpis.trend])),
  ),
  suggestionStatuses: unique(
    Object.values(dividendsPages).flatMap((p) => p.suggestions.map((x) => x.status)),
  ),
  drpAdvice: unique(
    Object.values(dividendsPages).flatMap((p) =>
      p.holdingsThisFy.flatMap((h) => (h.advice === null ? [] : [h.advice])),
    ),
  ),
  otherAssetFlags: unique(
    Object.values(otherAssetsPages).flatMap((p) => p.assets.flatMap((a) => a.flags)),
  ),
  otherAssetPriceStatuses: unique(
    Object.values(otherAssetsPages).flatMap((p) => p.assets.map((a) => a.priceStatus)),
  ),
  superFlags: unique(Object.values(superPages).flatMap((p) => p.flags)),
  superCapStatuses: unique(
    Object.values(superPages).flatMap((p) => p.capYears.map((c) => c.status)),
  ),
  loanFlags: unique(Object.values(propertyPages).flatMap((p) => p.loans.flatMap((l) => l.flags))),
  loanEntryFlags: unique(
    Object.values(propertyPages).flatMap((p) => p.loanEntries.flatMap((e) => e.flags)),
  ),
  fxRateSources: unique(
    Object.values(otherAssetsPages).flatMap((p) =>
      p.assets.flatMap((a) => (a.purchaseFxSource === null ? [] : [a.purchaseFxSource])),
    ),
  ),
};
