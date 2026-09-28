// Fixture-only Net Worth, History and Settings states in a real browser (stage-5.md §7.8 step 4):
// the page API is answered from the @joinr/schema fixtures (mockHistoryPage), so no data is
// touched. Screenshots at 1440 (desktop) and 375 (phone) of every §3.6 state; asserts the h1, no
// console errors and no page-level horizontal scroll; then the History forms and cards open
// (screenshots for the style review).
// Drafted by web phase A; the Integrator finishes it.
import { expect, test } from '@playwright/test';
import type { HistoryPageResponse, NetWorthPageResponse } from '../packages/schema/src/dto/history';
import type { SettingsPageResponse } from '../packages/schema/src/dto/settings';
import {
  historyPages,
  netWorthPages,
  settingsPages,
} from '../packages/schema/src/fixtures/history';
import { HISTORY_PAGES, mockHistoryPage, type HistoryRoute } from './history-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

type AnyPage = NetWorthPageResponse | HistoryPageResponse | SettingsPageResponse;

const STATES: readonly { route: HistoryRoute; name: string; fixture: AnyPage }[] = [
  ...Object.entries(netWorthPages).map(([name, fixture]) => ({
    route: 'net-worth' as const,
    name,
    fixture,
  })),
  ...Object.entries(historyPages).map(([name, fixture]) => ({
    route: 'history' as const,
    name,
    fixture,
  })),
  ...Object.entries(settingsPages).map(([name, fixture]) => ({
    route: 'settings' as const,
    name,
    fixture,
  })),
];

test.describe('history states (fixtures)', () => {
  for (const { route, name, fixture } of STATES) {
    test(`${route}: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockHistoryPage(page, route, fixture);
      const { path, title } = HISTORY_PAGES[route];
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, route === 'net-worth' ? 'networth' : route, `state-${name}`);
      expect(errors).toEqual([]);
    });
  }

  test('history: the record form, Details and Correct open', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await mockHistoryPage(page, 'history', historyPages.populated);
    await page.goto('/history');
    await page.getByRole('button', { name: 'Record month' }).click();
    await expect(page.getByRole('form', { name: 'Record month' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'history', 'form-record');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Details of Jun 2026' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Jun 2026 details' })).toBeVisible();
    await shot(page, testInfo, 'history', 'card-details');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Correct Mar 2026' }).click();
    await expect(page.getByRole('form', { name: 'Correct Mar 2026' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'history', 'form-correct-imported');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Correct Jun 2026' }).click();
    await expect(page.getByRole('form', { name: 'Correct Jun 2026' })).toBeVisible();
    await shot(page, testInfo, 'history', 'form-correct-recorded');
    expect(errors).toEqual([]);
  });

  test('settings: the tax suggestion bands and the pay form', async ({ page }, testInfo) => {
    // Five full Settings loads, each with a full-page shot: the page grew with the NAS block
    // (Stage 8), and under the full suite the loop ran past the default 30 s (7.5 s alone).
    test.setTimeout(90_000);
    for (const name of ['populated', 'taxShadeIn', 'taxNoLevy', 'taxLito', 'noSalary'] as const) {
      await mockHistoryPage(page, 'settings', settingsPages[name]);
      // A goto that changes only the hash does not reload the page (nor refetch the mock), so
      // leave the app between states.
      await page.goto('about:blank');
      await page.goto('/settings#pay');
      await expect(page.getByRole('heading', { level: 2, name: 'Pay and tax' })).toBeVisible();
      // Each state shows its own suggestion: the levy bands two buttons, no levy one, no salary
      // none (§6.5 item 3).
      const suggestion = settingsPages[name].taxSuggestion;
      const card = page.getByTestId('tax-suggestion');
      if (suggestion === null) {
        await expect(page.getByTestId('tax-suggestion-none')).toBeVisible();
        await expect(card).toHaveCount(0);
      } else {
        const buttons = suggestion.medicare.band === 'none' ? 1 : 2;
        await expect(card.getByRole('button', { name: /^(Use|In use)/ })).toHaveCount(buttons);
      }
      await shot(page, testInfo, 'settings', `tax-${name}`);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
