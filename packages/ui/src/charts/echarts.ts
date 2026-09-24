// Tree-shaken ECharts: only the charts and components Joinr uses, rendered as SVG.
// Never `import 'echarts'` (it pulls in every chart type).
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { init, registerTheme, use as installModules, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { CHART_THEME_NAME, JOINR_CHART_THEME } from './theme';

let registered = false;

/** Registers the modules and the 'joinr' theme once. Safe to call repeatedly. */
export function registerJoinrCharts(): void {
  if (registered) return;
  installModules([
    PieChart,
    BarChart,
    LineChart,
    GaugeChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    AriaComponent,
    SVGRenderer,
  ]);
  registerTheme(CHART_THEME_NAME, JOINR_CHART_THEME);
  registered = true;
}

/** Creates an SVG-rendered chart with the 'joinr' theme in `dom`. */
export function initChart(dom: HTMLElement): EChartsType {
  registerJoinrCharts();
  return init(dom, CHART_THEME_NAME, { renderer: 'svg' });
}

export type { EChartsType };
