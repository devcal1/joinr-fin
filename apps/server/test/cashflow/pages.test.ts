// The four page builders (stage-3.md §4.4, §7.4 step 2) on the generic seed with a FAKE engine
// that returns hand-built results: the DTOs are checked field by field, plus the server's own
// display fields (names, symbols, origins, notes, counts) and orders.
import type { EngineApi, SavingsPeriod } from '@joinr/engine';
import {
  dividendEvents,
  jobRuns,
  savingsAdjustments,
  savingsGoals,
  settings,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBudgetPage } from '../../src/cashflow/budget';
import { buildCashPage } from '../../src/cashflow/cash';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import { buildDividendsPage, publicJobError } from '../../src/cashflow/dividends';
import { buildSideIncomePage } from '../../src/cashflow/sideIncome';
import {
  AS_OF,
  budgetResult,
  emptyResult,
  fakeDividendEvents,
  fakeEngine,
  fakeMarket,
  kpisResult,
  NOW,
  savingsPeriod,
  sideIncomeResult,
  summaryResult,
} from './helpers';

let t: TestDb;
let ids: Record<string, number>;

beforeEach(() => {
  t = createTestDb();
  ids = seedGenericData(t.db, { now: NOW }).instrumentIds;
});
afterEach(() => t.close());

const id = (symbol: string): number => ids[symbol]!;

function deps(engine: EngineApi): FinanceDeps {
  return { database: t, market: fakeMarket(), engine, now: () => NOW };
}

function putSetting(key: string, value: unknown, origin: 'import' | 'app' = 'import'): void {
  const row = { key, valueJson: JSON.stringify(value), updatedAt: NOW.toISOString(), origin };
  t.db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson, origin } })
    .run();
}

// ─── Cash ───────────────────────────────────────────────────────────────────────────────────────

const PERIODS: SavingsPeriod[] = [
  savingsPeriod({
    periodMonth: '2026-05',
    runDate: '2026-05-31',
    through: '2026-05-31',
    status: 'first',
    cashCents: 2500000,
  }),
  savingsPeriod({
    periodMonth: '2026-06',
    runDate: '2026-06-30',
    after: '2026-05-31',
    through: '2026-06-30',
    status: 'closed',
    cashCents: 2550000,
    cashGainCents: 50000,
    cashGainRatio: '0.02',
    addedInvestmentsCents: 70000,
    added: {
      tradesCents: 50000,
      otherAssetsCents: 0,
      superCents: 20000,
      mortgagePrincipalCents: 0,
      propertyDepositCents: 0,
      offsetsCents: 0,
    },
    income: {
      salaryCents: 600000,
      sideIncomeCents: 50000,
      cashDividendsCents: 0,
      otherDividendsCents: 0,
    },
    adjustmentCents: 15000,
    raw: {
      incomeCents: 650000,
      savingsCents: 120000,
      savingsRatio: '0.184615384615',
      spendCents: 530000,
    },
    adjusted: {
      incomeCents: 650000,
      savingsCents: 105000,
      savingsRatio: '0.161538461538',
      spendCents: 545000,
    },
  }),
  savingsPeriod({
    periodMonth: '2026-09',
    runDate: AS_OF,
    after: '2026-07-31',
    through: AS_OF,
    status: 'provisional',
    cashCents: 2800000,
    cashGainCents: 100000,
  }),
];

describe('buildCashPage', () => {
  it('maps accounts, entries, totals, periods, orphans, KPIs, goals, charts and settings', () => {
    t.db
      .insert(savingsAdjustments)
      .values([
        { periodMonth: '2026-06', amountCents: 15000, note: 'Gift' },
        { periodMonth: '2026-05', amountCents: 5000, note: 'On the baseline' },
        { periodMonth: '2025-12', amountCents: 7000, note: 'No period' },
        // A re-import can drop a recorded month, leaving an adjustment on the provisional month.
        { periodMonth: '2026-09', amountCents: 3000, note: 'On the provisional month' },
      ])
      .run();
    t.db
      .insert(savingsGoals)
      .values({ name: 'Holiday', targetCents: 400000, targetDate: '2027-06-30', sortOrder: 1 })
      .run();
    putSetting('goals.cashSavingsTargetCents', 5000000);
    putSetting('savings.yearBasis', 'calendar', 'app');
    const kpis = kpisResult({
      anchor: '2026-07-31',
      year: { basis: 'calendar', start: '2026-01-01', end: '2027-01-01', year: 2026 },
      lastPeriod: {
        periodMonth: '2026-06',
        runDate: '2026-06-30',
        cashGainCents: 50000,
        savingsCents: 105000,
        savingsRatio: '0.161538461538',
        rawSavingsRatio: '0.184615384615',
      },
      avgWindow: { from: '2025-07-31', periods: 1 },
      avgSavingsCents: 105000,
      cashTarget: {
        targetCents: 5000000,
        progressRatio: '0.5',
        monthsToTarget: 12,
        arrival: '2027-07-31',
        status: 'on_track',
      },
      spend6mCents: 545000,
      spend6mRawCents: 530000,
      spend6mPeriods: 1,
    });
    const engine = fakeEngine({
      computeSavings: () => ({ periods: PERIODS }),
      cashKpis: () => kpis,
      computeBudget: (input) =>
        budgetResult({
          rows: fakeEngine().computeBudget(input).rows,
          invest: { ...budgetResult().invest, emergencyFundCents: 2600000 },
        }),
      computeInvestments: (input) => ({
        ...emptyResult(input.kind, input.asOf),
        summary: summaryResult({
          valueCents: input.kind === 'etf' ? 55000 : 0,
          unpricedCount: input.kind === 'stock' ? 1 : 0,
          stalePriceCount: input.kind === 'etf' ? 2 : 0,
        }),
      }),
      savingsGoals: ({ goals }) => ({
        savedCents: 123000,
        monthlyProgressCents: 45000,
        goals: goals.map((g) => ({
          id: g.id,
          allocatedCents: 123000,
          remainingCents: g.targetCents - 123000,
          progressRatio: '0.3075',
          reached: false,
          monthsToGo: 7,
          eta: '2027-02-28',
          onTrack: true,
          requiredPerMonthCents: 30000,
        })),
      }),
      compressCashflow: ({ periods, yearBasis }) =>
        periods.map((p) => ({
          label: `${p.periodMonth} ${yearBasis}`,
          period: p.periodMonth,
          date: p.runDate,
          live: p.status === 'provisional',
          cashCents: p.cashCents,
          cashGainCents: p.cashGainCents,
          addedInvestmentsCents: p.addedInvestmentsCents,
          adjustmentCents: p.adjustmentCents,
          savingsCents: p.adjusted.savingsCents,
          savingsRawCents: p.raw.savingsCents,
          incomeCents: p.adjusted.incomeCents,
          savingsRatio: p.adjusted.savingsRatio,
          savingsRawRatio: p.raw.savingsRatio,
          trendRatio: null,
        })),
    });
    const page = buildCashPage(createFinanceContext(deps(engine)));

    expect(page.asOf).toBe(AS_OF);
    expect(page.generatedAt).toBe(NOW.toISOString());
    expect(page.lastRun).toBe('2026-07-31');
    // Kind order, offsets last, then sort order.
    expect(page.accounts.map((a) => [a.kind, a.isOffset, a.name])).toEqual([
      ['bank', false, 'Example Bank – Everyday'],
      ['bank', false, 'Example Bank – Savings'],
      ['loan_receivable', false, 'Loan to a friend'],
      ['bank', true, 'Example Bank – Offset'],
    ]);
    expect(page.accounts[0]).toEqual({
      id: page.accounts[0]!.id,
      name: 'Example Bank – Everyday',
      kind: 'bank',
      isOffset: false,
      currency: 'AUD',
      balanceCents: 500000,
      balanceAsOf: '2026-08-31',
      inTotalCash: true,
      countsForEmergencyFund: true,
      note: null,
      sortOrder: 1,
      origin: 'import',
      sheetRef: 'Cash!A2',
      entryCount: 2,
      budgetRowCount: 2,
      linkedLoan: null,
    });
    expect(page.accounts[3]).toMatchObject({ inTotalCash: false, countsForEmergencyFund: false });
    // Every entry, as-of desc then id desc.
    expect(page.entries.map((e) => e.asOf)).toEqual([
      '2026-08-31',
      '2026-08-31',
      '2026-08-31',
      '2026-08-31',
      '2026-07-31',
    ]);
    expect(page.entries.at(-1)).toEqual({
      id: page.entries.at(-1)!.id,
      accountId: page.accounts[0]!.id,
      asOf: '2026-07-31',
      balanceCents: 450000,
      note: null,
      origin: 'import',
      sheetRef: 'Cash!A2',
    });
    expect(page.totals).toEqual({
      totalCashCents: 2800000,
      byKind: { bank: 2500000, credit_card: 0, loan_receivable: 300000, other: 0 },
      offsetCents: 1000000,
      loansCents: 300000,
      availableCashCents: 2500000,
      emergencyFundTestCents: 2500000,
      emergencyFund: {
        targetCents: 2600000,
        covered: false,
        shortfallCents: 100000,
        offsetsIncluded: false,
        loansIncluded: false,
      },
    });
    // Newest first; the adjustment and spend note attach by month; the baseline takes none.
    expect(page.periods.map((p) => [p.periodMonth, p.status])).toEqual([
      ['2026-09', 'provisional'],
      ['2026-06', 'closed'],
      ['2026-05', 'first'],
    ]);
    expect(page.periods[1]).toEqual({
      periodMonth: '2026-06',
      runDate: '2026-06-30',
      after: '2026-05-31',
      through: '2026-06-30',
      status: 'closed',
      cashCents: 2550000,
      cashGainCents: 50000,
      cashGainRatio: '0.02',
      addedInvestmentsCents: 70000,
      added: {
        tradesCents: 50000,
        otherAssetsCents: 0,
        superCents: 20000,
        mortgagePrincipalCents: 0,
        propertyDepositCents: 0,
        offsetsCents: 0,
      },
      income: {
        salaryCents: 600000,
        sideIncomeCents: 50000,
        cashDividendsCents: 0,
        otherDividendsCents: 0,
      },
      adjustment: { periodMonth: '2026-06', amountCents: 15000, note: 'Gift' },
      raw: {
        incomeCents: 650000,
        savingsCents: 120000,
        savingsRatio: '0.184615384615',
        spendCents: 530000,
      },
      adjusted: {
        incomeCents: 650000,
        savingsCents: 105000,
        savingsRatio: '0.161538461538',
        spendCents: 545000,
      },
      spendNote: null,
    });
    expect(page.periods[2]!.adjustment).toBeNull();
    // Closed periods only: the provisional period takes none either (the engine ignores it).
    expect(page.periods[0]!.adjustment).toBeNull();
    // The seeded spend note is for 2026-07 (no period in these results).
    expect(page.periods.every((p) => p.spendNote === null)).toBe(true);
    expect(page.orphanAdjustments).toEqual([
      { periodMonth: '2025-12', amountCents: 7000, note: 'No period' },
      { periodMonth: '2026-05', amountCents: 5000, note: 'On the baseline' },
      { periodMonth: '2026-09', amountCents: 3000, note: 'On the provisional month' },
    ]);
    expect(page.kpis).toEqual(kpis);
    expect(page.goals).toEqual({
      savedCents: 123000,
      monthlyProgressCents: 45000,
      investmentsValueCents: 55000,
      cashBasis: 'available',
      unpricedCount: 1,
      stalePriceCount: 2,
      items: [
        {
          id: 1,
          name: 'Holiday',
          targetCents: 400000,
          targetDate: '2027-06-30',
          sortOrder: 1,
          note: null,
          allocatedCents: 123000,
          remainingCents: 277000,
          progressRatio: '0.3075',
          reached: false,
          monthsToGo: 7,
          eta: '2027-02-28',
          onTrack: true,
          requiredPerMonthCents: 30000,
        },
      ],
    });
    expect(page.charts.unit).toBe('monthly');
    expect(page.charts.count).toBeNull();
    expect(page.charts.points.map((p) => p.label)).toEqual([
      '2026-05 calendar',
      '2026-06 calendar',
      '2026-09 calendar',
    ]);
    expect(page.charts.points[1]).toEqual({
      label: '2026-06 calendar',
      period: '2026-06',
      date: '2026-06-30',
      live: false,
      cashCents: 2550000,
      cashGainCents: 50000,
      addedInvestmentsCents: 70000,
      adjustmentCents: 15000,
      savingsCents: 105000,
      savingsRawCents: 120000,
      incomeCents: 650000,
      savingsRatio: '0.161538461538',
      savingsRawRatio: '0.184615384615',
      trendRatio: null,
    });
    expect(page.settings).toEqual({
      values: {
        'goals.cashSavingsTargetCents': 5000000,
        'goals.eoyCashGoalCents': null,
        'goals.houseDepositInvestmentShare': null,
        'savings.includeMortgagePrincipal': null,
        'savings.yearBasis': 'calendar',
        'property.offsetsIncludeEmergencyFund': null,
      },
      origins: {
        'goals.cashSavingsTargetCents': 'import',
        'goals.eoyCashGoalCents': null,
        'goals.houseDepositInvestmentShare': null,
        'savings.includeMortgagePrincipal': null,
        'savings.yearBasis': 'app',
        'property.offsetsIncludeEmergencyFund': null,
      },
    });
    // Stage 4: the provisional period's parts come from the live engines (always false).
    expect(page.staticUntilStage4).toBe(false);
  });

  it('attaches the spend note of a recorded month', () => {
    const engine = fakeEngine({
      computeSavings: () => ({
        periods: [savingsPeriod({ periodMonth: '2026-07', runDate: '2026-07-31' })],
      }),
    });
    const page = buildCashPage(createFinanceContext(deps(engine)));
    expect(page.periods[0]!.spendNote).toEqual({
      periodMonth: '2026-07',
      kind: 'spend',
      note: 'Car service',
      origin: 'import',
      sheetRef: 'Cash!Q3',
    });
  });

  it('has no emergency-fund verdict without a target', () => {
    const page = buildCashPage(createFinanceContext(deps(fakeEngine())));
    expect(page.totals.emergencyFund).toEqual({
      targetCents: null,
      covered: null,
      shortfallCents: null,
      offsetsIncluded: false,
      loansIncluded: false,
    });
  });
});

// ─── Side income ────────────────────────────────────────────────────────────────────────────────

describe('buildSideIncomePage', () => {
  it('maps streams, deposits (with their periods), periods, KPIs, the chart and the budget line', () => {
    const [d1, d2, d3] = [1, 2, 3];
    const result = sideIncomeResult({
      periods: [
        {
          periodMonth: '2026-06',
          start: '2026-06-01',
          end: '2026-06-30',
          status: 'closed',
          totalCents: 50000,
          byStream: [{ streamId: 1, amountCents: 50000 }],
          depositIds: [d1],
        },
        {
          periodMonth: '2026-07',
          start: '2026-07-01',
          end: '2026-07-31',
          status: 'closed',
          totalCents: 75000,
          byStream: [{ streamId: 1, amountCents: 75000 }],
          depositIds: [d2],
        },
        {
          periodMonth: '2026-09',
          start: '2026-08-01',
          end: AS_OF,
          status: 'provisional',
          totalCents: 20000,
          byStream: [{ streamId: 2, amountCents: 20000 }],
          depositIds: [d3],
        },
      ],
      beforeFirstCents: 0,
      afterAsOfCents: 0,
      fy: { financialYear: 2026, start: '2026-07-01', end: '2027-07-01' },
      avgPerPeriodThisFyCents: 75000,
      periodsThisFy: 1,
      fyToDateCents: 95000,
      projectedYearCents: 900000,
      avg365Cents: 62500,
      periods365: 2,
      lifetimeCents: 145000,
      byStreamLifetime: [
        { streamId: 1, amountCents: 125000 },
        { streamId: 2, amountCents: 20000 },
      ],
    });
    putSetting('budget.includeSideIncome', true);
    const engine = fakeEngine({ computeSideIncome: () => result });
    const page = buildSideIncomePage(createFinanceContext(deps(engine)));

    expect(page.lastRun).toBe('2026-07-31');
    expect(page.streams).toEqual([
      {
        id: 1,
        name: 'Side income 1',
        sortOrder: 1,
        archived: false,
        origin: 'import',
        sheetRef: 'Side Income!G1',
        depositCount: 2,
        lifetimeCents: 125000,
      },
      {
        id: 2,
        name: 'Side income 2',
        sortOrder: 2,
        archived: false,
        origin: 'import',
        sheetRef: 'Side Income!H1',
        depositCount: 1,
        lifetimeCents: 20000,
      },
    ]);
    // Newest first.
    expect(page.deposits.map((d) => [d.date, d.periodMonth, d.provisional])).toEqual([
      ['2026-08-20', '2026-09', true],
      ['2026-07-31', '2026-07', false],
      ['2026-06-30', '2026-06', false],
    ]);
    expect(page.deposits[0]).toEqual({
      id: d3,
      streamId: 2,
      streamName: 'Side income 2',
      date: '2026-08-20',
      amountCents: 20000,
      note: null,
      origin: 'import',
      sheetRef: 'Side Income!H4',
      periodMonth: '2026-09',
      provisional: true,
    });
    expect(page.periods.map((p) => p.periodMonth)).toEqual(['2026-09', '2026-07', '2026-06']);
    expect(page.periods[1]).toEqual({
      periodMonth: '2026-07',
      start: '2026-07-01',
      end: '2026-07-31',
      status: 'closed',
      totalCents: 75000,
      byStream: [{ streamId: 1, amountCents: 75000 }],
      note: {
        periodMonth: '2026-07',
        kind: 'side_income',
        note: 'One-off consulting job',
        origin: 'import',
        sheetRef: 'Side Income!J3',
      },
    });
    expect(page.outside).toEqual({ beforeFirstCents: 0, afterAsOfCents: 0 });
    expect(page.kpis).toEqual({
      financialYear: 2026,
      fyStart: '2026-07-01',
      fyEnd: '2027-07-01',
      avgPerPeriodThisFyCents: 75000,
      periodsThisFy: 1,
      fyToDateCents: 95000,
      projectedYearCents: 900000,
      avg365Cents: 62500,
      periods365: 2,
      lifetimeCents: 145000,
    });
    // The fake compressSeries passes points through: one per period, every stream keyed.
    expect(engine.calls.compressSeries[0]![4]).toBe('fy');
    expect(page.charts.points).toEqual([
      {
        label: '2026-06',
        period: '2026-06',
        date: '2026-06-30',
        live: false,
        byStream: { '1': 50000, '2': 0 },
        totalCents: 50000,
      },
      {
        label: '2026-07',
        period: '2026-07',
        date: '2026-07-31',
        live: false,
        byStream: { '1': 75000, '2': 0 },
        totalCents: 75000,
      },
      {
        label: '2026-09',
        period: '2026-09',
        date: AS_OF,
        live: true,
        byStream: { '1': 0, '2': 20000 },
        totalCents: 20000,
      },
    ]);
    expect(page.budget).toEqual({ includeSideIncome: true, avg365Cents: 62500 });
  });

  it('marks deposits outside every period with no period', () => {
    const page = buildSideIncomePage(createFinanceContext(deps(fakeEngine())));
    expect(page.deposits.every((d) => d.periodMonth === null && !d.provisional)).toBe(true);
    expect(page.budget).toEqual({ includeSideIncome: false, avg365Cents: null });
  });
});

// ─── Budget ─────────────────────────────────────────────────────────────────────────────────────

describe('buildBudgetPage', () => {
  it('maps the summary, rows (stored fields and a missing auto row), transfers and actual spend', () => {
    putSetting('allocation.cash', '0.15');
    putSetting('investing.allocationAggressiveness', 'normal');
    const engine = fakeEngine({
      computeBudget: (input) => {
        const base = fakeEngine().computeBudget(input);
        return budgetResult({
          invest: {
            monthlyIncomeCents: 650000,
            yearlyFundCents: 17000,
            plannedSpendCents: 282000,
            leftoverCents: 368000,
            emergencyFundCents: 3000000,
            cashShareRatio: '0.3',
            investShareRatio: '0.7',
            investmentRowCents: 257600,
            cashRowCents: 110400,
            sideIncomeInvestCents: 0,
            monthlyInvestCents: 257600,
            missing: ['tax.marginalRate'],
          },
          annualIncomeCents: 7800000,
          yearlySavingsCents: 4416000,
          plannedSavingsRatio: '0.566153846154',
          unallocatedCents: 0,
          emergencyFundBasisCents: 282000,
          rows: [
            ...base.rows.map((r, i) => ({
              ...r,
              weeklyCents: i,
              yearlyCents: 12 * r.monthlyCents,
            })),
            {
              id: null,
              kind: 'auto_invest' as const,
              name: null,
              monthlyCents: 257600,
              incomeShareRatio: null,
              weeklyCents: 0,
              yearlyCents: 0,
              category: null,
              accountId: null,
              accountName: null,
              savingsLine: false,
              derived: true,
              manual: false,
            },
          ],
          yearlyExpenses: input.yearlyExpenses.map((y) => ({
            ...y,
            monthlyCents: Math.round(y.annualCents / 12),
          })),
          transfers: [
            {
              accountId: base.rows[0]!.accountId,
              accountName: 'Example Bank – Everyday',
              perPayCents: 120000,
              monthlyCents: 260000,
              rows: 2,
            },
            {
              accountId: null,
              accountName: 'Example Bank – Old',
              perPayCents: 2300,
              monthlyCents: 5000,
              rows: 1,
            },
          ],
          unassigned: { perPayCents: 100, monthlyCents: 200, rows: 1 },
          perPayTotalCents: 122400,
          byCategory: [{ category: 'Housing', monthlyCents: 200000 }],
          investManual: false,
        });
      },
      cashKpis: () =>
        kpisResult({ spend6mCents: 400000, spend6mRawCents: 390000, spend6mPeriods: 2 }),
      computeSideIncome: () => sideIncomeResult({ avg365Cents: 30000 }),
    });
    const page = buildBudgetPage(createFinanceContext(deps(engine)));

    expect(page.summary).toEqual({
      payFrequency: 'fortnightly',
      netPayCents: 300000,
      monthlyIncomeCents: 650000,
      annualIncomeCents: 7800000,
      sideIncomeIncluded: false,
      sideIncomeAvgCents: 30000,
      yearlyFundCents: 17000,
      plannedSpendCents: 282000,
      leftoverCents: 368000,
      yearlySavingsCents: 4416000,
      emergencyFundCents: 3000000,
      emergencyFundBasisCents: 282000,
      // The EF-test cash (2,500,000: available cash) is below 3,000,000.
      belowEmergencyFund: true,
      cashShareRatio: '0.3',
      investShareRatio: '0.7',
      investmentRowCents: 257600,
      cashRowCents: 110400,
      investManual: false,
      unallocatedCents: 0,
      plannedSavingsRatio: '0.566153846154',
      cashTargetRatio: '0.15',
      aggressiveness: 'normal',
      monthlyInvestCents: 257600,
      sideIncomeInvestCents: 0,
    });
    expect(page.rows).toHaveLength(7);
    const everyday = page.accounts.find((a) => a.name === 'Example Bank – Everyday')!;
    expect(page.rows[0]).toEqual({
      id: page.rows[0]!.id,
      kind: 'item',
      name: 'Rent',
      storedMonthlyCents: 200000,
      monthlyCents: 200000,
      incomeShareRatio: null,
      weeklyCents: 0,
      yearlyCents: 2400000,
      category: 'Housing',
      accountId: everyday.id,
      accountName: 'Example Bank – Everyday',
      accountLinked: true,
      savingsLine: false,
      derived: false,
      manual: false,
      flags: [],
      sortOrder: 1,
      origin: 'import',
      sheetRef: 'Budget!A8',
    });
    // The unlinked row keeps its typed name and stored review flag.
    expect(page.rows[2]).toMatchObject({
      name: 'Phone',
      accountId: null,
      accountName: 'Example Bank – Old',
      accountLinked: false,
      flags: ['unmatched_account'],
    });
    // A missing auto row has no stored fields.
    expect(page.rows[6]).toMatchObject({
      id: null,
      storedMonthlyCents: null,
      flags: [],
      sortOrder: null,
      origin: null,
      sheetRef: null,
    });
    expect(page.yearlyExpenses).toEqual([
      {
        id: 1,
        name: 'Car registration',
        annualCents: 80000,
        monthlyCents: 6667,
        sortOrder: 1,
        origin: 'import',
        sheetRef: 'Budget!E32',
      },
      {
        id: 2,
        name: 'Insurance',
        annualCents: 120000,
        monthlyCents: 10000,
        sortOrder: 2,
        origin: 'import',
        sheetRef: 'Budget!E33',
      },
    ]);
    expect(page.transfers).toEqual([
      {
        accountId: everyday.id,
        accountName: 'Example Bank – Everyday',
        linked: true,
        perPayCents: 120000,
        monthlyCents: 260000,
        rows: 2,
      },
      {
        accountId: null,
        accountName: 'Example Bank – Old',
        linked: false,
        perPayCents: 2300,
        monthlyCents: 5000,
        rows: 1,
      },
    ]);
    expect(page.unassigned).toEqual({ perPayCents: 100, monthlyCents: 200, rows: 1 });
    expect(page.perPayTotalCents).toBe(122400);
    expect(page.byCategory).toEqual([{ category: 'Housing', monthlyCents: 200000 }]);
    expect(page.actual).toEqual({
      plannedCents: 282000,
      actualCents: 400000,
      actualRawCents: 390000,
      periods: 2,
    });
    // Every account, the Cash page order (offsets last).
    expect(page.accounts.map((a) => a.kind)).toEqual(['bank', 'bank', 'loan_receivable', 'bank']);
    expect(Object.keys(page.settings.values)).toEqual([
      'pay.frequency',
      'pay.netPayCents',
      'pay.dayOfMonth',
      'pay.jobStartDate',
      'budget.includeSideIncome',
      'budget.emergencyFundMonths',
      'budget.emergencyFundOverrideCents',
      'budget.autoInvestSplit',
      'budget.useForInvestAmount',
    ]);
    expect(page.settings.values['pay.frequency']).toBe('fortnightly');
    expect(page.settings.origins['pay.frequency']).toBe('import');
    expect(page.settings.origins['budget.emergencyFundMonths']).toBeNull();
    expect(page.missing).toEqual(['tax.marginalRate']);
  });
});

// ─── Dividends ──────────────────────────────────────────────────────────────────────────────────

describe('buildDividendsPage', () => {
  it('maps the ledger, summaries, holdings, suggestions and the events status', () => {
    const xyz = id('ASX:XYZ');
    t.db
      .insert(dividendEvents)
      .values([
        {
          instrumentId: xyz,
          exDate: '2026-09-01',
          amountPerUnit: '1.35',
          currency: 'AUD',
          closeBeforeEx: '105.2',
          closeDate: '2026-08-31',
          source: 'fake',
          fetchedAt: NOW.toISOString(),
        },
        {
          instrumentId: xyz,
          exDate: '2026-03-02',
          amountPerUnit: '0.3',
          currency: 'AUD',
          closeBeforeEx: null,
          closeDate: null,
          source: 'fake',
          fetchedAt: NOW.toISOString(),
          dismissedAt: NOW.toISOString(),
        },
      ])
      .run();
    t.db
      .insert(jobRuns)
      .values({
        job: 'dividends',
        trigger: 'manual',
        startedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        status: 'partial',
        error: 'Rate limited at https://example.com/v8/finance/chart/XYZ.AX?x=1 — stopped',
      })
      .run();
    const zeros = { stock: 0, etf: 0, managed_fund: 0, crypto: 0 };
    const engine = fakeEngine({
      computeDividends: ({ dividends }) => ({
        rows: dividends.map((d) => ({
          dividendId: d.id,
          instrumentId: d.instrumentId,
          unitsAtEx: d.instrumentId === null ? null : '30',
          yieldRatio: d.instrumentId === null ? null : '0.04',
        })),
        byFinancialYear: [
          { financialYear: 2026, byKind: { ...zeros, etf: 5000 }, totalCents: 5000 },
        ],
        rolling12: [{ month: '2026-09', byKind: zeros, totalCents: 0 }],
        holdingsThisFy: [
          {
            instrumentId: xyz,
            kind: 'etf',
            netThisFyCents: 12000,
            payments: 1,
            frequencyMonths: 6,
            drp: false,
            yield365Ratio: '0.08',
            monthsToExtraUnit: 5,
            advice: 'switch_on',
          },
        ],
        unlinkedThisFyCents: 5000,
        kpis: {
          financialYear: 2026,
          thisFyCents: 5000,
          lastFyCents: 12000,
          allTimeCents: 17000,
          rolling12Cents: 17000,
          reinvestedThisFyCents: 0,
          daysIntoFy: 86,
          projectedFyCents: 21235,
        },
      }),
      dividendSuggestions: ({ events }) =>
        events.map((e) => ({
          instrumentId: e.instrumentId,
          exDate: e.exDate,
          amountPerUnit: e.amountPerUnit,
          unitsAtEx: '30',
          estimatedNetCents: 4050,
          priceAtEx: e.closeBeforeEx,
          yieldRatio: null,
          expectedPaymentDate: '2026-09-15',
          status: e.dismissed ? 'dismissed' : 'due',
        })),
    });
    const service = fakeDividendEvents({
      mode: 'fake',
      lastRefreshAt: '2026-09-24T01:00:00.000Z',
    });
    const page = buildDividendsPage(createFinanceContext(deps(engine)), service);

    // Payment date desc, then id desc.
    expect(page.dividends.map((d) => d.paymentDate)).toEqual(['2025-08-15', '2025-07-15']);
    expect(page.dividends[1]).toEqual({
      id: 1,
      instrumentId: xyz,
      symbol: 'ASX:XYZ',
      ticker: 'XYZ',
      holdingKind: 'etf',
      paymentDate: '2025-07-15',
      exDate: '2025-06-30',
      reinvested: false,
      netAmountCents: 12000,
      priceAtEx: '100',
      priceAtExManual: false,
      unitsAtEx: '30',
      yieldRatio: '0.04',
      financialYear: 2025,
      flags: [],
      note: null,
      origin: 'import',
      sheetRef: 'Dividends!A4',
    });
    expect(page.dividends[0]).toMatchObject({
      instrumentId: null,
      symbol: null,
      ticker: 'ZZZ',
      unitsAtEx: null,
      flags: ['unmatched_ticker'],
    });
    expect(page.kpis).toEqual({
      financialYear: 2026,
      thisFyCents: 5000,
      lastFyCents: 12000,
      allTimeCents: 17000,
      rolling12Cents: 17000,
      reinvestedThisFyCents: 0,
      daysIntoFy: 86,
      projectedFyCents: 21235,
    });
    expect(page.byFinancialYear).toEqual([
      { financialYear: 2026, byKind: { ...zeros, etf: 5000 }, totalCents: 5000 },
    ]);
    expect(page.rolling12).toEqual([{ month: '2026-09', byKind: zeros, totalCents: 0 }]);
    expect(page.holdingsThisFy).toEqual([
      {
        instrumentId: xyz,
        symbol: 'ASX:XYZ',
        kind: 'etf',
        netThisFyCents: 12000,
        payments: 1,
        frequencyMonths: 6,
        drp: false,
        yield365Ratio: '0.08',
        monthsToExtraUnit: 5,
        advice: 'switch_on',
      },
    ]);
    expect(page.unlinkedThisFyCents).toBe(5000);
    expect(page.suggestions).toEqual([
      {
        instrumentId: xyz,
        symbol: 'ASX:XYZ',
        kind: 'etf',
        exDate: '2026-03-02',
        amountPerUnit: '0.3',
        currency: 'AUD',
        unitsAtEx: '30',
        estimatedNetCents: 4050,
        priceAtEx: null,
        yieldRatio: null,
        expectedPaymentDate: '2026-09-15',
        status: 'dismissed',
        reinvestedDefault: false,
      },
      expect.objectContaining({
        exDate: '2026-09-01',
        status: 'due',
        priceAtEx: '105.2',
      }) as unknown,
    ]);
    expect(page.events).toEqual({
      mode: 'fake',
      running: false,
      lastRefreshAt: '2026-09-24T01:00:00.000Z',
      nextRefreshAt: null,
      eventCount: 2,
      instrumentsCovered: 1,
      lastError: 'Rate limited at — stopped',
    });
    // Kind order (stock, ETF, managed fund, crypto), then id.
    expect(page.holdings.map((h) => h.symbol)).toEqual([
      'ASX:ABC',
      'ASX:OLD',
      'ASX:XYZ',
      'ASX:DEF',
      'EXAMPLEFUND',
      'EXAMPLEFUND2',
      'BTC',
      'ETH',
    ]);
    expect(page.holdings[2]).toEqual({
      instrumentId: xyz,
      symbol: 'ASX:XYZ',
      kind: 'etf',
      drp: false,
      dividendFreqMonths: 6,
    });
    // The holdings' units come from the investment engine's held units.
    const input = engine.calls.computeDividends[0]![0] as { holdings: { unitsNow: string }[] };
    expect(input.holdings).toHaveLength(8);
  });

  it('keeps job errors short and free of links', () => {
    expect(publicJobError(null)).toBeNull();
    expect(publicJobError('https://example.com/a?b=c')).toBeNull();
    expect(publicJobError('Timed out at http://x.test/y  and  more')).toBe('Timed out at and more');
    const long = publicJobError('x'.repeat(500))!;
    expect(long.length).toBeLessThanOrEqual(200);
  });
});
