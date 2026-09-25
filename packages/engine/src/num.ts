// Decimal and date helpers shared by the engine modules (stage-2.md §2.1). Money leaves the engine
// as integer cents rounded once, half away from zero; units and prices as normalised decimal
// strings; ratios with 12 significant digits. Dates are ISO strings, never parsed with
// `new Date(string)`; day arithmetic is UTC. No clock.
import { JoinrDecimal, normaliseDecimal, type DecimalValue, type IsoDate } from '@joinr/schema';
import type { Cents } from './types';

export type Dec = DecimalValue;

export const ZERO: Dec = new JoinrDecimal(0);
export const ONE: Dec = new JoinrDecimal(1);

/** Significant digits of every ratio the engine returns (§2.1). */
export const RATIO_SIGNIFICANT_DIGITS = 12;

/** A decimal from an input string; a malformed or non-finite value is a programmer error. */
export function dec(value: string, what: string): Dec {
  let d: Dec;
  try {
    d = new JoinrDecimal(value);
  } catch {
    throw new RangeError(`engine: ${what} is not a number: ${JSON.stringify(value)}`);
  }
  if (!d.isFinite())
    throw new RangeError(`engine: ${what} is not finite: ${JSON.stringify(value)}`);
  return d;
}

/** A decimal from a JS number (integers such as cents, or template constants). */
export function decN(value: number): Dec {
  if (!Number.isFinite(value)) throw new RangeError(`engine: not a finite number: ${value}`);
  return new JoinrDecimal(value);
}

/** Integer cents → dollars as a decimal. */
export function dollarsOf(cents: Cents, what = 'cents'): Dec {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`engine: ${what} must be a safe integer: ${cents}`);
  }
  return new JoinrDecimal(cents).div(100);
}

/** Dollars → integer cents, rounded once, half away from zero (never -0). */
export function centsOf(dollars: Dec): Cents {
  const c = dollars.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(c)) throw new RangeError('engine: amount out of range');
  return c === 0 ? 0 : c;
}

const MAX_SAFE_CENTS = new JoinrDecimal(Number.MAX_SAFE_INTEGER);

/** True when `dollars` converts to safe-integer cents, i.e. `centsOf` will not throw. */
export function isSafeCents(dollars: Dec): boolean {
  return dollars.times(100).abs().lessThanOrEqualTo(MAX_SAFE_CENTS);
}

/** A normalised decimal string (units and prices). */
export function decimalString(d: Dec): string {
  return normaliseDecimal(d);
}

/** A ratio string with 12 significant digits (§2.1). */
export function ratioString(d: Dec): string {
  return normaliseDecimal(
    d.toSignificantDigits(RATIO_SIGNIFICANT_DIGITS, JoinrDecimal.ROUND_HALF_UP),
  );
}

/** A price or average price: 12 significant digits, like a ratio (one rounding at the output). */
export function priceString(d: Dec): string {
  return ratioString(d);
}

/** Σ of decimals. */
export function sum(values: Iterable<Dec>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

/** Σ of integer cents (exact). */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Sheets ROUNDUP(x, dp): away from zero. */
export function roundUpAway(d: Dec, dp: number): Dec {
  return d.toDecimalPlaces(dp, JoinrDecimal.ROUND_UP);
}

/** Sheets ROUNDDOWN(x, dp): toward zero. */
export function roundDownToward(d: Dec, dp: number): Dec {
  return d.toDecimalPlaces(dp, JoinrDecimal.ROUND_DOWN);
}

export function maxDec(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

export function minDec(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}

// ─── Dates ──────────────────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 (UTC) of an ISO date; a malformed date is a programmer error. */
export function dayNumber(date: IsoDate): number {
  const m = ISO_DATE_RE.exec(date);
  if (!m)
    throw new RangeError(`engine: expected a date written YYYY-MM-DD: ${JSON.stringify(date)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(0);
  check.setUTCFullYear(y, mo - 1, d);
  const ms = check.getTime();
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`engine: not a calendar date: ${JSON.stringify(date)}`);
  }
  return Math.round(ms / MS_PER_DAY);
}

/** The ISO date of a day number. */
export function isoOfDayNumber(day: number): IsoDate {
  const dt = new Date(day * MS_PER_DAY);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

/** `b − a` in calendar days. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** An ISO date plus whole days. */
export function addDaysIso(date: IsoDate, days: number): IsoDate {
  return isoOfDayNumber(dayNumber(date) + days);
}

/** Sheets WEEKDAY(date) (type 1): Sunday = 1 … Saturday = 7. */
export function sheetWeekday(date: IsoDate): number {
  return new Date(dayNumber(date) * MS_PER_DAY).getUTCDay() + 1;
}
