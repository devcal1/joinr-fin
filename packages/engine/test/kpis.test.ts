// Cash KPIs (stage-3.md §2.6; §7.3 step 4). Periods are built directly with the §2.5 rules so each
// figure is easy to follow; generic round numbers only.
import { describe, expect, it } from 'vitest';
import { cashKpis, type CashKpisInput, type SavingsPeriod } from '../src/index';
import { D, firstPeriod, ratio, savingsPeriod, type Decimal } from './helpers';

const period = savingsPeriod;
const first = (runDate: string) => firstPeriod(runDate);

// Rates 0.3, 0.5 and −0.06 in Jan–Mar 2026, then a provisional April the KPIs ignore.
const periods: SavingsPeriod[] = [
  first('2025-12-31'),
  period('2026-01-31', { gain: 100_000, added: 50_000, income: 500_000 }),
  period('2026-02-28', { gain: 200_000, added: 100_000, income: 600_000 }),
  period('2026-03-31', { gain: -50_000, added: 20_000, income: 500_000 }),
  period('2026-04-20', { gain: 9_999_999, added: 0, status: 'provisional' }),
];

const input: CashKpisInput = {
  asOf: '2026-04-20',
  periods,
  yearBasis: 'calendar',
  jobStartDate: null,
  currentCashCents: 2_000_000,
  eoyCashGoalCents: 3_000_000,
  cashSavingsTargetCents: 2_500_000,
};
const kpis = (over: Partial<CashKpisInput> = {}) => cashKpis({ ...input, ...over });

/** A reference least-squares slope (per day) of (day number, rate) points. */
function slopePerDay(points: [string, string][]): Decimal {
  const xs = points.map(([d]) =>
    D(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000),
  );
  const ys = points.map(([, r]) => D(r));
  const mx = xs.reduce((a, b) => a.plus(b), D(0)).div(xs.length);
  const my = ys.reduce((a, b) => a.plus(b), D(0)).div(ys.length);
  const num = xs.reduce((a, x, i) => a.plus(x.minus(mx).times(ys[i]!.minus(my))), D(0));
  const den = xs.reduce((a, x) => a.plus(x.minus(mx).pow(2)), D(0));
  return num.div(den);
}

describe('cashKpis (§2.6)', () => {
  it('anchors on the latest recorded snapshot and averages closed periods only (§11 fix 14)', () => {
    const r = kpis();
    expect(r.anchor).toBe('2026-03-31');
    expect(r.year).toEqual({
      basis: 'calendar',
      start: '2026-01-01',
      end: '2027-01-01',
      year: 2026,
    });
    expect(r.lastPeriod).toEqual({
      periodMonth: '2026-03',
      runDate: '2026-03-31',
      cashGainCents: -50_000,
      savingsCents: -30_000,
      savingsRatio: '-0.06',
      rawSavingsRatio: '-0.06',
    });
    expect(r.avgWindow).toEqual({ from: '2025-03-31', periods: 3 });
    expect(r).toMatchObject({
      avgCashGainCents: 83_333,
      avgCashGainAdjustedCents: 83_333,
      avgAddedInvestmentsCents: 56_667,
      avgSavingsCents: 140_000,
      avgSavingsRawCents: 140_000,
    });
  });

  it('rounds the projections once from the unrounded average (C22 = C19 × 12)', () => {
    // 250,000 / 3 × 12 = 1,000,000 exactly (the rounded average × 12 would give 999,996).
    expect(kpis().predictedCashPerYearCents).toBe(1_000_000);
  });

  it('floors the averaging window at the job start date', () => {
    const r = kpis({ jobStartDate: '2026-02-15' });
    expect(r.avgWindow).toEqual({ from: '2026-02-15', periods: 2 });
    expect(r.avgCashGainCents).toBe(75_000);
    expect(kpis({ jobStartDate: '2020-01-01' }).avgWindow).toEqual({
      from: '2025-03-31',
      periods: 3,
    });
  });

  it('sums the year and weights the year rate by income (§11 fix 15)', () => {
    const r = kpis();
    expect(r).toMatchObject({
      yearCashGainCents: 250_000,
      yearSavingsCents: 420_000,
      yearAddedInvestmentsCents: 170_000,
      yearIncomeCents: 1_600_000,
      yearPeriods: 3,
      yearSavingsRatio: '0.2625',
      yearSavingsRawRatio: '0.2625',
    });
    // The sheet's simple mean would be (0.3 + 0.5 − 0.06) / 3.
    expect(r.last3SavingsRatio).toBe(ratio(D('0.74').div(3)));
  });

  it('uses the FY window by default basis and the calendar year on request (D52)', () => {
    const fy = kpis({ yearBasis: 'fy' });
    expect(fy.year).toEqual({ basis: 'fy', start: '2025-07-01', end: '2026-07-01', year: 2025 });
    expect(fy.monthsToYearEnd).toBe(3);
    expect(fy.eoyProjectedCashCents).toBe(2_250_000);
    expect(kpis().monthsToYearEnd).toBe(9);
    // A closed period before the FY start is outside the FY sums.
    const withJune = kpis({
      yearBasis: 'fy',
      periods: [
        first('2025-05-31'),
        period('2025-06-30', { gain: 1, added: 0 }),
        ...periods.slice(1),
      ],
    });
    expect(withJune.yearPeriods).toBe(3);
    expect(
      kpis({
        periods: [first('2025-05-31'), period('2025-06-30', { gain: 1 }), ...periods.slice(1)],
      }).yearPeriods,
    ).toBe(3);
  });

  it('fits the 3-month trend: slope per day × 365.25 / 12 (§11 fix 1)', () => {
    const r = kpis();
    const slope = slopePerDay([
      ['2026-01-31', '0.3'],
      ['2026-02-28', '0.5'],
      ['2026-03-31', '-0.06'],
    ]);
    expect(r.trendPerMonth).toBe(ratio(slope.times('365.25').div(12)));
    expect(r.trend).toBe('decreasing');

    // Two points: the straight line through them.
    const two = kpis({ periods: periods.slice(0, 3) });
    expect(two.trendPerMonth).toBe(ratio(D('0.2').div(28).times('365.25').div(12)));
    expect(two.trend).toBe('increasing');

    // A flat line and fewer than two points.
    const flat = kpis({
      periods: [
        first('2025-12-31'),
        period('2026-01-31', { gain: 100_000, income: 500_000 }),
        period('2026-02-28', { gain: 100_000, income: 500_000 }),
      ],
    });
    expect([flat.trendPerMonth, flat.trend]).toEqual(['0', 'flat']);
    const one = kpis({ periods: periods.slice(0, 2) });
    expect([one.trendPerMonth, one.trend, one.last3SavingsRatio]).toEqual([null, null, '0.3']);
  });

  it('has no trend when the points share one date', () => {
    const r = kpis({
      periods: [
        first('2025-12-31'),
        period('2026-01-31', { gain: 100_000 }),
        period('2026-01-31', { gain: 200_000 }),
      ],
    });
    expect([r.trendPerMonth, r.trend]).toEqual([null, null]);
    expect(r.last3SavingsRatio).toBe('0.3');
  });

  it('projects the end of year from available cash at the adjusted rate (C24, C25, C27 fixed)', () => {
    const r = kpis();
    // 9 months × 250,000 / 3 + 2,000,000; the gap divides by the 9 months left (§11 fix 2).
    expect(r.eoyProjectedCashCents).toBe(2_750_000);
    expect(r.eoyGapPerMonthCents).toBe(-27_778);
    expect(r.eoyOnTarget).toBe(false);
    expect(kpis({ eoyCashGoalCents: 2_750_000 }).eoyOnTarget).toBe(true);
    expect(kpis({ eoyCashGoalCents: null })).toMatchObject({
      eoyGapPerMonthCents: null,
      eoyOnTarget: null,
    });
  });

  it('divides the gap by at least one month at the year end', () => {
    const r = kpis({
      periods: [first('2026-11-30'), period('2026-12-31', { gain: 60_000 })],
      asOf: '2027-01-05',
    });
    expect(r.monthsToYearEnd).toBe(0);
    expect(r.eoyProjectedCashCents).toBe(2_000_000);
    expect(r.eoyGapPerMonthCents).toBe(-1_000_000);
  });

  it('moves the projections with an adjustment (D51, §11 fix 25) and with less available cash (D59)', () => {
    const adjusted = kpis({
      periods: periods.map((p) =>
        p.runDate === '2026-02-28'
          ? period('2026-02-28', {
              gain: 200_000,
              added: 100_000,
              income: 600_000,
              adjustment: 90_000,
            })
          : p,
      ),
    });
    expect(adjusted).toMatchObject({
      avgCashGainCents: 83_333,
      avgCashGainAdjustedCents: 53_333,
      avgSavingsCents: 110_000,
      avgSavingsRawCents: 140_000,
      predictedCashPerYearCents: 640_000,
      eoyProjectedCashCents: 2_480_000,
    });
    expect(adjusted.cashTarget).toMatchObject({ monthsToTarget: 10, arrival: '2027-01-31' });

    const base = kpis();
    expect(base.cashTarget).toEqual({
      targetCents: 2_500_000,
      progressRatio: '0.8',
      monthsToTarget: 6,
      arrival: '2026-09-30',
      status: 'on_track',
    });
    // Less current cash (loans you've made left out): later arrival, lower projection, same rate.
    const less = kpis({ currentCashCents: 1_500_000 });
    expect(less.avgCashGainAdjustedCents).toBe(base.avgCashGainAdjustedCents);
    expect(less.cashTarget).toMatchObject({
      monthsToTarget: 12,
      arrival: '2027-03-31',
      progressRatio: '0.6',
    });
    expect(less.eoyProjectedCashCents).toBe(2_250_000);
  });

  it('gives the cash target its three statuses, reached first even while not saving (§11 fix 24)', () => {
    expect(kpis({ currentCashCents: 3_000_000 }).cashTarget).toEqual({
      targetCents: 2_500_000,
      progressRatio: '1.2',
      monthsToTarget: null,
      arrival: null,
      status: 'reached',
    });
    const losing = [
      first('2025-12-31'),
      period('2026-01-31', { gain: -10_000 }),
      period('2026-02-28', { gain: -20_000 }),
    ];
    expect(kpis({ periods: losing, currentCashCents: 2_500_000 }).cashTarget!.status).toBe(
      'reached',
    );
    expect(kpis({ periods: losing }).cashTarget).toMatchObject({
      status: 'no_savings',
      monthsToTarget: null,
      arrival: null,
    });
    expect(kpis({ cashSavingsTargetCents: null }).cashTarget).toBeNull();
    expect(kpis({ cashSavingsTargetCents: 0 }).cashTarget).toBeNull();
  });

  it('averages the spend of closed periods in the 185 days to the anchor (Budget M4)', () => {
    const r = kpis({
      periods: [
        first('2025-08-31'),
        period('2025-09-27', { gain: 0, income: 100_000 }), // anchor − 185 days: outside
        period('2025-09-28', { gain: 0, income: 200_000 }),
        ...periods.slice(1, 4),
      ],
    });
    // Spends 200,000, 350,000, 300,000 and 530,000.
    expect(r).toMatchObject({ spend6mCents: 345_000, spend6mRawCents: 345_000, spend6mPeriods: 4 });
    const withDividends = kpis({
      periods: [
        first('2025-12-31'),
        period('2026-01-31', { gain: 100_000, income: 500_000, otherDividends: 20_000 }),
      ],
    });
    // Raw income leaves reinvested dividends out (the sheet); adjusted counts them (§11 fix 12).
    expect(withDividends).toMatchObject({ spend6mCents: 400_000, spend6mRawCents: 380_000 });
  });

  it('with no snapshots keeps only the current-cash figures', () => {
    const r = kpis({ periods: [] });
    expect(r).toMatchObject({
      anchor: null,
      year: { basis: 'calendar', start: '2026-01-01', end: '2027-01-01', year: 2026 },
      lastPeriod: null,
      avgWindow: null,
      avgCashGainCents: null,
      predictedCashPerYearCents: null,
      yearCashGainCents: 0,
      yearPeriods: 0,
      yearSavingsRatio: null,
      last3SavingsRatio: null,
      trendPerMonth: null,
      monthsToYearEnd: null,
      eoyProjectedCashCents: null,
      eoyGapPerMonthCents: null,
      eoyOnTarget: null,
      spend6mCents: null,
      spend6mPeriods: 0,
    });
    expect(r.cashTarget).toEqual({
      targetCents: 2_500_000,
      progressRatio: '0.8',
      monthsToTarget: null,
      arrival: null,
      status: 'no_savings',
    });
  });
});
