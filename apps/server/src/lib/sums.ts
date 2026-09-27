// Shared server sum helpers (CODE-9, stage-6.md §4.5): decimal strings summed with decimal.js,
// and integer cents summed with a safe-integer check.
import { JoinrDecimal, normaliseDecimal, sumDecimals, type DecimalValue } from '@joinr/schema';

/** Σ of decimal strings, normalised ('0' for none); RangeError on a malformed value (the schema's). */
export const sumDecimalStrings: (values: readonly string[]) => string = sumDecimals;

/**
 * Σ of stored decimal strings, leaving out a malformed value (a stored row the engine flags
 * instead of the sum failing).
 */
export function sumValidDecimals(values: readonly string[]): DecimalValue {
  let sum = new JoinrDecimal(0);
  for (const v of values) {
    try {
      sum = sum.plus(v);
    } catch {
      // Left out: a malformed stored decimal cannot be counted.
    }
  }
  return sum;
}

/** `sumValidDecimals`, normalised for a DTO ('0' for none). */
export function sumValidDecimalStrings(values: readonly string[]): string {
  return normaliseDecimal(sumValidDecimals(values));
}

/**
 * Σ of integer cents (0 for none). RangeError when a value is not a safe integer or the running
 * total leaves the safe-integer range, so a sum never silently loses a cent.
 */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`sumCents: not integer cents: ${v}`);
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('sumCents: total out of range');
  }
  return total;
}
