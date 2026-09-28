// Pre-import backups (stage-1.md §3.4 step 5): a consistent copy of the live database kept in
// <DATA_DIR>/backups, newest 10 only. Stage 7 (stage-7.md §5.2, §5.3, §11 item 1): written through
// the verified copy (`writeVerifiedBackup`, kind `pre-import`), named with the local UTC offset;
// the Stage 1 offset-less names still list and prune. A copy that fails its check throws a
// `BackupError` (500 `BACKUP_FAILED`), so the import stops instead of running without a backup.
import { BACKUP_RETENTION } from '@joinr/schema';
import { writeVerifiedBackup } from '../backups/copy';
import { BACKUPS_DIR_NAME, formatBackupName } from '../backups/names';
import type { AppDatabase } from './database';

export { BACKUPS_DIR_NAME };
export const PRE_IMPORT_PREFIX = 'pre-import-';
/** Unchanged from Stage 1 (D115). */
export const PRE_IMPORT_KEEP = BACKUP_RETENTION.preImport;

/** `pre-import-YYYYMMDD-HHmmss±HHMM.db` in local time with its offset. */
export function preImportBackupName(now: Date): string {
  return formatBackupName('pre-import', now);
}

/**
 * Writes a verified `<dataDir>/backups/pre-import-…` copy (a suffix `-2`, `-3`, … when that second
 * already has one), keeps the newest 10 pre-import backups and returns the path. Synchronous.
 */
export function backupBeforeImport(
  database: AppDatabase,
  dataDir: string,
  now: Date = new Date(),
): string {
  return writeVerifiedBackup(database, dataDir, 'pre-import', now).path;
}
