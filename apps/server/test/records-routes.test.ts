// GET /api/records and /api/records/:entity against the generic seed (stage-1.md §3.2, §7.5).
import { join } from 'node:path';
import {
  RECORD_ENTITIES,
  RECORD_ENTITY_IDS,
  RECORDS_PAGE_CAP,
  type RecordsIndexResponse,
  type RecordsPageResponse,
} from '@joinr/schema';
import {
  cashAccounts,
  dividendEvents,
  savingsAdjustments,
  savingsGoals,
  yearlyExpenses,
} from '@joinr/schema/db';
import { seedGenericData, type SeedResult } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { sortRows } from '../src/records/index';
import { makeTempDir, removeDir, testConfig } from './helpers';

const NOW = new Date('2026-09-24T04:00:00.000Z');

let tempDir: string;
let database: AppDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  tempDir = await makeTempDir();
  const config = testConfig(join(tempDir, 'data'));
  database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  app = await buildApp({ config, db: database });
});

afterEach(async () => {
  await app.close();
  closeDatabase(database);
  await removeDir(tempDir);
});

async function getPage(entity: string): Promise<RecordsPageResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/records/${entity}` });
  expect(res.statusCode).toBe(200);
  return res.json<RecordsPageResponse>();
}

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

/**
 * The seed writes no Stage 3 overlays or dividend events (stage-3.md §3.6); these tests add one
 * of each (generic values) so every record page has rows.
 */
function seedWithOverlays(): SeedResult {
  const seeded = seedGenericData(database.db, { now: NOW });
  database.db
    .insert(savingsAdjustments)
    .values({ periodMonth: '2026-07', amountCents: -100000, note: 'Car sold', origin: 'app' })
    .run();
  database.db
    .insert(savingsGoals)
    .values([
      { name: 'Holiday', targetCents: 500000, targetDate: '2027-06-30', sortOrder: 2 },
      { name: 'Emergency buffer', targetCents: 1000000, sortOrder: 1, note: 'First' },
    ])
    .run();
  database.db
    .insert(dividendEvents)
    .values([
      {
        instrumentId: seeded.instrumentIds['ASX:XYZ']!,
        exDate: '2026-06-30',
        amountPerUnit: '1.2',
        currency: 'AUD',
        closeBeforeEx: '104.5',
        closeDate: '2026-06-29',
        source: 'fake',
        fetchedAt: NOW.toISOString(),
        dismissedAt: NOW.toISOString(),
      },
      {
        instrumentId: seeded.instrumentIds['ASX:DEF']!,
        exDate: '2026-09-01',
        amountPerUnit: '0.45',
        currency: 'AUD',
        source: 'fake',
        fetchedAt: NOW.toISOString(),
      },
    ])
    .run();
  return seeded;
}

describe('GET /api/records', () => {
  it('lists every entity in registry order with zero counts on an empty database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/records' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<RecordsIndexResponse>();
    expect(body.entities.map((e) => e.id)).toEqual([...RECORD_ENTITY_IDS]);
    for (const e of body.entities) {
      expect(e).toEqual({
        id: e.id,
        label: RECORD_ENTITIES[e.id].label,
        group: RECORD_ENTITIES[e.id].group,
        count: 0,
      });
    }
  });

  it('counts the seeded rows of every entity', async () => {
    seedWithOverlays();
    const body = (
      await app.inject({ method: 'GET', url: '/api/records' })
    ).json<RecordsIndexResponse>();
    const counts = Object.fromEntries(body.entities.map((e) => [e.id, e.count]));
    for (const id of RECORD_ENTITY_IDS) expect(counts[id], id).toBeGreaterThan(0);
    expect(counts.instruments).toBe(8);
    expect(counts.trades).toBe(9);
    expect(counts.dividends).toBe(2);
    expect(counts['cash-accounts']).toBe(4);
    // Stage 3: one balance entry per account plus an earlier one; side income as deposits.
    expect(counts['cash-balance-entries']).toBe(5);
    expect(counts['side-income']).toBe(3);
    expect(counts['savings-goals']).toBe(2);
    expect(counts['dividend-events']).toBe(2);
  });
});

describe('GET /api/records/:entity', () => {
  beforeEach(() => {
    seedWithOverlays();
  });

  it.each(RECORD_ENTITY_IDS)(
    '%s returns its registry columns and cells for every column',
    async (id) => {
      const page = await getPage(id);
      const meta = RECORD_ENTITIES[id];
      expect(page.entity).toMatchObject({ id, label: meta.label, group: meta.group });
      expect(page.entity.count).toBe(page.rows.length);
      expect(page.columns).toEqual(meta.columns);
      expect(page.rows.length).toBeGreaterThan(0);
      const columnIds = meta.columns.map((c) => c.id).sort();
      for (const row of page.rows) {
        expect(typeof row.id).toBe('string');
        expect(Object.keys(row.cells).sort()).toEqual(columnIds);
        for (const column of meta.columns) {
          const cell = row.cells[column.id];
          if (cell === null) continue;
          switch (column.type) {
            case 'money':
            case 'integer':
              expect(Number.isInteger(cell), `${id}.${column.id}`).toBe(true);
              break;
            case 'quantity':
            case 'price':
            case 'ratio':
              expect(cell, `${id}.${column.id}`).toMatch(DECIMAL_RE);
              break;
            case 'date':
              expect(cell, `${id}.${column.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
              break;
            case 'month':
              expect(cell, `${id}.${column.id}`).toMatch(/^\d{4}-\d{2}$/);
              break;
            case 'timestamp':
              expect(cell, `${id}.${column.id}`).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
              break;
            case 'boolean':
              expect(typeof cell, `${id}.${column.id}`).toBe('boolean');
              break;
            case 'flags':
              expect(Array.isArray(cell), `${id}.${column.id}`).toBe(true);
              break;
            case 'text':
              expect(typeof cell, `${id}.${column.id}`).toBe('string');
              break;
            case 'setting':
              expect(['string', 'number', 'boolean']).toContain(typeof cell);
              break;
          }
        }
      }
    },
  );

  it('serialises trades: joined symbol and kind, order value in cents, flags as arrays', async () => {
    const page = await getPage('trades');
    const abc = page.rows.find((r) => r.cells.symbol === 'ASX:ABC' && r.cells.units === '100');
    expect(abc?.cells).toMatchObject({
      date: '2025-01-15',
      kind: 'stock',
      price: '10',
      orderValue: 100000,
      fee: 1000,
      feeRate: null,
      flags: [],
    });
    const sell = page.rows.find((r) => r.cells.units === '-20');
    expect(sell?.cells.orderValue).toBe(-12000);
    const flagged = page.rows.find((r) => r.cells.symbol === 'ASX:DEF');
    expect(flagged?.cells.flags).toEqual(['out_of_order']);
    const btc = page.rows.find((r) => r.cells.symbol === 'BTC');
    expect(btc?.cells).toMatchObject({ units: '0.05', orderValue: 450000, feeRate: '0.005' });
    // Default sort: newest first.
    const dates = page.rows.map((r) => r.cells.date as string);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('serialises instruments with held units and the price source', async () => {
    const page = await getPage('instruments');
    const bySymbol = new Map(page.rows.map((r) => [r.cells.symbol, r.cells]));
    expect(bySymbol.get('ASX:ABC')).toMatchObject({
      heldUnits: '150',
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
      watched: true,
    });
    expect(bySymbol.get('ASX:OLD')).toMatchObject({ heldUnits: '0', watched: false });
    expect(bySymbol.get('EXAMPLEFUND2')).toMatchObject({ heldUnits: '0', provider: 'none' });
  });

  it('links dividends and budget items by id and flags the unmatched ones', async () => {
    const dividends = await getPage('dividends');
    const linked = dividends.rows.find((r) => r.cells.ticker === 'XYZ');
    expect(linked?.cells).toMatchObject({ symbol: 'ASX:XYZ', netAmount: 12000, flags: [] });
    const unmatched = dividends.rows.find((r) => r.cells.ticker === 'ZZZ');
    expect(unmatched?.cells).toMatchObject({ symbol: null, flags: ['unmatched_ticker'] });

    const budget = await getPage('budget-items');
    const stale = budget.rows.find((r) => r.cells.flags && (r.cells.flags as string[]).length > 0);
    expect(stale?.cells).toMatchObject({ linkedAccount: null, flags: ['unmatched_account'] });
    const rent = budget.rows.find((r) => r.cells.name === 'Rent');
    expect(rent?.cells.linkedAccount).toBe('Example Bank – Everyday');
  });

  it('lists the Stage 3 entities: deposits, balance entries, overlays and events', async () => {
    const deposits = await getPage('side-income');
    expect(deposits.rows.map((r) => r.cells.date)).toEqual([
      '2026-08-20',
      '2026-07-31',
      '2026-06-30',
    ]);
    expect(deposits.rows[0]!.cells).toMatchObject({ stream: 'Side income 2', amount: 20000 });

    const entries = await getPage('cash-balance-entries');
    const everyday = entries.rows.filter((r) => r.cells.account === 'Example Bank – Everyday');
    expect(everyday.map((r) => r.cells.asOf)).toEqual(['2026-08-31', '2026-07-31']);

    const goals = await getPage('savings-goals');
    expect(goals.rows.map((r) => r.cells.name)).toEqual(['Emergency buffer', 'Holiday']);

    const events = await getPage('dividend-events');
    expect(events.rows.map((r) => [r.cells.symbol, r.cells.dismissed])).toEqual([
      ['ASX:DEF', false],
      ['ASX:XYZ', true],
    ]);
    expect(events.rows[1]!.id).toMatch(/^\d+:2026-06-30$/);
  });

  it('maps every History value column of the snapshots', async () => {
    const page = await getPage('snapshots');
    const periods = page.rows.map((r) => r.cells.period as string);
    expect(periods).toEqual([...periods].sort().reverse());
    const anyMoney = page.rows.some((r) => typeof r.cells.stocksValue === 'number');
    expect(anyMoney).toBe(true);
  });

  it('values AUD other assets from remaining units × unit price', async () => {
    const page = await getPage('other-assets');
    for (const r of page.rows) {
      if (r.cells.currency !== 'AUD' || r.cells.unitPrice === null) {
        expect(r.cells.value).toBeNull();
      } else {
        expect(typeof r.cells.value).toBe('number');
      }
    }
  });

  it('gives settings rows their key as id and a valueType from the registry', async () => {
    const page = await getPage('settings');
    for (const r of page.rows) {
      expect(r.id).toBe(r.cells.key);
      expect(r.valueType).toBeDefined();
      expect(r.cells.label).not.toBe(r.cells.key);
    }
  });

  it('shows an empty table for an entity without rows', async () => {
    database.db.delete(cashAccounts).run();
    const page = await getPage('cash-accounts');
    expect(page.rows).toEqual([]);
    expect(page.entity.count).toBe(0);
  });

  it('returns at most RECORDS_PAGE_CAP rows but the full count', async () => {
    const rows = Array.from({ length: RECORDS_PAGE_CAP + 1 }, (_, i) => ({
      name: `Expense ${i}`,
      annualCents: 100,
      sortOrder: i,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      database.db
        .insert(yearlyExpenses)
        .values(rows.slice(i, i + 500))
        .run();
    }
    const page = await getPage('yearly-expenses');
    expect(page.rows).toHaveLength(RECORDS_PAGE_CAP);
    expect(page.entity.count).toBeGreaterThan(RECORDS_PAGE_CAP);
  });

  it.each(['unknown', 'Trades', 'cash_accounts', '__proto__'])(
    '%s is a JSON 404',
    async (entity) => {
      const res = await app.inject({ method: 'GET', url: `/api/records/${entity}` });
      expect(res.statusCode).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    },
  );
});

describe('sortRows', () => {
  const r = (id: number, cells: Record<string, string | number | null>) => ({
    id: String(id),
    cells,
  });

  it('sorts newest first with nulls last and keeps ties in order', () => {
    const sorted = sortRows('trades', [
      r(1, { date: '2025-01-01' }),
      r(2, { date: null }),
      r(3, { date: '2026-01-01' }),
      r(4, { date: '2025-01-01' }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['3', '1', '4', '2']);
  });

  it('sorts names ascending', () => {
    const sorted = sortRows('cash-accounts', [r(1, { name: 'b' }), r(2, { name: 'a' })]);
    expect(sorted.map((x) => x.id)).toEqual(['2', '1']);
  });
});
