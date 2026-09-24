// Line and area option builders (pure). 2px lines with round joins; markers (8px, 2px surface
// ring) appear on hover; area fills are a wash of the series hue. The tooltip is a crosshair
// that lists every series at the hovered category.
import type { LineSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { formatChartNumber } from '../format';
import { AREA_OPACITY, resolveSeriesColor } from '../palette';
import { readParamIndex, tooltipHtml, type TooltipRow } from '../tooltip';
import type { AreaChartProps, ChartLegendItem, LineChartProps } from '../types';
import {
  MARKER_RING,
  TOOLTIP_BASE,
  alignSeries,
  ariaOption,
  GRID,
  NO_LEGEND,
  seriesLegend,
  type ChartOption,
} from './common';

export const LINE_WIDTH = 2;
export const MARKER_SIZE = 8;

/** Legend entries (line keys) when there are two or more series. Also used by AreaChart. */
export function lineLegend(p: LineChartProps): ChartLegendItem[] {
  return seriesLegend(
    p.series.map((s) => s.name),
    p.series.map((s, i) => resolveSeriesColor(i, s.color)),
    'line',
  );
}

interface LineMode {
  area: boolean;
  stacked: boolean;
}

function buildLineOption(p: LineChartProps, mode: LineMode): EChartsCoreOption {
  const { ariaLabel, categories, series } = p;
  const format = p.valueFormatter ?? formatChartNumber;
  const axisFormat = p.axisFormatter ?? format;
  const values = alignSeries(categories, series);
  const colors = series.map((s, i) => resolveSeriesColor(i, s.color));
  const isStacked = mode.stacked && series.length > 1;

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
      lineStyle: { color, width: LINE_WIDTH, cap: 'round', join: 'round' },
      itemStyle: { color, ...MARKER_RING },
      areaStyle: mode.area ? { color, opacity: AREA_OPACITY } : undefined,
      emphasis: { focus: 'none', lineStyle: { width: LINE_WIDTH } },
    };
  });

  const option: ChartOption = {
    aria: ariaOption(ariaLabel),
    color: colors,
    legend: NO_LEGEND,
    grid: GRID,
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => axisFormat(v), hideOverlap: true },
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
        return tooltipHtml({ title: categories[at.dataIndex], rows, total });
      },
    },
    series: lineSeries,
  };
  return option;
}

export function lineOption(p: LineChartProps): EChartsCoreOption {
  return buildLineOption(p, { area: false, stacked: false });
}

export function areaOption(p: AreaChartProps): EChartsCoreOption {
  return buildLineOption(p, { area: true, stacked: p.stacked ?? false });
}
