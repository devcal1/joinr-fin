// Zod schemas for the primitive value formats (stage-1.md §2.1).
import { z } from 'zod';
import { NORMALISED_DECIMAL_RE, normaliseDecimal } from './decimal';

/** `YYYY-MM-DD`, a real calendar date. */
export type IsoDate = string;
/** `YYYY-MM`. */
export type IsoMonth = string;
/** ISO-8601 UTC timestamp ending in `Z`, e.g. `2026-09-24T04:32:00.000Z`. */
export type IsoTimestamp = string;
/** A normalised decimal string (see `NORMALISED_DECIMAL_RE`). */
export type DecimalString = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** True for a real calendar date written `YYYY-MM-DD` (leap days checked). */
export function isIsoDateString(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

export function isIsoMonthString(value: string): boolean {
  return ISO_MONTH_RE.test(value);
}

export function isIsoTimestampString(value: string): boolean {
  if (!ISO_TIMESTAMP_RE.test(value)) return false;
  return isIsoDateString(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

export const IsoDateSchema = z
  .string()
  .refine(isIsoDateString, { error: 'must be a date written YYYY-MM-DD' });

export const IsoMonthSchema = z
  .string()
  .refine(isIsoMonthString, { error: 'must be a month written YYYY-MM' });

export const IsoTimestampSchema = z
  .string()
  .refine(isIsoTimestampString, { error: 'must be an ISO-8601 UTC timestamp ending in Z' });

/** A normalised decimal string, as stored (`"0.056"`, `"-2.5"`, `"20"`). */
export const DecimalStringSchema = z
  .string()
  .regex(NORMALISED_DECIMAL_RE, { error: 'must be a plain decimal number such as 12.5' });

/** Integer cents (a safe integer, may be negative). */
export const CentsSchema = z
  .number()
  .int({ error: 'must be whole cents' })
  .refine(Number.isSafeInteger, { error: 'is out of range' });

const PLAIN_POSITIVE_DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A user-entered positive decimal (`"12.50"`, `"0.5"`, `".5"`) with at most `maxDp` decimal places
 * and, optionally, a maximum. No sign, no exponent. Output is normalised (`"12.5"`).
 */
export function PositiveDecimalSchema(maxDp: number, max?: number) {
  return z
    .string()
    .trim()
    .regex(PLAIN_POSITIVE_DECIMAL_RE, { error: 'must be a positive number' })
    .refine(
      (v) => {
        const dp = v.includes('.') ? v.split('.')[1]!.length : 0;
        return dp <= maxDp;
      },
      { error: `must have at most ${maxDp} decimal places` },
    )
    .transform((v) => normaliseDecimal(v))
    .refine((v) => v !== '0', { error: 'must be greater than zero' })
    .refine((v) => max === undefined || Number(v) <= max, {
      error: `must be at most ${String(max)}`,
    });
}
