// Cash totals (stage-3.md §2.4; D49, D56, D59) and the monthly pay (§4.5; §7.3 step 2).
import { PAY_FREQUENCIES } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  budgetInvestment,
  cashTotals,
  monthlyPayCents,
  type BudgetInvestInput,
  type EngineCashAccount,
} from '../src/index';

const account = (
  id: number,
  kind: EngineCashAccount['kind'],
  balanceCents: number,
  isOffset = false,
): EngineCashAccount => ({ id, kind, isOffset, balanceCents });

const accounts: EngineCashAccount[] = [
  account(1, 'bank', 500_000),
  account(2, 'bank', 120_000),
  account(3, 'credit_card', -80_000),
  account(4, 'loan_receivable', 300_000),
  account(5, 'other', 10_000),
  account(6, 'bank', 900_000, true),
];

describe('cashTotals (§2.4)', () => {
  it('sums every non-offset kind into Total Cash and keeps offsets out', () => {
    const r = cashTotals({
      accounts,
      offsetsIncludeEmergencyFund: false,
      loansCountForEmergencyFund: false,
    });
    expect(r).toEqual({
      totalCashCents: 850_000,
      byKind: { bank: 620_000, credit_card: -80_000, loan_receivable: 300_000, other: 10_000 },
      offsetCents: 900_000,
      loansCents: 300_000,
      availableCashCents: 550_000,
      emergencyFundTestCents: 550_000,
    });
  });

  it('leaves loans you have made out of the emergency-fund test unless told otherwise (D59)', () => {
    const test = (loans: boolean, offsets: boolean) =>
      cashTotals({
        accounts,
        offsetsIncludeEmergencyFund: offsets,
        loansCountForEmergencyFund: loans,
      }).emergencyFundTestCents;
    expect(test(false, false)).toBe(550_000);
    expect(test(true, false)).toBe(850_000);
    // D56: offsets count toward the emergency fund when the setting is on.
    expect(test(false, true)).toBe(1_450_000);
    expect(test(true, true)).toBe(1_750_000);
  });

  it('treats an offset flag as winning over the kind, and an empty list as zeros', () => {
    const r = cashTotals({
      accounts: [account(1, 'loan_receivable', 50_000, true)],
      offsetsIncludeEmergencyFund: false,
      loansCountForEmergencyFund: false,
    });
    expect(r).toMatchObject({ totalCashCents: 0, loansCents: 0, offsetCents: 50_000 });
    expect(
      cashTotals({
        accounts: [],
        offsetsIncludeEmergencyFund: true,
        loansCountForEmergencyFund: true,
      }),
    ).toMatchObject({ totalCashCents: 0, availableCashCents: 0, emergencyFundTestCents: 0 });
    expect(() =>
      cashTotals({
        accounts: [account(1, 'bank', 1.5)],
        offsetsIncludeEmergencyFund: false,
        loansCountForEmergencyFund: false,
      }),
    ).toThrow(RangeError);
  });
});

describe('monthlyPayCents', () => {
  it('multiplies net pay by the template factor of each frequency', () => {
    expect(monthlyPayCents({ netPayCents: 200_000, payFrequency: 'monthly' })).toBe(200_000);
    expect(monthlyPayCents({ netPayCents: 200_000, payFrequency: 'four_weekly' })).toBe(216_667);
    expect(monthlyPayCents({ netPayCents: 200_000, payFrequency: 'fortnightly' })).toBe(434_524);
    expect(monthlyPayCents({ netPayCents: 200_000, payFrequency: 'weekly' })).toBe(869_048);
    expect(monthlyPayCents({ netPayCents: 200_000, payFrequency: 'twice_monthly' })).toBe(400_000);
  });

  it('uses the same factors as the budget chain (one table)', () => {
    const base: BudgetInvestInput = {
      asOf: '2026-09-24',
      payFrequency: 'monthly',
      netPayCents: 123_457,
      includeSideIncome: false,
      sideIncomePeriods: [],
      items: [],
      yearlyExpenseAnnualCents: [],
      autoInvestSplit: null,
      useBudgetForInvest: null,
      cashTargetRatio: null,
      aggressiveness: null,
      lastSnapshotCashShare: null,
      currentCashShare: null,
      cashCents: 0,
      emergencyFundMonths: null,
      emergencyFundOverrideCents: null,
      marginalTaxRate: null,
      lastPurchaseDate: null,
    };
    for (const payFrequency of PAY_FREQUENCIES) {
      expect(monthlyPayCents({ netPayCents: 123_457, payFrequency })).toBe(
        budgetInvestment({ ...base, payFrequency }).monthlyIncomeCents,
      );
    }
  });

  it('is null when the pay or the frequency is missing', () => {
    expect(monthlyPayCents({ netPayCents: null, payFrequency: 'weekly' })).toBeNull();
    expect(monthlyPayCents({ netPayCents: 100_000, payFrequency: null })).toBeNull();
  });
});
