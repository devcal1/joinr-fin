// Bar chart option builder (pure). Thin bars (≤ 24px) with a 4px rounded data end and a square
// baseline; stacked segments are separated by a 2px surface gap; gain/loss uses --go/--stop.
import type { BarSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { COLORS } from '../../core';
import { formatChartNumber } from '../format';
import { CHART_GAIN, CHART_LOSS, resolveSeriesColor } from '../palette';
import { readParamIndex, tooltipHtml, type TooltipRow } from '../tooltip';
import type { BarChartProps, ChartLegendItem } from '../types';
import {
  TOOLTIP_BASE,
  alignSeries,
  ariaOption,
  changeWord,
  GRID,
  NO_LEGEND,
  seriesLegend,
  signed,
  type ChartOption,
} from './common';

export const BAR_MAX_WIDTH = 24;
export const BAR_RADIUS = 4;
/** Surface gap between stacked segments. */
export const STACK_GAP = 2;

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

/** Legend entries: one per series when there are two or more (none for gain/loss colouring). */
export function barLegend(p: BarChartProps): ChartLegendItem[] {
  if (p.signColors) return [];
  return seriesLegend(
    p.series.map((s) => s.name),
    p.series.map((s, i) => resolveSeriesColor(i, s.color)),
    'swatch',
  );
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
  const axisFormat = p.axisFormatter ?? format;
  const values = alignSeries(categories, series);
  const colors = series.map((s, i) => resolveSeriesColor(i, s.color));
  const isStacked = stacked && series.length > 1;
  const ends = isStacked ? stackEnds(values) : null;

  const barSeries: BarSeriesOption[] = series.map((s, si) => ({
    type: 'bar',
    name: s.name,
    stack: isStacked ? 'total' : undefined,
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

  const option: ChartOption = {
    aria: ariaOption(ariaLabel),
    color: colors,
    legend: NO_LEGEND,
    grid: GRID,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'item',
      formatter: (params: unknown) => {
        const at = readParamIndex(params);
        const s = at ? series[at.seriesIndex] : undefined;
        const v = at ? values[at.seriesIndex]?.[at.dataIndex] : null;
        if (!at || !s || v === null || v === undefined) return '';
        const row: TooltipRow = signColors
          ? {
              name: s.name,
              value: signed(format, v),
              color: v >= 0 ? CHART_GAIN : CHART_LOSS,
              note: changeWord(v),
            }
          : { name: s.name, value: format(v), color: colors[at.seriesIndex] ?? COLORS.textMuted };
        const total = isStacked
          ? {
              name: 'Total',
              value: format(values.reduce((sum, r) => sum + (r[at.dataIndex] ?? 0), 0)),
            }
          : undefined;
        return tooltipHtml({ title: categories[at.dataIndex], rows: [row], total });
      },
    },
    series: barSeries,
  };
  return option;
}
