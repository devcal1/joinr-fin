// The request context's Stage 5 members (stage-5.md §4.5 "One request context", §7.4 step 1), with
// a FAKE engine that records its calls: the composer's input (the four kinds, every trade by kind,
// the cash totals and accounts, the monthly pay, the Stage 4 seam, the measured-through date, the
// previous snapshot), the live snapshot and "no provisional period" (a month recorded today), the
// dashboard's, rolling table's and checks' inputs, and each engine call made once per request.
// Generic values only.
import type {
  ComposeSnapshotInput,
  EngineApi,
  NetWorthDashboardInput,
  RollingNetWorthInput,
  SuperResult,
} from '@joinr/engine';
import {
  createTestDb,
  seedGenericData,
  seedRecordedMonth,
  type TestDb,
} from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import { figuresOf } from '../../src/history/inputs';
import { structuralSuper } from '../assets/helpers';
import { AS_OF, fakeMarket, NOW, type FakeEngine } from '../investments/helpers';
import { historyFakeEngine } from './helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

function deps(engine: EngineApi): FinanceDeps {
  return { database: t, market: fakeMarket(), engine, now: () => NOW };
}
const first = <T>(engine: FakeEngine, key: keyof EngineApi): T => engine.calls[key][0]![0] as T;

describe('the composer’s input (§4.5 "ComposeSnapshotInput")', () => {
  it('is built from the request’s results for the next month to record, at asOf', () => {
    const engine = historyFakeEngine({
      computeSuper: (i): SuperResult => ({ ...structuralSuper(i), measuredThrough: '2026-09-20' }),
    });
    const ctx = createFinanceContext(deps(engine));
    expect(ctx.liveMonth()).toBe('2026-08');
    expect(ctx.recordable()).toEqual(['2026-08', '2026-09']);
    expect(ctx.lastRun()).toBe('2026-07-31');
    const live = ctx.composeLive();
    expect(live).not.toBeNull();
    const input = first<ComposeSnapshotInput>(engine, 'composeSnapshot');
    expect(input.periodMonth).toBe('2026-08');
    expect(input.runDate).toBe(AS_OF);
    expect(input.previous).toEqual({
      runDate: '2026-07-31',
      cashValueCents: ctx.data.snapshots[2]!.cashValueCents,
    });
    expect(input.investments.stock).toBe(ctx.compute('stock'));
    expect(input.investments.etf).toBe(ctx.compute('etf'));
    expect(input.investments.crypto).toBe(ctx.compute('crypto'));
    expect(input.investments.managed_fund).toBe(ctx.compute('managed_fund'));
    expect(Object.values(input.trades).flat()).toHaveLength(ctx.data.trades.length);
    expect(input.cash).toBe(ctx.cashTotals());
    expect(input.cashAccounts).toHaveLength(ctx.data.cashAccounts.length);
    expect(input.salaryMonthlyCents).toBe(ctx.salaryMonthly());
    expect(input.assets).toBe(ctx.assetsSnapshot());
    expect(input.superMeasuredThrough).toBe('2026-09-20');
  });

  it('composes each month at most once per request', () => {
    const engine = historyFakeEngine();
    const ctx = createFinanceContext(deps(engine));
    ctx.composeLive();
    ctx.netWorth();
    ctx.rolling();
    ctx.compose('2026-08');
    expect(engine.calls.composeSnapshot).toHaveLength(1);
    ctx.compose('2026-09');
    expect(engine.calls.composeSnapshot).toHaveLength(2);
    expect(engine.calls.netWorthDashboard).toHaveLength(1);
    ctx.netWorth();
    expect(engine.calls.netWorthDashboard).toHaveLength(1);
  });

  it('without a measured-through date the super cut-off is null', () => {
    const engine = historyFakeEngine();
    createFinanceContext(deps(engine)).composeLive();
    expect(first<ComposeSnapshotInput>(engine, 'composeSnapshot').superMeasuredThrough).toBeNull();
  });

  it('without snapshots: no previous snapshot, the month of asOf', () => {
    t.sqlite.exec('DELETE FROM snapshots');
    const engine = historyFakeEngine();
    const ctx = createFinanceContext(deps(engine));
    expect(ctx.lastRun()).toBeNull();
    expect(ctx.liveMonth()).toBe('2026-09');
    ctx.composeLive();
    expect(first<ComposeSnapshotInput>(engine, 'composeSnapshot').previous).toBeNull();
  });
});

describe('no provisional period (a month recorded today, §4.5)', () => {
  it('has no live snapshot; the dashboard shows the latest snapshot’s figures', () => {
    seedRecordedMonth(t.db, { periodMonth: '2026-09', runDate: AS_OF });
    const engine = historyFakeEngine();
    const ctx = createFinanceContext(deps(engine));
    expect(ctx.composeLive()).toBeNull();
    expect(engine.calls.composeSnapshot).toHaveLength(0);
    const latest = ctx.snapshots().at(-1)!;
    expect(ctx.dashboardFigures()).toEqual(figuresOf(latest));
    ctx.netWorth();
    expect(first<NetWorthDashboardInput>(engine, 'netWorthDashboard').live).toEqual(
      figuresOf(latest),
    );
    ctx.rolling();
    expect(first<RollingNetWorthInput>(engine, 'rollingNetWorth').live).toBeNull();
  });
});

describe('the dashboard, rolling table and checks (§4.5)', () => {
  it('passes the live figures, the snapshots and the savings results', () => {
    const engine = historyFakeEngine();
    const ctx = createFinanceContext(deps(engine));
    ctx.netWorth();
    const input = first<NetWorthDashboardInput>(engine, 'netWorthDashboard');
    expect(input.asOf).toBe(AS_OF);
    expect(input.live).toBe(ctx.composeLive());
    expect(input.liveMonth).toBe('2026-08');
    expect(input.snapshots).toBe(ctx.snapshots());
    expect(input.property).toBe(ctx.property());
    expect(input.kpis).toBe(ctx.kpis());
    expect(input.plannedSavingsRatio).toBe(ctx.budget().plannedSavingsRatio);
    expect(input.considerNext).toBe(ctx.considerNext());
    // The liquid allocation is the investment pages' considerNext (the six classes' targets).
    const considered = engine.calls.considerNext.at(-1)![0] as { cashCents: number };
    expect(considered.cashCents).toBe(ctx.cashTotals().emergencyFundTestCents);

    ctx.rolling();
    const rolling = first<RollingNetWorthInput>(engine, 'rollingNetWorth');
    expect(rolling.snapshots).toBe(ctx.snapshots());
    expect(rolling.live).toEqual({
      periodMonth: '2026-08',
      runDate: AS_OF,
      figures: ctx.composeLive(),
    });
    expect(rolling.savings).toBe(ctx.savings().periods);
    expect(rolling.projection).toEqual({ monthlyCents: ctx.kpis().avgSavingsCents, months: 12 });

    ctx.check();
    const check = first<{ snapshots: unknown; trades: Record<string, unknown[]> }>(
      engine,
      'checkSnapshots',
    );
    expect(check.snapshots).toBe(ctx.snapshots());
    expect(Object.values(check.trades).flat()).toHaveLength(ctx.data.trades.length);
  });

  it('the live savings input passes the offsets when a recorded month stores a figure', () => {
    t.sqlite.exec('UPDATE cash_accounts SET is_offset = 0');
    seedRecordedMonth(t.db, { periodMonth: '2026-08', runDate: '2026-08-31' });
    const engine = historyFakeEngine();
    const ctx = createFinanceContext(deps(engine));
    ctx.savings();
    const input = first<{
      live: { offsetCents: number | null };
      snapshots: { offsetCents: unknown }[];
    }>(engine, 'computeSavings');
    expect(input.live.offsetCents).toBe(0);
    expect(input.snapshots.map((s) => s.offsetCents)).toEqual([null, null, null, 1500000]);
  });
});
