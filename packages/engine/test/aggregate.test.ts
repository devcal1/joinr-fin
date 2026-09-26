// Snapshot aggregation and the period rule (stage-5.md §2.3, §2.7, §7.3 step 3; §11 fixes 4, 20;
// D29, D52). Generic figures only.
import { describe, expect, it } from 'vitest';
import {
  aggregateSnapshots,
  cashKpis,
  compressCashflow,
  type SnapshotFigures,
  type SnapshotSeriesRow,
} from '../src/index';
import { groupOf } from '../src/periods';
import { D, firstPeriod, ratio, savingsPeriod } from './helpers';
import { figures } from './snapshotHelpers';

const row = (
  periodMonth: string,
  runDate: string,
  over: Partial<SnapshotFigures>,
  live = false,
): SnapshotSeriesRow => ({ periodMonth, runDate, live, figures: figures(over) });

/** Apr–Jul 2026 (June recorded late on 1 July) and a live August. */
const ROWS: SnapshotSeriesRow[] = [
  row('2026-04', '2026-04-30', {
    cashValueCents: 1_000,
    cashGainCents: 100,
    stocksMovementsCents: 10,
    stocksValueCents: 500,
    stocksGainCents: 50,
    superContribCents: 5,
    salaryMonthlyCents: 1_000,
    superValueCents: 2_000,
  }),
  row('2026-05', '2026-05-31', {
    cashValueCents: 1_200,
    cashGainCents: 200,
    stocksMovementsCents: 20,
    stocksValueCents: 600,
    stocksGainCents: 60,
    superContribCents: 5,
    salaryMonthlyCents: 1_000,
    superValueCents: 2_100,
  }),
  row('2026-06', '2026-07-01', {
    cashValueCents: 1_500,
    cashGainCents: 300,
    stocksMovementsCents: 30,
    stocksValueCents: 700,
    stocksGainCents: 70,
    superContribCents: null,
    salaryMonthlyCents: 1_000,
    superValueCents: 2_200,
  }),
  row('2026-07', '2026-07-31', {
    cashValueCents: 1_400,
    cashGainCents: -100,
    stocksMovementsCents: null,
    stocksValueCents: 800,
    stocksGainCents: 80,
    superContribCents: 5,
    salaryMonthlyCents: 1_100,
    superValueCents: 2_300,
  }),
  row(
    '2026-08',
    '2026-08-20',
    {
      cashValueCents: 1_600,
      cashGainCents: 200,
      stocksMovementsCents: 40,
      stocksValueCents: 900,
      stocksGainCents: 90,
      superContribCents: 5,
      salaryMonthlyCents: 1_100,
      superValueCents: 2_400,
    },
    true,
  ),
];
// Net worth per row (B + N + Q): 3,500, 3,900, 4,400, 4,500, 4,900; liquid (B + N): 1,500, 1,800,
// 2,200, 2,200, 2,500.

const agg = (
  unit: 'monthly' | 'quarterly' | 'yearly',
  count: number | null = null,
  yearBasis: 'fy' | 'calendar' = 'fy',
) => aggregateSnapshots({ rows: ROWS, unit, count, yearBasis });

describe('aggregateSnapshots (§2.7)', () => {
  it('gives one group per month equal to its row (ratios from its own cents)', () => {
    const g = agg('monthly');
    expect(g.map((x) => [x.label, x.period, x.date, x.live, x.rows])).toEqual([
      ['Apr 2026', '2026-04', '2026-04-30', false, 1],
      ['May 2026', '2026-05', '2026-05-31', false, 1],
      ['Jun 2026', '2026-06', '2026-07-01', false, 1],
      ['Jul 2026', '2026-07', '2026-07-31', false, 1],
      ['Aug 2026', '2026-08', '2026-08-20', true, 1],
    ]);
    for (const [k, x] of g.entries()) {
      const f = ROWS[k]!.figures;
      expect(x.figures).toMatchObject({
        cashValueCents: f.cashValueCents,
        cashGainCents: f.cashGainCents,
        stocksMovementsCents: f.stocksMovementsCents,
        superContribCents: f.superContribCents,
        salaryMonthlyCents: f.salaryMonthlyCents,
      });
    }
    expect(g[0]!.figures.stocksGainRatio).toBe(ratio(D(50).div(450)));
    expect(g[0]!.figures.cashIncreaseRatio).toBe(ratio(D(100).div(900)));
    expect(g[0]!.figures.superGainRatio).toBe('0'); // no super gain: the sheet's 0
    expect(g.map((x) => [x.netWorth.netWorthCents, x.growthCents, x.liquidGrowthCents])).toEqual([
      [3_500, null, null],
      [3_900, 400, 300],
      [4_400, 500, 400],
      [4_500, 100, 0],
      [4_900, 400, 300],
    ]);
    expect(agg('monthly', 2).map((x) => x.period)).toEqual(['2026-07', '2026-08']);
  });

  it('groups calendar quarters: end values, summed flows (the cash change too), ratios from the group', () => {
    const g = agg('quarterly');
    expect(g.map((x) => [x.label, x.period, x.rows, x.live])).toEqual([
      ['Q2 2026', '2026-06', 3, false],
      ['Q3 2026', '2026-08', 2, true],
    ]);
    const q2 = g[0]!;
    expect(q2.figures).toMatchObject({
      cashValueCents: 1_500, // end
      stocksValueCents: 700,
      stocksGainCents: 70,
      superValueCents: 2_200,
      cashGainCents: 600, // sum (§11 fix 4)
      stocksMovementsCents: 60,
      superContribCents: 10, // a null month adds nothing
      salaryMonthlyCents: 3_000,
      mfMovementsCents: null, // a sum of nulls is null
      cashIncreaseRatio: ratio(D(600).div(900)), // the summed O over the end N
      stocksGainRatio: ratio(D(70).div(630)), // the end row's own ratio
    });
    expect(q2.netWorth.netWorthCents).toBe(4_400);
    expect([q2.growthCents, q2.liquidGrowthCents]).toEqual([900, 700]);
    expect(g[1]!.figures).toMatchObject({ stocksMovementsCents: 40, cashGainCents: 100 });
    expect([g[1]!.growthCents, g[1]!.liquidGrowthCents]).toEqual([500, 300]);
  });

  it('groups financial years by the period month: June recorded on 1 July stays in its FY (D29)', () => {
    const g = agg('yearly');
    expect(g.map((x) => [x.label, x.period, x.date, x.rows, x.live])).toEqual([
      ['FY2025–26', '2026-06', '2026-07-01', 3, false],
      ['FY2026–27', '2026-08', '2026-08-20', 2, true],
    ]);
    const cal = agg('yearly', null, 'calendar');
    expect(cal.map((x) => [x.label, x.rows])).toEqual([['2026', 5]]);
    expect(cal[0]!.figures.cashGainCents).toBe(700);
    expect(agg('yearly', 1).map((x) => x.label)).toEqual(['FY2026–27']);
  });

  it('keeps 12 monthly, 8 quarterly and every yearly group by default', () => {
    const many: SnapshotSeriesRow[] = [];
    for (let k = 0; k < 40; k++) {
      const y = 2020 + Math.floor(k / 12);
      const m = String((k % 12) + 1).padStart(2, '0');
      many.push(row(`${y}-${m}`, `${y}-${m}-20`, { cashValueCents: k }));
    }
    const count = (unit: 'monthly' | 'quarterly' | 'yearly') =>
      aggregateSnapshots({ rows: many, unit, count: null, yearBasis: 'calendar' }).length;
    expect(count('monthly')).toBe(12);
    expect(count('quarterly')).toBe(8);
    expect(count('yearly')).toBe(4);
    expect(aggregateSnapshots({ rows: [], unit: 'monthly', count: null, yearBasis: 'fy' })).toEqual(
      [],
    );
  });
});

describe('the period rule elsewhere (§2.3, §11 fix 20)', () => {
  it('groupOf keys years on the period month, months and quarters as before', () => {
    expect(groupOf('2026-06', '2026-07-01', 'yearly', 'fy')).toEqual({
      key: 'fy:2025',
      label: 'FY2025–26',
    });
    expect(groupOf('2026-06', '2026-07-01', 'quarterly', 'fy')).toEqual({
      key: '2026-Q2',
      label: 'Q2 2026',
    });
    expect(groupOf('2026-06', '2026-07-01', 'monthly', 'fy')).toEqual({
      key: '2026-06',
      label: 'Jun 2026',
    });
    expect(groupOf('2025-12', '2026-01-02', 'yearly', 'calendar').label).toBe('2025');
  });

  it('compressCashflow puts a June recorded on 1 July in June’s FY, quarter and month', () => {
    const june = { ...savingsPeriod('2026-07-01', { gain: 100_000 }), periodMonth: '2026-06' };
    const periods = [
      firstPeriod('2026-05-31'),
      june,
      savingsPeriod('2026-07-31', { gain: 50_000 }),
    ];
    const yearly = compressCashflow({ periods, unit: 'yearly', count: null, yearBasis: 'fy' });
    expect(yearly.map((p) => [p.label, p.period, p.savingsCents])).toEqual([
      ['FY2025–26', '2026-06', 100_000],
      ['FY2026–27', '2026-07', 50_000],
    ]);
    const quarterly = compressCashflow({
      periods,
      unit: 'quarterly',
      count: null,
      yearBasis: 'fy',
    });
    expect(quarterly.map((p) => p.label)).toEqual(['Q2 2026', 'Q3 2026']);
    const monthly = compressCashflow({ periods, unit: 'monthly', count: null, yearBasis: 'fy' });
    expect(monthly.map((p) => p.label)).toEqual(['May 2026', 'Jun 2026', 'Jul 2026']);
  });

  it('counts a June recorded on 1 July in June’s year for the year KPIs', () => {
    const june = { ...savingsPeriod('2026-07-01', { gain: 100_000 }), periodMonth: '2026-06' };
    const base = {
      asOf: '2026-07-10',
      yearBasis: 'fy' as const,
      jobStartDate: null,
      currentCashCents: 0,
      eoyCashGoalCents: null,
      cashSavingsTargetCents: null,
    };
    const k = cashKpis({ ...base, periods: [firstPeriod('2026-05-31'), june] });
    expect(k.anchor).toBe('2026-07-01'); // run dates still bound the windows
    expect(k.year).toMatchObject({ start: '2025-07-01', year: 2025 });
    expect(k.yearPeriods).toBe(1);
    expect(k.yearSavingsCents).toBe(100_000);
    // Once July is recorded, the year is July's, and June is not in it.
    const later = cashKpis({
      ...base,
      asOf: '2026-08-10',
      periods: [firstPeriod('2026-05-31'), june, savingsPeriod('2026-07-31', { gain: 50_000 })],
    });
    expect(later.year.year).toBe(2026);
    expect(later.yearPeriods).toBe(1);
    expect(later.yearSavingsCents).toBe(50_000);
  });
});
