// Check builders and tolerances (stage-1.md §4.9).
import {
  JoinrDecimal,
  type CheckStatus,
  type CheckUnit,
  type ReasonCode,
  type ReportSection,
} from '@joinr/schema';
import type { Check } from './model';

export interface CheckInput {
  id: string;
  section: ReportSection;
  label: string;
  sheetRef?: string | null;
  unit?: CheckUnit;
  expected?: string | number | null;
  actual?: string | number | null;
  diff?: string | number | null;
  status: CheckStatus;
  reasonCode?: ReasonCode | null;
  reason?: string | null;
  refs?: Check['refs'];
}

export function check(c: CheckInput): Check {
  return {
    id: c.id,
    section: c.section,
    label: c.label,
    sheetRef: c.sheetRef ?? null,
    unit: c.unit ?? 'none',
    expected: c.expected ?? null,
    actual: c.actual ?? null,
    diff: c.diff ?? null,
    status: c.status,
    reasonCode: c.reasonCode ?? null,
    reason: c.reason ?? null,
    refs: c.refs ?? null,
  };
}

/** An info line (skipped rows, defaults, derived values). */
export function info(
  id: string,
  section: ReportSection,
  label: string,
  reasonCode: ReasonCode | null,
  reason: string,
  extra: Partial<CheckInput> = {},
): Check {
  return check({ id, section, label, status: 'info', reasonCode, reason, ...extra });
}

/** Money tolerance for a sum over `n` cells: max(1, ⌈n/2⌉) cents. */
export const centsTolerance = (n: number): number => Math.max(1, Math.ceil(n / 2));

export const withinCents = (expected: number, actual: number, n: number): boolean =>
  Math.abs(actual - expected) <= centsTolerance(n);

/** Units tolerance (1e-8). */
export const UNITS_TOLERANCE = new JoinrDecimal('1e-8');
/** Ratio tolerance (1e-9). */
export const RATIO_TOLERANCE = new JoinrDecimal('1e-9');

/** actual − expected as a normalised decimal string. */
export function decimalDiff(expected: string, actual: string): string {
  const d = new JoinrDecimal(actual).minus(new JoinrDecimal(expected));
  return d.isZero() ? '0' : d.toFixed();
}

export function withinDecimal(
  expected: string,
  actual: string,
  tolerance: InstanceType<typeof JoinrDecimal>,
): boolean {
  return new JoinrDecimal(actual)
    .minus(new JoinrDecimal(expected))
    .abs()
    .lessThanOrEqualTo(tolerance);
}

/** Dollars (a spreadsheet double) → exact decimal (shortest round-trip string). */
export const dec = (v: number): InstanceType<typeof JoinrDecimal> => new JoinrDecimal(v);

/** A sum of doubles as decimal, rounded once to cents (half away from zero). */
export function sumToCents(values: readonly number[]): number {
  let total = new JoinrDecimal(0);
  for (const v of values) total = total.plus(new JoinrDecimal(v));
  const cents = total.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  return cents === 0 ? 0 : cents;
}

/** A decimal value rounded to cents. */
export function decimalToCents(value: InstanceType<typeof JoinrDecimal>): number {
  const cents = value.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  return cents === 0 ? 0 : cents;
}
