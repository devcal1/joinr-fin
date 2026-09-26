// Stage 5 server constants for the History and Net Worth APIs (stage-5.md §4.1, §4.4, §4.5), and
// the month words the error messages use.
import type { IsoDate, IsoMonth } from '@joinr/schema';
import { displayDate } from '../investments/format';

/** The History page lists at most this many audit rows (newest first, §4.4). */
export const AUDIT_LIST_MAX = 200;

const MONTH_WORDS = [
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

/** `2027-03` → `Mar 2027` (STYLE_GUIDE §8). */
export function monthWords(month: IsoMonth): string {
  const m = Number(month.slice(5, 7));
  return `${MONTH_WORDS[m - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

// ─── Error messages (§4.1; safe to show to the client, never a figure) ───────────────────────────

/** 409 SNAPSHOT_EXISTS. */
export function snapshotExistsMessage(month: IsoMonth, runDate: IsoDate): string {
  return `${monthWords(month)} is already recorded (${displayDate(runDate)}). Correct it instead.`;
}

/** 409 SNAPSHOT_NOT_LATEST (D92). */
export const SNAPSHOT_NOT_LATEST_MESSAGE = 'Only the latest recorded month can be deleted';

/** 409 SNAPSHOT_NOT_DELETABLE (D92). */
export const SNAPSHOT_NOT_DELETABLE_MESSAGE = 'Imported months can be corrected but not deleted';

/** 404 for a month with no snapshot. */
export function snapshotNotFoundMessage(month: IsoMonth): string {
  return `${monthWords(month)} is not recorded`;
}

/** 400: a month outside `recordableMonths` (§4.5 step 1). */
export const NOT_RECORDABLE_MESSAGE =
  'cannot be recorded (only months after the latest recorded month, up to this month)';

/** 400: an offset extra named on a migrated row (§4.3). */
export const EXTRA_ON_MIGRATED_MESSAGE = 'not recorded for imported months';

/** 400: an offset extra cleared on a recorded row (§4.3). */
export const EXTRA_REQUIRED_MESSAGE = 'required';
