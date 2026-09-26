// The Stage 4 request schemas (stage-4.md §4.3), the statutory super tables and the payment grid
// helper (§3.2): bounds, strictness, `''` → null, unique ids, the bullion/manual/AUD refines and
// the date bound with an injected clock.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ANNUALISED_MIN_DAYS,
  assetValueTooLarge,
  ASSETS_MONEY_MAX,
  CASHFLOW_MONEY_MAX,
  COMPOUNDING_CHOICES,
  isOtherAssetCurrency,
  loanBalanceEntryUpdateSchema,
  loanOffsetsInputSchema,
  makeLoanBalancesInputSchema,
  makeLoanCreateSchema,
  makeLoanUpdateSchema,
  makeOtherAssetCreateSchema,
  makeOtherAssetPricesInputSchema,
  makeOtherAssetSaleInputSchema,
  makeOtherAssetUpdateSchema,
  makePropertyCreateSchema,
  makePropertyUpdateSchema,
  makeSuperBalancesInputSchema,
  makeSuperContributionInputSchema,
  makeSuperFundCreateSchema,
  makeValuationsInputSchema,
  ORDER_VALUE_CENTS_MAX,
  OTHER_ASSET_OZ_MAX,
  OTHER_ASSET_STALE_DAYS_DEFAULT,
  otherAssetCreateSchema,
  PAYDAY_SUPER_START,
  PAYMENTS_PER_YEAR,
  paymentDatesBetween,
  sgOverrideInputSchema,
  SG_QUARTER_DUE_DAYS,
  SUPER_CAP_WARNING_RATIO,
  SUPER_CONCESSIONAL_CAPS,
  SUPER_CONTRIBUTIONS_TAX_DEFAULT,
  SUPER_RATES_CHECKED_ON,
  SUPER_SG_RATE_DEFAULT,
  SUPER_SG_RATES,
  superFundUpdateSchema,
} from '../src/index';

/** Thu 24/09/2026 14:32 local: "tomorrow" is 25/09/2026. */
const now = () => new Date(2026, 8, 24, 14, 32);

/** `path: message` lines, as the server's 400 formats them. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`);
}
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('statutory tables and constants (§3.2)', () => {
  it('holds the recorded ATO figures by FY start year', () => {
    expect(SUPER_CONCESSIONAL_CAPS).toEqual({
      2021: 2_750_000,
      2022: 2_750_000,
      2023: 2_750_000,
      2024: 3_000_000,
      2025: 3_000_000,
      2026: 3_250_000,
    });
    expect(SUPER_SG_RATES).toEqual({
      2021: '0.1',
      2022: '0.105',
      2023: '0.11',
      2024: '0.115',
      2025: '0.12',
    });
    // Consecutive years; the SG rate never falls; the default is the table's last rate.
    for (const table of [SUPER_CONCESSIONAL_CAPS, SUPER_SG_RATES]) {
      const years = Object.keys(table).map(Number);
      expect(years).toEqual(years.map((_, i) => years[0]! + i));
    }
    const rates = Object.values(SUPER_SG_RATES).map(Number);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
    expect(SUPER_SG_RATE_DEFAULT).toBe(Object.values(SUPER_SG_RATES).at(-1));
    expect(SUPER_CONTRIBUTIONS_TAX_DEFAULT).toBe('0.15');
    expect(SUPER_CAP_WARNING_RATIO).toBe('0.9');
    expect(PAYDAY_SUPER_START).toBe('2026-07-01');
    expect(SG_QUARTER_DUE_DAYS).toBe(28);
    expect(SUPER_RATES_CHECKED_ON).toBe('2026-09-26');
    expect(PAYMENTS_PER_YEAR).toEqual({ weekly: 52, fortnightly: 26, monthly: 12 });
    expect(COMPOUNDING_CHOICES).toEqual([12, 26, 52, 365]);
    expect([OTHER_ASSET_STALE_DAYS_DEFAULT, ANNUALISED_MIN_DAYS]).toEqual([90, 90]);
    expect(ASSETS_MONEY_MAX).toBe(CASHFLOW_MONEY_MAX);
  });

  it('accepts a 3-letter currency code or GBX', () => {
    for (const c of ['AUD', 'USD', 'GBX', 'JPY']) expect(isOtherAssetCurrency(c), c).toBe(true);
    for (const c of ['usd', 'US', 'USDX', '', 'U$D'])
      expect(isOtherAssetCurrency(c), c).toBe(false);
  });
});

describe('paymentDatesBetween (§2.3)', () => {
  it('clamps month ends from the anchor, never chaining', () => {
    expect(paymentDatesBetween('2026-01-31', 'monthly', '2026-01-31', '2026-05-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(paymentDatesBetween('2024-01-31', 'monthly', '2024-01-31', '2024-03-31')).toEqual([
      '2024-02-29',
      '2024-03-31',
    ]);
  });

  it('counts the grid dates in (after, through]: after excluded, through included', () => {
    const anchor = '2020-03-15';
    expect(paymentDatesBetween(anchor, 'monthly', '2026-02-15', '2026-05-15')).toEqual([
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
    ]);
    expect(paymentDatesBetween(anchor, 'monthly', '2026-02-28', '2026-05-31')).toHaveLength(3);
    // From the anchor to a later date: every payment since (the anchor itself is not one).
    expect(paymentDatesBetween(anchor, 'monthly', anchor, '2026-02-28')).toHaveLength(71);
  });

  it('steps fortnightly and weekly from the anchor', () => {
    expect(paymentDatesBetween('2026-07-01', 'fortnightly', '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-15',
      '2026-07-29',
      '2026-08-12',
      '2026-08-26',
    ]);
    expect(paymentDatesBetween('2026-07-01', 'weekly', '2026-07-10', '2026-07-29')).toEqual([
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
    ]);
    // Far from the anchor: the same grid (no drift).
    expect(paymentDatesBetween('2020-01-06', 'fortnightly', '2026-08-31', '2026-09-24')).toEqual([
      '2026-09-07',
      '2026-09-21',
    ]);
  });

  it('handles an anchor after `after` and an empty range', () => {
    expect(paymentDatesBetween('2026-06-10', 'monthly', '2026-01-01', '2026-08-31')).toEqual([
      '2026-07-10',
      '2026-08-10',
    ]);
    // The first weekly payment (17/06) is after the range; the anchor (10/06) never counts.
    expect(paymentDatesBetween('2026-06-10', 'weekly', '2026-06-01', '2026-06-16')).toEqual([]);
    expect(paymentDatesBetween('2026-06-10', 'weekly', '2026-06-01', '2026-06-17')).toEqual([
      '2026-06-17',
    ]);
    expect(paymentDatesBetween('2026-01-15', 'monthly', '2026-05-31', '2026-05-31')).toEqual([]);
    expect(paymentDatesBetween('2026-01-15', 'monthly', '2026-06-30', '2026-05-31')).toEqual([]);
    expect(paymentDatesBetween('2026-01-15', 'monthly', '2026-05-16', '2026-06-14')).toEqual([]);
    expect(() => paymentDatesBetween('15/01/2026', 'monthly', '2026-01-01', '2026-02-01')).toThrow(
      RangeError,
    );
  });
});

describe('other assets (§4.3)', () => {
  const manual = {
    description: '  Example watch ',
    url: '',
    note: '',
    purchaseDate: '2023-04-01',
    units: '1',
    currency: 'aud',
    unitCost: '1500.00',
    purchaseFxRate: null,
    priceSource: 'manual',
    metal: null,
    ozPerUnit: null,
  };
  const update = makeOtherAssetUpdateSchema(now);

  it('trims, upper-cases the currency, normalises decimals and maps blanks to null', () => {
    expect(update.parse(manual)).toEqual({
      ...manual,
      description: 'Example watch',
      url: null,
      note: null,
      currency: 'AUD',
      unitCost: '1500',
    });
    expect(ok(update, { ...manual, unitCost: '0' })).toBe(true);
    expect(ok(update, { ...manual, unitCost: null })).toBe(true);
    expect(ok(update, { ...manual, purchaseDate: null })).toBe(true);
    expect(ok(update, { ...manual, extra: 1 })).toBe(false);
  });

  it('bounds the fields', () => {
    expect(issues(update, { ...manual, description: ' ' })).toEqual(['description: is required']);
    expect(issues(update, { ...manual, description: 'x'.repeat(201) })).toEqual([
      'description: must be at most 200 characters',
    ]);
    expect(issues(update, { ...manual, currency: 'US' })).toEqual([
      'currency: must be a 3-letter currency code or GBX',
    ]);
    expect(issues(update, { ...manual, url: 'ftp://example.com/x' })).toEqual([
      'url: must start with http:// or https://',
    ]);
    expect(ok(update, { ...manual, url: 'https://example.com/item' })).toBe(true);
    expect(issues(update, { ...manual, url: `https://example.com/${'x'.repeat(490)}` })).toEqual([
      'url: must be at most 500 characters',
    ]);
    expect(ok(update, { ...manual, units: '0' })).toBe(false);
    expect(ok(update, { ...manual, unitCost: '-1' })).toBe(false);
    expect(ok(update, { ...manual, unitCost: '1000000001' })).toBe(false);
    expect(issues(update, { ...manual, purchaseDate: '2026-09-26' })).toEqual([
      'purchaseDate: must not be after tomorrow',
    ]);
    expect(ok(update, { ...manual, purchaseDate: '2026-09-25' })).toBe(true);
  });

  it('applies the bullion, manual and AUD refines', () => {
    const bullion = { ...manual, priceSource: 'bullion', metal: 'silver', ozPerUnit: '1' };
    expect(ok(update, bullion)).toBe(true);
    expect(issues(update, { ...bullion, metal: null, ozPerUnit: null })).toEqual([
      'metal: is required for bullion',
      'ozPerUnit: is required for bullion',
    ]);
    expect(issues(update, { ...bullion, currency: 'USD', purchaseFxRate: '1.5' })).toEqual([
      'currency: bullion is priced in AUD',
    ]);
    expect(issues(update, { ...manual, metal: 'gold', ozPerUnit: '1' })).toEqual([
      'metal: only for bullion',
      'ozPerUnit: only for bullion',
    ]);
    expect(issues(update, { ...manual, purchaseFxRate: '1.5' })).toEqual([
      'purchaseFxRate: only for a foreign currency',
    ]);
    expect(ok(update, { ...manual, currency: 'GBX', purchaseFxRate: '0.0195' })).toBe(true);
    expect(ok(update, { ...manual, currency: 'USD', purchaseFxRate: '0' })).toBe(false);
  });

  it('bounds the joint products at and just over each limit (Fixer round 1)', () => {
    expect(ORDER_VALUE_CENTS_MAX).toBe(1e13);
    expect(OTHER_ASSET_OZ_MAX).toBe(1e7);
    // units × unit cost: 100,000 × $1,000,000 = 1e13 cents, at the bound.
    expect(ok(update, { ...manual, units: '100000', unitCost: '1000000' })).toBe(true);
    expect(issues(update, { ...manual, units: '100000', unitCost: '1000000.01' })).toEqual([
      'unitCost: units × unit cost is too large',
    ]);
    // A foreign item's cost includes the FX rate at purchase.
    const usd = { ...manual, currency: 'USD', units: '1000', unitCost: '1000000' };
    expect(ok(update, { ...usd, purchaseFxRate: '100' })).toBe(true);
    expect(issues(update, { ...usd, purchaseFxRate: '100.01' })).toEqual([
      'unitCost: units × unit cost is too large',
    ]);
    expect(ok(update, { ...usd, purchaseFxRate: null })).toBe(true);
    // Bullion: units × oz per unit within OTHER_ASSET_OZ_MAX.
    const bullion = { ...manual, priceSource: 'bullion', metal: 'silver', ozPerUnit: '1' };
    expect(ok(update, { ...bullion, units: '10000000', unitCost: '1' })).toBe(true);
    expect(issues(update, { ...bullion, units: '10000001', unitCost: '1' })).toEqual([
      'ozPerUnit: units × oz per unit is too large',
    ]);
    expect(issues(update, { ...bullion, units: '1000', ozPerUnit: '10000.5' })).toEqual([
      'ozPerUnit: units × oz per unit is too large',
    ]);
    // A new item's first price: units × price.
    const create = makeOtherAssetCreateSchema(now);
    const price = (unitPrice: string) => ({ unitPrice, asOf: '2026-09-24' });
    expect(ok(create, { ...manual, units: '100000', price: price('1000000') })).toBe(true);
    expect(issues(create, { ...manual, units: '100000', price: price('1000000.01') })).toEqual([
      'price.unitPrice: units × price is too large',
    ]);
    // The helpers skip a missing or unparsable part (the field checks report those).
    expect(assetValueTooLarge(['1e9', null])).toBe(false);
    expect(assetValueTooLarge(['x', '1e20'])).toBe(false);
    expect(assetValueTooLarge(['100000', '1000000.01'])).toBe(true);
  });

  it('creates with a first price (manual only), bound to the injected clock', () => {
    const create = makeOtherAssetCreateSchema(now);
    const price = { unitPrice: '1800.50', asOf: '2026-09-24' };
    expect(create.parse({ ...manual, price }).price).toEqual({
      unitPrice: '1800.5',
      asOf: '2026-09-24',
    });
    expect(ok(create, { ...manual, price: null })).toBe(true);
    expect(issues(create, { ...manual, price: { ...price, asOf: '2026-09-26' } })).toEqual([
      'price.asOf: must not be after tomorrow',
    ]);
    expect(
      issues(create, { ...manual, priceSource: 'bullion', metal: 'gold', ozPerUnit: '1', price }),
    ).toEqual(['price: bullion is priced from spot']);
    expect(ok(create, manual)).toBe(false); // price is required (null for none)
    // The default export binds the real clock.
    expect(ok(otherAssetCreateSchema, { ...manual, price: null })).toBe(true);
  });

  it('takes a price update with unique assets and a sale', () => {
    const prices = makeOtherAssetPricesInputSchema(now);
    const body = { asOf: '2026-09-24', entries: [{ assetId: 1, unitPrice: '1800', note: '' }] };
    expect(prices.parse(body).entries[0]).toEqual({ assetId: 1, unitPrice: '1800', note: null });
    expect(
      issues(prices, { ...body, entries: [...body.entries, { assetId: 1, unitPrice: '1' }] }),
    ).toEqual(['entries: an asset appears twice']);
    expect(issues(prices, { ...body, entries: [] })).toEqual([
      'entries: must list at least one asset',
    ]);
    expect(ok(prices, { ...body, entries: [{ assetId: 1, unitPrice: '0' }] })).toBe(true);
    const sale = makeOtherAssetSaleInputSchema(now);
    const s = { saleDate: '2026-09-24', units: '1', proceedsCents: 70000, note: '' };
    expect(sale.parse(s)).toEqual({ ...s, note: null });
    expect(ok(sale, { ...s, units: '0' })).toBe(false);
    expect(ok(sale, { ...s, proceedsCents: -1 })).toBe(false);
    expect(ok(sale, { ...s, proceedsCents: 0 })).toBe(true);
    expect(ok(sale, { ...s, proceedsCents: ASSETS_MONEY_MAX + 1 })).toBe(false);
    expect(ok(sale, { ...s, saleDate: '2026-09-26' })).toBe(false);
  });
});

describe('super (§4.3)', () => {
  it('takes funds: update, create with an opening balance and the rollover choice', () => {
    expect(
      superFundUpdateSchema.parse({ name: ' Example Super ', receivesSg: true, archived: false }),
    ).toEqual({
      name: 'Example Super',
      receivesSg: true,
      archived: false,
    });
    expect(
      issues(superFundUpdateSchema, { name: 'x'.repeat(81), receivesSg: false, archived: false }),
    ).toEqual(['name: must be at most 80 characters']);
    const create = makeSuperFundCreateSchema(now);
    const body = {
      name: 'Second Super',
      receivesSg: false,
      openingBalanceCents: 200000,
      asOf: '2026-06-15',
      openingIsRollover: false,
    };
    expect(ok(create, body)).toBe(true);
    expect(ok(create, { ...body, openingIsRollover: undefined })).toBe(false);
    expect(issues(create, { ...body, openingBalanceCents: -1 })).toEqual([
      'openingBalanceCents: must not be negative',
    ]);
  });

  it('takes a balance update: unique funds; transferIn omitted, null or cents', () => {
    const balances = makeSuperBalancesInputSchema(now);
    const body = { asOf: '2026-09-20', entries: [{ fundId: 1, balanceCents: 6170000 }] };
    expect(balances.parse(body).entries[0]).toEqual({ fundId: 1, balanceCents: 6170000 });
    expect(
      ok(balances, { ...body, entries: [{ fundId: 1, balanceCents: 1, transferInCents: null }] }),
    ).toBe(true);
    expect(
      ok(balances, { ...body, entries: [{ fundId: 1, balanceCents: 1, transferInCents: 5 }] }),
    ).toBe(true);
    expect(
      ok(balances, { ...body, entries: [{ fundId: 1, balanceCents: 1, transferInCents: -5 }] }),
    ).toBe(false);
    expect(
      issues(balances, { ...body, entries: [...body.entries, { fundId: 1, balanceCents: 5 }] }),
    ).toEqual(['entries: a fund appears twice']);
    expect(
      issues(balances, {
        ...body,
        entries: Array.from({ length: 51 }, (_, i) => ({ fundId: i + 1, balanceCents: 0 })),
      }),
    ).toEqual(['entries: must list at most 50 funds']);
  });

  it('takes typed contributions only, positive amounts, and SG statements', () => {
    const contribution = makeSuperContributionInputSchema(now);
    const body = {
      fundId: null,
      date: '2026-07-15',
      kind: 'salary_sacrifice',
      amountCents: 100000,
      note: '',
    };
    expect(contribution.parse(body)).toEqual({ ...body, note: null });
    expect(ok(contribution, { ...body, kind: 'after_tax', fundId: 2 })).toBe(true);
    expect(ok(contribution, { ...body, kind: 'voluntary_contribution' })).toBe(false);
    expect(issues(contribution, { ...body, amountCents: 0 })).toEqual([
      'amountCents: must be greater than zero',
    ]);
    expect(issues(contribution, { ...body, amountCents: ASSETS_MONEY_MAX + 1 })).toEqual([
      'amountCents: is too large',
    ]);
    expect(ok(contribution, { ...body, date: '2026-09-26' })).toBe(false);
    expect(sgOverrideInputSchema.parse({ grossCents: 165000, note: ' From the payslip ' })).toEqual(
      {
        grossCents: 165000,
        note: 'From the payslip',
      },
    );
    expect(ok(sgOverrideInputSchema, { grossCents: 0, note: '' })).toBe(true);
    expect(ok(sgOverrideInputSchema, { grossCents: 1.5, note: '' })).toBe(false);
  });
});

describe('property and loans (§4.3)', () => {
  const property = {
    name: 'Example property',
    purchaseDate: '2020-03-15',
    isPrimaryResidence: true,
    purchaseValueCents: 50000000,
    netRentToDateCents: -120000,
    note: '',
  };

  it('takes a property (net rent may be negative) and its opening valuation', () => {
    expect(makePropertyUpdateSchema(now).parse(property)).toEqual({ ...property, note: null });
    expect(
      ok(makePropertyUpdateSchema(now), { ...property, netRentToDateCents: -ASSETS_MONEY_MAX - 1 }),
    ).toBe(false);
    const create = makePropertyCreateSchema(now);
    expect(ok(create, { ...property, valueCents: 60000000, asOf: '2026-08-31' })).toBe(true);
    expect(ok(create, property)).toBe(false);
    const valuations = makeValuationsInputSchema(now);
    const body = { asOf: '2026-08-31', entries: [{ propertyId: 1, valueCents: 60000000 }] };
    expect(ok(valuations, body)).toBe(true);
    expect(
      issues(valuations, { ...body, entries: [...body.entries, { propertyId: 1, valueCents: 1 }] }),
    ).toEqual(['entries: a property appears twice']);
  });

  const loan = {
    propertyId: 1,
    name: 'Example property mortgage',
    lender: '',
    startDate: '2020-03-15',
    startBalanceCents: 45000000,
    annualRate: '0.060',
    compoundingPerYear: 12,
    paymentCents: 280000,
    paymentFrequency: 'fortnightly',
    note: '',
  };

  it('takes a loan: rate within 0..1, compounding 1..365, a payment frequency', () => {
    const update = makeLoanUpdateSchema(now);
    expect(update.parse(loan)).toEqual({ ...loan, lender: null, note: null, annualRate: '0.06' });
    for (const n of [1, 365])
      expect(ok(update, { ...loan, compoundingPerYear: n }), String(n)).toBe(true);
    for (const n of [0, 366, 1.5])
      expect(ok(update, { ...loan, compoundingPerYear: n }), String(n)).toBe(false);
    expect(ok(update, { ...loan, annualRate: '1.2' })).toBe(false);
    expect(
      ok(update, {
        ...loan,
        annualRate: null,
        compoundingPerYear: null,
        paymentCents: null,
        startDate: null,
        startBalanceCents: null,
      }),
    ).toBe(true);
    expect(ok(update, { ...loan, paymentFrequency: 'quarterly' })).toBe(false);
    expect(ok(update, { ...loan, propertyId: null })).toBe(false);
    const create = makeLoanCreateSchema(now);
    expect(ok(create, { ...loan, balanceCents: 39090000, asOf: '2026-08-31' })).toBe(true);
    expect(ok(create, loan)).toBe(false);
  });

  it('takes loan balances (repayments omitted, null or cents), an entry edit and offsets', () => {
    const balances = makeLoanBalancesInputSchema(now);
    const body = { asOf: '2026-08-31', entries: [{ loanId: 1, balanceCents: 39090000 }] };
    expect(balances.parse(body).entries[0]).toEqual({ loanId: 1, balanceCents: 39090000 });
    expect(
      ok(balances, { ...body, entries: [{ loanId: 1, balanceCents: 1, repaymentsCents: null }] }),
    ).toBe(true);
    expect(
      issues(balances, { ...body, entries: [...body.entries, { loanId: 1, balanceCents: 5 }] }),
    ).toEqual(['entries: a loan appears twice']);
    expect(
      loanBalanceEntryUpdateSchema.parse({ balanceCents: 1, repaymentsCents: null, note: '' }),
    ).toEqual({
      balanceCents: 1,
      repaymentsCents: null,
      note: null,
    });
    expect(ok(loanBalanceEntryUpdateSchema, { balanceCents: 1, note: '' })).toBe(false);
    expect(ok(loanOffsetsInputSchema, { accountIds: [] })).toBe(true);
    expect(issues(loanOffsetsInputSchema, { accountIds: [5, 5] })).toEqual([
      'accountIds: an account appears twice',
    ]);
    expect(
      ok(loanOffsetsInputSchema, { accountIds: Array.from({ length: 21 }, (_, i) => i + 1) }),
    ).toBe(false);
  });
});
