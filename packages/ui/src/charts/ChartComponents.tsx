// The chart components: each builds its option (and legend) with pure builders and renders them
// with EChart. Pass stable data (memoised or module-level) and formatters so a chart only redraws
// when its inputs change.
import { useMemo, type JSX } from 'react';
import { EChart } from './EChart';
import { percentFormatter } from './format';
import { hasSeriesData } from './options/common';
import { barLegend, barOption } from './options/bar';
import { DONUT_CENTER, donutLegend, donutOption, hasDonutData } from './options/donut';
import { GAUGE_CENTER, gaugeOption } from './options/gauge';
import { areaOption, lineLegend, lineOption } from './options/line';
import type {
  AreaChartProps,
  BarChartProps,
  DonutChartProps,
  GaugeChartProps,
  LineChartProps,
} from './types';

/** Allocation: current (outer ring) against target (thin inner ring), with a centre figure. */
export function DonutChart({
  ariaLabel,
  data,
  target,
  valueFormatter,
  centerLabel,
  centerValue,
  height,
  loading,
  emptyMessage,
}: DonutChartProps): JSX.Element {
  const option = useMemo(
    () => donutOption({ ariaLabel, data, target, valueFormatter }),
    [ariaLabel, data, target, valueFormatter],
  );
  const legend = useMemo(() => donutLegend({ data, target }), [data, target]);
  const [left, top] = DONUT_CENTER;
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      height={height}
      loading={loading}
      empty={!hasDonutData(data)}
      emptyMessage={emptyMessage}
      legend={legend}
    >
      {centerValue || centerLabel ? (
        <div className="jf-chart__center" style={{ left, top }}>
          {centerValue ? <span className="jf-chart__center-value">{centerValue}</span> : null}
          {centerLabel ? <span className="jf-chart__center-label">{centerLabel}</span> : null}
        </div>
      ) : null}
    </EChart>
  );
}

/** Bars: plain, grouped, stacked, horizontal, or gain/loss coloured by sign. */
export function BarChart({
  ariaLabel,
  categories,
  series,
  stacked,
  horizontal,
  signColors,
  valueFormatter,
  axisFormatter,
  height,
  loading,
  emptyMessage,
}: BarChartProps): JSX.Element {
  const option = useMemo(
    () =>
      barOption({
        ariaLabel,
        categories,
        series,
        stacked,
        horizontal,
        signColors,
        valueFormatter,
        axisFormatter,
      }),
    [ariaLabel, categories, series, stacked, horizontal, signColors, valueFormatter, axisFormatter],
  );
  const legend = useMemo(
    () => barLegend({ ariaLabel, categories, series, signColors }),
    [ariaLabel, categories, series, signColors],
  );
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      height={height}
      loading={loading}
      empty={!hasSeriesData(categories, series)}
      emptyMessage={emptyMessage}
      legend={legend}
    />
  );
}

/** Lines over time. One series is teal with no legend (the card title names it). */
export function LineChart({
  ariaLabel,
  categories,
  series,
  valueFormatter,
  axisFormatter,
  height,
  loading,
  emptyMessage,
}: LineChartProps): JSX.Element {
  const option = useMemo(
    () => lineOption({ ariaLabel, categories, series, valueFormatter, axisFormatter }),
    [ariaLabel, categories, series, valueFormatter, axisFormatter],
  );
  const legend = useMemo(
    () => lineLegend({ ariaLabel, categories, series }),
    [ariaLabel, categories, series],
  );
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      height={height}
      loading={loading}
      empty={!hasSeriesData(categories, series)}
      emptyMessage={emptyMessage}
      legend={legend}
    />
  );
}

/** Lines with a soft fill; `stacked` stacks the series into bands. */
export function AreaChart({
  ariaLabel,
  categories,
  series,
  stacked,
  valueFormatter,
  axisFormatter,
  height,
  loading,
  emptyMessage,
}: AreaChartProps): JSX.Element {
  const option = useMemo(
    () => areaOption({ ariaLabel, categories, series, stacked, valueFormatter, axisFormatter }),
    [ariaLabel, categories, series, stacked, valueFormatter, axisFormatter],
  );
  const legend = useMemo(
    () => lineLegend({ ariaLabel, categories, series }),
    [ariaLabel, categories, series],
  );
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      height={height}
      loading={loading}
      empty={!hasSeriesData(categories, series)}
      emptyMessage={emptyMessage}
      legend={legend}
    />
  );
}

/** A ratio on an arc with the true figure in the middle, and an optional target tick. */
export function GaugeChart({
  ariaLabel,
  value,
  target,
  label,
  valueFormatter = percentFormatter,
  min,
  max,
  height,
  loading,
  emptyMessage,
}: GaugeChartProps): JSX.Element {
  const option = useMemo(
    () => gaugeOption({ ariaLabel, value, target, label, min, max }),
    [ariaLabel, value, target, label, min, max],
  );
  const [left, top] = GAUGE_CENTER;
  const hasTarget = typeof target === 'number' && Number.isFinite(target);
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      height={height}
      loading={loading}
      empty={!Number.isFinite(value)}
      emptyMessage={emptyMessage}
    >
      <div className="jf-chart__center" style={{ left, top }}>
        <span className="jf-chart__center-value jf-chart__center-value--large">
          {valueFormatter(value)}
        </span>
        {label ? <span className="jf-chart__center-label">{label}</span> : null}
        {hasTarget ? (
          <span className="jf-chart__center-note">
            <span className="jf-chart__target-key" aria-hidden="true" />
            Target {valueFormatter(target)}
          </span>
        ) : null}
      </div>
    </EChart>
  );
}
