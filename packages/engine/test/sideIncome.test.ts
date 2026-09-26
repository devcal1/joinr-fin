// Side income (stage-3.md §2.8, D57; §7.3 step 6). Generic streams and round amounts.
import { describe, expect, it } from 'vitest';
import { budgetInvestment, computeSideIncome, type SideIncomeInput } from '../src/index';

const deposit = (id: number, streamId: number, date: string, amountCents: number) => ({
  id,
  streamId,
  date,
  amountCents,
});

const input: SideIncomeInput = {
  asOf: '2026-09-24',
  snapshots: [
    { periodMonth: '2026-06', runDate: '2026-06-15' },
    { periodMonth: '2026-03', runDate: '2026-03-15' },
    { periodMonth: '2026-04', runDate: '2026-04-15' },
    { periodMonth: '2026-07', runDate: '2026-07-15' },
    { periodMonth: '2026-08', runDate: '2026-08-31' },
  ],
  deposits: [
    deposit(1, 1, '2026-02-20', 40_000), // before the first period
    deposit(2, 1, '2026-03-01', 10_000),
    deposit(3, 2, '2026-03-15', 5_000),
    deposit(4, 1, '2026-03-16', 20_000),
    deposit(5, 1, '2026-06-10', 30_000),
    deposit(6, 2, '2026-06-30', 2_500), // FY2025–26 by date, in a period that starts in June
    deposit(7, 1, '2026-07-10', 70_000),
    deposit(8, 1, '2026-08-12', -5_000), // a reversal
    deposit(9, 1, '2026-08-10', 17_500),
    deposit(10, 1, '2026-09-10', 20_000), // the provisional period
    deposit(11, 2, '2026-09-30', 9_000), // after asOf
  ],
};

describe('computeSideIncome (§2.8)', () => {
  const r = computeSideIncome(input);

  it("starts with the first run's calendar month and each later period the day after the last run", () => {
    expect(r.periods.map((p) => [p.periodMonth, p.start, p.end, p.status, p.totalCents])).toEqual([
      ['2026-03', '2026-03-01', '2026-03-15', 'closed', 15_000],
      ['2026-04', '2026-03-16', '2026-04-15', 'closed', 20_000],
      ['2026-06', '2026-04-16', '2026-06-15', 'closed', 30_000],
      ['2026-07', '2026-06-16', '2026-07-15', 'closed', 72_500],
      ['2026-08', '2026-07-16', '2026-08-31', 'closed', 12_500],
      ['2026-09', '2026-09-01', '2026-09-24', 'provisional', 20_000],
    ]);
  });

  it('lists each period by stream and its deposits in date order', () => {
    expect(r.periods[0]).toMatchObject({
      byStream: [
        { streamId: 1, amountCents: 10_000 },
        { streamId: 2, amountCents: 5_000 },
      ],
      depositIds: [2, 3],
    });
    expect(r.periods[4]).toMatchObject({
      byStream: [{ streamId: 1, amountCents: 12_500 }],
      depositIds: [9, 8],
    });
  });

  it('keeps deposits outside every period apart', () => {
    expect(r.beforeFirstCents).toBe(40_000);
    expect(r.afterAsOfCents).toBe(9_000);
  });

  it('averages the FY by period start and sums FY to date by deposit date (§11 fixes 5, 6)', () => {
    expect(r.fy).toEqual({ financialYear: 2026, start: '2026-07-01', end: '2027-07-01' });
    // Only the August period starts in the FY; the provisional period is left out.
    expect(r).toMatchObject({
      avgPerPeriodThisFyCents: 12_500,
      periodsThisFy: 1,
      projectedYearCents: 150_000,
    });
    // Deposits dated 10/07, 10/08, 12/08 and 10/09 (the one after asOf is not counted).
    expect(r.fyToDateCents).toBe(102_500);
  });

  it('averages the closed periods that start in the last 365 days and totals everything', () => {
    expect(r).toMatchObject({ avg365Cents: 30_000, periods365: 5, lifetimeCents: 219_000 });
    expect(r.byStreamLifetime).toEqual([
      { streamId: 1, amountCents: 202_500 },
      { streamId: 2, amountCents: 16_500 },
    ]);
  });

  it('draws the 365-day line strictly after asOf − 365 days', () => {
    const edge = computeSideIncome({
      asOf: '2026-03-16',
      snapshots: [
        { periodMonth: '2025-03', runDate: '2025-03-15' },
        { periodMonth: '2025-04', runDate: '2025-04-15' },
      ],
      deposits: [deposit(1, 1, '2025-03-20', 10_000)],
    });
    // Starts 2025-03-01 (outside) and 2025-03-16 (= asOf − 365: outside).
    expect([edge.avg365Cents, edge.periods365]).toEqual([null, 0]);
    // asOf − 365 = 2026-03-15: the period starting 2026-03-16 counts, the one from 2026-03-01 not.
    const inside = computeSideIncome({ ...input, asOf: '2027-03-15' });
    expect(inside.periods365).toBe(4);
    expect(inside.avg365Cents).toBe(33_750);
  });

  it("matches budgetInvestment's 365-day side income when fed the closed periods (§2.8)", () => {
    const closed = r.periods.filter((p) => p.status === 'closed');
    const budget = budgetInvestment({
      asOf: input.asOf,
      payFrequency: 'monthly',
      netPayCents: 0,
      includeSideIncome: true,
      sideIncomePeriods: closed.map((p) => ({
        periodStart: p.start,
        periodEnd: p.end,
        amountCents: p.totalCents,
      })),
      items: [],
      yearlyExpenseAnnualCents: [],
      autoInvestSplit: null,
      useBudgetForInvest: null,
      cashTargetRatio: null,
      aggressiveness: null,
      lastSnapshotCashShare: null,
      currentCashShare: null,
      cashCents: 0,
      emergencyFundMonths: null,
      emergencyFundOverrideCents: null,
      marginalTaxRate: null,
      lastPurchaseDate: null,
    });
    expect(budget.monthlyIncomeCents).toBe(r.avg365Cents);
  });

  it('puts every deposit before the first period when there are no snapshots', () => {
    const none = computeSideIncome({ ...input, snapshots: [] });
    expect(none.periods).toEqual([]);
    expect(none).toMatchObject({
      beforeFirstCents: 210_000,
      afterAsOfCents: 9_000,
      avgPerPeriodThisFyCents: null,
      periodsThisFy: 0,
      projectedYearCents: null,
      avg365Cents: null,
      fyToDateCents: 102_500,
      lifetimeCents: 219_000,
    });
  });

  it('has no provisional period when asOf is the last run', () => {
    const r2 = computeSideIncome({ ...input, asOf: '2026-08-31' });
    expect(r2.periods.at(-1)).toMatchObject({ status: 'closed', end: '2026-08-31' });
    expect(r2.afterAsOfCents).toBe(29_000);
  });
});
