// CODE-9 (stage-6.md §4.5, §7.7 step 4): the shared server sum helpers. Generic values only.
// Stage 7 (CODE-7, stage-7.md §5.9): the two unused helpers were removed.
import { describe, expect, it } from 'vitest';
import * as sums from '../../src/lib/sums';
import { sumValidDecimals, sumValidDecimalStrings } from '../../src/lib/sums';

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

describe('CODE-7', () => {
  it('exports only the two decimal helpers', () => {
    expect(Object.keys(sums).sort()).toEqual(['sumValidDecimalStrings', 'sumValidDecimals']);
  });
});
