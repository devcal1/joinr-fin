// FIRE settings saved through the what-if (stage-6.md §7.5 step 4, D100, D103). Runs only in the
// `fire-mutations` Playwright project (desktop viewport, after `history-mutations`; the desktop
// and phone projects ignore it). It writes only the two app-only keys (extra savings and the FIRE
// market return) and sets both back to null afterwards; every FIRE key is a preference, so
// `hasAppData` stays false (D103). Assertions read `/api/fire` rather than fixed sources.
// Drafted by web-fire (phase A); the Integrator finishes it against the real API.
import { expect, test } from '@playwright/test';
import { FIRE_PATH, firePage, resetFireAppOnlyKeys } from './fire-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'fire-mutations';

test.describe('fire mutations', () => {
  const active = (project: string): boolean => project === PROJECT && SYNTHETIC_IMPORT_READY;

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'runs in the fire-mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await resetFireAppOnlyKeys(request);
  });

  test.afterAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await resetFireAppOnlyKeys(request);
  });

  test('Save as my settings writes the FIRE keys and keeps the import open', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await firePage(request);
    expect(before.inputs.extraSavings.source).not.toBe('setting');
    expect(before.inputs.marketReturn.settingKey).toBe('returns.marketReturn');

    await page.goto(FIRE_PATH);
    await expect(page.getByRole('heading', { level: 2, name: 'What if' })).toBeVisible();
    const extra = page.getByRole('textbox', { name: 'Extra savings a year' });
    await extra.fill('5000');
    await extra.press('Enter');
    const market = page.getByRole('textbox', { name: 'Market return' });
    await market.fill('6.5');
    await market.press('Enter');
    await expect(
      page.getByText('Saves: market return 6.5% · extra savings a year $5,000'),
    ).toBeVisible();

    const saved = page.waitForResponse(
      (res) => res.url().endsWith('/api/settings') && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save as my settings' }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      values: { 'fire.marketReturn': '0.065', 'fire.extraSavingsPerYearCents': 500_000 },
    });
    await expect(page.getByRole('heading', { level: 2, name: 'What if' })).toBeFocused();
    await expect(page.getByText('What-if (not saved)', { exact: true })).toHaveCount(0);

    const after = await firePage(request);
    expect(after.inputs.extraSavings).toMatchObject({ cents: 500_000, source: 'setting' });
    expect(after.inputs.marketReturn).toMatchObject({
      ratio: '0.065',
      settingKey: 'fire.marketReturn',
    });
    // D103: every FIRE key is a preference, so the workbook can still be re-imported.
    expect((await importRuns(request)).hasAppData).toBe(false);
    expect(after.hasAppData).toBe(false);

    await resetFireAppOnlyKeys(request);
    const reset = await firePage(request);
    expect(reset.inputs.extraSavings.source).not.toBe('setting');
    expect(reset.inputs.marketReturn.settingKey).toBe('returns.marketReturn');
    expect(errors).toEqual([]);
  });
});
