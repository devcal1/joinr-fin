// `GET /api/property` (stage-4.md §4.2, §4.4, §6.5): the properties with their valuations, the
// loans with the D66 balance log (the start point included), the D67 offsets and the schedules,
// every account flagged Offset, the totals and the charts. Every figure comes from the engine
// (`computeProperty`); the server adds names, notes, origins, counts and the imported "payments
// paid" figure (display only).
import type {
  AmortisationResult,
  LoanEntryResult,
  LoanResult,
  PropertiesResult,
  PropertyChartPoint,
  PropertyResultRow,
} from '@joinr/engine';
import type {
  AmortisationDto,
  LoanBalanceEntryDto,
  LoanDto,
  OffsetAccountDto,
  PropertyChartPointDto,
  PropertyDto,
  PropertyPageResponse,
  PropertyTotalsDto,
  PropertyValuationDto,
} from '@joinr/schema';
import type { FinanceContext } from '../cashflow/context';
import { latestSnapshot } from '../cashflow/inputs';
import { settingsSliceDto } from '../cashflow/settings';
import type {
  InvestmentData,
  LoanBalanceEntryRow,
  LoanRow,
  PropertyRow,
  PropertyValuationRow,
} from '../investments/load';
import { PROPERTY_PAGE_SETTING_KEYS } from './constants';
import { chartOf, linkedOffsetsByLoan, loansInPageOrder } from './inputs';

// ─── Properties ─────────────────────────────────────────────────────────────────────────────────

export function propertyDto(
  p: PropertyRow,
  r: PropertyResultRow,
  o: { valuationCount: number },
): PropertyDto {
  return {
    id: p.id,
    name: p.name,
    purchaseDate: p.purchaseDate,
    isPrimaryResidence: p.isPrimaryResidence,
    purchaseValueCents: r.purchaseValueCents,
    valueCents: r.valueCents,
    valuationDate: r.valuationDate,
    netRentToDateCents: r.netRentCents,
    gainCents: r.gainCents,
    gainRatio: r.gainRatio,
    cagrRatio: r.cagrRatio,
    heldDays: r.heldDays,
    debtCents: r.debtCents,
    equityCents: r.equityCents,
    lvrRatio: r.lvrRatio,
    loanIds: [...r.loanIds],
    valuationCount: o.valuationCount,
    note: p.note,
    sortOrder: p.sortOrder,
    origin: p.origin,
    sheetRef: p.sheetRef,
  };
}

/** Every property the engine returned, in sort order. */
export function propertyDtos(data: InvestmentData, result: PropertiesResult): PropertyDto[] {
  const byId = new Map(result.properties.map((r) => [r.id, r]));
  const counts = new Map<number, number>();
  for (const v of data.propertyValuations) {
    counts.set(v.propertyId, (counts.get(v.propertyId) ?? 0) + 1);
  }
  const out: PropertyDto[] = [];
  for (const p of data.properties) {
    const r = byId.get(p.id);
    if (r) out.push(propertyDto(p, r, { valuationCount: counts.get(p.id) ?? 0 }));
  }
  return out;
}

export function valuationDto(v: PropertyValuationRow): PropertyValuationDto {
  return {
    id: v.id,
    propertyId: v.propertyId,
    asOf: v.asOf,
    valueCents: v.valueCents,
    note: v.note,
    origin: v.origin,
    sheetRef: v.sheetRef,
  };
}

/** Every valuation, asOf desc (then id desc). */
export function valuationDtos(rows: readonly PropertyValuationRow[]): PropertyValuationDto[] {
  return [...rows]
    .sort((a, b) => (a.asOf !== b.asOf ? (a.asOf < b.asOf ? 1 : -1) : b.id - a.id))
    .map(valuationDto);
}

// ─── Loans ──────────────────────────────────────────────────────────────────────────────────────

export function amortisationDto(a: AmortisationResult | null): AmortisationDto | null {
  if (a === null) return null;
  return {
    periodicRatio: a.periodicRatio,
    firstPaymentDate: a.firstPaymentDate,
    firstPeriodInterestCents: a.firstPeriodInterestCents,
    payments: a.payments,
    payoffDate: a.payoffDate,
    totalInterestCents: a.totalInterestCents,
    points: a.points.map((p) => ({
      date: p.date,
      balanceCents: p.balanceCents,
      interestCents: p.interestCents,
    })),
    flag: a.flag,
  };
}

export function loanDto(
  l: LoanRow,
  r: LoanResult,
  o: { propertyName: string | null; offsetAccountIds: number[]; entryCount: number },
): LoanDto {
  return {
    id: l.id,
    propertyId: l.propertyId,
    propertyName: o.propertyName,
    name: l.name,
    lender: l.lender,
    startDate: l.startDate,
    startBalanceCents: l.startBalanceCents,
    annualRate: l.annualRate,
    compoundingPerYear: l.interestPeriodsPerYear,
    paymentCents: l.paymentCents,
    paymentFrequency: l.paymentFrequency,
    paymentAnchorDate: r.paymentAnchorDate,
    balanceCents: r.balanceCents,
    balanceAsOf: r.balanceAsOf,
    offsetCents: r.offsetCents,
    netBalanceCents: r.netBalanceCents,
    excessOffsetCents: r.excessOffsetCents,
    offsetAccountIds: o.offsetAccountIds,
    repaymentsCents: r.repaymentsCents,
    principalPaidCents: r.principalPaidCents,
    interestFeesCents: r.interestFeesCents,
    nextPeriodInterestCents: r.nextPeriodInterestCents,
    schedule: amortisationDto(r.schedule),
    scheduleWithoutOffset: amortisationDto(r.scheduleWithoutOffset),
    interestSavedCents: r.interestSavedCents,
    monthsSaved: r.monthsSaved,
    // The workbook's figure, for display beside the derived ones (a loan the app created has none).
    imported:
      l.sheetRef === null
        ? null
        : { paymentsPaidCents: l.paymentsPaidCents, paymentsPaidDerived: l.paymentsPaidDerived },
    flags: [...r.flags],
    entryCount: o.entryCount,
    note: l.note,
    sortOrder: l.sortOrder,
    origin: l.origin,
    sheetRef: l.sheetRef,
  };
}

/** Every loan the engine returned: mortgages by property order, then loans without a property. */
export function loanDtos(data: InvestmentData, result: PropertiesResult): LoanDto[] {
  const byId = new Map(result.loans.map((r) => [r.id, r]));
  const propertyNames = new Map(data.properties.map((p) => [p.id, p.name]));
  const offsets = linkedOffsetsByLoan(data);
  const counts = new Map<number, number>();
  for (const e of data.loanBalanceEntries) counts.set(e.loanId, (counts.get(e.loanId) ?? 0) + 1);
  const out: LoanDto[] = [];
  for (const l of loansInPageOrder(data)) {
    const r = byId.get(l.id);
    if (!r) continue;
    out.push(
      loanDto(l, r, {
        propertyName: l.propertyId === null ? null : (propertyNames.get(l.propertyId) ?? null),
        offsetAccountIds: (offsets.get(l.id) ?? []).map((o) => o.accountId),
        entryCount: counts.get(l.id) ?? 0,
      }),
    );
  }
  return out;
}

export function loanEntryDto(
  loan: LoanRow,
  e: LoanEntryResult,
  row: LoanBalanceEntryRow | undefined,
): LoanBalanceEntryDto {
  return {
    id: e.id,
    start: e.start,
    loanId: loan.id,
    asOf: e.asOf,
    balanceCents: e.balanceCents,
    paymentsCounted: e.paymentsCounted,
    repaymentsCents: e.repaymentsCents,
    repaymentsTyped: e.repaymentsTyped,
    principalCents: e.principalCents,
    interestFeesCents: e.interestFeesCents,
    cumulativePrincipalCents: e.cumulativePrincipalCents,
    cumulativeInterestFeesCents: e.cumulativeInterestFeesCents,
    flags: [...e.flags],
    // The start point is built from the loan's start fields: the loan's origin, no note or ref.
    note: row?.note ?? null,
    origin: row?.origin ?? loan.origin,
    sheetRef: row?.sheetRef ?? null,
  };
}

/**
 * Every loan's log points (the start points included, id null), asOf desc; on one date, loans in
 * page order and a loan's stored entries (id desc) before its start point.
 */
export function loanEntryDtos(
  data: InvestmentData,
  result: PropertiesResult,
): LoanBalanceEntryDto[] {
  const rows = new Map(data.loanBalanceEntries.map((e) => [e.id, e]));
  const loans = new Map(data.loans.map((l) => [l.id, l]));
  const order = new Map(loansInPageOrder(data).map((l, i) => [l.id, i]));
  const out: { dto: LoanBalanceEntryDto; rank: number }[] = [];
  for (const r of result.loans) {
    const loan = loans.get(r.id);
    if (!loan) continue;
    for (const e of r.entries) {
      const row = e.id === null ? undefined : rows.get(e.id);
      out.push({ dto: loanEntryDto(loan, e, row), rank: order.get(r.id) ?? 0 });
    }
  }
  return out
    .sort((a, b) => {
      if (a.dto.asOf !== b.dto.asOf) return a.dto.asOf < b.dto.asOf ? 1 : -1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (b.dto.id ?? -1) - (a.dto.id ?? -1);
    })
    .map((x) => x.dto);
}

/** Every account flagged Offset (D56), in the Cash page's account order, with its linked loan. */
export function offsetAccountDtos(data: InvestmentData): OffsetAccountDto[] {
  const links = new Map(data.loanOffsetLinks.map((l) => [l.accountId, l.loanId]));
  return data.cashAccounts
    .filter((a) => a.isOffset)
    .map((a) => ({
      id: a.id,
      name: a.name,
      balanceCents: a.balanceCents,
      balanceAsOf: a.balanceAsOf,
      linkedLoanId: links.get(a.id) ?? null,
    }));
}

export function propertyTotalsDto(t: PropertiesResult['totals']): PropertyTotalsDto {
  return {
    purchaseCents: t.purchaseCents,
    valueCents: t.valueCents,
    gainCents: t.gainCents,
    gainRatio: t.gainRatio,
    mortgageCents: t.mortgageCents,
    offsetCents: t.offsetCents,
    netMortgageCents: t.netMortgageCents,
    principalPaidCents: t.principalPaidCents,
    interestFeesCents: t.interestFeesCents,
    repaymentsCents: t.repaymentsCents,
    startBalanceCents: t.startBalanceCents,
    lvrRatio: t.lvrRatio,
    equityCents: t.equityCents,
  };
}

export function propertyChartPointDto(p: PropertyChartPoint): PropertyChartPointDto {
  return {
    label: p.label,
    period: p.period,
    date: p.date,
    live: p.live,
    valueCents: p.valueCents,
    purchaseCents: p.purchaseCents,
    mortgageCents: p.mortgageCents,
    equityCents: p.equityCents,
    lvrRatio: p.lvrRatio,
    interestFeesCents: p.interestFeesCents,
    principalPaidCents: p.principalPaidCents,
  };
}

// ─── The page ───────────────────────────────────────────────────────────────────────────────────

export function buildPropertyPage(ctx: FinanceContext): PropertyPageResponse {
  const { data } = ctx;
  const result = ctx.property();
  const { unit, count } = chartOf(data.settings);
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    lastRun: latestSnapshot(data.snapshots)?.runDate ?? null,
    properties: propertyDtos(data, result),
    valuations: valuationDtos(data.propertyValuations),
    loans: loanDtos(data, result),
    loanEntries: loanEntryDtos(data, result),
    offsetAccounts: offsetAccountDtos(data),
    totals: propertyTotalsDto(result.totals),
    charts: { unit, count, points: result.chart.map(propertyChartPointDto) },
    settings: settingsSliceDto(data.settings, data.settingOrigins, PROPERTY_PAGE_SETTING_KEYS),
  };
}
