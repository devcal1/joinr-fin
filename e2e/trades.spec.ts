// Trade and holding mutations through the UI (stage-2.md §7.6 step 6). Runs only in the
// `mutations` Playwright project (desktop viewport, after every other spec), because the app rows
// it creates would make the Stage 1 import spec answer 409 (D34) if both ran at once. Every row
// it creates carries E2E_NOTE, and afterAll removes them. Drafted by web phase A; the Integrator
// adds the project to playwright.config.ts and finishes the spec.
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_NOTE,
  cleanupE2eRows,
  expectInvestmentsApi,
  investmentPage,
  waitForPrices,
} from './investments-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

const DEF = 'ASX:DEF';
const NEW_SYMBOL = 'ASX:ZZZ';
/** How Chromium logs the deliberate 422 of the oversell step. */
const OVERSELL_RESOURCE_ERROR =
  'console: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)';

test.describe.configure({ mode: 'serial' });

function etfTable(page: Page): Locator {
  return page.getByRole('table', { name: 'ETFs holdings', exact: true });
}

function rowFor(table: Locator, symbol: string): Locator {
  return table
    .locator('tbody tr')
    .filter({ has: table.page().getByRole('link', { name: symbol, exact: true }) });
}

async function cellText(table: Locator, row: Locator, header: string): Promise<string> {
  const headers = (await table.getByRole('columnheader').allTextContents()).map((h) => h.trim());
  const index = headers.indexOf(header);
  expect(index, `column "${header}"`).toBeGreaterThanOrEqual(0);
  return ((await row.locator('th, td').nth(index).textContent()) ?? '').trim();
}

/** The held units of a holding, as the page shows them (commas removed). */
async function unitsOf(page: Page, symbol: string): Promise<number> {
  const table = etfTable(page);
  return Number((await cellText(table, rowFor(table, symbol), 'Units')).replace(/,/g, ''));
}

test.describe('trades and holdings (mutating)', () => {
  const active = (project: string): boolean => project === 'mutations' && SYNTHETIC_IMPORT_READY;

  test.beforeAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupE2eRows(request);
  });

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'mutations', 'runs in the mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await expectInvestmentsApi(request);
    await waitForPrices(request);
  });

  test.afterAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupE2eRows(request);
    // Nothing the spec did counts as app data once its rows are gone (§7.6 step 6.8).
    expect((await importRuns(request)).hasAppData).toBe(false);
  });

  test('a default-fee-only change is not app data', async ({ page, request }) => {
    const errors = trackConsoleErrors(page);
    const etfs = await investmentPage(request, 'etf');
    const def = etfs.holdings.find((h) => h.symbol === DEF);
    expect(def, `${DEF} in the synthetic workbook`).toBeDefined();
    await page.goto(`/etfs/${def?.instrumentId}`);
    await page.getByRole('button', { name: 'Edit holding' }).click();
    const form = page.getByRole('form', { name: `Holding settings for ${DEF}` });
    const global = form.getByRole('checkbox', { name: 'Use the global default fee' });
    if (await global.isChecked()) await global.uncheck();
    await form.getByRole('textbox', { name: 'Default fee', exact: true }).fill('0');
    const save = form.getByRole('button', { name: 'Save' });
    // A second run finds the $0 default already saved: the form stays pristine.
    if (await save.isEnabled()) {
      await expect(form.getByRole('note', { name: 'Workbook holding' })).toHaveCount(0);
      await save.click();
      // The holding form's own result, beside the form (not the page's trade notices).
      await expect(page.getByRole('status', { name: 'Holding save result' })).toContainText(
        'Holding saved',
      );
    }
    expect((await importRuns(request)).hasAppData).toBe(false);
    expect(errors).toEqual([]);
  });

  test('add (amount mode), edit, oversell and delete a trade', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/etfs');
    await expect(etfTable(page)).toBeVisible();
    const startUnits = await unitsOf(page, DEF);
    const valueTile = page.getByRole('group', { name: 'Portfolio value' });
    const startValue = await valueTile.textContent();

    // Add: the $0 default fee and Amount mode come pre-filled.
    await page.getByRole('button', { name: 'Add trade' }).click();
    let form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: DEF });
    await expect(form.getByRole('textbox', { name: /^Fee/ })).toHaveValue('0.00');
    await expect(form.getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await form.getByRole('button', { name: 'Buy' }).click();
    await form.getByRole('textbox', { name: /^Amount/ }).fill('500');
    const price = form.getByRole('textbox', { name: /Price per unit/ });
    await price.fill('50');
    await price.blur();
    await expect(form.getByTestId('trade-preview')).toContainText('≈ 10 units');
    await form.getByRole('textbox', { name: /^Note/ }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Trade added');
    await expect.poll(() => unitsOf(page, DEF)).toBeCloseTo(startUnits + 10, 6);
    await expect(valueTile).not.toHaveText(startValue ?? '');

    // Edit to 5 units.
    const ledger = page.getByRole('table', { name: /^ETFs trades: / });
    const row = ledger.locator('tbody tr').filter({ hasText: '$500.00' }).first();
    await row.getByRole('button', { name: /^Edit ASX:DEF trade of / }).click();
    form = page.getByRole('form', { name: /^Edit trade · ASX:DEF / });
    await form.getByRole('textbox', { name: /^Units/ }).fill('5');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Trade updated');
    await expect.poll(() => unitsOf(page, DEF)).toBeCloseTo(startUnits + 5, 6);

    // A sell of more than is held → the oversell message; nothing is saved.
    await page.getByRole('button', { name: 'Add trade' }).click();
    form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: DEF });
    await form.getByRole('button', { name: 'Sell' }).click();
    await form.getByRole('button', { name: 'Units' }).click();
    await form.getByRole('textbox', { name: /^Units/ }).fill(String(Math.ceil(startUnits + 100)));
    await form.getByRole('textbox', { name: /^Note/ }).fill(E2E_NOTE);
    const refused = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/trades',
    );
    await form.getByRole('button', { name: 'Save' }).click();
    expect((await refused).status()).toBe(422);
    await expect(form.getByRole('note', { name: 'Not saved' })).toContainText('only');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => unitsOf(page, DEF)).toBeCloseTo(startUnits + 5, 6);

    // Delete the trade → the units return to the start value.
    const added = ledger.locator('tbody tr').filter({ hasText: 'App' }).first();
    await added.getByRole('button', { name: /^Delete ASX:DEF trade of / }).click();
    await page.getByRole('button', { name: /^Delete the ASX:DEF trade of / }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Trade deleted');
    await expect.poll(() => unitsOf(page, DEF)).toBeCloseTo(startUnits, 6);
    // The browser logs the refused save (the 422 above) as a failed resource; nothing else.
    expect(errors.filter((e) => e !== OVERSELL_RESOURCE_ERROR)).toEqual([]);
    expect(errors.filter((e) => e === OVERSELL_RESOURCE_ERROR)).toHaveLength(1);
  });

  test('add a holding, see it as watching, then delete it', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/etfs');
    await page.getByRole('button', { name: 'Add holding' }).click();
    const form = page.getByRole('form', { name: 'Add ETF' });
    await form.getByRole('textbox', { name: /^Symbol/ }).fill(NEW_SYMBOL);
    await form.getByRole('textbox', { name: /^Note/ }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Holding saved');
    const row = rowFor(etfTable(page), NEW_SYMBOL);
    await expect(row).toBeVisible();
    expect(await cellText(etfTable(page), row, 'Value')).toBe('—');

    await row.getByRole('link', { name: NEW_SYMBOL, exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: NEW_SYMBOL, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete holding' }).click();
    const confirm = page.getByRole('note', { name: 'Delete holding' });
    await confirm.getByRole('button', { name: 'Delete holding' }).click();
    await expect(page).toHaveURL(/\/etfs$/);
    await expect(rowFor(etfTable(page), NEW_SYMBOL)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
