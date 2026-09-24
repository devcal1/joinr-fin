// @joinr/ui charts (stage-0 plan §7.6): palette, theme, the EChart wrapper, chart components,
// ChartCard and the pure option builders.

export type {
  AreaChartProps,
  BarChartProps,
  ChartCardProps,
  ChartLegendItem,
  ChartStateProps,
  Datum,
  DonutChartProps,
  EChartProps,
  GaugeChartProps,
  LineChartProps,
  Series,
  ValueFormatter,
} from './types';

export {
  AREA_OPACITY,
  CHART_GAIN,
  CHART_LOSS,
  CHART_OTHER,
  CHART_PALETTE,
  DONUT_MAX_SEGMENTS,
  seriesColor,
} from './palette';
export { JOINR_CHART_THEME } from './theme';
export {
  compactMoneyFormatter,
  formatChartNumber,
  moneyFormatter,
  percentFormatter,
  type MoneyFormatterOptions,
} from './format';

export { EChart } from './EChart';
export { AreaChart, BarChart, DonutChart, GaugeChart, LineChart } from './ChartComponents';
export { ChartCard } from './ChartCard';

export { barLegend, barOption } from './options/bar';
export { donutLegend, donutOption, donutSlices, type DonutSlice } from './options/donut';
export { gaugeOption } from './options/gauge';
export { areaOption, lineLegend, lineOption } from './options/line';
