// CODE-9 (stage-6.md §4.5, §7.7 step 4): the shared server sum helpers. Generic values only.
import { sumDecimals } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  sumCents,
  sumDecimalStrings,
  sumValidDecimals,
  sumValidDecimalStrings,
} from '../../src/lib/sums';

describe('sumDecimalStrings', () => {
  it("is the schema's sumDecimals: exact, normalised, '0' for none", () => {
    expect(sumDecimalStrings).toBe(sumDecimals);
    expect(sumDecimalStrings(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimalStrings(['1.50', '2.50', '-4'])).toBe('0');
    expect(sumDecimalStrings([])).toBe('0');
  });

  it('rejects a malformed value', () => {
    expect(() => sumDecimalStrings(['1', 'abc'])).toThrow(RangeError);
  });
});

describe('sumValidDecimals', () => {
  it('sums exactly with decimal.js, leaving out malformed stored values', () => {
    expect(sumValidDecimals(['0.1', '0.2']).toFixed()).toBe('0.3');
    expect(sumValidDecimals(['10', 'not a number', '2.25', '']).toFixed()).toBe('12.25');
    expect(sumValidDecimals([]).isZero()).toBe(true);
  });

  it('normalises for a DTO', () => {
    expect(sumValidDecimalStrings(['1.500', '2.500'])).toBe('4');
    expect(sumValidDecimalStrings(['0.000001', '0.000002'])).toBe('0.000003');
    expect(sumValidDecimalStrings(['-1', '1'])).toBe('0');
    expect(sumValidDecimalStrings(['x'])).toBe('0');
    expect(sumValidDecimalStrings([])).toBe('0');
  });
});

describe('sumCents', () => {
  it('sums integer cents', () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(sumCents([])).toBe(0);
    expect(sumCents(new Set([1, 2, 3]))).toBe(6);
    expect(sumCents([Number.MAX_SAFE_INTEGER, -1])).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(sumCents([Number.MIN_SAFE_INTEGER])).toBe(Number.MIN_SAFE_INTEGER);
  });

  it('rejects a value that is not integer cents', () => {
    expect(() => sumCents([1, 1.5])).toThrow(RangeError);
    expect(() => sumCents([Number.NaN])).toThrow(RangeError);
    expect(() => sumCents([Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER + 1])).toThrow(RangeError);
  });

  it('rejects a total that leaves the safe-integer range, even if it would come back', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1, -1])).toThrow(RangeError);
    expect(() => sumCents([Number.MIN_SAFE_INTEGER, -1])).toThrow(RangeError);
  });
});
