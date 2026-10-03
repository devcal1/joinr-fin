// Stage 10 CoinGecko history (stage-10.md §5.3; D142, P20): `coinClosesFrom` takes the close of a
// Melbourne date D at 00:00 on D + 1, from hourly points exactly and from daily (00:00 UTC) points
// as the nearest within ± 14 h, across the October change (2030-10-05/06), the April change and its
// 25-hour day (2031-04-05/06); the first point of a `days=365` answer gives the 12M start close; and
// the client's URL, timeout, 401 reach and 429. Made-up coin ids and values; no network.
process.env.TZ = 'Australia/Melbourne';

import { periodStartDate } from '@joinr/engine';
import { CLOSES_REQUEST_TIMEOUT_MS } from '@joinr/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coinClosesFrom } from '../../src/market/closes/coins';
import { coinGeckoHistoryUrl, createCoinGeckoProvider } from '../../src/market/providers/coingecko';
import { everyStep, marketChartBody } from './closesHelpers';
import { jsonResponse, mockFetch } from './helpers';

const MELBOURNE = 'Australia/Melbourne';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2030, 9, 7).toISOString()).toBe('2030-10-06T13:00:00.000Z');
});

/** Hourly points whose value is the hour's own epoch hour count (easy to read back). */
function hourly(fromIso: string, toIso: string): Array<[number, number]> {
  return everyStep(ms(fromIso), ms(toIso), HOUR).map((t) => [t, t / HOUR]);
}

describe('coinClosesFrom: hourly points (the 00:00 Melbourne price)', () => {
  it('across the October change: Sat 05/10 at 14:00Z (AEST), Sun 06/10 at 13:00Z (AEDT) (P20)', () => {
    const closes = coinClosesFrom(
      hourly('2030-10-03T00:00:00Z', '2030-10-08T00:00:00Z'),
      MELBOURNE,
      '2030-10-04',
      '2030-10-08',
      false,
    );
    expect(closes).toEqual([
      { date: '2030-10-04', close: String(ms('2030-10-04T14:00:00Z') / HOUR) },
      { date: '2030-10-05', close: String(ms('2030-10-05T14:00:00Z') / HOUR) },
      { date: '2030-10-06', close: String(ms('2030-10-06T13:00:00Z') / HOUR) },
      { date: '2030-10-07', close: String(ms('2030-10-07T13:00:00Z') / HOUR) },
    ]);
  });

  it('across the April change and its 25-hour day (05/04 at 13:00Z, 06/04 at 14:00Z)', () => {
    const closes = coinClosesFrom(
      hourly('2031-04-04T00:00:00Z', '2031-04-08T00:00:00Z'),
      MELBOURNE,
      '2031-04-05',
      '2031-04-07',
      false,
    );
    expect(closes).toEqual([
      { date: '2031-04-05', close: String(ms('2031-04-05T13:00:00Z') / HOUR) },
      { date: '2031-04-06', close: String(ms('2031-04-06T14:00:00Z') / HOUR) },
    ]);
  });

  it('takes the last point at or before midnight, at most 36 hours old; none → no close', () => {
    const points: Array<[number, number]> = [
      [ms('2030-10-03T10:00:00Z'), 5], // 34 h before 00:00 05/10 (14:00Z 04/10)
      [ms('2030-10-04T15:00:00Z'), 6], // after it
    ];
    expect(coinClosesFrom(points, MELBOURNE, '2030-10-04', '2030-10-05', false)).toEqual([
      { date: '2030-10-04', close: '5' },
    ]);
    const stale: Array<[number, number]> = [[ms('2030-10-03T01:00:00Z'), 5]]; // 37 h before
    expect(coinClosesFrom(stale, MELBOURNE, '2030-10-04', '2030-10-05', false)).toEqual([]);
    expect(coinClosesFrom([], MELBOURNE, '2030-10-04', '2030-10-05', false)).toEqual([]);
  });

  it('never gives a close for localDate itself or later', () => {
    const closes = coinClosesFrom(
      hourly('2030-10-03T00:00:00Z', '2030-10-08T00:00:00Z'),
      MELBOURNE,
      '2030-10-06',
      '2030-10-07',
      false,
    );
    expect(closes.map((c) => c.date)).toEqual(['2030-10-06']);
  });
});

describe('coinClosesFrom: daily points (00:00 UTC, the nearest within ± 14 h)', () => {
  const daily = (fromIso: string, toIso: string): Array<[number, number]> =>
    everyStep(ms(fromIso), ms(toIso), DAY).map((t) => [t, t / DAY]);

  it('the 00:00 UTC point of D + 1 is the close of D, on both DST changes', () => {
    const oct = coinClosesFrom(
      daily('2030-10-03T00:00:00Z', '2030-10-09T00:00:00Z'),
      MELBOURNE,
      '2030-10-04',
      '2030-10-08',
      true,
    );
    expect(oct).toEqual(
      ['2030-10-04', '2030-10-05', '2030-10-06', '2030-10-07'].map((date) => ({
        date,
        close: String(ms(`${date}T00:00:00Z`) / DAY + 1),
      })),
    );
    const apr = coinClosesFrom(
      daily('2031-04-03T00:00:00Z', '2031-04-09T00:00:00Z'),
      MELBOURNE,
      '2031-04-05',
      '2031-04-07',
      true,
    );
    expect(apr.map((c) => [c.date, Number(c.close) * DAY])).toEqual([
      ['2031-04-05', ms('2031-04-06T00:00:00Z')],
      ['2031-04-06', ms('2031-04-07T00:00:00Z')],
    ]);
  });

  it('the first point of a days=365 answer gives the 12M start close (a non-leap span)', () => {
    // localDate Friday 12/09/2031, run at 16:00 Melbourne: UTC today is 12/09; the first point is
    // 00:00Z of 12/09/2031 − 364 days = 13/09/2030, the close of 12/09/2030 (= the 12M start).
    const localDate = '2031-09-12';
    const first = ms('2031-09-12T00:00:00Z') - 364 * DAY;
    expect(new Date(first).toISOString()).toBe('2030-09-13T00:00:00.000Z');
    const points = everyStep(first, ms('2031-09-12T00:00:00Z'), DAY).map((t): [number, number] => [
      t,
      100,
    ]);
    const closes = coinClosesFrom(points, MELBOURNE, '2030-01-01', localDate, true);
    expect(periodStartDate(localDate, '12M')).toBe('2030-09-12');
    expect(closes[0]).toEqual({ date: '2030-09-12', close: '100' });
    expect(closes.at(-1)!.date).toBe('2031-09-11');
  });

  it('a point more than 14 hours from midnight is not used', () => {
    // 00:00 Melbourne on 04/10 is 14:00Z on 03/10: a point 15 h after it is too far; 14 h is not.
    const far: Array<[number, number]> = [[ms('2030-10-04T05:00:00Z'), 7]];
    expect(coinClosesFrom(far, MELBOURNE, '2030-10-03', '2030-10-04', true)).toEqual([]);
    const near: Array<[number, number]> = [[ms('2030-10-04T04:00:00Z'), 7]];
    expect(coinClosesFrom(near, MELBOURNE, '2030-10-03', '2030-10-04', true)).toEqual([
      { date: '2030-10-03', close: '7' },
    ]);
  });
});

describe('the CoinGecko history call', () => {
  afterEach(() => vi.restoreAllMocks());
  const NOW = new Date('2030-10-07T06:52:00.000Z');
  const body = marketChartBody([
    [ms('2030-10-06T13:00:00Z'), 150000.5],
    [ms('2030-10-06T14:00:00Z'), 150100],
  ]);

  it('asks market_chart in AUD, interval=daily only for the backfill, with a 30 s timeout', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(body));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const cg = createCoinGeckoProvider({ fetchImpl, now: () => NOW });
    const signal = new AbortController().signal;
    expect(await cg.fetchHistory('example-coin', 365, true, signal)).toEqual({
      ok: true,
      prices: [
        [ms('2030-10-06T13:00:00Z'), 150000.5],
        [ms('2030-10-06T14:00:00Z'), 150100],
      ],
    });
    await cg.fetchHistory('example-coin', 90, false, signal);
    expect(calls.map((c) => c.url.href)).toEqual([
      'https://api.coingecko.com/api/v3/coins/example-coin/market_chart?vs_currency=aud&days=365&interval=daily',
      'https://api.coingecko.com/api/v3/coins/example-coin/market_chart?vs_currency=aud&days=90',
    ]);
    expect(coinGeckoHistoryUrl('a/b', 4, false)).toContain('/coins/a%2Fb/market_chart?');
    expect(timeout).toHaveBeenCalledWith(CLOSES_REQUEST_TIMEOUT_MS);
  });

  it('a slow answer inside the timeout is kept (scaled: 200 ms within 300 ms)', async () => {
    const { fetchImpl } = mockFetch(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(body)), 200)),
    );
    const cg = createCoinGeckoProvider({ fetchImpl, now: () => NOW, historyTimeoutMs: 300 });
    expect(
      await cg.fetchHistory('example-coin', 90, false, new AbortController().signal),
    ).toMatchObject({
      ok: true,
    });
  });

  it('a 401 is beyond_reach only past 365 days, else failed; 429 is rate_limited', async () => {
    const answers: Response[] = [
      jsonResponse({ error: { status: { error_code: 10012 } } }, 401),
      jsonResponse({ error: { status: { error_code: 10012 } } }, 401),
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
      new Response('', { status: 500 }),
      jsonResponse({ nope: 1 }),
    ];
    const { fetchImpl } = mockFetch(() => answers.shift()!);
    const cg = createCoinGeckoProvider({ fetchImpl, now: () => NOW });
    const signal = new AbortController().signal;
    expect(await cg.fetchHistory('example-coin', 365, true, signal)).toEqual({
      ok: false,
      kind: 'failed',
      error: 'HTTP 401',
    });
    expect(await cg.fetchHistory('example-coin', 400, true, signal)).toMatchObject({
      ok: false,
      kind: 'beyond_reach',
    });
    expect(await cg.fetchHistory('example-coin', 90, false, signal)).toEqual({
      ok: false,
      kind: 'rate_limited',
      error: 'Rate limited',
      retryAfterMs: 60_000,
    });
    expect(await cg.fetchHistory('example-coin', 90, false, signal)).toMatchObject({
      kind: 'failed',
      error: 'HTTP 500',
    });
    expect(await cg.fetchHistory('example-coin', 90, false, signal)).toMatchObject({
      kind: 'failed',
      error: 'Malformed response',
    });
  });
});
