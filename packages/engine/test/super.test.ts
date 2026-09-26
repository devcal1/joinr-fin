// Super (stage-4.md §2.5; §7.3 step 2): fund balances at dates, contributions of every kind and
// reading, employer SG per month (statutory rate by FY, an employer's rate, statements, none),
// the SG spread by days, periods with merged not-updated months, transfers in and rollovers, T and
// Modified Dietz, the annualised chain, per-fund entry gains, the concessional cap meter (SG counted
// when the fund receives it), the snapshot, the flags and the chart. Generic, round figures only:
// a $120,000 salary gives SG of $1,200 a month at 12 % ($1,150 at 11.5 %).
import { describe, expect, it } from 'vitest';
import {
  computeSuper,
  type EngineSuperContribution,
  type EngineSuperFund,
  type SuperInput,
} from '../src/index';
import { capTiming } from '../src/super';
import { D, ratio } from './helpers';

const SALARY = 12_000_000;
const SG = 120_000; // a month at 12 %
const SG_FUND = 102_000; // after 15 % contributions tax

function fund(
  id: number,
  entries: readonly (readonly [string, number, (number | null)?])[],
  over: Partial<EngineSuperFund> = {},
): EngineSuperFund {
  return {
    id,
    receivesSg: false,
    archived: false,
    balances: entries.map(([asOf, balanceCents, transferInCents], k) => ({
      id: id * 100 + k,
      asOf,
      balanceCents,
      transferInCents: transferInCents ?? null,
    })),
    ...over,
  };
}

const snap = (runDate: string, superValueCents: number | null) => ({
  periodMonth: runDate.slice(0, 7),
  runDate,
  superValueCents,
});

function contribution(
  id: number,
  date: string,
  kind: EngineSuperContribution['kind'],
  amountCents: number,
  fundId: number | null = null,
): EngineSuperContribution {
  return { id, fundId, date, kind, amountCents };
}

/** Recorded months Mar–Jun 2026 (Apr not updated), one SG fund updated on 15/07, as of 20/07. */
const SNAPSHOTS = [
  snap('2026-03-31', 10_000_000),
  snap('2026-04-30', 10_000_000),
  snap('2026-05-31', 10_500_000),
  snap('2026-06-30', 10_300_000),
];
const MAIN = fund(
  1,
  [
    ['2026-03-31', 10_000_000],
    ['2026-05-31', 10_500_000],
    ['2026-06-30', 10_300_000],
    ['2026-07-15', 10_600_000],
  ],
  { receivesSg: true },
);
const CONTRIBUTIONS = [
  contribution(1, '2026-04-15', 'salary_sacrifice', 100_000, 1),
  contribution(2, '2026-05-10', 'after_tax', 50_000),
  contribution(3, '2026-07-10', 'salary_sacrifice', 100_000, 1),
];

function input(over: Partial<SuperInput> = {}): SuperInput {
  return {
    asOf: '2026-07-20',
    snapshots: SNAPSHOTS,
    funds: [MAIN],
    contributions: CONTRIBUTIONS,
    sgOverrides: [],
    grossAnnualSalaryCents: SALARY,
    jobStartDate: '2020-01-01',
    sgRatio: null,
    contributionsTaxRatio: '0.15',
    marginalTaxRatio: '0.3',
    importedContributionType: 'salary_sacrifice',
    concessionalCapOverride: null,
    chart: { unit: 'monthly', count: null },
    ...over,
  };
}

const period = (r: ReturnType<typeof computeSuper>, month: string) =>
  r.periods.find((p) => p.periodMonth === month)!;

describe('computeSuper: fund balances (§2.5 step 1)', () => {
  it('takes each fund’s latest entry on or before the as-of, and sums the funds not archived', () => {
    const later = fund(2, [['2026-07-21', 500_000]]); // every entry after the as-of: the earliest
    const archived = fund(3, [['2026-06-30', 0]], { archived: true });
    const r = computeSuper(input({ funds: [MAIN, later, archived] }));
    expect(r.totalCents).toBe(10_600_000 + 500_000);
    expect(r.funds.map((f) => [f.id, f.balanceCents, f.balanceAsOf])).toEqual([
      [1, 10_600_000, '2026-07-15'],
      [2, 500_000, '2026-07-21'],
      [3, 0, '2026-06-30'],
    ]);
    const empty = computeSuper(input({ funds: [fund(4, [])] }));
    expect(empty.funds[0]).toMatchObject({ balanceCents: null, balanceAsOf: null, entries: [] });
    expect(empty.totalCents).toBe(0);
  });
});

describe('computeSuper: contributions (§2.5 step 2, D71)', () => {
  const kinds = [
    contribution(1, '2026-07-01', 'salary_sacrifice', 100_000),
    contribution(2, '2026-07-02', 'after_tax', 50_000),
    contribution(3, '2026-07-02', 'voluntary_contribution', 70_000),
  ];

  it('reads salary sacrifice, after-tax and imported entries (read as salary sacrifice)', () => {
    const r = computeSuper(input({ contributions: kinds }));
    expect(r.contributions).toEqual([
      // Date desc, then id desc. The imported take-home 700 grosses up at 30 % to 1,000 pre-tax.
      {
        id: 3,
        fundId: null,
        date: '2026-07-02',
        kind: 'voluntary_contribution',
        amountCents: 70_000,
        estimate: true,
        preTaxCents: 100_000,
        fundReceivesCents: 85_000,
        netPayCostCents: 70_000,
        concessional: true,
      },
      {
        id: 2,
        fundId: null,
        date: '2026-07-02',
        kind: 'after_tax',
        amountCents: 50_000,
        estimate: false,
        preTaxCents: null,
        fundReceivesCents: 50_000,
        netPayCostCents: 50_000,
        concessional: false,
      },
      {
        id: 1,
        fundId: null,
        date: '2026-07-01',
        kind: 'salary_sacrifice',
        amountCents: 100_000,
        estimate: false,
        preTaxCents: 100_000,
        fundReceivesCents: 85_000,
        netPayCostCents: 70_000,
        concessional: true,
      },
    ]);
    expect(r.flags).toEqual(['imported_estimates']);
  });

  it('reads imported entries as after-tax when the setting says so', () => {
    const r = computeSuper(input({ contributions: kinds, importedContributionType: 'after_tax' }));
    expect(r.contributions[0]).toMatchObject({
      id: 3,
      estimate: true,
      preTaxCents: null,
      fundReceivesCents: 70_000,
      netPayCostCents: 70_000,
      concessional: false,
    });
  });

  it('leaves salary sacrifice out of the take-home cost and imported amounts ungrossed without a marginal rate', () => {
    const r = computeSuper(input({ contributions: kinds, marginalTaxRatio: null }));
    expect(
      r.contributions.map((c) => [c.id, c.preTaxCents, c.fundReceivesCents, c.netPayCostCents]),
    ).toEqual([
      [3, 70_000, 59_500, 70_000], // imported: pre-tax = the amount; the net-pay cost as imported
      [2, null, 50_000, 50_000],
      [1, 100_000, 85_000, null],
    ]);
    expect(r.flags).toEqual(['no_marginal_rate', 'imported_estimates']);
    // Only salary sacrifice needs the marginal rate.
    const afterTaxOnly = computeSuper(
      input({ contributions: [kinds[1]!], marginalTaxRatio: null }),
    );
    expect(afterTaxOnly.flags).toEqual([]);
  });

  it('rounds each row once, the imported fund figure from the unrounded gross-up', () => {
    // 400 take-home at 30 %: 571.428… pre-tax (57,143 cents); to the fund 485.71 (48,571 cents)
    // from the unrounded gross-up, not 48,572 from the rounded one.
    const r = computeSuper(
      input({ contributions: [contribution(1, '2026-07-01', 'voluntary_contribution', 40_000)] }),
    );
    expect(r.contributions[0]).toMatchObject({
      preTaxCents: 57_143,
      fundReceivesCents: 48_571,
      netPayCostCents: 40_000,
    });
  });
});

describe('computeSuper: employer SG per month earned (§2.5 step 3)', () => {
  const at = (over: Partial<SuperInput>) =>
    computeSuper(input({ asOf: '2026-09-24', snapshots: [], contributions: [], ...over }));

  it('estimates each month at the statutory rate of its FY, from the first month the previous FY’s cap counts', () => {
    const r = at({});
    expect(r.sgMonths.map((m) => m.month)).toEqual([
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
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
    // FY2024–25 at 11.5 %, from FY2025–26 at 12 % (an FY after the table uses its last entry).
    expect(r.sgMonths.slice(0, 3).map((m) => [m.grossCents, m.fundReceivesCents])).toEqual([
      [115_000, 97_750],
      [115_000, 97_750],
      [115_000, 97_750],
    ]);
    expect(
      r.sgMonths.slice(3).every((m) => m.grossCents === SG && m.fundReceivesCents === SG_FUND),
    ).toBe(true);
    expect(r.sgMonths.every((m) => m.source === 'estimate' && m.fundId === 1)).toBe(true);
    // The cap year that counts each month: its quarter's due date before July 2026, then the month.
    expect(r.sgMonths.map((m) => m.capFinancialYear)).toEqual([
      2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2026, 2026, 2026,
      2026, 2026, 2026,
    ]);
  });

  it('uses the employer’s rate for every month when it is set', () => {
    const r = at({ sgRatio: '0.1' });
    expect(
      r.sgMonths.every((m) => m.grossCents === 100_000 && m.fundReceivesCents === 85_000),
    ).toBe(true);
  });

  it('takes statement months as given (the month earned) and adds up several for one month', () => {
    const r = at({
      sgOverrides: [
        { periodMonth: '2026-08', grossCents: 100_000 },
        { periodMonth: '2026-08', grossCents: 30_000 },
      ],
    });
    expect(r.sgMonths.find((m) => m.month === '2026-08')).toMatchObject({
      source: 'statement',
      grossCents: 130_000,
      fundReceivesCents: 110_500,
    });
  });

  it('has no SG before the job started (a month counts when the job started by its last day)', () => {
    const r = at({ jobStartDate: '2025-06-15' });
    expect(r.sgMonths.slice(0, 3).map((m) => [m.month, m.source, m.grossCents])).toEqual([
      ['2025-04', 'none', 0],
      ['2025-05', 'none', 0],
      ['2025-06', 'estimate', 115_000],
    ]);
  });

  it('has no estimate without a salary; statements still count', () => {
    const r = at({
      grossAnnualSalaryCents: null,
      sgOverrides: [{ periodMonth: '2026-07', grossCents: 120_000 }],
    });
    expect(r.sgMonths.filter((m) => m.source !== 'none').map((m) => m.month)).toEqual(['2026-07']);
    expect(r.flags).toEqual(['no_salary']);
  });

  it('flags a missing SG fund while any month has SG', () => {
    const noFund = at({ funds: [{ ...MAIN, receivesSg: false }] });
    expect(noFund.flags).toEqual(['no_sg_fund']);
    expect(noFund.sgMonths.every((m) => m.fundId === null)).toBe(true);
    // An archived fund does not receive SG.
    expect(at({ funds: [{ ...MAIN, archived: true }] }).flags).toEqual(['no_sg_fund']);
    expect(at({ funds: [], grossAnnualSalaryCents: null }).flags).toEqual(['no_salary']);
  });
});

describe('computeSuper: periods and derived gains (§2.5 step 4, D69)', () => {
  const r = computeSuper(input());
  // 1–15 July: the provisional gain runs to the latest balance (15/07), not the as-of (D79).
  const sgFundJuly = D(SG).times(15).div(31).times('0.85');
  const gainJuly = D(300_000).minus(sgFundJuly).minus(85_000);

  it('keeps the baseline’s value only', () => {
    expect(period(r, '2026-03')).toEqual({
      periodMonth: '2026-03',
      runDate: '2026-03-31',
      after: null,
      through: '2026-03-31',
      status: 'first',
      valueCents: 10_000_000,
      notUpdated: false,
      flows: null,
      gainFrom: null,
      changeCents: null,
      gainFlows: null,
      gainCents: null,
      gainRatio: null,
      returnRatio: null,
    });
  });

  it('merges a month whose balance was not updated into the next', () => {
    expect(period(r, '2026-04')).toMatchObject({
      notUpdated: true,
      flows: {
        sgGrossCents: SG,
        sgFundCents: SG_FUND,
        memberFundCents: 85_000,
        memberNetPayCents: 70_000,
        concessionalCents: 100_000,
        nonConcessionalCents: 0,
        transferInCents: 0,
      },
      gainFrom: null,
      changeCents: null,
      gainCents: null,
      gainRatio: null,
      returnRatio: null,
    });
    const may = period(r, '2026-05');
    // May's own window, and the merged window from 31/03 its gain uses.
    expect(may.flows).toEqual({
      sgGrossCents: SG,
      sgFundCents: SG_FUND,
      memberFundCents: 50_000,
      memberNetPayCents: 50_000,
      concessionalCents: 0,
      nonConcessionalCents: 50_000,
      transferInCents: 0,
    });
    expect(may).toMatchObject({
      notUpdated: false,
      gainFrom: '2026-03-31',
      changeCents: 500_000,
      gainFlows: {
        sgGrossCents: 2 * SG,
        sgFundCents: 2 * SG_FUND,
        memberFundCents: 135_000,
        memberNetPayCents: 120_000,
        concessionalCents: 100_000,
        nonConcessionalCents: 50_000,
        transferInCents: 0,
      },
      gainCents: 161_000,
      gainRatio: ratio(D(161_000).div(10_500_000 - 161_000)),
      returnRatio: ratio(D(161_000).div(D(10_000_000).plus(D(2 * SG_FUND + 135_000).div(2)))),
    });
  });

  it('derives a loss when the balance fell by more than the flows', () => {
    expect(period(r, '2026-06')).toMatchObject({
      gainFrom: '2026-05-31',
      changeCents: -200_000,
      gainCents: -302_000,
      gainRatio: ratio(D(-302_000).div(10_300_000 + 302_000)),
      returnRatio: ratio(D(-302_000).div(D(10_500_000).plus(D(SG_FUND).div(2)))),
    });
  });

  it('values the provisional period from the latest balances, its gain measured to their date (D79)', () => {
    const p = period(r, '2026-07');
    expect(p).toMatchObject({
      status: 'provisional',
      after: '2026-06-30',
      through: '2026-07-20',
      valueCents: 10_600_000,
      notUpdated: false,
      gainFrom: '2026-06-30',
      changeCents: 300_000,
      // The window's flows (the savings side) run to the as-of: 20 of July's 31 days of SG.
      flows: {
        sgGrossCents: 77_419,
        sgFundCents: 65_806,
        memberFundCents: 85_000,
        memberNetPayCents: 70_000,
        transferInCents: 0,
      },
      // The gain's SG runs to the latest balance only: 15 of July's 31 days.
      gainFlows: {
        sgGrossCents: 58_065,
        sgFundCents: 49_355,
        memberFundCents: 85_000,
        memberNetPayCents: 70_000,
        transferInCents: 0,
      },
      // The gain adds up with the rounded flows; the ratios use the unrounded SG part.
      gainCents: 300_000 - 49_355 - 85_000,
      gainRatio: ratio(gainJuly.div(D(10_600_000).minus(gainJuly))),
      returnRatio: ratio(gainJuly.div(D(10_300_000).plus(sgFundJuly.plus(85_000).div(2)))),
    });
    // The same as the fund's own entry gain on 15/07 (§2.5 step 6).
    expect(r.funds[0]!.entries.at(-1)!.gainCents).toBe(p.gainCents);
    expect(r.flags).toEqual([]);
  });

  it('adds up on every valuation period: change − SG − yours − transfers = gain', () => {
    for (const p of r.periods.filter((x) => x.gainCents !== null)) {
      const f = p.gainFlows!;
      expect(p.changeCents! - f.sgFundCents - f.memberFundCents - f.transferInCents).toBe(
        p.gainCents,
      );
    }
  });

  it('spreads a month’s SG by its days across windows, statements included', () => {
    const mid = (over: Partial<SuperInput> = {}) =>
      period(
        computeSuper(
          input({
            asOf: '2026-02-25',
            snapshots: [snap('2026-01-15', 10_000_000), snap('2026-02-20', 10_200_000)],
            funds: [
              fund(
                1,
                [
                  ['2026-01-15', 10_000_000],
                  ['2026-02-20', 10_200_000],
                ],
                { receivesSg: true },
              ),
            ],
            contributions: [],
            ...over,
          }),
        ),
        '2026-02',
      );
    // 16 of January's 31 days and 20 of February's 28 days.
    const gross = D(SG).times(16).div(31).plus(D(SG).times(20).div(28));
    expect(mid().flows).toMatchObject({ sgGrossCents: 147_650, sgFundCents: 125_502 });
    expect(gross.times('0.85').toDecimalPlaces(0).toNumber()).toBe(125_502);
    const statement = mid({ sgOverrides: [{ periodMonth: '2026-02', grossCents: 140_000 }] });
    expect(statement.flows!.sgGrossCents).toBe(Math.round((120_000 * 16) / 31 + 100_000));
  });

  it('excludes SG and contributions dated after the as-of', () => {
    const r2 = computeSuper(
      input({
        contributions: [...CONTRIBUTIONS, contribution(9, '2026-07-21', 'after_tax', 10_000)],
      }),
    );
    expect(period(r2, '2026-07').flows).toEqual(period(r, '2026-07').flows);
    expect(r2.snapshot.superContribCents).toBe(70_000);
  });
});

describe('computeSuper: the provisional period not updated (§2.5 step 4)', () => {
  it('is not a valuation point when its value equals the last recorded month’s', () => {
    const r = computeSuper(
      input({
        funds: [
          fund(
            1,
            [
              ['2026-06-30', 10_300_000],
              ['2026-07-15', 10_300_000],
            ],
            { receivesSg: true },
          ),
        ],
      }),
    );
    expect(period(r, '2026-07')).toMatchObject({
      notUpdated: true,
      gainCents: null,
      returnRatio: null,
    });
    expect(r.flags).toEqual(['balances_not_updated']);
    expect(r.snapshot).toMatchObject({
      superValueCents: 10_300_000,
      superGainCents: null,
      superGainRatio: null,
    });
  });

  it('is not a valuation point while any fund not archived has no entry since the last recorded month', () => {
    const stale = fund(2, [['2026-06-30', 500_000]]);
    const r = computeSuper(input({ funds: [MAIN, stale] }));
    expect(period(r, '2026-07')).toMatchObject({
      valueCents: 11_100_000,
      notUpdated: true,
      gainCents: null,
    });
    expect(r.flags).toEqual(['balances_not_updated']);
    // An archived fund (a closing balance of 0) does not hold it back.
    const closed = computeSuper(
      input({ funds: [MAIN, fund(2, [['2026-06-30', 0]], { archived: true })] }),
    );
    expect(period(closed, '2026-07').notUpdated).toBe(false);
  });
});

describe('computeSuper: the provisional gain measured to the latest balances (D79)', () => {
  const base = computeSuper(input());
  const closed = (x: ReturnType<typeof computeSuper>) =>
    x.periods.filter((p) => p.status !== 'provisional');
  const provisional = (x: ReturnType<typeof computeSuper>) =>
    x.periods.find((p) => p.status === 'provisional')!;
  // A balance dated 15/07, five weeks before the as-of, with an after-tax contribution on 05/08.
  const late = computeSuper(
    input({
      asOf: '2026-08-20',
      contributions: [...CONTRIBUTIONS, contribution(4, '2026-08-05', 'after_tax', 10_000)],
    }),
  );

  it('counts no SG or contribution after the balance date in the gain, so it does not drift', () => {
    const p = provisional(late);
    expect(p).toMatchObject({ status: 'provisional', through: '2026-08-20', notUpdated: false });
    // 1–15 July's SG and contribution 3 only: the same gain as on 20/07 or on the balance date.
    expect(p.gainFlows).toEqual(period(base, '2026-07').gainFlows);
    expect(p.gainFlows).toMatchObject({ sgGrossCents: 58_065, memberFundCents: 85_000 });
    expect([p.gainCents, p.gainRatio, p.returnRatio]).toEqual([
      period(base, '2026-07').gainCents,
      period(base, '2026-07').gainRatio,
      period(base, '2026-07').returnRatio,
    ]);
    const onTheDay = period(computeSuper(input({ asOf: '2026-07-15' })), '2026-07');
    expect(onTheDay.gainFlows).toEqual(p.gainFlows);
    expect(onTheDay.gainCents).toBe(p.gainCents);
    expect(late.snapshot.superGainCents).toBe(p.gainCents);
  });

  it('keeps the savings flows running to the as-of', () => {
    const p = provisional(late);
    // July's SG whole and 20 of August's 31 days; contributions 3 and 4.
    expect(p.flows).toEqual({
      sgGrossCents: Math.round(SG + (SG * 20) / 31),
      sgFundCents: Math.round((SG + (SG * 20) / 31) * 0.85),
      memberFundCents: 85_000 + 10_000,
      memberNetPayCents: 70_000 + 10_000,
      concessionalCents: 100_000,
      nonConcessionalCents: 10_000,
      transferInCents: 0,
    });
    expect(late.snapshot.superContribCents).toBe(70_000 + 10_000);
    // The chart's flows are the window's.
    expect(late.chart.at(-1)).toMatchObject({
      memberNetPayCents: 80_000,
      memberFundCents: 95_000,
      sgFundCents: p.flows!.sgFundCents,
    });
  });

  it('measures to the oldest latest balance of the open funds, and every row adds up', () => {
    // A fund opened on 05/07 (a transfer in) holds the measurement back to 05/07: 5 days of SG,
    // and contribution 3 (10/07) waits for the next update.
    const opened = fund(2, [['2026-07-05', 500_000, 500_000]]);
    const r = computeSuper(input({ funds: [MAIN, opened] }));
    const p = period(r, '2026-07');
    expect(p.gainFlows).toMatchObject({
      sgGrossCents: Math.round((SG * 5) / 31),
      sgFundCents: Math.round(((SG * 5) / 31) * 0.85),
      memberFundCents: 0,
      transferInCents: 500_000,
    });
    expect(p.changeCents).toBe(800_000);
    for (const x of [p, provisional(late), ...closed(r), ...closed(late)]) {
      if (x.gainCents === null) continue;
      const f = x.gainFlows!;
      expect(x.changeCents! - f.sgFundCents - f.memberFundCents - f.transferInCents).toBe(
        x.gainCents,
      );
    }
    // An archived fund's older balance does not hold it back.
    const archived = fund(3, [['2026-06-30', 0]], { archived: true });
    expect(period(computeSuper(input({ funds: [MAIN, archived] })), '2026-07').gainFlows).toEqual(
      period(base, '2026-07').gainFlows,
    );
  });

  it('still counts a transfer in dated after the oldest latest balance (the value holds it)', () => {
    const added = fund(2, [['2026-07-18', 2_000_000, 2_000_000]]);
    const r = computeSuper(input({ funds: [MAIN, added] }));
    const p = period(r, '2026-07');
    expect(p.gainFlows).toMatchObject({ sgGrossCents: 58_065, transferInCents: 2_000_000 });
    expect(p.gainCents).toBe(period(base, '2026-07').gainCents);
  });

  it('leaves a provisional period that is not updated, and the closed periods, as they were', () => {
    const stale = computeSuper(input({ funds: [MAIN, fund(2, [['2026-06-30', 500_000]])] }));
    const p = period(stale, '2026-07');
    // No gain; its own window's flows still run to the as-of.
    expect(p).toMatchObject({ notUpdated: true, gainFlows: null, gainCents: null });
    expect(p.flows).toEqual(period(base, '2026-07').flows);
    expect(stale.annualised.through).toBe('2026-06-30');
    // Closed periods are measured to their run dates, whatever the latest balances.
    expect(closed(late)).toEqual(closed(base));
    expect(closed(stale)).toEqual(closed(base));
    expect(closed(computeSuper(input({ asOf: '2026-07-15' })))).toEqual(closed(base));
  });

  it('chains the corrected provisional return, annualised to the balance date', () => {
    const returns = [period(late, '2026-05'), period(late, '2026-06'), provisional(late)].map((p) =>
      D(p.returnRatio!),
    );
    const growth = returns.reduce((g, x) => g.times(D(1).plus(x)), D(1));
    // 31/03 to 15/07 (the latest balance), however far the as-of has moved on.
    expect(late.annualised).toEqual(base.annualised);
    expect(late.annualised).toMatchObject({ from: '2026-03-31', through: '2026-07-15', days: 106 });
    expect(Number(late.annualised.cumulativeRatio)).toBeCloseTo(growth.minus(1).toNumber(), 11);
  });
});

describe('computeSuper: transfers in and rollovers (§2.5 step 1)', () => {
  const base = computeSuper(input());

  it('leaves the gain unchanged when a fund is added with its opening balance as a transfer in', () => {
    // Dated with the latest balances (an older date would move the measured end back, D79).
    const added = fund(2, [['2026-07-15', 2_000_000, 2_000_000]]);
    const r = computeSuper(input({ funds: [MAIN, added] }));
    const p = period(r, '2026-07');
    expect(p).toMatchObject({ valueCents: 12_600_000, changeCents: 2_300_000 });
    expect(p.gainFlows!.transferInCents).toBe(2_000_000);
    expect(p.gainCents).toBe(period(base, '2026-07').gainCents);
    // The fund's first entry has no flows and no gain.
    expect(r.funds[1]!.entries[0]).toMatchObject({
      transferInCents: 2_000_000,
      flowsCents: null,
      gainCents: null,
    });
  });

  it('gives no gain for a rollover between tracked funds: the old fund’s 0 and the new fund’s balance cancel', () => {
    // The 15/07 balance update writes every open fund, the emptied one included.
    const old = fund(
      1,
      [
        ['2026-03-31', 10_000_000],
        ['2026-05-31', 10_500_000],
        ['2026-06-30', 10_300_000],
        ['2026-07-10', 0],
        ['2026-07-15', 0],
      ],
      { receivesSg: true },
    );
    const next = fund(2, [
      ['2026-07-10', 10_420_000],
      ['2026-07-15', 10_600_000],
    ]);
    const r = computeSuper(input({ funds: [old, next] }));
    expect(r.totalCents).toBe(10_600_000);
    expect(period(r, '2026-07').gainCents).toBe(period(base, '2026-07').gainCents);
  });
});

describe('computeSuper: per-fund entry gains (§2.5 step 6)', () => {
  it('counts the SG fund’s SG, its own and unassigned contributions and transfers between entries', () => {
    const other = fund(2, [
      ['2026-04-30', 1_000_000],
      ['2026-06-30', 1_100_000, 40_000],
    ]);
    const r = computeSuper(
      input({
        funds: [MAIN, other],
        contributions: [...CONTRIBUTIONS, contribution(4, '2026-05-20', 'after_tax', 30_000, 2)],
      }),
    );
    const main = r.funds[0]!.entries;
    expect(main.map((e) => [e.asOf, e.flowsCents, e.gainCents])).toEqual([
      ['2026-03-31', null, null],
      // Two months of SG to the fund, contribution 1 (to the fund) and 2 (unassigned: the SG fund).
      ['2026-05-31', 2 * SG_FUND + 85_000 + 50_000, 500_000 - (2 * SG_FUND + 85_000 + 50_000)],
      ['2026-06-30', SG_FUND, -200_000 - SG_FUND],
      // 1–15 July's SG and contribution 3.
      ['2026-07-15', 49_355 + 85_000, 300_000 - (49_355 + 85_000)],
    ]);
    // A fund without SG: its own contributions and the entry's transfer in.
    expect(r.funds[1]!.entries.map((e) => [e.flowsCents, e.gainCents])).toEqual([
      [null, null],
      [30_000 + 40_000, 100_000 - 70_000],
    ]);
  });
});

describe('computeSuper: the annualised return (§2.5 step 5, §11 fix 21)', () => {
  it('chains the valuation periods’ Modified Dietz returns from the first recorded month', () => {
    const r = computeSuper(input());
    const returns = ['2026-05', '2026-06', '2026-07'].map((m) => D(period(r, m).returnRatio!));
    // The chain uses the unrounded returns; the 12-digit strings reproduce it within 1e-11.
    const growth = returns.reduce((g, x) => g.times(D(1).plus(x)), D(1));
    // To the provisional period's measured end: the latest balance on 15/07 (D79).
    expect(r.annualised).toMatchObject({ from: '2026-03-31', through: '2026-07-15', days: 106 });
    expect(Number(r.annualised.cumulativeRatio)).toBeCloseTo(growth.minus(1).toNumber(), 11);
    expect(Number(r.annualised.returnRatio)).toBeCloseTo(
      growth.pow(D('365.25').div(106)).minus(1).toNumber(),
      10,
    );
  });

  it('stops at the last valuation period when the provisional one is not updated', () => {
    const r = computeSuper(
      input({ funds: [fund(1, [['2026-06-30', 10_300_000]], { receivesSg: true })] }),
    );
    expect(r.annualised).toMatchObject({ through: '2026-06-30', days: 91 });
  });

  it('annualises over more than a year too', () => {
    const r = computeSuper(
      input({
        asOf: '2027-09-24',
        snapshots: [snap('2026-06-30', 10_000_000), snap('2027-06-30', 11_000_000)],
        funds: [fund(1, [['2027-06-30', 11_000_000]], { receivesSg: true })],
        contributions: [],
        grossAnnualSalaryCents: null,
      }),
    );
    // No flows: a 10 % gain over 365 days.
    expect(r.periods[1]).toMatchObject({ gainCents: 1_000_000, returnRatio: '0.1' });
    expect(r.annualised).toMatchObject({
      cumulativeRatio: '0.1',
      days: 365,
      through: '2027-06-30',
    });
    expect(r.annualised.returnRatio).toBe(ratio(D('1.1').pow(D('365.25').div(365)).minus(1)));
  });

  it('has no annualised return without a valuation period', () => {
    const r = computeSuper(input({ snapshots: [], contributions: [] }));
    expect(r.periods).toEqual([]);
    expect(r.annualised).toEqual({
      cumulativeRatio: null,
      returnRatio: null,
      from: null,
      through: null,
      days: null,
    });
  });
});

describe('computeSuper: the concessional cap meter (§2.5 step 7, D70, D75)', () => {
  const capInput = (over: Partial<SuperInput> = {}) =>
    input({
      asOf: '2026-09-24',
      snapshots: [],
      contributions: [
        contribution(1, '2026-08-15', 'salary_sacrifice', 100_000),
        contribution(2, '2026-07-31', 'voluntary_contribution', 70_000),
        contribution(3, '2026-09-01', 'after_tax', 50_000),
        contribution(4, '2026-03-15', 'salary_sacrifice', 200_000),
        contribution(5, '2025-12-31', 'voluntary_contribution', 70_000),
        contribution(6, '2026-09-30', 'salary_sacrifice', 100_000), // after the as-of
      ],
      ...over,
    });

  it('counts SG when the fund receives it: the April–June 2026 quarter in FY2026–27, then each month', () => {
    const [fy27, fy26] = computeSuper(capInput()).capYears;
    // April–June 2026 (3 × 1,200, due in late July), July and August (Payday Super), and 24 of
    // September's 30 days.
    const sg = 3 * SG + SG + SG + (SG * 24) / 30;
    expect(fy27).toEqual({
      financialYear: 2026,
      start: '2026-07-01',
      end: '2027-07-01',
      complete: false,
      capCents: 3_250_000,
      capSource: 'statutory',
      sgGrossCents: sg,
      sgFundCents: 5 * SG_FUND + 81_600,
      sgSource: 'estimate',
      salarySacrificeCents: 100_000,
      importedEstimateCents: 100_000,
      totalCents: sg + 200_000,
      // The FY's 15 SG months + the contributions so far + (so far ÷ 3 months) × 9 months left.
      projectedCents: 15 * SG + 200_000 + 600_000,
      ratio: ratio(D(sg + 200_000).div(3_250_000)),
      projectedRatio: '0.8',
      status: 'under',
      nonConcessionalCents: 50_000,
      memberCents: 250_000,
      memberFundCents: 85_000 + 85_000 + 50_000,
      memberNetPayCents: 70_000 + 70_000 + 50_000,
      estimateCount: 1,
    });
    // FY2025–26 (complete): April–June 2025 at 11.5 %, July 2025 – March 2026 at 12 %.
    expect(fy26).toMatchObject({
      financialYear: 2025,
      complete: true,
      capCents: 3_000_000,
      sgGrossCents: 3 * 115_000 + 9 * SG,
      sgFundCents: 3 * 97_750 + 9 * SG_FUND,
      salarySacrificeCents: 200_000,
      importedEstimateCents: 100_000,
      totalCents: 3 * 115_000 + 9 * SG + 300_000,
      projectedCents: 3 * 115_000 + 9 * SG + 300_000,
      ratio: '0.575',
      status: 'under',
      memberCents: 300_000,
      estimateCount: 1,
    });
  });

  it('counts a quarter whole on its due date, before and after the switch to Payday Super', () => {
    const sgOf = (asOf: string, fy: number) =>
      computeSuper(capInput({ asOf, contributions: [] })).capYears.find(
        (c) => c.financialYear === fy,
      )!.sgGrossCents;
    // Before Payday Super: July–September 2025 is due 28/10/2025 and counts whole from that day.
    expect(sgOf('2025-10-27', 2025)).toBe(3 * 115_000);
    expect(sgOf('2025-10-28', 2025)).toBe(3 * 115_000 + 3 * SG);
    // The transition quarter (April–June 2026) is due in late July 2026: not yet on 20/07, counted
    // in FY2026–27 by August, beside July (Payday Super) and 5 of August's 31 days.
    expect(sgOf('2026-07-20', 2026)).toBe(Math.round((SG * 20) / 31));
    expect(sgOf('2026-08-05', 2026)).toBe(3 * SG + SG + Math.round((SG * 5) / 31));
    expect(capTiming('2026-06')).toMatchObject({ fy: 2026, payday: false });
    expect(capTiming('2026-03')).toEqual({ fy: 2025, receivedOn: '2026-04-28', payday: false });
    expect(capTiming('2026-07')).toEqual({ fy: 2026, receivedOn: '2026-07-01', payday: true });
    expect(capTiming('2025-12')).toEqual({ fy: 2025, receivedOn: '2026-01-28', payday: false });
  });

  it('says where the SG came from: estimates, statements, both or none', () => {
    const source = (over: Partial<SuperInput>) =>
      computeSuper(capInput(over)).capYears[0]!.sgSource;
    expect(source({})).toBe('estimate');
    expect(source({ sgOverrides: [{ periodMonth: '2026-07', grossCents: 124_000 }] })).toBe(
      'mixed',
    );
    const july = computeSuper(
      capInput({
        asOf: '2026-07-15',
        contributions: [],
        sgOverrides: [{ periodMonth: '2026-07', grossCents: 124_000 }],
      }),
    ).capYears[0]!;
    // Half of July's statement (15 of 31 days); the quarter is not due until 28/07.
    expect(july).toMatchObject({
      sgSource: 'statement',
      sgGrossCents: 60_000,
      sgFundCents: 51_000,
    });
    expect(source({ grossAnnualSalaryCents: null })).toBe('none');
  });

  it('uses an override for the FY it was set for only', () => {
    const caps = (override: SuperInput['concessionalCapOverride']) =>
      computeSuper(capInput({ concessionalCapOverride: override })).capYears.map((c) => [
        c.capCents,
        c.capSource,
      ]);
    expect(caps({ cents: 3_500_000, financialYear: 2026 })).toEqual([
      [3_500_000, 'setting'],
      [3_000_000, 'statutory'],
    ]);
    expect(caps({ cents: 2_500_000, financialYear: 2025 })).toEqual([
      [3_250_000, 'statutory'],
      [2_500_000, 'setting'],
    ]);
    expect(caps({ cents: 2_500_000, financialYear: 2024 })).toEqual([
      [3_250_000, 'statutory'],
      [3_000_000, 'statutory'],
    ]);
    // An FY after the table uses its last entry.
    expect(computeSuper(capInput({ asOf: '2030-09-24' })).capYears.map((c) => c.capCents)).toEqual([
      3_250_000, 3_250_000,
    ]);
  });

  it('is near from 90 % of the cap projected, and over when the total or the projection passes it', () => {
    // No contributions: the projection is the FY's 15 SG months (18,000), 90 % of a 20,000 cap.
    const status = (cap: number, contributions: EngineSuperContribution[] = []) =>
      computeSuper(
        capInput({ contributions, concessionalCapOverride: { cents: cap, financialYear: 2026 } }),
      ).capYears[0]!;
    expect(status(2_000_000)).toMatchObject({
      projectedCents: 1_800_000,
      projectedRatio: '0.9',
      status: 'near',
    });
    expect(status(2_000_001).status).toBe('under');
    expect(status(1_799_999).status).toBe('over');
    // Salary sacrifice so far projected past the cap.
    expect(
      status(3_250_000, [contribution(1, '2026-08-01', 'salary_sacrifice', 1_000_000)]),
    ).toMatchObject({
      projectedCents: 15 * SG + 1_000_000 + 3_000_000,
      status: 'over',
    });
    // A complete FY over its cap.
    const past = computeSuper(
      capInput({ contributions: [contribution(1, '2026-03-01', 'salary_sacrifice', 2_000_000)] }),
    ).capYears[1]!;
    expect(past).toMatchObject({ complete: true, status: 'over' });
    expect(past.totalCents).toBeGreaterThan(past.capCents);
  });
});

describe('computeSuper: the snapshot and the chart (§2.5 steps 8–9)', () => {
  it('gives the live History Q–T', () => {
    const r = computeSuper(input());
    expect(r.snapshot).toEqual({
      superValueCents: 10_600_000,
      superContribCents: 70_000, // contribution 3, the only one after the last recorded month
      superGainCents: period(r, '2026-07').gainCents,
      superGainRatio: period(r, '2026-07').gainRatio,
    });
    // Without a recorded month every contribution to date counts.
    const none = computeSuper(input({ snapshots: [] }));
    expect(none.snapshot).toEqual({
      superValueCents: 10_600_000,
      superContribCents: 70_000 + 50_000 + 70_000,
      superGainCents: null,
      superGainRatio: null,
    });
  });

  it('charts one point per period: value at the end, flows summed, returns chained', () => {
    const r = computeSuper(input());
    const ret = (m: string) => D(period(r, m).returnRatio!);
    expect(
      r.chart.map((p) => [
        p.label,
        p.live,
        p.valueCents,
        p.gainCents,
        p.memberNetPayCents,
        p.memberFundCents,
        p.sgFundCents,
      ]),
    ).toEqual([
      ['Mar 2026', false, 10_000_000, null, null, null, null],
      ['Apr 2026', false, 10_000_000, null, 70_000, 85_000, SG_FUND],
      ['May 2026', false, 10_500_000, 161_000, 50_000, 50_000, SG_FUND],
      ['Jun 2026', false, 10_300_000, -302_000, 0, 0, SG_FUND],
      ['Jul 2026', true, 10_600_000, period(r, '2026-07').gainCents, 70_000, 85_000, 65_806],
    ]);
    expect(r.chart[1]!.returnRatio).toBeNull();
    expect(r.chart[2]!.returnRatio).toBe(period(r, '2026-05').returnRatio);
    const quarterly = computeSuper(input({ chart: { unit: 'quarterly', count: null } })).chart;
    expect(
      quarterly.map((p) => [p.label, p.valueCents, p.gainCents, p.memberFundCents, p.sgFundCents]),
    ).toEqual([
      ['Q1 2026', 10_000_000, null, null, null],
      ['Q2 2026', 10_300_000, 161_000 - 302_000, 135_000, 3 * SG_FUND],
      ['Q3 2026', 10_600_000, period(r, '2026-07').gainCents, 85_000, 65_806],
    ]);
    // The group chains its periods' returns (the engine from the unrounded ones).
    expect(Number(quarterly[1]!.returnRatio)).toBeCloseTo(
      D(1)
        .plus(ret('2026-05'))
        .times(D(1).plus(ret('2026-06')))
        .minus(1)
        .toNumber(),
      12,
    );
    const yearly = computeSuper(input({ chart: { unit: 'yearly', count: 1 } })).chart;
    expect(yearly.map((p) => [p.label, p.live])).toEqual([['FY2026–27', true]]);
  });

  it('rejects programmer errors', () => {
    expect(() => computeSuper(input({ asOf: '20/07/2026' }))).toThrow(RangeError);
    expect(() => computeSuper(input({ contributionsTaxRatio: 'fifteen' }))).toThrow(RangeError);
    expect(() => computeSuper(input({ grossAnnualSalaryCents: 1.5 }))).toThrow(RangeError);
  });
});

describe('computeSuper: measured-through dates (stage-5.md §2.11, D88a)', () => {
  /** June baseline; July recorded late on 3 August with balances measured to 31 July; August. */
  const CARRY_FUND = fund(
    1,
    [
      ['2026-06-30', 10_000_000],
      ['2026-07-31', 10_200_000],
      ['2026-08-31', 10_400_000],
    ],
    { receivesSg: true },
  );
  const carrySnaps = (julyMeasured: string | null, augustMeasured: string | null = null) => [
    { ...snap('2026-06-30', 10_000_000), measuredThrough: null },
    {
      periodMonth: '2026-07',
      runDate: '2026-08-03',
      superValueCents: 10_200_000,
      measuredThrough: julyMeasured,
    },
    { ...snap('2026-08-31', 10_400_000), measuredThrough: augustMeasured },
  ];
  const carry = (julyMeasured: string | null, over: Partial<SuperInput> = {}) =>
    computeSuper(
      input({
        asOf: '2026-08-31',
        snapshots: carrySnaps(julyMeasured),
        funds: [CARRY_FUND],
        contributions: [contribution(1, '2026-08-02', 'after_tax', 50_000, 1)],
        ...over,
      }),
    );

  it('carries the SG and contributions after the measured date into the next month; the gains add up', () => {
    const measured = carry('2026-07-31');
    const plain = carry(null);
    const jul = period(measured, '2026-07');
    const aug = period(measured, '2026-08');
    // July's gain counts July's SG only; August's counts August's SG and the 2 August contribution.
    expect(jul.gainFlows).toMatchObject({ sgFundCents: SG_FUND, memberFundCents: 0 });
    expect(aug.gainFlows).toMatchObject({ sgFundCents: SG_FUND, memberFundCents: 50_000 });
    expect(jul.gainCents).toBe(200_000 - SG_FUND);
    expect(aug.gainCents).toBe(200_000 - SG_FUND - 50_000);
    // Without the carry the window runs to the run date (3 August): 3 days of August's SG and the
    // contribution land in July.
    expect(period(plain, '2026-07').gainFlows).toMatchObject({
      sgFundCents: 111_871,
      memberFundCents: 50_000,
    });
    expect(period(plain, '2026-08').gainFlows).toMatchObject({
      sgFundCents: 92_129,
      memberFundCents: 0,
    });
    const total = (r: ReturnType<typeof computeSuper>) =>
      period(r, '2026-07').gainCents! + period(r, '2026-08').gainCents!;
    expect(total(measured)).toBe(total(plain));
    // The savings side keeps the run-date windows (D79).
    expect(jul.flows).toEqual(period(plain, '2026-07').flows);
    expect(jul.gainFrom).toBe('2026-06-30');
    expect(aug.gainFrom).toBe('2026-08-03');
  });

  it('reproduces Stage 4 exactly with null or absent measured dates', () => {
    const absent = computeSuper(input());
    const nulls = computeSuper(
      input({ snapshots: SNAPSHOTS.map((s) => ({ ...s, measuredThrough: null })) }),
    );
    expect(nulls).toEqual(absent);
    // A measured date equal to the run date is the same as none.
    const same = computeSuper(
      input({ snapshots: SNAPSHOTS.map((s) => ({ ...s, measuredThrough: s.runDate })) }),
    );
    expect(same.periods).toEqual(absent.periods);
  });

  it('clamps the measured dates: never before the previous valuation point, never after the run date', () => {
    // August's stored date is before July's: its window is empty (no SG counted twice).
    const back = computeSuper(
      input({
        asOf: '2026-08-31',
        snapshots: carrySnaps('2026-07-31', '2026-07-20'),
        funds: [CARRY_FUND],
        contributions: [],
      }),
    );
    expect(period(back, '2026-07').gainFlows).toMatchObject({ sgFundCents: SG_FUND });
    expect(period(back, '2026-08').gainFlows).toMatchObject({ sgFundCents: 0, memberFundCents: 0 });
    // A date after the run date reads as the run date.
    const late = computeSuper(
      input({
        asOf: '2026-08-31',
        snapshots: carrySnaps('2026-08-10'),
        funds: [CARRY_FUND],
        contributions: [],
      }),
    );
    expect(period(late, '2026-07').gainFlows).toEqual(
      period(carry(null, { contributions: [] }), '2026-07').gainFlows,
    );
  });

  it('starts the provisional gain at the previous valuation point’s measured date', () => {
    const r = computeSuper(
      input({
        asOf: '2026-08-20',
        snapshots: carrySnaps('2026-07-31').slice(0, 2),
        funds: [
          fund(
            1,
            [
              ['2026-06-30', 10_000_000],
              ['2026-07-31', 10_200_000],
              ['2026-08-15', 10_400_000],
            ],
            { receivesSg: true },
          ),
        ],
        contributions: [],
      }),
    );
    const p = r.periods.at(-1)!;
    expect(p.status).toBe('provisional');
    // (31/07, 15/08]: 15 days of August's SG (not (03/08, 15/08]).
    // 120,000 × 15 ÷ 31 × 0.85 = 49,354.84 → 49,355.
    expect(p.gainFlows?.sgFundCents).toBe(49_355);
    expect(p.gainCents).toBe(200_000 - p.gainFlows!.sgFundCents);
    expect(r.measuredThrough).toBe('2026-08-15');
  });

  it('reports the provisional cut-off: updated, not updated, and none', () => {
    // Updated: the oldest latest balance of the open funds.
    expect(computeSuper(input()).measuredThrough).toBe('2026-07-15');
    // Not updated (no entry since the last run): still the latest balance date.
    const stale = computeSuper(
      input({ funds: [fund(1, [['2026-06-30', 10_300_000]], { receivesSg: true })] }),
    );
    expect(stale.flags).toContain('balances_not_updated');
    expect(stale.measuredThrough).toBe('2026-06-30');
    // No provisional period (asOf = the last run), no fund with a balance, or no snapshot.
    expect(computeSuper(input({ asOf: '2026-06-30' })).measuredThrough).toBeNull();
    expect(computeSuper(input({ funds: [fund(1, [])] })).measuredThrough).toBeNull();
    expect(computeSuper(input({ snapshots: [] })).measuredThrough).toBeNull();
  });
});
