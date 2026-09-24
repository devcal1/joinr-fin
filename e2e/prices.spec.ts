// Prices (stage-1.md §6.5, §7.6 phase B), with MARKET_DATA_MODE=fake (Playwright default).
// Refreshing and manual prices mutate shared data, so they run on desktop only; both projects
// check the read-only views.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

function pricesTable(page: Page): Locator {
  return page.getByRole('table', { name: /^Prices of/ });
}

/** The row of a priced instrument by its symbol. */
function rowFor(page: Page, symbol: string): Locator {
  return pricesTable(page)
    .getByRole('row')
    .filter({ has: page.locator('.jf-app-instrument__symbol', { hasText: symbol }) });
}

test.describe('prices', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
  });

  test('refresh, then set and clear a manual price', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'mutates shared data');
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/prices');
    await expect(page.getByRole('heading', { level: 1, name: 'Prices' })).toBeVisible();
    await expect(page.getByText('Test prices', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByRole('note', { name: 'Prices refreshed' })).toContainText(/updated/, {
      timeout: 90_000,
    });
    // Held instruments with a price source are fresh after a fake refresh.
    await expect(pricesTable(page).getByText('Fresh').first()).toBeVisible();
    await shot(page, testInfo, 'prices', 'refreshed');

    // Pick the first fresh held row and override its price.
    const freshRow = pricesTable(page)
      .getByRole('row')
      .filter({ has: page.locator('.jf-badge[data-status="fresh"]') })
      .first();
    const symbol = (await freshRow.locator('.jf-app-instrument__symbol').textContent())?.trim();
    expect(symbol, 'a fresh instrument').toBeTruthy();
    if (!symbol) return;

    await page.getByRole('button', { name: `Set price for ${symbol}` }).click();
    const form = page.getByRole('form', { name: `Set price for ${symbol}` });
    await form.getByRole('textbox', { name: /Price \(AUD\)/ }).fill('12.34');
    await form.getByRole('textbox', { name: 'Note' }).fill('e2e manual price');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('note', { name: 'Saved' })).toContainText(
      `Manual price saved for ${symbol}.`,
    );
    await expect(rowFor(page, symbol).locator('.jf-badge')).toHaveText('Manual');
    await expect(rowFor(page, symbol)).toContainText('$12.34');
    await shot(page, testInfo, 'prices', 'manual');

    await page.getByRole('button', { name: `Set price for ${symbol}` }).click();
    await form.getByRole('button', { name: 'Clear manual price' }).click();
    await expect(page.getByRole('note', { name: 'Saved' })).toContainText(
      `Manual price cleared for ${symbol}.`,
    );
    await expect(rowFor(page, symbol).locator('.jf-badge')).not.toHaveText('Manual');
    expect(errors).toEqual([]);
  });

  test('the prices page and the market series render', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/prices');
    await expect(page.getByRole('heading', { level: 1, name: 'Prices' })).toBeVisible();
    await expect(pricesTable(page)).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Held only' })).toBeChecked();
    const headers = await pricesTable(page).getByRole('columnheader').allTextContents();
    if (testInfo.project.name === 'phone') {
      // Status-first on a phone (D31): Price and Status show without scrolling sideways.
      expect(headers.slice(0, 4)).toEqual(['Instrument', 'Price', 'Status', 'Actions']);
      const viewport = page.viewportSize();
      const status = await pricesTable(page)
        .getByRole('columnheader', { name: 'Status' })
        .boundingBox();
      expect(status && viewport ? status.x + status.width : Infinity).toBeLessThanOrEqual(
        viewport?.width ?? 0,
      );
    } else {
      expect(headers.slice(0, 4)).toEqual(['Instrument', 'Kind', 'Held units', 'Price']);
    }
    const series = page.getByRole('table', { name: 'Market series' });
    await expect(series).toBeVisible();
    for (const label of ['AUD/USD', 'Silver (AUD/oz)', 'Gold (AUD/oz)']) {
      await expect(series.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'prices', 'page');
    expect(errors).toEqual([]);
  });
});
