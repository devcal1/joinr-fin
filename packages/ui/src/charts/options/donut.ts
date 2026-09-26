// Donut option builder (pure): an outer ring for the current split and a thin inner ring for the
// target, both in the same palette order so colour follows the entity. Slices are separated by a
// small pad angle (the surface gap). At most six slices (or `maxSegments`, Stage 5); the rest fold
// into "Other". A datum may carry its own colour (Stage 5), so an entity keeps its colour.
import type { PieSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { formatPercent } from '../../core';
import { formatChartNumber } from '../format';
import {
  CHART_OTHER,
  CHART_PALETTE,
  DONUT_MAX_SEGMENTS,
  isSafeColor,
  seriesColor,
} from '../palette';
import { readParamIndex, tooltipHtml, type TooltipRow } from '../tooltip';
import type { ChartLegendItem, Datum, DonutChartProps } from '../types';
import { NO_LEGEND, TOOLTIP_BASE, ariaOption, finiteOrNull, type ChartOption } from './common';

export const OTHER_LABEL = 'Other';

/** Ring geometry, as fractions of the chart's shorter side / 2. */
export const DONUT_RINGS = {
  current: ['60%', '80%'],
  target: ['49%', '53%'],
} as const;

/** Pie centre in the container. The DonutChart overlay uses the same point for its centre label. */
export const DONUT_CENTER: [string, string] = ['50%', '50%'];

export interface DonutSlice {
  label: string;
  /** Current value (null when the label only has a target). */
  value: number | null;
  /** Target value (null when no target was given for it). */
  target: number | null;
  color: string;
}

function sumByLabel(items: readonly Datum[] | undefined): Map<string, number> {
  const sums = new Map<string, number>();
  for (const item of items ?? []) {
    const v = finiteOrNull(item.value);
    if (v !== null) sums.set(item.label, (sums.get(item.label) ?? 0) + v);
  }
  return sums;
}

/** The slice limit: DONUT_MAX_SEGMENTS by default, clamped to 1…CHART_PALETTE.length. */
export function donutMaxSegments(maxSegments?: number): number {
  if (maxSegments === undefined || !Number.isFinite(maxSegments)) return DONUT_MAX_SEGMENTS;
  return Math.min(CHART_PALETTE.length, Math.max(1, Math.floor(maxSegments)));
}

/** The first safe colour a label carries in the data (current first), or undefined. */
function colorByLabel(items: readonly Datum[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const item of items) {
    if (item.color && isSafeColor(item.color) && !colors.has(item.label)) {
      colors.set(item.label, item.color.trim());
    }
  }
  return colors;
}

/**
 * Merges current and target by label, keeping first-seen order (current first, then target-only
 * labels), assigns palette slots in that order (a datum's own colour wins), and folds everything
 * past the `maxSegments`-th slice (default six) into "Other".
 */
export function donutSlices(
  data: readonly Datum[],
  target?: readonly Datum[],
  maxSegments?: number,
): DonutSlice[] {
  const limit = donutMaxSegments(maxSegments);
  const own = colorByLabel([...data, ...(target ?? [])]);
  const current = sumByLabel(data);
  const goal = target ? sumByLabel(target) : null;
  const labels: string[] = [];
  for (const item of [...data, ...(target ?? [])]) {
    if (!labels.includes(item.label)) labels.push(item.label);
  }
  const fold = labels.length > limit;
  const kept = fold ? labels.slice(0, limit - 1) : labels;
  const slices: DonutSlice[] = kept.map((label, i) => ({
    label,
    value: current.get(label) ?? null,
    target: goal?.get(label) ?? null,
    color: own.get(label) ?? seriesColor(i),
  }));
  if (fold) {
    const rest = labels.slice(limit - 1);
    const sum = (map: Map<string, number> | null): number | null => {
      const present = rest.filter((label) => map?.has(label));
      return present.length ? present.reduce((s, label) => s + (map?.get(label) ?? 0), 0) : null;
    };
    slices.push({ label: OTHER_LABEL, value: sum(current), target: sum(goal), color: CHART_OTHER });
  }
  return slices;
}

/** True when the current ring has something to draw. */
export function hasDonutData(data: readonly Datum[]): boolean {
  return data.some((d) => (finiteOrNull(d.value) ?? 0) > 0);
}

/** Legend entries: one swatch per slice (after folding), when there are two or more. */
export function donutLegend(
  p: Pick<DonutChartProps, 'data' | 'target' | 'maxSegments'>,
): ChartLegendItem[] {
  const slices = donutSlices(p.data, p.target, p.maxSegments);
  if (slices.length < 2) return [];
  return slices.map((s) => ({ name: s.label, color: s.color, key: 'swatch' }));
}

export function donutOption(p: DonutChartProps): EChartsCoreOption {
  const { ariaLabel, data, target } = p;
  const format = p.valueFormatter ?? formatChartNumber;
  const slices = donutSlices(data, target, p.maxSegments);
  const currentSlices = slices.filter((s) => (s.value ?? 0) > 0);
  const targetSlices = target ? slices.filter((s) => (s.target ?? 0) > 0) : [];
  const currentTotal = currentSlices.reduce((sum, s) => sum + (s.value ?? 0), 0);
  const targetTotal = targetSlices.reduce((sum, s) => sum + (s.target ?? 0), 0);

  const ring = (
    name: string,
    radius: readonly [string, string],
    items: DonutSlice[],
    pick: (s: DonutSlice) => number,
  ): PieSeriesOption => ({
    type: 'pie',
    name,
    radius: [...radius],
    center: DONUT_CENTER,
    startAngle: 90,
    clockwise: true,
    padAngle: items.length > 1 ? 1 : 0,
    minAngle: 2,
    avoidLabelOverlap: false,
    label: { show: false },
    labelLine: { show: false },
    itemStyle: { borderRadius: 2 },
    // Hover grows the slice but keeps its slot colour ('inherit' stops ECharts lightening it).
    emphasis: {
      scale: true,
      scaleSize: 3,
      label: { show: false },
      itemStyle: { color: 'inherit' },
    },
    data: items.map((s) => ({ name: s.label, value: pick(s), itemStyle: { color: s.color } })),
  });

  const series: PieSeriesOption[] = [
    ring('Current', DONUT_RINGS.current, currentSlices, (s) => s.value ?? 0),
  ];
  if (targetSlices.length) {
    series.push(ring('Target', DONUT_RINGS.target, targetSlices, (s) => s.target ?? 0));
  }

  const share = (v: number | null, total: number): string | undefined =>
    v !== null && total > 0 ? formatPercent(v / total) : undefined;

  const option: ChartOption = {
    aria: ariaOption(ariaLabel),
    color: slices.map((s) => s.color),
    legend: NO_LEGEND,
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'item',
      formatter: (params: unknown) => {
        const at = readParamIndex(params);
        if (!at) return '';
        const slice = (at.seriesIndex === 1 ? targetSlices : currentSlices)[at.dataIndex];
        if (!slice) return '';
        const rows: TooltipRow[] = [];
        if (slice.value !== null) {
          rows.push({
            name: 'Current',
            value: format(slice.value),
            color: slice.color,
            note: share(slice.value, currentTotal),
          });
        }
        if (target && slice.target !== null) {
          rows.push({
            name: 'Target',
            value: format(slice.target),
            color: slice.color,
            note: share(slice.target, targetTotal),
          });
        }
        return tooltipHtml({ title: slice.label, rows });
      },
    },
    series,
  };
  return option;
}
