import { eq, getTableName, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cashAccounts,
  cashBalanceEntries,
  dayQuotes,
  dividendEvents,
  DOMAIN_TABLES_DELETE_ORDER,
  incomeStreams,
  instruments,
  loanBalanceEntries,
  loanOffsetLinks,
  loans,
  marketQuoteHistory,
  otherAssetPrices,
  otherAssets,
  otherAssetSales,
  prices,
  priceSources,
  properties,
  propertyValuations,
  savingsAdjustments,
  savingsGoals,
  seriesDayQuotes,
  sideIncomeDeposits,
  sideIncomeEntries,
  snapshotAudit,
  snapshots,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
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
  seedRecordedMonth,
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
    expect(COMMITTED_MIGRATION_COUNT).toBeGreaterThanOrEqual(5); // 0000 … 0004 (Stage 4)
    expect(testDb.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

/**
 * Tables the seed leaves empty on purpose: the Stage 3 overlays and events cache (§3.6), the
 * Stage 1 side-income period entries (never written again: the server reads deposits), and the
 * Stage 4 sales, SG statements (an overlay), offset links and series history (stage-4.md §3.6),
 * and the Stage 5 snapshot audit log (only `seedRecordedMonth` writes it; stage-5.md §3.6), and
 * the Stage 9 day caches (only a price refresh writes them; stage-9.md §3.1, §3.1a).
 */
const UNSEEDED: ReadonlySet<unknown> = new Set([
  dayQuotes,
  seriesDayQuotes,
  savingsAdjustments,
  savingsGoals,
  dividendEvents,
  sideIncomeEntries,
  otherAssetSales,
  superSgOverrides,
  loanOffsetLinks,
  marketQuoteHistory,
  snapshotAudit,
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

  it('clears both Stage 9 day caches when it re-seeds (series_day_quotes has no FK)', () => {
    const now = new Date('2026-09-24T04:32:00.000Z');
    const { instrumentIds } = seedGenericData(testDb.db, { now });
    const row = {
      sessionDate: '2026-09-24',
      timeZone: 'Australia/Melbourne',
      granularity: '5m' as const,
      nativeCurrency: 'AUD',
      previousClose: '1',
      regularStart: null,
      regularEnd: null,
      points: '[]',
      source: 'fake' as const,
      fetchedAt: now.toISOString(),
    };
    testDb.db
      .insert(seriesDayQuotes)
      .values({ seriesId: 'XAG_AUD_OZ', ...row })
      .run();
    testDb.db
      .insert(dayQuotes)
      .values({ instrumentId: instrumentIds['ASX:ABC']!, ...row })
      .run();
    seedGenericData(testDb.db, { now });
    expect(count('series_day_quotes')).toBe(0);
    expect(count('day_quotes')).toBe(0);
  });

  it('dates the fetched Yahoo-style price and series at 00:00 on the previous weekday', () => {
    // Thursday → Wednesday 00:00 local: fresh under the market rule, older than any fake bar.
    const now = new Date(2026, 8, 24, 14, 32);
    const { instrumentIds } = seedGenericData(testDb.db, { now });
    const start = new Date(2026, 8, 23).toISOString();
    const abc = testDb.db
      .select()
      .from(prices)
      .where(eq(prices.instrumentId, instrumentIds['ASX:ABC']!))
      .get();
    expect(abc).toMatchObject({ asOf: start, fetchedAt: start, lastAttemptAt: start });
    const series = testDb.sqlite.prepare('SELECT DISTINCT as_of AS a FROM market_quotes').all();
    expect(series).toEqual([{ a: start }]);
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

describe('seedGenericData: Stage 4 rows (stage-4.md §3.6)', () => {
  it('gives the manual asset two price entries, the latest its unit price; bullion none', () => {
    seedGenericData(testDb.db);
    const assets = testDb.db.select().from(otherAssets).all();
    const entries = testDb.db.select().from(otherAssetPrices).all();
    const manual = assets.find((a) => a.priceSource === 'manual')!;
    const bullion = assets.find((a) => a.priceSource === 'bullion')!;
    const own = entries.filter((e) => e.otherAssetId === manual.id);
    expect(own).toHaveLength(2);
    const latest = own.reduce((x, y) => (y.asOf > x.asOf ? y : x));
    expect(latest).toMatchObject({
      asOf: manual.unitPriceAsOf,
      unitPrice: manual.unitPrice,
      sheetRef: manual.sheetRef,
    });
    expect(entries.filter((e) => e.otherAssetId === bullion.id)).toEqual([]);
    expect(assets.every((a) => a.purchaseFxRate === null && a.purchaseFxSource === null)).toBe(
      true,
    );
  });

  it('gives the SG fund two balance entries and dates every imported contribution', () => {
    seedGenericData(testDb.db);
    const [fund, ...others] = testDb.db.select().from(superFunds).all();
    expect(others).toEqual([]);
    expect(fund!.receivesSg).toBe(true);
    const own = testDb.db.select().from(superBalanceEntries).all();
    expect(own.every((e) => e.fundId === fund!.id && e.transferInCents === null)).toBe(true);
    expect(own).toHaveLength(2);
    const latest = own.reduce((x, y) => (y.asOf > x.asOf ? y : x));
    expect(latest).toMatchObject({ asOf: fund!.balanceAsOf, balanceCents: fund!.balanceCents });
    const contributions = testDb.db
      .select()
      .from(superEntries)
      .all()
      .filter((e) => e.kind === 'voluntary_contribution');
    expect(contributions.every((e) => e.entryDate !== null)).toBe(true);
    expect(contributions.find((e) => e.sheetRef === 'Super!B16')?.entryDate).toBe(
      SEED_WORKBOOK_AS_OF,
    );
    // One History-derived contribution per seeded snapshot, at its run date (History!R<row>).
    const history = contributions.filter((e) => e.sheetRef?.startsWith('History!R'));
    const snaps = testDb.db.select().from(snapshots).all();
    expect(history.map((e) => [e.periodMonth, e.entryDate, e.amountCents, e.sheetRef])).toEqual(
      snaps.map((x) => [
        x.periodMonth,
        x.runDate,
        x.superContribCents,
        `History!R${x.sheetRef!.slice('History!A'.length)}`,
      ]),
    );
  });

  it('gives the property two valuations and each loan two stored entries (no start entry)', () => {
    seedGenericData(testDb.db);
    const [property] = testDb.db.select().from(properties).all();
    const valuations = testDb.db.select().from(propertyValuations).all();
    expect(valuations).toHaveLength(2);
    const latest = valuations.reduce((x, y) => (y.asOf > x.asOf ? y : x));
    expect(latest).toMatchObject({
      propertyId: property!.id,
      asOf: property!.valuationDate,
      valueCents: property!.currentValueCents,
    });
    const entries = testDb.db.select().from(loanBalanceEntries).all();
    for (const loan of testDb.db.select().from(loans).all()) {
      const own = entries.filter((e) => e.loanId === loan.id);
      expect(own, loan.name).toHaveLength(2);
      const last = own.reduce((x, y) => (y.asOf > x.asOf ? y : x));
      expect(last).toMatchObject({
        asOf: loan.balanceAsOf,
        balanceCents: loan.currentBalanceCents,
      });
      // The start fields give the log's start point: they are set and before every entry.
      expect(loan.startDate !== null && loan.startBalanceCents !== null, loan.name).toBe(true);
      expect(own.every((e) => e.asOf > loan.startDate!)).toBe(true);
    }
  });

  it('writes no app rows in the Stage 4 tables and clears the overlay and history on re-seed', () => {
    seedGenericData(testDb.db);
    for (const table of [
      'other_asset_prices',
      'super_balance_entries',
      'property_valuations',
      'loan_balance_entries',
      'super_entries',
      'super_funds',
    ]) {
      const n = testDb.sqlite
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE origin = 'app'`)
        .get() as { n: number };
      expect(n.n, table).toBe(0);
    }
    testDb.db.insert(superSgOverrides).values({ periodMonth: '2026-07', grossCents: 90000 }).run();
    testDb.db
      .insert(marketQuoteHistory)
      .values({
        seriesId: 'XAG_AUD_OZ',
        date: '2026-09-24',
        value: '50',
        source: 'fake',
        fetchedAt: '2026-09-24T04:32:00.000Z',
      })
      .run();
    seedGenericData(testDb.db);
    expect(count('super_sg_overrides')).toBe(0);
    expect(count('market_quote_history')).toBe(0);
  });
});

describe('seedRecordedMonth (stage-5.md §3.6)', () => {
  it('adds one recorded app month with the four extras and one audit row', () => {
    seedGenericData(testDb.db);
    const { snapshotId, auditId } = seedRecordedMonth(testDb.db, {
      periodMonth: '2026-08',
      runDate: '2026-08-31',
    });
    const row = testDb.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get()!;
    expect(row).toMatchObject({
      periodMonth: '2026-08',
      runDate: '2026-08-31',
      source: 'recorded',
      origin: 'app',
      sheetRef: null,
      revision: 0,
      offsetCents: 1500000,
      mortgageOffsetCents: 1000000,
      cashDebtCents: -30000,
      superMeasuredThrough: '2026-08-27',
      liabilitiesBalanceCents: 0,
      liabilitiesPaidCents: 0,
    });
    // The derived columns follow §2.5: O against the seed's Jul 2026 cash, Z net of linked offsets.
    const jul = testDb.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.periodMonth, '2026-07'))
      .get()!;
    expect(row.cashGainCents).toBe(row.cashValueCents! - jul.cashValueCents!);
    expect(row.propertyEquityCents).toBe(
      row.propertyValueCents! + row.mortgageBalanceCents! + row.mortgageOffsetCents!,
    );
    const g = row.stocksGainCents!;
    expect(Number(row.stocksGainRatio)).toBeCloseTo(g / (row.stocksValueCents! - g), 12);
    const audit = testDb.db
      .select()
      .from(snapshotAudit)
      .where(eq(snapshotAudit.id, auditId))
      .get()!;
    expect(audit).toMatchObject({
      periodMonth: '2026-08',
      snapshotId,
      action: 'record',
      trigger: 'manual',
    });
    expect(JSON.parse(audit.snapshotJson!)).toMatchObject({ id: snapshotId, source: 'recorded' });
    // Seeding again clears the recorded month and its audit row.
    seedGenericData(testDb.db);
    expect(count('snapshots')).toBe(3);
    expect(count('snapshot_audit')).toBe(0);
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
    for (const overlay of [
      'savings_adjustments',
      'savings_goals',
      'dividend_events',
      'super_sg_overrides',
      'market_quote_history',
    ]) {
      expect(dump).not.toHaveProperty(overlay);
    }
    // Stage 4: the import writes the logs; the offset links are app rows but dumped (D34).
    for (const log of [
      'other_asset_prices',
      'other_asset_sales',
      'super_balance_entries',
      'property_valuations',
      'loan_balance_entries',
      'loan_offset_links',
    ]) {
      expect(dump).toHaveProperty(log);
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

  it('cascades the Stage 4 logs from their parents and keeps one entry per date', () => {
    seedGenericData(testDb.db);
    const [loan] = testDb.db.select().from(loans).all();
    const [offset] = testDb.db
      .select()
      .from(cashAccounts)
      .all()
      .filter((a) => a.isOffset);
    testDb.db.insert(loanOffsetLinks).values({ accountId: offset!.id, loanId: loan!.id }).run();
    const [asset] = testDb.db.select().from(otherAssets).all();
    testDb.db
      .insert(otherAssetSales)
      .values({ otherAssetId: asset!.id, saleDate: '2026-07-15', units: '1', proceedsCents: 1000 })
      .run();
    // Unique (parent, as_of) keys.
    expect(() =>
      testDb.db
        .insert(otherAssetPrices)
        .values({ otherAssetId: asset!.id, asOf: SEED_WORKBOOK_AS_OF, unitPrice: '1' })
        .run(),
    ).toThrow(/UNIQUE/);
    expect(() =>
      testDb.db
        .insert(superSgOverrides)
        .values([
          { periodMonth: '2026-07', grossCents: 1 },
          { periodMonth: '2026-07', grossCents: 2 },
        ])
        .run(),
    ).toThrow(/UNIQUE/);
    // An account links to at most one loan (the account is the key).
    expect(() =>
      testDb.db.insert(loanOffsetLinks).values({ accountId: offset!.id, loanId: loan!.id }).run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    // Deleting a parent cascades its log.
    testDb.db.delete(otherAssets).where(eq(otherAssets.id, asset!.id)).run();
    expect(
      testDb.db
        .select()
        .from(otherAssetPrices)
        .where(eq(otherAssetPrices.otherAssetId, asset!.id))
        .all(),
    ).toEqual([]);
    expect(count('other_asset_sales')).toBe(0);
    testDb.db.delete(loans).where(eq(loans.id, loan!.id)).run();
    expect(
      testDb.db
        .select()
        .from(loanBalanceEntries)
        .where(eq(loanBalanceEntries.loanId, loan!.id))
        .all(),
    ).toEqual([]);
    expect(count('loan_offset_links')).toBe(0);
    testDb.db.delete(properties).run();
    expect(count('property_valuations')).toBe(0);
    testDb.db.delete(superEntries).run();
    testDb.db.delete(superFunds).run();
    expect(count('super_balance_entries')).toBe(0);
  });

  it('removes an offset link with its cash account', () => {
    seedGenericData(testDb.db);
    const [loan] = testDb.db.select().from(loans).all();
    const [offset] = testDb.db
      .select()
      .from(cashAccounts)
      .all()
      .filter((a) => a.isOffset);
    testDb.db.insert(loanOffsetLinks).values({ accountId: offset!.id, loanId: loan!.id }).run();
    testDb.db.delete(cashAccounts).where(eq(cashAccounts.id, offset!.id)).run();
    expect(count('loan_offset_links')).toBe(0);
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
