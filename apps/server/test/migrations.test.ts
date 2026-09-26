// Migrations are append-only (stage-1.md §2.1, §7.2 step 3; stage-2.md §3.1; stage-3.md §3.1;
// stage-4.md §3.1): a fresh database reaches every committed migration, Stage 0–3 databases
// upgrade cleanly and keep their data (0003 converts cash balances and side income; 0004 converts
// other-asset prices, super balances and contributions, valuations and loan balances), and the FKs
// behave as specified. Counts come from COMMITTED_MIGRATION_COUNT, never literals.
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
const STAGE3_TAGS = [...STAGE2_TAGS, '0003_stage3_cashflow'];

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

/** The tables migration 0004 adds (stage-4.md §3.1). */
const STAGE4_TABLES = [
  'other_asset_prices',
  'other_asset_sales',
  'super_balance_entries',
  'super_sg_overrides',
  'property_valuations',
  'loan_balance_entries',
  'loan_offset_links',
  'market_quote_history',
];

/** The columns migration 0004 adds (stage-4.md §3.1). */
const STAGE4_OTHER_ASSET_COLUMNS = ['purchase_fx_rate', 'purchase_fx_source', 'purchase_fx_date'];
const STAGE4_SUPER_FUND_COLUMNS = ['receives_sg'];

/**
 * The generic seed as it would exist in a Stage 1 database: `seedGenericData` on a fully migrated
 * database, dumped, without the Stage 2 columns, the Stage 3 tables and the Stage 4 tables and
 * columns (and without what only the Stage 4 importer writes: the History-derived contributions and
 * the contribution dates). (The seed itself cannot write to a database stopped at 0001: Drizzle's
 * insert names every column of the current table definition.)
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
    for (const table of STAGE4_TABLES) delete dump[table];
    const without = (rows: Row[], cols: string[]) =>
      rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !cols.includes(k))));
    dump.other_assets = without(dump.other_assets!, STAGE4_OTHER_ASSET_COLUMNS);
    dump.super_funds = without(dump.super_funds!, STAGE4_SUPER_FUND_COLUMNS);
    dump.super_entries = dump
      .super_entries!.filter((e) => !String(e.sheet_ref).startsWith('History!R'))
      .map((e) => ({ ...e, entry_date: null }));
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

const maxDate = (values: readonly unknown[]): string | null => {
  const dates = values.filter((v): v is string => typeof v === 'string');
  return dates.length === 0 ? null : dates.reduce((x, y) => (y > x ? y : x));
};
const minDate = (a: string, b: string): string => (a < b ? a : b);
const byIdOrder = (rows: readonly Row[]): Row[] =>
  [...rows].sort((a, b) => (a.id as number) - (b.id as number));

/**
 * What 0004's data statements make of Stage 3 rows (stage-4.md §3.1), a JS mirror of the SQL in
 * statement order: a price entry per priced manual asset; the live month's contribution dated at
 * min(month end, workbook as-of); one balance entry per fund (at the latest snapshot's run date
 * when the funds' total equals its Q) and the funds' dates following them; one contribution per
 * migrated snapshot with a non-zero R (none twice); one valuation per property; one balance entry
 * per loan (at the latest run date when the property loans' total equals its |AB| and the loan
 * started before it) and the loans' dates following them. New columns are null (receives_sg 0).
 * `workbookAsOf` is the latest applied import run's; `today` stands in for date('now').
 */
function expectedStage4Conversion(
  d: DomainDump,
  workbookAsOf: string | null,
  today = new Date().toISOString().slice(0, 10),
): DomainDump {
  const snaps = [...(d.snapshots ?? [])].sort((a, b) =>
    String(a.run_date).localeCompare(String(b.run_date)),
  );
  const latest = snaps.at(-1) ?? null;
  const assets = byIdOrder(d.other_assets ?? []);
  const prices = assets
    .filter(
      (a) =>
        a.price_source === 'manual' &&
        a.unit_price !== null &&
        !(a.unit_price as string).startsWith('-'),
    )
    .map((a, i) => ({
      id: i + 1,
      other_asset_id: a.id,
      as_of: (a.unit_price_as_of as string | null) ?? today,
      unit_price: a.unit_price,
      note: null,
      origin: a.origin,
      sheet_ref: a.sheet_ref,
    }));

  const fallback =
    workbookAsOf ??
    maxDate((d.super_funds ?? []).map((f) => f.balance_as_of)) ??
    maxDate((d.cash_accounts ?? []).map((c) => c.balance_as_of)) ??
    '9999-12-31';
  const dated = byIdOrder(d.super_entries ?? []).map((e) =>
    e.kind === 'voluntary_contribution' && e.entry_date === null
      ? { ...e, entry_date: minDate(monthEnd(e.period_month as string), fallback) }
      : e,
  );

  const funds = byIdOrder(d.super_funds ?? []);
  const live = funds.filter((f) => f.archived === 0).map((f) => f.balance_cents as number);
  const fundsEqual =
    latest !== null &&
    live.length > 0 &&
    live.reduce((x, y) => x + y, 0) === latest.super_value_cents;
  const fundEntries = funds.map((f, i) => ({
    id: i + 1,
    fund_id: f.id,
    as_of: fundsEqual ? latest.run_date : ((f.balance_as_of as string | null) ?? today),
    balance_cents: f.balance_cents,
    transfer_in_cents: null,
    note: null,
    origin: f.origin,
    sheet_ref: f.sheet_ref,
  }));

  const refs = new Set(dated.map((e) => e.sheet_ref));
  let nextId = Math.max(0, ...dated.map((e) => e.id as number));
  const derived = snaps
    .filter(
      (x) =>
        x.source === 'migrated' &&
        String(x.sheet_ref).startsWith('History!A') &&
        x.super_contrib_cents !== null &&
        x.super_contrib_cents !== 0 &&
        !refs.has(`History!R${String(x.sheet_ref).slice(9)}`),
    )
    .map((x) => ({
      id: (nextId += 1),
      period_month: x.period_month,
      kind: 'voluntary_contribution',
      fund_id: null,
      entry_date: x.run_date,
      amount_cents: x.super_contrib_cents,
      note: null,
      origin: x.origin,
      sheet_ref: `History!R${String(x.sheet_ref).slice(9)}`,
    }));

  const valuations = byIdOrder(d.properties ?? []).map((x, i) => ({
    id: i + 1,
    property_id: x.id,
    as_of: (x.valuation_date as string | null) ?? today,
    value_cents: x.current_value_cents,
    note: null,
    origin: x.origin,
    sheet_ref: x.sheet_ref,
  }));

  const loanRows = byIdOrder(d.loans ?? []);
  const propertyLoans = loanRows.filter((l) => l.property_id !== null);
  const loansEqual =
    latest !== null &&
    propertyLoans.length > 0 &&
    latest.mortgage_balance_cents !== null &&
    propertyLoans.reduce((x, l) => x + (l.current_balance_cents as number), 0) ===
      -(latest.mortgage_balance_cents as number);
  const loanEntries = loanRows.map((l, i) => ({
    id: i + 1,
    loan_id: l.id,
    as_of:
      l.property_id !== null &&
      loansEqual &&
      (l.start_date === null || (l.start_date as string) < (latest.run_date as string))
        ? latest.run_date
        : ((l.balance_as_of as string | null) ?? today),
    balance_cents: l.current_balance_cents,
    repayments_cents: null,
    note: null,
    origin: l.origin,
    sheet_ref: l.sheet_ref,
  }));

  return {
    other_assets: (d.other_assets ?? []).map((a) => ({
      ...a,
      purchase_fx_rate: null,
      purchase_fx_source: null,
      purchase_fx_date: null,
    })),
    super_funds: (d.super_funds ?? []).map((f) => ({
      ...f,
      balance_as_of: maxDate(fundEntries.filter((e) => e.fund_id === f.id).map((e) => e.as_of)),
      receives_sg: 0,
    })),
    super_entries: [...dated, ...derived],
    loans: (d.loans ?? []).map((l) => ({
      ...l,
      balance_as_of: maxDate(loanEntries.filter((e) => e.loan_id === l.id).map((e) => e.as_of)),
    })),
    other_asset_prices: prices,
    other_asset_sales: [],
    super_balance_entries: fundEntries,
    property_valuations: valuations,
    loan_balance_entries: loanEntries,
    loan_offset_links: [],
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
    expect(COMMITTED_MIGRATION_COUNT).toBeGreaterThanOrEqual(5); // 0000 … 0004 (Stage 4)
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
    expect(tableNames(database)).toEqual(expect.arrayContaining(STAGE4_TABLES));
    expect(columnNames(database, 'other_assets')).toEqual(
      expect.arrayContaining(STAGE4_OTHER_ASSET_COLUMNS),
    );
    expect(columnNames(database, 'super_funds')).toEqual(
      expect.arrayContaining(STAGE4_SUPER_FUND_COLUMNS),
    );
    expect(columnNames(database, 'loan_offset_links')).toEqual([
      'account_id',
      'loan_id',
      'origin',
      'sheet_ref',
    ]);
    expect(columnNames(database, 'market_quote_history')).toEqual([
      'series_id',
      'date',
      'value',
      'source',
      'fetched_at',
    ]);
  });

  it('0004 holds only CREATE TABLE, CREATE INDEX, ALTER TABLE … ADD and the data statements', () => {
    const text = readFileSync(join(MIGRATIONS_DIR, '0004_stage4_assets.sql'), 'utf8');
    expect(text).not.toMatch(/__new_/);
    expect(text).not.toMatch(/PRAGMA/i);
    expect(text).not.toMatch(/DROP TABLE/i);
    const statements = text
      .split('--> statement-breakpoint')
      .map((chunk) =>
        chunk
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((chunk) => chunk !== '');
    for (const st of statements) {
      expect(st, st.slice(0, 60)).toMatch(
        /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE `\w+` ADD|INSERT INTO|UPDATE)/,
      );
    }
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
      // 0004 (stage-4.md §3.1): the price, balance, valuation and loan entries and the contribution
      // dates and History-derived contributions (no import run in the dump: the dates fall back).
      ...expectedStage4Conversion(seeded, null),
    };
    expect(upgraded).toEqual(expected);
    // The seed's latest snapshot holds the funds' total and the property loans' total, so those
    // entries are dated at its run date (the importer's rule) and the parents follow them.
    expect(upgraded.super_balance_entries!.map((e) => e.as_of)).toEqual(['2026-07-31']);
    expect(
      upgraded.super_entries!.filter((e) => String(e.sheet_ref).startsWith('History!R')),
    ).toHaveLength(3);
    expect(upgraded.loan_balance_entries!.map((e) => e.as_of)).toEqual([
      '2026-07-31',
      '2026-08-31',
    ]);
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

  describe('0004 converts a Stage 3 database with data (stage-4.md §3.1)', () => {
    interface Variant {
      /** The latest snapshot's Q and |AB| equal the funds' and the property loans' totals. */
      equalTotals: boolean;
      /** The latest applied import run has a workbook as-of (else the dates fall back). */
      withWorkbookAsOf: boolean;
      /** One app row of each converted parent (an asset, a fund, a contribution, a property, a loan). */
      withAppRows: boolean;
    }

    const CONVERTED_TABLES = [
      'import_runs',
      'cash_accounts',
      'snapshots',
      'other_assets',
      'super_funds',
      'super_entries',
      'properties',
      'loans',
    ];

    /**
     * A database stopped at 0003 with its own raw rows (independent of the seed): manual and
     * bullion assets with and without a price and a price date; two funds (one without a balance
     * date); contributions with and without a date (the live month's ends after the workbook
     * as-of); a reported gain; migrated snapshots with a null, a zero and non-zero R (one whose
     * derived entry already exists); properties with and without a valuation date; loans starting
     * before the last run, after it and never, and one without a property. Returns every row of the
     * converted tables as stored at 0003.
     */
    function stage3Database(dir: string, v: Variant): DomainDump {
      const first = open(dir);
      expect(runMigrations(first, migrationsDirUpTo(STAGE3_TAGS))).toEqual({
        applied: 4,
        total: 4,
      });
      expect(tableNames(first)).not.toContain('super_balance_entries');
      expect(columnNames(first, 'super_funds')).not.toContain('receives_sg');
      const insert = (table: string, row: Row) => {
        const cols = Object.keys(row);
        first.sqlite
          .prepare(
            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
          .run(...cols.map((c) => row[c]));
      };
      const importRun = (
        id: number,
        startedAt: string,
        dryRun: number,
        status: string,
        asOf: string | null,
      ) =>
        insert('import_runs', {
          id,
          started_at: startedAt,
          status,
          dry_run: dryRun,
          trigger: 'cli',
          file_name: 'workbook.xlsx',
          file_sha256: 'a'.repeat(64),
          file_size: 1,
          workbook_as_of: asOf,
          importer_version: '1',
        });
      importRun(
        1,
        '2026-08-20T09:00:00.000Z',
        0,
        'succeeded',
        v.withWorkbookAsOf ? '2026-08-20' : null,
      );
      // A later dry run and a later failed run never give the workbook as-of.
      importRun(2, '2026-08-26T09:00:00.000Z', 1, 'succeeded', '2026-08-26');
      importRun(3, '2026-08-29T09:00:00.000Z', 0, 'failed', '2026-08-29');
      // The last fallback (a cash account's balance date) is never reached: the funds have dates.
      insert('cash_accounts', {
        id: 1,
        name: 'Everyday account',
        balance_cents: 100000,
        balance_as_of: '2026-08-31',
        sort_order: 1,
        origin: 'import',
        sheet_ref: 'Cash!A2',
      });

      const propertyLoans = 39800000 + 10000000 + (v.withAppRows ? 5000000 : 0);
      const snapshot = (id: number, runDate: string, contrib: number | null, last: boolean) =>
        insert('snapshots', {
          id,
          run_date: runDate,
          period_month: runDate.slice(0, 7),
          source: 'migrated',
          origin: 'import',
          sheet_ref: `History!A${id + 2}`,
          super_value_cents: last ? (v.equalTotals ? 6000000 : 5900000) : 5500000,
          super_contrib_cents: contrib,
          mortgage_balance_cents: last ? (v.equalTotals ? -propertyLoans : -50000000) : -51000000,
        });
      snapshot(1, '2026-04-30', null, false);
      snapshot(2, '2026-05-31', 0, false);
      snapshot(3, '2026-06-30', 20000, false); // History!A5: its derived entry R5 already exists
      snapshot(4, '2026-07-31', 25000, true); // History!A6: the latest run

      const asset = (row: Row) =>
        insert('other_assets', { units: '1', currency: 'AUD', origin: 'import', ...row });
      asset({
        id: 1,
        description: 'Example watch',
        unit_price: '1800',
        unit_price_as_of: '2026-08-20',
        sort_order: 1,
        sheet_ref: 'Other Assets!F3',
      });
      asset({
        id: 2,
        description: 'Example print',
        currency: 'USD',
        unit_price: '450',
        unit_price_as_of: null,
        sort_order: 2,
        sheet_ref: 'Other Assets!F4',
      });
      asset({
        id: 3,
        description: 'Sealed box',
        unit_price: null,
        sort_order: 3,
        sheet_ref: 'Other Assets!F5',
      });
      asset({
        id: 4,
        description: 'Silver bar',
        unit_price: '46.15',
        unit_price_as_of: '2026-08-20',
        price_source: 'bullion',
        metal: 'silver',
        unit_of_measure: 'oz',
        oz_per_unit: '1',
        sort_order: 4,
        sheet_ref: 'Other Assets!F6',
      });
      // A negative hand price (the workbook allowed one): no price entry, as the importer.
      asset({
        id: 6,
        description: 'Scrap lot',
        unit_price: '-5',
        unit_price_as_of: '2026-08-20',
        sort_order: 6,
        sheet_ref: 'Other Assets!F7',
      });
      if (v.withAppRows) {
        asset({
          id: 5,
          description: 'Example lamp',
          unit_price: '100',
          unit_price_as_of: '2026-09-01',
          sort_order: 5,
          origin: 'app',
          sheet_ref: null,
        });
      }

      const fund = (row: Row) => insert('super_funds', { origin: 'import', ...row });
      fund({
        id: 1,
        name: 'Example Super',
        balance_cents: 5000000,
        balance_as_of: v.withWorkbookAsOf ? '2026-08-20' : '2026-08-18',
        sort_order: 1,
        sheet_ref: 'Super!A2',
      });
      fund({
        id: 2,
        name: 'Second Super',
        balance_cents: 1000000,
        balance_as_of: null,
        sort_order: 2,
        sheet_ref: 'Super!A3',
      });
      if (v.withAppRows) {
        // Archived with a closing balance of 0: never in the funds' total.
        fund({
          id: 3,
          name: 'Closed Super',
          balance_cents: 0,
          balance_as_of: '2026-08-25',
          sort_order: 3,
          archived: 1,
          origin: 'app',
          sheet_ref: null,
        });
      }

      const entry = (row: Row) =>
        insert('super_entries', { kind: 'voluntary_contribution', origin: 'import', ...row });
      entry({
        id: 1,
        period_month: '2026-08',
        entry_date: null,
        amount_cents: 20000,
        sheet_ref: 'Super!B16',
      });
      entry({
        id: 2,
        period_month: '2026-06',
        entry_date: '2026-06-30',
        amount_cents: 20000,
        sheet_ref: 'History!R5',
      });
      entry({
        id: 3,
        period_month: '2026-03',
        entry_date: '2026-03-10',
        amount_cents: 5000,
        sheet_ref: null,
      });
      entry({
        id: 4,
        period_month: '2026-08',
        kind: 'reported_gain',
        fund_id: 1,
        entry_date: null,
        amount_cents: 10000,
        sheet_ref: 'Super!B11',
      });
      if (v.withAppRows) {
        entry({
          id: 5,
          period_month: '2026-09',
          entry_date: null,
          amount_cents: 30000,
          origin: 'app',
          sheet_ref: null,
        });
      }

      const property = (row: Row) => insert('properties', { origin: 'import', ...row });
      property({
        id: 1,
        name: 'Example property',
        current_value_cents: 60000000,
        valuation_date: '2026-08-20',
        sort_order: 1,
        sheet_ref: 'Property!D15',
      });
      property({
        id: 2,
        name: 'Example unit',
        current_value_cents: 40000000,
        valuation_date: null,
        sort_order: 2,
        sheet_ref: 'Property!E15',
      });
      if (v.withAppRows) {
        property({
          id: 3,
          name: 'Example house',
          current_value_cents: 30000000,
          valuation_date: '2026-09-01',
          sort_order: 3,
          origin: 'app',
          sheet_ref: null,
        });
      }

      const loan = (row: Row) => insert('loans', { origin: 'import', ...row });
      loan({
        id: 1,
        property_id: 1,
        name: 'Example property mortgage',
        start_date: '2020-03-15',
        start_balance_cents: 45000000,
        current_balance_cents: 39800000,
        balance_as_of: '2026-08-20',
        sort_order: 1,
        sheet_ref: 'Property!D28',
      });
      loan({
        id: 2,
        property_id: 2,
        name: 'Example unit mortgage',
        start_date: '2026-08-15',
        start_balance_cents: 10100000,
        current_balance_cents: 10000000,
        balance_as_of: '2026-08-20',
        sort_order: 2,
        sheet_ref: 'Property!E28',
      });
      if (v.withAppRows) {
        loan({
          id: 3,
          property_id: 3,
          name: 'Example house mortgage',
          start_date: null,
          current_balance_cents: 5000000,
          balance_as_of: null,
          sort_order: 3,
          origin: 'app',
          sheet_ref: null,
        });
      }
      loan({
        id: 4,
        property_id: null,
        name: 'Example car loan',
        start_date: '2024-01-10',
        current_balance_cents: 1500000,
        balance_as_of: '2026-08-20',
        sort_order: 4,
        sheet_ref: 'LiabilitiesDebts!C11',
      });

      const before: DomainDump = {};
      for (const table of CONVERTED_TABLES) before[table] = all(first, table);
      closeDatabase(first);
      return before;
    }

    const all = (database: AppDatabase, table: string): Row[] =>
      database.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Row[];
    const pick = (rows: Row[], ...keys: string[]) => rows.map((r) => keys.map((k) => r[k]));

    /** Upgrades the database and returns the converted tables, and today's UTC date(s). */
    function upgrade(dir: string) {
      const todayBefore = new Date().toISOString().slice(0, 10);
      const second = open(dir);
      expect(runMigrations(second, MIGRATIONS_DIR)).toEqual({
        applied: COMMITTED_MIGRATION_COUNT - 4,
        total: COMMITTED_MIGRATION_COUNT,
      });
      const todayAfter = new Date().toISOString().slice(0, 10);
      return { second, today: todayAfter, todays: [todayBefore, todayAfter] };
    }

    it('dates unchanged balances at the last run (equal totals) and the contributions at the workbook as-of', () => {
      const dir = join(tempDir, 'stage3-equal');
      const before = stage3Database(dir, {
        equalTotals: true,
        withWorkbookAsOf: true,
        withAppRows: true,
      });
      const { second, today, todays } = upgrade(dir);

      // Price entries: priced manual assets only (not the unpriced one, not bullion, not the
      // negative price), app kept.
      const prices = all(second, 'other_asset_prices');
      expect(pick(prices, 'other_asset_id', 'unit_price', 'origin', 'sheet_ref')).toEqual([
        [1, '1800', 'import', 'Other Assets!F3'],
        [2, '450', 'import', 'Other Assets!F4'],
        [5, '100', 'app', null],
      ]);
      expect(prices[0]!.as_of).toBe('2026-08-20');
      expect(todays).toContain(prices[1]!.as_of);
      expect(prices[2]!.as_of).toBe('2026-09-01');
      expect(all(second, 'other_assets').every((a) => a.purchase_fx_rate === null)).toBe(true);

      // Contributions: the live month's is dated at the workbook as-of (its month end is later),
      // a dated one keeps its date, a reported gain stays undated, and History R6 is derived once.
      const entries = all(second, 'super_entries');
      expect(
        pick(
          entries,
          'id',
          'kind',
          'period_month',
          'entry_date',
          'amount_cents',
          'origin',
          'sheet_ref',
        ),
      ).toEqual([
        [1, 'voluntary_contribution', '2026-08', '2026-08-20', 20000, 'import', 'Super!B16'],
        [2, 'voluntary_contribution', '2026-06', '2026-06-30', 20000, 'import', 'History!R5'],
        [3, 'voluntary_contribution', '2026-03', '2026-03-10', 5000, 'import', null],
        [4, 'reported_gain', '2026-08', null, 10000, 'import', 'Super!B11'],
        [5, 'voluntary_contribution', '2026-09', '2026-08-20', 30000, 'app', null],
        [6, 'voluntary_contribution', '2026-07', '2026-07-31', 25000, 'import', 'History!R6'],
      ]);
      expect(entries[5]!.fund_id).toBeNull();

      // Fund balances: the total equals the latest Q, so every entry is at its run date; the
      // funds' balance dates follow; no transfer in; receives_sg off.
      expect(
        pick(
          all(second, 'super_balance_entries'),
          'fund_id',
          'as_of',
          'balance_cents',
          'transfer_in_cents',
          'origin',
          'sheet_ref',
        ),
      ).toEqual([
        [1, '2026-07-31', 5000000, null, 'import', 'Super!A2'],
        [2, '2026-07-31', 1000000, null, 'import', 'Super!A3'],
        [3, '2026-07-31', 0, null, 'app', null],
      ]);
      expect(pick(all(second, 'super_funds'), 'balance_as_of', 'receives_sg')).toEqual([
        ['2026-07-31', 0],
        ['2026-07-31', 0],
        ['2026-07-31', 0],
      ]);

      // Valuations: one per property at its valuation date (today when unknown).
      const valuations = all(second, 'property_valuations');
      expect(pick(valuations, 'property_id', 'value_cents', 'origin', 'sheet_ref')).toEqual([
        [1, 60000000, 'import', 'Property!D15'],
        [2, 40000000, 'import', 'Property!E15'],
        [3, 30000000, 'app', null],
      ]);
      expect([valuations[0]!.as_of, valuations[2]!.as_of]).toEqual(['2026-08-20', '2026-09-01']);
      expect(todays).toContain(valuations[1]!.as_of);

      // Loans: one entry each (no start entry); the property loans' total equals the latest |AB|,
      // so a loan started before the last run (or with no start) is dated at it; one started after
      // it, and a loan without a property, keep their balance dates.
      expect(
        pick(
          all(second, 'loan_balance_entries'),
          'loan_id',
          'as_of',
          'balance_cents',
          'repayments_cents',
          'origin',
          'sheet_ref',
        ),
      ).toEqual([
        [1, '2026-07-31', 39800000, null, 'import', 'Property!D28'],
        [2, '2026-08-20', 10000000, null, 'import', 'Property!E28'],
        [3, '2026-07-31', 5000000, null, 'app', null],
        [4, '2026-08-20', 1500000, null, 'import', 'LiabilitiesDebts!C11'],
      ]);
      expect(pick(all(second, 'loans'), 'balance_as_of')).toEqual([
        ['2026-07-31'],
        ['2026-08-20'],
        ['2026-07-31'],
        ['2026-08-20'],
      ]);
      for (const table of [
        'other_asset_sales',
        'super_sg_overrides',
        'loan_offset_links',
        'market_quote_history',
      ]) {
        expect(all(second, table), table).toEqual([]);
      }

      // The app rows stay app rows: app data before and after.
      expect(hasAppData(second.db)).toBe(true);
      // The JS mirror of the SQL (used by the Stage 1 upgrade test) agrees.
      expect(dumpDomainTables(second.db)).toMatchObject(
        expectedStage4Conversion(before, '2026-08-20', today),
      );
    });

    it('dates changed balances at their own dates, and falls back for the contribution date', () => {
      const dir = join(tempDir, 'stage3-differs');
      const before = stage3Database(dir, {
        equalTotals: false,
        withWorkbookAsOf: false,
        withAppRows: false,
      });
      const { second, today, todays } = upgrade(dir);

      expect(pick(all(second, 'other_asset_prices'), 'other_asset_id', 'unit_price')).toEqual([
        [1, '1800'],
        [2, '450'],
      ]);
      // No applied run with a workbook as-of (the dry and failed runs are ignored): the latest
      // fund balance date stands in.
      const entries = all(second, 'super_entries');
      expect(pick(entries, 'id', 'entry_date', 'sheet_ref')).toEqual([
        [1, '2026-08-18', 'Super!B16'],
        [2, '2026-06-30', 'History!R5'],
        [3, '2026-03-10', null],
        [4, null, 'Super!B11'],
        [5, '2026-07-31', 'History!R6'],
      ]);
      const fundEntries = all(second, 'super_balance_entries');
      expect(pick(fundEntries, 'fund_id', 'balance_cents')).toEqual([
        [1, 5000000],
        [2, 1000000],
      ]);
      expect(fundEntries[0]!.as_of).toBe('2026-08-18');
      expect(todays).toContain(fundEntries[1]!.as_of);
      expect(all(second, 'super_funds').map((f) => f.balance_as_of)).toEqual(
        fundEntries.map((e) => e.as_of),
      );
      expect(pick(all(second, 'loan_balance_entries'), 'loan_id', 'as_of')).toEqual([
        [1, '2026-08-20'],
        [2, '2026-08-20'],
        [4, '2026-08-20'],
      ]);
      expect(all(second, 'property_valuations')).toHaveLength(2);

      // Only imported rows: still no app data after the upgrade.
      expect(hasAppData(second.db)).toBe(false);
      expect(dumpDomainTables(second.db)).toMatchObject(
        expectedStage4Conversion(before, null, today),
      );
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

  it('cascades the Stage 4 logs from their parents (stage-4.md §3.1)', () => {
    run(
      "INSERT INTO other_assets (id, description, units, sort_order) VALUES (1, 'Example watch', '1', 1)",
    );
    run(
      "INSERT INTO other_asset_prices (other_asset_id, as_of, unit_price) VALUES (1, '2026-08-31', '1800')",
    );
    run(
      "INSERT INTO other_asset_sales (other_asset_id, sale_date, units, proceeds_cents) VALUES (1, '2026-09-01', '1', 190000)",
    );
    run(
      "INSERT INTO super_funds (id, name, balance_cents, sort_order) VALUES (1, 'Example Super', 0, 1)",
    );
    run(
      "INSERT INTO super_balance_entries (fund_id, as_of, balance_cents) VALUES (1, '2026-08-31', 0)",
    );
    run("INSERT INTO properties (id, name, sort_order) VALUES (1, 'Example property', 1)");
    run(
      "INSERT INTO property_valuations (property_id, as_of, value_cents) VALUES (1, '2026-08-31', 100)",
    );
    run(
      "INSERT INTO loans (id, property_id, name, current_balance_cents, sort_order) VALUES (1, 1, 'Example mortgage', 100, 1)",
    );
    run(
      "INSERT INTO loan_balance_entries (loan_id, as_of, balance_cents) VALUES (1, '2026-08-31', 100)",
    );
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order, is_offset) VALUES (1, 'Offset account', 0, 1, 1)",
    );
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order, is_offset) VALUES (2, 'Second offset', 0, 2, 1)",
    );
    run('INSERT INTO loan_offset_links (account_id, loan_id) VALUES (1, 1)');
    run('INSERT INTO loan_offset_links (account_id, loan_id) VALUES (2, 1)');

    run('DELETE FROM other_assets');
    expect(count('other_asset_prices')).toBe(0);
    expect(count('other_asset_sales')).toBe(0);
    run('DELETE FROM super_funds');
    expect(count('super_balance_entries')).toBe(0);
    // An account's link goes with the account; a loan's links and entries go with the loan.
    run('DELETE FROM cash_accounts WHERE id = 2');
    expect(count('loan_offset_links')).toBe(1);
    run('DELETE FROM loans');
    expect(count('loan_balance_entries')).toBe(0);
    expect(count('loan_offset_links')).toBe(0);
    run('DELETE FROM properties');
    expect(count('property_valuations')).toBe(0);
  });

  it('enforces the Stage 4 keys: one entry per parent and date, one statement per month, one link per account', () => {
    run(
      "INSERT INTO other_assets (id, description, units, sort_order) VALUES (1, 'Example watch', '1', 1)",
    );
    const price =
      "INSERT INTO other_asset_prices (other_asset_id, as_of, unit_price) VALUES (1, '2026-08-31', '1800')";
    run(price);
    expect(() => run(price)).toThrow(/UNIQUE/);
    run(
      "INSERT INTO super_funds (id, name, balance_cents, sort_order) VALUES (1, 'Example Super', 0, 1)",
    );
    const balance =
      "INSERT INTO super_balance_entries (fund_id, as_of, balance_cents) VALUES (1, '2026-08-31', 0)";
    run(balance);
    expect(() => run(balance)).toThrow(/UNIQUE/);
    const statement =
      "INSERT INTO super_sg_overrides (period_month, gross_cents) VALUES ('2026-08', 90000)";
    run(statement);
    expect(() => run(statement)).toThrow(/UNIQUE/);
    run("INSERT INTO properties (id, name, sort_order) VALUES (1, 'Example property', 1)");
    const valuation =
      "INSERT INTO property_valuations (property_id, as_of, value_cents) VALUES (1, '2026-08-31', 100)";
    run(valuation);
    expect(() => run(valuation)).toThrow(/UNIQUE/);
    run(
      "INSERT INTO loans (id, property_id, name, current_balance_cents, sort_order) VALUES (1, 1, 'Example mortgage', 100, 1)",
    );
    run(
      "INSERT INTO loans (id, property_id, name, current_balance_cents, sort_order) VALUES (2, 1, 'Second mortgage', 100, 2)",
    );
    const loanEntry =
      "INSERT INTO loan_balance_entries (loan_id, as_of, balance_cents) VALUES (1, '2026-08-31', 100)";
    run(loanEntry);
    expect(() => run(loanEntry)).toThrow(/UNIQUE/);
    run(
      "INSERT INTO cash_accounts (id, name, balance_cents, sort_order, is_offset) VALUES (1, 'Offset account', 0, 1, 1)",
    );
    run('INSERT INTO loan_offset_links (account_id, loan_id) VALUES (1, 1)');
    expect(() => run('INSERT INTO loan_offset_links (account_id, loan_id) VALUES (1, 2)')).toThrow(
      /UNIQUE|PRIMARY KEY/,
    );
    expect(() => run('INSERT INTO loan_offset_links (account_id, loan_id) VALUES (9, 1)')).toThrow(
      /FOREIGN KEY/,
    );
    const history =
      'INSERT INTO market_quote_history (series_id, date, value, source, fetched_at) ' +
      "VALUES ('XAG_AUD_OZ', '2026-09-24', '50', 'fake', '2026-09-24T04:32:00.000Z')";
    run(history);
    expect(() => run(history)).toThrow(/UNIQUE|PRIMARY KEY/);
    // The new columns: receives_sg defaults to false; the purchase FX columns to null.
    expect(value('SELECT receives_sg FROM super_funds WHERE id = 1')).toBe(0);
    expect(value('SELECT purchase_fx_rate FROM other_assets WHERE id = 1')).toBeNull();
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
