// An in-memory, fully migrated database for tests (importer, server, schema).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tables, type JoinrDb } from '../db/index';

/** The committed migrations (`apps/server/migrations`). */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../apps/server/migrations', import.meta.url),
);

/**
 * How many migrations are committed: the entry count of `meta/_journal.json` next to
 * `MIGRATIONS_DIR`. Tests that assert a migration count use this instead of a literal, so a new
 * migration never needs those assertions edited (stage-2.md §3.2).
 */
export const COMMITTED_MIGRATION_COUNT: number = (
  JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  }
).entries.length;

export interface TestDb {
  sqlite: Database.Database;
  db: JoinrDb;
  close(): void;
}

/**
 * `:memory:` SQLite with the server's connection pragmas (foreign keys on, busy timeout, NORMAL
 * sync; WAL does not apply to memory databases) and every migration applied.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema: tables });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    sqlite,
    db,
    close: () => {
      if (sqlite.open) sqlite.close();
    },
  };
}
