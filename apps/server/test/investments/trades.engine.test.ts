// Trade mutations with the REAL engine (stage-2.md §7.4 step 5, gated on ENGINE_IMPLEMENTED): the
// recomputed TradeRowDto bodies (201/200), 422 TRADE_OVERSELL on a sell beyond the held units and
// on deleting a buy that a later sell needs, and D34 hasAppData after each kind of change.
import { join } from 'node:path';
import { ENGINE_IMPLEMENTED } from '@joinr/engine';
import type {
  ApiErrorBody,
  ImportRunsResponse,
  TradeInputBody,
  TradeMutationResponse,
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
import { readAppEditMarker } from '../../src/db/queries/domain';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { NOW } from './helpers';

describe.skipIf(!ENGINE_IMPLEMENTED)('trade mutations with the real engine', () => {
  let tempDir: string;
  let database: AppDatabase;
  let app: FastifyInstance;
  let ids: Record<string, number>;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    const config = testConfig(join(tempDir, 'data'));
    database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    ids = seedGenericData(database.db, { now: NOW }).instrumentIds;
    app = await buildApp({ config, db: database, now: () => NOW });
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(database);
    await removeDir(tempDir);
  });

  const id = (symbol: string): number => ids[symbol]!;

  const post = (payload: TradeInputBody) =>
    app.inject({ method: 'POST', url: '/api/trades', payload });
  const put = (tradeId: number, payload: TradeInputBody) =>
    app.inject({ method: 'PUT', url: `/api/trades/${tradeId}`, payload });
  const del = (tradeId: number) => app.inject({ method: 'DELETE', url: `/api/trades/${tradeId}` });
  const hasAppData = async () =>
    (await app.inject({ method: 'GET', url: '/api/import/runs' })).json<ImportRunsResponse>()
      .hasAppData;

  const abcBuy = (over: Partial<TradeInputBody> = {}): TradeInputBody => ({
    instrumentId: id('ASX:ABC'),
    side: 'buy',
    tradeDate: '2026-09-01',
    quantity: { mode: 'units', units: '10' },
    price: '12',
    fee: { kind: 'flat', cents: 1000 },
    ...over,
  });

  it('answers 201 with the recomputed buy row and 200 after an update', async () => {
    const res = await post(abcBuy());
    expect(res.statusCode).toBe(201);
    const trade = res.json<TradeMutationResponse>().trade;
    expect(trade).toMatchObject({
      symbol: 'ASX:ABC',
      side: 'buy',
      units: '10',
      price: '12',
      orderValueCents: 12000,
      fee: { kind: 'flat', cents: 1000 },
      feeCents: 1000,
      origin: 'app',
      flags: [],
      remainingUnits: '10',
      // (12.5 − 12) × 10 − $10 fee
      unrealisedCents: -500,
      realisedCents: null,
      oversoldUnits: null,
    });

    const updated = await put(trade.id, abcBuy({ quantity: { mode: 'units', units: '5' } }));
    expect(updated.statusCode).toBe(200);
    expect(updated.json<TradeMutationResponse>().trade).toMatchObject({
      id: trade.id,
      units: '5',
      orderValueCents: 6000,
      remainingUnits: '5',
      // (12.5 − 12) × 5 − $10 fee
      unrealisedCents: -750,
    });
  });

  it('books a FIFO realised gain on a sell with the long-term split', async () => {
    const res = await post(
      abcBuy({
        side: 'sell',
        tradeDate: '2026-09-02',
        quantity: { mode: 'units', units: '50' },
        price: '13',
      }),
    );
    expect(res.statusCode).toBe(201);
    // 50 of the first parcel (100 @ $10, $10 fee): cost 500 + 5 = 505; proceeds 650 − 10 = 640.
    expect(res.json<TradeMutationResponse>().trade).toMatchObject({
      side: 'sell',
      units: '50',
      orderValueCents: 65000,
      realisedCents: 13500,
      realisedShortCents: 0,
      realisedLongCents: 13500,
      oversoldUnits: null,
      remainingUnits: null,
    });
  });

  it('refuses an oversell (422) and leaves the database unchanged', async () => {
    const dump = dumpDomainTables(database.db);
    const res = await post({
      ...abcBuy(),
      instrumentId: id('ASX:DEF'),
      side: 'sell',
      tradeDate: '2025-11-15',
      quantity: { mode: 'units', units: '20' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>().error).toEqual({
      code: 'TRADE_OVERSELL',
      message: 'The sell on 15/11/2025 is for 20 units but only 10 are held then.',
    });
    expect(dumpDomainTables(database.db)).toEqual(dump);
    expect(await hasAppData()).toBe(false);
  });

  it('refuses deleting a buy that a later sell needs (422), and an update that would oversell', async () => {
    const dump = dumpDomainTables(database.db);
    // ASX:OLD: bought 20 on 01/03/2024, all sold on 03/02/2025.
    const res = await del(3);
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>().error).toEqual({
      code: 'TRADE_OVERSELL',
      message: 'The sell on 03/02/2025 is for 20 units but only 0 are held then.',
    });
    const shrink = await put(3, {
      instrumentId: id('ASX:OLD'),
      side: 'buy',
      tradeDate: '2024-03-01',
      quantity: { mode: 'units', units: '15' },
      price: '5',
      fee: { kind: 'flat', cents: 1000 },
    });
    expect(shrink.statusCode).toBe(422);
    expect(shrink.json<ApiErrorBody>().error.message).toBe(
      'The sell on 03/02/2025 is for 20 units but only 15 are held then.',
    );
    expect(dumpDomainTables(database.db)).toEqual(dump);
    expect(readAppEditMarker(database.db)).toBeNull();
  });

  it('D34: hasAppData after a create, an import-row update, an import-row delete and edit-then-delete', async () => {
    expect(await hasAppData()).toBe(false);

    // Create, then delete that app row: no marker, nothing left.
    const created = (await post(abcBuy())).json<TradeMutationResponse>().trade;
    expect(await hasAppData()).toBe(true);
    expect((await del(created.id)).statusCode).toBe(200);
    expect(readAppEditMarker(database.db)).toBeNull();
    expect(await hasAppData()).toBe(false);

    // Update an imported row (same values): origin app.
    const same: TradeInputBody = {
      instrumentId: id('ASX:ABC'),
      side: 'buy',
      tradeDate: '2025-06-16',
      quantity: { mode: 'units', units: '50' },
      price: '12',
      fee: { kind: 'flat', cents: 1000 },
    };
    const edited = await put(2, same);
    expect(edited.statusCode).toBe(200);
    expect(edited.json<TradeMutationResponse>().trade.origin).toBe('app');
    expect(await hasAppData()).toBe(true);

    // Delete that edited imported row: it came from the workbook, so the marker is written.
    expect((await del(2)).statusCode).toBe(200);
    expect(readAppEditMarker(database.db)?.count).toBe(1);
    expect(await hasAppData()).toBe(true);

    // Delete another imported row: the count rises.
    expect((await del(9)).statusCode).toBe(200);
    expect(readAppEditMarker(database.db)?.count).toBe(2);
  });
});
