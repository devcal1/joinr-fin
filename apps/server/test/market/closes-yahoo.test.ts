// Stage 10 Yahoo daily history (stage-10.md §5.2; the filter is FROZEN): the history URL (never
// `range=`), the closes kept (weekday bars dated before today in the exchange's zone: no live
// Saturday FX bar, no today's bar; nulls skipped), the split events, the currency and listing date,
// and the client's spacing, timeout and errors. Hand-made bodies shaped like the probes; made-up
// symbols and values.
process.env.TZ = 'Australia/Melbourne';

import { CLOSES_REQUEST_TIMEOUT_MS, CLOSES_YAHOO_SPACING_MS } from '@joinr/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createYahooHistoryClient,
  filterHistoryCloses,
  parseYahooHistory,
  parseYahooSplits,
  yahooHistoryUrl,
} from '../../src/market/providers/yahoo';
import { historyBody, sec } from './closesHelpers';
import { jsonResponse, mockFetch, yahooNotFound } from './helpers';

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2030, 10, 7).toISOString()).toBe('2030-11-06T13:00:00.000Z');
});

// Thursday 07/11/2030 14:00 Sydney (AEDT, UTC+11).
const NOW = new Date('2030-11-07T03:00:00.000Z');

describe('yahooHistoryUrl', () => {
  it('asks for daily bars and splits between two unix times, never range=', () => {
    const url = yahooHistoryUrl('EXA.AX', 1_900_000_000, 1_910_000_000);
    expect(url).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/EXA.AX?period1=1900000000&period2=1910000000&interval=1d&events=split',
    );
    expect(url).not.toContain('range=');
    expect(new URL(yahooHistoryUrl('../x', 1, 2)).host).toBe('query1.finance.yahoo.com');
    expect(yahooHistoryUrl('GC=F', 1, 2)).toContain('/chart/GC%3DF?');
    expect(() => yahooHistoryUrl('EXA.AX', 1.5, 2)).toThrow(RangeError);
  });
});

describe('parseYahooHistory (the §5.2 filter)', () => {
  it('dates ASX bars stamped 23:00Z in AEDT the next day in Sydney; drops today; skips nulls', () => {
    const body = historyBody({
      symbol: 'EXA.AX',
      bars: [
        ['2030-11-03T23:00:00Z', 10.5], // Mon 04/11 10:00 Sydney
        ['2030-11-04T23:00:00Z', null], // Tue 05/11: an ASX gap day
        ['2030-11-05T23:00:00Z', 10.7], // Wed 06/11
        ['2030-11-06T23:00:00Z', 10.8], // Thu 07/11: today's session, dropped
      ],
    });
    const parsed = parseYahooHistory(body, NOW);
    expect(parsed).toEqual({
      ok: true,
      history: {
        closes: [
          { date: '2030-11-04', close: '10.5' },
          { date: '2030-11-06', close: '10.7' },
        ],
        splits: [],
        timeZone: 'Australia/Sydney',
        currency: 'AUD',
        firstTradeDate: null,
      },
    });
  });

  it('uses close, not adjclose (dividends are not counted, D161)', () => {
    const body = historyBody({ symbol: 'EXA.AX', bars: [['2030-11-03T23:00:00Z', 20]] });
    const parsed = parseYahooHistory(body, NOW);
    expect(parsed.ok && parsed.history.closes).toEqual([{ date: '2030-11-04', close: '20' }]);
  });

  it('drops a Saturday live AUDUSD=X bar and today’s bar (London dates)', () => {
    const body = historyBody({
      symbol: 'AUDUSD=X',
      currency: 'USD',
      exchangeTimezoneName: 'Europe/London',
      bars: [
        ['2030-11-01T00:00:00Z', 0.651], // Fri 01/11
        ['2030-11-02T00:00:00Z', 0.652], // Sat 02/11: the live quote on a weekend bar
        ['2030-11-04T00:00:00Z', 0.653], // Mon 04/11
        ['2030-11-07T00:00:00Z', 0.655], // Thu 07/11: today in London
      ],
    });
    const parsed = parseYahooHistory(body, NOW);
    expect(parsed.ok && parsed.history.closes.map((c) => c.date)).toEqual([
      '2030-11-01',
      '2030-11-04',
    ]);
    expect(parsed.ok && parsed.history.currency).toBe('USD');
  });

  it("skips a fund's US-holiday nulls (a gap stays a gap)", () => {
    const body = historyBody({
      symbol: '0PEXAMPLE1',
      exchangeTimezoneName: 'America/New_York',
      bars: [
        ['2030-11-27T21:00:00Z', 1.49], // Wed 27/11 New York
        ['2030-11-28T21:00:00Z', null], // Thu 28/11: a US holiday
        ['2030-11-29T21:00:00Z', 1.5], // Fri 29/11
      ],
    });
    const parsed = parseYahooHistory(body, new Date('2030-12-03T03:00:00Z'));
    expect(parsed.ok && parsed.history.closes).toEqual([
      { date: '2030-11-27', close: '1.49' },
      { date: '2030-11-29', close: '1.5' },
    ]);
  });

  it('keeps a weekday close only when it is before today in the same zone (pure filter)', () => {
    const closes = [
      { date: '2030-11-01', close: '1' }, // Fri
      { date: '2030-11-02', close: '2' }, // Sat
      { date: '2030-11-03', close: '3' }, // Sun
      { date: '2030-11-04', close: '4' }, // Mon = today
    ];
    expect(filterHistoryCloses(closes, '2030-11-04')).toEqual([closes[0]]);
  });

  it('reads the currency (meta, else the suffix, else null) and the listing date', () => {
    const exus = parseYahooHistory(
      historyBody({
        symbol: 'EXUS',
        currency: 'USD',
        exchangeTimezoneName: 'America/New_York',
        firstTradeDate: '2030-03-04T14:30:00Z',
        bars: [['2030-11-04T14:30:00Z', 100]],
      }),
      NOW,
    );
    expect(exus.ok && exus.history).toMatchObject({
      currency: 'USD',
      timeZone: 'America/New_York',
      firstTradeDate: '2030-03-04',
    });
    const pence = parseYahooHistory(
      historyBody({
        symbol: 'EXL.L',
        currency: 'GBp',
        exchangeTimezoneName: 'Europe/London',
        bars: [['2030-11-04T08:00:00Z', 250]],
      }),
      NOW,
    );
    expect(pence.ok && pence.history.currency).toBe('GBp');
    const suffix = parseYahooHistory(
      historyBody({ symbol: 'EXA.AX', currency: null, bars: [['2030-11-03T23:00:00Z', 1]] }),
      NOW,
    );
    expect(suffix.ok && suffix.history.currency).toBe('AUD');
    const unknown = parseYahooHistory(
      historyBody({ symbol: 'EXZ', currency: null, bars: [['2030-11-04T14:30:00Z', 1]] }),
      NOW,
    );
    expect(unknown.ok && unknown.history.currency).toBeNull();
    // The listing date is an exchange-zone date: 23:00Z in AEDT is the next day in Sydney.
    const listed = parseYahooHistory(
      historyBody({
        symbol: 'EXA.AX',
        firstTradeDate: '2030-03-03T23:00:00Z',
        bars: [['2030-11-03T23:00:00Z', 1]],
      }),
      NOW,
    );
    expect(listed.ok && listed.history.firstTradeDate).toBe('2030-03-04');
  });

  it('a chart.error is a failure; no bars is a success with none', () => {
    expect(parseYahooHistory(yahooNotFound(), NOW)).toEqual({
      ok: false,
      error: 'Symbol not found',
    });
    expect(parseYahooHistory({ nope: true }, NOW)).toEqual({
      ok: false,
      error: 'Malformed response',
    });
    const empty = parseYahooHistory(historyBody({ symbol: 'EXA.AX', bars: [] }), NOW);
    expect(empty.ok && empty.history.closes).toEqual([]);
    // Bars but no usable zone at all.
    expect(
      parseYahooHistory(
        historyBody({
          symbol: 'EXZ',
          exchangeTimezoneName: null,
          bars: [['2030-11-04T00:00:00Z', 1]],
        }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'No exchange time zone in response' });
  });
});

describe('parseYahooSplits', () => {
  it('reads a 4:1 split and a 1:10 consolidation in the exchange zone, oldest first', () => {
    const body = historyBody({
      symbol: 'EXA.AX',
      bars: [['2030-11-03T23:00:00Z', 10]],
      splits: [
        ['2030-08-11T00:00:00Z', 1, 10], // Sun 10:00 Sydney (AEST) = 2030-08-11
        ['2030-06-09T23:00:00Z', 4, 1], // 09:00 Sydney on 10/06
        ['2030-07-01T00:00:00Z', 2, 2], // a ratio of 1: ignored
      ],
    });
    expect(parseYahooSplits(body)).toEqual([
      { date: '2030-06-10', numerator: '4', denominator: '1' },
      { date: '2030-08-11', numerator: '1', denominator: '10' },
    ]);
  });

  it('a body without events has none', () => {
    expect(parseYahooSplits(historyBody({ symbol: 'EXA.AX', bars: [] }))).toEqual([]);
    expect(parseYahooSplits(yahooNotFound())).toEqual([]);
  });
});

describe('createYahooHistoryClient', () => {
  afterEach(() => vi.restoreAllMocks());

  const body = historyBody({ symbol: 'EXA.AX', bars: [['2030-11-03T23:00:00Z', 10.5]] });

  it('requests period1 = the date at 00:00 UTC and period2 = now, with a browser User-Agent', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(body));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = createYahooHistoryClient({
      fetchImpl,
      sleep: async () => undefined,
      now: () => NOW,
    });
    const result = await client.fetchHistory(
      { symbol: 'EXA.AX', from: '2030-01-05' },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, history: { closes: [{ date: '2030-11-04' }] } });
    const url = calls[0]!.url;
    expect(url.searchParams.get('period1')).toBe(String(sec('2030-01-05T00:00:00Z')));
    expect(url.searchParams.get('period2')).toBe(String(sec(NOW.toISOString())));
    expect(url.searchParams.get('interval')).toBe('1d');
    expect(url.searchParams.get('events')).toBe('split');
    expect(url.search).not.toContain('range=');
    expect((calls[0]!.init?.headers as Record<string, string>)['User-Agent']).toMatch(/Mozilla/);
    expect(timeout).toHaveBeenCalledWith(CLOSES_REQUEST_TIMEOUT_MS);
  });

  it('spaces requests CLOSES_YAHOO_SPACING_MS from the previous start', async () => {
    let now = NOW.getTime();
    const waits: number[] = [];
    const { fetchImpl } = mockFetch(() => jsonResponse(body));
    const client = createYahooHistoryClient({
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      now: () => new Date(now),
    });
    const signal = new AbortController().signal;
    await client.fetchHistory({ symbol: 'EXA.AX', from: '2030-01-05' }, signal);
    now += 400;
    await client.fetchHistory({ symbol: 'EXB.AX', from: '2030-01-05' }, signal);
    expect(waits).toEqual([CLOSES_YAHOO_SPACING_MS - 400]);
  });

  it('maps 429/403 to rate_limited (Retry-After kept), other errors to failed, an abort to skipped', async () => {
    const answers: Response[] = [
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
      new Response('', { status: 403 }),
      new Response('', { status: 500 }),
      jsonResponse(yahooNotFound(), 404),
      jsonResponse({ chart: { result: null, error: { code: 'x' } } }),
    ];
    const { fetchImpl } = mockFetch(() => answers.shift()!);
    const client = createYahooHistoryClient({
      fetchImpl,
      sleep: async () => undefined,
      now: () => NOW,
      spacingMs: 0,
    });
    const signal = new AbortController().signal;
    const req = { symbol: 'EXA.AX', from: '2030-01-05' };
    expect(await client.fetchHistory(req, signal)).toEqual({
      ok: false,
      kind: 'rate_limited',
      error: 'Rate limited',
      retryAfterMs: 60_000,
    });
    expect(await client.fetchHistory(req, signal)).toMatchObject({ kind: 'rate_limited' });
    expect(await client.fetchHistory(req, signal)).toEqual({
      ok: false,
      kind: 'failed',
      error: 'HTTP 500',
    });
    expect(await client.fetchHistory(req, signal)).toMatchObject({ kind: 'failed' });
    expect(await client.fetchHistory(req, signal)).toEqual({
      ok: false,
      kind: 'failed',
      error: 'Symbol not found',
    });
    const aborted = new AbortController();
    aborted.abort();
    expect(await client.fetchHistory(req, aborted.signal)).toMatchObject({ kind: 'skipped' });
  });
});
