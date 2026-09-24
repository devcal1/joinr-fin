// Shared Playwright helpers (Scaffolder).
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** The page itself must never scroll sideways (STYLE_GUIDE §3, §10). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page scrolls horizontally').toBeLessThanOrEqual(clientWidth);
}

/** Full-page screenshot to artifacts/screenshots/<project>/<role>-<name>.png. */
export async function shot(
  page: Page,
  testInfo: TestInfo,
  role: string,
  name: string,
): Promise<string> {
  const file = path.join(
    REPO_ROOT,
    'artifacts',
    'screenshots',
    testInfo.project.name,
    `${role}-${name}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Every `[data-gallery-item="<name>"]` is attached, and visible once scrolled into view. */
export async function expectGalleryItems(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const item = page.locator(`[data-gallery-item="${name}"]`);
    await expect(item, `gallery item "${name}"`).toBeAttached();
    await item.scrollIntoViewIfNeeded();
    await expect(item, `gallery item "${name}"`).toBeVisible();
  }
}

/** Collects console errors and uncaught page errors; assert the array is empty at the end. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}
