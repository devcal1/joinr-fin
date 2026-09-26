// The dividend-events parser, the events request and the fake events (stage-3.md §4.6, §7.5).
// Generic JSON shaped like Yahoo's `v8/finance/chart?events=div` response; no network.
import { describe, expect, it } from 'vitest';
import { eventsPeriod } from '../../src/market/dividends/client';
import {
  localDateInZone,
  localDateWithOffset,
  parseYahooDividends,
} from '../../src/market/dividends/parse';
import {
  fakeDividendAmount,
  fakeDividendEvents,
  fakePrice,
  fnv1a,
} from '../../src/market/providers/fake';
import { yahooDividendsUrl } from '../../src/market/providers/yahoo';
import { unix } from './helpers';

const SYDNEY = 'Australia/Sydney';

interface BodyOptions {
  symbol?: string;
  currency?: string | null;
  timeZone?: string | null;
  gmtoffset?: number | null;
  /** [UTC timestamp, close] pairs, in Yahoo's order. */
  bars?: Array<[string, number | null]>;
  /** [UTC timestamp, amount] pairs; `amount` is passed through as is. */
  events?: Array<[string, unknown]>;
  /** Replace the whole `events.dividends` container. */
  dividends?: unknown;
}

/** A body like the real chart response (only the fields the parser reads, plus decoys). */
function chartBody(o: BodyOptions = {}): unknown {
  const bars = o.bars ?? [];
  const meta: Record<string, unknown> = {
    symbol: o.symbol ?? 'ABC.AX',
    exchangeName: 'ASX',
    instrumentType: 'ETF',
    timezone: 'AEST',
    regularMarketPrice: 12,
    regularMarketTime: unix('2026-09-24T06:10:00.000Z'),
  };
  if (o.currency !== null) meta.currency = o.currency ?? 'AUD';
  if (o.timeZone !== null) meta.exchangeTimezoneName = o.timeZone ?? SYDNEY;
  if (o.gmtoffset !== null) meta.gmtoffset = o.gmtoffset ?? 36000;
  const dividends =
    o.dividends ??
    Object.fromEntries(
      (o.events ?? []).map(([ts, amount]) => [String(unix(ts)), { amount, date: unix(ts) }]),
    );
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: bars.map(([ts]) => unix(ts)),
          events: { dividends },
          indicators: {
            quote: [{ close: bars.map(([, c]) => c), open: bars.map(() => 1) }],
            // Decoy: the adjusted close is never used.
            adjclose: [{ adjclose: bars.map(([, c]) => (c === null ? null : c / 2)) }],
          },
        },
      ],
      error: null,
    },
  };
}

function okEvents(body: unknown) {
  const parsed = parseYahooDividends(body);
  if (!parsed.ok) throw new Error(`expected ok, got ${parsed.error}`);
  return parsed.events;
}

describe('local dates', () => {
  it('uses the exchange time zone, so a daylight-saving 10:00 bar keeps its local date', () => {
    // 10:00 AEDT on 02/01/2025 is 23:00 UTC the day before.
    expect(localDateInZone(unix('2025-01-01T23:00:00Z'), SYDNEY)).toBe('2025-01-02');
    // 10:00 AEST on 01/07/2025 is 00:00 UTC the same day.
    expect(localDateInZone(unix('2025-07-01T00:00:00Z'), SYDNEY)).toBe('2025-07-01');
    expect(localDateInZone(unix('2025-07-01T00:00:00Z'), 'America/New_York')).toBe('2025-06-30');
  });

  it('returns null for an unknown zone or an unusable timestamp', () => {
    expect(localDateInZone(unix('2025-07-01T00:00:00Z'), 'Not/AZone')).toBeNull();
    expect(localDateInZone(0, SYDNEY)).toBeNull();
    expect(localDateInZone(Number.NaN, SYDNEY)).toBeNull();
    expect(localDateInZone(1e15, SYDNEY)).toBeNull();
  });

  it('shifts by a fixed offset for the gmtoffset fallback', () => {
    expect(localDateWithOffset(unix('2025-01-01T23:00:00Z'), 39600)).toBe('2025-01-02');
    expect(localDateWithOffset(unix('2025-01-01T23:00:00Z'), 36000)).toBe('2025-01-02');
    expect(localDateWithOffset(unix('2025-01-01T12:00:00Z'), -18000)).toBe('2025-01-01');
    expect(localDateWithOffset(-5, 0)).toBeNull();
  });
});

describe('parseYahooDividends', () => {
  it('dates events and closes in the exchange zone under daylight saving (never the UTC date)', () => {
    const events = okEvents(
      chartBody({
        // Mon 30/12, Tue 31/12, (Wed 01/01 holiday), Thu 02/01 at 10:00 AEDT.
        bars: [
          ['2024-12-29T23:00:00Z', 10],
          ['2024-12-30T23:00:00Z', 10.5],
          ['2025-01-01T23:00:00Z', 9.75],
        ],
        events: [['2025-01-01T23:00:00Z', 0.25]],
      }),
    );
    expect(events).toEqual([
      {
        exDate: '2025-01-02',
        amountPerUnit: '0.25',
        currency: 'AUD',
        closeBeforeEx: '10.5',
        closeDate: '2024-12-31',
      },
    ]);
  });

  it('dates events in standard time', () => {
    const events = okEvents(
      chartBody({
        bars: [
          ['2025-06-27T00:00:00Z', 20],
          ['2025-06-30T00:00:00Z', 21],
          ['2025-07-01T00:00:00Z', 19],
        ],
        events: [['2025-07-01T00:00:00Z', 0.5]],
      }),
    );
    expect(events).toEqual([
      {
        exDate: '2025-07-01',
        amountPerUnit: '0.5',
        currency: 'AUD',
        closeBeforeEx: '21',
        closeDate: '2025-06-30',
      },
    ]);
  });

  it('takes the close before the ex-date across a weekend and a holiday', () => {
    const events = okEvents(
      chartBody({
        bars: [
          ['2025-04-17T00:00:00Z', 30], // Thu (Fri 18 and Mon 21 are holidays)
          ['2025-04-22T00:00:00Z', 29], // Tue
          ['2025-07-04T00:00:00Z', 31], // Fri
          ['2025-07-07T00:00:00Z', 30.5], // Mon
        ],
        events: [
          ['2025-07-07T00:00:00Z', 0.4],
          ['2025-04-22T00:00:00Z', 0.35],
        ],
      }),
    );
    expect(events.map((e) => [e.exDate, e.closeBeforeEx, e.closeDate])).toEqual([
      ['2025-04-22', '30', '2025-04-17'],
      ['2025-07-07', '31', '2025-07-04'],
    ]);
  });

  it('has no close when the first bar is the ex-date', () => {
    const events = okEvents(
      chartBody({
        bars: [
          ['2025-07-01T00:00:00Z', 19],
          ['2025-07-02T00:00:00Z', 19.5],
        ],
        events: [['2025-07-01T00:00:00Z', 0.5]],
      }),
    );
    expect(events[0]).toMatchObject({ exDate: '2025-07-01', closeBeforeEx: null, closeDate: null });
  });

  it('skips null and non-positive closes', () => {
    const events = okEvents(
      chartBody({
        bars: [
          ['2025-06-26T00:00:00Z', 18],
          ['2025-06-27T00:00:00Z', 0],
          ['2025-06-30T00:00:00Z', null],
          ['2025-07-01T00:00:00Z', 19],
        ],
        events: [['2025-07-01T00:00:00Z', 0.5]],
      }),
    );
    expect(events[0]).toMatchObject({ closeBeforeEx: '18', closeDate: '2025-06-26' });
  });

  it('skips non-finite, zero, negative and non-numeric amounts', () => {
    const events = okEvents(
      chartBody({
        events: [
          ['2025-01-01T23:00:00Z', Number.POSITIVE_INFINITY],
          ['2025-04-01T00:00:00Z', Number.NaN],
          ['2025-07-01T00:00:00Z', 0],
          ['2025-10-01T00:00:00Z', -0.5],
          ['2025-10-02T00:00:00Z', '0.5'],
          ['2025-10-03T00:00:00Z', null],
          ['2025-10-06T23:00:00Z', 0.30000000000000004],
        ],
      }),
    );
    expect(events).toEqual([
      {
        exDate: '2025-10-07',
        amountPerUnit: '0.3',
        currency: 'AUD',
        closeBeforeEx: null,
        closeDate: null,
      },
    ]);
  });

  it('adds amounts on the same local ex-date and returns events oldest first', () => {
    const events = okEvents(
      chartBody({
        events: [
          ['2025-07-01T05:00:00Z', 0.1],
          ['2025-01-01T23:00:00Z', 0.2],
          ['2025-07-01T00:00:00Z', 0.25],
        ],
      }),
    );
    expect(events.map((e) => [e.exDate, e.amountPerUnit])).toEqual([
      ['2025-01-02', '0.2'],
      ['2025-07-01', '0.35'],
    ]);
  });

  it('accepts the events as an array too and ignores malformed entries', () => {
    const events = okEvents(
      chartBody({
        dividends: [{ amount: 0.2, date: unix('2025-07-01T00:00:00Z') }, 'x', null, { amount: 1 }],
      }),
    );
    expect(events.map((e) => e.exDate)).toEqual(['2025-07-01']);
  });

  it('keeps a pence currency as reported', () => {
    const events = okEvents(
      chartBody({
        symbol: 'ABC.L',
        currency: 'GBp',
        timeZone: 'Europe/London',
        gmtoffset: 3600,
        bars: [['2025-06-30T07:00:00Z', 250]],
        events: [['2025-07-03T07:00:00Z', 5.5]],
      }),
    );
    expect(events).toEqual([
      {
        exDate: '2025-07-03',
        amountPerUnit: '5.5',
        currency: 'GBp',
        closeBeforeEx: '250',
        closeDate: '2025-06-30',
      },
    ]);
  });

  it('falls back to gmtoffset, then to the suffix zone, for the local dates', () => {
    const event: Array<[string, unknown]> = [['2025-01-01T23:00:00Z', 0.25]];
    const byOffset = okEvents(chartBody({ timeZone: null, gmtoffset: 39600, events: event }));
    expect(byOffset[0]!.exDate).toBe('2025-01-02');
    const badZone = okEvents(chartBody({ timeZone: 'Not/AZone', gmtoffset: 36000, events: event }));
    expect(badZone[0]!.exDate).toBe('2025-01-02');
    const bySuffix = okEvents(chartBody({ timeZone: null, gmtoffset: null, events: event }));
    expect(bySuffix[0]!.exDate).toBe('2025-01-02');
    expect(
      parseYahooDividends(
        chartBody({ symbol: 'ABC', timeZone: null, gmtoffset: null, events: event }),
      ),
    ).toEqual({ ok: false, error: 'No exchange time zone in response', retryable: false });
  });

  it('infers the currency from the suffix when meta has none', () => {
    const event: Array<[string, unknown]> = [['2025-07-01T00:00:00Z', 0.25]];
    expect(okEvents(chartBody({ currency: null, events: event }))[0]!.currency).toBe('AUD');
    expect(
      parseYahooDividends(chartBody({ symbol: 'ABC', currency: null, events: event })),
    ).toEqual({ ok: false, error: 'No currency in response', retryable: false });
  });

  it('succeeds with no events (none paid, or no time zone needed)', () => {
    expect(parseYahooDividends(chartBody({ bars: [['2025-07-01T00:00:00Z', 19]] }))).toEqual({
      ok: true,
      events: [],
    });
    const noEventsBlock = chartBody();
    delete (noEventsBlock as { chart: { result: Array<Record<string, unknown>> } }).chart.result[0]!
      .events;
    expect(parseYahooDividends(noEventsBlock)).toEqual({ ok: true, events: [] });
    expect(
      parseYahooDividends(chartBody({ symbol: 'ABC', timeZone: null, gmtoffset: null })),
    ).toEqual({ ok: true, events: [] });
  });

  it('maps chart.error, a missing result and malformed bodies', () => {
    expect(
      parseYahooDividends({
        chart: { result: null, error: { code: 'Not Found', description: 'No data found' } },
      }),
    ).toEqual({ ok: false, error: 'Symbol not found', retryable: false });
    expect(parseYahooDividends({ chart: { result: [], error: null } })).toEqual({
      ok: false,
      error: 'Symbol not found',
      retryable: false,
    });
    expect(parseYahooDividends({ chart: { result: [{}], error: null } })).toEqual({
      ok: false,
      error: 'Symbol not found',
      retryable: false,
    });
    for (const body of ['<html>', null, [], { nope: 1 }]) {
      expect(parseYahooDividends(body)).toEqual({
        ok: false,
        error: 'Malformed response',
        retryable: true,
      });
    }
  });
});

describe('the events request', () => {
  it('asks the fixed host for daily bars and dividend events between two unix times', () => {
    const url = new URL(yahooDividendsUrl('ABC.AX', 1735689600, 1790215200));
    expect(url.origin).toBe('https://query1.finance.yahoo.com');
    expect(url.pathname).toBe('/v8/finance/chart/ABC.AX');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      period1: '1735689600',
      period2: '1790215200',
      interval: '1d',
      events: 'div',
    });
    expect(new URL(yahooDividendsUrl('../../evil.example/x?y=1#', 0, 1)).host).toBe(
      'query1.finance.yahoo.com',
    );
    expect(() => yahooDividendsUrl('ABC.AX', 1.5, 2)).toThrow(RangeError);
  });

  it('starts 14 days before the first trade and ends now', () => {
    const now = new Date('2026-09-24T02:00:00.500Z');
    expect(eventsPeriod('2025-01-15', now)).toEqual({
      period1: unix('2025-01-01T00:00:00Z'),
      period2: unix('2026-09-24T02:00:00Z'),
    });
    // Never negative, never after period2.
    expect(eventsPeriod('1900-01-01', now).period1).toBe(0);
    expect(eventsPeriod('2026-10-30', now).period1).toBe(unix('2026-09-24T02:00:00Z'));
    expect(() => eventsPeriod('15/01/2025', now)).toThrow(RangeError);
  });
});

describe('fake dividend events', () => {
  it('pays 0.1 + (fnv1a(symbol) % 50) / 100 AUD per unit, deterministically', () => {
    for (const symbol of ['ABC.AX', 'XYZ.AX', 'EXAMPLEFUND']) {
      const expected = (10 + (fnv1a(symbol) % 50)) / 100;
      expect(Number(fakeDividendAmount(symbol))).toBeCloseTo(expected, 10);
    }
    const now = new Date('2026-09-24T02:00:00Z');
    expect(fakeDividendEvents('ABC.AX', now)).toEqual(fakeDividendEvents('ABC.AX', now));
  });

  it('puts an ex-date on the first weekday of each quarter for two years up to now', () => {
    const events = fakeDividendEvents('ABC.AX', new Date('2024-01-15T00:00:00Z'));
    expect(events.map((e) => [e.exDate, e.closeDate])).toEqual([
      ['2022-04-01', '2022-03-31'],
      ['2022-07-01', '2022-06-30'],
      ['2022-10-03', '2022-09-30'], // 1 October 2022 was a Saturday
      ['2023-01-02', '2022-12-30'], // 1 January 2023 was a Sunday
      ['2023-04-03', '2023-03-31'],
      ['2023-07-03', '2023-06-30'],
      ['2023-10-02', '2023-09-29'],
      ['2024-01-01', '2023-12-29'],
    ]);
    for (const e of events) {
      expect(e).toMatchObject({
        amountPerUnit: fakeDividendAmount('ABC.AX'),
        currency: 'AUD',
        closeBeforeEx: fakePrice('ABC.AX'),
      });
    }
  });

  it('includes both ends of the two-year window', () => {
    const events = fakeDividendEvents('XYZ.AX', new Date('2026-10-01T05:00:00Z'));
    expect(events).toHaveLength(9);
    expect(events[0]!.exDate).toBe('2024-10-01');
    expect(events.at(-1)!.exDate).toBe('2026-10-01');
  });
});
