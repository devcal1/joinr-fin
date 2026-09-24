import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  countAppliedMigrations,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../src/db/database';
import { getMeta, META_KEYS, recordStartup, setMeta } from '../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from './helpers';

let tempDir: string;
const opened: AppDatabase[] = [];

function open(dataDir = join(tempDir, 'data')): AppDatabase {
  const database = openDatabase(dataDir);
  opened.push(database);
  return database;
}

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  for (const database of opened.splice(0)) closeDatabase(database);
  await removeDir(tempDir);
});

describe('openDatabase', () => {
  it('creates the data folder and finance.db', () => {
    const dataDir = join(tempDir, 'nested', 'data');
    open(dataDir);
    expect(existsSync(join(dataDir, 'finance.db'))).toBe(true);
  });

  it('applies the connection pragmas', () => {
    const { sqlite } = open();
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
  });

  it('closes idempotently', () => {
    const database = open();
    closeDatabase(database);
    expect(database.sqlite.open).toBe(false);
    expect(() => closeDatabase(database)).not.toThrow();
  });
});

describe('runMigrations', () => {
  it('applies the migrations and creates app_meta', () => {
    const database = open();
    expect(countAppliedMigrations(database.sqlite)).toBe(0);

    const result = runMigrations(database, MIGRATIONS_DIR);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.total).toBe(result.applied);

    const columns = database.sqlite.prepare('PRAGMA table_info(app_meta)').all() as {
      name: string;
      notnull: number;
      pk: number;
    }[];
    expect(columns.map((c) => c.name)).toEqual(['key', 'value', 'updated_at']);
    expect(columns.find((c) => c.name === 'key')?.pk).toBe(1);
  });

  it('is idempotent, including across restarts', () => {
    const dataDir = join(tempDir, 'data');
    const first = open(dataDir);
    const initial = runMigrations(first, MIGRATIONS_DIR);
    expect(runMigrations(first, MIGRATIONS_DIR)).toEqual({ applied: 0, total: initial.total });
    closeDatabase(first);

    const second = open(dataDir);
    expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({ applied: 0, total: initial.total });
  });

  it('explains a missing migrations folder', () => {
    const database = open();
    expect(() => runMigrations(database, join(tempDir, 'nowhere'))).toThrow(
      /No migrations found in .*nowhere.*MIGRATIONS_DIR/s,
    );
  });
});

describe('app_meta', () => {
  it('records created_at once and last_started_at on every start', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    const { db } = database;

    const first = new Date('2026-08-18T01:00:00.000Z');
    const second = new Date('2026-08-19T02:30:00.000Z');
    recordStartup(db, first);
    expect(getMeta(db, META_KEYS.createdAt)).toBe(first.toISOString());
    expect(getMeta(db, META_KEYS.lastStartedAt)).toBe(first.toISOString());

    recordStartup(db, second);
    expect(getMeta(db, META_KEYS.createdAt)).toBe(first.toISOString());
    expect(getMeta(db, META_KEYS.lastStartedAt)).toBe(second.toISOString());
  });

  it('upserts arbitrary keys', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    expect(getMeta(database.db, 'example')).toBeUndefined();
    setMeta(database.db, 'example', 'one');
    setMeta(database.db, 'example', 'two');
    expect(getMeta(database.db, 'example')).toBe('two');
  });
});
