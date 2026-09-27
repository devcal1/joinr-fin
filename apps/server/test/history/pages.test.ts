// The Stage 5 page builders through the routes (stage-5.md §4.4, §4.5, §7.4 step 2) with a FAKE
// engine returning hand-built results (every field distinct): `GET /api/net-worth` (the dashboard,
// the rolling table, the charts with the view override, the trends, the spend notes, the prices and
// the recorder), `GET /api/history` (the months newest first with their marks, checks and savings
// rates, the live row, the record plan with gaps, the consistency counts, the audit trail, the
// chart) and `GET /api/history/series` (the aggregation API). Generic values only.
import type {
  NetWorthBreakdown,
  NetWorthDashboardResult,
  RollingNetWorthRow,
  SavingsPeriod,
  SnapshotCheckResult,
  SnapshotGroup,
} from '@joinr/engine';
import {
  SNAPSHOT_COLUMN_MODES,
  type HistoryPageResponse,
  type HistorySeriesResponse,
  type NetWorthPageResponse,
} from '@joinr/schema';
import { settings, snapshots } from '@joinr/schema/db';
import { seedRecordedMonth } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { readSettings } from '../../src/db/queries/settings';
import { allocationSumRatio } from '../../src/history/inputs';
import { savingsPeriod } from '../cashflow/helpers';
import type { FakeEngine } from '../investments/helpers';
import { AS_OF, call, figures, historyFakeEngine, NOW, startApp, type TestApp } from './helpers';

let ctx: TestApp;
afterEach(async () => {
  await ctx.close();
});

const breakdown = (base: number): NetWorthBreakdown => ({
  liquidCents: base + 1,
  superCents: base + 2,
  propertyCents: base + 3,
  liabilitiesCents: -(base + 4),
  offsetsCents: base + 5,
  netWorthCents: base + 6,
  missing: [],
});

const year = { basis: 'fy' as const, start: '2026-07-01', end: '2027-06-30', year: 2026 };

const dashboard: NetWorthDashboardResult = {
  breakdown: breakdown(100),
  assetsCents: 201,
  liabilitiesCents: 202,
  classes: [{ key: 'etf', valueCents: 203, gainCents: 204, gainRatio: '0.205' }],
  liabilities: [{ key: 'mortgages', balanceCents: 206, grossCents: 207, offsetCents: 1 }],
  assetsExSuperCents: 208,
  sinceLastRecord: {
    base: { periodMonth: '2026-07', runDate: '2026-07-31', netWorthCents: 209 },
    cents: 210,
    ratio: '0.211',
  },
  thisYear: { base: null, cents: null, ratio: null, year },
  distribution: {
    values: [{ key: 'property', valueCents: -212 }],
    slices: [{ key: 'etf', valueCents: 213, ratio: '1' }],
    excluded: [{ key: 'property', valueCents: -212 }],
    drawnCents: 213,
  },
  savingsRate: { ratio: '0.214', rawRatio: '0.215', year, periods: 2, targetRatio: '0.2' },
  averageSavings: { monthCents: 216, yearCents: 2592, periods: 3 },
  allocation: {
    assetClass: 'etf',
    reason: 'most_underweight',
    rows: [
      {
        assetClass: 'etf',
        valueCents: 217,
        currentRatio: '0.3',
        targetRatio: '0.5',
        deltaRatio: '-0.2',
      },
    ],
  },
};

const group = (label: string, date: string, live: boolean, liquid: number): SnapshotGroup => ({
  label,
  period: date.slice(0, 7),
  date,
  live,
  rows: 1,
  figures: figures({ cashValueCents: liquid, offsetCents: 10, mortgageOffsetCents: 4 }),
  netWorth: { ...breakdown(0), liquidCents: liquid },
  growthCents: 5,
  liquidGrowthCents: 6,
});

const rollingRow: RollingNetWorthRow = {
  periodMonth: '2026-08',
  runDate: null,
  status: 'projected',
  source: null,
  breakdown: null,
  growthCents: null,
  liquidGrowthCents: null,
  savingsRatio: null,
  rawSavingsRatio: null,
  projectedLiquidCents: 300,
};

function dashboardEngine(): FakeEngine {
  return historyFakeEngine({
    netWorthDashboard: () => dashboard,
    rollingNetWorth: () => [rollingRow],
    aggregateSnapshots: ({ unit }) =>
      unit === 'monthly'
        ? [
            group('Jul 2026', '2026-07-31', false, 1000),
            group('Aug 2026 (live)', AS_OF, true, 1100),
          ]
        : [group('Q3 2026 (live)', AS_OF, true, 1100)],
    linearTrend: (points) => ({
      fittedCents: points.map((p) => p.valueCents),
      slopePerMonthCents: 7,
      points: points.length,
    }),
  });
}

describe('GET /api/net-worth (§4.4, §4.5)', () => {
  it('maps the dashboard, the rolling table and the charts field by field', async () => {
    const engine = dashboardEngine();
    ctx = await startApp({ engine });
    ctx.database.db
      .insert(settings)
      .values([
        {
          key: 'allocation.etf',
          valueJson: '"0.6"',
          updatedAt: NOW.toISOString(),
          origin: 'import',
        },
      ])
      .onConflictDoUpdate({ target: settings.key, set: { valueJson: '"0.6"' } })
      .run();
    const res = await call<NetWorthPageResponse>(ctx.app, { method: 'GET', url: '/api/net-worth' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    expect(body).toMatchObject({
      asOf: AS_OF,
      generatedAt: NOW.toISOString(),
      lastRun: '2026-07-31',
      liveMonth: '2026-08',
      hasAppData: false,
      recordable: ['2026-08', '2026-09'],
      recordedToday: false,
      assetsCents: 201,
      liabilitiesCents: 202,
      assetsExSuperCents: 208,
      classes: dashboard.classes,
      liabilities: dashboard.liabilities,
      sinceLastRecord: dashboard.sinceLastRecord,
      thisYear: { base: null, cents: null, ratio: null, year },
      distribution: dashboard.distribution,
      savingsRate: dashboard.savingsRate,
      averageSavings: dashboard.averageSavings,
      prices: {
        unpricedCount: 0,
        stalePriceCount: 0,
        lastRefreshAt: ctx.app.market.status().lastRefreshAt,
        mode: 'off',
      },
      recorder: ctx.app.recorder.status(),
      rolling: [
        {
          periodMonth: '2026-08',
          runDate: null,
          status: 'projected',
          source: null,
          netWorth: null,
          growthCents: null,
          liquidGrowthCents: null,
          savingsRatio: null,
          rawSavingsRatio: null,
          projectedLiquidCents: 300,
        },
      ],
    });
    expect(body.live.netWorth).toEqual(dashboard.breakdown);
    expect(body.allocation).toEqual({
      ...dashboard.allocation,
      targetSumRatio: allocationSumRatio(readSettings(ctx.database.db)),
    });
    expect(body.allocation.targetSumRatio).not.toBeNull();
    // The spend notes (the rolling table's U), oldest first.
    expect(body.notes).toEqual([{ periodMonth: '2026-07', text: 'Car service' }]);
    // The charts: the settings' view (monthly, all), FY; the trends fitted per group.
    expect(body.charts).toMatchObject({
      unit: 'monthly',
      count: null,
      yearBasis: 'fy',
      savings: [],
    });
    expect(body.charts.groups.map((g) => g.label)).toEqual(['Jul 2026', 'Aug 2026 (live)']);
    expect(body.charts.trends.liquid).toEqual({
      fittedCents: [1000, 1100],
      slopePerMonthCents: 7,
      points: 2,
    });
    // The tracker: the five liquid classes with net cash + offsets − linked offsets.
    expect(body.charts.trends.tracker.fittedCents).toEqual([1000 + 10 - 4, 1100 + 10 - 4]);
    // The aggregation got every snapshot plus the live row.
    const agg = engine.calls.aggregateSnapshots[0]![0] as {
      rows: { periodMonth: string; live: boolean }[];
    };
    expect(agg.rows.map((r) => [r.periodMonth, r.live])).toEqual([
      ['2026-05', false],
      ['2026-06', false],
      ['2026-07', false],
      ['2026-08', true],
    ]);
  });

  it('the query overrides the chart view for this response only; bad queries are 400', async () => {
    const engine = dashboardEngine();
    ctx = await startApp({ engine });
    const res = await call<NetWorthPageResponse>(ctx.app, {
      method: 'GET',
      url: '/api/net-worth?unit=quarterly&count=8',
    });
    expect(res.status).toBe(200);
    expect(res.body.charts).toMatchObject({ unit: 'quarterly', count: 8, yearBasis: 'fy' });
    expect(engine.calls.aggregateSnapshots[0]![0]).toMatchObject({ unit: 'quarterly', count: 8 });
    expect(engine.calls.compressCashflow[0]![0]).toMatchObject({
      unit: 'quarterly',
      count: 8,
      yearBasis: 'fy',
    });
    expect(
      ctx.database.db
        .select()
        .from(settings)
        .all()
        .some((s) => s.key === 'charts.dateUnit'),
    ).toBe(false);
    for (const q of [
      'unit=weekly',
      'count=0',
      'count=241',
      'count=1.5',
      'count=',
      'count=0x10',
      'other=1',
    ]) {
      expect((await call(ctx.app, { method: 'GET', url: `/api/net-worth?${q}` })).status, q).toBe(
        400,
      );
    }
  });

  it('a month recorded today: recordedToday, the latest snapshot as `live`', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    seedRecordedMonth(ctx.database.db, { periodMonth: '2026-09', runDate: AS_OF });
    const res = await call<NetWorthPageResponse>(ctx.app, { method: 'GET', url: '/api/net-worth' });
    expect(res.body).toMatchObject({
      recordedToday: true,
      lastRun: AS_OF,
      liveMonth: '2026-10',
      recordable: [],
      hasAppData: true,
    });
    expect(res.body.live.figures).toMatchObject({ offsetCents: 1500000, cashDebtCents: -30000 });
  });
});

describe('GET /api/history (§4.4)', () => {
  const periods: SavingsPeriod[] = [
    savingsPeriod({ periodMonth: '2026-06', status: 'closed' }),
    savingsPeriod({
      periodMonth: '2026-07',
      status: 'closed',
      adjusted: { incomeCents: 1, savingsCents: 1, savingsRatio: '0.31', spendCents: 0 },
    }),
  ];
  const check = (
    rows: readonly { periodMonth: string; source: string }[],
  ): SnapshotCheckResult => ({
    checked: 0,
    matched: 0,
    rows: rows.map((r) => ({
      periodMonth: r.periodMonth,
      runDate: `${r.periodMonth}-28`,
      source: r.source as 'migrated',
      checked: 13,
      differences:
        r.periodMonth === '2026-06'
          ? [
              {
                column: 'etfMovementsCents',
                kind: 'movement',
                storedCents: 1,
                recomputedCents: 2,
                storedRatio: null,
                recomputedRatio: null,
              },
            ]
          : r.periodMonth === '2026-08'
            ? [
                {
                  column: 'etfGainRatio',
                  kind: 'derived',
                  storedCents: null,
                  recomputedCents: null,
                  storedRatio: '0.1',
                  recomputedRatio: '0.2',
                },
              ]
            : [],
    })),
  });

  it('lists the months newest first with their marks, checks and rates; the live row; the plan', async () => {
    const engine = historyFakeEngine({
      computeSavings: () => ({ periods }),
      checkSnapshots: ({ snapshots }) => check(snapshots),
    });
    ctx = await startApp({ engine });
    // August recorded late at start-up (the identity trigger forbids an UPDATE of the source).
    seedRecordedMonth(ctx.database.db, { periodMonth: '2026-08', runDate: '2026-09-02' });
    const stored = ctx.database.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.periodMonth, '2026-08'))
      .get()!;
    ctx.database.db.delete(snapshots).where(eq(snapshots.id, stored.id)).run();
    ctx.database.db
      .insert(snapshots)
      .values({ ...stored, source: 'late' })
      .run();
    const res = await call<HistoryPageResponse>(ctx.app, { method: 'GET', url: '/api/history' });
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.snapshots.map((s) => s.periodMonth)).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
    const [aug, jul, jun] = body.snapshots;
    expect(aug).toMatchObject({
      source: 'late',
      late: true,
      origin: 'app',
      sharedRunDate: false,
      deletable: true,
      revision: 0,
      check: { checked: 13, differences: [{ column: 'etfGainRatio', kind: 'derived' }] },
    });
    expect(aug!.netWorth.netWorthCents).toBeTypeOf('number');
    expect(jul).toMatchObject({
      source: 'migrated',
      late: false,
      deletable: false,
      savingsRatio: '0.31',
      sheetRef: 'History!A5',
      recordedAt: null,
    });
    expect(jun!.savingsRatio).toBeNull();
    expect(body.live).toMatchObject({
      periodMonth: '2026-09',
      runDate: AS_OF,
      pricesAsOf: ctx.app.market.status().lastRefreshAt,
      unpricedCount: 0,
      stalePriceCount: 0,
    });
    expect(body.record).toEqual({
      nextMonth: '2026-09',
      recordable: ['2026-09'],
      defaultMonths: ['2026-09'],
      missing: [],
      gaps: [],
    });
    expect(body.consistency).toEqual({
      checked: 52,
      matched: 50,
      migratedChecked: 39,
      migratedMatched: 38,
      movementDifferences: 1,
      derivedDifferences: 1,
      migratedMonths: 3,
      derivedMatchedMonths: 3,
      movementMonths: ['2026-06'],
    });
    expect(body.audit).toHaveLength(1);
    expect(body.audit[0]).toMatchObject({
      action: 'record',
      periodMonth: '2026-08',
      trigger: 'manual',
    });
    expect(body.recorder).toEqual(ctx.app.recorder.status());
    expect(body.charts).toMatchObject({ unit: 'monthly', count: null, groups: [] });
    expect(body.hasAppData).toBe(true);
  });

  it('the ended months are missing and ticked by default; months sharing a run date are marked', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    ctx.database.sqlite.exec("DELETE FROM snapshots WHERE period_month = '2026-07'");
    seedRecordedMonth(ctx.database.db, { periodMonth: '2026-07', runDate: '2026-07-31' });
    const res = await call<HistoryPageResponse>(ctx.app, { method: 'GET', url: '/api/history' });
    expect(res.body.record).toEqual({
      nextMonth: '2026-08',
      recordable: ['2026-08', '2026-09'],
      defaultMonths: ['2026-08'],
      missing: ['2026-08'],
      gaps: [],
    });
    seedRecordedMonth(ctx.database.db, { periodMonth: '2026-09', runDate: '2026-07-31' });
    const shared = await call<HistoryPageResponse>(ctx.app, { method: 'GET', url: '/api/history' });
    expect(shared.body.snapshots.slice(0, 2).map((s) => [s.periodMonth, s.sharedRunDate])).toEqual([
      ['2026-09', true],
      ['2026-07', true],
    ]);
    expect(shared.body.record.gaps).toEqual(['2026-08']);
    expect(shared.body.record.recordable).toEqual([]);
  });
});

describe('GET /api/history/series (the aggregation API)', () => {
  it('answers the groups with the view and the column modes', async () => {
    const engine = dashboardEngine();
    ctx = await startApp({ engine });
    const res = await call<HistorySeriesResponse>(ctx.app, {
      method: 'GET',
      url: '/api/history/series?unit=yearly',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unit: 'yearly', count: null, yearBasis: 'fy' });
    expect(res.body.groups.map((g) => g.label)).toEqual(['Q3 2026 (live)']);
    expect(res.body.modes).toEqual(SNAPSHOT_COLUMN_MODES);
    expect(
      (await call(ctx.app, { method: 'GET', url: '/api/history/series?count=x' })).status,
    ).toBe(400);
  });
});
