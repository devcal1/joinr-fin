// Periods, windows and years (stage-3.md §2.3), shared by the savings engine, the KPIs, side
// income and the charts. Snapshots are taken in run-date order; period i ≥ 1 is the window
// (run_{i−1}, run_i]; the first snapshot is the baseline; the provisional period is
// (lastRun, asOf] with the §2.3 month rule. Dated inputs after `asOf` belong to no period.
import {
  addMonthsIso,
  financialYearOfIso,
  isoMonthOf,
  monthEndOf,
  type ChartDateUnit,
  type IsoDate,
  type IsoMonth,
  type SavingsPeriodStatus,
  type YearBasis,
} from '@joinr/schema';
import { addDaysIso, dayNumber } from './num';
import type { YearWindow } from './types';

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * §2.3: the year containing `date`: `fy` → [YYYY-07-01, (YYYY+1)-07-01), year = the start year;
 * `calendar` → [YYYY-01-01, (YYYY+1)-01-01). Throws RangeError for a malformed date.
 */
export function yearWindow(date: IsoDate, basis: YearBasis): YearWindow {
  dayNumber(date); // a malformed or impossible date is a programmer error
  if (basis === 'fy') {
    const fy = financialYearOfIso(date);
    return { basis, start: `${pad(fy, 4)}-07-01`, end: `${pad(fy + 1, 4)}-07-01`, year: fy };
  }
  const year = Number(date.slice(0, 4));
  return { basis, start: `${pad(year, 4)}-01-01`, end: `${pad(year + 1, 4)}-01-01`, year };
}

/** A year's chart label: `FY2025–26` (an en dash) for a financial year, `2026` for a calendar year. */
export function yearLabel(w: YearWindow): string {
  return w.basis === 'fy' ? `FY${w.year}–${pad((w.year + 1) % 100, 2)}` : String(w.year);
}

/** True when `date` is in the half-open year window [start, end). */
export function inYear(date: IsoDate, w: YearWindow): boolean {
  return date >= w.start && date < w.end;
}

/**
 * Sheets DATEDIF(from, to, "M"): (ty − fy) × 12 + (tm − fm) − (td < fd ? 1 : 0). Negative when `to`
 * is earlier (callers clamp where the spec says max(1, …)).
 */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  dayNumber(from);
  dayNumber(to);
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const fd = Number(from.slice(8, 10));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  const td = Number(to.slice(8, 10));
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/** The month after `month` (`2026-12` → `2027-01`). */
export function nextMonth(month: IsoMonth): IsoMonth {
  return addMonthsIso(`${month}-01`, 1).slice(0, 7);
}

/** Snapshots in run-date order (ties: period month, then input order). Validates the dates. */
export function sortByRunDate<T extends { periodMonth: IsoMonth; runDate: IsoDate }>(
  snapshots: readonly T[],
): T[] {
  for (const s of snapshots) {
    dayNumber(s.runDate);
    dayNumber(`${s.periodMonth}-01`);
  }
  return snapshots
    .map((s, index) => ({ s, index }))
    .sort(
      (a, b) =>
        (a.s.runDate < b.s.runDate ? -1 : a.s.runDate > b.s.runDate ? 1 : 0) ||
        (a.s.periodMonth < b.s.periodMonth ? -1 : a.s.periodMonth > b.s.periodMonth ? 1 : 0) ||
        a.index - b.index,
    )
    .map((x) => x.s);
}

/**
 * stage-5.md §2.9: the month a record fills: the month after the latest snapshot's month (the
 * greatest period month, so a record never names a month at or before an existing one), or
 * `isoMonthOf(today)` without snapshots. Validates the dates.
 */
export function nextRecordMonth(
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth {
  dayNumber(today);
  let latest: IsoMonth | null = null;
  for (const s of snapshots) {
    monthLabel(s.periodMonth); // validates the month
    if (latest === null || s.periodMonth > latest) latest = s.periodMonth;
  }
  return latest === null ? isoMonthOf(today) : nextMonth(latest);
}

/**
 * The provisional period's month (stage-3.md §2.3, changed by stage-5.md §11 fix 9): the next month
 * to record (nextRecordMonth), so a missed month keeps its name until it is recorded. With no gap it
 * is asOf's month (or the month after when asOf's month is already recorded), as Stage 3.
 */
export function provisionalMonth(
  sorted: readonly { periodMonth: IsoMonth }[],
  asOf: IsoDate,
): IsoMonth {
  return nextRecordMonth(sorted, asOf);
}

/** One period of the §2.3 model: the window (after, through] and the snapshot it closes. */
export interface PeriodWindow<T> {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  /** Exclusive lower bound; null for the first period (the baseline). */
  after: IsoDate | null;
  /** Inclusive upper bound (the run date; the provisional period: asOf). */
  through: IsoDate;
  status: SavingsPeriodStatus;
  /** Null for the provisional period. */
  snapshot: T | null;
}

/**
 * The §2.3 periods of `snapshots` (sorted by run date): the first is the baseline, the rest closed,
 * plus the provisional period (lastRun, asOf] when `withProvisional`, a snapshot exists and
 * asOf > lastRun.
 */
export function periodWindows<T extends { periodMonth: IsoMonth; runDate: IsoDate }>(
  snapshots: readonly T[],
  asOf: IsoDate,
  withProvisional: boolean,
): PeriodWindow<T>[] {
  dayNumber(asOf);
  const sorted = sortByRunDate(snapshots);
  const out: PeriodWindow<T>[] = sorted.map((s, i) => ({
    periodMonth: s.periodMonth,
    runDate: s.runDate,
    after: i === 0 ? null : sorted[i - 1]!.runDate,
    through: s.runDate,
    status: i === 0 ? 'first' : 'closed',
    snapshot: s,
  }));
  const last = sorted[sorted.length - 1];
  if (withProvisional && last !== undefined && asOf > last.runDate) {
    out.push({
      periodMonth: provisionalMonth(sorted, asOf),
      runDate: asOf,
      after: last.runDate,
      through: asOf,
      status: 'provisional',
      snapshot: null,
    });
  }
  return out;
}

/**
 * The index of the period whose window holds `day` (a day number), or −1. The first period's
 * window starts at `firstStartDay` (inclusive; −Infinity for an open start); later windows are
 * (after, through]; days after `asOfDay` belong to no period.
 */
export function periodIndexOf(
  day: number,
  windows: readonly { after: IsoDate | null; through: IsoDate }[],
  asOfDay: number,
  firstStartDay = -Infinity,
): number {
  if (day > asOfDay || windows.length === 0 || day < firstStartDay) return -1;
  // Windows are contiguous and ascending: find the first whose `through` is on or after `day`.
  let lo = 0;
  let hi = windows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dayNumber(windows[mid]!.through) >= day) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (found < 0) return -1;
  const after = windows[found]!.after;
  return after === null || day > dayNumber(after) ? found : -1;
}

/** The first day of `date`'s month (Side Income E2 = F2 − DAY(F2) + 1). */
export function monthStart(date: IsoDate): IsoDate {
  dayNumber(date);
  return `${date.slice(0, 7)}-01`;
}

/** `date` + 1 day (a later side-income period starts the day after the previous run). */
export function dayAfter(date: IsoDate): IsoDate {
  return addDaysIso(date, 1);
}

// ─── Chart grouping (compressSeries and compressCashflow, stage-3.md §2.13) ────────────────────

const MONTH_LABELS = [
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

/** The template's compressTable defaults: 12 monthly, 8 quarterly, all yearly. */
export const DEFAULT_GROUP_COUNTS: Readonly<Record<ChartDateUnit, number | null>> = {
  monthly: 12,
  quarterly: 8,
  yearly: null,
};

/** `Aug 2026` for `2026-08`. */
export function monthLabel(period: IsoMonth): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) {
    throw new RangeError(`engine: expected a month written YYYY-MM: ${JSON.stringify(period)}`);
  }
  return `${MONTH_LABELS[month - 1]!} ${m[1]!}`;
}

/**
 * The chart group of a point: monthly by its period month, a calendar quarter of its period month
 * (FY quarters coincide with calendar quarters), or the year window on `basis` of its period
 * month's last day (stage-5.md §2.3, §11 fix 20, D29: a June recorded on 1 July stays in June's
 * year; the date still bounds nothing here). Every Stage 2 point's period is its date's month, so
 * the Stage 2 groups are unchanged.
 */
export function groupOf(
  period: IsoMonth,
  date: IsoDate,
  unit: ChartDateUnit,
  basis: YearBasis,
): { key: string; label: string } {
  const label = monthLabel(period); // validates the period
  const year = period.slice(0, 4);
  switch (unit) {
    case 'monthly':
      return { key: period, label };
    case 'quarterly': {
      const q = Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1;
      return { key: `${year}-Q${q}`, label: `Q${q} ${year}` };
    }
    case 'yearly': {
      dayNumber(date);
      const w = yearWindow(monthEndOf(period), basis);
      return { key: `${basis}:${w.year}`, label: yearLabel(w) };
    }
  }
}

/** The last `count` groups (null → the unit's default: 12 monthly, 8 quarterly, all yearly). */
export function keepLast<T>(groups: readonly T[], unit: ChartDateUnit, count: number | null): T[] {
  const n = count ?? DEFAULT_GROUP_COUNTS[unit];
  return n === null ? [...groups] : groups.slice(Math.max(0, groups.length - Math.max(0, n)));
}
