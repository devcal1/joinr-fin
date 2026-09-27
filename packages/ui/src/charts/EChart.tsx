// The ECharts wrapper: initialises an SVG chart in an effect, applies the option (replacing the
// previous one), follows the container's size and disposes on unmount. It also owns the legend
// and the empty, loading and refreshing states, so every chart handles them the same way.
import type { EChartsCoreOption } from 'echarts/core';
import { ChartNoAxesColumn } from 'lucide-react';
import { useEffect, useRef, type JSX } from 'react';
import { Icon } from '../core';
import { initChart, type EChartsType } from './echarts';
import { usePrefersReducedMotion } from './hooks';
import type { ChartLegendItem, EChartProps } from './types';

export const DEFAULT_CHART_HEIGHT = 240;
export const DEFAULT_EMPTY_MESSAGE = 'Nothing to chart yet.';

export type ChartViewState = 'ready' | 'refreshing' | 'loading' | 'empty';

/** loading + no data → placeholder; loading + data → dimmed chart (no layout jump). */
export function chartViewState(empty: boolean, loading: boolean): ChartViewState {
  if (empty) return loading ? 'loading' : 'empty';
  return loading ? 'refreshing' : 'ready';
}

/** Adds what every chart needs at runtime: its aria description and the motion preference. */
export function withRuntimeOptions(
  option: EChartsCoreOption,
  ariaLabel: string,
  reducedMotion: boolean,
): EChartsCoreOption {
  const aria = (option.aria ?? {}) as Record<string, unknown>;
  const animation: boolean | undefined = option.animation;
  return {
    ...option,
    animation: reducedMotion ? false : (animation ?? true),
    aria: { ...aria, enabled: true, label: { enabled: true, description: ariaLabel } },
  };
}

function joinClasses(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** The legend, as HTML above the plot: it wraps on a phone and screen readers can read it. */
function ChartLegend({ items }: { items: ChartLegendItem[] }): JSX.Element {
  return (
    <ul className="jf-chart__legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.name} className="jf-chart__legend-item">
          <span
            className={`jf-chart__legend-key jf-chart__legend-key--${item.key}`}
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export function EChart({
  option,
  ariaLabel,
  height = DEFAULT_CHART_HEIGHT,
  className,
  loading = false,
  empty = false,
  emptyMessage,
  legend,
  children,
}: EChartProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const state = chartViewState(empty, loading);
  const plotted = state === 'ready' || state === 'refreshing';

  // Create once; follow the container size; dispose on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const chart = initChart(host);
    chartRef.current = chart;
    let frame = 0;
    const resize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!chart.isDisposed()) chart.resize();
      });
    };
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    } else {
      window.addEventListener('resize', resize);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Replace the whole option whenever it changes (builders return complete options).
  useEffect(() => {
    chartRef.current?.setOption(withRuntimeOptions(option, ariaLabel, reducedMotion), {
      notMerge: true,
    });
  }, [option, ariaLabel, reducedMotion]);

  return (
    <div
      className={joinClasses('jf-chart', `jf-chart--${state}`, className)}
      data-state={state}
      aria-busy={loading || undefined}
    >
      {plotted && legend && legend.length > 0 ? <ChartLegend items={legend} /> : null}
      <div className="jf-chart__plot" style={{ height }}>
        <div
          ref={hostRef}
          className="jf-chart__host"
          role="img"
          aria-label={ariaLabel}
          aria-hidden={plotted ? undefined : true}
        />
        {plotted && children ? <div className="jf-chart__overlay">{children}</div> : null}
        {state === 'loading' ? (
          <div className="jf-chart__state" role="status">
            <span className="jf-chart__spinner" aria-hidden="true" />
            <span>Loading chart…</span>
          </div>
        ) : null}
        {state === 'empty' ? (
          <div className="jf-chart__state">
            <Icon icon={ChartNoAxesColumn} size={20} className="jf-chart__state-icon" />
            <p className="jf-chart__state-text">{emptyMessage ?? DEFAULT_EMPTY_MESSAGE}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
