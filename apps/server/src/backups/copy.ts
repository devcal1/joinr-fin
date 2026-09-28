// The verified copy (stage-7.md §5.3), used by every kind of backup: space check → `VACUUM INTO`
// a hidden temporary file → make the copy self-consistent → verify it → fsync, rename to the final
// name (atomic), fsync the folder → prune the kind's own set. A failed backup never prunes, so it
// never reduces what is kept. A listed file is therefore always complete and verified.
//
// Errors are categories (`BackupError.reason`): the raw error is logged by the caller with its
// `code` only, never its message or a path.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { BACKUP_FAILURE_MESSAGES, type BackupFailureReason, type BackupKind } from '@joinr/schema';
import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { DB_FILE_NAME } from '../config';
import { countAppliedMigrations, type AppDatabase } from '../db/database';
import { META_KEYS } from '../db/meta';
import { INTERRUPTED_ERROR } from '../db/queries/domain';
import { HttpError } from '../errors';
import { BACKUPS_DIR_NAME, localCompactDate, nextFreeBackupName } from './names';
import { retain } from './retention';

/** Free space needed beyond twice the live database (the copy and its temporary). */
export const BACKUP_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;

/** A failed backup, by category (§4.1); a 500 `BACKUP_FAILED` whose message reaches the client. */
export class BackupError extends HttpError {
  readonly reason: BackupFailureReason;
  /** The underlying error's `code` (e.g. `ENOSPC`, `SQLITE_CORRUPT`), for the log only. */
  readonly causeCode: string | undefined;

  constructor(reason: BackupFailureReason, causeCode?: string) {
    super(500, BACKUP_FAILURE_MESSAGES[reason], 'BACKUP_FAILED', { expose: true });
    this.name = 'BackupError';
    this.reason = reason;
    this.causeCode = causeCode;
  }
}

/** The `code` of an error, if it has a string one. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Free bytes for unprivileged users on the volume holding `dir`; null when unavailable. */
export type StatfsFn = (dir: string) => number | null;

export const defaultStatfs: StatfsFn = (dir) => {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
};

/** The copy step: `VACUUM INTO` the target. Tests pass an async fake (the join tests, §5.4). */
export type CopyFn = (sqlite: Database.Database, target: string) => void | Promise<void>;
/** A synchronous copy step (the default, and every production caller). */
export type SyncCopyFn = (sqlite: Database.Database, target: string) => void;

/** The default copy: synchronous `VACUUM INTO ?` with a bound parameter (never string-built SQL). */
export const vacuumInto: SyncCopyFn = (sqlite, target) => {
  sqlite.prepare('VACUUM INTO ?').run(target);
};

export interface WriteBackupOptions<C extends CopyFn = CopyFn> {
  /** The backup's own `job_runs` row (the scheduler inserted it as `running`). */
  jobRunId?: number;
  /** The settled nightly slot, local ISO with offset (written into the copy's own run detail). */
  slot?: string;
  copy?: C;
  statfs?: StatfsFn;
  /** Runs on the temporary file before verification (tests corrupt it). */
  beforeVerify?: (tempPath: string) => void;
  /** Deletes a pruned file (tests make it throw `EBUSY`). */
  unlink?: (path: string) => void;
  /** A file of the kind the prune must not delete this time (the restore's own candidate). */
  keep?: string;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
}

export interface BackupWritten {
  name: string;
  path: string;
  sizeBytes: number;
  durationMs: number;
  /** Files of the same kind the prune deleted. */
  pruned: string[];
  /** Files of the same kind dated too far ahead (never pruned; logged once per run). */
  future: string[];
}

const SIDE_SUFFIXES = ['', '-journal', '-wal', '-shm'] as const;

/** Deletes a file and any SQLite sidecar beside it; never throws. */
export function removeWithSidecars(path: string): void {
  for (const suffix of SIDE_SUFFIXES) {
    try {
      rmSync(`${path}${suffix}`, { force: true });
    } catch {
      // Best effort: the leftover cleanup at the next start retries.
    }
  }
}

/** fsync a file by path. */
export function fsyncFile(path: string): void {
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** fsync a folder; skipped where the platform refuses (Windows). */
export function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, 'r');
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // EPERM/EISDIR/EINVAL on Windows: folder fsync is not supported there.
  } finally {
    closeSync(fd);
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * The leftover cleanup (§5.2; at the service's start and the restore CLI's start): every
 * `.*.partial*` file in `backups/` and every `.finance.db.restoring*` file in DATA_DIR. Hidden
 * folders (`.unverified-pre-restore-*`) and anything else are never touched. Returns the names.
 */
export function cleanLeftovers(dataDir: string): string[] {
  const removed: string[] = [];
  const sweep = (dir: string, match: (name: string) => boolean): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !match(e.name)) continue;
      try {
        rmSync(join(dir, e.name), { force: true });
        removed.push(e.name);
      } catch {
        // Left for the next start.
      }
    }
  };
  sweep(join(dataDir, BACKUPS_DIR_NAME), (n) => n.startsWith('.') && n.includes('.partial'));
  sweep(dataDir, (n) => n.startsWith(`.${DB_FILE_NAME}.restoring`));
  return removed;
}

/** Makes the copy self-consistent (§5.3 step 3) and verifies it (step 4), on one connection. */
function settleAndVerify(
  tempPath: string,
  liveMigrations: number,
  at: Date,
  opts: WriteBackupOptions,
  kind: BackupKind,
  name: string,
): void {
  const copy = new Database(tempPath, { fileMustExist: true });
  try {
    copy.pragma('journal_mode = DELETE');
    copy.prepare('DELETE FROM app_meta WHERE key = ?').run(META_KEYS.runningSince);
    const finishedAt = at.toISOString();
    if (opts.jobRunId !== undefined) {
      const detail = {
        kind,
        name,
        ...(opts.slot !== undefined ? { slot: opts.slot } : {}),
        verified: true,
      };
      copy
        .prepare(
          "UPDATE job_runs SET status = 'succeeded', finished_at = ?, detail_json = ?, error = NULL WHERE id = ?",
        )
        .run(finishedAt, JSON.stringify(detail), opts.jobRunId);
    }
    copy
      .prepare(
        "UPDATE job_runs SET status = 'failed', finished_at = ?, error = ? WHERE status = 'running' AND id IS NOT ?",
      )
      .run(finishedAt, INTERRUPTED_ERROR, opts.jobRunId ?? null);
  } finally {
    copy.close();
  }
  opts.beforeVerify?.(tempPath);
  // A fresh connection, so the check reads the file as it is on disk (no cached pages).
  verifyCopy(tempPath, liveMigrations);
}

/** §5.3 step 4: `integrity_check` = ok, the migration count, `app_meta.created_at`. */
function verifyCopy(tempPath: string, liveMigrations: number): void {
  const copy = new Database(tempPath, { fileMustExist: true });
  try {
    const check = copy.pragma('integrity_check') as { integrity_check: string }[];
    if (check.length !== 1 || check[0]?.integrity_check !== 'ok') {
      throw new BackupError('verify_failed');
    }
    if (countAppliedMigrations(copy) !== liveMigrations) throw new BackupError('verify_failed');
    const created = copy.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(META_KEYS.createdAt);
    if (created === undefined) throw new BackupError('verify_failed');
  } finally {
    copy.close();
  }
}

const VERIFY_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_CORRUPT_VTAB']);
const SPACE_CODES = new Set(['ENOSPC', 'SQLITE_FULL']);

/** An error from any step → its category. */
function categorise(err: unknown): BackupError {
  if (err instanceof BackupError) return err;
  const code = errorCode(err);
  if (code !== undefined && SPACE_CODES.has(code)) return new BackupError('no_space', code);
  if (code !== undefined && VERIFY_CODES.has(code)) return new BackupError('verify_failed', code);
  return new BackupError('io', code);
}

interface Prepared {
  dir: string;
  name: string;
  tempPath: string;
  finalPath: string;
  liveMigrations: number;
  startedAt: number;
}

function prepare(
  database: AppDatabase,
  dataDir: string,
  kind: BackupKind,
  now: Date,
  opts: WriteBackupOptions,
): Prepared {
  const startedAt = Date.now();
  const dir = join(dataDir, BACKUPS_DIR_NAME);
  mkdirSync(dir, { recursive: true });

  // 1. Space: twice the live database (file + WAL) plus a margin; statfs unavailable → skipped.
  const free = (opts.statfs ?? defaultStatfs)(dataDir);
  if (free !== null) {
    const live = database.sqlite.name;
    const liveBytes =
      live === ':memory:' || live === '' ? 0 : fileSize(live) + fileSize(`${live}-wal`);
    if (free < 2 * liveBytes + BACKUP_SPACE_MARGIN_BYTES) throw new BackupError('no_space');
  }

  // A database only a CLI ever opened has no `created_at` yet; the copy's check needs it.
  database.sqlite
    .prepare(
      'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
    )
    .run(META_KEYS.createdAt, now.toISOString(), now.toISOString());

  const existing = new Set(readdirSync(dir));
  const name = nextFreeBackupName(kind, now, (n) => existing.has(n));
  const tempPath = join(dir, `.${name}.partial`);
  removeWithSidecars(tempPath);
  return {
    dir,
    name,
    tempPath,
    finalPath: join(dir, name),
    liveMigrations: countAppliedMigrations(database.sqlite),
    startedAt,
  };
}

function finish(
  p: Prepared,
  kind: BackupKind,
  now: Date,
  opts: WriteBackupOptions,
): Omit<BackupWritten, 'pruned' | 'future'> {
  // 3–4. Self-consistent, then verified (any failure deletes the temporary file and sidecars).
  settleAndVerify(p.tempPath, p.liveMigrations, now, opts, kind, p.name);
  // A single self-contained file (journal_mode DELETE): no sidecar should remain.
  for (const suffix of ['-journal', '-wal', '-shm']) {
    rmSync(`${p.tempPath}${suffix}`, { force: true });
  }
  // 5. Durable, then atomic.
  fsyncFile(p.tempPath);
  renameSync(p.tempPath, p.finalPath);
  fsyncDir(p.dir);
  return {
    name: p.name,
    path: p.finalPath,
    sizeBytes: statSync(p.finalPath).size,
    durationMs: Date.now() - p.startedAt,
  };
}

/**
 * 6. Prune the kind's own set, only after a verified copy. A delete that fails (`EBUSY`/`EPERM`,
 * e.g. a download streaming the file on Windows) is logged and skipped; the next prune retries.
 */
export function pruneKind(
  dir: string,
  kind: BackupKind,
  now: Date,
  opts: Pick<WriteBackupOptions, 'unlink' | 'log' | 'keep'> = {},
): { pruned: string[]; future: string[] } {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return { pruned: [], future: [] };
  }
  const plan = retain(names, kind, { instant: now, localDate: localCompactDate(now) });
  const unlink = opts.unlink ?? ((path: string) => rmSync(path));
  const pruned: string[] = [];
  for (const name of plan.remove) {
    if (name === opts.keep) continue;
    try {
      unlink(join(dir, name));
      pruned.push(name);
    } catch (err) {
      opts.log?.warn({ code: errorCode(err), file: name }, 'backup: could not delete an old copy');
    }
  }
  if (plan.future.length > 0) {
    opts.log?.warn(
      { files: plan.future },
      'backup: files dated in the future are kept as they are',
    );
  }
  return { pruned, future: plan.future };
}

function complete(
  p: Prepared,
  kind: BackupKind,
  now: Date,
  opts: WriteBackupOptions,
): BackupWritten {
  let written: Omit<BackupWritten, 'pruned' | 'future'>;
  try {
    written = finish(p, kind, now, opts);
  } catch (err) {
    removeWithSidecars(p.tempPath);
    throw categorise(err);
  }
  return { ...written, ...pruneKind(p.dir, kind, now, opts) };
}

/**
 * Writes a verified `kind` copy of the live database into `<dataDir>/backups/` named for `now`,
 * then prunes that kind. Synchronous (the default copy): nothing else in the process runs
 * meanwhile. Throws a `BackupError`.
 */
export function writeVerifiedBackup(
  database: AppDatabase,
  dataDir: string,
  kind: BackupKind,
  now: Date,
  opts: WriteBackupOptions<SyncCopyFn> = {},
): BackupWritten {
  const out = writeVerifiedBackupWith(database, dataDir, kind, now, opts);
  if (out instanceof Promise) throw new Error('writeVerifiedBackup: the copy must be synchronous');
  return out;
}

/**
 * `writeVerifiedBackup` through any copy seam: synchronous (a result) with a synchronous copy, a
 * promise when `opts.copy` returns one (the service's join tests, §5.4). Throws (or rejects
 * with) a `BackupError`.
 */
export function writeVerifiedBackupWith(
  database: AppDatabase,
  dataDir: string,
  kind: BackupKind,
  now: Date,
  opts: WriteBackupOptions = {},
): BackupWritten | Promise<BackupWritten> {
  let p: Prepared;
  try {
    p = prepare(database, dataDir, kind, now, opts);
  } catch (err) {
    throw categorise(err);
  }
  const copy: CopyFn = opts.copy ?? vacuumInto;
  let pending: unknown;
  try {
    pending = copy(database.sqlite, p.tempPath);
  } catch (err) {
    removeWithSidecars(p.tempPath);
    throw categorise(err);
  }
  if (pending instanceof Promise) {
    return (pending as Promise<void>).then(
      () => complete(p, kind, now, opts),
      (err: unknown) => {
        removeWithSidecars(p.tempPath);
        throw categorise(err);
      },
    );
  }
  return complete(p, kind, now, opts);
}
