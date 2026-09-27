// The hand-worked example (stage-6.md §10.1), figure by figure: generic round numbers only (the repo
// is public). As-of 15/03/2030, born 1975 (age 55), access 60 (n = 5); pre-super $150,000 (no
// debts), super $600,000, savings $30,000 a year, super contribution $20,000, spend $40,000,
// inflation 2 %, withdrawal rate 5 %; the growth weights of §2.4 step 5 (super at the market return)
// blend to g = 6.08 %, so r = 1.0608 ÷ 1.02 − 1 = 4 % exactly. The derivation of the inputs from
// generic periods is in the last block.
import { describe, expect, it } from 'vitest';
import { cashKpis, deriveFireInputs, projectFire } from '../src/index';
import type { FireProjection, FireProjectionInput, FireRow } from '../src/index';
import { examplePeriods, exampleSuper } from './fireHelpers';
import { emptyProperty, figures } from './snapshotHelpers';

/** §10.1's inputs (cents). */
const EXAMPLE: FireProjectionInput = {
  asOf: '2030-03-15',
  birthYear: 1975,
  accessAge: 60,
  inflationRatio: '0.02',
  withdrawalRatio: '0.05',
  preSuperCents: 15_000_000,
  preSuperDebtCents: 0,
  superCents: 60_000_000,
  savingsPerYearCents: 3_000_000,
  extraSavingsPerYearCents: 0,
  superContributionPerYearCents: 2_000_000,
  yearlySpendCents: 4_000_000,
  growth: {
    cashWeightCents: 3_000_000,
    marketWeightCents: 72_000_000,
    cashInterestRatio: '0.0512',
    marketReturnRatio: '0.0612',
  },
};

const run = (over: Partial<FireProjectionInput> = {}): FireProjection =>
  projectFire({ ...EXAMPLE, ...over });

/** [pre-super start, growth, saved, spent, top-up, end, super start, growth, contrib, top-up, withdrawn, end] */
// prettier-ignore
type RowCents = [number, number, number, number, number, number, number, number, number, number, number, number];
const flat = (r: FireRow): RowCents => [
  r.preSuper.startCents,
  r.preSuper.growthCents,
  r.preSuper.savedCents,
  r.preSuper.spentCents,
  r.preSuper.topUpCents,
  r.preSuper.endCents,
  r.super.startCents,
  r.super.growthCents,
  r.super.contributedCents,
  r.super.topUpCents,
  r.super.withdrawnCents,
  r.super.endCents,
];

describe('§10.1 the hand-worked example: projectFire figure by figure', () => {
  const p = run();

  it('blends growth with super weighted: g = 6.08 %, r = 4 % exactly (the template would say 4.08 %)', () => {
    // g = (30,000 × 0.0512 + 720,000 × 0.0612) ÷ 750,000 = (1,536 + 44,064) ÷ 750,000 = 0.0608.
    expect(p.rates).toEqual({
      nominalRatio: '0.0608',
      inflationRatio: '0.02',
      realRatio: '0.04',
      simpleRealRatio: '0.0408',
    });
    expect(p.status).toBe('on_track');
    expect(p.missing).toEqual([]);
    expect([p.ageNow, p.accessYear, p.yearsToAccess]).toEqual([55, 2035, 5]);
    expect(p.savingsPerYearCents).toBe(3_000_000);
    expect(p.noSavingsHistory).toBe(false);
  });

  it('finds FIRE in 2031 at 56 with a 4-year bridge', () => {
    expect(p.fire).toEqual({
      yearsToGo: 1,
      year: 2031,
      age: 56,
      afterAccess: false,
      bridgeYears: 4,
    });
  });

  it('tops super up with C from FIRE start: 3 payments, the last $2,386.35, ending 2034', () => {
    // D = 46,611.09; payments at the end of 2031 and 2032 grow to 22,497.28 + 21,632.00 by
    // access; the third closes the rest: 2,481.81 ÷ 1.04 = 2,386.35.
    expect(p.topUps).toEqual({
      years: 3,
      perYearCents: 2_000_000,
      lastCents: 238_635,
      totalCents: 4_238_635,
      level: false,
      endYear: 2034,
    });
  });

  it('lays out every row of the table (balances at each anniversary; flows at the year end)', () => {
    expect(p.rows.map((r) => [r.t, r.year, r.age, r.phase])).toEqual([
      [0, 2030, 55, 'accumulation'],
      [1, 2031, 56, 'top_up'],
      [2, 2032, 57, 'top_up'],
      [3, 2033, 58, 'top_up'],
      [4, 2034, 59, 'drawdown'],
      [5, 2035, 60, 'access'],
      [6, 2036, 61, 'access'],
    ]);
    // prettier-ignore
    expect(p.rows.map(flat)).toEqual([
      [15_000_000, 600_000, 3_000_000, 0, 0, 18_600_000, 60_000_000, 2_400_000, 2_000_000, 0, 0, 64_400_000],
      [18_600_000, 744_000, 0, 4_000_000, 2_000_000, 13_344_000, 64_400_000, 2_576_000, 0, 2_000_000, 0, 68_976_000],
      [13_344_000, 533_760, 0, 4_000_000, 2_000_000, 7_877_760, 68_976_000, 2_759_040, 0, 2_000_000, 0, 73_735_040],
      [7_877_760, 315_110, 0, 4_000_000, 238_635, 3_954_235, 73_735_040, 2_949_402, 0, 238_635, 0, 76_923_077],
      [3_954_235, 158_169, 0, 4_000_000, 0, 112_404, 76_923_077, 3_076_923, 0, 0, 0, 80_000_000],
      [112_404, 4_496, 0, 0, 0, 116_901, 80_000_000, 3_200_000, 0, 0, 4_000_000, 79_200_000],
      [116_901, 4_676, 0, 0, 0, 121_577, 79_200_000, 3_168_000, 0, 0, 4_000_000, 78_368_000],
    ]);
  });

  it('checks: super reaches the $800,000 target at access; the pre-super pot keeps the year-1 surplus', () => {
    const access = p.rows.find((r) => r.year === 2035)!;
    expect(access.super.startCents).toBe(80_000_000);
    // 960.84 × 1.16985856 = 1,124.04.
    expect(access.preSuper.startCents).toBe(112_404);
    // 2033: 78,777.60 + 3,151.10 − 40,000 − 2,386.35 = 39,542.35.
    const y2033 = p.rows.find((r) => r.year === 2033)!.preSuper;
    expect(y2033.startCents + y2033.growthCents - y2033.spentCents - y2033.topUpCents).toBe(
      y2033.endCents,
    );
  });

  it('gives the KPIs: needed at FIRE start, progress, super needed and projected at access', () => {
    expect(p.preSuper).toEqual({
      currentCents: 15_000_000,
      neededAtFireCents: 18_503_916,
      projectedAtFireCents: 18_600_000,
      progressRatio: '0.810639210347', // 150,000 ÷ 185,039.16 = 81.1 %
    });
    expect(p.super).toEqual({
      currentCents: 60_000_000,
      neededAtAccessCents: 80_000_000,
      projectedAtAccessCents: 80_000_000,
      neededAtFireCents: 68_384_335, // 800,000 ÷ 1.16985856 (the template's "− 2" would give 739,644.97)
      progressRatio: '0.75',
    });
    expect(p.target).toEqual({ superAtAccessCents: 80_000_000, superAtFireStartCents: 68_384_335 });
    // Needed to stop today: 40,000 × 4.451822331 + 70,008.26 ÷ 1.2166529024 = 235,614.58.
    expect(p.rows[0]!.helper!.neededCents).toBe(23_561_458);
  });

  it('shows both views of the helper: needed vs projected, short by then ahead by', () => {
    expect(p.rows.map((r) => [r.year, r.helper!.neededCents, r.helper!.projectedCents])).toEqual([
      [2030, 23_561_458, 15_000_000],
      [2031, 18_503_916, 18_600_000],
      [2032, 13_244_073, 22_344_000],
      [2033, 7_773_836, 26_237_760],
      [2034, 3_846_154, 30_287_270],
      [2035, 0, 34_498_761],
      [2036, 0, 38_878_712],
    ]);
    expect(p.rows[0]!.helper!.gapCents).toBe(8_561_458); // short by 85,614.58
    expect(p.rows[1]!.helper!.gapCents).toBe(-96_084); // ahead by 960.84
  });

  it('places the milestones: today 2030, FIRE start 2031, top-ups end 2034, access 2035', () => {
    expect(p.milestones).toEqual([
      { kind: 'today', t: 0, year: 2030, age: 55 },
      { kind: 'fire_start', t: 1, year: 2031, age: 56 },
      { kind: 'top_ups_end', t: 4, year: 2034, age: 59 },
      { kind: 'access', t: 5, year: 2035, age: 60 },
    ]);
  });
});

describe('§10.1 status cases from the same inputs', () => {
  it('S = 0 → spend_needed', () => {
    expect(run({ yearlySpendCents: 0 }).status).toBe('spend_needed');
  });

  it('birth year null → needs_input [birthYear]', () => {
    const p = run({ birthYear: null });
    expect(p.status).toBe('needs_input');
    expect(p.missing).toEqual(['birthYear']);
  });

  it('A0 = $300,000 → fire (needed(0) $235,614.58 ≤ $300,000)', () => {
    const p = run({ preSuperCents: 30_000_000 });
    expect(p.status).toBe('fire');
    expect(p.fire?.yearsToGo).toBe(0);
  });

  it('C = 0 → FIRE in year 2 with level top-ups of $22,427.04 for the 3 bridge years', () => {
    const p = run({ superContributionPerYearCents: 0 });
    expect(p.fire).toMatchObject({ yearsToGo: 2, year: 2032, bridgeYears: 3 });
    expect(p.topUps).toMatchObject({
      years: 3,
      perYearCents: 2_242_704,
      level: true,
      endYear: 2035,
    });
  });

  it('B0 = $1,000,000 → FIRE in year 1 with no top-ups (needed(1) = S·a(4))', () => {
    const p = run({ superCents: 100_000_000 });
    expect(p.fire?.yearsToGo).toBe(1);
    expect(p.topUps).toBeNull();
    // 40,000 × 3.629895224 = 145,195.81.
    expect(p.preSuper.neededAtFireCents).toBe(14_519_581);
  });

  it('P = 0 and A0 = $0 → FIRE at access (year 5: B(5) = $838,318.19 ≥ $800,000)', () => {
    const p = run({ savingsPerYearCents: 0, preSuperCents: 0 });
    expect(p.fire).toMatchObject({ yearsToGo: 5, year: 2035, afterAccess: false, bridgeYears: 0 });
    expect(p.super.projectedAtAccessCents).toBe(83_831_819);
  });

  it('P = 0, A0 = $0 and B0 = $500,000 → FIRE after access (year 7, age 62: B(7) = $815,931.78)', () => {
    const p = run({ savingsPerYearCents: 0, preSuperCents: 0, superCents: 50_000_000 });
    expect(p.fire).toMatchObject({ yearsToGo: 7, year: 2037, age: 62, afterAccess: true });
    expect(p.rows.map((r) => r.phase)).toEqual([
      ...Array<string>(7).fill('accumulation'),
      'retired',
      'retired',
    ]);
    expect(p.rows[7]!.super.startCents).toBe(81_593_178);
  });

  it('P = 0, C = 0 and A0 = $60,000 → FIRE at access with super below the target, no lump', () => {
    const p = run({
      savingsPerYearCents: 0,
      superContributionPerYearCents: 0,
      preSuperCents: 6_000_000,
    });
    expect(p.fire).toMatchObject({ yearsToGo: 5, year: 2035 });
    expect(p.topUps).toBeNull();
    expect(p.rows.some((r) => r.phase === 'top_up')).toBe(false);
    expect(p.super.projectedAtAccessCents).toBe(72_999_174);
    // The pre-super $72,999.17 covers the $70,008.26 difference under the combined rule.
    const access = p.rows[5]!;
    expect(access.preSuper.startCents).toBe(7_299_917);
    expect(access.helper!.neededCents).toBe(7_000_826);
  });

  it('debts: A0 = −$50,000 with L = $200,000 → projected(1) held above the template’s compounding', () => {
    const debts = { preSuperCents: -5_000_000, preSuperDebtCents: 20_000_000 };
    // 150,000 × 1.04 − 200,000 ÷ 1.02 + 30,000.
    expect(run(debts).rows[1]!.helper!.projectedCents).toBe(-1_007_843);
    expect(run({ preSuperCents: -5_000_000 }).rows[1]!.helper!.projectedCents).toBe(-2_200_000);
  });

  it('debts: projected(3) rises with the market return ($67,836.93 at g = 5 %, $84,991.67 at g = 8 %)', () => {
    const at = (g: string) =>
      run({
        preSuperCents: -5_000_000,
        preSuperDebtCents: 20_000_000,
        growth: {
          cashWeightCents: 0,
          marketWeightCents: 1,
          cashInterestRatio: null,
          marketReturnRatio: g,
        },
      }).rows[3]!.helper!.projectedCents;
    expect(at('0.05')).toBe(6_783_693);
    expect(at('0.08')).toBe(8_499_167);
  });

  it('the combined rule: age 62, B0 = $1,600,000, A0 = −$100,000 with L = $250,000, P = 0 → fire', () => {
    const p = run({
      birthYear: 1968,
      superCents: 160_000_000,
      preSuperCents: -10_000_000,
      preSuperDebtCents: 25_000_000,
      savingsPerYearCents: 0,
    });
    expect(p.yearsToAccess).toBe(-2);
    expect(p.status).toBe('fire');
    expect(p.rows.every((r) => r.helper!.neededCents >= 0)).toBe(true);
  });
});

// ─── The derivation of the example's inputs (§10.1 "Derivations", §2.4) ──────────────────────────

describe('§10.1 derivations: deriveFireInputs on generic periods', () => {
  const periods = examplePeriods();
  const kpis = cashKpis({
    asOf: '2030-03-15',
    periods,
    yearBasis: 'calendar',
    jobStartDate: null,
    currentCashCents: 0,
    eoyCashGoalCents: null,
    cashSavingsTargetCents: null,
  });
  const d = deriveFireInputs({
    asOf: '2030-03-15',
    figures: figures({
      cashValueCents: 3_000_000,
      etfValueCents: 8_000_000,
      stocksValueCents: 4_000_000,
      superValueCents: 60_000_000,
    }),
    classes: [
      { key: 'etf', valueCents: 8_000_000, gainCents: null, gainRatio: null },
      { key: 'stock', valueCents: 4_000_000, gainCents: null, gainRatio: null },
      { key: 'cash', valueCents: 3_000_000, gainCents: null, gainRatio: null },
      { key: 'super', valueCents: 60_000_000, gainCents: null, gainRatio: null },
    ],
    liabilities: [],
    property: emptyProperty('2030-03-15'),
    savings: periods,
    kpis,
    superResult: exampleSuper(),
  });

  it('pre-super = net worth − super − home = $150,000, no debts', () => {
    expect(d.preSuper).toEqual({
      netWorthCents: 75_000_000,
      superCents: 60_000_000,
      primaryResidenceCents: 0,
      primaryResidenceDebtCents: 0,
      primaryResidenceLoanGrossCents: 0,
      preSuperCents: 15_000_000,
      debtCents: 0,
      preSuperExHomeLoanCents: 15_000_000,
    });
  });

  it('spend (D97): ten × $3,750 + $2,500 + $0 = $40,000 a year; the sheet rule gives $34,000', () => {
    expect(d.window).toEqual({ from: '2029-02-28', through: '2030-02-28', periods: 12 });
    expect(d.spend).toEqual({
      yearlyCents: 4_000_000,
      flooredPeriods: 1,
      rawYearlyCents: 3_400_000,
    });
  });

  it('savings: capped at income in the floored month, voluntary super out: $30,000 (sheet: $38,400)', () => {
    expect(d.savings).toEqual({
      yearlyCents: 3_000_000,
      cappedPeriods: 1,
      superExcludedCents: 240_000,
      rawYearlyCents: 3_840_000,
    });
    const floored = d.rows.find((r) => r.floored)!;
    expect(floored).toEqual({
      periodMonth: '2029-11',
      runDate: '2029-11-30',
      incomeCents: 640_000,
      spendCents: -600_000,
      countedSpendCents: 0,
      superNetPayCents: 20_000,
      countedSavingsCents: 620_000,
      floored: true,
    });
    expect(d.rows.map((r) => r.countedSavingsCents).reduce((a, b) => a + b, 0)).toBe(3_000_000);
  });

  it('super contribution (D99): SG $10,200 + after-tax $9,800 = $20,000', () => {
    expect(d.superContribution).toEqual({
      yearlyCents: 2_000_000,
      sgCents: 1_020_000,
      memberCents: 980_000,
      fromMonth: '2029-03',
      toMonth: '2030-02',
      sgSource: 'estimate',
      contributions: 2,
    });
  });

  it('growth weights (D102): cash at the cash rate; ETFs, stocks and super at the market return', () => {
    expect(d.growth).toEqual({
      weights: [
        { key: 'cash', valueCents: 3_000_000, rate: 'cash' },
        { key: 'etf', valueCents: 8_000_000, rate: 'market' },
        { key: 'stock', valueCents: 4_000_000, rate: 'market' },
        { key: 'super', valueCents: 60_000_000, rate: 'market' },
      ],
      cashWeightCents: 3_000_000,
      marketWeightCents: 72_000_000,
    });
  });

  it('feeds projectFire to the example exactly', () => {
    const p = projectFire({
      ...EXAMPLE,
      preSuperCents: d.preSuper.preSuperCents,
      preSuperDebtCents: d.preSuper.debtCents,
      superCents: d.preSuper.superCents,
      savingsPerYearCents: d.savings.yearlyCents,
      superContributionPerYearCents: d.superContribution.yearlyCents,
      yearlySpendCents: d.spend.yearlyCents,
      growth: {
        ...EXAMPLE.growth,
        cashWeightCents: d.growth.cashWeightCents,
        marketWeightCents: d.growth.marketWeightCents,
      },
    });
    expect(p).toEqual(run());
  });
});
