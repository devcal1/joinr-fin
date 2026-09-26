// The finance context and the engine inputs the server builds (stage-3.md §4.5 "Engine inputs
// built by the server", §7.4 step 1), row by row, on the generic seed with a FAKE engine that
// records its calls: the live salary through monthlyPayCents, the provisional super, AUD-only
// other assets, the mortgage sums, the emergency-fund-test cash to both consumers, the two D59
// constants reaching the engine and the DTO, and available cash as the KPIs' current cash while
// the savings engine's live cash stays Total Cash (the seed has a loan you've made).
import type {
  BudgetInput,
  CashKpisInput,
  EngineApi,
  SavingsGoalsInput,
  SavingsInput,
  SideIncomeInput,
} from '@joinr/engine';
import {
  cashBalanceEntries,
  cashAccounts,
  otherAssets,
  savingsAdjustments,
  savingsGoals,
  settings,
  superEntries,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCashPage } from '../../src/cashflow/cash';
import { GOALS_CASH_BASIS, LOANS_COUNT_FOR_EMERGENCY_FUND } from '../../src/cashflow/constants';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import {
  closedSideIncomePeriods,
  otherAssetPurchases,
  provisionalSuperContribCents,
} from '../../src/cashflow/inputs';
import { buildInvestmentPage } from '../../src/investments/page';
import { AS_OF, fakeEngine, fakeMarket, NOW, sideIncomeResult, type FakeEngine } from './helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

function deps(engine: EngineApi): FinanceDeps {
  return { database: t, market: fakeMarket(), engine, now: () => NOW };
}

function putSetting(key: string, value: unknown): void {
  const row = {
    key,
    valueJson: JSON.stringify(value),
    updatedAt: NOW.toISOString(),
    origin: 'import' as const,
  };
  t.db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson } })
    .run();
}

// The seed's cash (stage-3.md §3.6): everyday 5,000 + savings 20,000 (bank), an offset 10,000 and a
// loan you've made 3,000.
const TOTAL_CASH = 500000 + 2000000 + 300000;
const AVAILABLE_CASH = 500000 + 2000000;
const OFFSETS = 1000000;

const first = <T>(engine: FakeEngine, key: keyof EngineApi): T => engine.calls[key][0]![0] as T;

describe('the D59 constants', () => {
  it('are the owner-confirmed values', () => {
    expect(LOANS_COUNT_FOR_EMERGENCY_FUND).toBe(false);
    expect(GOALS_CASH_BASIS).toBe('available');
  });
});

describe('cash totals and the emergency-fund test (§2.4)', () => {
  it('passes every account with its kind, the constant and the offsets setting', () => {
    const engine = fakeEngine();
    const ctx = createFinanceContext(deps(engine));
    const totals = ctx.cashTotals();
    const input = first<Parameters<EngineApi['cashTotals']>[0]>(engine, 'cashTotals');
    expect(input.loansCountForEmergencyFund).toBe(false);
    expect(input.offsetsIncludeEmergencyFund).toBe(false);
    expect(input.accounts.map((a) => [a.kind, a.isOffset, a.balanceCents])).toEqual([
      ['bank', false, 500000],
      ['bank', false, 2000000],
      ['bank', true, OFFSETS],
      ['loan_receivable', false, 300000],
    ]);
    expect(totals.totalCashCents).toBe(TOTAL_CASH);
    expect(totals.emergencyFundTestCents).toBe(AVAILABLE_CASH);
    // Memoised: one call per request.
    ctx.cashTotals();
    expect(engine.calls.cashTotals).toHaveLength(1);
  });

  it('counts the offsets when property.offsetsIncludeEmergencyFund is on (D56)', () => {
    putSetting('property.offsetsIncludeEmergencyFund', true);
    const engine = fakeEngine();
    const totals = createFinanceContext(deps(engine)).cashTotals();
    expect(first<{ offsetsIncludeEmergencyFund: boolean }>(engine, 'cashTotals')).toMatchObject({
      offsetsIncludeEmergencyFund: true,
    });
    expect(totals.emergencyFundTestCents).toBe(AVAILABLE_CASH + OFFSETS);
  });

  it('gives the budget and consider-next the same emergency-fund-test cash; the cash class keeps loans', () => {
    const engine = fakeEngine();
    buildInvestmentPage(createFinanceContext(deps(engine)), 'etf');
    expect(first<BudgetInput>(engine, 'budgetInvestInputOf').cashCents).toBe(AVAILABLE_CASH);
    const consider = first<Parameters<EngineApi['considerNext']>[0]>(engine, 'considerNext');
    expect(consider.cashCents).toBe(AVAILABLE_CASH);
    // Net worth (the cash class, so also the cash-deficit wait) keeps the loan (D49, D59).
    expect(consider.classes.cash.valueCents).toBe(TOTAL_CASH);
    expect(
      first<Parameters<EngineApi['cashDeficitMonths']>[0]>(engine, 'cashDeficitMonths').cashCents,
    ).toBe(TOTAL_CASH);
  });
});

describe('the savings input (§2.5, §4.5)', () => {
  it('maps the snapshots, the live values, trades, other assets, deposits, dividends and adjustments', () => {
    t.db
      .insert(savingsAdjustments)
      .values({ periodMonth: '2026-07', amountCents: -25000, note: 'A refund' })
      .run();
    const engine = fakeEngine({ monthlyPayCents: () => 650000 });
    createFinanceContext(deps(engine)).savings();
    expect(engine.calls.monthlyPayCents[0]![0]).toEqual({
      netPayCents: 300000,
      payFrequency: 'fortnightly',
    });
    const input = first<SavingsInput>(engine, 'computeSavings');
    expect(input.asOf).toBe(AS_OF);
    expect(input.snapshots).toHaveLength(3);
    expect(input.snapshots[0]).toEqual({
      periodMonth: '2026-05',
      runDate: '2026-05-31',
      cashValueCents: 2500000,
      superContribCents: 20000,
      salaryMonthlyCents: 600000,
      propertyPurchaseCents: 50000000,
      mortgageBalanceCents: -40000000,
      mortgagePrincipalPaidCents: 100000,
    });
    expect(input.live).toEqual({
      // Total Cash: the savings engine keeps loans in (D59).
      cashCents: TOTAL_CASH,
      salaryMonthlyCents: 650000,
      // The 2026-09 voluntary contribution: after the latest snapshot (2026-07), not after asOf.
      superContribCents: 20000,
      propertyPurchaseCents: 50000000,
      // The mortgage only (the car loan has no property); payments paid, no interest before Stage 4.
      mortgageBalanceCents: -39800000,
      mortgagePrincipalPaidCents: 5200000,
    });
    expect(input.trades).toHaveLength(9);
    expect(input.otherAssetPurchases).toEqual([
      { date: '2023-04-01', amountCents: 150000 },
      { date: '2024-02-01', amountCents: 35000 },
    ]);
    expect(input.sideIncome).toEqual([
      { date: '2026-06-30', amountCents: 50000 },
      { date: '2026-07-31', amountCents: 75000 },
      { date: '2026-08-20', amountCents: 20000 },
    ]);
    expect(input.dividends.map((d) => d.netAmountCents)).toEqual([12000, 5000]);
    expect(input.adjustments).toEqual([{ periodMonth: '2026-07', amountCents: -25000 }]);
    expect(input.includeMortgagePrincipal).toBe(true);
  });

  it('reads includeMortgagePrincipal from the setting', () => {
    putSetting('savings.includeMortgagePrincipal', false);
    const engine = fakeEngine();
    createFinanceContext(deps(engine)).savings();
    expect(first<SavingsInput>(engine, 'computeSavings').includeMortgagePrincipal).toBe(false);
  });

  it('has no live property or mortgage figures without a property or mortgage', () => {
    t.sqlite.prepare('DELETE FROM loans').run();
    t.sqlite.prepare('DELETE FROM properties').run();
    const engine = fakeEngine();
    createFinanceContext(deps(engine)).savings();
    expect(first<SavingsInput>(engine, 'computeSavings').live).toMatchObject({
      propertyPurchaseCents: null,
      mortgageBalanceCents: null,
      mortgagePrincipalPaidCents: null,
    });
  });

  it('counts only voluntary contributions after the latest snapshot and up to the as-of month', () => {
    t.db
      .insert(superEntries)
      .values([
        { periodMonth: '2026-07', kind: 'voluntary_contribution', amountCents: 1 },
        { periodMonth: '2026-08', kind: 'voluntary_contribution', amountCents: 10 },
        { periodMonth: '2026-08', kind: 'reported_gain', amountCents: 100 },
        { periodMonth: '2026-10', kind: 'voluntary_contribution', amountCents: 1000 },
      ])
      .run();
    const ctx = createFinanceContext(deps(fakeEngine()));
    // 2026-08 (10) + the seeded 2026-09 (20000); not 2026-07 (recorded) nor 2026-10 (after asOf).
    expect(provisionalSuperContribCents(ctx.data, AS_OF)).toBe(20010);
  });

  it('values other-asset purchases (units − sold) × cost, AUD rows with a date and a cost only', () => {
    t.db
      .insert(otherAssets)
      .values([
        {
          description: 'Sold half',
          purchaseDate: '2025-01-10',
          units: '4',
          soldUnits: '2',
          currency: 'AUD',
          unitCost: '12.5',
          sortOrder: 3,
        },
        {
          description: 'Foreign',
          purchaseDate: '2025-01-10',
          units: '1',
          currency: 'USD',
          unitCost: '100',
          sortOrder: 4,
        },
        { description: 'No date', units: '1', currency: 'AUD', unitCost: '100', sortOrder: 5 },
        { description: 'No cost', purchaseDate: '2025-01-10', units: '1', sortOrder: 6 },
      ])
      .run();
    const rows = createFinanceContext(deps(fakeEngine())).data.otherAssets;
    expect(otherAssetPurchases(rows)).toEqual([
      { date: '2023-04-01', amountCents: 150000 },
      { date: '2024-02-01', amountCents: 35000 },
      { date: '2025-01-10', amountCents: 2500 },
    ]);
  });
});

describe('the KPI and goals inputs (§2.6, §2.7, D59)', () => {
  it('starts the cash goals from available cash, the goals from GOALS_CASH_BASIS, FY by default', () => {
    t.db
      .insert(savingsGoals)
      .values([
        { name: 'Holiday', targetCents: 400000, targetDate: '2027-06-30', sortOrder: 2 },
        { name: 'Buffer', targetCents: 100000, sortOrder: 1 },
      ])
      .run();
    putSetting('goals.houseDepositInvestmentShare', '0.25');
    putSetting('goals.eoyCashGoalCents', 3000000);
    putSetting('goals.cashSavingsTargetCents', 5000000);
    const engine = fakeEngine({
      cashKpis: (input) => ({
        ...fakeEngine().cashKpis(input),
        anchor: '2026-07-31',
        avgCashGainAdjustedCents: 40000,
        avgAddedInvestmentsCents: 70000,
      }),
      computeBudget: (input) => ({
        ...fakeEngine().computeBudget(input),
        invest: { ...fakeEngine().computeBudget(input).invest, emergencyFundCents: 1100000 },
      }),
    });
    const page = buildCashPage(createFinanceContext(deps(engine)));

    const kpis = first<CashKpisInput>(engine, 'cashKpis');
    expect(kpis).toMatchObject({
      asOf: AS_OF,
      yearBasis: 'fy',
      jobStartDate: '2020-01-06',
      currentCashCents: AVAILABLE_CASH,
      eoyCashGoalCents: 3000000,
      cashSavingsTargetCents: 5000000,
    });
    // The savings engine keeps Total Cash while the KPIs take available cash (D59).
    expect(first<SavingsInput>(engine, 'computeSavings').live?.cashCents).toBe(TOTAL_CASH);

    const goals = first<SavingsGoalsInput>(engine, 'savingsGoals');
    expect(goals).toEqual({
      anchor: '2026-07-31',
      // Waterfall order: sort order, then id.
      goals: [
        { id: 2, targetCents: 100000, targetDate: null },
        { id: 1, targetCents: 400000, targetDate: '2027-06-30' },
      ],
      goalsCashCents: AVAILABLE_CASH,
      emergencyFundCents: 1100000,
      investmentsValueCents: 0,
      investmentShareRatio: '0.25',
      avgCashGainAdjustedCents: 40000,
      avgAddedInvestmentsCents: 70000,
    });
    expect(page.goals.cashBasis).toBe('available');
    expect(page.totals.emergencyFund.loansIncluded).toBe(false);
    const loan = page.accounts.find((a) => a.kind === 'loan_receivable')!;
    expect(loan).toMatchObject({ inTotalCash: true, countsForEmergencyFund: false });
  });

  it('takes the calendar year when savings.yearBasis is calendar (D52)', () => {
    putSetting('savings.yearBasis', 'calendar');
    const engine = fakeEngine();
    createFinanceContext(deps(engine)).kpis();
    expect(first<CashKpisInput>(engine, 'cashKpis').yearBasis).toBe('calendar');
  });

  it('anchors the goals on the as-of date without a recorded snapshot', () => {
    const engine = fakeEngine();
    buildCashPage(createFinanceContext(deps(engine)));
    expect(first<SavingsGoalsInput>(engine, 'savingsGoals').anchor).toBe(AS_OF);
  });
});

describe('the side-income and budget inputs (§2.8, §2.9)', () => {
  it('passes the snapshots and deposits, and feeds the budget the closed periods only', () => {
    const periods = sideIncomeResult({
      periods: [
        {
          periodMonth: '2026-06',
          start: '2026-06-01',
          end: '2026-06-30',
          status: 'closed',
          totalCents: 50000,
          byStream: [],
          depositIds: [],
        },
        {
          periodMonth: '2026-09',
          start: '2026-08-01',
          end: AS_OF,
          status: 'provisional',
          totalCents: 20000,
          byStream: [],
          depositIds: [],
        },
      ],
    });
    const engine = fakeEngine({ computeSideIncome: () => periods });
    const ctx = createFinanceContext(deps(engine));
    const input = ctx.budgetInput();
    const side = first<SideIncomeInput>(engine, 'computeSideIncome');
    expect(side.snapshots.map((s) => s.periodMonth)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(side.deposits.map((d) => [d.date, d.amountCents])).toEqual([
      ['2026-06-30', 50000],
      ['2026-07-31', 75000],
      ['2026-08-20', 20000],
    ]);
    expect(input.sideIncomePeriods).toEqual([
      { periodStart: '2026-06-01', periodEnd: '2026-06-30', amountCents: 50000 },
    ]);
    expect(closedSideIncomePeriods(periods)).toEqual(input.sideIncomePeriods);
  });

  it('maps every budget row in sort order, the linked account name first, else the typed text', () => {
    const engine = fakeEngine();
    const input = createFinanceContext(deps(engine)).budgetInput();
    expect(input.rows.map((r) => [r.kind, r.name, r.accountId !== null, r.accountName])).toEqual([
      ['item', 'Rent', true, 'Example Bank – Everyday'],
      ['item', 'Groceries', true, 'Example Bank – Everyday'],
      ['item', 'Phone', false, 'Example Bank – Old'],
      ['auto_yearly', 'Yearly Expenses - Automatic', false, null],
      ['auto_invest', 'Investment Savings - Automatic', false, null],
      ['auto_cash', 'Cash Savings - Automatic', false, null],
    ]);
    expect(input.yearlyExpenses.map((y) => y.annualCents)).toEqual([80000, 120000]);
    expect(input.includeSideIncome).toBe(false);
  });

  it('uses the latest balance entry the account holds (the denormalised copy)', () => {
    // A newer entry written by the app moves the account's balance with it (D58).
    const everyday = t.db.select().from(cashAccounts).all()[0]!;
    t.db
      .insert(cashBalanceEntries)
      .values({ accountId: everyday.id, asOf: '2026-09-20', balanceCents: 510000 })
      .run();
    t.db
      .update(cashAccounts)
      .set({ balanceCents: 510000, balanceAsOf: '2026-09-20' })
      .where(eq(cashAccounts.id, everyday.id))
      .run();
    const engine = fakeEngine();
    createFinanceContext(deps(engine)).cashTotals();
    const accounts = first<Parameters<EngineApi['cashTotals']>[0]>(engine, 'cashTotals').accounts;
    expect(accounts.find((a) => a.id === everyday.id)?.balanceCents).toBe(510000);
  });
});
