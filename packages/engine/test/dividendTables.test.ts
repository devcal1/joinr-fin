// Dividends page figures (stage-3.md §2.10; §7.3 step 8): the FY table, the rolling 12 months,
// this FY by holding with the DRP advice, and the shared per-payment rule. Generic holdings.
import { describe, expect, it } from 'vitest';
import {
  computeDividends,
  type DividendHoldingInput,
  type DividendsInput,
  type EngineDividend,
} from '../src/index';
import { cents, D, dividend, instrument, prices, ratio, run, trade } from './helpers';

const holding = (
  instrumentId: number,
  kind: DividendHoldingInput['kind'],
  dividendFreqMonths: number | null,
  drp: boolean | null,
  unitsNow: string,
): DividendHoldingInput => ({ instrumentId, kind, dividendFreqMonths, drp, unitsNow });

const holdings: DividendHoldingInput[] = [
  holding(1, 'stock', 6, false, '150'),
  holding(3, 'etf', 3, true, '35'),
  holding(4, 'etf', 3, true, '1200'),
  holding(5, 'managed_fund', 12, null, '1000'),
  holding(8, 'crypto', null, null, '1.25'),
  holding(9, 'etf', 0, false, '100'),
];
const trades = [
  trade(1, 1, '2023-01-15', '100', '10'),
  trade(2, 1, '2025-06-16', '50', '11'),
  trade(3, 3, '2019-07-01', '30', '80'),
  trade(4, 3, '2024-07-01', '5', '100'),
  trade(5, 4, '2024-01-10', '1000', '45'),
  trade(6, 4, '2026-08-18', '200', '52'),
  trade(7, 5, '2024-09-10', '1000', '1.4'),
  trade(8, 8, '2025-03-03', '1.25', '3000'),
  trade(9, 9, '2026-01-01', '100', '10'),
];
const div = (
  id: number,
  instrumentId: number | null,
  holdingKind: EngineDividend['holdingKind'],
  paymentDate: string,
  exDate: string | null,
  reinvested: boolean | null,
  net: number,
  priceAtEx: string | null,
) => dividend(id, instrumentId, paymentDate, net, { holdingKind, exDate, reinvested, priceAtEx });

const dividends: EngineDividend[] = [
  div(1, 3, 'etf', '2020-10-16', '2020-09-30', false, 3_000, '90'),
  div(2, 1, 'stock', '2023-03-20', '2023-03-01', false, 3_000, '10'),
  div(3, 3, 'etf', '2024-10-16', '2024-10-01', true, 4_000, '100'),
  div(4, 4, 'etf', '2025-04-16', '2025-04-01', false, 12_000, '50'),
  div(5, 1, 'stock', '2025-09-20', '2025-09-01', false, 4_500, '12'),
  div(6, 4, 'etf', '2025-10-16', '2025-10-01', false, 12_500, '50.5'),
  div(7, 3, 'etf', '2026-01-16', '2026-01-02', true, 4_000, '102'),
  div(8, 4, 'etf', '2026-04-16', '2026-04-01', false, 13_000, '51'),
  div(9, 5, 'managed_fund', '2026-07-15', '2026-06-30', null, 8_000, '1.5'),
  div(10, 3, 'etf', '2026-07-16', '2026-07-01', true, 4_200, '104'),
  div(11, 4, 'etf', '2026-07-16', '2026-07-01', true, 13_500, '52'),
  div(12, 8, 'crypto', '2026-08-31', null, true, 1_800, null),
  div(13, 1, 'stock', '2026-09-18', '2026-09-01', false, 5_250, '12.5'),
  div(14, null, 'etf', '2026-08-15', null, null, 5_000, null), // no instrument
  div(15, 9, 'stock', '2026-08-20', '2026-08-01', false, 1_000, '10'), // instrument of another kind
  div(16, 1, 'stock', '2026-09-30', '2026-09-15', false, 100, '12'), // after asOf, this month
];
const input: DividendsInput = { asOf: '2026-09-24', holdings, trades, dividends };
const kind = (etf: number, stock: number, managed_fund: number, crypto: number) => ({
  stock,
  etf,
  managed_fund,
  crypto,
});

describe('computeDividends (§2.10)', () => {
  const r = computeDividends(input);

  it("always lists asOf's FY and the four before it, plus older FYs with payments", () => {
    expect(r.byFinancialYear).toEqual([
      { financialYear: 2026, byKind: kind(22_700, 6_350, 8_000, 1_800), totalCents: 38_850 },
      { financialYear: 2025, byKind: kind(29_500, 4_500, 0, 0), totalCents: 34_000 },
      { financialYear: 2024, byKind: kind(16_000, 0, 0, 0), totalCents: 16_000 },
      { financialYear: 2023, byKind: kind(0, 0, 0, 0), totalCents: 0 },
      { financialYear: 2022, byKind: kind(0, 3_000, 0, 0), totalCents: 3_000 },
      // FY2021 has no payment and is older than the five: no row; FY2020 has one.
      { financialYear: 2020, byKind: kind(3_000, 0, 0, 0), totalCents: 3_000 },
    ]);
  });

  it('sums the 12 calendar months ending with asOf’s month, across a year end', () => {
    expect(r.rolling12.map((m) => m.month)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(r.rolling12.map((m) => m.totalCents)).toEqual([
      12_500, 0, 0, 4_000, 0, 0, 13_000, 0, 0, 25_700, 7_800, 5_350,
    ]);
    expect(r.rolling12[9]!.byKind).toEqual(kind(17_700, 0, 8_000, 0));
  });

  it('builds this FY by holding: net, payments, the 365-day yield and the DRP advice', () => {
    const yieldOf = (net: number, price: string, units: number) =>
      D(net).div(D(price).times(units));
    const y4 = [yieldOf(125, '50.5', 1000), yieldOf(130, '51', 1000), yieldOf(135, '52', 1000)];
    const mean4 = y4.reduce((a, b) => a.plus(b), D(0)).div(3);
    const y3 = [yieldOf(40, '102', 35), yieldOf(42, '104', 35)];
    const mean3 = y3.reduce((a, b) => a.plus(b), D(0)).div(2);
    expect(r.holdingsThisFy).toEqual([
      {
        instrumentId: 4,
        kind: 'etf',
        netThisFyCents: 13_500,
        payments: 1,
        frequencyMonths: 3,
        drp: true,
        yield365Ratio: ratio(mean4.times(4)),
        monthsToExtraUnit: 1,
        advice: 'keep',
      },
      {
        instrumentId: 5,
        kind: 'managed_fund',
        netThisFyCents: 8_000,
        payments: 1,
        frequencyMonths: 12,
        drp: null,
        yield365Ratio: ratio(D(80).div(1500)),
        monthsToExtraUnit: 1,
        advice: null,
      },
      {
        instrumentId: 1,
        kind: 'stock',
        netThisFyCents: 5_350,
        payments: 2,
        frequencyMonths: 6,
        drp: false,
        // Only the payment in (asOf − 365, asOf]: 52.50 / (12.50 × 150) = 0.028, × 12 / 6.
        yield365Ratio: '0.056',
        monthsToExtraUnit: 2,
        advice: 'switch_on',
      },
      {
        instrumentId: 3,
        kind: 'etf',
        netThisFyCents: 4_200,
        payments: 1,
        frequencyMonths: 3,
        drp: true,
        yield365Ratio: ratio(mean3.times(4)),
        monthsToExtraUnit: 8,
        advice: 'switch_off',
      },
      {
        instrumentId: 8,
        kind: 'crypto',
        netThisFyCents: 1_800,
        payments: 1,
        frequencyMonths: null,
        drp: null,
        yield365Ratio: null,
        monthsToExtraUnit: null,
        advice: null,
      },
    ]);
  });

  it('keeps unlinked payments (no instrument, or one of another kind) apart', () => {
    expect(r.unlinkedThisFyCents).toBe(6_000);
    expect(r.rows.find((x) => x.dividendId === 15)).toEqual({
      dividendId: 15,
      instrumentId: 9,
      unitsAtEx: null,
      yieldRatio: null,
    });
  });

  it('gives the FY KPIs, SheetOptions H30 and H28', () => {
    expect(r.kpis).toEqual({
      financialYear: 2026,
      thisFyCents: 38_850,
      lastFyCents: 34_000,
      allTimeCents: 94_850,
      rolling12Cents: 68_350,
      reinvestedThisFyCents: 19_500,
      daysIntoFy: 86,
      projectedFyCents: cents(D(388.5).div(86).times('365.25')),
    });
  });

  it('shares the per-payment rule with computeInvestments (one row per dividend, input order)', () => {
    expect(r.rows.map((x) => x.dividendId)).toEqual(dividends.map((d) => d.id));
    const etf = run({
      kind: 'etf',
      instruments: [
        instrument(3, 'ASX:XYZ', { kind: 'etf' }),
        instrument(4, 'ASX:DEF', { kind: 'etf' }),
        instrument(9, 'ASX:GHI', { kind: 'etf' }),
      ],
      trades: trades.filter((t) => [3, 4, 9].includes(t.instrumentId)),
      dividends: dividends.filter((d) => d.holdingKind === 'etf'),
      prices: prices([[3, '100']]),
    });
    for (const d of etf.dividends)
      expect(r.rows.find((x) => x.dividendId === d.dividendId)).toEqual(d);
  });

  it('has the five zero FY rows and nothing else with no dividends', () => {
    const empty = computeDividends({ ...input, dividends: [] });
    expect(empty.byFinancialYear.map((x) => [x.financialYear, x.totalCents])).toEqual([
      [2026, 0],
      [2025, 0],
      [2024, 0],
      [2023, 0],
      [2022, 0],
    ]);
    expect(empty.holdingsThisFy).toEqual([]);
    expect(empty.kpis).toMatchObject({ thisFyCents: 0, projectedFyCents: 0, daysIntoFy: 86 });
  });
});

describe('DRP advice boundaries (Dividends N and R)', () => {
  // One payment with a 1 % yield (1.00 on 100 units at 1.00); 6-monthly; N = ⌈6 / (0.01 × units)⌉.
  const advise = (unitsNow: string, drp: boolean | null) =>
    computeDividends({
      asOf: '2026-09-24',
      holdings: [holding(1, 'stock', 6, drp, unitsNow)],
      trades: [trade(1, 1, '2026-01-01', '100', '1')],
      dividends: [div(1, 1, 'stock', '2026-08-01', '2026-07-15', false, 100, '1')],
    }).holdingsThisFy[0]!;

  it('rounds a 5.9-month wait up to 6: switch off with DRP on, keep with it off', () => {
    // 6 / (0.01 × 101.69491525424) = 5.9.
    expect(advise('101.69491525424', true)).toMatchObject({
      monthsToExtraUnit: 6,
      advice: 'switch_off',
    });
    expect(advise('101.69491525424', false)).toMatchObject({
      monthsToExtraUnit: 6,
      advice: 'keep',
    });
  });

  it('under 6 months: switch on with DRP off, keep with it on; unknown DRP gives no advice', () => {
    expect(advise('120', false)).toMatchObject({ monthsToExtraUnit: 5, advice: 'switch_on' });
    expect(advise('120', true)).toMatchObject({ monthsToExtraUnit: 5, advice: 'keep' });
    expect(advise('120', null)).toMatchObject({ monthsToExtraUnit: 5, advice: null });
  });

  it('has no wait without units now or without a frequency', () => {
    expect(advise('0', true)).toMatchObject({ monthsToExtraUnit: null, advice: null });
    const noFreq = computeDividends({
      asOf: '2026-09-24',
      holdings: [holding(1, 'stock', 0, true, '100')],
      trades: [trade(1, 1, '2026-01-01', '100', '1')],
      dividends: [div(1, 1, 'stock', '2026-08-01', '2026-07-15', false, 100, '1')],
    }).holdingsThisFy[0]!;
    expect(noFreq).toMatchObject({
      frequencyMonths: null,
      yield365Ratio: null,
      monthsToExtraUnit: null,
      advice: null,
    });
  });
});
