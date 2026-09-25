import { tradeInputSchema, type QuantityMode } from '@joinr/schema';
import {
  apiErrors,
  investmentPages,
  investmentTrades,
  tradeInputExamples,
} from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import {
  AMOUNT_TOO_SMALL,
  NO_REMEMBERED_MODE,
  defaultEntryMode,
  FEE_TOO_LARGE,
  ORDER_TOO_LARGE,
  draftFromTrade,
  newTradeDraft,
  percentMaxDp,
  previewText,
  sameDraft,
  tradeApiErrors,
  tradeBody,
  tradeFieldOfPath,
  tradePreview,
  validateTradeDraft,
  withHolding,
  type RememberedMode,
  type TradeDraft,
} from './tradeDraft';

const TODAY = '2026-09-24';
const [DEF, MNO] = investmentPages.etf.holdings;
const [BTC] = investmentPages.crypto.holdings;
const [ABC] = investmentPages.stock.holdings;

function draft(overrides: Partial<TradeDraft> = {}): TradeDraft {
  return { ...newTradeDraft(MNO, 'etf', TODAY, NO_REMEMBERED_MODE), ...overrides };
}

describe('the default entry mode and fee (D38)', () => {
  it('opens in Amount mode for a $0 flat default fee, else Units', () => {
    expect(defaultEntryMode(DEF, NO_REMEMBERED_MODE)).toBe('amount');
    expect(defaultEntryMode(MNO, NO_REMEMBERED_MODE)).toBe('units');
    expect(defaultEntryMode(BTC, NO_REMEMBERED_MODE)).toBe('units');
    expect(defaultEntryMode(undefined, NO_REMEMBERED_MODE)).toBe('units');
  });

  it('lets the holding’s own remembered choice win, never another holding’s (D47)', () => {
    const only =
      (id: number, mode: QuantityMode): RememberedMode =>
      (instrumentId) =>
        instrumentId === id ? mode : null;
    expect(defaultEntryMode(DEF, only(DEF!.instrumentId, 'units'))).toBe('units');
    expect(defaultEntryMode(MNO, only(MNO!.instrumentId, 'amount'))).toBe('amount');
    // A Units choice on another holding leaves the $0-fee holding in Amount mode, and the reverse.
    expect(defaultEntryMode(DEF, only(MNO!.instrumentId, 'units'))).toBe('amount');
    expect(defaultEntryMode(MNO, only(DEF!.instrumentId, 'amount'))).toBe('units');
    // No holding chosen yet: no holding's choice applies.
    expect(defaultEntryMode(undefined, () => 'amount')).toBe('units');
    // A new draft and a holding change both read the chosen holding's own choice.
    expect(newTradeDraft(DEF, 'etf', TODAY, only(DEF!.instrumentId, 'units')).mode).toBe('units');
    expect(
      withHolding(draft(), DEF!, 'etf', new Set(), only(DEF!.instrumentId, 'units')).mode,
    ).toBe('units');
    expect(
      withHolding(draft(), DEF!, 'etf', new Set(), only(MNO!.instrumentId, 'units')).mode,
    ).toBe('amount');
  });

  it('pre-fills the price and the holding’s effective default fee', () => {
    expect(newTradeDraft(DEF, 'etf', TODAY, NO_REMEMBERED_MODE)).toMatchObject({
      instrumentId: 4,
      side: 'buy',
      tradeDate: TODAY,
      mode: 'amount',
      price: '62',
      feeMode: 'flat',
      feeCents: 0,
    });
    expect(newTradeDraft(MNO, 'etf', TODAY, NO_REMEMBERED_MODE)).toMatchObject({
      feeMode: 'flat',
      feeCents: 1000,
    });
    expect(newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE)).toMatchObject({
      feeMode: 'rate',
      feePercent: '0.25',
      feeCents: null,
    });
    expect(newTradeDraft(undefined, 'etf', TODAY, NO_REMEMBERED_MODE)).toMatchObject({
      instrumentId: null,
      price: '',
      feeCents: null,
    });
  });

  it('re-fills the price, fee and mode on a holding change, but not a field the owner edited', () => {
    const start = draft();
    expect(withHolding(start, DEF!, 'etf', new Set(), NO_REMEMBERED_MODE)).toMatchObject({
      instrumentId: 4,
      price: '62',
      feeCents: 0,
      mode: 'amount',
    });
    const edited = { ...start, price: '99', feeCents: 1500, mode: 'units' as const };
    expect(
      withHolding(
        edited,
        DEF!,
        'etf',
        new Set(['price', 'fee', 'mode'] as const),
        NO_REMEMBERED_MODE,
      ),
    ).toMatchObject({ instrumentId: 4, price: '99', feeCents: 1500, mode: 'units' });
  });
});

describe('edit', () => {
  it('opens in Units mode with the stored values and the fee as stored', () => {
    const rateTrade = investmentTrades.crypto.trades.find((t) => t.id === 131)!;
    expect(draftFromTrade(rateTrade)).toMatchObject({
      instrumentId: 7,
      side: 'buy',
      tradeDate: '2024-11-11',
      mode: 'units',
      units: '0.05',
      price: '90000',
      feeMode: 'rate',
      feePercent: '0.5',
    });
    const sell = investmentTrades.stock.trades.find((t) => t.id === 107)!;
    expect(draftFromTrade(sell)).toMatchObject({ side: 'sell', feeMode: 'flat', feeCents: 1000 });
  });

  it('sends an untouched fee back exactly as stored', () => {
    const trade = investmentTrades.crypto.trades.find((t) => t.id === 131)!;
    const stored = { ...trade, fee: { kind: 'rate' as const, rate: '0.00123456' } };
    const d = draftFromTrade(stored);
    expect(d.feePercent).toBe('0.123456');
    const maxDp = percentMaxDp(d.feePercent);
    expect(maxDp).toBe(6);
    expect(tradeBody(d, maxDp, { fee: stored.fee, feeTouched: false }).fee).toEqual(stored.fee);
    expect(tradeBody(d, maxDp, { fee: stored.fee, feeTouched: true }).fee).toEqual({
      kind: 'rate',
      rate: '0.00123456',
    });
    expect(tradeBody(d, maxDp).quantity).toEqual({ mode: 'units', units: '0.05' });
  });

  it('knows a pristine draft', () => {
    const d = draftFromTrade(investmentTrades.etf.trades[0]!);
    expect(sameDraft(d, { ...d })).toBe(true);
    expect(sameDraft(d, { ...d, note: 'x' })).toBe(false);
  });
});

describe('the preview line', () => {
  it('amount mode: units rounded down, the order and the fee on top', () => {
    const d = draft({
      ...newTradeDraft(DEF, 'etf', TODAY, NO_REMEMBERED_MODE),
      amountCents: 50000,
      price: '170',
    });
    const preview = tradePreview(d, 'etf', 4);
    // 500 ÷ 170 = 2.94117… → 2.9411 (rounded down to 4 dp); 2.9411 × 170 = $499.99.
    expect(preview).toMatchObject({ ok: true, units: '2.9411', orderCents: 49999, feeCents: 0 });
    expect(previewText(preview!, 'etf')).toBe(
      '≈ 2.9411 units · order $499.99 · fee $0.00 · total $499.99',
    );
  });

  it('units mode with a flat fee; a sell shows the proceeds', () => {
    const buy = draft({ units: '10', price: '110' });
    expect(previewText(tradePreview(buy, 'etf', 4)!, 'etf')).toBe(
      '10 units · order $1,100.00 · fee $10.00 · total $1,110.00',
    );
    const sell = { ...buy, side: 'sell' as const };
    expect(previewText(tradePreview(sell, 'etf', 4)!, 'etf')).toBe(
      '10 units · order $1,100.00 · fee $10.00 · proceeds $1,090.00',
    );
    expect(previewText(tradePreview({ ...buy, units: '1' }, 'etf', 4)!, 'etf')).toMatch(
      /^1 unit ·/,
    );
  });

  it('a crypto % fee through ratioFromPercentText', () => {
    const d = {
      ...newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE),
      units: '0.01',
      price: '160000',
    };
    const preview = tradePreview(d, 'crypto', 4);
    // 0.25 % of $1,600.00 = $4.00
    expect(preview).toMatchObject({
      ok: true,
      orderCents: 160000,
      feeCents: 400,
      totalCents: 160400,
    });
    expect(tradeBody(d, 4).fee).toEqual({ kind: 'rate', rate: '0.0025' });
  });

  it('an amount too small for one unit step says so; unknown inputs give no preview', () => {
    const d = draft({ mode: 'amount', amountCents: 1, price: '1000' });
    expect(tradePreview(d, 'etf', 4)).toEqual({ ok: false, message: AMOUNT_TOO_SMALL });
    expect(tradePreview(draft({ units: '' }), 'etf', 4)).toBeNull();
    expect(tradePreview(draft({ units: '1', price: '' }), 'etf', 4)).toBeNull();
    expect(tradePreview(draft({ units: '1', feeCents: null }), 'etf', 4)).toBeNull();
  });

  it('gives no preview (never throws) when units × price passes the order value limit', () => {
    // Each is within its own limit; the product (1e15 dollars) is beyond safe-integer cents.
    const huge = draft({ units: '1000000', price: '1000000000' });
    expect(() => tradePreview(huge, 'etf', 4)).not.toThrow();
    expect(tradePreview(huge, 'etf', 4)).toBeNull();
    const coin = {
      ...newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE),
      units: '100',
      price: '1000000000',
    };
    expect(tradePreview({ ...coin, feePercent: '200' }, 'crypto', 4)).toBeNull();
    // Exactly the limit ($1e11) still previews.
    expect(tradePreview(draft({ units: '100', price: '1000000000' }), 'etf', 4)).toMatchObject({
      ok: true,
      orderCents: 1e13,
    });
  });
});

describe('validation and the request body', () => {
  it('finds the missing and invalid fields', () => {
    const empty = newTradeDraft(undefined, 'etf', TODAY, NO_REMEMBERED_MODE);
    expect(validateTradeDraft({ ...empty, tradeDate: null }, 'etf', 4)).toEqual({
      instrumentId: 'Choose a holding.',
      tradeDate: 'Enter the trade date.',
      price: 'Enter the price per unit.',
      units: 'Enter the units.',
      fee: 'Enter a fee ($0 for none).',
    });
    expect(validateTradeDraft(draft({ units: '0', price: '0' }), 'etf', 4)).toMatchObject({
      units: 'Enter units greater than zero.',
      price: 'Enter a price greater than zero.',
    });
    expect(
      validateTradeDraft(draft({ units: '1234567890.1234567', price: '1' }), 'etf', 4),
    ).toMatchObject({
      units: 'Use at most 15 significant digits.',
    });
    expect(
      validateTradeDraft(draft({ mode: 'amount', amountCents: 1, price: '1000' }), 'etf', 4),
    ).toEqual({ amountCents: AMOUNT_TOO_SMALL });
    const crypto = {
      ...newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE),
      units: '1',
      feePercent: '0.12345',
    };
    expect(validateTradeDraft(crypto, 'crypto', 4)).toEqual({
      fee: 'Enter a percentage with up to 4 decimal places.',
    });
    expect(validateTradeDraft({ ...crypto, feePercent: '101' }, 'crypto', 4)).toEqual({
      fee: 'Enter a fee of at most 100%.',
    });
    expect(validateTradeDraft(draft({ units: '1', note: 'x'.repeat(201) }), 'etf', 4)).toEqual({
      note: 'Use at most 200 characters.',
    });
  });

  it('checks the joint order value bound as the server does (ORDER_VALUE_CENTS_MAX)', () => {
    expect(validateTradeDraft(draft({ units: '1000000', price: '1000000000' }), 'etf', 4)).toEqual({
      units: ORDER_TOO_LARGE,
    });
    expect(validateTradeDraft(draft({ units: '100', price: '1000000000' }), 'etf', 4)).toEqual({});
    // A rate fee is at most 100 %, so the order check is the one that fires.
    const coin = {
      ...newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE),
      price: '1000000000',
    };
    expect(validateTradeDraft({ ...coin, units: '1000000' }, 'crypto', 4)).toEqual({
      units: ORDER_TOO_LARGE,
    });
    expect(FEE_TOO_LARGE).toBe('The fee is too large.');
    // Amount mode is bounded by the amount itself.
    expect(
      validateTradeDraft(draft({ mode: 'amount', amountCents: 1e13, price: '1' }), 'etf', 4),
    ).toEqual({});
  });

  it('builds a units body and an amount body that the server schema accepts', () => {
    const units = tradeBody(
      { ...newTradeDraft(ABC, 'stock', TODAY, NO_REMEMBERED_MODE), units: '10', note: '  ' },
      4,
    );
    expect(units).toEqual({ ...tradeInputExamples.units });
    expect(tradeInputSchema.safeParse(units).success).toBe(true);

    const amount = tradeBody(
      {
        ...newTradeDraft(DEF, 'etf', TODAY, NO_REMEMBERED_MODE),
        amountCents: 50000,
        note: 'Auto-invest buy',
      },
      4,
    );
    expect(amount).toEqual(tradeInputExamples.amount);
    expect(tradeInputSchema.safeParse(amount).success).toBe(true);

    const rate = tradeBody(
      {
        ...newTradeDraft(BTC, 'crypto', TODAY, NO_REMEMBERED_MODE),
        side: 'sell',
        tradeDate: '2026-09-23',
        units: '0.01',
      },
      4,
    );
    expect(rate).toEqual({ ...tradeInputExamples.cryptoRate, note: '' });
    expect(tradeInputSchema.safeParse(rate).success).toBe(true);
  });
});

describe('API errors', () => {
  it('maps validation issues onto fields by path prefix', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', apiErrors.tradeValidation.error.message);
    expect(tradeApiErrors(error, 'units')).toEqual({
      fields: { units: 'Must be a positive number.', price: 'Must be greater than zero.' },
      form: null,
    });
    expect(tradeFieldOfPath('fee.cents', 'units')).toBe('fee');
    expect(tradeFieldOfPath('fee.rate', 'units')).toBe('fee');
    expect(tradeFieldOfPath('quantity.amountCents', 'amount')).toBe('amountCents');
    expect(tradeFieldOfPath('quantity', 'amount')).toBe('amountCents');
    expect(tradeFieldOfPath('somethingElse', 'units')).toBeUndefined();
    const mixed = new ApiError(400, 'VALIDATION_ERROR', 'price: must be positive; body: too large');
    expect(tradeApiErrors(mixed, 'units')).toEqual({
      fields: { price: 'Must be positive.' },
      form: 'Body: too large.',
    });
  });

  it('keeps the oversell message and names a running import in plain words', () => {
    const oversell = new ApiError(422, 'TRADE_OVERSELL', apiErrors.tradeOversell.error.message);
    expect(tradeApiErrors(oversell, 'units')).toEqual({
      fields: {},
      form: apiErrors.tradeOversell.error.message,
    });
    const busy = new ApiError(409, 'IMPORT_IN_PROGRESS', apiErrors.inProgress.error.message);
    expect(tradeApiErrors(busy, 'units').form).toBe('An import is running; try again shortly.');
  });
});
