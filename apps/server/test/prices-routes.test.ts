import { join } from 'node:path';
import type {
  ApiErrorBody,
  MarketSeriesResponse,
  PriceItem,
  PricesResponse,
  RefreshResponse,
} from '@joinr/schema';
import { seedGenericData } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type ServicesFactory } from '../src/app';
import type { Config } from '../src/config';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { createService } from '../src/market/service';
import { createScheduler } from '../src/scheduler/index';
import { makeTempDir, removeDir, testConfig } from './helpers';

let tempDir: string;
let config: Config;
let database: AppDatabase;
let app: FastifyInstance | undefined;
let ids: Record<string, number>;

/** Fake prices (no network), no refresh timer. */
const fakeServices: ServicesFactory = ({ database: db, log }) => {
  const scheduler = createScheduler({ db: db.db, log });
  const market = createService({
    db: db.db,
    config: { marketDataMode: 'fake', priceRefreshMinutes: 0 },
    log,
    scheduler,
  });
  return { scheduler, market };
};

async function start(services?: ServicesFactory): Promise<FastifyInstance> {
  app = await buildApp({ config, db: database, services });
  return app;
}

beforeEach(async () => {
  tempDir = await makeTempDir();
  config = testConfig(join(tempDir, 'data'));
  database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  ids = seedGenericData(database.db).instrumentIds;
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  closeDatabase(database);
  await removeDir(tempDir);
});

function expectError(
  res: { statusCode: number; json: <T>() => T; headers: Record<string, unknown> },
  status: number,
  code: string,
) {
  expect(res.statusCode).toBe(status);
  expect(res.headers['cache-control']).toBe('no-store');
  const body = res.json<ApiErrorBody>();
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  return body;
}

describe('GET /api/prices', () => {
  it('returns the prices response, no-store', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({ method: 'GET', url: '/api/prices' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<PricesResponse>();
    expect(body.mode).toBe('fake');
    expect(body.refreshIntervalMinutes).toBe(0);
    expect(body.running).toBe(false);
    expect(body.items).toHaveLength(8);
    expect(body.items[0]).toMatchObject({ symbol: 'ASX:ABC', held: true, heldUnits: '150' });
    expect(body.series.map((s) => s.seriesId)).toEqual([
      'AUDUSD',
      'SI_USD_OZ',
      'GC_USD_OZ',
      'XAG_AUD_OZ',
      'XAU_AUD_OZ',
    ]);
  });

  it('works in mode off (the default services)', async () => {
    const a = await start();
    const body = (await a.inject({ method: 'GET', url: '/api/prices' })).json<PricesResponse>();
    expect(body.mode).toBe('off');
  });
});

describe('POST /api/prices/refresh', () => {
  it('runs a refresh and returns the summary with the new prices', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({ method: 'POST', url: '/api/prices/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<RefreshResponse>();
    expect(body.summary).toMatchObject({ requested: 5, ok: 5, failed: 0, skipped: 0 });
    expect(body.summary.jobRunId).toEqual(expect.any(Number));
    expect(body.prices.lastRun).toMatchObject({ id: body.summary.jobRunId, trigger: 'manual' });
    const abc = body.prices.items.find((i) => i.symbol === 'ASX:ABC')!;
    expect(abc).toMatchObject({ status: 'fresh', priceSource: 'fake' });
  });

  it('accepts a JSON body with ids and force', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({
      method: 'POST',
      url: '/api/prices/refresh',
      payload: { instrumentIds: [ids['ASX:ABC']], force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<RefreshResponse>().summary).toMatchObject({ requested: 1, ok: 1 });
  });

  it('rejects an invalid body with 400', async () => {
    const a = await start(fakeServices);
    for (const payload of [
      { instrumentIds: 'all' },
      { force: 'yes' },
      { extra: 1 },
      { instrumentIds: [0] },
    ]) {
      const res = await a.inject({ method: 'POST', url: '/api/prices/refresh', payload });
      expectError(res, 400, 'VALIDATION_ERROR');
    }
  });

  it('answers 503 MARKET_DATA_DISABLED in mode off', async () => {
    const a = await start();
    const res = await a.inject({ method: 'POST', url: '/api/prices/refresh' });
    const body = expectError(res, 503, 'MARKET_DATA_DISABLED');
    expect(body.error.message).toMatch(/switched off/);
  });
});

describe('PUT /api/prices/:instrumentId/manual', () => {
  it('sets a manual price (normalised) and returns the item', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({
      method: 'PUT',
      url: `/api/prices/${ids['ASX:XYZ']}/manual`,
      payload: { price: '12.50', asOf: '2020-01-02', note: 'Broker quote' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json<PriceItem>()).toMatchObject({
      instrumentId: ids['ASX:XYZ'],
      price: '12.5',
      priceSource: 'manual',
      status: 'stale', // older than 31 days
      manual: { price: '12.5', asOf: '2020-01-02', note: 'Broker quote', origin: 'user' },
    });
  });

  it('validates the body and the id', async () => {
    const a = await start(fakeServices);
    const url = `/api/prices/${ids['ASX:XYZ']}/manual`;
    for (const payload of [
      { price: '0', asOf: '2026-01-01' },
      { price: '-1', asOf: '2026-01-01' },
      { price: '1.123456789', asOf: '2026-01-01' },
      { price: '1', asOf: '2999-01-01' },
      { price: '1', asOf: '01/02/2026' },
      { price: '1' },
      { price: '1', asOf: '2026-01-01', note: 'x'.repeat(201) },
    ]) {
      expectError(await a.inject({ method: 'PUT', url, payload }), 400, 'VALIDATION_ERROR');
    }
    expectError(
      await a.inject({
        method: 'PUT',
        url: '/api/prices/abc/manual',
        payload: { price: '1', asOf: '2026-01-01' },
      }),
      400,
      'VALIDATION_ERROR',
    );
    expectError(
      await a.inject({
        method: 'PUT',
        url: '/api/prices/0/manual',
        payload: { price: '1', asOf: '2026-01-01' },
      }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('answers 404 for an unknown instrument', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({
      method: 'PUT',
      url: '/api/prices/999/manual',
      payload: { price: '1', asOf: '2026-01-01' },
    });
    expect(expectError(res, 404, 'NOT_FOUND').error.message).toBe('No instrument 999');
  });
});

describe('DELETE /api/prices/:instrumentId/manual', () => {
  it('clears the manual price', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({ method: 'DELETE', url: `/api/prices/${ids.EXAMPLEFUND}/manual` });
    expect(res.statusCode).toBe(200);
    expect(res.json<PriceItem>()).toMatchObject({ manual: null, price: null, status: 'none' });
  });

  it('answers 404 for an unknown instrument', async () => {
    const a = await start(fakeServices);
    expectError(
      await a.inject({ method: 'DELETE', url: '/api/prices/999/manual' }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('PUT /api/prices/:instrumentId/source', () => {
  it('sets the provider and symbol (symbol origin user)', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({
      method: 'PUT',
      url: `/api/prices/${ids.ETH}/source`,
      payload: { provider: 'coingecko', providerSymbol: 'ethereum' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<PriceItem>()).toMatchObject({
      provider: 'coingecko',
      providerSymbol: 'ethereum',
      symbolOrigin: 'user',
    });
  });

  it('validates the body', async () => {
    const a = await start(fakeServices);
    const url = `/api/prices/${ids.ETH}/source`;
    for (const payload of [
      { provider: 'coingecko', providerSymbol: null },
      { provider: 'yahoo', providerSymbol: 'bad symbol' },
      { provider: 'yahoo', providerSymbol: 'https://evil.example/' },
      { provider: 'other', providerSymbol: 'X' },
      { provider: 'yahoo', providerSymbol: 'x'.repeat(65) },
    ]) {
      expectError(await a.inject({ method: 'PUT', url, payload }), 400, 'VALIDATION_ERROR');
    }
  });

  it('answers 404 for an unknown instrument', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({
      method: 'PUT',
      url: '/api/prices/999/source',
      payload: { provider: 'none', providerSymbol: null },
    });
    expectError(res, 404, 'NOT_FOUND');
  });
});

describe('GET /api/market/series', () => {
  it('lists the series', async () => {
    const a = await start(fakeServices);
    const res = await a.inject({ method: 'GET', url: '/api/market/series' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<MarketSeriesResponse>();
    expect(body.series).toHaveLength(5);
    expect(body.series[0]).toMatchObject({ seriesId: 'AUDUSD', label: 'AUD/USD', value: '0.65' });
  });
});
