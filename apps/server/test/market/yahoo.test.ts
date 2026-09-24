import { describe, expect, it } from 'vitest';
import {
  createYahooProvider,
  parseYahooChart,
  yahooChartUrl,
} from '../../src/market/providers/yahoo';
import {
  hangingResponse,
  jsonResponse,
  mockFetch,
  noSleep,
  yahooChart,
  yahooNotFound,
  yahooSymbolOf,
  type FetchHandler,
} from './helpers';

const NOW = new Date('2026-09-24T07:00:00.000Z');

function provider(
  handler: FetchHandler,
  extra: { timeoutMs?: number; sleep?: typeof noSleep } = {},
) {
  const { fetchImpl, calls } = mockFetch(handler);
  const yahoo = createYahooProvider({
    fetchImpl,
    sleep: extra.sleep ?? noSleep,
    now: () => NOW,
    timeoutMs: extra.timeoutMs,
  });
  return { yahoo, calls };
}

const run = () => new AbortController().signal;

describe('yahooChartUrl', () => {
  it('uses the fixed host and encodes the symbol', () => {
    expect(yahooChartUrl('ABC.AX')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/ABC.AX?range=5d&interval=1d',
    );
    expect(yahooChartUrl('SI=F')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/SI%3DF?range=5d&interval=1d',
    );
    // A hostile symbol cannot change the host or the path.
    expect(new URL(yahooChartUrl('../../evil.example/x?y=1#')).host).toBe(
      'query1.finance.yahoo.com',
    );
    expect(new URL(yahooChartUrl('../x')).pathname).toBe('/v8/finance/chart/..%2Fx');
  });
});

describe('parseYahooChart', () => {
  it('reads regularMarketPrice, currency and regularMarketTime', () => {
    expect(
      parseYahooChart(
        'k',
        yahooChart({ symbol: 'ABC.AX', price: 45.67, time: '2026-09-24T06:10:00.000Z' }),
      ),
    ).toEqual({ key: 'k', price: '45.67', currency: 'AUD', asOf: '2026-09-24T06:10:00.000Z' });
  });

  it('removes float noise from the price', () => {
    const q = parseYahooChart('k', yahooChart({ symbol: 'X', price: 0.1 + 0.2 }));
    expect(q).toMatchObject({ price: '0.3' });
  });

  it('falls back to the last non-null close with its timestamp', () => {
    const body = yahooChart({
      symbol: 'ABC.AX',
      price: null,
      timestamps: [
        '2026-09-22T06:10:00.000Z',
        '2026-09-23T06:10:00.000Z',
        '2026-09-24T06:10:00.000Z',
      ],
      closes: [10, 11, null],
    });
    expect(parseYahooChart('k', body)).toEqual({
      key: 'k',
      price: '11',
      currency: 'AUD',
      asOf: '2026-09-23T06:10:00.000Z',
    });
  });

  it('ignores a meta price without a valid market time and uses the last close', () => {
    // Degraded meta seen live for a thinly traded ASX ETF: no currency, market time 0 and a
    // meta price that disagrees with the daily bars.
    const body = yahooChart({
      symbol: 'ABC.AX',
      currency: null,
      price: 17.94,
      marketTime: 0,
      timestamps: [
        '2026-09-22T06:10:00.000Z',
        '2026-09-23T06:10:00.000Z',
        '2026-09-24T06:10:00.000Z',
      ],
      closes: [61.17, 60.62, null],
    });
    expect(parseYahooChart('k', body)).toEqual({
      key: 'k',
      price: '60.62',
      currency: 'AUD',
      asOf: '2026-09-23T06:10:00.000Z',
    });
  });

  it('infers the currency from a known exchange suffix only', () => {
    expect(parseYahooChart('k', yahooChart({ symbol: 'ABC.NZ', currency: null }))).toMatchObject({
      currency: 'NZD',
    });
    expect(parseYahooChart('k', yahooChart({ symbol: 'ABC.XX', currency: null }))).toMatchObject({
      error: 'No currency in response',
    });
  });

  it('fails when there is no price at all', () => {
    const body = yahooChart({ symbol: 'ABC.AX', price: null, closes: [null] });
    expect(parseYahooChart('k', body)).toEqual({
      key: 'k',
      error: 'No price in response',
      retryable: true,
    });
  });

  it('treats a zero or negative price as missing', () => {
    const body = yahooChart({ symbol: 'ABC.AX', price: 0, closes: [0] });
    expect(parseYahooChart('k', body)).toMatchObject({ error: 'No price in response' });
  });

  it('maps chart.error to "Symbol not found"', () => {
    expect(parseYahooChart('k', yahooNotFound())).toEqual({
      key: 'k',
      error: 'Symbol not found',
      retryable: false,
    });
  });

  it('rejects a response without a currency or with an unexpected shape', () => {
    expect(parseYahooChart('k', yahooChart({ symbol: 'X', currency: null }))).toMatchObject({
      error: 'No currency in response',
    });
    expect(parseYahooChart('k', { nope: true })).toMatchObject({ error: 'Malformed response' });
    expect(parseYahooChart('k', { chart: { result: [], error: null } })).toMatchObject({
      error: 'Symbol not found',
    });
  });
});

describe('createYahooProvider', () => {
  it('fetches each symbol with the browser-like headers and returns quotes', async () => {
    const { yahoo, calls } = provider((url) =>
      jsonResponse(yahooChart({ symbol: yahooSymbolOf(url), price: 2, currency: 'USD' })),
    );
    const res = await yahoo.fetchQuotes(
      [
        { key: 'a', symbol: 'ABC.AX' },
        { key: 'b', symbol: 'GC=F' },
      ],
      run(),
    );
    expect(res.failures).toEqual([]);
    expect(res.quotes.map((q) => [q.key, q.price, q.currency]).sort()).toEqual([
      ['a', '2', 'USD'],
      ['b', '2', 'USD'],
    ]);
    expect(calls.map((c) => yahooSymbolOf(c.url)).sort()).toEqual(['ABC.AX', 'GC=F']);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^Mozilla\/5\.0/);
    expect(headers.Accept).toBe('application/json');
    expect(calls[0]!.url.host).toBe('query1.finance.yahoo.com');
    expect(calls[0]!.url.searchParams.get('range')).toBe('5d');
    expect(calls[0]!.url.searchParams.get('interval')).toBe('1d');
  });

  it('maps a 404 to "Symbol not found" (not retryable)', async () => {
    const { yahoo } = provider(() => jsonResponse(yahooNotFound(), 404));
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'NOPE.AX' }], run());
    expect(res.failures).toEqual([{ key: 'a', error: 'Symbol not found', retryable: false }]);
  });

  it('maps a 5xx to a retryable failure', async () => {
    const { yahoo } = provider(() => new Response('oops', { status: 502 }));
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'ABC.AX' }], run());
    expect(res.failures).toEqual([{ key: 'a', error: 'HTTP 502', retryable: true }]);
  });

  it('reports malformed JSON', async () => {
    const { yahoo } = provider(() => new Response('<html>not json</html>', { status: 200 }));
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'ABC.AX' }], run());
    expect(res.failures).toEqual([{ key: 'a', error: 'Malformed response', retryable: true }]);
  });

  it('stops the batch on a 429 and returns Retry-After', async () => {
    const { yahoo, calls } = provider(() =>
      jsonResponse({ error: 'Too Many Requests' }, 429, { 'retry-after': '120' }),
    );
    const reqs = ['A.AX', 'B.AX', 'C.AX', 'D.AX', 'E.AX'].map((s, i) => ({
      key: String(i),
      symbol: s,
    }));
    const res = await yahoo.fetchQuotes(reqs, run());
    expect(res.quotes).toEqual([]);
    expect(res.failures.map((f) => f.key).sort()).toEqual(['0', '1', '2', '3', '4']);
    for (const f of res.failures) {
      expect(f).toMatchObject({ error: 'Rate limited', rateLimited: true, retryAfterMs: 120_000 });
    }
    // The two workers each sent at most one request; the rest were not sent.
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('treats a 403 as rate limited and parses an HTTP-date Retry-After', async () => {
    const retryAt = new Date(NOW.getTime() + 60_000).toUTCString();
    const { yahoo } = provider(
      () => new Response('', { status: 403, headers: { 'retry-after': retryAt } }),
    );
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'ABC.AX' }], run());
    expect(res.failures[0]).toMatchObject({ rateLimited: true, retryAfterMs: 60_000 });
  });

  it('times out a request that takes too long', async () => {
    const { yahoo } = provider((_url, init) => hangingResponse(init), { timeoutMs: 20 });
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'ABC.AX' }], run());
    expect(res.failures).toEqual([{ key: 'a', error: 'Request timed out', retryable: true }]);
  });

  it('returns skipped failures when the run signal aborts', async () => {
    const controller = new AbortController();
    const { yahoo, calls } = provider((_url, init) => {
      controller.abort();
      return hangingResponse(init);
    });
    const res = await yahoo.fetchQuotes(
      [
        { key: 'a', symbol: 'A.AX' },
        { key: 'b', symbol: 'B.AX' },
        { key: 'c', symbol: 'C.AX' },
      ],
      controller.signal,
    );
    expect(res.quotes).toEqual([]);
    expect(res.failures).toHaveLength(3);
    for (const f of res.failures) expect(f).toMatchObject({ skipped: true });
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('sends nothing when the run signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { yahoo, calls } = provider(() => jsonResponse(yahooChart({ symbol: 'X' })));
    const res = await yahoo.fetchQuotes([{ key: 'a', symbol: 'A.AX' }], controller.signal);
    expect(calls).toHaveLength(0);
    expect(res.failures).toEqual([{ key: 'a', error: 'Aborted', retryable: true, skipped: true }]);
  });

  it('keeps at most 2 requests in flight and spaces them', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let sleeps = 0;
    const { yahoo } = provider(
      async (url) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return jsonResponse(yahooChart({ symbol: yahooSymbolOf(url) }));
      },
      {
        sleep: async (ms) => {
          expect(ms).toBe(250);
          sleeps += 1;
        },
      },
    );
    const reqs = Array.from({ length: 6 }, (_, i) => ({ key: String(i), symbol: `S${i}.AX` }));
    const res = await yahoo.fetchQuotes(reqs, run());
    expect(res.quotes).toHaveLength(6);
    expect(maxInFlight).toBe(2);
    expect(sleeps).toBe(5); // every request after the first waits the spacing
  });
});
