// The `closes` job's timer instants (stage-10.md §5.7). Pure: the instant and the server's IANA zone
// are passed in; every wall time is read through Intl (`wallTimeInZone`, `zonedTimeToEpoch`), never
// the process TZ, so the daily 16:52 holds across both DST changes.
//
// Why 16:52: every bar dated yesterday in its own zone is final by then (New York's previous day ends
// by 16:00 Melbourne in AEDT, London's by 11:00); today's ASX bar is excluded by the §5.2 filter and
// stored the next day; and minute 52 is off the 15-minute grid on which the intraday crypto and
// bullion slots fire (mark + 20 s), so the daily run never starts inside an intraday burst.
import {
  CLOSES_FOLLOW_UP_MS,
  CLOSES_RUN_AT,
  CLOSES_SLOT_MINUTE_OFFSET,
  dateInZone,
  wallTimeInZone,
} from '@joinr/schema';
import { addDaysIso } from '../../lib/dates';
import { zonedTimeToEpoch } from '../day';
import { nextSlot, scopesForSlot } from '../intraday/schedule';

const MINUTE_MS = 60_000;

/** The next 16:52 (CLOSES_RUN_AT) in `timeZone` strictly after `nowMs`; null for an unknown zone. */
export function nextDailyRunMs(nowMs: number, timeZone: string): number | null {
  const today = dateInZone(nowMs, timeZone);
  if (today === null) return null;
  for (let i = 0; i < 3; i += 1) {
    const at = zonedTimeToEpoch(
      addDaysIso(today, i),
      CLOSES_RUN_AT.hour,
      CLOSES_RUN_AT.minute,
      timeZone,
    );
    if (at !== null && at > nowMs) return at;
  }
  return null;
}

/**
 * A follow-up's instant (§5.7): at least CLOSES_FOLLOW_UP_MS after `endMs`, snapped forward to the
 * next whole minute whose wall minute in `timeZone` satisfies `minute % 15 === 7` (xx:07, xx:22,
 * xx:37, xx:52), off the intraday grid.
 */
export function followUpAtMs(endMs: number, timeZone: string): number {
  let t = Math.ceil((endMs + CLOSES_FOLLOW_UP_MS) / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i < 60; i += 1) {
    const w = wallTimeInZone(t, timeZone);
    if (w !== null && w.minute % 15 === CLOSES_SLOT_MINUTE_OFFSET) return t;
    t += MINUTE_MS;
  }
  return t;
}

/** When the next intraday crypto slot fires (a 15-minute mark + 20 s) strictly after `nowMs`. */
export function nextCryptoSlotFireMs(nowMs: number, timeZone: string): number {
  let t = nowMs;
  for (let i = 0; i < 12; i += 1) {
    const slot = nextSlot(t);
    if (scopesForSlot(slot.slotMs, timeZone, false).crypto) return slot.fireAtMs;
    t = slot.fireAtMs;
  }
  return nextSlot(nowMs).fireAtMs;
}
