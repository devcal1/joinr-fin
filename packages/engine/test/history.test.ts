// History functions (stage-2.md §2.11; §7.3 step 7): contributions with DRP (≤), exited instruments
// included, purchase windows and the period compressor.
import { describe, expect, it } from 'vitest';
import {
  compressSeries,
  contributionsAt,
  netPurchases,
  purchaseWindows,
  type SeriesPoint,
} from '../src/index';
import { dividend, trade } from './helpers';

describe('contributionsAt', () => {
  const trades = [
    trade(1, 1, '2025-01-10', '10', '10'),
    trade(2, 1, '2025-03-10', '-5', '12', { feeCents: 999 }),
    // An exited instrument still counts (§11 fix 2).
    trade(3, 2, '2025-02-15', '3', '100'),
    trade(4, 2, '2025-04-15', '-3', '110'),
  ];
  const dividends = [
    dividend(1, 1, '2025-02-01', 2000, { reinvested: true }),
    dividend(2, 1, '2025-02-01', 5000, { reinvested: false }),
    dividend(3, 1, '2025-02-01', 7000, { reinvested: null }),
    dividend(4, 1, '2025-02-01', -300, { reinvested: true }),
    dividend(5, 1, '2025-02-01', 4000, { reinvested: true, holdingKind: 'etf' }),
    dividend(6, null, '2025-03-10', 500, { reinvested: true }),
  ];

  it('sums signed order values (fees excluded) less reinvested dividends, both ≤ the date', () => {
    const cents = contributionsAt({
      kind: 'stock',
      trades,
      dividends,
      dates: ['2025-01-09', '2025-01-10', '2025-02-01', '2025-02-15', '2025-03-10', '2025-04-15'],
    });
    // 0 · 100 · 100 − 20 = 80 · 80 + 300 = 380 · 380 − 60 − 5 (an unlinked DRP row) = 315 ·
    // 315 − 330 = −15. Only the kind's reinvested positive dividends are subtracted.
    expect(cents).toEqual([0, 10000, 8000, 38000, 31500, -1500]);
  });

  it('accepts trades in any order and an empty date list', () => {
    const shuffled = [...trades].reverse();
    expect(
      contributionsAt({ kind: 'stock', trades: shuffled, dividends: [], dates: ['2025-12-31'] }),
    ).toEqual([10000 - 6000 + 30000 - 33000]);
    expect(contributionsAt({ kind: 'stock', trades, dividends, dates: [] })).toEqual([]);
  });
});

describe('purchaseWindows', () => {
  it('builds (previous, run date] windows, the first one month back, plus the live window', () => {
    expect(purchaseWindows(['2026-01-31', '2025-12-31'], '2026-02-15')).toEqual([
      { after: '2025-11-30', through: '2025-12-31' },
      { after: '2025-12-31', through: '2026-01-31' },
      { after: '2026-01-31', through: '2026-02-15' },
    ]);
  });

  it('has only snapshot windows without a live date', () => {
    expect(purchaseWindows(['2026-03-31'], null)).toEqual([
      { after: '2026-02-28', through: '2026-03-31' },
    ]);
  });

  it('has one open window with no snapshots', () => {
    expect(purchaseWindows([], '2026-09-24')).toEqual([{ after: null, through: '2026-09-24' }]);
    expect(purchaseWindows([], null)).toEqual([]);
  });
});

describe('netPurchases', () => {
  it('sums signed order values per (after, through] window', () => {
    const trades = [
      trade(1, 1, '2025-11-30', '1', '100'),
      trade(2, 1, '2025-12-01', '2', '100'),
      trade(3, 1, '2025-12-31', '-1', '50'),
      trade(4, 2, '2026-01-15', '4', '25'),
      trade(5, 2, '2026-02-15', '1', '10'),
    ];
    const windows = purchaseWindows(['2025-12-31', '2026-01-31'], '2026-02-15');
    expect(netPurchases({ trades, windows })).toEqual([15000, 10000, 1000]);
    expect(netPurchases({ trades, windows: [{ after: null, through: '2025-12-01' }] })).toEqual([
      30000,
    ]);
  });
});

describe('compressSeries', () => {
  const point = (date: string, v: number | null, n: number | null, live = false): SeriesPoint => ({
    period: date.slice(0, 7),
    date,
    live,
    values: { value: v, net: n },
  });
  const points = [
    point('2025-10-31', 100, 10),
    point('2025-11-30', 110, 20),
    point('2025-12-31', 120, null),
    point('2026-01-31', 130, 5),
    point('2026-02-28', 140, 5),
    point('2026-03-15', null, 1, true),
  ];
  const modes = { value: 'end', net: 'sum' } as const;

  it('keeps monthly points with labels and the live flag', () => {
    const out = compressSeries(points, 'monthly', null, modes);
    expect(out.map((p) => p.label)).toEqual([
      'Oct 2025',
      'Nov 2025',
      'Dec 2025',
      'Jan 2026',
      'Feb 2026',
      'Mar 2026',
    ]);
    expect(out.at(-1)).toEqual({
      label: 'Mar 2026',
      period: '2026-03',
      date: '2026-03-15',
      live: true,
      values: { value: null, net: 1 },
    });
  });

  it('groups by calendar quarter: end takes the last point, sum adds the non-null values', () => {
    const out = compressSeries(points, 'quarterly', null, modes);
    expect(out).toEqual([
      {
        label: 'Q4 2025',
        period: '2025-12',
        date: '2025-12-31',
        live: false,
        values: { value: 120, net: 30 },
      },
      {
        label: 'Q1 2026',
        period: '2026-03',
        date: '2026-03-15',
        live: true,
        values: { value: null, net: 11 },
      },
    ]);
  });

  it('groups by year and keeps every year by default', () => {
    const out = compressSeries(points, 'yearly', null, modes);
    expect(out.map((p) => [p.label, p.values])).toEqual([
      ['2025', { value: 120, net: 30 }],
      ['2026', { value: null, net: 11 }],
    ]);
  });

  it('keeps the last `count` groups; null means 12 monthly or 8 quarterly', () => {
    const many: SeriesPoint[] = [];
    for (let m = 0; m < 30; m++) {
      const y = 2024 + Math.floor(m / 12);
      const mm = String((m % 12) + 1).padStart(2, '0');
      many.push({ period: `${y}-${mm}`, date: `${y}-${mm}-10`, live: false, values: { value: m } });
    }
    expect(compressSeries(many, 'monthly', null, {})).toHaveLength(12);
    expect(compressSeries(many, 'monthly', null, {})[0]!.label).toBe('Jul 2025');
    expect(compressSeries(many, 'quarterly', null, {})).toHaveLength(8);
    expect(compressSeries(many, 'quarterly', 3, {}).map((p) => p.label)).toEqual([
      'Q4 2025',
      'Q1 2026',
      'Q2 2026',
    ]);
    expect(compressSeries(many, 'yearly', null, {})).toHaveLength(3);
    expect(compressSeries(many, 'monthly', 0, {})).toEqual([]);
  });

  it('sorts its input by period and date, and marks a group live only by its last point', () => {
    const out = compressSeries([points[5]!, points[3]!, points[4]!], 'quarterly', null, modes);
    expect(out).toHaveLength(1);
    expect(out[0]!.live).toBe(true);
    const notLive = compressSeries(
      [point('2026-01-10', 1, 1, true), point('2026-01-31', 2, 1)],
      'monthly',
      null,
      modes,
    );
    expect(notLive[0]).toMatchObject({
      live: false,
      date: '2026-01-31',
      values: { value: 2, net: 2 },
    });
  });
});
