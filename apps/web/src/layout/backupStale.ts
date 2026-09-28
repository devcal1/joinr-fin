// The stale-backup callout's words (stage-7.md §6.4, §11 item 5): shown above every page while
// `/api/status` says the backups are stale (no nightly or manual backup for 48 hours, with data).
// The date is the server-local date written in `lastBackupAt` (`2030-09-12T02:30:00+10:00`), so it
// matches the file names and the Backups table whatever the viewer's zone.
import type { AppStatus } from '@joinr/schema';
import { formatDate, isIsoDate } from '@joinr/ui';

export const STALE_BACKUP_TITLE = 'Backup overdue';
export const NO_BACKUP_YET = 'No backup has been taken yet.';
export const OPEN_BACKUPS = 'Open Backups';

/** True when the header status reports stale backups. */
export function backupsStale(status: AppStatus | undefined): boolean {
  return status?.backups?.stale === true;
}

/** "The nightly backup has not succeeded since 12/09/2030." (or: "No backup has been taken yet."). */
export function staleBackupText(lastBackupAt: string | null | undefined): string {
  const day = lastBackupAt?.slice(0, 10);
  if (!day || !isIsoDate(day)) return NO_BACKUP_YET;
  return `The nightly backup has not succeeded since ${formatDate(day)}.`;
}
