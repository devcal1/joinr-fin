// Recording rules (stage-5.md §2.9, §7.3 step 5; D81, D82, D89, D94). Generic months only.
import { describe, expect, it } from 'vitest';
import { nextRecordMonth, recordableMonths, recordingsDue } from '../src/index';

const months = (...ms: string[]) => ms.map((periodMonth) => ({ periodMonth }));

describe('nextRecordMonth (§2.9)', () => {
  it("is today's month without snapshots", () => {
    expect(nextRecordMonth([], '2026-09-24')).toBe('2026-09');
  });

  it("is the month after the latest snapshot's month, across a year boundary", () => {
    expect(nextRecordMonth(months('2026-07', '2026-08'), '2026-09-24')).toBe('2026-09');
    expect(nextRecordMonth(months('2026-11', '2026-12'), '2027-01-05')).toBe('2027-01');
    // The latest month is the current month: the next month (not yet recordable).
    expect(nextRecordMonth(months('2026-08', '2026-09'), '2026-09-24')).toBe('2026-10');
    // A gap after the latest month: the first missing month.
    expect(nextRecordMonth(months('2026-05'), '2026-09-24')).toBe('2026-06');
    // The greatest month counts, whatever the input order.
    expect(nextRecordMonth(months('2026-08', '2026-06'), '2026-09-24')).toBe('2026-09');
  });

  it('refuses malformed dates and months', () => {
    expect(() => nextRecordMonth([], '2026-02-30')).toThrow(RangeError);
    expect(() => nextRecordMonth(months('2026-13'), '2026-09-24')).toThrow(RangeError);
  });
});

describe('recordableMonths (§2.9)', () => {
  it('lists every month from the next one through the current month', () => {
    expect(recordableMonths(months('2026-05'), '2026-09-24')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(recordableMonths(months('2026-08'), '2026-09-01')).toEqual(['2026-09']);
    expect(recordableMonths([], '2026-09-24')).toEqual(['2026-09']);
    expect(recordableMonths(months('2026-11'), '2027-01-31')).toEqual(['2026-12', '2027-01']);
  });

  it('is empty when the current month (or a later one) is recorded', () => {
    expect(recordableMonths(months('2026-08', '2026-09'), '2026-09-24')).toEqual([]);
    expect(recordableMonths(months('2026-10'), '2026-09-24')).toEqual([]);
  });
});

describe('recordingsDue (§2.9; D82, D94)', () => {
  const plan = (
    snapshots: readonly string[],
    today: string,
    recordTimeReached: boolean,
    autoRecordSince: string | null,
  ) =>
    recordingsDue({ snapshots: months(...snapshots), today, recordTimeReached, autoRecordSince });

  it('plans nothing while auto-record is off', () => {
    expect(plan(['2026-05'], '2026-09-30', true, null)).toEqual({ due: [], blocked: null });
  });

  it('records the current month on its last day only once the record time is reached (D89)', () => {
    // The last day before 23:00, and after.
    expect(plan(['2026-08'], '2026-09-30', false, '2026-09-01')).toEqual({
      due: [],
      blocked: null,
    });
    expect(plan(['2026-08'], '2026-09-30', true, '2026-09-01')).toEqual({
      due: [{ periodMonth: '2026-09', source: 'recorded' }],
      blocked: null,
    });
    // The day before the last day: never due, whatever the hour.
    expect(plan(['2026-08'], '2026-09-29', true, '2026-09-01')).toEqual({
      due: [],
      blocked: null,
    });
  });

  it('catches up every ended month since auto-record was switched on as late (D82)', () => {
    expect(plan(['2026-06'], '2026-09-05', false, '2026-07-01')).toEqual({
      due: [
        { periodMonth: '2026-07', source: 'late' },
        { periodMonth: '2026-08', source: 'late' },
      ],
      blocked: null,
    });
    // A month that ended on the day auto-record was switched on still counts (on or after).
    expect(plan(['2026-07'], '2026-09-05', false, '2026-08-31')).toEqual({
      due: [{ periodMonth: '2026-08', source: 'late' }],
      blocked: null,
    });
    // The missed months and the current month on its last day, in order.
    expect(plan(['2026-07'], '2026-09-30', true, '2026-08-15')).toEqual({
      due: [
        { periodMonth: '2026-08', source: 'late' },
        { periodMonth: '2026-09', source: 'recorded' },
      ],
      blocked: null,
    });
  });

  it('crosses a year boundary (December caught up in January)', () => {
    expect(plan(['2026-11'], '2027-01-02', false, '2026-12-01')).toEqual({
      due: [{ periodMonth: '2026-12', source: 'late' }],
      blocked: null,
    });
    expect(plan(['2026-11'], '2026-12-31', true, '2026-12-01')).toEqual({
      due: [{ periodMonth: '2026-12', source: 'recorded' }],
      blocked: null,
    });
  });

  it('never catches up a month that ended before auto-record was on, and blocks every later month (D94)', () => {
    // August ended before `since`: it is never due, and it blocks September's record.
    expect(plan(['2026-07'], '2026-09-30', true, '2026-09-10')).toEqual({
      due: [],
      blocked: { periodMonth: '2026-09', missing: ['2026-08'] },
    });
    // Two missing months block the late month after them too.
    expect(plan(['2026-05'], '2026-09-02', false, '2026-08-01')).toEqual({
      due: [],
      blocked: { periodMonth: '2026-08', missing: ['2026-06', '2026-07'] },
    });
    // Nothing would be due (mid-month): no block is reported.
    expect(plan(['2026-07'], '2026-09-20', false, '2026-09-10')).toEqual({
      due: [],
      blocked: null,
    });
    // Once the missing month is recorded, the plan runs again.
    expect(plan(['2026-07', '2026-08'], '2026-09-30', true, '2026-09-10')).toEqual({
      due: [{ periodMonth: '2026-09', source: 'recorded' }],
      blocked: null,
    });
  });

  it('plans nothing when the current month is already recorded', () => {
    expect(plan(['2026-08', '2026-09'], '2026-09-30', true, '2026-01-01')).toEqual({
      due: [],
      blocked: null,
    });
  });
});
