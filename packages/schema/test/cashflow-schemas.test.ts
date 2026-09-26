// The Stage 3 request schemas (stage-3.md §4.3): bounds, strictness, blank text → null, unique ids,
// the ex-date rule, the editable settings and the date bound with an injected clock.
import { describe, expect, it } from 'vitest';
import {
  budgetAutoRowInputSchema,
  budgetItemInputSchema,
  CASHFLOW_MONEY_MAX,
  cashAccountCreateSchema,
  cashAccountUpdateSchema,
  cashBalancesInputSchema,
  dividendEventKeySchema,
  EDITABLE_SETTING_KEYS,
  incomeStreamInputSchema,
  makeCashAccountCreateSchema,
  makeCashBalancesInputSchema,
  makeCashflowDateSchema,
  makeDepositInputSchema,
  makeDividendInputSchema,
  periodNoteInputSchema,
  reorderSchema,
  savingsAdjustmentInputSchema,
  savingsGoalInputSchema,
  settingsPatchSchema,
  SETTINGS_INTEGER_MAX,
  SETTINGS_PATCH_MAX_KEYS,
  yearlyExpenseInputSchema,
} from '../src/index';
import type { z } from 'zod';

/** Thu 24/09/2026 14:32 local: "tomorrow" is 25/09/2026. */
const now = () => new Date(2026, 8, 24, 14, 32);

/** `path: message` lines, as the server's 400 formats them. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
}
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('makeCashflowDateSchema', () => {
  const date = makeCashflowDateSchema(now);

  it('accepts real dates from 01/01/1900 to tomorrow', () => {
    for (const d of ['1900-01-01', '2024-02-29', '2026-09-24', '2026-09-25']) {
      expect(ok(date, d), d).toBe(true);
    }
  });

  it('rejects malformed, too early and future dates with one message each', () => {
    expect(issues(date, '2026-09-26')).toEqual([': must not be after tomorrow']);
    expect(issues(date, '1899-12-31')).toEqual([': must be on or after 01/01/1900']);
    expect(issues(date, '2026-02-30')).toEqual([': must be a date written YYYY-MM-DD']);
    expect(issues(date, '24/09/2026')).toEqual([': must be a date written YYYY-MM-DD']);
  });

  it('defaults to the real clock', () => {
    expect(ok(makeCashflowDateSchema(), '2000-01-01')).toBe(true);
    expect(ok(makeCashflowDateSchema(), '2999-01-01')).toBe(false);
  });
});

describe('cash accounts and balances', () => {
  const account = { name: '  Everyday account ', kind: 'bank', isOffset: false, note: '' };

  it('trims names, maps a blank note to null and is strict', () => {
    expect(cashAccountUpdateSchema.parse(account)).toEqual({
      name: 'Everyday account',
      kind: 'bank',
      isOffset: false,
      note: null,
    });
    expect(issues(cashAccountUpdateSchema, { ...account, name: '   ' })).toEqual([
      'name: is required',
    ]);
    expect(issues(cashAccountUpdateSchema, { ...account, name: 'x'.repeat(81) })).toEqual([
      'name: must be at most 80 characters',
    ]);
    expect(ok(cashAccountUpdateSchema, { ...account, kind: 'savings' })).toBe(false);
    expect(ok(cashAccountUpdateSchema, { ...account, extra: 1 })).toBe(false);
    for (const kind of ['bank', 'credit_card', 'loan_receivable', 'other']) {
      expect(ok(cashAccountUpdateSchema, { ...account, kind }), kind).toBe(true);
    }
  });

  it('creates with a signed opening balance and a bounded as-of date', () => {
    const create = makeCashAccountCreateSchema(now);
    const body = { ...account, openingBalanceCents: -150000, asOf: '2026-09-24' };
    expect(create.parse(body)).toMatchObject({ openingBalanceCents: -150000, asOf: '2026-09-24' });
    expect(issues(create, { ...body, asOf: '2026-09-26' })).toEqual([
      'asOf: must not be after tomorrow',
    ]);
    expect(ok(create, { ...body, openingBalanceCents: 1.5 })).toBe(false);
    expect(ok(create, { ...body, openingBalanceCents: CASHFLOW_MONEY_MAX })).toBe(true);
    expect(ok(create, { ...body, openingBalanceCents: -CASHFLOW_MONEY_MAX - 1 })).toBe(false);
    expect(ok(create, { ...body, extra: true })).toBe(false);
    expect(ok(cashAccountCreateSchema, { ...body, asOf: '2000-01-01' })).toBe(true);
  });

  it('takes 1–200 balance entries, each account once', () => {
    const balances = makeCashBalancesInputSchema(now);
    const entry = (accountId: number, note?: string) => ({ accountId, balanceCents: 500000, note });
    expect(balances.parse({ asOf: '2026-09-24', entries: [entry(1, ' '), entry(2)] })).toEqual({
      asOf: '2026-09-24',
      entries: [
        { accountId: 1, balanceCents: 500000, note: null },
        { accountId: 2, balanceCents: 500000 },
      ],
    });
    expect(issues(balances, { asOf: '2026-09-24', entries: [entry(1), entry(1)] })).toEqual([
      'entries: an account appears twice',
    ]);
    expect(issues(balances, { asOf: '2026-09-24', entries: [] })).toEqual([
      'entries: must list at least one account',
    ]);
    const many = Array.from({ length: 201 }, (_, i) => entry(i + 1));
    expect(issues(balances, { asOf: '2026-09-24', entries: many })).toEqual([
      'entries: must list at most 200 accounts',
    ]);
    expect(ok(balances, { asOf: '2026-09-24', entries: [{ ...entry(1), extra: 1 }] })).toBe(false);
    expect(ok(balances, { asOf: '2026-09-24', entries: [entry(0)] })).toBe(false);
    expect(ok(cashBalancesInputSchema, { asOf: '2026-09-24', entries: [entry(3)] })).toBe(true);
  });
});

describe('adjustments, notes, goals and reorder', () => {
  it('needs a non-zero signed amount and a note for an adjustment', () => {
    expect(
      savingsAdjustmentInputSchema.parse({ amountCents: -100000, note: ' Car sold ' }),
    ).toEqual({ amountCents: -100000, note: 'Car sold' });
    expect(issues(savingsAdjustmentInputSchema, { amountCents: 0, note: 'x' })).toEqual([
      'amountCents: must not be zero',
    ]);
    expect(issues(savingsAdjustmentInputSchema, { amountCents: 5, note: '' })).toEqual([
      'note: is required',
    ]);
    expect(
      ok(savingsAdjustmentInputSchema, { amountCents: CASHFLOW_MONEY_MAX + 1, note: 'x' }),
    ).toBe(false);
  });

  it('trims a period note; empty text is allowed (it deletes)', () => {
    expect(periodNoteInputSchema.parse({ note: '  ' })).toEqual({ note: '' });
    expect(ok(periodNoteInputSchema, { note: 'x'.repeat(500) })).toBe(true);
    expect(ok(periodNoteInputSchema, { note: 'x'.repeat(501) })).toBe(false);
    expect(ok(periodNoteInputSchema, { note: 'x', kind: 'spend' })).toBe(false);
  });

  it('bounds a goal target and its optional date', () => {
    const goal = { name: 'Holiday', targetCents: 500000, targetDate: '2027-06-30', note: '' };
    expect(savingsGoalInputSchema.parse(goal)).toEqual({ ...goal, note: null });
    expect(ok(savingsGoalInputSchema, { ...goal, targetDate: null })).toBe(true);
    expect(issues(savingsGoalInputSchema, { ...goal, targetCents: 0 })).toEqual([
      'targetCents: must be greater than zero',
    ]);
    expect(ok(savingsGoalInputSchema, { ...goal, targetDate: '2201-01-01' })).toBe(false);
    expect(ok(savingsGoalInputSchema, { ...goal, targetDate: '1899-12-31' })).toBe(false);
    expect(ok(savingsGoalInputSchema, { ...goal, targetDate: '2200-12-31' })).toBe(true);
  });

  it('reorders 1–500 unique positive ids', () => {
    expect(ok(reorderSchema, { ids: [3, 1, 2] })).toBe(true);
    expect(issues(reorderSchema, { ids: [1, 2, 1] })).toEqual(['ids: an id appears twice']);
    expect(ok(reorderSchema, { ids: [] })).toBe(false);
    expect(ok(reorderSchema, { ids: [0] })).toBe(false);
    expect(ok(reorderSchema, { ids: Array.from({ length: 501 }, (_, i) => i + 1) })).toBe(false);
  });
});

describe('side income, budget and yearly expenses', () => {
  it('takes a non-zero deposit (negative = a reversal) up to tomorrow', () => {
    const deposit = makeDepositInputSchema(now);
    const body = { streamId: 1, date: '2026-09-25', amountCents: -5000, note: '' };
    expect(deposit.parse(body)).toEqual({ ...body, note: null });
    expect(issues(deposit, { ...body, amountCents: 0 })).toEqual(['amountCents: must not be zero']);
    expect(issues(deposit, { ...body, date: '2026-09-26' })).toEqual([
      'date: must not be after tomorrow',
    ]);
    expect(ok(deposit, { ...body, note: 'x'.repeat(201) })).toBe(false);
  });

  it('takes a stream name and its archived flag', () => {
    expect(ok(incomeStreamInputSchema, { name: 'Consulting', archived: false })).toBe(true);
    expect(ok(incomeStreamInputSchema, { name: 'x'.repeat(61), archived: false })).toBe(false);
    expect(ok(incomeStreamInputSchema, { name: 'Consulting' })).toBe(false);
  });

  it('takes a budget item with a non-negative amount and an optional account', () => {
    const body = { name: 'Rent', monthlyCents: 220000, category: ' ', accountId: null };
    expect(budgetItemInputSchema.parse(body)).toEqual({ ...body, category: null });
    expect(ok(budgetItemInputSchema, { ...body, monthlyCents: 0 })).toBe(true);
    expect(issues(budgetItemInputSchema, { ...body, monthlyCents: -1 })).toEqual([
      'monthlyCents: must not be negative',
    ]);
    expect(ok(budgetItemInputSchema, { ...body, category: 'x'.repeat(41) })).toBe(false);
    expect(ok(budgetItemInputSchema, { ...body, accountId: 0 })).toBe(false);
  });

  it('takes an automatic row with an optional manual amount (D54)', () => {
    const body = { category: 'Investing', accountId: 2 };
    expect(budgetAutoRowInputSchema.parse(body)).toEqual(body);
    expect(ok(budgetAutoRowInputSchema, { ...body, manualMonthlyCents: 100000 })).toBe(true);
    expect(ok(budgetAutoRowInputSchema, { ...body, manualMonthlyCents: null })).toBe(true);
    expect(ok(budgetAutoRowInputSchema, { ...body, manualMonthlyCents: -1 })).toBe(false);
    expect(ok(budgetAutoRowInputSchema, { ...body, name: 'x' })).toBe(false);
  });

  it('takes a yearly expense', () => {
    expect(ok(yearlyExpenseInputSchema, { name: 'Insurance', annualCents: 150000 })).toBe(true);
    expect(ok(yearlyExpenseInputSchema, { name: 'Insurance', annualCents: -1 })).toBe(false);
  });
});

describe('dividends', () => {
  const dividend = makeDividendInputSchema(now);
  const body = {
    instrumentId: 3,
    paymentDate: '2026-09-16',
    exDate: '2026-09-01',
    reinvested: true,
    netAmountCents: 4725,
    note: '',
  };

  it('parses a payment with the price at the ex-date omitted, typed or null', () => {
    expect(dividend.parse(body)).toEqual({ ...body, note: null });
    expect(dividend.parse({ ...body, priceAtEx: '105.20' })).toMatchObject({ priceAtEx: '105.2' });
    expect(dividend.parse({ ...body, priceAtEx: null })).toMatchObject({ priceAtEx: null });
    expect(ok(dividend, { ...body, exDate: null, reinvested: null })).toBe(true);
  });

  it('rejects an ex-date after the payment date, a zero amount and a bad price', () => {
    expect(issues(dividend, { ...body, exDate: '2026-09-17' })).toEqual([
      'exDate: after the payment date',
    ]);
    expect(issues(dividend, { ...body, netAmountCents: 0 })).toEqual([
      'netAmountCents: must not be zero',
    ]);
    expect(ok(dividend, { ...body, priceAtEx: '-1' })).toBe(false);
    expect(ok(dividend, { ...body, paymentDate: '2026-09-26' })).toBe(false);
    expect(ok(dividend, { ...body, ticker: 'XYZ' })).toBe(false);
  });

  it('keys a Yahoo event by instrument and ex-date', () => {
    expect(ok(dividendEventKeySchema, { instrumentId: 3, exDate: '2026-09-01' })).toBe(true);
    expect(ok(dividendEventKeySchema, { instrumentId: 3, exDate: '01/09/2026' })).toBe(false);
    expect(ok(dividendEventKeySchema, { instrumentId: 3, exDate: '2026-09-01', x: 1 })).toBe(false);
  });
});

describe('settingsPatchSchema', () => {
  it('parses each editable key with its own value schema, or null', () => {
    expect(
      settingsPatchSchema.parse({
        values: {
          'savings.yearBasis': 'calendar',
          'pay.netPayCents': 650000,
          'goals.houseDepositInvestmentShare': '0.2',
          'budget.emergencyFundOverrideCents': null,
        },
      }),
    ).toEqual({
      values: {
        'savings.yearBasis': 'calendar',
        'pay.netPayCents': 650000,
        'goals.houseDepositInvestmentShare': '0.2',
        'budget.emergencyFundOverrideCents': null,
      },
    });
  });

  it('refuses a key that is not editable here, and a bad value with its key path', () => {
    // Stage 5 (D86, D91): every key is editable but the server-written cap FY.
    expect(issues(settingsPatchSchema, { values: { 'super.concessionalCapFy': 2026 } })).toEqual([
      'values.super.concessionalCapFy: not editable here',
    ]);
    expect(issues(settingsPatchSchema, { values: { 'savings.yearBasis': 'weekly' } })).toHaveLength(
      1,
    );
    expect(issues(settingsPatchSchema, { values: { 'savings.yearBasis': 'weekly' } })[0]).toMatch(
      /^values\.savings\.yearBasis: /,
    );
    expect(issues(settingsPatchSchema, { values: { 'pay.dayOfMonth': 29 } })[0]).toMatch(
      /^values\.pay\.dayOfMonth: /,
    );
    expect(issues(settingsPatchSchema, { values: { nope: 1 } })).toEqual([
      'values.nope: not editable here',
    ]);
  });

  it('takes 1–64 keys (Stage 5: above the 60 editable keys) and is strict', () => {
    expect(SETTINGS_PATCH_MAX_KEYS).toBe(64);
    expect(EDITABLE_SETTING_KEYS.length).toBeLessThanOrEqual(SETTINGS_PATCH_MAX_KEYS);
    expect(issues(settingsPatchSchema, { values: {} })).toEqual([
      'values: must hold 1 to 64 settings',
    ]);
    const tooMany = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`key${i}`, 1] as const),
    );
    expect(issues(settingsPatchSchema, { values: tooMany })).toEqual([
      'values: must hold 1 to 64 settings',
    ]);
    expect(ok(settingsPatchSchema, { values: { 'savings.yearBasis': 'fy' }, extra: 1 })).toBe(
      false,
    );
    expect(ok(settingsPatchSchema, {})).toBe(false);
  });

  it('accepts every editable key with a null value', () => {
    const all = Object.fromEntries(EDITABLE_SETTING_KEYS.map((k) => [k, null]));
    expect(settingsPatchSchema.parse({ values: all }).values).toEqual(all);
  });

  it('bounds the Stage 4 keys (stage-4.md §3.3); the cap FY is never editable', () => {
    const values = {
      'pay.grossAnnualSalaryCents': 12000000,
      'tax.marginalRate': '0.3',
      'otherAssets.stalePriceDays': 90,
      'super.sgRate': '0.12',
      'super.contributionsTaxRate': '0.15',
      'super.concessionalCapCents': 3250000,
      'super.importedContributionType': 'after_tax',
    };
    expect(settingsPatchSchema.parse({ values }).values).toEqual(values);
    const days = 'otherAssets.stalePriceDays';
    expect(ok(settingsPatchSchema, { values: { [days]: 1 } })).toBe(true);
    expect(ok(settingsPatchSchema, { values: { [days]: 3650 } })).toBe(true);
    expect(issues(settingsPatchSchema, { values: { [days]: 0 } })[0]).toMatch(
      /^values\.otherAssets/,
    );
    expect(ok(settingsPatchSchema, { values: { [days]: 3651 } })).toBe(false);
    expect(ok(settingsPatchSchema, { values: { [days]: 1.5 } })).toBe(false);
    expect(issues(settingsPatchSchema, { values: { 'super.sgRate': '1.2' } })).toEqual([
      'values.super.sgRate: must be between 0 and 1',
    ]);
    expect(
      ok(settingsPatchSchema, { values: { 'super.importedContributionType': 'employer' } }),
    ).toBe(false);
    expect(
      issues(settingsPatchSchema, {
        values: { 'super.concessionalCapCents': CASHFLOW_MONEY_MAX + 1 },
      }),
    ).toEqual(['values.super.concessionalCapCents: is too large']);
    expect(issues(settingsPatchSchema, { values: { 'super.concessionalCapFy': 2026 } })).toEqual([
      'values.super.concessionalCapFy: not editable here',
    ]);
  });

  it('enforces the write bounds: a ratio within 0..1, money and months not absurdly large', () => {
    const share = 'goals.houseDepositInvestmentShare';
    for (const v of ['0', '1', '0.5'])
      expect(ok(settingsPatchSchema, { values: { [share]: v } })).toBe(true);
    for (const v of ['-0.01', '1.01', '25', '-3']) {
      expect(issues(settingsPatchSchema, { values: { [share]: v } }), v).toEqual([
        `values.${share}: must be between 0 and 1`,
      ]);
    }
    expect(ok(settingsPatchSchema, { values: { 'pay.netPayCents': CASHFLOW_MONEY_MAX } })).toBe(
      true,
    );
    expect(
      issues(settingsPatchSchema, { values: { 'pay.netPayCents': CASHFLOW_MONEY_MAX + 1 } }),
    ).toEqual(['values.pay.netPayCents: is too large']);
    expect(
      issues(settingsPatchSchema, {
        values: { 'budget.emergencyFundOverrideCents': Number.MAX_SAFE_INTEGER },
      }),
    ).toEqual(['values.budget.emergencyFundOverrideCents: is too large']);
    expect(
      ok(settingsPatchSchema, { values: { 'budget.emergencyFundMonths': SETTINGS_INTEGER_MAX } }),
    ).toBe(true);
    expect(issues(settingsPatchSchema, { values: { 'budget.emergencyFundMonths': 1201 } })).toEqual(
      ['values.budget.emergencyFundMonths: must be at most 1200'],
    );
    // A registry maximum still applies as before (day of month 0..28).
    expect(ok(settingsPatchSchema, { values: { 'pay.dayOfMonth': 28 } })).toBe(true);
    // Every bad key is reported, and nothing is parsed.
    expect(
      issues(settingsPatchSchema, {
        values: { [share]: '2', 'pay.netPayCents': CASHFLOW_MONEY_MAX + 1 },
      }),
    ).toHaveLength(2);
  });
});
