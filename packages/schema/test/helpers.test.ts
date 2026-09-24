import { describe, expect, it } from 'vitest';
import {
  addMonthsIso,
  centsFromDecimal,
  centsFromNumber,
  compareDecimals,
  compareIso,
  decimalFromNumber,
  excelSerialToIsoDate,
  financialYearOfIso,
  isoMonthOf,
  isPositiveDecimal,
  multiplyToCents,
  normaliseDecimal,
  previousWeekdayStart,
  sumDecimals,
} from '../src/index';

describe('decimal helpers', () => {
  it('normalises decimal strings', () => {
    expect(normaliseDecimal('1.500')).toBe('1.5');
    expect(normaliseDecimal('-0')).toBe('0');
    expect(normaliseDecimal('0.000')).toBe('0');
    expect(normaliseDecimal('1e-7')).toBe('0.0000001');
    expect(normaliseDecimal('12e3')).toBe('12000');
    expect(normaliseDecimal('-005.20')).toBe('-5.2');
    expect(() => normaliseDecimal('abc')).toThrow(RangeError);
  });

  it('removes float noise with 12 significant digits', () => {
    expect(decimalFromNumber(1234.5000000000002)).toBe('1234.5');
    expect(decimalFromNumber(-2.5000000000000004)).toBe('-2.5');
    expect(decimalFromNumber(0.1 + 0.2)).toBe('0.3');
    expect(decimalFromNumber(0.00012345)).toBe('0.00012345');
    expect(decimalFromNumber(12.345678901234567)).toBe('12.3456789012');
    expect(decimalFromNumber(0.056)).toBe('0.056');
    expect(decimalFromNumber(1e-7)).toBe('0.0000001');
    expect(decimalFromNumber(-0)).toBe('0');
    expect(() => decimalFromNumber(Number.NaN)).toThrow(RangeError);
  });

  it('rounds dollars to cents half away from zero', () => {
    expect(centsFromNumber(1.005)).toBe(101); // 1.005 is stored as 1.00499999…; decimal.js reads "1.005"
    expect(centsFromNumber(2.5 / 100)).toBe(3);
    expect(centsFromNumber(-0.025)).toBe(-3);
    expect(centsFromNumber(-0.004)).toBe(0);
    expect(Object.is(centsFromNumber(-0.004), -0)).toBe(false);
    expect(centsFromNumber(1234.5000000000002)).toBe(123450);
    expect(centsFromDecimal('12.345')).toBe(1235);
    expect(centsFromDecimal('-12.345')).toBe(-1235);
    expect(() => centsFromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => centsFromDecimal('1e300')).toThrow(RangeError);
  });

  it('sums, compares and multiplies exactly', () => {
    expect(sumDecimals(['0.1', '0.2', '-0.3'])).toBe('0');
    expect(sumDecimals([])).toBe('0');
    expect(sumDecimals(['100', '-20.5'])).toBe('79.5');
    expect(compareDecimals('1.50', '1.5')).toBe(0);
    expect(compareDecimals('-1', '0.0001')).toBe(-1);
    expect(compareDecimals('10', '9.99')).toBe(1);
    expect(isPositiveDecimal('0.00000001')).toBe(true);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('-1')).toBe(false);
    expect(isPositiveDecimal('x')).toBe(false);
    expect(multiplyToCents('0.05', '90000')).toBe(450000);
    expect(multiplyToCents('-20', '6')).toBe(-12000);
    expect(multiplyToCents('3', '0.335')).toBe(101); // 1.005 → 101
    expect(multiplyToCents('-3', '0.335')).toBe(-101);
  });
});

describe('date helpers', () => {
  it('converts serial dates in both systems', () => {
    expect(excelSerialToIsoDate(1)).toBe('1899-12-31');
    expect(excelSerialToIsoDate(45292)).toBe('2024-01-01');
    expect(excelSerialToIsoDate(45292.75)).toBe('2024-01-01');
    expect(excelSerialToIsoDate(45351)).toBe('2024-02-29');
    expect(excelSerialToIsoDate(0, true)).toBe('1904-01-01');
    expect(excelSerialToIsoDate(43830, true)).toBe('2024-01-01');
    expect(() => excelSerialToIsoDate(Number.NaN)).toThrow(RangeError);
  });

  it('takes the month of a date', () => {
    expect(isoMonthOf('2026-02-17')).toBe('2026-02');
    expect(() => isoMonthOf('17/02/2026')).toThrow(RangeError);
  });

  it('adds months with EDATE clamping', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsIso('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsIso('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsIso('2026-01-15', -13)).toBe('2024-12-15');
    expect(addMonthsIso('2026-05-31', 0)).toBe('2026-05-31');
    expect(() => addMonthsIso('2026-01-01', 1.5)).toThrow(RangeError);
  });

  it('compares ISO strings', () => {
    expect(compareIso('2026-01-02', '2026-01-10')).toBe(-1);
    expect(compareIso('2026-01', '2026-01')).toBe(0);
    expect(compareIso('2026-02-01T00:00:00Z', '2026-01-31T23:59:59Z')).toBe(1);
  });

  it('finds the financial year (1 July – 30 June)', () => {
    expect(financialYearOfIso('2026-06-30')).toBe(2025);
    expect(financialYearOfIso('2026-07-01')).toBe(2026);
    expect(financialYearOfIso('2027-01-01')).toBe(2026);
  });

  it('finds the start of the previous weekday across weekends', () => {
    const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 30);
    const day = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    // 2026-09-21 is a Monday.
    expect(day(previousWeekdayStart(at(2026, 9, 22)))).toEqual([2026, 9, 21]); // Tue → Mon
    expect(day(previousWeekdayStart(at(2026, 9, 21)))).toEqual([2026, 9, 18]); // Mon → Fri
    expect(day(previousWeekdayStart(at(2026, 9, 26)))).toEqual([2026, 9, 25]); // Sat → Fri
    expect(day(previousWeekdayStart(at(2026, 9, 27)))).toEqual([2026, 9, 25]); // Sun → Fri
    expect(day(previousWeekdayStart(at(2026, 9, 21, 0)))).toEqual([2026, 9, 18]);
    const start = previousWeekdayStart(at(2026, 9, 24));
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });
});
