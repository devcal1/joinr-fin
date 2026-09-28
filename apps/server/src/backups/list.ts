// The backups folder as the API lists it (stage-7.md §4.3, §5.10): only regular files that match
// the name rule (a hand-made sub-folder, a stray `.db`, a partial or a symlink is neither listed
// nor counted), `keptAs` by the frozen §4.3 reference rule, and the stale rule of §5.4.
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_FUTURE_TOLERANCE_MS,
  BACKUP_STALE_HOURS,
  type BackupFileDto,
  type BackupKeptAs,
} from '@joinr/schema';
import { importRuns } from '@joinr/schema/db';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/database';
import { hasDomainData } from '../db/queries/domain';
import {
  BACKUPS_DIR_NAME,
  compareBackupNames,
  parseBackupName,
  type ParsedBackupName,
} from './names';
import { retain } from './retention';

export interface ListedBackup extends ParsedBackupName {
  sizeBytes: number;
}

/** `<dataDir>/backups`. */
export function backupsDir(dataDir: string): string {
  return join(dataDir, BACKUPS_DIR_NAME);
}

/**
 * Every backup file in the folder, newest first. A missing folder is an empty list; a file that
 * vanishes between `readdir` and `lstat` is skipped.
 */
export function listBackupFiles(dataDir: string): ListedBackup[] {
  const dir = backupsDir(dataDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: ListedBackup[] = [];
  for (const name of names) {
    const parsed = parseBackupName(name);
    if (parsed === null) continue;
    try {
      const st = lstatSync(join(dir, name));
      if (!st.isFile()) continue;
      out.push({ ...parsed, sizeBytes: st.size });
    } catch {
      // Vanished (a prune) or unreadable: not listed.
    }
  }
  return out.sort((a, b) => compareBackupNames(b, a));
}

const isFuture = (f: ParsedBackupName, now: Date): boolean =>
  f.instant.getTime() > now.getTime() + BACKUP_FUTURE_TOLERANCE_MS;

/**
 * `keptAs` for every listed file (§4.3, frozen): `retain(nightly, 'nightly', ref)` with `ref` the
 * newest non-future nightly file's instant (the instant of the last prune), else `now`. Future
 * files are 'future'; a nightly file absent from the keep map (a prune could not delete it) is
 * 'recent', as is every other kind.
 */
export function keptAsMap(files: readonly ListedBackup[], now: Date): Map<string, BackupKeptAs> {
  const out = new Map<string, BackupKeptAs>();
  const nightly: ListedBackup[] = [];
  for (const f of files) {
    if (isFuture(f, now)) out.set(f.name, 'future');
    else if (f.kind === 'nightly') nightly.push(f);
    else out.set(f.name, 'recent');
  }
  if (nightly.length > 0) {
    const newest = nightly.reduce((a, b) => (compareBackupNames(a, b) >= 0 ? a : b));
    const { keep } = retain(
      nightly.map((f) => f.name),
      'nightly',
      { instant: newest.instant, localDate: newest.localDate },
    );
    for (const f of nightly) out.set(f.name, keep.get(f.name) ?? 'recent');
  }
  return out;
}

/** The DTO rows, newest first. */
export function toBackupDtos(files: readonly ListedBackup[], now: Date): BackupFileDto[] {
  const kept = keptAsMap(files, now);
  return files.map((f) => ({
    name: f.name,
    kind: f.kind,
    createdAt: f.createdAt,
    sizeBytes: f.sizeBytes,
    keptAs: kept.get(f.name) ?? 'recent',
  }));
}

/** One file's DTO, with `keptAs` computed against the whole folder. */
export function backupDtoFor(dataDir: string, name: string, now: Date): BackupFileDto | null {
  const files = listBackupFiles(dataDir);
  return toBackupDtos(files, now).find((f) => f.name === name) ?? null;
}

/** The newest non-future nightly or manual file (the stale rule's and `lastBackupAt`'s source). */
export function newestRoutineBackup(
  files: readonly ListedBackup[],
  now: Date,
): ListedBackup | null {
  let best: ListedBackup | null = null;
  for (const f of files) {
    if ((f.kind !== 'nightly' && f.kind !== 'manual') || isFuture(f, now)) continue;
    if (best === null || compareBackupNames(f, best) > 0) best = f;
  }
  return best;
}

/** The start of the first committed (not dry-run) import, or null. */
export function firstCommittedImportAt(db: Db): Date | null {
  const row = db
    .select({ startedAt: importRuns.startedAt })
    .from(importRuns)
    .where(and(eq(importRuns.status, 'succeeded'), eq(importRuns.dryRun, false)))
    .orderBy(asc(importRuns.startedAt), asc(importRuns.id))
    .limit(1)
    .get();
  if (!row) return null;
  const t = Date.parse(row.startedAt);
  return Number.isNaN(t) ? null : new Date(t);
}

export interface Staleness {
  stale: boolean;
  lastBackupAt: string | null;
}

/**
 * §5.4: `stale = enabled && hasDomainData && ref !== null && now − ref > 48 h`, where `ref` is the
 * newest non-future nightly or manual file's instant, else the first committed import's start (so
 * a fresh install is not stale before its first night). `lastBackupAt` ignores future files too.
 */
export function computeStaleness(
  db: Db,
  files: readonly ListedBackup[],
  now: Date,
  enabled: boolean,
): Staleness {
  const newest = newestRoutineBackup(files, now);
  const lastBackupAt = newest?.createdAt ?? null;
  if (!enabled) return { stale: false, lastBackupAt };
  if (!hasDomainData(db)) return { stale: false, lastBackupAt };
  const ref = newest?.instant ?? firstCommittedImportAt(db);
  const stale = ref !== null && now.getTime() - ref.getTime() > BACKUP_STALE_HOURS * 3_600_000;
  return { stale, lastBackupAt };
}
