// Public chart types (stage-0 plan §7.6). Values are plain numbers: callers convert cents to
// dollars before charting and pass a formatMoney-based ValueFormatter for display.
import type { ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts/core';

/** Formats one chart value for tooltips and axis labels. */
export type ValueFormatter = (v: number) => string;

/** One slice or bar: a label and its value. */
export interface Datum {
  label: string;
  value: number;
  /**
   * Stage 5 (additive): the slice's own colour, so an entity keeps its colour whatever else is
   * drawn (a hex or rgb(a) colour; anything else falls back to the palette slot).
   */
  color?: string;
}

/** One named series over the chart's categories. `null` is a gap (missing value). */
export interface Series {
  name: string;
  data: (number | null)[];
  /** Overrides the palette slot. Must be a hex or rgb(a) colour; anything else falls back to "Other". */
  color?: string;
}

/** Shared optional state props (additions to the frozen contract, all optional). */
export interface ChartStateProps {
  /** Data is loading. With no data yet a loading placeholder shows; with data the chart dims. */
  loading?: boolean;
  /** Shown instead of the plot when there is nothing to chart. */
  emptyMessage?: ReactNode;
}

/** One legend entry, drawn as HTML above the plot. */
export interface ChartLegendItem {
  name: string;
  color: string;
  /**
   * 'line' = a short stroke (lines, areas); 'swatch' = a small square (bars, slices);
   * 'dashed-line' = a dashed stroke (a reference line such as a trend; Stage 5, additive).
   */
  key: 'line' | 'swatch' | 'dashed-line';
}

export interface EChartProps extends ChartStateProps {
  option: EChartsCoreOption;
  /** Accessible name of the chart image; also passed to ECharts' aria description. */
  ariaLabel: string;
  /** Plot height in px, including the axis labels (the legend sits above it). Default 280. */
  height?: number;
  className?: string;
  /** Nothing to plot: shows the empty state instead of the chart. */
  empty?: boolean;
  /** Legend entries shown above the plot (needed whenever there are two or more series). */
  legend?: ChartLegendItem[];
  /** HTML overlay drawn over the plot (centre labels). Never intercepts the pointer. */
  children?: ReactNode;
}

export interface DonutChartProps extends ChartStateProps {
  ariaLabel: string;
  /** Current values: the outer ring. Order sets the palette slot; pass largest first. */
  data: Datum[];
  /** Target values: the thin inner ring, matched to `data` by label. */
  target?: Datum[];
  valueFormatter?: ValueFormatter;
  /**
   * The most slices drawn before the rest fold into "Other" (Stage 5, additive). Default
   * DONUT_MAX_SEGMENTS (6); clamped to CHART_PALETTE.length (8).
   */
  maxSegments?: number;
  /** Small uppercase label in the hole, e.g. "Total". */
  centerLabel?: string;
  /** Figure in the hole, e.g. "$12,480". */
  centerValue?: string;
  height?: number;
}

/** A line drawn over a bar chart's bars (Stage 5, additive): a rate or a trend. */
export interface BarOverlay {
  name: string;
  /** Aligned to the chart's categories; null is a gap. */
  values: (number | null)[];
  /** 'secondary' draws it against a right-hand axis (`secondaryAxisFormatter`). Default 'value'. */
  axis?: 'value' | 'secondary';
  /** A 2px dashed line (a reference line such as a trend); its legend key is dashed. */
  dashed?: boolean;
  /** A hex or rgb(a) colour; default the next palette slot after the bars. */
  color?: string;
}

export interface BarChartProps extends ChartStateProps {
  ariaLabel: string;
  categories: string[];
  series: Series[];
  stacked?: boolean;
  /** Bars run left to right, categories top to bottom. */
  horizontal?: boolean;
  /** Colour each bar by its sign (gain `--go`, loss `--stop`). Meant for a single series. */
  signColors?: boolean;
  valueFormatter?: ValueFormatter;
  /** Value-axis tick formatter. Defaults to `valueFormatter`. */
  axisFormatter?: ValueFormatter;
  height?: number;
  /** Lines drawn over the bars (Stage 5, additive). */
  overlays?: BarOverlay[];
  /**
   * The right-hand axis's formatter (its ticks and the overlay's tooltip value), used only when an
   * overlay asks for the secondary axis (Stage 5, additive). Default: the value formatter.
   */
  secondaryAxisFormatter?: ValueFormatter;
  /** The name of a stacked chart's total in the tooltip (Stage 5, additive). Default "Total". */
  totalLabel?: string;
}

export interface LineChartProps extends ChartStateProps {
  ariaLabel: string;
  categories: string[];
  series: Series[];
  valueFormatter?: ValueFormatter;
  /** Value-axis tick formatter. Defaults to `valueFormatter`. */
  axisFormatter?: ValueFormatter;
  height?: number;
}

export interface AreaChartProps extends LineChartProps {
  stacked?: boolean;
}

export interface GaugeChartProps extends ChartStateProps {
  ariaLabel: string;
  /** A ratio (0.074 = 7.4%). Out-of-range values clamp the arc; the figure stays true. */
  value: number;
  /** Target ratio, drawn as a tick across the track. */
  target?: number;
  /** The target's words under the figure (default "Target"), e.g. "Budget plan". */
  targetLabel?: string;
  /** Uppercase caption under the figure, e.g. "Savings rate". */
  label?: string;
  /** Default: formatPercent (one decimal). */
  valueFormatter?: ValueFormatter;
  /** Arc range. Default 0..1. */
  min?: number;
  max?: number;
  height?: number;
}

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** The chart element (DonutChart, BarChart, …). */
  chart: ReactNode;
  /** The same numbers as a table (normally a ColumnTable). A chart never replaces the numbers. */
  table: ReactNode;
  defaultView?: 'chart' | 'table';
  actions?: ReactNode;
}
