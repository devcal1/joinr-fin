// Stage 9 refresh writes (stage-9.md §5.4, §5.4a; the newer-session rule is FROZEN): the day rows
// of the hourly run, the FX previous closes, bullion's day since 00:00, daily fund requests, the
// lite runs of the intraday scopes and the price write that never goes backwards. Scripted
// providers on a seeded in-memory database; made-up symbols and prices.
process.env.TZ = 'Australia/Melbourne';

import type { MarketSeriesId } from '@joinr/schema';
import { dayQuotes, marketQuotes, prices, priceSources, seriesDayQuotes } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { roundDerived } from '../../src/market/fx';
import { createYahooProvider } from '../../src/market/providers/yahoo';
import type { QuoteDay } from '../../src/market/providers/types';
import { Cooldowns, runRefresh, type RefreshOptions } from '../../src/market/refresh';
import { JoinrDecimal } from '@joinr/schema';
import {
  chartBody,
  chartErrorBody,
  everyMinutes,
  scriptedProvider,
  sec,
  type ScriptedProvider,
} from './dayHelpers';
import { jsonResponse, mockFetch, noSleep, silentLogger } from './helpers';

const MELBOURNE = 'Australia/Melbourne';
/** Thursday 12/09/2030 15:20 in Melbourne and Sydney (AEST). */
const NOW = '2030-09-12T05:20:00.000Z';

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
});

const open: TestDb[] = [];
afterEach(() => {
  for (const t of open.splice(0)) t.close();
});

interface Harness {
  t: TestDb;
  ids: Record<string, number>;
  yahoo: ScriptedProvider;
  coin: ScriptedProvider;
  now: { iso: string };
  run(opts?: RefreshOptions): ReturnType<typeof runRefresh>;
}

function listingDay(date: string, prev: string | null, points: Array<[string, string]>): QuoteDay {
  return {
    sessionDate: date,
    timeZone: 'Australia/Sydney',
    granularity: '5m',
    nativeCurrency: 'AUD',
    previousClose: prev,
    regularStart: `${date}T00:00:00.000Z`,
    regularEnd: `${date}T06:12:00.000Z`,
    points: points.map(([iso, p]) => [sec(iso), p]),
  };
}

const bars = (from: string, to: string, value: string): Array<[number, string]> =>
  everyMinutes(from, to).map((iso) => [sec(iso), value]);

function setup(): Harness {
  const t = createTestDb();
  open.push(t);
  const now = { iso: NOW };
  const { instrumentIds: ids } = seedGenericData(t.db, { now: new Date(NOW) });
  const yahoo = scriptedProvider('yahoo');
  const coin = scriptedProvider('coingecko');
  const usd =
    (price: string, asOf = NOW) =>
    () => ({ price, currency: 'USD', asOf });
  yahoo.answers.set('ABC.AX', () => ({
    price: '13',
    currency: 'AUD',
    asOf: NOW,
    day: listingDay('2030-09-12', '12.5', [
      ['2030-09-12T00:00:00Z', '12.6'],
      ['2030-09-12T05:20:00Z', '13'],
    ]),
  }));
  yahoo.answers.set('XYZ.AX', () => ({ price: '110', currency: 'AUD', asOf: NOW }));
  yahoo.answers.set('DEF.AX', () => ({ price: '32', currency: 'AUD', asOf: NOW }));
  // The bullion inputs' two-day bars: across 00:00 Melbourne (14:00Z on 11/09).
  yahoo.answers.set('AUDUSD=X', () => ({
    ...usd('0.65')(),
    day: {
      sessionDate: '2030-09-12',
      timeZone: 'Europe/London',
      granularity: '5m',
      nativeCurrency: 'USD',
      previousClose: '0.64',
      regularStart: null,
      regularEnd: null,
      points: [[sec(NOW), '0.65']],
    },
    bars: bars('2030-09-11T12:00:00Z', NOW, '0.65'),
  }));
  yahoo.answers.set('SI=F', () => ({
    ...usd('30')(),
    bars: [
      ...bars('2030-09-11T12:00:00Z', '2030-09-11T14:00:00Z', '29.9'),
      ...bars('2030-09-11T14:05:00Z', NOW, '30'),
    ],
  }));
  yahoo.answers.set('GC=F', () => ({
    ...usd('2600')(),
    bars: bars('2030-09-11T12:00:00Z', NOW, '2600'),
  }));
  coin.answers.set('bitcoin', () => ({ price: '160000', currency: 'AUD', asOf: NOW }));
  coin.answers.set('ethereum', () => ({ price: '5000', currency: 'AUD', asOf: NOW }));
  return {
    t,
    ids,
    yahoo,
    coin,
    now,
    run: (opts = {}) =>
      runRefresh(
        {
          db: t.db,
          providers: { yahoo, coingecko: coin },
          cooldowns: new Cooldowns(),
          now: () => new Date(now.iso),
          sleep: noSleep,
          signal: new AbortController().signal,
          log: silentLogger(),
          searchSpacingMs: 0,
          timeZone: MELBOURNE,
        },
        opts,
      ),
  };
}

const dayRow = (h: Harness, symbol: string) =>
  h.t.db.select().from(dayQuotes).where(eq(dayQuotes.instrumentId, h.ids[symbol]!)).get();
const seriesDay = (h: Harness, seriesId: string) =>
  h.t.db.select().from(seriesDayQuotes).where(eq(seriesDayQuotes.seriesId, seriesId)).get();
const priceOf = (h: Harness, symbol: string) =>
  h.t.db.select().from(prices).where(eq(prices.instrumentId, h.ids[symbol]!)).get();
const quoteOf = (h: Harness, seriesId: string) =>
  h.t.db.select().from(marketQuotes).where(eq(marketQuotes.seriesId, seriesId)).get();

describe('the hourly run', () => {
  it('writes the listings’ day rows, the FX previous close and bullion’s day since 00:00', async () => {
    const h = setup();
    const out = await h.run();
    expect(dayRow(h, 'ASX:ABC')).toMatchObject({
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Sydney',
      granularity: '5m',
      nativeCurrency: 'AUD',
      previousClose: '12.5',
      points: JSON.stringify([
        [sec('2030-09-12T00:00:00Z'), '12.6'],
        [sec(NOW), '13'],
      ]),
      source: 'yahoo',
      fetchedAt: NOW,
    });
    // Quotes without a day write none; crypto's day comes only from its chart.
    expect(dayRow(h, 'ASX:XYZ')).toBeUndefined();
    expect(dayRow(h, 'BTC')).toBeUndefined();
    expect(quoteOf(h, 'AUDUSD')).toMatchObject({
      previousClose: '0.64',
      previousCloseDate: '2030-09-12',
    });
    expect(quoteOf(h, 'SI_USD_OZ')).toMatchObject({ previousClose: null, previousCloseDate: null });
    // Silver: base = 29.9 ÷ 0.65 at 00:00 Melbourne; gold too (written whether or not it is held).
    const silverBase = roundDerived(new JoinrDecimal('29.9').div('0.65'));
    expect(seriesDay(h, 'XAG_AUD_OZ')).toMatchObject({
      sessionDate: '2030-09-12',
      timeZone: MELBOURNE,
      nativeCurrency: 'AUD',
      previousClose: silverBase,
      source: 'yahoo',
    });
    const points = JSON.parse(seriesDay(h, 'XAG_AUD_OZ')!.points) as Array<[number, string]>;
    expect(points[0]).toEqual([sec('2030-09-11T14:00:00Z'), silverBase]);
    expect(points.at(-1)).toEqual([sec(NOW), roundDerived(new JoinrDecimal('30').div('0.65'))]);
    expect(seriesDay(h, 'SI_USD_OZ')).toMatchObject({
      nativeCurrency: 'USD',
      previousClose: '29.9',
    });
    expect(seriesDay(h, 'XAU_AUD_OZ')).toBeDefined();
    expect(seriesDay(h, 'GC_USD_OZ')).toBeDefined();
    expect(out.dayRows).toBe(5);
  });

  it('asks a Yahoo-priced managed fund as a daily request and stores its 1d row', async () => {
    const h = setup();
    h.t.db
      .update(priceSources)
      .set({ provider: 'yahoo', providerSymbol: '0PEXAMPLE1' })
      .where(eq(priceSources.instrumentId, h.ids.EXAMPLEFUND2!))
      .run();
    h.yahoo.answers.set('0PEXAMPLE1', (req) => ({
      price: '1.515',
      currency: 'AUD',
      asOf: '2030-09-11T06:00:00.000Z',
      day: {
        ...listingDay('2030-09-11', '1.5', [['2030-09-11T06:00:00Z', '1.515']]),
        granularity: req.daily ? '1d' : '5m',
        regularStart: null,
        regularEnd: null,
      },
    }));
    await h.run();
    expect(h.yahoo.requests.find((r) => r.symbol === '0PEXAMPLE1')).toEqual({
      key: String(h.ids.EXAMPLEFUND2),
      symbol: '0PEXAMPLE1',
      daily: true,
    });
    expect(h.yahoo.requests.filter((r) => r.daily)).toHaveLength(1);
    expect(dayRow(h, 'EXAMPLEFUND2')).toMatchObject({ granularity: '1d', previousClose: '1.5' });
  });
});

describe('the newer-session rule (FROZEN)', () => {
  it('ignores an older session, merges the same one and replaces with a newer one', async () => {
    const h = setup();
    await h.run();
    // An older session is ignored.
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '13',
      currency: 'AUD',
      asOf: NOW,
      day: listingDay('2030-09-11', '12', [['2030-09-11T05:00:00Z', '12.4']]),
    }));
    await h.run();
    expect(dayRow(h, 'ASX:ABC')!.sessionDate).toBe('2030-09-12');
    // The same session merges: base kept when the incoming is null; points by time.
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '13.1',
      currency: 'AUD',
      asOf: '2030-09-12T05:25:00.000Z',
      day: listingDay('2030-09-12', null, [
        ['2030-09-12T05:20:00Z', '13.05'],
        ['2030-09-12T05:25:00Z', '13.1'],
      ]),
    }));
    await h.run();
    expect(dayRow(h, 'ASX:ABC')).toMatchObject({
      previousClose: '12.5',
      points: JSON.stringify([
        [sec('2030-09-12T00:00:00Z'), '12.6'],
        [sec('2030-09-12T05:20:00Z'), '13.05'],
        [sec('2030-09-12T05:25:00Z'), '13.1'],
      ]),
    });
    // A newer session replaces the row.
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '13.2',
      currency: 'AUD',
      asOf: '2030-09-13T00:00:00.000Z',
      day: listingDay('2030-09-13', '13.1', [['2030-09-13T00:00:00Z', '13.2']]),
    }));
    await h.run();
    expect(dayRow(h, 'ASX:ABC')).toMatchObject({
      sessionDate: '2030-09-13',
      previousClose: '13.1',
      points: JSON.stringify([[sec('2030-09-13T00:00:00Z'), '13.2']]),
    });
  });

  it('never writes a row with neither a previous close nor a point', async () => {
    const h = setup();
    h.yahoo.answers.set('XYZ.AX', () => ({
      price: '110',
      currency: 'AUD',
      asOf: NOW,
      day: listingDay('2030-09-12', null, []),
    }));
    await h.run();
    expect(dayRow(h, 'ASX:XYZ')).toBeUndefined();
  });
});

describe('the price write never goes backwards (every job)', () => {
  it('keeps a stored price with a later as-of; the attempt columns move', async () => {
    const h = setup();
    h.now.iso = '2030-09-12T05:30:00.000Z';
    h.t.db
      .update(prices)
      .set({ price: '13.3', asOf: '2030-09-12T05:25:00.000Z', consecutiveFailures: 2 })
      .where(eq(prices.instrumentId, h.ids['ASX:ABC']!))
      .run();
    await h.run();
    expect(priceOf(h, 'ASX:ABC')).toMatchObject({
      price: '13.3',
      asOf: '2030-09-12T05:25:00.000Z',
      lastAttemptAt: '2030-09-12T05:30:00.000Z',
      lastStatus: 'ok',
      consecutiveFailures: 0,
    });
    // A newer one is written as before.
    h.yahoo.answers.set('ABC.AX', () => ({
      price: '13.4',
      currency: 'AUD',
      asOf: '2030-09-12T05:30:00.000Z',
    }));
    await h.run();
    expect(priceOf(h, 'ASX:ABC')).toMatchObject({
      price: '13.4',
      asOf: '2030-09-12T05:30:00.000Z',
    });
  });
});

describe('lite runs (the intraday scopes)', () => {
  it('fetch only the given instruments: no series, cross FX, search or backfill', async () => {
    const h = setup();
    const out = await h.run({ lite: true, instrumentIds: [h.ids['ASX:ABC']!] });
    expect(h.yahoo.requests.map((r) => r.symbol)).toEqual(['ABC.AX']);
    expect(h.coin.requests).toEqual([]);
    expect(out).toMatchObject({ requested: 1, ok: 1, dayRows: 1 });
    expect(out.series).toEqual({ ok: 0, failed: 0, skipped: 0 });
    expect(priceOf(h, 'ASX:ABC')!.price).toBe('13');
  });

  it('convert with the stored FX', async () => {
    const h = setup();
    h.yahoo.answers.set('ABC.AX', () => ({ price: '10', currency: 'USD', asOf: NOW }));
    await h.run({ lite: true, instrumentIds: [h.ids['ASX:ABC']!] });
    const stored = quoteOf(h, 'AUDUSD')!.value!;
    expect(priceOf(h, 'ASX:ABC')!.price).toBe(roundDerived(new JoinrDecimal('10').div(stored)));
  });

  it('never search for a CoinGecko id', async () => {
    const h = setup();
    h.t.db
      .update(priceSources)
      .set({ providerSymbol: null })
      .where(eq(priceSources.instrumentId, h.ids.BTC!))
      .run();
    const out = await h.run({ lite: true, instrumentIds: [h.ids.BTC!] });
    expect(h.coin.searches).toEqual([]);
    expect(out).toMatchObject({ requested: 1, skipped: 1 });
  });

  it('a lite failure writes nothing (backoff never advances)', async () => {
    const h = setup();
    const before = priceOf(h, 'ASX:ABC')!;
    h.yahoo.answers.set('ABC.AX', () => ({ error: 'HTTP 500', retryable: true }));
    const out = await h.run({ lite: true, instrumentIds: [h.ids['ASX:ABC']!] });
    expect(out).toMatchObject({ requested: 1, failed: 1 });
    expect(priceOf(h, 'ASX:ABC')).toEqual(before);
    // The hourly job still records failures as before.
    await h.run({ instrumentIds: [h.ids['ASX:ABC']!] });
    expect(priceOf(h, 'ASX:ABC')).toMatchObject({ lastStatus: 'error', consecutiveFailures: 1 });
  });

  it('read backoff: an instrument in backoff is skipped', async () => {
    const h = setup();
    h.t.db
      .update(prices)
      .set({ consecutiveFailures: 3, lastAttemptAt: NOW })
      .where(eq(prices.instrumentId, h.ids['ASX:ABC']!))
      .run();
    const out = await h.run({ lite: true, instrumentIds: [h.ids['ASX:ABC']!] });
    expect(out).toMatchObject({ requested: 1, skipped: 1 });
    expect(h.yahoo.requests).toEqual([]);
  });

  it('the bullion scope fetches only its series, derives its spots and writes their days', async () => {
    const h = setup();
    const seriesIds: MarketSeriesId[] = ['AUDUSD', 'SI_USD_OZ'];
    const out = await h.run({ lite: true, seriesIds });
    expect(h.yahoo.requests.map((r) => r.symbol).sort()).toEqual(['AUDUSD=X', 'SI=F']);
    expect(out.requested).toBe(0);
    expect(out.series).toEqual({ ok: 3, failed: 0, skipped: 0 }); // AUDUSD, SI and the XAG spot
    expect(seriesDay(h, 'XAG_AUD_OZ')).toBeDefined();
    expect(seriesDay(h, 'XAU_AUD_OZ')).toBeUndefined();
    expect(quoteOf(h, 'AUDUSD')!.previousClose).toBe('0.64');
  });

  it('a lite bullion failure writes nothing', async () => {
    const h = setup();
    const before = h.t.db.select().from(marketQuotes).all();
    h.yahoo.answers.set('AUDUSD=X', () => ({ error: 'HTTP 500', retryable: true }));
    h.yahoo.answers.set('SI=F', () => ({ error: 'HTTP 500', retryable: true }));
    const out = await h.run({ lite: true, seriesIds: ['AUDUSD', 'SI_USD_OZ'] });
    expect(out.series.failed).toBeGreaterThanOrEqual(2);
    expect(h.t.db.select().from(marketQuotes).all()).toEqual(before);
    expect(h.t.db.select().from(seriesDayQuotes).all()).toEqual([]);
  });
});

describe('bullion: the first base of a Melbourne day is kept (owner review O14)', () => {
  it('a closed-futures base (the closing spot) survives the reopen fetch', async () => {
    const h = setup();
    const friday = '2026-10-09T20:55:00.000Z';
    const fridayBars = (v: string) => bars('2026-10-09T00:00:00Z', friday, v);
    // Monday 12/10/2026 08:00 AEDT, before the reopen: the quote is Friday's close (2020).
    h.now.iso = '2026-10-11T21:00:00.000Z';
    h.yahoo.answers.set('GC=F', () => ({
      price: '2020',
      currency: 'USD',
      asOf: friday,
      bars: fridayBars('2019'),
    }));
    h.yahoo.answers.set('AUDUSD=X', () => ({
      price: '0.65',
      currency: 'USD',
      asOf: friday,
      bars: fridayBars('0.64'),
    }));
    await h.run({ lite: true, seriesIds: ['AUDUSD', 'GC_USD_OZ'] });
    const closingSpot = roundDerived(new JoinrDecimal('2020').div('0.65'));
    expect(seriesDay(h, 'XAU_AUD_OZ')).toMatchObject({
      sessionDate: '2026-10-12',
      previousClose: closingSpot,
      points: JSON.stringify([[sec('2026-10-11T13:00:00Z'), closingSpot]]),
    });
    // 10:30, after the reopen: the bars-based base (2019 ÷ 0.64) differs; the first base is kept.
    h.now.iso = '2026-10-11T23:30:00.000Z';
    h.yahoo.answers.set('GC=F', () => ({
      price: '2025',
      currency: 'USD',
      asOf: '2026-10-11T23:25:00.000Z',
      bars: [
        ...fridayBars('2019'),
        ...bars('2026-10-11T22:00:00Z', '2026-10-11T23:25:00Z', '2025'),
      ],
    }));
    h.yahoo.answers.set('AUDUSD=X', () => ({
      price: '0.65',
      currency: 'USD',
      asOf: '2026-10-11T23:25:00.000Z',
      bars: [
        ...fridayBars('0.64'),
        ...bars('2026-10-11T21:00:00Z', '2026-10-11T23:25:00Z', '0.65'),
      ],
    }));
    await h.run({ lite: true, seriesIds: ['AUDUSD', 'GC_USD_OZ'] });
    const row = seriesDay(h, 'XAU_AUD_OZ')!;
    expect(row.previousClose).toBe(closingSpot);
    const points = JSON.parse(row.points) as Array<[number, string]>;
    expect(points[0]).toEqual([sec('2026-10-11T13:00:00Z'), closingSpot]);
    expect(points.at(-1)).toEqual([
      sec('2026-10-11T23:25:00Z'),
      roundDerived(new JoinrDecimal('2025').div('0.65')),
    ]);
  });
});

describe('the five-day fallback through a refresh (§5.1)', () => {
  it('on chart.error for the 5m URL: the 5d price is written, no day, one attempt', async () => {
    const t = createTestDb();
    open.push(t);
    const { instrumentIds: ids } = seedGenericData(t.db, { now: new Date(NOW) });
    const { fetchImpl, calls } = mockFetch((url) =>
      url.searchParams.get('interval') === '5m'
        ? jsonResponse(chartErrorBody())
        : jsonResponse(
            chartBody({
              symbol: 'ABC.AX',
              timestamps: ['2030-09-11T00:00:00Z', '2030-09-12T00:00:00Z'],
              closes: [12.9, 13],
              dataGranularity: '1d',
              marketTime: NOW,
            }),
          ),
    );
    const out = await runRefresh(
      {
        db: t.db,
        providers: {
          yahoo: createYahooProvider({ fetchImpl, sleep: noSleep, now: () => new Date(NOW) }),
          coingecko: scriptedProvider('coingecko'),
        },
        cooldowns: new Cooldowns(),
        now: () => new Date(NOW),
        sleep: noSleep,
        signal: new AbortController().signal,
        log: silentLogger(),
        timeZone: MELBOURNE,
      },
      { lite: true, instrumentIds: [ids['ASX:ABC']!] },
    );
    expect(calls).toHaveLength(2);
    expect(out).toMatchObject({ requested: 1, ok: 1, failed: 0 });
    expect(
      t.db.select().from(prices).where(eq(prices.instrumentId, ids['ASX:ABC']!)).get(),
    ).toMatchObject({
      price: '13',
      consecutiveFailures: 0,
    });
    expect(t.db.select().from(dayQuotes).all()).toEqual([]);
  });
});
