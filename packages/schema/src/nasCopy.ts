// Stage 8 weekly copy to the NAS (stage-8.md §3.2, frozen; D132: no heartbeat): the schedule, the
// two NAS file names, the configuration states and reasons, the fixed sentences and the address
// rule. Plain constants and pure functions with no imports, so the web bundle, the server and the
// deploy helper's copy of the rule can all use them.

/** D128: weekly, Sunday 03:00 server-local time. `weekday` is Date#getDay() (0 = Sunday). */
export const NAS_COPY_WEEKDAY = 0;
export const NAS_COPY_HOUR = 3;
export const NAS_COPY_MINUTE = 0;

/** No successful copy for this long (a missed Sunday plus a day), while ready → stale (§5.9). */
export const NAS_COPY_STALE_HOURS = 8 * 24;

/** The folder in DATA_DIR and the two one-line files (D126). Both or neither. */
export const NAS_SECRETS_DIR = 'secrets';
export const NAS_SECRET_FILES = {
  url: 'nas-url',
  password: 'nas-password',
} as const;
/** A secret file larger than this, or not a regular file, is not usable (§5.2). */
export const NAS_SECRET_MAX_BYTES = 4096;

export const NAS_COPY_CONFIG_STATES = ['off', 'partial', 'invalid', 'ready'] as const;
export type NasCopyConfigState = (typeof NAS_COPY_CONFIG_STATES)[number];

export const NAS_COPY_FAILURE_REASONS = [
  // configuration (no rsync run)
  'url_missing',
  'password_missing',
  'url_invalid',
  'password_invalid',
  // the NAS said no
  'auth',
  'unknown_module',
  'refused',
  // transport and storage
  'unreachable',
  'timeout',
  'broken',
  'nas_io',
  // the proof failed
  'not_verified',
  'readback_failed',
  'no_rsync',
  'stopped',
  'other',
] as const;
export type NasCopyFailureReason = (typeof NAS_COPY_FAILURE_REASONS)[number];

/** Why a non-ready configuration is not ready (§4.3), decided from the current files. */
export type NasCopyConfigReason =
  'url_missing' | 'password_missing' | 'url_invalid' | 'password_invalid';

/** Configuration reasons: recorded without running rsync (`attempted: false`). */
export const NAS_COPY_CONFIG_REASONS: readonly NasCopyFailureReason[] = [
  'url_missing',
  'password_missing',
  'url_invalid',
  'password_invalid',
];
/** Retried automatically within a scheduled slot (§5.9). Everything else is not. */
export const NAS_COPY_RETRYABLE_REASONS: readonly NasCopyFailureReason[] = [
  'unreachable',
  'timeout',
  'broken',
  'nas_io',
  'not_verified',
  'readback_failed',
  'stopped',
  'other',
];
/** Reasons that engage the refusal lock (§5.9): the NAS said no to the login or the module. */
export const NAS_COPY_REFUSAL_REASONS: readonly NasCopyFailureReason[] = [
  'auth',
  'unknown_module',
  'refused',
];

/** Appended to every failure sentence. */
export const NAS_COPY_SAFE_TAIL = 'The backups on the server are not affected.';

/** The 409 message when a copy is asked for and the files are absent (§4.1). */
export const NAS_COPY_OFF_MESSAGE =
  'The copy to the NAS is not set up: the NAS files are not on the server.';
/** The 409 message while the refusal lock holds (§4.1, §5.9). */
export const NAS_COPY_FIX_FIRST_MESSAGE =
  "The NAS refused the last copy's password or module. Place the NAS files again with the NAS set-up helper first: repeated refusals could make the NAS block this server.";

/** A sentence's body before the exit-code parenthesis and the tail (§4.4). */
const SENTENCE_BODIES: Record<Exclude<NasCopyFailureReason, 'not_verified'>, string> = {
  url_missing:
    'The copy to the NAS is half set up: nas-url is missing, so nothing is copied. Run the NAS set-up helper again',
  password_missing:
    'The copy to the NAS is half set up: nas-password is missing, so nothing is copied. Run the NAS set-up helper again',
  url_invalid:
    'nas-url is not an rsync://user@host/module address, so nothing is copied. Run the NAS set-up helper again',
  password_invalid:
    'nas-password is not usable (it must be one line of text), so nothing is copied. Run the NAS set-up helper again',
  auth: 'The NAS refused the password in nas-password. Check the rsync account on the NAS, then place the password again with the NAS set-up helper',
  unknown_module:
    'The NAS has no rsync module by the name in nas-url. Check the module on the NAS, then place the address again',
  refused: 'The NAS refused the connection, usually because of a wrong password or module name',
  unreachable: 'The NAS did not answer. Check it is switched on and reachable over Tailscale',
  timeout:
    "The copy to the NAS stalled and was stopped. No incomplete file is left under a backup's name on the NAS",
  broken:
    "The connection to the NAS broke part way through. No incomplete file is left under a backup's name on the NAS",
  nas_io:
    'The NAS could not store or list the files: it may be full, or the rsync account may not be allowed to read and write the folder',
  readback_failed:
    'The files were sent, but the NAS could not be read back, so the copy is not proved',
  no_rsync: 'rsync is missing from the app image, so nothing can be copied',
  stopped: 'The copy was stopped because the app was shutting down',
  other: 'The copy to the NAS failed',
};

/** The reasons whose sentence ends with "(rsync exit code {code})" when a code is given. */
const WITH_CODE: ReadonlySet<NasCopyFailureReason> = new Set<NasCopyFailureReason>([
  'auth',
  'unknown_module',
  'refused',
  'unreachable',
  'timeout',
  'broken',
  'nas_io',
  'readback_failed',
  'other',
]);

/** A non-negative integer, or undefined (never a text, NaN or a fraction). */
function count(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The only sentences a copy ever records or shows (§4.4), each followed by " " + the safe tail.
 * Numbers are the only variables. The exit-code parenthesis is omitted when no integer code is
 * given (the frozen case is `timeout` at the 15-minute ceiling); `not_verified` counts default to 0.
 */
export function nasCopyFailureMessage(
  reason: NasCopyFailureReason,
  n?: { code?: number; missing?: number; total?: number },
): string {
  let sentence: string;
  if (reason === 'not_verified') {
    const missing = count(n?.missing) ?? 0;
    const total = count(n?.total) ?? 0;
    sentence = `rsync reported success, but ${missing} of ${total} files are not on the NAS at the right size.`;
  } else {
    const body = SENTENCE_BODIES[reason] ?? SENTENCE_BODIES.other;
    const code = WITH_CODE.has(reason) ? count(n?.code) : undefined;
    sentence = code === undefined ? `${body}.` : `${body} (rsync exit code ${code}).`;
  }
  return `${sentence} ${NAS_COPY_SAFE_TAIL}`;
}

// ─── The address rule (§5.3) ─────────────────────────────────────────────────────────────────────

/**
 * The address rule (§5.3): `rsync://<user>@<host>[:<port>]/<module>[/<subfolder>]`, no password,
 * no query or fragment, no whitespace. Returns a canonical URL ending in `/`, or `configured`
 * (whether the text was non-empty) and nothing else, so a refusal can never quote the value.
 * NEVER THROWS for any input (a malformed percent-escape is a refusal, §5.3).
 */
export type NasUrlCheck =
  { ok: true; url: string; hasSubfolder: boolean } | { ok: false; configured: boolean };

/** The user, module and subfolder allowlist (after percent-decoding). */
const NAS_URL_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A DNS name or IPv4 (starting with a letter or digit), or a bracketed IPv6. */
const NAS_URL_HOST_RE = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:.]+\])$/;
/** The whole address, split: user, host, optional port, path. No whitespace, `?` or `#` anywhere. */
const NAS_URL_SHAPE_RE =
  /^rsync:\/\/([^@/?#\s]+)@(\[[^\]/?#\s]*\]|[^:/?#@\s[\]]*)(?::(\d{1,5}))?(\/[^?#\s]*)$/i;

/** decodeURIComponent that answers null instead of throwing. */
function decodeSegment(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

function refuse(configured: boolean): NasUrlCheck {
  return { ok: false, configured };
}

export function checkNasUrl(raw: unknown): NasUrlCheck {
  try {
    if (typeof raw !== 'string') return refuse(false);
    const text = raw.trim();
    if (text === '') return refuse(false);
    const shape = NAS_URL_SHAPE_RE.exec(text);
    if (shape === null) return refuse(true);
    const [, rawUser = '', host = '', portText, rawPath = ''] = shape;

    // WHATWG URL as a second gate: it must parse as rsync: with no password, query or fragment.
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return refuse(true);
    }
    if (parsed.protocol !== 'rsync:') return refuse(true);
    if (parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return refuse(true);
    if (rawUser.includes(':')) return refuse(true);

    const user = decodeSegment(rawUser);
    if (user === null || !NAS_URL_SEGMENT_RE.test(user)) return refuse(true);
    if (!NAS_URL_HOST_RE.test(host)) return refuse(true);

    let port = '';
    if (portText !== undefined) {
      const value = Number(portText);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) return refuse(true);
      port = `:${value}`;
    }

    // The path: `/module`, `/module/`, `/module/sub` or `/module/sub/` (checked on the raw text,
    // before any dot-segment resolution the URL parser would apply).
    let path = rawPath.slice(1);
    if (path.endsWith('/')) path = path.slice(0, -1);
    const raws = path.split('/');
    if (raws.length < 1 || raws.length > 2) return refuse(true);
    const segments: string[] = [];
    for (const segment of raws) {
      const decoded = decodeSegment(segment);
      if (decoded === null || !NAS_URL_SEGMENT_RE.test(decoded)) return refuse(true);
      segments.push(decoded);
    }

    return {
      ok: true,
      url: `rsync://${user}@${host}${port}/${segments.join('/')}/`,
      hasSubfolder: segments.length === 2,
    };
  } catch {
    return refuse(typeof raw === 'string' && raw.trim() !== '');
  }
}
