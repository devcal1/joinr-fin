// Shared helpers of the Stage 4 modules (stage-4.md §2.1, §2.3, §2.10): money rounded once from
// decimal cents, the entry of a dated log in force at a date, the annualising power (a non-integer
// exponent through JoinrDecimal.pow), month arithmetic for the day spreads, and the chart grouping
// every Stage 4 chart uses (monthly, calendar quarter, or the financial year).
import {
  addMonthsIso,
  JoinrDecimal,
  type ChartDateUnit,
  type IsoDate,
  type IsoMonth,
} from '@joinr/schema';
import { addDaysIso, checkCents, dayNumber, ONE, ZERO, type Dec } from './num';
import { groupOf, keepLast } from './periods';
import type { Cents } from './types';

/** The sheet's RRI convention: an annualising exponent of 365.25 ÷ days (§2.3). */
export const DAYS_PER_YEAR = new JoinrDecimal('365.25');

/** Integer cents as a decimal (a non-integer is a programmer error). */
export function centsDec(cents: Cents, what: string): Dec {
  return new JoinrDecimal(checkCents(cents, what));
}

/** Decimal cents → integer cents, rounded once, half away from zero (never -0). */
export function roundCents(cents: Dec): Cents {
  const c = cents.toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(c)) throw new RangeError('engine: amount out of range');
  return c === 0 ? 0 : c;
}

/** max(0, d). */
export function maxZero(d: Dec): Dec {
  return d.isNegative() ? ZERO : d;
}

/** `-c` without producing -0. */
export function negateCents(c: Cents): Cents {
  return c === 0 ? 0 : -c;
}

/** Sort key helper: ISO dates (or months) compare as strings. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A dated log in date order (ties: id order); every date is validated. */
export function byAsOf<T extends { asOf: IsoDate; id: number | null }>(entries: readonly T[]): T[] {
  for (const e of entries) dayNumber(e.asOf);
  return [...entries].sort((a, b) => compareIso(a.asOf, b.asOf) || (a.id ?? 0) - (b.id ?? 0));
}

/** The latest entry dated on or before `date` (§2.3); null before the first entry. `sorted` is in date order. */
export function latestOnOrBefore<T extends { asOf: IsoDate }>(
  sorted: readonly T[],
  date: IsoDate,
): T | null {
  let found: T | null = null;
  for (const e of sorted) {
    if (e.asOf > date) break;
    found = e;
  }
  return found;
}

/**
 * The entry in force at `asOf` (§2.3): the latest dated on or before it; when every entry is later
 * (an entry may be dated tomorrow), the earliest, so a fresh entry never makes a figure vanish.
 * Null only for an empty log. `sorted` is in date order.
 */
export function latestAtAsOf<T extends { asOf: IsoDate }>(
  sorted: readonly T[],
  asOf: IsoDate,
): T | null {
  return latestOnOrBefore(sorted, asOf) ?? sorted[0] ?? null;
}

/**
 * The annualised rate of a growth multiple over `days` (§2.3): growth^(365.25 ÷ days) − 1, through
 * JoinrDecimal.pow (non-integer exponents). Null when days ≤ 0 or the growth is negative.
 */
export function annualise(growth: Dec, days: number): Dec | null {
  if (!(days > 0) || growth.isNegative()) return null;
  if (growth.isZero()) return ONE.negated();
  return growth.pow(DAYS_PER_YEAR.div(days)).minus(ONE);
}

/** The first day of a month (`2026-09` → `2026-09-01`). */
export function firstOfMonth(month: IsoMonth): IsoDate {
  return `${month}-01`;
}

/** The last day of a month (`2026-02` → `2026-02-28`). */
export function lastOfMonth(month: IsoMonth): IsoDate {
  return addDaysIso(addMonthsIso(firstOfMonth(month), 1), -1);
}

/** The month after `month`. */
export function monthAfter(month: IsoMonth): IsoMonth {
  return addMonthsIso(firstOfMonth(month), 1).slice(0, 7);
}

/** The number of days in a month. */
export function daysInMonth(month: IsoMonth): number {
  return dayNumber(addMonthsIso(firstOfMonth(month), 1)) - dayNumber(firstOfMonth(month));
}

/**
 * The days of `month` inside the window (after, through] (a null `after` is open below).
 * `through < after` gives 0.
 */
export function monthDaysInWindow(
  month: IsoMonth,
  after: IsoDate | null,
  through: IsoDate,
): number {
  const start = dayNumber(firstOfMonth(month));
  const end = dayNumber(lastOfMonth(month));
  const lo = Math.max(start, after === null ? -Infinity : dayNumber(after) + 1);
  const hi = Math.min(end, dayNumber(through));
  return hi >= lo ? hi - lo + 1 : 0;
}

/** Σ of decimals (ZERO for none). */
export function sumDec(values: Iterable<Dec>): Dec {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
}

/** The flags present in `set`, in the canonical order of `all`. */
export function orderedFlags<T extends string>(all: readonly T[], set: ReadonlySet<T>): T[] {
  return all.filter((f) => set.has(f));
}

// ─── Chart grouping (§2.10) ────────────────────────────────────────────────────────────────────

/** A chart point before grouping: its period month, date and whether it is the live point. */
export interface ChartSource {
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
}

export interface ChartGroup<P extends ChartSource> {
  label: string;
  /** The group's points in period, date, input order. */
  points: P[];
  /** The group's last point (its period, date and live flag label the group). */
  last: P;
}

/**
 * compressSeries' grouping (stage-3.md §2.13) for the Stage 4 charts: points ordered by period
 * month, then date, then input order; grouped monthly by period month, by calendar quarter, or by
 * the financial year of their date (labelled `FY2025–26`, D52); the last `count` groups (null →
 * 12 monthly, 8 quarterly, all yearly).
 */
export function groupChart<P extends ChartSource>(
  points: readonly P[],
  unit: ChartDateUnit,
  count: number | null,
): ChartGroup<P>[] {
  const sorted = points
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        compareIso(a.p.period, b.p.period) || compareIso(a.p.date, b.p.date) || a.index - b.index,
    )
    .map((x) => x.p);
  const groups: { key: string; label: string; points: P[] }[] = [];
  for (const p of sorted) {
    const { key, label } = groupOf(p.period, p.date, unit, 'fy');
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.points.push(p);
    else groups.push({ key, label, points: [p] });
  }
  return keepLast(groups, unit, count).map((g) => ({
    label: g.label,
    points: g.points,
    last: g.points[g.points.length - 1]!,
  }));
}

/** Σ of the non-null values; null when every value is null (compressSeries' `sum`). */
export function sumOrNull(values: readonly (Cents | null)[]): Cents | null {
  let total: Cents | null = null;
  for (const v of values) if (v !== null) total = (total ?? 0) + v;
  return total;
}
