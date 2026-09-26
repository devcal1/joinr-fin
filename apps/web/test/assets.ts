// Helpers for the assets page tests (stage-4.md §7.7 step 3): mock the three page routes (the
// @joinr/schema fixtures by default) and the import runs (`hasAppData`), and read legend colours.
import type {
  ImportRunsResponse,
  OtherAssetsPageResponse,
  PropertyPageResponse,
  SuperPageResponse,
} from '@joinr/schema';
import {
  importRunsPopulated,
  otherAssetsPages,
  propertyPages,
  superPages,
} from '@joinr/schema/fixtures';
import { mockApi, type MockHandler } from './mockApi';

export type PageBody<T> = T | MockHandler;

function asHandler(value: unknown): MockHandler {
  return typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'status' in value && !('asOf' in value))
    ? (value as MockHandler)
    : { body: value };
}

export interface AssetsMocks {
  otherAssets?: PageBody<OtherAssetsPageResponse>;
  super?: PageBody<SuperPageResponse>;
  property?: PageBody<PropertyPageResponse>;
  /** Default: imported data, no app data (the new-app-row note shows). */
  importRuns?: PageBody<ImportRunsResponse>;
  routes?: Record<string, MockHandler>;
}

/** Stubs the three assets GETs and `/api/import/runs` (defaults: the populated fixtures). */
export function mockAssets(options: AssetsMocks = {}) {
  return mockApi({
    'GET /api/other-assets': asHandler(options.otherAssets ?? otherAssetsPages.populated),
    'GET /api/super': asHandler(options.super ?? superPages.populated),
    'GET /api/property': asHandler(options.property ?? propertyPages.populated),
    'GET /api/import/runs': asHandler(options.importRuns ?? importRunsPopulated),
    ...options.routes,
  });
}

/** A chart card's legend: each entry's name and its key's colour, in order. */
export function legendOf(card: HTMLElement): { name: string; color: string }[] {
  return [...card.querySelectorAll<HTMLElement>('.jf-chart__legend-item')].map((item) => ({
    name: item.textContent?.trim() ?? '',
    color: item.querySelector<HTMLElement>('.jf-chart__legend-key')?.style.backgroundColor ?? '',
  }));
}

/** '#07AE8B' → 'rgb(7, 174, 139)' (jsdom reports inline colours as rgb()). */
export function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
