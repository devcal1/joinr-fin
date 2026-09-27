// Bar chart option builder (pure). Thin bars (≤ 24px) with a 4px rounded data end and a square
// baseline; stacked segments are separated by a 2px surface gap; gain/loss uses --go/--stop.
// Stage 5 (additive, stage-5.md §6.1): stacked negatives go below zero ('samesign'), line overlays
// (a rate on a right-hand axis, a dashed trend) are drawn over the bars, and the stacked total can
// be named ("Net worth").
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { COLORS } from '../../core';
import { formatChartNumber } from '../format';
import { CHART_GAIN, CHART_LOSS, resolveSeriesColor } from '../palette';
import { readParamIndex, tooltipHtml, type TooltipRow } from '../tooltip';
import type { BarChartProps, BarOverlay, ChartLegendItem, ValueFormatter } from '../types';
import {
  MARKER_RING,
  TOOLTIP_BASE,
  alignSeries,
  ariaOption,
  axisFormatterFor,
  changeWord,
  finiteOrNull,
  GRID,
  hasSeriesData,
  NO_LEGEND,
  signed,
  valueExtent,
  type ChartOption,
} from './common';
import { LINE_WIDTH, MARKER_SIZE } from './line';

export const BAR_MAX_WIDTH = 24;
export const BAR_RADIUS = 4;
/** Surface gap between stacked segments. */
export const STACK_GAP = 2;
/** The default name of a stacked chart's total in the tooltip. */
export const DEFAULT_TOTAL_LABEL = 'Total';

type Radius = [number, number, number, number];

/** Rounds the data end only: [top-left, top-right, bottom-right, bottom-left]. */
export function barRadius(horizontal: boolean, positive: boolean): Radius {
  const r = BAR_RADIUS;
  if (horizontal) return positive ? [0, r, r, 0] : [r, 0, 0, r];
  return positive ? [r, r, 0, 0] : [0, 0, r, r];
}

/**
 * For each category, the index of the outermost positive and negative segment of a stack
 * (-1 when there is none). Only those segments get the rounded data end.
 */
export function stackEnds(values: (number | null)[][]): { top: number[]; bottom: number[] } {
  const count = values[0]?.length ?? 0;
  const top = Array.from({ length: count }, () => -1);
  const bottom = Array.from({ length: count }, () => -1);
  values.forEach((row, seriesIndex) => {
    row.forEach((v, i) => {
      if (v !== null && v > 0) top[i] = seriesIndex;
      if (v !== null && v < 0) bottom[i] = seriesIndex;
    });
  });
  return { top, bottom };
}

/** An overlay's colour: its own (when safe), else the palette slot after the bars. */
export function overlayColor(overlay: BarOverlay, index: number, barCount: number): string {
  return resolveSeriesColor(barCount + index, overlay.color);
}

/**
 * Legend entries when two or more things are drawn: a swatch per bar series (none for gain/loss
 * colouring: those colours are status), a stroke per line overlay, a dashed stroke per dashed one.
 */
export function barLegend(p: BarChartProps): ChartLegendItem[] {
  const bars: ChartLegendItem[] = p.signColors
    ? []
    : p.series.map((s, i) => ({
        name: s.name,
        color: resolveSeriesColor(i, s.color),
        key: 'swatch',
      }));
  const lines: ChartLegendItem[] = (p.overlays ?? []).map((o, i) => ({
    name: o.name,
    color: overlayColor(o, i, p.series.length),
    key: o.dashed ? 'dashed-line' : 'line',
  }));
  const drawn = p.series.length + lines.length;
  if (drawn < 2) return [];
  return [...bars, ...lines];
}

/** The span covering both extents. */
function mergeExtents(a: [number, number], b: [number, number]): [number, number] {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

/**
 * True when the chart has something to draw: a non-zero bar value or a non-zero overlay value
 * (an all-zero chart shows its empty message, Stage 6, STYLE-5).
 */
export function hasBarData(p: Pick<BarChartProps, 'categories' | 'series' | 'overlays'>): boolean {
  if (hasSeriesData(p.categories, p.series)) return true;
  const overlays = (p.overlays ?? []).map((o) => ({ name: o.name, data: o.values }));
  return hasSeriesData(p.categories, overlays);
}

export function barOption(p: BarChartProps): EChartsCoreOption {
  const {
    ariaLabel,
    categories,
    series,
    stacked = false,
    horizontal = false,
    signColors = false,
  } = p;
  const format = p.valueFormatter ?? formatChartNumber;
  const values = alignSeries(categories, series);
  const colors = series.map((s, i) => resolveSeriesColor(i, s.color));
  const isStacked = stacked && series.length > 1;
  const ends = isStacked ? stackEnds(values) : null;
  const overlays = p.overlays ?? [];
  const secondary = !horizontal && overlays.some((o) => o.axis === 'secondary');
  const totalLabel = p.totalLabel ?? DEFAULT_TOTAL_LABEL;
  const overlayColors = overlays.map((o, i) => overlayColor(o, i, series.length));
  const overlayValues = overlays.map((o) => categories.map((_, i) => finiteOrNull(o.values[i])));
  const onSecondary = (o: BarOverlay): boolean => secondary && o.axis === 'secondary';
  // Money axes get tick labels precise enough for their own extent (STYLE-5, stage-6.md §6.9 C).
  const primaryExtent = mergeExtents(
    valueExtent(values, isStacked),
    valueExtent(overlayValues.filter((_, oi) => !onSecondary(overlays[oi] as BarOverlay))),
  );
  const secondaryExtent = valueExtent(
    overlayValues.filter((_, oi) => onSecondary(overlays[oi] as BarOverlay)),
  );
  const axisFormat = axisFormatterFor(p.axisFormatter ?? format, primaryExtent);
  // The secondary formatter also writes the overlay's tooltip figures; only its ticks are compacted.
  const secondaryFormat: ValueFormatter = p.secondaryAxisFormatter ?? format;
  const secondaryAxisFormat = axisFormatterFor(secondaryFormat, secondaryExtent);

  const barSeries: BarSeriesOption[] = series.map((s, si) => ({
    type: 'bar',
    name: s.name,
    stack: isStacked ? 'total' : undefined,
    // Positives stack up and negatives down (a loss, a debt), so each stack adds up to its total.
    stackStrategy: isStacked ? 'samesign' : undefined,
    barMaxWidth: BAR_MAX_WIDTH,
    barGap: '15%',
    barCategoryGap: '35%',
    itemStyle: {
      color: colors[si],
      ...(isStacked ? { borderColor: COLORS.surface, borderWidth: STACK_GAP } : {}),
    },
    // Hover keeps the slot colour ('inherit' stops ECharts lightening it).
    emphasis: { focus: 'none', itemStyle: { color: 'inherit' } },
    data: (values[si] ?? []).map((v, ci) => {
      if (v === null) return null;
      const positive = v >= 0;
      const outermost = !ends || (positive ? ends.top[ci] === si : ends.bottom[ci] === si);
      return {
        value: v,
        itemStyle: {
          borderRadius: outermost ? barRadius(horizontal, positive) : 0,
          ...(signColors ? { color: positive ? CHART_GAIN : CHART_LOSS } : {}),
        },
      };
    }),
  }));

  const lineSeries: LineSeriesOption[] = overlays.map((o, oi) => {
    const color = overlayColors[oi];
    return {
      type: 'line',
      name: o.name,
      yAxisIndex: onSecondary(o) ? 1 : 0,
      data: overlayValues[oi] ?? [],
      connectNulls: false,
      smooth: false,
      symbol: 'circle',
      symbolSize: MARKER_SIZE,
      // A lone point would be invisible without its marker.
      showSymbol: categories.length === 1,
      z: 3,
      lineStyle: {
        color,
        width: LINE_WIDTH,
        cap: 'round',
        join: 'round',
        type: o.dashed ? 'dashed' : 'solid',
      },
      itemStyle: { color, ...MARKER_RING },
      emphasis: { focus: 'none', lineStyle: { width: LINE_WIDTH } },
    };
  });

  const categoryAxis = {
    type: 'category' as const,
    data: categories,
    inverse: horizontal, // first category at the top when horizontal
    axisLabel: horizontal
      ? { hideOverlap: true, width: 120, overflow: 'truncate' as const }
      : { hideOverlap: true },
  };
  const valueAxis = {
    type: 'value' as const,
    axisLabel: { formatter: (v: number) => axisFormat(v), hideOverlap: true },
  };
  // The one chart with a second axis (stage-5.md §6.1): a rate against money bars. The axis is
  // named after its overlay; it draws no gridlines of its own.
  const secondaryAxis = {
    type: 'value' as const,
    position: 'right' as const,
    name: overlays.find((o) => o.axis === 'secondary')?.name,
    nameTextStyle: { color: COLORS.textSecondary, fontSize: 11 },
    splitLine: { show: false },
    axisLabel: { formatter: (v: number) => secondaryAxisFormat(v), hideOverlap: true },
  };

  const barRow = (si: number, ci: number): TooltipRow | null => {
    const s = series[si];
    const v = values[si]?.[ci];
    if (!s || v === null || v === undefined) return null;
    return signColors
      ? {
          name: s.name,
          value: signed(format, v),
          color: v >= 0 ? CHART_GAIN : CHART_LOSS,
          note: changeWord(v),
        }
      : { name: s.name, value: format(v), color: colors[si] ?? COLORS.textMuted };
  };
  const totalOf = (ci: number): { name: string; value: string } | undefined =>
    isStacked
      ? { name: totalLabel, value: format(values.reduce((sum, r) => sum + (r[ci] ?? 0), 0)) }
      : undefined;

  const itemTooltip = {
    ...TOOLTIP_BASE,
    trigger: 'item' as const,
    formatter: (params: unknown) => {
      const at = readParamIndex(params);
      if (!at || at.seriesIndex >= series.length) return '';
      const row = barRow(at.seriesIndex, at.dataIndex);
      if (!row) return '';
      return tooltipHtml({
        title: categories[at.dataIndex],
        rows: [row],
        total: totalOf(at.dataIndex),
      });
    },
  };
  // With lines over the bars, one tooltip per category lists every bar and every line.
  const axisTooltip = {
    ...TOOLTIP_BASE,
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const },
    formatter: (params: unknown) => {
      const at = readParamIndex(params);
      if (!at) return '';
      const ci = at.dataIndex;
      const rows: TooltipRow[] = series.flatMap((_, si) => {
        const row = barRow(si, ci);
        return row ? [row] : [];
      });
      overlays.forEach((o, oi) => {
        const v = overlayValues[oi]?.[ci];
        if (v === null || v === undefined) return;
        rows.push({
          name: o.name,
          value: (onSecondary(o) ? secondaryFormat : format)(v),
          color: overlayColors[oi] ?? COLORS.textMuted,
          key: 'line',
        });
      });
      if (rows.length === 0) return '';
      return tooltipHtml({ title: categories[ci], rows, total: totalOf(ci) });
    },
  };

  const option: ChartOption = {
    aria: ariaOption(ariaLabel),
    color: [...colors, ...overlayColors],
    legend: NO_LEGEND,
    grid: GRID,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : secondary ? [valueAxis, secondaryAxis] : valueAxis,
    tooltip: overlays.length === 0 ? itemTooltip : axisTooltip,
    series: [...barSeries, ...lineSeries],
  };
  return option;
}
