// An in-memory, fully migrated database for tests (importer, server, schema).
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { tables, type JoinrDb } from '../db/index';

/** The committed migrations (`apps/server/migrations`). */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../apps/server/migrations', import.meta.url),
);

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
