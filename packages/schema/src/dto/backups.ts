// `GET /api/backups`, `POST /api/backups` (stage-7.md §4.3, frozen). Times are ISO 8601 with the
// server's local offset (e.g. `2030-03-15T02:30:00+11:00`), except the job run's own timestamps,
// which are stored as UTC ISO like every other `job_runs` row.
import type { BACKUP_RETENTION, BackupKind } from '../backups';
import type { NasCopyStatusDto } from './nasCopy';
import type { JobRunSummary } from './prices';

export type BackupKeptAs = 'daily' | 'monthly' | 'daily_and_monthly' | 'recent' | 'future';

export interface BackupFileDto {
  /** The file name; also the download id. */
  name: string;
  kind: BackupKind;
  /** From the name: local time with its offset (legacy pre-import: the local offset of that instant). */
  createdAt: string;
  sizeBytes: number;
  /**
   * Why retention keeps it (§5.3); 'recent' for every non-nightly kind; 'future' when dated more
   * than BACKUP_FUTURE_TOLERANCE_MS after now (never pruned, never counted).
   */
  keptAs: BackupKeptAs;
}

export interface BackupScheduleDto {
  /** config.nightlyBackups (§5.1). */
  enabled: boolean;
  /** BACKUP_NIGHTLY_HOUR */
  hour: number;
  /** BACKUP_NIGHTLY_MINUTE */
  minute: number;
  /** Intl.DateTimeFormat().resolvedOptions().timeZone on the server. */
  timeZone: string;
  /**
   * The timer's actual next due run: min(pending retry, armed start-up catch-up, next slot)
   * (§5.4); null when disabled.
   */
  nextRunAt: string | null;
}

export interface BackupsResponse {
  /** Every kind, newest first. */
  backups: BackupFileDto[];
  totalBytes: number;
  /** statfs of DATA_DIR; null when unavailable. */
  freeBytes: number | null;
  schedule: BackupScheduleDto;
  /** A backup job is in flight. */
  running: boolean;
  /** The newest `backup` job run (any trigger). */
  lastRun: JobRunSummary | null;
  /** The newest nightly or manual file's createdAt. */
  lastBackupAt: string | null;
  /** §5.4 */
  stale: boolean;
  retention: typeof BACKUP_RETENTION;
  app: {
    /** APP_VERSION */
    version: string;
    /** Applied migrations. */
    migrations: number;
    /** app_meta restore.last (§5.5 step 10). */
    restoredFrom: { name: string; at: string } | null;
  };
  /** Stage 8 (stage-8.md §4.2, §4.3): the weekly copy to the NAS. */
  nasCopy: NasCopyStatusDto;
}

export interface BackupNowResponse {
  backup: BackupFileDto;
  /** True when the click joined a backup already in flight. */
  joined: boolean;
}

// ─── The `backup` job's run detail (§4.3) ───────────────────────────────────────────────────────
// Transcribed from the frozen prose of §4.3 and §4.1 so the server and the page share one spelling.
// `JobRunSummary.detail` stays `Record<string, unknown> | null`; these types describe what the
// `backup` job writes there.

/** Why a run did nothing (the page shows "Skipped" plus a muted reason). */
export type BackupSkipReason = 'import_in_progress' | 'empty' | 'not_due';
/** The category of a failed run (`detail.reason`). */
export type BackupFailureReason = 'no_space' | 'verify_failed' | 'io';

/** The `backup` job's `job_runs.detail`. */
export interface BackupJobDetail {
  kind: BackupKind;
  name?: string;
  /** The settled slot, local ISO with offset. */
  slot?: string;
  sizeBytes?: number;
  durationMs?: number;
  verified?: boolean;
  pruned?: string[];
  skipped?: BackupSkipReason;
  reason?: BackupFailureReason;
  attempt?: number;
}

/**
 * The only messages a failed backup exposes (§4.1): `job_runs.error`, `lastRun.error` and the 500
 * `BACKUP_FAILED` body. Never raw error text, never a path.
 */
export const BACKUP_FAILURE_MESSAGES: Record<BackupFailureReason, string> = {
  no_space: 'Not enough free space on the server',
  verify_failed: 'The copy failed its check',
  io: 'The copy could not be written',
};
