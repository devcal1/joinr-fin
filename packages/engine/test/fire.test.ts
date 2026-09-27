// The FIRE planner (stage-6.md §2.4, §2.5, §7.3 steps 1–2): deriveFireInputs and projectFire on
// generic round figures (the repo is public). The hand-worked example (§10.1) is in
// fire.handworked.test.ts; these tests cover every rule, guard, state and edge around it.
import { describe, expect, it } from 'vitest';
import { cashKpis, computeProperty, deriveFireInputs, projectFire } from '../src/index';
import type {
  EngineLoan,
  EngineProperty,
  FireDeriveInput,
  FireProjection,
  FireProjectionInput,
  NetWorthClassRow,
  NetWorthLiabilityRow,
  SavingsPeriod,
} from '../src/index';
import {
  baselinePeriod,
  contribution,
  examplePeriods,
  exampleSuper,
  monthEnds,
  period,
  sgMonth,
  superResult,
} from './fireHelpers';
import { fireFixtureInputs } from '@joinr/schema/fixtures';
import { D } from './helpers';
import { emptyProperty, figures } from './snapshotHelpers';

const AS_OF = '2030-03-15';

// ═══ deriveFireInputs (§2.4) ═════════════════════════════════════════════════════════════════════

const kpisOf = (periods: SavingsPeriod[], jobStartDate: string | null = null, asOf = AS_OF) =>
  cashKpis({
    asOf,
    periods,
    yearBasis: 'calendar',
    jobStartDate,
    currentCashCents: 0,
    eoyCashGoalCents: null,
    cashSavingsTargetCents: null,
  });

const cls = (key: NetWorthClassRow['key'], valueCents: number): NetWorthClassRow => ({
  key,
  valueCents,
  gainCents: null,
  gainRatio: null,
});

function deriveInput(over: Partial<FireDeriveInput> = {}): FireDeriveInput {
  const periods = examplePeriods();
  return {
    asOf: AS_OF,
    figures: figures({ cashValueCents: 3_000_000, superValueCents: 60_000_000 }),
    classes: [cls('cash', 3_000_000), cls('super', 60_000_000)],
    liabilities: [],
    property: emptyProperty(AS_OF),
    savings: periods,
    kpis: kpisOf(periods),
    superResult: exampleSuper(),
    ...over,
  };
}

const property = (id: number, isPrimaryResidence: boolean, valueCents: number): EngineProperty => ({
  id,
  purchaseDate: '2020-01-01',
  isPrimaryResidence,
  purchaseValueCents: valueCents,
  netRentToDateCents: 0,
  valuations: [{ id, asOf: '2029-12-31', valueCents }],
});

const loan = (
  id: number,
  propertyId: number | null,
  balanceCents: number,
  offsets: number[] = [],
): EngineLoan => ({
  id,
  propertyId,
  startDate: null,
  startBalanceCents: null,
  annualRate: null,
  compoundingPerYear: null,
  paymentCents: null,
  paymentFrequency: 'monthly',
  entries: [{ id: id * 10, asOf: '2030-02-28', balanceCents, repaymentsCents: null }],
  offsets: offsets.map((b, k) => ({ accountId: id * 100 + k, balanceCents: b })),
});

const propertiesOf = (properties: EngineProperty[], loans: EngineLoan[]) =>
  computeProperty({
    asOf: AS_OF,
    properties,
    loans,
    snapshots: [],
    chart: { unit: 'monthly', count: null },
  });

describe('deriveFireInputs: pre-super net worth and its debts (§2.4 step 1, D68)', () => {
  // A home $800,000 (loan $500,000, a $50,000 linked offset), an investment property $400,000
  // (loan $300,000), cash $30,000 in credit and $5,000 in debit, an unlinked offset $20,000, ETFs
  // $100,000, other debts $10,000, super $300,000.
  const props = propertiesOf(
    [property(1, true, 80_000_000), property(2, false, 40_000_000)],
    [loan(1, 1, 50_000_000, [5_000_000]), loan(2, 2, 30_000_000)],
  );
  const liabilities: NetWorthLiabilityRow[] = [
    { key: 'mortgages', balanceCents: 75_000_000, grossCents: 80_000_000, offsetCents: 5_000_000 },
    { key: 'cash_debit', balanceCents: 500_000, grossCents: 500_000, offsetCents: 0 },
    { key: 'other_debts', balanceCents: 1_000_000, grossCents: 1_000_000, offsetCents: 0 },
  ];
  const d = deriveFireInputs(
    deriveInput({
      figures: figures({
        cashValueCents: 2_500_000,
        cashDebtCents: -500_000,
        etfValueCents: 10_000_000,
        superValueCents: 30_000_000,
        propertyValueCents: 120_000_000,
        mortgageBalanceCents: 80_000_000,
        mortgageOffsetCents: 5_000_000,
        offsetCents: 7_000_000,
        liabilitiesBalanceCents: 1_000_000,
      }),
      classes: [
        cls('etf', 10_000_000),
        cls('stock', 0),
        cls('cash', 3_000_000),
        cls('offsets', 2_000_000),
        cls('super', 30_000_000),
        cls('property', 120_000_000),
      ],
      liabilities,
      property: props,
    }),
  );

  it('leaves the home value out and keeps its loan in: net worth − super − home', () => {
    // Net worth 885,000 = 125,000 liquid + 300,000 super + 1,200,000 property − 810,000 + 70,000.
    expect(d.preSuper.netWorthCents).toBe(88_500_000);
    expect(d.preSuper.superCents).toBe(30_000_000);
    expect(d.preSuper.primaryResidenceCents).toBe(80_000_000);
    expect(d.preSuper.preSuperCents).toBe(-21_500_000);
  });

  it('splits the debts out: L = Σ liabilities, so A0 + L are the pre-super assets', () => {
    expect(d.preSuper.debtCents).toBe(76_500_000);
    // Cash 30,000 + ETFs 100,000 + investment property 400,000 + the unlinked offset 20,000.
    expect(d.preSuper.preSuperCents + d.preSuper.debtCents).toBe(55_000_000);
  });

  it('shows the home debt net of the linked offset, and adds back the gross loan for the alternative', () => {
    expect(d.preSuper.primaryResidenceDebtCents).toBe(45_000_000);
    expect(d.preSuper.primaryResidenceLoanGrossCents).toBe(50_000_000);
    // The linked offset's cash stays in: −215,000 + 500,000.
    expect(d.preSuper.preSuperExHomeLoanCents).toBe(28_500_000);
  });

  it('weights cash and unlinked offsets at the cash rate; ETFs, investment property and super at the market', () => {
    expect(d.growth.weights).toEqual([
      { key: 'cash', valueCents: 3_000_000, rate: 'cash' },
      { key: 'offsets', valueCents: 2_000_000, rate: 'cash' },
      { key: 'etf', valueCents: 10_000_000, rate: 'market' },
      { key: 'investment_property', valueCents: 40_000_000, rate: 'market' },
      { key: 'super', valueCents: 30_000_000, rate: 'market' },
    ]);
    expect(d.growth.cashWeightCents).toBe(5_000_000);
    expect(d.growth.marketWeightCents).toBe(80_000_000);
  });

  it('sums two primary residences (values, net debts, gross loans)', () => {
    const two = propertiesOf(
      [property(1, true, 60_000_000), property(3, true, 20_000_000)],
      [loan(1, 1, 30_000_000, [2_000_000]), loan(3, 3, 5_000_000), loan(4, null, 1_000_000)],
    );
    const r = deriveFireInputs(
      deriveInput({
        figures: figures({ superValueCents: 10_000_000, propertyValueCents: 80_000_000 }),
        property: two,
      }),
    );
    expect(r.preSuper.primaryResidenceCents).toBe(80_000_000);
    expect(r.preSuper.primaryResidenceDebtCents).toBe(33_000_000);
    expect(r.preSuper.primaryResidenceLoanGrossCents).toBe(35_000_000);
    expect(r.preSuper.preSuperCents).toBe(0);
    // No investment property: nothing weighted at the market for property.
    expect(r.growth.weights.find((w) => w.key === 'investment_property')).toBeUndefined();
  });

  it('leaves out weights ≤ 0 (crypto at 0, other assets negative) and never weights the home', () => {
    const r = deriveFireInputs(
      deriveInput({
        classes: [cls('crypto', 0), cls('other_assets', -100_000), cls('cash', 100_000)],
        property: propertiesOf([property(1, true, 50_000_000)], []),
      }),
    );
    expect(r.growth.weights).toEqual([{ key: 'cash', valueCents: 100_000, rate: 'cash' }]);
    expect(r.growth.marketWeightCents).toBe(0);
  });

  it('keeps crypto, managed funds, stocks and other assets at the market return', () => {
    const r = deriveFireInputs(
      deriveInput({
        classes: [
          cls('stock', 100),
          cls('managed_fund', 200),
          cls('crypto', 300),
          cls('other_assets', 400),
        ],
      }),
    );
    expect(r.growth.weights.map((w) => [w.key, w.rate])).toEqual([
      ['stock', 'market'],
      ['managed_fund', 'market'],
      ['crypto', 'market'],
      ['other_assets', 'market'],
    ]);
    expect(r.growth.marketWeightCents).toBe(1_000);
  });
});

describe('deriveFireInputs: the window, spend and savings (§2.4 steps 2–3, D97, fix 7)', () => {
  it('has no window without a closed period: every yearly figure null, nothing excluded', () => {
    const periods = [baselinePeriod('2030-02-28')];
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    expect(d.window).toBeNull();
    expect(d.rows).toEqual([]);
    expect(d.spend).toEqual({ yearlyCents: null, flooredPeriods: 0, rawYearlyCents: null });
    expect(d.savings).toEqual({
      yearlyCents: null,
      cappedPeriods: 0,
      superExcludedCents: 0,
      rawYearlyCents: null,
    });
  });

  it('drops the baseline and never counts the live period; through = the last run date', () => {
    const d = deriveFireInputs(deriveInput());
    expect(d.rows.map((r) => r.runDate)).toEqual(monthEnds('2029-03', 12));
    expect(d.window?.through).toBe('2030-02-28');
  });

  it('floors the window at the job start (the Stage 3 rule)', () => {
    const periods = examplePeriods();
    const d = deriveFireInputs(deriveInput({ kpis: kpisOf(periods, '2029-09-01') }));
    expect(d.window).toEqual({ from: '2029-09-01', through: '2030-02-28', periods: 6 });
    // Four months at $3,750 spend, the floored month at $0 and one at $3,750: 18,750 ÷ 6 × 12.
    expect(d.spend.yearlyCents).toBe(3_750_000);
  });

  it('drops closed periods older than the 12-month window', () => {
    const periods = [
      baselinePeriod('2028-01-31'),
      period('2028-06-30', { income: 600_000, savings: 100_000 }),
      ...examplePeriods().slice(1),
    ];
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    expect(d.window?.periods).toBe(12);
    expect(d.rows[0]!.runDate).toBe('2029-03-31');
  });

  it('skips a closed period without income (no spend figure)', () => {
    const periods = [
      ...examplePeriods().slice(0, -1),
      period('2030-03-10', { income: 0, savings: 50_000 }),
    ];
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    expect(d.rows.map((r) => r.runDate)).not.toContain('2030-03-10');
    expect(d.window?.through).toBe('2030-02-28');
  });

  it('uses plain means of unrounded per-period values, rounded once', () => {
    // Three months of spend $1,000.004, $1,000.004, $1,000.005 (income $2,000, savings the rest).
    const periods = [
      baselinePeriod('2029-12-31'),
      period('2030-01-31', { income: 200_000, savings: 100_000, superCents: 0 }),
      period('2030-02-28', { income: 300_000, savings: 150_000, superCents: 0 }),
    ];
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    // Not income-weighted: (1,000 + 1,500) ÷ 2 × 12 = 15,000.
    expect(d.spend.yearlyCents).toBe(1_500_000);
    expect(d.savings.yearlyCents).toBe(1_500_000);
  });

  it('keeps the raw rule apart: a D51 adjustment in the window makes raw ≠ adjusted', () => {
    // Nov 2029: raw savings $12,400 (a sale), adjusted down by $10,000 to $2,400.
    const periods = examplePeriods().map((p) =>
      p.runDate === '2029-11-30'
        ? period(p.runDate, { income: 640_000, savings: 240_000, rawSavings: 1_240_000 })
        : p,
    );
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    const nov = d.rows.find((r) => r.periodMonth === '2029-11')!;
    expect(nov).toMatchObject({
      spendCents: 400_000,
      floored: false,
      countedSavingsCents: 220_000,
    });
    // Adjusted: (10 × 3,750 + 2,500 + 4,000) ÷ 12 × 12 = 44,000; raw unchanged at 34,000.
    expect(d.spend.yearlyCents).toBe(4_400_000);
    expect(d.spend.rawYearlyCents).toBe(3_400_000);
    expect(d.spend.flooredPeriods).toBe(0);
    // Savings: 10 × 2,050 + 3,300 + 2,200 = 26,000; raw 38,400 (super kept, uncapped).
    expect(d.savings.yearlyCents).toBe(2_600_000);
    expect(d.savings.rawYearlyCents).toBe(3_840_000);
  });

  it('floors negative mean savings at $0 (and the raw rule likewise)', () => {
    const periods = [
      baselinePeriod('2029-12-31'),
      period('2030-01-31', { income: 100_000, savings: -50_000, superCents: 10_000 }),
    ];
    const d = deriveFireInputs(deriveInput({ savings: periods, kpis: kpisOf(periods) }));
    expect(d.rows[0]!.countedSavingsCents).toBe(-60_000);
    expect(d.savings.yearlyCents).toBe(0);
    expect(d.savings.rawYearlyCents).toBe(0);
    expect(d.savings.superExcludedCents).toBe(120_000);
    expect(d.spend.yearlyCents).toBe(1_800_000);
  });

  it('makes spend + savings + voluntary super = income in every month (the cap, owner question 4)', () => {
    const d = deriveFireInputs(deriveInput());
    for (const r of d.rows) {
      expect(r.countedSpendCents + r.countedSavingsCents + r.superNetPayCents).toBe(r.incomeCents);
      expect(r.countedSpendCents).toBe(Math.max(0, r.spendCents));
    }
  });
});

describe('deriveFireInputs: the super contribution a year (§2.4 step 4, D99)', () => {
  const at = (
    asOf: string,
    months: ReturnType<typeof sgMonth>[],
    contributions = [] as ReturnType<typeof contribution>[],
  ) =>
    deriveFireInputs(deriveInput({ asOf, superResult: superResult(months, contributions) }))
      .superContribution;
  const everyMonth = monthEnds('2028-01', 36).map((d) => d.slice(0, 7));

  it('takes the 12 whole months before asOf’s month at a month start', () => {
    const c = at(
      '2030-03-01',
      everyMonth.map((m) => sgMonth(m, 10_000)),
    );
    expect([c.fromMonth, c.toMonth, c.sgCents]).toEqual(['2029-03', '2030-02', 120_000]);
  });

  it('takes the same months mid-month', () => {
    const c = at(
      '2030-03-15',
      everyMonth.map((m) => sgMonth(m, 10_000)),
    );
    expect([c.fromMonth, c.toMonth, c.sgCents]).toEqual(['2029-03', '2030-02', 120_000]);
  });

  it('crosses the FY boundary in July (July – June)', () => {
    const c = at(
      '2030-07-10',
      everyMonth.map((m) => sgMonth(m, m < '2030-01' ? 10_000 : 20_000)),
    );
    expect([c.fromMonth, c.toMonth]).toEqual(['2029-07', '2030-06']);
    expect(c.sgCents).toBe(6 * 10_000 + 6 * 20_000);
  });

  it('adds salary-sacrifice and after-tax contributions as the fund receives them; ignores the rest', () => {
    const c = at(
      '2030-03-15',
      everyMonth.map((m) => sgMonth(m, 10_000)),
      [
        contribution(1, '2029-02-28', 99_900), // before the months
        contribution(2, '2029-03-01', 85_000, 'salary_sacrifice'),
        contribution(3, '2030-02-28', 50_000),
        contribution(4, '2030-03-01', 99_900), // asOf's month
      ],
    );
    expect(c).toEqual({
      yearlyCents: 120_000 + 135_000,
      sgCents: 120_000,
      memberCents: 135_000,
      fromMonth: '2029-03',
      toMonth: '2030-02',
      sgSource: 'estimate',
      contributions: 2,
    });
  });

  it('summarises the SG source: statement, mixed, none', () => {
    const months = monthEnds('2029-03', 12).map((d) => d.slice(0, 7));
    expect(
      at(
        AS_OF,
        months.map((m) => sgMonth(m, 10_000, 'statement')),
      ).sgSource,
    ).toBe('statement');
    expect(
      at(
        AS_OF,
        months.map((m, k) => sgMonth(m, 10_000, k < 6 ? 'statement' : 'estimate')),
      ).sgSource,
    ).toBe('mixed');
    expect(
      at(
        AS_OF,
        months.map((m, k) => sgMonth(m, k < 6 ? 0 : 10_000, k < 6 ? 'none' : 'estimate')),
      ).sgSource,
    ).toBe('estimate');
    const none = at(
      AS_OF,
      months.map((m) => sgMonth(m, 0, 'none')),
    );
    expect([none.sgSource, none.yearlyCents]).toEqual(['none', 0]);
    expect(at(AS_OF, []).sgSource).toBe('none');
  });
});

// ═══ projectFire (§2.5) ══════════════════════════════════════════════════════════════════════════

/** The §10.1 inputs (g 6.08 %, i 2 %, r 4 % exactly). */
const BASE: FireProjectionInput = {
  asOf: AS_OF,
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
  projectFire({ ...BASE, ...over });
/** A single market rate (weights: market only). */
const market = (g: string | null): FireProjectionInput['growth'] => ({
  cashWeightCents: 0,
  marketWeightCents: 100,
  cashInterestRatio: null,
  marketReturnRatio: g,
});

/** Every row's printed figures add up within 1 cent per column. */
function expectRowsAddUp(p: FireProjection): void {
  for (const r of p.rows) {
    const a = r.preSuper;
    const b = r.super;
    expect(
      Math.abs(
        a.startCents + a.growthCents + a.savedCents - a.spentCents - a.topUpCents - a.endCents,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        b.startCents +
          b.growthCents +
          b.contributedCents +
          b.topUpCents -
          b.withdrawnCents -
          b.endCents,
      ),
    ).toBeLessThanOrEqual(1);
  }
  p.rows.slice(1).forEach((r, k) => {
    expect(r.preSuper.startCents).toBe(p.rows[k]!.preSuper.endCents);
    expect(r.super.startCents).toBe(p.rows[k]!.super.endCents);
  });
}

describe('projectFire: inputs and needs_input (§2.5 step 1)', () => {
  it('lists every missing input in order', () => {
    const p = run({
      birthYear: null,
      accessAge: null,
      inflationRatio: null,
      withdrawalRatio: null,
      growth: {
        cashWeightCents: 1,
        marketWeightCents: 1,
        cashInterestRatio: null,
        marketReturnRatio: null,
      },
    });
    expect(p.status).toBe('needs_input');
    expect(p.missing).toEqual([
      'birthYear',
      'accessAge',
      'inflationRate',
      'withdrawalRate',
      'marketReturn',
      'cashInterestRate',
    ]);
    expect(p).toMatchObject({
      ageNow: null,
      accessYear: null,
      yearsToAccess: null,
      rates: null,
      target: null,
      fire: null,
      topUps: null,
      milestones: [],
      rows: [],
    });
    // The current figures stay; every projected figure is null.
    expect(p.preSuper).toEqual({
      currentCents: 15_000_000,
      neededAtFireCents: null,
      projectedAtFireCents: null,
      progressRatio: null,
    });
    expect(p.super).toEqual({
      currentCents: 60_000_000,
      neededAtAccessCents: null,
      projectedAtAccessCents: null,
      neededAtFireCents: null,
      progressRatio: null,
    });
    expect(p.savingsPerYearCents).toBe(3_000_000);
  });

  it('guards the birth year: after the as-of year, or an age at or past the horizon', () => {
    expect(run({ birthYear: 2031 }).missing).toEqual(['birthYear']);
    expect(run({ birthYear: 1930 }).missing).toEqual(['birthYear']);
    expect(run({ birthYear: 1931 }).missing).toEqual([]);
    expect(run({ birthYear: 2030 }).missing).toEqual([]);
    expect(run({ birthYear: 1980, horizonAge: 50 }).missing).toEqual(['birthYear', 'accessAge']);
  });

  it('guards the access age at the horizon', () => {
    expect(run({ accessAge: 100 }).missing).toEqual(['accessAge']);
    expect(run({ accessAge: 99 }).missing).toEqual([]);
  });

  it('keeps the age and access year when only other inputs are missing', () => {
    const p = run({ withdrawalRatio: null });
    expect([p.ageNow, p.accessYear, p.yearsToAccess]).toEqual([55, 2035, 5]);
    expect(run({ accessAge: null }).ageNow).toBe(55);
    expect(run({ accessAge: null }).accessYear).toBeNull();
  });

  it('needs a positive withdrawal rate', () => {
    expect(run({ withdrawalRatio: '0' }).missing).toEqual(['withdrawalRate']);
    expect(run({ withdrawalRatio: '-0.01' }).missing).toEqual(['withdrawalRate']);
  });

  it('needs the market return while market weight exists, and the cash rate while cash weight exists', () => {
    expect(run({ growth: { ...BASE.growth, marketReturnRatio: null } }).missing).toEqual([
      'marketReturn',
    ]);
    expect(run({ growth: { ...BASE.growth, cashInterestRatio: null } }).missing).toEqual([
      'cashInterestRate',
    ]);
    // No cash weight: the cash rate is not needed.
    const noCash = run({ growth: { ...BASE.growth, cashWeightCents: 0, cashInterestRatio: null } });
    expect(noCash.missing).toEqual([]);
    expect(noCash.rates?.nominalRatio).toBe('0.0612');
  });

  it('with both weights 0: the market return, else the cash rate, else marketReturn is missing', () => {
    const none = { cashWeightCents: 0, marketWeightCents: 0 };
    expect(
      run({ growth: { ...none, cashInterestRatio: '0.03', marketReturnRatio: '0.07' } }).rates
        ?.nominalRatio,
    ).toBe('0.07');
    expect(
      run({ growth: { ...none, cashInterestRatio: '0.03', marketReturnRatio: null } }).rates
        ?.nominalRatio,
    ).toBe('0.03');
    expect(
      run({ growth: { ...none, cashInterestRatio: null, marketReturnRatio: null } }).missing,
    ).toEqual(['marketReturn']);
  });

  it('flags rates that break the model: 1 + g ≤ 0 or 1 + i ≤ 0', () => {
    expect(run({ growth: market('-1') }).missing).toEqual(['rates']);
    expect(run({ growth: market('-1.5') }).missing).toEqual(['rates']);
    expect(run({ inflationRatio: '-1' }).missing).toEqual(['rates']);
    expect(run({ inflationRatio: '-0.5' }).missing).toEqual([]);
  });

  /** needs_input with only `missing`, no rows and no rates (the step 1 shape). */
  function expectNeedsInput(p: FireProjection, missing: FireProjection['missing']): void {
    expect(p.status).toBe('needs_input');
    expect(p.missing).toEqual(missing);
    expect(p.rows).toEqual([]);
    expect(p.rates).toBeNull();
    expect(p.target).toBeNull();
    expect(p.preSuper.currentCents).toBe(BASE.preSuperCents);
    expect(p.super.currentCents).toBe(BASE.superCents);
  }

  it('reports rates, never throws, when a projected figure leaves the cents range (triage SPEC-1)', () => {
    // A long horizon (age 35, 65 years to the horizon): the real rate compounds past the range.
    const young = { birthYear: 1995 };
    for (const over of [
      { growth: market('-0.9') },
      { inflationRatio: '-0.9' },
      { inflationRatio: '-0.5' },
    ]) {
      let p: FireProjection | undefined;
      expect(() => (p = run({ ...young, ...over }))).not.toThrow();
      expectNeedsInput(p!, ['rates']);
    }
  });

  it('reports the withdrawal rate when the target S ÷ wr leaves the cents range', () => {
    expectNeedsInput(run({ birthYear: 1995, withdrawalRatio: '0.0000000001' }), ['withdrawalRate']);
  });

  it('keeps a finite projection over a short horizon at −50 % growth (control)', () => {
    const p = run({ growth: market('-0.5') });
    expect(p.status).toBe('not_reachable');
    expect(p.rows.length).toBeGreaterThan(0);
  });

  it('reports rates for extreme rate pairs on the onTrack fixture (triage CODE-1)', () => {
    const base = fireFixtureInputs.onTrack as FireProjectionInput;
    const pair = (i: string, g: string): FireProjectionInput => ({
      ...base,
      inflationRatio: i,
      growth: { ...base.growth, cashInterestRatio: g, marketReturnRatio: g },
    });
    for (const input of [pair('-0.99', '1'), pair('1', '-0.99')]) {
      let p: FireProjection | undefined;
      expect(() => (p = projectFire(input))).not.toThrow();
      expect(p!.status).toBe('needs_input');
      expect(p!.missing).toEqual(['rates']);
      expect(p!.rows).toEqual([]);
    }
    // A young birth year, 100 % growth and no inflation: needs_input or a valid projection.
    let young: FireProjection | undefined;
    expect(() => (young = projectFire({ ...pair('0', '1'), birthYear: 2025 }))).not.toThrow();
    if (young!.status === 'needs_input') expect(young!.missing).toEqual(['rates']);
    else for (const r of young!.rows) expect(Number.isSafeInteger(r.preSuper.endCents)).toBe(true);
  });

  it('rejects malformed decimals and dates as programmer errors', () => {
    expect(() => run({ inflationRatio: 'abc' })).toThrow(RangeError);
    expect(() => run({ asOf: '2030-02-30' })).toThrow(RangeError);
    expect(() => run({ preSuperCents: 0.5 })).toThrow(RangeError);
  });
});

describe('projectFire: rates (§2.5 step 1, D102)', () => {
  it('uses the exact real rate: 1.0608 ÷ 1.02 − 1 = 0.04 (the template’s g − i = 0.0408)', () => {
    expect(run().rates).toEqual({
      nominalRatio: '0.0608',
      inflationRatio: '0.02',
      realRatio: '0.04',
      simpleRealRatio: '0.0408',
    });
  });

  it('handles r = 0: s(t) = t and a(t) = t', () => {
    const p = run({ growth: market('0.02') });
    expect(p.rates?.realRatio).toBe('0');
    // needed(0) = S × 5 + max(0, 800,000 − 600,000) = 400,000; projected(1) = 150,000 + 30,000.
    expect(p.rows[0]!.helper).toEqual({
      neededCents: 40_000_000,
      projectedCents: 15_000_000,
      gapCents: 25_000_000,
    });
    // B(t) = 600,000 + 20,000 t, so the shortfall vanishes once t ≥ 10: FIRE never before access.
    expect(p.rows[1]!.helper!.neededCents).toBe(4 * 4_000_000 + 18_000_000);
    expect(p.rows[1]!.helper!.projectedCents).toBe(18_000_000);
    expectRowsAddUp(p);
  });
});

describe('projectFire: spend_needed (§2.5 step 2)', () => {
  for (const [label, spend] of [
    ['null', null],
    ['0', 0],
    ['negative', -100_000],
  ] as const) {
    it(`spend ${label} → spend_needed: the accumulation path only, no helper`, () => {
      const p = run({ yearlySpendCents: spend });
      expect(p.status).toBe('spend_needed');
      expect(p.target).toBeNull();
      expect(p.fire).toBeNull();
      expect(p.topUps).toBeNull();
      expect(p.rows).toHaveLength(7);
      expect(p.rows.every((r) => r.phase === 'accumulation' && r.helper === null)).toBe(true);
      expect(p.milestones.map((m) => m.kind)).toEqual(['today', 'access']);
      // Super at access = B(5) = 600,000 × 1.2166529024 + 20,000 × 5.416322560.
      expect(p.super.projectedAtAccessCents).toBe(83_831_819);
      expect(p.super.neededAtAccessCents).toBeNull();
      expect(p.super.progressRatio).toBeNull();
      expect(p.rates?.realRatio).toBe('0.04');
      expectRowsAddUp(p);
    });
  }
});

describe('projectFire: paths, the helper and the FIRE year (§2.5 steps 3–4)', () => {
  it('gives needed/projected/gap at hand values (year 1 of §10.1)', () => {
    const h = run().rows[1]!.helper!;
    // needed(1) = 40,000 × 3.629895224 + 46,611.09 ÷ 1.16985856 = 185,039.16.
    expect(h).toEqual({ neededCents: 18_503_916, projectedCents: 18_600_000, gapCents: -96_084 });
  });

  it('holds debts fixed in dollars: L = 0 reproduces the template’s W = A0·q(t) + P·s(t)', () => {
    const p = run({ preSuperCents: 5_000_000 });
    // 50,000 × 1.04² + 30,000 × 2.04 = 54,080 + 61,200.
    expect(p.rows[2]!.helper!.projectedCents).toBe(11_528_000);
  });

  it('with debts, a higher market return never lowers projected(t) through the debt term', () => {
    const debts = { preSuperCents: -5_000_000, preSuperDebtCents: 20_000_000 };
    const low = run({ ...debts, growth: market('0.03') });
    const high = run({ ...debts, growth: market('0.09') });
    low.rows.forEach((r, t) => {
      const other = high.rows[t];
      if (other)
        expect(other.helper!.projectedCents).toBeGreaterThanOrEqual(r.helper!.projectedCents);
    });
    // The template's rule compounds the negative net figure: a higher return makes it worse.
    const tplLow = run({
      preSuperCents: -5_000_000,
      savingsPerYearCents: 0,
      growth: market('0.03'),
    });
    const tplHigh = run({
      preSuperCents: -5_000_000,
      savingsPerYearCents: 0,
      growth: market('0.09'),
    });
    expect(tplHigh.rows[3]!.helper!.projectedCents).toBeLessThan(
      tplLow.rows[3]!.helper!.projectedCents,
    );
  });

  it('grows the pre-super path with the debts’ fall in today’s dollars', () => {
    const p = run({
      preSuperCents: -5_000_000,
      preSuperDebtCents: 20_000_000,
      savingsPerYearCents: 0,
    });
    // Row 0: (−50,000 + 200,000) × 0.04 + 200,000 × 0.02 ÷ 1.02 = 6,000 + 3,921.57.
    expect(p.rows[0]!.preSuper.growthCents).toBe(992_157);
    // The path's end equals projected(1) while accumulating.
    expect(p.rows[0]!.preSuper.endCents).toBe(p.rows[1]!.helper!.projectedCents);
  });

  it('after access, the combined rule: needed = target − B(t), signed; the displayed figure floored', () => {
    const p = run({
      birthYear: 1968,
      superCents: 160_000_000,
      preSuperCents: -10_000_000,
      preSuperDebtCents: 25_000_000,
      savingsPerYearCents: 0,
    });
    expect(p.status).toBe('fire');
    expect(p.rows[0]!.helper!.neededCents).toBe(0);
    // gap = (800,000 − 1,600,000) − (−100,000) = −700,000.
    expect(p.rows[0]!.helper!.gapCents).toBe(-70_000_000);
    expect(p.preSuper.progressRatio).toBeNull();
    expect(p.milestones.map((m) => m.kind)).toEqual(['today']);
  });

  it('not_reachable at the horizon: accumulation rows to access + 1, no FIRE figures', () => {
    const p = run({ yearlySpendCents: 1_000_000_000 });
    expect(p.status).toBe('not_reachable');
    expect(p.fire).toBeNull();
    expect(p.target).toEqual({ superAtAccessCents: 20_000_000_000, superAtFireStartCents: null });
    expect(p.preSuper).toMatchObject({
      neededAtFireCents: null,
      projectedAtFireCents: null,
      progressRatio: null,
    });
    expect(p.super.projectedAtAccessCents).toBe(83_831_819);
    expect(p.super.progressRatio).toBe('0.003');
    expect(p.rows).toHaveLength(7);
    expect(p.rows.every((r) => r.phase === 'accumulation')).toBe(true);
    expect(p.milestones.map((m) => m.kind)).toEqual(['today', 'access']);
  });
});

describe('projectFire: top-ups and the plan path (§2.5 steps 5–6)', () => {
  it('pays C until the paid amounts grown to access close the shortfall, then super reaches the target', () => {
    const p = run();
    const access = p.rows.find((r) => r.t === 5)!;
    expect(Math.abs(access.super.startCents - p.target!.superAtAccessCents)).toBeLessThanOrEqual(1);
    expect(p.rows.filter((r) => r.phase === 'top_up').map((r) => r.super.topUpCents)).toEqual([
      2_000_000, 2_000_000, 238_635,
    ]);
    expectRowsAddUp(p);
  });

  it('pays a level top-up over the bridge when C is 0 or too small', () => {
    for (const c of [0, 100_000]) {
      const p = run({ superContributionPerYearCents: c });
      expect(p.topUps?.level).toBe(true);
      const access = p.rows.find((r) => r.t === 5)!;
      expect(Math.abs(access.super.startCents - 80_000_000)).toBeLessThanOrEqual(1);
      expect(p.topUps!.years).toBe(p.fire!.bridgeYears);
      expect(p.topUps!.perYearCents).toBe(p.topUps!.lastCents);
      expectRowsAddUp(p);
    }
  });

  it('needs no top-up when super grows past the target by itself', () => {
    const p = run({ superCents: 100_000_000 });
    expect(p.topUps).toBeNull();
    expect(p.rows.some((r) => r.phase === 'top_up')).toBe(false);
    expect(p.rows.filter((r) => r.phase === 'drawdown').map((r) => r.t)).toEqual([1, 2, 3, 4]);
    expect(p.milestones.map((m) => m.kind)).toEqual(['today', 'fire_start', 'access']);
  });

  it('k = n with B(n) ≥ target: FIRE at access, two milestones in one year', () => {
    const p = run({ savingsPerYearCents: 0, preSuperCents: 0 });
    expect(p.fire).toMatchObject({ yearsToGo: 5, bridgeYears: 0 });
    expect(p.milestones.map((m) => [m.kind, m.t])).toEqual([
      ['today', 0],
      ['fire_start', 5],
      ['access', 5],
    ]);
    expect(p.rows.map((r) => r.phase)).toEqual([
      'accumulation',
      'accumulation',
      'accumulation',
      'accumulation',
      'accumulation',
      'access',
      'access',
    ]);
  });

  it('k = n with B(n) < target: no lump, no top-up row; the pre-super pot covers the rest', () => {
    const p = run({
      savingsPerYearCents: 0,
      superContributionPerYearCents: 0,
      preSuperCents: 6_000_000,
    });
    expect(p.fire?.yearsToGo).toBe(5);
    expect(p.topUps).toBeNull();
    expect(p.super.projectedAtAccessCents).toBe(72_999_174);
    expect(p.super.projectedAtAccessCents!).toBeLessThan(p.target!.superAtAccessCents);
  });

  it('FIRE after access: rows n ≤ t < k keep accumulating, then retired', () => {
    const p = run({ savingsPerYearCents: 0, preSuperCents: 0, superCents: 50_000_000 });
    expect(p.fire).toMatchObject({ yearsToGo: 7, afterAccess: true, bridgeYears: 0 });
    expect(p.rows).toHaveLength(9);
    expect(p.rows.slice(5, 7).every((r) => r.phase === 'accumulation')).toBe(true);
    expect(p.rows.slice(7).every((r) => r.phase === 'retired')).toBe(true);
    // Super at access = B(5) (still accumulating).
    expect(p.super.projectedAtAccessCents).toBe(p.rows[5]!.super.startCents);
    expect(p.target?.superAtFireStartCents).toBe(80_000_000);
    expect(p.milestones.map((m) => m.kind)).toEqual(['today', 'access', 'fire_start']);
    expectRowsAddUp(p);
  });

  it('access reached (n ≤ 0): no access milestone; super at access is the current super', () => {
    const p = run({ birthYear: 1968, superCents: 50_000_000, preSuperCents: 15_000_000 });
    expect(p.yearsToAccess).toBe(-2);
    expect(p.accessYear).toBe(2028);
    expect(p.super.projectedAtAccessCents).toBe(50_000_000);
    expect(p.milestones.some((m) => m.kind === 'access')).toBe(false);
    expect(p.fire?.afterAccess).toBe(true);
    expect(p.rows.at(-1)!.t).toBe(p.fire!.yearsToGo + 1);
  });

  it('draws super first after access, then pre-super once super is exhausted', () => {
    const p = run({ birthYear: 1968, superCents: 3_000_000, preSuperCents: 200_000_000 });
    expect(p.status).toBe('fire');
    const row = p.rows[0]!;
    // Super 30,000 grows 1,200 and is drawn to 0; the other 8,800 comes from pre-super.
    expect(row.super.withdrawnCents).toBe(3_120_000);
    expect(row.super.endCents).toBe(0);
    expect(row.preSuper.spentCents).toBe(880_000);
    expect(p.rows[1]!.super.withdrawnCents).toBe(0);
    expect(p.rows[1]!.preSuper.spentCents).toBe(4_000_000);
    expectRowsAddUp(p);
  });

  it('spans rows to max(n, k) + 1, capped at the horizon', () => {
    expect(run().rows).toHaveLength(7);
    const young = run({
      birthYear: 2005,
      superCents: 1_000_000,
      preSuperCents: 500_000,
      savingsPerYearCents: 0,
      superContributionPerYearCents: 0,
      yearlySpendCents: 3_600_000,
      withdrawalRatio: '0.05',
    });
    // Age 25: the horizon is 75 years away; FIRE (after access) is found late or never.
    expect(young.rows.length).toBeLessThanOrEqual(76);
    expect(young.rows.at(-1)!.age).toBeLessThanOrEqual(100);
    const tight = run({ horizonAge: 58, accessAge: 57, yearlySpendCents: 1_000_000_000 });
    expect(tight.status).toBe('not_reachable');
    expect(tight.rows.at(-1)!.t).toBe(3);
  });

  it('fire (k = 0) with a super shortfall has top-up rows from t = 0 and no FIRE node', () => {
    const p = run({ preSuperCents: 30_000_000 });
    expect(p.status).toBe('fire');
    expect(p.rows[0]!.phase).toBe('top_up');
    expect(p.milestones.map((m) => m.kind)).toEqual(['today', 'top_ups_end', 'access']);
    expect(p.preSuper.progressRatio).toBe('1');
  });
});

describe('projectFire: KPIs, progress and milestones (§2.5 steps 5, 7, 8)', () => {
  it('clamps progress to 0–1 with the true figures beside it', () => {
    expect(
      run({ preSuperCents: -5_000_000, preSuperDebtCents: 20_000_000 }).preSuper.progressRatio,
    ).toBe('0');
    expect(run({ superCents: 100_000_000 }).super.progressRatio).toBe('1');
    expect(run({ superCents: 0 }).super.progressRatio).toBe('0');
  });

  it('values the self-sustaining super at FIRE start as target ÷ q(bridge) (no "− 2")', () => {
    const p = run();
    expect(p.target?.superAtFireStartCents).toBe(68_384_335);
    expect(p.super.neededAtFireCents).toBe(68_384_335);
  });

  it('merges nothing itself: ties keep the kind order (top-ups end and access in one year)', () => {
    const p = run({ superContributionPerYearCents: 0 });
    expect(p.milestones.map((m) => [m.kind, m.year])).toEqual([
      ['today', 2030],
      ['fire_start', 2032],
      ['top_ups_end', 2035],
      ['access', 2035],
    ]);
  });
});

describe('projectFire: savings and extra savings (§2.5 step 1)', () => {
  it('floors P + X at 0; a positive X adds', () => {
    expect(run({ extraSavingsPerYearCents: -5_000_000 }).savingsPerYearCents).toBe(0);
    expect(run({ extraSavingsPerYearCents: -1_000_000 }).savingsPerYearCents).toBe(2_000_000);
    expect(run({ extraSavingsPerYearCents: 1_000_000 }).savingsPerYearCents).toBe(4_000_000);
    expect(run({ extraSavingsPerYearCents: -5_000_000 }).rows[0]!.preSuper.savedCents).toBe(0);
  });

  it('treats P null as 0 with a flag; X still applies', () => {
    const p = run({ savingsPerYearCents: null, extraSavingsPerYearCents: 500_000 });
    expect(p.noSavingsHistory).toBe(true);
    expect(p.savingsPerYearCents).toBe(500_000);
  });
});

describe('projectFire: the time rules (§2.1)', () => {
  it('steps the age and n on 1 January while no balance moves', () => {
    const dec31 = run({ asOf: '2030-12-31' });
    const jan1 = run({ asOf: '2031-01-01' });
    expect([dec31.ageNow, dec31.yearsToAccess]).toEqual([55, 5]);
    expect([jan1.ageNow, jan1.yearsToAccess]).toEqual([56, 4]);
    expect(jan1.rows[0]!.year).toBe(2031);
    expect(jan1.rows[0]!.preSuper.startCents).toBe(dec31.rows[0]!.preSuper.startCents);
  });

  it('labels row t with YEAR(asOf) + t and the age YEAR(asOf) + t − birth year', () => {
    const p = run();
    p.rows.forEach((r) => {
      expect(r.year).toBe(2030 + r.t);
      expect(r.age).toBe(55 + r.t);
    });
  });
});

describe('projectFire: decimal-only maths', () => {
  it('computes the example’s factors exactly: q(5) = 1.2166529024', () => {
    // B(5) with C = 0 from 600,000: 729,991.7414 → 729,991.74.
    const p = run({
      savingsPerYearCents: 0,
      superContributionPerYearCents: 0,
      preSuperCents: 6_000_000,
    });
    expect(p.rows[5]!.super.startCents).toBe(
      D('600000').times('1.2166529024').times(100).round().toNumber(),
    );
  });
});
