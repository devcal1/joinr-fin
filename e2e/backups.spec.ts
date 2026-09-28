// The Settings Backups and About sections against the real API (stage-7.md §6.8), desktop and
// phone, read-only. It runs beside import.spec.ts's committed re-import (which writes a pre-import
// backup), so the list is compared with `expect.poll` and a fresh `GET /api/backups`, never with a
// fixed count. Under e2e the nightly schedule is off (NIGHTLY_BACKUPS=false in the webServer env),
// so the page shows the "Off …" text, which still names the time. Nothing is written here.
// Drafted by web-backups (phase A); run in phase B.
import { expect, test } from '@playwright/test';
import {
  SETTINGS_PATH,
  aboutSection,
  backupsList,
  backupsSection,
  downloadLink,
  downloadPath,
  health,
  scheduleLine,
  showAllBackups,
  tableFits,
} from './backups-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
});

test('Backups: the schedule, every file with its download link, no sideways scroll', async ({
  page,
  request,
}, testInfo) => {
  const errors = trackConsoleErrors(page);
  const before = await backupsList(request);
  await page.goto(SETTINGS_PATH);
  const section = backupsSection(page);
  await expect(
    section.getByRole('heading', { level: 2, name: 'Backups', exact: true }),
  ).toBeVisible();

  // The schedule line follows the API (never hard-coded); off under e2e, still naming the time.
  await expect(page.getByTestId('backups-schedule')).toHaveText(scheduleLine(before.schedule));
  const at = `${String(before.schedule.hour).padStart(2, '0')}:${String(before.schedule.minute).padStart(2, '0')}`;
  await expect(page.getByTestId('backups-schedule')).toContainText(at);
  if (!before.schedule.enabled) {
    await expect(page.getByTestId('backups-next')).toHaveText('Not scheduled');
  }
  await expect(section.getByRole('note', { name: 'Stored on the server' })).toContainText(
    'Uninstalling the app deletes them.',
  );
  await expect(section.getByRole('button', { name: /^(Back up now|Backing up…)$/ })).toBeVisible();

  // Every name from a fresh list has a row (the re-import may add a pre-import copy meanwhile:
  // reload and compare until they agree).
  await expect
    .poll(
      async () => {
        await page.reload();
        await expect(page.getByTestId('backups-schedule')).toBeVisible();
        await showAllBackups(page);
        const fresh = await backupsList(request);
        const missing: string[] = [];
        for (const file of fresh.backups) {
          if ((await downloadLink(page, file.name).count()) === 0) missing.push(file.name);
        }
        return missing;
      },
      { timeout: 30_000 },
    )
    .toEqual([]);
  const rows = page.locator('[data-testid="backups-table"] a[title]');
  expect(await rows.count()).toBeGreaterThanOrEqual(before.backups.length);

  // Each link is the encoded download path, with the download attribute and a label.
  const fresh = await backupsList(request);
  for (const file of fresh.backups) {
    const link = downloadLink(page, file.name);
    if ((await link.count()) === 0) continue; // added after this render; the poll above covered it
    await expect(link).toHaveAttribute('href', downloadPath(file.name));
    await expect(link).toHaveAttribute('download', '');
    await expect(link).toHaveAttribute(
      'aria-label',
      /^Download the backup of \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/,
    );
  }
  if (fresh.backups.length === 0) {
    await expect(section).toContainText('No backups yet.');
  }

  await expectNoHorizontalScroll(page);
  const fits = await tableFits(page);
  expect(fits.scroll, 'the backups table scrolls inside its box').toBeLessThanOrEqual(fits.client);
  await shot(page, testInfo, 'settings', 'backups');
  if (testInfo.project.name !== 'phone') {
    await page.setViewportSize({ width: 1024, height: 900 });
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'settings', 'backups-1024');
  }
  expect(errors).toEqual([]);
});

test('About: the versions equal the server’s health version', async ({ page, request }) => {
  const errors = trackConsoleErrors(page);
  const { version, migrations } = await health(request);
  await page.goto(SETTINGS_PATH);
  const about = aboutSection(page);
  await expect(about.getByRole('heading', { level: 2, name: 'About', exact: true })).toBeVisible();
  const table = about.getByRole('table', { name: 'About this app' });
  await expect(table.getByRole('row', { name: /App version/ })).toContainText(`v${version}`);
  await expect(table.getByRole('row', { name: /Server version/ })).toContainText(`v${version}`);
  await expect(table.getByRole('row', { name: /Database level/ })).toContainText(
    String(migrations),
  );
  await expect(table.getByRole('row', { name: /Time zone/ })).toContainText(
    (await backupsList(request)).schedule.timeZone,
  );
  // The page and the server are one build: no version note.
  await expect(about.getByRole('note', { name: 'New version' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const [hash, name] of [
  ['backups', 'Backups'],
  ['about', 'About'],
] as const) {
  test(`/settings#${hash} scrolls to the section and focuses its heading`, async ({ page }) => {
    await page.goto(`${SETTINGS_PATH}#${hash}`);
    const heading = page.getByRole('heading', { level: 2, name, exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test(`the in-page index scrolls to ${name}`, async ({ page }, testInfo) => {
    await page.goto(SETTINGS_PATH);
    await expect(page.getByTestId('backups-schedule')).toBeVisible();
    if (testInfo.project.name === 'phone') {
      await page.getByTestId('settings-jump').locator('summary').click();
    }
    await page
      .getByRole('list', { name: 'Settings groups' })
      .getByRole('link', { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeInViewport();
  });
}
