// Brand (stage-0 plan §6.5): header lockup, Net Worth hero band, brand screens, not-found, gallery.
// Runs on desktop (1440×900) and phone (375×812). Screenshots are the demo's key frames.
import { expect, test } from '@playwright/test';
import { SCREEN_VARIANTS } from '../apps/web/src/pages';
import { expectGalleryItems, expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

const BRAND_GALLERY = [
  'Wordmark',
  'BrandBlock',
  'HeroBand',
  ...SCREEN_VARIANTS.map((variant) => `BrandScreen/${variant}`),
];

const SCREEN_TITLES = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
  login: 'Sign in',
} as const;

test('the header shows the brand block: wordmark + FINANCE', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/');
  const header = page.getByRole('banner');
  const mark = header.getByRole('img', { name: 'joinr' });
  await expect(mark).toBeVisible();
  await expect(header.getByText('FINANCE', { exact: true })).toBeVisible();
  const box = await mark.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24); // STYLE_GUIDE §7.2 minimum
  // The full stop's gradient resolves (a broken url(#id) would paint nothing).
  const fill = await mark.locator('circle').evaluate((el) => getComputedStyle(el).fill);
  expect(fill).toMatch(/^url\("?#jf-wordmark-dot-/);
  expect(errors).toEqual([]);
});

test('Net Worth shows the hero band with four KPI tiles', async ({ page }, testInfo) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Net worth summary (sample figures)' });
  await expect(hero).toBeVisible();
  await expect(hero.getByRole('group')).toHaveCount(4);
  await expect(hero.getByRole('group', { name: 'Net worth' })).toContainText('$12,480');
  await expect(
    page.getByText('Sample figures. The live dashboard arrives in Stage 5.'),
  ).toBeVisible();

  // The node line and its four nodes stay visible above the tiles.
  const firstTile = await hero.getByRole('group').first().boundingBox();
  const nodes = hero.locator('[data-node]');
  await expect(nodes).toHaveCount(4);
  for (const node of await nodes.all()) {
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(firstTile?.y ?? 0);
  }
  const heroBox = await hero.boundingBox();
  // STYLE_GUIDE §7.2: 140–200px on desktop (the compact band); it grows to fit on narrow screens.
  if (testInfo.project.name === 'desktop') {
    expect(heroBox?.height ?? 0).toBeGreaterThanOrEqual(140);
    expect(heroBox?.height ?? 0).toBeLessThanOrEqual(200);
  }
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'brand', 'net-worth');
  expect(errors).toEqual([]);
});

for (const variant of SCREEN_VARIANTS) {
  test(`/preview/screen/${variant} fills the viewport`, async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`/preview/screen/${variant}`);
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 1, name: SCREEN_TITLES[variant] }),
    ).toBeVisible();
    const viewport = page.viewportSize();
    const box = await main.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.y).toBe(0);
    expect(box?.width).toBe(viewport?.width);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
    // No app shell around it.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(main.getByRole('img', { name: 'joinr' })).toBeVisible();
    if (variant === 'loading') await expect(page.getByRole('status')).toContainText('Loading');
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'brand', `screen-${variant}`);
    expect(errors).toEqual([]);
  });
}

test('the loading animation runs, and stops under reduced motion', async ({ page }) => {
  await page.goto('/preview/screen/loading');
  const node = page.locator('.jf-brand-loader__node').first();
  await expect(node).toBeVisible();
  const animationName = (): Promise<string> =>
    node.evaluate((el) => getComputedStyle(el).animationName);
  expect(await animationName()).toBe('jf-brand-node-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animationName()).toBe('none');
});

test('an unknown path shows the not-found screen, which links home', async ({ page }, testInfo) => {
  await page.goto('/definitely-not-a-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'brand', 'not-found');
  await page.getByRole('link', { name: 'Back to Net Worth' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: /net worth/i })).toBeVisible();
});

test('the style guide shows every brand item', async ({ page }, testInfo) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/styleguide');
  await expectGalleryItems(page, BRAND_GALLERY);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'brand', 'styleguide');
  expect(errors).toEqual([]);
});
