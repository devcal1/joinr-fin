// Smoke test (Scaffolder): dev stack up, every route renders, 404 works. Runs on desktop + phone.
import { expect, test } from '@playwright/test';
import { PAGES, STYLEGUIDE_PAGE } from '../apps/web/src/pages';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

const SHELL_PAGES = [...PAGES, STYLEGUIDE_PAGE].map(({ path, title }) => ({ path, title }));

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('/api/health responds through the web origin', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

for (const { path, title } of SHELL_PAGES) {
  test(`shell page ${path} renders`, async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(`^${escapeRegExp(title)}$`, 'i') }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('net worth page: no horizontal scroll, screenshot', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'smoke', 'net-worth');
});

test('style guide: no horizontal scroll, screenshot', async ({ page }, testInfo) => {
  await page.goto(STYLEGUIDE_PAGE.path);
  await expect(page.getByRole('heading', { level: 1, name: /style guide/i })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'smoke', 'styleguide');
});

test('an unknown path shows "Page not found"', async ({ page }) => {
  await page.goto('/definitely-not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Net Worth' })).toBeVisible();
});
