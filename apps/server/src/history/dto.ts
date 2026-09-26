// Engine result → DTO mapping for the History, Net Worth and Settings APIs (stage-5.md §4.4). Every
// DTO is declared field by field in @joinr/schema; these mappers copy field by field (Cents →
// number), so a new engine field never leaks into a response unnoticed (a type-level test asserts
// the engine types are assignable to the DTOs).
import type {
  MarginalRateSuggestion,
  NetWorthBreakdown,
  NetWorthChange,
  RollingNetWorthRow,
  SnapshotDifference,
  SnapshotFigures,
  SnapshotGroup,
  TrendResult,
} from '@joinr/engine';
import type {
  NetWorthBreakdownDto,
  NetWorthChangeDto,
  RollingNetWorthRowDto,
  SnapshotDifferenceDto,
  SnapshotFiguresDto,
  SnapshotGroupDto,
  TrendDto,
} from '@joinr/schema';

export function snapshotFiguresDto(f: SnapshotFigures): SnapshotFiguresDto {
  return {
    stocksValueCents: f.stocksValueCents,
    stocksGainCents: f.stocksGainCents,
    stocksGainRatio: f.stocksGainRatio,
    stocksMovementsCents: f.stocksMovementsCents,
    etfValueCents: f.etfValueCents,
    etfGainCents: f.etfGainCents,
    etfGainRatio: f.etfGainRatio,
    etfMovementsCents: f.etfMovementsCents,
    cryptoValueCents: f.cryptoValueCents,
    cryptoGainCents: f.cryptoGainCents,
    cryptoGainRatio: f.cryptoGainRatio,
    cryptoMovementsCents: f.cryptoMovementsCents,
    cashValueCents: f.cashValueCents,
    cashGainCents: f.cashGainCents,
    cashIncreaseRatio: f.cashIncreaseRatio,
    superValueCents: f.superValueCents,
    superContribCents: f.superContribCents,
    superGainCents: f.superGainCents,
    superGainRatio: f.superGainRatio,
    liabilitiesBalanceCents: f.liabilitiesBalanceCents,
    liabilitiesPaidCents: f.liabilitiesPaidCents,
    salaryMonthlyCents: f.salaryMonthlyCents,
    propertyValueCents: f.propertyValueCents,
    propertyPurchaseCents: f.propertyPurchaseCents,
    propertyEquityCents: f.propertyEquityCents,
    propertyGainCents: f.propertyGainCents,
    mortgageBalanceCents: f.mortgageBalanceCents,
    mortgageInterestFeesCents: f.mortgageInterestFeesCents,
    mortgagePrincipalPaidCents: f.mortgagePrincipalPaidCents,
    propertyGainRatio: f.propertyGainRatio,
    mfValueCents: f.mfValueCents,
    mfGainCents: f.mfGainCents,
    mfGainRatio: f.mfGainRatio,
    mfMovementsCents: f.mfMovementsCents,
    otherValueCents: f.otherValueCents,
    otherGainCents: f.otherGainCents,
    offsetCents: f.offsetCents,
    mortgageOffsetCents: f.mortgageOffsetCents,
    cashDebtCents: f.cashDebtCents,
    superMeasuredThrough: f.superMeasuredThrough,
  };
}

export function netWorthBreakdownDto(b: NetWorthBreakdown): NetWorthBreakdownDto {
  return {
    liquidCents: b.liquidCents,
    superCents: b.superCents,
    propertyCents: b.propertyCents,
    liabilitiesCents: b.liabilitiesCents,
    offsetsCents: b.offsetsCents,
    netWorthCents: b.netWorthCents,
    missing: [...b.missing],
  };
}

export function snapshotDifferenceDto(d: SnapshotDifference): SnapshotDifferenceDto {
  return {
    column: d.column,
    kind: d.kind,
    storedCents: d.storedCents,
    recomputedCents: d.recomputedCents,
    storedRatio: d.storedRatio,
    recomputedRatio: d.recomputedRatio,
  };
}

export function snapshotGroupDto(g: SnapshotGroup): SnapshotGroupDto {
  return {
    label: g.label,
    period: g.period,
    date: g.date,
    live: g.live,
    rows: g.rows,
    figures: snapshotFiguresDto(g.figures),
    netWorth: netWorthBreakdownDto(g.netWorth),
    growthCents: g.growthCents,
    liquidGrowthCents: g.liquidGrowthCents,
  };
}

export function netWorthChangeDto(c: NetWorthChange): NetWorthChangeDto {
  return {
    base:
      c.base === null
        ? null
        : {
            periodMonth: c.base.periodMonth,
            runDate: c.base.runDate,
            netWorthCents: c.base.netWorthCents,
          },
    cents: c.cents,
    ratio: c.ratio,
  };
}

export function rollingNetWorthRowDto(r: RollingNetWorthRow): RollingNetWorthRowDto {
  return {
    periodMonth: r.periodMonth,
    runDate: r.runDate,
    status: r.status,
    source: r.source,
    netWorth: r.breakdown === null ? null : netWorthBreakdownDto(r.breakdown),
    growthCents: r.growthCents,
    liquidGrowthCents: r.liquidGrowthCents,
    savingsRatio: r.savingsRatio,
    rawSavingsRatio: r.rawSavingsRatio,
    projectedLiquidCents: r.projectedLiquidCents,
  };
}

export function trendDto(t: TrendResult): TrendDto {
  return {
    fittedCents: [...t.fittedCents],
    slopePerMonthCents: t.slopePerMonthCents,
    points: t.points,
  };
}

/** The engine's suggestion (Cents → number), without the server's three fields. */
export function marginalRateSuggestionFields(s: MarginalRateSuggestion) {
  return {
    financialYear: s.financialYear,
    tableFinancialYear: s.tableFinancialYear,
    tableCurrent: s.tableCurrent,
    incomeCents: s.incomeCents,
    bracket: {
      thresholdCents: s.bracket.thresholdCents,
      toCents: s.bracket.toCents,
      ratio: s.bracket.ratio,
    },
    bracketRatio: s.bracketRatio,
    medicare: {
      thresholdCents: s.medicare.thresholdCents,
      thresholdFinancialYear: s.medicare.thresholdFinancialYear,
      ratio: s.medicare.ratio,
      band: s.medicare.band,
    },
    suggestedRatio: s.suggestedRatio,
    incomeTaxCents: s.incomeTaxCents,
    medicareLevyCents: s.medicareLevyCents,
    litoPhaseOut: s.litoPhaseOut,
  };
}
