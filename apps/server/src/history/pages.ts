// The Stage 5 page builders (stage-5.md §4.4, §4.5): `GET /api/history`, `GET /api/history/series`
// and `GET /api/net-worth`. Every figure comes from the engine through the request's finance
// context; the server adds display fields only (names, notes, origins, audit rows, the recorder's
// status).
import type { SnapshotGroup } from '@joinr/engine';
import {
  SNAPSHOT_COLUMN_MODES,
  type HistoryPageResponse,
  type HistorySeriesResponse,
  type IsoMonth,
  type MortgageLoanLineDto,
  type NetWorthPageResponse,
  type RecorderStatusDto,
} from '@joinr/schema';
import { loanDtos } from '../assets/property';
import { cashChartPointDto, yearWindowDto } from '../cashflow/cash';
import type { FinanceContext } from '../cashflow/context';
import type { Db } from '../db/database';
import { readAudit, snapshotAuditDto } from './audit';
import {
  netWorthBreakdownDto,
  netWorthChangeDto,
  rollingNetWorthRowDto,
  snapshotFiguresDto,
  snapshotGroupDto,
  trendDto,
} from './dto';
import {
  allocationSumRatio,
  chartViewOf,
  defaultRecordMonths,
  endedMonths,
  gapMonths,
  seriesRows,
  trackerCents,
  type ChartView,
} from './inputs';
import { priceCounts, snapshotDtos } from './snapshots';

/** The view-only chart override of a request (`?unit=&count=`, already parsed). */
export interface ChartQuery {
  unit?: ChartView['unit'] | undefined;
  count?: number | undefined;
}

/** What a page needs beyond the finance context. */
export interface PageExtras {
  recorder: RecorderStatusDto;
  hasAppData: boolean;
}

/** The snapshot groups for the view: every snapshot plus the live row (§2.7, §5). */
export function chartGroups(ctx: FinanceContext, view: ChartView): SnapshotGroup[] {
  const live = ctx.composeLive();
  return ctx.engine.aggregateSnapshots({
    rows: seriesRows(
      ctx.snapshots(),
      live === null ? null : { periodMonth: ctx.liveMonth(), runDate: ctx.asOf, figures: live },
    ),
    unit: view.unit,
    count: view.count,
    yearBasis: view.yearBasis,
  });
}

// ─── GET /api/history ───────────────────────────────────────────────────────────────────────────

export function historyConsistency(
  snapshots: readonly {
    periodMonth: IsoMonth;
    source: string;
    check: { checked: number; differences: readonly { kind: 'derived' | 'movement' }[] };
  }[],
): HistoryPageResponse['consistency'] {
  const out: HistoryPageResponse['consistency'] = {
    checked: 0,
    matched: 0,
    migratedChecked: 0,
    migratedMatched: 0,
    movementDifferences: 0,
    derivedDifferences: 0,
    migratedMonths: 0,
    derivedMatchedMonths: 0,
    movementMonths: [],
  };
  for (const s of snapshots) {
    const { checked, differences } = s.check;
    const derived = differences.filter((d) => d.kind === 'derived').length;
    const movement = differences.length - derived;
    const matched = checked - differences.length;
    out.checked += checked;
    out.matched += matched;
    out.derivedDifferences += derived;
    out.movementDifferences += movement;
    if (movement > 0) out.movementMonths.push(s.periodMonth);
    if (s.source === 'migrated') {
      out.migratedMonths += 1;
      out.migratedChecked += checked;
      out.migratedMatched += matched;
      if (derived === 0) out.derivedMatchedMonths += 1;
    }
  }
  out.movementMonths.sort();
  return out;
}

export function buildHistoryPage(
  ctx: FinanceContext,
  db: Db,
  extras: PageExtras,
): HistoryPageResponse {
  const snapshots = snapshotDtos(ctx);
  const live = ctx.composeLive();
  const recordable = ctx.recordable();
  const view = chartViewOf(ctx.data.settings);
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    hasAppData: extras.hasAppData,
    snapshots: [...snapshots].reverse(),
    live:
      live === null
        ? null
        : {
            periodMonth: ctx.liveMonth(),
            runDate: ctx.asOf,
            figures: snapshotFiguresDto(live),
            netWorth: netWorthBreakdownDto(ctx.engine.netWorthOf(live)),
            pricesAsOf: ctx.market.lastRefreshAt,
            ...priceCounts(ctx),
          },
    record: {
      nextMonth: ctx.liveMonth(),
      recordable,
      defaultMonths: defaultRecordMonths(recordable, ctx.asOf),
      missing: endedMonths(recordable, ctx.asOf),
      gaps: gapMonths(ctx.data.snapshots.map((s) => s.periodMonth)),
    },
    recorder: extras.recorder,
    consistency: historyConsistency(snapshots),
    audit: readAudit(db).map(snapshotAuditDto),
    charts: {
      unit: view.unit,
      count: view.count,
      groups: chartGroups(ctx, view).map(snapshotGroupDto),
    },
  };
}

// ─── GET /api/history/series (the aggregation API) ─────────────────────────────────────────────

export function buildHistorySeries(ctx: FinanceContext, query: ChartQuery): HistorySeriesResponse {
  const view = chartViewOf(ctx.data.settings, query);
  return {
    unit: view.unit,
    count: view.count,
    yearBasis: view.yearBasis,
    groups: chartGroups(ctx, view).map(snapshotGroupDto),
    modes: { ...SNAPSHOT_COLUMN_MODES },
  };
}

// ─── GET /api/net-worth ─────────────────────────────────────────────────────────────────────────

/**
 * The per-loan lines under Mortgages (§6.3 item 4; Fixer round 1, SPEC-1): the loans with a
 * property (the loans History AB sums), in page order, each with its linked offsets capped at its
 * balance (§2.6 step 2). Display only: the table's figures stay from `live`, so the lines are sent
 * only when their gross balances add up to the Mortgages row's (a month recorded today, or a stored
 * snapshot shown with no provisional period, need not match today's loans); otherwise [].
 */
export function mortgageLoanLines(ctx: FinanceContext, grossCents: number): MortgageLoanLineDto[] {
  const lines = loanDtos(ctx.data, ctx.property())
    .filter((l) => l.propertyId !== null)
    .map((l) => {
      const gross = Math.abs(l.balanceCents);
      const offset = Math.min(gross, Math.max(0, l.offsetCents - l.excessOffsetCents));
      return {
        loanId: l.id,
        name: l.name,
        propertyName: l.propertyName,
        balanceCents: gross - offset,
        grossCents: gross,
        offsetCents: offset,
      };
    });
  const total = lines.reduce((sum, l) => sum + l.grossCents, 0);
  return total === grossCents ? lines : [];
}

export function buildNetWorthPage(
  ctx: FinanceContext,
  query: ChartQuery,
  extras: PageExtras,
): NetWorthPageResponse {
  const nw = ctx.netWorth();
  const view = chartViewOf(ctx.data.settings, query);
  const groups = chartGroups(ctx, view);
  const savingsPoints = ctx.engine.compressCashflow({
    periods: ctx.savings().periods,
    unit: view.unit,
    count: view.count,
    yearBasis: view.yearBasis,
  });
  const liquidTrend = ctx.engine.linearTrend(
    groups.map((g) => ({ date: g.date, valueCents: g.netWorth.liquidCents })),
  );
  const trackerTrend = ctx.engine.linearTrend(
    groups.map((g) => ({ date: g.date, valueCents: trackerCents(g.figures) })),
  );
  const figures = ctx.dashboardFigures();
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    lastRun: ctx.lastRun(),
    liveMonth: ctx.liveMonth(),
    hasAppData: extras.hasAppData,
    recordable: ctx.recordable(),
    recordedToday: ctx.composeLive() === null,
    live: {
      figures: snapshotFiguresDto(figures),
      netWorth: netWorthBreakdownDto(nw.breakdown),
    },
    assetsCents: nw.assetsCents,
    liabilitiesCents: nw.liabilitiesCents,
    assetsExSuperCents: nw.assetsExSuperCents,
    classes: nw.classes.map((c) => ({
      key: c.key,
      valueCents: c.valueCents,
      gainCents: c.gainCents,
      gainRatio: c.gainRatio,
    })),
    liabilities: nw.liabilities.map((l) => ({
      key: l.key,
      balanceCents: l.balanceCents,
      grossCents: l.grossCents,
      offsetCents: l.offsetCents,
    })),
    mortgageLoans: mortgageLoanLines(
      ctx,
      nw.liabilities.find((l) => l.key === 'mortgages')?.grossCents ?? 0,
    ),
    sinceLastRecord: netWorthChangeDto(nw.sinceLastRecord),
    thisYear: { ...netWorthChangeDto(nw.thisYear), year: yearWindowDto(nw.thisYear.year) },
    distribution: {
      values: nw.distribution.values.map((v) => ({ key: v.key, valueCents: v.valueCents })),
      slices: nw.distribution.slices.map((v) => ({
        key: v.key,
        valueCents: v.valueCents,
        ratio: v.ratio,
      })),
      excluded: nw.distribution.excluded.map((v) => ({ key: v.key, valueCents: v.valueCents })),
      drawnCents: nw.distribution.drawnCents,
    },
    savingsRate: {
      ratio: nw.savingsRate.ratio,
      rawRatio: nw.savingsRate.rawRatio,
      year: yearWindowDto(nw.savingsRate.year),
      periods: nw.savingsRate.periods,
      targetRatio: nw.savingsRate.targetRatio,
    },
    averageSavings: {
      monthCents: nw.averageSavings.monthCents,
      yearCents: nw.averageSavings.yearCents,
      periods: nw.averageSavings.periods,
    },
    allocation: {
      assetClass: nw.allocation.assetClass,
      reason: nw.allocation.reason,
      rows: nw.allocation.rows.map((r) => ({
        assetClass: r.assetClass,
        valueCents: r.valueCents,
        currentRatio: r.currentRatio,
        targetRatio: r.targetRatio,
        deltaRatio: r.deltaRatio,
      })),
      targetSumRatio: allocationSumRatio(ctx.data.settings),
    },
    prices: {
      ...priceCounts(ctx),
      lastRefreshAt: ctx.market.lastRefreshAt,
      mode: ctx.market.mode,
    },
    recorder: extras.recorder,
    rolling: ctx.rolling().map(rollingNetWorthRowDto),
    charts: {
      unit: view.unit,
      count: view.count,
      yearBasis: view.yearBasis,
      groups: groups.map(snapshotGroupDto),
      savings: savingsPoints.map(cashChartPointDto),
      trends: { liquid: trendDto(liquidTrend), tracker: trendDto(trackerTrend) },
    },
    notes: ctx.data.periodNotes
      .filter((n) => n.kind === 'spend')
      .map((n) => ({ periodMonth: n.periodMonth, text: n.note }))
      .sort((a, b) => (a.periodMonth < b.periodMonth ? -1 : a.periodMonth > b.periodMonth ? 1 : 0)),
  };
}
