// Shared HTTP plumbing for the providers: per-request timeout combined with the run signal,
// JSON parsing, error classification and Retry-After. Error texts are short and never carry a URL,
// a response body or a stack.
import type { Clock } from '../../scheduler/types';
import type { QuoteFailure, Sleep } from './types';

/** No provider request may outlive this (§5.2). */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Stored `last_error` values are capped at this length. */
export const MAX_ERROR_LENGTH = 200;

/** A fixed, browser-like User-Agent (Yahoo rejects obvious bots). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export type HttpOutcome =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'http'; status: number; retryAfterMs?: number }
  | { kind: 'malformed'; status: number }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'network' };

export function truncateError(message: string): string {
  return message.length <= MAX_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

/** `Retry-After` as seconds or an HTTP date → milliseconds from `now` (never negative). */
export function parseRetryAfter(value: string | null, now: Date): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now.getTime());
}

/** The run signal combined with a per-request timeout. */
export function requestSignal(runSignal: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), runSignal]);
}

/** GET a JSON document from a fixed host. Never throws. */
export async function getJson(o: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  runSignal: AbortSignal;
  timeoutMs?: number;
  now: () => Date;
}): Promise<HttpOutcome> {
  if (o.runSignal.aborted) return { kind: 'aborted' };
  const signal = requestSignal(o.runSignal, o.timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await o.fetchImpl(o.url, { method: 'GET', headers: o.headers, signal });
    if (!response.ok) {
      // Drain the body so the connection can be reused; its content is not needed.
      await response.text().catch(() => '');
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), o.now());
      return retryAfterMs === undefined
        ? { kind: 'http', status: response.status }
        : { kind: 'http', status: response.status, retryAfterMs };
    }
    text = await response.text();
  } catch {
    if (o.runSignal.aborted) return { kind: 'aborted' };
    if (signal.aborted) return { kind: 'timeout' };
    return { kind: 'network' };
  }
  try {
    return { kind: 'ok', status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { kind: 'malformed', status: response.status };
  }
}

/**
 * The failure for a non-`ok` outcome. `notFound` is the text for a 404 (and callers map provider
 * "unknown symbol" bodies to the same text).
 */
export function failureFor(
  key: string,
  outcome: Exclude<HttpOutcome, { kind: 'ok' }>,
  notFound = 'Symbol not found',
): QuoteFailure {
  switch (outcome.kind) {
    case 'aborted':
      return { key, error: 'Aborted', retryable: true, skipped: true };
    case 'timeout':
      return { key, error: 'Request timed out', retryable: true };
    case 'network':
      return { key, error: 'Network error', retryable: true };
    case 'malformed':
      return { key, error: 'Malformed response', retryable: true };
    case 'http': {
      const { status } = outcome;
      if (status === 404) return { key, error: notFound, retryable: false };
      if (status === 429 || status === 403) {
        const failure: QuoteFailure = {
          key,
          error: 'Rate limited',
          retryable: true,
          rateLimited: true,
        };
        if (outcome.retryAfterMs !== undefined) failure.retryAfterMs = outcome.retryAfterMs;
        return failure;
      }
      return { key, error: `HTTP ${status}`, retryable: status >= 500 };
    }
  }
}

/** A `Sleep` on an injectable clock (fake timers in tests). */
export function clockSleep(clock: Clock): Sleep {
  return (ms, signal) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || signal.aborted) {
        resolve();
        return;
      }
      const done = (): void => {
        clock.clearTimeout(handle);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const handle = clock.setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Unix seconds → ISO timestamp, or null when not a sane positive number. */
export function unixToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const d = new Date(value * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
