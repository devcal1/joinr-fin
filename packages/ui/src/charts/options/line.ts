// Line and area option builders (pure). 2px lines with round joins; markers (8px, 2px surface
// ring) appear on hover; area fills are a wash of the series hue. The tooltip is a crosshair
// that lists every series at the hovered category.
//
// Stage 6 (stage-6.md §5, §6.5), additive:
// - `Series.dashed` draws a 2px dashed stroke (a target line) with a dashed legend key.
// - `markers` draw the node-line motif (STYLE_GUIDE §7.2): a 1px dashed `--text-muted` vertical
//   line at each milestone category (an ECharts markLine, which also carries the 11px
//   `--text-secondary` label, anchored inside the plot: the first to the right of its line, the
//   last to the left) and the node's dot in its full-strength brand colour (no glow) at the top of
//   the plot, in a lane kept above the highest value. A markLine's end symbol takes the line's
//   colour, so the dots are a separate point-only series. A marker with `labelHidden` shows the
//   dot only. The crosshair tooltip names the category's milestone.
// - A money axis given `compactMoneyFormatter` uses `compactAxisFormatter` for the data's extent,
//   so adjacent ticks stay distinct (STYLE-5, §6.9 C).
import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { COLORS, FONT_SIZES } from '../../core';
import { compactAxisFormatter, compactMoneyFormatter, formatChartNumber } from '../format';
import { AREA_OPACITY, resolveSeriesColor } from '../palette';
import { readParamIndex, tooltipHtml, type TooltipRow } from '../tooltip';
import type {
  AreaChartProps,
  ChartLegendItem,
  LineChartMarker,
  LineChartProps,
  Series,
  ValueFormatter,
} from '../types';
import {
  MARKER_RING,
  TOOLTIP_BASE,
  alignSeries,
  ariaOption,
  GRID,
  NO_LEGEND,
  type ChartOption,
} from './common';

export const LINE_WIDTH = 2;
export const MARKER_SIZE = 8;

/** A milestone node's dot diameter (px): as the MilestoneLine's dots. */
export const MILESTONE_DOT_SIZE = 10;
/** The plot's top padding (px) when markers are drawn: room for the labels above the dots. */
export const MARKER_GRID_TOP = 34;
/** Headroom above the highest value, as a share of the value range: the dots' lane. */
export const MARKER_LANE_SHARE = 0.14;

/** The brand colour of each node tone (full strength; glows stay in the brand moments). */
const TONE_COLORS: Readonly<Record<LineChartMarker['tone'], string>> = {
  teal: COLORS.teal,
  violet: COLORS.violet,
  fuchsia: COLORS.fuchsia,
  orange: COLORS.orange,
};

/** The colour of a milestone node's tone. */
export function markerToneColor(tone: LineChartMarker['tone']): string {
  return TONE_COLORS[tone];
}

/**
 * Legend entries when there are two or more series (a dashed series gets a dashed key). Also used
 * by AreaChart.
 */
export function lineLegend(p: LineChartProps): ChartLegendItem[] {
  if (p.series.length < 2) return [];
  return p.series.map((s, i) => ({
    name: s.name,
    color: resolveSeriesColor(i, s.color),
    key: s.dashed ? 'dashed-line' : 'line',
  }));
}

interface LineMode {
  area: boolean;
  stacked: boolean;
}

/**
 * The smallest and largest plotted values (0 included, as the value axis starts at 0). A stacked
 * chart's extent is its per-category sums of the positive and of the negative values.
 */
function valueExtent(
  values: readonly (readonly (number | null)[])[],
  stacked: boolean,
): [number, number] {
  let min = 0;
  let max = 0;
  if (stacked) {
    const count = Math.max(0, ...values.map((row) => row.length));
    for (let i = 0; i < count; i += 1) {
      let up = 0;
      let down = 0;
      for (const row of values) {
        const v = row[i];
        if (v === null || v === undefined) continue;
        if (v > 0) up += v;
        else down += v;
      }
      max = Math.max(max, up);
      min = Math.min(min, down);
    }
    return [min, max];
  }
  for (const row of values) {
    for (const v of row) {
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return [min, max];
}

/** The value axis's top with the dots' lane above the highest value. */
export function markerAxisMax(extent: readonly [number, number]): number {
  const [min, max] = extent;
  return max + (max - min || Math.abs(max) || 1) * MARKER_LANE_SHARE;
}

/** The series name of the milestone dots (never in the legend or the tooltip). */
export const MILESTONE_DOTS_SERIES = 'Milestones';

/** A point-only series: each marker's dot at the top of the plot in its tone. */
function markerDotsSeries(
  markers: readonly LineChartMarker[],
  categoryCount: number,
  top: number,
): LineSeriesOption {
  const at = new Map(markers.map((m) => [m.index, m]));
  return {
    type: 'line',
    name: MILESTONE_DOTS_SERIES,
    silent: true,
    animation: false,
    connectNulls: false,
    symbol: 'circle',
    symbolSize: MILESTONE_DOT_SIZE,
    showSymbol: true,
    showAllSymbol: true,
    clip: false,
    z: 5,
    lineStyle: { width: 0, opacity: 0 },
    emphasis: { disabled: true },
    tooltip: { show: false },
    data: Array.from({ length: categoryCount }, (_, i) => {
      const marker = at.get(i);
      return marker
        ? { value: top, itemStyle: { color: TONE_COLORS[marker.tone], borderWidth: 0 } }
        : null;
    }),
  };
}

/** The axis tick formatter: a compact money axis follows its extent (STYLE-5). */
function axisFormatterFor(
  p: LineChartProps,
  format: ValueFormatter,
  extent: readonly [number, number],
): ValueFormatter {
  const axis = p.axisFormatter ?? format;
  return axis === compactMoneyFormatter ? compactAxisFormatter(extent) : axis;
}

/** The markers on real categories, in category order (a later duplicate index is dropped). */
export function visibleMarkers(
  markers: readonly LineChartMarker[] | undefined,
  categoryCount: number,
): LineChartMarker[] {
  const seen = new Set<number>();
  return (markers ?? [])
    .filter((m) => Number.isInteger(m.index) && m.index >= 0 && m.index < categoryCount)
    .filter((m) => (seen.has(m.index) ? false : (seen.add(m.index), true)))
    .sort((a, b) => a.index - b.index);
}

/** The markLine drawing the milestones (attached to the first series). */
function markLineOf(
  markers: readonly LineChartMarker[],
): NonNullable<LineSeriesOption['markLine']> {
  const last = markers.length - 1;
  return {
    silent: true,
    animation: false,
    // No end symbols: they would take the line's colour (the dots are their own series).
    symbol: ['none', 'none'],
    precision: 0,
    lineStyle: { type: 'dashed', width: 1, color: COLORS.textMuted, opacity: 1 },
    emphasis: { disabled: true },
    data: markers.map((m, i) => ({
      name: m.label,
      xAxis: m.index,
      label: {
        show: !m.labelHidden,
        formatter: m.label,
        position: 'end',
        distance: 6,
        // Anchored inside the plot: the first to the right of its line, the last to the left.
        align: i === 0 ? 'left' : i === last ? 'right' : 'center',
        color: COLORS.textSecondary,
        fontSize: FONT_SIZES.small,
      },
    })),
  };
}

function buildLineOption(p: LineChartProps, mode: LineMode): EChartsCoreOption {
  const { ariaLabel, categories, series } = p;
  const format = p.valueFormatter ?? formatChartNumber;
  const values = alignSeries(categories, series);
  const colors = series.map((s: Series, i) => resolveSeriesColor(i, s.color));
  const isStacked = mode.stacked && series.length > 1;
  const extent = valueExtent(values, isStacked);
  const axisFormat = axisFormatterFor(p, format, extent);
  const markers = visibleMarkers(p.markers, categories.length);
  const hasMarkers = markers.length > 0 && series.length > 0;
  const axisMax = hasMarkers ? markerAxisMax(extent) : undefined;

  const lineSeries: LineSeriesOption[] = series.map((s, si) => {
    const color = colors[si];
    return {
      type: 'line',
      name: s.name,
      stack: isStacked ? 'total' : undefined,
      data: values[si] ?? [],
      connectNulls: false,
      smooth: false,
      symbol: 'circle',
      symbolSize: MARKER_SIZE,
      // A lone point would be invisible without its marker.
      showSymbol: categories.length === 1,
      lineStyle: {
        color,
        width: LINE_WIDTH,
        cap: 'round',
        join: 'round',
        type: s.dashed ? 'dashed' : 'solid',
      },
      itemStyle: { color, ...MARKER_RING },
      areaStyle: mode.area ? { color, opacity: AREA_OPACITY } : undefined,
      emphasis: { focus: 'none', lineStyle: { width: LINE_WIDTH } },
      markLine: hasMarkers && si === 0 ? markLineOf(markers) : undefined,
    };
  });

  const markerAt = new Map(markers.map((m) => [m.index, m]));

  const option: ChartOption = {
    aria: ariaOption(ariaLabel),
    color: colors,
    legend: NO_LEGEND,
    grid: hasMarkers ? { ...GRID, top: MARKER_GRID_TOP } : GRID,
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      // With markers the axis top is the dots' lane, not a round figure: no label there.
      axisLabel: {
        formatter: (v: number) => axisFormat(v),
        hideOverlap: true,
        showMaxLabel: hasMarkers ? false : undefined,
      },
      // The dots sit in a lane above the highest value, so they never sit on a series line.
      max: axisMax,
      splitLine: hasMarkers ? { showMaxLine: false } : undefined,
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (params: unknown) => {
        const at = readParamIndex(params);
        if (!at) return '';
        const rows: TooltipRow[] = [];
        let sum = 0;
        series.forEach((s, si) => {
          const v = values[si]?.[at.dataIndex];
          if (v === null || v === undefined) return;
          sum += v;
          rows.push({ name: s.name, value: format(v), color: colors[si] ?? '', key: 'line' });
        });
        if (rows.length === 0) return '';
        const total =
          isStacked && rows.length > 1 ? { name: 'Total', value: format(sum) } : undefined;
        const marker = markerAt.get(at.dataIndex);
        const category = categories[at.dataIndex];
        const title =
          marker && category !== undefined
            ? `${category} · ${marker.tooltip ?? marker.label}`
            : category;
        return tooltipHtml({ title, rows, total });
      },
    },
    series:
      axisMax === undefined
        ? lineSeries
        : [...lineSeries, markerDotsSeries(markers, categories.length, axisMax)],
  };
  return option;
}

export function lineOption(p: LineChartProps): EChartsCoreOption {
  return buildLineOption(p, { area: false, stacked: false });
}

export function areaOption(p: AreaChartProps): EChartsCoreOption {
  return buildLineOption(p, { area: true, stacked: p.stacked ?? false });
}
