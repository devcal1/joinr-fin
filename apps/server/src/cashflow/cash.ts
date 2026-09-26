// `GET /api/cash` (stage-3.md §4.2, §4.4, §6.3): accounts by kind with their balance history, the
// totals and the emergency-fund test, the savings periods (raw and adjusted), the KPIs, the savings
// goals and the charts. Every figure comes from the engine; the server adds names, notes, origins
// and counts. Stage 4 (stage-4.md §3.2, §6.6): each account's linked loan (D67), the offsets part
// of added investments. Stage 5 dropped `staticUntilStage4` (stage-5.md §3.2).
import type {
  CashKpisResult,
  CashTotalsResult,
  CashflowChartPoint,
  SavingsGoalResult,
  SavingsPeriod,
  YearWindow,
} from '@joinr/engine';
import {
  CASH_ACCOUNT_KINDS,
  EDITABLE_NOTE_KINDS,
  INSTRUMENT_KINDS,
  type EditableNoteKind,
  type CashAccountDto,
  type CashBalanceEntryDto,
  type CashChartPointDto,
  type CashKpisDto,
  type CashPageResponse,
  type CashTotalsDto,
  type PeriodNoteDto,
  type SavingsAdjustmentDto,
  type SavingsGoalDto,
  type SavingsPeriodDto,
  type YearWindowDto,
} from '@joinr/schema';
import { chartDateUnitSetting, numberSetting, stringSetting } from '../db/queries/settings';
import type {
  CashAccountRow,
  CashBalanceEntryRow,
  InvestmentData,
  PeriodNoteRow,
  SavingsAdjustmentRow,
  SavingsGoalRow,
} from '../investments/load';
import {
  CASH_PAGE_SETTING_KEYS,
  GOALS_CASH_BASIS,
  LOANS_COUNT_FOR_EMERGENCY_FUND,
} from './constants';
import type { FinanceContext } from './context';
import { latestSnapshot, offsetsIncludeEmergencyFundOf, yearBasisOf } from './inputs';
import { settingsSliceDto } from './settings';

function isEditableNoteKind(kind: string): kind is EditableNoteKind {
  return (EDITABLE_NOTE_KINDS as readonly string[]).includes(kind);
}

// ─── Accounts and entries ───────────────────────────────────────────────────────────────────────

/** Kind order (CASH_ACCOUNT_KINDS), offsets last, then sortOrder (then id). */
export function sortAccounts<
  T extends Pick<CashAccountRow, 'kind' | 'isOffset' | 'sortOrder' | 'id'>,
>(rows: readonly T[]): T[] {
  const kindIndex = (k: T['kind']) => CASH_ACCOUNT_KINDS.indexOf(k);
  return [...rows].sort(
    (a, b) =>
      Number(a.isOffset) - Number(b.isOffset) ||
      kindIndex(a.kind) - kindIndex(b.kind) ||
      a.sortOrder - b.sortOrder ||
      a.id - b.id,
  );
}

/** Whether an account counts toward the emergency-fund test (D56 offsets, D59 loans). */
export function countsForEmergencyFund(
  a: Pick<CashAccountRow, 'kind' | 'isOffset'>,
  offsetsIncludeEmergencyFund: boolean,
): boolean {
  if (a.isOffset) return offsetsIncludeEmergencyFund;
  return a.kind === 'loan_receivable' ? LOANS_COUNT_FOR_EMERGENCY_FUND : true;
}

export function cashAccountDto(
  a: CashAccountRow,
  o: {
    entryCount: number;
    budgetRowCount: number;
    offsetsIncludeEmergencyFund: boolean;
    /** The loan this offset account is linked to (D67), or null. */
    linkedLoan?: { id: number; name: string } | null;
  },
): CashAccountDto {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    isOffset: a.isOffset,
    currency: a.currency,
    balanceCents: a.balanceCents,
    balanceAsOf: a.balanceAsOf,
    inTotalCash: !a.isOffset,
    countsForEmergencyFund: countsForEmergencyFund(a, o.offsetsIncludeEmergencyFund),
    note: a.note,
    sortOrder: a.sortOrder,
    origin: a.origin,
    sheetRef: a.sheetRef,
    entryCount: o.entryCount,
    budgetRowCount: o.budgetRowCount,
    // Stage 4 (stage-4.md §3.2, additive): the account's loan_offset_links row (D67).
    linkedLoan: o.linkedLoan ?? null,
  };
}

/** Every account's DTO in the page order (kind order, offsets last, sortOrder). */
export function cashAccountDtos(data: InvestmentData): CashAccountDto[] {
  const entries = new Map<number, number>();
  for (const e of data.balanceEntries)
    entries.set(e.accountId, (entries.get(e.accountId) ?? 0) + 1);
  const budgetRows = new Map<number, number>();
  for (const r of data.budgetItems) {
    if (r.cashAccountId !== null) {
      budgetRows.set(r.cashAccountId, (budgetRows.get(r.cashAccountId) ?? 0) + 1);
    }
  }
  const offsets = offsetsIncludeEmergencyFundOf(data.settings);
  const loans = new Map(data.loans.map((l) => [l.id, l]));
  const linked = new Map<number, { id: number; name: string }>();
  for (const link of data.loanOffsetLinks) {
    const loan = loans.get(link.loanId);
    if (loan) linked.set(link.accountId, { id: loan.id, name: loan.name });
  }
  return sortAccounts(data.cashAccounts).map((a) =>
    cashAccountDto(a, {
      entryCount: entries.get(a.id) ?? 0,
      budgetRowCount: budgetRows.get(a.id) ?? 0,
      offsetsIncludeEmergencyFund: offsets,
      linkedLoan: linked.get(a.id) ?? null,
    }),
  );
}

export function balanceEntryDto(e: CashBalanceEntryRow): CashBalanceEntryDto {
  return {
    id: e.id,
    accountId: e.accountId,
    asOf: e.asOf,
    balanceCents: e.balanceCents,
    note: e.note,
    origin: e.origin,
    sheetRef: e.sheetRef,
  };
}

/** asOf desc, then id desc. */
export function sortEntriesNewestFirst(
  rows: readonly CashBalanceEntryRow[],
): CashBalanceEntryRow[] {
  return [...rows].sort((a, b) => (a.asOf !== b.asOf ? (a.asOf < b.asOf ? 1 : -1) : b.id - a.id));
}

export function cashTotalsDto(
  t: CashTotalsResult,
  o: { emergencyFundCents: number | null; offsetsIncluded: boolean },
): CashTotalsDto {
  const target = o.emergencyFundCents;
  return {
    totalCashCents: t.totalCashCents,
    byKind: {
      bank: t.byKind.bank,
      credit_card: t.byKind.credit_card,
      loan_receivable: t.byKind.loan_receivable,
      other: t.byKind.other,
    },
    offsetCents: t.offsetCents,
    loansCents: t.loansCents,
    availableCashCents: t.availableCashCents,
    emergencyFundTestCents: t.emergencyFundTestCents,
    emergencyFund: {
      targetCents: target,
      // The test (§2.4) is `emergencyFundTestCents < target`: short when true.
      covered: target === null ? null : t.emergencyFundTestCents >= target,
      shortfallCents: target === null ? null : Math.max(0, target - t.emergencyFundTestCents),
      offsetsIncluded: o.offsetsIncluded,
      loansIncluded: LOANS_COUNT_FOR_EMERGENCY_FUND,
    },
  };
}

// ─── Periods ────────────────────────────────────────────────────────────────────────────────────

export function adjustmentDto(a: SavingsAdjustmentRow): SavingsAdjustmentDto {
  return { periodMonth: a.periodMonth, amountCents: a.amountCents, note: a.note };
}

/** A note of an editable kind (`spend`, `side_income`, `super_option`); null for any other kind. */
export function periodNoteDto(n: PeriodNoteRow): PeriodNoteDto | null {
  if (!isEditableNoteKind(n.kind)) return null;
  return {
    periodMonth: n.periodMonth,
    kind: n.kind,
    note: n.note,
    origin: n.origin,
    sheetRef: n.sheetRef,
  };
}

/** Notes of one kind by period month. */
export function notesByMonth(
  notes: readonly PeriodNoteRow[],
  kind: EditableNoteKind,
): Map<string, PeriodNoteDto> {
  const out = new Map<string, PeriodNoteDto>();
  for (const n of notes) {
    if (n.kind !== kind) continue;
    const dto = periodNoteDto(n);
    if (dto) out.set(n.periodMonth, dto);
  }
  return out;
}

export function savingsPeriodDto(
  p: SavingsPeriod,
  o: {
    adjustment: SavingsAdjustmentRow | undefined;
    spendNote: PeriodNoteDto | undefined;
  },
): SavingsPeriodDto {
  return {
    periodMonth: p.periodMonth,
    runDate: p.runDate,
    after: p.after,
    through: p.through,
    status: p.status,
    cashCents: p.cashCents,
    cashGainCents: p.cashGainCents,
    cashGainRatio: p.cashGainRatio,
    addedInvestmentsCents: p.addedInvestmentsCents,
    added:
      p.added === null
        ? null
        : {
            tradesCents: p.added.tradesCents,
            otherAssetsCents: p.added.otherAssetsCents,
            superCents: p.added.superCents,
            mortgagePrincipalCents: p.added.mortgagePrincipalCents,
            propertyDepositCents: p.added.propertyDepositCents,
            offsetsCents: p.added.offsetsCents,
          },
    income:
      p.income === null
        ? null
        : {
            salaryCents: p.income.salaryCents,
            sideIncomeCents: p.income.sideIncomeCents,
            cashDividendsCents: p.income.cashDividendsCents,
            otherDividendsCents: p.income.otherDividendsCents,
          },
    // Adjustments attach to closed periods only (§2.3): the engine ignores one on the baseline or
    // the provisional month, so it is listed as an orphan instead (where it can be removed).
    adjustment: p.status !== 'closed' || !o.adjustment ? null : adjustmentDto(o.adjustment),
    raw: {
      incomeCents: p.raw.incomeCents,
      savingsCents: p.raw.savingsCents,
      savingsRatio: p.raw.savingsRatio,
      spendCents: p.raw.spendCents,
    },
    adjusted: {
      incomeCents: p.adjusted.incomeCents,
      savingsCents: p.adjusted.savingsCents,
      savingsRatio: p.adjusted.savingsRatio,
      spendCents: p.adjusted.spendCents,
    },
    spendNote: o.spendNote ?? null,
  };
}

/**
 * Adjustments whose month is not a closed period's month: no period at all, the first (baseline)
 * period, or the provisional period (whose month can change before it is recorded, §2.3).
 */
export function orphanAdjustments(
  periods: readonly SavingsPeriod[],
  adjustments: readonly SavingsAdjustmentRow[],
): SavingsAdjustmentDto[] {
  const months = new Set(periods.filter((p) => p.status === 'closed').map((p) => p.periodMonth));
  return adjustments.filter((a) => !months.has(a.periodMonth)).map(adjustmentDto);
}

// ─── KPIs and charts (declared field by field; §4.4) ────────────────────────────────────────────

export function yearWindowDto(y: YearWindow): YearWindowDto {
  return { basis: y.basis, start: y.start, end: y.end, year: y.year };
}

export function cashKpisDto(k: CashKpisResult): CashKpisDto {
  return {
    anchor: k.anchor,
    year: yearWindowDto(k.year),
    lastPeriod:
      k.lastPeriod === null
        ? null
        : {
            periodMonth: k.lastPeriod.periodMonth,
            runDate: k.lastPeriod.runDate,
            cashGainCents: k.lastPeriod.cashGainCents,
            savingsCents: k.lastPeriod.savingsCents,
            savingsRatio: k.lastPeriod.savingsRatio,
            rawSavingsRatio: k.lastPeriod.rawSavingsRatio,
          },
    avgWindow:
      k.avgWindow === null ? null : { from: k.avgWindow.from, periods: k.avgWindow.periods },
    avgCashGainCents: k.avgCashGainCents,
    avgCashGainAdjustedCents: k.avgCashGainAdjustedCents,
    avgAddedInvestmentsCents: k.avgAddedInvestmentsCents,
    avgSavingsCents: k.avgSavingsCents,
    avgSavingsRawCents: k.avgSavingsRawCents,
    predictedCashPerYearCents: k.predictedCashPerYearCents,
    yearCashGainCents: k.yearCashGainCents,
    yearSavingsCents: k.yearSavingsCents,
    yearAddedInvestmentsCents: k.yearAddedInvestmentsCents,
    yearIncomeCents: k.yearIncomeCents,
    yearPeriods: k.yearPeriods,
    yearSavingsRatio: k.yearSavingsRatio,
    yearSavingsRawRatio: k.yearSavingsRawRatio,
    last3SavingsRatio: k.last3SavingsRatio,
    trendPerMonth: k.trendPerMonth,
    trend: k.trend,
    monthsToYearEnd: k.monthsToYearEnd,
    eoyProjectedCashCents: k.eoyProjectedCashCents,
    eoyGapPerMonthCents: k.eoyGapPerMonthCents,
    eoyOnTarget: k.eoyOnTarget,
    cashTarget:
      k.cashTarget === null
        ? null
        : {
            targetCents: k.cashTarget.targetCents,
            progressRatio: k.cashTarget.progressRatio,
            monthsToTarget: k.cashTarget.monthsToTarget,
            arrival: k.cashTarget.arrival,
            status: k.cashTarget.status,
          },
    spend6mCents: k.spend6mCents,
    spend6mRawCents: k.spend6mRawCents,
    spend6mPeriods: k.spend6mPeriods,
  };
}

export function cashChartPointDto(p: CashflowChartPoint): CashChartPointDto {
  return {
    label: p.label,
    period: p.period,
    date: p.date,
    live: p.live,
    cashCents: p.cashCents,
    cashGainCents: p.cashGainCents,
    addedInvestmentsCents: p.addedInvestmentsCents,
    adjustmentCents: p.adjustmentCents,
    savingsCents: p.savingsCents,
    savingsRawCents: p.savingsRawCents,
    incomeCents: p.incomeCents,
    savingsRatio: p.savingsRatio,
    savingsRawRatio: p.savingsRawRatio,
    trendRatio: p.trendRatio,
  };
}

// ─── Goals (D55, D59) ───────────────────────────────────────────────────────────────────────────

/** A goal row merged with its engine result (a goal the engine skipped reads as not started). */
export function savingsGoalDto(
  g: SavingsGoalRow,
  r: SavingsGoalResult | undefined,
): SavingsGoalDto {
  return {
    id: g.id,
    name: g.name,
    targetCents: g.targetCents,
    targetDate: g.targetDate,
    sortOrder: g.sortOrder,
    note: g.note,
    allocatedCents: r?.allocatedCents ?? 0,
    remainingCents: r?.remainingCents ?? g.targetCents,
    progressRatio: r?.progressRatio ?? '0',
    reached: r?.reached ?? false,
    monthsToGo: r?.monthsToGo ?? null,
    eta: r?.eta ?? null,
    onTrack: r?.onTrack ?? null,
    requiredPerMonthCents: r?.requiredPerMonthCents ?? null,
  };
}

/** The goals block of the Cash page: the engine's waterfall over the stored goals. */
export function buildGoals(ctx: FinanceContext): CashPageResponse['goals'] {
  const s = ctx.data.settings;
  const summaries = INSTRUMENT_KINDS.map((k) => ctx.compute(k).summary);
  const investmentsValueCents = summaries.reduce((sum, x) => sum + x.valueCents, 0);
  const totals = ctx.cashTotals();
  const kpis = ctx.kpis();
  const result = ctx.engine.savingsGoals({
    anchor: kpis.anchor ?? ctx.asOf,
    goals: ctx.data.goals.map((g) => ({
      id: g.id,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
    })),
    goalsCashCents:
      GOALS_CASH_BASIS === 'available' ? totals.availableCashCents : totals.totalCashCents,
    emergencyFundCents: ctx.budget().invest.emergencyFundCents,
    investmentsValueCents,
    investmentShareRatio: stringSetting(s, 'goals.houseDepositInvestmentShare'),
    avgCashGainAdjustedCents: kpis.avgCashGainAdjustedCents,
    avgAddedInvestmentsCents: kpis.avgAddedInvestmentsCents,
  });
  const byId = new Map(result.goals.map((r) => [r.id, r]));
  return {
    savedCents: result.savedCents,
    monthlyProgressCents: result.monthlyProgressCents,
    investmentsValueCents,
    cashBasis: GOALS_CASH_BASIS,
    unpricedCount: summaries.reduce((sum, x) => sum + x.unpricedCount, 0),
    stalePriceCount: summaries.reduce((sum, x) => sum + x.stalePriceCount, 0),
    items: ctx.data.goals.map((g) => savingsGoalDto(g, byId.get(g.id))),
  };
}

// ─── The page ───────────────────────────────────────────────────────────────────────────────────

export function buildCashPage(ctx: FinanceContext): CashPageResponse {
  const { data } = ctx;
  const s = data.settings;
  const totals = ctx.cashTotals();
  const savings = ctx.savings();
  const adjustments = new Map(data.adjustments.map((a) => [a.periodMonth, a]));
  const spendNotes = notesByMonth(data.periodNotes, 'spend');
  const yearBasis = yearBasisOf(s);
  const unit = chartDateUnitSetting(s) ?? 'monthly';
  const count = numberSetting(s, 'charts.unitCount');
  const points = ctx.engine.compressCashflow({ periods: savings.periods, unit, count, yearBasis });

  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    lastRun: latestSnapshot(data.snapshots)?.runDate ?? null,
    accounts: cashAccountDtos(data),
    entries: sortEntriesNewestFirst(data.balanceEntries).map(balanceEntryDto),
    totals: cashTotalsDto(totals, {
      emergencyFundCents: ctx.budget().invest.emergencyFundCents,
      offsetsIncluded: offsetsIncludeEmergencyFundOf(s),
    }),
    periods: [...savings.periods].reverse().map((p) =>
      savingsPeriodDto(p, {
        adjustment: adjustments.get(p.periodMonth),
        spendNote: spendNotes.get(p.periodMonth),
      }),
    ),
    orphanAdjustments: orphanAdjustments(savings.periods, data.adjustments),
    kpis: cashKpisDto(ctx.kpis()),
    goals: buildGoals(ctx),
    charts: { unit, count, points: points.map(cashChartPointDto) },
    settings: settingsSliceDto(s, data.settingOrigins, CASH_PAGE_SETTING_KEYS),
  };
}
