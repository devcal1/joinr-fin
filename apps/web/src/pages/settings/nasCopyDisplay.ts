// The Settings "Copy to the NAS" block's words (stage-8.md §8.2, §4.5; D132: no heartbeat): the Copy
// row built from the configuration state and `configReason` (never from a run's error, which may
// predate the current files), the Next row, the last copy's badge and text (the frozen §4.5
// mapping), the Last success row, the button's result texts, and the §8.1 follow rule. Every time
// is in the server's zone. Nothing here ever reads or shows an address, an account, a module or a
// password: the DTO has no field for one.
// No components here (react-refresh): NasCopyBlock.tsx draws them.
import {
  nasCopyFailureMessage,
  type JobRunSummary,
  type NasCopyNowResponse,
  type NasCopyScheduleDto,
  type NasCopyStatusDto,
} from '@joinr/schema';
import type { StatusKind } from '@joinr/ui';
import { formatServerDateTime, scheduleTime } from './backupsDisplay';

/** The block's subheading id: `/settings#nas-copy` (the NAS-copy callout's link, the index). */
export const NAS_COPY_SECTION_ID = 'nas-copy';
/** The subheading, and the in-page index entry. */
export const NAS_COPY_TITLE = 'Copy to the NAS';
export const NAS_COPY_INDEX_LABEL = 'NAS copy';
/** The KV table's caption (distinct from the subheading that already names the block). */
export const NAS_COPY_TABLE_CAPTION = 'NAS copy status';
/** Under the subheading while the backups list loads or failed (the hash target always exists). */
export const NAS_COPY_WAITING_TEXT = 'Shown once the backups have loaded.';
/** The Copy row's value id: the unavailable button's `aria-describedby` target. */
export const NAS_COPY_STATE_ID = 'nas-copy-state';

export const COPY_NOW_LABEL = 'Copy to NAS now';
export const COPY_BUSY_LABEL = 'Copying…';

/** The muted line under the button (§8.2 item 3). */
export const NAS_COPY_ADDS_ONLY =
  'Adds only: nothing on the NAS is ever deleted or changed. The NAS address and password are never shown here.';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** "Sunday" from `schedule.weekday` (Date#getDay(): 0 = Sunday); never hard-coded. */
export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? WEEKDAYS[0];
}

/** "Weekly, Sunday at 03:00 (Australia/Melbourne)" (built from the schedule). */
export function nasScheduleText(schedule: NasCopyScheduleDto): string {
  return `Weekly, ${weekdayName(schedule.weekday)} at ${scheduleTime(schedule)} (${schedule.timeZone})`;
}

export const NAS_COPY_OFF_TEXT =
  'Not set up: the NAS files are not on the server. Place them with the NAS set-up helper (see the runbook).';
export const NAS_COPY_SCHEDULE_OFF_TEXT =
  'Weekly copy off (turned off in the server settings); Copy to NAS now still works';
export const NAS_COPY_BLOCKED_TEXT =
  'Stopped: the NAS refused the password or module. Place the NAS files again with the NAS set-up helper first.';

/** The Copy row for a half-set-up or unusable configuration, by `configReason` (§8.2 item 1). */
const CONFIG_REASON_TEXT: Record<NonNullable<NasCopyStatusDto['configReason']>, string> = {
  url_missing: 'Half set up: nas-url is missing. Nothing is copied.',
  password_missing: 'Half set up: nas-password is missing. Nothing is copied.',
  url_invalid: 'The NAS address in nas-url is not usable. Nothing is copied.',
  password_invalid: 'The password file nas-password is not usable. Nothing is copied.',
};

export interface CopyRowView {
  text: string;
  /** The stop tint: the refusal lock. */
  stop: boolean;
}

/**
 * The Copy row (§8.2 item 1): from the configuration state, `configReason` and the lock only
 * (the current files), never from `lastRun.error`.
 */
export function copyRowView(status: NasCopyStatusDto): CopyRowView {
  switch (status.configured) {
    case 'off':
      return { text: NAS_COPY_OFF_TEXT, stop: false };
    case 'partial':
      return {
        text: CONFIG_REASON_TEXT[
          status.configReason ??
            (status.missing[0] === 'nas-password' ? 'password_missing' : 'url_missing')
        ],
        stop: false,
      };
    case 'invalid':
      return {
        text: CONFIG_REASON_TEXT[status.configReason ?? 'url_invalid'],
        stop: false,
      };
    case 'ready':
      if (status.blockedUntilFilesChange) return { text: NAS_COPY_BLOCKED_TEXT, stop: true };
      return {
        text: status.schedule.enabled
          ? nasScheduleText(status.schedule)
          : NAS_COPY_SCHEDULE_OFF_TEXT,
        stop: false,
      };
  }
}

/** "Copy to NAS now" can be pressed: the files are ready and the refusal lock does not hold. */
export function nasCopyAvailable(status: NasCopyStatusDto): boolean {
  return status.configured === 'ready' && !status.blockedUntilFilesChange;
}

/** The Next row's time, or null (the row is left out) when no run is planned. */
export function nasNextText(schedule: NasCopyScheduleDto): string | null {
  if (!schedule.nextRunAt) return null;
  return formatServerDateTime(schedule.nextRunAt, schedule.timeZone);
}

/** A non-negative integer from a run's detail, or null. */
function countOf(detail: JobRunSummary['detail'], key: string): number | null {
  const value = detail?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** "5 sent · 22 already there · proved on the NAS[ · 1 removed here first][ · 27 on the NAS]" (§4.5). */
export function succeededText(detail: JobRunSummary['detail']): string {
  const sent = countOf(detail, 'sent') ?? 0;
  const alreadyThere = countOf(detail, 'alreadyThere') ?? 0;
  const vanished = countOf(detail, 'vanished') ?? 0;
  const onNas = countOf(detail, 'onNas');
  const parts = [`${sent} sent`, `${alreadyThere} already there`, 'proved on the NAS'];
  if (vanished > 0) parts.push(`${vanished} removed here first`);
  if (onNas !== null) parts.push(`${onNas} on the NAS`);
  return parts.join(' · ');
}

/** A failed run's sentence: always a §4.4 sentence from the server; a generic one if absent. */
export function failedText(run: JobRunSummary): string {
  return run.error ?? nasCopyFailureMessage('other');
}

export interface LastCopyView {
  status: StatusKind;
  /** The badge word. */
  label: string;
  /** `dd/mm/yyyy HH:mm` in the server's zone. */
  at: string;
  /** The counts after a Succeeded badge. */
  text: string | null;
  /** The sentence after a Failed badge (the stop tint). */
  error: string | null;
}

/** The frozen §4.5 mapping from the last copy to its badge and text, or null (no copy yet). */
export function lastCopyView(run: JobRunSummary | null, timeZone: string): LastCopyView | null {
  if (!run) return null;
  const at = formatServerDateTime(
    run.status === 'running' ? run.startedAt : (run.finishedAt ?? run.startedAt),
    timeZone,
  );
  switch (run.status) {
    case 'running':
      return { status: 'pending', label: 'Running', at, text: null, error: null };
    case 'succeeded':
      return { status: 'go', label: 'Succeeded', at, text: succeededText(run.detail), error: null };
    case 'failed':
      return { status: 'failed', label: 'Failed', at, text: null, error: failedText(run) };
    case 'partial':
      // Never written by this job (§4.5); shown as a check with its message, if any.
      return { status: 'check', label: 'Partial', at, text: null, error: run.error };
  }
}

export const NO_COPY_YET = 'No copy yet';

/**
 * The Last success row (§8.2 item 1): shown only when there is a last copy and it did not
 * succeed; the time, or "Never". Null → the row is left out.
 */
export function lastSuccessText(status: NasCopyStatusDto): string | null {
  const run = status.lastRun;
  if (!run || run.status === 'succeeded') return null;
  if (!status.lastSuccessAt) return 'Never';
  return formatServerDateTime(status.lastSuccessAt, status.schedule.timeZone);
}

/** The 202's result text (§8.2 item 2). */
export function copyStartedText(response: Pick<NasCopyNowResponse, 'joined'>): string {
  return response.joined ? 'A copy was already running.' : 'Copy started.';
}

/** The failed result's visible text: the sentence itself is already in the Last copy row. */
export const COPY_FAILED_SEE_ABOVE = 'Copy failed: see Last copy above.';

/**
 * A finished copy's result text: "Copied: 5 sent, 22 already there." or "Copy failed: …" (the
 * live region announces the whole sentence). A failure's `visible` text is short, because the
 * same sentence already shows in the Last copy row just above.
 */
export function copyDoneText(run: JobRunSummary): { ok: boolean; text: string; visible: string } {
  if (run.status === 'succeeded') {
    const sent = countOf(run.detail, 'sent') ?? 0;
    const alreadyThere = countOf(run.detail, 'alreadyThere') ?? 0;
    const text = `Copied: ${sent} sent, ${alreadyThere} already there.`;
    return { ok: true, text, visible: text };
  }
  return { ok: false, text: `Copy failed: ${failedText(run)}`, visible: COPY_FAILED_SEE_ABOVE };
}

/**
 * The §8.1 follow rule (FROZEN): the copy started (or joined) with the 202 body's
 * `nasCopy.lastRun.id` = `followId` is done when `GET /api/backups` shows that id with a status
 * other than running, or a newer id. Null: not done yet. Done: `run` is the finished run to
 * report, or null when a newer copy is already running (the followed copy has ended, but its
 * result is no longer the last copy; the Last copy row shows the new one).
 */
export function followedCopyDone(
  status: NasCopyStatusDto,
  followId: number,
): { run: JobRunSummary | null } | null {
  const run = status.lastRun;
  if (!run) return null;
  if (run.id === followId) return run.status === 'running' ? null : { run };
  if (run.id > followId) return { run: run.status === 'running' ? null : run };
  return null;
}
