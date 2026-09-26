// The snapshot composer and checks (stage-5.md §2.4, §2.5, §7.3 step 1). Generic figures only.
import { describe, expect, it } from 'vitest';
import {
  cashTotals,
  checkSnapshots,
  composeSnapshot,
  deriveSnapshotColumns,
  type ComposeSnapshotInput,
  type EngineCashAccount,
  type EngineTrade,
} from '../src/index';
import { D, ratio, trade } from './helpers';
import { assetsColumns, figures, investments, snapshot } from './snapshotHelpers';

const ACCOUNTS: EngineCashAccount[] = [
  { id: 1, kind: 'bank', isOffset: false, balanceCents: 3_000_000 },
  { id: 2, kind: 'credit_card', isOffset: false, balanceCents: -30_000 }, // in debit
  { id: 3, kind: 'bank', isOffset: true, balanceCents: 1_500_000 }, // an offset account
  { id: 4, kind: 'loan_receivable', isOffset: false, balanceCents: 50_000 },
  { id: 5, kind: 'other', isOffset: false, balanceCents: -20_000 }, // in debit
];

/** Stock trades around a window (2026-08-31, 2026-09-24]; one ETF sale inside it. */
const TRADES: Record<'stock' | 'etf' | 'crypto' | 'managed_fund', EngineTrade[]> = {
  stock: [
    trade(1, 10, '2026-08-24', '10', '10'), // $100: only in the month-before window
    trade(2, 10, '2026-08-31', '5', '10'), // $50: on the previous run date (excluded)
    trade(3, 10, '2026-09-01', '2', '100'), // $200
    trade(4, 10, '2026-09-24', '1', '50.5'), // $50.50 on the run date (included)
    trade(5, 10, '2026-09-25', '9', '9'), // after the run date
  ],
  etf: [trade(6, 20, '2026-09-10', '-4', '25')], // a sale: −$100
  crypto: [],
  managed_fund: [trade(7, 30, '2026-09-15', '1000', '1.2345')], // $1,234.50
};

function input(over: Partial<ComposeSnapshotInput> = {}): ComposeSnapshotInput {
  return {
    periodMonth: '2026-09',
    runDate: '2026-09-24',
    previous: { runDate: '2026-08-31', cashValueCents: 2_000_000 },
    investments: {
      stock: investments('stock', 1_100_000, 100_000),
      etf: investments('etf', 5_000_000, -200_000),
      crypto: investments('crypto', 0, 0),
      managed_fund: investments('managed_fund', 800_000, 80_000),
    },
    trades: TRADES,
    cash: cashTotals({
      accounts: ACCOUNTS,
      offsetsIncludeEmergencyFund: false,
      loansCountForEmergencyFund: false,
    }),
    cashAccounts: ACCOUNTS,
    salaryMonthlyCents: 600_000,
    assets: assetsColumns(),
    superMeasuredThrough: '2026-09-20',
    ...over,
  };
}

describe('composeSnapshot (§2.4)', () => {
  it('maps every History column and the Stage 5 extras', () => {
    const f = composeSnapshot(input());
    expect(f).toEqual({
      // B–E: value, total return (D41), the sheet ratio of those cents, movements in the window.
      stocksValueCents: 1_100_000,
      stocksGainCents: 100_000,
      stocksGainRatio: '0.1',
      stocksMovementsCents: 25_050,
      etfValueCents: 5_000_000,
      etfGainCents: -200_000,
      etfGainRatio: ratio(D(-200_000).div(5_200_000)),
      etfMovementsCents: -10_000,
      cryptoValueCents: 0,
      cryptoGainCents: 0,
      cryptoGainRatio: '0',
      cryptoMovementsCents: 0,
      // N–P: Total Cash (non-offset accounts, loans in, debit accounts netted), the change.
      cashValueCents: 3_000_000,
      cashGainCents: 1_000_000,
      cashIncreaseRatio: '0.5',
      // Q–T: the seam; T from the rounded cents.
      superValueCents: 20_000_000,
      superContribCents: 50_000,
      superGainCents: 500_000,
      superGainRatio: ratio(D(500_000).div(19_500_000)),
      // U, V: LiabilitiesDebts is not rebuilt (D2).
      liabilitiesBalanceCents: 0,
      liabilitiesPaidCents: 0,
      salaryMonthlyCents: 600_000,
      // X–AE: the seam; Z = X + AB + the linked offsets (D67).
      propertyValueCents: 60_000_000,
      propertyPurchaseCents: 55_000_000,
      propertyEquityCents: 21_000_000,
      propertyGainCents: 5_000_000,
      mortgageBalanceCents: -40_000_000,
      mortgageInterestFeesCents: 1_200_000,
      mortgagePrincipalPaidCents: 800_000,
      propertyGainRatio: ratio(D(5_000_000).div(55_000_000)),
      mfValueCents: 800_000,
      mfGainCents: 80_000,
      mfGainRatio: ratio(D(80_000).div(720_000)),
      mfMovementsCents: 123_450,
      otherValueCents: 300_000,
      otherGainCents: 30_000,
      // Extras (D88): every offset account; the linked ones; accounts in debit; the super cut-off.
      offsetCents: 1_500_000,
      mortgageOffsetCents: 1_000_000,
      cashDebtCents: -50_000,
      superMeasuredThrough: '2026-09-20',
    });
  });

  it('uses the month before the run date as the window without a previous snapshot', () => {
    const f = composeSnapshot(input({ previous: null }));
    // (2026-08-24, 2026-09-24]: the 2026-08-31 trade is in, the 2026-08-24 one is not.
    expect(f.stocksMovementsCents).toBe(30_050);
    expect(f.cashGainCents).toBeNull();
    expect(f.cashIncreaseRatio).toBe('0');
  });

  it('leaves O null (and P 0) when the previous cash is null', () => {
    const f = composeSnapshot(input({ previous: { runDate: '2026-08-31', cashValueCents: null } }));
    expect(f.cashGainCents).toBeNull();
    expect(f.cashIncreaseRatio).toBe('0');
  });

  it('gives an empty window to a month recorded with the same run date as the previous one', () => {
    const f = composeSnapshot(
      input({ previous: { runDate: '2026-09-24', cashValueCents: 3_000_000 } }),
    );
    expect(f.stocksMovementsCents).toBe(0);
    expect(f.mfMovementsCents).toBe(0);
    expect(f.cashGainCents).toBe(0);
  });

  it('keeps the extras at 0 without offset or debit accounts; T is 0 with no super gain', () => {
    const accounts: EngineCashAccount[] = [
      { id: 1, kind: 'bank', isOffset: false, balanceCents: 100 },
    ];
    const f = composeSnapshot(
      input({
        cash: cashTotals({
          accounts,
          offsetsIncludeEmergencyFund: false,
          loansCountForEmergencyFund: false,
        }),
        cashAccounts: accounts,
        assets: assetsColumns({
          superGainCents: null,
          superGainRatio: null,
          mortgageOffsetCents: 0,
        }),
        superMeasuredThrough: null,
      }),
    );
    expect(f.offsetCents).toBe(0);
    expect(f.mortgageOffsetCents).toBe(0);
    expect(f.cashDebtCents).toBe(0);
    expect(f.superGainRatio).toBe('0');
    expect(f.superMeasuredThrough).toBeNull();
    expect(f.propertyEquityCents).toBe(20_000_000);
  });

  it('equals its own derived columns (a recorded row agrees with its inputs by construction)', () => {
    const f = composeSnapshot(input());
    expect({
      ...f,
      ...deriveSnapshotColumns({ figures: f, previousCashValueCents: 2_000_000 }),
    }).toEqual(f);
  });
});

describe('deriveSnapshotColumns (§2.5)', () => {
  it('uses the sheet ratio: 0 for a zero denominator or a null figure', () => {
    const d = deriveSnapshotColumns({
      figures: figures({
        stocksValueCents: 500,
        stocksGainCents: 500, // v − g = 0
        etfValueCents: null,
        etfGainCents: 100,
        cryptoValueCents: 100,
        cryptoGainCents: null,
        superValueCents: 1_000,
        superGainCents: -1_000, // v − g = 2,000: −0.5
        mfValueCents: 3,
        mfGainCents: 1,
      }),
      previousCashValueCents: undefined,
    });
    expect(d.stocksGainRatio).toBe('0');
    expect(d.etfGainRatio).toBe('0');
    expect(d.cryptoGainRatio).toBe('0');
    expect(d.superGainRatio).toBe('-0.5');
    expect(d.mfGainRatio).toBe('0.5');
    expect(d.propertyGainRatio).toBe('0');
    expect(d.cashGainCents).toBeNull(); // no previous snapshot
    expect(d.cashIncreaseRatio).toBe('0');
    expect(d.propertyEquityCents).toBeNull(); // X and AB both null
  });

  it('computes O from the previous cash and Z with the linked offsets', () => {
    const d = deriveSnapshotColumns({
      figures: figures({
        cashValueCents: 1_200,
        propertyValueCents: 10_000,
        mortgageBalanceCents: -8_000,
        mortgageOffsetCents: 500,
      }),
      previousCashValueCents: 1_000,
    });
    expect(d.cashGainCents).toBe(200);
    expect(d.cashIncreaseRatio).toBe('0.2');
    expect(d.propertyEquityCents).toBe(2_500);
    // A previous snapshot whose cash is null: no O.
    expect(
      deriveSnapshotColumns({
        figures: figures({ cashValueCents: 1 }),
        previousCashValueCents: null,
      }).cashGainCents,
    ).toBeNull();
    // Z counts a missing X or AB as 0 (the sheet's blank), and has no offsets on migrated rows.
    expect(
      deriveSnapshotColumns({
        figures: figures({ propertyValueCents: 0, mortgageBalanceCents: null }),
        previousCashValueCents: undefined,
      }).propertyEquityCents,
    ).toBe(0);
  });
});

describe('checkSnapshots (§2.5)', () => {
  const noTrades = { stock: [], etf: [], crypto: [], managed_fund: [] };
  /** A consistent row: stocks 1,100,000 / 100,000 (r = 0.1), cash, property, zero movements. */
  const row = (month: string, runDate: string, cash: number, over = {}) =>
    snapshot(`2026-${month}`, runDate, {
      stocksValueCents: 1_100_000,
      stocksGainCents: 100_000,
      stocksGainRatio: '0.1',
      stocksMovementsCents: 0,
      etfGainRatio: '0',
      etfMovementsCents: 0,
      cryptoGainRatio: '0',
      cryptoMovementsCents: 0,
      cashValueCents: cash,
      cashIncreaseRatio: '0',
      superGainRatio: '0',
      propertyValueCents: 1_000,
      mortgageBalanceCents: -600,
      propertyEquityCents: 400,
      propertyGainRatio: '0',
      mfGainRatio: '0',
      mfMovementsCents: 0,
      ...over,
    });

  it('matches consistent rows and counts every cell (the first row has no O check)', () => {
    const r = checkSnapshots({
      snapshots: [
        row('08', '2026-08-31', 1_200, { cashGainCents: 200, cashIncreaseRatio: '0.2' }),
        // The first row's O is a typed seed (not checked); its P follows the stored O.
        row('07', '2026-07-31', 1_000, { cashGainCents: 500, cashIncreaseRatio: '1' }),
      ],
      trades: noTrades,
    });
    expect(r.checked).toBe(12 + 13);
    expect(r.matched).toBe(25);
    expect(r.rows.map((x) => [x.periodMonth, x.checked, x.differences])).toEqual([
      ['2026-07', 12, []],
      ['2026-08', 13, []],
    ]);
  });

  it('holds a ratio to |r × (v − g) − g| ≤ 1 + |r| cents', () => {
    const check = (r: string) =>
      checkSnapshots({
        snapshots: [row('07', '2026-07-31', 1, { stocksGainRatio: r })],
        trades: noTrades,
      }).rows[0]!.differences;
    expect(check('0.100001')).toEqual([]); // 1 cent off: within 1.1
    expect(check('0.100002')).toEqual([
      {
        column: 'stocksGainRatio',
        kind: 'derived',
        storedCents: null,
        recomputedCents: null,
        storedRatio: '0.100002',
        recomputedRatio: '0.1',
      },
    ]);
    // A zero denominator needs r = 0; a null figure accepts 0 or blank.
    const zero = (r: string | null) =>
      checkSnapshots({
        snapshots: [
          row('07', '2026-07-31', 1, {
            stocksValueCents: 5,
            stocksGainCents: 5,
            stocksGainRatio: r,
          }),
        ],
        trades: noTrades,
      }).rows[0]!.differences.length;
    expect(zero('0')).toBe(0);
    expect(zero('0.5')).toBe(1);
    const blank = (r: string | null) =>
      checkSnapshots({
        snapshots: [row('07', '2026-07-31', 1, { stocksValueCents: null, stocksGainRatio: r })],
        trades: noTrades,
      }).rows[0]!.differences.length;
    expect(blank('0')).toBe(0);
    expect(blank(null)).toBe(0);
    expect(blank('0.1')).toBe(1);
    // A null ratio against figures never matches.
    expect(check(null as unknown as string)).toHaveLength(1);
  });

  it('holds O and Z to 1 cent', () => {
    const diffs = (o: number, z: number) =>
      checkSnapshots({
        snapshots: [
          row('07', '2026-07-31', 1_000),
          row('08', '2026-08-31', 1_200, {
            cashGainCents: o,
            cashIncreaseRatio: ratio(D(o).div(1_200 - o)),
            propertyEquityCents: z,
          }),
        ],
        trades: noTrades,
      }).rows[1]!.differences.map((d) => [d.column, d.storedCents, d.recomputedCents]);
    expect(diffs(201, 401)).toEqual([]);
    expect(diffs(202, 402)).toEqual([
      ['cashGainCents', 202, 200],
      ['propertyEquityCents', 402, 400],
    ]);
  });

  it('flags a null against a figure', () => {
    const r = checkSnapshots({
      snapshots: [
        row('07', '2026-07-31', 1_000),
        row('08', '2026-08-31', 1_200, { cashGainCents: null, stocksMovementsCents: null }),
      ],
      trades: noTrades,
    });
    expect(
      r.rows[1]!.differences.map((d) => [d.column, d.kind, d.storedCents, d.recomputedCents]),
    ).toEqual([
      ['cashGainCents', 'derived', null, 200],
      ['stocksMovementsCents', 'movement', null, 0],
    ]);
    expect(r.matched).toBe(r.checked - 2);
  });

  it('recomputes the movements over each window and reports a trade changed later', () => {
    const trades = {
      ...noTrades,
      stock: [
        trade(1, 10, '2026-07-01', '1', '100'), // in the first window (2026-06-30, 2026-07-31]
        trade(2, 10, '2026-06-30', '1', '999'), // before it
        trade(3, 10, '2026-08-15', '2', '100'), // the second window, edited after recording
      ],
    };
    const r = checkSnapshots({
      snapshots: [
        row('07', '2026-07-31', 1_000, { stocksMovementsCents: 10_000 }),
        row('08', '2026-08-31', 1_000, { cashGainCents: 0, stocksMovementsCents: 10_000 }),
      ],
      trades,
    });
    expect(r.rows[0]!.differences).toEqual([]);
    expect(r.rows[1]!.differences).toEqual([
      {
        column: 'stocksMovementsCents',
        kind: 'movement',
        storedCents: 10_000,
        recomputedCents: 20_000,
        storedRatio: null,
        recomputedRatio: null,
      },
    ]);
  });

  it('orders by run date; months sharing a run date keep their order (the later window is empty)', () => {
    const trades = { ...noTrades, stock: [trade(1, 10, '2026-09-02', '1', '100')] };
    const r = checkSnapshots({
      snapshots: [
        row('08', '2026-09-02', 1_000, { cashGainCents: 0, stocksMovementsCents: 10_000 }),
        row('09', '2026-09-02', 1_000, { cashGainCents: 0, stocksMovementsCents: 0 }),
        row('07', '2026-07-31', 1_000),
      ].map((s, k) => (k < 2 ? { ...s, source: 'late' as const } : s)),
      trades,
    });
    expect(r.rows.map((x) => [x.periodMonth, x.source, x.differences.length])).toEqual([
      ['2026-07', 'migrated', 0],
      ['2026-08', 'late', 0],
      ['2026-09', 'late', 0],
    ]);
  });
});
