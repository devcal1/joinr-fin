// Shared server sum helpers (CODE-9, stage-6.md §4.5): stored decimal strings summed with
// decimal.js, leaving out a malformed value. Stage 7 (CODE-7, stage-7.md §5.9) removed the two
// unused helpers (a plain decimal sum and a cents sum).
import { JoinrDecimal, normaliseDecimal, type DecimalValue } from '@joinr/schema';

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
