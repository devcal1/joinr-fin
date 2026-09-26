// The Stage 5 engine inputs the server builds from the loaded rows (stage-5.md §4.5 "Engine inputs
// built by the server"). Pure functions of the loaded data, the settings and the as-of date, so each
// row of the input table is unit-tested on its own; the request context (cashflow/context.ts)
// memoises the engine calls that consume them. The server never computes a figure here: it only
// picks rows (the snapshots in run-date order, the trades by kind, the chart view).
import type {
  EngineSnapshot,
  EngineTrade,
  SnapshotFigures,
  SnapshotSeriesRow,
} from '@joinr/engine';
import {
  INSTRUMENT_KINDS,
  JoinrDecimal,
  monthEndOf,
  normaliseDecimal,
  SNAPSHOT_FIGURE_COLUMNS,
  type ChartDateUnit,
  type DecimalString,
  type DecimalValue,
  type InstrumentKind,
  type IsoDate,
  type IsoMonth,
  type SettingKey,
  type YearBasis,
} from '@joinr/schema';
import { chartDateUnitSetting, numberSetting, type SettingsValues } from '../db/queries/settings';
import { snapshotsByRunDate } from '../assets/inputs';
import { yearBasisOf } from '../cashflow/inputs';
import { toEngineTrade, type InvestmentData, type SnapshotRow } from '../investments/load';

// ─── Snapshots (§4.5 "EngineSnapshot") ──────────────────────────────────────────────────────────

/** Any object carrying every figure column (a snapshot row, an engine snapshot, a DTO). */
type FigureCarrier = { [K in (typeof SNAPSHOT_FIGURE_COLUMNS)[number]]: SnapshotFigures[K] };

/** The figure columns of a row or snapshot (B…AK and the four extras), nothing else. */
export function figuresOf(row: FigureCarrier): SnapshotFigures {
  const out = {} as Record<string, unknown>;
  for (const column of SNAPSHOT_FIGURE_COLUMNS) out[column] = row[column];
  return out as unknown as SnapshotFigures;
}

/** A `snapshots` row as the engine takes it: every figure column, as stored, and its identity. */
export function toEngineSnapshot(row: SnapshotRow): EngineSnapshot {
  return {
    ...figuresOf(row),
    periodMonth: row.periodMonth,
    runDate: row.runDate,
    source: row.source,
  };
}

/** Every snapshot in run-date order (then period month), as the engine takes them. */
export function engineSnapshots(rows: readonly SnapshotRow[]): EngineSnapshot[] {
  return snapshotsByRunDate(rows).map(toEngineSnapshot);
}

/** Every trade of each kind (the composer's movements; every trade counts, D37). */
export function tradesByKind(data: InvestmentData): Record<InstrumentKind, EngineTrade[]> {
  const kindOf = new Map(data.instruments.map((i) => [i.id, i.kind]));
  const out = Object.fromEntries(INSTRUMENT_KINDS.map((k) => [k, [] as EngineTrade[]])) as Record<
    InstrumentKind,
    EngineTrade[]
  >;
  for (const t of data.trades) {
    const kind = kindOf.get(t.instrumentId);
    if (kind !== undefined) out[kind].push(toEngineTrade(t));
  }
  return out;
}

// ─── Charts (§4.5 "charts", §5) ─────────────────────────────────────────────────────────────────

export interface ChartView {
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
}

/**
 * The chart unit and count: the query (a view-only override, nothing saved) over the settings
 * (`charts.dateUnit ?? 'monthly'`, `charts.unitCount ?? null`); the year basis is
 * `savings.yearBasis ?? 'fy'` (D52).
 */
export function chartViewOf(
  s: SettingsValues,
  query: { unit?: ChartDateUnit | undefined; count?: number | undefined } = {},
): ChartView {
  return {
    unit: query.unit ?? chartDateUnitSetting(s) ?? 'monthly',
    count: query.count ?? numberSetting(s, 'charts.unitCount') ?? null,
    yearBasis: yearBasisOf(s),
  };
}

/** The aggregation rows: every snapshot (run-date order), then the live row when there is one. */
export function seriesRows(
  snapshots: readonly EngineSnapshot[],
  live: { periodMonth: IsoMonth; runDate: IsoDate; figures: SnapshotFigures } | null,
): SnapshotSeriesRow[] {
  const rows: SnapshotSeriesRow[] = snapshots.map((s) => ({
    periodMonth: s.periodMonth,
    runDate: s.runDate,
    live: false,
    figures: figuresOf(s),
  }));
  if (live) {
    rows.push({
      periodMonth: live.periodMonth,
      runDate: live.runDate,
      live: true,
      figures: live.figures,
    });
  }
  return rows;
}

/**
 * The savings tracker's total (§5): Stocks, ETFs, Crypto, Cash and Managed funds, with the
 * historical chart's Cash (`N + offsets − linked offsets`). Nulls count 0; null when every part is
 * null (nothing to plot).
 */
export function trackerCents(f: SnapshotFigures): number | null {
  const parts = [
    f.stocksValueCents,
    f.etfValueCents,
    f.cryptoValueCents,
    f.cashValueCents,
    f.mfValueCents,
  ];
  if (parts.every((p) => p === null)) return null;
  const cash = (f.cashValueCents ?? 0) + (f.offsetCents ?? 0) - (f.mortgageOffsetCents ?? 0);
  return (
    (f.stocksValueCents ?? 0) +
    (f.etfValueCents ?? 0) +
    (f.cryptoValueCents ?? 0) +
    cash +
    (f.mfValueCents ?? 0)
  );
}

// ─── Record planning (§2.9, §4.4 `record`) ──────────────────────────────────────────────────────

/** The month after `month` (`2026-12` → `2027-01`). */
export function nextIsoMonth(month: IsoMonth): IsoMonth {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12
    ? `${String(y + 1).padStart(4, '0')}-01`
    : `${month.slice(0, 5)}${String(m + 1).padStart(2, '0')}`;
}

/** The recordable months whose last day is before `today` (they have ended). */
export function endedMonths(recordable: readonly IsoMonth[], today: IsoDate): IsoMonth[] {
  return recordable.filter((m) => monthEndOf(m) < today);
}

/**
 * The record form's default months (§6.4): every recordable month that has ended; otherwise the
 * current month when it is recordable; otherwise none.
 */
export function defaultRecordMonths(recordable: readonly IsoMonth[], today: IsoDate): IsoMonth[] {
  const ended = endedMonths(recordable, today);
  if (ended.length > 0) return ended;
  const current = today.slice(0, 7);
  return recordable.includes(current) ? [current] : [];
}

/**
 * The months between the first and the latest snapshot month with no snapshot (never recordable:
 * a month before the latest snapshot can never be filled later, §2.9).
 */
export function gapMonths(months: readonly IsoMonth[]): IsoMonth[] {
  if (months.length === 0) return [];
  const have = new Set(months);
  const sorted = [...have].sort();
  const last = sorted[sorted.length - 1]!;
  const out: IsoMonth[] = [];
  for (let m = sorted[0]!; m < last; m = nextIsoMonth(m)) {
    if (!have.has(m)) out.push(m);
  }
  return out;
}

// ─── Allocation targets (§4.4 `targetSumRatio`, §6.5 item 4) ────────────────────────────────────

export const ALLOCATION_SETTING_KEYS = [
  'allocation.etf',
  'allocation.stock',
  'allocation.crypto',
  'allocation.cash',
  'allocation.managedFund',
  'allocation.otherAssets',
] as const satisfies readonly SettingKey[];

/** Σ of the set `allocation.*` targets (decimals, unrounded); null when none is set. */
export function allocationSumRatio(s: SettingsValues): DecimalString | null {
  let sum: DecimalValue | null = null;
  for (const key of ALLOCATION_SETTING_KEYS) {
    const v = s[key];
    if (typeof v !== 'string') continue;
    sum = (sum ?? new JoinrDecimal(0)).plus(new JoinrDecimal(v));
  }
  return sum === null ? null : normaliseDecimal(sum);
}
