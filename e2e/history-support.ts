// Shared e2e helpers for the Net Worth, History and Settings pages (stage-5.md §7.8 step 2).
// Drafted by web phase A; the Integrator owns and finishes them. Every month an e2e spec records
// carries E2E_NOTE in its note, so `cleanupHistoryRows` can remove what a crashed run left behind
// (a recorded month is app data and makes the Stage 1 import answer 409, D34/D84).
// `import.setup.ts` (Integrator) calls `cleanupHistoryRows` before the import.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { HistoryPageResponse, NetWorthPageResponse } from '../packages/schema/src/dto/history';
import type { SettingsPageResponse } from '../packages/schema/src/dto/settings';
import { E2E_NOTE } from './investments-support';

export { E2E_NOTE };

export type HistoryRoute = 'net-worth' | 'history' | 'settings';

export const HISTORY_PAGES: Readonly<
  Record<HistoryRoute, { path: string; title: string; api: string }>
> = {
  'net-worth': { path: '/', title: 'Net worth', api: '/api/net-worth' },
  history: { path: '/history', title: 'History', api: '/api/history' },
  settings: { path: '/settings', title: 'Settings', api: '/api/settings' },
};

export const HISTORY_ROUTES = Object.keys(HISTORY_PAGES) as HistoryRoute[];

export const isE2e = (text: string | null | undefined): boolean =>
  typeof text === 'string' && text.startsWith(E2E_NOTE);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08' → "Aug 2026" (the app's formatMonth; STYLE_GUIDE §8). */
export function monthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/**
 * Fails the run when a Stage 5 API is missing (the scaffold's 501 stubs, or an engine that still
 * throws): the specs must fail then, never skip.
 */
export async function expectHistoryApi(request: APIRequestContext): Promise<void> {
  for (const route of HISTORY_ROUTES) {
    const { api } = HISTORY_PAGES[route];
    const response = await request.get(api);
    expect(response.status(), `GET ${api}: ${await response.text()}`).toBe(200);
  }
}

async function mustGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as T;
}

export function netWorthPage(request: APIRequestContext): Promise<NetWorthPageResponse> {
  return mustGet<NetWorthPageResponse>(request, '/api/net-worth');
}

export function historyPage(request: APIRequestContext): Promise<HistoryPageResponse> {
  return mustGet<HistoryPageResponse>(request, '/api/history');
}

export function settingsPage(request: APIRequestContext): Promise<SettingsPageResponse> {
  return mustGet<SettingsPageResponse>(request, '/api/settings');
}

/**
 * Deletes every recorded month whose note starts with E2E_NOTE, latest first (only the latest
 * app-recorded month can be deleted, D92). Stops at the first latest month that is not an e2e
 * row. Safe with nothing to delete, and before any import (a page that does not answer 200 is
 * skipped).
 */
export async function cleanupHistoryRows(request: APIRequestContext): Promise<void> {
  for (let guard = 0; guard < 48; guard += 1) {
    const response = await request.get('/api/history');
    if (response.status() !== 200) return;
    const page = (await response.json()) as HistoryPageResponse;
    const latest = page.snapshots.find((s) => s.deletable);
    if (!latest || !isE2e(latest.note)) return;
    const removed = await request.delete(`/api/history/snapshots/${latest.periodMonth}`);
    expect([200, 404], await removed.text()).toContain(removed.status());
  }
}

/**
 * Renders a fixture-only state in a real browser: the page's GET answers `fixture` (the view
 * query too). No data is touched; the rest of the API (the header status) stays live.
 */
export async function mockHistoryPage(
  page: Page,
  route: HistoryRoute,
  fixture: NetWorthPageResponse | HistoryPageResponse | SettingsPageResponse,
): Promise<void> {
  const { api } = HISTORY_PAGES[route];
  await page.route(
    (url) => url.pathname === api,
    async (request) => {
      if (request.request().method() !== 'GET') return request.fallback();
      await request.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    },
  );
}

/**
 * The tables §6.8 checks from 768 to 1199 px: the first column holds a name or month, keeps at
 * least 200 px and never breaks a word. `open` reveals a table behind a Table toggle.
 */
export const WIDTH_CHECK_TABLES: readonly {
  path: string;
  name: RegExp;
  open?: { card: string };
}[] = [
  { path: '/', name: /^Assets and liabilities$/ },
  { path: '/', name: /^Liquid allocation$/ },
  { path: '/', name: /^Rolling net worth$/ },
  { path: '/history', name: /^Recorded months: / },
  { path: '/history', name: /^Audit trail$/ },
];

/** The tables that fit the 1152 px content area at 1440 px without inner scroll (§6.8). */
export const FIT_AT_1440_TABLES: readonly { path: string; name: RegExp }[] = [
  { path: '/', name: /^Assets and liabilities$/ },
  { path: '/', name: /^Liquid allocation$/ },
  { path: '/history', name: /^Consistency differences$/ },
];

/** The wide tables that may scroll inside their container at 1440 px, first column sticky. */
export const SCROLL_AT_1440_TABLES: readonly { path: string; name: RegExp }[] = [
  { path: '/', name: /^Rolling net worth$/ },
  { path: '/history', name: /^Recorded months: / },
];

/** The hero band's height in px (§6.3 item 2: 140–200 px at 1440). */
export async function heroHeight(page: Page): Promise<number> {
  const band = page.getByRole('region', { name: 'Net worth summary' });
  const box = await band.boundingBox();
  return box?.height ?? 0;
}
