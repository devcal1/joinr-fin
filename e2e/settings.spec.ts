// The Settings page on the synthetic import (stage-5.md §7.8 step 3), desktop and phone,
// read-only: the h1, every group as a reference section, `/settings#super` scrolls to its group
// and focuses its heading after load, a page's Settings link lands on its group, no page-level
// horizontal scroll, no console errors, screenshots. Nothing is saved here. Stage 7 (stage-7.md §6.8):
// the Backups and About sections follow the groups, and the auto-record help names no stage.
// Stage 8 (stage-8.md §8.2): the "Copy to the NAS" subheading sits in Backups; no "Stage 8" text.
// Drafted by web phase A; finished by the Integrator against the real API.
import { expect, test } from '@playwright/test';
import { SETTING_GROUPS } from '../packages/schema/src/settings';
import { expectHistoryApi, settingsPage } from './history-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
  await expectHistoryApi(request);
});

test('Settings: every group', async ({ page, request }, testInfo) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Settings', exact: true }),
  ).toBeVisible();
  for (const group of SETTING_GROUPS) {
    await expect(
      page.getByRole('heading', { level: 2, name: group.label, exact: true }),
    ).toBeVisible();
  }
  for (const name of ['Backups', 'About']) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('heading', { level: 3, name: 'Copy to the NAS', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Stage 7');
  await expect(page.getByRole('main')).not.toContainText('Stage 8');
  // The auto-record note shows before the cutover (no app data yet).
  if (!(await settingsPage(request)).hasAppData) {
    await expect(page.getByRole('main')).toContainText(
      'Switch this on when you stop using the workbook.',
    );
  }
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'settings', 'page');
  expect(errors).toEqual([]);
});

test('Settings: /settings#super scrolls to the group and focuses its heading', async ({ page }) => {
  await page.goto('/settings#super');
  const heading = page.getByRole('heading', { level: 2, name: 'Super', exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});

test('Settings: the Budget page links to its groups', async ({ page }) => {
  await page.goto('/budget');
  const links = page.getByTestId('settings-links');
  await expect(links).toContainText('In Settings: Pay and tax · Budget');
  await links.getByRole('link', { name: 'Budget', exact: true }).click();
  await expect(page).toHaveURL(/\/settings#budget$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Budget', exact: true })).toBeFocused();
});
