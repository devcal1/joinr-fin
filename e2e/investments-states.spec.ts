// Fixture-only investment states in a real browser (stage-2.md §7.6 step 5): the page API is
// answered from @joinr/schema fixtures (mockInvestmentPage), so no data is touched. Screenshots at
// 1440 (desktop) and 375 (phone) for the style reviewer; asserts the h1, no console errors and no
// page-level horizontal scroll (§6.7). Drafted by web phase A; the Integrator finishes it.
import { expect, test, type Locator } from '@playwright/test';
import type { InvestmentPageResponse } from '../packages/schema/src/dto/investments';
import {
  investmentPageAllUnpriced,
  investmentPageEmpty,
  investmentPageNulls,
  investmentPageTiming,
  investmentPageUnpriced,
  investmentPages,
} from '../packages/schema/src/fixtures/investments';
import { KIND_PAGES, mockInvestmentPage } from './investments-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

/** The browser-wide Units / Amount key used before D47 (apps/web …/investments/storage.ts). */
const LEGACY_KEY = 'joinr.investments.entryMode';

const STATES: readonly { name: string; fixture: InvestmentPageResponse }[] = [
  { name: 'timing-wait', fixture: investmentPageTiming.wait },
  { name: 'timing-invest', fixture: investmentPageTiming.invest },
  { name: 'timing-cash-first', fixture: investmentPageTiming.cash_first },
  { name: 'timing-unavailable', fixture: investmentPageTiming.unavailable },
  { name: 'timing-below-emergency-fund', fixture: investmentPageTiming.below_emergency_fund },
  { name: 'timing-no-targets', fixture: investmentPageTiming.no_targets },
  { name: 'timing-split-off', fixture: investmentPageTiming.split_off },
  { name: 'unpriced', fixture: investmentPageUnpriced },
  { name: 'all-unpriced', fixture: investmentPageAllUnpriced },
  { name: 'nulls', fixture: investmentPageNulls },
  { name: 'empty', fixture: investmentPageEmpty('etf') },
];

test.describe('investment states (fixtures)', () => {
  for (const { name, fixture } of STATES) {
    test(`state: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockInvestmentPage(page, fixture);
      const { path, title } = KIND_PAGES[fixture.kind];
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      // Let the page settle (tiles, or the empty callout) before the screenshot.
      await expect(
        page
          .getByRole('group', { name: 'Portfolio value' })
          .or(page.getByText(/ yet\. Add a holding/)),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'investments', `state-${name}`);
      expect(errors).toEqual([]);
    });
  }

  test('the trade form open on a ledger with an oversold row', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockInvestmentPage(page, investmentPages.stock);
    await page.goto('/stocks');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Stocks', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^Oversold \d/).first()).toBeAttached();
    await page.getByRole('button', { name: 'Add trade' }).click();
    const form = page.getByRole('form', { name: 'Add trade' });
    await expect(form).toBeVisible();
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: 'ASX:ABC' });
    await form.getByRole('button', { name: 'Sell' }).click();
    await shot(page, testInfo, 'investments', 'state-trade-form-oversold-ledger');
    expect(errors).toEqual([]);
  });

  test('the trade form in amount mode and with a crypto % fee', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockInvestmentPage(page, investmentPages.etf);
    await page.goto('/etfs');
    await page.getByRole('button', { name: 'Add trade' }).click();
    let form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: 'ASX:DEF' });
    await form.getByRole('textbox', { name: /^Amount/ }).fill('500');
    await expect(form.getByTestId('trade-preview')).toContainText('units');
    await shot(page, testInfo, 'investments', 'state-trade-form-amount');

    await page.unrouteAll();
    await mockInvestmentPage(page, investmentPages.crypto);
    await page.goto('/crypto');
    await page.getByRole('button', { name: 'Add trade' }).click();
    form = page.getByRole('form', { name: 'Add trade' });
    await form.getByRole('combobox', { name: /Holding/ }).selectOption({ label: 'BTC' });
    await form.getByRole('textbox', { name: /^Units/ }).fill('0.01');
    await expect(form.getByRole('textbox', { name: /^Fee %/ })).toBeVisible();
    await shot(page, testInfo, 'investments', 'state-trade-form-crypto');
    expect(errors).toEqual([]);
  });

  test('the Units / Amount choice is remembered per holding (D47)', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // A choice left under the old browser-wide key is ignored, and removed when the form opens.
    await page.addInitScript((key) => window.localStorage.setItem(key, 'units'), LEGACY_KEY);
    await mockInvestmentPage(page, investmentPages.etf);
    await page.goto('/etfs');
    const addTrade = page.getByRole('button', { name: 'Add trade' });
    const holding = (form: Locator) => form.getByRole('combobox', { name: /Holding/ });

    // An explicit Units click on ASX:MNO (a $10 default fee)…
    await addTrade.click();
    let form = page.getByRole('form', { name: 'Add trade' });
    await holding(form).selectOption({ label: 'ASX:MNO' });
    await form.getByRole('button', { name: 'Units' }).click();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)).toBeNull();
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);

    // …leaves the $0-fee ASX:DEF in its own default, Amount; ASX:MNO keeps its Units.
    await addTrade.click();
    form = page.getByRole('form', { name: 'Add trade' });
    await holding(form).selectOption({ label: 'ASX:DEF' });
    await expect(form.getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await holding(form).selectOption({ label: 'ASX:MNO' });
    await expect(form.getByRole('button', { name: 'Units' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(errors).toEqual([]);
  });

  test('the holding form (create)', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockInvestmentPage(page, investmentPages.etf);
    await page.goto('/etfs');
    await page.getByRole('button', { name: 'Add holding' }).click();
    await expect(page.getByRole('form', { name: 'Add ETF' })).toBeVisible();
    await shot(page, testInfo, 'investments', 'state-holding-form');
    expect(errors).toEqual([]);
  });
});
