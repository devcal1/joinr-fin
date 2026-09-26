// The savings engine (stage-3.md §2.5; §7.3 step 3). A hand-worked three-snapshot example plus
// the edge cases. Generic, round figures only.
import { describe, expect, it } from 'vitest';
import {
  computeSavings,
  type SavingsInput,
  type SavingsLiveInput,
  type SavingsSnapshotInput,
} from '../src/index';
import { D, dividend, ratio, trade } from './helpers';

const snapshot = (
  runDate: string,
  cashValueCents: number | null,
  over: Partial<SavingsSnapshotInput> = {},
): SavingsSnapshotInput => ({
  periodMonth: runDate.slice(0, 7),
  runDate,
  cashValueCents,
  superContribCents: 0,
  salaryMonthlyCents: 500_000,
  propertyPurchaseCents: 0,
  mortgageBalanceCents: 0,
  mortgagePrincipalPaidCents: 0,
  ...over,
});

const live: SavingsLiveInput = {
  cashCents: 1_180_000,
  salaryMonthlyCents: 520_000,
  superContribCents: 0,
  propertyPurchaseCents: null,
  mortgageBalanceCents: null,
  mortgagePrincipalPaidCents: null,
};

/** Three snapshots (Jan, Feb, Mar 2026) and a provisional April to 20 April. */
const input: SavingsInput = {
  asOf: '2026-04-20',
  snapshots: [
    snapshot('2026-03-31', 1_100_000, { superContribCents: 10_000, salaryMonthlyCents: 520_000 }),
    snapshot('2026-01-31', 1_000_000),
    snapshot('2026-02-28', 1_150_000, { superContribCents: 20_000 }),
  ],
  live,
  trades: [
    trade(1, 1, '2026-01-15', '10', '50'), // the baseline's window: ignored
    trade(2, 1, '2026-02-10', '20', '100'),
    trade(3, 2, '2026-02-28', '1.5', '10', { feeCents: 999 }), // on the run date; fees excluded
    trade(4, 1, '2026-03-01', '-5', '110'),
    trade(5, 2, '2026-04-05', '3', '100'),
    trade(6, 2, '2026-04-21', '1', '100'), // after asOf: no period
  ],
  otherAssetPurchases: [
    { date: '2026-01-20', amountCents: 5_000 },
    { date: '2026-03-15', amountCents: 25_000 },
  ],
  sideIncome: [
    { date: '2026-01-05', amountCents: 40_000 },
    { date: '2026-02-15', amountCents: 30_000 },
    { date: '2026-03-31', amountCents: 20_000 },
    { date: '2026-04-10', amountCents: 10_000 },
  ],
  dividends: [
    dividend(1, 1, '2026-03-20', 5_000, { reinvested: false }),
    dividend(2, 1, '2026-03-25', 3_000, { reinvested: true }),
    dividend(3, 2, '2026-04-15', 2_000, { reinvested: null }),
  ],
  adjustments: [
    { periodMonth: '2026-02', amountCents: 80_000 },
    { periodMonth: '2026-01', amountCents: 7_777 }, // the baseline ignores it
    { periodMonth: '2026-04', amountCents: 1_234 }, // the provisional month ignores it
  ],
  includeMortgagePrincipal: true,
};

describe('computeSavings (§2.5)', () => {
  const r = computeSavings(input);

  it('orders the periods by run date with the provisional period last', () => {
    expect(r.periods.map((p) => [p.periodMonth, p.status, p.after, p.through])).toEqual([
      ['2026-01', 'first', null, '2026-01-31'],
      ['2026-02', 'closed', '2026-01-31', '2026-02-28'],
      ['2026-03', 'closed', '2026-02-28', '2026-03-31'],
      ['2026-04', 'provisional', '2026-03-31', '2026-04-20'],
    ]);
    expect(r.periods.at(-1)!.runDate).toBe('2026-04-20');
  });

  it('makes the first snapshot a baseline with cash only (§11 fix 18)', () => {
    expect(r.periods[0]).toEqual({
      periodMonth: '2026-01',
      runDate: '2026-01-31',
      after: null,
      through: '2026-01-31',
      status: 'first',
      cashCents: 1_000_000,
      cashGainCents: null,
      cashGainRatio: null,
      addedInvestmentsCents: null,
      added: null,
      income: null,
      adjustmentCents: 0,
      raw: { incomeCents: null, savingsCents: null, savingsRatio: null, spendCents: null },
      adjusted: { incomeCents: null, savingsCents: null, savingsRatio: null, spendCents: null },
    });
  });

  it('works a closed period with an adjustment by hand (D51)', () => {
    // Gain 1500; trades 2000 + 15 = 2015; super 200 → added 2215; income 5000 + 300 = 5300.
    // Raw savings 3715 (rate 3715 / 5300, spend 1585); an 800 adjustment leaves 2915.
    expect(r.periods[1]).toEqual({
      periodMonth: '2026-02',
      runDate: '2026-02-28',
      after: '2026-01-31',
      through: '2026-02-28',
      status: 'closed',
      cashCents: 1_150_000,
      cashGainCents: 150_000,
      cashGainRatio: '0.15',
      addedInvestmentsCents: 221_500,
      added: {
        tradesCents: 201_500,
        otherAssetsCents: 0,
        superCents: 20_000,
        mortgagePrincipalCents: 0,
        propertyDepositCents: 0,
      },
      income: {
        salaryCents: 500_000,
        sideIncomeCents: 30_000,
        cashDividendsCents: 0,
        otherDividendsCents: 0,
      },
      adjustmentCents: 80_000,
      raw: {
        incomeCents: 530_000,
        savingsCents: 371_500,
        savingsRatio: ratio(D(3715).div(5300)),
        spendCents: 158_500,
      },
      adjusted: {
        incomeCents: 530_000,
        savingsCents: 291_500,
        savingsRatio: ratio(D(2915).div(5300)),
        spendCents: 238_500,
      },
    });
  });

  it('counts a sell negative, other assets and dividends by window; reinvested ones only adjusted (§11 fix 12)', () => {
    const p = r.periods[2]!;
    // Gain −500; trades −550, other assets 250, super 100 → added −200; savings −700.
    expect(p).toMatchObject({
      cashGainCents: -50_000,
      cashGainRatio: ratio(D(-500).div(11_500)),
      addedInvestmentsCents: -20_000,
      added: { tradesCents: -55_000, otherAssetsCents: 25_000, superCents: 10_000 },
      income: {
        salaryCents: 520_000,
        sideIncomeCents: 20_000,
        cashDividendsCents: 5_000,
        otherDividendsCents: 3_000,
      },
      adjustmentCents: 0,
    });
    expect(p.raw).toEqual({
      incomeCents: 545_000,
      savingsCents: -70_000,
      savingsRatio: ratio(D(-700).div(5450)),
      spendCents: 615_000,
    });
    expect(p.adjusted).toEqual({
      incomeCents: 548_000,
      savingsCents: -70_000,
      savingsRatio: ratio(D(-700).div(5480)),
      spendCents: 618_000,
    });
  });

  it('builds the provisional period from the live values and ignores an adjustment on it', () => {
    const p = r.periods[3]!;
    expect(p).toMatchObject({
      periodMonth: '2026-04',
      status: 'provisional',
      cashCents: 1_180_000,
      cashGainCents: 80_000,
      addedInvestmentsCents: 30_000,
      added: {
        tradesCents: 30_000,
        superCents: 0,
        mortgagePrincipalCents: 0,
        propertyDepositCents: 0,
      },
      income: {
        salaryCents: 520_000,
        sideIncomeCents: 10_000,
        cashDividendsCents: 0,
        otherDividendsCents: 2_000,
      },
      adjustmentCents: 0,
    });
    expect(p.raw).toEqual({
      incomeCents: 530_000,
      savingsCents: 110_000,
      savingsRatio: ratio(D(1100).div(5300)),
      spendCents: 420_000,
    });
    expect(p.adjusted.savingsRatio).toBe(ratio(D(1100).div(5320)));
  });

  it('has no provisional period without live values or when asOf is not after the last run', () => {
    expect(computeSavings({ ...input, live: null }).periods.map((p) => p.status)).toEqual([
      'first',
      'closed',
      'closed',
    ]);
    expect(computeSavings({ ...input, asOf: '2026-03-31' }).periods).toHaveLength(3);
    expect(computeSavings({ ...input, snapshots: [] }).periods).toEqual([]);
  });
});

describe('computeSavings: property, mortgage and nulls', () => {
  const base: SavingsInput = {
    ...input,
    live: null,
    trades: [],
    otherAssetPurchases: [],
    sideIncome: [],
    dividends: [],
    adjustments: [],
  };

  it('captures a property purchase as Δ purchase value + Δ (negative) mortgage balance', () => {
    const r = computeSavings({
      ...base,
      snapshots: [
        snapshot('2026-01-31', 1_000_000),
        snapshot('2026-02-28', 200_000, {
          propertyPurchaseCents: 50_000_000,
          mortgageBalanceCents: -40_000_000,
        }),
        snapshot('2026-03-31', 250_000, {
          propertyPurchaseCents: 50_000_000,
          mortgageBalanceCents: -39_900_000,
          mortgagePrincipalPaidCents: 100_000,
        }),
      ],
    });
    // The deposit 500,000 − 400,000 = 100,000 balances the cash drop of 8,000 (savings 92,000).
    expect(r.periods[1]!.added).toMatchObject({
      propertyDepositCents: 10_000_000,
      mortgagePrincipalCents: 0,
    });
    expect(r.periods[1]!.raw.savingsCents).toBe(9_200_000);
    // A later month: no new purchase, so no deposit; the principal paid (cumulative) counts.
    expect(r.periods[2]!.added).toMatchObject({
      propertyDepositCents: 0,
      mortgagePrincipalCents: 100_000,
    });
    expect(r.periods[2]!.addedInvestmentsCents).toBe(100_000);
  });

  it('counts the mortgage principal paid (the cumulative column’s change) only when the setting is on', () => {
    const snapshots = [
      snapshot('2026-01-31', 1_000_000, { mortgagePrincipalPaidCents: 50_000 }),
      snapshot('2026-02-28', 1_000_000, { mortgagePrincipalPaidCents: 150_000 }),
    ];
    const on = computeSavings({ ...base, snapshots, includeMortgagePrincipal: true });
    const off = computeSavings({ ...base, snapshots, includeMortgagePrincipal: false });
    expect(on.periods[1]!.added!.mortgagePrincipalCents).toBe(100_000);
    expect(on.periods[1]!.raw.savingsCents).toBe(100_000);
    expect(off.periods[1]!.added!.mortgagePrincipalCents).toBe(0);
    expect(off.periods[1]!.raw.savingsCents).toBe(0);
  });

  it('gives no ratio or spend without income, and no savings without cash', () => {
    const noIncome = computeSavings({
      ...base,
      snapshots: [
        snapshot('2026-01-31', 1_000_000, { salaryMonthlyCents: null }),
        snapshot('2026-02-28', 1_100_000, { salaryMonthlyCents: null }),
      ],
    }).periods[1]!;
    expect(noIncome.income!.salaryCents).toBeNull();
    expect(noIncome.raw).toEqual({
      incomeCents: 0,
      savingsCents: 100_000,
      savingsRatio: null,
      spendCents: null,
    });

    const noCash = computeSavings({
      ...base,
      snapshots: [
        snapshot('2026-01-31', 1_000_000),
        snapshot('2026-02-28', null),
        snapshot('2026-03-31', 1_200_000),
      ],
    }).periods;
    for (const p of noCash.slice(1)) {
      expect(p.cashGainCents).toBeNull();
      expect(p.cashGainRatio).toBeNull();
      expect(p.raw).toMatchObject({ savingsCents: null, savingsRatio: null, spendCents: null });
      expect(p.raw.incomeCents).toBe(500_000);
    }
  });

  it('has no cash gain ratio when the previous cash is zero', () => {
    const r = computeSavings({
      ...base,
      snapshots: [snapshot('2026-01-31', 0), snapshot('2026-02-28', 100_000)],
    });
    expect(r.periods[1]).toMatchObject({ cashGainCents: 100_000, cashGainRatio: null });
  });

  it('rounds the added investments once at the total', () => {
    const r = computeSavings({
      ...base,
      snapshots: [snapshot('2026-01-31', 0), snapshot('2026-02-28', 0)],
      trades: [trade(1, 1, '2026-02-01', '1', '0.004'), trade(2, 1, '2026-02-02', '1', '0.004')],
    });
    // 0.4 + 0.4 cents: each would round to 0, the total rounds to 1 cent.
    expect(r.periods[1]).toMatchObject({ addedInvestmentsCents: 1, added: { tradesCents: 1 } });
  });
});
