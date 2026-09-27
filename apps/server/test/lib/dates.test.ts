// CODE-9 (stage-6.md §4.5, §7.7 step 4): the shared server date helpers at month, year, leap-day and
// DST boundaries. The file pins Sydney time before its first Date, so the local date rule meets a
// real zone with daylight saving (it starts on the first Sunday of October and ends on the first
// Sunday of April).
process.env.TZ = 'Australia/Sydney';

import { describe, expect, it } from 'vitest';
import { addDaysIso, isoDayBefore, localIsoDate, monthEndOf } from '../../src/lib/dates';
import { localIsoDate as formatLocalIsoDate } from '../../src/investments/format';
import {
  addDaysIso as fxAddDaysIso,
  localIsoDate as fxLocalIsoDate,
} from '../../src/market/fxHistory';

describe('the pinned zone', () => {
  it('is Sydney: +11:00 in summer, +10:00 in winter', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-660);
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-600);
  });
});

describe('localIsoDate', () => {
  it('reads the server-local calendar date, not the UTC one', () => {
    expect(localIsoDate(new Date(2026, 5, 13, 23, 59))).toBe('2026-06-13');
    expect(localIsoDate(new Date(2026, 5, 14, 0, 0))).toBe('2026-06-14');
    // 13:30 UTC on 31 December is 00:30 on 1 January in Sydney (daylight time).
    expect(localIsoDate(new Date(Date.UTC(2026, 11, 31, 13, 30)))).toBe('2027-01-01');
    // 14:30 UTC on 30 June is 00:30 on 1 July in Sydney (standard time): the FY boundary.
    expect(localIsoDate(new Date(Date.UTC(2026, 5, 30, 14, 30)))).toBe('2026-07-01');
  });

  it('handles month and year ends', () => {
    expect(localIsoDate(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31');
    expect(localIsoDate(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
    expect(localIsoDate(new Date(2026, 3, 30, 23, 59))).toBe('2026-04-30');
    expect(localIsoDate(new Date(2028, 1, 29, 12, 0))).toBe('2028-02-29');
  });

  it('keeps the calendar day across the DST changes of April and October', () => {
    // Daylight saving ends at 03:00 on Sunday 5 April 2026 (the 02:00–03:00 hour repeats).
    expect(localIsoDate(new Date(2026, 3, 5, 0, 30))).toBe('2026-04-05');
    expect(localIsoDate(new Date(2026, 3, 5, 2, 30))).toBe('2026-04-05');
    expect(localIsoDate(new Date(2026, 3, 5, 23, 59))).toBe('2026-04-05');
    expect(localIsoDate(new Date(Date.UTC(2026, 3, 4, 13, 30)))).toBe('2026-04-05'); // 00:30 AEDT
    // Daylight saving starts at 02:00 on Sunday 4 October 2026 (the clock skips to 03:00).
    expect(localIsoDate(new Date(2026, 9, 4, 0, 30))).toBe('2026-10-04');
    expect(localIsoDate(new Date(2026, 9, 4, 3, 30))).toBe('2026-10-04');
    expect(localIsoDate(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04');
    expect(localIsoDate(new Date(Date.UTC(2026, 9, 3, 14, 30)))).toBe('2026-10-04'); // 00:30 AEST
  });

  it('pads the year and is the helper the investments and FX modules re-export', () => {
    expect(localIsoDate(new Date(999, 0, 2, 12))).toBe('0999-01-02');
    expect(formatLocalIsoDate).toBe(localIsoDate);
    expect(fxLocalIsoDate).toBe(localIsoDate);
  });
});

describe('addDaysIso and isoDayBefore', () => {
  it('step over month and year ends', () => {
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysIso('2026-01-05', -10)).toBe('2025-12-26');
    expect(addDaysIso('2026-03-01', -365)).toBe('2025-03-01');
    expect(addDaysIso('2026-06-13', 0)).toBe('2026-06-13');
    expect(isoDayBefore('2027-01-01')).toBe('2026-12-31');
    expect(isoDayBefore('2026-03-01')).toBe('2026-02-28');
  });

  it('know leap days (the 400-year rule too)', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDaysIso('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysIso('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDaysIso('2000-02-28', 1)).toBe('2000-02-29');
    expect(isoDayBefore('2028-03-01')).toBe('2028-02-29');
    expect(addDaysIso('2028-02-29', 366)).toBe('2029-03-01');
  });

  it('count whole calendar days across the DST days (never 23- or 25-hour days)', () => {
    // Local midnight minus 24 hours lands on the wrong day around the October change…
    const afterStart = new Date(2026, 9, 5).getTime();
    expect(localIsoDate(new Date(afterStart - 86_400_000))).toBe('2026-10-03');
    // …while the string arithmetic does not.
    expect(isoDayBefore('2026-10-05')).toBe('2026-10-04');
    expect(addDaysIso('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDaysIso('2026-10-03', 2)).toBe('2026-10-05');
    expect(addDaysIso('2026-04-04', 1)).toBe('2026-04-05');
    expect(addDaysIso('2026-04-06', -2)).toBe('2026-04-04');
    expect(isoDayBefore('2026-04-06')).toBe('2026-04-05');
  });

  it('reject malformed input with a RangeError', () => {
    expect(() => addDaysIso('13/06/2026', 1)).toThrow(RangeError);
    expect(() => addDaysIso('2026-6-1', 1)).toThrow(RangeError);
    expect(() => addDaysIso('2026-06-01', 1.5)).toThrow(RangeError);
    expect(() => addDaysIso('2026-06-01', Number.NaN)).toThrow(RangeError);
    expect(() => isoDayBefore('')).toThrow(RangeError);
  });

  it('is the helper the FX module re-exports', () => {
    expect(fxAddDaysIso).toBe(addDaysIso);
  });
});

describe('monthEndOf (re-exported from the schema)', () => {
  it('gives the last day of each month', () => {
    expect(monthEndOf('2026-01')).toBe('2026-01-31');
    expect(monthEndOf('2026-04')).toBe('2026-04-30');
    expect(monthEndOf('2026-06')).toBe('2026-06-30');
    expect(monthEndOf('2026-12')).toBe('2026-12-31');
    expect(monthEndOf('2027-02')).toBe('2027-02-28');
    expect(monthEndOf('2028-02')).toBe('2028-02-29');
    expect(monthEndOf('2100-02')).toBe('2100-02-28');
    expect(monthEndOf('2000-02')).toBe('2000-02-29');
  });

  it('agrees with the day before the next month starts', () => {
    for (let m = 1; m <= 12; m++) {
      const month = `2028-${String(m).padStart(2, '0')}`;
      const next = m === 12 ? '2029-01-01' : `2028-${String(m + 1).padStart(2, '0')}-01`;
      expect(monthEndOf(month)).toBe(isoDayBefore(next));
    }
  });

  it('rejects a malformed month', () => {
    expect(() => monthEndOf('2026-13')).toThrow(RangeError);
    expect(() => monthEndOf('2026-1')).toThrow(RangeError);
  });
});
