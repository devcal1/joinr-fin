// Backup file names (stage-7.md §5.2): `<kind>-YYYYMMDD-HHmmss±HHMM[-n].db` in server-local time
// with its UTC offset, so every name sorts and parses to one instant (the two 02:30s of the April
// change get different names). The Stage 1 form `pre-import-YYYYMMDD-HHmmss[-n].db` (no offset)
// still parses: as local time, the earlier instant when the wall time is ambiguous.
//
// The local date and month of a file are the ones written in its name, never a re-computation in
// the process's zone, so retention does not depend on the process TZ.
import {
  BACKUP_DOWNLOAD_PREFIX,
  BACKUP_FILE_NAME_MAX,
  BACKUP_FILE_NAME_RE,
  type BackupKind,
} from '@joinr/schema';

/** The flat backups folder inside DATA_DIR (the Stage 1 folder). */
export const BACKUPS_DIR_NAME = 'backups';

/** The largest same-second suffix the name rule accepts (`-2` … `-999`). */
export const MAX_NAME_SUFFIX = 999;

export interface ParsedBackupName {
  name: string;
  kind: BackupKind;
  /** The instant the name stands for. */
  instant: Date;
  /** `YYYYMMDD` as written in the name (the server-local date when the copy was made). */
  localDate: string;
  /** `YYYYMM` as written in the name. */
  localMonth: string;
  /** Minutes east of UTC, as written; null for the legacy offset-less pre-import form. */
  offsetMinutes: number | null;
  /** 1 without a suffix, else the `-n` value. */
  suffix: number;
  /** The instant written with its offset: `YYYY-MM-DDTHH:mm:ss±HH:MM` (the DTO's createdAt). */
  createdAt: string;
}

const PARSE_RE =
  /^(nightly|manual|pre-import|pre-restore|pre-migrate)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:([+-])(\d{2})(\d{2}))?(?:-(\d{1,3}))?\.db$/;

const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `+HH:MM` / `-HH:MM` for an offset in minutes east of UTC. */
function isoOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** A Date → local `YYYY-MM-DDTHH:mm:ss±HH:MM` in the process zone. */
export function localIsoWithOffset(d: Date): string {
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    isoOffset(-d.getTimezoneOffset())
  );
}

/** The process-local calendar date of `d` as `YYYYMMDD`. */
export function localCompactDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** True when the local wall time of `d` is exactly these fields. */
function wallTimeIs(d: Date, f: readonly number[]): boolean {
  return (
    d.getFullYear() === f[0] &&
    d.getMonth() + 1 === f[1] &&
    d.getDate() === f[2] &&
    d.getHours() === f[3] &&
    d.getMinutes() === f[4] &&
    d.getSeconds() === f[5]
  );
}

/**
 * Parses a backup file name, or returns null when it breaks the name rule (the schema regex, at
 * most 64 characters, a real calendar date and time, an offset within ±14:59).
 */
export function parseBackupName(name: string): ParsedBackupName | null {
  if (name.length > BACKUP_FILE_NAME_MAX || !BACKUP_FILE_NAME_RE.test(name)) return null;
  const m = PARSE_RE.exec(name);
  if (!m) return null;
  const kind = m[1] as BackupKind;
  const [year, month, day, hour, minute, second] = [2, 3, 4, 5, 6, 7].map((i) => Number(m[i]));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const suffix = m[11] === undefined ? 1 : Number(m[11]);
  const localDate = `${m[2]}${m[3]}${m[4]}`;
  const wall = `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}`;

  if (m[8] !== undefined) {
    const offHours = Number(m[9]);
    const offMinutes = Number(m[10]);
    if (offHours > 14 || offMinutes > 59) return null;
    const offsetMinutes = (m[8] === '-' ? -1 : 1) * (offHours * 60 + offMinutes);
    const instant = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000,
    );
    return {
      name,
      kind,
      instant,
      localDate,
      localMonth: localDate.slice(0, 6),
      offsetMinutes,
      suffix,
      createdAt: `${wall}${isoOffset(offsetMinutes)}`,
    };
  }

  // The legacy Stage 1 form (pre-import only, the regex guarantees it): local time in the process
  // zone. JavaScript resolves a skipped wall time forwards; an ambiguous one is resolved here to
  // the earlier instant explicitly (the only place that rule applies).
  const fields = [year, month, day, hour, minute, second];
  let instant = new Date(year, month - 1, day, hour, minute, second);
  const earlier = new Date(instant.getTime() - 3_600_000);
  if (wallTimeIs(earlier, fields)) instant = earlier;
  return {
    name,
    kind,
    instant,
    localDate,
    localMonth: localDate.slice(0, 6),
    offsetMinutes: null,
    suffix,
    createdAt: localIsoWithOffset(instant),
  };
}

/** True for a name the app writes or lists. */
export function isBackupFileName(name: string): boolean {
  return parseBackupName(name) !== null;
}

/** `<kind>-YYYYMMDD-HHmmss±HHMM.db` for `at` in the process zone (every kind, pre-import included). */
export function formatBackupName(kind: BackupKind, at: Date, suffix = 1): string {
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const stamp =
    `${localCompactDate(at)}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  return `${kind}-${stamp}${suffix > 1 ? `-${suffix}` : ''}.db`;
}

/**
 * The name for a new `kind` copy at `at` that `taken` does not hold yet: `-2`, `-3`, … when that
 * second already has one (as Stage 1). Throws when every suffix is taken.
 */
export function nextFreeBackupName(
  kind: BackupKind,
  at: Date,
  taken: (name: string) => boolean,
): string {
  for (let suffix = 1; suffix <= MAX_NAME_SUFFIX; suffix++) {
    const name = formatBackupName(kind, at, suffix);
    if (!taken(name) && !taken(`.${name}.partial`)) return name;
  }
  throw new Error('Too many backups in the same second');
}

/** Oldest first: by the parsed instant, then the suffix. */
export function compareBackupNames(a: ParsedBackupName, b: ParsedBackupName): number {
  return a.instant.getTime() - b.instant.getTime() || a.suffix - b.suffix;
}

/** Strips a leading `joinr-finance-` (a downloaded file's name) when the rest is a backup name. */
export function stripDownloadPrefix(name: string): string {
  if (!name.startsWith(BACKUP_DOWNLOAD_PREFIX)) return name;
  const rest = name.slice(BACKUP_DOWNLOAD_PREFIX.length);
  return isBackupFileName(rest) ? rest : name;
}
