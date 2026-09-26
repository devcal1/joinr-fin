// Investment timing (stage-2.md §2.12; §7.3 step 8) and the cash-deficit wait (stage-3.md §2.12;
// §7.3 step 9). Generic, hand-worked figures.
import type { AssetClass } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  budgetInvestment,
  cashDeficitMonths,
  considerNext,
  investCountdown,
  nextBuyHint,
  parcelOptimiser,
  sheetDate,
  type BudgetInvestInput,
  type ConsiderNextResult,
  type HoldingResult,
} from '../src/index';

const base: BudgetInvestInput = {
  asOf: '2026-09-24',
  payFrequency: 'fortnightly',
  netPayCents: 200_000,
  includeSideIncome: false,
  sideIncomePeriods: [
    { periodStart: '2026-06-01', periodEnd: '2026-06-30', amountCents: 60_000 },
    { periodStart: '2026-07-01', periodEnd: '2026-07-31', amountCents: 40_000 },
    { periodStart: '2026-08-01', periodEnd: '2026-08-31', amountCents: 50_000 },
  ],
  items: [
    { kind: 'item', monthlyCents: 150_000 },
    { kind: 'item', monthlyCents: 80_000 },
    { kind: 'item', monthlyCents: null },
    { kind: 'auto_invest', monthlyCents: 99_999 },
  ],
  yearlyExpenseAnnualCents: [120_000, 60_000],
  autoInvestSplit: true,
  useBudgetForInvest: true,
  cashTargetRatio: '0.2',
  aggressiveness: 'normal',
  lastSnapshotCashShare: '0.25',
  currentCashShare: '0.9',
  cashCents: 1_000_000,
  emergencyFundMonths: 3,
  emergencyFundOverrideCents: null,
  marginalTaxRate: '0.3',
  lastPurchaseDate: '2026-07-15',
};
const budget = (over: Partial<BudgetInvestInput> = {}) => budgetInvestment({ ...base, ...over });

describe('budgetInvestment (§2.12)', () => {
  it('runs the whole chain', () => {
    // Income 2000 × 4.34523783659 × 0.5; items 2300 + yearly fund ROUNDUP(1800 / 60) × 5 = 150;
    // leftover 1895.24; emergency ROUNDUP(3 × 2450 / 1000) × 1000 = 8000; cash share
    // ROUNDUP(0.2 + 2 × (0.2 − 0.25), 2) = 0.1; investment row ROUNDDOWN(189.52 × 0.9) × 10 = 1700;
    // cash row ROUNDDOWN(189.52 × 0.1) × 10 = 180; side 0.9 × 0.7 × mean(400, 500) = 283.5.
    expect(budget()).toEqual({
      monthlyIncomeCents: 434_524,
      yearlyFundCents: 15_000,
      plannedSpendCents: 245_000,
      leftoverCents: 189_524,
      emergencyFundCents: 800_000,
      cashShareRatio: '0.1',
      investShareRatio: '0.9',
      investmentRowCents: 170_000,
      cashRowCents: 18_000,
      sideIncomeInvestCents: 28_350,
      monthlyInvestCents: 198_350,
      missing: [],
    });
  });

  it('applies each pay frequency factor', () => {
    const income = (payFrequency: BudgetInvestInput['payFrequency']) =>
      budget({ payFrequency }).monthlyIncomeCents;
    expect(income('monthly')).toBe(200_000);
    expect(income('four_weekly')).toBe(216_667);
    expect(income('fortnightly')).toBe(434_524);
    expect(income('weekly')).toBe(869_048);
    expect(income('twice_monthly')).toBe(400_000);
  });

  it('adds the 365-day side-income mean when included', () => {
    expect(budget({ includeSideIncome: true }).monthlyIncomeCents).toBe(484_524);
    expect(
      budget({
        includeSideIncome: true,
        sideIncomePeriods: [
          { periodStart: '2025-09-24', periodEnd: '2025-10-23', amountCents: 999_900 },
          { periodStart: '2025-09-25', periodEnd: '2025-10-24', amountCents: 20_000 },
        ],
      }).monthlyIncomeCents,
    ).toBe(454_524);
  });

  it('rounds the cash share up at 2 dp, away from zero, and clamps it to [0, 1]', () => {
    expect(
      budget({ aggressiveness: 'light', lastSnapshotCashShare: '0.1985' }).cashShareRatio,
    ).toBe('0.21');
    expect(budget({ aggressiveness: 'aggressive', lastSnapshotCashShare: '0.6' })).toMatchObject({
      cashShareRatio: '0',
      investShareRatio: '1',
    });
    expect(budget({ cashTargetRatio: '0.5', lastSnapshotCashShare: '0' }).cashShareRatio).toBe('1');
  });

  it('rounds the rows down toward zero in whole tens, including a negative leftover', () => {
    const r = budget({ payFrequency: 'monthly', netPayCents: 100_000 });
    expect(r.leftoverCents).toBe(-145_000);
    expect(r.investmentRowCents).toBe(-130_000);
    expect(r.cashRowCents).toBe(-14_000);
  });

  it('rounds the yearly fund up to the next $5 and the emergency fund to the next $1000', () => {
    expect(budget({ yearlyExpenseAnnualCents: [181_000] }).yearlyFundCents).toBe(15_500);
    expect(budget({ emergencyFundMonths: 2 }).emergencyFundCents).toBe(500_000);
  });

  it('uses the emergency fund override', () => {
    expect(
      budget({ emergencyFundOverrideCents: 500_000, emergencyFundMonths: null }),
    ).toMatchObject({
      emergencyFundCents: 500_000,
      missing: [],
    });
  });

  it('with no months and no override: no emergency fund and no cash-first override', () => {
    const r = budget({ emergencyFundMonths: null, cashCents: 0 });
    expect(r.emergencyFundCents).toBeNull();
    expect(r.cashShareRatio).toBe('0.1');
    expect(r.missing).toEqual(['budget.emergencyFundMonths']);
  });

  it('puts everything into cash while cash is below the emergency fund (use budget on)', () => {
    const r = budget({ cashCents: 700_000 });
    expect(r).toMatchObject({ cashShareRatio: '1', investShareRatio: '0', investmentRowCents: 0 });
    expect(r.monthlyInvestCents).toBe(0);
    expect(budget({ cashCents: 700_000, useBudgetForInvest: false }).cashShareRatio).toBe('0.1');
  });

  it('falls back to the current cash share, then to 0', () => {
    const current = budget({ lastSnapshotCashShare: null });
    expect(current.cashShareRatio).toBe('0');
    expect(current.missing).toEqual(['snapshots']);
    const none = budget({ lastSnapshotCashShare: null, currentCashShare: null });
    expect(none.cashShareRatio).toBe('0.6');
  });

  it('uses monthly income at the invest share when the budget switch is off', () => {
    // 4345.23783659 × 0.9 + 283.5.
    expect(budget({ useBudgetForInvest: false }).monthlyInvestCents).toBe(419_421);
  });

  it('with the auto split off, invests the typed amount and puts the rest in the cash row (D54)', () => {
    // stage-3.md §2.9 step 9: the auto_invest row's typed 999.99 is the investment row; the cash
    // row is ROUNDDOWN((1895.24 − 999.99) / 10) × 10 = 890; D40 adds the side income: 1283.49.
    expect(budget({ autoInvestSplit: false })).toMatchObject({
      investmentRowCents: 99_999,
      cashRowCents: 89_000,
      monthlyInvestCents: 128_349,
    });
    // No typed amount (the template's formula row imports as null): the whole leftover is cash.
    const untyped = base.items.map((i) =>
      i.kind === 'auto_invest' ? { ...i, monthlyCents: null } : i,
    );
    expect(budget({ autoInvestSplit: false, items: untyped })).toMatchObject({
      investmentRowCents: 0,
      cashRowCents: 189_000,
      monthlyInvestCents: 28_350,
    });
  });

  it('averages every filled side-income period that ends after the last buy', () => {
    expect(budget({ lastPurchaseDate: '2026-06-15' }).sideIncomeInvestCents).toBe(31_500);
    expect(budget({ lastPurchaseDate: '2026-08-31' }).sideIncomeInvestCents).toBe(0);
    expect(budget({ lastPurchaseDate: null })).toMatchObject({
      sideIncomeInvestCents: 0,
      missing: ['investments.lastPurchaseDate'],
    });
    expect(budget({ marginalTaxRate: null })).toMatchObject({
      sideIncomeInvestCents: 0,
      monthlyInvestCents: 170_000,
      missing: ['tax.marginalRate'],
    });
  });

  it('reports every missing input and nulls the amount where §2.12 says so', () => {
    const nulled = (over: Partial<BudgetInvestInput>) => budget(over).monthlyInvestCents;
    expect(nulled({ netPayCents: null })).toBeNull();
    expect(nulled({ payFrequency: null })).toBeNull();
    expect(nulled({ cashTargetRatio: null })).toBeNull();
    expect(nulled({ autoInvestSplit: null })).toBeNull();
    expect(nulled({ useBudgetForInvest: null })).toBeNull();
    expect(budget({ netPayCents: null })).toMatchObject({
      monthlyIncomeCents: null,
      leftoverCents: null,
      investmentRowCents: null,
      cashRowCents: null,
      missing: ['pay.netPayCents'],
    });
    expect(budget({ cashTargetRatio: null })).toMatchObject({
      cashShareRatio: null,
      investShareRatio: null,
      sideIncomeInvestCents: 0,
      missing: ['allocation.cash'],
    });
    expect(budget({ aggressiveness: null })).toMatchObject({
      cashShareRatio: '0.05',
      missing: ['investing.allocationAggressiveness'],
    });
    expect(budget({ items: [{ kind: 'auto_invest', monthlyCents: 1 }] }).missing).toEqual([
      'budget.items',
    ]);
    const all = budgetInvestment({
      ...base,
      payFrequency: null,
      netPayCents: null,
      items: [],
      autoInvestSplit: null,
      useBudgetForInvest: null,
      cashTargetRatio: null,
      aggressiveness: null,
      lastSnapshotCashShare: null,
      emergencyFundMonths: null,
      marginalTaxRate: null,
      lastPurchaseDate: null,
    });
    expect(all.missing).toEqual([
      'pay.netPayCents',
      'pay.frequency',
      'budget.items',
      'budget.useForInvestAmount',
      'budget.autoInvestSplit',
      'allocation.cash',
      'investing.allocationAggressiveness',
      'budget.emergencyFundMonths',
      'snapshots',
      'tax.marginalRate',
      'investments.lastPurchaseDate',
    ]);
    expect(all.monthlyInvestCents).toBeNull();
  });
});

describe('parcelOptimiser (§2.12, inferred)', () => {
  const opt = (over: Partial<Parameters<typeof parcelOptimiser>[0]> = {}) =>
    parcelOptimiser({
      monthlyInvestCents: 60_000,
      brokerageCents: 1000,
      growthRatio: '0.07',
      cashRateRatio: '0.05',
      ...over,
    });

  it('balances brokerage against the return edge: sqrt(2 × 10 × 7200 / 0.02) = 2683.28 → 5 months', () => {
    expect(opt()).toEqual({ months: 5, parcelCents: 300_000, optimalParcelCents: 268_328 });
  });

  it('is null without a positive amount or with a missing input', () => {
    expect(opt({ monthlyInvestCents: null })).toBeNull();
    expect(opt({ monthlyInvestCents: 0 })).toBeNull();
    expect(opt({ monthlyInvestCents: -100 })).toBeNull();
    expect(opt({ brokerageCents: null })).toBeNull();
    expect(opt({ growthRatio: null })).toBeNull();
    expect(opt({ cashRateRatio: null })).toBeNull();
  });

  it('buys monthly without brokerage and waits 12 months without a return edge', () => {
    expect(opt({ brokerageCents: 0 })).toEqual({
      months: 1,
      parcelCents: 60_000,
      optimalParcelCents: 60_000,
    });
    expect(opt({ growthRatio: '0.05' })).toEqual({
      months: 12,
      parcelCents: 720_000,
      optimalParcelCents: 720_000,
    });
  });

  it('clamps the months to 1–12', () => {
    expect(
      opt({
        monthlyInvestCents: 1000,
        brokerageCents: 2000,
        growthRatio: '0.06',
        cashRateRatio: '0.05',
      }),
    ).toEqual({ months: 12, parcelCents: 12_000, optimalParcelCents: 69_282 });
    expect(
      opt({
        monthlyInvestCents: 10_000_000,
        brokerageCents: 100,
        growthRatio: '0.1',
        cashRateRatio: '0.05',
      }),
    ).toEqual({ months: 1, parcelCents: 10_000_000, optimalParcelCents: 692_820 });
  });
});

describe('investCountdown (§2.12)', () => {
  const plan = { months: 1, parcelCents: 60_000, optimalParcelCents: 60_000 };
  const count = (over: Partial<Parameters<typeof investCountdown>[0]> = {}) =>
    investCountdown({
      asOf: '2026-09-24',
      monthlyInvestCents: 60_000,
      plan,
      lastPurchaseDate: '2026-09-11',
      payDayOfMonth: 1,
      growthRatio: '0.07',
      ...over,
    });

  it('rolls forward to a Thursday from each weekday', () => {
    // DATE(2026, 9, pay day + 2) + 30 days = 3–9 October 2026 (Saturday to Friday).
    const next = [1, 2, 3, 4, 5, 6, 7].map((payDayOfMonth) => count({ payDayOfMonth }));
    expect(next.map((c) => (c.state === 'wait' ? c.nextPurchaseDate : c.state))).toEqual([
      '2026-10-08',
      '2026-10-08',
      '2026-10-08',
      '2026-10-08',
      '2026-10-08',
      '2026-10-08',
      '2026-10-15',
    ]);
    expect(next[0]).toEqual({
      state: 'wait',
      days: 14,
      nextPurchaseDate: '2026-10-08',
      periodDays: 30,
    });
  });

  it('uses 30 days per parcel month', () => {
    // 3 September + 120 days = Friday 1 January → Thursday 7 January.
    expect(count({ plan: { ...plan, months: 4 } })).toMatchObject({
      periodDays: 120,
      nextPurchaseDate: '2027-01-07',
    });
  });

  it('adds 365 days when growth is 0 (the template quirk)', () => {
    expect(count({ growthRatio: '0' })).toEqual({
      state: 'wait',
      days: 379,
      nextPurchaseDate: '2027-10-08',
      periodDays: 30,
    });
  });

  it('says invest from the purchase date on', () => {
    expect(count({ asOf: '2026-10-08' })).toEqual({
      state: 'invest',
      nextPurchaseDate: '2026-10-08',
      periodDays: 30,
    });
    expect(count({ asOf: '2026-10-07' })).toMatchObject({ state: 'wait', days: 1 });
    expect(count({ asOf: '2027-01-01' })).toMatchObject({ state: 'invest' });
  });

  it('rolls DATE() overflow like the sheet', () => {
    // DATE(2026, 2, 30) = 2 March; + 30 days = Wednesday 1 April → Thursday 2 April.
    expect(sheetDate(2026, 2, 30)).toBe('2026-03-02');
    expect(
      count({ lastPurchaseDate: '2026-02-10', payDayOfMonth: 28, asOf: '2026-03-20' }),
    ).toEqual({
      state: 'wait',
      days: 13,
      nextPurchaseDate: '2026-04-02',
      periodDays: 30,
    });
  });

  it('is cash first with nothing to invest and unavailable without its inputs', () => {
    expect(count({ monthlyInvestCents: 0 })).toEqual({ state: 'cash_first' });
    expect(count({ monthlyInvestCents: null })).toEqual({ state: 'unavailable', missing: [] });
    expect(count({ plan: null })).toEqual({ state: 'unavailable', missing: [] });
    expect(count({ plan: null, growthRatio: null })).toEqual({
      state: 'unavailable',
      missing: ['returns.marketReturn'],
    });
    expect(count({ lastPurchaseDate: null, payDayOfMonth: null })).toEqual({
      state: 'unavailable',
      missing: ['investments.lastPurchaseDate', 'pay.dayOfMonth'],
    });
  });

  it('says the automatic split is off, not cash first, when the budget drives the amount (D46)', () => {
    const off = { useBudgetForInvest: true, autoInvestSplit: false } as const;
    expect(count({ monthlyInvestCents: 0, ...off })).toEqual({ state: 'split_off' });
    expect(count({ monthlyInvestCents: -100, ...off })).toEqual({ state: 'split_off' });
    // Only that combination: the income-based amount, a split that is on or unknown, or no
    // switches at all (the optional inputs omitted) stay cash first.
    for (const switches of [
      { useBudgetForInvest: false, autoInvestSplit: false },
      { useBudgetForInvest: true, autoInvestSplit: true },
      { useBudgetForInvest: null, autoInvestSplit: false },
      { useBudgetForInvest: true, autoInvestSplit: null },
      {},
    ]) {
      expect(count({ monthlyInvestCents: 0, ...switches })).toEqual({ state: 'cash_first' });
    }
    // Something to invest still counts down; a missing amount is still unavailable.
    expect(count(off)).toMatchObject({ state: 'wait', nextPurchaseDate: '2026-10-08' });
    expect(count({ monthlyInvestCents: null, ...off })).toEqual({
      state: 'unavailable',
      missing: [],
    });
  });

  it('chains the budget into the countdown with the automatic split off (D46)', () => {
    // No typed investment amount (D54: a typed one would be invested; see budgetInvestment).
    const items = base.items.map((i) =>
      i.kind === 'auto_invest' ? { ...i, monthlyCents: null } : i,
    );
    const off = { useBudgetForInvest: true, autoInvestSplit: false } as const;
    // No side income since the last buy: the investment row is $0 and the leftover goes to cash.
    const none = budget({ ...off, items, lastPurchaseDate: '2026-08-31' });
    expect(none).toMatchObject({
      investmentRowCents: 0,
      cashRowCents: 189_000,
      sideIncomeInvestCents: 0,
      monthlyInvestCents: 0,
    });
    const plan0 = parcelOptimiser({
      monthlyInvestCents: none.monthlyInvestCents,
      brokerageCents: 1000,
      growthRatio: '0.07',
      cashRateRatio: '0.05',
    });
    expect(plan0).toBeNull();
    expect(count({ monthlyInvestCents: none.monthlyInvestCents, plan: plan0, ...off })).toEqual({
      state: 'split_off',
    });
    // After-tax side income is still invested (as before D46), so the countdown runs.
    const side = budget({ ...off, items });
    expect(side.monthlyInvestCents).toBe(28_350);
    expect(count({ monthlyInvestCents: side.monthlyInvestCents, ...off })).toMatchObject({
      state: 'wait',
    });
  });
});

describe('cashDeficitMonths (SheetOptions H12, §2.12)', () => {
  const wait = (over: Partial<Parameters<typeof cashDeficitMonths>[0]> = {}) =>
    cashDeficitMonths({
      cashCents: 150_000,
      liquidTotalCents: 1_000_000,
      targetRatio: '0.2',
      avgMonthlySavingsCents: 12_000,
      ...over,
    });

  it('sizes the shortfall on the liquid total: floor((0.2 × 10,000 − 1,500) / 120) + 1', () => {
    // The sheet multiplied the 0.05 share gap by the cash (75 → 1 month; §11 fix 16).
    expect(wait()).toBe(5);
    // A shortfall of exactly 4 months of savings still waits the extra month (ROUNDDOWN + 1).
    expect(wait({ avgMonthlySavingsCents: 12_500 })).toBe(5);
    expect(wait({ avgMonthlySavingsCents: 100_000 })).toBe(1);
  });

  it('is null at or above the target, without a target or without positive savings', () => {
    expect(wait({ cashCents: 200_000 })).toBeNull();
    expect(wait({ cashCents: 300_000 })).toBeNull();
    expect(wait({ targetRatio: null })).toBeNull();
    expect(wait({ avgMonthlySavingsCents: null })).toBeNull();
    expect(wait({ avgMonthlySavingsCents: 0 })).toBeNull();
    expect(wait({ avgMonthlySavingsCents: -5_000 })).toBeNull();
    expect(wait({ liquidTotalCents: 0 })).toBeNull();
    expect(wait({ liquidTotalCents: -1_000 })).toBeNull();
  });
});

describe('investCountdown with the cash-deficit wait (H14 = MAX(H12:H13))', () => {
  const plan = { months: 1, parcelCents: 60_000, optimalParcelCents: 60_000 };
  const count = (over: Partial<Parameters<typeof investCountdown>[0]> = {}) =>
    investCountdown({
      asOf: '2026-09-24',
      monthlyInvestCents: 60_000,
      plan,
      lastPurchaseDate: '2026-09-11',
      payDayOfMonth: 1,
      growthRatio: '0.07',
      ...over,
    });

  it('waits the longer of the parcel plan and the cash-deficit months', () => {
    const deficit = count({ cashDeficitMonths: 5 });
    expect(deficit).toMatchObject({ state: 'wait', periodDays: 150 });
    expect(deficit).toEqual(count({ plan: { ...plan, months: 5 } }));
    expect(count({ plan: { ...plan, months: 4 }, cashDeficitMonths: 2 })).toMatchObject({
      periodDays: 120,
    });
  });

  it('keeps the plan without a deficit and rejects a malformed one', () => {
    expect(count({ cashDeficitMonths: null })).toEqual(count());
    expect(count({ cashDeficitMonths: 0 })).toEqual(count());
    expect(() => count({ cashDeficitMonths: 1.5 })).toThrow(RangeError);
    expect(() => count({ cashDeficitMonths: -1 })).toThrow(RangeError);
  });
});

type Classes = Record<AssetClass, { valueCents: number; targetRatio: string | null }>;

describe('considerNext (§2.12)', () => {
  const classes: Classes = {
    etf: { valueCents: 300_000, targetRatio: '0.5' },
    stock: { valueCents: 100_000, targetRatio: '0.2' },
    crypto: { valueCents: 0, targetRatio: '0.05' },
    cash: { valueCents: 500_000, targetRatio: '0.2' },
    managed_fund: { valueCents: 100_000, targetRatio: '0.05' },
    other_assets: { valueCents: 0, targetRatio: null },
  };

  it('picks the most underweight class and lists every class in order', () => {
    const r = considerNext({ classes, cashCents: 500_000, emergencyFundCents: 400_000 });
    expect(r.assetClass).toBe('etf');
    expect(r.reason).toBe('most_underweight');
    expect(r.rows).toEqual([
      {
        assetClass: 'etf',
        valueCents: 300_000,
        currentRatio: '0.3',
        targetRatio: '0.5',
        deltaRatio: '-0.2',
      },
      {
        assetClass: 'stock',
        valueCents: 100_000,
        currentRatio: '0.1',
        targetRatio: '0.2',
        deltaRatio: '-0.1',
      },
      {
        assetClass: 'crypto',
        valueCents: 0,
        currentRatio: '0',
        targetRatio: '0.05',
        deltaRatio: '-0.05',
      },
      {
        assetClass: 'cash',
        valueCents: 500_000,
        currentRatio: '0.5',
        targetRatio: '0.2',
        deltaRatio: '0.3',
      },
      {
        assetClass: 'managed_fund',
        valueCents: 100_000,
        currentRatio: '0.1',
        targetRatio: '0.05',
        deltaRatio: '0.05',
      },
      {
        assetClass: 'other_assets',
        valueCents: 0,
        currentRatio: '0',
        targetRatio: null,
        deltaRatio: null,
      },
    ]);
  });

  it('says cash first while cash is below the emergency fund', () => {
    const r = considerNext({ classes, cashCents: 300_000, emergencyFundCents: 400_000 });
    expect([r.assetClass, r.reason]).toEqual(['cash', 'below_emergency_fund']);
    const unknown = considerNext({ classes, cashCents: 0, emergencyFundCents: null });
    expect(unknown.reason).toBe('most_underweight');
  });

  it('breaks ties in ASSET_CLASSES order', () => {
    const tie = considerNext({
      classes: {
        ...classes,
        etf: { valueCents: 300_000, targetRatio: '0.3' },
        stock: { valueCents: 0, targetRatio: '0.1' },
        crypto: { valueCents: 0, targetRatio: '0.1' },
      },
      cashCents: 500_000,
      emergencyFundCents: null,
    });
    expect(tie.assetClass).toBe('stock');
  });

  it('has no suggestion without targets, and zero shares when nothing has value', () => {
    const none = Object.fromEntries(
      Object.entries(classes).map(([k, v]) => [k, { ...v, targetRatio: null }]),
    ) as Classes;
    expect(considerNext({ classes: none, cashCents: 0, emergencyFundCents: null })).toMatchObject({
      assetClass: null,
      reason: 'no_targets',
    });
    const empty = Object.fromEntries(
      Object.entries(classes).map(([k, v]) => [k, { ...v, valueCents: 0 }]),
    ) as Classes;
    const r = considerNext({ classes: empty, cashCents: 0, emergencyFundCents: null });
    expect(r.rows.every((row) => row.currentRatio === '0')).toBe(true);
    expect(r.assetClass).toBe('etf');
  });
});

describe('nextBuyHint (§2.12)', () => {
  const holding = (
    instrumentId: number,
    over: Partial<HoldingResult> &
      Pick<HoldingResult, 'currentRatio' | 'targetRatio' | 'differenceRatio'>,
  ): HoldingResult => ({
    instrumentId,
    status: 'held',
    flags: [],
    netUnits: '1',
    openUnits: '1',
    price: '1',
    priceStatus: 'fresh',
    valueCents: 100,
    costCents: 100,
    unrealisedCents: 0,
    dividendsCents: 0,
    totalReturnCents: 0,
    totalReturnRatio: '0',
    realisedCents: 0,
    xirr: null,
    averagePrice: '1',
    dividendYieldRatio: null,
    estMgmtFeeCents: null,
    lastBuyDate: null,
    lastTradeDate: null,
    ...over,
  });
  const holdings = [
    holding(1, { currentRatio: '0.5', targetRatio: '0.4', differenceRatio: '0.1' }),
    holding(2, { currentRatio: '0.2', targetRatio: '0.4', differenceRatio: '-0.2' }),
    holding(3, { currentRatio: '0.3', targetRatio: '0.5', differenceRatio: '-0.2' }),
    holding(4, {
      currentRatio: null,
      targetRatio: '0.9',
      differenceRatio: null,
      flags: ['unpriced'],
    }),
    holding(5, {
      currentRatio: '0',
      targetRatio: '0.9',
      differenceRatio: '-0.9',
      flags: ['unwatched_held'],
    }),
    holding(6, { status: 'exited', currentRatio: null, targetRatio: '0.9', differenceRatio: null }),
  ];
  const consider = (assetClass: ConsiderNextResult['assetClass']): ConsiderNextResult => ({
    assetClass,
    reason: assetClass === null ? 'no_targets' : 'most_underweight',
    rows: [],
  });

  it('picks the watched holding with the lowest difference (ties in holding order)', () => {
    expect(
      nextBuyHint({ kind: 'etf', considerNext: consider('etf'), holdings, parcelCents: 150_000 }),
    ).toEqual({
      assetClass: 'etf',
      instrumentId: 2,
      parcelCents: 150_000,
    });
  });

  it('skips held unpriced holdings and unwatched ones', () => {
    const r = nextBuyHint({
      kind: 'etf',
      considerNext: consider('etf'),
      holdings: holdings.slice(3),
      parcelCents: 1,
    });
    expect(r).toEqual({ assetClass: 'etf', instrumentId: null, parcelCents: null });
  });

  it('names only the class when another class is suggested', () => {
    expect(
      nextBuyHint({ kind: 'crypto', considerNext: consider('etf'), holdings, parcelCents: 1 }),
    ).toEqual({
      assetClass: 'etf',
      instrumentId: null,
      parcelCents: null,
    });
    expect(
      nextBuyHint({ kind: 'etf', considerNext: consider(null), holdings, parcelCents: 1 }),
    ).toEqual({
      assetClass: null,
      instrumentId: null,
      parcelCents: null,
    });
  });
});
