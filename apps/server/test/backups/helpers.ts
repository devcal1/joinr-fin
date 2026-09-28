// Backup test helpers (stage-7.md §5.11): a live database in a temp DATA_DIR, a recording logger,
// file hashes. Every value is generic; never `data/`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedGenericData } from '@joinr/schema/testing';
import type { FastifyBaseLogger } from 'fastify';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { recordStartup } from '../../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from '../helpers';

export interface LiveDb {
  tempDir: string;
  dataDir: string;
  database: AppDatabase;
  /** Closes the connection (if open) and removes the temp folder. */
  cleanup(): Promise<void>;
}

/** A migrated live database at `<temp>/data/finance.db`, optionally seeded with generic rows. */
export async function makeLiveDb(o: { seed?: boolean } = {}): Promise<LiveDb> {
  const tempDir = await makeTempDir('joinr-backups-test-');
  const dataDir = join(tempDir, 'data');
  const database = openDatabase(dataDir);
  runMigrations(database, MIGRATIONS_DIR);
  recordStartup(database.db, new Date('2030-01-01T00:00:00.000Z'));
  if (o.seed) seedGenericData(database.db, { now: new Date('2030-09-01T00:00:00.000Z') });
  return {
    tempDir,
    dataDir,
    database,
    async cleanup() {
      closeDatabase(database);
      await removeDir(tempDir);
    },
  };
}

export interface LogCall {
  level: 'error' | 'warn' | 'info';
  obj: unknown;
  msg: string | undefined;
}

/** A logger that records error/warn/info calls (the no-path checks read them). */
export function recordingLogger(): FastifyBaseLogger & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  const noop = (): void => {};
  const rec =
    (level: LogCall['level']) =>
    (obj: unknown, msg?: string): void => {
      calls.push({ level, obj, msg });
    };
  const logger = {
    level: 'info',
    fatal: noop,
    error: rec('error'),
    warn: rec('warn'),
    info: rec('info'),
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
    calls,
  } as unknown as FastifyBaseLogger & { calls: LogCall[] };
  return logger;
}

/** sha256 of a file, or null when it does not exist. */
export function hashFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The hashes of `finance.db` and `finance.db-wal` in `dataDir` (§5.11: refusals change neither). */
export function liveHashes(dataDir: string): { db: string | null; wal: string | null } {
  return {
    db: hashFile(join(dataDir, 'finance.db')),
    wal: hashFile(join(dataDir, 'finance.db-wal')),
  };
}

export { closeDatabase, openDatabase };
