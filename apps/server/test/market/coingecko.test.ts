import { describe, expect, it } from 'vitest';
import {
  coinGeckoPriceUrl,
  coinGeckoSearchUrl,
  createCoinGeckoProvider,
  pickCoinId,
} from '../../src/market/providers/coingecko';
import { hangingResponse, jsonResponse, mockFetch, unix, type FetchHandler } from './helpers';

const NOW = new Date('2026-09-24T07:00:00.000Z');
const run = () => new AbortController().signal;

function provider(handler: FetchHandler, timeoutMs?: number) {
  const { fetchImpl, calls } = mockFetch(handler);
  return { cg: createCoinGeckoProvider({ fetchImpl, now: () => NOW, timeoutMs }), calls };
}

/** A /search body shaped like the real one (generic values). */
function searchBody(coins: Array<{ id: string; symbol: string; rank: number | null }>) {
  return {
    coins: coins.map((c) => ({
      id: c.id,
      name: c.id,
      api_symbol: c.id,
      symbol: c.symbol,
      market_cap_rank: c.rank,
      thumb: 'https://example.com/t.png',
      large: 'https://example.com/l.png',
    })),
    exchanges: [],
    icos: [],
    categories: [],
    nfts: [],
  };
}

describe('URLs', () => {
  it('builds the batched price URL and the search URL on the fixed host', () => {
    expect(coinGeckoPriceUrl(['bitcoin', 'ethereum'])).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=aud&include_last_updated_at=true',
    );
    expect(coinGeckoSearchUrl('ETH')).toBe('https://api.coingecko.com/api/v3/search?query=ETH');
    const hostile = new URL(coinGeckoPriceUrl(['a&vs_currencies=usd', '../x']));
    expect(hostile.host).toBe('api.coingecko.com');
    expect(hostile.searchParams.get('vs_currencies')).toBe('aud');
    expect(new URL(coinGeckoSearchUrl('a&b=c')).searchParams.get('query')).toBe('a&b=c');
  });
});

describe('fetchQuotes', () => {
  it('reads the AUD price and last_updated_at of each id in one call', async () => {
    const { cg, calls } = provider(() =>
      jsonResponse({
        bitcoin: { aud: 150000.5, last_updated_at: unix('2026-09-24T06:59:00.000Z') },
        ethereum: { aud: 5000 },
      }),
    );
    const res = await cg.fetchQuotes(
      [
        { key: '7', symbol: 'bitcoin' },
        { key: '8', symbol: 'ethereum' },
      ],
      run(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('ids')).toBe('bitcoin,ethereum');
    expect(res.failures).toEqual([]);
    expect(res.quotes).toEqual([
      { key: '7', price: '150000.5', currency: 'AUD', asOf: '2026-09-24T06:59:00.000Z' },
      { key: '8', price: '5000', currency: 'AUD', asOf: NOW.toISOString() },
    ]);
  });

  it('fails a missing id with "Unknown CoinGecko id"', async () => {
    const { cg } = provider(() => jsonResponse({ bitcoin: { aud: 1 } }));
    const res = await cg.fetchQuotes(
      [
        { key: '7', symbol: 'bitcoin' },
        { key: '9', symbol: 'no-such-coin' },
      ],
      run(),
    );
    expect(res.quotes.map((q) => q.key)).toEqual(['7']);
    expect(res.failures).toEqual([{ key: '9', error: 'Unknown CoinGecko id', retryable: false }]);
  });

  it('splits more than 100 ids into several calls', async () => {
    const { cg, calls } = provider((url) => {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      return jsonResponse(Object.fromEntries(ids.map((id) => [id, { aud: 1 }])));
    });
    const reqs = Array.from({ length: 150 }, (_, i) => ({ key: String(i), symbol: `coin-${i}` }));
    const res = await cg.fetchQuotes(reqs, run());
    expect(calls).toHaveLength(2);
    expect(res.quotes).toHaveLength(150);
  });

  it('marks every id rate limited on a 429', async () => {
    const { cg } = provider(() =>
      jsonResponse({ status: { error_code: 429 } }, 429, { 'retry-after': '30' }),
    );
    const res = await cg.fetchQuotes([{ key: '7', symbol: 'bitcoin' }], run());
    expect(res.failures).toEqual([
      { key: '7', error: 'Rate limited', retryable: true, rateLimited: true, retryAfterMs: 30_000 },
    ]);
  });

  it('reports malformed JSON and timeouts', async () => {
    const bad = provider(() => new Response('{', { status: 200 }));
    expect((await bad.cg.fetchQuotes([{ key: '7', symbol: 'bitcoin' }], run())).failures).toEqual([
      { key: '7', error: 'Malformed response', retryable: true },
    ]);
    const slow = provider((_u, init) => hangingResponse(init), 20);
    expect((await slow.cg.fetchQuotes([{ key: '7', symbol: 'bitcoin' }], run())).failures).toEqual([
      { key: '7', error: 'Request timed out', retryable: true },
    ]);
  });
});

describe('search', () => {
  it('picks the exact symbol match with the lowest market-cap rank', () => {
    const body = searchBody([
      { id: 'ethereum-wrapped', symbol: 'WETH', rank: 20 },
      { id: 'eth-fork', symbol: 'eth', rank: 900 },
      { id: 'ethereum', symbol: 'ETH', rank: 2 },
      { id: 'eth-unranked', symbol: 'ETH', rank: null },
    ]);
    expect(pickCoinId('ETH', body)).toBe('ethereum');
  });

  it('falls back to the first match when none is ranked, and null without a match', () => {
    expect(
      pickCoinId(
        'BTC',
        searchBody([
          { id: 'btc-a', symbol: 'BTC', rank: null },
          { id: 'btc-b', symbol: 'BTC', rank: null },
        ]),
      ),
    ).toBe('btc-a');
    expect(pickCoinId('BTC', searchBody([{ id: 'x', symbol: 'XBT', rank: 1 }]))).toBeNull();
    expect(pickCoinId('BTC', { coins: 'nope' })).toBeNull();
  });

  it('searchId resolves an id, or explains why not', async () => {
    const ok = provider(() =>
      jsonResponse(searchBody([{ id: 'bitcoin', symbol: 'BTC', rank: 1 }])),
    );
    expect(await ok.cg.searchId('BTC', run())).toEqual({ ok: true, id: 'bitcoin' });
    expect(ok.calls[0]!.url.pathname).toBe('/api/v3/search');
    expect(ok.calls[0]!.url.searchParams.get('query')).toBe('BTC');

    const none = provider(() => jsonResponse(searchBody([])));
    expect(await none.cg.searchId('BTC', run())).toEqual({
      ok: false,
      error: 'No CoinGecko match for BTC',
    });

    const limited = provider(() => jsonResponse({}, 429));
    expect(await limited.cg.searchId('BTC', run())).toEqual({
      ok: false,
      error: 'Rate limited',
      rateLimited: true,
    });
  });
});
