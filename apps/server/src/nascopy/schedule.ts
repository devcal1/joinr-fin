// The weekly slot, the settled / lock / attempt / stale rules and the timer plan (stage-8.md §5.9,
// frozen rules). Everything here is pure: the service reads the files and the `job_runs` rows and
// passes them in.
//
// The slot `W(t)` is the latest Sunday 03:00 local ≤ t, built with calendar arithmetic
// (`new Date(y, m, d − w, 3, 0)`), never `+ 7 × 24 h`: on the October change day 03:00 is 03:00
// AEDT (the first instant after the 02:00 → 03:00 gap), on the April change day 03:00 AEST once.
import {
  NAS_COPY_CONFIG_REASONS,
  NAS_COPY_FAILURE_REASONS,
  NAS_COPY_HOUR,
  NAS_COPY_MINUTE,
  NAS_COPY_REFUSAL_REASONS,
  NAS_COPY_STALE_HOURS,
  NAS_COPY_WEEKDAY,
  type NasCopyConfigState,
  type NasCopyFailureReason,
  type NasCopyJobDetail,
} from '@joinr/schema';
import { localIsoWithOffset } from '../backups/names';
import { NAS_COPY_FUTURE_SLACK_MS, NAS_COPY_MAX_ATTEMPTS, NAS_COPY_WAKE_MAX_MS } from './constants';

// ─── Slots ──────────────────────────────────────────────────────────────────────────────────────

/** `W(t)`: the latest Sunday 03:00 local ≤ t. */
export function slotAt(t: Date): Date {
  const back = (t.getDay() - NAS_COPY_WEEKDAY + 7) % 7;
  const y = t.getFullYear();
  const m = t.getMonth();
  const d = t.getDate() - back;
  const s = new Date(y, m, d, NAS_COPY_HOUR, NAS_COPY_MINUTE);
  return t.getTime() < s.getTime() ? new Date(y, m, d - 7, NAS_COPY_HOUR, NAS_COPY_MINUTE) : s;
}

/** The first slot strictly after `t`: W(t)'s date + 7 calendar days, 03:00. */
export function nextSlotAfter(t: Date): Date {
  const w = slotAt(t);
  return new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7, NAS_COPY_HOUR, NAS_COPY_MINUTE);
}

/** A slot as it is recorded in `detail.slot` (local ISO with offset). */
export const slotIso = (slot: Date): string => localIsoWithOffset(slot);

// ─── Runs ───────────────────────────────────────────────────────────────────────────────────────

/** A `nas-copy` job_runs row as the rules read it. */
export interface NasRun {
  id: number;
  trigger: string;
  /** Epoch ms of `startedAt` (NaN when unparsable). */
  startedMs: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  /** Only the fields this app wrote with their own types; null for a crash-left row. */
  detail: Partial<NasCopyJobDetail> | null;
}

const REASONS = new Set<string>(NAS_COPY_FAILURE_REASONS);

/** A job_runs detail object → the typed fields (anything else dropped). */
export function readDetail(raw: Record<string, unknown> | null): Partial<NasCopyJobDetail> | null {
  if (raw === null) return null;
  const out: Partial<NasCopyJobDetail> = {};
  const int = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) ? v : undefined;
  if (typeof raw['attempted'] === 'boolean') out.attempted = raw['attempted'];
  if (typeof raw['slot'] === 'string') out.slot = raw['slot'];
  const attempt = int(raw['attempt']);
  if (attempt !== undefined) out.attempt = attempt;
  if (typeof raw['reason'] === 'string' && REASONS.has(raw['reason'])) {
    out.reason = raw['reason'] as NasCopyFailureReason;
  }
  const exitCode = int(raw['exitCode']);
  if (exitCode !== undefined) out.exitCode = exitCode;
  for (const key of ['localFiles', 'alreadyThere', 'sent', 'vanished', 'bytes'] as const) {
    const v = int(raw[key]);
    if (v !== undefined) out[key] = v;
  }
  const missingAfter = raw['missingAfter'];
  if (missingAfter === null || int(missingAfter) !== undefined) {
    out.missingAfter = missingAfter as number | null;
  }
  const onNas = raw['onNas'];
  if (onNas === null || int(onNas) !== undefined) out.onNas = onNas as number | null;
  return out;
}

const isFuture = (run: NasRun, t: Date): boolean =>
  !(run.startedMs <= t.getTime() + NAS_COPY_FUTURE_SLACK_MS);

/** A failed run that really tried the NAS: attempted, and not stopped by a shutdown (rule d). */
export function isRealAttempt(run: NasRun): boolean {
  return (
    run.status === 'failed' && run.detail?.attempted === true && run.detail.reason !== 'stopped'
  );
}

/** The real attempts already recorded for the slot (the next attempt is this + 1, §5.9). */
export function attemptsFor(runs: readonly NasRun[], slot: Date): number {
  const iso = slotIso(slot);
  return runs.filter((r) => r.detail?.slot === iso && isRealAttempt(r)).length;
}

/** Rules (a)–(d) of §5.9: is `slot` settled at `t`? */
export function isSettled(
  runs: readonly NasRun[],
  slot: Date,
  t: Date,
  configured: NasCopyConfigState,
): boolean {
  const from = slot.getTime();
  const to = t.getTime() + NAS_COPY_FUTURE_SLACK_MS;
  const iso = slotIso(slot);
  let attempts = 0;
  for (const r of runs) {
    // (a) a success of any trigger that started at or after the slot (and not in the future).
    if (r.status === 'succeeded' && r.startedMs >= from && r.startedMs <= to) return true;
    if (r.status !== 'failed' || r.detail?.slot !== iso) continue;
    const reason = r.detail.reason;
    // (b) the image has no rsync: given up for the slot.
    if (reason === 'no_rsync') return true;
    // (c) a configuration failure, while the configuration is still not ready.
    if (
      reason !== undefined &&
      NAS_COPY_CONFIG_REASONS.includes(reason) &&
      configured !== 'ready'
    ) {
      return true;
    }
    if (isRealAttempt(r)) attempts += 1;
  }
  // (d) every attempt used.
  return attempts >= NAS_COPY_MAX_ATTEMPTS;
}

/** Newest first: startedAt, then id. */
function newestFirst(runs: readonly NasRun[]): NasRun[] {
  return [...runs].sort((a, b) => b.startedMs - a.startedMs || b.id - a.id);
}

/**
 * The refusal lock (§5.9): the newest attempted run (runs dated after t + slack ignored) was
 * refused, and neither file has an mtime later than that run's start.
 */
export function isBlocked(
  runs: readonly NasRun[],
  t: Date,
  mtimes: { url: number | null; password: number | null },
): boolean {
  const newest = newestFirst(runs).find((r) => r.detail?.attempted === true && !isFuture(r, t));
  if (newest === undefined || newest.status !== 'failed') return false;
  const reason = newest.detail?.reason;
  if (reason === undefined || !NAS_COPY_REFUSAL_REASONS.includes(reason)) return false;
  const changed = (m: number | null): boolean => m !== null && m > newest.startedMs;
  return !changed(mtimes.url) && !changed(mtimes.password);
}

/** The newest succeeded run (any date), or null. */
export function lastSuccess(runs: readonly NasRun[]): NasRun | null {
  return newestFirst(runs).find((r) => r.status === 'succeeded') ?? null;
}

/**
 * Stale (§5.9): enabled, ready, and more than NAS_COPY_STALE_HOURS since `ref`: the newest
 * succeeded run's finishedAt, else the start of the oldest kept attempted run, else never stale.
 * Runs dated after now + slack are ignored.
 */
export function isStale(o: {
  runs: readonly NasRun[];
  now: Date;
  enabled: boolean;
  configured: NasCopyConfigState;
}): boolean {
  if (!o.enabled || o.configured !== 'ready') return false;
  const kept = o.runs.filter((r) => !isFuture(r, o.now));
  const success = newestFirst(kept).find((r) => r.status === 'succeeded');
  let ref: number | null;
  if (success !== undefined) {
    const finished = success.finishedAt === null ? NaN : Date.parse(success.finishedAt);
    ref = Number.isNaN(finished) ? success.startedMs : finished;
  } else {
    const attempted = kept.filter((r) => r.detail?.attempted === true);
    const oldest = attempted.sort((a, b) => a.startedMs - b.startedMs || a.id - b.id)[0];
    ref = oldest?.startedMs ?? null;
  }
  return ref !== null && o.now.getTime() - ref > NAS_COPY_STALE_HOURS * 3_600_000;
}

// ─── The timer plan ─────────────────────────────────────────────────────────────────────────────

export interface NasPlanState {
  enabled: boolean;
  /** configured ≠ off, not blocked, W(now) not settled. */
  due: boolean;
  /** A pending retry for this slot (nothing runs before it). */
  retryAt: Date | null;
  /** The armed start-up catch-up (nothing runs before it). */
  catchUpAt: Date | null;
}

export interface NasPlan {
  runNow: boolean;
  /** When the timer should wake next; null when disabled. */
  wakeAt: Date | null;
  /** The next run: the gate when due, else the next slot; null when disabled. */
  nextRunAt: Date | null;
}

/** The plan at `now` (pure; as Stage 7's planNext, with the 1-hour wake cap). */
export function planNext(now: Date, state: NasPlanState): NasPlan {
  if (!state.enabled) return { runNow: false, wakeAt: null, nextRunAt: null };
  const t = now.getTime();
  const nextSlot = nextSlotAfter(now).getTime();
  const retry =
    state.due && state.retryAt !== null && t < state.retryAt.getTime() ? state.retryAt : null;
  const catchUp =
    state.catchUpAt !== null && t < state.catchUpAt.getTime() ? state.catchUpAt : null;
  const runNow = state.due && retry === null && catchUp === null;
  const gate = Math.max(t, retry?.getTime() ?? t, catchUp?.getTime() ?? t);
  let wake = Math.min(nextSlot, t + NAS_COPY_WAKE_MAX_MS);
  if (catchUp) wake = Math.min(wake, catchUp.getTime());
  if (state.due) wake = Math.min(wake, gate);
  const next = state.due ? Math.min(nextSlot, gate) : nextSlot;
  return { runNow, wakeAt: new Date(wake), nextRunAt: new Date(next) };
}
