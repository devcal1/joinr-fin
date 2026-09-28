// Restore (stage-7.md §5.5): validate a backup, check the app is stopped, take a pre-restore
// backup (or, with --force, set a damaged live file aside raw), and swap the database in.
//
// Every read of the live database before --yes is read-only (`withLiveReadOnly`), so a refusal
// never changes `finance.db` or `finance.db-wal`. The candidate is copied to the hidden staging
// file `.finance.db.restoring` in DATA_DIR first and validated there, so opening it never needs to
// create sidecars next to the original; the staging file is what the swap renames into place.
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DB_FILE_NAME, type Config } from '../config';
import { countAppliedMigrations, openDatabase, type AppDatabase } from '../db/database';
import { META_KEYS } from '../db/meta';
import {
  BackupError,
  cleanLeftovers,
  errorCode,
  fsyncDir,
  fsyncFile,
  removeWithSidecars,
  writeVerifiedBackup,
} from './copy';
import { APP_RUNNING_MESSAGE, readRunningMarker, withLiveReadOnly } from './live';
import { readMigrationJournal } from './migrate';
import {
  BACKUPS_DIR_NAME,
  localIsoWithOffset,
  parseBackupName,
  stripDownloadPrefix,
} from './names';

/** Exit codes (§5.5, frozen). */
export const RESTORE_EXIT = {
  restored: 0,
  failed: 1,
  usage: 2,
  confirm: 3,
  invalid: 5,
  running: 6,
} as const;
export type RestoreExitCode = (typeof RESTORE_EXIT)[keyof typeof RESTORE_EXIT];

/** The hidden staging file in DATA_DIR (swept at start by the leftover cleanup). */
export const STAGING_NAME = `.${DB_FILE_NAME}.restoring`;
/** The hidden folder a damaged live database is moved into with --force. */
export const UNVERIFIED_PREFIX = '.unverified-pre-restore-';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export const WAL_CANDIDATE_MESSAGE =
  'This file is a live database with unsaved changes beside it: checkpoint it first, or restore a backup file';
export const LOCKED_MESSAGE = 'Another process has the database open';
export const DAMAGED_LIVE_MESSAGE =
  'The current database could not be backed up (it may be damaged). Re-run with --force to set it aside unverified and restore.';

/** A refusal or failure with its exit code (the message is written for the owner). */
export class RestoreError extends Error {
  readonly exitCode: RestoreExitCode;

  constructor(exitCode: RestoreExitCode, message: string) {
    super(message);
    this.name = 'RestoreError';
    this.exitCode = exitCode;
  }
}

export interface RestoreOptions {
  /** A bare backup name (optionally `joinr-finance-`-prefixed) or a path to a SQLite file. */
  backup: string;
  yes: boolean;
  force: boolean;
  /** Relative paths resolve against this. */
  cwd: string;
  now: Date;
  /** Step 6's WAL checkpoint (tests make it throw). */
  checkpoint?: (sqlite: AppDatabase['sqlite']) => void;
}

export interface CandidateSummary {
  name: string;
  /** Local ISO with offset, from the name when it is a backup name, else the file's mtime. */
  createdAt: string;
  sizeBytes: number;
  level: number;
}

export interface LiveSummary {
  state: 'missing' | 'readable' | 'unreadable';
  level: number | null;
  /** The last committed import's start (UTC ISO), if any. */
  lastImportAt: string | null;
  recordedMonths: number | null;
  newestMonth: string | null;
}

export interface RestoreSummary {
  backup: CandidateSummary;
  live: LiveSummary;
  /** The app's database level (the migrations journal). */
  appLevel: number;
  /** The running marker: 'none', 'set', 'skipped' (live missing or unreadable), 'forced'. */
  marker: 'none' | 'set' | 'skipped' | 'forced';
}

export interface RestoreOutcome {
  exitCode: RestoreExitCode;
  summary: RestoreSummary | null;
  /** The pre-restore backup's name, when one was taken. */
  preRestoreBackup: string | null;
  /** The folder a damaged live database was set aside in (`backups/<name>`), with --force. */
  unverifiedFolder: string | null;
  messages: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

function readHeader(path: string, length: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

const utcStamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

interface ResolvedCandidate {
  path: string;
  /** The bare name for a backups-folder candidate, else the path's basename. */
  name: string;
  isPath: boolean;
}

/** Step 1: a bare name in backups/ (prefix stripped), else a path. Exit 2 when missing. */
export function resolveCandidate(backup: string, dataDir: string, cwd: string): ResolvedCandidate {
  const hasSeparator = /[/\\]/.test(backup);
  if (!hasSeparator) {
    const bare = stripDownloadPrefix(backup);
    if (parseBackupName(bare) !== null) {
      const inFolder = join(dataDir, BACKUPS_DIR_NAME, bare);
      if (existsSync(inFolder)) return { path: inFolder, name: bare, isPath: false };
    }
  }
  const path = isAbsolute(backup) ? backup : resolve(cwd, backup);
  if (!existsSync(path)) {
    throw new RestoreError(RESTORE_EXIT.usage, `No backup named ${basename(backup)} was found`);
  }
  return { path, name: basename(path), isPath: true };
}

/** A validated candidate's level, opened on the staging copy. */
function validateStaged(staging: string, whens: readonly number[]): number {
  let db: Database.Database;
  try {
    db = new Database(staging, { fileMustExist: true });
  } catch {
    throw new RestoreError(RESTORE_EXIT.invalid, 'This file is not a SQLite database');
  }
  try {
    try {
      // A self-contained single file (a WAL-mode copy is converted; the original is untouched).
      db.pragma('journal_mode = DELETE');
      const check = db.pragma('integrity_check') as { integrity_check: string }[];
      if (check.length !== 1 || check[0]?.integrity_check !== 'ok') throw new Error('integrity');
    } catch {
      throw new RestoreError(RESTORE_EXIT.invalid, 'This backup failed its integrity check');
    }
    const hasTable = (name: string): boolean =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
      undefined;
    const notJoinr = new RestoreError(
      RESTORE_EXIT.invalid,
      'This file is not a Joinr Finance database',
    );
    if (!hasTable('app_meta') || !hasTable('__drizzle_migrations')) throw notJoinr;
    if (db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(META_KEYS.createdAt) === undefined) {
      throw notJoinr;
    }
    const rows = db
      .prepare('SELECT created_at AS createdAt FROM __drizzle_migrations ORDER BY rowid')
      .all() as { createdAt: number | string | bigint | null }[];
    const level = rows.length;
    const known = whens.length;
    if (level > known) {
      throw new RestoreError(
        RESTORE_EXIT.invalid,
        `This backup was made by a newer version of the app (database level ${level}; this app knows ${known}). Install that version or newer, then restore.`,
      );
    }
    for (let i = 0; i < level; i++) {
      if (Number(rows[i]?.createdAt) !== whens[i]) {
        throw new RestoreError(
          RESTORE_EXIT.invalid,
          'This backup belongs to a different database (its migration history does not match this app)',
        );
      }
    }
    return level;
  } finally {
    db.close();
  }
}

/** The live database's summary, read without changing it. */
function summariseLive(dbFile: string): LiveSummary {
  if (!existsSync(dbFile)) {
    return {
      state: 'missing',
      level: null,
      lastImportAt: null,
      recordedMonths: null,
      newestMonth: null,
    };
  }
  try {
    return withLiveReadOnly(dbFile, (db) => {
      const level = countAppliedMigrations(db);
      const hasTable = (name: string): boolean =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
        undefined;
      const lastImport = hasTable('import_runs')
        ? (db
            .prepare(
              "SELECT started_at AS at FROM import_runs WHERE status = 'succeeded' AND dry_run = 0 ORDER BY started_at DESC, id DESC LIMIT 1",
            )
            .get() as { at: string } | undefined)
        : undefined;
      const snaps = hasTable('snapshots')
        ? (db.prepare('SELECT count(*) AS n, max(period_month) AS newest FROM snapshots').get() as {
            n: number;
            newest: string | null;
          })
        : { n: 0, newest: null };
      return {
        state: 'readable',
        level,
        lastImportAt: lastImport?.at ?? null,
        recordedMonths: snaps.n,
        newestMonth: snaps.newest,
      } satisfies LiveSummary;
    });
  } catch {
    return {
      state: 'unreadable',
      level: null,
      lastImportAt: null,
      recordedMonths: null,
      newestMonth: null,
    };
  }
}

/**
 * Step 5: a fresh connection with busy_timeout 0 takes an exclusive lock. SQLITE_BUSY → another
 * process (the app, a shell) has the database open. POSIX locks hold across containers on one
 * host filesystem; proved against an idle WAL connection by the tests.
 */
export function assertNotLocked(dbFile: string): void {
  let db: Database.Database;
  try {
    db = new Database(dbFile, { fileMustExist: true, timeout: 0 });
  } catch {
    return; // A file that cannot be opened is handled by the pre-restore step.
  }
  try {
    db.pragma('busy_timeout = 0');
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    db.exec('ROLLBACK');
  } catch (err) {
    if (errorCode(err)?.startsWith('SQLITE_BUSY') || errorCode(err)?.startsWith('SQLITE_LOCKED')) {
      throw new RestoreError(RESTORE_EXIT.running, LOCKED_MESSAGE);
    }
  } finally {
    db.close();
  }
}

// ─── The restore ────────────────────────────────────────────────────────────────────────────────

export function restoreBackup(
  config: Pick<Config, 'dataDir' | 'dbFile' | 'migrationsDir'>,
  opts: RestoreOptions,
): RestoreOutcome {
  const messages: string[] = [];
  const outcome = (
    exitCode: RestoreExitCode,
    summary: RestoreSummary | null,
    extra: Partial<Pick<RestoreOutcome, 'preRestoreBackup' | 'unverifiedFolder'>> = {},
  ): RestoreOutcome => ({
    exitCode,
    summary,
    preRestoreBackup: extra.preRestoreBackup ?? null,
    unverifiedFolder: extra.unverifiedFolder ?? null,
    messages,
  });
  const { dataDir, dbFile } = config;
  const staging = join(dataDir, STAGING_NAME);
  let summary: RestoreSummary | null = null;
  /** Set once step 6 starts moving the live files aside (the generic failure message names it). */
  let setAsideFolder: string | null = null;

  try {
    // 1. The leftovers, the candidate.
    mkdirSync(dataDir, { recursive: true });
    cleanLeftovers(dataDir);
    const candidate = resolveCandidate(opts.backup, dataDir, opts.cwd);
    const liveReal = realpathOrNull(dbFile);
    const candidateReal = realpathOrNull(candidate.path);
    if (liveReal !== null && candidateReal !== null && liveReal === candidateReal) {
      throw new RestoreError(
        RESTORE_EXIT.usage,
        'That is the live database itself: choose a backup',
      );
    }
    let st;
    try {
      st = statSync(candidate.path);
    } catch {
      throw new RestoreError(RESTORE_EXIT.usage, `No backup named ${candidate.name} was found`);
    }
    if (!st.isFile()) {
      throw new RestoreError(RESTORE_EXIT.usage, `${candidate.name} is not a file`);
    }

    // 2. Validate: the header, a WAL-mode path candidate with its -wal, then a staging copy.
    const header = readHeader(candidate.path, 100);
    if (header.length < 16 || !header.subarray(0, 16).equals(SQLITE_HEADER)) {
      throw new RestoreError(RESTORE_EXIT.invalid, 'This file is not a SQLite database');
    }
    if (
      candidate.isPath &&
      header[18] === 2 &&
      header[19] === 2 &&
      existsSync(`${candidate.path}-wal`)
    ) {
      throw new RestoreError(RESTORE_EXIT.invalid, WAL_CANDIDATE_MESSAGE);
    }
    const whens = readMigrationJournal(config.migrationsDir).whens;
    removeWithSidecars(staging);
    copyFileSync(candidate.path, staging);
    const level = validateStaged(staging, whens);
    const backupSummary: CandidateSummary = {
      name: candidate.name,
      createdAt:
        parseBackupName(candidate.name)?.createdAt ?? localIsoWithOffset(new Date(st.mtimeMs)),
      sizeBytes: st.size,
      level,
    };

    // 3. The app must be stopped (the marker; --force skips this check only).
    const live = summariseLive(dbFile);
    let marker: RestoreSummary['marker'] = 'skipped';
    if (live.state === 'readable') {
      const m = readRunningMarker(dbFile);
      if (m.state === 'set') marker = opts.force ? 'forced' : 'set';
      else if (m.state === 'none') marker = 'none';
    }
    summary = { backup: backupSummary, live, appLevel: whens.length, marker };
    if (marker === 'set') throw new RestoreError(RESTORE_EXIT.running, APP_RUNNING_MESSAGE);

    // 4. The summary (printed by the caller); without --yes, stop here.
    if (!opts.yes) {
      removeWithSidecars(staging);
      messages.push('Nothing was changed. Re-run with --yes to restore.');
      return outcome(RESTORE_EXIT.confirm, summary);
    }

    // 5. Nothing else may hold the live database (ignores --force).
    if (live.state !== 'missing') assertNotLocked(dbFile);

    // 6. The pre-restore backup (or the damaged live file set aside with --force).
    let preRestoreBackup: string | null = null;
    let unverifiedFolder: string | null = null;
    if (live.state !== 'missing') {
      let damaged = live.state === 'unreadable';
      let liveDb: AppDatabase | null = null;
      if (!damaged) {
        try {
          liveDb = openDatabase(dataDir);
          // The candidate's own file is never pruned by this copy (restoring the oldest of the
          // pre-restore set would otherwise delete the file being restored; Fixer SPEC-7).
          preRestoreBackup = writeVerifiedBackup(liveDb, dataDir, 'pre-restore', opts.now, {
            ...(candidate.isPath ? {} : { keep: candidate.name }),
          }).name;
        } catch (err) {
          if (err instanceof BackupError && err.reason === 'no_space') {
            if (liveDb !== null && liveDb.sqlite.open) liveDb.sqlite.close();
            throw new RestoreError(
              RESTORE_EXIT.failed,
              'Not enough free space on the server for the pre-restore backup. Nothing was changed.',
            );
          }
          damaged = true;
        }
        // A verified pre-restore copy exists: a checkpoint that fails now is not damage (the file
        // is readable and backed up), so the database is never set aside for it (Fixer F7).
        try {
          if (!damaged && liveDb !== null) {
            (opts.checkpoint ?? ((db) => db.pragma('wal_checkpoint(TRUNCATE)')))(liveDb.sqlite);
          }
        } catch (err) {
          throw new RestoreError(
            RESTORE_EXIT.failed,
            `The current database could not be checkpointed before the swap (${errorCode(err) ?? 'unexpected error'}; another process may have it open). Nothing was changed. The pre-restore copy is ${BACKUPS_DIR_NAME}/${preRestoreBackup ?? ''}.`,
          );
        } finally {
          if (liveDb !== null && liveDb.sqlite.open) liveDb.sqlite.close();
        }
      }
      if (damaged) {
        if (!opts.force) throw new RestoreError(RESTORE_EXIT.failed, DAMAGED_LIVE_MESSAGE);
        const folderName = `${UNVERIFIED_PREFIX}${utcStamp(opts.now)}`;
        const folder = join(dataDir, BACKUPS_DIR_NAME, folderName);
        mkdirSync(folder, { recursive: true });
        setAsideFolder = `${BACKUPS_DIR_NAME}/${folderName}`;
        for (const suffix of ['', '-wal', '-shm']) {
          const from = `${dbFile}${suffix}`;
          if (existsSync(from)) renameSync(from, join(folder, `${DB_FILE_NAME}${suffix}`));
        }
        fsyncDir(join(dataDir, BACKUPS_DIR_NAME));
        unverifiedFolder = `${BACKUPS_DIR_NAME}/${folderName}`;
        preRestoreBackup = null;
        messages.push(
          `The current database could not be backed up; it was set aside unverified in ${unverifiedFolder}/.`,
        );
      }
    }
    const undo = preRestoreBackup
      ? `The pre-restore copy is ${BACKUPS_DIR_NAME}/${preRestoreBackup}: restore it to go back.`
      : unverifiedFolder
        ? `The previous database is in ${unverifiedFolder}/.`
        : '';

    try {
      // 7. Stage: durable and checked again.
      fsyncFile(staging);
      const check = new Database(staging, { readonly: true, fileMustExist: true });
      try {
        const rows = check.pragma('integrity_check') as { integrity_check: string }[];
        if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('integrity');
      } finally {
        check.close();
      }

      // 8. Swap: the sidecars (empty after the checkpoint) go, then an atomic rename.
      rmSync(`${dbFile}-wal`, { force: true });
      rmSync(`${dbFile}-shm`, { force: true });
      renameSync(staging, dbFile);
      fsyncDir(dataDir);

      // 9–10. Post-check, then the markers in the restored database.
      const restored = new Database(dbFile, { fileMustExist: true });
      try {
        const rows = restored.pragma('integrity_check') as { integrity_check: string }[];
        if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('integrity');
        const at = opts.now.toISOString();
        restored
          .prepare(
            'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          )
          .run(
            META_KEYS.restoreLast,
            JSON.stringify({ name: candidate.name, at: localIsoWithOffset(opts.now) }),
            at,
          );
        restored.prepare('DELETE FROM app_meta WHERE key = ?').run(META_KEYS.runningSince);
      } finally {
        restored.close();
      }
    } catch (err) {
      removeWithSidecars(staging);
      const reason =
        err instanceof RestoreError ? err.message : 'The restore could not be finished';
      throw new RestoreError(RESTORE_EXIT.failed, `${reason}. ${undo}`.trim());
    }

    // 11.
    messages.push(
      `Restored ${candidate.name}.${preRestoreBackup ? ` The pre-restore copy is ${BACKUPS_DIR_NAME}/${preRestoreBackup}.` : ''} Start the app.`,
    );
    if (level < whens.length) {
      messages.push(
        `The app will update the database from level ${level} to ${whens.length} when it starts (a pre-update backup is taken first).`,
      );
    }
    return outcome(RESTORE_EXIT.restored, summary, { preRestoreBackup, unverifiedFolder });
  } catch (err) {
    removeWithSidecars(staging);
    if (err instanceof RestoreError) {
      messages.push(err.message);
      return outcome(err.exitCode, summary);
    }
    messages.push(
      setAsideFolder === null
        ? `The restore failed (${errorCode(err) ?? 'unexpected error'}). The current database was not replaced.`
        : `The restore failed (${errorCode(err) ?? 'unexpected error'}) after the current database was moved aside: its files are in ${setAsideFolder}/ (move them back to ${DB_FILE_NAME} to undo).`,
    );
    return outcome(RESTORE_EXIT.failed, summary);
  }
}
