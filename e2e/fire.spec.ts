// The FIRE page against the real API on the synthetic import (stage-6.md §7.5 step 4; desktop and
// phone, read-only): the h1, the tiles against `GET /api/fire`, both chart views render, the
// what-if changes the figures and saves nothing (every `fire.*` setting and `hasAppData`
// unchanged), the slider keys (arrows, Page Up/Down, Home/End) in Chromium, no horizontal page
// scroll, no console errors, screenshots. The synthetic workbook has the page switched off
// (features.fire false), so the page opens by its path under the "switched off" note.
// Drafted by web-fire (phase A); the Integrator finishes it against the real API.
import { expect, test } from '@playwright/test';
import { FIRE_PATH, firePage, fireSettings, stripText, yearsToFireText } from './fire-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, importRuns } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

test.describe('fire (read-only)', () => {
  test.beforeEach(() => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  });

  test('the page matches the API', async ({ page, request }, testInfo) => {
    const errors = trackConsoleErrors(page);
    const api = await firePage(request);
    await page.goto(FIRE_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'FIRE', exact: true })).toBeVisible();
    if (!api.featureOn) {
      await expect(page.getByRole('note', { name: 'Page switched off' })).toBeVisible();
    }
    if (api.isEmpty) {
      await expect(
        page.getByText('Import the workbook or add accounts to plan FIRE'),
      ).toBeVisible();
      return;
    }
    await expect(page.getByRole('group', { name: 'Years to FIRE' })).toContainText(
      yearsToFireText(api),
    );
    await expect(page.locator('.jf-app-fire-strip')).toHaveText(stripText(api));
    const card = page.getByRole('region', { name: 'Your path by year' });
    await expect(card.locator('svg').first()).toBeVisible();
    await card.getByRole('button', { name: 'Needed vs projected' }).click();
    await expect(card.getByRole('button', { name: 'Needed vs projected' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(card.locator('.jf-chart')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'fire', 'page');
    expect(errors).toEqual([]);
  });

  test('a what-if changes the figures and saves nothing', async ({ page, request }, testInfo) => {
    const errors = trackConsoleErrors(page);
    const before = await fireSettings(request);
    const runsBefore = await importRuns(request);
    await page.goto(FIRE_PATH);
    await expect(page.getByRole('heading', { level: 2, name: 'What if' })).toBeVisible();

    const whatIf = page.waitForRequest(
      (req) => req.url().includes('/api/fire?') && req.url().includes('withdrawalRate='),
    );
    const rate = page.getByRole('textbox', { name: 'Withdrawal rate' });
    await rate.fill('3');
    await rate.press('Enter');
    await whatIf;
    await expect(page.getByText('What-if (not saved)', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Saved: /).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'fire', 'whatif');

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('What-if (not saved)', { exact: true })).toHaveCount(0);
    expect(await fireSettings(request)).toEqual(before);
    expect((await importRuns(request)).hasAppData).toBe(runsBefore.hasAppData);
    expect(errors).toEqual([]);
  });

  test('the slider keys move the value', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the range keys are checked in Chromium');
    await page.goto(FIRE_PATH);
    const age = page.getByRole('slider', { name: 'Access age' });
    const field = page.getByRole('textbox', { name: 'Access age' });
    const start = Number(await field.inputValue());
    await age.focus();
    await page.keyboard.press('ArrowRight');
    await expect(field).toHaveValue(String(Math.min(start + 1, 75)));
    await page.keyboard.press('PageUp');
    await expect(field).toHaveValue(String(Math.min(start + 11, 75)));
    await page.keyboard.press('Home');
    await expect(field).toHaveValue(String(Math.min(55, start)));
    await page.keyboard.press('End');
    await expect(field).toHaveValue(String(Math.max(75, start)));
    await page.keyboard.press('PageDown');
    await expect(field).toHaveValue(String(Math.max(75, start) - 10));
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(field).toHaveValue(String(start));
  });
});
