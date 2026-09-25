// Holding metrics, the summary and allocation (stage-2.md §2.6, §2.8, §2.13; §7.3 steps 3–4).
// Generic ETFs: ASX:DEF (held), ASX:MNO (held, stale price), ASX:XYZ (exited), ASX:GHI (watching).
import { describe, expect, it } from 'vitest';
import { D, dividend, instrument, prices, ratio, run, trade } from './helpers';
import { xirr, type EngineInstrument } from '../src/index';

const ETF = (id: number, symbol: string, over: Partial<EngineInstrument> = {}) =>
  instrument(id, symbol, { kind: 'etf', ...over });

const etfInstruments = [
  ETF(1, 'ASX:DEF', {
    targetRatio: '0.6',
    sector: 'Global shares',
    regions: { us: '0.6', asia: '0.1', aus: '0.2', other: '0.1' },
    mgmtFeeRatio: '0.002',
  }),
  ETF(2, 'ASX:MNO', {
    targetRatio: '0.4',
    sector: 'Australian shares',
    regions: { us: '0.5', asia: '0.1', aus: '0.3', other: null },
  }),
  ETF(3, 'ASX:XYZ', { watched: false }),
  ETF(4, 'ASX:GHI', { targetRatio: '0' }),
];
const etfTrades = [
  trade(10, 1, '2025-01-10', '10', '50', { feeCents: 1000 }),
  trade(11, 1, '2026-02-10', '10', '60'),
  trade(12, 2, '2025-06-01', '20', '100', { feeCents: 1000 }),
  trade(13, 3, '2024-01-10', '10', '20', { feeCents: 1000 }),
  trade(14, 3, '2025-12-01', '-10', '25', { feeCents: 1000 }),
];
const etfPrices = prices([
  [1, '62'],
  [2, '110', 'stale'],
  [4, '20'],
]);

describe('computeInvestments: holdings (§2.6)', () => {
  const r = run({ kind: 'etf', instruments: etfInstruments, trades: etfTrades, prices: etfPrices });
  const byId = (id: number) => r.holdings.find((h) => h.instrumentId === id)!;

  it('orders holdings by sortOrder then id and sets each status', () => {
    expect(r.holdings.map((h) => [h.instrumentId, h.status])).toEqual([
      [1, 'held'],
      [2, 'held'],
      [3, 'exited'],
      [4, 'watching'],
    ]);
  });

  it('values a held priced holding (value, cost, unrealised, total return, average price)', () => {
    // 20 units at 62 = 1240; cost 500 + 10 + 600 = 1110; unrealised 130.
    expect(byId(1)).toMatchObject({
      netUnits: '20',
      openUnits: '20',
      price: '62',
      priceStatus: 'fresh',
      valueCents: 124000,
      costCents: 111000,
      unrealisedCents: 13000,
      dividendsCents: 0,
      totalReturnCents: 13000,
      totalReturnRatio: ratio(D(130).div(1110)),
      realisedCents: 0,
      averagePrice: '55',
      currentRatio: ratio(D(1240).div(3440)),
      targetRatio: '0.6',
      differenceRatio: ratio(D(1240).div(3440).minus('0.6')),
      lastBuyDate: '2026-02-10',
      lastTradeDate: '2026-02-10',
      flags: [],
    });
  });

  it('uses a stale price and flags it', () => {
    expect(byId(2)).toMatchObject({
      flags: ['stale_price'],
      valueCents: 220000,
      priceStatus: 'stale',
    });
  });

  it('computes the ETF management fee estimate with daily compounding (§11 fix 13)', () => {
    const expected = D(1240).times(D(1).plus(D('0.002').div(365)).pow(365).minus(1));
    expect(byId(1).estMgmtFeeCents).toBe(Math.round(expected.times(100).toNumber()));
    expect(byId(1).estMgmtFeeCents).toBe(248);
    expect(byId(2).estMgmtFeeCents).toBeNull();
  });

  it('keeps an exited holding’s realised gain and gives it no total return (D41)', () => {
    // Proceeds 250 − 10 = 240; cost 200 + 10 = 210; gain 30, long, FY2025–26.
    expect(byId(3)).toMatchObject({
      status: 'exited',
      realisedCents: 3000,
      valueCents: null,
      unrealisedCents: null,
      totalReturnCents: null,
      totalReturnRatio: null,
      averagePrice: null,
      currentRatio: null,
      differenceRatio: null,
      lastBuyDate: '2024-01-10',
      lastTradeDate: '2025-12-01',
    });
    expect(byId(3).xirr).not.toBeNull();
  });

  it('gives a priced watching instrument value 0, current 0 and difference −target', () => {
    expect(byId(4)).toMatchObject({
      valueCents: 0,
      unrealisedCents: 0,
      totalReturnCents: null,
      currentRatio: '0',
      targetRatio: '0',
      differenceRatio: '0',
      xirr: null,
      averagePrice: null,
      lastBuyDate: null,
    });
  });
});

describe('computeInvestments: summary (§2.8)', () => {
  const r = run({ kind: 'etf', instruments: etfInstruments, trades: etfTrades, prices: etfPrices });

  it('sums the held priced holdings (the Σ of their rounded cents)', () => {
    expect(r.summary).toMatchObject({
      valueCents: 344000,
      costCents: 312000,
      unrealisedCents: 32000,
      dividendsHeldCents: 0,
      totalReturnCents: 32000,
      totalReturnRatio: ratio(D(320).div(3120)),
      realisedCents: 3000,
      realisedThisFyCents: 0,
      heldCount: 2,
      watchingCount: 1,
      exitedCount: 1,
      unpricedCount: 0,
      stalePriceCount: 1,
      targetSumRatio: '1',
      targetCount: 2,
      estMgmtFeeCents: 248,
      lastBuyDate: '2026-02-10',
    });
  });

  it('computes the 1Y investment rate from the earliest trade in the window, rounded up', () => {
    // Window (2025-09-24, 2026-09-24]: the sell of 2025-12-01 and a buy of 600.
    // 600 × 30.416 / 297 days = 61.45 → $62.
    expect(r.summary.investmentRatePerMonthCents).toBe(6200);
  });

  it('lists the FY rows newest first with the as-of FY', () => {
    expect(r.realisedByFy).toEqual([
      { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
      {
        financialYear: 2025,
        shortTermCents: 0,
        longTermCents: 3000,
        totalCents: 3000,
        disposals: 1,
      },
    ]);
  });

  it('computes the D43 portfolio XIRR over every trade plus the priced value at as-of', () => {
    const flows = [
      { amount: -500, date: '2025-01-10' },
      { amount: -600, date: '2026-02-10' },
      { amount: -2000, date: '2025-06-01' },
      { amount: -200, date: '2024-01-10' },
      { amount: 250, date: '2025-12-01' },
      { amount: 3440, date: '2026-09-24' },
    ];
    expect(Number(r.summary.xirr)).toBeCloseTo(xirr(flows)!, 9);
  });
});

describe('computeInvestments: unpriced and edge cases (§2.13)', () => {
  it('leaves a held unpriced holding out of every sum and flags it', () => {
    const r = run({
      kind: 'etf',
      instruments: etfInstruments,
      trades: etfTrades,
      prices: prices([
        [1, null, 'failed'],
        [2, '110'],
      ]),
    });
    const h = r.holdings[0]!;
    expect(h).toMatchObject({
      flags: ['unpriced'],
      valueCents: null,
      unrealisedCents: null,
      totalReturnCents: null,
      totalReturnRatio: null,
      xirr: null,
      currentRatio: null,
      differenceRatio: null,
      costCents: 111000,
      averagePrice: '55',
      estMgmtFeeCents: null,
    });
    expect(r.summary).toMatchObject({
      valueCents: 220000,
      costCents: 201000,
      totalReturnCents: 19000,
      unpricedCount: 1,
      stalePriceCount: 0,
      estMgmtFeeCents: null,
    });
    expect(r.holdings[1]!.currentRatio).toBe('1');
    // The portfolio XIRR leaves the unpriced holding's flows out.
    expect(r.summary.xirr).not.toBeNull();
  });

  it('treats a zero price as no price', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [trade(1, 1, '2025-01-10', '10', '10')],
      prices: prices([[1, '0']]),
    });
    expect(r.holdings[0]!.flags).toEqual(['unpriced']);
    expect(r.holdings[0]!.price).toBeNull();
  });

  it('treats a price that values the holding beyond safe-integer cents as no price', () => {
    // 1e6 units × a manual price of 1e9 = 1e15 dollars: past Number.MAX_SAFE_INTEGER cents.
    const input = {
      instruments: [instrument(1, 'ASX:ABC'), instrument(2, 'ASX:DEF')],
      trades: [trade(1, 1, '2025-01-10', '1000000', '1'), trade(2, 2, '2025-01-10', '10', '10')],
      prices: prices([
        [1, '1000000000', 'manual'],
        [2, '12'],
      ]),
    };
    expect(() => run(input)).not.toThrow();
    const r = run(input);
    expect(r.holdings[0]).toMatchObject({
      status: 'held',
      flags: ['unpriced'],
      price: null,
      valueCents: null,
      unrealisedCents: null,
      totalReturnCents: null,
      xirr: null,
      currentRatio: null,
      costCents: 100_000_000,
    });
    expect(r.lots.find((l) => l.tradeId === 1)!.unrealisedCents).toBeNull();
    // The other holding still counts; the unpriced one is left out of every sum.
    expect(r.summary).toMatchObject({ valueCents: 12_000, unpricedCount: 1 });
    expect(r.holdings[1]!.currentRatio).toBe('1');
  });

  it('flags a held instrument that is not watched', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC', { watched: false })],
      trades: [trade(1, 1, '2025-01-10', '10', '10')],
      prices: prices([[1, '10', 'failed']]),
    });
    expect(r.holdings[0]!.flags).toEqual(['stale_price', 'unwatched_held']);
    expect(r.holdings[0]!.status).toBe('held');
  });

  it('ignores a trade whose instrument is not in the input', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [trade(1, 1, '2025-01-10', '10', '10'), trade(2, 99, '2025-01-10', '10', '10')],
      prices: prices([[1, '10']]),
    });
    expect(r.trades.map((t) => t.tradeId)).toEqual([1]);
    expect(r.lots.map((l) => l.tradeId)).toEqual([1]);
  });

  it('gives an empty kind zero totals and the as-of FY row', () => {
    const r = run({ kind: 'crypto', instruments: [] });
    expect(r.summary).toMatchObject({
      valueCents: 0,
      totalReturnRatio: null,
      xirr: null,
      investmentRatePerMonthCents: null,
      heldCount: 0,
      targetSumRatio: '0',
      targetCount: 0,
      estMgmtFeeCents: null,
      lastBuyDate: null,
    });
    expect(r.realisedByFy).toEqual([
      { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
    ]);
    expect(r.allocation).toEqual({ byHolding: [], bySector: [], byRegion: null });
  });

  it('returns plain JSON data (no decimal objects)', () => {
    const r = run({
      kind: 'etf',
      instruments: etfInstruments,
      trades: etfTrades,
      prices: etfPrices,
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('accepts trades in any order', () => {
    const shuffled = [...etfTrades].reverse();
    const a = run({
      kind: 'etf',
      instruments: etfInstruments,
      trades: etfTrades,
      prices: etfPrices,
    });
    const b = run({
      kind: 'etf',
      instruments: etfInstruments,
      trades: shuffled,
      prices: etfPrices,
    });
    expect(b).toEqual(a);
  });
});

describe('the 1Y investment rate window (§2.8)', () => {
  const inst = [instrument(1, 'ASX:ABC')];
  it('leaves out a trade exactly 365 days back', () => {
    const r = run({
      instruments: inst,
      asOf: '2026-09-24',
      trades: [trade(1, 1, '2025-09-24', '10', '100'), trade(2, 1, '2026-06-26', '1', '100')],
    });
    // Only the 2026-06-26 buy (90 days before): 100 × 30.416 / 90 = 33.80 → $34.
    expect(r.summary.investmentRatePerMonthCents).toBe(3400);
  });

  it('includes a trade 364 days back', () => {
    const r = run({
      instruments: inst,
      asOf: '2026-09-24',
      trades: [trade(1, 1, '2025-09-25', '10', '100')],
    });
    // 1000 × 30.416 / 364 = 83.56 → $84.
    expect(r.summary.investmentRatePerMonthCents).toBe(8400);
  });

  it('is null when the window is empty or its first trade is on the as-of date', () => {
    expect(
      run({ instruments: inst, trades: [trade(1, 1, '2024-01-10', '10', '100')] }).summary
        .investmentRatePerMonthCents,
    ).toBeNull();
    expect(
      run({ instruments: inst, trades: [trade(1, 1, '2026-09-24', '10', '100')] }).summary
        .investmentRatePerMonthCents,
    ).toBeNull();
  });
});

describe('allocation (§2.8)', () => {
  const r = run({ kind: 'etf', instruments: etfInstruments, trades: etfTrades, prices: etfPrices });
  const c1 = D(1240).div(3440);
  const c2 = D(2200).div(3440);

  it('slices by holding: held or targeted, current descending', () => {
    expect(r.allocation.byHolding).toEqual([
      { key: '2', label: 'ASX:MNO', currentRatio: ratio(c2), targetRatio: '0.4' },
      { key: '1', label: 'ASX:DEF', currentRatio: ratio(c1), targetRatio: '0.6' },
    ]);
  });

  it('slices by sector', () => {
    expect(r.allocation.bySector).toEqual([
      {
        key: 'Australian shares',
        label: 'Australian shares',
        currentRatio: ratio(c2),
        targetRatio: '0.4',
      },
      { key: 'Global shares', label: 'Global shares', currentRatio: ratio(c1), targetRatio: '0.6' },
    ]);
  });

  it('looks through regions with an unassigned remainder', () => {
    const us = c1.times('0.6').plus(c2.times('0.5'));
    const aus = c1.times('0.2').plus(c2.times('0.3'));
    const other = c1.times('0.1');
    const unassigned = D(1).minus(us).minus('0.1').minus(aus).minus(other);
    expect(r.allocation.byRegion).toEqual([
      { key: 'us', label: 'US', currentRatio: ratio(us), targetRatio: '0.56' },
      { key: 'aus', label: 'Australia', currentRatio: ratio(aus), targetRatio: '0.24' },
      { key: 'asia', label: 'Asia', currentRatio: '0.1', targetRatio: '0.1' },
      {
        key: 'unassigned',
        label: 'Unassigned',
        currentRatio: ratio(unassigned),
        targetRatio: '0.04',
      },
      { key: 'other', label: 'EU/Other', currentRatio: ratio(other), targetRatio: '0.06' },
    ]);
  });

  it('has no regions for stocks and crypto, and an Unassigned sector for a null sector', () => {
    const s = run({
      instruments: [instrument(1, 'ASX:ABC', { targetRatio: '1' })],
      trades: [trade(1, 1, '2025-01-10', '10', '10')],
      prices: prices([[1, '10']]),
    });
    expect(s.allocation.byRegion).toBeNull();
    expect(s.allocation.bySector).toEqual([
      { key: 'unassigned', label: 'Unassigned', currentRatio: '1', targetRatio: '1' },
    ]);
  });

  it('counts targets: target > 0, plus held with current > 0 and no target', () => {
    const t = run({
      kind: 'etf',
      instruments: [
        ETF(1, 'ASX:ABC', { targetRatio: '0.5' }),
        ETF(2, 'ASX:DEF', { targetRatio: '0' }),
        ETF(3, 'ASX:GHI', { targetRatio: null }),
        ETF(4, 'ASX:JKL', { targetRatio: '0.5' }),
      ],
      trades: [trade(1, 1, '2025-01-10', '1', '10'), trade(2, 2, '2025-01-10', '1', '10')],
      prices: prices([
        [1, '10'],
        [2, '10'],
      ]),
    });
    expect(t.summary.targetCount).toBe(3);
    expect(t.summary.targetSumRatio).toBe('1');
  });

  it('reports a target sum that is not 100 %', () => {
    const t = run({
      instruments: [
        instrument(1, 'ASX:ABC', { targetRatio: '0.5' }),
        instrument(2, 'ASX:DEF', { targetRatio: '0.45' }),
        instrument(3, 'ASX:OLD', { targetRatio: '0.3', watched: false }),
      ],
    });
    expect(t.summary.targetSumRatio).toBe('0.95');
  });
});

describe('per-kind differences', () => {
  it('computes the est. fee for managed funds but not for stocks or crypto', () => {
    for (const kind of ['stock', 'crypto'] as const) {
      const r = run({
        kind,
        instruments: [
          instrument(1, kind === 'stock' ? 'ASX:ABC' : 'BTC', { kind, mgmtFeeRatio: '0.01' }),
        ],
        trades: [trade(1, 1, '2025-01-10', '10', '10')],
        prices: prices([[1, '10']]),
      });
      expect(r.holdings[0]!.estMgmtFeeCents).toBeNull();
      expect(r.summary.estMgmtFeeCents).toBeNull();
    }
    const mf = run({
      kind: 'managed_fund',
      instruments: [instrument(1, 'EXAMPLEFUND', { kind: 'managed_fund', mgmtFeeRatio: '0.01' })],
      trades: [trade(1, 1, '2025-01-10', '1000', '1')],
      prices: prices([[1, '1', 'manual']]),
    });
    // 1000 × ((1 + 0.01/365)^365 − 1) = 10.0500 → $10.05.
    expect(mf.holdings[0]!.estMgmtFeeCents).toBe(1005);
    expect(mf.summary.estMgmtFeeCents).toBe(1005);
    expect(mf.allocation.byRegion).not.toBeNull();
  });

  it('adds linked dividends to total return and XIRR, and counts every dividend of the kind', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC'), instrument(2, 'ASX:DEF')],
      trades: [trade(1, 1, '2025-01-10', '10', '10')],
      dividends: [
        dividend(1, 1, '2025-06-01', 500),
        dividend(2, null, '2026-08-01', 300),
        dividend(3, 1, '2026-08-15', 200),
        dividend(4, 1, '2026-08-15', 999, { holdingKind: 'etf' }),
      ],
      prices: prices([[1, '10']]),
    });
    const h = r.holdings[0]!;
    expect(h.dividendsCents).toBe(700);
    expect(h.totalReturnCents).toBe(700);
    expect(h.totalReturnRatio).toBe('0.07');
    expect(Number(h.xirr)).toBeGreaterThan(0);
    expect(r.summary).toMatchObject({
      dividendsAllTimeCents: 1000,
      dividendsThisFyCents: 500,
      dividendsHeldCents: 700,
    });
  });
});
