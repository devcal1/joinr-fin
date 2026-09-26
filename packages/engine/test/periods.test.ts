// Periods, windows and years (stage-3.md §2.3; §7.3 step 1). Generic dates only.
import { describe, expect, it } from 'vitest';
import { yearWindow } from '../src/index';
import { dayNumber } from '../src/num';
import {
  monthsBetween,
  periodIndexOf,
  periodWindows,
  provisionalMonth,
  sortByRunDate,
  yearLabel,
} from '../src/periods';

const snap = (periodMonth: string, runDate: string) => ({ periodMonth, runDate });

describe('yearWindow and its labels (§2.3, D52)', () => {
  it('gives the FY [1 July, 1 July) and the calendar year containing a date', () => {
    expect(yearWindow('2026-06-30', 'fy')).toEqual({
      basis: 'fy',
      start: '2025-07-01',
      end: '2026-07-01',
      year: 2025,
    });
    expect(yearWindow('2026-07-01', 'fy')).toMatchObject({ start: '2026-07-01', year: 2026 });
    expect(yearWindow('2026-12-31', 'calendar')).toEqual({
      basis: 'calendar',
      start: '2026-01-01',
      end: '2027-01-01',
      year: 2026,
    });
    expect(() => yearWindow('2026-02-30', 'fy')).toThrow(RangeError);
  });

  it('labels a financial year FY2025–26 (an en dash) and a calendar year 2026', () => {
    expect(yearLabel(yearWindow('2026-03-01', 'fy'))).toBe('FY2025–26');
    expect(yearLabel(yearWindow('2000-03-01', 'fy'))).toBe('FY1999–00');
    expect(yearLabel(yearWindow('2026-03-01', 'calendar'))).toBe('2026');
  });
});

describe('monthsBetween (DATEDIF "M")', () => {
  it('counts whole months, one less when the day of month has not been reached', () => {
    expect(monthsBetween('2026-01-15', '2026-02-15')).toBe(1);
    expect(monthsBetween('2026-01-15', '2026-02-14')).toBe(0);
    expect(monthsBetween('2026-01-31', '2026-02-28')).toBe(0);
    expect(monthsBetween('2026-01-31', '2026-03-01')).toBe(1);
    // To the end of a calendar year and of a financial year from a month end.
    expect(monthsBetween('2026-08-31', '2027-01-01')).toBe(4);
    expect(monthsBetween('2026-08-31', '2027-07-01')).toBe(10);
    expect(monthsBetween('2026-12-31', '2027-01-01')).toBe(0);
    expect(monthsBetween('2026-05-10', '2026-03-10')).toBe(-2);
  });
});

describe('periodWindows (§2.3)', () => {
  it('makes the first snapshot the baseline and later windows (previous run, run]', () => {
    // A mid-month first snapshot and a gap month (no February snapshot).
    const w = periodWindows(
      [snap('2026-03', '2026-03-31'), snap('2026-01', '2026-01-15')],
      '2026-03-31',
      true,
    );
    expect(w.map((p) => [p.periodMonth, p.after, p.through, p.status])).toEqual([
      ['2026-01', null, '2026-01-15', 'first'],
      ['2026-03', '2026-01-15', '2026-03-31', 'closed'],
    ]);
  });

  it('adds the provisional period (last run, asOf] only after the last run', () => {
    const snaps = [snap('2026-07', '2026-07-31'), snap('2026-08', '2026-08-31')];
    const w = periodWindows(snaps, '2026-09-24', true);
    expect(w.at(-1)).toEqual({
      periodMonth: '2026-09',
      runDate: '2026-09-24',
      after: '2026-08-31',
      through: '2026-09-24',
      status: 'provisional',
      snapshot: null,
    });
    expect(periodWindows(snaps, '2026-08-31', true)).toHaveLength(2);
    expect(periodWindows(snaps, '2026-09-24', false)).toHaveLength(2);
    expect(periodWindows([], '2026-09-24', true)).toEqual([]);
  });

  it("names the provisional period after the latest snapshot's month when asOf's month is recorded", () => {
    const snaps = sortByRunDate([snap('2026-09', '2026-09-10'), snap('2026-08', '2026-08-31')]);
    expect(provisionalMonth(snaps, '2026-09-24')).toBe('2026-10');
    expect(provisionalMonth(snaps.slice(0, 1), '2026-09-24')).toBe('2026-09');
    expect(periodWindows(snaps, '2026-09-24', true).at(-1)!.periodMonth).toBe('2026-10');
    expect(provisionalMonth([snap('2026-12', '2026-12-05')], '2026-12-20')).toBe('2027-01');
  });

  it('buckets a day into the window that holds it; after asOf or before the start is outside', () => {
    const w = periodWindows(
      [snap('2026-01', '2026-01-15'), snap('2026-02', '2026-02-15')],
      '2026-03-10',
      true,
    );
    const at = (date: string, start = -Infinity) =>
      periodIndexOf(dayNumber(date), w, dayNumber('2026-03-10'), start);
    expect(at('2025-12-01')).toBe(0); // the baseline's window is open below
    expect(at('2026-01-15')).toBe(0);
    expect(at('2026-01-16')).toBe(1);
    expect(at('2026-02-15')).toBe(1);
    expect(at('2026-02-16')).toBe(2);
    expect(at('2026-03-10')).toBe(2);
    expect(at('2026-03-11')).toBe(-1);
    expect(at('2025-12-31', dayNumber('2026-01-01'))).toBe(-1);
  });
});
