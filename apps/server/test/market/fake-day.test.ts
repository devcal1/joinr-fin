// Stage 9 fake day data (stage-9.md §5.3): deterministic sessions, a fund's NAV, the bullion inputs'
// two-day bars with the weekend gap, the CoinGecko day chart, and the rule that a quote's as-of is
// the time of its last day point. Pure (the clock is passed in).
process.env.TZ = 'Australia/Melbourne';

import { describe, expect, it } from 'vitest';
import { cryptoDayFrom } from '../../src/market/day';
import {
  createFakeProvider,
  fakeDayChart,
  fakePreviousClose,
  fakePrice,
  fakeQuote,
  FAKE_AUDUSD,
} from '../../src/market/providers/fake';
import { sec } from './dayHelpers';

const at = (iso: string) => Date.parse(iso);

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
});

describe('listings (10:00 to 16:10 in the listing’s zone)', () => {
  it('Thursday 12/09/2030 15:20 Sydney: today’s bars, the last one at the price and the as-of', () => {
    const q = fakeQuote({ key: '1', symbol: 'EXA.AX' }, at('2030-09-12T05:22:00Z'));
    const day = q.day!;
    expect(day).toMatchObject({
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Sydney',
      granularity: '5m',
      nativeCurrency: 'AUD',
      previousClose: fakePreviousClose('EXA.AX', fakePrice('EXA.AX')),
      regularStart: '2030-09-12T00:00:00.000Z',
      regularEnd: '2030-09-12T06:10:00.000Z',
    });
    expect(day.points[0]![0]).toBe(sec('2030-09-12T00:00:00Z'));
    expect(day.points.at(-1)).toEqual([sec('2030-09-12T05:20:00Z'), fakePrice('EXA.AX')]);
    expect(q.asOf).toBe('2030-09-12T05:20:00.000Z');
    expect(day.points).toHaveLength(65);
  });

  it('before 10:00 on Monday and on a Saturday: the previous weekday’s full session', () => {
    const monday = fakeQuote({ key: '1', symbol: 'EXA.AX' }, at('2030-09-15T22:00:00Z'));
    expect(monday.day!.sessionDate).toBe('2030-09-13');
    expect(monday.asOf).toBe('2030-09-13T06:10:00.000Z');
    expect(monday.day!.points).toHaveLength(75);
    const saturday = fakeQuote({ key: '1', symbol: 'EXA.AX' }, at('2030-09-14T01:00:00Z'));
    expect(saturday.day!.sessionDate).toBe('2030-09-13');
  });

  it('quotes EXUS in USD (and every other listing as before)', () => {
    const q = fakeQuote({ key: '1', symbol: 'EXUS' }, at('2030-09-12T05:22:00Z'));
    expect(q.currency).toBe('USD');
    expect(q.day!.nativeCurrency).toBe('USD');
    expect(fakeQuote({ key: '1', symbol: 'EXA.AX' }, 0).currency).toBe('AUD');
  });

  it('FX series have no move: the previous close is the price', () => {
    const q = fakeQuote({ key: 'FX_GBPAUD', symbol: 'GBPAUD=X' }, at('2030-09-12T05:22:00Z'));
    expect(q.day!.previousClose).toBe(q.price);
  });
});

describe('daily requests (funds)', () => {
  it('one point at 16:00 local on the latest weekday whose 16:00 has passed', () => {
    const before = fakeQuote(
      { key: '7', symbol: '0PEXAMPLE1', daily: true },
      at('2030-09-12T05:20:00Z'),
    );
    expect(before.day).toMatchObject({
      sessionDate: '2030-09-11',
      granularity: '1d',
      regularStart: null,
      points: [[sec('2030-09-11T06:00:00Z'), fakePrice('0PEXAMPLE1')]],
    });
    expect(before.asOf).toBe('2030-09-11T06:00:00.000Z');
    const after = fakeQuote(
      { key: '7', symbol: '0PEXAMPLE1', daily: true },
      at('2030-09-12T06:30:00Z'),
    );
    expect(after.day!.sessionDate).toBe('2030-09-12');
  });
});

describe('the bullion inputs (two-day bars, the weekend gap)', () => {
  it('Sunday 11/10/2026 in Melbourne: the bars end at Friday 17:00 New York', () => {
    const now = at('2026-10-11T00:00:00Z');
    for (const symbol of ['GC=F', 'SI=F', 'AUDUSD=X']) {
      const q = fakeQuote({ key: symbol, symbol }, now);
      expect(q.asOf).toBe('2026-10-09T20:55:00.000Z');
      expect(q.bars!.at(-1)![0]).toBe(sec('2026-10-09T20:55:00Z'));
      expect(q.bars!.every(([t]) => t < sec('2026-10-09T21:00:00Z'))).toBe(true);
    }
    expect(fakeQuote({ key: 'A', symbol: 'AUDUSD=X' }, now).price).toBe(FAKE_AUDUSD);
  });

  it('Monday morning in Melbourne after the reopen: AUDUSD from 17:00, the futures from 18:00 New York', () => {
    const now = at('2026-10-11T23:30:00Z');
    const gold = fakeQuote({ key: 'GC', symbol: 'GC=F' }, now);
    const fx = fakeQuote({ key: 'A', symbol: 'AUDUSD=X' }, now);
    const after = (bars: Array<[number, string]>) =>
      bars.filter(([t]) => t > sec('2026-10-09T21:00:00Z'))[0]![0];
    expect(after(gold.bars!)).toBe(sec('2026-10-11T22:00:00Z'));
    expect(after(fx.bars!)).toBe(sec('2026-10-11T21:00:00Z'));
    expect(gold.asOf).toBe('2026-10-11T23:30:00.000Z');
    expect(gold.bars!.at(-1)![1]).toBe(gold.price);
    expect(gold.day!.timeZone).toBe('America/New_York');
    expect(fx.day!.timeZone).toBe('Europe/London');
    // A bar sits on 00:00 Melbourne on a weekday (bullionDayFrom's base).
    const tuesday = fakeQuote({ key: 'GC', symbol: 'GC=F' }, at('2026-10-13T02:00:00Z'));
    expect(tuesday.bars!.some(([t]) => t === sec('2026-10-12T13:00:00Z'))).toBe(true);
  });
});

describe('crypto', () => {
  it('a CoinGecko id keeps as-of = now and has no day; its chart ends at now at the price', async () => {
    const now = at('2026-10-03T02:02:00Z');
    expect(fakeQuote({ key: '9', symbol: 'bitcoin' }, now)).toEqual({
      key: '9',
      price: fakePrice('bitcoin'),
      currency: 'AUD',
      asOf: '2026-10-03T02:02:00.000Z',
    });
    const chart = fakeDayChart('bitcoin', now);
    expect(chart.at(-1)).toEqual([now, Number(fakePrice('bitcoin'))]);
    expect(chart[0]![0]).toBeGreaterThan(now - 86_400_000);
    const day = cryptoDayFrom(chart, new Date(now), 'Australia/Melbourne')!;
    expect(day.previousClose).not.toBeNull();
    expect(day.points[0]![0]).toBe(sec('2026-10-02T14:00:00Z'));
    const fake = createFakeProvider({ now: () => new Date(now) });
    expect(await fake.fetchDayChart('bitcoin', new AbortController().signal)).toEqual({
      ok: true,
      prices: chart,
    });
  });
});
