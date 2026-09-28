// The NAS copy's server-only constants (stage-8.md §3.3, frozen; D132: no heartbeat constants).
// The rsync flags here are the ONLY flags the copy ever passes; the read-only pin test
// (test/nascopy/readonly.test.ts) fails when anything else appears.

/** The ONLY rsync flags the copy passes (§5.4). Test-pinned. */
export const RSYNC_FLAGS = ['--times', '--contimeout=10', '--timeout=120'] as const;
/** Added for the two listings only. */
export const RSYNC_LIST_FLAG = '--list-only';
/** Resolved on PATH; there is no environment override. */
export const RSYNC_EXECUTABLE = 'rsync';
/** One copy, end to end (list, send, list). */
export const NAS_COPY_TIMEOUT_MS = 15 * 60_000;
/** SIGTERM, then SIGKILL after this; the runner rejects by grace + 500 ms. */
export const RSYNC_KILL_GRACE_MS = 2_000;
/** The runner's rejection after an abort, whatever the child does. */
export const RSYNC_ABORT_SETTLE_MS = RSYNC_KILL_GRACE_MS + 500;
/** nasCopy.stop() never waits longer (the app force-exits 10 s after the first signal). */
export const NAS_COPY_STOP_BUDGET_MS = 4_000;
/** stdout kept per invocation. */
export const RSYNC_OUTPUT_LIMIT = 8 * 1024 * 1024;
/** stderr kept per invocation. */
export const RSYNC_STDERR_LIMIT = 64 * 1024;
/** The start-up catch-up waits this long (after the backup's 2-minute catch-up). */
export const NAS_COPY_STARTUP_DELAY_MS = 5 * 60_000;
/** The timer never sleeps longer. */
export const NAS_COPY_WAKE_MAX_MS = 60 * 60_000;
/** The retry delays after attempts 1, 2 and 3 of a slot. */
export const NAS_COPY_RETRY_DELAYS_MS: readonly number[] = [60, 120, 240].map((m) => m * 60_000);
/** Attempts per slot. */
export const NAS_COPY_MAX_ATTEMPTS = 4;
/** A run dated later than now + this settles nothing (a clock that jumped back). */
export const NAS_COPY_FUTURE_SLACK_MS = 10 * 60_000;
