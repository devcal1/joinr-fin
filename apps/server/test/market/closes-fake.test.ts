// Stage 10 fake histories (stage-10.md §5.4): deterministic; weekday bars dated before today in the
// symbol's zone; the close of the weekday before the fake session equals the fake previous close
// exactly (listings, funds, the futures); every close > 0 over a 15-year window; flat FX; CoinGecko
// points anchored at the fake day's 00:00 base, with the keyless 401 past 365 days. No network.
process.env.TZ = 'Australia/Melbourne';

import { JoinrDecimal } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import { coinClosesFrom } from '../../src/market/closes/coins';
import { cryptoDayFrom, isWeekday, previousWeekday, weekdayOfIso } from '../../src/market/day';
import {
  createFakeHistoryClients,
  FAKE_AUDUSD,
  fakeCoinHistory,
  fakeDayChart,
  fakeFxClose,
  fakePreviousClose,
  fakePrice,
  fakeSessionDate,
  fakeYahooHistory,
} from '../../src/market/providers/fake';

const MELBOURNE = 'Australia/Melbourne';

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2030, 8, 12).toISOString()).toBe('2030-09-11T14:00:00.000Z');
});

// Thursday 12/09/2030 16:52 Melbourne (AEST).
const NOW = Date.parse('2030-09-12T06:52:00Z');

describe('the fake Yahoo-style history', () => {
  it('is deterministic, weekday-only and dated before today in the symbol’s zone', () => {
    const a = fakeYahooHistory('EXA.AX', '2030-08-01', NOW);
    expect(fakeYahooHistory('EXA.AX', '2030-08-01', NOW)).toEqual(a);
    expect(a.timeZone).toBe('Australia/Sydney');
    expect(a.currency).toBe('AUD');
    expect(a.closes.length).toBeGreaterThan(20);
    expect(a.closes.every((c) => isWeekday(weekdayOfIso(c.date)))).toBe(true);
    expect(a.closes.at(-1)!.date).toBe('2030-09-11');
    expect(a.closes[0]!.date).toBe('2030-08-01');
    expect(a.splits).toEqual([]);
  });

  it('the close of the weekday before the fake session is the fake previous close exactly', () => {
    // A listing: 16:52 Sydney on a Thursday → the session is today; its eve is Wednesday 11/09.
    const listing = fakeYahooHistory('EXA.AX', '2030-09-01', NOW);
    expect(fakeSessionDate('EXA.AX', NOW)).toBe('2030-09-12');
    expect(listing.closes.find((c) => c.date === '2030-09-11')!.close).toBe(
      fakePreviousClose('EXA.AX', fakePrice('EXA.AX')),
    );
    // Before 10:00 Sydney the session is the previous weekday, which closed at the price.
    const early = Date.parse('2030-09-11T22:00:00Z'); // Thu 08:00 Sydney
    const before = fakeYahooHistory('EXA.AX', '2030-09-01', early);
    expect(before.closes.find((c) => c.date === '2030-09-11')!.close).toBe(fakePrice('EXA.AX'));
    expect(before.closes.find((c) => c.date === '2030-09-10')!.close).toBe(
      fakePreviousClose('EXA.AX', fakePrice('EXA.AX')),
    );
    // A fund: its NAV day (16:00) — the NAV of 12/09 is out at 16:52, so the eve is 11/09.
    const fund = fakeYahooHistory('0PEXAMPLE1', '2030-09-01', NOW, { daily: true });
    expect(fund.closes.find((c) => c.date === '2030-09-11')!.close).toBe(
      fakePreviousClose('0PEXAMPLE1', fakePrice('0PEXAMPLE1')),
    );
    // The futures: New York dates (Thursday 02:52 there: the session is Thursday).
    const gold = fakeYahooHistory('GC=F', '2030-09-01', NOW);
    expect(gold.timeZone).toBe('America/New_York');
    expect(gold.currency).toBe('USD');
    const session = fakeSessionDate('GC=F', NOW)!;
    expect(gold.closes.find((c) => c.date === previousWeekday(session))!.close).toBe(
      fakePreviousClose('GC=F', fakePrice('GC=F')),
    );
  });

  it('drifts multiplicatively: every close > 0 over a 15-year window', () => {
    const long = fakeYahooHistory('EXB.AX', '2015-09-01', NOW);
    expect(long.closes.length).toBeGreaterThan(3800);
    expect(long.closes.every((c) => new JoinrDecimal(c.close).greaterThan(0))).toBe(true);
    // Older closes are lower on average (the 0.9996 per-weekday drift).
    expect(Number(long.closes[0]!.close)).toBeLessThan(Number(long.closes.at(-1)!.close));
  });

  it('FX is flat: AUDUSD the fake rate, <CCY>AUD the Stage 4 fake close', () => {
    const fx = fakeYahooHistory('AUDUSD=X', '2030-09-02', NOW);
    expect(fx.timeZone).toBe('Europe/London');
    expect(new Set(fx.closes.map((c) => c.close))).toEqual(new Set([FAKE_AUDUSD]));
    const gbp = fakeYahooHistory('GBPAUD=X', '2030-09-02', NOW);
    expect(new Set(gbp.closes.map((c) => c.close))).toEqual(new Set([fakeFxClose('GBP')]));
  });

  it('the client lists a test’s split events and honours an abort', async () => {
    const clients = createFakeHistoryClients({
      now: () => new Date(NOW),
      timeZone: MELBOURNE,
      splits: { 'EXA.AX': [{ date: '2030-09-10', numerator: '2', denominator: '1' }] },
    });
    const signal = new AbortController().signal;
    const result = await clients.yahoo.fetchHistory(
      { symbol: 'EXA.AX', from: '2030-09-01' },
      signal,
    );
    expect(result.ok && result.history.splits).toEqual([
      { date: '2030-09-10', numerator: '2', denominator: '1' },
    ]);
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await clients.yahoo.fetchHistory({ symbol: 'EXA.AX', from: '2030-09-01' }, aborted.signal),
    ).toMatchObject({ kind: 'skipped' });
    expect(
      await clients.coins.fetchHistory('example-coin', 90, false, aborted.signal),
    ).toMatchObject({ kind: 'skipped' });
  });
});

describe('the fake CoinGecko-style history', () => {
  it('answers 401 (beyond_reach) past 365 days', () => {
    expect(fakeCoinHistory('example-coin', 366, true, NOW, MELBOURNE)).toMatchObject({
      ok: false,
      kind: 'beyond_reach',
    });
    expect(fakeCoinHistory('example-coin', 365, true, NOW, MELBOURNE).ok).toBe(true);
  });

  it('hourly: the point at 00:00 Melbourne today is the fake day’s base', () => {
    const result = fakeCoinHistory('example-coin', 90, false, NOW, MELBOURNE);
    if (!result.ok) throw new Error('expected points');
    const base = cryptoDayFrom(
      fakeDayChart('example-coin', NOW),
      new Date(NOW),
      MELBOURNE,
    )!.previousClose;
    const closes = coinClosesFrom(result.prices, MELBOURNE, '2030-06-01', '2030-09-12', false);
    expect(closes.at(-1)).toEqual({ date: '2030-09-11', close: base });
    expect(result.prices.at(-1)).toEqual([NOW, Number(fakePrice('example-coin'))]);
    expect(result.prices.every(([, p]) => p > 0)).toBe(true);
  });

  it('daily: points at 00:00 UTC from UTC-today − 364 (days=365)', () => {
    const result = fakeCoinHistory('example-coin', 365, true, NOW, MELBOURNE);
    if (!result.ok) throw new Error('expected points');
    expect(new Date(result.prices[0]![0]).toISOString()).toBe('2029-09-13T00:00:00.000Z');
    expect(result.prices.length).toBe(366); // 365 midnights + now
  });
});
