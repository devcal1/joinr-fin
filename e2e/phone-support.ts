// Shared e2e helpers for Settings → Phone (stage-9.md §8.3). `mockPhone` answers `GET /api/phone`
// from a fixture (the rest of the API stays live) and refuses every phone write in the browser, so
// the fixture states touch no data. Screenshots go to artifacts/screenshots/stage9/web/.
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { PhoneSectionResponse } from '../packages/schema/src/dto/phone';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

export const SETTINGS_PATH = '/settings';
export const PHONE_API = '/api/phone';
export const PAIR_API = '/api/mobile/pair';
export const TODAY_API = '/api/mobile/today';

/** The widths each project checks: the owner's browser (1707) and the two desktop shots, or 375. */
export const PHONE_WIDTHS = { desktop: [1707, 1440, 1024], phone: [375] } as const;

/** True in a project with the phone viewport (its width is the only one checked). */
export function isPhoneProject(testInfo: TestInfo): boolean {
  return testInfo.project.use.isMobile === true;
}

export function widthsFor(testInfo: TestInfo): readonly number[] {
  return isPhoneProject(testInfo) ? PHONE_WIDTHS.phone : PHONE_WIDTHS.desktop;
}

/** The Phone section (a region labelled by its section bar). */
export function phoneSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Phone', exact: true });
}

/** A shot of the whole page or of one locator, under artifacts/screenshots/stage9/web/. */
export async function stage9Shot(
  target: Page | Locator,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
): Promise<string> {
  const file = path.join(
    REPO_ROOT,
    'artifacts',
    'screenshots',
    'stage9',
    'web',
    `${testInfo.project.name}-${name}.png`,
  );
  if ('goto' in target) await target.screenshot({ path: file, fullPage });
  else await target.screenshot({ path: file });
  return file;
}

/**
 * Answers `GET /api/phone` with `body`; every phone write is aborted and counted (a fixture state
 * must never reach the server). Returns the live count.
 */
export async function mockPhone(
  page: Page,
  body: PhoneSectionResponse,
): Promise<{ writes: () => number }> {
  let writes = 0;
  await page.route(
    (url) => url.pathname === PHONE_API || url.pathname.startsWith(`${PHONE_API}/`),
    async (route) => {
      if (
        route.request().method() === 'GET' &&
        new URL(route.request().url()).pathname === PHONE_API
      ) {
        await route.fulfill({ status: 200, contentType: 'application/json', json: body });
        return;
      }
      writes += 1;
      await route.abort();
    },
  );
  return { writes: () => writes };
}

/** The device-key headers the app sends (§4.2: both, the same key). */
export function keyHeaders(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'x-joinr-key': key };
}

/** An error body's code (the Stage 0 shape). */
export async function errorCode(response: { json(): Promise<unknown> }): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

/** Opens Settings at a width (desktop) and waits for the Phone section's lead line. */
export async function openSettings(page: Page, width: number | null): Promise<Locator> {
  if (width !== null) await page.setViewportSize({ width, height: 900 });
  await page.goto(SETTINGS_PATH);
  const section = phoneSection(page);
  await expect(section).toContainText("today's change in your holdings");
  return section;
}

/** Brings the section into view (for a viewport-sized shot of it). */
export async function reveal(section: Locator): Promise<void> {
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
}
