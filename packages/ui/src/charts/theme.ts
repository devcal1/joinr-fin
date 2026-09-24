// The 'joinr' ECharts theme (STYLE_GUIDE §6): transparent ground, Arial, hairline axes and grid,
// 11px secondary axis labels, tooltips on --raised with a hairline border, no shadows, no 3-D.
import { COLORS, FONT_MONO, FONT_SANS } from '../core';
import { CHART_PALETTE } from './palette';

export const CHART_THEME_NAME = 'joinr';

/** Axis-label and legend text size (STYLE_GUIDE §2 small label). */
export const CHART_LABEL_SIZE = 11;

const axisLabel = {
  color: COLORS.textSecondary,
  fontSize: CHART_LABEL_SIZE,
  fontFamily: FONT_SANS,
};
const hairline = { color: COLORS.hairline, width: 1, type: 'solid' } as const;

const categoryAxis = {
  axisLine: { show: true, lineStyle: hairline },
  axisTick: { show: false },
  axisLabel: { ...axisLabel, margin: 10 },
  splitLine: { show: false },
  splitArea: { show: false },
};

const valueAxis = {
  axisLine: { show: false, lineStyle: hairline },
  axisTick: { show: false },
  // Numbers on axes are monospaced and tabular (STYLE_GUIDE §2).
  axisLabel: { ...axisLabel, fontFamily: FONT_MONO, margin: 10 },
  splitLine: { show: true, lineStyle: hairline },
  splitArea: { show: false },
};

/** Registered as 'joinr' by `initChart`. Built only from COLORS and CHART_PALETTE. */
export const JOINR_CHART_THEME: Record<string, unknown> = {
  color: [...CHART_PALETTE],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT_SANS, color: COLORS.text, fontSize: CHART_LABEL_SIZE },
  animationDuration: 450,
  animationDurationUpdate: 300,
  animationEasing: 'cubicOut',
  legend: {
    textStyle: { color: COLORS.text, fontSize: CHART_LABEL_SIZE, fontFamily: FONT_SANS },
    inactiveColor: COLORS.textMuted,
    pageTextStyle: { color: COLORS.textSecondary, fontFamily: FONT_MONO },
    pageIconColor: COLORS.teal,
    pageIconInactiveColor: COLORS.textMuted,
  },
  tooltip: {
    backgroundColor: COLORS.raised,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: 5,
    padding: [8, 12],
    textStyle: { color: COLORS.text, fontFamily: FONT_SANS, fontSize: 12 },
    extraCssText: 'box-shadow: none;',
    axisPointer: {
      lineStyle: { color: COLORS.textMuted, width: 1, type: 'solid' },
      crossStyle: { color: COLORS.textMuted, width: 1, type: 'solid' },
    },
  },
  categoryAxis,
  valueAxis,
  line: { symbol: 'circle', symbolSize: 8, smooth: false, lineStyle: { width: 2 } },
  bar: { barMaxWidth: 24 },
  gauge: {
    title: { color: COLORS.textSecondary },
    detail: { color: COLORS.textBright, fontFamily: FONT_MONO },
  },
};
