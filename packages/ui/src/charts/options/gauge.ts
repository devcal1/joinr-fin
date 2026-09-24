// Gauge option builder (pure): a ratio on a 240° arc. The fill is teal on a track of the same hue;
// the target is a bright tick across the track. Values outside min..max clamp the arc, but the
// figure (drawn as HTML by GaugeChart) always shows the true value.
import type { GaugeSeriesOption } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import { COLORS } from '../../core';
import { CHART_PALETTE, withAlpha } from '../palette';
import type { GaugeChartProps } from '../types';
import { ariaOption, finiteOrNull, type ChartOption } from './common';

/** Gauge centre in the container; GaugeChart centres its figure on the same point. */
export const GAUGE_CENTER: [string, string] = ['50%', '56%'];
export const GAUGE_ARC = { startAngle: 210, endAngle: -30 } as const;
export const GAUGE_WIDTH = 14;
/** The target tick overhangs the track by this much on each side. */
const TARGET_OVERHANG = 4;
/** Half the target tick's length along the arc, as a fraction of the arc. */
const TARGET_HALF_SPAN = 0.004;
/** Track: the fill's hue at 16% (the same ramp, like a status badge fill). */
const TRACK_ALPHA = 0.16;

export interface GaugeRange {
  min: number;
  max: number;
}

/** A usable min..max: defaults 0..1, and max always above min. */
export function gaugeRange(p: Pick<GaugeChartProps, 'min' | 'max'>): GaugeRange {
  const min = finiteOrNull(p.min) ?? 0;
  const max = finiteOrNull(p.max) ?? 1;
  return max > min ? { min, max } : { min, max: min + 1 };
}

/** Clamps a value into the range; non-finite values sit at min. */
export function clampToRange(value: number, { min, max }: GaugeRange): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** axisLine colour stops that draw a short bright tick at `fraction` of the arc. */
export function targetStops(fraction: number): [number, string][] {
  const f = Math.min(1, Math.max(0, fraction));
  const from = f - TARGET_HALF_SPAN;
  const to = f + TARGET_HALF_SPAN;
  const stops: [number, string][] = [];
  if (from > 0) stops.push([from, 'transparent']);
  stops.push([Math.min(1, to), COLORS.textBright]);
  if (to < 1) stops.push([1, 'transparent']);
  return stops;
}

const hidden = {
  pointer: { show: false },
  anchor: { show: false },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { show: false },
  title: { show: false },
  detail: { show: false },
} as const;

export function gaugeOption(p: GaugeChartProps): EChartsCoreOption {
  const range = gaugeRange(p);
  const value = clampToRange(p.value, range);
  const fill = CHART_PALETTE[0] ?? COLORS.teal;
  const common = {
    type: 'gauge' as const,
    ...GAUGE_ARC,
    min: range.min,
    max: range.max,
    center: GAUGE_CENTER,
    radius: '86%',
    silent: true,
    ...hidden,
  };

  const series: GaugeSeriesOption[] = [
    {
      ...common,
      name: p.label ?? 'Value',
      progress: {
        show: value > range.min,
        width: GAUGE_WIDTH,
        roundCap: true,
        itemStyle: { color: fill },
      },
      axisLine: {
        roundCap: true,
        lineStyle: { width: GAUGE_WIDTH, color: [[1, withAlpha(fill, TRACK_ALPHA)]] },
      },
      data: [{ value, name: p.label ?? '' }],
      z: 2,
    },
  ];

  const target = finiteOrNull(p.target);
  if (target !== null) {
    const fraction = (clampToRange(target, range) - range.min) / (range.max - range.min);
    series.push({
      ...common,
      name: 'Target',
      progress: { show: false },
      axisLine: {
        roundCap: false,
        lineStyle: { width: GAUGE_WIDTH + TARGET_OVERHANG * 2, color: targetStops(fraction) },
      },
      data: [{ value: clampToRange(target, range), name: 'Target' }],
      z: 3,
    });
  }

  const option: ChartOption = {
    aria: ariaOption(p.ariaLabel),
    tooltip: { show: false },
    series,
  };
  return option;
}
