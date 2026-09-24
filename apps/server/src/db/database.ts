// SQLite connection and migrations (better-sqlite3 + Drizzle).
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DB_FILE_NAME } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface AppDatabase {
  /** The raw better-sqlite3 handle (pragmas, health checks, close). */
  sqlite: Database.Database;
  /** The Drizzle wrapper used for queries. */
  db: Db;
}

/** Drizzle's bookkeeping table (its default name). */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Creates `dataDir` if needed, opens `<dataDir>/finance.db` and applies the connection pragmas:
 * WAL journal, enforced foreign keys, a 5 s busy timeout and NORMAL sync (safe with WAL).
 */
export function openDatabase(dataDir: string, fileName: string = DB_FILE_NAME): AppDatabase {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, fileName));
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('synchronous = NORMAL');
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/** Closes the connection if it is still open. Safe to call twice. */
export function closeDatabase(database: AppDatabase): void {
  if (database.sqlite.open) database.sqlite.close();
}

/** How many migrations Drizzle has recorded as applied (0 on a fresh database). */
export function countAppliedMigrations(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return 0;
  const row = sqlite.prepare(`SELECT count(*) AS n FROM "${MIGRATIONS_TABLE}"`).get() as {
    n: number;
  };
  return row.n;
}

export interface MigrationResult {
  /** Migrations applied by this call. */
  applied: number;
  /** Migrations recorded in the database afterwards. */
  total: number;
}

/**
 * Applies pending migrations from `migrationsDir` (the drizzle-kit output folder) in one
 * transaction. Idempotent: a second run applies nothing.
 */
export function runMigrations(database: AppDatabase, migrationsDir: string): MigrationResult {
  if (!existsSync(join(migrationsDir, 'meta', '_journal.json'))) {
    throw new Error(
      `No migrations found in ${migrationsDir} (expected meta/_journal.json). ` +
        'Set MIGRATIONS_DIR, or run the server from a full checkout or image.',
    );
  }
  const before = countAppliedMigrations(database.sqlite);
  migrate(database.db, { migrationsFolder: migrationsDir });
  const total = countAppliedMigrations(database.sqlite);
  return { applied: total - before, total };
}
