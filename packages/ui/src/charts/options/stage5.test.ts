// Stage 5 chart additions (stage-5.md §6.1, web-owned, additive): BarChart overlays on a second
// axis or dashed, negative stacking ('samesign'), the named stacked total, and the donut's
// `maxSegments` with per-datum colours (D93).
import type { EChartsCoreOption } from 'echarts/core';
import { describe, expect, it } from 'vitest';
import { moneyFormatter } from '../format';
import { CHART_OTHER, CHART_PALETTE } from '../palette';
import type { Series } from '../types';
import { barLegend, barOption } from './bar';
import { OTHER_LABEL, donutLegend, donutMaxSegments, donutOption, donutSlices } from './donut';

type Loose = Record<string, unknown>;
interface DataItem {
  value: number;
  itemStyle: { borderRadius?: unknown; color?: string };
}
interface SeriesView extends Loose {
  type: string;
  data: unknown[];
  lineStyle?: Loose;
}
interface OptionView {
  series: SeriesView[];
  tooltip: { trigger?: string; formatter: (p: unknown) => string };
  yAxis: unknown;
}
const view = (option: EChartsCoreOption): OptionView => option as unknown as OptionView;
const item = (value: unknown): DataItem => value as DataItem;
const nth = <T>(list: readonly T[], i: number): T => {
  const value = list[i];
  if (value === undefined) throw new Error(`no item ${i}`);
  return value;
};

const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];
const dollars = moneyFormatter();
const NET: Series[] = [
  { name: 'Stocks', data: [100, 120, 130] },
  { name: 'Property equity', data: [300, -50, 320] },
  { name: 'Other debts', data: [-40, -20, 0], color: CHART_OTHER },
];

describe('barOption: negative stacking and the total label', () => {
  it('stacks positives up and negatives down (samesign), rounding each outermost end', () => {
    const o = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: NET, stacked: true }));
    for (const s of o.series) expect(s.stackStrategy).toBe('samesign');
    const radius = (si: number, ci: number): unknown =>
      item(nth(nth(o.series, si).data, ci)).itemStyle.borderRadius;
    // Feb: Stocks is the top of the positive stack, Other debts the bottom of the negative one.
    expect(radius(0, 1)).toEqual([4, 4, 0, 0]);
    expect(radius(1, 1)).toBe(0);
    expect(radius(2, 1)).toEqual([0, 0, 4, 4]);
    const plain = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: NET }));
    expect(plain.series.every((s) => s.stackStrategy === undefined)).toBe(true);
  });

  it('names the stacked total with totalLabel (default "Total")', () => {
    const named = view(
      barOption({
        ariaLabel: 'x',
        categories: MONTHS,
        series: NET,
        stacked: true,
        totalLabel: 'Net worth',
        valueFormatter: dollars,
      }),
    );
    const html = named.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
    expect(html).toContain('Net worth');
    expect(html).toContain('$50'); // 120 − 50 − 20
    expect(html).not.toContain('Total');
    const plain = view(
      barOption({ ariaLabel: 'x', categories: MONTHS, series: NET, stacked: true }),
    );
    expect(plain.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 })).toContain('Total');
  });
});

describe('barOption: line overlays', () => {
  const liquid: Series[] = [{ name: 'Liquid assets', data: [10, 12, 14] }];

  it('draws a dashed overlay over the bars and keys it with a dashed stroke', () => {
    const overlays = [{ name: 'Trend', values: [10, 12, null], dashed: true, color: CHART_OTHER }];
    const o = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: liquid, overlays }));
    expect(o.series.map((s) => s.type)).toEqual(['bar', 'line']);
    const line = nth(o.series, 1);
    expect(line.lineStyle).toMatchObject({ type: 'dashed', width: 2, color: CHART_OTHER });
    expect(line.data).toEqual([10, 12, null]);
    expect(line.yAxisIndex).toBe(0);
    expect(Array.isArray(o.yAxis)).toBe(false);
    expect(barLegend({ ariaLabel: 'x', categories: MONTHS, series: liquid, overlays })).toEqual([
      { name: 'Liquid assets', color: CHART_PALETTE[0], key: 'swatch' },
      { name: 'Trend', color: CHART_OTHER, key: 'dashed-line' },
    ]);
  });

  it('gives an overlay without a colour the next palette slot and a solid key', () => {
    const legend = barLegend({
      ariaLabel: 'x',
      categories: MONTHS,
      series: [{ name: 'Savings', data: [1, 2, 3] }],
      overlays: [{ name: 'Savings rate', values: [0.1, 0.2, 0.3] }],
    });
    expect(legend[1]).toEqual({ name: 'Savings rate', color: CHART_PALETTE[1], key: 'line' });
  });

  it('puts a secondary overlay on a right-hand axis with its own formatter', () => {
    const o = view(
      barOption({
        ariaLabel: 'x',
        categories: MONTHS,
        series: [{ name: 'Savings', data: [1200, -300, 900] }],
        overlays: [{ name: 'Savings rate', values: [0.2, -0.05, 0.15], axis: 'secondary' }],
        valueFormatter: dollars,
        secondaryAxisFormatter: (v) => `${Math.round(v * 100)}%`.replace('-', '−'),
      }),
    );
    const axes = o.yAxis as Loose[];
    expect(axes).toHaveLength(2);
    expect(axes[1]).toMatchObject({ position: 'right', name: 'Savings rate' });
    const tick = (axes[1] as { axisLabel: { formatter: (v: number) => string } }).axisLabel;
    expect(tick.formatter(0.25)).toBe('25%');
    expect(nth(o.series, 1).yAxisIndex).toBe(1);
    // One tooltip per category lists the bar and the line, each in its own format.
    expect(o.tooltip.trigger).toBe('axis');
    const html = o.tooltip.formatter([{ seriesIndex: 0, dataIndex: 1 }]);
    expect(html).toContain('−$300');
    expect(html).toContain('−5%');
    expect(html).toContain('Savings rate');
    expect(html).toContain('jf-chart-tooltip__key--line');
  });

  it('keeps a single axis and the item tooltip without overlays', () => {
    const o = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: NET }));
    expect(Array.isArray(o.yAxis)).toBe(false);
    expect(o.tooltip.trigger).toBe('item');
  });
});

describe('donutSlices: maxSegments and Datum.color (D93)', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ label: `Class ${i + 1}`, value: 100 }));

  it('draws eight slices and no "Other" with maxSegments 8', () => {
    const slices = donutSlices(eight, undefined, 8);
    expect(slices).toHaveLength(8);
    expect(slices.map((s) => s.label)).not.toContain(OTHER_LABEL);
    expect(donutLegend({ data: eight, maxSegments: 8 })).toHaveLength(8);
    const o = view(donutOption({ ariaLabel: 'x', data: eight, maxSegments: 8 }));
    expect(nth(o.series, 0).data).toHaveLength(8);
  });

  it('still folds the seventh slice by default, and clamps maxSegments to the palette', () => {
    const folded = donutSlices(eight.slice(0, 7));
    expect(folded).toHaveLength(6);
    expect(folded[5]?.label).toBe(OTHER_LABEL);
    const nine = [...eight, { label: 'Class 9', value: 100 }];
    const clamped = donutSlices(nine, undefined, 20);
    expect(clamped).toHaveLength(8);
    expect(clamped[7]?.label).toBe(OTHER_LABEL);
    expect([donutMaxSegments(), donutMaxSegments(0), donutMaxSegments(99)]).toEqual([6, 1, 8]);
  });

  it("keeps a datum's own colour whatever else is drawn", () => {
    const data = [
      { label: 'Stocks', value: 5, color: CHART_PALETTE[1] },
      { label: 'Cash', value: 3, color: CHART_PALETTE[3] },
      { label: 'Unsafe', value: 1, color: 'url(x)' },
    ];
    const slices = donutSlices(data, undefined, 8);
    // An unsafe colour falls back to its position's slot.
    expect(slices.map((s) => s.color)).toEqual([
      CHART_PALETTE[1],
      CHART_PALETTE[3],
      CHART_PALETTE[2],
    ]);
    const o = view(donutOption({ ariaLabel: 'x', data, maxSegments: 8 }));
    expect(nth(o.series, 0).data.map((d) => item(d).itemStyle.color)).toEqual(
      slices.map((s) => s.color),
    );
  });
});
