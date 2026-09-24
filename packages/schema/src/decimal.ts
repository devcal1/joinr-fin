// Decimal helpers (stage-1.md §2.1, §4.2). Quantities, prices and ratios are decimal strings;
// money is integer cents. All arithmetic goes through decimal.js, never through JS floats.
import Decimal from 'decimal.js';

/** The shared Decimal constructor: high precision, never exponent notation, half away from zero. */
export const JoinrDecimal = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -60,
  toExpPos: 60,
});
export type DecimalValue = InstanceType<typeof JoinrDecimal>;

/** Significant digits kept when a spreadsheet double becomes a decimal string (§4.2 rule 2). */
export const IMPORT_SIGNIFICANT_DIGITS = 12;

/** Normalised decimal string: no exponent, `.` separator, leading `-`, no trailing zeros, no `-0`. */
export const NORMALISED_DECIMAL_RE = /^(?!-0$)-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

function toDecimal(value: string | number | Decimal, fn: string): DecimalValue {
  let d: DecimalValue;
  try {
    d = new JoinrDecimal(value);
  } catch {
    throw new RangeError(`${fn}: not a number: ${String(value)}`);
  }
  if (!d.isFinite()) throw new RangeError(`${fn}: not a finite number: ${String(value)}`);
  return d;
}

function format(d: DecimalValue): string {
  if (d.isZero()) return '0';
  return d.toFixed();
}

/** `"1.500"` → `"1.5"`, `"-0"` → `"0"`, `"1e-7"` → `"0.0000001"`. Throws on non-numbers. */
export function normaliseDecimal(value: string | Decimal): string {
  return format(toDecimal(value, 'normaliseDecimal'));
}

/**
 * A spreadsheet double → a decimal string with 12 significant digits (ROUND_HALF_EVEN), which
 * removes float noise: `-2.5000000000000004` → `"-2.5"`, `1234.5000000000002` → `"1234.5"`.
 */
export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`decimalFromNumber: not finite: ${value}`);
  const d = toDecimal(value, 'decimalFromNumber').toSignificantDigits(
    IMPORT_SIGNIFICANT_DIGITS,
    Decimal.ROUND_HALF_EVEN,
  );
  return format(d);
}

function toCents(d: DecimalValue, fn: string): number {
  const cents = d.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(cents)) throw new RangeError(`${fn}: out of range`);
  return cents === 0 ? 0 : cents; // never -0
}

/** Dollars (a spreadsheet double) → integer cents, half away from zero. */
export function centsFromNumber(dollars: number): number {
  if (!Number.isFinite(dollars)) throw new RangeError(`centsFromNumber: not finite: ${dollars}`);
  return toCents(toDecimal(dollars, 'centsFromNumber'), 'centsFromNumber');
}

/** Dollars as a decimal string → integer cents, half away from zero. */
export function centsFromDecimal(dollars: string): number {
  return toCents(toDecimal(dollars, 'centsFromDecimal'), 'centsFromDecimal');
}

/** Sum of decimal strings, normalised. `[]` → `"0"`. */
export function sumDecimals(values: readonly string[]): string {
  let total = new JoinrDecimal(0);
  for (const v of values) total = total.plus(toDecimal(v, 'sumDecimals'));
  return format(total);
}

/** -1, 0 or 1, compared numerically (`"1.50"` equals `"1.5"`). */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const c = toDecimal(a, 'compareDecimals').comparedTo(toDecimal(b, 'compareDecimals'));
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/** True when `value` parses as a number greater than zero. Never throws. */
export function isPositiveDecimal(value: string): boolean {
  try {
    const d = new JoinrDecimal(value);
    return d.isFinite() && d.greaterThan(0);
  } catch {
    return false;
  }
}

/** units × price (dollars) → integer cents, half away from zero (an order value). */
export function multiplyToCents(units: string, price: string): number {
  return toCents(
    toDecimal(units, 'multiplyToCents').times(toDecimal(price, 'multiplyToCents')),
    'multiplyToCents',
  );
}
