// Date helpers on ISO strings (stage-1.md §2.1, §4.2 rule 3, §5.6). Calendar dates never go
// through `new Date(string)`; serial dates use UTC arithmetic.
import type { IsoDate, IsoMonth } from './primitives';

const MS_PER_DAY = 86_400_000;
/** Day 0 of the 1900 date system as the sheets use it (Lotus leap-year bug included). */
const EPOCH_1900_MS = Date.UTC(1899, 11, 30);
const EPOCH_1904_MS = Date.UTC(1904, 0, 1);

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

function parts(date: IsoDate, fn: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`${fn}: expected YYYY-MM-DD, got ${JSON.stringify(date)}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function isoFromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

/** A spreadsheet serial date → `YYYY-MM-DD` (the time of day is dropped). */
export function excelSerialToIsoDate(serial: number, date1904 = false): IsoDate {
  if (!Number.isFinite(serial)) throw new RangeError(`excelSerialToIsoDate: not finite: ${serial}`);
  const epoch = date1904 ? EPOCH_1904_MS : EPOCH_1900_MS;
  return isoFromUtcMs(epoch + Math.floor(serial) * MS_PER_DAY);
}

/** `2026-02-17` → `2026-02`. */
export function isoMonthOf(date: IsoDate): IsoMonth {
  parts(date, 'isoMonthOf');
  return date.slice(0, 7);
}

/** EDATE semantics: add whole months and clamp the day (`2026-01-31` + 1 → `2026-02-28`). */
export function addMonthsIso(date: IsoDate, months: number): IsoDate {
  if (!Number.isInteger(months)) throw new RangeError(`addMonthsIso: months must be whole`);
  const { y, m, d } = parts(date, 'addMonthsIso');
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${pad(ny, 4)}-${pad(nm, 2)}-${pad(Math.min(d, lastDay), 2)}`;
}

/** Compares two ISO dates, months or timestamps of the same shape. */
export function compareIso(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The financial year (1 July – 30 June) a date falls in, as its starting year: 2026-07-01 → 2026. */
export function financialYearOfIso(date: IsoDate): number {
  const { y, m } = parts(date, 'financialYearOfIso');
  return m >= 7 ? y : y - 1;
}

/**
 * 00:00 local time on the most recent weekday (Mon–Fri) strictly before `now`'s calendar day:
 * Tue → Mon, Mon → the previous Fri, Sat/Sun → Fri. Public holidays are ignored (§5.6).
 */
export function previousWeekdayStart(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do {
    start.setDate(start.getDate() - 1);
  } while (start.getDay() === 0 || start.getDay() === 6);
  return start;
}
