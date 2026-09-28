// Backup retention (stage-7.md §5.3, D115): pure. One set per kind, never another kind's.
//
// nightly: the newest copy of each local date (as written in the name); the copies of the 14
// newest dates that have one (not the 14 calendar days before now, so an outage never eats the
// dailies); and, for each calendar month from `ref.localDate`'s month back 11 months, the newest
// nightly copy dated in that month. Every other kind: the newest BACKUP_KEEP_BY_KIND[kind].
//
// A file dated more than BACKUP_FUTURE_TOLERANCE_MS after `ref.instant` (a copy taken while the
// clock was wrong, or copied in by hand) is not an input: never removed, reported in `future`.
// A name that breaks the name rule, or belongs to another kind, is not an input either.
import {
  BACKUP_FUTURE_TOLERANCE_MS,
  BACKUP_KEEP_BY_KIND,
  BACKUP_RETENTION,
  type BackupKeptAs,
  type BackupKind,
} from '@joinr/schema';
import { compareBackupNames, parseBackupName, type ParsedBackupName } from './names';

export interface RetentionRef {
  instant: Date;
  /** `YYYYMMDD`: the server-local date of `instant` (from the service or a file's name). */
  localDate: string;
}

export interface RetentionResult {
  /** The kept files of this kind and why. */
  keep: Map<string, BackupKeptAs>;
  /** The files of this kind to delete, oldest first. */
  remove: string[];
  /** Files of this kind dated too far ahead of `ref.instant` (never removed, never counted). */
  future: string[];
}

/** `YYYYMM` → the month `n` months earlier. */
function monthsBack(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(4, 6)) - 1) - n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}${String(index - year * 12 + 1).padStart(2, '0')}`;
}

/** Newest first. */
const newestFirst = (a: ParsedBackupName, b: ParsedBackupName): number => compareBackupNames(b, a);

export function retain(
  files: readonly string[],
  kind: BackupKind,
  ref: RetentionRef,
): RetentionResult {
  const limit = ref.instant.getTime() + BACKUP_FUTURE_TOLERANCE_MS;
  const inputs: ParsedBackupName[] = [];
  const future: string[] = [];
  for (const name of files) {
    const parsed = parseBackupName(name);
    if (parsed === null || parsed.kind !== kind) continue;
    if (parsed.instant.getTime() > limit) future.push(name);
    else inputs.push(parsed);
  }
  inputs.sort(newestFirst);
  const keep = new Map<string, BackupKeptAs>();

  if (kind !== 'nightly') {
    inputs.slice(0, BACKUP_KEEP_BY_KIND[kind]).forEach((f) => keep.set(f.name, 'recent'));
  } else {
    // The newest file of each local date is that date's copy (inputs are newest first).
    const byDate = new Map<string, ParsedBackupName>();
    for (const f of inputs) if (!byDate.has(f.localDate)) byDate.set(f.localDate, f);
    const dates = [...byDate.keys()].sort().reverse();
    const daily = new Set(
      dates.slice(0, BACKUP_RETENTION.dailyCopies).map((d) => byDate.get(d)!.name),
    );
    const refMonth = ref.localDate.slice(0, 6);
    const window = new Set(
      Array.from({ length: BACKUP_RETENTION.monthlyMonths }, (_, i) => monthsBack(refMonth, i)),
    );
    const monthly = new Set<string>();
    const monthsSeen = new Set<string>();
    for (const f of inputs) {
      if (monthsSeen.has(f.localMonth)) continue;
      monthsSeen.add(f.localMonth);
      if (window.has(f.localMonth)) monthly.add(f.name);
    }
    for (const f of inputs) {
      const d = daily.has(f.name);
      const m = monthly.has(f.name);
      if (d && m) keep.set(f.name, 'daily_and_monthly');
      else if (d) keep.set(f.name, 'daily');
      else if (m) keep.set(f.name, 'monthly');
    }
  }

  const remove = inputs
    .filter((f) => !keep.has(f.name))
    .sort(compareBackupNames)
    .map((f) => f.name);
  return { keep, remove, future };
}
