// Stage 6 chart polish (web-polish-ui, stage-6.md §6.9 C, D): all-zero charts show the empty
// message (STYLE-5), money axes label adjacent ticks distinctly (`compactAxisFormatter`, used by
// the bar builder), and a ChartCard's table view lets its header labels wrap (STYLE-11).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUiCss } from '../core/testing/cssHarness';
import { ColumnTable } from '../core';
import { ChartCard } from './ChartCard';
import { AreaChart, BarChart, LineChart } from './ChartComponents';
import { DEFAULT_EMPTY_MESSAGE } from './EChart';
import { compactAxisFormatter, compactMoneyFormatter, moneyFormatter } from './format';
import { barOption, hasBarData } from './options/bar';
import { axisFormatterFor, valueExtent } from './options/common';

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

const MINUS = '−';
const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];
const ZEROS = [0, 0, 0];

beforeEach(() => {
  vi.clearAllMocks();
});

/** The tick labels an axis formatter writes for the ticks `from, from + step, …, to`. */
function ticks(format: (v: number) => string, from: number, to: number, step: number): string[] {
  const out: string[] = [];
  for (let i = 0; from + i * step <= to + step / 1e6; i += 1) {
    // Tick values as ECharts computes them: multiples of a float step (e.g. 0.30000000000000004).
    out.push(format(from + i * step));
  }
  return out;
}

function distinct(labels: readonly string[]): boolean {
  return new Set(labels).size === labels.length;
}

describe('compactAxisFormatter (STYLE-5)', () => {
  it('keeps adjacent ticks distinct on a $0–$4 axis (the plain compact formatter repeats them)', () => {
    const format = compactAxisFormatter([0, 4]);
    for (const step of [0.2, 0.5, 1]) {
      const labels = ticks(format, 0, 4, step);
      expect(distinct(labels), labels.join(' ')).toBe(true);
    }
    expect(ticks(format, 0, 2, 0.5)).toEqual(['$0', '$0.50', '$1.00', '$1.50', '$2.00']);
    // The regression: whole-dollar rounding reads $0.50 and $1.00 both as "$1" or "$0".
    expect(distinct(ticks(compactMoneyFormatter, 0, 4, 0.5))).toBe(false);
  });

  it('never writes one decimal of a dollar ("$0.5"), per STYLE_GUIDE §8', () => {
    const format = compactAxisFormatter([0, 3]);
    for (const label of ticks(format, 0, 3, 0.1)) {
      expect(label).not.toMatch(/\$\d[\d,]*\.\d(?!\d)/);
    }
  });

  it('adds a decimal in thousands when the step needs one', () => {
    const format = compactAxisFormatter([0, 2_000]);
    // ECharts' tick steps are 1, 2, 3 or 5 × 10ⁿ.
    expect(ticks(format, 0, 2_000, 200)).toEqual([
      '$0',
      '$200',
      '$400',
      '$600',
      '$800',
      '$1k',
      '$1.2k',
      '$1.4k',
      '$1.6k',
      '$1.8k',
      '$2k',
    ]);
    for (const step of [300, 500]) {
      expect(distinct(ticks(format, 0, 2_000, step))).toBe(true);
    }
    expect(distinct(ticks(compactAxisFormatter([0, 1_200]), 0, 1_200, 100))).toBe(true);
    expect(distinct(ticks(compactAxisFormatter([0, 1_200]), 0, 1_200, 200))).toBe(true);
  });

  it('matches the plain compact labels on wide axes', () => {
    const format = compactAxisFormatter([0, 1_000_000]);
    expect(ticks(format, 0, 1_000_000, 200_000)).toEqual([
      '$0',
      '$200k',
      '$400k',
      '$600k',
      '$800k',
      '$1M',
    ]);
    expect(compactAxisFormatter([0, 2_500_000])(1_500_000)).toBe('$1.5M');
    expect(compactAxisFormatter([0, 900])(900)).toBe('$900');
  });

  it('distinguishes ticks on a narrow axis far from zero', () => {
    const format = compactAxisFormatter([1_200_000, 1_300_000]);
    const labels = ticks(format, 1_200_000, 1_300_000, 20_000);
    expect(distinct(labels), labels.join(' ')).toBe(true);
    expect(labels[1]).toBe('$1.22M');
  });

  it('signs negatives with U+2212 and writes zero and float noise as $0', () => {
    const format = compactAxisFormatter([-3_000, 3_000]);
    expect(format(-1_500)).toBe(`${MINUS}$1.5k`);
    expect(format(0)).toBe('$0');
    expect(format(-0)).toBe('$0');
    expect(format(1e-12)).toBe('$0');
    expect(format(Number.NaN)).toBe('—');
  });

  it('falls back to the plain compact formatter for an empty or non-finite extent', () => {
    expect(compactAxisFormatter([0, 0])).toBe(compactMoneyFormatter);
    expect(compactAxisFormatter([Number.NaN, 4])).toBe(compactMoneyFormatter);
    // A flat, non-zero axis (one value repeated) still gets a precision from its size.
    expect(compactAxisFormatter([5, 5])(4.5)).toBe('$4.50');
  });
});

describe('axis helpers', () => {
  it('valueExtent covers zero, and a stack adds its positives and negatives per category', () => {
    expect(valueExtent([])).toEqual([0, 0]);
    expect(valueExtent([[3, null, -2]])).toEqual([-2, 3]);
    expect(valueExtent([[5, 6]])).toEqual([0, 6]);
    expect(
      valueExtent(
        [
          [2, 3],
          [4, -1],
          [-5, 1],
        ],
        true,
      ),
    ).toEqual([-5, 6]);
  });

  it('axisFormatterFor swaps only the shared compact money formatter', () => {
    const money = moneyFormatter();
    expect(axisFormatterFor(money, [0, 4])).toBe(money);
    const swapped = axisFormatterFor(compactMoneyFormatter, [0, 4]);
    expect(swapped).not.toBe(compactMoneyFormatter);
    expect(swapped(0.5)).toBe('$0.50');
  });
});

type AxisLabel = { formatter: (v: number) => string };
interface BuiltBarOption {
  xAxis: { axisLabel: AxisLabel };
  yAxis: { axisLabel: AxisLabel } | { axisLabel: AxisLabel }[];
}

describe('barOption money axes (STYLE-5)', () => {
  it('uses the axis-aware formatter when given the compact money formatter', () => {
    const option = barOption({
      ariaLabel: 'Small figures',
      categories: MONTHS,
      series: [{ name: 'Interest', data: [1, 3, 4] }],
      axisFormatter: compactMoneyFormatter,
    }) as unknown as BuiltBarOption;
    const y = option.yAxis as { axisLabel: AxisLabel };
    const labels = ticks(y.axisLabel.formatter, 0, 4, 0.5);
    expect(distinct(labels), labels.join(' ')).toBe(true);
  });

  it('sizes the axis from the stacked totals and the overlays on it', () => {
    const option = barOption({
      ariaLabel: 'Stacked',
      categories: ['A', 'B'],
      series: [
        { name: 'One', data: [600, 700] },
        { name: 'Two', data: [600, 700] },
      ],
      stacked: true,
      axisFormatter: compactMoneyFormatter,
    }) as unknown as BuiltBarOption;
    const y = option.yAxis as { axisLabel: AxisLabel };
    // The stack reaches $1,400, so ticks of 100 need a decimal in thousands.
    expect(y.axisLabel.formatter(1_100)).toBe('$1.1k');
    expect(y.axisLabel.formatter(1_200)).toBe('$1.2k');
  });

  it('keeps a secondary axis on its own extent and its tooltip formatter unchanged', () => {
    const option = barOption({
      ariaLabel: 'Two axes',
      categories: ['A', 'B'],
      series: [{ name: 'Saved', data: [10_000, 20_000] }],
      overlays: [{ name: 'Small', values: [1, 2], axis: 'secondary' }],
      axisFormatter: compactMoneyFormatter,
      secondaryAxisFormatter: compactMoneyFormatter,
    }) as unknown as BuiltBarOption;
    const [primary, secondary] = option.yAxis as { axisLabel: AxisLabel }[];
    expect(primary?.axisLabel.formatter(12_000)).toBe('$12k');
    expect(distinct(ticks(primary?.axisLabel.formatter ?? String, 0, 20_000, 2_000))).toBe(true);
    expect(secondary?.axisLabel.formatter(1.5)).toBe('$1.50');
  });

  it('leaves any other axis formatter as given', () => {
    const format = (v: number): string => `${v} units`;
    const option = barOption({
      ariaLabel: 'Units',
      categories: MONTHS,
      series: [{ name: 'Units', data: [1, 2, 3] }],
      axisFormatter: format,
      horizontal: true,
    }) as unknown as BuiltBarOption;
    expect(option.xAxis.axisLabel.formatter(2)).toBe('2 units');
  });
});

describe('all-zero charts show the empty message (STYLE-5)', () => {
  it('hasBarData: zero bars with zero or missing overlays are empty; a non-zero overlay is not', () => {
    const series = [{ name: 'Saved', data: ZEROS }];
    expect(hasBarData({ categories: MONTHS, series })).toBe(false);
    expect(
      hasBarData({ categories: MONTHS, series, overlays: [{ name: 'Rate', values: ZEROS }] }),
    ).toBe(false);
    expect(
      hasBarData({ categories: MONTHS, series, overlays: [{ name: 'Rate', values: [0, 0.1, 0] }] }),
    ).toBe(true);
  });

  it.each([
    [
      'bar',
      () => <BarChart ariaLabel="Bars" categories={MONTHS} series={[{ name: 'A', data: ZEROS }]} />,
    ],
    [
      'stacked bar',
      () => (
        <BarChart
          ariaLabel="Stacked bars"
          categories={MONTHS}
          stacked
          series={[
            { name: 'A', data: ZEROS },
            { name: 'B', data: [0, null, 0] },
          ]}
        />
      ),
    ],
    [
      'line',
      () => (
        <LineChart ariaLabel="Line" categories={MONTHS} series={[{ name: 'A', data: ZEROS }]} />
      ),
    ],
    [
      'area',
      () => (
        <AreaChart ariaLabel="Area" categories={MONTHS} series={[{ name: 'A', data: ZEROS }]} />
      ),
    ],
    [
      'stacked area',
      () => (
        <AreaChart
          ariaLabel="Stacked area"
          categories={MONTHS}
          stacked
          series={[
            { name: 'A', data: ZEROS },
            { name: 'B', data: ZEROS },
          ]}
        />
      ),
    ],
  ])('%s chart: every value 0 → the empty message, no plot', (_kind, chart) => {
    const { container } = render(chart());
    expect(screen.getByText(DEFAULT_EMPTY_MESSAGE)).toBeInTheDocument();
    expect(container.querySelector('.jf-chart')).toHaveAttribute('data-state', 'empty');
    expect(container.querySelector('.jf-chart__legend')).toBeNull();
  });

  it('uses the chart’s own empty message', () => {
    render(
      <LineChart
        ariaLabel="Line"
        categories={MONTHS}
        series={[{ name: 'A', data: ZEROS }]}
        emptyMessage="No interest yet."
      />,
    );
    expect(screen.getByText('No interest yet.')).toBeInTheDocument();
  });

  it('a chart with one non-zero value still plots', () => {
    const { container } = render(
      <BarChart ariaLabel="Bars" categories={MONTHS} series={[{ name: 'A', data: [0, 5, 0] }]} />,
    );
    expect(container.querySelector('.jf-chart')).toHaveAttribute('data-state', 'ready');
    expect(fake.chart.setOption).toHaveBeenCalled();
  });
});

describe('ChartCard table view (STYLE-11)', () => {
  let removeCss: () => void = () => undefined;
  afterEach(() => {
    removeCss();
  });

  it('lets the header labels wrap between words, in the table view and elsewhere', async () => {
    removeCss = installUiCss(['tokens', 'base', 'table', 'charts']);
    const user = userEvent.setup();
    const table = (
      <ColumnTable
        caption="By month"
        columns={[
          { id: 'month', header: 'Month', value: (r: { m: string; v: number }) => r.m },
          { id: 'value', header: 'Contributions after tax', value: (r) => r.v, numeric: true },
        ]}
        rows={[{ m: 'Jan 2026', v: 1 }]}
        getRowId={(r) => r.m}
      />
    );
    render(<ChartCard title="Example" chart={<p>chart</p>} table={table} />);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const header = screen.getByRole('columnheader', { name: 'Contributions after tax' });
    expect(getComputedStyle(header).whiteSpace).toBe('normal');
    expect(getComputedStyle(header).wordBreak).toBe('normal');

    // Outside a chart card too (owner 2026-09-29): a header wraps at its spaces only when the table
    // would otherwise be wider than its box.
    render(table);
    const plain = screen.getAllByRole('columnheader', { name: 'Contributions after tax' })[1];
    expect(getComputedStyle(plain as HTMLElement).whiteSpace).toBe('normal');
    expect(getComputedStyle(plain as HTMLElement).overflowWrap).toBe('normal');
  });
});
