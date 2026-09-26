// Chart series for the Net Worth and History pages (stage-5.md §5): the one stack of classes in
// NET_WORTH_STACK_ORDER with each class in its NET_WORTH_CLASS_SLOTS colour, "Other debts" (History
// U) in grey below zero when a displayed group has one, and the dashed grey trend overlays. Values
// are dollars for the charts; the tables read the cents. Pure functions, no React.
import {
  NET_WORTH_STACK_ORDER,
  type NetWorthStackClass,
  type SnapshotGroupDto,
  type TrendDto,
} from '@joinr/schema';
import type { BarOverlay, Series } from '@joinr/ui';
import { toDollars } from '../assets/display';
import {
  OTHER_DEBTS_COLOR,
  OTHER_DEBTS_SERIES,
  STACK_LABELS,
  TREND_COLOR,
  TREND_NAME,
  classColor,
  groupCategory,
  otherDebtsCents,
  stackValueCents,
} from './display';

/** One stacked class over the groups (cents), with its label and colour. */
export interface StackColumn {
  key: NetWorthStackClass | 'other_debts';
  label: string;
  color: string;
  cents: (number | null)[];
}

/** True when a series has something to draw (a class that is empty everywhere is left out). */
function drawn(values: readonly (number | null)[]): boolean {
  return values.some((v) => v !== null && v !== 0);
}

/**
 * The stacked classes over the groups, in the stack order, each in its class colour. A class with
 * nothing in any displayed group is left out (the legend lists only what is drawn); "Other debts"
 * is added (grey, ≤ 0) only when a displayed group has one.
 */
export function stackColumns(
  groups: readonly SnapshotGroupDto[],
  classes: readonly NetWorthStackClass[] = NET_WORTH_STACK_ORDER,
  withOtherDebts = true,
): StackColumn[] {
  const columns: StackColumn[] = classes
    .map((key) => ({
      key,
      label: STACK_LABELS[key],
      color: classColor(key),
      cents: groups.map((g) => stackValueCents(g.figures, key)),
    }))
    .filter((column) => drawn(column.cents));
  if (withOtherDebts) {
    const debts = groups.map((g) => otherDebtsCents(g.figures));
    if (debts.some((v) => v !== null && v < 0)) {
      columns.push({
        key: 'other_debts',
        label: OTHER_DEBTS_SERIES,
        color: OTHER_DEBTS_COLOR,
        cents: debts,
      });
    }
  }
  return columns;
}

/** The chart series of stack columns (dollars). */
export function stackSeries(columns: readonly StackColumn[]): Series[] {
  return columns.map((column) => ({
    name: column.label,
    color: column.color,
    // ECharts' samesign stacking puts a 0 of the below-zero series on top of the positive stack,
    // which drew the Other debts line up to the total wherever it is 0 (the live group, where U is
    // always 0): draw it only where there is a debt. The table keeps the 0.
    data: column.cents.map((cents) =>
      column.key === 'other_debts' && cents !== null && cents >= 0 ? null : toDollars(cents),
    ),
  }));
}

/** The chart categories: each group's label, " (live)" on the live one. */
export function groupCategories(groups: readonly SnapshotGroupDto[]): string[] {
  return groups.map(groupCategory);
}

/** A trend as a dashed grey overlay named "Trend" (§5). */
export function trendOverlay(trend: TrendDto): BarOverlay {
  return {
    name: TREND_NAME,
    values: trend.fittedCents.map(toDollars),
    dashed: true,
    color: TREND_COLOR,
  };
}

/** Σ of a group's drawn columns (cents): the stacked total. */
export function stackTotalCents(columns: readonly StackColumn[], index: number): number {
  return columns.reduce((sum, column) => sum + (column.cents[index] ?? 0), 0);
}
