// Property and loans (stage-4.md §2.6; §7.3 step 3): the valuation in force, gain and CAGR, the
// D66 balance log (the start point from the loan's start fields, typed and default repayments on
// the anchored grid, both entry flags, a changed repayment), cumulative figures, offsets (D67),
// equity and LVR, the schedules, the loan flags, totals without a loan that has no property, the
// History X–AE, the savings engine's live parts and the chart. Generic, round figures only.
import { describe, expect, it } from 'vitest';
import {
  amortise,
  computeProperty,
  type EngineLoan,
  type EngineProperty,
  type PropertyInput,
} from '../src/index';
import { monthsBetween } from '../src/periods';
import { D, ratio } from './helpers';

const AS_OF = '2026-09-24';

const HOME: EngineProperty = {
  id: 1,
  purchaseDate: '2024-09-24',
  isPrimaryResidence: true,
  purchaseValueCents: 50_000_000,
  netRentToDateCents: 2_000_000,
  valuations: [
    { id: 1, asOf: '2025-09-24', valueCents: 55_000_000 },
    { id: 3, asOf: '2026-09-25', valueCents: 61_000_000 }, // dated tomorrow: not yet in force
    { id: 2, asOf: '2026-06-30', valueCents: 60_000_000 },
  ],
};

/** A $400,000 mortgage from 15/01/2024 at 6 % monthly, $2,500 a month, a $10,000 offset. */
const MORTGAGE: EngineLoan = {
  id: 1,
  propertyId: 1,
  startDate: '2024-01-15',
  startBalanceCents: 40_000_000,
  annualRate: '0.06',
  compoundingPerYear: 12,
  paymentCents: 250_000,
  paymentFrequency: 'monthly',
  entries: [
    { id: 11, asOf: '2025-01-15', balanceCents: 39_000_000, repaymentsCents: null },
    { id: 12, asOf: '2025-07-15', balanceCents: 38_500_000, repaymentsCents: 1_600_000 },
    { id: 13, asOf: '2026-01-15', balanceCents: 38_700_000, repaymentsCents: null },
    { id: 14, asOf: '2026-07-15', balanceCents: 37_000_000, repaymentsCents: null },
  ],
  offsets: [{ accountId: 5, balanceCents: 1_000_000 }],
};

/** A loan with no property (LiabilitiesDebts is not rebuilt, D2). */
const CAR: EngineLoan = {
  id: 2,
  propertyId: null,
  startDate: null,
  startBalanceCents: null,
  annualRate: '0.08',
  compoundingPerYear: 12,
  paymentCents: 50_000,
  paymentFrequency: 'monthly',
  entries: [{ id: 21, asOf: '2026-08-31', balanceCents: 1_500_000, repaymentsCents: null }],
  offsets: [],
};

function input(over: Partial<PropertyInput> = {}): PropertyInput {
  return {
    asOf: AS_OF,
    properties: [HOME],
    loans: [MORTGAGE, CAR],
    snapshots: [],
    chart: { unit: 'monthly', count: null },
    ...over,
  };
}

const loanOf = (over: Partial<EngineLoan>, i: Partial<PropertyInput> = {}) =>
  computeProperty(input({ loans: [{ ...MORTGAGE, ...over }], ...i })).loans[0]!;

describe('computeProperty: the property (§2.6 steps 1 and 7)', () => {
  it('values at the latest valuation on or before the as-of, gain with net rent, CAGR, equity and LVR', () => {
    const r = computeProperty(input());
    expect(r.properties).toEqual([
      {
        id: 1,
        isPrimaryResidence: true,
        valueCents: 60_000_000,
        valuationDate: '2026-06-30',
        purchaseValueCents: 50_000_000,
        netRentCents: 2_000_000,
        gainCents: 12_000_000,
        gainRatio: '0.24',
        cagrRatio: ratio(D('1.24').pow(D('365.25').div(730)).minus(1)),
        heldDays: 730,
        loanIds: [1],
        // Net of the linked offset (D67): 370,000 − 10,000 owed on 600,000.
        debtCents: 36_000_000,
        equityCents: 60_000_000 - 37_000_000 + 1_000_000,
        lvrRatio: '0.6',
      },
    ]);
  });

  it('uses the earliest valuation when every one is dated after the as-of', () => {
    const r = computeProperty(
      input({
        properties: [
          { ...HOME, valuations: [{ id: 3, asOf: '2026-09-25', valueCents: 61_000_000 }] },
        ],
      }),
    );
    expect(r.properties[0]).toMatchObject({ valueCents: 61_000_000, valuationDate: '2026-09-25' });
  });

  it('has no CAGR without a purchase date, a day held or a purchase price; a zero value has no LVR', () => {
    const row = (p: Partial<EngineProperty>) =>
      computeProperty(input({ properties: [{ ...HOME, ...p }] })).properties[0]!;
    expect(row({ purchaseDate: null })).toMatchObject({ cagrRatio: null, heldDays: null });
    expect(row({ purchaseDate: AS_OF })).toMatchObject({ cagrRatio: null, heldDays: 0 });
    expect(row({ purchaseValueCents: 0 })).toMatchObject({ gainRatio: null, cagrRatio: null });
    expect(row({ netRentToDateCents: -1_000_000 })).toMatchObject({
      gainCents: 9_000_000,
      gainRatio: '0.18',
    });
    const zero = row({ valuations: [{ id: 1, asOf: '2026-01-01', valueCents: 0 }] });
    expect(zero.lvrRatio).toBeNull();
  });
});

describe('computeProperty: the balance log (§2.6 step 3, D66)', () => {
  const loan = computeProperty(input()).loans[0]!;

  it('starts at the loan’s start fields and counts the payments due on the anchored grid', () => {
    expect(loan.entries).toEqual([
      {
        id: null,
        start: true,
        asOf: '2024-01-15',
        balanceCents: 40_000_000,
        paymentsCounted: null,
        repaymentsCents: null,
        repaymentsTyped: false,
        principalCents: null,
        interestFeesCents: null,
        cumulativePrincipalCents: 0,
        cumulativeInterestFeesCents: 0,
        flags: [],
      },
      {
        id: 11,
        start: false,
        asOf: '2025-01-15',
        balanceCents: 39_000_000,
        paymentsCounted: 12, // 15/02/2024 … 15/01/2025
        repaymentsCents: 12 * 250_000,
        repaymentsTyped: false,
        principalCents: 1_000_000,
        interestFeesCents: 2_000_000,
        cumulativePrincipalCents: 1_000_000,
        cumulativeInterestFeesCents: 2_000_000,
        flags: [],
      },
      {
        id: 12,
        start: false,
        asOf: '2025-07-15',
        balanceCents: 38_500_000,
        paymentsCounted: 6,
        repaymentsCents: 1_600_000, // typed: it replaces the 6 × 2,500 estimate
        repaymentsTyped: true,
        principalCents: 500_000,
        interestFeesCents: 1_100_000,
        cumulativePrincipalCents: 1_500_000,
        cumulativeInterestFeesCents: 3_100_000,
        flags: [],
      },
      {
        id: 13,
        start: false,
        asOf: '2026-01-15',
        balanceCents: 38_700_000,
        paymentsCounted: 6,
        repaymentsCents: 1_500_000,
        repaymentsTyped: false,
        principalCents: -200_000, // a redraw
        interestFeesCents: 1_700_000,
        cumulativePrincipalCents: 1_300_000,
        cumulativeInterestFeesCents: 4_800_000,
        flags: ['balance_increased'],
      },
      {
        id: 14,
        start: false,
        asOf: '2026-07-15',
        balanceCents: 37_000_000,
        paymentsCounted: 6,
        repaymentsCents: 1_500_000,
        repaymentsTyped: false,
        principalCents: 1_700_000,
        interestFeesCents: -200_000, // the estimate is below the principal repaid (an extra payment)
        cumulativePrincipalCents: 3_000_000,
        cumulativeInterestFeesCents: 4_600_000,
        flags: ['repayments_below_principal'],
      },
    ]);
  });

  it('totals the log: repayments, interest and fees, and principal = start − current', () => {
    expect(loan).toMatchObject({
      balanceCents: 37_000_000,
      balanceAsOf: '2026-07-15',
      startBalanceCents: 40_000_000,
      paymentAnchorDate: '2024-01-15',
      repaymentsCents: 7_600_000,
      interestFeesCents: 4_600_000,
      principalPaidCents: 3_000_000,
    });
    expect(loan.repaymentsCents - loan.interestFeesCents).toBe(loan.principalPaidCents);
  });

  it('re-estimates every entry without typed repayments when the regular repayment changes (D76)', () => {
    const changed = loanOf({ paymentCents: 300_000 });
    expect(
      changed.entries
        .slice(1)
        .map((e) => [e.repaymentsCents, e.repaymentsTyped, e.interestFeesCents, e.flags]),
    ).toEqual([
      [3_600_000, false, 2_600_000, []],
      [1_600_000, true, 1_100_000, []],
      [1_800_000, false, 2_000_000, ['balance_increased']],
      [1_800_000, false, 100_000, []],
    ]);
    const none = loanOf({ paymentCents: null });
    expect(none.entries.slice(1).map((e) => [e.repaymentsCents, e.interestFeesCents])).toEqual([
      [null, null],
      [1_600_000, 1_100_000],
      [null, null],
      [null, null],
    ]);
    expect(none).toMatchObject({
      repaymentsCents: 1_600_000,
      interestFeesCents: 1_100_000,
      principalPaidCents: 3_000_000,
    });
    expect(none.entries.at(-1)!.cumulativeInterestFeesCents).toBe(1_100_000);
  });

  it('has no start point unless both start fields are set and the start is before the first entry', () => {
    const sameDay = loanOf({ startDate: '2025-01-15' });
    expect(sameDay.entries[0]).toMatchObject({
      id: 11,
      start: false,
      paymentsCounted: null,
      cumulativePrincipalCents: 1_000_000,
    });
    expect(sameDay).toMatchObject({
      paymentAnchorDate: '2025-01-15',
      startBalanceCents: 40_000_000,
      principalPaidCents: 3_000_000,
    });
    const noStartDate = loanOf({ startDate: null });
    expect(noStartDate.entries.map((e) => e.id)).toEqual([11, 12, 13, 14]);
    expect(noStartDate).toMatchObject({
      paymentAnchorDate: '2025-01-15',
      startBalanceCents: 40_000_000,
    });
    const noStartBalance = loanOf({ startBalanceCents: null });
    expect(noStartBalance.entries[0]!.id).toBe(11);
    // The first entry's balance stands in for the start balance; the start date still anchors.
    expect(noStartBalance).toMatchObject({
      startBalanceCents: 39_000_000,
      paymentAnchorDate: '2024-01-15',
      principalPaidCents: 2_000_000,
    });
  });

  it('counts fortnightly and weekly payments on grids anchored at the start', () => {
    const fortnightly = loanOf({ paymentFrequency: 'fortnightly', paymentCents: 100_000 });
    // 366 days to 15/01/2025: 14-day steps land on 13/01/2025 (the 26th), the 27th is after.
    expect(fortnightly.entries[1]).toMatchObject({
      paymentsCounted: 26,
      repaymentsCents: 2_600_000,
    });
    const weekly = loanOf({ paymentFrequency: 'weekly', paymentCents: 50_000 });
    expect(weekly.entries[1]!.paymentsCounted).toBe(52);
  });

  it('keeps an entry dated after the as-of in the log but not in the balance or the totals', () => {
    const later = loanOf({
      entries: [
        ...MORTGAGE.entries,
        { id: 15, asOf: '2026-09-30', balanceCents: 36_000_000, repaymentsCents: null },
      ],
    });
    expect(later.entries.at(-1)).toMatchObject({ id: 15, asOf: '2026-09-30' });
    expect(later).toMatchObject({
      balanceCents: 37_000_000,
      balanceAsOf: '2026-07-15',
      repaymentsCents: 7_600_000,
    });
  });
});

describe('computeProperty: offsets and the schedules (§2.6 steps 2 and 5, D67)', () => {
  it('nets the offset off the balance and projects the payoff with and without it', () => {
    const loan = computeProperty(input()).loans[0]!;
    expect(loan).toMatchObject({
      offsetCents: 1_000_000,
      netBalanceCents: 36_000_000,
      excessOffsetCents: 0,
    });
    const common = {
      balanceCents: 37_000_000,
      annualRate: '0.06',
      compoundingPerYear: 12,
      paymentCents: 250_000,
      paymentFrequency: 'monthly' as const,
      anchorDate: '2024-01-15',
      balanceDate: '2026-07-15',
    };
    const withOffset = amortise({ ...common, offsetCents: 1_000_000 });
    const without = amortise({ ...common, offsetCents: 0 });
    expect(loan.schedule).toEqual(withOffset);
    expect(loan.scheduleWithoutOffset).toEqual(without);
    // The next repayment (15/08/2026) is charged on the balance less the offset.
    expect(withOffset).toMatchObject({
      firstPaymentDate: '2026-08-15',
      firstPeriodInterestCents: 180_000,
    });
    expect(without.firstPeriodInterestCents).toBe(185_000);
    expect(loan.nextPeriodInterestCents).toBe(180_000);
    expect(loan.interestSavedCents).toBe(
      without.totalInterestCents! - withOffset.totalInterestCents!,
    );
    expect(loan.interestSavedCents).toBeGreaterThan(0);
    expect(loan.monthsSaved).toBe(monthsBetween(withOffset.payoffDate!, without.payoffDate!));
    expect(loan.monthsSaved).toBeGreaterThan(0);
  });

  it('has no schedule without the offset when none is linked', () => {
    const loan = loanOf({ offsets: [] });
    expect(loan).toMatchObject({
      offsetCents: 0,
      scheduleWithoutOffset: null,
      interestSavedCents: null,
      monthsSaved: null,
    });
    expect(loan.schedule!.firstPeriodInterestCents).toBe(185_000);
  });

  it('charges no interest once the offset covers the balance', () => {
    const loan = loanOf({
      offsets: [
        { accountId: 5, balanceCents: 30_000_000 },
        { accountId: 6, balanceCents: 10_000_000 },
      ],
    });
    expect(loan).toMatchObject({
      offsetCents: 40_000_000,
      netBalanceCents: 0,
      excessOffsetCents: 3_000_000,
    });
    expect(loan.schedule).toMatchObject({
      firstPeriodInterestCents: 0,
      payments: 148,
      totalInterestCents: 0,
    });
    const home = computeProperty(
      input({ loans: [{ ...MORTGAGE, offsets: [{ accountId: 5, balanceCents: 40_000_000 }] }] }),
    ).properties[0]!;
    expect(home).toMatchObject({
      debtCents: 0,
      lvrRatio: '0',
      equityCents: 60_000_000 - 37_000_000 + 40_000_000,
    });
  });

  it('flags a missing rate, compounding frequency or repayment and gives no schedule', () => {
    const loan = loanOf({ annualRate: null, compoundingPerYear: null, paymentCents: null });
    expect(loan).toMatchObject({
      schedule: null,
      scheduleWithoutOffset: null,
      nextPeriodInterestCents: null,
      interestSavedCents: null,
      monthsSaved: null,
    });
    expect(loan.flags).toEqual(['no_rate', 'no_compounding', 'no_payment']);
    expect(loanOf({ compoundingPerYear: 0 }).flags).toEqual(['no_compounding']);
  });

  it('copies the schedule’s flag: a repayment below the interest never pays off', () => {
    const loan = loanOf({ paymentCents: 150_000 });
    expect(loan.flags).toEqual(['payment_below_interest']);
    expect(loan.schedule).toMatchObject({
      flag: 'payment_below_interest',
      payments: null,
      payoffDate: null,
    });
    expect(loan).toMatchObject({
      nextPeriodInterestCents: 180_000,
      interestSavedCents: null,
      monthsSaved: null,
    });
  });
});

describe('computeProperty: totals, the snapshot and the savings parts (§2.6 steps 6, 8–10)', () => {
  it('totals the properties and their loans; a loan without a property counts nowhere', () => {
    const r = computeProperty(input());
    expect(r.loans.map((l) => [l.id, l.flags])).toEqual([
      [1, []],
      [2, ['no_property']],
    ]);
    expect(r.loans[1]).toMatchObject({
      startBalanceCents: 1_500_000,
      paymentAnchorDate: '2026-08-31',
      principalPaidCents: 0,
    });
    expect(r.loans[1]!.schedule!.firstPaymentDate).toBe('2026-09-30');
    expect(r.totals).toEqual({
      purchaseCents: 50_000_000,
      valueCents: 60_000_000,
      gainCents: 12_000_000,
      gainRatio: '0.24',
      mortgageCents: 37_000_000,
      offsetCents: 1_000_000,
      netMortgageCents: 36_000_000,
      principalPaidCents: 3_000_000,
      interestFeesCents: 4_600_000,
      repaymentsCents: 7_600_000,
      startBalanceCents: 40_000_000,
      lvrRatio: '0.6',
      equityCents: 24_000_000,
    });
    expect(r.snapshot).toEqual({
      propertyValueCents: 60_000_000,
      propertyPurchaseCents: 50_000_000,
      propertyEquityCents: 24_000_000,
      propertyGainCents: 12_000_000,
      mortgageBalanceCents: -37_000_000,
      mortgageInterestFeesCents: 4_600_000,
      mortgagePrincipalPaidCents: 3_000_000,
      propertyGainRatio: '0.25', // AA ÷ (X − AA)
      mortgageOffsetCents: 1_000_000,
    });
    expect(r.savingsLive).toEqual({
      propertyPurchaseCents: 50_000_000,
      mortgageBalanceCents: -37_000_000,
      mortgagePrincipalPaidCents: 3_000_000,
    });
  });

  it('adds a second loan on the same property to its debt and the totals', () => {
    const topUp: EngineLoan = {
      ...CAR,
      id: 3,
      propertyId: 1,
      entries: [{ id: 31, asOf: '2026-08-31', balanceCents: 2_000_000, repaymentsCents: null }],
    };
    const r = computeProperty(input({ loans: [MORTGAGE, topUp] }));
    expect(r.properties[0]).toMatchObject({
      loanIds: [1, 3],
      debtCents: 38_000_000,
      equityCents: 22_000_000,
    });
    expect(r.totals).toMatchObject({
      mortgageCents: 39_000_000,
      netMortgageCents: 38_000_000,
      startBalanceCents: 42_000_000,
    });
  });

  it('gives 0s with no property and nulls for the savings parts that do not exist', () => {
    const none = computeProperty(input({ properties: [], loans: [CAR] }));
    expect(none.totals).toMatchObject({
      purchaseCents: 0,
      valueCents: 0,
      gainRatio: null,
      lvrRatio: null,
      mortgageCents: 0,
    });
    expect(none.snapshot).toEqual({
      propertyValueCents: 0,
      propertyPurchaseCents: 0,
      propertyEquityCents: 0,
      propertyGainCents: 0,
      mortgageBalanceCents: 0,
      mortgageInterestFeesCents: 0,
      mortgagePrincipalPaidCents: 0,
      propertyGainRatio: '0',
      mortgageOffsetCents: 0,
    });
    expect(none.savingsLive).toEqual({
      propertyPurchaseCents: null,
      mortgageBalanceCents: null,
      mortgagePrincipalPaidCents: null,
    });
    const noLoan = computeProperty(input({ loans: [] }));
    expect(noLoan.savingsLive).toEqual({
      propertyPurchaseCents: 50_000_000,
      mortgageBalanceCents: null,
      mortgagePrincipalPaidCents: null,
    });
    expect(noLoan.properties[0]).toMatchObject({
      loanIds: [],
      debtCents: 0,
      lvrRatio: '0',
      equityCents: 60_000_000,
    });
  });
});

describe('computeProperty: the chart (§2.6 step 11, §2.10)', () => {
  const snapshots = [
    {
      periodMonth: '2026-06',
      runDate: '2026-06-30',
      propertyValueCents: 0,
      propertyPurchaseCents: 0,
      mortgageBalanceCents: 0,
      mortgageInterestFeesCents: 0,
      mortgagePrincipalPaidCents: 0,
    },
    {
      periodMonth: '2026-07',
      runDate: '2026-07-31',
      propertyValueCents: 60_000_000,
      propertyPurchaseCents: 50_000_000,
      mortgageBalanceCents: -37_200_000,
      mortgageInterestFeesCents: 4_500_000,
      mortgagePrincipalPaidCents: 2_800_000,
    },
    {
      periodMonth: '2026-08',
      runDate: '2026-08-31',
      propertyValueCents: 60_000_000,
      propertyPurchaseCents: 50_000_000,
      mortgageBalanceCents: -37_100_000,
      mortgageInterestFeesCents: 4_550_000,
      mortgagePrincipalPaidCents: 2_900_000,
    },
  ];

  it('charts the stored History per recorded month (gross LVR) and the live totals (net LVR)', () => {
    const r = computeProperty(input({ snapshots }));
    expect(r.chart).toEqual([
      {
        label: 'Jun 2026',
        period: '2026-06',
        date: '2026-06-30',
        live: false,
        valueCents: 0,
        purchaseCents: 0,
        mortgageCents: 0,
        equityCents: 0,
        lvrRatio: null,
        interestFeesCents: 0,
        principalPaidCents: 0,
      },
      {
        label: 'Jul 2026',
        period: '2026-07',
        date: '2026-07-31',
        live: false,
        valueCents: 60_000_000,
        purchaseCents: 50_000_000,
        mortgageCents: 37_200_000,
        equityCents: 22_800_000,
        lvrRatio: '0.62',
        interestFeesCents: 4_500_000,
        principalPaidCents: 2_800_000,
      },
      {
        label: 'Aug 2026',
        period: '2026-08',
        date: '2026-08-31',
        live: false,
        valueCents: 60_000_000,
        purchaseCents: 50_000_000,
        mortgageCents: 37_100_000,
        equityCents: 22_900_000,
        lvrRatio: ratio(D(37_100_000).div(60_000_000)),
        interestFeesCents: 4_550_000,
        principalPaidCents: 2_900_000,
      },
      {
        label: 'Sep 2026',
        period: '2026-09',
        date: AS_OF,
        live: true,
        valueCents: 60_000_000,
        purchaseCents: 50_000_000,
        mortgageCents: 37_000_000,
        equityCents: 24_000_000,
        lvrRatio: '0.6',
        interestFeesCents: 4_600_000,
        principalPaidCents: 3_000_000,
      },
    ]);
  });

  it('keeps the last point of each group', () => {
    const quarterly = computeProperty(
      input({ snapshots, chart: { unit: 'quarterly', count: null } }),
    ).chart;
    expect(quarterly.map((p) => [p.label, p.date, p.live, p.mortgageCents])).toEqual([
      ['Q2 2026', '2026-06-30', false, 0],
      ['Q3 2026', AS_OF, true, 37_000_000],
    ]);
    const yearly = computeProperty(
      input({ snapshots, chart: { unit: 'yearly', count: null } }),
    ).chart;
    expect(yearly.map((p) => p.label)).toEqual(['FY2025–26', 'FY2026–27']);
  });
});

describe('computeProperty: programmer errors', () => {
  it('rejects a property without a valuation, a loan without an entry and malformed input', () => {
    expect(() => computeProperty(input({ properties: [{ ...HOME, valuations: [] }] }))).toThrow(
      RangeError,
    );
    expect(() => computeProperty(input({ loans: [{ ...MORTGAGE, entries: [] }] }))).toThrow(
      RangeError,
    );
    expect(() => computeProperty(input({ asOf: '24/09/2026' }))).toThrow(RangeError);
    expect(() => computeProperty(input({ loans: [{ ...MORTGAGE, annualRate: 'six' }] }))).toThrow(
      RangeError,
    );
  });
});
