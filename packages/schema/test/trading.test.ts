// Trading helpers (stage-2.md §2.3, §7.2 step 2): fee authority, D38 amount mode and default
// fees, percent ↔ ratio text, and the decimal input limits.
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_MODE_UNIT_DP,
  decimalFromNumber,
  DECIMAL_INPUT_MAX_SIG,
  effectiveDefaultFee,
  INSTRUMENT_KINDS,
  ORDER_VALUE_CENTS_MAX,
  orderValueIssue,
  PERCENT_INPUT_MAX_DP,
  percentTextFromRatio,
  ratioFromPercentText,
  TRADE_DECIMAL_MAX_DP,
  tradeFeeCents,
  tradeFeeDollars,
  unitsFromAmount,
  withinDecimalInputLimits,
} from '../src/index';

describe('constants', () => {
  it('match the plan', () => {
    expect(TRADE_DECIMAL_MAX_DP).toBe(18);
    expect(DECIMAL_INPUT_MAX_SIG).toBe(15);
    expect(PERCENT_INPUT_MAX_DP).toBe(4);
    expect(AMOUNT_MODE_UNIT_DP).toEqual({ stock: 4, etf: 4, managed_fund: 6, crypto: 8 });
    expect(Object.keys(AMOUNT_MODE_UNIT_DP).sort()).toEqual([...INSTRUMENT_KINDS].sort());
  });
});

describe('fee authority', () => {
  it('uses the exact decimal rate fee when feeRate is set, ignoring feeCents', () => {
    const t = { units: '0.05', price: '90000', feeCents: 9999, feeRate: '0.005' };
    expect(tradeFeeDollars(t)).toBe('22.5');
    expect(tradeFeeCents(t)).toBe(2250);
  });

  it('keeps full precision in dollars and rounds once, half away from zero, in cents', () => {
    const t = { units: '0.01234567', price: '150000', feeCents: 0, feeRate: '0.005' };
    expect(tradeFeeDollars(t)).toBe('9.2592525');
    expect(tradeFeeCents(t)).toBe(926);
    const half = { units: '1', price: '1', feeCents: 0, feeRate: '0.125' };
    expect(tradeFeeDollars(half)).toBe('0.125');
    expect(tradeFeeCents(half)).toBe(13);
  });

  it('is the absolute value for a sell (negative units)', () => {
    const t = { units: '-0.25', price: '4000', feeCents: 0, feeRate: '0.005' };
    expect(tradeFeeDollars(t)).toBe('5');
    expect(tradeFeeCents(t)).toBe(500);
  });

  it('uses feeCents exactly when the rate is null', () => {
    const t = { units: '-20', price: '6', feeCents: 1000, feeRate: null };
    expect(tradeFeeDollars(t)).toBe('10');
    expect(tradeFeeCents(t)).toBe(1000);
    expect(tradeFeeDollars({ ...t, feeCents: 0 })).toBe('0');
    expect(tradeFeeDollars({ ...t, feeCents: 1995 })).toBe('19.95');
  });

  it('throws RangeError on a malformed decimal', () => {
    expect(() => tradeFeeDollars({ units: 'x', price: '1', feeCents: 0, feeRate: '0.1' })).toThrow(
      RangeError,
    );
  });
});

describe('unitsFromAmount (D38)', () => {
  it('rounds down to the per-kind precision', () => {
    // $500 / $48.85 = 10.23541453...
    expect(unitsFromAmount(50000, '48.85', 'stock')).toBe('10.2354');
    expect(unitsFromAmount(50000, '48.85', 'etf')).toBe('10.2354');
    expect(unitsFromAmount(50000, '48.85', 'managed_fund')).toBe('10.235414');
    expect(unitsFromAmount(50000, '48.85', 'crypto')).toBe('10.23541453');
  });

  it('never rounds up', () => {
    // $100 / $3 = 33.3333…; $200 / $3 = 66.6666… → 66.6666, not 66.6667
    expect(unitsFromAmount(10000, '3', 'etf')).toBe('33.3333');
    expect(unitsFromAmount(20000, '3', 'etf')).toBe('66.6666');
  });

  it('is exact when the amount divides evenly', () => {
    expect(unitsFromAmount(50000, '50', 'etf')).toBe('10');
    expect(unitsFromAmount(150, '1.5', 'managed_fund')).toBe('1');
  });

  it('returns "0" when the amount buys less than one step', () => {
    expect(unitsFromAmount(1, '100000', 'stock')).toBe('0'); // 0.0000001 < 0.0001
    expect(unitsFromAmount(1, '100000', 'crypto')).toBe('0.0000001');
    expect(unitsFromAmount(0, '10', 'etf')).toBe('0');
  });

  it('throws RangeError for a non-positive price or a bad amount', () => {
    expect(() => unitsFromAmount(100, '0', 'etf')).toThrow(RangeError);
    expect(() => unitsFromAmount(100, '-1', 'etf')).toThrow(RangeError);
    expect(() => unitsFromAmount(100, 'abc', 'etf')).toThrow(RangeError);
    expect(() => unitsFromAmount(-1, '10', 'etf')).toThrow(RangeError);
    expect(() => unitsFromAmount(1.5, '10', 'etf')).toThrow(RangeError);
  });
});

describe('effectiveDefaultFee (D38)', () => {
  const settings = { defaultBrokerageCents: 995, cryptoFeeRate: '0.005' };
  const none = { defaultFeeCents: null, defaultFeeRate: null };

  it("uses the holding's own flat default first", () => {
    expect(effectiveDefaultFee({ kind: 'etf', ...none, defaultFeeCents: 0 }, settings)).toEqual({
      kind: 'flat',
      cents: 0,
    });
    expect(effectiveDefaultFee({ kind: 'stock', ...none, defaultFeeCents: 500 }, settings)).toEqual(
      { kind: 'flat', cents: 500 },
    );
    expect(
      effectiveDefaultFee({ kind: 'managed_fund', ...none, defaultFeeCents: 250 }, settings),
    ).toEqual({ kind: 'flat', cents: 250 });
    expect(
      effectiveDefaultFee({ kind: 'crypto', ...none, defaultFeeCents: 100 }, settings),
    ).toEqual({ kind: 'flat', cents: 100 });
  });

  it("uses a crypto holding's own rate first (and ignores a rate on other kinds)", () => {
    expect(
      effectiveDefaultFee(
        { kind: 'crypto', defaultFeeCents: 100, defaultFeeRate: '0.001' },
        settings,
      ),
    ).toEqual({ kind: 'rate', rate: '0.001' });
    expect(
      effectiveDefaultFee(
        { kind: 'etf', defaultFeeCents: null, defaultFeeRate: '0.001' },
        settings,
      ),
    ).toEqual({ kind: 'flat', cents: 995 });
  });

  it('falls back by kind', () => {
    expect(effectiveDefaultFee({ kind: 'crypto', ...none }, settings)).toEqual({
      kind: 'rate',
      rate: '0.005',
    });
    expect(effectiveDefaultFee({ kind: 'stock', ...none }, settings)).toEqual({
      kind: 'flat',
      cents: 995,
    });
    expect(effectiveDefaultFee({ kind: 'etf', ...none }, settings)).toEqual({
      kind: 'flat',
      cents: 995,
    });
    expect(effectiveDefaultFee({ kind: 'managed_fund', ...none }, settings)).toEqual({
      kind: 'flat',
      cents: 0,
    });
  });

  it('uses zero when the global settings are missing', () => {
    const missing = { defaultBrokerageCents: null, cryptoFeeRate: null };
    expect(effectiveDefaultFee({ kind: 'crypto', ...none }, missing)).toEqual({
      kind: 'rate',
      rate: '0',
    });
    expect(effectiveDefaultFee({ kind: 'etf', ...none }, missing)).toEqual({
      kind: 'flat',
      cents: 0,
    });
    expect(effectiveDefaultFee({ kind: 'stock', ...none }, missing)).toEqual({
      kind: 'flat',
      cents: 0,
    });
  });
});

describe('percent ↔ ratio text', () => {
  it.each([
    ['0.07', '0.0007'],
    ['0.35', '0.0035'],
    ['12.5', '0.125'],
    ['100', '1'],
    ['0', '0'],
    ['60', '0.6'],
    ['0.5', '0.005'],
    ['12.3456', '0.123456'],
  ])('%s %% ↔ %s', (percent, ratio) => {
    expect(ratioFromPercentText(percent)).toBe(ratio);
    expect(percentTextFromRatio(ratio)).toBe(percent);
  });

  it('accepts surrounding spaces, a bare point and trailing zeros', () => {
    expect(ratioFromPercentText(' 12.50 ')).toBe('0.125');
    expect(ratioFromPercentText('.5')).toBe('0.005');
    expect(ratioFromPercentText('5.')).toBe('0.05');
    expect(ratioFromPercentText('007')).toBe('0.07');
  });

  it('round-trips a stored 6-dp ratio to the same string', () => {
    for (const ratio of ['0.123456', '0.000001', '0.999999', '0.0007', '1']) {
      expect(ratioFromPercentText(percentTextFromRatio(ratio))).toBe(ratio);
    }
  });

  it('returns null for blank text, a sign, an exponent or too many decimal places', () => {
    for (const bad of ['', '   ', '-5', '+5', '1e2', '5%', '1,5', 'abc', '.', '12.34567']) {
      expect(ratioFromPercentText(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(ratioFromPercentText('12.34567', 5)).toBe('0.1234567');
  });

  it('percentTextFromRatio is exact for long ratios and keeps a sign', () => {
    expect(percentTextFromRatio('0.00123456789012')).toBe('0.123456789012');
    expect(percentTextFromRatio('-0.05')).toBe('-5');
    expect(percentTextFromRatio('2.5')).toBe('250');
    expect(() => percentTextFromRatio('x')).toThrow(RangeError);
  });
});

describe('withinDecimalInputLimits', () => {
  it('accepts up to 18 decimal places', () => {
    expect(withinDecimalInputLimits('0.000000000000000001')).toBe(true); // 18 dp
    expect(withinDecimalInputLimits('0.0000000000000000001')).toBe(false); // 19 dp
  });

  it('accepts up to 15 significant digits', () => {
    expect(withinDecimalInputLimits('123456789.123456')).toBe(true); // 15
    expect(withinDecimalInputLimits('123456789.1234567')).toBe(false); // 16
    expect(withinDecimalInputLimits('1234567890123456')).toBe(false); // 16 integer digits
  });

  it('accepts a 12-significant-digit value with more than 12 decimal places', () => {
    const v = decimalFromNumber(0.000012345678901234);
    expect(v).toBe('0.0000123456789012');
    expect(withinDecimalInputLimits(v)).toBe(true);
  });

  it('is false for a non-number', () => {
    expect(withinDecimalInputLimits('abc')).toBe(false);
    expect(withinDecimalInputLimits('')).toBe(false);
  });
});

describe('orderValueIssue', () => {
  it('is null within ORDER_VALUE_CENTS_MAX and names the part beyond it', () => {
    expect(ORDER_VALUE_CENTS_MAX).toBe(1e13);
    expect(orderValueIssue({ units: '100', price: '1000000000', feeRate: null })).toBeNull();
    expect(orderValueIssue({ units: '-100', price: '1000000000', feeRate: '1' })).toBeNull();
    expect(orderValueIssue({ units: '1000000', price: '1000000000', feeRate: null })).toBe('order');
    expect(orderValueIssue({ units: '-1000000', price: '1000000000', feeRate: '0.01' })).toBe(
      'order',
    );
    // A rate above 1 is refused by the schema; the helper still names the fee.
    expect(orderValueIssue({ units: '100', price: '1000000000', feeRate: '2' })).toBe('fee');
  });

  it('is null for input that is not a number', () => {
    expect(orderValueIssue({ units: 'abc', price: '1', feeRate: null })).toBeNull();
    expect(orderValueIssue({ units: '', price: '1', feeRate: null })).toBeNull();
    expect(orderValueIssue({ units: '1', price: '1', feeRate: 'x' })).toBeNull();
  });
});
