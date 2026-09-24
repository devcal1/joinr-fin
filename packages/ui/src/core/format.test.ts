import { describe, expect, it } from 'vitest';
import {
  MINUS,
  daysInMonth,
  financialYearBounds,
  financialYearOf,
  formatDate,
  formatDateLong,
  formatFinancialYear,
  formatMoney,
  formatMonth,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatTime,
  isIsoDate,
  parseDate,
  parseDecimal,
  parseMoney,
  toIsoDate,
} from './format';

const M = MINUS;

describe('MINUS', () => {
  it('is U+2212', () => {
    expect(MINUS).toBe('−');
    expect(MINUS.codePointAt(0)).toBe(0x2212);
  });
});

describe('formatMoney', () => {
  it.each([
    [1_248_000, '$12,480.00'],
    [0, '$0.00'],
    [5, '$0.05'],
    [99, '$0.99'],
    [100, '$1.00'],
    [123_456, '$1,234.56'],
    [100_000_000, '$1,000,000.00'],
    [-123_400, `${M}$1,234.00`],
    [-5, `${M}$0.05`],
    [-0, '$0.00'],
    [Number.MAX_SAFE_INTEGER, '$90,071,992,547,409.91'],
  ])('%d cents → %s', (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });

  it('never uses the ASCII hyphen for negatives', () => {
    expect(formatMoney(-1)).not.toContain('-');
    expect(formatMoney(-1).startsWith(MINUS)).toBe(true);
  });

  it.each([
    [1_248_000, '$12,480'],
    [1_248_049, '$12,480'],
    [1_248_050, '$12,481'], // half away from zero
    [-1_248_050, `${M}$12,481`],
    [-1_248_049, `${M}$12,480`],
    [49, '$0'],
    [50, '$1'],
    [-49, '$0'], // rounds to zero: no sign
    [-50, `${M}$1`],
  ])('wholeDollars: %d → %s', (cents, expected) => {
    expect(formatMoney(cents, { wholeDollars: true })).toBe(expected);
  });

  it('signDisplay always / never', () => {
    expect(formatMoney(1200, { signDisplay: 'always' })).toBe('+$12.00');
    expect(formatMoney(-1200, { signDisplay: 'always' })).toBe(`${M}$12.00`);
    expect(formatMoney(0, { signDisplay: 'always' })).toBe('+$0.00');
    expect(formatMoney(124_000, { signDisplay: 'always', wholeDollars: true })).toBe('+$1,240');
    expect(formatMoney(-1200, { signDisplay: 'never' })).toBe('$12.00');
    expect(formatMoney(1200, { signDisplay: 'never' })).toBe('$12.00');
  });

  it.each([[1.5], [0.1], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY]])(
    'throws TypeError for %s',
    (bad) => {
      expect(() => formatMoney(bad)).toThrow(TypeError);
    },
  );

  it('throws RangeError beyond the safe integer range', () => {
    expect(() => formatMoney(2 ** 60)).toThrow(RangeError);
  });
});

describe('formatPercent', () => {
  it.each([
    [0.074, '7.4%'],
    [-0.021, `${M}2.1%`],
    [0, '0.0%'],
    [1, '100.0%'],
    [12.345, '1,234.5%'],
    [0.0745, '7.5%'], // decimal rounding, not binary: 0.0745 × 100 is 7.45 exactly
    [0.0744, '7.4%'],
    [-0.0745, `${M}7.5%`], // half away from zero
    [-0.0004, '0.0%'], // rounds to zero: no sign
  ])('%d → %s', (ratio, expected) => {
    expect(formatPercent(ratio)).toBe(expected);
  });

  it('honours dp and signDisplay', () => {
    expect(formatPercent(0.07456, { dp: 2 })).toBe('7.46%');
    expect(formatPercent(0.074, { dp: 0 })).toBe('7%');
    expect(formatPercent(0.074, { signDisplay: 'always' })).toBe('+7.4%');
    expect(formatPercent(-0.074, { signDisplay: 'always' })).toBe(`${M}7.4%`);
    expect(formatPercent(0, { signDisplay: 'always' })).toBe('+0.0%');
  });

  it('rejects non-finite ratios and bad dp', () => {
    expect(() => formatPercent(Number.NaN)).toThrow(TypeError);
    expect(() => formatPercent(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => formatPercent(0.1, { dp: -1 })).toThrow(RangeError);
    expect(() => formatPercent(0.1, { dp: 1.5 })).toThrow(RangeError);
  });
});

describe('formatQuantity', () => {
  it.each<[string | number, string]>([
    ['1234.5', '1,234.5'],
    ['1234.50000', '1,234.5'],
    ['10', '10'],
    [0, '0'],
    ['0.00001', '0'], // rounds below 4 dp
    ['0.00005', '0.0001'], // half away from zero
    ['1.23456', '1.2346'],
    ['-12.5', `${M}12.5`],
    ['-0.00001', '0'], // rounds to zero: no sign
    [1234567.891, '1,234,567.891'],
    ['−2.5', `${M}2.5`],
  ])('%s → %s', (value, expected) => {
    expect(formatQuantity(value)).toBe(expected);
  });

  it('keeps 8 dp for crypto quantities', () => {
    expect(formatQuantity('0.12345678', { maxDp: 8 })).toBe('0.12345678');
    expect(formatQuantity('0.123456789', { maxDp: 8 })).toBe('0.12345679');
    expect(formatQuantity('0.00000001', { maxDp: 8 })).toBe('0.00000001');
    expect(formatQuantity('21000000.00000000', { maxDp: 8 })).toBe('21,000,000');
  });

  it('pads to minDp', () => {
    expect(formatQuantity('5', { minDp: 2 })).toBe('5.00');
    expect(formatQuantity('5.1', { minDp: 2 })).toBe('5.10');
    expect(formatQuantity('5.12345', { minDp: 2, maxDp: 3 })).toBe('5.123');
  });

  it('works on decimal strings without float drift', () => {
    expect(formatQuantity('0.1', { maxDp: 20 })).toBe('0.1');
    expect(formatQuantity('123456789012345678.123456', { maxDp: 6 })).toBe(
      '123,456,789,012,345,678.123456',
    );
  });

  it('rejects anything that is not a decimal', () => {
    for (const bad of ['', 'abc', '1e5', '1,234', '0x10', 'Infinity', 'NaN', '1.2.3']) {
      expect(() => formatQuantity(bad), bad).toThrow(TypeError);
    }
    expect(() => formatQuantity(Number.NaN)).toThrow(TypeError);
  });
});

describe('formatPrice', () => {
  it.each<[string | number, string]>([
    ['1.2345', '$1.2345'],
    ['12.5', '$12.50'],
    ['12', '$12.00'],
    ['1.23456', '$1.2346'],
    ['1234.5', '$1,234.50'],
    ['-0.05', `${M}$0.05`],
    [0, '$0.00'],
  ])('%s → %s', (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
  });

  it('honours minDp and maxDp', () => {
    expect(formatPrice('0.000123', { maxDp: 6 })).toBe('$0.000123');
    expect(formatPrice('3', { minDp: 0 })).toBe('$3');
    expect(formatPrice('3.14159', { minDp: 2, maxDp: 2 })).toBe('$3.14');
    expect(formatPrice('3', { minDp: 4, maxDp: 2 })).toBe('$3.00'); // minDp clamped to maxDp
  });
});

describe('dates', () => {
  it('formats ISO dates as dd/mm/yyyy, long and month forms', () => {
    expect(formatDate('2026-08-18')).toBe('18/08/2026');
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
    expect(formatDateLong('2026-08-18')).toBe('18 August 2026');
    expect(formatDateLong('2026-07-01')).toBe('1 July 2026');
    expect(formatMonth('2026-08')).toBe('Aug 2026');
    expect(formatMonth('2026-08-18')).toBe('Aug 2026');
    expect(formatMonth('2026-12')).toBe('Dec 2026');
  });

  it('reads a Date in local time', () => {
    const date = new Date(2026, 7, 18, 23, 59);
    expect(formatDate(date)).toBe('18/08/2026');
    expect(formatDateLong(date)).toBe('18 August 2026');
    expect(formatMonth(date)).toBe('Aug 2026');
    expect(formatTime(date)).toBe('23:59');
    expect(formatTime(new Date(2026, 0, 1, 7, 5))).toBe('07:05');
    expect(formatTime(new Date(2026, 0, 1, 0, 0))).toBe('00:00');
    expect(toIsoDate(date)).toBe('2026-08-18');
  });

  it('never shifts an ISO date through UTC', () => {
    // new Date('2026-07-01') would be UTC midnight, i.e. 30 June in the Americas.
    expect(formatDate('2026-07-01')).toBe('01/07/2026');
    expect(financialYearOf('2026-07-01')).toBe(2026);
  });

  it('handles leap days', () => {
    expect(formatDate('2028-02-29')).toBe('29/02/2028');
    expect(formatDate('2000-02-29')).toBe('29/02/2000');
    expect(() => formatDate('2026-02-29')).toThrow(RangeError);
    expect(() => formatDate('1900-02-29')).toThrow(RangeError);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('rejects invalid dates', () => {
    for (const bad of ['', '2026-13-01', '2026-00-10', '2026-04-31', '18/08/2026', '2026-8-18']) {
      expect(() => formatDate(bad), bad).toThrow(RangeError);
    }
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => formatMonth('2026-13')).toThrow(RangeError);
    expect(() => formatMonth('Aug 2026')).toThrow(RangeError);
    expect(() => formatTime(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('validates ISO date strings', () => {
    expect(isIsoDate('2026-08-18')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-8-18')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('financial year (1 July – 30 June)', () => {
  it('splits at 30 June / 1 July', () => {
    expect(financialYearOf('2026-06-30')).toBe(2025);
    expect(financialYearOf('2026-07-01')).toBe(2026);
    expect(financialYearOf('2027-06-30')).toBe(2026);
    expect(financialYearOf('2026-01-01')).toBe(2025);
    expect(financialYearOf('2026-12-31')).toBe(2026);
    expect(financialYearOf(new Date(2026, 5, 30, 23, 59))).toBe(2025);
    expect(financialYearOf(new Date(2026, 6, 1, 0, 0))).toBe(2026);
  });

  it('formats FY labels with an en dash', () => {
    expect(formatFinancialYear(2026)).toBe('FY2026–27');
    expect(formatFinancialYear(2025)).toBe('FY2025–26');
    expect(formatFinancialYear(1999)).toBe('FY1999–00');
    expect(formatFinancialYear(2099)).toBe('FY2099–00');
    expect(() => formatFinancialYear(2026.5)).toThrow(RangeError);
  });

  it('gives the inclusive bounds', () => {
    expect(financialYearBounds(2026)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(financialYearBounds(2027)).toEqual({ start: '2027-07-01', end: '2028-06-30' });
    expect(() => financialYearBounds(0)).toThrow(RangeError);
  });
});

describe('parseMoney', () => {
  it.each<[string, number]>([
    ['$1,234.50', 123_450],
    ['1234.5', 123_450],
    ['1234', 123_400],
    ['-12', -1200],
    ['−12', -1200],
    ['-$12', -1200],
    ['$-12', -1200],
    [`${M}$1,234.00`, -123_400],
    ['+12', 1200],
    ['  $ 12.30  ', 1230],
    ['.5', 50],
    ['$.05', 5],
    ['5.', 500],
    ['0', 0],
    ['-0', 0],
    ['1,000,000', 100_000_000],
    ['007', 700],
  ])('%s → %d', (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each([
    [''],
    ['   '],
    ['$'],
    ['-'],
    ['.'],
    ['12.345'], // > 2 dp
    ['1,23'],
    ['1234,567'],
    ['12a'],
    ['--12'],
    ['-$-12'],
    ['1 234'],
    ['1e3'],
    ['(12.00)'],
    ['99999999999999999'], // beyond safe integer cents
  ])('%s → null', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('round-trips formatMoney', () => {
    for (const cents of [0, 5, 123_456, -123_400, 100_000_000]) {
      expect(parseMoney(formatMoney(cents))).toBe(cents);
    }
  });
});

describe('parseDate', () => {
  it.each<[string, string]>([
    ['18/08/2026', '2026-08-18'],
    ['18/8/2026', '2026-08-18'],
    ['1/7/2026', '2026-07-01'],
    ['30/06/2026', '2026-06-30'],
    ['18-08-2026', '2026-08-18'],
    ['18.08.2026', '2026-08-18'],
    [' 18/08/2026 ', '2026-08-18'],
    ['2026-08-18', '2026-08-18'],
    ['29/02/2028', '2028-02-29'],
  ])('%s → %s', (input, iso) => {
    expect(parseDate(input)).toBe(iso);
  });

  it.each([
    [''],
    ['29/02/2026'], // not a leap year
    ['31/04/2026'],
    ['32/01/2026'],
    ['00/01/2026'],
    ['18/13/2026'],
    ['18/08/26'], // two-digit year
    ['18/08-2026'], // mixed separators
    ['2026/08/18'],
    ['08/18/2026'], // US order
    ['tomorrow'],
    ['2026-02-30'],
  ])('%s → null', (input) => {
    expect(parseDate(input)).toBeNull();
  });

  it('round-trips formatDate', () => {
    for (const iso of ['2026-08-18', '2026-07-01', '2028-02-29', '1999-12-31']) {
      expect(parseDate(formatDate(iso))).toBe(iso);
    }
  });
});

describe('parseDecimal', () => {
  it.each<[string, number | undefined, string]>([
    ['1234.5678', undefined, '1234.5678'],
    ['1,234.50', undefined, '1234.5'],
    ['0.12345678', 8, '0.12345678'],
    ['-0.5', undefined, '-0.5'],
    ['−0.5', undefined, '-0.5'],
    ['+3', undefined, '3'],
    ['.5', undefined, '0.5'],
    ['5.', undefined, '5'],
    ['-0', undefined, '0'],
    ['000123', undefined, '123'],
    ['1.500', 1, '1.5'], // trailing zeros do not count against maxDp
    ['12', 0, '12'],
    ['123456789012345678901234.123456789', undefined, '123456789012345678901234.123456789'],
  ])('%s (maxDp %s) → %s', (input, maxDp, expected) => {
    expect(parseDecimal(input, maxDp)).toBe(expected);
  });

  it.each<[string, number | undefined]>([
    ['', undefined],
    ['.', undefined],
    ['-', undefined],
    ['abc', undefined],
    ['1e5', undefined],
    ['1,23', undefined],
    ['1.2.3', undefined],
    ['0.123456789', 8],
    ['1.25', 1],
    ['1.5', 0],
    ['Infinity', undefined],
  ])('%s (maxDp %s) → null', (input, maxDp) => {
    expect(parseDecimal(input, maxDp)).toBeNull();
  });

  it('round-trips formatQuantity', () => {
    for (const value of ['1234.5', '-12.25', '0.00000001', '21000000']) {
      expect(parseDecimal(formatQuantity(value, { maxDp: 8 }), 8)).toBe(value);
    }
  });
});
