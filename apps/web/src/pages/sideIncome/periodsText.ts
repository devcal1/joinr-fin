// The side-income chart's empty states (STYLE-15, stage-6.md §6.9 C).
import type { SideIncomePageResponse } from '@joinr/schema';

export const CHART_NO_STREAMS = 'No side income yet. Add a deposit to start.';
export const CHART_NO_RECORDED_PERIOD =
  'Side income is grouped by recorded month; it appears after the first recorded month.';

/**
 * The chart's empty message (it shows only when there is nothing to draw): no recorded period yet
 * (the chart groups by recorded month), else no side income at all (no stream, or no deposit).
 */
export function chartEmptyMessage(page: SideIncomePageResponse): string {
  if (!page.charts.points.some((p) => !p.live)) return CHART_NO_RECORDED_PERIOD;
  if (page.streams.length === 0 || page.deposits.length === 0) return CHART_NO_STREAMS;
  return 'No side income yet';
}
