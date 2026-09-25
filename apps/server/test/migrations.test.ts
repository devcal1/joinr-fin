// Migrations are append-only (stage-1.md §2.1, §7.2 step 3; stage-2.md §3.1): a fresh database
// reaches every committed migration, Stage 0 and Stage 1 databases upgrade cleanly and keep their
// data, and the FKs behave as specified. Counts come from COMMITTED_MIGRATION_COUNT, never literals.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMITTED_MIGRATION_COUNT,
  createTestDb,
  DUMPED_TABLES,
  dumpDomainTables,
  seedGenericData,
  type DomainDump,
} from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  countAppliedMigrations,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../src/db/database';
import { getMeta, setMeta } from '../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from './helpers';

let tempDir: string;
const opened: AppDatabase[] = [];

function open(dir = join(tempDir, 'data')): AppDatabase {
  const database = openDatabase(dir);
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

const tableNames = (database: AppDatabase): string[] =>
  (
    database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);

/** A copy of the migrations folder that stops after the given tags (an older install). */
function migrationsDirUpTo(tags: readonly string[]): string {
  const dir = join(tempDir, `migrations-${tags.length}`);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const tag of tags) cpSync(join(MIGRATIONS_DIR, `${tag}.sql`), join(dir, `${tag}.sql`));
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => tags.includes(e.tag));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return dir;
}

const STAGE0_TAGS = ['0000_app_meta'];
const STAGE1_TAGS = ['0000_app_meta', '0001_stage1_core'];

/** The columns migration 0002 adds (stage-2.md §3.1). */
const STAGE2_INSTRUMENT_COLUMNS = ['default_fee_cents', 'default_fee_rate'];

/**
 * The generic seed as it would exist in a Stage 1 database: `seedGenericData` on a fully migrated
 * database, dumped, without the Stage 2 columns. (The seed itself cannot write to a database
 * stopped at 0001: Drizzle's insert names every column of the current table definition.)
 */
function stage1SeedDump(): DomainDump {
  const full = createTestDb();
  try {
    seedGenericData(full.db, { now: new Date('2026-09-24T04:32:00.000Z') });
    const dump = dumpDomainTables(full.db);
    dump.instruments = dump.instruments!.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([k]) => !STAGE2_INSTRUMENT_COLUMNS.includes(k)),
      ),
    );
    return dump;
  } finally {
    full.close();
  }
}

/** Inserts a dump with raw SQL (parents first: DUMPED_TABLES order). */
function insertDump(database: AppDatabase, dump: DomainDump): void {
  database.sqlite.transaction(() => {
    for (const { table } of DUMPED_TABLES) {
      for (const row of dump[table] ?? []) {
        const cols = Object.keys(row);
        database.sqlite
          .prepare(
            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .run(...cols.map((c) => row[c]));
      }
    }
  })();
}

const STAGE1_TABLES = [
  'app_meta',
  'settings',
  'instruments',
  'price_sources',
  'prices',
  'market_quotes',
  'trades',
  'dividends',
  'cash_accounts',
  'budget_items',
  'yearly_expenses',
  'income_streams',
  'side_income_entries',
  'period_notes',
  'snapshots',
  'other_assets',
  'super_funds',
  'super_entries',
  'properties',
  'loans',
  'import_runs',
  'job_runs',
];

const columnNames = (database: AppDatabase, table: string): string[] =>
  (database.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
    (c) => c.name,
  );

describe('migrations', () => {
  it('brings a fresh database to every committed migration with every table', () => {
    expect(COMMITTED_MIGRATION_COUNT).toBeGreaterThanOrEqual(3);
    const database = open();
    expect(runMigrations(database, MIGRATIONS_DIR)).toEqual({
      applied: COMMITTED_MIGRATION_COUNT,
      total: COMMITTED_MIGRATION_COUNT,
    });
    expect(tableNames(database)).toEqual(expect.arrayContaining(STAGE1_TABLES));
    expect(columnNames(database, 'instruments')).toEqual(
      expect.arrayContaining(STAGE2_INSTRUMENT_COLUMNS),
    );
  });

  it('upgrades a Stage 0 database (0000 only) and keeps its data', () => {
    const dataDir = join(tempDir, 'stage0');
    const first = open(dataDir);
    expect(runMigrations(first, migrationsDirUpTo(STAGE0_TAGS))).toEqual({
      applied: 1,
      total: 1,
    });
    setMeta(first.db, 'created_at', '2026-08-18T01:00:00.000Z');
    closeDatabase(first);

    const second = open(dataDir);
    expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({
      applied: COMMITTED_MIGRATION_COUNT - 1,
      total: COMMITTED_MIGRATION_COUNT,
    });
    expect(countAppliedMigrations(second.sqlite)).toBe(COMMITTED_MIGRATION_COUNT);
    expect(getMeta(second.db, 'created_at')).toBe('2026-08-18T01:00:00.000Z');
    expect(tableNames(second)).toEqual(expect.arrayContaining(STAGE1_TABLES));
  });

  it('upgrades a Stage 1 database with data (0000 + 0001): rows kept, the new columns null', () => {
    const dataDir = join(tempDir, 'stage1');
    const first = open(dataDir);
    expect(runMigrations(first, migrationsDirUpTo(STAGE1_TAGS))).toEqual({
      applied: 2,
      total: 2,
    });
    expect(columnNames(first, 'instruments')).not.toContain('default_fee_cents');
    const seeded = stage1SeedDump();
    insertDump(first, seeded);
    setMeta(first.db, 'created_at', '2026-08-18T01:00:00.000Z');
    closeDatabase(first);

    const second = open(dataDir);
    expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({
      applied: COMMITTED_MIGRATION_COUNT - 2,
      total: COMMITTED_MIGRATION_COUNT,
    });
    expect(getMeta(second.db, 'created_at')).toBe('2026-08-18T01:00:00.000Z');
    const upgraded = dumpDomainTables(second.db);
    const expected: DomainDump = {
      ...seeded,
      instruments: seeded.instruments!.map((row) => ({
        ...row,
        default_fee_cents: null,
        default_fee_rate: null,
      })),
    };
    expect(upgraded).toEqual(expected);
    expect(upgraded.instruments!.length).toBeGreaterThan(0);
    expect(upgraded.trades!.length).toBeGreaterThan(0);
  });

  it('creates integer primary keys without AUTOINCREMENT', () => {
    const database = open();
    runMigrations(database, MIGRATIONS_DIR);
    const { s } = database.sqlite
      .prepare("SELECT group_concat(sql, ' ') AS s FROM sqlite_master")
      .get() as { s: string };
    expect(s).not.toMatch(/AUTOINCREMENT/i);
    expect(tableNames(database)).not.toContain('sqlite_sequence');
  });
});

describe('foreign keys and unique keys', () => {
  let db: AppDatabase;
  const run = (sql: string): void => {
    db.sqlite.prepare(sql).run();
  };
  const count = (table: string): number =>
    (db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const value = (sql: string): unknown => Object.values(db.sqlite.prepare(sql).get() as object)[0];

  beforeEach(() => {
    db = open();
    runMigrations(db, MIGRATIONS_DIR);
    run(
      "INSERT INTO instruments (id, kind, symbol, code, sort_order) VALUES (1, 'etf', 'ASX:XYZ', 'XYZ', 1)",
    );
    run(
      'INSERT INTO price_sources (instrument_id, provider, symbol_origin, updated_at) ' +
        "VALUES (1, 'yahoo', 'derived', '2026-09-24T00:00:00.000Z')",
    );
    run("INSERT INTO prices (instrument_id, price) VALUES (1, '100')");
    run(
      'INSERT INTO trades (instrument_id, trade_date, units, price, seq) ' +
        "VALUES (1, '2025-01-01', '10', '100', 1)",
    );
    run(
      'INSERT INTO dividends (instrument_id, ticker, holding_kind, payment_date, net_amount_cents) ' +
        "VALUES (1, 'XYZ', 'etf', '2025-07-15', 1000)",
    );
  });

  it('cascades an instrument delete to trades, price_sources and prices; nulls dividends', () => {
    run('DELETE FROM instruments WHERE id = 1');
    expect(count('trades')).toBe(0);
    expect(count('price_sources')).toBe(0);
    expect(count('prices')).toBe(0);
    expect(value('SELECT instrument_id FROM dividends')).toBeNull();
  });

  it('cascades a stream delete to its entries; nulls budget, super-entry and loan links', () => {
    run("INSERT INTO income_streams (id, name, sort_order) VALUES (1, 'Side income 1', 1)");
    run(
      'INSERT INTO side_income_entries (stream_id, period_month, amount_cents) ' +
        "VALUES (1, '2026-07', 100)",
    );
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order) VALUES (1, 'Example Bank – Everyday', 0, 1)",
    );
    run(
      "INSERT INTO budget_items (name, kind, cash_account_id, sort_order) VALUES ('Rent', 'item', 1, 1)",
    );
    run(
      "INSERT INTO super_funds (id, name, balance_cents, sort_order) VALUES (1, 'Example Super', 0, 1)",
    );
    run(
      'INSERT INTO super_entries (period_month, kind, fund_id, amount_cents) ' +
        "VALUES ('2026-07', 'reported_gain', 1, 100)",
    );
    run("INSERT INTO properties (id, name, sort_order) VALUES (1, 'Example property', 1)");
    run(
      'INSERT INTO loans (property_id, name, current_balance_cents, sort_order) ' +
        "VALUES (1, 'Example mortgage', 100, 1)",
    );
    run('DELETE FROM income_streams');
    run('DELETE FROM cash_accounts');
    run('DELETE FROM super_funds');
    run('DELETE FROM properties');
    expect(count('side_income_entries')).toBe(0);
    expect(value('SELECT cash_account_id FROM budget_items')).toBeNull();
    expect(value('SELECT fund_id FROM super_entries')).toBeNull();
    expect(value('SELECT property_id FROM loans')).toBeNull();
  });

  it('rejects orphans', () => {
    expect(() =>
      run(
        'INSERT INTO trades (instrument_id, trade_date, units, price, seq) ' +
          "VALUES (99, '2025-01-01', '1', '1', 1)",
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('enforces the unique keys', () => {
    expect(() =>
      run(
        "INSERT INTO instruments (kind, symbol, code, sort_order) VALUES ('etf', 'ASX:XYZ', 'XYZ', 2)",
      ),
    ).toThrow(/UNIQUE/);
    run(
      "INSERT INTO snapshots (run_date, period_month, source) VALUES ('2026-07-31', '2026-07', 'migrated')",
    );
    expect(() =>
      run(
        "INSERT INTO snapshots (run_date, period_month, source) VALUES ('2026-07-15', '2026-07', 'migrated')",
      ),
    ).toThrow(/UNIQUE/);
  });
});
