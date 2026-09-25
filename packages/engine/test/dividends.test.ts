// Dividend and staking metrics (stage-2.md §2.9; §7.3 step 5) and the FY realised table (§2.5,
// §2.10; §7.3 step 6). Generic values only.
import { describe, expect, it } from 'vitest';
import { realisedByFinancialYear, type DisposalResult } from '../src/index';
import { D, dividend, instrument, prices, ratio, run, trade } from './helpers';

describe('dividend metrics (§2.9)', () => {
  const trades = [trade(1, 1, '2025-01-10', '100', '10'), trade(2, 1, '2025-06-16', '50', '10')];

  it('gives units at the ex-date (trades strictly before it) and the payment yield', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades,
      prices: prices([[1, '10']]),
      dividends: [
        dividend(1, 1, '2025-03-20', 5000, { exDate: '2025-03-01', priceAtEx: '10' }),
        dividend(2, 1, '2025-07-20', 3000, { exDate: '2025-06-16', priceAtEx: '12' }),
        dividend(3, 1, '2025-09-20', 6000, { exDate: '2025-09-01', priceAtEx: '12' }),
        dividend(4, null, '2025-10-01', 700, { exDate: '2025-09-01', priceAtEx: '12' }),
        dividend(5, 1, '2025-10-02', 800),
        dividend(6, 1, '2025-10-03', 800, { exDate: '2025-09-01' }),
        dividend(7, 1, '2025-10-04', 800, { exDate: '2025-01-01', priceAtEx: '12' }),
      ],
    });
    expect(r.dividends).toEqual([
      { dividendId: 1, instrumentId: 1, unitsAtEx: '100', yieldRatio: '0.05' },
      // The buy dated on the ex-date is not counted (<).
      { dividendId: 2, instrumentId: 1, unitsAtEx: '100', yieldRatio: '0.025' },
      { dividendId: 3, instrumentId: 1, unitsAtEx: '150', yieldRatio: ratio(D(60).div(1800)) },
      { dividendId: 4, instrumentId: null, unitsAtEx: null, yieldRatio: null },
      { dividendId: 5, instrumentId: 1, unitsAtEx: null, yieldRatio: null },
      { dividendId: 6, instrumentId: 1, unitsAtEx: '150', yieldRatio: null },
      { dividendId: 7, instrumentId: 1, unitsAtEx: '0', yieldRatio: null },
    ]);
  });

  it('annualises the mean payment yield by the cadence (count − 1) / span (§11 fix 3)', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades,
      prices: prices([[1, '10']]),
      dividends: [
        dividend(1, 1, '2025-03-20', 5000, { exDate: '2025-03-01', priceAtEx: '10' }),
        dividend(3, 1, '2025-09-20', 6000, { exDate: '2025-09-01', priceAtEx: '12' }),
      ],
    });
    // Mean (0.05 + 1/30) / 2 × 365 × 1 / 184 days.
    const mean = D('0.05').plus(D(60).div(1800)).div(2);
    expect(r.holdings[0]!.dividendYieldRatio).toBe(ratio(mean.times(365).div(184)));
  });

  it('gives no yield for a single payment (count = 1)', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades,
      dividends: [dividend(1, 1, '2025-03-20', 5000, { exDate: '2025-03-01', priceAtEx: '10' })],
    });
    expect(r.holdings[0]!.dividendYieldRatio).toBeNull();
  });

  it('gives crypto a staking yield over the last 365 days × 12 / frequency', () => {
    const coin = instrument(1, 'ETH', { kind: 'crypto', dividendFreqMonths: 1 });
    const staking = (id: number, paid: string, cents: number) =>
      dividend(id, 1, paid, cents, { holdingKind: 'crypto', exDate: paid, priceAtEx: '4000' });
    const r = run({
      kind: 'crypto',
      instruments: [coin],
      trades: [trade(1, 1, '2025-01-10', '1', '3000')],
      prices: prices([[1, '4000']]),
      dividends: [
        staking(1, '2025-06-01', 10000),
        staking(2, '2026-08-01', 1000),
        staking(3, '2026-09-01', 2000),
      ],
    });
    // Window (2025-09-24, 2026-09-24]: yields 10/4000 and 20/4000; mean 0.00375 × 12 / 1.
    expect(r.holdings[0]!.dividendYieldRatio).toBe('0.045');
    expect(r.holdings[0]!.dividendsCents).toBe(13000);

    const noFreq = run({
      kind: 'crypto',
      instruments: [{ ...coin, dividendFreqMonths: null }],
      trades: [trade(1, 1, '2025-01-10', '1', '3000')],
      prices: prices([[1, '4000']]),
      dividends: [staking(2, '2026-08-01', 1000), staking(3, '2026-09-01', 2000)],
    });
    // The cadence rule on the same window: 0.00375 × 365 × 1 / 31 days.
    expect(noFreq.holdings[0]!.dividendYieldRatio).toBe(ratio(D('0.00375').times(365).div(31)));
  });
});

describe('realisedByFinancialYear (§2.5, §2.10)', () => {
  const disposal = (
    sellDate: string,
    fy: number,
    term: 'short' | 'long',
    gainCents: number,
  ): DisposalResult => ({
    sellTradeId: 1,
    lotTradeId: 1,
    instrumentId: 1,
    sellDate,
    acquiredDate: '2020-01-01',
    units: '1',
    proceedsCents: 0,
    costCents: 0,
    gainCents,
    term,
    financialYear: fy,
  });

  it('splits at 30 June / 1 July, always lists the as-of FY and sorts newest first', () => {
    const rows = realisedByFinancialYear(
      [
        disposal('2025-06-30', 2024, 'short', 1000),
        disposal('2025-07-01', 2025, 'long', -250),
        disposal('2025-07-02', 2025, 'short', 400),
        disposal('2025-06-01', 2024, 'long', 50),
      ],
      '2026-09-24',
    );
    expect(rows).toEqual([
      { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
      {
        financialYear: 2025,
        shortTermCents: 400,
        longTermCents: -250,
        totalCents: 150,
        disposals: 2,
      },
      {
        financialYear: 2024,
        shortTermCents: 1000,
        longTermCents: 50,
        totalCents: 1050,
        disposals: 2,
      },
    ]);
  });

  it('does not repeat the as-of FY when it has disposals', () => {
    const rows = realisedByFinancialYear(
      [disposal('2026-07-01', 2026, 'short', 100)],
      '2026-09-24',
    );
    expect(rows).toEqual([
      { financialYear: 2026, shortTermCents: 100, longTermCents: 0, totalCents: 100, disposals: 1 },
    ]);
  });

  it('matches computeInvestments on the same disposals', () => {
    const r = run({
      instruments: [instrument(1, 'ASX:ABC')],
      trades: [
        trade(1, 1, '2024-06-30', '10', '10'),
        trade(2, 1, '2025-06-30', '-4', '12'),
        trade(3, 1, '2025-07-01', '-6', '9'),
      ],
    });
    expect(realisedByFinancialYear(r.disposals, r.asOf)).toEqual(r.realisedByFy);
    expect(r.realisedByFy.map((row) => row.financialYear)).toEqual([2026, 2025, 2024]);
    expect(r.summary.realisedThisFyCents).toBe(0);
  });
});
