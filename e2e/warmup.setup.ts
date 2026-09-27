// Setup project (stage-6.md §7.8): warms the dev server before the desktop and phone projects run.
// Since Stage 6 every page route loads lazily (§6.1), so the first visit to a page makes Vite
// transform that page's modules (and may re-optimise a dependency and reload the tab). On a cold
// server that took longer than the specs' 5 s expect timeout, so the first test to open each page
// failed and passed only on a retry. Visiting every route once here pays that cost up front.
// Read-only: it only opens pages.
import { expect, test as setup } from '@playwright/test';
import { PAGES, STYLEGUIDE_PAGE } from '../apps/web/src/pages';

/** Every page route plus the lazy detail and records routes (their ids need not exist). */
const WARM_PATHS = [
  ...PAGES.map((page) => page.path),
  '/stocks/1',
  '/import/runs/1',
  '/records/trades',
  STYLEGUIDE_PAGE.path,
];

setup('warm the dev server: every lazy route loads once', async ({ page }) => {
  setup.setTimeout(300_000);
  for (const path of WARM_PATHS) {
    await page.goto(path);
    // Any h1 (the page's, or NotFound/ErrorPage for a detail id that does not exist yet) means
    // the route's chunk has loaded.
    await expect(page.locator('h1').first(), path).toBeVisible({ timeout: 60_000 });
  }
});
