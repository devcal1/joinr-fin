// Shared helpers for the Stage 9 phone-API suites (stage-9.md §6.10): an app on a temp DATA_DIR with
// the REAL engine and a movable clock, a pairing shortcut, and planters for instruments, trades,
// prices, day rows, FX previous closes, market series and bullion rows; Stage 10 (stage-10.md §6.6)
// adds the periods call and planters for stored closes, splits, series closes and bullion sales. Made-up symbols and round
// amounts only (the repo is public); every key and code is generated at run time and never printed.
import { join } from 'node:path';
import {
  type MobilePairResponse,
  type MobilePeriodsResponse,
  type MobileTodayResponse,
  type PhoneSectionResponse,
} from '@joinr/schema';
import {
  dayQuotes,
  instrumentCloses,
  instrumentSplits,
  instruments,
  marketQuotes,
  otherAssetSales,
  otherAssets,
  prices,
  priceSources,
  seriesCloses,
  seriesDayQuotes,
  trades,
} from '@joinr/schema/db';
import { seedGenericData } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions, type ServicesFactory } from '../../src/app';
import { createOffDividendEventsService } from '../../src/market/dividends/index';
import { createMarketDataService } from '../../src/market/index';
import { createScheduler, systemClock } from '../../src/scheduler/index';
import type { Config } from '../../src/config';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

/**
 * Market data off, with the price service on the test clock (price statuses are relative to it,
 * not to the real time).
 */
export function clockedOffServices(clock: TestClock): ServicesFactory {
  return ({ database, log }) => {
    const scheduler = createScheduler({ db: database.db, log });
    const market = createMarketDataService({
      db: database.db,
      config: { marketDataMode: 'off', priceRefreshMinutes: 0 },
      log,
      scheduler,
      clock: { ...systemClock, now: clock.now },
    });
    return { scheduler, market, dividendEvents: createOffDividendEventsService() };
  };
}

/** A movable clock: `clock.set(iso)`, `clock.advance(ms)`. */
export class TestClock {
  private ms: number;
  constructor(iso: string) {
    this.ms = Date.parse(iso);
  }
  now = (): Date => new Date(this.ms);
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface MobileApp {
  app: FastifyInstance;
  database: AppDatabase;
  config: Config;
  clock: TestClock;
  dataDir: string;
  /** Rebuilds the app on the same DATA_DIR (a restart: the store reloads, the code is gone). */
  restart(over?: Partial<BuildAppOptions>): Promise<void>;
  close(): Promise<void>;
}

export interface StartOptions {
  now?: string;
  seed?: boolean;
  build?: Partial<BuildAppOptions>;
  /** A shared temp folder (a second app on the same DATA_DIR); default: a new one. */
  tempDir?: string;
}

export async function startMobileApp(o: StartOptions = {}): Promise<MobileApp> {
  const tempDir = o.tempDir ?? (await makeTempDir('joinr-mobile-test-'));
  const config = testConfig(join(tempDir, 'data'));
  const database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  const clock = new TestClock(o.now ?? '2030-09-12T05:20:00.000Z');
  if (o.seed !== false) seedGenericData(database.db, { now: clock.now() });
  const build = async (over: Partial<BuildAppOptions> = {}) =>
    buildApp({
      config,
      db: database,
      now: clock.now,
      services: clockedOffServices(clock),
      ...o.build,
      ...over,
    });
  const handle: MobileApp = {
    app: await build(),
    database,
    config,
    clock,
    dataDir: config.dataDir,
    async restart(over) {
      // app.close() closes the database; reopen it for the new app.
      await handle.app.close();
      handle.database = openDatabase(config.dataDir);
      handle.app = await buildApp({
        config,
        db: handle.database,
        now: clock.now,
        services: clockedOffServices(clock),
        ...o.build,
        ...over,
      });
    },
    async close() {
      await handle.app.close();
      closeDatabase(handle.database);
      if (o.tempDir === undefined) await removeDir(tempDir);
    },
  };
  return handle;
}

export function json<T>(res: LightMyRequestResponse): T {
  return res.json<T>();
}

export async function call(
  app: FastifyInstance,
  opts: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject(opts);
}

/** Opens a code through the web route; returns the code (test value, never printed). */
export async function openCode(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/phone/pairing' });
  if (res.statusCode !== 201) throw new Error(`open code: ${res.statusCode}`);
  return res.json<PhoneSectionResponse>().pairing!.code;
}

/** Opens a code and pairs; returns the 201 body (with the key). */
export async function pairPhone(
  app: FastifyInstance,
  body: Record<string, unknown> = {},
): Promise<MobilePairResponse> {
  const code = await openCode(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/mobile/pair',
    payload: { code, deviceName: 'Test phone', appVersion: '1.0.0', ...body },
  });
  if (res.statusCode !== 201) throw new Error(`pair: ${res.statusCode}`);
  return res.json<MobilePairResponse>();
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'x-joinr-key': key });

export async function getToday(app: FastifyInstance, key: string): Promise<MobileTodayResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/mobile/today', headers: bearer(key) });
  if (res.statusCode !== 200) throw new Error(`today: ${res.statusCode} ${res.body}`);
  return res.json<MobileTodayResponse>();
}

export async function getPeriods(
  app: FastifyInstance,
  key: string,
): Promise<MobilePeriodsResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/mobile/periods', headers: bearer(key) });
  if (res.statusCode !== 200) throw new Error(`periods: ${res.statusCode} ${res.body}`);
  return res.json<MobilePeriodsResponse>();
}

// ─── Planters (an empty database: `seed: false`) ────────────────────────────────────────────────

type Db = AppDatabase['db'];

let sortOrder = 0;

export function plantInstrument(
  db: Db,
  i: {
    kind: 'stock' | 'etf' | 'managed_fund' | 'crypto';
    symbol: string;
    code: string;
    provider: 'yahoo' | 'coingecko' | 'none';
    providerSymbol: string | null;
    name?: string | null;
  },
): number {
  sortOrder += 1;
  const row = db
    .insert(instruments)
    .values({
      kind: i.kind,
      symbol: i.symbol,
      code: i.code,
      name: i.name ?? null,
      exchange: i.symbol.includes(':') ? i.symbol.split(':')[0]! : null,
      sortOrder,
      isWatched: true,
    })
    .returning({ id: instruments.id })
    .get();
  db.insert(priceSources)
    .values({
      instrumentId: row.id,
      provider: i.provider,
      providerSymbol: i.providerSymbol,
      symbolOrigin: 'derived',
      updatedAt: '2030-01-01T00:00:00.000Z',
    })
    .run();
  return row.id;
}

let tradeSeq = 0;
export function plantTrade(
  db: Db,
  instrumentId: number,
  date: string,
  units: string,
  price: string,
  feeCents = 0,
) {
  tradeSeq += 1;
  db.insert(trades)
    .values({ instrumentId, tradeDate: date, units, price, feeCents, seq: tradeSeq })
    .run();
}

export function plantPrice(
  db: Db,
  instrumentId: number,
  p: {
    price: string;
    asOf: string;
    nativePrice?: string;
    nativeCurrency?: string;
    fxRate?: string;
    source?: 'yahoo' | 'coingecko' | 'fake' | 'sheet';
    fetchedAt?: string;
  },
) {
  db.insert(prices)
    .values({
      instrumentId,
      price: p.price,
      nativePrice: p.nativePrice ?? p.price,
      nativeCurrency: p.nativeCurrency ?? 'AUD',
      fxRate: p.fxRate ?? '1',
      asOf: p.asOf,
      fetchedAt: p.fetchedAt ?? p.asOf,
      source: p.source ?? 'yahoo',
      lastAttemptAt: p.fetchedAt ?? p.asOf,
      lastStatus: 'ok',
    })
    .onConflictDoUpdate({
      target: prices.instrumentId,
      set: {
        price: p.price,
        nativePrice: p.nativePrice ?? p.price,
        nativeCurrency: p.nativeCurrency ?? 'AUD',
        fxRate: p.fxRate ?? '1',
        asOf: p.asOf,
        fetchedAt: p.fetchedAt ?? p.asOf,
      },
    })
    .run();
}

export function plantManual(db: Db, instrumentId: number, price: string, asOf: string) {
  db.update(priceSources)
    .set({ manualPrice: price, manualPriceAsOf: asOf, manualOrigin: 'user' })
    .where(eq(priceSources.instrumentId, instrumentId))
    .run();
}

export interface PlantedDay {
  sessionDate: string;
  timeZone: string;
  granularity?: '5m' | '1d';
  nativeCurrency?: string;
  previousClose: string | null;
  points?: Array<[number, string]>;
}

function dayValues(d: PlantedDay) {
  return {
    sessionDate: d.sessionDate,
    timeZone: d.timeZone,
    granularity: d.granularity ?? '5m',
    nativeCurrency: d.nativeCurrency ?? 'AUD',
    previousClose: d.previousClose,
    regularStart: null,
    regularEnd: null,
    points: JSON.stringify(d.points ?? []),
    source: 'fake' as const,
    fetchedAt: '2030-01-01T00:00:00.000Z',
  };
}

export function plantDay(db: Db, instrumentId: number, d: PlantedDay) {
  db.delete(dayQuotes).where(eq(dayQuotes.instrumentId, instrumentId)).run();
  db.insert(dayQuotes)
    .values({ instrumentId, ...dayValues(d) })
    .run();
}

export function plantSeriesDay(db: Db, seriesId: string, d: PlantedDay) {
  db.delete(seriesDayQuotes).where(eq(seriesDayQuotes.seriesId, seriesId)).run();
  db.insert(seriesDayQuotes)
    .values({ seriesId, ...dayValues(d) })
    .run();
}

export function plantQuote(
  db: Db,
  seriesId: string,
  q: {
    value: string;
    asOf: string;
    unit?: string;
    previousClose?: string;
    previousCloseDate?: string;
  },
) {
  const values = {
    value: q.value,
    unit: q.unit ?? 'unit',
    asOf: q.asOf,
    fetchedAt: q.asOf,
    source: 'yahoo',
    lastAttemptAt: q.asOf,
    lastStatus: 'ok' as const,
    previousClose: q.previousClose ?? null,
    previousCloseDate: q.previousCloseDate ?? null,
  };
  db.insert(marketQuotes)
    .values({ seriesId, ...values })
    .onConflictDoUpdate({ target: marketQuotes.seriesId, set: values })
    .run();
}

let assetSort = 100;
export function plantBullion(
  db: Db,
  b: {
    metal: 'silver' | 'gold';
    units: string;
    ozPerUnit?: string;
    unitCost: string | null;
    currency?: string;
    purchaseFxRate?: string | null;
    purchaseDate: string | null;
    unitPrice?: string | null;
  },
): number {
  assetSort += 1;
  return db
    .insert(otherAssets)
    .values({
      description: `${b.metal} bar`,
      purchaseDate: b.purchaseDate,
      units: b.units,
      soldUnits: '0',
      currency: b.currency ?? 'AUD',
      unitCost: b.unitCost,
      unitPrice: b.unitPrice ?? null,
      unitPriceAsOf: b.unitPrice ? '2030-01-01' : null,
      priceSource: 'bullion',
      metal: b.metal,
      unitOfMeasure: 'oz',
      ozPerUnit: b.ozPerUnit ?? '1',
      sortOrder: assetSort,
      purchaseFxRate: b.purchaseFxRate ?? null,
    })
    .returning({ id: otherAssets.id })
    .get().id;
}

/** Unix seconds of a UTC ISO instant. */
export const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Every 5 minutes from `fromIso` to `toIso` inclusive, prices walking from a to b (3 dp). */
export function bars(
  fromIso: string,
  toIso: string,
  a: number,
  b: number,
): Array<[number, string]> {
  const from = unix(fromIso);
  const n = (unix(toIso) - from) / 300 + 1;
  return Array.from({ length: n }, (_, i) => {
    const p = a + ((b - a) * i) / Math.max(1, n - 1);
    return [from + i * 300, String(Number(p.toFixed(3)))] as [number, string];
  });
}

// ─── Stage 10 planters (stage-10.md §3.1–§3.3) ──────────────────────────────────────────────────

/** Stored daily closes of an instrument (`instrument_closes`), replacing any on the same dates. */
export function plantCloses(
  db: Db,
  instrumentId: number,
  closes: ReadonlyArray<readonly [string, string]>,
  currency = 'AUD',
  source: 'yahoo' | 'coingecko' | 'fake' = 'yahoo',
) {
  for (const [date, close] of closes) {
    const values = { close, currency, source, fetchedAt: '2030-01-01T00:00:00.000Z' };
    db.insert(instrumentCloses)
      .values({ instrumentId, date, ...values })
      .onConflictDoUpdate({
        target: [instrumentCloses.instrumentId, instrumentCloses.date],
        set: values,
      })
      .run();
  }
}

/** A stored split event (`instrument_splits`). */
export function plantSplit(
  db: Db,
  instrumentId: number,
  date: string,
  numerator = '2',
  denominator = '1',
) {
  db.insert(instrumentSplits)
    .values({ instrumentId, date, numerator, denominator, fetchedAt: '2030-01-01T00:00:00.000Z' })
    .run();
}

/** Stored daily closes of a market series (`series_closes`). */
export function plantSeriesCloses(
  db: Db,
  seriesId: string,
  closes: ReadonlyArray<readonly [string, string]>,
  source: 'yahoo' | 'derived' | 'midnight' | 'fake' = 'yahoo',
) {
  for (const [date, value] of closes) {
    const values = { value, source, fetchedAt: '2030-01-01T00:00:00.000Z' };
    db.insert(seriesCloses)
      .values({ seriesId, date, ...values })
      .onConflictDoUpdate({ target: [seriesCloses.seriesId, seriesCloses.date], set: values })
      .run();
  }
}

/** A sale of some units of an Other Assets row. */
export function plantAssetSale(
  db: Db,
  otherAssetId: number,
  saleDate: string,
  units: string,
  proceedsCents: number,
) {
  db.insert(otherAssetSales).values({ otherAssetId, saleDate, units, proceedsCents }).run();
}
