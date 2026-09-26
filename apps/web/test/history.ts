// Helpers for the Stage 5 page tests (stage-5.md §7.7 step 3): mock the Net Worth, History, series
// and Settings routes (the @joinr/schema fixtures by default) and the import runs, and read chart
// legends as class colours.
import type {
  HistoryPageResponse,
  HistorySeriesResponse,
  NetWorthPageResponse,
  SettingsPageResponse,
} from '@joinr/schema';
import {
  historyPages,
  importRunsPopulated,
  netWorthPages,
  settingsPages,
} from '@joinr/schema/fixtures';
import { mockApi, type MockHandler } from './mockApi';

export type PageBody<T> = T | MockHandler;

function asHandler(value: unknown): MockHandler {
  return typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'status' in value && !('asOf' in value))
    ? (value as MockHandler)
    : { body: value };
}

export interface OverviewMocks {
  netWorth?: PageBody<NetWorthPageResponse>;
  history?: PageBody<HistoryPageResponse>;
  series?: PageBody<HistorySeriesResponse>;
  settings?: PageBody<SettingsPageResponse>;
  routes?: Record<string, MockHandler>;
}

/** Stubs the Stage 5 GETs (defaults: the populated fixtures) and `/api/import/runs`. */
export function mockOverview(options: OverviewMocks = {}) {
  return mockApi({
    'GET /api/net-worth': asHandler(options.netWorth ?? netWorthPages.populated),
    'GET /api/history': asHandler(options.history ?? historyPages.populated),
    'GET /api/settings': asHandler(options.settings ?? settingsPages.populated),
    'GET /api/import/runs': { body: importRunsPopulated },
    ...(options.series ? { 'GET /api/history/series': asHandler(options.series) } : {}),
    ...options.routes,
  });
}
