// The amortisation schedule (stage-4.md §2.3, §2.7; §7.3 step 3): the periodic ratio of every
// frequency pair, the anchored payment grid, zero rates, offsets, the payment-below-interest and
// 100-year flags, the yearly points and sheet mode against a hand-computed NPER. Generic, round
// figures only.
import { addMonthsIso, type PaymentFrequency } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import { amortise, type AmortisationInput } from '../src/index';
import { firstGridIndexAfter, gridDate, periodicRatio } from '../src/amortise';
import { cents, D, ratio } from './helpers';

const loan = (over: Partial<AmortisationInput> = {}): AmortisationInput => ({
  balanceCents: 1_000_000, // $10,000
  annualRate: '0.06',
  compoundingPerYear: 12,
  paymentCents: 20_000, // $200 a month
  paymentFrequency: 'monthly',
  offsetCents: 0,
  anchorDate: '2026-01-15',
  balanceDate: '2026-01-15',
  ...over,
});

/** The balance after n level payments at a periodic rate i (the annuity identity), in dollars. */
const balanceAfter = (pv: number, pmt: number, i: string, n: number) => {
  const g = D(1).plus(i).pow(n);
  return D(pv)
    .times(g)
    .minus(D(pmt).times(g.minus(1)).div(i));
};

/** Sheets NPER(rate, −pmt, pv) with fv = 0 (a float, as the sheet computes it). */
const nper = (rate: number, pmt: number, pv: number) =>
  Math.log(pmt / (pmt - pv * rate)) / Math.log(1 + rate);

describe('periodicRatio (§2.7)', () => {
  it('is exactly r/m when the payment and compounding frequencies are equal', () => {
    expect(periodicRatio(D('0.06'), 12, 12).toString()).toBe('0.005');
    expect(periodicRatio(D('0.065'), 26, 26).toString()).toBe('0.0025');
    expect(periodicRatio(D('0.052'), 52, 52).toString()).toBe('0.001');
  });

  it('is (1 + r/m)^(m/p) − 1 for different frequencies, and 0 at a zero rate', () => {
    const fortnightlyOfMonthly = D(1).plus(D('0.06').div(12)).pow(D(12).div(26)).minus(1);
    expect(ratio(periodicRatio(D('0.06'), 12, 26))).toBe(ratio(fortnightlyOfMonthly));
    const monthlyOfDaily = D(1).plus(D('0.05').div(365)).pow(D(365).div(12)).minus(1);
    expect(ratio(periodicRatio(D('0.05'), 365, 12))).toBe(ratio(monthlyOfDaily));
    const monthlyOfFortnightly = D(1).plus(D('0.06').div(26)).pow(D(26).div(12)).minus(1);
    expect(ratio(periodicRatio(D('0.06'), 26, 12))).toBe(ratio(monthlyOfFortnightly));
    expect(periodicRatio(D('0'), 12, 26).isZero()).toBe(true);
    expect(
      amortise(loan({ paymentFrequency: 'fortnightly', paymentCents: 10_000 })).periodicRatio,
    ).toBe(ratio(fortnightlyOfMonthly));
  });

  it.each([
    ['monthly', 12],
    ['fortnightly', 26],
    ['weekly', 52],
  ] as const)(
    'gives %s payments their rate for every compounding choice',
    (paymentFrequency, p) => {
      for (const m of [12, 26, 52, 365]) {
        const expected =
          m === p ? D('0.06').div(m) : D(1).plus(D('0.06').div(m)).pow(D(m).div(p)).minus(1);
        const r = amortise(
          loan({ paymentFrequency, compoundingPerYear: m, paymentCents: 100_000 }),
        );
        expect(r.periodicRatio, `m = ${m}`).toBe(ratio(expected));
      }
    },
  );
});

describe('the payment grid (§2.3)', () => {
  it('clamps month ends from the anchor, never chained', () => {
    const dates = [1, 2, 3, 4, 13].map((k) => gridDate('2026-01-31', 'monthly', k));
    expect(dates).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2027-02-28']);
    expect(gridDate('2026-01-01', 'fortnightly', 3)).toBe('2026-02-12');
    expect(gridDate('2026-01-01', 'weekly', 2)).toBe('2026-01-15');
  });

  it('finds the first grid date after a balance date', () => {
    expect(firstGridIndexAfter('2026-01-31', 'monthly', '2026-02-15')).toBe(1);
    expect(firstGridIndexAfter('2026-01-31', 'monthly', '2026-02-28')).toBe(2);
    expect(firstGridIndexAfter('2026-01-15', 'monthly', '2026-08-31')).toBe(8);
    expect(firstGridIndexAfter('2026-01-01', 'fortnightly', '2026-01-20')).toBe(2);
    expect(firstGridIndexAfter('2026-01-01', 'weekly', '2026-01-08')).toBe(2);
    // A balance dated before the anchor: the first payment is one period after the anchor.
    expect(firstGridIndexAfter('2026-06-01', 'monthly', '2026-03-01')).toBe(1);
    expect(firstGridIndexAfter('2026-06-01', 'weekly', '2026-03-01')).toBe(1);
  });

  it('pays on the grid: the first payment is the first grid date after the balance date', () => {
    const r = amortise(
      loan({
        annualRate: '0',
        balanceCents: 30_000,
        paymentCents: 10_000,
        anchorDate: '2026-01-31',
        balanceDate: '2026-02-15',
      }),
    );
    expect(r.firstPaymentDate).toBe('2026-02-28');
    expect(r).toMatchObject({
      payments: 3,
      payoffDate: '2026-04-30',
      totalInterestCents: 0,
      flag: null,
    });
    const fortnightly = amortise(
      loan({
        annualRate: '0',
        balanceCents: 30_000,
        paymentCents: 10_000,
        paymentFrequency: 'fortnightly',
        anchorDate: '2026-01-01',
        balanceDate: '2026-01-20',
      }),
    );
    expect(fortnightly).toMatchObject({
      firstPaymentDate: '2026-01-29',
      payoffDate: '2026-02-26',
      payments: 3,
    });
    const weekly = amortise(
      loan({
        annualRate: '0',
        balanceCents: 30_000,
        paymentCents: 10_000,
        paymentFrequency: 'weekly',
        anchorDate: '2026-01-01',
        balanceDate: '2026-01-08',
      }),
    );
    expect(weekly).toMatchObject({
      firstPaymentDate: '2026-01-15',
      payoffDate: '2026-01-29',
      payments: 3,
    });
  });
});

describe('amortise (§2.7)', () => {
  it('works a monthly loan by hand: payments, first interest, total interest and payoff', () => {
    const r = amortise(loan());
    // NPER = ln(200 / (200 − 10000 × 0.005)) / ln(1.005) = 57.68… → 58 payments.
    expect(Math.ceil(nper(0.005, 200, 10_000))).toBe(58);
    expect(r.payments).toBe(58);
    expect(r.firstPaymentDate).toBe('2026-02-15');
    expect(r.firstPeriodInterestCents).toBe(5_000);
    expect(r.payoffDate).toBe(addMonthsIso('2026-01-15', 58));
    // Σ interest = Σ payments − the balance: 57 × 200 + the final (B57 × 1.005) − 10,000.
    const final = balanceAfter(10_000, 200, '0.005', 57).times('1.005');
    expect(r.totalInterestCents).toBe(
      cents(
        D(57 * 200)
          .plus(final)
          .minus(10_000),
      ),
    );
    expect(r.flag).toBeNull();
  });

  it('gives yearly points with the cumulative interest, and the payoff point', () => {
    const r = amortise(loan());
    expect(r.points.map((p) => p.date)).toEqual([
      '2026-01-15',
      '2027-01-15',
      '2028-01-15',
      '2029-01-15',
      '2030-01-15',
      r.payoffDate,
    ]);
    expect(r.points[0]).toEqual({ date: '2026-01-15', balanceCents: 1_000_000, interestCents: 0 });
    const b12 = balanceAfter(10_000, 200, '0.005', 12);
    expect(r.points[1]!.balanceCents).toBe(cents(b12));
    // Interest to date = payments made − the principal repaid.
    expect(r.points[1]!.interestCents).toBe(cents(D(12 * 200).minus(D(10_000).minus(b12))));
    expect(r.points.at(-1)).toEqual({
      date: r.payoffDate,
      balanceCents: 0,
      interestCents: r.totalInterestCents,
    });
  });

  it('repays a zero-rate loan in ⌈B ÷ P⌉ payments with no interest', () => {
    const r = amortise(loan({ annualRate: '0', balanceCents: 100_000, paymentCents: 30_000 }));
    expect(r).toMatchObject({
      periodicRatio: '0',
      payments: 4,
      totalInterestCents: 0,
      firstPeriodInterestCents: 0,
    });
    expect(r.payoffDate).toBe('2026-05-15');
  });

  it('charges interest on the balance net of an offset below it', () => {
    const without = amortise(loan());
    const r = amortise(loan({ offsetCents: 200_000 }));
    expect(r.firstPeriodInterestCents).toBe(4_000); // (10,000 − 2,000) × 0.5 %
    expect(r.payments!).toBeLessThan(without.payments!);
    expect(r.totalInterestCents!).toBeLessThan(without.totalInterestCents!);
  });

  it('charges no interest with an offset equal to or above the balance: ⌈B ÷ P⌉ payments', () => {
    for (const offsetCents of [1_000_000, 1_500_000]) {
      const r = amortise(loan({ offsetCents }));
      expect(r).toMatchObject({
        firstPeriodInterestCents: 0,
        payments: 50,
        totalInterestCents: 0,
        flag: null,
      });
    }
  });

  it('flags a payment that does not cover the first interest (no payoff, no points)', () => {
    const r = amortise(loan({ paymentCents: 5_000 })); // = the interest
    expect(r).toMatchObject({
      flag: 'payment_below_interest',
      payments: null,
      payoffDate: null,
      totalInterestCents: null,
      points: [],
      firstPeriodInterestCents: 5_000,
      firstPaymentDate: '2026-02-15',
    });
    expect(amortise(loan({ paymentCents: 0 })).flag).toBe('payment_below_interest');
    // An offset that brings the interest under the payment lets it repay.
    expect(amortise(loan({ paymentCents: 5_000, offsetCents: 200_000 })).flag).toBeNull();
  });

  it('flags a loan still owing after 100 years of payments', () => {
    // One cent over the interest: about 1,700 months to repay, past the 1,200-payment cap.
    const r = amortise(loan({ paymentCents: 5_001 }));
    expect(r).toMatchObject({
      flag: 'never_repaid',
      payments: null,
      payoffDate: null,
      totalInterestCents: null,
      points: [],
    });
    // With the whole balance offset and no payment, nothing ever repays it either.
    expect(amortise(loan({ paymentCents: 0, offsetCents: 1_000_000 })).flag).toBe('never_repaid');
  });

  it('has nothing to pay on a repaid balance', () => {
    const r = amortise(loan({ balanceCents: 0 }));
    expect(r).toMatchObject({
      payments: 0,
      payoffDate: '2026-01-15',
      totalInterestCents: 0,
      firstPeriodInterestCents: 0,
      flag: null,
    });
    expect(r.points).toEqual([{ date: '2026-01-15', balanceCents: 0, interestCents: 0 }]);
  });

  it('rejects programmer errors', () => {
    expect(() => amortise(loan({ compoundingPerYear: 0 }))).toThrow(RangeError);
    expect(() => amortise(loan({ anchorDate: '15/01/2026' }))).toThrow(RangeError);
    expect(() => amortise(loan({ annualRate: 'six' }))).toThrow(RangeError);
    expect(() => amortise(loan({ paymentFrequency: 'yearly' as PaymentFrequency }))).toThrow(
      RangeError,
    );
    expect(() => amortise(loan({ balanceCents: 0.5 }))).toThrow(RangeError);
  });
});

describe('sheet mode (§2.7; the goldens compare X32 and ⌈NPER⌉ this way)', () => {
  const sheetMode = (monthlyDollars: number, frequency: 12 | 26 | 52) => {
    const paymentFrequency: PaymentFrequency =
      frequency === 12 ? 'monthly' : frequency === 26 ? 'fortnightly' : 'weekly';
    // The sheet's monthly payment × 12 ÷ frequency, rounded half away from zero to whole cents.
    const paymentCents = cents(D(monthlyDollars).times(12).div(frequency));
    return {
      paymentCents,
      result: amortise(
        loan({
          balanceCents: 30_000_000,
          annualRate: '0.06',
          compoundingPerYear: frequency,
          paymentCents,
          paymentFrequency,
        }),
      ),
    };
  };

  it.each([12, 26, 52] as const)(
    'pays ⌈NPER⌉ times at compounding %i with the whole-cent payment',
    (f) => {
      const { paymentCents, result } = sheetMode(2_000, f);
      expect(result.payments).toBe(Math.ceil(nper(0.06 / f, paymentCents / 100, 300_000)));
      // The first period's interest is balance × r ÷ m (the sheet's X32).
      expect(result.firstPeriodInterestCents).toBe(cents(D(300_000).times('0.06').div(f)));
      expect(result.periodicRatio).toBe(ratio(D('0.06').div(f)));
    },
  );
});
