// Migrations are append-only (stage-1.md §2.1, §7.2 step 3; stage-2.md §3.1; stage-3.md §3.1): a
// fresh database reaches every committed migration, Stage 0–2 databases upgrade cleanly and keep
// their data (0003 converts cash balances and side income), and the FKs behave as specified.
// Counts come from COMMITTED_MIGRATION_COUNT, never literals.
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
import { hasAppData } from '../src/db/queries/domain';
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
const STAGE2_TAGS = ['0000_app_meta', '0001_stage1_core', '0002_stage2_investments'];

/** The tables migration 0003 adds (stage-3.md §3.1). */
const STAGE3_TABLES = [
  'cash_balance_entries',
  'side_income_deposits',
  'savings_adjustments',
  'savings_goals',
  'dividend_events',
];

/** The columns migration 0002 adds (stage-2.md §3.1). */
const STAGE2_INSTRUMENT_COLUMNS = ['default_fee_cents', 'default_fee_rate'];

/**
 * The generic seed as it would exist in a Stage 1 database: `seedGenericData` on a fully migrated
 * database, dumped, without the Stage 2 columns and the Stage 3 tables. (The seed itself cannot
 * write to a database stopped at 0001: Drizzle's insert names every column of the current table
 * definition.)
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
    for (const table of STAGE3_TABLES) delete dump[table];
    // The seed no longer writes Stage 1 period entries (the server reads deposits from Stage 3), so
    // the Stage 1 database gets its own: two streams, a zero amount (not converted) and two filled
    // months.
    const streams = dump.income_streams!.map((s) => s.id as number);
    const [s1, s2] = [streams[0]!, streams[1] ?? streams[0]!];
    const entry = (id: number, streamId: number, month: string, end: string, cents: number) => ({
      id,
      stream_id: streamId,
      period_month: month,
      period_start: `${month}-01`,
      period_end: end,
      amount_cents: cents,
      origin: 'import',
      sheet_ref: `Side Income!${streamId === s1 ? 'G' : 'H'}${id + 1}`,
    });
    dump.side_income_entries = [
      entry(1, s1, '2026-06', '2026-06-30', 50000),
      entry(2, s2, '2026-06', '2026-06-30', 0),
      entry(3, s1, '2026-07', '2026-07-31', 75000),
    ];
    return dump;
  } finally {
    full.close();
  }
}

type Row = Record<string, unknown>;

/** The last day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * What 0003's data statements make of Stage 2 rows (stage-3.md §3.1), in insert order: one
 * balance entry per account, and one deposit per non-zero side-income entry, dated at its period
 * end (the month end when unknown) but never after the latest `balance_as_of`.
 */
function expectedConversion(accounts: Row[], entries: Row[]): { entries: Row[]; deposits: Row[] } {
  const asOfs = accounts.map((a) => a.balance_as_of).filter((v): v is string => v !== null);
  const latest = asOfs.length > 0 ? asOfs.reduce((x, y) => (y > x ? y : x)) : '9999-12-31';
  const byId = [...accounts].sort((a, b) => (a.id as number) - (b.id as number));
  const deposits = entries
    .filter((e) => e.amount_cents !== 0)
    .sort(
      (a, b) =>
        String(a.period_month).localeCompare(String(b.period_month)) ||
        (a.stream_id as number) - (b.stream_id as number) ||
        (a.id as number) - (b.id as number),
    )
    .map((e, i) => {
      const end = (e.period_end as string | null) ?? monthEnd(e.period_month as string);
      return {
        id: i + 1,
        stream_id: e.stream_id,
        deposit_date: end < latest ? end : latest,
        amount_cents: e.amount_cents,
        note: null,
        origin: e.origin,
        sheet_ref: e.sheet_ref,
      };
    });
  return {
    entries: byId.map((a, i) => ({
      id: i + 1,
      account_id: a.id,
      as_of: a.balance_as_of,
      balance_cents: a.balance_cents,
      note: null,
      origin: a.origin,
      sheet_ref: a.sheet_ref,
    })),
    deposits,
  };
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
    expect(COMMITTED_MIGRATION_COUNT).toBeGreaterThanOrEqual(4); // 0000 … 0003 (Stage 3)
    const database = open();
    expect(runMigrations(database, MIGRATIONS_DIR)).toEqual({
      applied: COMMITTED_MIGRATION_COUNT,
      total: COMMITTED_MIGRATION_COUNT,
    });
    expect(tableNames(database)).toEqual(expect.arrayContaining(STAGE1_TABLES));
    expect(columnNames(database, 'instruments')).toEqual(
      expect.arrayContaining(STAGE2_INSTRUMENT_COLUMNS),
    );
    expect(tableNames(database)).toEqual(expect.arrayContaining(STAGE3_TABLES));
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

  it('upgrades a Stage 1 database with data (0000 + 0001): rows kept or converted, new columns null', () => {
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
    const converted = expectedConversion(seeded.cash_accounts!, seeded.side_income_entries!);
    const expected: DomainDump = {
      ...seeded,
      instruments: seeded.instruments!.map((row) => ({
        ...row,
        default_fee_cents: null,
        default_fee_rate: null,
      })),
      // 0003 (stage-3.md §3.1): balance entries and deposits; the period entries are emptied.
      cash_balance_entries: converted.entries,
      side_income_deposits: converted.deposits,
      side_income_entries: [],
    };
    expect(upgraded).toEqual(expected);
    expect(upgraded.instruments!.length).toBeGreaterThan(0);
    expect(upgraded.trades!.length).toBeGreaterThan(0);
    expect(upgraded.side_income_deposits!.length).toBeGreaterThan(0);
    expect(hasAppData(second.db)).toBe(false);
  });

  describe('0003 converts a Stage 2 database with data (stage-3.md §3.1)', () => {
    /**
     * A database stopped at 0002 with its own raw rows (independent of the seed): three accounts
     * (one without a balance date) and side income for two streams, including a zero amount, a
     * null period end (a leap-year February), a period end after the latest balance date and,
     * optionally, an app-entered entry.
     */
    function stage2Database(dir: string, withAppRow: boolean): { accounts: Row[]; entries: Row[] } {
      const first = open(dir);
      expect(runMigrations(first, migrationsDirUpTo(STAGE2_TAGS))).toEqual({
        applied: 3,
        total: 3,
      });
      expect(tableNames(first)).not.toContain('cash_balance_entries');
      const run = (sql: string, ...args: unknown[]) => first.sqlite.prepare(sql).run(...args);
      const accounts: Row[] = [
        {
          id: 1,
          name: 'Everyday account',
          balance_cents: 150000,
          balance_as_of: '2026-08-31',
          sort_order: 1,
          origin: 'import',
          sheet_ref: 'Cash!A2',
        },
        {
          id: 2,
          name: 'Savings account',
          balance_cents: 900000,
          balance_as_of: '2026-08-15',
          sort_order: 2,
          origin: 'import',
          sheet_ref: 'Cash!A3',
        },
        {
          id: 3,
          name: 'Credit card',
          balance_cents: -20000,
          balance_as_of: null,
          sort_order: 3,
          origin: 'import',
          sheet_ref: 'Cash!A4',
        },
      ];
      for (const a of accounts) {
        run(
          'INSERT INTO cash_accounts (id, name, balance_cents, balance_as_of, sort_order, origin, sheet_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
          a.id,
          a.name,
          a.balance_cents,
          a.balance_as_of,
          a.sort_order,
          a.origin,
          a.sheet_ref,
        );
      }
      run(
        "INSERT INTO income_streams (id, name, sort_order, origin, sheet_ref) VALUES (1, 'Consulting', 1, 'import', 'Side Income!G1')",
      );
      run(
        "INSERT INTO income_streams (id, name, sort_order, origin, sheet_ref) VALUES (2, 'Rent', 2, 'import', 'Side Income!H1')",
      );
      const entries: Row[] = [
        {
          id: 1,
          stream_id: 1,
          period_month: '2026-06',
          period_end: '2026-06-30',
          amount_cents: 50000,
          origin: 'import',
          sheet_ref: 'Side Income!G2',
        },
        {
          id: 2,
          stream_id: 2,
          period_month: '2026-06',
          period_end: '2026-06-30',
          amount_cents: 0,
          origin: 'import',
          sheet_ref: 'Side Income!H2',
        },
        {
          id: 3,
          stream_id: 1,
          period_month: '2026-07',
          period_end: null,
          amount_cents: 30000,
          origin: 'import',
          sheet_ref: 'Side Income!G3',
        },
        {
          id: 4,
          stream_id: 2,
          period_month: '2026-07',
          period_end: '2026-07-31',
          amount_cents: -2500,
          origin: 'import',
          sheet_ref: 'Side Income!H3',
        },
        {
          id: 5,
          stream_id: 1,
          period_month: '2026-09',
          period_end: '2026-09-30',
          amount_cents: 10000,
          origin: 'import',
          sheet_ref: 'Side Income!G5',
        },
        {
          id: 6,
          stream_id: 2,
          period_month: '2024-02',
          period_end: null,
          amount_cents: 7000,
          origin: 'import',
          sheet_ref: 'Side Income!H9',
        },
      ];
      if (withAppRow) {
        entries.push({
          id: 7,
          stream_id: 2,
          period_month: '2026-08',
          period_end: '2026-08-31',
          amount_cents: 5000,
          origin: 'app',
          sheet_ref: null,
        });
      }
      for (const e of entries) {
        run(
          'INSERT INTO side_income_entries (id, stream_id, period_month, period_end, amount_cents, origin, sheet_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
          e.id,
          e.stream_id,
          e.period_month,
          e.period_end,
          e.amount_cents,
          e.origin,
          e.sheet_ref,
        );
      }
      closeDatabase(first);
      return { accounts, entries };
    }

    const all = (database: AppDatabase, table: string): Row[] =>
      database.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id`).all() as Row[];

    it('writes one balance entry per account and one deposit per non-zero entry', () => {
      const dir = join(tempDir, 'stage2');
      const { accounts, entries } = stage2Database(dir, false);
      const todayBefore = new Date().toISOString().slice(0, 10);
      const second = open(dir);
      expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({
        applied: COMMITTED_MIGRATION_COUNT - 3,
        total: COMMITTED_MIGRATION_COUNT,
      });
      const todayAfter = new Date().toISOString().slice(0, 10);
      const converted = expectedConversion(accounts, entries);

      // Balance entries: the account's balance, as-of (today's UTC date when unknown), origin, ref.
      const balanceEntries = all(second, 'cash_balance_entries');
      expect(balanceEntries).toHaveLength(accounts.length);
      expect(balanceEntries.slice(0, 2)).toEqual(converted.entries.slice(0, 2));
      const { as_of: asOf, ...undated } = balanceEntries[2]!;
      expect({ ...undated }).toEqual(
        Object.fromEntries(Object.entries(converted.entries[2]!).filter(([k]) => k !== 'as_of')),
      );
      expect([todayBefore, todayAfter]).toContain(asOf);

      // Deposits: the zero amount is skipped; a null end → the month end (29/02/2024); an end
      // after the latest balance date → that date (31/08/2026).
      const deposits = all(second, 'side_income_deposits');
      expect(deposits).toEqual(converted.deposits);
      expect(deposits.map((d) => d.deposit_date)).toEqual([
        '2024-02-29',
        '2026-06-30',
        '2026-07-31',
        '2026-07-31',
        '2026-08-31',
      ]);
      expect(deposits.map((d) => d.amount_cents)).toEqual([7000, 50000, 30000, -2500, 10000]);
      expect(all(second, 'side_income_entries')).toEqual([]);

      // Only imported rows: still no app data after the upgrade.
      expect(hasAppData(second.db)).toBe(false);
      // The accounts themselves are untouched.
      expect(all(second, 'cash_accounts').map((a) => a.balance_cents)).toEqual([
        150000, 900000, -20000,
      ]);
    });

    it('keeps an app-entered entry as an app deposit (app data before and after)', () => {
      const dir = join(tempDir, 'stage2-app');
      stage2Database(dir, true);
      const second = open(dir);
      runMigrations(second, MIGRATIONS_DIR);
      const deposits = all(second, 'side_income_deposits');
      expect(deposits.filter((d) => d.origin === 'app')).toEqual([
        expect.objectContaining({
          stream_id: 2,
          deposit_date: '2026-08-31',
          amount_cents: 5000,
          sheet_ref: null,
        }),
      ]);
      expect(hasAppData(second.db)).toBe(true);
    });
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

  it('cascades the Stage 3 children: entries, deposits and events', () => {
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order) VALUES (1, 'Everyday account', 0, 1)",
    );
    run(
      "INSERT INTO cash_balance_entries (account_id, as_of, balance_cents) VALUES (1, '2026-08-31', 0)",
    );
    run("INSERT INTO income_streams (id, name, sort_order) VALUES (1, 'Consulting', 1)");
    run(
      "INSERT INTO side_income_deposits (stream_id, deposit_date, amount_cents) VALUES (1, '2026-08-31', 100)",
    );
    run(
      'INSERT INTO dividend_events (instrument_id, ex_date, amount_per_unit, currency, source, fetched_at) ' +
        "VALUES (1, '2026-06-30', '0.5', 'AUD', 'fake', '2026-09-24T00:00:00.000Z')",
    );
    run('DELETE FROM cash_accounts');
    run('DELETE FROM income_streams');
    run('DELETE FROM instruments WHERE id = 1');
    expect(count('cash_balance_entries')).toBe(0);
    expect(count('side_income_deposits')).toBe(0);
    expect(count('dividend_events')).toBe(0);
  });

  it('enforces the Stage 3 keys: one entry per account and date, one adjustment per month, one event per ex-date', () => {
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order) VALUES (1, 'Everyday account', 0, 1)",
    );
    run(
      "INSERT INTO cash_balance_entries (account_id, as_of, balance_cents) VALUES (1, '2026-08-31', 0)",
    );
    expect(() =>
      run(
        "INSERT INTO cash_balance_entries (account_id, as_of, balance_cents) VALUES (1, '2026-08-31', 5)",
      ),
    ).toThrow(/UNIQUE/);
    expect(() =>
      run(
        "INSERT INTO cash_balance_entries (account_id, as_of, balance_cents) VALUES (9, '2026-08-31', 5)",
      ),
    ).toThrow(/FOREIGN KEY/);
    run(
      "INSERT INTO savings_adjustments (period_month, amount_cents, note) VALUES ('2026-07', 100, 'Car sold')",
    );
    expect(() =>
      run(
        "INSERT INTO savings_adjustments (period_month, amount_cents, note) VALUES ('2026-07', 5, 'Again')",
      ),
    ).toThrow(/UNIQUE/);
    const event =
      'INSERT INTO dividend_events (instrument_id, ex_date, amount_per_unit, currency, source, fetched_at) ' +
      "VALUES (1, '2026-06-30', '0.5', 'AUD', 'fake', '2026-09-24T00:00:00.000Z')";
    run(event);
    expect(() => run(event)).toThrow(/UNIQUE|PRIMARY KEY/);
    // Overlays default to origin 'app', like every provenance table.
    expect(value("SELECT origin FROM savings_adjustments WHERE period_month = '2026-07'")).toBe(
      'app',
    );
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
