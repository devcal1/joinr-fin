// Builders for the Stage 5 engine tests (stage-5.md §7.3). Generic round figures only (the repo is
// public).
import type { InstrumentKind, IsoDate, IsoMonth, SnapshotSource } from '@joinr/schema';
import { computeProperty } from '../src/index';
import type {
  AssetsSnapshotColumns,
  EngineSnapshot,
  InvestmentsResult,
  PropertiesResult,
  SnapshotFigures,
  SummaryResult,
} from '../src/index';

/** Every figure null (a blank History row); override what a test needs. */
export function figures(over: Partial<SnapshotFigures> = {}): SnapshotFigures {
  return {
    stocksValueCents: null,
    stocksGainCents: null,
    stocksGainRatio: null,
    stocksMovementsCents: null,
    etfValueCents: null,
    etfGainCents: null,
    etfGainRatio: null,
    etfMovementsCents: null,
    cryptoValueCents: null,
    cryptoGainCents: null,
    cryptoGainRatio: null,
    cryptoMovementsCents: null,
    cashValueCents: null,
    cashGainCents: null,
    cashIncreaseRatio: null,
    superValueCents: null,
    superContribCents: null,
    superGainCents: null,
    superGainRatio: null,
    liabilitiesBalanceCents: null,
    liabilitiesPaidCents: null,
    salaryMonthlyCents: null,
    propertyValueCents: null,
    propertyPurchaseCents: null,
    propertyEquityCents: null,
    propertyGainCents: null,
    mortgageBalanceCents: null,
    mortgageInterestFeesCents: null,
    mortgagePrincipalPaidCents: null,
    propertyGainRatio: null,
    mfValueCents: null,
    mfGainCents: null,
    mfGainRatio: null,
    mfMovementsCents: null,
    otherValueCents: null,
    otherGainCents: null,
    offsetCents: null,
    mortgageOffsetCents: null,
    cashDebtCents: null,
    superMeasuredThrough: null,
    ...over,
  };
}

/** A snapshot row (migrated unless said otherwise). */
export function snapshot(
  periodMonth: IsoMonth,
  runDate: IsoDate,
  over: Partial<SnapshotFigures> = {},
  source: SnapshotSource = 'migrated',
): EngineSnapshot {
  return { ...figures(over), periodMonth, runDate, source };
}

/** A figure set with every value column set: the liquid classes, super, property and a mortgage. */
export function fullFigures(over: Partial<SnapshotFigures> = {}): SnapshotFigures {
  return figures({
    stocksValueCents: 1_000_000,
    stocksGainCents: 100_000,
    etfValueCents: 5_000_000,
    etfGainCents: 500_000,
    cryptoValueCents: 200_000,
    cryptoGainCents: -50_000,
    cashValueCents: 3_000_000,
    superValueCents: 20_000_000,
    superGainCents: 400_000,
    liabilitiesBalanceCents: 0,
    liabilitiesPaidCents: 0,
    propertyValueCents: 60_000_000,
    propertyGainCents: 5_000_000,
    propertyEquityCents: 20_000_000,
    mortgageBalanceCents: -40_000_000,
    mfValueCents: 800_000,
    mfGainCents: 80_000,
    otherValueCents: 300_000,
    otherGainCents: 30_000,
    ...over,
  });
}

/** A kind's investments result: only the summary's value and total return matter to Stage 5. */
export function investments(
  kind: InstrumentKind,
  valueCents: number,
  totalReturnCents: number,
): InvestmentsResult {
  const summary: SummaryResult = {
    valueCents,
    costCents: valueCents - totalReturnCents,
    unrealisedCents: totalReturnCents,
    dividendsHeldCents: 0,
    totalReturnCents,
    totalReturnRatio: null,
    realisedCents: 0,
    realisedThisFyCents: 0,
    xirr: null,
    investmentRatePerMonthCents: null,
    dividendsThisFyCents: 0,
    dividendsAllTimeCents: 0,
    heldCount: 1,
    watchingCount: 1,
    exitedCount: 0,
    unpricedCount: 0,
    stalePriceCount: 0,
    targetSumRatio: '0',
    targetCount: 0,
    estMgmtFeeCents: null,
    lastBuyDate: null,
  };
  return {
    kind,
    asOf: '2026-09-24',
    holdings: [],
    lots: [],
    disposals: [],
    trades: [],
    dividends: [],
    summary,
    allocation: { byHolding: [], bySector: [], byRegion: null },
    realisedByFy: [],
  };
}

/** The Stage 4 seam with a property, a mortgage, a linked offset and other assets. */
export function assetsColumns(over: Partial<AssetsSnapshotColumns> = {}): AssetsSnapshotColumns {
  return {
    superValueCents: 20_000_000,
    superContribCents: 50_000,
    superGainCents: 500_000,
    superGainRatio: '0.0256410256410',
    propertyValueCents: 60_000_000,
    propertyPurchaseCents: 55_000_000,
    propertyEquityCents: 21_000_000,
    propertyGainCents: 5_000_000,
    mortgageBalanceCents: -40_000_000,
    mortgageInterestFeesCents: 1_200_000,
    mortgagePrincipalPaidCents: 800_000,
    propertyGainRatio: '0.0909090909091',
    otherValueCents: 300_000,
    otherGainCents: 30_000,
    mortgageOffsetCents: 1_000_000,
    ...over,
  };
}

/** A property result for the dashboard's display lines (no property, no loan). */
export function emptyProperty(asOf: IsoDate = '2026-09-24'): PropertiesResult {
  return computeProperty({
    asOf,
    properties: [],
    loans: [],
    snapshots: [],
    chart: { unit: 'monthly', count: null },
  });
}
