// The dividend-events service and its `dividends` job (stage-3.md §4.6, §7.5): targets, the
// identity check, upserts that keep dismissals, the Yahoo cool-down shared with the price job,
// waiting for the price job, the run deadline, the modes and the job registration. A mocked
// fetch and injected clocks only; the server test setup makes any real fetch fail.
import type { MarketDataMode } from '@joinr/schema';
import {
  dividendEvents,
  instruments,
  jobRuns,
  priceSources,
  trades,
  type JoinrDb,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDividendEventsService,
  createOffDividendEventsService,
  DIVIDENDS_INITIAL_DELAY_MS,
  DIVIDENDS_INTERVAL_MS,
  PRICES_WAIT_POLL_MS,
  type DividendEventsService,
  type DividendEventsServiceOptions,
} from '../../src/market/dividends/index';
import { selectEventTargets } from '../../src/market/dividends/run';
import { fakeDividendAmount, fakeDividendEvents, fakePrice } from '../../src/market/providers/fake';
import { Cooldowns } from '../../src/market/refresh';
import { createService } from '../../src/market/service';
import { MarketDataDisabledError } from '../../src/market/types';
import { createScheduler } from '../../src/scheduler/index';
import type { Clock, Scheduler } from '../../src/scheduler/types';
import {
  hangingResponse,
  jsonResponse,
  manualClock,
  mockFetch,
  settableClock,
  silentLogger,
  unix,
  yahooNotFound,
  yahooSymbolOf,
  type FetchCall,
  type FetchHandler,
} from './helpers';

// A Thursday, mid-morning in Australia.
const NOW = '2026-09-24T02:00:00.000Z';
const YAHOO_HOST = 'query1.finance.yahoo.com';

/** [UTC timestamp of the 10:00 Sydney bar, close]. */
type Bar = [string, number | null];

/**
 * Generic events per Yahoo symbol: timestamps at 10:00 Sydney time (00:00 UTC in standard time,
 * 23:00 UTC the day before under daylight saving).
 */
const EVENTS: Record<string, { bars: Bar[]; events: Array<[string, number]> }> = {
  'ABC.AX': {
    bars: [
      ['2025-06-30T00:00:00Z', 12],
      ['2025-07-01T00:00:00Z', 11.5],
      ['2026-01-01T23:00:00Z', 13], // Fri 02/01/2026
      ['2026-01-04T23:00:00Z', 12.8], // Mon 05/01/2026
    ],
    events: [
      ['2025-07-01T00:00:00Z', 0.25],
      ['2026-01-04T23:00:00Z', 0.3],
    ],
  },
  'OLD.AX': { bars: [['2025-06-30T00:00:00Z', 5]], events: [] },
  'XYZ.AX': {
    bars: [
      ['2026-03-30T23:00:00Z', 100], // Tue 31/03/2026 (daylight saving ends 05/04/2026)
      ['2026-03-31T23:00:00Z', 99], // Wed 01/04/2026
    ],
    events: [['2026-03-31T23:00:00Z', 1.2]],
  },
  'DEF.AX': {
    bars: [['2026-06-30T00:00:00Z', 50]],
    events: [['2026-07-01T00:00:00Z', 0.75]],
  },
};

function eventsBody(symbol: string): unknown {
  const e = EVENTS[symbol]!;
  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'AUD',
            symbol,
            exchangeName: 'ASX',
            instrumentType: 'ETF',
            gmtoffset: 36000,
            timezone: 'AEST',
            exchangeTimezoneName: 'Australia/Sydney',
            regularMarketPrice: 12,
            regularMarketTime: unix(NOW),
          },
          timestamp: e.bars.map(([ts]) => unix(ts)),
          events: {
            dividends: Object.fromEntries(
              e.events.map(([ts, amount]) => [String(unix(ts)), { amount, date: unix(ts) }]),
            ),
          },
          indicators: { quote: [{ close: e.bars.map(([, c]) => c) }] },
        },
      ],
      error: null,
    },
  };
}

const yahooEvents: FetchHandler = (url) => {
  if (url.host !== YAHOO_HOST) return jsonResponse({}, 404);
  const symbol = yahooSymbolOf(url);
  if (!EVENTS[symbol]) return jsonResponse(yahooNotFound(), 404);
  return jsonResponse(eventsBody(symbol));
};

/** The event requests only (a price service in the same test also calls Yahoo). */
function eventCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.url.searchParams.get('events') === 'div');
}

interface Harness {
  testDb: TestDb;
  db: JoinrDb;
  ids: Record<string, number>;
  calls: FetchCall[];
  fetchImpl: typeof fetch;
  clock: Clock;
  scheduler: Scheduler;
  cooldowns: Cooldowns;
  dividends: DividendEventsService;
}

const open: TestDb[] = [];
const schedulers: Scheduler[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const s of schedulers.splice(0)) await s.stop();
  for (const t of open.splice(0)) t.close();
});

function setup(
  o: {
    mode?: MarketDataMode;
    priceRefreshMinutes?: number;
    handler?: FetchHandler;
    clock?: Clock;
    extra?: Partial<DividendEventsServiceOptions>;
    /** Changes before the service is built (e.g. extra instruments). */
    prepare?: (db: JoinrDb, ids: Record<string, number>) => void;
  } = {},
): Harness {
  const testDb = createTestDb();
  open.push(testDb);
  const clock = o.clock ?? settableClock(NOW);
  const { instrumentIds } = seedGenericData(testDb.db, { now: clock.now() });
  o.prepare?.(testDb.db, instrumentIds);
  const { fetchImpl, calls } = mockFetch(o.handler ?? yahooEvents);
  const log = silentLogger();
  const scheduler = createScheduler({ db: testDb.db, log, clock });
  schedulers.push(scheduler);
  const cooldowns = new Cooldowns();
  const dividends = createDividendEventsService({
    db: testDb.db,
    config: { marketDataMode: o.mode ?? 'live', priceRefreshMinutes: o.priceRefreshMinutes ?? 0 },
    log,
    scheduler,
    cooldowns,
    fetchImpl,
    clock,
    yahooSpacingMs: 0,
    ...o.extra,
  });
  return {
    testDb,
    db: testDb.db,
    ids: instrumentIds,
    calls,
    fetchImpl,
    clock,
    scheduler,
    cooldowns,
    dividends,
  };
}

/** A price service on the same scheduler, database and cool-downs (as `defaultServices`). */
function priceService(h: Harness, handler: FetchHandler) {
  const { fetchImpl, calls } = mockFetch(handler);
  const service = createService({
    db: h.db,
    config: { marketDataMode: 'live', priceRefreshMinutes: 0 },
    log: silentLogger(),
    scheduler: h.scheduler,
    fetchImpl,
    clock: h.clock,
    cooldowns: h.cooldowns,
    yahooSpacingMs: 0,
    searchSpacingMs: 0,
  });
  return { service, calls };
}

function eventRows(h: Harness, symbol?: string) {
  const rows = h.db.select().from(dividendEvents).all();
  const filtered = symbol ? rows.filter((r) => r.instrumentId === h.ids[symbol]) : rows;
  return filtered.sort(
    (a, b) =>
      a.instrumentId - b.instrumentId || (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0),
  );
}

function dividendRuns(h: Harness) {
  return h.db.select().from(jobRuns).where(eq(jobRuns.job, 'dividends')).all();
}

/** Registers a stand-in `prices` job that runs until `release()` (or shutdown). */
function blockingPricesJob(scheduler: Scheduler): { release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  scheduler.register({
    name: 'prices',
    intervalMs: 0,
    run: async (ctx) => {
      await Promise.race([
        gate,
        new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r(), { once: true })),
      ]);
      return { status: 'succeeded' };
    },
  });
  return { release };
}

describe('mode off', () => {
  it('throws MarketDataDisabledError, registers no job and reports mode off', async () => {
    const h = setup({ mode: 'off' });
    await expect(h.dividends.refresh()).rejects.toBeInstanceOf(MarketDataDisabledError);
    await expect(h.scheduler.run('dividends')).rejects.toThrow('Unknown job: dividends');
    expect(h.dividends.status()).toEqual({
      mode: 'off',
      running: false,
      lastRefreshAt: null,
      nextRefreshAt: null,
    });
    expect(h.calls).toHaveLength(0);
    const off = createOffDividendEventsService();
    await expect(off.refresh()).rejects.toMatchObject({
      code: 'MARKET_DATA_DISABLED',
      statusCode: 503,
    });
  });
});

describe('targets', () => {
  it('takes Yahoo stocks, ETFs and funds with a symbol and a trade; never crypto', () => {
    const h = setup({
      prepare: (db, ids) => {
        const now = new Date(NOW).toISOString();
        // A fund priced on Yahoo; crypto moved to Yahoo; an ETF without a symbol.
        db.update(priceSources)
          .set({ provider: 'yahoo', providerSymbol: 'EXAMPLEFUND.AX' })
          .where(eq(priceSources.instrumentId, ids['EXAMPLEFUND']!))
          .run();
        db.update(priceSources)
          .set({ provider: 'yahoo', providerSymbol: 'BTC-AUD' })
          .where(eq(priceSources.instrumentId, ids['BTC']!))
          .run();
        db.update(priceSources)
          .set({ providerSymbol: null })
          .where(eq(priceSources.instrumentId, ids['ASX:DEF']!))
          .run();
        // An ETF without a price_sources row (derived: yahoo GHI.AX) with a trade, and one
        // with a Yahoo source but no trade.
        const add = (symbol: string, code: string, sortOrder: number) =>
          db
            .insert(instruments)
            .values({ kind: 'etf', symbol, exchange: 'ASX', code, sortOrder, origin: 'app' })
            .returning({ id: instruments.id })
            .get().id;
        const ghi = add('ASX:GHI', 'GHI', 90);
        const jkl = add('ASX:JKL', 'JKL', 91);
        ids['ASX:GHI'] = ghi;
        ids['ASX:JKL'] = jkl;
        db.insert(priceSources)
          .values({
            instrumentId: jkl,
            provider: 'yahoo',
            providerSymbol: 'JKL.AX',
            symbolOrigin: 'user',
            updatedAt: now,
          })
          .run();
        db.insert(trades)
          .values({
            instrumentId: ghi,
            tradeDate: '2026-02-02',
            units: '10',
            price: '20',
            seq: 1,
            origin: 'app',
          })
          .run();
      },
    });
    const targets = selectEventTargets(h.db);
    expect(targets.map((t) => [t.symbol, t.providerSymbol, t.firstTradeDate])).toEqual([
      ['ASX:ABC', 'ABC.AX', '2025-01-15'],
      ['ASX:OLD', 'OLD.AX', '2024-03-01'],
      ['ASX:XYZ', 'XYZ.AX', '2024-07-01'],
      ['EXAMPLEFUND', 'EXAMPLEFUND.AX', '2024-09-10'],
      ['ASX:GHI', 'GHI.AX', '2026-02-02'],
    ]);
    expect(targets[3]).toMatchObject({ kind: 'managed_fund', id: h.ids['EXAMPLEFUND'] });
    expect(
      selectEventTargets(h.db, [h.ids['ASX:XYZ']!, h.ids['BTC']!, h.ids['ASX:JKL']!]).map(
        (t) => t.symbol,
      ),
    ).toEqual(['ASX:XYZ']);
  });
});

describe('refresh (live)', () => {
  it('requests each target once and writes its events with the close before the ex-date', async () => {
    const h = setup();
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 4, failed: 0, skipped: 0, events: 4 });
    expect(summary.jobRunId).toBeGreaterThan(0);

    expect(h.calls.map((c) => yahooSymbolOf(c.url)).sort()).toEqual([
      'ABC.AX',
      'DEF.AX',
      'OLD.AX',
      'XYZ.AX',
    ]);
    const abc = h.calls.find((c) => yahooSymbolOf(c.url) === 'ABC.AX')!;
    expect(abc.url.host).toBe(YAHOO_HOST);
    expect(abc.url.pathname).toBe('/v8/finance/chart/ABC.AX');
    expect(Object.fromEntries(abc.url.searchParams)).toEqual({
      period1: String(unix('2025-01-01T00:00:00Z')), // first trade 15/01/2025 − 14 days
      period2: String(unix(NOW)),
      interval: '1d',
      events: 'div',
    });
    expect((abc.init?.headers as Record<string, string>)['User-Agent']).toMatch(/^Mozilla\/5\.0/);

    expect(eventRows(h, 'ASX:ABC')).toEqual([
      {
        instrumentId: h.ids['ASX:ABC'],
        exDate: '2025-07-01',
        amountPerUnit: '0.25',
        currency: 'AUD',
        closeBeforeEx: '12',
        closeDate: '2025-06-30',
        source: 'yahoo',
        fetchedAt: NOW,
        dismissedAt: null,
      },
      {
        instrumentId: h.ids['ASX:ABC'],
        exDate: '2026-01-05',
        amountPerUnit: '0.3',
        currency: 'AUD',
        closeBeforeEx: '13',
        closeDate: '2026-01-02',
        source: 'yahoo',
        fetchedAt: NOW,
        dismissedAt: null,
      },
    ]);
    expect(eventRows(h, 'ASX:XYZ').map((r) => [r.exDate, r.closeBeforeEx])).toEqual([
      ['2026-04-01', '100'],
    ]);
    expect(eventRows(h, 'ASX:OLD')).toEqual([]);

    const run = h.scheduler.lastRun('dividends')!;
    expect(run).toMatchObject({ trigger: 'manual', status: 'succeeded', error: null });
    expect(run.detail).toMatchObject({
      requested: 4,
      ok: 4,
      failed: 0,
      skipped: 0,
      events: 4,
      source: 'yahoo',
      rateLimited: false,
      deadlineHit: false,
      waitedForPrices: false,
    });
    expect(h.dividends.status()).toEqual({
      mode: 'live',
      running: false,
      lastRefreshAt: NOW,
      nextRefreshAt: null,
    });
  });

  it('upserts by holding and ex-date and never touches dismissed_at', async () => {
    const h = setup({
      prepare: (db, ids) => {
        const old = {
          currency: 'AUD',
          closeBeforeEx: null,
          closeDate: null,
          source: 'yahoo' as const,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          dismissedAt: '2026-02-01T00:00:00.000Z',
        };
        db.insert(dividendEvents)
          .values([
            { ...old, instrumentId: ids['ASX:ABC']!, exDate: '2025-07-01', amountPerUnit: '9' },
            { ...old, instrumentId: ids['ASX:ABC']!, exDate: '2024-07-01', amountPerUnit: '8' },
          ])
          .run();
      },
    });
    await h.dividends.refresh();
    expect(
      eventRows(h, 'ASX:ABC').map((r) => [r.exDate, r.amountPerUnit, r.fetchedAt, r.dismissedAt]),
    ).toEqual([
      // Yahoo no longer lists this one: kept as it was.
      ['2024-07-01', '8', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
      // Refreshed from Yahoo; the dismissal stays.
      ['2025-07-01', '0.25', NOW, '2026-02-01T00:00:00.000Z'],
      ['2026-01-05', '0.3', NOW, null],
    ]);
    // A second run changes nothing but the fetch time.
    const before = eventRows(h).length;
    await h.dividends.refresh();
    expect(eventRows(h)).toHaveLength(before);
    expect(dividendRuns(h)).toHaveLength(2);
  });

  it('restricts the run to the requested instrument ids', async () => {
    const h = setup();
    const summary = await h.dividends.refresh({ instrumentIds: [h.ids['ASX:XYZ']!] });
    expect(summary).toMatchObject({ requested: 1, ok: 1, events: 1 });
    expect(h.calls.map((c) => yahooSymbolOf(c.url))).toEqual(['XYZ.AX']);
    // The next run is unrestricted again.
    expect((await h.dividends.refresh()).requested).toBe(4);
  });

  it('skips a holding deleted or renamed while the run was fetching', async () => {
    const h = setup({
      handler: (url, init) => {
        const symbol = yahooSymbolOf(url);
        if (symbol === 'ABC.AX') {
          h.db.delete(instruments).where(eq(instruments.id, h.ids['ASX:ABC']!)).run();
        }
        if (symbol === 'XYZ.AX') {
          h.db
            .update(instruments)
            .set({ symbol: 'ASX:XYZ2', code: 'XYZ2' })
            .where(eq(instruments.id, h.ids['ASX:XYZ']!))
            .run();
        }
        return yahooEvents(url, init);
      },
    });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 2, failed: 0, skipped: 2, events: 1 });
    expect(eventRows(h).map((r) => r.instrumentId)).toEqual([h.ids['ASX:DEF']]);
    // A holding that vanished is not an error.
    expect(h.scheduler.lastRun('dividends')).toMatchObject({ status: 'succeeded', error: null });
  });

  it('records failures (no URL or body in the text) and still writes the rest', async () => {
    const h = setup({
      handler: (url, init) => {
        const symbol = yahooSymbolOf(url);
        if (symbol === 'OLD.AX') return jsonResponse(yahooNotFound(), 404);
        if (symbol === 'XYZ.AX') return new Response('upstream <b>oops</b>', { status: 500 });
        if (symbol === 'DEF.AX') return new Response('not json', { status: 200 });
        return yahooEvents(url, init);
      },
    });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 1, failed: 3, skipped: 0, events: 2 });
    const run = h.scheduler.lastRun('dividends')!;
    expect(run.status).toBe('partial');
    expect(run.error).toBe('3 of 4 holdings failed: Symbol not found');
    expect(run.error).not.toMatch(/https?:|yahoo\.com|oops/);
  });

  it('keeps going when one target cannot even be requested', async () => {
    const h = setup({
      prepare: (db, ids) => {
        // An unreadable first-trade date (sorts before every real one).
        db.insert(trades)
          .values({
            instrumentId: ids['ASX:DEF']!,
            tradeDate: '0001/01/01',
            units: '1',
            price: '1',
            seq: 99,
          })
          .run();
      },
    });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 3, failed: 1, skipped: 0, events: 3 });
    expect(h.calls.map((c) => yahooSymbolOf(c.url))).not.toContain('DEF.AX');
    expect(h.scheduler.lastRun('dividends')).toMatchObject({
      status: 'partial',
      error: '1 of 4 holdings failed: Unexpected error',
    });
  });

  it('fails the job when every target fails', async () => {
    const h = setup({ handler: () => new Response('', { status: 502 }) });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 0, failed: 4, skipped: 0, events: 0 });
    expect(h.scheduler.lastRun('dividends')).toMatchObject({
      status: 'failed',
      error: '4 of 4 holdings failed: HTTP 502',
    });
    expect(h.dividends.status().lastRefreshAt).toBeNull();
  });

  it('joins a refresh already in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = setup({
      handler: async (url, init) => {
        await gate;
        return yahooEvents(url, init);
      },
    });
    const a = h.dividends.refresh();
    const b = h.dividends.refresh({ instrumentIds: [h.ids['ASX:ABC']!] });
    expect(h.dividends.status().running).toBe(true);
    release();
    const [sa, sb] = await Promise.all([a, b]);
    expect(sa.jobRunId).toBe(sb.jobRunId);
    expect(sb.requested).toBe(4);
    expect(h.calls).toHaveLength(4);
    expect(dividendRuns(h)).toHaveLength(1);
    expect(h.dividends.status().running).toBe(false);
  });

  it('marks a run stopped by shutdown as partial', async () => {
    const h = setup({
      handler: (url, init) =>
        yahooSymbolOf(url) === 'ABC.AX' ? yahooEvents(url, init) : hangingResponse(init),
    });
    const run = h.dividends.refresh();
    await vi.waitFor(() => expect(h.calls.length).toBeGreaterThanOrEqual(2));
    await h.scheduler.stop();
    const summary = await run;
    expect(summary).toMatchObject({ requested: 4, ok: 1, skipped: 3 });
    expect(h.scheduler.lastRun('dividends')).toMatchObject({
      status: 'partial',
      error: 'Run aborted',
    });
  });
});

describe('rate limits and the shared cool-down', () => {
  /** ABC answers 429 at once; the others answer a little later, so the order is fixed. */
  function limitedHandler(status: number, headers: Record<string, string> = {}): FetchHandler {
    return async (url, init) => {
      if (url.host === YAHOO_HOST && yahooSymbolOf(url) === 'ABC.AX')
        return new Response('', { status, headers });
      await new Promise((r) => setTimeout(r, 10));
      return yahooEvents(url, init);
    };
  }

  it('stops the run on a 429 and starts the Yahoo cool-down (Retry-After honoured)', async () => {
    const h = setup({ handler: limitedHandler(429, { 'retry-after': '120' }) });
    const summary = await h.dividends.refresh();
    // ABC is rate limited; OLD was already in flight; XYZ and DEF are skipped.
    expect(summary).toMatchObject({ requested: 4, ok: 1, failed: 0, skipped: 3, events: 0 });
    expect(eventCalls(h.calls).map((c) => yahooSymbolOf(c.url))).toEqual(['ABC.AX', 'OLD.AX']);
    expect(h.cooldowns.untilIso('yahoo')).toBe(new Date(Date.parse(NOW) + 120_000).toISOString());
    expect(h.scheduler.lastRun('dividends')).toMatchObject({
      status: 'partial',
      error: 'Rate limited by Yahoo; the remaining holdings were skipped',
    });
    expect(h.scheduler.lastRun('dividends')!.detail).toMatchObject({ rateLimited: true });

    // The price job shares the cool-down: it skips Yahoo altogether.
    const prices = priceService(h, (url) =>
      url.host === YAHOO_HOST ? jsonResponse({}, 500) : jsonResponse({}),
    );
    const before = h.calls.length;
    await prices.service.refresh();
    const pricesRun = h.scheduler.lastRun('prices')!;
    const yahoo = (pricesRun.detail!.byProvider as Record<string, Record<string, number>>).yahoo!;
    expect(yahoo.requested).toBeGreaterThan(0);
    expect(yahoo.skipped).toBe(yahoo.requested);
    expect(prices.calls.filter((c) => c.url.host === YAHOO_HOST)).toHaveLength(0);

    // A new dividends run inside the cool-down skips every target without a request.
    const again = await h.dividends.refresh();
    expect(again).toMatchObject({ requested: 4, ok: 0, skipped: 4 });
    expect(h.calls.length).toBe(before);
    expect(h.scheduler.lastRun('dividends')).toMatchObject({
      status: 'partial',
      error: 'Yahoo is cooling down after a rate limit; holdings were skipped',
    });
  });

  it('treats a 403 as a rate limit (15-minute cool-down without Retry-After)', async () => {
    const h = setup({ handler: limitedHandler(403) });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ ok: 1, failed: 0, skipped: 3 });
    expect(h.cooldowns.untilIso('yahoo')).toBe(
      new Date(Date.parse(NOW) + 15 * 60_000).toISOString(),
    );
  });

  it('is stopped by a cool-down the price job started', async () => {
    const h = setup();
    const prices = priceService(h, (url) =>
      url.host === YAHOO_HOST ? new Response('', { status: 429 }) : jsonResponse({}),
    );
    await prices.service.refresh();
    expect(prices.calls.some((c) => c.url.host === YAHOO_HOST)).toBe(true);
    expect(h.cooldowns.isCooling('yahoo', h.clock.now())).toBe(true);
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 0, failed: 0, skipped: 4, events: 0 });
    expect(eventCalls(h.calls)).toHaveLength(0);
    expect(h.scheduler.lastRun('dividends')!.detail).toMatchObject({ cooling: true });
  });

  it('checks the cool-down before every request (one started mid-run stops the rest)', async () => {
    const h = setup({
      handler: (url, init) => {
        // As if the price job hit a 429 while this run was fetching.
        if (yahooSymbolOf(url) === 'ABC.AX') h.cooldowns.start('yahoo', h.clock.now());
        return yahooEvents(url, init);
      },
    });
    const summary = await h.dividends.refresh();
    expect(summary).toMatchObject({ requested: 4, ok: 1, failed: 0, skipped: 3, events: 2 });
    expect(eventCalls(h.calls).map((c) => yahooSymbolOf(c.url))).toEqual(['ABC.AX']);
    expect(h.scheduler.lastRun('dividends')!.status).toBe('partial');
  });
});

describe('the price job and the run deadline', () => {
  it('waits while the prices job runs, polling on the injected clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = setup();
    const pricesJob = blockingPricesJob(h.scheduler);
    const pricesRun = h.scheduler.run('prices');
    const run = h.dividends.refresh();
    await vi.advanceTimersByTimeAsync(5 * PRICES_WAIT_POLL_MS);
    expect(h.calls).toHaveLength(0);
    expect(h.dividends.status().running).toBe(true);

    pricesJob.release();
    await pricesRun;
    await vi.advanceTimersByTimeAsync(PRICES_WAIT_POLL_MS);
    const summary = await run;
    expect(summary).toMatchObject({ requested: 4, ok: 4, events: 4 });
    expect(h.calls).toHaveLength(4);
    expect(h.scheduler.lastRun('dividends')!.detail).toMatchObject({ waitedForPrices: true });
  });

  it('bounds the wait by the run deadline (every target skipped, partial)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = setup({ extra: { runDeadlineMs: 5_000 } });
    blockingPricesJob(h.scheduler);
    void h.scheduler.run('prices');
    const run = h.dividends.refresh();
    await vi.advanceTimersByTimeAsync(5_000);
    const summary = await run;
    expect(summary).toMatchObject({ requested: 4, ok: 0, failed: 0, skipped: 4, events: 0 });
    expect(h.calls).toHaveLength(0);
    const last = h.scheduler.lastRun('dividends')!;
    expect(last).toMatchObject({ status: 'partial', error: 'Run deadline reached' });
    expect(last.detail).toMatchObject({ deadlineHit: true, waitedForPrices: true });
  });

  it('writes what succeeded when the run deadline passes mid-fetch', async () => {
    const h = setup({
      handler: (url, init) =>
        ['XYZ.AX', 'DEF.AX'].includes(yahooSymbolOf(url))
          ? hangingResponse(init)
          : yahooEvents(url, init),
      extra: { runDeadlineMs: 50 },
    });
    const started = Date.now();
    const summary = await h.dividends.refresh();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(summary).toMatchObject({ requested: 4, ok: 2, failed: 0, skipped: 2, events: 2 });
    expect(eventRows(h, 'ASX:ABC')).toHaveLength(2);
    const last = h.scheduler.lastRun('dividends')!;
    expect(last).toMatchObject({ status: 'partial', error: 'Run deadline reached' });
    expect(last.detail).toMatchObject({ deadlineHit: true });
  });
});

describe('fake mode', () => {
  it('writes deterministic quarterly events without the network', async () => {
    const h = setup({ mode: 'fake', handler: () => Promise.reject(new Error('no network')) });
    const summary = await h.dividends.refresh();
    const perHolding = fakeDividendEvents('ABC.AX', new Date(NOW)).length;
    expect(perHolding).toBe(8);
    expect(summary).toMatchObject({ requested: 4, ok: 4, failed: 0, events: 4 * perHolding });
    expect(h.calls).toHaveLength(0);
    const abc = eventRows(h, 'ASX:ABC');
    expect(abc).toHaveLength(perHolding);
    expect(abc[0]).toMatchObject({
      exDate: '2024-10-01',
      amountPerUnit: fakeDividendAmount('ABC.AX'),
      currency: 'AUD',
      closeBeforeEx: fakePrice('ABC.AX'),
      closeDate: '2024-09-30',
      source: 'fake',
      fetchedAt: NOW,
      dismissedAt: null,
    });
    expect(h.scheduler.lastRun('dividends')).toMatchObject({ status: 'succeeded' });
    expect(h.dividends.status().mode).toBe('fake');
  });
});

describe('scheduling', () => {
  it('registers without a timer when PRICE_REFRESH_MINUTES is 0; a manual run still logs', async () => {
    for (const mode of ['live', 'fake'] as const) {
      const clock = manualClock(NOW);
      const h = setup({ mode, clock, priceRefreshMinutes: 0 });
      h.scheduler.start();
      expect(clock.pending()).toEqual([]);
      expect(h.dividends.status().nextRefreshAt).toBeNull();
      const summary = await h.dividends.refresh();
      expect(summary.requested).toBe(4);
      expect(dividendRuns(h)).toEqual([
        expect.objectContaining({ trigger: 'manual', status: 'succeeded' }),
      ]);
      expect(clock.pending()).toEqual([]);
    }
  });

  it('runs 60 s after start, then daily, when PRICE_REFRESH_MINUTES > 0', async () => {
    const clock = manualClock(NOW);
    const h = setup({ mode: 'fake', clock, priceRefreshMinutes: 60 });
    h.scheduler.start();
    expect(clock.pending()).toEqual([{ ms: DIVIDENDS_INITIAL_DELAY_MS }]);
    expect(DIVIDENDS_INITIAL_DELAY_MS).toBe(60_000);
    expect(h.dividends.status().nextRefreshAt).toBe(
      new Date(Date.parse(NOW) + 60_000).toISOString(),
    );
    clock.fire();
    await vi.waitFor(() =>
      expect(h.scheduler.lastRun('dividends')).toMatchObject({
        trigger: 'schedule',
        status: 'succeeded',
      }),
    );
    await vi.waitFor(() => expect(clock.pending()).toEqual([{ ms: DIVIDENDS_INTERVAL_MS }]));
    expect(DIVIDENDS_INTERVAL_MS).toBe(24 * 3_600_000);
  });

  it('uses the daily interval in live mode too (not the price interval)', async () => {
    const clock = manualClock(NOW);
    const h = setup({ mode: 'live', clock, priceRefreshMinutes: 5 });
    h.scheduler.start();
    expect(clock.pending()).toEqual([{ ms: DIVIDENDS_INITIAL_DELAY_MS }]);
    expect(dividendRuns(h)).toHaveLength(0);
    clock.fire();
    await vi.waitFor(() => expect(clock.pending()).toEqual([{ ms: DIVIDENDS_INTERVAL_MS }]));
    expect(dividendRuns(h)).toEqual([
      expect.objectContaining({ trigger: 'schedule', status: 'succeeded' }),
    ]);
    expect(eventCalls(h.calls)).toHaveLength(4);
  });
});
