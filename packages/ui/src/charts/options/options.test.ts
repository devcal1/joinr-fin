// Pure option builders: palette order, formatter use, stacking, sign colours, gauge clamping,
// accessibility and the no-shadow rule.
import type { EChartsCoreOption } from 'echarts/core';
import { describe, expect, it } from 'vitest';
import { COLORS } from '../../core';
import { moneyFormatter } from '../format';
import { CHART_GAIN, CHART_LOSS, CHART_OTHER, CHART_PALETTE, withAlpha } from '../palette';
import { JOINR_CHART_THEME } from '../theme';
import type { Series } from '../types';
import { BAR_MAX_WIDTH, barLegend, barOption, barRadius, stackEnds } from './bar';
import { alignSeries, changeWord, hasSeriesData, seriesLegend, signed } from './common';
import {
  DONUT_RINGS,
  OTHER_LABEL,
  donutLegend,
  donutOption,
  donutSlices,
  hasDonutData,
} from './donut';
import { clampToRange, gaugeOption, gaugeRange, targetStops } from './gauge';
import { LINE_WIDTH, MARKER_SIZE, areaOption, lineLegend, lineOption } from './line';

/* ───────────── a typed view of the parts of an option these tests read ───────────── */

type Loose = Record<string, unknown>;
interface DataItem {
  value: number;
  name?: string;
  itemStyle: { borderRadius?: unknown; color?: string };
}
interface SeriesView extends Loose {
  type: string;
  name?: string;
  stack?: string;
  data: unknown[];
  itemStyle?: Loose;
  lineStyle?: Loose;
  areaStyle?: Loose;
  progress?: Loose;
  axisLine?: { lineStyle: { width: number; color: [number, string][] } };
}
interface OptionView {
  series: SeriesView[];
  color?: string[];
  legend?: { show?: boolean };
  aria: { enabled: boolean; label: { description: string } };
  tooltip: {
    trigger?: string;
    show?: boolean;
    confine?: boolean;
    formatter: (p: unknown) => string;
  };
  xAxis: Loose;
  yAxis: Loose;
}
const view = (option: EChartsCoreOption): OptionView => option as unknown as OptionView;
const item = (value: unknown): DataItem => value as DataItem;
const nth = <T>(list: readonly T[], i: number): T => {
  const value = list[i];
  if (value === undefined) throw new Error(`no item ${i}`);
  return value;
};

/** Every path in the option tree whose key is `key` (functions are not walked). */
function findKey(value: unknown, key: string, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKey(v, key, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(k === key ? [`${path}.${k}`] : []),
      ...findKey(v, key, `${path}.${k}`),
    ]);
  }
  return [];
}

const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];
const dollars = moneyFormatter();
const THREE: Series[] = [
  { name: 'Salary', data: [5200, 5200, 5400] },
  { name: 'Side income', data: [600, null, 720] },
  { name: 'Dividends', data: [0, 120, 0] },
];

/* ───────────── common ───────────── */

describe('common helpers', () => {
  it('aligns series to categories and turns non-finite values into gaps', () => {
    expect(alignSeries(['a', 'b', 'c'], [{ name: 'x', data: [1, Number.NaN] }])).toEqual([
      [1, null, null],
    ]);
    expect(hasSeriesData(['a'], [{ name: 'x', data: [null] }])).toBe(false);
    expect(hasSeriesData([], [{ name: 'x', data: [1] }])).toBe(false);
    expect(hasSeriesData(['a'], [{ name: 'x', data: [0] }])).toBe(true);
  });

  it('only builds a legend for two or more series', () => {
    expect(seriesLegend(['A'], ['#07AE8B'], 'line')).toEqual([]);
    expect(seriesLegend(['A', 'B'], ['#07AE8B'], 'swatch')).toEqual([
      { name: 'A', color: '#07AE8B', key: 'swatch' },
      { name: 'B', color: CHART_OTHER, key: 'swatch' },
    ]);
  });

  it('pairs a gain or loss with a sign and a word', () => {
    expect(signed(dollars, 1240)).toBe('+$1,240');
    expect(signed(dollars, -620)).toBe('−$620');
    expect(signed(() => '+1', 1)).toBe('+1');
    expect([changeWord(1), changeWord(-1), changeWord(0)]).toEqual(['Gain', 'Loss', 'No change']);
  });
});

/* ───────────── bar ───────────── */

describe('barOption', () => {
  it('draws a single series in teal (slot 1) with no legend', () => {
    const o = view(
      barOption({
        ariaLabel: 'Savings',
        categories: MONTHS,
        series: [{ name: 'Saved', data: [1, 2, 3] }],
      }),
    );
    expect(o.series).toHaveLength(1);
    expect(nth(o.series, 0).itemStyle?.color).toBe(CHART_PALETTE[0]);
    expect(o.legend?.show).toBe(false);
    expect(nth(o.series, 0).barMaxWidth).toBe(BAR_MAX_WIDTH);
    expect(
      barLegend({ ariaLabel: '', categories: MONTHS, series: [{ name: 'Saved', data: [] }] }),
    ).toEqual([]);
  });

  it('assigns palette slots in series order and honours a safe override', () => {
    const series: Series[] = [...THREE, { name: 'Other', data: [1, 1, 1], color: '#123456' }];
    const o = view(barOption({ ariaLabel: 'x', categories: MONTHS, series }));
    expect(o.series.map((s) => s.itemStyle?.color)).toEqual([
      CHART_PALETTE[0],
      CHART_PALETTE[1],
      CHART_PALETTE[2],
      '#123456',
    ]);
    expect(barLegend({ ariaLabel: 'x', categories: MONTHS, series }).map((l) => l.color)).toEqual(
      o.series.map((s) => s.itemStyle?.color),
    );
  });

  it('stacks with a surface gap and rounds only the outermost segment', () => {
    const o = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: THREE, stacked: true }));
    for (const s of o.series) {
      expect(s.stack).toBe('total');
      expect(s.itemStyle).toMatchObject({ borderColor: COLORS.surface, borderWidth: 2 });
    }
    const radius = (si: number, ci: number): unknown =>
      item(nth(nth(o.series, si).data, ci)).itemStyle.borderRadius;
    // Jan: Side income is the top (Dividends is 0). Feb: Dividends is the top.
    expect(radius(0, 0)).toBe(0);
    expect(radius(1, 0)).toEqual([4, 4, 0, 0]);
    expect(radius(2, 0)).toBe(0);
    expect(radius(2, 1)).toEqual([4, 4, 0, 0]);
    expect(nth(nth(o.series, 1).data, 1)).toBeNull(); // the gap stays a gap
  });

  it('does not stack when not asked, or with a single series', () => {
    expect(
      view(barOption({ ariaLabel: 'x', categories: MONTHS, series: THREE })).series[0]?.stack,
    ).toBe(undefined);
    const single = view(
      barOption({
        ariaLabel: 'x',
        categories: MONTHS,
        series: [THREE[0] as Series],
        stacked: true,
      }),
    );
    expect(single.series[0]?.stack).toBeUndefined();
    expect(single.series[0]?.itemStyle?.borderWidth).toBeUndefined();
  });

  it('rounds the data end for each direction', () => {
    expect(barRadius(false, true)).toEqual([4, 4, 0, 0]);
    expect(barRadius(false, false)).toEqual([0, 0, 4, 4]);
    expect(barRadius(true, true)).toEqual([0, 4, 4, 0]);
    expect(barRadius(true, false)).toEqual([4, 0, 0, 4]);
    expect(
      stackEnds([
        [1, -1],
        [2, null],
        [0, -3],
      ]),
    ).toEqual({ top: [1, -1], bottom: [-1, 2] });
  });

  it('colours by sign with --go / --stop, and the tooltip adds a sign and a word', () => {
    const o = view(
      barOption({
        ariaLabel: 'Change',
        categories: MONTHS,
        series: [{ name: 'Change', data: [1240, -620, 0] }],
        signColors: true,
        valueFormatter: dollars,
      }),
    );
    const data = nth(o.series, 0).data.map(item);
    expect(data.map((d) => d.itemStyle.color)).toEqual([CHART_GAIN, CHART_LOSS, CHART_GAIN]);
    expect(nth(data, 1).itemStyle.borderRadius).toEqual([0, 0, 4, 4]);
    const loss = o.tooltip.formatter({ seriesIndex: 0, dataIndex: 1 });
    expect(loss).toContain('−$620');
    expect(loss).toContain('Loss');
    expect(loss).toContain(`background-color:${CHART_LOSS}`);
    const gain = o.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 });
    expect(gain).toContain('+$1,240');
    expect(gain).toContain('Gain');
    expect(
      barLegend({ ariaLabel: 'x', categories: MONTHS, series: THREE, signColors: true }),
    ).toEqual([]);
  });

  it('puts categories on the y axis (top first) when horizontal', () => {
    const o = view(
      barOption({
        ariaLabel: 'x',
        categories: MONTHS,
        series: [THREE[0] as Series],
        horizontal: true,
      }),
    );
    expect(o.yAxis).toMatchObject({ type: 'category', data: MONTHS, inverse: true });
    expect(o.xAxis).toMatchObject({ type: 'value' });
    expect(item(nth(nth(o.series, 0).data, 0)).itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
  });

  it('formats tooltips with valueFormatter and axis ticks with axisFormatter', () => {
    const o = view(
      barOption({
        ariaLabel: 'x',
        categories: MONTHS,
        series: THREE,
        stacked: true,
        valueFormatter: dollars,
        axisFormatter: (v) => `A${v}`,
      }),
    );
    const html = o.tooltip.formatter({ seriesIndex: 1, dataIndex: 0 });
    expect(html).toContain('Jan 2026');
    expect(html).toContain('$600');
    expect(html).toContain('Side income');
    expect(html).toContain('$5,800'); // stack total
    expect(o.tooltip.formatter({ seriesIndex: 1, dataIndex: 1 })).toBe(''); // a gap
    const axisLabel = o.yAxis.axisLabel as { formatter: (v: number) => string };
    expect(axisLabel.formatter(5)).toBe('A5');
    expect(o.tooltip).toMatchObject({ trigger: 'item', confine: true });
  });
});

/* ───────────── line and area ───────────── */

describe('lineOption / areaOption', () => {
  const two: Series[] = [
    { name: 'Net worth', data: [100, 110, null] },
    { name: 'Invested', data: [60, 65, 70] },
  ];

  it('draws 2px round lines with ringed 8px markers, gaps kept', () => {
    const o = view(lineOption({ ariaLabel: 'x', categories: MONTHS, series: two }));
    const s = nth(o.series, 0);
    expect(s.lineStyle).toMatchObject({
      width: LINE_WIDTH,
      cap: 'round',
      join: 'round',
      color: CHART_PALETTE[0],
    });
    expect(s.symbolSize).toBe(MARKER_SIZE);
    expect(s.itemStyle).toMatchObject({ borderColor: COLORS.surface, borderWidth: 2 });
    expect(s.connectNulls).toBe(false);
    expect(s.areaStyle).toBeUndefined();
    expect(s.data).toEqual([100, 110, null]);
    expect(nth(o.series, 1).lineStyle?.color).toBe(CHART_PALETTE[1]);
    expect(o.xAxis).toMatchObject({ type: 'category', boundaryGap: false });
  });

  it('uses an axis crosshair that lists every series at that category', () => {
    const o = view(
      lineOption({ ariaLabel: 'x', categories: MONTHS, series: two, valueFormatter: dollars }),
    );
    expect(o.tooltip).toMatchObject({ trigger: 'axis', axisPointer: { type: 'line' } });
    const html = o.tooltip.formatter([{ seriesIndex: 0, dataIndex: 1 }]);
    expect(html).toContain('Feb 2026');
    expect(html).toContain('$110');
    expect(html).toContain('$65');
    expect(html).toContain('jf-chart-tooltip__key--line');
    // Mar: Net worth is a gap, so only Invested is listed.
    const mar = o.tooltip.formatter([{ seriesIndex: 1, dataIndex: 2 }]);
    expect(mar).not.toContain('Net worth');
    expect(mar).not.toContain('Total');
  });

  it('keys the legend with line strokes for two or more series only', () => {
    expect(lineLegend({ ariaLabel: 'x', categories: MONTHS, series: two })).toEqual([
      { name: 'Net worth', color: CHART_PALETTE[0], key: 'line' },
      { name: 'Invested', color: CHART_PALETTE[1], key: 'line' },
    ]);
    expect(lineLegend({ ariaLabel: 'x', categories: MONTHS, series: [two[0] as Series] })).toEqual(
      [],
    );
  });

  it('fills areas with a wash, and stacks only when asked', () => {
    const plain = view(areaOption({ ariaLabel: 'x', categories: MONTHS, series: two }));
    expect(nth(plain.series, 0).areaStyle).toEqual({ color: CHART_PALETTE[0], opacity: 0.14 });
    expect(nth(plain.series, 0).stack).toBeUndefined();
    const stacked = view(
      areaOption({ ariaLabel: 'x', categories: MONTHS, series: two, stacked: true }),
    );
    expect(stacked.series.every((s) => s.stack === 'total')).toBe(true);
    expect(stacked.tooltip.formatter([{ seriesIndex: 0, dataIndex: 0 }])).toContain('Total');
  });
});

/* ───────────── donut ───────────── */

describe('donutSlices / donutOption', () => {
  const current = [
    { label: 'Australian shares', value: 5200 },
    { label: 'International shares', value: 3400 },
    { label: 'Property', value: 2480 },
    { label: 'Cash', value: 1400 },
  ];
  const target = [
    { label: 'Cash', value: 1248 },
    { label: 'Australian shares', value: 4992 },
    { label: 'International shares', value: 3744 },
    { label: 'Property', value: 2496 },
  ];

  it('matches target to current by label so colour follows the entity', () => {
    const slices = donutSlices(current, target);
    expect(slices.map((s) => s.label)).toEqual(current.map((c) => c.label));
    expect(slices.map((s) => s.color)).toEqual(CHART_PALETTE.slice(0, 4));
    expect(slices[3]).toMatchObject({ label: 'Cash', value: 1400, target: 1248 });
  });

  it('appends target-only labels and folds past six slices into Other', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `Class ${i + 1}`, value: 100 }));
    const slices = donutSlices(many, [{ label: 'Class 8', value: 50 }]);
    expect(slices).toHaveLength(6);
    expect(slices[5]).toEqual({ label: OTHER_LABEL, value: 300, target: 50, color: CHART_OTHER });
    const extra = donutSlices([{ label: 'ABC', value: 1 }], [{ label: 'XYZ', value: 2 }]);
    expect(extra.map((s) => [s.label, s.value, s.target])).toEqual([
      ['ABC', 1, null],
      ['XYZ', null, 2],
    ]);
  });

  it('draws the current ring outside and a thin target ring inside', () => {
    const o = view(donutOption({ ariaLabel: 'Allocation', data: current, target }));
    expect(o.series.map((s) => s.name)).toEqual(['Current', 'Target']);
    expect(nth(o.series, 0).radius).toEqual([...DONUT_RINGS.current]);
    expect(nth(o.series, 1).radius).toEqual([...DONUT_RINGS.target]);
    const colors = (s: SeriesView): (string | undefined)[] =>
      s.data.map((d) => item(d).itemStyle.color);
    expect(colors(nth(o.series, 1))).toEqual(colors(nth(o.series, 0)));
    expect(nth(o.series, 0).padAngle).toBeGreaterThan(0);
    expect(o.legend?.show).toBe(false);
    expect(donutLegend({ data: current, target })).toHaveLength(4);
  });

  it('leaves out non-positive slices and omits the target ring without a target', () => {
    const o = view(
      donutOption({
        ariaLabel: 'x',
        data: [
          { label: 'A', value: 2 },
          { label: 'B', value: 0 },
          { label: 'C', value: -1 },
        ],
      }),
    );
    expect(o.series).toHaveLength(1);
    expect(nth(o.series, 0).data.map((d) => item(d).name)).toEqual(['A']);
    expect(hasDonutData([{ label: 'A', value: 0 }])).toBe(false);
    expect(hasDonutData([])).toBe(false);
  });

  it('keeps each slice in its slot colour on hover (no lightened emphasis fill)', () => {
    const o = view(donutOption({ ariaLabel: 'x', data: current, target }));
    for (const s of o.series) {
      expect((s.emphasis as { itemStyle?: { color?: string } }).itemStyle?.color).toBe('inherit');
    }
    const bars = view(barOption({ ariaLabel: 'x', categories: MONTHS, series: THREE }));
    for (const s of bars.series) {
      expect((s.emphasis as { itemStyle?: { color?: string } }).itemStyle?.color).toBe('inherit');
    }
  });

  it('shows current and target with their shares in the tooltip', () => {
    const o = view(donutOption({ ariaLabel: 'x', data: current, target, valueFormatter: dollars }));
    const html = o.tooltip.formatter({ seriesIndex: 0, dataIndex: 3 });
    expect(html).toContain('Cash');
    expect(html).toContain('$1,400');
    expect(html).toContain('11.2%');
    expect(html).toContain('$1,248');
    expect(html).toContain('10.0%');
  });
});

/* ───────────── gauge ───────────── */

describe('gaugeOption', () => {
  it('normalises the range and clamps values into it', () => {
    expect(gaugeRange({})).toEqual({ min: 0, max: 1 });
    expect(gaugeRange({ min: 2, max: 1 })).toEqual({ min: 2, max: 3 });
    expect(clampToRange(-0.021, { min: 0, max: 1 })).toBe(0);
    expect(clampToRange(1.4, { min: 0, max: 1 })).toBe(1);
    expect(clampToRange(Number.NaN, { min: 0, max: 1 })).toBe(0);
  });

  it('fills teal on a same-hue track', () => {
    const o = view(gaugeOption({ ariaLabel: 'Savings rate', value: 0.074 }));
    const s = nth(o.series, 0);
    expect(s.progress).toMatchObject({ show: true, itemStyle: { color: CHART_PALETTE[0] } });
    expect(s.axisLine?.lineStyle.color).toEqual([[1, withAlpha(CHART_PALETTE[0] ?? '', 0.16)]]);
    expect(nth(s.data, 0)).toMatchObject({ value: 0.074 });
    expect(o.series).toHaveLength(1);
    expect(o.tooltip.show).toBe(false);
  });

  it('clamps a negative value to an empty arc (the figure is drawn by GaugeChart)', () => {
    const o = view(gaugeOption({ ariaLabel: 'x', value: -0.021, target: 0.2 }));
    expect(nth(nth(o.series, 0).data, 0)).toMatchObject({ value: 0 });
    expect(nth(o.series, 0).progress).toMatchObject({ show: false });
  });

  it('draws the target as a bright tick across the track', () => {
    const o = view(gaugeOption({ ariaLabel: 'x', value: 0.074, target: 0.2 }));
    const tick = nth(o.series, 1);
    expect(tick.name).toBe('Target');
    const stops = tick.axisLine?.lineStyle.color ?? [];
    expect(stops.some(([, c]) => c === COLORS.textBright)).toBe(true);
    expect(tick.axisLine?.lineStyle.width).toBeGreaterThan(
      nth(o.series, 0).axisLine?.lineStyle.width ?? 0,
    );
    expect(targetStops(0.5)).toEqual([
      [0.496, 'transparent'],
      [0.504, COLORS.textBright],
      [1, 'transparent'],
    ]);
    expect(targetStops(0)).toEqual([
      [0.004, COLORS.textBright],
      [1, 'transparent'],
    ]);
    expect(targetStops(2)).toEqual([
      [0.996, 'transparent'],
      [1, COLORS.textBright],
    ]);
  });
});

/* ───────────── shared rules ───────────── */

describe('every builder', () => {
  const options: [string, EChartsCoreOption][] = [
    [
      'bar',
      barOption({ ariaLabel: 'Bar chart', categories: MONTHS, series: THREE, stacked: true }),
    ],
    ['line', lineOption({ ariaLabel: 'Line chart', categories: MONTHS, series: THREE })],
    [
      'area',
      areaOption({ ariaLabel: 'Area chart', categories: MONTHS, series: THREE, stacked: true }),
    ],
    [
      'donut',
      donutOption({
        ariaLabel: 'Donut chart',
        data: [{ label: 'A', value: 1 }],
        target: [{ label: 'A', value: 1 }],
      }),
    ],
    ['gauge', gaugeOption({ ariaLabel: 'Gauge chart', value: 0.5, target: 0.6 })],
  ];

  it.each(options)('%s: enables aria with the given description', (name, option) => {
    const o = view(option);
    expect(o.aria.enabled).toBe(true);
    expect(o.aria.label.description).toMatch(new RegExp(`^${name}`, 'i'));
  });

  it.each(options)('%s: has no shadows and no ECharts legend', (_name, option) => {
    expect(findKey(option, 'shadowBlur')).toEqual([]);
    expect(findKey(option, 'shadowColor')).toEqual([]);
    expect(view(option).legend?.show ?? false).toBe(false);
  });

  it('keeps the theme free of shadows too, and built from the tokens', () => {
    expect(findKey(JOINR_CHART_THEME, 'shadowBlur')).toEqual([]);
    expect(JOINR_CHART_THEME.color).toEqual([...CHART_PALETTE]);
    expect(JOINR_CHART_THEME.backgroundColor).toBe('transparent');
    expect(JOINR_CHART_THEME.tooltip).toMatchObject({
      backgroundColor: COLORS.raised,
      borderColor: COLORS.hairline,
      extraCssText: 'box-shadow: none;',
    });
    expect(JOINR_CHART_THEME.valueAxis).toMatchObject({
      axisLabel: { color: COLORS.textSecondary, fontSize: 11 },
      splitLine: { lineStyle: { color: COLORS.hairline, type: 'solid' } },
    });
    expect(JOINR_CHART_THEME.categoryAxis).toMatchObject({
      axisLine: { lineStyle: { color: COLORS.hairline } },
    });
  });
});
