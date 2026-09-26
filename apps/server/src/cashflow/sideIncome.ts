// `GET /api/side-income` (stage-3.md §4.2, §4.4, §6.4, D57): streams, dated deposits bucketed into
// the snapshot periods by the engine, the FY and 365-day KPIs, the chart (FY years, §2.13) and
// what the Budget adds (D53).
import type { SeriesPoint, SideIncomePeriodResult, SideIncomeResult } from '@joinr/engine';
import type {
  IncomeStreamDto,
  PeriodNoteDto,
  SideIncomeChartPointDto,
  SideIncomeDepositDto,
  SideIncomeKpisDto,
  SideIncomePageResponse,
  SideIncomePeriodDto,
} from '@joinr/schema';
import { chartDateUnitSetting, numberSetting } from '../db/queries/settings';
import type { IncomeStreamRow, InvestmentData, SideIncomeDepositRow } from '../investments/load';
import { notesByMonth } from './cash';
import type { FinanceContext } from './context';
import { includeSideIncomeOf, latestSnapshot } from './inputs';

export function incomeStreamDto(
  s: IncomeStreamRow,
  o: { depositCount: number; lifetimeCents: number },
): IncomeStreamDto {
  return {
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    archived: s.archived,
    origin: s.origin,
    sheetRef: s.sheetRef,
    depositCount: o.depositCount,
    lifetimeCents: o.lifetimeCents,
  };
}

/** Every stream's DTO in sort order (deposit counts from the rows, lifetime from the engine). */
export function incomeStreamDtos(
  data: InvestmentData,
  result: SideIncomeResult,
): IncomeStreamDto[] {
  const counts = new Map<number, number>();
  for (const d of data.deposits) counts.set(d.streamId, (counts.get(d.streamId) ?? 0) + 1);
  const lifetime = new Map(result.byStreamLifetime.map((x) => [x.streamId, x.amountCents]));
  return data.incomeStreams.map((s) =>
    incomeStreamDto(s, {
      depositCount: counts.get(s.id) ?? 0,
      lifetimeCents: lifetime.get(s.id) ?? 0,
    }),
  );
}

/** deposit id → the period it landed in (none: before the first period or after the as-of). */
export function periodOfDeposit(result: SideIncomeResult): Map<number, SideIncomePeriodResult> {
  const out = new Map<number, SideIncomePeriodResult>();
  for (const p of result.periods) for (const id of p.depositIds) out.set(id, p);
  return out;
}

export function depositDto(
  d: SideIncomeDepositRow,
  o: { streamName: string; period: SideIncomePeriodResult | undefined },
): SideIncomeDepositDto {
  return {
    id: d.id,
    streamId: d.streamId,
    streamName: o.streamName,
    date: d.depositDate,
    amountCents: d.amountCents,
    note: d.note,
    origin: d.origin,
    sheetRef: d.sheetRef,
    periodMonth: o.period?.periodMonth ?? null,
    provisional: o.period?.status === 'provisional',
  };
}

/** Every deposit, newest first (date desc, then id desc). */
export function depositDtos(
  data: InvestmentData,
  result: SideIncomeResult,
): SideIncomeDepositDto[] {
  const names = new Map(data.incomeStreams.map((s) => [s.id, s.name]));
  const periods = periodOfDeposit(result);
  return [...data.deposits]
    .sort((a, b) =>
      a.depositDate !== b.depositDate ? (a.depositDate < b.depositDate ? 1 : -1) : b.id - a.id,
    )
    .map((d) =>
      depositDto(d, { streamName: names.get(d.streamId) ?? '', period: periods.get(d.id) }),
    );
}

export function sideIncomePeriodDto(
  p: SideIncomePeriodResult,
  note: PeriodNoteDto | undefined,
): SideIncomePeriodDto {
  return {
    periodMonth: p.periodMonth,
    start: p.start,
    end: p.end,
    status: p.status,
    totalCents: p.totalCents,
    byStream: p.byStream.map((x) => ({ streamId: x.streamId, amountCents: x.amountCents })),
    note: note ?? null,
  };
}

export function sideIncomeKpisDto(r: SideIncomeResult): SideIncomeKpisDto {
  return {
    financialYear: r.fy.financialYear,
    fyStart: r.fy.start,
    fyEnd: r.fy.end,
    avgPerPeriodThisFyCents: r.avgPerPeriodThisFyCents,
    periodsThisFy: r.periodsThisFy,
    fyToDateCents: r.fyToDateCents,
    projectedYearCents: r.projectedYearCents,
    avg365Cents: r.avg365Cents,
    periods365: r.periods365,
    lifetimeCents: r.lifetimeCents,
  };
}

const TOTAL_KEY = 'total';

/** The side-income chart: engine periods → compressSeries (sums; yearly = FY, §2.13, §5). */
export function sideIncomeChart(ctx: FinanceContext): SideIncomePageResponse['charts'] {
  const s = ctx.data.settings;
  const unit = chartDateUnitSetting(s) ?? 'monthly';
  const count = numberSetting(s, 'charts.unitCount');
  const streamKeys = ctx.data.incomeStreams.map((st) => String(st.id));
  const points: SeriesPoint[] = ctx.sideIncome().periods.map((p) => {
    const values: Record<string, number | null> = { [TOTAL_KEY]: p.totalCents };
    for (const key of streamKeys) values[key] = 0;
    for (const x of p.byStream) values[String(x.streamId)] = x.amountCents;
    return { period: p.periodMonth, date: p.end, live: p.status === 'provisional', values };
  });
  const modes = Object.fromEntries(
    [...streamKeys, TOTAL_KEY].map((k) => [k, 'sum' as const]),
  ) as Record<string, 'sum'>;
  const compressed = ctx.engine.compressSeries(points, unit, count, modes, 'fy');
  return {
    unit,
    count,
    points: compressed.map((p): SideIncomeChartPointDto => ({
      label: p.label,
      period: p.period,
      date: p.date,
      live: p.live,
      byStream: Object.fromEntries(streamKeys.map((k) => [k, p.values[k] ?? null])),
      totalCents: p.values[TOTAL_KEY] ?? null,
    })),
  };
}

export function buildSideIncomePage(ctx: FinanceContext): SideIncomePageResponse {
  const { data } = ctx;
  const result = ctx.sideIncome();
  const notes = notesByMonth(data.periodNotes, 'side_income');
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    lastRun: latestSnapshot(data.snapshots)?.runDate ?? null,
    streams: incomeStreamDtos(data, result),
    deposits: depositDtos(data, result),
    periods: [...result.periods]
      .reverse()
      .map((p) => sideIncomePeriodDto(p, notes.get(p.periodMonth))),
    outside: { beforeFirstCents: result.beforeFirstCents, afterAsOfCents: result.afterAsOfCents },
    kpis: sideIncomeKpisDto(result),
    charts: sideIncomeChart(ctx),
    budget: {
      includeSideIncome: includeSideIncomeOf(data.settings),
      avg365Cents: result.avg365Cents,
    },
  };
}
