// Fixture-only cash-flow states in a real browser (stage-3.md §7.8 step 4): the page API is
// answered from the @joinr/schema fixtures (mockCashflowPage), so no data is touched. Screenshots
// at 1440 (desktop) and 375 (phone) of every §3.6 state; asserts the h1, no console errors and no
// page-level horizontal scroll. Drafted by web phase A; the Integrator finishes it.
import { expect, test } from '@playwright/test';
import type {
  BudgetPageResponse,
  CashPageResponse,
  DividendsPageResponse,
  SideIncomePageResponse,
} from '../packages/schema/src/dto/cashflow';
import {
  budgetPages,
  cashPages,
  dividendsPages,
  sideIncomePages,
} from '../packages/schema/src/fixtures/cashflow';
import { investmentPageTiming } from '../packages/schema/src/fixtures/investments';
import { CASHFLOW_PAGES, mockCashflowPage, type CashflowRoute } from './cashflow-support';
import { mockInvestmentPage } from './investments-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

type AnyPage =
  CashPageResponse | SideIncomePageResponse | BudgetPageResponse | DividendsPageResponse;

const STATES: readonly { route: CashflowRoute; name: string; fixture: AnyPage }[] = [
  ...Object.entries(cashPages).map(([name, fixture]) => ({
    route: 'cash' as const,
    name,
    fixture,
  })),
  ...Object.entries(sideIncomePages).map(([name, fixture]) => ({
    route: 'side-income' as const,
    name,
    fixture,
  })),
  ...Object.entries(budgetPages).map(([name, fixture]) => ({
    route: 'budget' as const,
    name,
    fixture,
  })),
  ...Object.entries(dividendsPages).map(([name, fixture]) => ({
    route: 'dividends' as const,
    name,
    fixture,
  })),
];

test.describe('cash-flow states (fixtures)', () => {
  for (const { route, name, fixture } of STATES) {
    test(`${route}: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockCashflowPage(page, route, fixture);
      const { path, title, keyTile } = CASHFLOW_PAGES[route];
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: keyTile, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'cashflow', `state-${route}-${name}`);
      expect(errors).toEqual([]);
    });
  }

  test('cash: update balances, the account form and the adjustment form open', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockCashflowPage(page, 'cash', cashPages.populated);
    await page.goto('/cash');
    await page.getByRole('button', { name: 'Update balances' }).click();
    await expect(page.getByRole('form', { name: 'Update balances' })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Balance, Everyday account', exact: true })
      .fill('5300');
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'cashflow', 'form-update-balances');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit Loan to a friend' }).click();
    await expect(page.getByRole('form', { name: 'Edit account · Loan to a friend' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-account');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Adjust Jul 2026' }).click();
    await expect(page.getByRole('form', { name: 'Adjust Jul 2026' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-adjustment');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add goal' }).click();
    await expect(page.getByRole('form', { name: 'Add goal' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-goal');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit settings for this page' }).click();
    await expect(page.getByRole('form', { name: 'Edit settings for this page' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'cashflow', 'form-cash-settings');
    expect(errors).toEqual([]);
  });

  test('budget: the item, automatic-row (D54) and settings forms open', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockCashflowPage(page, 'budget', budgetPages.manualSplit);
    await page.goto('/budget');
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('form', { name: 'Add item' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-budget-item');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit budget row Investment savings (manual)' }).click();
    await expect(page.getByRole('textbox', { name: 'Amount per month' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-budget-auto-invest');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Edit income and settings' }).click();
    await expect(page.getByRole('form', { name: 'Edit income and settings' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'cashflow', 'form-budget-settings');
    expect(errors).toEqual([]);
  });

  test('side income and dividends: the deposit form and a confirmed suggestion', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockCashflowPage(page, 'side-income', sideIncomePages.populated);
    await page.goto('/side-income');
    await page.getByRole('button', { name: 'Add deposit' }).click();
    await expect(page.getByRole('form', { name: 'Add deposit' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'form-deposit');
    await mockCashflowPage(page, 'dividends', dividendsPages.suggestions);
    await page.goto('/dividends');
    await page
      .getByRole('button', { name: 'Confirm the suggestion ASX:XYZ ex-date 01/09/2026' })
      .click();
    await expect(
      page.getByRole('form', { name: 'Confirm · ASX:XYZ ex-date 01/09/2026' }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'cashflow', 'form-dividend-confirm');
    expect(errors).toEqual([]);
  });

  test('the next-buy card with the cash-deficit wait (Stage 3 §6.7)', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockInvestmentPage(page, investmentPageTiming.cash_deficit);
    await page.goto('/etfs');
    const card = page.getByRole('region', { name: 'Next buy' });
    await expect(card.getByTestId('next-buy-parcel')).toContainText(
      'while cash tops up to its target',
    );
    await expect(card.getByRole('link', { name: 'From your budget' })).toBeVisible();
    await shot(page, testInfo, 'cashflow', 'next-buy-cash-deficit');
    expect(errors).toEqual([]);
  });
});
