// The live Budget (stage-3.md §2.9; D53, D54, D61; §7.3 step 7). Generic items, accounts and
// round amounts; each figure is worked from the template's formulas.
import { PAY_FREQUENCIES, type PayFrequency } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  budgetInvestInputOf,
  budgetInvestment,
  computeBudget,
  type BudgetInput,
  type BudgetRowInput,
} from '../src/index';
import { cents, D, ratio } from './helpers';

const WEEKS = D('4.34523783659');
const INCOME = D(2000).times(WEEKS).times('0.5'); // fortnightly 2,000 → 4,345.2378… a month

const row = (
  id: number,
  kind: BudgetRowInput['kind'],
  name: string | null,
  monthlyCents: number | null,
  category: string | null,
  accountId: number | null,
  accountName: string | null,
): BudgetRowInput => ({ id, kind, name, monthlyCents, category, accountId, accountName });

const rows: BudgetRowInput[] = [
  row(1, 'item', 'Rent', 150_000, 'Living', 1, 'Everyday account'),
  row(2, 'item', 'Groceries', 80_000, ' Living ', 1, 'Everyday account'),
  row(3, 'item', 'Emergency top-up', 20_000, 'Savings', 2, 'Savings account'),
  row(4, 'auto_yearly', 'Yearly expenses', null, 'Expenses', 2, 'Savings account'),
  row(5, 'item', 'Streaming', 2_000, null, null, 'Old card'), // a stale account name
  row(6, 'item', 'Gym', 5_000, 'Health', null, null), // no account at all
  row(7, 'auto_invest', 'Investment savings', null, 'Savings', 3, 'Broker account'),
  row(8, 'auto_cash', 'Cash savings', null, null, 2, 'Savings account'),
];

const input: BudgetInput = {
  asOf: '2026-09-24',
  payFrequency: 'fortnightly',
  netPayCents: 200_000,
  includeSideIncome: false,
  sideIncomePeriods: [],
  rows,
  yearlyExpenses: [
    { id: 1, name: 'Insurance', annualCents: 120_000 },
    { id: 2, name: 'Registration', annualCents: 60_000 },
  ],
  autoInvestSplit: true,
  useBudgetForInvest: true,
  cashTargetRatio: '0.2',
  aggressiveness: 'normal',
  lastSnapshotCashShare: '0.25',
  currentCashShare: null,
  cashCents: 1_000_000,
  emergencyFundMonths: 3,
  emergencyFundOverrideCents: null,
  marginalTaxRate: '0.3',
  lastPurchaseDate: '2026-07-15',
};
const budget = (over: Partial<BudgetInput> = {}) => computeBudget({ ...input, ...over });

describe('computeBudget (§2.9)', () => {
  const r = budget();

  it('runs the shared chain: income, planned spend, leftover, emergency fund and the split', () => {
    // Items 2,570 + the yearly fund ROUNDUP(1,800 / 60) × 5 = 150 → planned 2,720; leftover
    // 1,625.24; emergency fund ROUNDUP(3 × 2,720 / 1,000) × 1,000 = 9,000 (the sheet's basis, D61);
    // cash share ROUNDUP(0.2 + 2 × (0.2 − 0.25), 2) = 0.1: rows 1,460 and 160.
    expect(r.invest).toMatchObject({
      monthlyIncomeCents: 434_524,
      yearlyFundCents: 15_000,
      plannedSpendCents: 272_000,
      leftoverCents: 162_524,
      emergencyFundCents: 900_000,
      investShareRatio: '0.9',
      investmentRowCents: 146_000,
      cashRowCents: 16_000,
      monthlyInvestCents: 146_000,
    });
    expect(r.invest).toEqual(budgetInvestment(budgetInvestInputOf(input)));
    expect(r).toMatchObject({
      annualIncomeCents: cents(INCOME.times(12)),
      yearlySavingsCents: cents(INCOME.minus(2720).times(12)),
      plannedSavingsRatio: ratio(D(1620).div(INCOME)),
      unallocatedCents: 524,
      emergencyFundBasisCents: 272_000,
      investManual: false,
    });
  });

  it('returns every row in order with the auto rows computed', () => {
    expect(
      r.rows.map((x) => [x.id, x.kind, x.monthlyCents, x.derived, x.manual, x.savingsLine]),
    ).toEqual([
      [1, 'item', 150_000, false, false, false],
      [2, 'item', 80_000, false, false, false],
      [3, 'item', 20_000, false, false, true],
      [4, 'auto_yearly', 15_000, true, false, false],
      [5, 'item', 2_000, false, false, false],
      [6, 'item', 5_000, false, false, false],
      [7, 'auto_invest', 146_000, true, false, false],
      [8, 'auto_cash', 16_000, true, false, false],
    ]);
    expect(r.rows[0]).toEqual({
      id: 1,
      kind: 'item',
      name: 'Rent',
      monthlyCents: 150_000,
      incomeShareRatio: ratio(D(1500).div(INCOME)),
      weeklyCents: cents(D(1500).div(WEEKS)),
      yearlyCents: 1_800_000,
      category: 'Living',
      accountId: 1,
      accountName: 'Everyday account',
      savingsLine: false,
      derived: false,
      manual: false,
    });
    expect(r.yearlyExpenses).toEqual([
      { id: 1, name: 'Insurance', annualCents: 120_000, monthlyCents: 10_000 },
      { id: 2, name: 'Registration', annualCents: 60_000, monthlyCents: 5_000 },
    ]);
  });

  it('groups the payday transfers by account in first-appearance order (A35:B, §11 fix 17)', () => {
    const perPay = (monthly: number) => cents(D(monthly).div(100).times(2).div(WEEKS));
    expect(r.transfers).toEqual([
      {
        accountId: 1,
        accountName: 'Everyday account',
        perPayCents: perPay(230_000),
        monthlyCents: 230_000,
        rows: 2,
      },
      {
        accountId: 2,
        accountName: 'Savings account',
        perPayCents: perPay(51_000),
        monthlyCents: 51_000,
        rows: 3,
      },
      {
        accountId: null,
        accountName: 'Old card',
        perPayCents: perPay(2_000),
        monthlyCents: 2_000,
        rows: 1,
      },
      {
        accountId: 3,
        accountName: 'Broker account',
        perPayCents: perPay(146_000),
        monthlyCents: 146_000,
        rows: 1,
      },
    ]);
    expect(r.unassigned).toEqual({ perPayCents: perPay(5_000), monthlyCents: 5_000, rows: 1 });
    expect(r.perPayTotalCents).toBe(
      [230_000, 51_000, 2_000, 146_000, 5_000].reduce((a, m) => a + perPay(m), 0),
    );
  });

  it('computes the per-pay amount for every pay frequency', () => {
    const one = [row(1, 'item', 'Rent', 100_000, null, 1, 'Everyday account')];
    const perPay = (payFrequency: PayFrequency | null) =>
      budget({ rows: one, payFrequency }).transfers.find((t) => t.accountId === 1)!.perPayCents;
    expect(perPay('monthly')).toBe(100_000);
    expect(perPay('twice_monthly')).toBe(50_000);
    expect(perPay('weekly')).toBe(cents(D(1000).div(WEEKS)));
    expect(perPay('fortnightly')).toBe(cents(D(2000).div(WEEKS)));
    expect(perPay('four_weekly')).toBe(cents(D(4000).div(WEEKS)));
    expect(PAY_FREQUENCIES).toHaveLength(5);
    // Without a pay frequency there is no pay day: 0 per pay and no total.
    expect(perPay(null)).toBe(0);
    expect(budget({ payFrequency: null }).perPayTotalCents).toBeNull();
  });

  it('sums monthly amounts by trimmed category, largest first, with no category last', () => {
    expect(r.byCategory).toEqual([
      { category: 'Living', monthlyCents: 230_000 },
      { category: 'Savings', monthlyCents: 166_000 },
      { category: 'Expenses', monthlyCents: 15_000 },
      { category: 'Health', monthlyCents: 5_000 },
      { category: null, monthlyCents: 18_000 },
    ]);
  });

  it('keeps a savings line in the emergency-fund basis: the flag is display only (D61)', () => {
    const other = budget({
      rows: rows.map((x) => (x.id === 3 ? { ...x, category: 'Other' } : x)),
    });
    expect(other.rows[2]!.savingsLine).toBe(false);
    expect(other.invest.emergencyFundCents).toBe(r.invest.emergencyFundCents);
    expect(other.emergencyFundBasisCents).toBe(r.emergencyFundBasisCents);
    expect(
      budget({ rows: rows.map((x) => (x.id === 3 ? { ...x, category: ' SAVINGS ' } : x)) }).rows[2]!
        .savingsLine,
    ).toBe(true);
  });

  it('with the split off takes the typed investment amount (D54) and leaves the rest to cash', () => {
    const typed = (monthlyCents: number | null) =>
      budget({
        autoInvestSplit: false,
        rows: rows.map((x) => (x.kind === 'auto_invest' ? { ...x, monthlyCents } : x)),
      });
    const zero = typed(0);
    expect(zero).toMatchObject({ investManual: true, unallocatedCents: 524 });
    expect(zero.invest).toMatchObject({ investmentRowCents: 0, cashRowCents: 162_000 });
    expect(zero.rows[6]).toMatchObject({
      kind: 'auto_invest',
      monthlyCents: 0,
      manual: true,
      derived: true,
    });
    expect(typed(null).invest).toMatchObject({ investmentRowCents: 0, cashRowCents: 162_000 });

    const below = typed(100_000);
    expect(below.invest).toMatchObject({
      investmentRowCents: 100_000,
      cashRowCents: 62_000,
      monthlyInvestCents: 100_000,
    });
    expect(below.unallocatedCents).toBe(524);

    // Above the leftover: the cash row goes negative (toward zero in tens), unallocated too.
    const above = typed(200_000);
    expect(above.invest).toMatchObject({ investmentRowCents: 200_000, cashRowCents: -37_000 });
    expect(above.unallocatedCents).toBe(-476);
    expect(above.plannedSavingsRatio).toBe(ratio(D(1630).div(INCOME)));
  });

  it('returns a missing automatic row with no id or name', () => {
    const r2 = budget({ rows: rows.filter((x) => x.kind !== 'auto_cash') });
    expect(r2.rows).toHaveLength(8);
    expect(r2.rows.at(-1)).toMatchObject({
      id: null,
      kind: 'auto_cash',
      name: null,
      monthlyCents: 16_000,
      accountId: null,
      accountName: null,
      derived: true,
    });
    // It has no account, so it is unassigned.
    expect(r2.unassigned).toMatchObject({ monthlyCents: 21_000, rows: 2 });
  });

  it('maps rows and yearly expenses to the chain input and back (budgetInvestInputOf)', () => {
    const chain = budgetInvestInputOf(input);
    expect(chain.items).toEqual(rows.map((x) => ({ kind: x.kind, monthlyCents: x.monthlyCents })));
    expect(chain.yearlyExpenseAnnualCents).toEqual([120_000, 60_000]);
    // Every other field is passed through unchanged, and nothing else is added.
    const keys = Object.keys(chain).sort();
    expect(keys).toEqual(
      [
        ...Object.keys(input).filter((k) => k !== 'rows' && k !== 'yearlyExpenses'),
        'items',
        'yearlyExpenseAnnualCents',
      ].sort(),
    );
    for (const key of keys) {
      if (key === 'items' || key === 'yearlyExpenseAnnualCents') continue;
      expect(chain[key as keyof typeof chain]).toEqual(input[key as keyof typeof input]);
    }
  });

  it('has no shares, annual figures or savings rate without income', () => {
    const noPay = budget({ netPayCents: null });
    expect(noPay).toMatchObject({
      annualIncomeCents: null,
      yearlySavingsCents: null,
      plannedSavingsRatio: null,
      unallocatedCents: null,
    });
    expect(noPay.rows.every((x) => x.incomeShareRatio === null)).toBe(true);
    expect(noPay.invest.missing).toContain('pay.netPayCents');
  });
});
