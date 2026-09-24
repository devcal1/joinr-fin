import { eq, getTableName, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_TABLES_DELETE_ORDER,
  instruments,
  prices,
  priceSources,
  tables,
  trades,
} from '../src/db/index';
import {
  createTestDb,
  dumpDomainTables,
  dumpDomainTablesJson,
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
    expect(n.n).toBe(2);
    expect(testDb.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('seedGenericData', () => {
  it('puts rows in every table', () => {
    seedGenericData(testDb.db);
    for (const table of Object.values(tables)) {
      expect(count(getTableName(table)), getTableName(table)).toBeGreaterThan(0);
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
