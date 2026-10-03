import { describe, expect, it } from 'vitest';
import {
  convertToAud,
  deriveSeries,
  divideDecimals,
  fxCurrencyOfSeries,
  fxNeedFor,
  roundDerived,
} from '../../src/market/fx';
import { createFakeProvider, fakePrice, fnv1a } from '../../src/market/providers/fake';
import { clockSleep, parseRetryAfter, truncateError } from '../../src/market/providers/http';
import {
  isFresh,
  localDaysSince,
  priceStatus,
  quoteStatus,
  type PriceStatusInput,
} from '../../src/market/status';
import { JoinrDecimal } from '@joinr/schema';
import { manualClock } from './helpers';

/** Local time (freshness uses the server's local weekdays). */
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min);
}

describe('fake provider', () => {
  const now = new Date('2026-09-24T07:00:00.000Z');
  const fake = createFakeProvider({ now: () => now });

  it('is deterministic: 1 + (fnv1a(symbol) % 99900) / 100 in AUD', async () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c); // the published FNV-1a test vector
    const expected = new JoinrDecimal(fnv1a('ABC.AX') % 99900).div(100).plus(1).toFixed();
    expect(fakePrice('ABC.AX')).toBe(expected);
    const { quotes } = await fake.fetchQuotes(
      [{ key: '1', symbol: 'ABC.AX' }],
      new AbortController().signal,
    );
    // Stage 9 (§5.3): the as-of is the last point of the fake session (16:10 Sydney; now is 17:00).
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      key: '1',
      price: fakePrice('ABC.AX'),
      currency: 'AUD',
      asOf: '2026-09-24T06:10:00.000Z',
      day: { sessionDate: '2026-09-24' },
    });
    const n = Number(fakePrice('bitcoin'));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(1000);
  });

  it('prices AUDUSD=X at 0.65 and the bullion futures in USD', async () => {
    const { quotes } = await fake.fetchQuotes(
      [
        { key: 'AUDUSD', symbol: 'AUDUSD=X' },
        { key: 'SI', symbol: 'SI=F' },
        { key: 'GC', symbol: 'GC=F' },
        { key: 'FX', symbol: 'GBPAUD=X' },
      ],
      new AbortController().signal,
    );
    expect(quotes.map((q) => [q.key, q.currency])).toEqual([
      ['AUDUSD', 'USD'],
      ['SI', 'USD'],
      ['GC', 'USD'],
      ['FX', 'AUD'],
    ]);
    expect(quotes[0]!.price).toBe('0.65');
  });

  it('search returns the symbol in lower case', async () => {
    expect(await fake.searchId('ETH', new AbortController().signal)).toEqual({
      ok: true,
      id: 'eth',
    });
  });
});

describe('fx', () => {
  const rates = {
    audUsd: '0.65',
    cross: (ccy: string) => ({ GBP: '2', NZD: '0.9' })[ccy] ?? null,
  };

  it('keeps AUD, divides USD by AUDUSD and multiplies other currencies by FX_<CCY>AUD', () => {
    expect(convertToAud('12.5', 'AUD', rates)).toEqual({ price: '12.5', fxRate: '1' });
    expect(convertToAud('48.75', 'USD', rates)).toEqual({ price: '75', fxRate: '1.538461538462' });
    expect(convertToAud('10', 'NZD', rates)).toEqual({ price: '9', fxRate: '0.9' });
  });

  it('converts London pence (GBp / GBX) via GBP', () => {
    expect(convertToAud('250', 'GBp', rates)).toEqual({ price: '5', fxRate: '0.02' });
    expect(convertToAud('250', 'GBX', rates)).toEqual({ price: '5', fxRate: '0.02' });
    expect(fxNeedFor('GBp')).toEqual({ kind: 'cross', ccy: 'GBP' });
  });

  it('fails without the rate it needs', () => {
    expect(convertToAud('1', 'USD', { audUsd: null, cross: () => null })).toEqual({
      error: 'No FX rate for USD',
    });
    expect(convertToAud('1', 'EUR', rates)).toEqual({ error: 'No FX rate for EUR' });
    expect(convertToAud('1', 'US$', rates)).toMatchObject({
      error: expect.stringMatching(/^Unsupported currency/) as string,
    });
  });

  it('derives a series from two inputs with the older as-of', () => {
    expect(
      deriveSeries(
        { value: '30', asOf: '2026-09-24T04:00:00.000Z' },
        { value: '0.65', asOf: '2026-09-23T20:00:00.000Z' },
      ),
    ).toEqual({ value: '46.153846153846', asOf: '2026-09-23T20:00:00.000Z' });
    expect(deriveSeries(null, { value: '0.65', asOf: 'x' })).toBeNull();
    expect(divideDecimals('1', '0')).toBeNull();
  });

  it('rounds to 12 dp, or 12 significant digits below 1', () => {
    expect(roundDerived(new JoinrDecimal(2).div(3))).toBe('0.666666666667');
    expect(roundDerived(new JoinrDecimal('0.0000000123456789012345'))).toBe(
      '0.0000000123456789012',
    );
    expect(roundDerived(new JoinrDecimal(200).div(3))).toBe('66.666666666667');
  });

  it('recognises dynamic FX series ids', () => {
    expect(fxCurrencyOfSeries('FX_GBPAUD')).toBe('GBP');
    expect(fxCurrencyOfSeries('AUDUSD')).toBeNull();
  });
});

describe('http helpers', () => {
  it('parses Retry-After seconds and dates', () => {
    const now = new Date('2026-09-24T07:00:00.000Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter(new Date(now.getTime() + 5_000).toUTCString(), now)).toBe(5_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('caps error texts at 200 characters', () => {
    expect(truncateError('x'.repeat(500))).toHaveLength(200);
    expect(truncateError('short')).toBe('short');
  });

  it('sleeps on the injected clock and wakes early on abort', async () => {
    const clock = manualClock('2026-09-24T07:00:00.000Z');
    const sleep = clockSleep(clock);
    let done = false;
    const p = sleep(250, new AbortController().signal).then(() => (done = true));
    expect(clock.pending()).toEqual([{ ms: 250 }]);
    clock.fire();
    await p;
    expect(done).toBe(true);

    const controller = new AbortController();
    const q = sleep(1_000, controller.signal);
    controller.abort();
    await q;
    expect(clock.pending()).toEqual([]);
  });
});

describe('freshness', () => {
  const tue = local(2026, 9, 22, 10); // Tuesday
  const mon = local(2026, 9, 21, 10);
  const sat = local(2026, 9, 26, 10);
  const sun = local(2026, 9, 27, 10);
  const iso = (d: Date) => d.toISOString();

  it('market: fresh from 00:00 on the previous weekday', () => {
    expect(isFresh(iso(local(2026, 9, 21, 0, 0)), 'market', tue)).toBe(true); // Mon 00:00
    expect(isFresh(iso(local(2026, 9, 20, 23, 59)), 'market', tue)).toBe(false); // Sun night
  });

  it('market: on Monday the previous Friday counts', () => {
    expect(isFresh(iso(local(2026, 9, 18, 16)), 'market', mon)).toBe(true); // Fri close
    expect(isFresh(iso(local(2026, 9, 17, 16)), 'market', mon)).toBe(false); // Thu
  });

  it('market: on Saturday and Sunday Friday counts', () => {
    expect(isFresh(iso(local(2026, 9, 25, 16)), 'market', sat)).toBe(true);
    expect(isFresh(iso(local(2026, 9, 25, 16)), 'market', sun)).toBe(true);
    expect(isFresh(iso(local(2026, 9, 24, 16)), 'market', sun)).toBe(false);
  });

  it('crypto: fresh for 3 hours', () => {
    expect(isFresh(iso(new Date(tue.getTime() - 3 * 3_600_000)), 'crypto', tue)).toBe(true);
    expect(isFresh(iso(new Date(tue.getTime() - 3 * 3_600_000 - 1_000)), 'crypto', tue)).toBe(
      false,
    );
  });

  it('counts local calendar days for manual prices', () => {
    expect(localDaysSince('2026-09-22', tue)).toBe(0);
    expect(localDaysSince('2026-08-22', tue)).toBe(31);
    expect(localDaysSince('2026-09-23', tue)).toBe(-1);
  });
});

describe('priceStatus', () => {
  const now = local(2026, 9, 24, 12); // Thursday
  const fetched = (over: Partial<NonNullable<PriceStatusInput['fetched']>> = {}) => ({
    price: '10',
    asOf: local(2026, 9, 24, 10).toISOString(),
    source: 'yahoo' as const,
    lastStatus: 'ok' as const,
    ...over,
  });
  const status = (i: Partial<PriceStatusInput>) =>
    priceStatus({ manual: null, fetched: null, rule: 'market', ...i }, now);

  it('manual wins: manual within 31 days, stale after', () => {
    expect(status({ manual: { asOf: '2026-08-24' }, fetched: fetched() })).toBe('manual');
    expect(status({ manual: { asOf: '2026-08-23' }, fetched: fetched() })).toBe('stale');
  });

  it('no good price: failed after an error, else none', () => {
    expect(status({})).toBe('none');
    expect(status({ fetched: fetched({ price: null, lastStatus: 'never' }) })).toBe('none');
    expect(status({ fetched: fetched({ price: null, lastStatus: 'error' }) })).toBe('failed');
  });

  it('a workbook price is stale', () => {
    expect(status({ fetched: fetched({ source: 'sheet' }) })).toBe('stale');
  });

  it('fresh, then stale or failed by the last attempt', () => {
    expect(status({ fetched: fetched() })).toBe('fresh');
    expect(status({ fetched: fetched({ lastStatus: 'error' }) })).toBe('fresh');
    const old = local(2026, 9, 20, 10).toISOString();
    expect(status({ fetched: fetched({ asOf: old }) })).toBe('stale');
    expect(status({ fetched: fetched({ asOf: old, lastStatus: 'error' }) })).toBe('failed');
  });

  it('crypto uses the 3-hour rule', () => {
    const fourHoursAgo = new Date(now.getTime() - 4 * 3_600_000).toISOString();
    expect(
      status({ fetched: fetched({ asOf: fourHoursAgo, source: 'coingecko' }), rule: 'crypto' }),
    ).toBe('stale');
    expect(status({ fetched: fetched({ asOf: fourHoursAgo }), rule: 'market' })).toBe('fresh');
  });

  it('series status follows the market rule', () => {
    expect(quoteStatus(null, now)).toBe('none');
    expect(quoteStatus({ value: null, asOf: null, lastStatus: 'error' }, now)).toBe('failed');
    expect(
      quoteStatus(
        { value: '0.65', asOf: local(2026, 9, 24, 1).toISOString(), lastStatus: 'ok' },
        now,
      ),
    ).toBe('fresh');
    expect(
      quoteStatus({ value: '0.65', asOf: local(2026, 9, 1).toISOString(), lastStatus: 'ok' }, now),
    ).toBe('stale');
    expect(
      quoteStatus(
        { value: '0.65', asOf: local(2026, 9, 1).toISOString(), lastStatus: 'error' },
        now,
      ),
    ).toBe('failed');
  });
});
