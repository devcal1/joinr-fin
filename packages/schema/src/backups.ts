// Stage 7 backups (stage-7.md §3.2, frozen): the kinds, the nightly schedule (D115), the retention
// sets, the stale and clock-tolerance thresholds, the page's words and the file-name rule.
// Plain constants: no imports, so the web bundle and the server can both use them.

export const BACKUP_KINDS = [
  'nightly',
  'manual',
  'pre-import',
  'pre-restore',
  'pre-migrate',
] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** D115: the nightly backup runs at 02:30 server-local time. */
export const BACKUP_NIGHTLY_HOUR = 2;
export const BACKUP_NIGHTLY_MINUTE = 30;

/** D115 plus the per-kind sets (§5.3). */
export const BACKUP_RETENTION = {
  dailyCopies: 14, // nightly: the newest copy of each of the 14 newest local dates
  monthlyMonths: 12, // nightly: the newest copy of each of the last 12 calendar months
  manual: 10,
  preImport: 10, // unchanged from Stage 1 (D115)
  preRestore: 5,
  preMigrate: 5,
} as const;

/** The non-nightly counts, keyed by kind (used by `retain` and the retention text). */
export const BACKUP_KEEP_BY_KIND: Record<Exclude<BackupKind, 'nightly'>, number> = {
  manual: BACKUP_RETENTION.manual,
  'pre-import': BACKUP_RETENTION.preImport,
  'pre-restore': BACKUP_RETENTION.preRestore,
  'pre-migrate': BACKUP_RETENTION.preMigrate,
};

/** No successful nightly or manual backup for this long, with data present → stale (§5.4). */
export const BACKUP_STALE_HOURS = 48;

/** A file dated more than this after `now` is "future": never pruned, never counted (§5.3, §5.4). */
export const BACKUP_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
/** A nightly file settles a slot only if its instant is in [S(now), now + this] (§5.4). */
export const BACKUP_DUE_SLACK_MS = 10 * 60 * 1000;

/** Words for the page (§6.2); the Monthly word is a retention label, not a kind. */
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  nightly: 'Nightly',
  manual: 'By hand',
  'pre-import': 'Before import',
  'pre-restore': 'Before restore',
  'pre-migrate': 'Before update',
};

/**
 * Every backup file name the app writes or lists (§5.2). Every Stage 7 name carries the local UTC
 * offset; the offset is optional for `pre-import` only, so the Stage 1 files still list and prune.
 * At most 64 characters.
 */
export const BACKUP_FILE_NAME_RE =
  /^(?:(?:nightly|manual|pre-restore|pre-migrate)-\d{8}-\d{6}[+-]\d{4}|pre-import-\d{8}-\d{6}(?:[+-]\d{4})?)(?:-[2-9]|-[1-9]\d{1,2})?\.db$/;
/** The download's file name prefix (§4.2); the CLI and the wrapper strip it (§5.5, §7.6). */
export const BACKUP_DOWNLOAD_PREFIX = 'joinr-finance-';
export const BACKUP_FILE_NAME_MAX = 64;
