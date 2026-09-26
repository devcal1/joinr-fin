// Stage 4 daily market series history (stage-4.md §4.6 items 3 and 6, §7.5 steps 2–3): every
// series the `prices` job writes `ok` lands in `market_quote_history`, one row per series per
// server-local day (a later run that day replaces it), and `readQuoteHistory` reads it back.
// Generic values only; every request goes to a mocked fetch.
import { marketQuoteHistory, otherAssets, type JoinrDb } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { readQuoteHistory } from '../../src/market/history';
import { createFakeProvider, fakePrice } from '../../src/market/providers/fake';
import { createYahooProvider } from '../../src/market/providers/yahoo';
import { Cooldowns, runRefresh } from '../../src/market/refresh';
import { createService } from '../../src/market/service';
import { createScheduler } from '../../src/scheduler/index';
import {
  jsonResponse,
  mockFetch,
  noSleep,
  settableClock,
  silentLogger,
  yahooChart,
  yahooNotFound,
  yahooSymbolOf,
} from './helpers';

const NOW = '2026-09-24T02:00:00.000Z';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The server-local calendar date of an ISO timestamp (the rule the history uses). */
function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}`;
}

const open: TestDb[] = [];
const schedulers: Array<ReturnType<typeof createScheduler>> = [];

afterEach(async () => {
  for (const s of schedulers.splice(0)) await s.stop();
  for (const t of open.splice(0)) t.close();
});

function seededDb(now: Date): TestDb {
  const testDb = createTestDb();
  open.push(testDb);
  seedGenericData(testDb.db, { now });
  return testDb;
}

function history(db: JoinrDb) {
  return db
    .select()
    .from(marketQuoteHistory)
    .orderBy(marketQuoteHistory.seriesId, marketQuoteHistory.date)
    .all();
}

/** A live Yahoo provider on a mocked fetch whose AUDUSD, market time and failures are settable. */
function harness() {
  const clock = settableClock(NOW);
  const testDb = seededDb(clock.now());
  const market = {
    time: '2026-09-24T01:50:00.000Z',
    audUsd: 0.65,
    failing: new Set<string>(),
  };
  const { fetchImpl, calls } = mockFetch((url) => {
    const symbol = yahooSymbolOf(url);
    if (market.failing.has(symbol)) return jsonResponse(yahooNotFound(), 404);
    const table: Record<string, [number, string]> = {
      'AUDUSD=X': [market.audUsd, 'USD'],
      'SI=F': [30, 'USD'],
      'GC=F': [2600, 'USD'],
      'GBPAUD=X': [2, 'AUD'],
    };
    const [price, currency] = table[symbol] ?? [10, 'AUD'];
    return jsonResponse(yahooChart({ symbol, price, currency, time: market.time }));
  });
  const now = () => clock.now();
  const cooldowns = new Cooldowns();
  const run = () =>
    runRefresh({
      db: testDb.db,
      providers: {
        yahoo: createYahooProvider({ fetchImpl, sleep: noSleep, now, spacingMs: 0 }),
        coingecko: createFakeProvider({ now }),
      },
      cooldowns,
      now,
      sleep: noSleep,
      signal: new AbortController().signal,
      log: silentLogger(),
    });
  return { db: testDb.db, clock, market, calls, cooldowns, run };
}

describe('series history (the prices job)', () => {
  it('writes every series written ok, dated at the local day of its as-of', async () => {
    const h = harness();
    h.db
      .insert(otherAssets)
      .values({
        description: 'Example print',
        units: '1',
        currency: 'GBX',
        purchaseDate: null,
        unitCost: '100',
        sortOrder: 50,
      })
      .run();
    expect(history(h.db)).toEqual([]);
    await h.run();
    const day = localDay(h.market.time);
    expect(history(h.db)).toEqual([
      { seriesId: 'AUDUSD', date: day, value: '0.65', source: 'yahoo', fetchedAt: NOW },
      { seriesId: 'FX_GBPAUD', date: day, value: '2', source: 'yahoo', fetchedAt: NOW },
      { seriesId: 'GC_USD_OZ', date: day, value: '2600', source: 'yahoo', fetchedAt: NOW },
      { seriesId: 'SI_USD_OZ', date: day, value: '30', source: 'yahoo', fetchedAt: NOW },
      {
        seriesId: 'XAG_AUD_OZ',
        date: day,
        value: '46.153846153846',
        source: 'derived',
        fetchedAt: NOW,
      },
      { seriesId: 'XAU_AUD_OZ', date: day, value: '4000', source: 'derived', fetchedAt: NOW },
    ]);
  });

  it('keeps one row per series per day: a later run that day replaces it, the next day adds one', async () => {
    const h = harness();
    await h.run();
    const firstDay = localDay(h.market.time);

    // An hour later, the same local day: replaced.
    h.clock.advance(HOUR_MS);
    h.market.time = new Date(Date.parse(h.market.time) + HOUR_MS).toISOString();
    h.market.audUsd = 0.66;
    await h.run();
    const later = new Date(Date.parse(NOW) + HOUR_MS).toISOString();
    const audUsd = () => history(h.db).filter((r) => r.seriesId === 'AUDUSD');
    expect(audUsd()).toEqual([
      { seriesId: 'AUDUSD', date: firstDay, value: '0.66', source: 'yahoo', fetchedAt: later },
    ]);

    // The next day: a second row.
    h.clock.advance(DAY_MS);
    h.market.time = new Date(Date.parse(h.market.time) + DAY_MS).toISOString();
    h.market.audUsd = 0.64;
    await h.run();
    const nextDay = localDay(h.market.time);
    expect(nextDay).not.toBe(firstDay);
    expect(audUsd().map((r) => [r.date, r.value])).toEqual([
      [firstDay, '0.66'],
      [nextDay, '0.64'],
    ]);
    expect(history(h.db)).toHaveLength(10); // five series × two days
  });

  it('uses the server-local calendar date of the as-of, not its UTC date', async () => {
    const h = harness();
    // 20:00 UTC: already the next day east of UTC+4 (the same day on a UTC host).
    h.market.time = '2026-09-23T20:00:00.000Z';
    await h.run();
    const row = history(h.db).find((r) => r.seriesId === 'AUDUSD')!;
    expect(row.date).toBe(localDay('2026-09-23T20:00:00.000Z'));
    if (new Date('2026-09-23T20:00:00.000Z').getTimezoneOffset() <= -240) {
      expect(row.date).toBe('2026-09-24');
    }
  });

  it('writes nothing for a failed or skipped series', async () => {
    const h = harness();
    h.market.failing.add('SI=F');
    await h.run();
    const ids = new Set(history(h.db).map((r) => r.seriesId));
    expect(ids.has('SI_USD_OZ')).toBe(false);
    expect(ids.has('AUDUSD')).toBe(true);

    // While Yahoo cools down nothing is fetched, so nothing new is written.
    const before = history(h.db);
    h.cooldowns.start('yahoo', h.clock.now());
    h.clock.advance(60_000);
    await h.run();
    expect(history(h.db)).toEqual(before);
  });

  it('mode fake writes the fake series too', async () => {
    const clock = settableClock(NOW);
    const testDb = seededDb(clock.now());
    const log = silentLogger();
    const scheduler = createScheduler({ db: testDb.db, log, clock });
    schedulers.push(scheduler);
    const market = createService({
      db: testDb.db,
      config: { marketDataMode: 'fake', priceRefreshMinutes: 60 },
      log,
      scheduler,
      clock,
    });
    await market.refresh();
    const rows = history(testDb.db);
    expect(rows.map((r) => r.seriesId)).toEqual([
      'AUDUSD',
      'GC_USD_OZ',
      'SI_USD_OZ',
      'XAG_AUD_OZ',
      'XAU_AUD_OZ',
    ]);
    expect(rows.every((r) => r.date === localDay(NOW) && r.fetchedAt === NOW)).toBe(true);
    expect(rows.find((r) => r.seriesId === 'SI_USD_OZ')).toMatchObject({
      value: fakePrice('SI=F'),
      source: 'fake',
    });
    expect(rows.find((r) => r.seriesId === 'XAG_AUD_OZ')).toMatchObject({ source: 'derived' });
  });
});

describe('readQuoteHistory', () => {
  function withRows(rows: Array<[seriesId: string, date: string, value: string]>) {
    const testDb = createTestDb();
    open.push(testDb);
    for (const [seriesId, date, value] of rows) {
      testDb.db
        .insert(marketQuoteHistory)
        .values({ seriesId, date, value, source: 'yahoo', fetchedAt: NOW })
        .run();
    }
    return testDb.db;
  }

  const db = () =>
    withRows([
      ['XAG_AUD_OZ', '2026-09-24', '48'],
      ['XAG_AUD_OZ', '2025-09-23', '40'],
      ['XAG_AUD_OZ', '2026-01-15', '45.5'],
      ['XAG_AUD_OZ', '2025-09-24', '41'],
      ['XAU_AUD_OZ', '2026-03-01', '4100'],
      ['FX_GBPAUD', '2026-09-24', '2'],
    ]);

  it('returns each series in date order from the from-date on (inclusive)', () => {
    expect(readQuoteHistory(db(), ['XAG_AUD_OZ', 'XAU_AUD_OZ'], '2025-09-24')).toEqual({
      XAG_AUD_OZ: [
        { date: '2025-09-24', value: '41' },
        { date: '2026-01-15', value: '45.5' },
        { date: '2026-09-24', value: '48' },
      ],
      XAU_AUD_OZ: [{ date: '2026-03-01', value: '4100' }],
    });
  });

  it('bounds by the from-date', () => {
    expect(readQuoteHistory(db(), ['XAG_AUD_OZ'], '2026-09-24')).toEqual({
      XAG_AUD_OZ: [{ date: '2026-09-24', value: '48' }],
    });
    expect(readQuoteHistory(db(), ['XAG_AUD_OZ'], '2026-09-25')).toEqual({ XAG_AUD_OZ: [] });
  });

  it('answers an unknown series with an empty list and ignores repeated ids', () => {
    expect(readQuoteHistory(db(), ['XAU_AUD_OZ', 'NOPE', 'XAU_AUD_OZ'], '2020-01-01')).toEqual({
      XAU_AUD_OZ: [{ date: '2026-03-01', value: '4100' }],
      NOPE: [],
    });
    expect(readQuoteHistory(db(), [], '2020-01-01')).toEqual({});
    expect(readQuoteHistory(withRows([]), ['XAG_AUD_OZ'], '2020-01-01')).toEqual({
      XAG_AUD_OZ: [],
    });
  });

  it('refuses a malformed from-date', () => {
    expect(() => readQuoteHistory(db(), ['XAG_AUD_OZ'], '24/09/2026')).toThrow(RangeError);
    expect(() => readQuoteHistory(db(), ['XAG_AUD_OZ'], '2026-02-30')).toThrow(RangeError);
  });
});
