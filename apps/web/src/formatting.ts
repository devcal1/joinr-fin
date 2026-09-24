// App-level display helpers on top of the @joinr/ui formatters (STYLE_GUIDE §8).
import { MINUS, formatDate, formatTime, isIsoDate, toIsoDate } from '@joinr/ui';

/** An ISO-8601 timestamp as a Date, or null when it does not parse. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A timestamp → `24/09/2026 14:32` (local time). A bare IsoDate → `24/09/2026`. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  if (isIsoDate(value)) return formatDate(value);
  const date = parseTimestamp(value);
  return date ? `${formatDate(date)} ${formatTime(date)}` : value;
}

/** True when both instants fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

/** `14:32` when the timestamp is today (local), otherwise `24/09/2026`. */
export function formatTimeOrDate(value: string | null | undefined, now: Date): string | null {
  const date = parseTimestamp(value);
  if (!date) return null;
  return isSameLocalDay(date, now) ? formatTime(date) : formatDate(date);
}

/** `14:32` today, otherwise `24/09/2026 14:32`. */
export function formatTimeOrDateTime(value: string | null | undefined, now: Date): string | null {
  const date = parseTimestamp(value);
  if (!date) return null;
  return isSameLocalDay(date, now) ? formatTime(date) : `${formatDate(date)} ${formatTime(date)}`;
}

/** An integer with en-AU grouping and a U+2212 minus: -1234 → "−1,234" (STYLE_GUIDE §8). */
export function formatCount(value: number): string {
  return value.toLocaleString('en-AU').replace(/^-/, MINUS);
}

/** 1 → "1 row", 1234 → "1,234 rows". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`;
}

/** A file size in bytes → `1.8 MB` (decimal megabytes, one decimal). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
