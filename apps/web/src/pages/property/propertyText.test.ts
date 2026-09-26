import { paymentDatesBetween, type LoanDto } from '@joinr/schema';
import { propertyPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { compoundingOptions, loanDraftOf, repaymentChanged } from './loanDraft';
import {
  anyDefaultRepayments,
  bridgeGaps,
  entryEstimate,
  estimatePlaceholder,
  estimateRepayments,
  loanEntryMarkers,
  loanLog,
  loansWithoutPropertyText,
  missingFieldTexts,
  payoffTile,
  projectionRows,
  unlinkedOffsets,
} from './propertyText';

const populated = propertyPages.populated;
const mortgage = populated.loans[0] as LoanDto;

describe('the loan log (D66)', () => {
  it('oldest first: the start point leads', () => {
    const log = loanLog(populated, 1);
    expect(log.map((e) => e.asOf)).toEqual([
      '2020-03-15',
      '2026-02-28',
      '2026-05-31',
      '2026-08-31',
    ]);
    expect(log[0]?.start).toBe(true);
  });

  it('markers: Loan start, Estimate on a default repayment, Check below the principal', () => {
    const [start, first, second, third] = loanLog(populated, 1);
    expect(start && loanEntryMarkers(start)).toEqual(['loanStart']);
    expect(first && loanEntryMarkers(first)).toEqual(['estimate']);
    expect(second && loanEntryMarkers(second)).toEqual(['estimate', 'check']);
    // A typed repayment carries no badge.
    expect(third && loanEntryMarkers(third)).toEqual([]);
    // Every repayment an estimate: the column carries one foot-noted marker instead.
    expect(first && loanEntryMarkers(first, true)).toEqual([]);
  });

  it('any default repayment raises the D66 callout', () => {
    expect(anyDefaultRepayments(populated)).toBe(true);
    expect(anyDefaultRepayments(propertyPages.noLoan)).toBe(false);
  });
});

describe('the estimated repayments placeholder (UX-7)', () => {
  it('counts the loan’s payment dates in (previous point, as of] with paymentDatesBetween', () => {
    const log = loanLog(populated, 1);
    const estimate = estimateRepayments(mortgage, log, '2026-09-24');
    // The same helper the engine uses: 15/09 is the only grid date after 31/08.
    const dates = paymentDatesBetween('2020-03-15', 'monthly', '2026-08-31', '2026-09-24');
    expect(dates).toEqual(['2026-09-15']);
    expect(estimate).toEqual({ payments: 1, cents: 280000 });
    expect(estimatePlaceholder(estimate)).toBe('Estimated 2,800.00 (1 payment)');
    expect(estimateRepayments(mortgage, log, '2026-12-20')).toEqual({
      payments: 4,
      cents: 1120000,
    });
  });

  it('a date before every point counts nothing; no regular payment gives no estimate', () => {
    expect(estimateRepayments(mortgage, loanLog(populated, 1), '2019-01-01')).toEqual({
      payments: 0,
      cents: 0,
    });
    const noPayment = { ...mortgage, paymentCents: null };
    const estimate = estimateRepayments(noPayment, loanLog(populated, 1), '2026-09-24');
    expect(estimate.cents).toBeNull();
    expect(estimatePlaceholder(estimate)).toBe('No regular repayment to estimate');
  });

  it('a stored entry’s default is its counted payments × the regular payment', () => {
    expect(entryEstimate(mortgage, { paymentsCounted: 3 })).toEqual({ payments: 3, cents: 840000 });
  });
});

describe('the Paid off tile and the callouts', () => {
  it('one mortgage: the payoff month, when, and the months the offset saves', () => {
    expect(payoffTile(populated)).toEqual({
      value: 'Jan 2046',
      hint: 'In 19 years 3 months · 8 months sooner with your offset',
    });
  });

  it('several loans: the latest payoff and the count', () => {
    const tile = payoffTile(propertyPages.twoLoans);
    expect(tile.value).toBe('Jan 2046');
    expect(tile.hint).toContain('the latest of 2 loans');
  });

  it('no payoff: "—" with the flag’s words', () => {
    expect(payoffTile(propertyPages.paymentBelowInterest)).toEqual({
      value: '—',
      hint: 'The repayment does not cover the interest',
    });
    expect(payoffTile(propertyPages.noRate)).toEqual({ value: '—', hint: 'No interest rate' });
    expect(payoffTile(propertyPages.noLoan)).toEqual({ value: '—', hint: 'No mortgage' });
  });

  it('loans without a property, unlinked offsets and missing fields', () => {
    expect(loansWithoutPropertyText(1)).toBe(
      '1 loan is not linked to a property. The app tracks mortgages only.',
    );
    expect(loansWithoutPropertyText(2)).toBe(
      '2 loans are not linked to a property. The app tracks mortgages only.',
    );
    expect(unlinkedOffsets(propertyPages.unlinkedOffset)).toHaveLength(1);
    expect(unlinkedOffsets(populated)).toHaveLength(0);
    expect(missingFieldTexts(propertyPages.noRate.loans)).toEqual([
      'Example property mortgage has no interest rate, so no payoff date is shown. Edit the loan to add it.',
    ]);
    expect(missingFieldTexts(propertyPages.loanWithoutProperty.loans)).toEqual([
      'Example car loan has no repayment amount, so no payoff date is shown. Edit the loan to add it.',
      'Example car loan has no compounding frequency, so no payoff date is shown. Edit the loan to add it.',
    ]);
  });
});

describe('the payoff projection rows', () => {
  it('both schedules on one date axis: 0 after a payoff, a gap inside the other’s range', () => {
    const rows = projectionRows(mortgage.schedule, mortgage.scheduleWithoutOffset);
    expect(rows[0]).toEqual({ date: '2026-08-31', withCents: 39090000, withoutCents: 39090000 });
    const payoff = rows.find((r) => r.date === '2046-01-15');
    expect(payoff).toEqual({ date: '2046-01-15', withCents: 0, withoutCents: null });
    expect(rows.at(-1)).toEqual({ date: '2046-09-15', withCents: 0, withoutCents: 0 });
    expect(projectionRows(null, null)).toEqual([]);
  });

  it('the chart bridges inner gaps by date; leading and trailing gaps stay', () => {
    expect(bridgeGaps(['2026-01-01', '2026-01-11', '2026-01-21'], [100, null, 0])).toEqual([
      100, 50, 0,
    ]);
    expect(bridgeGaps(['2026-01-01', '2026-01-02'], [null, 5])).toEqual([null, 5]);
    expect(bridgeGaps(['2026-01-01', '2026-01-02'], [5, null])).toEqual([5, null]);
  });
});

describe('the loan form model', () => {
  it('the rate as percent text, the compounding choice, the stored other value', () => {
    const draft = loanDraftOf(mortgage, '2026-09-24', 1);
    expect(draft.ratePercent).toBe('6');
    expect(draft.compounding).toBe('12');
    expect(draft.propertyId).toBe('1');
    expect(compoundingOptions(4).map((o) => o.label)).toEqual([
      'Monthly',
      'Fortnightly',
      'Weekly',
      'Daily',
      '4 times a year',
    ]);
    expect(compoundingOptions(12)).toHaveLength(4);
  });

  it('a new loan defaults to the first property and monthly compounding', () => {
    const draft = loanDraftOf(undefined, '2026-09-24', 7);
    expect(draft.propertyId).toBe('7');
    expect(draft.compounding).toBe('12');
    expect(draft.paymentFrequency).toBe('monthly');
  });

  it('the repayment-change note follows the amount and the frequency (D76)', () => {
    const draft = loanDraftOf(mortgage, '2026-09-24', 1);
    expect(repaymentChanged(draft, mortgage)).toBe(false);
    expect(repaymentChanged({ ...draft, paymentCents: 300000 }, mortgage)).toBe(true);
    expect(repaymentChanged({ ...draft, paymentFrequency: 'fortnightly' }, mortgage)).toBe(true);
    expect(repaymentChanged(draft, undefined)).toBe(false);
  });
});
