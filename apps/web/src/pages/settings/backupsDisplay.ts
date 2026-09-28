// The Settings Backups and About sections' words and formats (stage-7.md §6.2, §6.3): every backup
// time in the server's zone as `dd/mm/yyyy HH:mm`, the schedule line, the last-run badge (the frozen
// §4.3 mapping), the space and retention lines, the Monthly pill rule and the button's result text.
// No components here (react-refresh): BackupsSection.tsx and AboutSection.tsx draw them.
import {
  BACKUP_KIND_LABELS,
  type BACKUP_RETENTION,
  type BackupFileDto,
  type BackupNowResponse,
  type BackupScheduleDto,
  type JobRunSummary,
} from '@joinr/schema';
import type { StatusKind } from '@joinr/ui';
import { formatFileSize } from '../../formatting';

/** The sections' heading ids: `/settings#backups` (the stale-backup callout's link) and `#about`. */
export const BACKUPS_SECTION_ID = 'backups';
export const ABOUT_SECTION_ID = 'about';

/** Rows shown before "Show all" (§6.2 item 5). */
export const BACKUPS_SHOWN = 12;

export const UNINSTALL_WARNING_LEAD =
  "These backups are stored on the server, in this app's data folder.";
export const UNINSTALL_WARNING_STRONG = 'Uninstalling the app deletes them.';
export const UNINSTALL_WARNING_TAIL =
  'Download the newest one before you uninstall, and keep a copy off the server: the weekly NAS copy does this once it is set up.';

const pad2 = (value: number): string => String(value).padStart(2, '0');

function dateTimeFormat(timeZone: string | undefined, seconds = false): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone });
  } catch {
    // An unknown zone name (RangeError): the browser's own zone.
    return new Intl.DateTimeFormat('en-AU', options);
  }
}

/** The parts of an instant in a zone (the browser's when the zone is invalid). */
function zonedParts(
  date: Date,
  timeZone: string | undefined,
  seconds = false,
): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of dateTimeFormat(timeZone, seconds).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/**
 * An ISO instant → `15/09/2030 14:32` in the server's zone (§6.2 "Times"), whatever the browser's
 * zone; with `seconds`, `15/09/2030 14:32:05`. An unparseable value → an em dash.
 */
export function formatServerDateTime(
  iso: string | null | undefined,
  timeZone: string,
  { seconds = false }: { seconds?: boolean } = {},
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const p = zonedParts(date, timeZone, seconds);
  // Some ICU builds write midnight as 24 under h23 requests; normalise.
  const hour = p.hour === '24' ? '00' : p.hour;
  const time = `${hour}:${p.minute}${seconds ? `:${p.second}` : ''}`;
  return `${p.day}/${p.month}/${p.year} ${time}`;
}

/** `YYYY-MM` of an instant in the server's zone (the current month for the Monthly pill). */
export function serverMonth(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}`;
}

/** "02:30" from the schedule (never hard-coded). */
export function scheduleTime(schedule: Pick<BackupScheduleDto, 'hour' | 'minute'>): string {
  return `${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
}

/**
 * "Nightly at 02:30 (Australia/Melbourne)"; when off: "Off (turned off in the server settings);
 * would run at 02:30 (Australia/Melbourne)". No variable name in the owner's words.
 */
export function scheduleText(schedule: BackupScheduleDto): string {
  const at = `${scheduleTime(schedule)} (${schedule.timeZone})`;
  return schedule.enabled
    ? `Nightly at ${at}`
    : `Off (turned off in the server settings); would run at ${at}`;
}

/** "Next": the actual next run (a retry or the start-up catch-up included), or why there is none. */
export function nextRunText(schedule: BackupScheduleDto): string {
  if (!schedule.enabled || !schedule.nextRunAt) return 'Not scheduled';
  return formatServerDateTime(schedule.nextRunAt, schedule.timeZone);
}

export interface LastRunView {
  status: StatusKind;
  /** The badge word. */
  label: string;
  /** A muted reason after a Skipped badge. */
  reason: string | null;
  /** The category message after a Failed badge (never raw text: the server sends one of three). */
  error: string | null;
  /** When it ran: `dd/mm/yyyy HH:mm` in the server's zone. */
  at: string;
}

const SKIP_REASONS: Record<string, string> = {
  empty: 'nothing to back up yet',
  import_in_progress: 'an import was running',
  not_due: 'it was not due',
};

function skippedOf(run: JobRunSummary): string | null {
  const skipped = run.detail?.['skipped'];
  return typeof skipped === 'string' ? skipped : null;
}

/** The frozen §4.3 mapping from the last run to the badge, its reason or message, and its time. */
export function lastRunView(run: JobRunSummary | null, timeZone: string): LastRunView | null {
  if (!run) return null;
  const at = formatServerDateTime(
    run.status === 'running' ? run.startedAt : (run.finishedAt ?? run.startedAt),
    timeZone,
  );
  const skipped = skippedOf(run);
  switch (run.status) {
    case 'running':
      return { status: 'pending', label: 'Running', reason: null, error: null, at };
    case 'failed':
      return {
        status: 'failed',
        label: 'Failed',
        reason: null,
        error: run.error ?? 'The copy could not be written',
        at,
      };
    case 'succeeded':
    case 'partial':
      if (skipped !== null) {
        return {
          status: 'pending',
          label: 'Skipped',
          reason: SKIP_REASONS[skipped] ?? null,
          error: null,
          at,
        };
      }
      return run.status === 'succeeded'
        ? { status: 'go', label: 'Succeeded', reason: null, error: null, at }
        : { status: 'check', label: 'Partial', reason: null, error: run.error, at };
  }
}

/** "1 backup" / "27 backups". */
function backupsCount(count: number): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? 'backup' : 'backups'}`;
}

/** A disk size: `formatFileSize` up to megabytes, then `120.0 GB` / `1.2 TB`. */
export function formatSpace(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return formatFileSize(bytes);
}

/** "110.0 MB in 27 backups · 120.0 GB free on the server" (the free part only when known). */
export function spaceText(totalBytes: number, count: number, freeBytes: number | null): string {
  const used = `${formatSpace(totalBytes)} in ${backupsCount(count)}`;
  return freeBytes === null ? used : `${used} · ${formatSpace(freeBytes)} free on the server`;
}

/** The retention line, built from the server's numbers (§6.2 item 2). */
export function retentionText(retention: typeof BACKUP_RETENTION): string {
  return (
    `Keeps the newest nightly copy of each of the last ${retention.dailyCopies} days it ran and of ` +
    `each of the last ${retention.monthlyMonths} months, plus the newest ${retention.manual} by ` +
    `hand, ${retention.preImport} before an import, ${retention.preRestore} before a restore and ` +
    `${retention.preMigrate} before an update.`
  );
}

/** The file's server-local month, as written in its `createdAt` (`2030-09-15T02:30:00+10:00`). */
function fileMonth(file: BackupFileDto): string {
  return file.createdAt.slice(0, 7);
}

/**
 * The "Monthly" pill (§6.2 item 5): only for a file kept for a month other than the current one,
 * so the newest row does not carry a pill that changes every day.
 */
export function showsMonthlyPill(file: BackupFileDto, currentMonth: string): boolean {
  if (file.keptAs === 'monthly') return true;
  return file.keptAs === 'daily_and_monthly' && fileMonth(file) < currentMonth;
}

/** The kind's word ("Nightly", "By hand", …). */
export function kindLabel(file: BackupFileDto): string {
  return BACKUP_KIND_LABELS[file.kind];
}

/** The download's URL: the name encoded (a `+` in the offset becomes `%2B`). */
export function downloadHref(name: string): string {
  return `/api/backups/${encodeURIComponent(name)}`;
}

/**
 * "Download the backup of 15/09/2030 02:30:00": with the seconds, so two copies taken in the same
 * minute have different accessible names (the visible When cell keeps `HH:mm`; Fixer UX-1).
 */
export function downloadLabel(file: BackupFileDto, timeZone: string): string {
  return `Download the backup of ${formatServerDateTime(file.createdAt, timeZone, { seconds: true })}`;
}

/** The result of "Back up now": "Backup taken: 15/09/2030 14:32, 4.2 MB." or the joined form. */
export function backupNowText(result: BackupNowResponse, timeZone: string): string {
  const what = `${formatServerDateTime(result.backup.createdAt, timeZone)}, ${formatFileSize(
    result.backup.sizeBytes,
  )}.`;
  return result.joined
    ? `A backup was already running; it finished: ${what}`
    : `Backup taken: ${what}`;
}

/** The empty table's text. */
export function emptyText(schedule: BackupScheduleDto): string {
  return schedule.enabled
    ? `No backups yet. The first nightly backup runs at ${scheduleTime(schedule)}.`
    : 'No backups yet. Nightly backups are off.';
}

/** "Show all 27 backups" / "Show the newest 12". */
export function showAllText(expanded: boolean, count: number): string {
  return expanded ? `Show the newest ${BACKUPS_SHOWN}` : `Show all ${backupsCount(count)}`;
}

/** The About block's version note (§6.3), or null when the page and the server agree. */
export function versionMismatchText(webVersion: string, serverVersion: string): string | null {
  if (webVersion === serverVersion) return null;
  return `This page is from v${webVersion}; the server runs v${serverVersion}. Reload to get the new version.`;
}

/** "from manual-….db on 15/09/2030 11:00". */
export function restoredText(restored: { name: string; at: string }, timeZone: string): string {
  return `from ${restored.name} on ${formatServerDateTime(restored.at, timeZone)}`;
}
