// The one thing a NAS-copy log line may say about an unexpected error (stage-8.md §5.12): its
// `code` or `name`, and only when it has the shape of one. A dependency's `code` or `name` is a
// free string that could carry an address, a path or a value, so anything that does not look
// like a system code (`EACCES`, `SQLITE_FULL`, `ERR_INVALID_ARG_VALUE`) or an error class name
// (`TypeError`, `AbortError`, `RsyncStartError`) is logged as `unknown`.

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;
const NAME_RE = /^[A-Z][A-Za-z]{0,38}Error$/;

/** An allowlisted `code`, else an allowlisted `name`, else `unknown`. */
export function safeErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CODE_RE.test(code)) return code;
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && NAME_RE.test(name)) return name;
  return 'unknown';
}

/** An allowlisted system `code` only, else `fallback` (the runner and the secrets reader). */
export function safeSystemCode(err: unknown, fallback = 'UNKNOWN'): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE_RE.test(code) ? code : fallback;
}
