// Cash accounts and totals (stage-3.md §2.4; D49, D56, D59) and the template's pay-frequency
// factors (spec 02 §0.5), shared by `monthlyPayCents` and `budgetInvestment` (one table).
import {
  CASH_ACCOUNT_KINDS,
  JoinrDecimal,
  type CashAccountKind,
  type PayFrequency,
} from '@joinr/schema';
import { centsOf, checkCents, dollarsOf, type Dec } from './num';
import type { CashTotalsResult, Cents, EngineCashAccount } from './types';

/** Weeks per month (365.25 / 7 / 12), the template's constant. */
export const WEEKS_PER_MONTH: Dec = new JoinrDecimal('4.34523783659');

/** Monthly pay = pay per period × factor (spec 02 §0.5, exact template constants). */
export const PAY_FACTORS: Readonly<Record<PayFrequency, Dec>> = {
  monthly: new JoinrDecimal(1),
  four_weekly: new JoinrDecimal('1.0833333333'),
  fortnightly: WEEKS_PER_MONTH.times('0.5'),
  weekly: WEEKS_PER_MONTH,
  twice_monthly: new JoinrDecimal(2),
};

/**
 * §2.4: Total Cash = Σ non-offset accounts of every kind (Cash!C13; loans you've made stay in, D49);
 * offsets are never in it; available cash = total − loans you've made (D59); the emergency-fund
 * test cash = (loans counted ? total : available) + (offsets counted ? offsets : 0) (D56, D59).
 */
export function cashTotals(i: {
  accounts: readonly EngineCashAccount[];
  offsetsIncludeEmergencyFund: boolean;
  loansCountForEmergencyFund: boolean;
}): CashTotalsResult {
  const byKind = Object.fromEntries(CASH_ACCOUNT_KINDS.map((k) => [k, 0])) as Record<
    CashAccountKind,
    Cents
  >;
  let offsetCents = 0;
  for (const a of i.accounts) {
    const balance = checkCents(a.balanceCents, `account ${a.id} balance`);
    if (a.isOffset) offsetCents += balance;
    else byKind[a.kind] += balance;
  }
  const totalCashCents = CASH_ACCOUNT_KINDS.reduce((sum, k) => sum + byKind[k], 0);
  const loansCents = byKind.loan_receivable;
  const availableCashCents = totalCashCents - loansCents;
  const emergencyFundTestCents =
    (i.loansCountForEmergencyFund ? totalCashCents : availableCashCents) +
    (i.offsetsIncludeEmergencyFund ? offsetCents : 0);
  return {
    totalCashCents,
    byKind,
    offsetCents,
    loansCents,
    availableCashCents,
    emergencyFundTestCents,
  };
}

/** Net pay × the template's pay-frequency factor, rounded once; null when either is null. */
export function monthlyPayCents(i: {
  netPayCents: Cents | null;
  payFrequency: PayFrequency | null;
}): Cents | null {
  if (i.netPayCents === null || i.payFrequency === null) return null;
  return centsOf(dollarsOf(i.netPayCents, 'net pay').times(PAY_FACTORS[i.payFrequency]));
}
