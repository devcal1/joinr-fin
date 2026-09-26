// A loan's amortisation schedule on its payment grid (stage-4.md §2.3, §2.7; D66, §11 fixes 2–4):
// the periodic rate from separate payment and compounding frequencies, interest on the balance net
// of linked offsets, payments on the loan's own grid dates (anchored at its start, never chained),
// in decimals rounded once at each output.
import {
  addMonthsIso,
  PAYMENTS_PER_YEAR,
  type IsoDate,
  type PaymentFrequency,
} from '@joinr/schema';
import { centsDec, maxZero, roundCents } from './assetsCommon';
import { addDaysIso, dayNumber, dec, decN, ONE, ratioString, ZERO, type Dec } from './num';
import type { AmortisationInput, AmortisationResult } from './types';

/** A loan runs at most this many years of payments before it is `never_repaid` (§2.7). */
export const MAX_LOAN_YEARS = 100;

/** Payments per year of a frequency; an unknown frequency is a programmer error. */
export function paymentsPerYear(frequency: PaymentFrequency): number {
  if (!Object.hasOwn(PAYMENTS_PER_YEAR, frequency)) {
    throw new RangeError(`engine: unknown payment frequency: ${JSON.stringify(frequency)}`);
  }
  return PAYMENTS_PER_YEAR[frequency];
}

/**
 * The k-th payment date (k ≥ 1) of the grid anchored at `anchor` (§2.3): monthly on
 * addMonthsIso(anchor, k) (EDATE clamping, always from the anchor), fortnightly on anchor + 14k
 * days, weekly on anchor + 7k days.
 */
export function gridDate(anchor: IsoDate, frequency: PaymentFrequency, k: number): IsoDate {
  if (frequency === 'monthly') return addMonthsIso(anchor, k);
  return addDaysIso(anchor, (frequency === 'fortnightly' ? 14 : 7) * k);
}

/** The smallest k ≥ 1 whose grid date is after `date` (the first payment after a balance). */
export function firstGridIndexAfter(
  anchor: IsoDate,
  frequency: PaymentFrequency,
  date: IsoDate,
): number {
  const a = dayNumber(anchor);
  const d = dayNumber(date);
  if (frequency !== 'monthly') {
    const step = frequency === 'fortnightly' ? 14 : 7;
    return Math.max(1, Math.floor((d - a) / step) + 1);
  }
  const months =
    (Number(date.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 +
    (Number(date.slice(5, 7)) - Number(anchor.slice(5, 7)));
  let k = Math.max(1, months);
  while (dayNumber(gridDate(anchor, frequency, k)) <= d) k += 1;
  while (k > 1 && dayNumber(gridDate(anchor, frequency, k - 1)) > d) k -= 1;
  return k;
}

/**
 * The periodic ratio of an annual rate compounded `compounding` times a year and paid `perYear`
 * times a year: (1 + r/m)^(m/p) − 1; exactly r/m when m = p; 0 when r = 0 (§2.7).
 */
export function periodicRatio(annualRate: Dec, compounding: number, perYear: number): Dec {
  if (annualRate.isZero()) return ZERO;
  const m = decN(compounding);
  if (compounding === perYear) return annualRate.div(m);
  return ONE.plus(annualRate.div(m)).pow(m.div(perYear)).minus(ONE);
}

export function amortise(input: AmortisationInput): AmortisationResult {
  const p = paymentsPerYear(input.paymentFrequency);
  if (!Number.isFinite(input.compoundingPerYear) || input.compoundingPerYear <= 0) {
    throw new RangeError(
      `engine: compoundingPerYear must be a positive number: ${input.compoundingPerYear}`,
    );
  }
  dayNumber(input.anchorDate);
  dayNumber(input.balanceDate);
  const i = periodicRatio(dec(input.annualRate, 'annualRate'), input.compoundingPerYear, p);
  const offset = centsDec(input.offsetCents, 'offsetCents');
  const payment = centsDec(input.paymentCents, 'paymentCents');
  let balance = centsDec(input.balanceCents, 'balanceCents');

  const firstIndex = firstGridIndexAfter(
    input.anchorDate,
    input.paymentFrequency,
    input.balanceDate,
  );
  const firstPaymentDate = gridDate(input.anchorDate, input.paymentFrequency, firstIndex);
  const interestOn = (b: Dec): Dec => maxZero(b.minus(offset)).times(i);
  const firstInterest = interestOn(balance);
  const base = {
    periodicRatio: ratioString(i),
    firstPaymentDate,
    firstPeriodInterestCents: roundCents(firstInterest),
  };
  const noPayoff = { payments: null, payoffDate: null, totalInterestCents: null, points: [] };

  // A balance already repaid: nothing is owed, so no payment falls due.
  if (!balance.greaterThan(0)) {
    return {
      ...base,
      payments: 0,
      payoffDate: input.balanceDate,
      totalInterestCents: 0,
      points: [
        { date: input.balanceDate, balanceCents: roundCents(maxZero(balance)), interestCents: 0 },
      ],
      flag: null,
    };
  }
  // The repayment never covers the interest while any of the balance is not offset.
  if (balance.minus(offset).greaterThan(0) && payment.lessThanOrEqualTo(firstInterest)) {
    return { ...base, ...noPayoff, flag: 'payment_below_interest' };
  }

  const points: AmortisationResult['points'] = [
    { date: input.balanceDate, balanceCents: roundCents(balance), interestCents: 0 },
  ];
  let totalInterest = ZERO;
  const maxPayments = MAX_LOAN_YEARS * p;
  for (let n = 1; n <= maxPayments; n++) {
    const date = gridDate(input.anchorDate, input.paymentFrequency, firstIndex + n - 1);
    const interest = interestOn(balance);
    totalInterest = totalInterest.plus(interest);
    const due = balance.plus(interest);
    balance = due.lessThanOrEqualTo(payment) ? ZERO : due.minus(payment);
    const paidOff = balance.isZero();
    if (n % p === 0 || paidOff) {
      points.push({
        date,
        balanceCents: roundCents(balance),
        interestCents: roundCents(totalInterest),
      });
    }
    if (paidOff) {
      return {
        ...base,
        payments: n,
        payoffDate: date,
        totalInterestCents: roundCents(totalInterest),
        points,
        flag: null,
      };
    }
  }
  return { ...base, ...noPayoff, flag: 'never_repaid' };
}
