// The recorder's pure planning (stage-5.md §4.6 item 4, §7.5 item 2): the record time at 23:00
// (D89), the wake-up rules, the 6 h cap, the retry time, the blocked report (D94) and the DST
// changes in April and October, all in the owner's zone.
process.env.TZ = 'Australia/Sydney';

import { engine } from '@joinr/engine';
import type { IsoDate, IsoMonth } from '@joinr/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  localIsoWithOffset,
  nextMonthEndRecordTime,
  planNext,
  recordTimeReachedAt,
  SNAPSHOT_RETRY_MS,
  SNAPSHOT_WAKE_MAX_MS,
  type PlanState,
} from '../../src/history/recorder';
import { local, refRecordingsDue } from './helpers';

const HOUR = 3_600_000;

function state(over: Partial<PlanState> = {}): PlanState {
  return {
    snapshots: [{ periodMonth: '2026-08' }],
    enabled: true,
    since: '2026-08-15',
    retryAt: null,
    reportedBlocked: null,
    recordingsDue: refRecordingsDue,
    ...over,
  };
}

describe('the record time (23:00 on the last day, D89)', () => {
  it('is reached at 23:00 on the last day, not at 22:59 nor the day before', () => {
    expect(recordTimeReachedAt(local(2026, 9, 30, 22, 59, 59))).toBe(false);
    expect(recordTimeReachedAt(local(2026, 9, 30, 23, 0))).toBe(true);
    expect(recordTimeReachedAt(local(2026, 9, 30, 23, 59))).toBe(true);
    expect(recordTimeReachedAt(local(2026, 9, 29, 23, 30))).toBe(false);
    expect(recordTimeReachedAt(local(2027, 2, 28, 23, 0))).toBe(true); // February
    expect(recordTimeReachedAt(local(2028, 2, 28, 23, 0))).toBe(false); // leap year
  });

  it('names the next month end, across December', () => {
    expect(nextMonthEndRecordTime(local(2026, 9, 30, 22, 59))).toEqual(local(2026, 9, 30, 23));
    expect(nextMonthEndRecordTime(local(2026, 9, 30, 23))).toEqual(local(2026, 10, 31, 23));
    expect(nextMonthEndRecordTime(local(2026, 12, 31, 23, 30))).toEqual(local(2027, 1, 31, 23));
  });

  it('formats local times with the offset (standard and daylight time)', () => {
    expect(localIsoWithOffset(local(2026, 6, 30, 23))).toBe('2026-06-30T23:00:00+10:00');
    expect(localIsoWithOffset(local(2026, 12, 31, 23))).toBe('2026-12-31T23:00:00+11:00');
  });
});

describe('planNext', () => {
  it('does nothing while auto-record is off (no timer, no engine call)', () => {
    const due = vi.fn(refRecordingsDue);
    const r = planNext(local(2026, 9, 30, 23, 30), state({ enabled: false, recordingsDue: due }));
    expect(r).toMatchObject({ runNow: false, wakeAt: null, nextRunAt: null });
    expect(r.plan).toEqual({ due: [], blocked: null });
    expect(due).not.toHaveBeenCalled();
  });

  it('wakes at 23:00 on the last day and runs then (22:59 → not yet)', () => {
    const before = planNext(local(2026, 9, 30, 22, 59), state());
    expect(before.runNow).toBe(false);
    expect(before.plan.due).toEqual([]);
    expect(before.wakeAt).toEqual(local(2026, 9, 30, 23));
    expect(before.nextRunAt).toEqual(local(2026, 9, 30, 23));

    const at = planNext(local(2026, 9, 30, 23), state());
    expect(at.recordTimeReached).toBe(true);
    expect(at.plan.due).toEqual([{ periodMonth: '2026-09', source: 'recorded' }]);
    expect(at.runNow).toBe(true);
    expect(at.wakeAt).toEqual(local(2026, 9, 30, 23));
    expect(at.nextRunAt).toEqual(local(2026, 10, 31, 23));
  });

  it('is not due the day before at 23:30 and never sleeps longer than 6 h', () => {
    const r = planNext(local(2026, 9, 29, 23, 30), state());
    expect(r.runNow).toBe(false);
    expect(r.wakeAt!.getTime() - local(2026, 9, 29, 23, 30).getTime()).toBe(SNAPSHOT_WAKE_MAX_MS);
    const early = planNext(local(2026, 9, 1, 8), state());
    expect(early.wakeAt!.getTime() - local(2026, 9, 1, 8).getTime()).toBe(6 * HOUR);
  });

  it('runs at once for missed months (late) and holds a retry time after a failure', () => {
    const now = local(2026, 10, 2, 9);
    expect(planNext(now, state()).plan.due).toEqual([{ periodMonth: '2026-09', source: 'late' }]);
    expect(planNext(now, state()).runNow).toBe(true);

    const retryAt = new Date(now.getTime() + SNAPSHOT_RETRY_MS);
    const waiting = planNext(now, state({ retryAt }));
    expect(waiting.runNow).toBe(false);
    expect(waiting.wakeAt).toEqual(retryAt);
    const retried = planNext(retryAt, state({ retryAt }));
    expect(retried.runNow).toBe(true);
  });

  it('reports a blocked month once (D94)', () => {
    // Aug ended before `since` (missing, never due) and Sep is due at its record time.
    const s = state({ snapshots: [{ periodMonth: '2026-07' }], since: '2026-09-05' });
    const r = planNext(local(2026, 9, 30, 23), s);
    expect(r.plan).toEqual({
      due: [],
      blocked: { periodMonth: '2026-09', missing: ['2026-08'] },
    });
    expect(r.runNow).toBe(true);
    const again = planNext(local(2026, 9, 30, 23), { ...s, reportedBlocked: '2026-09' });
    expect(again.runNow).toBe(false);
    expect(again.wakeAt).toEqual(local(2026, 10, 1, 5)); // 6 h later
  });

  it.each([
    // [label, start, month end, offset]
    [
      'October (daylight time starts 04/10)',
      local(2026, 10, 3, 22),
      local(2026, 10, 31, 23),
      '+11:00',
    ],
    ['April (daylight time ends 05/04)', local(2026, 4, 4, 20), local(2026, 4, 30, 23), '+10:00'],
  ] as const)('wakes at 23:00 local across the DST change in %s', (_label, start, end, offset) => {
    const s = state({ snapshots: [{ periodMonth: addPrev(end) }], since: '2026-01-01' });
    let t = start;
    let wakes = 0;
    for (;;) {
      const r = planNext(t, s);
      if (r.runNow) break;
      const next = r.wakeAt!;
      expect(next.getTime() - t.getTime()).toBeGreaterThan(0);
      expect(next.getTime() - t.getTime()).toBeLessThanOrEqual(SNAPSHOT_WAKE_MAX_MS);
      t = next;
      wakes += 1;
      expect(wakes).toBeLessThan(200);
    }
    expect(t).toEqual(end);
    expect(t.getHours()).toBe(23);
    expect(localIsoWithOffset(t)).toBe(`${isoDate(end)}T23:00:00${offset}`);
  });
});

/** The engine's recording rules exist (the Scaffolder's stubs throw 'engine: not implemented'). */
function engineRecordingImplemented(): boolean {
  try {
    engine.recordingsDue({
      snapshots: [],
      today: '2026-09-30',
      recordTimeReached: false,
      autoRecordSince: null,
    });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!engineRecordingImplemented())('the reference rule agrees with the engine', () => {
  const cases: {
    snapshots: IsoMonth[];
    today: IsoDate;
    reached: boolean;
    since: IsoDate | null;
  }[] = [
    { snapshots: ['2026-08'], today: '2026-09-30', reached: true, since: '2026-08-15' },
    { snapshots: ['2026-08'], today: '2026-09-30', reached: false, since: '2026-08-15' },
    { snapshots: ['2026-07'], today: '2026-10-02', reached: false, since: '2026-07-15' },
    { snapshots: ['2026-07'], today: '2026-09-30', reached: true, since: '2026-09-05' },
    { snapshots: ['2026-11'], today: '2027-01-31', reached: true, since: '2026-10-01' },
    { snapshots: [], today: '2026-09-30', reached: true, since: '2026-09-01' },
    { snapshots: ['2026-09'], today: '2026-09-30', reached: true, since: '2026-09-01' },
    { snapshots: ['2026-08'], today: '2026-09-30', reached: true, since: null },
  ];
  it.each(cases)('%o', (c) => {
    const input = {
      snapshots: c.snapshots.map((periodMonth) => ({ periodMonth })),
      today: c.today,
      recordTimeReached: c.reached,
      autoRecordSince: c.since,
    };
    expect(engine.recordingsDue(input)).toEqual(refRecordingsDue(input));
  });
});

function isoDate(d: Date): string {
  return localIsoWithOffset(d).slice(0, 10);
}

/** The month before a month end's month. */
function addPrev(end: Date): IsoMonth {
  const d = new Date(end.getFullYear(), end.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
