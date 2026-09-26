// Chart series (stage-3.md §2.13; §7.3 step 9): compressCashflow and compressSeries with a year
// basis (D52). Generic periods only.
import { describe, expect, it } from 'vitest';
import { cashKpis, compressCashflow, compressSeries, type SeriesPoint } from '../src/index';
import { D, firstPeriod, ratio, savingsPeriod } from './helpers';

// May–Sep 2025 recorded (May the baseline), October provisional. Adjusted rates: Jun 0.15,
// Jul 0.25 (a 5,000 adjustment), Aug 0.2 (20,000 of reinvested dividends), Sep 0.3.
const periods = [
  firstPeriod('2025-05-31', 1_000_000),
  savingsPeriod('2025-06-30', { cash: 1_010_000, gain: 10_000, added: 5_000, income: 100_000 }),
  savingsPeriod('2025-07-31', {
    cash: 1_030_000,
    gain: 20_000,
    added: 10_000,
    income: 100_000,
    adjustment: 5_000,
  }),
  savingsPeriod('2025-08-31', {
    cash: 1_020_000,
    gain: -10_000,
    added: 50_000,
    income: 200_000,
    otherDividends: 20_000,
  }),
  savingsPeriod('2025-09-30', { cash: 1_050_000, gain: 30_000, added: 0, income: 100_000 }),
  savingsPeriod('2025-10-20', {
    cash: 1_060_000,
    gain: 10_000,
    added: 0,
    income: 50_000,
    status: 'provisional',
  }),
];
const chart = (
  unit: 'monthly' | 'quarterly' | 'yearly',
  yearBasis: 'fy' | 'calendar' = 'fy',
  count: number | null = null,
) => compressCashflow({ periods, unit, count, yearBasis });

describe('compressCashflow (§2.13)', () => {
  it('gives one point per month; the baseline has cash only; the last point is live', () => {
    const m = chart('monthly');
    expect(m.map((p) => [p.label, p.period, p.date, p.live])).toEqual([
      ['May 2025', '2025-05', '2025-05-31', false],
      ['Jun 2025', '2025-06', '2025-06-30', false],
      ['Jul 2025', '2025-07', '2025-07-31', false],
      ['Aug 2025', '2025-08', '2025-08-31', false],
      ['Sep 2025', '2025-09', '2025-09-30', false],
      ['Oct 2025', '2025-10', '2025-10-20', true],
    ]);
    expect(m[0]).toMatchObject({
      cashCents: 1_000_000,
      cashGainCents: null,
      addedInvestmentsCents: null,
      adjustmentCents: 0,
      savingsCents: null,
      incomeCents: null,
      savingsRatio: null,
      trendRatio: null,
    });
    expect(m[2]).toMatchObject({
      cashCents: 1_030_000,
      cashGainCents: 20_000,
      addedInvestmentsCents: 10_000,
      adjustmentCents: 5_000,
      savingsCents: 25_000,
      savingsRawCents: 30_000,
      incomeCents: 100_000,
      savingsRatio: '0.25',
      savingsRawRatio: '0.3',
    });
    // Reinvested dividends are income in the adjusted rate only (§11 fix 12).
    expect(m[3]).toMatchObject({
      incomeCents: 200_000,
      savingsRatio: '0.2',
      savingsRawRatio: ratio(D(40_000).div(180_000)),
    });
  });

  it('draws the 3-period trend line at its closed periods, as cashKpis fits it (monthly only)', () => {
    const m = chart('monthly');
    const kpis = cashKpis({
      asOf: '2025-10-20',
      periods,
      yearBasis: 'fy',
      jobStartDate: null,
      currentCashCents: 0,
      eoyCashGoalCents: null,
      cashSavingsTargetCents: null,
    });
    const fitted = m.map((p) => p.trendRatio);
    expect(fitted.map((f) => f !== null)).toEqual([false, false, true, true, true, false]);
    // The fitted line has the KPI's slope: (fit(Sep) − fit(Jul)) / 61 days × 365.25 / 12.
    const slope = D(fitted[4]!).minus(fitted[2]!).div(61).times('365.25').div(12);
    expect(Number(slope)).toBeCloseTo(Number(kpis.trendPerMonth), 10);
    // Its mean over the three points is the 3-period mean rate (C39).
    const mean = D(fitted[2]!).plus(fitted[3]!).plus(fitted[4]!).div(3);
    expect(Number(mean)).toBeCloseTo(Number(kpis.last3SavingsRatio), 10);
    expect(chart('quarterly').every((p) => p.trendRatio === null)).toBe(true);
  });

  it('groups calendar quarters: cash at the end, flows summed, rates income-weighted', () => {
    const q = chart('quarterly');
    expect(q.map((p) => [p.label, p.period, p.live])).toEqual([
      ['Q2 2025', '2025-06', false],
      ['Q3 2025', '2025-09', false],
      ['Q4 2025', '2025-10', true],
    ]);
    expect(q[1]).toMatchObject({
      cashCents: 1_050_000,
      cashGainCents: 40_000,
      addedInvestmentsCents: 60_000,
      adjustmentCents: 5_000,
      savingsCents: 95_000,
      savingsRawCents: 100_000,
      incomeCents: 400_000,
      savingsRatio: '0.2375',
      savingsRawRatio: ratio(D(100_000).div(380_000)),
    });
    expect(q[0]).toMatchObject({
      cashCents: 1_010_000,
      cashGainCents: 10_000,
      savingsRatio: '0.15',
    });
  });

  it('groups years on the year basis: FY2024–25 or the calendar year (D52)', () => {
    const fy = chart('yearly', 'fy');
    expect(fy.map((p) => [p.label, p.period, p.live])).toEqual([
      ['FY2024–25', '2025-06', false],
      ['FY2025–26', '2025-10', true],
    ]);
    expect(fy[1]).toMatchObject({
      cashCents: 1_060_000,
      cashGainCents: 50_000,
      savingsCents: 105_000,
    });
    expect(chart('yearly', 'calendar').map((p) => [p.label, p.live])).toEqual([['2025', true]]);
  });

  it('keeps the last `count` groups (null → 12 monthly, 8 quarterly, all yearly)', () => {
    expect(chart('monthly', 'fy', 2).map((p) => p.label)).toEqual(['Sep 2025', 'Oct 2025']);
    expect(chart('monthly', 'fy', 0)).toEqual([]);
    expect(chart('yearly', 'fy', null)).toHaveLength(2);
  });
});

describe('compressSeries with a year basis (§2.13)', () => {
  const point = (date: string, v: number): SeriesPoint => ({
    period: date.slice(0, 7),
    date,
    live: false,
    values: { value: v, net: v },
  });
  const points = [
    point('2025-06-30', 1),
    point('2025-07-31', 2),
    point('2026-06-30', 3),
    point('2026-07-31', 4),
  ];
  const modes = { value: 'end', net: 'sum' } as const;

  it('groups financial years and labels them FY2025–26', () => {
    const out = compressSeries(points, 'yearly', null, modes, 'fy');
    expect(out.map((p) => [p.label, p.values])).toEqual([
      ['FY2024–25', { value: 1, net: 1 }],
      ['FY2025–26', { value: 3, net: 5 }],
      ['FY2026–27', { value: 4, net: 4 }],
    ]);
  });

  it('keeps the calendar year without the argument (the Stage 2 behaviour)', () => {
    const calendar = compressSeries(points, 'yearly', null, modes);
    expect(calendar.map((p) => [p.label, p.values])).toEqual([
      ['2025', { value: 2, net: 3 }],
      ['2026', { value: 4, net: 7 }],
    ]);
    expect(compressSeries(points, 'yearly', null, modes, 'calendar')).toEqual(calendar);
    // Monthly and quarterly groups do not depend on the basis.
    expect(compressSeries(points, 'quarterly', null, modes, 'fy')).toEqual(
      compressSeries(points, 'quarterly', null, modes),
    );
  });
});
