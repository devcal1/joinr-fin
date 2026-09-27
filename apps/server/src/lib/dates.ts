// Shared server date helpers (CODE-9, stage-6.md §4.5). Pure: the caller passes the clock's `now`.
//
// Calendar dates are `YYYY-MM-DD` strings. `localIsoDate` reads the server-local calendar date of
// an instant (Stage 7 sets TZ); the day arithmetic works on the date string in UTC, so a DST change
// in the server's zone never shifts a day.
import { monthEndOf, type IsoDate } from '@joinr/schema';

/** The last day of a month (`2028-02` → `2028-02-29`); RangeError on a malformed month. */
export { monthEndOf };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** The server-local calendar date of `d` (the as-of date rule every page shares). */
export function localIsoDate(d: Date): IsoDate {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/** `date` + `days` calendar days (UTC arithmetic on the date string); RangeError on bad input. */
export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const m = ISO_DATE_RE.exec(date);
  if (!m || !Number.isInteger(days)) throw new RangeError(`addDaysIso: bad input ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** The calendar day before `date`; RangeError on a malformed date. */
export function isoDayBefore(date: IsoDate): IsoDate {
  return addDaysIso(date, -1);
}
