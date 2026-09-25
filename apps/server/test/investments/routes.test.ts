// The investments routes through buildApp + inject on the generic seed, with a FAKE engine (a
// units-only model, not FIFO), for everything that does not depend on real figures: 404 and 400
// shapes, the kind rules, 409s (duplicate, in use, import running), the D34 origin rules and the
// deletion marker, the stored trade columns (seq, amount mode, fees) and the refresh notifications.
// Tests that need real FIFO results live in trades.engine.test.ts (gated on the engine).
import { join } from 'node:path';
import {
  instrumentEditableFromDto,
  tradeFeeCents,
  unitsFromAmount,
  type ApiErrorBody,
  type DeletedResponse,
  type HoldingDetailResponse,
  type ImportRunsResponse,
  type InstrumentDto,
  type InvestmentPageResponse,
  type InvestmentTradesResponse,
  type TradeInputBody,
  type TradeMutationResponse,
} from '@joinr/schema';
import { appMeta, instruments, priceSources, trades } from '@joinr/schema/db';
import { dumpDomainTables, seedGenericData } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { DELETED_IMPORT_ROWS_KEY, readAppEditMarker } from '../../src/db/queries/domain';
import {
  AMOUNT_TOO_SMALL_MESSAGE,
  INSTRUMENT_IN_USE_MESSAGE,
} from '../../src/investments/mutations';
import { importLock } from '../../src/routes/import';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { AS_OF, fakeEngine, NOW, spyServices } from './helpers';

let tempDir: string;
let database: AppDatabase;
let app: FastifyInstance;
let ids: Record<string, number>;
let notify: ReturnType<typeof spyServices>['notify'];

beforeEach(async () => {
  tempDir = await makeTempDir();
  const config = testConfig(join(tempDir, 'data'));
  database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  ids = seedGenericData(database.db, { now: NOW }).instrumentIds;
  const spy = spyServices();
  notify = spy.notify;
  app = await buildApp({
    config,
    db: database,
    now: () => NOW,
    engine: fakeEngine(),
    services: spy.factory,
  });
});

afterEach(async () => {
  importLock.release();
  await app.close();
  closeDatabase(database);
  await removeDir(tempDir);
});

const id = (symbol: string): number => {
  const v = ids[symbol];
  if (v === undefined) throw new Error(`no ${symbol}`);
  return v;
};

async function call(opts: InjectOptions) {
  const res = await app.inject(opts);
  return { status: res.statusCode, body: res.json<unknown>(), headers: res.headers };
}

function error(body: unknown): ApiErrorBody['error'] {
  return (body as ApiErrorBody).error;
}

async function hasAppData(): Promise<boolean> {
  const res = await app.inject({ method: 'GET', url: '/api/import/runs' });
  return res.json<ImportRunsResponse>().hasAppData;
}

async function instrument(instrumentId: number): Promise<InstrumentDto> {
  const res = await app.inject({ method: 'GET', url: `/api/instruments/${instrumentId}` });
  expect(res.statusCode).toBe(200);
  return res.json<HoldingDetailResponse>().instrument;
}

function tradeRow(tradeId: number) {
  return database.db.select().from(trades).where(eq(trades.id, tradeId)).get();
}

function instrumentRow(instrumentId: number) {
  return database.db.select().from(instruments).where(eq(instruments.id, instrumentId)).get();
}

const etfBuy = (over: Partial<TradeInputBody> = {}): TradeInputBody => ({
  instrumentId: id('ASX:DEF'),
  side: 'buy',
  tradeDate: '2026-09-01',
  quantity: { mode: 'units', units: '5' },
  price: '52.5',
  fee: { kind: 'flat', cents: 995 },
  ...over,
});

/** A full create body (every editable field is required; nulls by default). */
function newInstrument(
  kind: string,
  symbol: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind,
    symbol,
    name: null,
    watched: true,
    targetRatio: null,
    sector: null,
    location: null,
    mgmtFeeRatio: null,
    regions: null,
    dividendFreqMonths: null,
    drp: null,
    defaultFee: null,
    note: null,
    ...over,
  };
}

describe('reads', () => {
  it('answers 404 for an unknown kind and 400/404 for bad or unknown instrument ids', async () => {
    for (const url of [
      '/api/investments/bonds',
      '/api/investments/ETF',
      '/api/investments/x/trades',
    ]) {
      const res = await call({ method: 'GET', url });
      expect(res.status, url).toBe(404);
      expect(error(res.body).code).toBe('NOT_FOUND');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    for (const url of ['/api/instruments/abc', '/api/instruments/0', '/api/instruments/-1']) {
      const res = await call({ method: 'GET', url });
      expect(res.status, url).toBe(400);
      expect(error(res.body)).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'id: must be a positive integer',
      });
    }
    const missing = await call({ method: 'GET', url: '/api/instruments/999' });
    expect(missing.status).toBe(404);
    expect(error(missing.body)).toEqual({ code: 'NOT_FOUND', message: 'Instrument 999 not found' });
  });

  it('serves the page, the ledger and the detail (no-store)', async () => {
    const page = await app.inject({ method: 'GET', url: '/api/investments/managed_fund' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    const body = page.json<InvestmentPageResponse>();
    expect(body).toMatchObject({ kind: 'managed_fund', asOf: AS_OF });
    expect(body.holdings.map((h) => h.symbol)).toEqual(['EXAMPLEFUND', 'EXAMPLEFUND2']);
    expect(body.holdings[0]).toMatchObject({ status: 'held', units: '1000' });

    const ledger = await app.inject({ method: 'GET', url: '/api/investments/stock/trades' });
    expect(ledger.statusCode).toBe(200);
    const rows = ledger.json<InvestmentTradesResponse>().trades;
    expect(rows.map((r) => [r.tradeDate, r.symbol, r.side])).toEqual([
      ['2025-06-16', 'ASX:ABC', 'buy'],
      ['2025-02-03', 'ASX:OLD', 'sell'],
      ['2025-01-15', 'ASX:ABC', 'buy'],
      ['2024-03-01', 'ASX:OLD', 'buy'],
    ]);
    expect(rows[1]!.units).toBe('20');

    const detail = await app.inject({ method: 'GET', url: `/api/instruments/${id('BTC')}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<HoldingDetailResponse>().instrument).toMatchObject({
      symbol: 'BTC',
      defaultFee: { kind: 'rate', rate: '0.0025' },
      effectiveDefaultFee: { kind: 'rate', rate: '0.0025' },
      tradeCount: 1,
      dividendCount: 0,
    });
  });
});

describe('POST /api/instruments', () => {
  it('creates an app instrument with a derived price source (201)', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/instruments',
      payload: {
        kind: 'etf',
        symbol: ' asx:zzz ',
        name: '  ZZZ Example ETF ',
        watched: true,
        targetRatio: '0.10',
        sector: '',
        location: null,
        mgmtFeeRatio: null,
        regions: { us: '0.5', asia: null, aus: '0.5', other: null },
        dividendFreqMonths: 3,
        drp: null,
        defaultFee: { kind: 'flat', cents: 0 },
        note: 'e2e-temp',
      },
    });
    expect(res.status).toBe(201);
    const dto = res.body as InstrumentDto;
    expect(dto).toMatchObject({
      kind: 'etf',
      symbol: 'ASX:ZZZ',
      exchange: 'ASX',
      code: 'ZZZ',
      name: 'ZZZ Example ETF',
      quoteCurrency: 'AUD',
      watched: true,
      sortOrder: 3,
      targetRatio: '0.1',
      sector: null,
      regions: { us: '0.5', asia: null, aus: '0.5', other: null },
      dividendFreqMonths: 3,
      defaultFee: { kind: 'flat', cents: 0 },
      effectiveDefaultFee: { kind: 'flat', cents: 0 },
      note: 'e2e-temp',
      origin: 'app',
      sheetRef: null,
      tradeCount: 0,
      dividendCount: 0,
      price: { price: null, status: 'none' },
    });
    const source = database.db
      .select()
      .from(priceSources)
      .where(eq(priceSources.instrumentId, dto.id))
      .get();
    expect(source).toMatchObject({
      provider: 'yahoo',
      providerSymbol: 'ZZZ.AX',
      symbolOrigin: 'derived',
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await hasAppData()).toBe(true);
  });

  it('answers 409 INSTRUMENT_EXISTS for the same kind and symbol, but allows another kind', async () => {
    const dup = await call({
      method: 'POST',
      url: '/api/instruments',
      payload: newInstrument('etf', 'asx:def'),
    });
    expect(dup.status).toBe(409);
    expect(error(dup.body)).toEqual({
      code: 'INSTRUMENT_EXISTS',
      message: 'An ETF with the symbol ASX:DEF already exists',
    });
    const other = await call({
      method: 'POST',
      url: '/api/instruments',
      payload: newInstrument('stock', 'ASX:DEF', { watched: false }),
    });
    expect(other.status).toBe(201);
    expect(other.body).toMatchObject({ kind: 'stock', sortOrder: 3, watched: false });
  });

  it('applies the per-kind rules with field paths (400)', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        newInstrument('etf', 'ASX:ZZZ', { defaultFee: { kind: 'rate', rate: '0.001' } }),
        'defaultFee: a percentage fee is for crypto only',
      ],
      [
        newInstrument('stock', 'ASX:ZZZ', {
          regions: { us: '1', asia: null, aus: null, other: null },
        }),
        'regions: must be empty for a stock',
      ],
      [newInstrument('crypto', 'BTC-X'), 'symbol: must be a coin symbol, e.g. BTC'],
      [newInstrument('stock', 'ZZZ'), 'symbol: must be EXCHANGE:CODE, e.g. ASX:ABC'],
    ];
    for (const [payload, message] of cases) {
      const res = await call({ method: 'POST', url: '/api/instruments', payload });
      expect(res.status, message).toBe(400);
      expect(error(res.body).code).toBe('VALIDATION_ERROR');
      expect(error(res.body).message).toContain(message);
    }
    const unknownKey = await call({
      method: 'POST',
      url: '/api/instruments',
      payload: newInstrument('etf', 'ASX:ZZZ', { bogus: 1 }),
    });
    expect(unknownKey.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('PUT /api/instruments/:id (origin rules, §3.3)', () => {
  it('keeps origin and hasAppData false when only the default fee changes', async () => {
    const before = await instrument(id('ASX:XYZ'));
    const body = { ...instrumentEditableFromDto(before), defaultFee: { kind: 'flat', cents: 0 } };
    const dump = dumpDomainTables(database.db);
    const res = await call({ method: 'PUT', url: `/api/instruments/${before.id}`, payload: body });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      origin: 'import',
      defaultFee: { kind: 'flat', cents: 0 },
      effectiveDefaultFee: { kind: 'flat', cents: 0 },
    });
    expect(await hasAppData()).toBe(false);
    // Only the fee column changed.
    const after = dumpDomainTables(database.db);
    const row = (d: typeof dump) =>
      d.instruments!.find((r) => r.id === before.id) as Record<string, unknown>;
    expect({ ...row(after), default_fee_cents: null }).toEqual(row(dump));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('keeps origin on a no-op save of the DTO round trip', async () => {
    for (const symbol of ['ASX:ABC', 'ASX:DEF', 'EXAMPLEFUND', 'BTC']) {
      const dto = await instrument(id(symbol));
      const res = await call({
        method: 'PUT',
        url: `/api/instruments/${dto.id}`,
        payload: instrumentEditableFromDto(dto),
      });
      expect(res.status, symbol).toBe(200);
      expect((res.body as InstrumentDto).origin, symbol).toBe('import');
    }
    expect(await hasAppData()).toBe(false);
  });

  it('keeps origin when text and ratios only differ before normalising', async () => {
    const dto = await instrument(id('ASX:XYZ'));
    const body = {
      ...instrumentEditableFromDto(dto),
      name: `  ${dto.name!}  `,
      targetRatio: '0.600',
      sector: ` ${dto.sector!}`,
      note: '',
    };
    const res = await call({ method: 'PUT', url: `/api/instruments/${dto.id}`, payload: body });
    expect(res.status).toBe(200);
    expect((res.body as InstrumentDto).origin).toBe('import');
    expect(await hasAppData()).toBe(false);
  });

  it('sets origin app when an importer-written field changes', async () => {
    const dto = await instrument(id('ASX:XYZ'));
    const res = await call({
      method: 'PUT',
      url: `/api/instruments/${dto.id}`,
      payload: { ...instrumentEditableFromDto(dto), targetRatio: '0.55', regions: null },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      origin: 'app',
      sheetRef: dto.sheetRef,
      targetRatio: '0.55',
      regions: { us: null, asia: null, aus: null, other: null },
    });
    expect(instrumentRow(dto.id)).toMatchObject({ origin: 'app', regionUsRatio: null });
    expect(await hasAppData()).toBe(true);
  });

  it('parses with the stored kind: a rate default fee on an ETF is 400; kind and symbol are immutable', async () => {
    const dto = await instrument(id('ASX:DEF'));
    const rate = await call({
      method: 'PUT',
      url: `/api/instruments/${dto.id}`,
      payload: { ...instrumentEditableFromDto(dto), defaultFee: { kind: 'rate', rate: '0.001' } },
    });
    expect(rate.status).toBe(400);
    expect(error(rate.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'defaultFee: a percentage fee is for crypto only',
    });
    const kind = await call({
      method: 'PUT',
      url: `/api/instruments/${dto.id}`,
      payload: { ...instrumentEditableFromDto(dto), kind: 'crypto', symbol: 'ZZZ' },
    });
    expect(kind.status).toBe(400);
    expect(instrumentRow(dto.id)).toMatchObject({
      kind: 'etf',
      symbol: 'ASX:DEF',
      origin: 'import',
    });

    const btc = await instrument(id('BTC'));
    const ok = await call({
      method: 'PUT',
      url: `/api/instruments/${btc.id}`,
      payload: { ...instrumentEditableFromDto(btc), defaultFee: { kind: 'rate', rate: '0.0010' } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      origin: 'import',
      defaultFee: { kind: 'rate', rate: '0.001' },
    });
    expect(instrumentRow(btc.id)).toMatchObject({ defaultFeeRate: '0.001', defaultFeeCents: null });
  });

  it('answers 404 for an unknown instrument and 400 for a bad id', async () => {
    const dto = await instrument(id('ASX:DEF'));
    const body = instrumentEditableFromDto(dto);
    expect((await call({ method: 'PUT', url: '/api/instruments/999', payload: body })).status).toBe(
      404,
    );
    expect((await call({ method: 'PUT', url: '/api/instruments/x', payload: body })).status).toBe(
      400,
    );
  });
});

describe('DELETE /api/instruments/:id', () => {
  it('refuses while trades or dividends reference it (409 INSTRUMENT_IN_USE)', async () => {
    for (const symbol of ['ASX:ABC', 'ASX:XYZ']) {
      const res = await call({ method: 'DELETE', url: `/api/instruments/${id(symbol)}` });
      expect(res.status, symbol).toBe(409);
      expect(error(res.body)).toEqual({
        code: 'INSTRUMENT_IN_USE',
        message: INSTRUMENT_IN_USE_MESSAGE,
      });
    }
  });

  it('deletes a workbook instrument and writes the deletion marker', async () => {
    const fund2 = id('EXAMPLEFUND2');
    const res = await call({ method: 'DELETE', url: `/api/instruments/${fund2}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: fund2 } satisfies DeletedResponse);
    expect(instrumentRow(fund2)).toBeUndefined();
    expect(
      database.db.select().from(priceSources).where(eq(priceSources.instrumentId, fund2)).get(),
    ).toBeUndefined();
    expect(readAppEditMarker(database.db)).toEqual({ count: 1, lastAt: NOW.toISOString() });
    expect(await hasAppData()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await call({ method: 'DELETE', url: `/api/instruments/${fund2}` })).status).toBe(404);
  });

  it('deletes an app-created instrument without a marker', async () => {
    const created = await call({
      method: 'POST',
      url: '/api/instruments',
      payload: newInstrument('crypto', 'eth2'),
    });
    expect(created.status).toBe(201);
    expect((created.body as InstrumentDto).symbol).toBe('ETH2');
    expect(await hasAppData()).toBe(true);
    const res = await call({
      method: 'DELETE',
      url: `/api/instruments/${(created.body as InstrumentDto).id}`,
    });
    expect(res.status).toBe(200);
    expect(readAppEditMarker(database.db)).toBeNull();
    expect(await hasAppData()).toBe(false);
  });
});

describe('409 IMPORT_IN_PROGRESS while the import lock is held', () => {
  it('refuses every mutation before anything else, even with a bad body or id', async () => {
    expect(importLock.tryAcquire()).toBe(true);
    const dump = dumpDomainTables(database.db);
    const cases: InjectOptions[] = [
      { method: 'POST', url: '/api/trades', payload: etfBuy() },
      { method: 'POST', url: '/api/trades', payload: { bogus: true } },
      { method: 'PUT', url: '/api/trades/6', payload: etfBuy() },
      { method: 'PUT', url: '/api/trades/abc', payload: {} },
      { method: 'DELETE', url: '/api/trades/6' },
      { method: 'DELETE', url: '/api/trades/999' },
      { method: 'POST', url: '/api/instruments', payload: newInstrument('etf', 'ASX:ZZZ') },
      { method: 'PUT', url: `/api/instruments/${id('ASX:DEF')}`, payload: {} },
      { method: 'DELETE', url: `/api/instruments/${id('EXAMPLEFUND2')}` },
      { method: 'DELETE', url: '/api/instruments/zero' },
    ];
    for (const opts of cases) {
      const res = await call(opts);
      expect(res.status, JSON.stringify([opts.method, opts.url])).toBe(409);
      expect(error(res.body)).toEqual({
        code: 'IMPORT_IN_PROGRESS',
        message: 'An import is running; try again shortly',
      });
    }
    expect(dumpDomainTables(database.db)).toEqual(dump);
    // Reads still work.
    expect((await call({ method: 'GET', url: '/api/investments/etf' })).status).toBe(200);
  });
});

describe('trade mutations (stored columns; fake engine)', () => {
  it('creates an app trade with the next seq of its kind and a flat fee (201)', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ note: '  e2e-temp ' }),
    });
    expect(res.status).toBe(201);
    const trade = (res.body as TradeMutationResponse).trade;
    expect(trade).toMatchObject({
      instrumentId: id('ASX:DEF'),
      symbol: 'ASX:DEF',
      kind: 'etf',
      side: 'buy',
      units: '5',
      price: '52.5',
      fee: { kind: 'flat', cents: 995 },
      origin: 'app',
      sheetRef: null,
      note: 'e2e-temp',
      flags: [],
      correctionId: null,
    });
    // Seed seqs run 1..9 across kinds; the ETF trades hold 5 and 6, so max over ETFs + 1.
    expect(tradeRow(trade.id)).toMatchObject({
      units: '5',
      feeCents: 995,
      feeRate: null,
      seq: 7,
      reviewFlags: null,
      origin: 'app',
      sheetRef: null,
    });
    expect(await hasAppData()).toBe(true);
  });

  it('stores a sell as negative units and a crypto rate fee with its rounded display cents', async () => {
    const sell = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ side: 'sell', quantity: { mode: 'units', units: '4' } }),
    });
    expect(sell.status).toBe(201);
    const sellRow = tradeRow((sell.body as TradeMutationResponse).trade.id)!;
    expect(sellRow.units).toBe('-4');
    expect((sell.body as TradeMutationResponse).trade).toMatchObject({ side: 'sell', units: '4' });

    const coin = await call({
      method: 'POST',
      url: '/api/trades',
      payload: {
        instrumentId: id('ETH'),
        side: 'buy',
        tradeDate: '2026-09-02',
        quantity: { mode: 'units', units: '0.123456789' },
        price: '4012.34',
        fee: { kind: 'rate', rate: '0.0025' },
      },
    });
    expect(coin.status).toBe(201);
    const coinRow = tradeRow((coin.body as TradeMutationResponse).trade.id)!;
    expect(coinRow).toMatchObject({
      units: '0.123456789',
      feeRate: '0.0025',
      feeCents: tradeFeeCents({
        units: '0.123456789',
        price: '4012.34',
        feeCents: 0,
        feeRate: '0.0025',
      }),
      seq: 10,
    });
    expect((coin.body as TradeMutationResponse).trade.fee).toEqual({
      kind: 'rate',
      rate: '0.0025',
    });
  });

  it('derives units in amount mode (D38) and refuses an amount below one unit step', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ quantity: { mode: 'amount', amountCents: 50000 }, price: '49.9' }),
    });
    expect(res.status).toBe(201);
    const expected = unitsFromAmount(50000, '49.9', 'etf');
    expect(expected).toBe('10.02');
    expect(tradeRow((res.body as TradeMutationResponse).trade.id)!.units).toBe(expected);

    const tiny = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ quantity: { mode: 'amount', amountCents: 1 }, price: '1000' }),
    });
    expect(tiny.status).toBe(400);
    expect(error(tiny.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: AMOUNT_TOO_SMALL_MESSAGE,
    });
  });

  it('validates bodies with field paths, the kind fee rule and the instrument', async () => {
    const bad = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ quantity: { mode: 'units', units: '-1' }, price: '0' }),
    });
    expect(bad.status).toBe(400);
    expect(error(bad.body).code).toBe('VALIDATION_ERROR');
    expect(error(bad.body).message).toMatch(/^quantity\.units: .+; price: .+$/);

    const late = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ tradeDate: '2026-09-26' }),
    });
    expect(late.status).toBe(400);
    expect(error(late.body).message).toBe('tradeDate: must not be after tomorrow');
    const tomorrow = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ tradeDate: '2026-09-25' }),
    });
    expect(tomorrow.status).toBe(201);

    // The joint bound: units and price are each within their limits, the order value is not.
    const huge = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ quantity: { mode: 'units', units: '1000000' }, price: '1000000000' }),
    });
    expect(huge.status).toBe(400);
    expect(error(huge.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'quantity.units: the order value is too large',
    });
    const hugeRate = await call({
      method: 'POST',
      url: '/api/trades',
      payload: {
        instrumentId: id('ETH'),
        side: 'buy',
        tradeDate: '2026-09-02',
        quantity: { mode: 'units', units: '1000000000000' },
        price: '1000000000',
        fee: { kind: 'rate', rate: '0.01' },
      },
    });
    expect(hugeRate.status).toBe(400);
    expect(error(hugeRate.body).message).toBe('quantity.units: the order value is too large');

    const rate = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ fee: { kind: 'rate', rate: '0.001' } }),
    });
    expect(rate.status).toBe(400);
    expect(error(rate.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'fee: a percentage fee is for crypto only',
    });

    const missing = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ instrumentId: 999 }),
    });
    expect(missing.status).toBe(404);
    expect(error(missing.body)).toEqual({ code: 'NOT_FOUND', message: 'Instrument 999 not found' });
  });

  it('updates an imported trade: origin app, sheet_ref and seq kept, review flags cleared', async () => {
    const before = tradeRow(6)!;
    expect(before.reviewFlags).not.toBeNull();
    const res = await call({
      method: 'PUT',
      url: '/api/trades/6',
      payload: etfBuy({
        tradeDate: '2025-05-20',
        quantity: { mode: 'units', units: '10' },
        price: '50',
        fee: { kind: 'flat', cents: 1000 },
      }),
    });
    expect(res.status).toBe(200);
    expect(tradeRow(6)).toEqual({ ...before, reviewFlags: null, origin: 'app' });
    expect((res.body as TradeMutationResponse).trade).toMatchObject({
      id: 6,
      origin: 'app',
      sheetRef: before.sheetRef,
      flags: [],
      seq: before.seq,
    });
    expect(await hasAppData()).toBe(true);
  });

  it('keeps the stored note when PUT omits it, and clears it with an empty note', async () => {
    const created = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({ note: 'keep me' }),
    });
    const tradeId = (created.body as TradeMutationResponse).trade.id;
    await call({ method: 'PUT', url: `/api/trades/${tradeId}`, payload: etfBuy() });
    expect(tradeRow(tradeId)!.note).toBe('keep me');
    await call({ method: 'PUT', url: `/api/trades/${tradeId}`, payload: etfBuy({ note: '' }) });
    expect(tradeRow(tradeId)!.note).toBeNull();
  });

  it('refuses to move a trade to another instrument, and 404s an unknown trade', async () => {
    const move = await call({
      method: 'PUT',
      url: '/api/trades/6',
      payload: etfBuy({ instrumentId: id('ASX:XYZ') }),
    });
    expect(move.status).toBe(400);
    expect(error(move.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'instrumentId: the holding of a trade cannot change',
    });
    expect((await call({ method: 'PUT', url: '/api/trades/999', payload: etfBuy() })).status).toBe(
      404,
    );
    expect((await call({ method: 'DELETE', url: '/api/trades/999' })).status).toBe(404);
  });

  it('deletes: a workbook row writes the marker (count rises), an app row does not', async () => {
    const res = await call({ method: 'DELETE', url: '/api/trades/6' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 6 });
    expect(tradeRow(6)).toBeUndefined();
    expect(readAppEditMarker(database.db)?.count).toBe(1);
    // Edit an imported row, then delete it: still a workbook row (sheet_ref kept).
    await call({
      method: 'PUT',
      url: '/api/trades/5',
      payload: etfBuy({
        instrumentId: id('ASX:XYZ'),
        tradeDate: '2024-07-01',
        quantity: { mode: 'units', units: '30' },
        price: '100',
      }),
    });
    expect((await call({ method: 'DELETE', url: '/api/trades/5' })).status).toBe(200);
    expect(readAppEditMarker(database.db)?.count).toBe(2);

    const created = await call({ method: 'POST', url: '/api/trades', payload: etfBuy() });
    const appId = (created.body as TradeMutationResponse).trade.id;
    expect((await call({ method: 'DELETE', url: `/api/trades/${appId}` })).status).toBe(200);
    expect(readAppEditMarker(database.db)?.count).toBe(2);
    expect(
      database.db.select().from(appMeta).where(eq(appMeta.key, DELETED_IMPORT_ROWS_KEY)).get(),
    ).toBeDefined();
  });

  it('refuses a change that oversells more than before (422) and rolls back', async () => {
    const dump = dumpDomainTables(database.db);
    const res = await call({
      method: 'POST',
      url: '/api/trades',
      payload: etfBuy({
        side: 'sell',
        tradeDate: '2025-11-15',
        quantity: { mode: 'units', units: '20' },
      }),
    });
    expect(res.status).toBe(422);
    expect(error(res.body)).toEqual({
      code: 'TRADE_OVERSELL',
      message: 'The sell on 15/11/2025 is for 20 units but only 10 are held then.',
    });
    expect(dumpDomainTables(database.db)).toEqual(dump);
    expect(readAppEditMarker(database.db)).toBeNull();
    // Deleting the buy a later sell needs.
    const del = await call({ method: 'DELETE', url: '/api/trades/3' });
    expect(del.status).toBe(422);
    expect(error(del.body).message).toBe(
      'The sell on 03/02/2025 is for 20 units but only 0 are held then.',
    );
    expect(dumpDomainTables(database.db)).toEqual(dump);
    expect(readAppEditMarker(database.db)).toBeNull();
  });

  it('notifies the price service only when the held status changes', async () => {
    // EXAMPLEFUND2 is watched and never bought: the first buy makes it held.
    const buy = await call({
      method: 'POST',
      url: '/api/trades',
      payload: { ...etfBuy(), instrumentId: id('EXAMPLEFUND2'), fee: { kind: 'flat', cents: 0 } },
    });
    expect(buy.status).toBe(201);
    expect(notify).toHaveBeenCalledTimes(1);
    const again = await call({
      method: 'POST',
      url: '/api/trades',
      payload: { ...etfBuy(), instrumentId: id('EXAMPLEFUND2'), fee: { kind: 'flat', cents: 0 } },
    });
    expect(again.status).toBe(201);
    expect(notify).toHaveBeenCalledTimes(1);
    const firstId = (buy.body as TradeMutationResponse).trade.id;
    const secondId = (again.body as TradeMutationResponse).trade.id;
    await call({ method: 'DELETE', url: `/api/trades/${firstId}` });
    expect(notify).toHaveBeenCalledTimes(1);
    await call({ method: 'DELETE', url: `/api/trades/${secondId}` });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
