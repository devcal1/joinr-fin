// Pure formatting and parsing helpers (STYLE_GUIDE §8, stage-0 plan §7.4). No React.
//
// - Money is integer cents. Quantities and prices are decimal strings (or numbers) handled with
//   decimal.js, so nothing drifts through binary floating point.
// - Every negative number uses U+2212 (−), never the ASCII hyphen.
// - Grouping follows en-AU: commas every three digits, full stop for decimals.
// - An IsoDate string is read as a calendar date, never through `new Date(string)` (which would
//   apply UTC and shift the day). A `Date` argument is read in local time.
// - Rounding is half away from zero everywhere.

import { Decimal } from 'decimal.js';

/** 'YYYY-MM-DD' (a calendar date, no time zone). */
export type IsoDate = string;
/** 'YYYY-MM'. */
export type IsoMonth = string;

/** U+2212 MINUS SIGN, used for every negative figure. */
export const MINUS = '−';
const EN_DASH = '–';

export interface MoneyFormatOptions {
  /** Round to whole dollars (KPI tiles): `$12,480`. Half away from zero. */
  wholeDollars?: boolean;
  /** 'always' adds `+` to zero and positive values; 'never' drops the sign. Default 'auto'. */
  signDisplay?: 'auto' | 'always' | 'never';
}

export interface PercentFormatOptions {
  /** Decimal places, default 1. */
  dp?: number;
  signDisplay?: 'auto' | 'always';
}

export interface QuantityFormatOptions {
  /** Default 4 (use 8 for crypto). */
  maxDp?: number;
  /** Default 0. Trailing zeros are trimmed down to this. */
  minDp?: number;
}

export interface PriceFormatOptions {
  /** Default 2. */
  minDp?: number;
  /** Default 4. */
  maxDp?: number;
}

// Private decimal.js constructor, so the app-wide Decimal config is never mutated.
const Dec = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP });

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_RE = /^(\d{4})-(\d{2})$/;
const DECIMAL_STRING_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
// Optional sign before or after `$`, then digits with valid en-AU grouping (or none), then cents.
const MONEY_INPUT_RE = /^([+-])?\s*\$?\s*([+-])?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;
const DECIMAL_INPUT_RE = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;
// Day, month and a four-digit year, with one separator used consistently: 18/08/2026, 18-8-2026.
const DMY_INPUT_RE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/;

type Sign = 'auto' | 'always' | 'never';

/* ───────────────────────── helpers ───────────────────────── */

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The sign follows the displayed (rounded) value: a value that rounds to zero never shows −. */
function signFor(negative: boolean, zero: boolean, display: Sign): string {
  if (display === 'never') return '';
  if (negative && !zero) return MINUS;
  return display === 'always' ? '+' : '';
}

function checkDp(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new RangeError(`${name} must be an integer from 0 to 20, got ${String(value)}`);
  }
  return value;
}

/** Grouped digits of a non-negative decimal, rounded to maxDp, trailing zeros trimmed to minDp. */
function decimalBody(abs: Decimal, minDp: number, maxDp: number): string {
  const [intPart = '0', fracPart = ''] = abs.toFixed(maxDp).split('.');
  let frac = fracPart.replace(/0+$/, '');
  if (frac.length < minDp) frac = frac.padEnd(minDp, '0');
  return frac ? `${groupDigits(intPart)}.${frac}` : groupDigits(intPart);
}

function toDecimal(value: string | number, fn: string): Decimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${fn} expects a finite number`);
    return new Dec(value);
  }
  const text = value.trim().replace(/−/g, '-');
  if (!DECIMAL_STRING_RE.test(text)) {
    throw new TypeError(`${fn} expects a decimal string, got "${value}"`);
  }
  return new Dec(text);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month (1–12) of a year, leap years included. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function ymdFromDate(value: Date, fn: string): Ymd {
  if (Number.isNaN(value.getTime())) throw new RangeError(`${fn}: Invalid Date`);
  return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
}

function parseIsoDateParts(text: string): Ymd | null {
  const match = ISO_DATE_RE.exec(text);
  if (!match) return null;
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return isValidYmd(ymd.y, ymd.m, ymd.d) ? ymd : null;
}

function ymdOf(value: IsoDate | Date, fn: string): Ymd {
  if (value instanceof Date) return ymdFromDate(value, fn);
  const ymd = parseIsoDateParts(value);
  if (!ymd) throw new RangeError(`${fn} expects an ISO date (YYYY-MM-DD), got "${value}"`);
  return ymd;
}

function monthName(names: readonly string[], month: number): string {
  const name = names[month - 1];
  if (name === undefined) throw new RangeError(`Invalid month: ${month}`);
  return name;
}

/* ───────────────────────── numbers ───────────────────────── */

/**
 * Integer cents → `$12,480.00`; negatives `−$1,234.00`; `wholeDollars` → `$12,480`;
 * `signDisplay: 'always'` → `+$12.00`. Throws TypeError on non-integer or non-finite cents.
 */
export function formatMoney(cents: number, options: MoneyFormatOptions = {}): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`formatMoney expects integer cents, got ${String(cents)}`);
  }
  if (!Number.isSafeInteger(cents))
    throw new RangeError('formatMoney: cents exceed the safe range');
  const abs = Math.abs(cents);
  let body: string;
  let zero: boolean;
  if (options.wholeDollars) {
    const dollars = Math.floor(abs / 100) + (abs % 100 >= 50 ? 1 : 0);
    body = groupDigits(String(dollars));
    zero = dollars === 0;
  } else {
    body = `${groupDigits(String(Math.floor(abs / 100)))}.${pad2(abs % 100)}`;
    zero = abs === 0;
  }
  return `${signFor(cents < 0, zero, options.signDisplay ?? 'auto')}$${body}`;
}

/** A ratio → percent with one decimal: 0.074 → `7.4%`, −0.021 → `−2.1%`. */
export function formatPercent(ratio: number, options: PercentFormatOptions = {}): string {
  if (!Number.isFinite(ratio)) throw new TypeError('formatPercent expects a finite number');
  const dp = checkDp(options.dp ?? 1, 'dp');
  const percent = new Dec(ratio).times(100).toDecimalPlaces(dp);
  const sign = signFor(percent.isNegative(), percent.isZero(), options.signDisplay ?? 'auto');
  return `${sign}${decimalBody(percent.abs(), dp, dp)}%`;
}

/** Units and quantities: up to 4 dp by default (crypto 8), trailing zeros trimmed, grouped. */
export function formatQuantity(
  value: string | number,
  options: QuantityFormatOptions = {},
): string {
  const maxDp = checkDp(options.maxDp ?? 4, 'maxDp');
  const minDp = Math.min(checkDp(options.minDp ?? 0, 'minDp'), maxDp);
  const rounded = toDecimal(value, 'formatQuantity').toDecimalPlaces(maxDp);
  return `${signFor(rounded.isNegative(), rounded.isZero(), 'auto')}${decimalBody(rounded.abs(), minDp, maxDp)}`;
}

/** Unit prices: 2–4 dp by default → `$1.2345`, `$12.50`, `−$0.05`. */
export function formatPrice(value: string | number, options: PriceFormatOptions = {}): string {
  const maxDp = checkDp(options.maxDp ?? 4, 'maxDp');
  const minDp = Math.min(checkDp(options.minDp ?? 2, 'minDp'), maxDp);
  const rounded = toDecimal(value, 'formatPrice').toDecimalPlaces(maxDp);
  return `${signFor(rounded.isNegative(), rounded.isZero(), 'auto')}$${decimalBody(rounded.abs(), minDp, maxDp)}`;
}

/* ───────────────────────── dates ───────────────────────── */

/** `18/08/2026` (tables and forms). */
export function formatDate(value: IsoDate | Date): string {
  const { y, m, d } = ymdOf(value, 'formatDate');
  return `${pad2(d)}/${pad2(m)}/${pad4(y)}`;
}

/** `18 August 2026` (prose). */
export function formatDateLong(value: IsoDate | Date): string {
  const { y, m, d } = ymdOf(value, 'formatDateLong');
  return `${d} ${monthName(MONTHS_LONG, m)} ${y}`;
}

/**
 * `Aug 2026` (snapshot months). Accepts an IsoMonth ('YYYY-MM'), an IsoDate ('YYYY-MM-DD') or a
 * Date. (IsoMonth and IsoDate are both `string`, so the union is written once.)
 */
export function formatMonth(value: IsoMonth | Date): string {
  if (typeof value === 'string') {
    const month = ISO_MONTH_RE.exec(value);
    if (month) {
      const y = Number(month[1]);
      const m = Number(month[2]);
      if (y >= 1 && m >= 1 && m <= 12) return `${monthName(MONTHS_SHORT, m)} ${y}`;
      throw new RangeError(`formatMonth expects 'YYYY-MM' or 'YYYY-MM-DD', got "${value}"`);
    }
  }
  const { y, m } = ymdOf(value, 'formatMonth');
  return `${monthName(MONTHS_SHORT, m)} ${y}`;
}

/** `14:32` (24-hour, local time). */
export function formatTime(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError('formatTime: Invalid Date');
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

/** The financial year's start year: 2026-07-01 → 2026; 2026-06-30 → 2025 (1 July – 30 June). */
export function financialYearOf(value: IsoDate | Date): number {
  const { y, m } = ymdOf(value, 'financialYearOf');
  return m >= 7 ? y : y - 1;
}

/** 2026 → `FY2026–27` (en dash). */
export function formatFinancialYear(startYear: number): string {
  if (!Number.isInteger(startYear) || startYear < 1) {
    throw new RangeError(`formatFinancialYear expects a year, got ${String(startYear)}`);
  }
  return `FY${startYear}${EN_DASH}${pad2((startYear + 1) % 100)}`;
}

/** 2026 → { start: '2026-07-01', end: '2027-06-30' }. */
export function financialYearBounds(startYear: number): { start: IsoDate; end: IsoDate } {
  if (!Number.isInteger(startYear) || startYear < 1) {
    throw new RangeError(`financialYearBounds expects a year, got ${String(startYear)}`);
  }
  return { start: `${pad4(startYear)}-07-01`, end: `${pad4(startYear + 1)}-06-30` };
}

/** A Date's local calendar date as 'YYYY-MM-DD'. */
export function toIsoDate(value: Date): IsoDate {
  const { y, m, d } = ymdFromDate(value, 'toIsoDate');
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

/** True for a real calendar date written 'YYYY-MM-DD' (leap days checked). */
export function isIsoDate(value: string): boolean {
  return parseIsoDateParts(value) !== null;
}

/* ───────────────────────── parsing (form input) ───────────────────────── */

/**
 * `$1,234.50` · `1234.5` · `-12` · `−12` · `-$12` · `$.5` → integer cents.
 * More than 2 decimal places, bad grouping or anything else → null.
 */
export function parseMoney(input: string): number | null {
  const match = MONEY_INPUT_RE.exec(input.trim().replace(/−/g, '-'));
  if (!match) return null;
  const [, signBefore, signAfter, intPart = '', frac] = match;
  if (signBefore && signAfter) return null;
  if (!intPart && !frac) return null;
  if (frac !== undefined && frac.length > 2) return null;
  const cents = Number(intPart.replace(/,/g, '') + (frac ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  if (cents === 0) return 0;
  return (signBefore ?? signAfter) === '-' ? -cents : cents;
}

/**
 * `18/08/2026` · `18/8/2026` · `18-08-2026` · `2026-08-18` → '2026-08-18'.
 * Two-digit years and impossible dates (31/04, 29/02 outside leap years) → null.
 */
export function parseDate(input: string): IsoDate | null {
  const text = input.trim();
  const dmy = DMY_INPUT_RE.exec(text);
  const ymd = dmy
    ? { y: Number(dmy[4]), m: Number(dmy[3]), d: Number(dmy[1]) }
    : parseIsoDateParts(text);
  if (!ymd || !isValidYmd(ymd.y, ymd.m, ymd.d)) return null;
  return `${pad4(ymd.y)}-${pad2(ymd.m)}-${pad2(ymd.d)}`;
}

/**
 * A typed number → a normalised decimal string ('1,234.50' → '1234.5', '−0.5' → '-0.5').
 * Returns null for anything that is not a plain decimal, or that needs more than `maxDp`
 * decimal places (trailing zeros don't count).
 */
export function parseDecimal(input: string, maxDp?: number): string | null {
  const match = DECIMAL_INPUT_RE.exec(input.trim().replace(/−/g, '-'));
  if (!match) return null;
  const [, sign = '', intPart = '', frac] = match;
  if (!intPart && !frac) return null;
  const significant = (frac ?? '').replace(/0+$/, '');
  if (maxDp !== undefined && significant.length > checkDp(maxDp, 'maxDp')) return null;
  const value = new Dec(`${sign}${intPart.replace(/,/g, '') || '0'}.${significant || '0'}`);
  return value.isZero() ? '0' : value.toFixed();
}
