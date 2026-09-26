// Snapshot aggregation (stage-5.md §2.7; spec 01 §4, replacing WorkingSheet's compressTable): rows
// grouped monthly by period month, by calendar quarter, or by year on the year basis of the period
// month (§2.3), each column combined by SNAPSHOT_COLUMN_MODES: `end` (the group's last row), `sum`
// (the flows; a sum of nulls is null) or `ratio` (recomputed from the group's aggregated cents).
import {
  SNAPSHOT_COLUMN_MODES,
  SNAPSHOT_FIGURE_COLUMNS,
  type ChartDateUnit,
  type YearBasis,
} from '@joinr/schema';
import { sumOrNull } from './assetsCommon';
import { netWorthOf } from './netWorth';
import { groupOf, keepLast, sortByRunDate } from './periods';
import { RATIO_CHECKS, sheetRatio, type RatioColumn } from './snapshot';
import type { Cents, SnapshotFigures, SnapshotGroup, SnapshotSeriesRow } from './types';

export function aggregateSnapshots(i: {
  rows: readonly SnapshotSeriesRow[];
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
}): SnapshotGroup[] {
  const rows = sortByRunDate(i.rows);
  // Each row's growth against the row before it (the rolling table's Q and R).
  const breakdowns = rows.map((r) => netWorthOf(r.figures));
  const growth = rows.map((_, k) =>
    k === 0
      ? { total: null, liquid: null }
      : {
          total: breakdowns[k]!.netWorthCents - breakdowns[k - 1]!.netWorthCents,
          liquid: breakdowns[k]!.liquidCents - breakdowns[k - 1]!.liquidCents,
        },
  );

  const groups: { key: string; label: string; members: number[] }[] = [];
  rows.forEach((r, k) => {
    const { key, label } = groupOf(r.periodMonth, r.runDate, i.unit, i.yearBasis);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.members.push(k);
    else groups.push({ key, label, members: [k] });
  });

  return keepLast(groups, i.unit, i.count).map((g) => {
    const members = g.members.map((k) => rows[k]!);
    const last = members[members.length - 1]!;
    const figures = { ...last.figures } as Record<keyof SnapshotFigures, unknown>;
    for (const column of SNAPSHOT_FIGURE_COLUMNS) {
      if (SNAPSHOT_COLUMN_MODES[column] === 'sum') {
        figures[column] = sumOrNull(members.map((m) => m.figures[column] as Cents | null));
      }
    }
    const f = figures as unknown as SnapshotFigures;
    for (const column of Object.keys(RATIO_CHECKS) as RatioColumn[]) {
      const [gain, value] = RATIO_CHECKS[column];
      f[column] = sheetRatio(f[gain], f[value]);
    }
    const sumGrowth = (pick: 'total' | 'liquid') =>
      sumOrNull(g.members.map((k) => growth[k]![pick]));
    return {
      label: g.label,
      period: last.periodMonth,
      date: last.runDate,
      live: last.live,
      rows: members.length,
      figures: f,
      netWorth: netWorthOf(f),
      growthCents: sumGrowth('total'),
      liquidGrowthCents: sumGrowth('liquid'),
    };
  });
}
