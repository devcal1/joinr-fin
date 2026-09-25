// ui-core: the app shell (sidebar, drawer, header, footer) and the core gallery. Desktop + phone.
import { expect, test, type Page } from '@playwright/test';
import { expectGalleryItems, expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

const CORE_ITEMS = [
  'AppShell',
  'PageHeader',
  'SectionBar',
  'Card',
  'Grid',
  'Callout',
  'KeyValueTable',
  'ColumnTable',
  'StatTile',
  'StatusBadge',
  'Pill',
  'StepCard',
  'ImageFrame',
  'Icon',
  'Button',
  'TextField',
  'MoneyField',
  'NumberField',
  'DateField',
  'Select',
  'Checkbox',
  'Switch',
  'Formatters',
] as const;

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Open navigation' });

test.describe('app shell', () => {
  test('frame: spectrum rules, running header, footer, landmarks', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/stocks');
    await expect(page.getByRole('heading', { level: 1, name: 'Stocks' })).toBeVisible();
    const banner = page.getByRole('banner');
    await expect(banner.getByText('Stocks', { exact: true })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('Joinr Finance v');
    await expect(page.getByRole('contentinfo')).not.toContainText('ABN');
    await expect(page.locator('.jf-shell__rule--top')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Portfolio value' })).toBeVisible();
    // The top spectrum rule stays fixed at the top of the viewport while the page scrolls.
    const ruleBox = await page.locator('.jf-shell__rule--top').boundingBox();
    expect(ruleBox).toMatchObject({ y: 0, height: 4 });
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'ui-core', 'stocks');
    expect(errors).toEqual([]);
  });

  test('skip link is the first tab stop and targets main', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'keyboard check on desktop');
    await page.goto('/stocks');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('desktop: sidebar visible, active item marked', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'desktop layout');
    await page.goto('/stocks');
    await expect(mainNav(page)).toBeVisible();
    await expect(menuButton(page)).toBeHidden();
    const current = mainNav(page).locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Stocks');
    await expect(mainNav(page).getByRole('link', { name: 'Style guide' })).toBeVisible();

    await mainNav(page).getByRole('link', { name: 'Budget' }).click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Budget' })).toBeVisible();
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText('Budget');
    await expect(page).toHaveTitle('Budget · Joinr Finance');
  });

  test('tablet (768px): drawer nav, no page scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'sized explicitly');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/cash');
    await expect(menuButton(page)).toBeVisible();
    await expect(mainNav(page)).toBeHidden();
    // Freshness (stage-1.md §6.6): the empty text, or a live line once data is imported.
    await expect(page.getByRole('banner').locator('.jf-shell__freshness')).toHaveText(
      /^(No prices yet|Prices (\d{2}:\d{2}|\d{2}\/\d{2}\/\d{4})) · (No snapshots yet|Snapshot [A-Z][a-z]{2} \d{4})$/,
    );
    await expectNoHorizontalScroll(page);
    await menuButton(page).click();
    await expect(mainNav(page)).toBeVisible();
    await shot(page, testInfo, 'ui-core', 'tablet-drawer');
    await page.keyboard.press('Escape');
    await expect(mainNav(page)).toBeHidden();
  });

  test('phone: the drawer opens and closes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone layout');
    await page.goto('/stocks');
    await expectNoHorizontalScroll(page);
    const menu = menuButton(page);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(mainNav(page)).toBeHidden();

    // Open, then close with Escape: focus returns to the menu button.
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(mainNav(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await shot(page, testInfo, 'ui-core', 'drawer-open');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(mainNav(page)).toBeHidden();
    await expect(menu).toBeFocused();

    // Open, then close with a tap outside the drawer.
    await menu.click();
    await expect(mainNav(page)).toBeVisible();
    await page.mouse.click(360, 600);
    await expect(mainNav(page)).toBeHidden();

    // Open, then follow a link: the drawer closes and the page changes.
    await menu.click();
    await mainNav(page).getByRole('link', { name: 'Dividends' }).click();
    await expect(page).toHaveURL(/\/dividends$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dividends' })).toBeVisible();
    await expect(mainNav(page)).toBeHidden();
    await expectNoHorizontalScroll(page);
  });

  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    test(`phone ${size.width}×${size.height}: the drawer fills the height and every link can be scrolled to`, async ({
      page,
    }) => {
      test.skip(test.info().project.name !== 'phone', 'phone layout');
      await page.setViewportSize(size);
      await page.goto('/stocks');
      await menuButton(page).click();
      const nav = mainNav(page);
      await expect(nav).toBeVisible();
      // The drawer spans the viewport top to bottom (it used to shrink to its content).
      const { navHeight, innerHeight } = await nav.evaluate((el) => ({
        navHeight: el.clientHeight,
        innerHeight: window.innerHeight,
      }));
      expect(navHeight).toBe(innerHeight);
      // The page behind is scroll-locked, so the list scrolls inside the drawer.
      await page.mouse.move(100, size.height / 2);
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
      const last = nav.getByRole('link', { name: 'Style guide' });
      await expect(last).toBeInViewport({ ratio: 1 });
      await expect(nav.getByRole('link', { name: 'Settings' })).toBeInViewport();
    });
  }

  test('desktop: a short page fits the viewport, footer included', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'desktop layout');
    // Short pages = routes that still render PlaceholderPage. /stocks left this list when Stage 2
    // built it; swap in another placeholder when a later stage builds one of these.
    for (const path of ['/fire', '/budget']) {
      await page.goto(path);
      // Measure only once the placeholder has rendered, and fail plainly if the page is built now.
      await expect(page.getByRole('main').getByRole('note'), path).toContainText(
        'arrives in Stage',
      );
      const { scrollHeight, innerHeight } = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(scrollHeight, path).toBe(innerHeight);
      await expect(page.getByRole('contentinfo')).toBeInViewport({ ratio: 1 });
    }
  });

  test('phone: the running header keeps to one row, freshness below', async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'phone layout');
    await page.goto('/managed-funds');
    const title = page.locator('.jf-shell__title');
    const menu = await menuButton(page).boundingBox();
    const titleBox = await title.boundingBox();
    const fresh = await page.locator('.jf-shell__freshness').boundingBox();
    expect(menu && titleBox && fresh).toBeTruthy();
    if (!menu || !titleBox || !fresh) return;
    // The page name sits on the menu button's row; the freshness line sits below it.
    expect(Math.abs(titleBox.y + titleBox.height / 2 - (menu.y + menu.height / 2))).toBeLessThan(4);
    expect(fresh.y).toBeGreaterThanOrEqual(menu.y + menu.height - 1);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('core gallery', () => {
  test('every core item renders, with no page scroll', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/styleguide');
    await expect(page.getByRole('heading', { level: 1, name: /style guide/i })).toBeVisible();
    await expectGalleryItems(page, CORE_ITEMS);
    await expectNoHorizontalScroll(page);
    await page.locator('#core').scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'ui-core', 'styleguide');
    expect(errors).toEqual([]);
  });

  test('the wide ColumnTable scrolls inside its own box', async ({ page }, testInfo) => {
    await page.goto('/styleguide');
    const item = page.locator('[data-gallery-item="ColumnTable"]');
    await item.scrollIntoViewIfNeeded();
    const box = item.locator('.jf-table__scroll').first();
    const { scrollWidth, clientWidth } = await box.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    if (testInfo.project.name === 'phone') {
      expect(scrollWidth).toBeGreaterThan(clientWidth);
      // Scrollable, so reachable by keyboard and named by its caption.
      await expect(box).toHaveAttribute('tabindex', '0');
      await expect(box).toHaveAttribute('role', 'region');
      await box.evaluate((el) => el.scrollBy({ left: 240 }));
      await expect.poll(() => box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      // The first column stays in place while the rest scrolls under it.
      const first = box.getByRole('rowheader', { name: 'ABC' });
      const boxLeft = (await box.boundingBox())?.x ?? 0;
      expect(Math.abs(((await first.boundingBox())?.x ?? -99) - boxLeft)).toBeLessThan(2);
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'ui-core', 'columntable-scrolled');
    } else {
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
  });

  test('ColumnTable sorts from the header and sets aria-sort', async ({ page }) => {
    await page.goto('/styleguide');
    const table = page.getByRole('table', { name: 'Example holdings' });
    await table.scrollIntoViewIfNeeded();
    const header = table.getByRole('columnheader', { name: /Value/ });
    await expect(header).not.toHaveAttribute('aria-sort');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(table.getByRole('rowheader').first()).toHaveText('XYZ');
    // The total row keeps its single teal key figure.
    await expect(table.locator('.jf-table__key')).toHaveCount(1);
  });

  test('MoneyField formats on blur and flags bad input', async ({ page }) => {
    await page.goto('/styleguide');
    const field = page.getByRole('textbox', { name: 'Balance', exact: true });
    await field.scrollIntoViewIfNeeded();
    await expect(field).toHaveValue('12,480.00');
    await field.fill('2500.5');
    await field.blur();
    await expect(field).toHaveValue('2,500.50');
    await field.fill('12.345');
    await field.blur();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter an amount like 1,234.56').first()).toBeVisible();
  });
});
