import type { MarketDataMode } from '@joinr/schema';
import { instruments, jobRuns, marketQuotes, prices, priceSources } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/errors';
import { fakePrice } from '../../src/market/providers/fake';
import { Cooldowns, runRefresh } from '../../src/market/refresh';
import { createService, type MarketDataServiceOptions } from '../../src/market/service';
import { MarketDataDisabledError } from '../../src/market/types';
import { createScheduler } from '../../src/scheduler/index';
import type { Clock } from '../../src/scheduler/types';
import {
  hangingResponse,
  jsonResponse,
  manualClock,
  mockFetch,
  noSleep,
  settableClock,
  silentLogger,
  unix,
  yahooChart,
  yahooNotFound,
  yahooSymbolOf,
  type FetchHandler,
} from './helpers';

// A Thursday, mid-morning in Australia.
const NOW = '2026-09-24T02:00:00.000Z';
const MARKET_TIME = '2026-09-24T01:50:00.000Z';

const YAHOO_PRICES: Record<string, { price: number; currency: string }> = {
  'AUDUSD=X': { price: 0.65, currency: 'USD' },
  'SI=F': { price: 30, currency: 'USD' },
  'GC=F': { price: 2600, currency: 'USD' },
  'ABC.AX': { price: 13, currency: 'AUD' },
  'XYZ.AX': { price: 110, currency: 'AUD' },
  'DEF.AX': { price: 32.5, currency: 'USD' },
  'NEW.AX': { price: 7, currency: 'AUD' },
};

function yahooOk(url: URL): Response {
  const symbol = yahooSymbolOf(url);
  const p = YAHOO_PRICES[symbol];
  if (!p) return jsonResponse(yahooNotFound(), 404);
  return jsonResponse(
    yahooChart({ symbol, price: p.price, currency: p.currency, time: MARKET_TIME }),
  );
}

function coinGeckoOk(url: URL): Response {
  if (url.pathname === '/api/v3/search') {
    const query = (url.searchParams.get('query') ?? '').toUpperCase();
    const coins =
      query === 'ETH'
        ? [
            { id: 'ethereum', symbol: 'ETH', market_cap_rank: 2 },
            { id: 'eth-copy', symbol: 'ETH', market_cap_rank: 3000 },
          ]
        : query === 'BTC'
          ? [{ id: 'bitcoin', symbol: 'BTC', market_cap_rank: 1 }]
          : [];
    return jsonResponse({ coins });
  }
  const ids = (url.searchParams.get('ids') ?? '').split(',');
  const table: Record<string, number> = { bitcoin: 150000, ethereum: 5000 };
  return jsonResponse(
    Object.fromEntries(
      ids
        .filter((id) => id in table)
        .map((id) => [id, { aud: table[id], last_updated_at: unix(MARKET_TIME) }]),
    ),
  );
}

const liveHandler: FetchHandler = (url) =>
  url.host === 'api.coingecko.com' ? coinGeckoOk(url) : yahooOk(url);

interface Harness {
  testDb: TestDb;
  ids: Record<string, number>;
  calls: Array<{ url: URL }>;
  clock: Clock;
  market: ReturnType<typeof createService>;
  scheduler: ReturnType<typeof createScheduler>;
}

const open: TestDb[] = [];
const schedulers: Array<ReturnType<typeof createScheduler>> = [];

afterEach(async () => {
  for (const s of schedulers.splice(0)) await s.stop();
  for (const t of open.splice(0)) t.close();
});

function setup(
  o: {
    mode?: MarketDataMode;
    handler?: FetchHandler;
    clock?: Clock;
    extra?: Partial<MarketDataServiceOptions>;
  } = {},
): Harness {
  const testDb = createTestDb();
  open.push(testDb);
  const clock = o.clock ?? settableClock(NOW);
  const { instrumentIds } = seedGenericData(testDb.db, { now: clock.now() });
  const { fetchImpl, calls } = mockFetch(o.handler ?? liveHandler);
  const log = silentLogger();
  const scheduler = createScheduler({ db: testDb.db, log, clock });
  schedulers.push(scheduler);
  const market = createService({
    db: testDb.db,
    config: { marketDataMode: o.mode ?? 'live', priceRefreshMinutes: 60 },
    log,
    scheduler,
    fetchImpl,
    clock,
    yahooSpacingMs: 0,
    searchSpacingMs: 0,
    ...o.extra,
  });
  return { testDb, ids: instrumentIds, calls, clock, market, scheduler };
}

function priceRow(h: Harness, symbol: string) {
  return h.testDb.db.select().from(prices).where(eq(prices.instrumentId, h.ids[symbol]!)).get();
}

function sourceRow(h: Harness, symbol: string) {
  return h.testDb.db
    .select()
    .from(priceSources)
    .where(eq(priceSources.instrumentId, h.ids[symbol]!))
    .get();
}

function quote(h: Harness, seriesId: string) {
  return h.testDb.db.select().from(marketQuotes).where(eq(marketQuotes.seriesId, seriesId)).get();
}

function item(h: Harness, symbol: string) {
  return h.market.getPrices().items.find((i) => i.symbol === symbol)!;
}

describe('mode off', () => {
  it('refuses to refresh, registers no job and still serves prices', async () => {
    const h = setup({ mode: 'off' });
    await expect(h.market.refresh()).rejects.toBeInstanceOf(MarketDataDisabledError);
    await expect(h.scheduler.run('prices')).rejects.toThrow('Unknown job');
    const res = h.market.getPrices();
    expect(res.mode).toBe('off');
    expect(res.refreshIntervalMinutes).toBe(0);
    expect(res.nextRefreshAt).toBeNull();
    expect(res.items).toHaveLength(8);
    expect(h.calls).toHaveLength(0);
    expect(h.market.status()).toMatchObject({ mode: 'off', running: false, nextRefreshAt: null });
  });
});

describe('getPrices', () => {
  it('orders held first, then kind, then sort order, with held units and statuses', () => {
    const h = setup();
    const res = h.market.getPrices();
    expect(res.mode).toBe('live');
    expect(res.refreshIntervalMinutes).toBe(60);
    expect(res.items.map((i) => [i.symbol, i.held, i.heldUnits, i.status])).toEqual([
      ['ASX:ABC', true, '150', 'fresh'],
      ['ASX:XYZ', true, '30', 'stale'],
      ['ASX:DEF', true, '10', 'failed'],
      ['EXAMPLEFUND', true, '1000', 'manual'],
      ['BTC', true, '0.05', 'fresh'],
      ['ETH', true, '1.25', 'stale'],
      ['ASX:OLD', false, '0', 'none'],
      ['EXAMPLEFUND2', false, '0', 'none'],
    ]);
    expect(item(h, 'ASX:XYZ')).toMatchObject({ priceSource: 'sheet', price: '105' });
    expect(item(h, 'EXAMPLEFUND')).toMatchObject({
      priceSource: 'manual',
      price: '1.5',
      manual: { price: '1.5', origin: 'import' },
      fetched: null,
    });
    expect(res.lastRun).toMatchObject({ job: 'prices', status: 'partial' });
    expect(res.series.map((s) => [s.seriesId, s.status])).toEqual([
      ['AUDUSD', 'fresh'],
      ['SI_USD_OZ', 'fresh'],
      ['GC_USD_OZ', 'fresh'],
      ['XAG_AUD_OZ', 'fresh'],
      ['XAU_AUD_OZ', 'fresh'],
    ]);
  });

  it('lists the built-in series even when nothing was fetched', () => {
    const h = setup();
    h.testDb.db.delete(marketQuotes).run();
    const series = h.market.getSeries();
    expect(series.map((s) => s.seriesId)).toEqual([
      'AUDUSD',
      'SI_USD_OZ',
      'GC_USD_OZ',
      'XAG_AUD_OZ',
      'XAU_AUD_OZ',
    ]);
    expect(series.every((s) => s.status === 'none' && s.value === null)).toBe(true);
  });
});

describe('refresh (live)', () => {
  it('fetches series and targets, converts to AUD and logs the job run', async () => {
    const h = setup();
    const summary = await h.market.refresh();
    // Targets: held or watched with a provider (ABC, XYZ, DEF, BTC, ETH); not OLD (not held,
    // not watched) and not the managed funds (provider none).
    expect(summary).toMatchObject({ requested: 5, ok: 5, failed: 0, skipped: 0 });
    expect(summary.jobRunId).toEqual(expect.any(Number));

    const fetchedSymbols = h.calls
      .filter((c) => c.url.host !== 'api.coingecko.com')
      .map((c) => yahooSymbolOf(c.url));
    expect(fetchedSymbols.slice(0, 3)).toEqual(['AUDUSD=X', 'SI=F', 'GC=F']); // series first
    expect(fetchedSymbols.sort()).toEqual([
      'ABC.AX',
      'AUDUSD=X',
      'DEF.AX',
      'GC=F',
      'SI=F',
      'XYZ.AX',
    ]);
    expect(h.calls.filter((c) => c.url.pathname === '/api/v3/simple/price')).toHaveLength(1);

    expect(priceRow(h, 'ASX:ABC')).toMatchObject({
      price: '13',
      nativePrice: '13',
      nativeCurrency: 'AUD',
      fxRate: '1',
      asOf: MARKET_TIME,
      fetchedAt: NOW,
      source: 'yahoo',
      lastStatus: 'ok',
      lastError: null,
      consecutiveFailures: 0,
    });
    // USD ÷ AUDUSD.
    expect(priceRow(h, 'ASX:DEF')).toMatchObject({
      price: '50',
      nativePrice: '32.5',
      nativeCurrency: 'USD',
      fxRate: '1.538461538462',
      consecutiveFailures: 0,
    });
    expect(priceRow(h, 'BTC')).toMatchObject({
      price: '150000',
      source: 'coingecko',
      asOf: MARKET_TIME,
    });

    expect(quote(h, 'AUDUSD')).toMatchObject({ value: '0.65', source: 'yahoo', lastStatus: 'ok' });
    expect(quote(h, 'XAG_AUD_OZ')).toMatchObject({
      value: '46.153846153846',
      source: 'derived',
      asOf: MARKET_TIME,
    });
    expect(quote(h, 'XAU_AUD_OZ')).toMatchObject({ value: '4000', source: 'derived' });

    const run = h.scheduler.lastRun('prices')!;
    expect(run).toMatchObject({
      id: summary.jobRunId,
      trigger: 'manual',
      status: 'succeeded',
      error: null,
    });
    expect(run.detail).toMatchObject({
      requested: 5,
      ok: 5,
      failed: 0,
      skipped: 0,
      byProvider: {
        yahoo: { requested: 3, ok: 3, failed: 0, skipped: 0 },
        coingecko: { requested: 2, ok: 2, failed: 0, skipped: 0 },
      },
      series: { ok: 5, failed: 0, skipped: 0 },
    });

    const items = h.market.getPrices().items;
    for (const i of items.filter((x) => x.held)) expect(['fresh', 'manual']).toContain(i.status);
    expect(h.market.status().lastRefreshAt).toBe(NOW);
  });

  it('writes nothing until every fetch is done (one transaction at the end)', async () => {
    let seenDuringFetch: string | null | undefined;
    const h: Harness = setup({
      handler: (url) => {
        if (yahooSymbolOf(url) === 'ABC.AX') seenDuringFetch = quote(h, 'AUDUSD')?.fetchedAt;
        return liveHandler(url, undefined);
      },
    });
    const before = quote(h, 'AUDUSD')!.fetchedAt;
    await h.market.refresh();
    expect(seenDuringFetch).toBe(before);
    expect(quote(h, 'AUDUSD')!.fetchedAt).toBe(NOW);
  });

  it('restricts the run to the requested instrument ids', async () => {
    const h = setup();
    const summary = await h.market.refresh({
      instrumentIds: [h.ids['ASX:ABC']!, h.ids['EXAMPLEFUND']!],
    });
    expect(summary).toMatchObject({ requested: 1, ok: 1 });
    expect(priceRow(h, 'ASX:XYZ')!.source).toBe('sheet');
  });

  it('prices an instrument without a price_sources row from the derived default', async () => {
    const h = setup();
    const id = h.testDb.db
      .insert(instruments)
      .values({ kind: 'stock', symbol: 'ASX:NEW', exchange: 'ASX', code: 'NEW', sortOrder: 9 })
      .returning({ id: instruments.id })
      .get().id;
    await h.market.refresh();
    const row = h.testDb.db.select().from(prices).where(eq(prices.instrumentId, id)).get();
    expect(row).toMatchObject({ price: '7', source: 'yahoo' });
    const i = h.market.getPrices().items.find((x) => x.instrumentId === id)!;
    expect(i).toMatchObject({
      provider: 'yahoo',
      providerSymbol: 'NEW.AX',
      symbolOrigin: 'derived',
    });
  });

  it('records failures, keeps the last good price and counts consecutive failures', async () => {
    const h = setup({
      handler: (url) =>
        ['XYZ.AX', 'DEF.AX'].includes(yahooSymbolOf(url))
          ? jsonResponse(yahooNotFound(), 404)
          : liveHandler(url, undefined),
    });
    const summary = await h.market.refresh();
    expect(summary).toMatchObject({ requested: 5, ok: 3, failed: 2, skipped: 0 });
    expect(priceRow(h, 'ASX:XYZ')).toMatchObject({
      price: '105',
      source: 'sheet',
      lastStatus: 'error',
      lastError: 'Symbol not found',
      consecutiveFailures: 1,
      lastAttemptAt: NOW,
    });
    expect(priceRow(h, 'ASX:DEF')).toMatchObject({ price: null, consecutiveFailures: 3 });
    expect(item(h, 'ASX:XYZ').status).toBe('stale');
    expect(item(h, 'ASX:DEF')).toMatchObject({ status: 'failed', lastError: 'Symbol not found' });
    expect(h.scheduler.lastRun('prices')!.status).toBe('partial');
  });

  it('fails the job when everything fails', async () => {
    const h = setup({ handler: () => new Response('down', { status: 503 }) });
    const summary = await h.market.refresh();
    expect(summary).toMatchObject({ requested: 5, ok: 0, failed: 5 });
    expect(h.scheduler.lastRun('prices')!.status).toBe('failed');
    expect(quote(h, 'AUDUSD')).toMatchObject({
      value: '0.65',
      lastStatus: 'error',
      lastError: 'HTTP 503',
    });
  });

  it('skips instruments in backoff unless forced', async () => {
    const h = setup();
    const clock = h.clock as ReturnType<typeof settableClock>;
    const thirtyMinAgo = new Date(clock.now().getTime() - 30 * 60_000).toISOString();
    h.testDb.db
      .update(prices)
      .set({ consecutiveFailures: 3, lastAttemptAt: thirtyMinAgo })
      .where(eq(prices.instrumentId, h.ids['ASX:DEF']!))
      .run();
    expect(await h.market.refresh()).toMatchObject({ requested: 5, ok: 4, skipped: 1 });
    expect(h.calls.some((c) => yahooSymbolOf(c.url) === 'DEF.AX')).toBe(false);

    expect(await h.market.refresh({ force: true })).toMatchObject({ ok: 5, skipped: 0 });
    expect(priceRow(h, 'ASX:DEF')!.consecutiveFailures).toBe(0);
  });

  it('backs off 2^(n−3) hours, capped at 24 h', async () => {
    const h = setup();
    const at = (minutesAgo: number) =>
      new Date(h.clock.now().getTime() - minutesAgo * 60_000).toISOString();
    const set = (n: number, minutesAgo: number) =>
      h.testDb.db
        .update(prices)
        .set({ consecutiveFailures: n, lastAttemptAt: at(minutesAgo) })
        .where(eq(prices.instrumentId, h.ids['ASX:DEF']!))
        .run();
    set(4, 90); // wait 2 h
    expect((await h.market.refresh()).skipped).toBe(1);
    set(4, 130);
    expect((await h.market.refresh()).skipped).toBe(0);
    set(20, 23 * 60); // capped at 24 h
    expect((await h.market.refresh()).skipped).toBe(1);
    set(20, 24 * 60 + 1);
    expect((await h.market.refresh()).skipped).toBe(0);
  });

  it('cools a provider down after a 429 (Retry-After), even for a forced refresh', async () => {
    const h = setup({
      handler: (url) =>
        url.host !== 'api.coingecko.com' && yahooSymbolOf(url).endsWith('.AX')
          ? jsonResponse({}, 429, { 'retry-after': '600' })
          : liveHandler(url, undefined),
    });
    const clock = h.clock as ReturnType<typeof settableClock>;
    const first = await h.market.refresh();
    expect(first).toMatchObject({ requested: 5, ok: 2, failed: 0, skipped: 3 });
    expect(priceRow(h, 'ASX:DEF')!.consecutiveFailures).toBe(2); // not counted as a failure

    const yahooCalls = () => h.calls.filter((c) => c.url.host !== 'api.coingecko.com').length;
    const before = yahooCalls();
    clock.advance(60_000);
    const second = await h.market.refresh({ force: true });
    expect(second).toMatchObject({ ok: 2, skipped: 3 });
    expect(yahooCalls()).toBe(before); // neither series nor instruments hit Yahoo

    clock.advance(600_000);
    await h.market.refresh();
    expect(yahooCalls()).toBeGreaterThan(before);
  });

  it('cools down for 15 minutes without Retry-After', async () => {
    const h = setup({
      handler: (url) =>
        url.host === 'api.coingecko.com' ? jsonResponse({}, 429) : liveHandler(url, undefined),
    });
    const clock = h.clock as ReturnType<typeof settableClock>;
    expect(await h.market.refresh()).toMatchObject({ ok: 3, skipped: 2 });
    const cgCalls = () => h.calls.filter((c) => c.url.host === 'api.coingecko.com').length;
    const before = cgCalls();
    clock.advance(14 * 60_000);
    await h.market.refresh();
    expect(cgCalls()).toBe(before);
    clock.advance(2 * 60_000);
    await h.market.refresh();
    expect(cgCalls()).toBe(before + 1);
  });

  it('resolves a missing CoinGecko id by search and persists it', async () => {
    const h = setup();
    h.testDb.db
      .update(priceSources)
      .set({ providerSymbol: null })
      .where(eq(priceSources.instrumentId, h.ids.ETH!))
      .run();
    const summary = await h.market.refresh();
    expect(summary).toMatchObject({ ok: 5, failed: 0 });
    expect(sourceRow(h, 'ETH')).toMatchObject({
      providerSymbol: 'ethereum',
      symbolOrigin: 'search',
    });
    expect(priceRow(h, 'ETH')).toMatchObject({ price: '5000', source: 'coingecko' });
    expect(item(h, 'ETH')).toMatchObject({ providerSymbol: 'ethereum', symbolOrigin: 'search' });
    expect(h.scheduler.lastRun('prices')!.detail).toMatchObject({ searches: 1 });

    // Resolved ids are reused: no second search.
    await h.market.refresh();
    expect(h.calls.filter((c) => c.url.pathname === '/api/v3/search')).toHaveLength(1);
  });

  it('fails a coin without a search match', async () => {
    const h = setup({
      handler: (url) =>
        url.pathname === '/api/v3/search'
          ? jsonResponse({ coins: [] })
          : liveHandler(url, undefined),
    });
    h.testDb.db
      .update(priceSources)
      .set({ providerSymbol: null })
      .where(eq(priceSources.instrumentId, h.ids.ETH!))
      .run();
    expect(await h.market.refresh()).toMatchObject({ ok: 4, failed: 1 });
    expect(priceRow(h, 'ETH')).toMatchObject({
      lastError: 'No CoinGecko match for ETH',
      price: '4000',
    });
    expect(sourceRow(h, 'ETH')!.providerSymbol).toBeNull();
  });

  it('limits searches per run', async () => {
    const testDb = createTestDb();
    open.push(testDb);
    const now = new Date(NOW);
    const { instrumentIds } = seedGenericData(testDb.db, { now });
    testDb.db
      .update(priceSources)
      .set({ providerSymbol: null })
      .where(eq(priceSources.provider, 'coingecko'))
      .run();
    const { fetchImpl, calls } = mockFetch(liveHandler);
    const { createCoinGeckoProvider } = await import('../../src/market/providers/coingecko');
    const { createYahooProvider } = await import('../../src/market/providers/yahoo');
    const outcome = await runRefresh(
      {
        db: testDb.db,
        providers: {
          yahoo: createYahooProvider({ fetchImpl, sleep: noSleep, now: () => now, spacingMs: 0 }),
          coingecko: createCoinGeckoProvider({ fetchImpl, now: () => now }),
        },
        cooldowns: new Cooldowns(),
        now: () => now,
        sleep: noSleep,
        signal: new AbortController().signal,
        log: silentLogger(),
        maxSearches: 1,
      },
      { instrumentIds: [instrumentIds.BTC!, instrumentIds.ETH!] },
    );
    expect(outcome).toMatchObject({ requested: 2, ok: 1, skipped: 1, searches: 1 });
    expect(calls.filter((c) => c.url.pathname === '/api/v3/search')).toHaveLength(1);
  });

  it('skips instruments deleted while the run was fetching', async () => {
    const h: Harness = setup({
      handler: (url) => {
        if (yahooSymbolOf(url) === 'ABC.AX') {
          h.testDb.db.delete(instruments).where(eq(instruments.id, h.ids['ASX:ABC']!)).run();
        }
        return liveHandler(url, undefined);
      },
    });
    const summary = await h.market.refresh();
    expect(summary).toMatchObject({ requested: 5, ok: 4, failed: 0, skipped: 1 });
    expect(priceRow(h, 'ASX:ABC')).toBeUndefined();
    expect(h.scheduler.lastRun('prices')!.status).toBe('succeeded');
  });

  it('writes what succeeded when the run deadline passes', async () => {
    const h = setup({
      handler: (url, init) =>
        url.host !== 'api.coingecko.com' && yahooSymbolOf(url).endsWith('.AX')
          ? hangingResponse(init)
          : liveHandler(url, init),
      extra: { runDeadlineMs: 50 },
    });
    const started = Date.now();
    const summary = await h.market.refresh();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(summary).toMatchObject({ requested: 5, ok: 2, failed: 0, skipped: 3 });
    expect(priceRow(h, 'BTC')).toMatchObject({ price: '150000' });
    expect(quote(h, 'AUDUSD')!.fetchedAt).toBe(NOW);
    const run = h.scheduler.lastRun('prices')!;
    expect(run).toMatchObject({ status: 'partial', error: 'Run deadline reached' });
    expect(run.detail).toMatchObject({ deadlineHit: true });
  });

  it('joins a refresh already in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = setup({
      handler: async (url, init) => {
        await gate;
        return liveHandler(url, init);
      },
    });
    const a = h.market.refresh();
    const b = h.market.refresh({ force: true });
    expect(h.market.status().running).toBe(true);
    expect(h.market.getPrices().running).toBe(true);
    release();
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa.jobRunId).toBe(sb.jobRunId);
    expect(h.testDb.db.select().from(jobRuns).where(eq(jobRuns.job, 'prices')).all()).toHaveLength(
      2,
    ); // seed + 1
  });

  it('converts other currencies with an on-demand FX series', async () => {
    const h = setup({
      handler: (url, init) => {
        const s = yahooSymbolOf(url);
        if (s === 'XYZ.AX')
          return jsonResponse(
            yahooChart({ symbol: s, price: 250, currency: 'GBp', time: MARKET_TIME }),
          );
        if (s === 'GBPAUD=X')
          return jsonResponse(
            yahooChart({ symbol: s, price: 2, currency: 'AUD', time: MARKET_TIME }),
          );
        return liveHandler(url, init);
      },
    });
    await h.market.refresh();
    expect(priceRow(h, 'ASX:XYZ')).toMatchObject({
      price: '5',
      nativePrice: '250',
      nativeCurrency: 'GBp',
      fxRate: '0.02',
    });
    expect(quote(h, 'FX_GBPAUD')).toMatchObject({
      value: '2',
      unit: 'AUD per GBP',
      source: 'yahoo',
    });
    expect(h.market.getSeries().at(-1)).toMatchObject({
      seriesId: 'FX_GBPAUD',
      label: 'GBP/AUD',
      status: 'fresh',
    });
  });

  it('fails an instrument whose FX rate is unavailable', async () => {
    const h = setup({
      handler: (url, init) => {
        const s = yahooSymbolOf(url);
        if (s === 'XYZ.AX')
          return jsonResponse(
            yahooChart({ symbol: s, price: 10, currency: 'EUR', time: MARKET_TIME }),
          );
        return liveHandler(url, init); // EURAUD=X → 404
      },
    });
    expect(await h.market.refresh()).toMatchObject({ ok: 4, failed: 1 });
    expect(priceRow(h, 'ASX:XYZ')).toMatchObject({ lastError: 'No FX rate for EUR', price: '105' });
    expect(quote(h, 'FX_EURAUD')).toMatchObject({ value: null, lastStatus: 'error' });
  });
});

describe('refresh (fake)', () => {
  it('prices every target deterministically without the network', async () => {
    const h = setup({ mode: 'fake' });
    const summary = await h.market.refresh();
    expect(summary).toMatchObject({ requested: 5, ok: 5, failed: 0 });
    expect(h.calls).toHaveLength(0);
    expect(priceRow(h, 'ASX:ABC')).toMatchObject({ price: fakePrice('ABC.AX'), source: 'fake' });
    expect(priceRow(h, 'BTC')).toMatchObject({ price: fakePrice('bitcoin'), source: 'fake' });
    expect(quote(h, 'AUDUSD')).toMatchObject({ value: '0.65', source: 'fake' });
    const held = h.market.getPrices().items.filter((i) => i.held);
    expect(held.map((i) => i.status)).toEqual([
      'fresh',
      'fresh',
      'fresh',
      'manual',
      'fresh',
      'fresh',
    ]);
  });
});

describe('manual prices and sources', () => {
  it('sets, wins over the fetched price, and clears a manual price', async () => {
    const h = setup();
    await h.market.refresh();
    const set = h.market.setManualPrice(h.ids['ASX:ABC']!, {
      price: '14',
      asOf: '2026-09-24',
      note: '  Broker quote ',
    });
    expect(set).toMatchObject({
      status: 'manual',
      price: '14',
      priceSource: 'manual',
      asOf: '2026-09-24',
      manual: { price: '14', asOf: '2026-09-24', note: 'Broker quote', origin: 'user' },
      fetched: { price: '13', source: 'yahoo' },
    });
    // A refresh updates the fetched price but never the manual one.
    await h.market.refresh();
    expect(item(h, 'ASX:ABC')).toMatchObject({ price: '14', status: 'manual' });

    const cleared = h.market.clearManualPrice(h.ids['ASX:ABC']!);
    expect(cleared).toMatchObject({
      status: 'fresh',
      price: '13',
      priceSource: 'yahoo',
      manual: null,
    });
    expect(sourceRow(h, 'ASX:ABC')).toMatchObject({
      manualPrice: null,
      manualOrigin: null,
      provider: 'yahoo',
    });
  });

  it('shows an old manual price as stale', () => {
    const h = setup();
    const i = h.market.setManualPrice(h.ids['ASX:XYZ']!, { price: '100', asOf: '2026-08-01' });
    expect(i).toMatchObject({ status: 'stale', priceSource: 'manual', manual: { note: null } });
  });

  it('creates the price_sources row when an instrument has none', () => {
    const h = setup();
    const id = h.testDb.db
      .insert(instruments)
      .values({ kind: 'managed_fund', symbol: 'EXAMPLEFUND3', code: 'EXAMPLEFUND3', sortOrder: 3 })
      .returning({ id: instruments.id })
      .get().id;
    expect(h.market.setManualPrice(id, { price: '2.5', asOf: '2026-09-23' })).toMatchObject({
      provider: 'none',
      symbolOrigin: 'derived',
      status: 'manual',
    });
  });

  it('edits the source (symbol origin user) and the next refresh uses it', async () => {
    const h = setup();
    h.testDb.db
      .update(prices)
      .set({ consecutiveFailures: 5, lastAttemptAt: NOW })
      .where(eq(prices.instrumentId, h.ids['ASX:DEF']!))
      .run();
    const i = h.market.setPriceSource(h.ids['ASX:DEF']!, {
      provider: 'yahoo',
      providerSymbol: 'NEW.AX',
    });
    expect(i).toMatchObject({
      provider: 'yahoo',
      providerSymbol: 'NEW.AX',
      symbolOrigin: 'user',
      consecutiveFailures: 0,
    });
    await h.market.refresh();
    expect(h.calls.some((c) => yahooSymbolOf(c.url) === 'NEW.AX')).toBe(true);
    expect(priceRow(h, 'ASX:DEF')).toMatchObject({ price: '7' });

    const none = h.market.setPriceSource(h.ids['ASX:DEF']!, {
      provider: 'none',
      providerSymbol: 'IGNORED',
    });
    expect(none).toMatchObject({ provider: 'none', providerSymbol: null, symbolOrigin: 'user' });
    expect((await h.market.refresh()).requested).toBe(4);
  });

  it('answers 404 for an unknown instrument', () => {
    const h = setup();
    const expect404 = (fn: () => unknown) => {
      try {
        fn();
        expect.fail('expected a 404');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect(err).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      }
    };
    expect404(() => h.market.setManualPrice(999, { price: '1', asOf: '2026-09-24' }));
    expect404(() => h.market.clearManualPrice(999));
    expect404(() => h.market.setPriceSource(999, { provider: 'none', providerSymbol: null }));
  });
});

describe('notifyInstrumentsChanged', () => {
  it('coalesces calls into one refresh ~5 s later', async () => {
    const clock = manualClock(NOW);
    const h = setup({ clock });
    h.market.notifyInstrumentsChanged();
    h.market.notifyInstrumentsChanged();
    h.market.notifyInstrumentsChanged();
    expect(clock.pending()).toEqual([{ ms: 5_000 }]);
    clock.fire();
    await vi.waitFor(() => {
      const run = h.scheduler.lastRun('prices')!;
      expect(run.trigger).toBe('import');
      expect(run.status).toBe('succeeded');
    });
    expect(h.testDb.db.select().from(jobRuns).all()).toHaveLength(2); // seed + 1
    // A later change schedules a new refresh.
    h.market.notifyInstrumentsChanged();
    expect(clock.pending()).toEqual([{ ms: 5_000 }]);
  });

  it('does nothing in mode off', () => {
    const clock = manualClock(NOW);
    const h = setup({ mode: 'off', clock });
    h.market.notifyInstrumentsChanged();
    expect(clock.pending()).toEqual([]);
  });
});

describe('scheduling', () => {
  it('registers the prices job with the configured interval and a 15 s first run', () => {
    const clock = manualClock(NOW);
    const h = setup({ clock });
    expect(h.market.status().nextRefreshAt).toBeNull();
    h.scheduler.start();
    expect(clock.pending()).toEqual([{ ms: 15_000 }]);
    expect(h.market.status().nextRefreshAt).toBe(new Date(Date.parse(NOW) + 15_000).toISOString());
    expect(h.market.getPrices().nextRefreshAt).toBe(h.market.status().nextRefreshAt);
  });
});
