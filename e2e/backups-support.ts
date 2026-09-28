// Shared e2e helpers for the Settings Backups and About sections (stage-7.md §6.8). Drafted by
// web-backups (phase A); run against the real API in phase B. `mockBackups` answers
// `GET /api/backups` from a fixture (the rest of the API stays live), so the fixture states touch no
// data; `mockStatus` does the same for `/api/status` (the stale-backup callout).
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { BackupFileDto, BackupsResponse } from '../packages/schema/src/dto/backups';
import type { AppStatus } from '../packages/schema/src/dto/status';

export const SETTINGS_PATH = '/settings';
export const BACKUPS_API = '/api/backups';
export const STATUS_API = '/api/status';

/** Rows shown before "Show all" (§6.2 item 5). */
export const BACKUPS_SHOWN = 12;

/** The viewports the fixture states are shot at (the project's own, plus 1024 on desktop). */
export const BACKUPS_WIDTHS = { desktop: [1440, 1024], phone: [375] } as const;

async function mustGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

/** `GET /api/backups`; fails the run on a missing route (never skips). */
export function backupsList(request: APIRequestContext): Promise<BackupsResponse> {
  return mustGet<BackupsResponse>(request, BACKUPS_API);
}

/** `GET /api/health`'s version and database level. */
export async function health(
  request: APIRequestContext,
): Promise<{ version: string; migrations: number | null }> {
  const body = await mustGet<{ version: string; db: { migrations: number | null } }>(
    request,
    '/api/health',
  );
  return { version: body.version, migrations: body.db.migrations };
}

/** The download URL the page must link to (the name encoded: `+` → `%2B`). */
export function downloadPath(name: string): string {
  return `${BACKUPS_API}/${encodeURIComponent(name)}`;
}

/** The Backups section (a region labelled by its section bar). */
export function backupsSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Backups', exact: true });
}

/** The About section. */
export function aboutSection(page: Page): Locator {
  return page.getByRole('region', { name: 'About', exact: true });
}

/** The backups table's download link for a file (matched by its `title`, the file name). */
export function downloadLink(page: Page, name: string): Locator {
  return page.locator(`[data-testid="backups-table"] a[title="${name}"]`);
}

/** The body rows of the backups table. */
export function backupRows(page: Page): Locator {
  return page.locator('[data-testid="backups-table"] tbody tr');
}

/** Opens every row ("Show all <n> backups") when the list is longer than 12. */
export async function showAllBackups(page: Page): Promise<void> {
  const more = backupsSection(page).getByRole('button', { name: /^Show all \d+ backups?$/ });
  if ((await more.count()) > 0) {
    await more.click();
    await expect(
      backupsSection(page).getByRole('button', { name: `Show the newest ${BACKUPS_SHOWN}` }),
    ).toHaveAttribute('aria-expanded', 'true');
  }
}

/** The newest file of a kind in a list (the list is newest first). */
export function newestOfKind(
  list: BackupsResponse,
  kind: BackupFileDto['kind'],
): BackupFileDto | undefined {
  return list.backups.find((file) => file.kind === kind);
}

/** The schedule line the page must show for a schedule (§6.2 item 1; never hard-coded). */
export function scheduleLine(schedule: BackupsResponse['schedule']): string {
  const at = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
  const where = `${at} (${schedule.timeZone})`;
  return schedule.enabled
    ? `Nightly at ${where}`
    : `Off (turned off in the server settings); would run at ${where}`;
}

/**
 * Renders a fixture-only Backups state in a real browser: `GET /api/backups` answers `fixture`
 * (with the server version set to `version`, so no version note shows unless the fixture is the
 * mismatch). POSTs and downloads stay live (the states spec never clicks them).
 */
export async function mockBackups(page: Page, fixture: BackupsResponse): Promise<void> {
  await page.route(
    (url) => url.pathname === BACKUPS_API,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    },
  );
}

/** `/api/status` answers `status` (the stale-backup callout on every page). */
export async function mockStatus(page: Page, status: AppStatus): Promise<void> {
  await page.route(
    (url) => url.pathname === STATUS_API,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(status),
      });
    },
  );
}

/** A fixture with its server version set (equal to the web build's unless testing a mismatch). */
export function withServerVersion(fixture: BackupsResponse, version: string): BackupsResponse {
  return { ...fixture, app: { ...fixture.app, version } };
}

/** The table's own scroll width against its box (D109: the inner scroll width ≤ its container). */
export async function tableFits(page: Page): Promise<{ scroll: number; client: number }> {
  return page
    .locator('[data-testid="backups-table"] .jf-table__scroll')
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
}

// ─── Stage 8: the weekly copy to the NAS (stage-8.md §8.7; D132: no heartbeat) ───────────────────

/** "Copy to NAS now" (202; 409 while the NAS files are not ready). */
export const NAS_COPY_API = '/api/backups/nas-copy';

/** The "Copy to the NAS" block (a group labelled by its subheading, inside Backups). */
export function nasCopyBlock(page: Page): Locator {
  return page.getByRole('group', { name: 'Copy to the NAS', exact: true });
}

/** The block's "Copy to NAS now" button (or "Copying…" while a copy runs). */
export function nasCopyButton(page: Page): Locator {
  return nasCopyBlock(page).getByRole('button', { name: /^(Copy to NAS now|Copying…)$/ });
}

/** The KV table's own scroll width against its box (D109: the inner width ≤ its container). */
export async function nasTableFits(page: Page): Promise<{ scroll: number; client: number }> {
  return nasCopyBlock(page)
    .getByRole('table')
    .evaluate((el) => {
      const box = el.parentElement ?? el;
      return { scroll: el.scrollWidth, client: box.clientWidth };
    });
}

/** Counts the POSTs the page sends to `NAS_COPY_API` (answered 500, never reaching the server). */
export async function countNasCopyPosts(page: Page): Promise<() => number> {
  let posts = 0;
  await page.route(
    (url) => url.pathname === NAS_COPY_API,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'not expected in this test' } }),
      });
    },
  );
  return () => posts;
}
