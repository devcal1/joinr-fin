// Shared pieces for the pure option builders.
import type {
  BarSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
} from 'echarts/charts';
import type {
  AriaComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { COLORS } from '../../core';
import { CHART_OTHER } from '../palette';
import type { ChartLegendItem, Series, ValueFormatter } from '../types';

/** The option shape every builder returns (assignable to EChartsCoreOption). */
export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GaugeSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | AriaComponentOption
>;

/** The number itself when finite, else null (a gap). */
export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Each series' values aligned to the categories, non-finite values as null. */
export function alignSeries(
  categories: readonly string[],
  series: readonly Series[],
): (number | null)[][] {
  return series.map((s) => categories.map((_, i) => finiteOrNull(s.data[i])));
}

/** True when at least one category has a finite value to plot. */
export function hasSeriesData(categories: readonly string[], series: readonly Series[]): boolean {
  return (
    categories.length > 0 &&
    alignSeries(categories, series).some((row) => row.some((v) => v !== null))
  );
}

/** Screen-reader description: ECharts writes it verbatim as the container's aria-label. */
export function ariaOption(ariaLabel: string): AriaComponentOption {
  return {
    enabled: true,
    label: { enabled: true, description: ariaLabel },
    decal: { show: false },
  };
}

/**
 * The ECharts legend stays off: EChart renders the legend as HTML above the plot, so it wraps
 * on a phone instead of paging, and screen readers can read it.
 */
export const NO_LEGEND: LegendComponentOption = { show: false };

/** Legend entries for two or more series (a single series is named by the card title). */
export function seriesLegend(
  names: readonly string[],
  colors: readonly string[],
  key: ChartLegendItem['key'],
): ChartLegendItem[] {
  if (names.length < 2) return [];
  return names.map((name, i) => ({ name, color: colors[i] ?? CHART_OTHER, key }));
}

/** Plot area: ECharts 6 keeps the axis labels inside the container (outerBounds 'auto'). */
export const GRID: GridComponentOption = { left: 4, right: 12, top: 12, bottom: 4 };

/** Tooltips stay inside the chart so they never widen the page on a phone. */
export const TOOLTIP_BASE: TooltipComponentOption = { confine: true, transitionDuration: 0.2 };

/** `+$1,240` for gains: adds the plus sign a formatter leaves off. */
export function signed(format: ValueFormatter, value: number): string {
  const text = format(value);
  return value > 0 && !text.startsWith('+') ? `+${text}` : text;
}

/** The word that goes with a gain/loss colour (status is never colour-only). */
export function changeWord(value: number): string {
  if (value > 0) return 'Gain';
  if (value < 0) return 'Loss';
  return 'No change';
}

/** Marker ring: a 2px ring in the card surface colour keeps points legible where lines cross. */
export const MARKER_RING = { borderColor: COLORS.surface, borderWidth: 2 } as const;
