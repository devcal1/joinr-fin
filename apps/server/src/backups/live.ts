// Reading the live database without changing it (stage-7.md §5.5 "every read before --yes is
// read-only", §5.7 the import CLI's running check).
//
// A read-only better-sqlite3 connection never checkpoints, but on a cleanly closed WAL database
// (no `-wal` beside it) SQLite would still create empty `-wal`/`-shm` files next to it. So:
//   - `-wal` present (the app is running, or crashed): a read-only connection on the live file;
//   - otherwise the file is complete on its own: it is copied to a hidden probe in DATA_DIR
//     (`.finance.db.restoring-probe`, swept by the leftover cleanup) and the probe is read.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DB_FILE_NAME } from '../config';
import { META_KEYS } from '../db/meta';
import { removeWithSidecars } from './copy';

/** The hidden probe copy's name (matches the `.finance.db.restoring*` cleanup of §5.2). */
export const LIVE_PROBE_NAME = `.${DB_FILE_NAME}.restoring-probe`;

/**
 * Runs `fn` on a read-only view of the live database `dbFile`. Throws when the file cannot be
 * opened or read (a damaged file); the caller decides what that means.
 */
export function withLiveReadOnly<T>(dbFile: string, fn: (db: Database.Database) => T): T {
  if (existsSync(`${dbFile}-wal`)) {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }
  const probe = join(dirname(dbFile), LIVE_PROBE_NAME);
  removeWithSidecars(probe);
  copyFileSync(dbFile, probe);
  try {
    const db = new Database(probe, { fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    removeWithSidecars(probe);
  }
}

export type RunningMarker =
  | { state: 'none' }
  | { state: 'missing' }
  | { state: 'set'; since: string }
  | { state: 'unreadable' };

/** `server.running_since` of the live database, read without changing it. */
export function readRunningMarker(dbFile: string): RunningMarker {
  if (!existsSync(dbFile)) return { state: 'missing' };
  try {
    return withLiveReadOnly(dbFile, (db) => {
      const table = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
        .get();
      if (table === undefined) return { state: 'none' } as const;
      const row = db
        .prepare('SELECT value FROM app_meta WHERE key = ?')
        .get(META_KEYS.runningSince) as { value: string } | undefined;
      return row ? ({ state: 'set', since: row.value } as const) : ({ state: 'none' } as const);
    });
  } catch {
    return { state: 'unreadable' };
  }
}

/** The CLIs' exit-6 message (§5.5 step 3, §5.7). */
export const APP_RUNNING_MESSAGE =
  'The app appears to be running (or did not shut down cleanly). Stop the app; if it is stopped, re-run with --force.';
