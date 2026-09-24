// Charts gallery (charts owner): every chart renders an SVG at both widths, the ChartCard toggle
// shows the table, empty/loading states render, tooltips stay inside the chart, and the page
// never scrolls sideways.
import { expect, test, type Page } from '@playwright/test';
import { expectGalleryItems, expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

/** The stage-0 plan §7 inventory for charts. */
const INVENTORY = [
  'DonutChart',
  'BarChart',
  'BarChart/stacked',
  'BarChart/gain-loss',
  'LineChart',
  'AreaChart',
  'GaugeChart',
  'ChartCard',
] as const;

/** Extra items shown in the gallery. */
const EXTRAS = [
  'Palette',
  'BarChart/horizontal',
  'AreaChart/stacked',
  'Chart/empty',
  'Chart/loading',
] as const;

/** Items that open on the chart view and must draw an SVG. */
const PLOTTED = [
  'DonutChart',
  'BarChart',
  'BarChart/stacked',
  'BarChart/gain-loss',
  'BarChart/horizontal',
  'LineChart',
  'AreaChart',
  'AreaChart/stacked',
  'GaugeChart',
] as const;

const item = (page: Page, name: string) => page.locator(`[data-gallery-item="${name}"]`);

test.describe('charts gallery', () => {
  test('every chart renders an SVG with an accessible name', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/styleguide');
    await expectGalleryItems(page, [...INVENTORY, ...EXTRAS]);

    for (const name of PLOTTED) {
      const host = item(page, name).locator('.jf-chart__host').first();
      await host.scrollIntoViewIfNeeded();
      await expect(host, name).toHaveAttribute('role', 'img');
      await expect(host, name).toHaveAttribute('aria-label', /\S/);
      const svg = host.locator('svg').first();
      await expect(svg, name).toBeVisible();
      const box = await svg.boundingBox();
      expect(box?.width ?? 0, `${name} svg width`).toBeGreaterThan(150);
      expect(box?.height ?? 0, `${name} svg height`).toBeGreaterThan(150);
    }

    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
    await shot(page, testInfo, 'charts', 'styleguide');
  });

  test('the Chart | Table toggle shows the numbers', async ({ page }, testInfo) => {
    await page.goto('/styleguide');
    const donut = item(page, 'DonutChart');
    await donut.scrollIntoViewIfNeeded();
    const tableButton = donut.getByRole('button', { name: 'Table' });
    const chartButton = donut.getByRole('button', { name: 'Chart' });
    await expect(chartButton).toHaveAttribute('aria-pressed', 'true');

    await tableButton.click();
    await expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    await expect(chartButton).toHaveAttribute('aria-pressed', 'false');
    await expect(donut.getByRole('table')).toBeVisible();
    await expect(donut.locator('.jf-chart__host')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await donut.screenshot({
      path: testInfo.outputPath('donut-table.png'),
    });

    await chartButton.focus();
    await page.keyboard.press('Enter');
    await expect(donut.locator('.jf-chart__host svg')).toBeVisible();

    // The ChartCard exhibit opens on the table view.
    const card = item(page, 'ChartCard');
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole('table')).toBeVisible();
    await card.getByRole('button', { name: 'Chart' }).click();
    await expect(card.locator('.jf-chart__host svg')).toBeVisible();
    await shot(page, testInfo, 'charts', 'toggled');
  });

  test('empty and loading states keep the chart footprint', async ({ page }) => {
    await page.goto('/styleguide');
    const empty = item(page, 'Chart/empty');
    await empty.scrollIntoViewIfNeeded();
    await expect(empty.getByText('Add a holding to see your allocation.')).toBeVisible();

    const loading = item(page, 'Chart/loading');
    await loading.scrollIntoViewIfNeeded();
    await expect(loading.getByRole('status')).toHaveText('Loading chart…');
    await expect(loading.locator('[data-state="refreshing"]')).toHaveAttribute('aria-busy', 'true');
  });

  test('legends wrap as text and tooltips stay inside the chart', async ({ page }) => {
    await page.goto('/styleguide');
    const donut = item(page, 'DonutChart');
    await donut.scrollIntoViewIfNeeded();
    const legend = donut.getByRole('list', { name: 'Legend' });
    await expect(legend.getByRole('listitem')).toHaveText([
      'Australian shares',
      'International shares',
      'Property',
      'Cash',
    ]);

    const line = item(page, 'LineChart');
    const host = line.locator('.jf-chart__host');
    await host.scrollIntoViewIfNeeded();
    const box = await host.boundingBox();
    if (!box) throw new Error('line chart has no box');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    const tooltip = line.locator('.jf-chart-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Net worth');
    await expect(tooltip).toContainText('$');
    const tip = await tooltip.boundingBox();
    expect(tip && tip.x >= box.x - 16 && tip.x + tip.width <= box.x + box.width + 16).toBe(true);
    await expectNoHorizontalScroll(page);
  });
});
