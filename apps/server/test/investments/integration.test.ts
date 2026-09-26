// Integration with the REAL engine (stage-2.md §7.4 step 6, gated on ENGINE_IMPLEMENTED and, from
// Stage 3, on CASHFLOW_ENGINE_IMPLEMENTED: the timing chain reads the live cash, budget and savings,
// stage-3.md §4.5): every page, ledger and detail builds on the generic seed; a trade
// create/update/delete round trip leaves the domain tables as they were; and after importing the
// synthetic workbook (corrections off) the four pages build and count the unpriced holdings the
// price service reports. Stage 4 (stage-4.md §7.4 step 7): the timing chain's class values and
// savings now come from the assets engines too, so the suite also waits for
// ASSETS_ENGINE_IMPLEMENTED.
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  INSTRUMENT_KINDS,
  type HoldingDetailResponse,
  type InvestmentPageResponse,
  type InvestmentTradesResponse,
  type PricesResponse,
  type TradeMutationResponse,
} from '@joinr/schema';
import { dumpDomainTables, seedGenericData } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { AS_OF, NOW } from './helpers';

const CAN_IMPORT = SYNTHETIC_WORKBOOK_IMPLEMENTED && IMPORTER_IMPLEMENTED;

// Stage 5 (stage-5.md §7.4 step 8, the Stage 4 FEAS-1 precedent): the finance context feeds the
// D88 figures (stored offsets, measured-through dates) into computeSavings and computeSuper, so the
// suite also waits for HISTORY_ENGINE_IMPLEMENTED.
describe.skipIf(
  !ENGINE_IMPLEMENTED ||
    !CASHFLOW_ENGINE_IMPLEMENTED ||
    !ASSETS_ENGINE_IMPLEMENTED ||
    !HISTORY_ENGINE_IMPLEMENTED,
)('investments API with the real engine', { timeout: 60_000 }, () => {
  let tempDir: string;
  let database: AppDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    const config = testConfig(join(tempDir, 'data'));
    database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    app = await buildApp({ config, db: database, now: () => NOW });
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(database);
    await removeDir(tempDir);
  });

  const get = async <T>(url: string): Promise<T> => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(200);
    return res.json<T>();
  };

  it('builds every page, ledger and holding detail on the generic seed', async () => {
    const { instrumentIds } = seedGenericData(database.db, { now: NOW });
    for (const kind of INSTRUMENT_KINDS) {
      const page = await get<InvestmentPageResponse>(`/api/investments/${kind}`);
      expect(page.kind).toBe(kind);
      expect(page.asOf).toBe(AS_OF);
      // Summary money = Σ of the held, priced rows it covers.
      const priced = page.holdings.filter((h) => h.status === 'held' && h.valueCents !== null);
      expect(page.summary.valueCents).toBe(priced.reduce((s, h) => s + h.valueCents!, 0));
      expect(page.realisedByFy.length).toBeGreaterThan(0);
      expect(page.charts.points.length).toBeGreaterThan(0);
      expect(page.charts.points.at(-1)!.live).toBe(true);
      const ledger = await get<InvestmentTradesResponse>(`/api/investments/${kind}/trades`);
      expect(ledger.trades.length).toBeGreaterThan(0);
    }
    for (const instrumentId of Object.values(instrumentIds)) {
      const detail = await get<HoldingDetailResponse>(`/api/instruments/${instrumentId}`);
      expect(detail.instrument.id).toBe(instrumentId);
      expect(detail.holding.instrumentId).toBe(instrumentId);
    }
    // The exited stock keeps its realised gain: 20 × (6 − 5) − $10 − $10.
    const stock = await get<InvestmentPageResponse>('/api/investments/stock');
    const old = stock.holdings.find((h) => h.symbol === 'ASX:OLD')!;
    expect(old).toMatchObject({ status: 'exited', realisedCents: 0, units: '0' });
    expect(stock.summary.realisedCents).toBe(0);
  });

  it('a trade create/update/delete round trip leaves the domain tables unchanged', async () => {
    const { instrumentIds } = seedGenericData(database.db, { now: NOW });
    const before = dumpDomainTables(database.db);
    const body = {
      instrumentId: instrumentIds['ASX:DEF']!,
      side: 'buy' as const,
      tradeDate: '2026-09-01',
      quantity: { mode: 'amount' as const, amountCents: 50000 },
      price: '50',
      fee: { kind: 'flat' as const, cents: 0 },
      note: 'e2e-temp',
    };
    const created = await app.inject({ method: 'POST', url: '/api/trades', payload: body });
    expect(created.statusCode).toBe(201);
    const trade = created.json<TradeMutationResponse>().trade;
    expect(trade.units).toBe('10');
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/trades/${trade.id}`,
      payload: { ...body, quantity: { mode: 'units', units: '5' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/trades/${trade.id}` })).statusCode,
    ).toBe(200);
    expect(dumpDomainTables(database.db)).toEqual(before);
  });

  it.skipIf(!CAN_IMPORT)(
    'builds the four pages after importing the synthetic workbook',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/import',
        payload: Buffer.from(buildSyntheticWorkbook()),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(res.statusCode).toBe(201);
      const prices = await get<PricesResponse>('/api/prices');
      for (const kind of INSTRUMENT_KINDS) {
        const page = await get<InvestmentPageResponse>(`/api/investments/${kind}`);
        const unpriced = prices.items.filter(
          (i) => i.kind === kind && i.held && i.price === null,
        ).length;
        expect(page.summary.unpricedCount, kind).toBe(unpriced);
        expect(page.holdings.filter((h) => h.flags.includes('unpriced')).length, kind).toBe(
          unpriced,
        );
        expect(page.holdings.length, kind).toBeGreaterThan(0);
        await get<InvestmentTradesResponse>(`/api/investments/${kind}/trades`);
        for (const h of page.holdings) {
          await get<HoldingDetailResponse>(`/api/instruments/${h.instrumentId}`);
        }
      }
    },
  );
});
