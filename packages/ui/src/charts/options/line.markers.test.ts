// Stage 6 line additions (stage-6.md §5, §6.5, §6.9 C; web-fire): milestone markers drawn as
// ECharts markLines (a dashed --text-muted line, the node dot in its brand colour, the label inside
// the plot, dots only on request, the tooltip naming the milestone), dashed series with a dashed
// legend key, and the compact money axis following its extent. Rendered with the real ECharts as
// SVG where it matters.
import { init, type EChartsCoreOption } from 'echarts/core';
import { afterEach, describe, expect, it } from 'vitest';
import { COLORS } from '../../core';
import { registerJoinrCharts } from '../echarts';
import { compactMoneyFormatter, moneyFormatter } from '../format';
import { CHART_PALETTE } from '../palette';
import { CHART_THEME_NAME } from '../theme';
import type { LineChartMarker, LineChartProps } from '../types';
import {
  MARKER_GRID_TOP,
  MILESTONE_DOTS_SERIES,
  areaOption,
  lineLegend,
  lineOption,
  markerAxisMax,
  markerToneColor,
  visibleMarkers,
} from './line';

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
});

function renderSvg(option: EChartsCoreOption): string {
  registerJoinrCharts();
  const chart = init(null, CHART_THEME_NAME, {
    renderer: 'svg',
    ssr: true,
    width: 640,
    height: 300,
  });
  disposers.push(() => chart.dispose());
  chart.setOption({ ...option, animation: false });
  return chart.renderToSVGString();
}

type Loose = Record<string, unknown>;
interface MarkLineView {
  symbol: unknown;
  lineStyle: Loose;
  data: { xAxis: number; label: Loose }[];
}
interface OptionView {
  grid: Loose;
  yAxis: { max?: unknown; axisLabel: { formatter: (v: number) => string; showMaxLabel?: boolean } };
  series: {
    name: string;
    lineStyle: Loose;
    markLine?: MarkLineView;
    data: ({ value: number; itemStyle: { color: string } } | number | null)[];
  }[];
  tooltip: { formatter: (p: unknown) => string };
}
const view = (option: EChartsCoreOption): OptionView => option as unknown as OptionView;

const YEARS = ['2030', '2031', '2032', '2033', '2034', '2035', '2036'];
const PRE = [150_000, 186_000, 133_440, 78_777.6, 39_542.35, 1_124.04, 1_169.01];
const SUPER = [600_000, 644_000, 689_760, 737_350.4, 769_230.77, 800_000, 792_000];
const MARKERS: LineChartMarker[] = [
  { index: 0, label: 'Today 2030', tone: 'teal' },
  { index: 1, label: 'FIRE 2031', tone: 'violet', tooltip: 'FIRE starts' },
  { index: 4, label: 'Top-ups end 2034', tone: 'fuchsia' },
  { index: 5, label: 'Access 2035', tone: 'orange' },
];

function props(extra: Partial<LineChartProps> = {}): LineChartProps {
  return {
    ariaLabel: 'Pre-super and super balances',
    categories: YEARS,
    series: [
      { name: 'Pre-super', data: PRE },
      { name: 'Super', data: SUPER, color: CHART_PALETTE[5] },
    ],
    valueFormatter: moneyFormatter(),
    markers: MARKERS,
    ...extra,
  };
}

describe('lineOption: milestone markers', () => {
  it('draws one dashed --text-muted markLine per marker and each node dot in its tone', () => {
    const o = view(lineOption(props()));
    const markLine = o.series[0]?.markLine;
    expect(markLine).toBeDefined();
    expect(o.series[1]?.markLine).toBeUndefined();
    expect(markLine?.symbol).toEqual(['none', 'none']);
    expect(markLine?.lineStyle).toMatchObject({
      type: 'dashed',
      width: 1,
      color: COLORS.textMuted,
    });
    expect(markLine?.data.map((d) => d.xAxis)).toEqual([0, 1, 4, 5]);
    // The dots: a point-only series at the top of the plot, one per marker, in its tone.
    expect(o.series).toHaveLength(3);
    const dots = o.series[2];
    expect(dots?.name).toBe(MILESTONE_DOTS_SERIES);
    expect(dots?.lineStyle).toMatchObject({ width: 0, opacity: 0 });
    const top = markerAxisMax([0, 800_000]);
    expect(o.yAxis.max).toBe(top);
    const points = (dots?.data ?? []).map((d) =>
      d && typeof d === 'object' ? [d.value, d.itemStyle.color] : d,
    );
    expect(points).toEqual([
      [top, COLORS.teal],
      [top, COLORS.violet],
      null,
      null,
      [top, COLORS.fuchsia],
      [top, COLORS.orange],
      null,
    ]);
    expect(markerToneColor('orange')).toBe(COLORS.orange);
  });

  it('anchors the labels inside the plot: first to the right, last to the left', () => {
    const data = view(lineOption(props())).series[0]?.markLine?.data ?? [];
    expect(data.map((d) => d.label.align)).toEqual(['left', 'center', 'center', 'right']);
    expect(data.map((d) => d.label.formatter)).toEqual(MARKERS.map((m) => m.label));
    expect(data.every((d) => d.label.color === COLORS.textSecondary)).toBe(true);
    expect(data.every((d) => d.label.show === true)).toBe(true);
  });

  it('shows the dots only when a marker asks for it', () => {
    const dotsOnly = MARKERS.map((m) => ({ ...m, labelHidden: true }));
    const data = view(lineOption(props({ markers: dotsOnly }))).series[0]?.markLine?.data ?? [];
    expect(data.every((d) => d.label.show === false)).toBe(true);
  });

  it('keeps a lane above the values for the dots and room above the plot for the labels', () => {
    const o = view(lineOption(props()));
    expect(o.grid.top).toBe(MARKER_GRID_TOP);
    expect(o.yAxis.max).toBeGreaterThan(800_000);
    // The lane's top is not a round figure: no tick label there.
    expect(o.yAxis.axisLabel.showMaxLabel).toBe(false);
    expect(markerAxisMax([-50_000, 100_000])).toBeCloseTo(121_000, 6);
    const plain = view(lineOption(props({ markers: [] })));
    expect(plain.yAxis.max).toBeUndefined();
    expect(plain.series[0]?.markLine).toBeUndefined();
    expect(plain.series).toHaveLength(2);
  });

  it('drops markers outside the categories and duplicate indexes', () => {
    const kept = visibleMarkers(
      [
        { index: 9, label: 'Out', tone: 'teal' },
        { index: 2, label: 'B', tone: 'violet' },
        { index: 0, label: 'A', tone: 'teal' },
        { index: 2, label: 'Again', tone: 'fuchsia' },
      ],
      YEARS.length,
    );
    expect(kept.map((m) => m.label)).toEqual(['A', 'B']);
  });

  it('names the milestone in the crosshair tooltip', () => {
    const o = view(lineOption(props()));
    const at = (dataIndex: number): string => o.tooltip.formatter([{ seriesIndex: 0, dataIndex }]);
    expect(at(1)).toContain('2031 · FIRE starts');
    expect(at(4)).toContain('2034 · Top-ups end 2034');
    expect(at(2)).toContain('>2032<');
  });

  it('renders the marker lines, dots and labels as SVG', () => {
    const svg = renderSvg(lineOption(props()));
    for (const marker of MARKERS) expect(svg).toContain(marker.label);
    expect(svg.toLowerCase()).toContain(COLORS.violet.toLowerCase());
    expect(svg.toLowerCase()).toContain(COLORS.orange.toLowerCase());
    expect(svg).toMatch(/stroke-dasharray/);
    expect(svg).not.toMatch(/filter|drop-shadow/);
  });

  it('renders on an area chart too', () => {
    const svg = renderSvg(areaOption(props()));
    expect(svg).toContain('FIRE 2031');
  });
});

describe('lineOption: dashed series', () => {
  it('draws a dashed stroke and a dashed legend key', () => {
    const p = props({
      markers: undefined,
      series: [
        { name: 'Projected pre-super', data: PRE },
        { name: 'Needed to stop that year', data: SUPER, color: CHART_PALETTE[2], dashed: true },
      ],
    });
    const o = view(lineOption(p));
    expect(o.series[0]?.lineStyle.type).toBe('solid');
    expect(o.series[1]?.lineStyle.type).toBe('dashed');
    expect(lineLegend(p).map((l) => l.key)).toEqual(['line', 'dashed-line']);
    expect(lineLegend({ ...p, series: p.series.slice(0, 1) })).toEqual([]);
  });
});

describe('lineOption: the compact money axis', () => {
  it('passes compactMoneyFormatter through compactAxisFormatter for the data extent', () => {
    const o = view(lineOption(props({ axisFormatter: compactMoneyFormatter })));
    expect(o.yAxis.axisLabel.formatter(800_000)).toBe(compactMoneyFormatter(800_000));
    const custom = (v: number): string => `v${v}`;
    const c = view(lineOption(props({ axisFormatter: custom })));
    expect(c.yAxis.axisLabel.formatter(3)).toBe('v3');
  });
});
