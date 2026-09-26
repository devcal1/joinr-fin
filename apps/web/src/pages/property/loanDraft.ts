// The loan form's model (stage-4.md §4.3, §6.5 item 5, D76): the draft (the rate as percent text,
// the compounding choice as text), the compounding options (plus a stored value outside them) and
// whether the repayment changed. Pure: no React.
import {
  COMPOUNDING_CHOICES,
  percentTextFromRatio,
  type LoanDto,
  type PaymentFrequency,
} from '@joinr/schema';
import { compoundingLabel } from '../assets/display';

export interface LoanDraft {
  propertyId: string;
  name: string;
  lender: string;
  startDate: string | null;
  startBalanceCents: number | null;
  /** Percent text: "6.04". */
  ratePercent: string;
  /** The compounding choice as text ('' = not set). */
  compounding: string;
  paymentCents: number | null;
  paymentFrequency: PaymentFrequency;
  note: string;
  balanceCents: number | null;
  asOf: string | null;
}

export function loanDraftOf(
  loan: LoanDto | undefined,
  today: string,
  defaultPropertyId: number | null,
): LoanDraft {
  let ratePercent = '';
  if (loan?.annualRate) {
    try {
      ratePercent = percentTextFromRatio(loan.annualRate);
    } catch {
      ratePercent = '';
    }
  }
  const propertyId = loan ? loan.propertyId : defaultPropertyId;
  return {
    propertyId: propertyId === null ? '' : String(propertyId),
    name: loan?.name ?? '',
    lender: loan?.lender ?? '',
    startDate: loan?.startDate ?? null,
    startBalanceCents: loan?.startBalanceCents ?? null,
    ratePercent,
    compounding: loan?.compoundingPerYear ? String(loan.compoundingPerYear) : loan ? '' : '12',
    paymentCents: loan?.paymentCents ?? null,
    paymentFrequency: loan?.paymentFrequency ?? 'monthly',
    note: loan?.note ?? '',
    balanceCents: null,
    asOf: today,
  };
}

/** The compounding choices: monthly, fortnightly, weekly, daily, plus a stored other value. */
export function compoundingOptions(stored: number | null): { value: string; label: string }[] {
  const values: number[] = [...COMPOUNDING_CHOICES];
  if (stored !== null && !values.includes(stored)) values.push(stored);
  return values.map((value) => ({ value: String(value), label: compoundingLabel(value) }));
}

/** True when the repayment amount or frequency differs from the stored loan (D76's note). */
export function repaymentChanged(draft: LoanDraft, loan: LoanDto | undefined): boolean {
  if (!loan) return false;
  return (
    draft.paymentCents !== loan.paymentCents || draft.paymentFrequency !== loan.paymentFrequency
  );
}
