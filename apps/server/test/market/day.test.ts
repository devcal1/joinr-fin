// Stage 9 day parsing and merging (stage-9.md §5.1, §5.2, §5.4, §5.4a; pure). Hand-made Yahoo and
// CoinGecko shapes from the probes; made-up symbols and prices. The zone is always passed in; the
// process TZ is Melbourne here so a wrong reading of local time would show.
process.env.TZ = 'Australia/Melbourne';

import { DAY_POINTS_MAX } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  bullionDayFrom,
  cryptoDayFrom,
  lastTradingPeriod,
  mergeDayRow,
  midnightOf,
  parseYahooBars,
  parseYahooDailyDay,
  parseYahooDay,
  previousWeekday,
  zonedTimeToEpoch,
  type DayPoint,
  type DayRow,
} from '../../src/market/day';
import { roundDerived } from '../../src/market/fx';
import { JoinrDecimal } from '@joinr/schema';
import { chartBody, everyMinutes, resultOf, sec } from './dayHelpers';

const MELBOURNE = 'Australia/Melbourne';

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
});

describe('zone helpers', () => {
  it('finds 00:00 Melbourne on both sides of the October and April changes', () => {
    expect(
      new Date(midnightOf(new Date('2026-10-03T02:00:00Z'), MELBOURNE)!.ms).toISOString(),
    ).toBe('2026-10-02T14:00:00.000Z');
    expect(
      new Date(midnightOf(new Date('2026-10-04T00:00:00Z'), MELBOURNE)!.ms).toISOString(),
    ).toBe('2026-10-03T14:00:00.000Z');
    expect(
      new Date(midnightOf(new Date('2026-10-05T01:00:00Z'), MELBOURNE)!.ms).toISOString(),
    ).toBe('2026-10-04T13:00:00.000Z');
    expect(
      new Date(midnightOf(new Date('2027-04-04T13:30:00Z'), MELBOURNE)!.ms).toISOString(),
    ).toBe('2027-04-03T13:00:00.000Z');
  });

  it('turns a wall time into an instant across a DST change', () => {
    // 04/10/2026: 02:00 → 03:00; 10:00 local is AEDT (+11).
    expect(new Date(zonedTimeToEpoch('2026-10-04', 10, 0, MELBOURNE)!).toISOString()).toBe(
      '2026-10-03T23:00:00.000Z',
    );
    expect(new Date(zonedTimeToEpoch('2026-10-03', 10, 0, MELBOURNE)!).toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
    expect(previousWeekday('2026-10-05')).toBe('2026-10-02');
  });
});

// ─── Yahoo one-day charts ───────────────────────────────────────────────────────────────────────

/** EXA.AX on Thursday 12/09/2030: 10:00–16:10 Sydney (AEST) = 00:00–06:10Z. */
function asxSession(over: Partial<Parameters<typeof chartBody>[0]> = {}) {
  const timestamps = everyMinutes('2030-09-12T00:00:00Z', '2030-09-12T06:10:00Z');
  const closes = timestamps.map((_, i) => 50 + i / 100);
  return chartBody({
    symbol: 'EXA.AX',
    timestamps,
    closes,
    chartPreviousClose: 49.5,
    previousClose: 49.5,
    exchangeTimezoneName: 'Australia/Sydney',
    tradingPeriods: [['2030-09-12T00:00:00Z', '2030-09-12T06:12:00Z']],
    ...over,
  });
}

describe('parseYahooDay', () => {
  it('reads the session: zone, date, regular period, bars and the previous close', () => {
    const day = parseYahooDay(resultOf(asxSession()), 'AUD')!;
    expect(day).toMatchObject({
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Sydney',
      granularity: '5m',
      nativeCurrency: 'AUD',
      previousClose: '49.5',
      regularStart: '2030-09-12T00:00:00.000Z',
      regularEnd: '2030-09-12T06:12:00.000Z',
    });
    expect(day.points).toHaveLength(75);
    expect(day.points[0]).toEqual([sec('2030-09-12T00:00:00Z'), '50']);
    expect(day.points.at(-1)).toEqual([sec('2030-09-12T06:10:00Z'), '50.74']);
  });

  it('takes the previous close from chartPreviousClose, else previousClose', () => {
    const both = asxSession({ chartPreviousClose: 49.5, previousClose: 48 });
    expect(parseYahooDay(resultOf(both), 'AUD')!.previousClose).toBe('49.5');
    const prevOnly = asxSession({ chartPreviousClose: undefined, previousClose: 48 });
    expect(parseYahooDay(resultOf(prevOnly), 'AUD')!.previousClose).toBe('48');
    const none = asxSession({ chartPreviousClose: undefined, previousClose: undefined });
    expect(parseYahooDay(resultOf(none), 'AUD')!.previousClose).toBeNull();
    // A two-day request reads previousClose first.
    expect(parseYahooDay(resultOf(both), 'AUD', { previousCloseFirst: true })!.previousClose).toBe(
      '48',
    );
  });

  it('skips null closes and drops bars outside the regular period (post-market)', () => {
    const timestamps = [
      '2030-09-12T00:00:00Z',
      '2030-09-12T00:05:00Z',
      '2030-09-12T06:10:00Z',
      '2030-09-12T06:15:00Z',
      '2030-09-12T08:00:00Z',
    ];
    const day = parseYahooDay(
      resultOf(asxSession({ timestamps, closes: [50, null, 51, 52, 53] })),
      'AUD',
    )!;
    expect(day.points).toEqual([
      [sec('2030-09-12T00:00:00Z'), '50'],
      [sec('2030-09-12T06:10:00Z'), '51'],
    ]);
  });

  it('reads tradingPeriods, never currentTradingPeriod (after a close it is the next session)', () => {
    // EXUS queried after its close: the previous session's bars, currentTradingPeriod tomorrow.
    const timestamps = everyMinutes('2030-09-12T13:30:00Z', '2030-09-12T19:55:00Z');
    const body = chartBody({
      symbol: 'EXUS',
      currency: 'USD',
      timestamps,
      closes: timestamps.map(() => 101),
      chartPreviousClose: 100,
      exchangeTimezoneName: 'America/New_York',
      tradingPeriods: [['2030-09-12T13:30:00Z', '2030-09-12T20:00:00Z']],
      currentTradingPeriod: ['2030-09-13T13:30:00Z', '2030-09-13T20:00:00Z'],
    });
    const day = parseYahooDay(resultOf(body), 'USD')!;
    expect(day.sessionDate).toBe('2030-09-12');
    expect(day.timeZone).toBe('America/New_York');
    expect(day.regularStart).toBe('2030-09-12T13:30:00.000Z');
    expect(day.points).toHaveLength(78);
    expect(lastTradingPeriod({ tradingPeriods: { regular: [[{ start: 1, end: 2 }]] } })).toEqual({
      start: 1,
      end: 2,
    });
  });

  it('marks a fund answered at daily granularity as 1d', () => {
    const body = chartBody({
      symbol: '0PEXAMPLE1',
      timestamps: ['2030-09-12T00:00:00Z'],
      closes: [1.515],
      chartPreviousClose: 1.5,
      dataGranularity: '1d',
    });
    expect(parseYahooDay(resultOf(body), 'AUD')).toMatchObject({
      granularity: '1d',
      previousClose: '1.5',
      points: [[sec('2030-09-12T00:00:00Z'), '1.515']],
    });
  });

  it('has no day without bars', () => {
    const body = asxSession({ timestamps: [], closes: [] });
    expect(parseYahooDay(resultOf(body), 'AUD')).toBeNull();
    const nulls = asxSession({ timestamps: ['2030-09-12T00:00:00Z'], closes: [null] });
    expect(parseYahooDay(resultOf(nulls), 'AUD')).toBeNull();
  });

  it('falls back from an unknown zone to the suffix zone, then UTC', () => {
    const bad = asxSession({ exchangeTimezoneName: 'Not/AZone' });
    expect(parseYahooDay(resultOf(bad), 'AUD')!.timeZone).toBe('Australia/Sydney');
    const body = chartBody({
      symbol: 'EXUS',
      timestamps: ['2030-09-12T23:30:00Z'],
      closes: [1],
    });
    expect(parseYahooDay(resultOf(body), 'USD')).toMatchObject({
      timeZone: 'UTC',
      sessionDate: '2030-09-12',
    });
  });

  it('keeps the last DAY_POINTS_MAX points', () => {
    const timestamps = everyMinutes('2030-09-10T00:00:00Z', '2030-09-12T00:00:00Z');
    const body = chartBody({ symbol: 'EXA.AX', timestamps, closes: timestamps.map(() => 2) });
    const day = parseYahooDay(resultOf(body), 'AUD')!;
    expect(day.points).toHaveLength(DAY_POINTS_MAX);
    expect(day.points.at(-1)![0]).toBe(sec('2030-09-12T00:00:00Z'));
  });
});

describe('two-day charts (the bullion inputs, D153)', () => {
  // GC=F-shaped: two New York days, null bars in the daily break, previousClose ≠ chartPreviousClose.
  const day1 = everyMinutes('2030-09-11T04:00:00Z', '2030-09-11T20:55:00Z');
  const day2 = everyMinutes('2030-09-11T22:00:00Z', '2030-09-12T10:00:00Z');
  const timestamps = [...day1, '2030-09-11T21:00:00Z', ...day2];
  const closes = [...day1.map(() => 2000), null, ...day2.map(() => 2010)];
  const body = chartBody({
    symbol: 'GC=F',
    currency: 'USD',
    timestamps,
    closes,
    chartPreviousClose: 1990,
    previousClose: 2001,
    exchangeTimezoneName: 'America/New_York',
    tradingPeriods: [
      ['2030-09-11T04:00:00Z', '2030-09-12T03:59:00Z'],
      ['2030-09-12T04:00:00Z', '2030-09-13T03:59:00Z'],
    ],
  });

  it('reads meta.previousClose first and keeps only the last trading period as the day', () => {
    const day = parseYahooDay(resultOf(body), 'USD', { previousCloseFirst: true })!;
    expect(day.previousClose).toBe('2001');
    expect(day.sessionDate).toBe('2030-09-12');
    expect(day.points[0]![0]).toBe(sec('2030-09-12T04:00:00Z'));
  });

  it('lists every finite bar of both periods for bullionDayFrom', () => {
    const bars = parseYahooBars(resultOf(body));
    expect(bars).toHaveLength(day1.length + day2.length);
    expect(bars[0]).toEqual([sec('2030-09-11T04:00:00Z'), '2000']);
  });
});

describe('parseYahooDailyDay (a fund on the five-day daily chart)', () => {
  const days = [
    '2030-09-09T00:00:00Z',
    '2030-09-10T00:00:00Z',
    '2030-09-11T00:00:00Z',
    '2030-09-12T00:00:00Z',
    '2030-09-13T00:00:00Z',
  ];
  const fund = (closes: Array<number | null>) =>
    resultOf(
      chartBody({
        symbol: '0PEXAMPLE1',
        timestamps: days,
        closes,
        chartPreviousClose: 1.2,
        dataGranularity: '1d',
        exchangeTimezoneName: 'Australia/Sydney',
      }),
    );

  it('takes the NAV from the last finite close and the previous close from the one before', () => {
    // The probe's shape: 5 bars, 2 finite; chartPreviousClose (the close before the window) ignored.
    expect(parseYahooDailyDay(fund([null, 1.5, null, 1.515, null]), 'AUD')).toEqual({
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Sydney',
      granularity: '1d',
      nativeCurrency: 'AUD',
      previousClose: '1.5',
      regularStart: null,
      regularEnd: null,
      points: [[sec('2030-09-12T00:00:00Z'), '1.515']],
    });
  });

  it('has a null previous close with one NAV, and no day with none', () => {
    expect(
      parseYahooDailyDay(fund([null, null, null, 1.515, null]), 'AUD')!.previousClose,
    ).toBeNull();
    expect(parseYahooDailyDay(fund([null, null, null, null, null]), 'AUD')).toBeNull();
  });
});

// ─── Crypto since 00:00 (D142) ──────────────────────────────────────────────────────────────────

/** CoinGecko-style [ms, aud] points every 5 minutes over 24 hours ending at `nowIso`. */
function coinDay(nowIso: string, value: (ms: number) => number): Array<[number, number]> {
  const end = Date.parse(nowIso);
  const out: Array<[number, number]> = [];
  for (let t = Math.ceil((end - 86_400_000) / 300_000) * 300_000; t <= end; t += 300_000) {
    out.push([t, value(t)]);
  }
  return out;
}

describe('cryptoDayFrom', () => {
  it.each([
    [
      'AEST, Saturday 03/10/2026 12:00',
      '2026-10-03T02:00:00Z',
      '2026-10-02T14:00:00Z',
      '2026-10-03',
    ],
    ['AEDT, Monday 05/10/2026 12:00', '2026-10-05T01:00:00Z', '2026-10-04T13:00:00Z', '2026-10-05'],
    ['the October change day', '2026-10-04T05:00:00Z', '2026-10-03T14:00:00Z', '2026-10-04'],
    ['the April change day', '2027-04-04T01:00:00Z', '2027-04-03T13:00:00Z', '2027-04-04'],
  ])('%s: base = the point at 00:00 Melbourne', (_name, now, midnight, date) => {
    const prices = coinDay(now, (t) => 160000 + (t - Date.parse(midnight)) / 60_000);
    const day = cryptoDayFrom(prices, new Date(now), MELBOURNE)!;
    expect(day.sessionDate).toBe(date);
    expect(day.previousClose).toBe('160000');
    expect(day.points[0]).toEqual([sec(midnight), '160000']);
    expect(day.points.every(([t]) => t >= sec(midnight))).toBe(true);
    expect(day.points.at(-1)![0]).toBe(sec(now));
    expect(day).toMatchObject({ granularity: '5m', nativeCurrency: 'AUD', timeZone: MELBOURNE });
  });

  it('23:30 on 04/04/2027 (the 25-hour day): days=1 starts after midnight, so no base', () => {
    const now = '2027-04-04T13:30:00Z'; // 23:30 AEST; midnight was 13:00Z the day before
    const day = cryptoDayFrom(
      coinDay(now, () => 150000),
      new Date(now),
      MELBOURNE,
    )!;
    expect(day.previousClose).toBeNull();
    expect(day.sessionDate).toBe('2027-04-04');
    expect(day.points[0]![0]).toBeGreaterThan(sec('2027-04-03T13:00:00Z'));
    // The stored same-session row keeps its base (the first non-null base of the session).
    const stored: DayRow = {
      ...day,
      previousClose: '149000',
      points: [[sec('2027-04-03T13:00:00Z'), '149000']],
    };
    const merged = mergeDayRow(stored, day, 'midnight')!;
    expect(merged.previousClose).toBe('149000');
    expect(merged.points[0]).toEqual([sec('2027-04-03T13:00:00Z'), '149000']);
  });

  it('writes no row for an empty series', () => {
    expect(cryptoDayFrom([], new Date('2026-10-03T02:00:00Z'), MELBOURNE)).toBeNull();
  });
});

// ─── Bullion since 00:00 (§5.4a, D153) ──────────────────────────────────────────────────────────

/** Five-minute bars between two instants (inclusive), skipping the futures' weekend. */
function bars(fromIso: string, toIso: string, value: (t: number) => number): DayPoint[] {
  return everyMinutes(fromIso, toIso).map((iso) => [sec(iso), String(value(sec(iso)))]);
}

const spotOf = (f: string, x: string) => roundDerived(new JoinrDecimal(f).div(x));

describe('bullionDayFrom', () => {
  it('00:05 on a weekday: base = F(00:00) ÷ X(00:00); points since midnight', () => {
    // Wednesday 07/10/2026 00:05 AEDT; midnight = 13:00Z on 06/10.
    const now = new Date('2026-10-06T13:05:00Z');
    const futuresBars = bars('2026-10-05T13:00:00Z', '2026-10-06T13:05:00Z', (t) =>
      t <= sec('2026-10-06T13:00:00Z') ? 2000 : 2002,
    );
    const audUsdBars = bars('2026-10-05T13:00:00Z', '2026-10-06T13:05:00Z', () => 0.65);
    const day = bullionDayFrom({
      futuresBars,
      audUsdBars,
      futures: { price: '2002', asOf: '2026-10-06T13:05:00Z' },
      spot: { value: spotOf('2002', '0.65'), asOf: '2026-10-06T13:05:00Z' },
      now,
      timeZone: MELBOURNE,
    });
    const base = spotOf('2000', '0.65');
    expect(day.aud).toEqual({
      sessionDate: '2026-10-07',
      timeZone: MELBOURNE,
      granularity: '5m',
      nativeCurrency: 'AUD',
      previousClose: base,
      regularStart: null,
      regularEnd: null,
      points: [
        [sec('2026-10-06T13:00:00Z'), base],
        [sec('2026-10-06T13:05:00Z'), spotOf('2002', '0.65')],
      ],
    });
    expect(day.usd).toMatchObject({
      nativeCurrency: 'USD',
      previousClose: '2000',
      points: [
        [sec('2026-10-06T13:00:00Z'), '2000'],
        [sec('2026-10-06T13:05:00Z'), '2002'],
      ],
    });
  });

  it('13:00 on a weekday: each bar ÷ the AUDUSD bar at or before it', () => {
    const now = new Date('2026-10-07T02:00:00Z'); // Wednesday 13:00 AEDT
    const futuresBars = bars('2026-10-06T00:00:00Z', '2026-10-07T02:00:00Z', () => 2000);
    // AUDUSD bars every 10 minutes, so half the futures bars use the bar before them.
    const audUsdBars = everyMinutes('2026-10-06T00:00:00Z', '2026-10-07T02:00:00Z', 10).map(
      (iso, i): DayPoint => [sec(iso), i % 2 === 0 ? '0.65' : '0.64'],
    );
    const day = bullionDayFrom({
      futuresBars,
      audUsdBars,
      futures: { price: '2000', asOf: '2026-10-07T02:00:00Z' },
      spot: null,
      now,
      timeZone: MELBOURNE,
    });
    const at = (iso: string) => day.aud!.points.find(([t]) => t === sec(iso))![1];
    const fx1305 = audUsdBars.find(([t]) => t === sec('2026-10-06T13:00:00Z'))![1];
    expect(at('2026-10-06T13:05:00Z')).toBe(spotOf('2000', fx1305));
    expect(day.aud!.points).toHaveLength(1 + 13 * 12);
  });

  it('Saturday after the close: from 00:00 to the Friday-night close', () => {
    // Saturday 10/10/2026 11:00 AEDT; the futures closed at 17:00 New York = 21:00Z on Friday.
    const now = new Date('2026-10-10T00:00:00Z');
    const futuresBars = bars('2026-10-09T00:00:00Z', '2026-10-09T20:55:00Z', (t) =>
      t <= sec('2026-10-09T13:00:00Z') ? 2000 : 2020,
    );
    const audUsdBars = bars('2026-10-09T00:00:00Z', '2026-10-09T20:55:00Z', () => 0.65);
    const day = bullionDayFrom({
      futuresBars,
      audUsdBars,
      futures: { price: '2020', asOf: '2026-10-09T20:55:00Z' },
      spot: { value: spotOf('2020', '0.65'), asOf: '2026-10-09T20:55:00Z' },
      now,
      timeZone: MELBOURNE,
    });
    expect(day.aud!.sessionDate).toBe('2026-10-10');
    expect(day.aud!.previousClose).toBe(spotOf('2000', '0.65'));
    expect(day.aud!.points.at(-1)).toEqual([sec('2026-10-09T20:55:00Z'), spotOf('2020', '0.65')]);
  });

  it.each([
    ['Sunday 11/10/2026', '2026-10-11T00:00:00Z', '2026-10-10T13:00:00Z', '2026-10-11'],
    [
      'Monday 12/10/2026 before the reopen',
      '2026-10-11T21:00:00Z',
      '2026-10-11T13:00:00Z',
      '2026-10-12',
    ],
    [
      'Sunday 04/10/2026 (AEST midnight)',
      '2026-10-04T00:00:00Z',
      '2026-10-03T14:00:00Z',
      '2026-10-04',
    ],
  ])(
    '%s: no trade since midnight, so the base is the closing spot, flat',
    (_n, now, midnight, date) => {
      const friday = '2026-10-02T20:55:00Z';
      const day = bullionDayFrom({
        futuresBars: bars('2026-10-02T00:00:00Z', friday, () => 2020),
        audUsdBars: bars('2026-10-02T00:00:00Z', friday, () => 0.65),
        futures: { price: '2020', asOf: friday },
        spot: { value: '3107.692307692308', asOf: friday },
        now: new Date(now),
        timeZone: MELBOURNE,
      });
      expect(day.aud).toMatchObject({
        sessionDate: date,
        previousClose: '3107.692307692308',
        points: [[sec(midnight), '3107.692307692308']],
      });
      expect(day.usd).toMatchObject({ previousClose: '2020', points: [[sec(midnight), '2020']] });
    },
  );

  it('Monday 05/10/2026 after the reopen (AEDT midnight): base from Friday’s last bars', () => {
    const now = new Date('2026-10-05T01:00:00Z'); // Monday 12:00 AEDT; midnight 13:00Z on 04/10
    const futuresBars = [
      ...bars('2026-10-02T00:00:00Z', '2026-10-02T20:55:00Z', () => 2000),
      ...bars('2026-10-04T22:00:00Z', '2026-10-05T01:00:00Z', () => 2010),
    ];
    const audUsdBars = [
      ...bars('2026-10-02T00:00:00Z', '2026-10-02T20:55:00Z', () => 0.64),
      ...bars('2026-10-04T21:00:00Z', '2026-10-05T01:00:00Z', () => 0.65),
    ];
    const day = bullionDayFrom({
      futuresBars,
      audUsdBars,
      futures: { price: '2010', asOf: '2026-10-05T01:00:00Z' },
      spot: { value: spotOf('2010', '0.65'), asOf: '2026-10-05T01:00:00Z' },
      now,
      timeZone: MELBOURNE,
    });
    expect(day.aud!.previousClose).toBe(spotOf('2000', '0.64'));
    expect(day.aud!.points[0]).toEqual([sec('2026-10-04T13:00:00Z'), spotOf('2000', '0.64')]);
    expect(day.aud!.points[1]).toEqual([sec('2026-10-04T22:00:00Z'), spotOf('2010', '0.65')]);
    // The row written while the futures were shut keeps its base (the first base is kept).
    const closed: DayRow = {
      ...day.aud!,
      previousClose: '3100',
      points: [[sec('2026-10-04T13:00:00Z'), '3100']],
    };
    expect(mergeDayRow(closed, day.aud!, 'midnight')!.previousClose).toBe('3100');
  });

  it('the April change: Tuesday 06/04/2027 09:00 AEST, midnight 14:00Z', () => {
    const now = new Date('2027-04-05T23:00:00Z');
    const day = bullionDayFrom({
      futuresBars: bars('2027-04-05T00:00:00Z', '2027-04-05T23:00:00Z', () => 2000),
      audUsdBars: bars('2027-04-05T00:00:00Z', '2027-04-05T23:00:00Z', () => 0.625),
      futures: { price: '2000', asOf: '2027-04-05T23:00:00Z' },
      spot: { value: '3200', asOf: '2027-04-05T23:00:00Z' },
      now,
      timeZone: MELBOURNE,
    });
    expect(day.aud!.sessionDate).toBe('2027-04-06');
    expect(day.aud!.points[0]).toEqual([sec('2027-04-05T14:00:00Z'), '3200']);
  });

  it('no AUDUSD bar before midnight: base null; a later fetch fills it', () => {
    const now = new Date('2026-10-07T02:00:00Z');
    const input = {
      futuresBars: bars('2026-10-06T00:00:00Z', '2026-10-07T02:00:00Z', () => 2000),
      audUsdBars: bars('2026-10-06T13:30:00Z', '2026-10-07T02:00:00Z', () => 0.625),
      futures: { price: '2000', asOf: '2026-10-07T02:00:00Z' },
      spot: { value: '3200', asOf: '2026-10-07T02:00:00Z' },
      now,
      timeZone: MELBOURNE,
    };
    const gap = bullionDayFrom(input);
    expect(gap.aud!.previousClose).toBeNull();
    expect(gap.aud!.points[0]![0]).toBe(sec('2026-10-06T13:30:00Z'));
    const later = bullionDayFrom({
      ...input,
      audUsdBars: bars('2026-10-06T00:00:00Z', '2026-10-07T02:00:00Z', () => 0.625),
    });
    const merged = mergeDayRow(gap.aud, later.aud!, 'midnight')!;
    expect(merged.previousClose).toBe('3200');
    expect(merged.points[0]).toEqual([sec('2026-10-06T13:00:00Z'), '3200']);
  });
});

// ─── The newer-session rule (FROZEN) ────────────────────────────────────────────────────────────

describe('mergeDayRow', () => {
  const row = (date: string, prev: string | null, points: DayPoint[]): DayRow => ({
    sessionDate: date,
    timeZone: 'Australia/Sydney',
    granularity: '5m',
    nativeCurrency: 'AUD',
    previousClose: prev,
    regularStart: null,
    regularEnd: null,
    points,
  });

  it('ignores an older session and replaces with a newer one', () => {
    const stored = row('2030-09-12', '50', [[100, '51']]);
    expect(mergeDayRow(stored, row('2030-09-11', '49', [[50, '49.5']]), 'session')).toBeNull();
    expect(mergeDayRow(stored, row('2030-09-13', '51', [[200, '52']]), 'session')).toEqual(
      row('2030-09-13', '51', [[200, '52']]),
    );
  });

  it('merges the same session: base kept when the incoming is null, points by time', () => {
    const stored = row('2030-09-12', '50', [
      [100, '51'],
      [200, '52'],
    ]);
    const merged = mergeDayRow(
      stored,
      row('2030-09-12', null, [
        [200, '52.5'],
        [300, '53'],
      ]),
      'session',
    )!;
    expect(merged.previousClose).toBe('50');
    expect(merged.points).toEqual([
      [100, '51'],
      [200, '52.5'],
      [300, '53'],
    ]);
    // Yahoo rows: a known incoming close wins; midnight rows: the stored base wins.
    expect(mergeDayRow(stored, row('2030-09-12', '49', []), 'session')!.previousClose).toBe('49');
    expect(mergeDayRow(stored, row('2030-09-12', '49', []), 'midnight')!.previousClose).toBe('50');
  });

  it('caps the merged points at DAY_POINTS_MAX, keeping the newest', () => {
    const many = (from: number): DayPoint[] =>
      Array.from({ length: 300 }, (_, i): DayPoint => [from + i, '1']);
    const merged = mergeDayRow(row('d', '1', many(1)), row('d', '1', many(1000)), 'session')!;
    expect(merged.points).toHaveLength(DAY_POINTS_MAX);
    expect(merged.points.at(-1)![0]).toBe(1299);
  });

  it('never writes a row with neither a previous close nor a point', () => {
    expect(mergeDayRow(null, row('2030-09-12', null, []), 'session')).toBeNull();
    expect(
      mergeDayRow(row('2030-09-11', '1', []), row('2030-09-12', null, []), 'session'),
    ).toBeNull();
  });
});

describe('timestamps and dates are taken in the given zone', () => {
  it('dates a New York bar after 00:00 Melbourne in New York', () => {
    const body = chartBody({
      symbol: 'EXUS',
      currency: 'USD',
      timestamps: ['2030-09-13T19:55:00Z'], // Friday 15:55 New York = Saturday 05:55 Melbourne
      closes: [101],
      exchangeTimezoneName: 'America/New_York',
    });
    expect(parseYahooDay(resultOf(body), 'USD')!.sessionDate).toBe('2030-09-13');
  });
});
