// Stage 9 provider requests (stage-9.md §5.1, §5.2): the one-day and two-day five-minute charts,
// a managed fund's daily request, the five-day fallback (on "No price", on chart.error and on a
// non-2xx other than 429/403) and CoinGecko's day chart. Injected fetch; made-up symbols.
process.env.TZ = 'Australia/Melbourne';

import { describe, expect, it } from 'vitest';
import {
  coinGeckoDayChartUrl,
  createCoinGeckoProvider,
  parseMarketChart,
} from '../../src/market/providers/coingecko';
import { createYahooProvider, yahooDailyChartUrl } from '../../src/market/providers/yahoo';
import { chartBody, chartErrorBody, everyMinutes, sec } from './dayHelpers';
import { jsonResponse, mockFetch, noSleep, yahooSymbolOf, type FetchHandler } from './helpers';

const NOW = new Date('2030-09-12T05:20:00.000Z');
const run = () => new AbortController().signal;

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
});

function yahoo(handler: FetchHandler) {
  const { fetchImpl, calls } = mockFetch(handler);
  const sleeps: number[] = [];
  const provider = createYahooProvider({
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    spacingMs: 250,
  });
  return { provider, calls, sleeps };
}

const rangeOf = (url: URL) =>
  `${url.searchParams.get('range')}/${url.searchParams.get('interval')}`;

const session = everyMinutes('2030-09-12T00:00:00Z', '2030-09-12T05:15:00Z');
const listing = () =>
  chartBody({
    symbol: 'EXA.AX',
    timestamps: session,
    closes: session.map(() => 50.5),
    chartPreviousClose: 50,
    exchangeTimezoneName: 'Australia/Sydney',
    tradingPeriods: [['2030-09-12T00:00:00Z', '2030-09-12T06:12:00Z']],
  });
const daily = () =>
  chartBody({
    symbol: 'EXA.AX',
    timestamps: ['2030-09-11T00:00:00Z', '2030-09-12T00:00:00Z'],
    closes: [50, 50.5],
    dataGranularity: '1d',
  });

describe('Yahoo five-minute requests', () => {
  it('fetches a listing at 1d/5m and attaches its day', async () => {
    const { provider, calls } = yahoo(() => jsonResponse(listing()));
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], run());
    expect(calls.map((c) => rangeOf(c.url))).toEqual(['1d/5m']);
    expect(res.quotes[0]!.day).toMatchObject({
      sessionDate: '2030-09-12',
      previousClose: '50',
      granularity: '5m',
    });
    expect(res.quotes[0]!.bars).toBeUndefined();
  });

  it('fetches AUDUSD=X at 2d/5m: the previous close from meta.previousClose, every bar attached', async () => {
    const two = [
      ...everyMinutes('2030-09-10T23:00:00Z', '2030-09-11T22:55:00Z', 15),
      ...everyMinutes('2030-09-11T23:00:00Z', '2030-09-12T05:15:00Z', 15),
    ];
    const body = chartBody({
      symbol: 'AUDUSD=X',
      currency: 'USD',
      timestamps: two,
      closes: two.map(() => 0.65),
      chartPreviousClose: 0.63, // the close before the two-day window
      previousClose: 0.64, // the one-day previous close
      exchangeTimezoneName: 'Europe/London',
      tradingPeriods: [
        ['2030-09-10T23:00:00Z', '2030-09-11T22:59:00Z'],
        ['2030-09-11T23:00:00Z', '2030-09-12T22:59:00Z'],
      ],
    });
    const { provider, calls } = yahoo(() => jsonResponse(body));
    const res = await provider.fetchQuotes([{ key: 'AUDUSD', symbol: 'AUDUSD=X' }], run());
    expect(calls.map((c) => rangeOf(c.url))).toEqual(['2d/5m']);
    const q = res.quotes[0]!;
    expect(q.day!.previousClose).toBe('0.64');
    expect(q.day!.sessionDate).toBe('2030-09-12');
    expect(q.day!.points[0]![0]).toBe(sec('2030-09-11T23:00:00Z'));
    expect(q.bars).toHaveLength(two.length);
  });
});

describe('daily requests (managed funds, owner review O8)', () => {
  it('fetches the fund once at 5d/1d (never 5m), its day from the last two finite NAVs', async () => {
    const body = chartBody({
      symbol: '0PEXAMPLE1',
      timestamps: [
        '2030-09-06T00:00:00Z',
        '2030-09-09T00:00:00Z',
        '2030-09-10T00:00:00Z',
        '2030-09-11T00:00:00Z',
        '2030-09-12T00:00:00Z',
      ],
      closes: [null, 1.5, null, 1.515, null],
      chartPreviousClose: 1.4,
      dataGranularity: '1d',
      exchangeTimezoneName: 'Australia/Sydney',
      price: 1.515,
      marketTime: '2030-09-11T00:00:00Z',
    });
    const { provider, calls } = yahoo(() => jsonResponse(body));
    const res = await provider.fetchQuotes(
      [{ key: '7', symbol: '0PEXAMPLE1', daily: true }],
      run(),
    );
    expect(calls.map((c) => rangeOf(c.url))).toEqual(['5d/1d']);
    expect(calls[0]!.url.href).toBe(yahooDailyChartUrl('0PEXAMPLE1'));
    expect(res.quotes[0]).toMatchObject({
      price: '1.515',
      day: {
        granularity: '1d',
        sessionDate: '2030-09-11',
        previousClose: '1.5',
        points: [[sec('2030-09-11T00:00:00Z'), '1.515']],
      },
    });
  });

  it('a fund with no 5d answer fails without a five-minute retry', async () => {
    const { provider, calls } = yahoo(() => new Response('', { status: 500 }));
    const res = await provider.fetchQuotes(
      [{ key: '7', symbol: '0PEXAMPLE1', daily: true }],
      run(),
    );
    expect(calls).toHaveLength(1);
    expect(res.failures).toEqual([{ key: '7', error: 'HTTP 500', retryable: true }]);
  });
});

describe('the five-day fallback (§5.1)', () => {
  /** Answers the 5m URL with `first`, the 5d URL with a good daily chart. */
  function fallback(first: () => Response) {
    return yahoo((url) =>
      url.searchParams.get('interval') === '5m' ? first() : jsonResponse(daily()),
    );
  }

  it.each([
    [
      '"No price in response"',
      () => jsonResponse(chartBody({ symbol: 'EXA.AX', price: null, timestamps: [], closes: [] })),
    ],
    ['a chart.error', () => jsonResponse(chartErrorBody())],
    ['a 404', () => jsonResponse(chartErrorBody(), 404)],
    ['a 500', () => new Response('', { status: 500 })],
  ])('on %s: one more request at 5d/1d, spaced; its quote has no day', async (_n, first) => {
    const { provider, calls, sleeps } = fallback(first);
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], run());
    expect(calls.map((c) => rangeOf(c.url))).toEqual(['1d/5m', '5d/1d']);
    expect(sleeps).toEqual([250]);
    expect(res.failures).toEqual([]);
    expect(res.quotes).toHaveLength(1);
    expect(res.quotes[0]!.day).toBeUndefined();
    expect(res.quotes[0]!.price).toBe('50.5');
  });

  it.each([429, 403])('not on a %i (the cool-down starts as before)', async (status) => {
    const { provider, calls } = fallback(() => new Response('', { status }));
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], run());
    expect(calls).toHaveLength(1);
    expect(res.failures[0]).toMatchObject({ key: '1', rateLimited: true });
  });

  it('records the fallback’s own failure when both fail', async () => {
    const { provider } = yahoo((url) =>
      url.searchParams.get('interval') === '5m'
        ? new Response('', { status: 500 })
        : jsonResponse(chartErrorBody(), 404),
    );
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], run());
    expect(res.failures).toEqual([{ key: '1', error: 'Symbol not found', retryable: false }]);
  });

  it('a malformed answer or a timeout does not fall back', async () => {
    const { provider, calls } = yahoo(() => new Response('<html>', { status: 200 }));
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], run());
    expect(calls).toHaveLength(1);
    expect(res.failures[0]!.error).toBe('Malformed response');
  });

  it('the fallback is skipped when the run is aborted', async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = mockFetch(() => {
      controller.abort();
      return new Response('', { status: 500 });
    });
    const provider = createYahooProvider({ fetchImpl, sleep: noSleep, now: () => NOW });
    const res = await provider.fetchQuotes([{ key: '1', symbol: 'EXA.AX' }], controller.signal);
    expect(calls.map((c) => yahooSymbolOf(c.url))).toEqual(['EXA.AX']);
    expect(res.failures[0]).toMatchObject({ skipped: true });
  });
});

describe('CoinGecko day chart (§5.2)', () => {
  function cg(handler: FetchHandler) {
    const { fetchImpl, calls } = mockFetch(handler);
    return { cg: createCoinGeckoProvider({ fetchImpl, now: () => NOW }), calls };
  }

  it('asks /coins/<id>/market_chart in AUD for one day on the fixed host', async () => {
    expect(coinGeckoDayChartUrl('bitcoin')).toBe(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=aud&days=1',
    );
    expect(new URL(coinGeckoDayChartUrl('../x?y')).host).toBe('api.coingecko.com');
    const prices = [
      [1915400000000, 160000.5],
      [1915400300000, 160010],
    ];
    const { cg: client, calls } = cg(() =>
      jsonResponse({ prices, market_caps: [], total_volumes: [] }),
    );
    expect(await client.fetchDayChart('bitcoin', run())).toEqual({ ok: true, prices });
    expect(calls[0]!.url.pathname).toBe('/api/v3/coins/bitcoin/market_chart');
  });

  it('maps 429 to rate-limited (with Retry-After) and drops unusable points', async () => {
    const { cg: client } = cg(() => jsonResponse({}, 429, { 'retry-after': '60' }));
    expect(await client.fetchDayChart('bitcoin', run())).toEqual({
      ok: false,
      error: 'Rate limited',
      rateLimited: true,
      retryAfterMs: 60_000,
    });
    expect(parseMarketChart({ prices: [[1, 2], ['x', 3], [5, null], [6]] })).toEqual([[1, 2]]);
    expect(parseMarketChart({ nope: true })).toBeNull();
    const { cg: bad } = cg(() => jsonResponse({ nope: true }));
    expect(await bad.fetchDayChart('bitcoin', run())).toEqual({
      ok: false,
      error: 'Malformed response',
    });
  });
});
