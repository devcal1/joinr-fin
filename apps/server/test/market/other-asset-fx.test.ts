// Stage 4 price-job additions for other assets (stage-4.md §4.6, §7.5 step 2): the assets'
// currencies join the extra FX, and the purchase-date FX backfill (target selection, per-run cap,
// one request per (currency, date), once-a-day retries, the shared cool-down, a 429 stop, the run
// deadline, the identity check, origin and user rates untouched, GBX ÷ 100, the closes in the
// history), the FX-closes clients `buildProviders` builds (fake, live, off), and the job detail and
// status. Generic assets and values only; every request goes to a mocked fetch.
import type { FxRateSource, MarketDataMode } from '@joinr/schema';
import { marketQuoteHistory, marketQuotes, otherAssets, type JoinrDb } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { and, eq, like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FX_BACKFILL_MAX_PER_RUN,
  FxBackfillAttempts,
  purchaseFxRateFrom,
  selectFxBackfillTargets,
} from '../../src/market/fxHistory';
import { createFakeProvider, fakeFxClose } from '../../src/market/providers/fake';
import { BROWSER_USER_AGENT } from '../../src/market/providers/http';
import { createYahooFxClosesClient, createYahooProvider } from '../../src/market/providers/yahoo';
import { Cooldowns, runRefresh, type Providers } from '../../src/market/refresh';
import { createService } from '../../src/market/service';
import { MarketDataDisabledError } from '../../src/market/types';
import { createScheduler } from '../../src/scheduler/index';
import {
  hangingResponse,
  jsonResponse,
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
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ─── Mocked Yahoo and CoinGecko ─────────────────────────────────────────────────────────────────

const PRICES: Record<string, [number, string]> = {
  'AUDUSD=X': [0.65, 'USD'],
  'SI=F': [30, 'USD'],
  'GC=F': [2600, 'USD'],
  'GBPAUD=X': [2, 'AUD'],
  'EURAUD=X': [1.6, 'AUD'],
};

function priceResponse(url: URL): Response {
  const symbol = yahooSymbolOf(url);
  const [price, currency] = PRICES[symbol] ?? [10, 'AUD'];
  return jsonResponse(yahooChart({ symbol, price, currency, time: MARKET_TIME }));
}

function coinGeckoResponse(url: URL): Response {
  const ids = (url.searchParams.get('ids') ?? '').split(',');
  return jsonResponse(
    Object.fromEntries(ids.map((id) => [id, { aud: 100, last_updated_at: unix(MARKET_TIME) }])),
  );
}

/** Base closes (AUD per unit); a day's close is base + day of month ÷ 1000. */
const CROSS: Record<string, number> = { USD: 1.5, GBP: 2, EUR: 1.6 };

type Bar = [date: string, close: number];

/** A daily FX chart body: each bar at 00:00 London (BST: 23:00 UTC the day before). */
function fxChart(symbol: string, bars: Bar[]): unknown {
  const bst = (date: string) => unix(`${date}T00:00:00.000Z`) - 3600;
  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'AUD',
            symbol,
            exchangeName: 'CCY',
            instrumentType: 'CURRENCY',
            exchangeTimezoneName: 'Europe/London',
            gmtoffset: 3600,
            regularMarketPrice: bars.at(-1)?.[1] ?? 1,
            regularMarketTime: unix(MARKET_TIME),
          },
          timestamp: bars.map(([d]) => bst(d)),
          indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
        },
      ],
      error: null,
    },
  };
}

const isoOfUnix = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

/** The purchase date a backfill request is for (`period2` is the day after it). */
function requestedDate(url: URL): string {
  return isoOfUnix(Number(url.searchParams.get('period2')) - 86_400);
}

/** Like Yahoo: weekday closes from period1 up to (not including) period2. */
function fxClosesResponse(url: URL): Response {
  const symbol = yahooSymbolOf(url);
  const base = CROSS[symbol.slice(0, 3)];
  if (base === undefined || !symbol.endsWith('AUD=X')) {
    return jsonResponse(yahooNotFound(), 404);
  }
  const from = Number(url.searchParams.get('period1'));
  const to = Number(url.searchParams.get('period2'));
  const bars: Bar[] = [];
  for (let t = from; t < to; t += 86_400) {
    const date = isoOfUnix(t);
    const day = new Date(t * 1000).getUTCDay();
    if (day !== 0 && day !== 6) bars.push([date, base + Number(date.slice(8)) / 1000]);
  }
  return jsonResponse(fxChart(symbol, bars));
}

type FxHandler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

function handler(fx: FxHandler = fxClosesResponse): FetchHandler {
  return (url, init) => {
    if (url.host === 'api.coingecko.com') return coinGeckoResponse(url);
    if (url.searchParams.has('period1')) return fx(url, init);
    return priceResponse(url);
  };
}

// ─── Database helpers ───────────────────────────────────────────────────────────────────────────

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

let nextSort = 100;

function addAsset(
  db: JoinrDb,
  o: {
    currency: string;
    purchaseDate?: string | null;
    rate?: string | null;
    source?: FxRateSource | null;
    fxDate?: string | null;
    origin?: 'app' | 'import';
    sheetRef?: string | null;
  },
): number {
  return db
    .insert(otherAssets)
    .values({
      description: 'Example print',
      units: '2',
      currency: o.currency,
      purchaseDate: o.purchaseDate === undefined ? '2026-06-13' : o.purchaseDate,
      unitCost: '100',
      priceSource: 'manual',
      sortOrder: nextSort++,
      origin: o.origin ?? 'app',
      sheetRef: o.sheetRef ?? null,
      purchaseFxRate: o.rate ?? null,
      purchaseFxSource: o.source ?? null,
      purchaseFxDate: o.fxDate ?? null,
    })
    .returning({ id: otherAssets.id })
    .get().id;
}

function asset(db: JoinrDb, id: number) {
  return db.select().from(otherAssets).where(eq(otherAssets.id, id)).get();
}

function historyRows(db: JoinrDb, seriesId: string) {
  return db
    .select()
    .from(marketQuoteHistory)
    .where(eq(marketQuoteHistory.seriesId, seriesId))
    .orderBy(marketQuoteHistory.date)
    .all();
}

// ─── runRefresh harness (live Yahoo clients on a mocked fetch) ──────────────────────────────────

function harness(o: { fx?: FxHandler; withFxCloses?: boolean } = {}) {
  const clock = settableClock(NOW);
  const testDb = seededDb(clock.now());
  let fx: FxHandler = o.fx ?? fxClosesResponse;
  const { fetchImpl, calls } = mockFetch(handler((url, init) => fx(url, init)));
  const now = () => clock.now();
  const cooldowns = new Cooldowns();
  const providers: Providers = {
    yahoo: createYahooProvider({ fetchImpl, sleep: noSleep, now, spacingMs: 0 }),
    coingecko: createFakeProvider({ now }),
  };
  if (o.withFxCloses !== false) {
    providers.fxCloses = createYahooFxClosesClient({
      fetchImpl,
      sleep: noSleep,
      now,
      spacingMs: 0,
    });
  }
  const run = (signal: AbortSignal = new AbortController().signal) =>
    runRefresh({
      db: testDb.db,
      providers,
      cooldowns,
      now,
      sleep: noSleep,
      signal,
      log: silentLogger(),
    });
  return {
    db: testDb.db,
    clock,
    calls,
    cooldowns,
    run,
    setFx(next: FxHandler) {
      fx = next;
    },
    /** The backfill's requests (the price requests use `range`, not `period1`). */
    fxCalls: () => calls.filter((c) => c.url.searchParams.has('period1')),
    priceSymbols: () =>
      calls
        .filter((c) => c.url.host !== 'api.coingecko.com' && !c.url.searchParams.has('period1'))
        .map((c) => yahooSymbolOf(c.url)),
  };
}

// ─── The job's extra FX ─────────────────────────────────────────────────────────────────────────

describe('other assets in the extra FX list', () => {
  it('refreshes FX_<CCY>AUD for every other-asset currency (GBX → GBP; not AUD or USD)', async () => {
    const h = harness();
    addAsset(h.db, { currency: 'GBX', purchaseDate: null });
    addAsset(h.db, { currency: 'EUR', purchaseDate: null });
    addAsset(h.db, { currency: 'USD', purchaseDate: null });
    addAsset(h.db, { currency: 'AUD', purchaseDate: null });
    const outcome = await h.run();
    const symbols = h.priceSymbols();
    expect(symbols).toContain('GBPAUD=X');
    expect(symbols).toContain('EURAUD=X');
    expect(symbols).toContain('AUDUSD=X');
    expect(symbols).not.toContain('USDAUD=X');
    expect(symbols).not.toContain('AUDAUD=X');
    expect(symbols.filter((s) => s === 'GBPAUD=X')).toHaveLength(1);
    const quote = (id: string) =>
      h.db.select().from(marketQuotes).where(eq(marketQuotes.seriesId, id)).get();
    expect(quote('FX_GBPAUD')).toMatchObject({ value: '2', source: 'yahoo', lastStatus: 'ok' });
    expect(quote('FX_EURAUD')).toMatchObject({ value: '1.6', source: 'yahoo' });
    expect(quote('FX_USDAUD')).toBeUndefined();
    // Undated assets need no purchase rate: nothing to backfill.
    expect(h.fxCalls()).toHaveLength(0);
    expect(outcome.fxBackfill).toEqual({ requested: 0, filled: 0, failed: 0, skipped: 0 });
  });

  it('fetches no extra FX without foreign-currency assets', async () => {
    const h = harness();
    addAsset(h.db, { currency: 'AUD' });
    await h.run();
    expect(h.priceSymbols().filter((s) => s.endsWith('AUD=X'))).toEqual([]);
  });
});

// ─── The backfill ───────────────────────────────────────────────────────────────────────────────

describe('purchase-date FX backfill', () => {
  it('fills each rate from the last close on or before the purchase date, one request per pair', async () => {
    const h = harness();
    // 13/06/2026 is a Saturday: Friday's close applies.
    const usdImported = addAsset(h.db, {
      currency: 'USD',
      purchaseDate: '2026-06-13',
      origin: 'import',
      sheetRef: 'Other Assets!F9',
    });
    const usdApp = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    const gbp = addAsset(h.db, { currency: 'GBP', purchaseDate: '2026-06-10' });
    const gbx = addAsset(h.db, { currency: 'GBX', purchaseDate: '2026-06-10' });

    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 4, filled: 4, failed: 0, skipped: 0 });

    // One request per distinct (currency, date): USD 13/06, and GBP 10/06 for both GBP and GBX.
    const fx = h.fxCalls();
    expect(fx.map((c) => yahooSymbolOf(c.url))).toEqual(['USDAUD=X', 'GBPAUD=X']);
    expect(fx[0]!.url.searchParams.get('period1')).toBe(String(unix('2026-06-03T00:00:00.000Z')));
    expect(fx[0]!.url.searchParams.get('period2')).toBe(String(unix('2026-06-14T00:00:00.000Z')));
    expect((fx[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe(BROWSER_USER_AGENT);

    expect(asset(h.db, usdImported)).toMatchObject({
      purchaseFxRate: '1.512',
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-12',
      origin: 'import',
      sheetRef: 'Other Assets!F9',
    });
    expect(asset(h.db, usdApp)).toMatchObject({
      purchaseFxRate: '1.512',
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-12',
      origin: 'app',
    });
    expect(asset(h.db, gbp)).toMatchObject({
      purchaseFxRate: '2.01',
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-10',
    });
    // GBX stores the per-penny rate.
    expect(asset(h.db, gbx)).toMatchObject({
      purchaseFxRate: '0.0201',
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-10',
      currency: 'GBX',
    });

    // The fetched closes are kept as FX_<CCY>AUD history (exchange-local dates).
    const usd = historyRows(h.db, 'FX_USDAUD');
    expect(usd.map((r) => r.date)).toEqual([
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
    ]);
    expect(usd.at(-1)).toEqual({
      seriesId: 'FX_USDAUD',
      date: '2026-06-12',
      value: '1.512',
      source: 'yahoo',
      fetchedAt: NOW,
    });
    const gbpJune = historyRows(h.db, 'FX_GBPAUD').filter((r) => r.date < '2026-07-01');
    expect(gbpJune).toHaveLength(8);
    expect(gbpJune.at(-1)).toMatchObject({ date: '2026-06-10', value: '2.01' });

    // Filled rates leave nothing for the next run.
    const again = await h.run();
    expect(again.fxBackfill).toEqual({ requested: 0, filled: 0, failed: 0, skipped: 0 });
    expect(h.fxCalls()).toHaveLength(2);
  });

  it('leaves AUD, undated, already-rated and user-rated assets alone', async () => {
    const h = harness();
    const aud = addAsset(h.db, { currency: 'AUD' });
    const undated = addAsset(h.db, { currency: 'USD', purchaseDate: null });
    const imported = addAsset(h.db, {
      currency: 'USD',
      rate: '1.4',
      source: 'import',
      fxDate: '2026-06-13',
      origin: 'import',
    });
    const typed = addAsset(h.db, {
      currency: 'EUR',
      rate: '1.45',
      source: 'user',
      fxDate: '2026-06-13',
    });
    const userNoRate = addAsset(h.db, { currency: 'USD', source: 'user' });
    const before = [aud, undated, imported, typed, userNoRate].map((id) => asset(h.db, id));

    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 0, filled: 0, failed: 0, skipped: 0 });
    expect(h.fxCalls()).toHaveLength(0);
    expect([aud, undated, imported, typed, userNoRate].map((id) => asset(h.db, id))).toEqual(
      before,
    );
  });

  it('chooses the least recently attempted first (never attempted, then id order)', () => {
    const h = harness();
    const ids = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'].map((d) =>
      addAsset(h.db, { currency: 'USD', purchaseDate: d }),
    );
    const gbx = addAsset(h.db, { currency: 'GBX', purchaseDate: '2026-06-02' });
    const attempts = new FxBackfillAttempts();
    const t0 = new Date(NOW);
    attempts.record('USD', '2026-06-01', new Date(t0.getTime() + 2_000));
    attempts.record('USD', '2026-06-02', new Date(t0.getTime() + 1_000));
    const targets = selectFxBackfillTargets(h.db, attempts);
    expect(targets.map((t) => t.id)).toEqual([ids[2], ids[3], gbx, ids[1], ids[0]]);
    expect(targets.find((t) => t.id === gbx)).toEqual({
      id: gbx,
      currency: 'GBX',
      purchaseDate: '2026-06-02',
      fetchCcy: 'GBP',
    });
    expect(selectFxBackfillTargets(h.db, attempts, 2).map((t) => t.id)).toEqual([ids[2], ids[3]]);
  });

  it(`caps a run at ${FX_BACKFILL_MAX_PER_RUN} assets and retries a pair at most once a day`, async () => {
    const h = harness({ fx: () => jsonResponse(yahooNotFound(), 404) });
    const dates = Array.from({ length: 12 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
    const ids = dates.map((d) => addAsset(h.db, { currency: 'USD', purchaseDate: d }));
    const requested = () => h.fxCalls().map((c) => requestedDate(c.url));

    // Run 1: the first ten by id, all failing.
    expect((await h.run()).fxBackfill).toEqual({
      requested: 10,
      filled: 0,
      failed: 10,
      skipped: 0,
    });
    expect(requested()).toEqual(dates.slice(0, 10));

    // Run 2 (an hour later): the two never attempted go first; the others were tried today.
    h.clock.advance(HOUR_MS);
    expect((await h.run()).fxBackfill).toEqual({ requested: 10, filled: 0, failed: 2, skipped: 8 });
    expect(requested().slice(10)).toEqual(dates.slice(10));

    // Run 3: every pair was tried within the day: skipped, no request, nothing failed.
    h.clock.advance(HOUR_MS);
    expect((await h.run()).fxBackfill).toEqual({
      requested: 10,
      filled: 0,
      failed: 0,
      skipped: 10,
    });
    expect(h.fxCalls()).toHaveLength(12);

    // A day after run 1, its pairs are retried (and now answer).
    h.setFx(fxClosesResponse);
    h.clock.set(new Date(Date.parse(NOW) + DAY_MS).toISOString());
    expect((await h.run()).fxBackfill).toEqual({
      requested: 10,
      filled: 10,
      failed: 0,
      skipped: 0,
    });
    expect(requested().slice(12)).toEqual(dates.slice(0, 10));
    expect(asset(h.db, ids[0]!)).toMatchObject({ purchaseFxDate: '2026-06-01' });

    // A day after run 2, the last two.
    h.clock.set(new Date(Date.parse(NOW) + DAY_MS + HOUR_MS).toISOString());
    expect((await h.run()).fxBackfill).toEqual({ requested: 2, filled: 2, failed: 0, skipped: 0 });
    expect(requested().slice(22)).toEqual(dates.slice(10));
    // 06/06 and 07/06/2026 are a weekend: Friday's close.
    expect(asset(h.db, ids[6]!)).toMatchObject({
      purchaseFxRate: '1.505',
      purchaseFxDate: '2026-06-05',
    });
    expect(asset(h.db, ids[11]!)).toMatchObject({
      purchaseFxRate: '1.512',
      purchaseFxDate: '2026-06-12',
    });
  });

  it('fills a second asset on a pair that already gave a rate that day (a rate spends no retry)', async () => {
    const h = harness();
    const first = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    expect((await h.run()).fxBackfill).toEqual({ requested: 1, filled: 1, failed: 0, skipped: 0 });

    // An hour later another item bought the same day in the same currency (or the first one
    // deleted and added again) is filled too.
    h.clock.advance(HOUR_MS);
    const second = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    expect((await h.run()).fxBackfill).toEqual({ requested: 1, filled: 1, failed: 0, skipped: 0 });
    expect(asset(h.db, second)).toMatchObject({
      purchaseFxRate: asset(h.db, first)!.purchaseFxRate,
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-10',
    });
    expect(h.fxCalls()).toHaveLength(2);
  });

  it('waits out the shared Yahoo cool-down without spending the daily retry', async () => {
    const h = harness();
    const a = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    const b = addAsset(h.db, { currency: 'EUR', purchaseDate: '2026-06-11' });
    h.cooldowns.start('yahoo', h.clock.now());

    expect((await h.run()).fxBackfill).toEqual({ requested: 2, filled: 0, failed: 0, skipped: 2 });
    expect(h.fxCalls()).toHaveLength(0);
    expect(asset(h.db, a)!.purchaseFxRate).toBeNull();

    h.clock.advance(16 * 60_000);
    expect((await h.run()).fxBackfill).toEqual({ requested: 2, filled: 2, failed: 0, skipped: 0 });
    expect(asset(h.db, a)).toMatchObject({ purchaseFxRate: '1.51', purchaseFxSource: 'market' });
    expect(asset(h.db, b)).toMatchObject({ purchaseFxRate: '1.611', purchaseFxSource: 'market' });
  });

  it('stops at a 429, starts the shared cool-down and retries after it', async () => {
    const h = harness({ fx: () => jsonResponse({}, 429, { 'retry-after': '600' }) });
    for (const d of ['2026-06-08', '2026-06-09', '2026-06-10']) {
      addAsset(h.db, { currency: 'USD', purchaseDate: d });
    }
    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 3, filled: 0, failed: 0, skipped: 3 });
    expect(h.fxCalls()).toHaveLength(1); // the backfill stopped at the first 429
    expect(h.cooldowns.isCooling('yahoo', h.clock.now())).toBe(true);
    expect(h.cooldowns.untilIso('yahoo')).toBe(new Date(Date.parse(NOW) + 600_000).toISOString());

    // While cooling, nothing is requested.
    h.setFx(fxClosesResponse);
    h.clock.advance(60_000);
    expect((await h.run()).fxBackfill).toMatchObject({ skipped: 3 });
    expect(h.fxCalls()).toHaveLength(1);

    // After the cool-down every pair is tried (the 429 did not count as the day's attempt).
    h.clock.advance(600_000);
    expect((await h.run()).fxBackfill).toEqual({ requested: 3, filled: 3, failed: 0, skipped: 0 });
    expect(h.fxCalls()).toHaveLength(4);
  });

  it('stops at the run deadline and retries the pairs on the next run', async () => {
    const deadline = new AbortController();
    const h = harness({
      fx: (_url, init) => {
        deadline.abort(); // the deadline passes while the first request is in flight
        return hangingResponse(init);
      },
    });
    const a = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-11' });

    const outcome = await h.run(deadline.signal);
    expect(outcome.aborted).toBe(true);
    expect(outcome.fxBackfill).toEqual({ requested: 2, filled: 0, failed: 0, skipped: 2 });
    expect(h.fxCalls()).toHaveLength(1);
    expect(asset(h.db, a)!.purchaseFxRate).toBeNull();
    // What succeeded before the deadline was still written.
    expect(
      h.db.select().from(marketQuotes).where(eq(marketQuotes.seriesId, 'AUDUSD')).get()!.fetchedAt,
    ).toBe(NOW);

    h.setFx(fxClosesResponse);
    expect((await h.run()).fxBackfill).toEqual({ requested: 2, filled: 2, failed: 0, skipped: 0 });
    expect(h.fxCalls()).toHaveLength(3);
  });

  it('writes only rows unchanged since the run chose them (identity check)', async () => {
    const h = harness();
    const recurrency = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-12' });
    const typed = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-11' });
    const redated = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    const kept = addAsset(h.db, {
      currency: 'USD',
      purchaseDate: '2026-06-09',
      origin: 'import',
      sheetRef: 'Other Assets!F12',
    });
    const deleted = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-08' });

    // Each edit lands while that asset's request is in flight (a CLI import or a page save).
    h.setFx((url) => {
      switch (requestedDate(url)) {
        case '2026-06-12':
          h.db
            .update(otherAssets)
            .set({ currency: 'EUR' })
            .where(eq(otherAssets.id, recurrency))
            .run();
          break;
        case '2026-06-11':
          h.db
            .update(otherAssets)
            .set({ purchaseFxRate: '1.44', purchaseFxSource: 'user', purchaseFxDate: '2026-06-11' })
            .where(eq(otherAssets.id, typed))
            .run();
          break;
        case '2026-06-10':
          h.db
            .update(otherAssets)
            .set({ purchaseDate: '2026-06-05' })
            .where(eq(otherAssets.id, redated))
            .run();
          break;
        case '2026-06-08':
          h.db.delete(otherAssets).where(eq(otherAssets.id, deleted)).run();
          break;
      }
      return fxClosesResponse(url);
    });

    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 5, filled: 1, failed: 0, skipped: 4 });
    expect(asset(h.db, recurrency)).toMatchObject({
      currency: 'EUR',
      purchaseFxRate: null,
      purchaseFxSource: null,
    });
    expect(asset(h.db, typed)).toMatchObject({
      purchaseFxRate: '1.44',
      purchaseFxSource: 'user',
      purchaseFxDate: '2026-06-11',
    });
    expect(asset(h.db, redated)).toMatchObject({
      purchaseDate: '2026-06-05',
      purchaseFxRate: null,
    });
    expect(asset(h.db, kept)).toMatchObject({
      purchaseFxRate: '1.509',
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-09',
      origin: 'import',
      sheetRef: 'Other Assets!F12',
    });
    expect(asset(h.db, deleted)).toBeUndefined();

    // The changed rows are new pairs: the next run fills them; the typed rate stays.
    h.setFx(fxClosesResponse);
    expect((await h.run()).fxBackfill).toEqual({ requested: 2, filled: 2, failed: 0, skipped: 0 });
    expect(asset(h.db, recurrency)).toMatchObject({
      purchaseFxRate: '1.612',
      purchaseFxDate: '2026-06-12',
    });
    expect(asset(h.db, redated)).toMatchObject({
      purchaseFxRate: '1.505',
      purchaseFxDate: '2026-06-05',
    });
    expect(asset(h.db, typed)!.purchaseFxRate).toBe('1.44');
  });

  it('fails a pair with no close on or before the purchase date, and keeps what it fetched', async () => {
    const h = harness({
      fx: (url) =>
        yahooSymbolOf(url) === 'USDAUD=X'
          ? jsonResponse(fxChart('USDAUD=X', [['2026-06-15', 1.515]]))
          : jsonResponse(fxChart(yahooSymbolOf(url), [])),
    });
    const usd = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    const eur = addAsset(h.db, { currency: 'EUR', purchaseDate: '2026-06-13' });
    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 2, filled: 0, failed: 2, skipped: 0 });
    expect(asset(h.db, usd)!.purchaseFxRate).toBeNull();
    expect(asset(h.db, eur)!.purchaseFxRate).toBeNull();
    expect(historyRows(h.db, 'FX_USDAUD')).toEqual([
      {
        seriesId: 'FX_USDAUD',
        date: '2026-06-15',
        value: '1.515',
        source: 'yahoo',
        fetchedAt: NOW,
      },
    ]);
  });

  it('is skipped when the providers have no FX-closes client (Stage 1–3 literals)', async () => {
    const h = harness({ withFxCloses: false });
    const a = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-10' });
    const outcome = await h.run();
    expect(outcome.fxBackfill).toEqual({ requested: 0, filled: 0, failed: 0, skipped: 0 });
    expect(h.fxCalls()).toHaveLength(0);
    expect(asset(h.db, a)!.purchaseFxRate).toBeNull();
    expect(
      h.db.select().from(marketQuoteHistory).where(like(marketQuoteHistory.seriesId, 'FX_%')).all(),
    ).toEqual([]);
  });
});

// ─── Through the service: buildProviders, the job detail and status ─────────────────────────────

function serviceHarness(o: { mode?: MarketDataMode; fx?: FxHandler; runDeadlineMs?: number } = {}) {
  const clock = settableClock(NOW);
  const testDb = seededDb(clock.now());
  const { fetchImpl, calls } = mockFetch(handler(o.fx));
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
    ...(o.runDeadlineMs === undefined ? {} : { runDeadlineMs: o.runDeadlineMs }),
  });
  return {
    db: testDb.db,
    calls,
    market,
    lastRun: () => scheduler.lastRun('prices')!,
    fxCalls: () => calls.filter((c) => c.url.searchParams.has('period1')),
  };
}

describe('the price job with the backfill', () => {
  it('mode fake: fills rates with the fake close at the purchase date, without the network', async () => {
    const h = serviceHarness({ mode: 'fake' });
    const usd = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    const gbx = addAsset(h.db, { currency: 'GBX', purchaseDate: '2026-06-10' });
    await h.market.refresh();
    expect(h.calls).toHaveLength(0);
    expect(asset(h.db, usd)).toMatchObject({
      purchaseFxRate: fakeFxClose('USD'),
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-13',
    });
    expect(fakeFxClose('USD')).toBe('1.53846153846');
    expect(asset(h.db, gbx)).toMatchObject({
      purchaseFxRate: purchaseFxRateFrom(fakeFxClose('GBP'), 'GBX'),
      purchaseFxSource: 'market',
      purchaseFxDate: '2026-06-10',
    });
    const run = h.lastRun();
    expect(run.status).toBe('succeeded');
    expect(run.detail).toMatchObject({
      fxBackfill: { requested: 2, filled: 2, failed: 0, skipped: 0 },
    });
    expect(
      h.db
        .select()
        .from(marketQuoteHistory)
        .where(
          and(
            eq(marketQuoteHistory.seriesId, 'FX_USDAUD'),
            eq(marketQuoteHistory.date, '2026-06-13'),
          ),
        )
        .get(),
    ).toMatchObject({ value: fakeFxClose('USD'), source: 'fake' });
  });

  it('mode live: builds the Yahoo FX-closes client and reports the backfill in the detail', async () => {
    const h = serviceHarness();
    const usd = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    await h.market.refresh();
    const fx = h.fxCalls();
    expect(fx).toHaveLength(1);
    expect(fx[0]!.url.host).toBe('query1.finance.yahoo.com');
    expect(yahooSymbolOf(fx[0]!.url)).toBe('USDAUD=X');
    expect((fx[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe(BROWSER_USER_AGENT);
    expect(asset(h.db, usd)).toMatchObject({ purchaseFxRate: '1.512', purchaseFxSource: 'market' });
    const run = h.lastRun();
    expect(run.status).toBe('succeeded');
    expect(run.detail).toMatchObject({
      failed: 0,
      series: { failed: 0 },
      fxBackfill: { requested: 1, filled: 1, failed: 0, skipped: 0 },
    });
  });

  it('a backfill failure alone makes the run partial; a pair skipped for the day does not', async () => {
    const h = serviceHarness({ fx: () => jsonResponse(yahooNotFound(), 404) });
    addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    await h.market.refresh();
    let run = h.lastRun();
    expect(run.status).toBe('partial');
    expect(run.detail).toMatchObject({
      failed: 0,
      series: { failed: 0 },
      fxBackfill: { requested: 1, filled: 0, failed: 1, skipped: 0 },
    });

    await h.market.refresh();
    run = h.lastRun();
    expect(run.status).toBe('succeeded');
    expect(run.detail).toMatchObject({
      fxBackfill: { requested: 1, filled: 0, failed: 0, skipped: 1 },
    });
    expect(h.fxCalls()).toHaveLength(1);
  });

  it('a deadline during the backfill leaves the run partial and the pair unattempted', async () => {
    const h = serviceHarness({
      fx: (_url, init) => hangingResponse(init),
      runDeadlineMs: 500,
    });
    const usd = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    await h.market.refresh();
    const run = h.lastRun();
    expect(run).toMatchObject({ status: 'partial', error: 'Run deadline reached' });
    expect(run.detail).toMatchObject({
      deadlineHit: true,
      fxBackfill: { requested: 1, filled: 0, failed: 0, skipped: 1 },
    });
    expect(asset(h.db, usd)!.purchaseFxRate).toBeNull();
  });

  it('mode off: nothing runs and the rates stay null', async () => {
    const h = serviceHarness({ mode: 'off' });
    const usd = addAsset(h.db, { currency: 'USD', purchaseDate: '2026-06-13' });
    await expect(h.market.refresh()).rejects.toBeInstanceOf(MarketDataDisabledError);
    expect(h.calls).toHaveLength(0);
    expect(asset(h.db, usd)).toMatchObject({ purchaseFxRate: null, purchaseFxSource: null });
    expect(h.db.select().from(marketQuoteHistory).all()).toEqual([]);
  });
});
