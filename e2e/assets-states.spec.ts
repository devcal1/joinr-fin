// Fixture-only assets states in a real browser (stage-4.md §7.8 step 4): the page API is answered
// from the @joinr/schema fixtures (mockAssetsPage), so no data is touched. Screenshots at 1440
// (desktop) and 375 (phone) of every §3.6 state; asserts the h1, no console errors and no
// page-level horizontal scroll; then every form opens (screenshots for the style review).
// Drafted by web phase A; the Integrator finishes it.
import { expect, test } from '@playwright/test';
import type {
  OtherAssetsPageResponse,
  PropertyPageResponse,
  SuperPageResponse,
} from '../packages/schema/src/dto/assets';
import {
  otherAssetsPages,
  propertyPages,
  superPages,
} from '../packages/schema/src/fixtures/assets';
import { cashPages } from '../packages/schema/src/fixtures/cashflow';
import { ASSETS_PAGES, mockAssetsPage, type AssetsRoute } from './assets-support';
import { mockCashflowPage } from './cashflow-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

type AnyPage = OtherAssetsPageResponse | SuperPageResponse | PropertyPageResponse;

const STATES: readonly { route: AssetsRoute; name: string; fixture: AnyPage }[] = [
  ...Object.entries(otherAssetsPages).map(([name, fixture]) => ({
    route: 'other-assets' as const,
    name,
    fixture,
  })),
  ...Object.entries(superPages).map(([name, fixture]) => ({
    route: 'super' as const,
    name,
    fixture,
  })),
  ...Object.entries(propertyPages).map(([name, fixture]) => ({
    route: 'property' as const,
    name,
    fixture,
  })),
];

test.describe('assets states (fixtures)', () => {
  for (const { route, name, fixture } of STATES) {
    test(`${route}: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockAssetsPage(page, route, fixture);
      const { path, title, keyTile } = ASSETS_PAGES[route];
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: keyTile, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'assets', `state-${route}-${name}`);
      expect(errors).toEqual([]);
    });
  }

  test('other assets: update prices, the item, sale and settings forms open', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockAssetsPage(page, 'other-assets', otherAssetsPages.populated);
    await page.goto('/other-assets');
    await page.getByRole('button', { name: 'Update prices' }).click();
    await expect(page.getByRole('form', { name: 'Update prices' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Price, Example watch', exact: true }).fill('1900');
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'assets', 'form-update-prices');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add asset' }).click();
    await expect(page.getByRole('form', { name: 'Add asset' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-asset');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Sell Example camera' }).click();
    await expect(page.getByRole('form', { name: 'Sell · Example camera' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-sale');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit settings for this page' }).click();
    await expect(page.getByRole('form', { name: 'Edit settings for this page' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'assets', 'form-other-assets-settings');
    expect(errors).toEqual([]);
  });

  test('super: balances, the fund, contribution, statement and option-note forms open', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockAssetsPage(page, 'super', superPages.populated);
    await page.goto('/super');
    await page.getByRole('button', { name: 'Update balances' }).click();
    await expect(page.getByRole('form', { name: 'Update balances' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-super-balances');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add fund' }).click();
    await expect(page.getByRole('form', { name: 'Add fund' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-fund');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add contribution' }).click();
    await expect(page.getByRole('form', { name: 'Add contribution' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-contribution');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Enter a statement for Aug 2026' }).click();
    await expect(page.getByRole('form', { name: 'Statement · Aug 2026' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-sg-statement');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Option note for Sep 2026' }).click();
    await expect(page.getByRole('form', { name: 'Investment option note' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'assets', 'form-option-note');
    expect(errors).toEqual([]);
  });

  test('property: values, balances, the property, loan, entry and offsets forms open', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockAssetsPage(page, 'property', propertyPages.populated);
    await page.goto('/property');
    await page.getByRole('button', { name: 'Update values' }).click();
    await expect(page.getByRole('form', { name: 'Update values' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-update-values');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Update balances' }).click();
    await expect(page.getByRole('form', { name: 'Update balances' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-loan-balances');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add property' }).click();
    await expect(page.getByRole('form', { name: 'Add property' })).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-property');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit Example property mortgage' }).click();
    await expect(
      page.getByRole('form', { name: 'Edit loan · Example property mortgage' }),
    ).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-loan');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page
      .getByRole('button', { name: 'Update the balance of Example property mortgage' })
      .click();
    await expect(
      page.getByRole('form', { name: 'Update balance · Example property mortgage' }),
    ).toBeVisible();
    await shot(page, testInfo, 'assets', 'form-loan-entry');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page
      .getByRole('button', { name: 'Link offset accounts to Example property mortgage' })
      .click();
    await expect(
      page.getByRole('form', { name: 'Offset accounts · Example property mortgage' }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'assets', 'form-offsets');
    expect(errors).toEqual([]);
  });

  test('cash: the offset account’s linked loan and the Offsets detail line (§6.6)', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockCashflowPage(page, 'cash', cashPages.populated);
    await page.goto('/cash');
    await page.getByRole('button', { name: 'Edit Offset account' }).click();
    const form = page.getByRole('form', { name: 'Edit account · Offset account' });
    await expect(form).toContainText('Linked to Example property mortgage');
    await shot(page, testInfo, 'assets', 'cash-offset-linked');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Details of Sep 2026' }).click();
    await expect(page.getByRole('table', { name: 'Parts of Sep 2026' })).toContainText('Offsets');
    await shot(page, testInfo, 'assets', 'cash-offsets-detail');
    expect(errors).toEqual([]);
  });
});
