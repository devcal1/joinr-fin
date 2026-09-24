import { describe, expect, it } from 'vitest';
import {
  CentsSchema,
  correctionsSettingFromEnv,
  CorrectionsFileSchema,
  DecimalStringSchema,
  importQuerySchema,
  IsoDateSchema,
  IsoMonthSchema,
  IsoTimestampSchema,
  makeManualPriceInputSchema,
  parseReviewFlags,
  PositiveDecimalSchema,
  priceSourceInputSchema,
  refreshRequestSchema,
  serialiseReviewFlags,
  UPLOAD_LIMIT_BYTES,
} from '../src/index';

describe('primitive schemas', () => {
  it('accepts only real ISO dates, months and UTC timestamps', () => {
    expect(IsoDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(IsoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(IsoDateSchema.safeParse('2026-2-1').success).toBe(false);
    expect(IsoMonthSchema.safeParse('2026-12').success).toBe(true);
    expect(IsoMonthSchema.safeParse('2026-13').success).toBe(false);
    expect(IsoTimestampSchema.safeParse('2026-09-24T04:32:00.000Z').success).toBe(true);
    expect(IsoTimestampSchema.safeParse('2026-09-24T04:32:00Z').success).toBe(true);
    expect(IsoTimestampSchema.safeParse('2026-09-24T04:32:00+10:00').success).toBe(false);
  });

  it('accepts only normalised decimal strings and integer cents', () => {
    for (const ok of ['0', '1', '-2.5', '0.056', '12.3456789012', '100']) {
      expect(DecimalStringSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['-0', '1.50', '01', '1e5', '.5', '1,000', '', '+1']) {
      expect(DecimalStringSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(CentsSchema.safeParse(-12345).success).toBe(true);
    expect(CentsSchema.safeParse(1.5).success).toBe(false);
    expect(CentsSchema.safeParse(2 ** 53).success).toBe(false);
  });

  it('parses user-entered positive decimals', () => {
    const s = PositiveDecimalSchema(8, 1e9);
    expect(s.parse('12.50')).toBe('12.5');
    expect(s.parse(' .5 ')).toBe('0.5');
    expect(s.parse('0.00000001')).toBe('0.00000001');
    expect(s.safeParse('0.000000001').success).toBe(false); // 9 dp
    expect(s.safeParse('0').success).toBe(false);
    expect(s.safeParse('-1').success).toBe(false);
    expect(s.safeParse('1e3').success).toBe(false);
    expect(s.safeParse('1000000001').success).toBe(false);
    expect(s.safeParse('1000000000').success).toBe(true);
  });

  it('round-trips review flags', () => {
    expect(serialiseReviewFlags([])).toBeNull();
    expect(serialiseReviewFlags(['oversell', 'oversell', 'zero_units'])).toBe(
      '["oversell","zero_units"]',
    );
    expect(parseReviewFlags('["oversell"]')).toEqual(['oversell']);
    expect(parseReviewFlags(null)).toEqual([]);
    expect(() => parseReviewFlags('["nope"]')).toThrow();
  });

  it('defines the upload limit in bytes', () => {
    expect(UPLOAD_LIMIT_BYTES).toBe(26_214_400);
  });
});

describe('request schemas', () => {
  it('parses the import query', () => {
    expect(importQuerySchema.parse({ dryRun: 'true', extra: 'x' })).toEqual({ dryRun: 'true' });
    expect(importQuerySchema.safeParse({ confirmReplace: 'yes' }).success).toBe(false);
  });

  it('parses the refresh body', () => {
    expect(refreshRequestSchema.parse({})).toEqual({});
    expect(refreshRequestSchema.parse({ instrumentIds: [1, 2], force: true })).toEqual({
      instrumentIds: [1, 2],
      force: true,
    });
    expect(refreshRequestSchema.safeParse({ instrumentIds: Array(501).fill(1) }).success).toBe(
      false,
    );
    expect(refreshRequestSchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it('validates a manual price, including "not after tomorrow"', () => {
    const schema = makeManualPriceInputSchema(() => new Date(2026, 8, 24, 10));
    expect(schema.parse({ price: '12.50', asOf: '2026-09-25' })).toEqual({
      price: '12.5',
      asOf: '2026-09-25',
    });
    expect(schema.safeParse({ price: '12.5', asOf: '2026-09-26' }).success).toBe(false);
    expect(schema.safeParse({ price: '0', asOf: '2026-09-24' }).success).toBe(false);
    expect(schema.safeParse({ price: '1.123456789', asOf: '2026-09-24' }).success).toBe(false);
    expect(
      schema.safeParse({ price: '1', asOf: '2026-09-24', note: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('requires a provider symbol unless the provider is none', () => {
    expect(
      priceSourceInputSchema.safeParse({ provider: 'none', providerSymbol: null }).success,
    ).toBe(true);
    expect(
      priceSourceInputSchema.safeParse({ provider: 'yahoo', providerSymbol: null }).success,
    ).toBe(false);
    expect(
      priceSourceInputSchema.safeParse({ provider: 'yahoo', providerSymbol: 'ABC.AX' }).success,
    ).toBe(true);
    expect(
      priceSourceInputSchema.safeParse({ provider: 'yahoo', providerSymbol: 'ABC AX' }).success,
    ).toBe(false);
    expect(
      priceSourceInputSchema.safeParse({ provider: 'coingecko', providerSymbol: 'x'.repeat(65) })
        .success,
    ).toBe(false);
  });
});

describe('corrections', () => {
  const trade = {
    id: 'C1',
    target: 'trade',
    match: { sheet: 'Crypto', row: 30, symbol: 'ETH', date: '2025-11-03', units: '0.5' },
    set: { date: '2025-03-11' },
    reason: 'Owner-confirmed day/month swap',
    approvedOn: '2025-12-01',
  };
  const dividend = {
    id: 'C2',
    target: 'dividend',
    match: { ticker: 'XYZ', paymentDate: '2025-07-15', netAmountCents: 12000 },
    action: 'skip',
    reason: 'Duplicate row',
  };

  it('accepts the documented format', () => {
    const file = CorrectionsFileSchema.parse({ version: 1, corrections: [trade, dividend] });
    expect(file.corrections).toHaveLength(2);
  });

  it('rejects duplicates, unknown fields, empty sets and missing reasons', () => {
    const bad = (corrections: unknown[]) =>
      CorrectionsFileSchema.safeParse({ version: 1, corrections }).success;
    expect(bad([trade, { ...trade }])).toBe(false);
    expect(bad([{ ...trade, extra: 1 }])).toBe(false);
    expect(bad([{ ...trade, set: {} }])).toBe(false);
    expect(bad([{ ...trade, reason: ' ' }])).toBe(false);
    expect(bad([{ ...trade, action: 'skip' }])).toBe(false); // set and action together
    expect(bad([{ ...trade, match: { ...trade.match, sheet: 'Cash' } }])).toBe(false);
    expect(bad([{ ...dividend, target: 'trade' }])).toBe(false);
    expect(CorrectionsFileSchema.safeParse({ version: 2, corrections: [] }).success).toBe(false);
  });

  it('reads IMPORT_CORRECTIONS_FILE', () => {
    expect(correctionsSettingFromEnv(undefined)).toEqual({ kind: 'auto' });
    expect(correctionsSettingFromEnv('  ')).toEqual({ kind: 'auto' });
    expect(correctionsSettingFromEnv('none')).toEqual({ kind: 'off' });
    expect(correctionsSettingFromEnv('NONE')).toEqual({ kind: 'off' });
    expect(correctionsSettingFromEnv('reference/x.json')).toEqual({
      kind: 'file',
      path: 'reference/x.json',
    });
  });
});
