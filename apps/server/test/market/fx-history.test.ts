// Stage 4 FX closes (stage-4.md §4.6, §7.5 step 1): `parseYahooCloses` (exchange-local dates), the
// last close on or before a date, the rate helpers, the attempt times and the Yahoo and fake
// FX-closes clients. Generic JSON shaped like Yahoo's daily `v8/finance/chart` response; no network.
import { JoinrDecimal } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  FX_BACKFILL_RETRY_MS,
  FxBackfillAttempts,
  fxBackfillAttemptsFor,
  fxFetchCurrency,
  lastCloseOnOrBefore,
  localIsoDate,
  purchaseFxRateFrom,
} from '../../src/market/fxHistory';
import { createFakeFxClosesClient, fakeFxClose, fakePrice } from '../../src/market/providers/fake';
import { BROWSER_USER_AGENT } from '../../src/market/providers/http';
import { FxClosesError, type FxClosesClient } from '../../src/market/providers/types';
import {
  createYahooFxClosesClient,
  parseYahooCloses,
  yahooFxClosesUrl,
  yahooFxPairSymbol,
} from '../../src/market/providers/yahoo';
import {
  hangingResponse,
  jsonResponse,
  mockFetch,
  noSleep,
  settableClock,
  unix,
  yahooNotFound,
  yahooSymbolOf,
  type FetchHandler,
} from './helpers';

const LONDON = 'Europe/London';

interface FxBodyOptions {
  symbol?: string;
  timeZone?: string | null;
  gmtoffset?: number | null;
  /** [UTC timestamp, close] pairs, in Yahoo's order. */
  bars: Array<[string, number | null | string]>;
}

/** A daily FX chart body like the real response (only the fields the parser reads, plus decoys). */
function fxBody(o: FxBodyOptions): unknown {
  const meta: Record<string, unknown> = {
    currency: 'AUD',
    symbol: o.symbol ?? 'USDAUD=X',
    exchangeName: 'CCY',
    instrumentType: 'CURRENCY',
    timezone: 'BST',
    regularMarketPrice: 1.5,
    regularMarketTime: unix('2026-06-15T10:00:00.000Z'),
  };
  if (o.timeZone !== null) meta.exchangeTimezoneName = o.timeZone ?? LONDON;
  if (o.gmtoffset !== null) meta.gmtoffset = o.gmtoffset ?? 3600;
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: o.bars.map(([ts]) => unix(ts)),
          indicators: {
            quote: [{ close: o.bars.map(([, c]) => c), open: o.bars.map(() => 1) }],
            // Decoy: the adjusted close is never used.
            adjclose: [{ adjclose: o.bars.map(() => 9) }],
          },
        },
      ],
      error: null,
    },
  };
}

function okCloses(body: unknown) {
  const parsed = parseYahooCloses(body);
  if (!parsed.ok) throw new Error(`expected ok, got ${parsed.error}`);
  return parsed.closes;
}

describe('parseYahooCloses', () => {
  it('dates each bar in the exchange time zone, not by its UTC date', () => {
    // Yahoo stamps FX bars at 00:00 London time: 23:00 UTC the day before in summer (BST).
    const closes = okCloses(
      fxBody({
        bars: [
          ['2026-06-10T23:00:00.000Z', 1.5],
          ['2026-06-11T23:00:00.000Z', 1.52],
          ['2026-01-05T00:00:00.000Z', 1.4], // winter (GMT): the UTC date is the local date
        ],
      }),
    );
    expect(closes).toEqual([
      { date: '2026-01-05', close: '1.4' },
      { date: '2026-06-11', close: '1.5' },
      { date: '2026-06-12', close: '1.52' },
    ]);
  });

  it('falls back to gmtoffset when the zone name is missing or unknown', () => {
    const bars: FxBodyOptions['bars'] = [['2026-06-10T23:00:00.000Z', 1.5]];
    expect(okCloses(fxBody({ timeZone: null, gmtoffset: 3600, bars }))).toEqual([
      { date: '2026-06-11', close: '1.5' },
    ]);
    expect(okCloses(fxBody({ timeZone: 'Not/AZone', gmtoffset: 3600, bars }))).toEqual([
      { date: '2026-06-11', close: '1.5' },
    ]);
    // Without either, a symbol with no known suffix has no usable zone.
    expect(parseYahooCloses(fxBody({ timeZone: null, gmtoffset: null, bars }))).toEqual({
      ok: false,
      error: 'No exchange time zone in response',
      retryable: false,
    });
  });

  it('skips null, zero, negative and non-numeric closes and keeps 12 significant digits', () => {
    const closes = okCloses(
      fxBody({
        bars: [
          ['2026-06-07T23:00:00.000Z', null],
          ['2026-06-08T23:00:00.000Z', 0],
          ['2026-06-09T23:00:00.000Z', -1],
          ['2026-06-10T23:00:00.000Z', '1.5'],
          ['2026-06-11T23:00:00.000Z', 1.4712800979614258],
        ],
      }),
    );
    expect(closes).toEqual([{ date: '2026-06-12', close: '1.47128009796' }]);
  });

  it('keeps one close per date (the later bar wins) and sorts oldest first', () => {
    const closes = okCloses(
      fxBody({
        bars: [
          ['2026-06-11T23:00:00.000Z', 1.53],
          ['2026-06-10T23:00:00.000Z', 1.5],
          ['2026-06-12T08:30:00.000Z', 1.531], // the live bar of the same local day
        ],
      }),
    );
    expect(closes).toEqual([
      { date: '2026-06-11', close: '1.5' },
      { date: '2026-06-12', close: '1.531' },
    ]);
  });

  it('answers an empty result with no closes', () => {
    expect(parseYahooCloses(fxBody({ bars: [] }))).toEqual({ ok: true, closes: [] });
    const noArrays = { chart: { result: [{ meta: { currency: 'AUD' } }], error: null } };
    expect(parseYahooCloses(noArrays)).toEqual({ ok: true, closes: [] });
  });

  it('maps chart.error, a missing result and a non-chart body', () => {
    expect(parseYahooCloses(yahooNotFound())).toEqual({
      ok: false,
      error: 'Symbol not found',
      retryable: false,
    });
    expect(parseYahooCloses({ chart: { result: [], error: null } })).toMatchObject({
      ok: false,
      error: 'Symbol not found',
    });
    expect(parseYahooCloses({ chart: { result: [{}], error: null } })).toMatchObject({
      ok: false,
      error: 'Symbol not found',
    });
    expect(parseYahooCloses('<html>')).toEqual({
      ok: false,
      error: 'Malformed response',
      retryable: true,
    });
    expect(parseYahooCloses(null)).toMatchObject({ ok: false, error: 'Malformed response' });
  });
});

describe('lastCloseOnOrBefore', () => {
  // Thu 17, Fri 18, (weekend), Mon 21 September 2026.
  const week = [
    { date: '2026-09-21', close: '1.53' },
    { date: '2026-09-17', close: '1.51' },
    { date: '2026-09-18', close: '1.52' },
  ];

  it('takes Friday for a Saturday or a Sunday, and the day itself on a trading day', () => {
    expect(lastCloseOnOrBefore(week, '2026-09-19')).toEqual({ date: '2026-09-18', close: '1.52' });
    expect(lastCloseOnOrBefore(week, '2026-09-20')?.date).toBe('2026-09-18');
    expect(lastCloseOnOrBefore(week, '2026-09-21')?.date).toBe('2026-09-21');
    expect(lastCloseOnOrBefore(week, '2026-09-30')?.date).toBe('2026-09-21');
  });

  it('steps back over a holiday', () => {
    // No closes on 25 and 26 December 2019 (Wednesday and Thursday holidays).
    const closes = [
      { date: '2019-12-20', close: '1.6' },
      { date: '2019-12-24', close: '1.61' },
      { date: '2019-12-27', close: '1.62' },
    ];
    expect(lastCloseOnOrBefore(closes, '2019-12-25')).toEqual({
      date: '2019-12-24',
      close: '1.61',
    });
    expect(lastCloseOnOrBefore(closes, '2019-12-26')?.date).toBe('2019-12-24');
    expect(lastCloseOnOrBefore(closes, '2019-12-27')?.date).toBe('2019-12-27');
  });

  it('is null before the first close or with no closes', () => {
    expect(lastCloseOnOrBefore(week, '2026-09-16')).toBeNull();
    expect(lastCloseOnOrBefore([], '2026-09-16')).toBeNull();
  });
});

describe('rate helpers', () => {
  it('stores GBX rates per penny (÷ 100), with 12 significant digits', () => {
    expect(purchaseFxRateFrom('2', 'GBX')).toBe('0.02');
    expect(purchaseFxRateFrom('1.9512', 'gbx')).toBe('0.019512');
    expect(purchaseFxRateFrom('1.53846153846153846', 'USD')).toBe('1.53846153846');
    expect(purchaseFxRateFrom('1.6', 'EUR')).toBe('1.6');
  });

  it('fetches GBX as GBP, USD as USD, and nothing for AUD or an unusable code', () => {
    expect(fxFetchCurrency('GBX')).toBe('GBP');
    expect(fxFetchCurrency('USD')).toBe('USD');
    expect(fxFetchCurrency('EUR')).toBe('EUR');
    expect(fxFetchCurrency('AUD')).toBeNull();
    expect(fxFetchCurrency('US$')).toBeNull();
  });

  it('adds calendar days across months, years and leap days', () => {
    expect(addDaysIso('2026-06-13', -10)).toBe('2026-06-03');
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysIso('2026-01-05', -10)).toBe('2025-12-26');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(() => addDaysIso('13/06/2026', 1)).toThrow(RangeError);
  });

  it('formats the server-local calendar date', () => {
    expect(localIsoDate(new Date(2026, 5, 13, 23, 59))).toBe('2026-06-13');
    expect(localIsoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('FxBackfillAttempts', () => {
  it('retries a (currency, date) pair at most once a day', () => {
    const attempts = new FxBackfillAttempts();
    const t0 = new Date('2026-09-24T02:00:00.000Z');
    expect(attempts.lastAttempt('USD', '2026-06-13')).toBeNull();
    expect(attempts.isRecent('USD', '2026-06-13', t0)).toBe(false);
    attempts.record('USD', '2026-06-13', t0);
    expect(attempts.lastAttempt('USD', '2026-06-13')).toBe(t0.getTime());
    const later = (ms: number) => new Date(t0.getTime() + ms);
    expect(attempts.isRecent('USD', '2026-06-13', later(FX_BACKFILL_RETRY_MS - 1))).toBe(true);
    expect(attempts.isRecent('USD', '2026-06-13', later(FX_BACKFILL_RETRY_MS))).toBe(false);
    // Another date or currency is another pair.
    expect(attempts.isRecent('USD', '2026-06-14', t0)).toBe(false);
    expect(attempts.isRecent('GBP', '2026-06-13', t0)).toBe(false);
  });

  it('keeps one set of attempt times per FX-closes client', () => {
    const a = createFakeFxClosesClient({ now: () => new Date() });
    const b = createFakeFxClosesClient({ now: () => new Date() });
    expect(fxBackfillAttemptsFor(a)).toBe(fxBackfillAttemptsFor(a));
    expect(fxBackfillAttemptsFor(a)).not.toBe(fxBackfillAttemptsFor(b));
  });
});

describe('yahoo FX closes request', () => {
  it('uses the <CCY>AUD=X pair on the fixed host (GBX → GBP)', () => {
    expect(yahooFxPairSymbol('USD')).toBe('USDAUD=X');
    expect(yahooFxPairSymbol('GBX')).toBe('GBPAUD=X');
    expect(yahooFxPairSymbol('eur')).toBe('EURAUD=X');
    expect(yahooFxClosesUrl('USD', 1780617600, 1781568000)).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/USDAUD%3DX?period1=1780617600&period2=1781568000&interval=1d',
    );
    // A hostile code cannot change the host or the path.
    const hostile = new URL(yahooFxClosesUrl('../../evil.example/x?y=1#', 1, 2));
    expect(hostile.host).toBe('query1.finance.yahoo.com');
    expect(hostile.pathname.startsWith('/v8/finance/chart/')).toBe(true);
    expect(hostile.pathname.split('/')).toHaveLength(5);
    expect(() => yahooFxClosesUrl('USD', 1.5, 2)).toThrow(RangeError);
  });
});

describe('createYahooFxClosesClient', () => {
  const NOW = new Date('2026-09-24T02:00:00.000Z');
  const run = () => new AbortController().signal;

  function client(
    handler: FetchHandler,
    extra: {
      timeoutMs?: number;
      spacingMs?: number;
      sleep?: typeof noSleep;
      now?: () => Date;
    } = {},
  ) {
    const { fetchImpl, calls } = mockFetch(handler);
    const fx = createYahooFxClosesClient({
      fetchImpl,
      sleep: extra.sleep ?? noSleep,
      now: extra.now ?? (() => NOW),
      timeoutMs: extra.timeoutMs,
      spacingMs: extra.spacingMs ?? 0,
    });
    return { fx, calls };
  }

  async function rejection(p: Promise<unknown>): Promise<FxClosesError> {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(FxClosesError);
      return err as FxClosesError;
    }
    throw new Error('expected a rejection');
  }

  it('requests the window between two dates (00:00 UTC) and returns the parsed closes', async () => {
    const { fx, calls } = client(() =>
      jsonResponse(
        fxBody({
          bars: [
            ['2026-06-10T23:00:00.000Z', 1.5],
            ['2026-06-11T23:00:00.000Z', 1.52],
          ],
        }),
      ),
    );
    const closes = await fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run());
    expect(closes).toEqual([
      { date: '2026-06-11', close: '1.5' },
      { date: '2026-06-12', close: '1.52' },
    ]);
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url.host).toBe('query1.finance.yahoo.com');
    expect(yahooSymbolOf(url)).toBe('USDAUD=X');
    expect(url.searchParams.get('period1')).toBe(String(unix('2026-06-03T00:00:00.000Z')));
    expect(url.searchParams.get('period2')).toBe(String(unix('2026-06-14T00:00:00.000Z')));
    expect(url.searchParams.get('interval')).toBe('1d');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(BROWSER_USER_AGENT);
    expect(calls[0]!.init?.method).toBe('GET');
  });

  it('requests GBX as the GBP pair', async () => {
    const { fx, calls } = client(() => jsonResponse(fxBody({ symbol: 'GBPAUD=X', bars: [] })));
    await expect(fx.fetchCloses('GBX', '2026-06-03', '2026-06-14', run())).resolves.toEqual([]);
    expect(yahooSymbolOf(calls[0]!.url)).toBe('GBPAUD=X');
  });

  it('rejects a 429/403 as rate limited, with Retry-After', async () => {
    const limited = client(() => jsonResponse({}, 429, { 'retry-after': '600' }));
    const err = await rejection(limited.fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run()));
    expect(err).toMatchObject({ kind: 'rate_limited', retryAfterMs: 600_000 });
    const forbidden = client(() => jsonResponse({}, 403));
    const err403 = await rejection(
      forbidden.fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run()),
    );
    expect(err403).toMatchObject({ kind: 'rate_limited', retryAfterMs: undefined });
  });

  it('rejects other errors as failed, with short texts and no URL or body', async () => {
    const cases: Array<[FetchHandler, string]> = [
      [() => jsonResponse(yahooNotFound(), 404), 'Symbol not found'],
      [() => new Response('down with details', { status: 503 }), 'HTTP 503'],
      [() => new Response('<html>not json', { status: 200 }), 'Malformed response'],
      [() => jsonResponse({ chart: { result: null, error: { code: 'x' } } }), 'Symbol not found'],
      [
        () => {
          throw new TypeError('fetch failed https://query1.finance.yahoo.com/secret');
        },
        'Network error',
      ],
    ];
    for (const [handler, message] of cases) {
      const { fx } = client(handler);
      const err = await rejection(fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run()));
      expect(err).toMatchObject({ kind: 'failed', message });
      expect(err.message).not.toMatch(/https?:|yahoo|details|html/i);
    }
  });

  it('times out a request that never answers', async () => {
    const { fx } = client((_url, init) => hangingResponse(init), { timeoutMs: 20 });
    const err = await rejection(fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run()));
    expect(err).toMatchObject({ kind: 'failed', message: 'Request timed out' });
  });

  it('rejects as skipped when the run is aborted, before or during the request', async () => {
    const before = client(() => jsonResponse(fxBody({ bars: [] })));
    const aborted = new AbortController();
    aborted.abort();
    const err = await rejection(
      before.fx.fetchCloses('USD', '2026-06-03', '2026-06-14', aborted.signal),
    );
    expect(err.kind).toBe('skipped');
    expect(before.calls).toHaveLength(0);

    const controller = new AbortController();
    const during = client((_url, init) => {
      controller.abort();
      return hangingResponse(init);
    });
    const err2 = await rejection(
      during.fx.fetchCloses('USD', '2026-06-03', '2026-06-14', controller.signal),
    );
    expect(err2.kind).toBe('skipped');
  });

  it('spaces request starts by the provider spacing', async () => {
    const clock = settableClock('2026-09-24T02:00:00.000Z');
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
      clock.advance(ms);
    };
    const { fx, calls } = client(() => jsonResponse(fxBody({ bars: [] })), {
      spacingMs: 250,
      sleep,
      now: () => clock.now(),
    });
    await fx.fetchCloses('USD', '2026-06-03', '2026-06-14', run());
    expect(slept).toEqual([]); // the first request starts at once
    clock.advance(100);
    await fx.fetchCloses('GBP', '2026-06-03', '2026-06-14', run());
    expect(slept).toEqual([150]); // the rest of the spacing
    clock.advance(1_000);
    await fx.fetchCloses('EUR', '2026-06-03', '2026-06-14', run());
    expect(slept).toEqual([150]); // already spaced
    expect(calls).toHaveLength(3);
  });

  it('refuses a malformed period (a programmer error) without a request', async () => {
    const { fx, calls } = client(() => jsonResponse(fxBody({ bars: [] })));
    await expect(fx.fetchCloses('USD', '03/06/2026', '2026-06-14', run())).rejects.toThrow(
      RangeError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('fake FX closes', () => {
  it('fakeFxClose: 1 ÷ FAKE_AUDUSD for USD, the fake cross rate otherwise (GBX as GBP)', () => {
    const usd = new JoinrDecimal(1).div('0.65').toSignificantDigits(12).toFixed();
    expect(fakeFxClose('USD')).toBe(usd);
    expect(fakeFxClose('USD')).toBe('1.53846153846');
    expect(fakeFxClose('EUR')).toBe(fakePrice('EURAUD=X'));
    expect(fakeFxClose('GBP')).toBe(fakePrice('GBPAUD=X'));
    expect(fakeFxClose('GBX')).toBe(fakePrice('GBPAUD=X'));
  });

  it('returns one close dated the day before period2, never after today', async () => {
    const fake: FxClosesClient = createFakeFxClosesClient({
      now: () => new Date(2026, 8, 24, 12, 0), // local noon, 24/09/2026
    });
    const signal = new AbortController().signal;
    await expect(fake.fetchCloses('USD', '2026-06-03', '2026-06-14', signal)).resolves.toEqual([
      { date: '2026-06-13', close: fakeFxClose('USD') },
    ]);
    // A window reaching past today is dated today.
    await expect(fake.fetchCloses('GBP', '2026-09-15', '2026-09-26', signal)).resolves.toEqual([
      { date: '2026-09-24', close: fakeFxClose('GBP') },
    ]);
  });

  it('rejects as skipped when the run is aborted', async () => {
    const fake = createFakeFxClosesClient({ now: () => new Date() });
    const controller = new AbortController();
    controller.abort();
    await expect(
      fake.fetchCloses('USD', '2026-06-03', '2026-06-14', controller.signal),
    ).rejects.toMatchObject({ kind: 'skipped' });
  });
});
