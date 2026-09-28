// Reading an `rsync --list-only` listing (stage-8.md §5.6, frozen line pattern; pure).
//
// Only regular files (a mode starting `-`) are read; directories, symlinks, devices, fifos,
// sockets, a daemon's message of the day and anything else are skipped. The name is the WHOLE
// remainder after the time and one space (never "the last field": `copy of nightly-….db` is not
// the backup `nightly-….db`), kept only when it passes the backup-name rule. A name listed twice
// gets size NaN: unreadable, so it is sent again and proved (the safe direction).
import { parseBackupName } from '../backups/names';

export interface RemoteFile {
  name: string;
  /** NaN when unreadable (a duplicated name). */
  bytes: number;
}

/** The anchored regular-file line (§5.6, frozen). */
export const LISTING_LINE_RE =
  /^(-[rwxsStT-]{9})[.+@]?\s+([\d,]+)\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s(.+)$/;

/** The backup-named regular files of a listing, each name once. */
export function parseListing(text: string): RemoteFile[] {
  const byName = new Map<string, number>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const m = LISTING_LINE_RE.exec(line);
    if (m === null) continue;
    const name = m[5] ?? '';
    if (parseBackupName(name) === null) continue;
    const digits = (m[2] ?? '').replace(/,/g, '');
    const bytes = digits === '' ? NaN : Number(digits);
    byName.set(name, byName.has(name) ? NaN : bytes);
  }
  return [...byName].map(([name, bytes]) => ({ name, bytes }));
}
