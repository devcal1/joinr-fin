import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  cashAccounts,
  DOMAIN_TABLES_DELETE_ORDER,
  importRuns,
  instruments,
  jobRuns,
  settings,
  trades,
} from '@joinr/schema/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  countAppliedMigrations,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../src/db/database';
import { getMeta, META_KEYS, recordStartup, setMeta } from '../src/db/meta';
import { hasAppData, hasDomainData, markInterruptedRuns } from '../src/db/queries/domain';
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
  it('applies both migrations and creates app_meta', () => {
    const database = open();
    expect(countAppliedMigrations(database.sqlite)).toBe(0);

    const result = runMigrations(database, MIGRATIONS_DIR);
    expect(result).toEqual({ applied: 2, total: 2 });

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

describe('domain helpers', () => {
  it('reports whether imported data exists', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    expect(hasDomainData(database.db)).toBe(false);
    database.db
      .insert(cashAccounts)
      .values({ name: 'Example Bank – Everyday', balanceCents: 0, sortOrder: 1 })
      .run();
    expect(hasDomainData(database.db)).toBe(true);
  });

  it('counts instruments alone as imported data', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    database.db
      .insert(instruments)
      .values({ kind: 'etf', symbol: 'ASX:XYZ', code: 'XYZ', sortOrder: 1 })
      .run();
    expect(hasDomainData(database.db)).toBe(true);
  });

  describe('hasAppData (D34)', () => {
    function migrated(): AppDatabase {
      const database = open();
      runMigrations(database, MIGRATIONS_DIR);
      return database;
    }

    it('is false on an empty database', () => {
      expect(hasAppData(migrated().db)).toBe(false);
    });

    it('counts an app-entered domain row, but not an imported one', () => {
      const { db } = migrated();
      db.insert(cashAccounts)
        .values({ name: 'Example Bank', balanceCents: 0, sortOrder: 1, origin: 'import' })
        .run();
      expect(hasAppData(db)).toBe(false);
      db.insert(cashAccounts)
        .values({ name: 'Example Bank – Savings', balanceCents: 0, sortOrder: 2, origin: 'app' })
        .run();
      expect(hasAppData(db)).toBe(true);
    });

    it('treats a domain row without an explicit origin as app-entered (the column default)', () => {
      const { db } = migrated();
      db.insert(cashAccounts).values({ name: 'Example Bank', balanceCents: 0, sortOrder: 1 }).run();
      expect(hasAppData(db)).toBe(true);
    });

    it('checks a table later in the delete order (trades on an imported instrument)', () => {
      const { db } = migrated();
      const instrumentId = db
        .insert(instruments)
        .values({ kind: 'etf', symbol: 'ASX:ABC', code: 'ABC', sortOrder: 1, origin: 'import' })
        .returning({ id: instruments.id })
        .get().id;
      expect(hasAppData(db)).toBe(false);
      db.insert(trades)
        .values({
          instrumentId,
          tradeDate: '2026-01-02',
          units: '1',
          price: '1.00',
          seq: 1,
          origin: 'app',
        })
        .run();
      expect(hasAppData(db)).toBe(true);
      expect(DOMAIN_TABLES_DELETE_ORDER).toContain(trades);
    });

    it('counts an app-entered instrument, but not an imported one', () => {
      const { db } = migrated();
      db.insert(instruments)
        .values({ kind: 'etf', symbol: 'ASX:ABC', code: 'ABC', sortOrder: 1, origin: 'import' })
        .run();
      expect(hasAppData(db)).toBe(false);
      db.insert(instruments)
        .values({ kind: 'crypto', symbol: 'BTC', code: 'BTC', sortOrder: 2, origin: 'app' })
        .run();
      expect(hasAppData(db)).toBe(true);
    });

    it('counts an app-entered setting, but not an imported one', () => {
      const { db } = migrated();
      const row = { valueJson: '1', updatedAt: '2026-09-24T00:00:00.000Z' };
      db.insert(settings)
        .values({ ...row, key: 'example.imported', origin: 'import' })
        .run();
      expect(hasAppData(db)).toBe(false);
      expect(hasDomainData(db)).toBe(false);
      db.insert(settings)
        .values({ ...row, key: 'example.app', origin: 'app' })
        .run();
      expect(hasAppData(db)).toBe(true);
    });
  });

  it('marks runs left running as failed (interrupted), and nothing else', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    const { db } = database;
    const run = (status: 'running' | 'succeeded') =>
      db
        .insert(importRuns)
        .values({
          startedAt: '2026-09-24T01:00:00.000Z',
          status,
          trigger: 'upload',
          fileName: 'example.xlsx',
          fileSha256: 'a'.repeat(64),
          fileSize: 1,
          importerVersion: '1.0.0',
        })
        .run();
    run('running');
    run('succeeded');
    db.insert(jobRuns)
      .values({
        job: 'prices',
        trigger: 'schedule',
        startedAt: '2026-09-24T01:00:00.000Z',
        status: 'running',
      })
      .run();

    const now = new Date('2026-09-24T02:00:00.000Z');
    expect(markInterruptedRuns(db, now)).toEqual({ importRuns: 1, jobRuns: 1 });
    const imports = db.select().from(importRuns).all();
    expect(imports.map((r) => r.status)).toEqual(['failed', 'succeeded']);
    expect(imports[0]).toMatchObject({
      finishedAt: now.toISOString(),
      errorCode: 'INTERRUPTED',
      error: 'interrupted',
    });
    expect(db.select().from(jobRuns).get()).toMatchObject({
      status: 'failed',
      error: 'interrupted',
    });
    expect(markInterruptedRuns(db, now)).toEqual({ importRuns: 0, jobRuns: 0 });
  });
});
