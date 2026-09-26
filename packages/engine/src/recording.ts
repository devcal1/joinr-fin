// Recording rules (stage-5.md §2.9; D81, D82, D94): which month a record fills, which months can be
// recorded, and which the scheduler should record now. Pure: `today` and the record-hour flag are
// inputs (the server's local clock decides them, §4.6).
import { isoMonthOf, monthEndOf, type IsoDate, type IsoMonth } from '@joinr/schema';
import { dayNumber } from './num';
import { nextMonth, nextRecordMonth } from './periods';
import type { RecordingDue, RecordingPlan } from './types';

export { nextRecordMonth };

/**
 * Every month from `nextRecordMonth` through `today`'s month, in order; empty when the latest
 * snapshot's month is the current month or later (a month before the latest snapshot can never be
 * recorded: its run date would sort after later months).
 */
export function recordableMonths(
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth[] {
  const current = isoMonthOf(today);
  const out: IsoMonth[] = [];
  for (let m = nextRecordMonth(snapshots, today); m <= current; m = nextMonth(m)) out.push(m);
  return out;
}

/**
 * The scheduler's plan (§2.9). Off (`autoRecordSince` null) → nothing. A recordable month that ended
 * before `today` is due `late` when it ended on or after `autoRecordSince` (D82); the current month
 * is due `recorded` on its last day once the record time is reached. A recordable month that ended
 * before `autoRecordSince` is never due, and while one is missing nothing is due at all: `blocked`
 * names the first month that would have been due and the missing months (D94).
 */
export function recordingsDue(i: {
  snapshots: readonly { periodMonth: IsoMonth }[];
  today: IsoDate;
  recordTimeReached: boolean;
  autoRecordSince: IsoDate | null;
}): RecordingPlan {
  dayNumber(i.today);
  if (i.autoRecordSince === null) return { due: [], blocked: null };
  const since = i.autoRecordSince;
  dayNumber(since);
  const current = isoMonthOf(i.today);
  const wouldBeDue: RecordingDue[] = [];
  const missing: IsoMonth[] = [];
  for (const m of recordableMonths(i.snapshots, i.today)) {
    const end = monthEndOf(m);
    if (end < i.today) {
      if (end >= since) wouldBeDue.push({ periodMonth: m, source: 'late' });
      else missing.push(m);
    } else if (m === current && end === i.today && i.recordTimeReached) {
      wouldBeDue.push({ periodMonth: m, source: 'recorded' });
    }
  }
  if (wouldBeDue.length === 0) return { due: [], blocked: null };
  if (missing.length > 0) {
    return { due: [], blocked: { periodMonth: wouldBeDue[0]!.periodMonth, missing } };
  }
  return { due: wouldBeDue, blocked: null };
}
