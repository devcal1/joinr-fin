import { eq, getTableName, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cashAccounts,
  cashBalanceEntries,
  dividendEvents,
  DOMAIN_TABLES_DELETE_ORDER,
  incomeStreams,
  instruments,
  prices,
  priceSources,
  savingsAdjustments,
  savingsGoals,
  sideIncomeDeposits,
  sideIncomeEntries,
  tables,
  trades,
} from '../src/db/index';
import {
  COMMITTED_MIGRATION_COUNT,
  createTestDb,
  dumpDomainTables,
  dumpDomainTablesJson,
  SEED_WORKBOOK_AS_OF,
  seedGenericData,
  type TestDb,
} from '../src/testing/index';
import { parseReviewFlags } from '../src/index';

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
});

afterEach(() => {
  testDb.close();
});

const count = (table: string): number =>
  (testDb.sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;

describe('createTestDb', () => {
  it('applies every migration with foreign keys on', () => {
    const n = testDb.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
      n: number;
    };
    expect(n.n).toBe(COMMITTED_MIGRATION_COUNT);
    expect(COMMITTED_MIGRATION_COUNT).toBeGreaterThanOrEqual(4); // 0000 … 0003 (Stage 3)
    expect(testDb.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

/**
 * Tables the seed leaves empty on purpose: the Stage 3 overlays and events cache (§3.6), and the
 * Stage 1 side-income period entries (never written again: the server reads deposits).
 */
const UNSEEDED: ReadonlySet<unknown> = new Set([
  savingsAdjustments,
  savingsGoals,
  dividendEvents,
  sideIncomeEntries,
]);

describe('seedGenericData', () => {
  it('puts rows in every table but the overlays, the events cache and the old period entries', () => {
    seedGenericData(testDb.db);
    for (const table of Object.values(tables)) {
      const name = getTableName(table);
      if (UNSEEDED.has(table)) expect(count(name), name).toBe(0);
      else expect(count(name), name).toBeGreaterThan(0);
    }
  });

  it('is idempotent: seeding twice gives the same data, ids included', () => {
    const now = new Date('2026-09-24T04:32:00.000Z');
    seedGenericData(testDb.db, { now });
    const first = dumpDomainTablesJson(testDb.db);
    seedGenericData(testDb.db, { now });
    expect(dumpDomainTablesJson(testDb.db)).toBe(first);
    expect(count('import_runs')).toBe(1);
    expect(count('job_runs')).toBe(1);
  });

  it('covers a sell, a flagged trade and every price status input', () => {
    const { instrumentIds } = seedGenericData(testDb.db);
    const all = testDb.db.select().from(trades).all();
    expect(all.some((row) => row.units.startsWith('-'))).toBe(true);
    expect(all.some((row) => parseReviewFlags(row.reviewFlags).length > 0)).toBe(true);
    const manual = testDb.db
      .select()
      .from(priceSources)
      .where(eq(priceSources.instrumentId, instrumentIds.EXAMPLEFUND!))
      .get();
    expect(manual?.manualPrice).toBe('1.5');
    const statuses = testDb.db
      .select({ s: prices.lastStatus, src: prices.source })
      .from(prices)
      .all();
    expect(statuses).toContainEqual({ s: 'error', src: null });
    expect(statuses).toContainEqual({ s: 'ok', src: 'sheet' });
  });
});

describe('seedGenericData: Stage 2 columns', () => {
  it('sets a $0 default fee on one ETF and a default rate on one crypto, and nothing else', () => {
    const { instrumentIds } = seedGenericData(testDb.db);
    const rows = testDb.db.select().from(instruments).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(instrumentIds['ASX:DEF']!)).toMatchObject({
      kind: 'etf',
      defaultFeeCents: 0,
      defaultFeeRate: null,
    });
    expect(byId.get(instrumentIds.BTC!)).toMatchObject({
      kind: 'crypto',
      defaultFeeCents: null,
      defaultFeeRate: '0.0025',
    });
    const others = rows.filter(
      (r) => r.id !== instrumentIds['ASX:DEF'] && r.id !== instrumentIds.BTC,
    );
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) {
      expect(r.defaultFeeCents, r.symbol).toBeNull();
      expect(r.defaultFeeRate, r.symbol).toBeNull();
    }
  });

  it('writes no app rows (an import after seeding stays allowed, D34)', () => {
    seedGenericData(testDb.db);
    for (const table of ['instruments', 'trades', 'dividends', 'settings']) {
      const n = testDb.sqlite
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE origin = 'app'`)
        .get() as { n: number };
      expect(n.n, table).toBe(0);
    }
  });
});

describe('seedGenericData: Stage 3 rows (stage-3.md §3.6)', () => {
  it('gives every account a balance entry at the as-of, plus an earlier everyday balance', () => {
    seedGenericData(testDb.db);
    const accounts = testDb.db.select().from(cashAccounts).all();
    expect(accounts.map((a) => [a.kind, a.isOffset])).toEqual([
      ['bank', false],
      ['bank', false],
      ['bank', true],
      ['loan_receivable', false],
    ]);
    const entries = testDb.db.select().from(cashBalanceEntries).all();
    for (const a of accounts) {
      const own = entries.filter((e) => e.accountId === a.id);
      const latest = own.reduce((x, y) => (y.asOf > x.asOf ? y : x));
      // The account's balance is its latest entry's (the denormalised copy, D58).
      expect(latest).toMatchObject({
        asOf: a.balanceAsOf,
        balanceCents: a.balanceCents,
        origin: 'import',
        sheetRef: a.sheetRef,
      });
    }
    const everyday = accounts[0]!;
    expect(entries.filter((e) => e.accountId === everyday.id)).toHaveLength(2);
    expect(entries).toHaveLength(accounts.length + 1);
  });

  it('writes the side income as dated deposits only, plus a provisional one', () => {
    seedGenericData(testDb.db);
    const deposits = testDb.db.select().from(sideIncomeDeposits).all();
    // The Stage 1 period entries are no longer seeded (the server reads deposits).
    expect(testDb.db.select().from(sideIncomeEntries).all()).toEqual([]);
    // Two deposits at the Jun and Jul 2026 period ends (the seeded snapshots' run dates).
    expect(deposits.filter((d) => d.depositDate <= '2026-07-31').map((d) => d.depositDate)).toEqual(
      ['2026-06-30', '2026-07-31'],
    );
    expect(deposits.every((d) => d.amountCents !== 0 && d.origin === 'import')).toBe(true);
    // One deposit after the last seeded snapshot (31/07/2026), on or before the as-of.
    const later = deposits.filter((d) => d.depositDate > '2026-07-31');
    expect(later).toHaveLength(1);
    expect(later[0]!.depositDate <= SEED_WORKBOOK_AS_OF).toBe(true);
    const streams = new Set(deposits.map((d) => d.streamId));
    expect(streams.size).toBe(testDb.db.select().from(incomeStreams).all().length);
  });

  it('writes no app rows in the new tables, and no overlays or events', () => {
    seedGenericData(testDb.db);
    for (const table of ['cash_balance_entries', 'side_income_deposits', 'cash_accounts']) {
      const n = testDb.sqlite
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE origin = 'app'`)
        .get() as { n: number };
      expect(n.n, table).toBe(0);
    }
    for (const table of ['savings_adjustments', 'savings_goals', 'dividend_events']) {
      expect(count(table), table).toBe(0);
    }
  });

  it('clears the overlays when it re-seeds', () => {
    seedGenericData(testDb.db);
    testDb.db
      .insert(savingsGoals)
      .values({ name: 'Holiday', targetCents: 500000, sortOrder: 1 })
      .run();
    testDb.db
      .insert(savingsAdjustments)
      .values({ periodMonth: '2026-07', amountCents: 100000, note: 'Car sold' })
      .run();
    seedGenericData(testDb.db);
    expect(count('savings_goals')).toBe(0);
    expect(count('savings_adjustments')).toBe(0);
  });
});

describe('dumpDomainTables', () => {
  it('lists the domain tables plus settings and pricing, in key order', () => {
    seedGenericData(testDb.db);
    const dump = dumpDomainTables(testDb.db);
    for (const table of DOMAIN_TABLES_DELETE_ORDER)
      expect(dump).toHaveProperty(getTableName(table));
    for (const extra of ['instruments', 'settings', 'price_sources', 'prices']) {
      expect(dump).toHaveProperty(extra);
    }
    expect(dump).not.toHaveProperty('import_runs');
    // Stage 3: the import writes balance entries and deposits; overlays and events are not dumped.
    expect(dump.cash_balance_entries!.length).toBeGreaterThan(0);
    expect(dump.side_income_deposits!.length).toBeGreaterThan(0);
    for (const overlay of ['savings_adjustments', 'savings_goals', 'dividend_events']) {
      expect(dump).not.toHaveProperty(overlay);
    }
    const ids = dump.trades!.map((r) => r.id as number);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe('foreign keys', () => {
  it('cascades instrument deletes to trades and pricing, and nulls dividends', () => {
    const { instrumentIds } = seedGenericData(testDb.db);
    const xyz = instrumentIds['ASX:XYZ']!;
    testDb.db.delete(instruments).where(eq(instruments.id, xyz)).run();
    expect(testDb.db.select().from(trades).where(eq(trades.instrumentId, xyz)).all()).toEqual([]);
    expect(testDb.db.select().from(prices).where(eq(prices.instrumentId, xyz)).all()).toEqual([]);
    expect(
      testDb.db.select().from(priceSources).where(eq(priceSources.instrumentId, xyz)).all(),
    ).toEqual([]);
    const linked = testDb.db.all<{ n: number }>(
      sql`SELECT count(*) AS n FROM dividends WHERE ticker = 'XYZ' AND instrument_id IS NULL`,
    );
    expect(linked[0]?.n).toBe(1);
  });

  it('empties the domain tables in DOMAIN_TABLES_DELETE_ORDER without FK errors', () => {
    seedGenericData(testDb.db);
    testDb.db.transaction((tx) => {
      for (const table of DOMAIN_TABLES_DELETE_ORDER) tx.delete(table).run();
    });
    for (const table of DOMAIN_TABLES_DELETE_ORDER) expect(count(getTableName(table))).toBe(0);
    // ids restart at 1 (no AUTOINCREMENT)
    testDb.sqlite
      .prepare("INSERT INTO cash_accounts (name, balance_cents, sort_order) VALUES ('x', 0, 1)")
      .run();
    expect(testDb.sqlite.prepare('SELECT id FROM cash_accounts').get()).toEqual({ id: 1 });
  });

  it('rejects a trade for an unknown instrument', () => {
    expect(() =>
      testDb.sqlite
        .prepare(
          "INSERT INTO trades (instrument_id, trade_date, units, price, seq) VALUES (999, '2025-01-01', '1', '1', 1)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
