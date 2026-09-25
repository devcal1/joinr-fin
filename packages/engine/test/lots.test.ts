// FIFO lots, realised gains and the ATO holding-period split (stage-2.md §2.4, §2.5, §7.3 step 1).
// Hand-worked generic figures only.
import { describe, expect, it } from 'vitest';
import { capitalGainTerm, processLedger, selectLots } from '../src/lots';
import { MATCHING_STRATEGIES } from '../src/index';
import { instrument, prices, run, trade } from './helpers';

describe('FIFO lots (§2.4)', () => {
  it('matches a multi-parcel exit with a fee on every trade, fees pro rata', () => {
    // Buys: 10 @ 10 + $10, 20 @ 12 + $10, 5 @ 11 + $5. Sell 35 @ 15 − $14.
    // Parcel gains: (150 − 4) − 110 = 36; (300 − 8) − 250 = 42; (75 − 2) − 60 = 13 → 91.
    const r = run({
      instruments: [instrument(1, 'ASX:ABC', { watched: false })],
      trades: [
        trade(1, 1, '2024-01-10', '10', '10', { feeCents: 1000 }),
        trade(2, 1, '2024-03-10', '20', '12', { feeCents: 1000 }),
        trade(3, 1, '2024-05-10', '5', '11', { feeCents: 500 }),
        trade(4, 1, '2024-08-10', '-35', '15', { feeCents: 1400 }),
      ],
    });
    expect(
      r.disposals.map((d) => [d.lotTradeId, d.units, d.proceedsCents, d.costCents, d.gainCents]),
    ).toEqual([
      [1, '10', 14600, 11000, 3600],
      [2, '20', 29200, 25000, 4200],
      [3, '5', 7300, 6000, 1300],
    ]);
    expect(r.disposals.every((d) => d.term === 'short' && d.financialYear === 2024)).toBe(true);
    const sell = r.trades.find((t) => t.tradeId === 4)!;
    expect(sell).toMatchObject({
      side: 'sell',
      orderValueCents: 52500,
      feeCents: 1400,
      realisedCents: 9100,
      realisedShortCents: 9100,
      realisedLongCents: 0,
      oversoldUnits: null,
      remainingUnits: null,
      unrealisedCents: null,
    });
    expect(r.lots.map((l) => l.remainingUnits)).toEqual(['0', '0', '0']);
    const h = r.holdings[0]!;
    expect(h).toMatchObject({
      status: 'exited',
      realisedCents: 9100,
      openUnits: '0',
      netUnits: '0',
    });
    expect(h.costCents).toBe(0);
    expect(h.averagePrice).toBeNull();
    expect(h.flags).toEqual([]);
  });

  it('pro-rates the buy fee on a partly-sold lot (§11 fix 9)', () => {
    // Buy 100 @ 10 + $20; sell 40 @ 12 − $8. Left 60: cost 600 + 12 = 612; at 11 the gain is 60 − 12.
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [
        trade(1, 1, '2025-01-15', '100', '10', { feeCents: 2000 }),
        trade(2, 1, '2025-06-01', '-40', '12', { feeCents: 800 }),
      ],
      prices: prices([[1, '11']]),
    });
    const lot = r.lots[0]!;
    expect(lot).toMatchObject({
      units: '100',
      remainingUnits: '60',
      feeCents: 2000,
      remainingCostCents: 61200,
      unrealisedCents: 4800,
      unrealisedRatio: '0.048',
      heldDays: 617,
      termIfSoldToday: 'long',
    });
    expect(r.disposals[0]).toMatchObject({
      units: '40',
      proceedsCents: 47200,
      costCents: 40800,
      gainCents: 6400,
    });
    const buy = r.trades.find((t) => t.tradeId === 1)!;
    expect(buy).toMatchObject({
      side: 'buy',
      remainingUnits: '60',
      unrealisedCents: 4800,
      realisedCents: null,
    });
    const h = r.holdings[0]!;
    expect(h).toMatchObject({
      status: 'held',
      openUnits: '60',
      netUnits: '60',
      costCents: 61200,
      valueCents: 66000,
      unrealisedCents: 4800,
      realisedCents: 6400,
      averagePrice: '10',
    });
  });

  it('lets a same-day sell entered before its buy use that buy (buys first on a date)', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [
        trade(1, 1, '2025-03-01', '-5', '12', { seq: 1 }),
        trade(2, 1, '2025-03-01', '10', '10', { seq: 2 }),
      ],
      prices: prices([[1, '10']]),
    });
    expect(r.trades.map((t) => t.tradeId)).toEqual([2, 1]);
    expect(r.trades[1]!.oversoldUnits).toBeNull();
    expect(r.trades[1]!.realisedCents).toBe(1000);
    expect(r.lots[0]!.remainingUnits).toBe('5');
    expect(r.holdings[0]!.flags).toEqual([]);
  });

  it('consumes older lots first and orders by date, then seq, then id', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [
        trade(5, 1, '2025-05-01', '-15', '20'),
        trade(3, 1, '2025-02-01', '10', '12', { seq: 9 }),
        trade(2, 1, '2025-02-01', '10', '11', { seq: 9 }),
        trade(1, 1, '2025-01-01', '10', '10', { seq: 99 }),
      ],
    });
    expect(r.trades.map((t) => t.tradeId)).toEqual([1, 2, 3, 5]);
    expect(r.disposals.map((d) => [d.lotTradeId, d.units])).toEqual([
      [1, '10'],
      [2, '5'],
    ]);
    expect(r.lots.map((l) => [l.tradeId, l.remainingUnits])).toEqual([
      [1, '0'],
      [2, '5'],
      [3, '10'],
    ]);
  });

  it('flags an oversell, books no gain for the excess and never throws', () => {
    // 10 held; sell 15 @ 12 − $15: 10 matched (proceeds 120 − 10 = 110, cost 100), 5 oversold.
    const r = run({
      instruments: [instrument(1, 'ASX:OLD', { watched: false })],
      trades: [
        trade(1, 1, '2025-01-10', '10', '10'),
        trade(2, 1, '2025-02-10', '-15', '12', { feeCents: 1500 }),
      ],
    });
    const sell = r.trades.find((t) => t.tradeId === 2)!;
    expect(sell.oversoldUnits).toBe('5');
    expect(sell.realisedCents).toBe(1000);
    const h = r.holdings[0]!;
    expect(h.flags).toEqual(['oversell']);
    expect(h.netUnits).toBe('-5');
    expect(h.openUnits).toBe('0');
    expect(h.status).toBe('exited');
  });

  it('ignores zero-unit rows (they get a trade row but no lot)', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [trade(1, 1, '2025-01-10', '10', '10'), trade(2, 1, '2026-01-10', '0', '10')],
      prices: prices([[1, '10']]),
    });
    expect(r.lots.map((l) => l.tradeId)).toEqual([1]);
    expect(r.trades.find((t) => t.tradeId === 2)).toMatchObject({
      side: 'buy',
      orderValueCents: 0,
      remainingUnits: null,
      realisedCents: null,
    });
    expect(r.holdings[0]!.lastTradeDate).toBe('2025-01-10');
  });

  it('uses the rate fee exactly (the authority), not its rounded cents', () => {
    // Buy 0.5 @ 60000.33 at 0.1 %: fee 30.000165 (stored rounded as 3000 cents).
    // Sell 0.5 @ 70000 at 0.1 %: fee 35. Gain 34965 − 30030.165165 = 4934.834835 → 493483.
    const r = run({
      kind: 'crypto',
      instruments: [instrument(1, 'BTC', { kind: 'crypto' })],
      trades: [
        trade(1, 1, '2025-01-10', '0.5', '60000.33', { feeCents: 3000, feeRate: '0.001' }),
        trade(2, 1, '2025-02-10', '-0.5', '70000', { feeCents: 3500, feeRate: '0.001' }),
      ],
    });
    expect(r.disposals[0]!.gainCents).toBe(493483);
    expect(r.trades.map((t) => t.feeCents)).toEqual([3000, 3500]);
  });

  it('keeps one queue per instrument, even with the same code', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:XYZ'), instrument(2, 'ASX:XYZ', { sortOrder: 2 })],
      trades: [trade(1, 1, '2025-01-10', '10', '10'), trade(2, 2, '2025-02-10', '-4', '12')],
      prices: prices([
        [1, '10'],
        [2, '10'],
      ]),
    });
    expect(r.lots[0]!.remainingUnits).toBe('10');
    expect(r.trades.find((t) => t.tradeId === 2)!.oversoldUnits).toBe('4');
    expect(r.holdings.map((h) => h.flags)).toEqual([[], ['oversell']]);
  });

  it('never mixes kinds: each kind is computed from its own instruments', () => {
    const stock = instrument(1, 'ASX:XYZ');
    const etf = instrument(2, 'ASX:XYZ', { kind: 'etf' });
    const trades = [trade(1, 1, '2025-01-10', '10', '10'), trade(2, 2, '2025-02-10', '5', '20')];
    const s = run({ kind: 'stock', instruments: [stock], trades });
    const e = run({ kind: 'etf', instruments: [etf], trades });
    expect(s.lots.map((l) => l.tradeId)).toEqual([1]);
    expect(e.lots.map((l) => l.tradeId)).toEqual([2]);
    expect(s.holdings[0]!.openUnits).toBe('10');
    expect(e.holdings[0]!.openUnits).toBe('5');
  });

  it('has the FIFO seam and nothing else', () => {
    expect(MATCHING_STRATEGIES).toEqual(['fifo']);
    expect(typeof selectLots('fifo')).toBe('function');
    const l = processLedger([trade(1, 1, '2025-01-10', '10', '10')], 'fifo');
    expect(l.lots.get(1)!.remaining.toString()).toBe('10');
  });
});

describe('the ATO holding period (§2.5)', () => {
  it('is long only after the acquisition anniversary', () => {
    expect(capitalGainTerm('2024-03-15', '2025-03-14')).toBe('short');
    expect(capitalGainTerm('2024-03-15', '2025-03-15')).toBe('short');
    expect(capitalGainTerm('2024-03-15', '2025-03-16')).toBe('long');
  });

  it('clamps a 29 February acquisition to 28 February (EDATE)', () => {
    expect(capitalGainTerm('2024-02-29', '2025-02-28')).toBe('short');
    expect(capitalGainTerm('2024-02-29', '2025-03-01')).toBe('long');
  });

  it('splits one sell across short and long parcels and assigns the FY of the sell date', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [
        trade(1, 1, '2024-06-30', '10', '10'),
        trade(2, 1, '2025-06-01', '10', '10'),
        trade(3, 1, '2025-07-01', '-20', '12'),
      ],
      prices: prices([[1, '12']]),
    });
    expect(r.disposals.map((d) => [d.term, d.financialYear, d.gainCents])).toEqual([
      ['long', 2025, 2000],
      ['short', 2025, 2000],
    ]);
    const sell = r.trades.find((t) => t.tradeId === 3)!;
    expect([sell.realisedShortCents, sell.realisedLongCents, sell.realisedCents]).toEqual([
      2000, 2000, 4000,
    ]);
    expect(r.lots.map((l) => l.termIfSoldToday)).toEqual(['long', 'long']);
  });
});
