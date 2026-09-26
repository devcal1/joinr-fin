// Stage 5 chart props in the components (stage-5.md §6.1), with ECharts mocked as in
// components.test.tsx: the bar overlays and their dashed legend key, and the eight-slice donut.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarChart, DonutChart, GaugeChart } from './ChartComponents';
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

function lastSeriesTypes(): string[] {
  const call = fake.chart.setOption.mock.calls.at(-1);
  if (!call) throw new Error('setOption was not called');
  return (call[0] as { series: { type: string }[] }).series.map((s) => s.type);
}

const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Stage 5 chart props', () => {
  it('BarChart: overlays are drawn and keyed in the legend, dashed for a trend', () => {
    const { container } = render(
      <BarChart
        ariaLabel="Liquid assets"
        categories={MONTHS}
        series={[{ name: 'Liquid assets', data: [1240, 980, 1500] }]}
        overlays={[{ name: 'Trend', values: [1000, 1100, 1200], dashed: true }]}
      />,
    );
    expect(lastSeriesTypes()).toEqual(['bar', 'line']);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Trend');
    expect(container.querySelector('.jf-chart__legend-key--dashed-line')).not.toBeNull();
  });

  it('DonutChart: maxSegments 8 draws eight slices with their own colours', () => {
    const data = CHART_PALETTE.map((color, i) => ({ label: `Class ${i + 1}`, value: 10, color }));
    render(<DonutChart ariaLabel="Distribution" data={data} maxSegments={8} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(8);
    expect(items.map((li) => li.textContent)).not.toContain('Other');
  });
});

describe('GaugeChart targetLabel (Fixer round 1, STYLE-5)', () => {
  it('defaults to "Target"; a label replaces the word, one decimal either way', () => {
    const { unmount } = render(<GaugeChart ariaLabel="Rate" value={0.28} target={0.3} />);
    expect(screen.getByText('Target 30.0%')).toBeInTheDocument();
    unmount();
    render(<GaugeChart ariaLabel="Rate" value={0.28} target={0.3} targetLabel="Budget plan" />);
    expect(screen.getByText('Budget plan 30.0%')).toBeInTheDocument();
    expect(screen.queryByText(/^Target /)).not.toBeInTheDocument();
  });
});
