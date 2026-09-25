// Investment pages on the synthetic workbook (stage-2.md §7.6 step 4): read-only, desktop and
// phone. Drafted by web phase A; the Integrator runs and finishes it once the API has landed.
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  INVESTMENT_KINDS,
  KIND_PAGES,
  SYNTHETIC_EXITED_ETF,
  SYNTHETIC_HELD,
  expectInvestmentsApi,
  waitForPrices,
} from './investments-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

function holdingsTable(page: Page, title: string): Locator {
  return page.getByRole('table', { name: `${title} holdings`, exact: true });
}

/** The text of a row's cell under a column header. */
async function cellText(table: Locator, row: Locator, header: string): Promise<string> {
  const headers = (await table.getByRole('columnheader').allTextContents()).map((h) => h.trim());
  const index = headers.indexOf(header);
  expect(index, `column "${header}"`).toBeGreaterThanOrEqual(0);
  return ((await row.locator('th, td').nth(index).textContent()) ?? '').trim();
}

test.describe('investment pages', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await expectInvestmentsApi(request);
    await waitForPrices(request);
  });

  for (const kind of INVESTMENT_KINDS) {
    const { path, title } = KIND_PAGES[kind];

    test(`${path}: tiles, holdings, charts, FY table and trades`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Portfolio value' })).toBeVisible();

      const table = holdingsTable(page, title);
      await expect(table).toBeVisible();
      for (const symbol of SYNTHETIC_HELD[kind]) {
        await expect(table.getByRole('link', { name: symbol, exact: true })).toBeVisible();
      }

      // Each history card draws an svg, or says there is no history yet.
      for (const name of ['Value', 'Gain', 'Net purchases']) {
        const card = page.getByRole('region', { name, exact: true });
        await expect(
          card.locator('.jf-chart__host svg').first().or(card.getByText('No history yet')),
        ).toBeVisible();
      }

      await expect(
        page
          .getByRole('table', { name: 'Realised gains by financial year' })
          .or(page.getByText('No realised gains yet.')),
      ).toBeVisible();
      const trades = page.getByRole('table', { name: new RegExp(`^${title} trades: \\d+ rows?$`) });
      await expect(trades).toBeVisible();
      expect(await trades.locator('tbody tr').count()).toBeGreaterThan(0);

      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'investments', kind);
      expect(errors).toEqual([]);
    });

    test(`${path}: one holding's detail page`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await page.goto(path);
      const symbol = SYNTHETIC_HELD[kind][0] ?? '';
      await holdingsTable(page, title).getByRole('link', { name: symbol, exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: symbol, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('table', { name: 'Parcels', exact: true })).toBeVisible();
      await expect(
        page.getByRole('form', { name: `Holding settings for ${symbol}` }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'investments', `${kind}-detail`);
      expect(errors).toEqual([]);
    });
  }

  test('the trade and holding forms open on real data (nothing is saved)', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/etfs');
    await expect(holdingsTable(page, 'ETFs')).toBeVisible();

    // Trade form, amount mode: the preview shows the units the amount buys.
    await page.getByRole('button', { name: 'Add trade' }).click();
    let form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: 'ASX:DEF' });
    await form.getByRole('button', { name: 'Amount' }).click();
    await form.getByRole('textbox', { name: /^Amount/ }).fill('500');
    await expect(form.getByTestId('trade-preview')).toContainText('units');
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'investments', 'etf-trade-form-amount');
    // Units mode, as a sell (the "Held now" hint).
    await form.getByRole('button', { name: 'Units' }).click();
    await form.getByRole('button', { name: 'Sell' }).click();
    await form.getByRole('textbox', { name: /^Units/ }).fill('1');
    await expect(form.getByText(/^Held now: /)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'investments', 'etf-trade-form-units');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);

    // Holding form (create), not saved.
    await page.getByRole('button', { name: 'Add holding' }).click();
    await expect(page.getByRole('form', { name: 'Add ETF' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'investments', 'etf-holding-form');

    // Crypto trade form: the fee is a percentage.
    await page.goto('/crypto');
    await page.getByRole('button', { name: 'Add trade' }).click();
    form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: 'BTC' });
    await expect(form.getByRole('textbox', { name: /^Fee %/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'investments', 'crypto-trade-form');
    expect(errors).toEqual([]);
  });

  test('ETFs: the exited holding and its realised gain in its financial year', async ({ page }) => {
    await page.goto('/etfs');
    await page.getByText(/^Exited holdings \(\d+\)$/).click();
    const exited = page.getByRole('table', { name: 'Exited ETFs', exact: true });
    const row = exited.getByRole('row').filter({ hasText: SYNTHETIC_EXITED_ETF });
    await expect(row).toBeVisible();
    const realised = await cellText(exited, row, 'Realised');
    expect(realised).not.toBe('$0.00');

    const fyTable = page.getByRole('table', { name: 'Realised gains by financial year' });
    const lastTrade = await cellText(exited, row, 'Last trade'); // dd/mm/yyyy
    const [, month = '1', year = '2000'] = lastTrade.split('/');
    const start = Number(month) >= 7 ? Number(year) : Number(year) - 1;
    const label = `FY${start}–${String((start + 1) % 100).padStart(2, '0')}`;
    const fyRow = fyTable.getByRole('row').filter({ hasText: label });
    await expect(fyRow).toBeVisible();
    expect(await cellText(fyTable, fyRow, 'Total')).not.toBe('$0.00');
  });

  test('ETFs at 1440 px: record whether the holdings table overflows its container', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only');
    await page.goto('/etfs');
    const scroll = holdingsTable(page, 'ETFs').locator(
      'xpath=ancestor::div[contains(@class,"jf-table__scroll")][1]',
    );
    await expect(scroll).toBeVisible();
    const measure = () =>
      scroll.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    const off = await measure();
    await page.getByRole('switch', { name: 'More columns' }).click();
    const on = await measure();
    await page.getByRole('switch', { name: 'More columns' }).click(); // leave the choice off
    const describe = (m: { scrollWidth: number; clientWidth: number }) =>
      `${m.scrollWidth > m.clientWidth + 1 ? 'overflows' : 'fits'} (${m.scrollWidth}/${m.clientWidth} px)`;
    // Recorded, not asserted: the style reviewer judges it (§7.6 step 4).
    testInfo.annotations.push(
      { type: 'etf-table-more-columns-off', description: describe(off) },
      { type: 'etf-table-more-columns-on', description: describe(on) },
    );
    console.log(`ETF holdings table: more columns off ${describe(off)}; on ${describe(on)}`);
  });
});
