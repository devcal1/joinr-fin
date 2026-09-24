// Renders every builder's option with the real (tree-shaken) ECharts, as SVG at an explicit size
// (server-side mode, no DOM layout needed), to prove the options are valid and draw marks.
import { init, type EChartsCoreOption } from 'echarts/core';
import { afterEach, describe, expect, it } from 'vitest';
import { COLORS } from '../core';
import { registerJoinrCharts } from './echarts';
import { barOption } from './options/bar';
import { donutOption } from './options/donut';
import { gaugeOption } from './options/gauge';
import { areaOption, lineOption } from './options/line';
import { CHART_PALETTE } from './palette';
import { CHART_THEME_NAME } from './theme';

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
});

function renderSvg(option: EChartsCoreOption): string {
  registerJoinrCharts();
  const chart = init(null, CHART_THEME_NAME, {
    renderer: 'svg',
    ssr: true,
    width: 480,
    height: 280,
  });
  disposers.push(() => chart.dispose());
  chart.setOption({ ...option, animation: false });
  return chart.renderToSVGString();
}

const has = (svg: string, hex: string): boolean => svg.toLowerCase().includes(hex.toLowerCase());
const MONTHS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];

describe('ECharts renders each option as SVG', () => {
  it('bar (stacked) and gain/loss', () => {
    const svg = renderSvg(
      barOption({
        ariaLabel: 'Income by source',
        categories: MONTHS,
        series: [
          { name: 'Salary', data: [5200, 5200, 5400] },
          { name: 'Side income', data: [600, 850, 720] },
        ],
        stacked: true,
      }),
    );
    expect(svg).toMatch(/^<svg/);
    expect(has(svg, CHART_PALETTE[0] ?? '')).toBe(true);
    expect(has(svg, CHART_PALETTE[1] ?? '')).toBe(true);
    expect(svg).toContain('Jan 2026');
    // Only the outermost segment gets the rounded data end (an arc in the path).
    expect(svg).toMatch(/fill="#7744DD"[^>]*/i);
    expect(svg).toMatch(/<path d="[^"]*A4 4[^"]*" fill="#7744DD"/i);
    expect(svg).not.toMatch(/<path d="[^"]*A4 4[^"]*" fill="#07AE8B"/i);

    const signed = renderSvg(
      barOption({
        ariaLabel: 'Change',
        categories: MONTHS,
        series: [{ name: 'Change', data: [1240, -620, 880] }],
        signColors: true,
      }),
    );
    expect(has(signed, COLORS.go)).toBe(true);
    expect(has(signed, COLORS.stop)).toBe(true);
  });

  it('line and stacked area', () => {
    const series = [
      { name: 'Shares', data: [5000, 5200, 5100] },
      { name: 'Cash', data: [2400, 2650, null] },
    ];
    const line = renderSvg(lineOption({ ariaLabel: 'Line', categories: MONTHS, series }));
    expect(line).toMatch(/<path[^>]+stroke="#07AE8B"/i);
    const area = renderSvg(
      areaOption({ ariaLabel: 'Area', categories: MONTHS, series, stacked: true }),
    );
    expect(area).toContain('fill-opacity');
    expect(has(area, CHART_PALETTE[1] ?? '')).toBe(true);
  });

  it('donut with target ring', () => {
    const svg = renderSvg(
      donutOption({
        ariaLabel: 'Allocation',
        data: [
          { label: 'Australian shares', value: 5200 },
          { label: 'Cash', value: 1400 },
        ],
        target: [
          { label: 'Australian shares', value: 5000 },
          { label: 'Cash', value: 1600 },
        ],
      }),
    );
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(has(svg, CHART_PALETTE[0] ?? '')).toBe(true);
    expect(svg).not.toMatch(/filter|drop-shadow/);
  });

  it('gauge with target tick', () => {
    const svg = renderSvg(gaugeOption({ ariaLabel: 'Savings rate', value: 0.074, target: 0.2 }));
    expect(has(svg, CHART_PALETTE[0] ?? '')).toBe(true);
    expect(has(svg, COLORS.textBright)).toBe(true);
  });
});
