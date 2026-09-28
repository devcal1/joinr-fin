// The weekly copy to the NAS (stage-8.md §4.3, frozen; D132: no heartbeat). `GET /api/backups`
// carries a `nasCopy` block, `POST /api/backups/nas-copy` answers 202 with `NasCopyNowResponse`.
// Times: `schedule.nextRunAt` and `detail.slot` are local ISO with the server's offset; the run
// times and `lastSuccessAt` are UTC ISO with milliseconds, like every `job_runs` row.
// There is no field in these types that an address, a host, an account, a module, a subfolder or
// a password could travel in.
import type { NasCopyConfigReason, NasCopyConfigState, NasCopyFailureReason } from '../nasCopy';
import type { JobRunSummary } from './prices';

/** The `nas-copy` job's `job_runs.detail` (every field an integer, a boolean or a word this app wrote). */
export interface NasCopyJobDetail {
  /** At the start of the run. */
  configured: NasCopyConfigState;
  /** rsync was run at least once. */
  attempted: boolean;
  /** Runs the service started with trigger schedule or startup only: the weekly slot, local ISO with offset. */
  slot?: string;
  /** Those runs only: 1..NAS_COPY_MAX_ATTEMPTS (counts attempted, non-stopped failures, §5.9). */
  attempt?: number;
  /** Backup files eligible here at the start. */
  localFiles: number;
  /** Of those, on the NAS at the same size before sending. */
  alreadyThere: number;
  /** Intended names proved on the NAS at the right size afterwards. */
  sent: number;
  /** Intended names still absent or wrong-sized (null: never looked again). */
  missingAfter: number | null;
  /** Intended names removed here during the copy (a prune): not counted, not a failure. */
  vanished: number;
  /** Backup-named files the NAS holds after the run (null: not read). */
  onNas: number | null;
  /** The sizes of the files proved sent. */
  bytes: number;
  durationMs: number;
  /** Failed runs only. */
  reason?: NasCopyFailureReason;
  /** rsync's exit code on a failure (an integer; never its text). */
  exitCode?: number;
}

export interface NasCopyScheduleDto {
  /** config.weeklyNasCopy (§5.1). */
  enabled: boolean;
  /** NAS_COPY_WEEKDAY */
  weekday: number;
  /** NAS_COPY_HOUR */
  hour: number;
  /** NAS_COPY_MINUTE */
  minute: number;
  /** The server's zone. */
  timeZone: string;
  /** §5.9; null unless enabled, configured is 'ready' and the refusal lock does not hold. */
  nextRunAt: string | null;
}

export interface NasCopyStatusDto {
  configured: NasCopyConfigState;
  /** From the CURRENT files (never from lastRun); null when off or ready. */
  configReason: NasCopyConfigReason | null;
  /** The absent file when 'partial'; [] otherwise. */
  missing: Array<'nas-url' | 'nas-password'>;
  /** The refusal lock (§5.9); false unless configured is 'ready'. */
  blockedUntilFilesChange: boolean;
  schedule: NasCopyScheduleDto;
  running: boolean;
  /** The newest nas-copy run; `error` is always a §4.4 sentence. */
  lastRun: JobRunSummary | null;
  /** finishedAt of the newest succeeded run. */
  lastSuccessAt: string | null;
  /** §5.9 */
  stale: boolean;
}

export interface NasCopyNowResponse {
  /** True when a copy was already running. */
  joined: boolean;
  /** The status just after starting (running: true; lastRun is the running row, with its id). */
  nasCopy: NasCopyStatusDto;
}
