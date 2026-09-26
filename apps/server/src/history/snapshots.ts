// The recorded months as the History page and the mutation responses show them (stage-5.md §4.4
// SnapshotDto): each stored row's identity and provenance, its figures, its net-worth breakdown
// (`netWorthOf`), its savings period's adjusted rate, its own consistency check and whether it may
// be deleted (D92: the latest, and never a migrated month). Every figure comes from the engine.
import { INSTRUMENT_KINDS, type IsoMonth, type SnapshotDto } from '@joinr/schema';
import type { FinanceContext } from '../cashflow/context';
import type { SnapshotRow } from '../investments/load';
import { netWorthBreakdownDto, snapshotDifferenceDto, snapshotFiguresDto } from './dto';
import { figuresOf } from './inputs';

/** Every snapshot's DTO, in run-date order (then period month). */
export function snapshotDtos(ctx: FinanceContext): SnapshotDto[] {
  const rows = new Map<IsoMonth, SnapshotRow>(ctx.data.snapshots.map((r) => [r.periodMonth, r]));
  const ordered = ctx.snapshots();
  const checks = new Map(ctx.check().rows.map((r) => [r.periodMonth, r]));
  const ratios = new Map(
    ctx.savings().periods.map((p) => [p.periodMonth, p.adjusted.savingsRatio]),
  );
  const runDates = new Map<string, number>();
  for (const s of ordered) runDates.set(s.runDate, (runDates.get(s.runDate) ?? 0) + 1);
  const latest = ordered.at(-1);
  return ordered.map((s) => {
    const row = rows.get(s.periodMonth)!;
    const figures = figuresOf(s);
    const check = checks.get(s.periodMonth);
    return {
      id: row.id,
      periodMonth: s.periodMonth,
      runDate: s.runDate,
      source: s.source,
      recordedAt: row.recordedAt,
      origin: row.origin,
      sheetRef: row.sheetRef,
      note: row.note,
      revision: row.revision,
      figures: snapshotFiguresDto(figures),
      netWorth: netWorthBreakdownDto(ctx.engine.netWorthOf(figures)),
      late: s.source === 'late' || s.source === 'lookback',
      sharedRunDate: (runDates.get(s.runDate) ?? 0) > 1,
      savingsRatio: ratios.get(s.periodMonth) ?? null,
      check: {
        checked: check?.checked ?? 0,
        differences: (check?.differences ?? []).map(snapshotDifferenceDto),
      },
      deletable: s === latest && s.source !== 'migrated',
    };
  });
}

/** The DTO of one month (null when it has no snapshot). */
export function snapshotDtoOf(ctx: FinanceContext, month: IsoMonth): SnapshotDto | null {
  return snapshotDtos(ctx).find((d) => d.periodMonth === month) ?? null;
}

/** Σ unpriced and stale holdings over the four investment kinds (the prices callouts). */
export function priceCounts(ctx: FinanceContext): {
  unpricedCount: number;
  stalePriceCount: number;
} {
  let unpricedCount = 0;
  let stalePriceCount = 0;
  for (const kind of INSTRUMENT_KINDS) {
    const summary = ctx.compute(kind).summary;
    unpricedCount += summary.unpricedCount;
    stalePriceCount += summary.stalePriceCount;
  }
  return { unpricedCount, stalePriceCount };
}
