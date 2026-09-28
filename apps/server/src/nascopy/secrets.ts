// The NAS files (stage-8.md §5.2; D126, D132: exactly `nas-url` and `nas-password`, both or
// neither). The app only READS them: it never creates, changes, lists or deletes anything in
// `<DATA_DIR>/secrets/`. They are read afresh on every copy, status request and timer wake, so
// the helper's changes take effect without a restart.
//
// One file: `lstat` must be a regular file (a symlink, a folder or anything else is present but
// unusable), at most NAS_SECRET_MAX_BYTES, opened with O_NOFOLLOW where the platform has it, UTF-8;
// the value is the first line (a trailing `\r` dropped), trimmed; empty means absent.
//
// The password's value is returned by `readForCopy()` only (the copy's local scope, §5.2); every
// other reader sees `usable` or `unusable`. Nothing here logs a value, a path or an error message:
// a folder that cannot be read logs its error code once per change of that code.
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';
import { NAS_SECRET_FILES, NAS_SECRET_MAX_BYTES, NAS_SECRETS_DIR } from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { safeSystemCode } from './errorCode';

/** `nas-url`: its first line when present (the address rule decides whether it is usable). */
export type UrlFile =
  | { state: 'absent' }
  | { state: 'unusable'; mtimeMs: number }
  | { state: 'present'; mtimeMs: number; line: string };

/** `nas-password`: never its value here. */
export type PasswordFile = { state: 'absent' } | { state: 'unusable' | 'usable'; mtimeMs: number };

export interface NasFiles {
  url: UrlFile;
  password: PasswordFile;
}

/** The part of `fs.lstatSync` the reader uses (a test seam for an unreadable folder). */
export type LstatFn = (path: string) => { isFile(): boolean; size: number; mtimeMs: number };

export interface SecretsReader {
  /** Both files; the password only as usable or unusable. */
  read(): NasFiles;
  /** The copy's read (§5.5 step 1): the files, and the password's value when it is usable. */
  readForCopy(): { files: NasFiles; password: string | null };
  /** The two files' modification times now (null: absent or unreadable). */
  mtimes(): { url: number | null; password: number | null };
}

/** A control character (NUL included) makes a password unusable (§5.2, §5.4). */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Codes that mean "this file is not there". */
const ABSENT_CODES = new Set(['ENOENT', 'ENOTDIR']);

type Raw =
  | { state: 'absent' }
  | { state: 'unusable'; mtimeMs: number }
  | { state: 'present'; mtimeMs: number; line: string };

class FolderError extends Error {
  constructor(readonly code: string) {
    super('The NAS files folder cannot be read');
    this.name = 'FolderError';
  }
}

/** The error's system code, allowlisted (a free-form `code` becomes UNKNOWN, §5.12). */
const codeOf = (err: unknown): string => safeSystemCode(err);

/** The first line, a trailing `\r` dropped, trimmed. */
export function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  let line = newline === -1 ? text : text.slice(0, newline);
  if (line.endsWith('\r')) line = line.slice(0, -1);
  return line.trim();
}

function readRaw(path: string, lstat: LstatFn): Raw {
  let st: ReturnType<LstatFn>;
  try {
    st = lstat(path);
  } catch (err) {
    const code = codeOf(err);
    if (ABSENT_CODES.has(code)) return { state: 'absent' };
    throw new FolderError(code);
  }
  const mtimeMs = st.mtimeMs;
  if (!st.isFile() || st.size > NAS_SECRET_MAX_BYTES) return { state: 'unusable', mtimeMs };
  const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | noFollow);
  } catch (err) {
    // Removed between lstat and open: absent. Anything else (a permission): present, unusable.
    return ABSENT_CODES.has(codeOf(err)) ? { state: 'absent' } : { state: 'unusable', mtimeMs };
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > NAS_SECRET_MAX_BYTES) {
      return { state: 'unusable', mtimeMs };
    }
    const buffer = Buffer.alloc(NAS_SECRET_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n <= 0) break;
      length += n;
      if (length > NAS_SECRET_MAX_BYTES) return { state: 'unusable', mtimeMs };
    }
    const line = firstLine(buffer.subarray(0, length).toString('utf8'));
    buffer.fill(0);
    return line === '' ? { state: 'absent' } : { state: 'present', mtimeMs, line };
  } catch {
    return { state: 'unusable', mtimeMs };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Nothing to do: the descriptor is gone either way.
    }
  }
}

/**
 * The reader for one DATA_DIR. It keeps only the last folder error code (to warn once per change
 * of it); never a value.
 */
export function createSecretsReader(o: {
  dataDir: string;
  log?: FastifyBaseLogger;
  lstat?: LstatFn;
}): SecretsReader {
  const dir = join(o.dataDir, NAS_SECRETS_DIR);
  const urlPath = join(dir, NAS_SECRET_FILES.url);
  const passwordPath = join(dir, NAS_SECRET_FILES.password);
  const lstat: LstatFn = o.lstat ?? ((p) => lstatSync(p));
  let lastFolderCode: string | null = null;

  /** Both raw files, or null when the folder cannot be read (every file absent, §5.2). */
  function readBoth(): { url: Raw; password: Raw } | null {
    try {
      const both = { url: readRaw(urlPath, lstat), password: readRaw(passwordPath, lstat) };
      lastFolderCode = null;
      return both;
    } catch (err) {
      const code = err instanceof FolderError ? err.code : codeOf(err);
      if (code !== lastFolderCode) {
        lastFolderCode = code;
        o.log?.warn({ code }, 'nas-copy: the NAS files folder cannot be read');
      }
      return null;
    }
  }

  function toFiles(both: { url: Raw; password: Raw } | null): NasFiles {
    if (both === null) return { url: { state: 'absent' }, password: { state: 'absent' } };
    const p = both.password;
    const password: PasswordFile =
      p.state === 'absent'
        ? { state: 'absent' }
        : {
            state: p.state === 'present' && !CONTROL_RE.test(p.line) ? 'usable' : 'unusable',
            mtimeMs: p.mtimeMs,
          };
    return { url: both.url, password };
  }

  function mtimeOf(path: string): number | null {
    try {
      return lstat(path).mtimeMs;
    } catch {
      return null;
    }
  }

  return {
    read: () => toFiles(readBoth()),
    readForCopy() {
      const both = readBoth();
      const files = toFiles(both);
      const password =
        files.password.state === 'usable' && both?.password.state === 'present'
          ? both.password.line
          : null;
      return { files, password };
    },
    mtimes: () => ({ url: mtimeOf(urlPath), password: mtimeOf(passwordPath) }),
  };
}
