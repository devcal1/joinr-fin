// Migrations are append-only (stage-1.md §2.1, §7.2 step 3): a fresh database reaches 2
// migrations, a Stage 0 database upgrades cleanly, and the FKs behave as specified.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** A copy of the migrations folder that stops after 0000 (a Stage 0 install). */
function stage0MigrationsDir(): string {
  const dir = join(tempDir, 'migrations-0000');
  mkdirSync(join(dir, 'meta'), { recursive: true });
  cpSync(join(MIGRATIONS_DIR, '0000_app_meta.sql'), join(dir, '0000_app_meta.sql'));
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag === '0000_app_meta');
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return dir;
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

describe('migrations', () => {
  it('brings a fresh database to 2 migrations with every Stage 1 table', () => {
    const database = open();
    expect(runMigrations(database, MIGRATIONS_DIR)).toEqual({ applied: 2, total: 2 });
    expect(tableNames(database)).toEqual(expect.arrayContaining(STAGE1_TABLES));
  });

  it('upgrades a Stage 0 database (0000 only) and keeps its data', () => {
    const dataDir = join(tempDir, 'stage0');
    const first = open(dataDir);
    expect(runMigrations(first, stage0MigrationsDir())).toEqual({ applied: 1, total: 1 });
    setMeta(first.db, 'created_at', '2026-08-18T01:00:00.000Z');
    closeDatabase(first);

    const second = open(dataDir);
    expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({ applied: 1, total: 2 });
    expect(countAppliedMigrations(second.sqlite)).toBe(2);
    expect(getMeta(second.db, 'created_at')).toBe('2026-08-18T01:00:00.000Z');
    expect(tableNames(second)).toEqual(expect.arrayContaining(STAGE1_TABLES));
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
