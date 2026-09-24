// Component tests with ECharts mocked (jsdom has no layout): init, setOption, resize, dispose,
// accessibility, legends, states and the ChartCard toggle.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EChartsCoreOption } from 'echarts/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartCard } from './ChartCard';
import { AreaChart, BarChart, DonutChart, GaugeChart, LineChart } from './ChartComponents';
import { EChart, chartViewState, withRuntimeOptions } from './EChart';
import { CHART_PALETTE } from './palette';

const fake = vi.hoisted(() => {
  const chart = {
    setOption: vi.fn<(option: unknown, opts?: unknown) => void>(),
    resize: vi.fn(),
    dispose: vi.fn(),
    isDisposed: vi.fn(() => false),
  };
  return { chart, initChart: vi.fn((_dom: HTMLElement) => chart) };
});
vi.mock('./echarts', () => ({ initChart: fake.initChart }));

interface AppliedOption {
  animation: boolean;
  aria: { enabled: boolean; label: { description: string } };
  series: { type: string; name?: string }[];
}
function lastOption(): AppliedOption {
  const call = fake.chart.setOption.mock.calls.at(-1);
  if (!call) throw new Error('setOption was not called');
  return call[0] as AppliedOption;
}

const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];
const TWO = [
  { name: 'Net worth', data: [100, 110, 120] },
  { name: 'Invested', data: [60, 65, 70] },
];
const ONE = [{ name: 'Saved', data: [1240, 980, 1500] }];

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EChart', () => {
  const option: EChartsCoreOption = { series: [{ type: 'bar', data: [1] }] };

  it('initialises in its host, applies the option whole and disposes on unmount', () => {
    const { unmount } = render(<EChart option={option} ariaLabel="Example chart" height={200} />);
    const host = screen.getByRole('img', { name: 'Example chart' });
    expect(fake.initChart).toHaveBeenCalledWith(host);
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1);
    expect(fake.chart.setOption.mock.calls[0]?.[1]).toEqual({ notMerge: true });
    expect(lastOption().aria).toMatchObject({
      enabled: true,
      label: { enabled: true, description: 'Example chart' },
    });
    expect(host.parentElement).toHaveStyle({ height: '200px' });
    unmount();
    expect(fake.chart.dispose).toHaveBeenCalledTimes(1);
  });

  it('re-applies only when the option changes', () => {
    const { rerender } = render(<EChart option={option} ariaLabel="x" />);
    rerender(<EChart option={option} ariaLabel="x" />);
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1);
    rerender(<EChart option={{ series: [] }} ariaLabel="x" />);
    expect(fake.chart.setOption).toHaveBeenCalledTimes(2);
  });

  it('resizes with its container through ResizeObserver', () => {
    let notify: () => void = () => undefined;
    class Observer {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    render(<EChart option={option} ariaLabel="x" />);
    act(() => notify());
    expect(fake.chart.resize).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state instead of the plot', () => {
    render(<EChart option={option} ariaLabel="x" empty emptyMessage="Add a holding first." />);
    expect(screen.getByText('Add a holding first.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'x' })).not.toBeInTheDocument(); // aria-hidden
  });

  it('shows a status while loading with no data, and dims a refresh', () => {
    const { container, rerender } = render(<EChart option={option} ariaLabel="x" empty loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart…');
    rerender(<EChart option={option} ariaLabel="x" loading />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('data-state', 'refreshing');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the legend as a list above the plot', () => {
    render(
      <EChart
        option={option}
        ariaLabel="x"
        legend={[
          { name: 'Salary', color: '#07AE8B', key: 'swatch' },
          { name: 'Dividends', color: '#7744DD', key: 'swatch' },
        ]}
      />,
    );
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Salary', 'Dividends']);
  });
});

describe('runtime helpers', () => {
  it('maps empty/loading to a view state', () => {
    expect(chartViewState(false, false)).toBe('ready');
    expect(chartViewState(false, true)).toBe('refreshing');
    expect(chartViewState(true, true)).toBe('loading');
    expect(chartViewState(true, false)).toBe('empty');
  });

  it('turns animation off for reduced motion', () => {
    expect(withRuntimeOptions({}, 'x', true).animation).toBe(false);
    expect(withRuntimeOptions({}, 'x', false).animation).toBe(true);
    expect(withRuntimeOptions({ animation: false }, 'x', false).animation).toBe(false);
  });

  it('respects prefers-reduced-motion in the component', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<EChart option={{ series: [] }} ariaLabel="x" />);
    expect(lastOption().animation).toBe(false);
  });
});

describe('chart components', () => {
  it('DonutChart: rings, legend and centre figure', () => {
    render(
      <DonutChart
        ariaLabel="Allocation"
        data={[
          { label: 'Australian shares', value: 5200 },
          { label: 'Cash', value: 1400 },
        ]}
        target={[
          { label: 'Australian shares', value: 5000 },
          { label: 'Cash', value: 1600 },
        ]}
        centerValue="$6,600"
        centerLabel="Total"
      />,
    );
    expect(screen.getByRole('img', { name: 'Allocation' })).toBeInTheDocument();
    expect(lastOption().series.map((s) => s.name)).toEqual(['Current', 'Target']);
    expect(screen.getByText('$6,600')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('DonutChart: empty data shows the empty state', () => {
    render(<DonutChart ariaLabel="Allocation" data={[]} />);
    expect(screen.getByText('Nothing to chart yet.')).toBeInTheDocument();
  });

  it('BarChart: one series has no legend; several do', () => {
    const { rerender } = render(<BarChart ariaLabel="Savings" categories={MONTHS} series={ONE} />);
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
    expect(lastOption().series[0]?.type).toBe('bar');
    rerender(<BarChart ariaLabel="Savings" categories={MONTHS} series={TWO} stacked />);
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument();
  });

  it('LineChart and AreaChart: line series with a line-keyed legend', () => {
    const { container, unmount } = render(
      <LineChart ariaLabel="Net worth" categories={MONTHS} series={TWO} />,
    );
    expect(lastOption().series.map((s) => s.type)).toEqual(['line', 'line']);
    const key = container.querySelector('.jf-chart__legend-key--line');
    expect(key).toHaveStyle({ backgroundColor: CHART_PALETTE[0] });
    unmount();
    render(<AreaChart ariaLabel="Holdings" categories={MONTHS} series={TWO} stacked />);
    expect(screen.getByRole('img', { name: 'Holdings' })).toBeInTheDocument();
  });

  it('LineChart: no data at all is empty', () => {
    render(<LineChart ariaLabel="x" categories={MONTHS} series={[]} />);
    expect(screen.getByText('Nothing to chart yet.')).toBeInTheDocument();
  });

  it('GaugeChart: shows the true figure even when the arc clamps', () => {
    render(
      <GaugeChart ariaLabel="Savings rate" value={-0.021} target={0.2} label="Savings rate" />,
    );
    expect(screen.getByText('−2.1%')).toBeInTheDocument();
    expect(screen.getByText('Savings rate')).toBeInTheDocument();
    expect(screen.getByText('Target 20.0%')).toBeInTheDocument();
  });

  it('GaugeChart: a non-finite value is empty', () => {
    render(<GaugeChart ariaLabel="x" value={Number.NaN} />);
    expect(screen.getByText('Nothing to chart yet.')).toBeInTheDocument();
  });
});

describe('ChartCard', () => {
  it('toggles between the chart and its table with pressed buttons', async () => {
    const user = userEvent.setup();
    render(
      <ChartCard
        title="Monthly savings"
        subtitle="Jan–Jun 2026"
        chart={<div>the chart</div>}
        table={
          <table>
            <caption>Monthly savings</caption>
          </table>
        }
      />,
    );
    const region = screen.getByRole('region', { name: 'Monthly savings' });
    const group = within(region).getByRole('group', { name: 'Monthly savings: view as' });
    const chartButton = within(group).getByRole('button', { name: 'Chart' });
    const tableButton = within(group).getByRole('button', { name: 'Table' });
    expect(chartButton).toHaveAttribute('aria-pressed', 'true');
    expect(tableButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('the chart')).toBeInTheDocument();

    await user.click(tableButton);
    expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table', { name: 'Monthly savings' })).toBeInTheDocument();
    expect(screen.queryByText('the chart')).not.toBeInTheDocument();
    expect(tableButton).toHaveAttribute('aria-controls', expect.any(String) as string);

    // Keyboard: Tab to Chart, Enter.
    chartButton.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('the chart')).toBeInTheDocument();
  });

  it('can open on the table view and keeps caller actions', () => {
    render(
      <ChartCard
        title="Allocation"
        chart={<div>chart</div>}
        table={<p>numbers</p>}
        defaultView="table"
        actions={<button type="button">Export</button>}
      />,
    );
    expect(screen.getByText('numbers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});
