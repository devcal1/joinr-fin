// Net worth (stage-5.md §2.6, §7.3 step 2; D67, D93; §11 fixes 1–3, 7, 8, 17, 20). Generic figures
// only. Every dashboard case asserts assets − liabilities = net worth (a test invariant).
import type { YearBasis } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  cashKpis,
  computeProperty,
  netWorthDashboard,
  netWorthOf,
  rollingNetWorth,
  type ConsiderNextResult,
  type EngineSnapshot,
  type NetWorthDashboardInput,
  type NetWorthDashboardResult,
  type SnapshotFigures,
} from '../src/index';
import { D, firstPeriod, ratio, savingsPeriod } from './helpers';
import { emptyProperty, figures, fullFigures, snapshot } from './snapshotHelpers';

const ALLOCATION: ConsiderNextResult = { assetClass: null, reason: 'no_targets', rows: [] };

const kpisOf = (basis: YearBasis = 'fy', periods = [firstPeriod('2026-06-30')]) =>
  cashKpis({
    asOf: '2026-09-24',
    periods,
    yearBasis: basis,
    jobStartDate: null,
    currentCashCents: 0,
    eoyCashGoalCents: null,
    cashSavingsTargetCents: null,
  });

function dashboard(
  live: SnapshotFigures,
  over: Partial<NetWorthDashboardInput> = {},
): NetWorthDashboardResult {
  const r = netWorthDashboard({
    asOf: '2026-09-24',
    live,
    liveMonth: '2026-09',
    snapshots: [],
    property: emptyProperty(),
    cashAccounts: [],
    kpis: kpisOf(),
    plannedSavingsRatio: null,
    considerNext: ALLOCATION,
    ...over,
  });
  // The invariant (§2.6 step 3; §11 fixes 1–2): it holds for every figure set.
  expect(r.assetsCents - r.liabilitiesCents).toBe(r.breakdown.netWorthCents);
  expect(r.assetsCents).toBe(r.classes.reduce((s, c) => s + c.valueCents, 0));
  expect(r.distribution.values.reduce((s, v) => s + v.valueCents, 0)).toBe(
    r.breakdown.netWorthCents + Math.abs(live.liabilitiesBalanceCents ?? 0),
  );
  return r;
}

/** Linked, unlinked offsets, accounts in debit and a non-zero U (History LiabilitiesDebts). */
const LIVE = fullFigures({
  offsetCents: 1_500_000,
  mortgageOffsetCents: 1_000_000,
  cashDebtCents: -50_000,
  propertyEquityCents: 21_000_000,
  liabilitiesBalanceCents: -10_000,
});

describe('netWorthOf (§2.6 step 1)', () => {
  it("adds liquid + super + property − |U| − |AB| + offsets (the sheet's P + offsets)", () => {
    expect(netWorthOf(LIVE)).toEqual({
      liquidCents: 10_300_000,
      superCents: 20_000_000,
      propertyCents: 60_000_000,
      liabilitiesCents: -40_010_000,
      offsetsCents: 1_500_000,
      netWorthCents: 51_790_000,
      missing: [],
    });
  });

  it('counts a null as 0 and names it; a migrated row has no offsets', () => {
    const b = netWorthOf(
      figures({ stocksValueCents: 100, cashValueCents: 200, superValueCents: 300 }),
    );
    expect(b).toEqual({
      liquidCents: 300,
      superCents: 300,
      propertyCents: 0,
      liabilitiesCents: 0,
      offsetsCents: 0,
      netWorthCents: 600,
      missing: [
        'etfValueCents',
        'cryptoValueCents',
        'liabilitiesBalanceCents',
        'propertyValueCents',
        'mortgageBalanceCents',
        'mfValueCents',
        'otherValueCents',
      ],
    });
    expect(Object.is(netWorthOf(figures()).liabilitiesCents, -0)).toBe(false);
    // A positive stored U still counts as owed (−|U|).
    expect(netWorthOf(figures({ liabilitiesBalanceCents: 70 })).netWorthCents).toBe(-70);
  });
});

describe('netWorthDashboard: classes and liabilities (§2.6 steps 2–3)', () => {
  it('splits linked and unlinked offsets, cash in debit and other debts', () => {
    const r = dashboard(LIVE);
    expect(r.breakdown.netWorthCents).toBe(51_790_000);
    expect(r.classes).toEqual([
      {
        key: 'etf',
        valueCents: 5_000_000,
        gainCents: 500_000,
        gainRatio: ratio(D(500_000).div(4_500_000)),
      },
      { key: 'stock', valueCents: 1_000_000, gainCents: 100_000, gainRatio: ratio(D(1).div(9)) },
      {
        key: 'managed_fund',
        valueCents: 800_000,
        gainCents: 80_000,
        gainRatio: ratio(D(1).div(9)),
      },
      { key: 'crypto', valueCents: 200_000, gainCents: -50_000, gainRatio: '-0.2' },
      // Positive balances only (§11 fix 2); no gain (§11 fix 17).
      { key: 'cash', valueCents: 3_050_000, gainCents: null, gainRatio: null },
      // The offsets not netting a mortgage.
      { key: 'offsets', valueCents: 500_000, gainCents: null, gainRatio: null },
      {
        key: 'other_assets',
        valueCents: 300_000,
        gainCents: 30_000,
        gainRatio: ratio(D(1).div(9)),
      },
      {
        key: 'super',
        valueCents: 20_000_000,
        gainCents: 400_000,
        gainRatio: ratio(D(400_000).div(19_600_000)),
      },
      {
        key: 'property',
        valueCents: 60_000_000,
        gainCents: 5_000_000,
        gainRatio: ratio(D(5).div(55)),
      },
    ]);
    expect(r.liabilities).toEqual([
      {
        key: 'mortgages',
        balanceCents: 39_000_000,
        grossCents: 40_000_000,
        offsetCents: 1_000_000,
      },
      { key: 'cash_debit', balanceCents: 50_000, grossCents: 50_000, offsetCents: 0 },
      { key: 'other_debts', balanceCents: 10_000, grossCents: 10_000, offsetCents: 0 },
    ]);
    expect(r.assetsCents).toBe(90_850_000);
    expect(r.liabilitiesCents).toBe(39_060_000);
    expect(r.assetsExSuperCents).toBe(70_850_000);
  });

  it('caps the offsets applied to the mortgages; the excess is an asset', () => {
    const r = dashboard(
      fullFigures({
        offsetCents: 50_000_000,
        mortgageOffsetCents: 45_000_000,
        propertyEquityCents: 65_000_000,
      }),
    );
    expect(r.liabilities[0]).toEqual({
      key: 'mortgages',
      balanceCents: 0,
      grossCents: 40_000_000,
      offsetCents: 40_000_000,
    });
    expect(r.classes.find((c) => c.key === 'offsets')!.valueCents).toBe(10_000_000);
  });

  it('counts an offset linked to a loan without a property in full (not in the linked total)', () => {
    const r = dashboard(fullFigures({ offsetCents: 500_000, mortgageOffsetCents: 0 }));
    expect(r.classes.find((c) => c.key === 'offsets')!.valueCents).toBe(500_000);
    expect(r.liabilities[0]!.balanceCents).toBe(40_000_000);
  });

  it('keeps every class and liability at 0 for a blank figure set (two mortgages add in AB)', () => {
    const r = dashboard(figures());
    expect(r.classes.map((c) => [c.key, c.valueCents, c.gainRatio])).toEqual([
      ['etf', 0, null],
      ['stock', 0, null],
      ['managed_fund', 0, null],
      ['crypto', 0, null],
      ['cash', 0, null],
      ['offsets', 0, null],
      ['other_assets', 0, null],
      ['super', 0, null],
      ['property', 0, null],
    ]);
    expect(r.liabilities.map((l) => l.balanceCents)).toEqual([0, 0, 0]);
    // Two mortgages are one AB (their Σ): the class and the liability follow it.
    const two = dashboard(
      fullFigures({ mortgageBalanceCents: -55_000_000, propertyEquityCents: 5_000_000 }),
    );
    expect(two.liabilities[0]!.balanceCents).toBe(55_000_000);
  });

  it('takes every figure from `live`: a disagreeing property result changes nothing', () => {
    const property = computeProperty({
      asOf: '2026-09-24',
      properties: [
        {
          id: 1,
          purchaseDate: '2020-01-01',
          isPrimaryResidence: true,
          purchaseValueCents: 1_000,
          netRentToDateCents: 0,
          valuations: [{ id: 1, asOf: '2020-01-01', valueCents: 9_999 }],
        },
      ],
      loans: [],
      snapshots: [],
      chart: { unit: 'monthly', count: null },
    });
    const a = dashboard(LIVE);
    const b = dashboard(LIVE, { property });
    expect(b).toEqual(a);
  });
});

describe('netWorthDashboard: changes (§2.6 step 4; §11 fix 20)', () => {
  const s = (
    month: string,
    runDate: string,
    cash: number,
    source: EngineSnapshot['source'] = 'migrated',
  ) => snapshot(month, runDate, { cashValueCents: cash }, source);
  const live = figures({ cashValueCents: 200_000 });
  const snaps = [
    s('2026-06', '2026-06-30', 100_000),
    s('2026-07', '2026-07-31', 120_000),
    s('2026-08', '2026-08-31', 150_000),
  ];

  it('has no base without snapshots', () => {
    const r = dashboard(live);
    expect(r.sinceLastRecord).toEqual({ base: null, cents: null, ratio: null });
    expect(r.thisYear).toMatchObject({ base: null, cents: null, ratio: null });
    expect(r.thisYear.year).toMatchObject({ basis: 'fy', start: '2026-07-01', year: 2026 });
  });

  it('compares with the latest snapshot and with the last one of the previous FY', () => {
    const r = dashboard(live, { snapshots: snaps });
    expect(r.sinceLastRecord).toEqual({
      base: { periodMonth: '2026-08', runDate: '2026-08-31', netWorthCents: 150_000 },
      cents: 50_000,
      ratio: ratio(D(1).div(3)),
    });
    expect(r.thisYear).toMatchObject({
      base: { periodMonth: '2026-06', runDate: '2026-06-30', netWorthCents: 100_000 },
      cents: 100_000,
      ratio: '1',
    });
    // One snapshot only.
    const one = dashboard(live, { snapshots: snaps.slice(2) });
    expect(one.sinceLastRecord.cents).toBe(50_000);
    expect(one.thisYear.base).toBeNull();
  });

  it('compares a month recorded today with the snapshot before it', () => {
    const today = [...snaps, s('2026-09', '2026-09-24', 200_000, 'recorded')];
    const r = dashboard(live, { snapshots: today });
    expect(r.sinceLastRecord.base?.periodMonth).toBe('2026-08');
  });

  it('keeps a June recorded on 1 July as the FY base of the new year (D29)', () => {
    const june = [s('2026-05', '2026-05-31', 90_000), s('2026-06', '2026-07-01', 100_000, 'late')];
    const r = dashboard(live, { snapshots: june });
    expect(r.thisYear.base?.periodMonth).toBe('2026-06');
    // Recorded today (1 July): since the last record is May's; this FY's base is still June.
    const onDay = dashboard(live, { snapshots: june, asOf: '2026-07-01' });
    expect(onDay.sinceLastRecord.base?.periodMonth).toBe('2026-05');
    expect(onDay.thisYear.base?.periodMonth).toBe('2026-06');
  });

  it('moves the year base across 1 July and follows a calendar basis', () => {
    const before = dashboard(live, { snapshots: snaps, asOf: '2026-06-15' });
    expect(before.thisYear.year.year).toBe(2025);
    expect(before.thisYear.base).toBeNull(); // nothing ends before 1 July 2025
    const cal = dashboard(live, {
      snapshots: [s('2025-12', '2025-12-31', 80_000), ...snaps],
      kpis: kpisOf('calendar'),
    });
    expect(cal.thisYear.year).toMatchObject({ basis: 'calendar', start: '2026-01-01' });
    expect(cal.thisYear.base?.periodMonth).toBe('2025-12');
  });

  it('gives no ratio against a zero base', () => {
    const r = dashboard(live, { snapshots: [s('2026-08', '2026-08-31', 0)] });
    expect(r.sinceLastRecord).toMatchObject({ cents: 200_000, ratio: null });
    const neg = dashboard(live, { snapshots: [s('2026-08', '2026-08-31', -100_000)] });
    expect(neg.sinceLastRecord).toMatchObject({ cents: 300_000, ratio: '3' });
  });
});

describe('netWorthDashboard: the distribution (§2.6 step 6; D93, §11 fix 3)', () => {
  it('draws eight positive classes as eight slices in the stack order (no fold)', () => {
    const r = dashboard(LIVE);
    expect(r.distribution.values).toEqual([
      { key: 'stock', valueCents: 1_000_000 },
      { key: 'etf', valueCents: 5_000_000 },
      { key: 'crypto', valueCents: 200_000 },
      { key: 'cash', valueCents: 3_500_000 }, // net cash + the offsets not inside equity
      { key: 'managed_fund', valueCents: 800_000 },
      { key: 'other_assets', valueCents: 300_000 },
      { key: 'super', valueCents: 20_000_000 },
      { key: 'property', valueCents: 21_000_000 }, // net equity Z
    ]);
    expect(r.distribution.slices.map((x) => x.key)).toEqual([
      'stock',
      'etf',
      'crypto',
      'cash',
      'managed_fund',
      'other_assets',
      'super',
      'property',
    ]);
    expect(r.distribution.excluded).toEqual([]);
    expect(r.distribution.drawnCents).toBe(51_800_000);
    const total = r.distribution.slices.reduce((s, x) => s + Number(x.ratio), 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
    expect(r.distribution.slices[0]!.ratio).toBe(ratio(D(1_000_000).div(51_800_000)));
  });

  it('leaves out a zero class and lists a negative one (negative equity)', () => {
    const r = dashboard(
      fullFigures({
        cryptoValueCents: 0,
        propertyValueCents: 30_000_000,
        propertyEquityCents: -10_000_000,
      }),
    );
    expect(r.distribution.slices.map((x) => x.key)).not.toContain('crypto');
    expect(r.distribution.slices.map((x) => x.key)).not.toContain('property');
    expect(r.distribution.excluded).toEqual([{ key: 'property', valueCents: -10_000_000 }]);
    expect(r.distribution.values.find((v) => v.key === 'crypto')).toEqual({
      key: 'crypto',
      valueCents: 0,
    });
    expect(r.distribution.drawnCents).toBe(
      r.distribution.slices.reduce((s, x) => s + x.valueCents, 0),
    );
  });
});

describe('netWorthDashboard: the gauge and the averages (§2.6 step 5; §11 fix 7)', () => {
  it('passes the year savings rate, its target and the average savings × 12 through', () => {
    const periods = [
      firstPeriod('2026-06-30'),
      savingsPeriod('2026-07-31', { gain: 100_000, income: 500_000 }),
      savingsPeriod('2026-08-31', { gain: 200_000, added: 50_000, income: 500_000 }),
    ];
    const kpis = kpisOf('fy', periods);
    const r = dashboard(LIVE, { kpis, plannedSavingsRatio: '0.25' });
    expect(r.savingsRate).toEqual({
      ratio: kpis.yearSavingsRatio,
      rawRatio: kpis.yearSavingsRawRatio,
      year: kpis.year,
      periods: 2,
      targetRatio: '0.25',
    });
    expect(r.savingsRate.ratio).toBe('0.35'); // 350,000 ÷ 1,000,000
    expect(r.averageSavings).toEqual({ monthCents: 175_000, yearCents: 2_100_000, periods: 2 });
    expect(r.allocation).toBe(ALLOCATION);
  });

  it('shows no rate without a closed period in the year', () => {
    const r = dashboard(LIVE);
    expect(r.savingsRate).toMatchObject({ ratio: null, periods: 0, targetRatio: null });
    expect(r.averageSavings).toEqual({ monthCents: null, yearCents: null, periods: 0 });
  });
});

describe('rollingNetWorth (§2.6 step 7; §11 fix 8)', () => {
  const snaps = [
    snapshot('2026-08', '2026-08-31', { cashValueCents: 150_000, superValueCents: 50_000 }),
    snapshot(
      '2026-07',
      '2026-07-31',
      { cashValueCents: 100_000, superValueCents: 40_000 },
      'recorded',
    ),
  ];
  const savings = [
    firstPeriod('2026-07-31'),
    savingsPeriod('2026-08-31', { gain: 50_000, income: 200_000, adjustment: 10_000 }),
    {
      ...savingsPeriod('2026-09-24', { gain: 20_000, income: 200_000 }),
      status: 'provisional' as const,
    },
  ];
  const live = {
    periodMonth: '2026-09',
    runDate: '2026-09-24',
    figures: figures({ cashValueCents: 170_000 }),
  };

  it('adds the recorded rows, the live row and the projected months', () => {
    const rows = rollingNetWorth({
      snapshots: snaps,
      live,
      savings,
      projection: { monthlyCents: 10_000, months: 3 },
    });
    expect(
      rows.map((r) => [
        r.periodMonth,
        r.status,
        r.source,
        r.runDate,
        r.breakdown?.netWorthCents ?? null,
        r.growthCents,
        r.liquidGrowthCents,
        r.savingsRatio,
        r.rawSavingsRatio,
        r.projectedLiquidCents,
      ]),
    ).toEqual([
      ['2026-07', 'recorded', 'recorded', '2026-07-31', 140_000, null, null, null, null, 100_000],
      [
        '2026-08',
        'recorded',
        'migrated',
        '2026-08-31',
        200_000,
        60_000,
        50_000,
        '0.2',
        '0.25',
        150_000,
      ],
      ['2026-09', 'live', null, '2026-09-24', 170_000, -30_000, 20_000, '0.1', '0.1', 170_000],
      ['2026-10', 'projected', null, null, null, null, null, null, null, 180_000],
      ['2026-11', 'projected', null, null, null, null, null, null, null, 190_000],
      ['2026-12', 'projected', null, null, null, null, null, null, null, 200_000],
    ]);
  });

  it('projects nothing without an average; works without a live row', () => {
    const rows = rollingNetWorth({
      snapshots: snaps,
      live: null,
      savings,
      projection: { monthlyCents: null, months: 12 },
    });
    expect(rows.map((r) => r.status)).toEqual(['recorded', 'recorded']);
    const next = rollingNetWorth({
      snapshots: snaps,
      live: null,
      savings: [],
      projection: { monthlyCents: -5_000, months: 1 },
    });
    expect(next.at(-1)).toMatchObject({
      periodMonth: '2026-09',
      status: 'projected',
      projectedLiquidCents: 145_000,
    });
    expect(next[1]!.savingsRatio).toBeNull();
    expect(
      rollingNetWorth({
        snapshots: [],
        live: null,
        savings: [],
        projection: { monthlyCents: 1, months: 2 },
      }),
    ).toEqual([]);
  });
});
