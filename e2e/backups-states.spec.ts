// Fixture-only Backups states in a real browser (stage-7.md §6.8), desktop (1440 and 1024) and phone
// (375), read-only: `GET /api/backups` answers each `backupsPages` fixture (mockBackups), with the
// server version set to the web build's (the server's health version) except in the mismatch
// state, so the enabled schedule, a running backup, a failure and the rest can be seen and shot
// although the e2e server never shows them. Then the stale-backup callout on two pages
// (`/api/status` mocked) and its link. Screenshots: artifacts/screenshots/<project>/
// settings-backups-state-<name>-<width>.png and settings-backups-stale-<page>.png.
// Drafted by web-backups (phase A); run in phase B.
import { expect, test, type Page } from '@playwright/test';
import type { BackupsResponse } from '../packages/schema/src/dto/backups';
import { appStatusBackups, backupsPages } from '../packages/schema/src/fixtures/backups';
import {
  BACKUPS_SHOWN,
  BACKUPS_WIDTHS,
  SETTINGS_PATH,
  aboutSection,
  backupRows,
  backupsSection,
  health,
  mockBackups,
  mockStatus,
  scheduleLine,
  tableFits,
  withServerVersion,
} from './backups-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

/** The states §6.8 lists, plus the two skipped reasons and the future file. */
const STATES = [
  'typical',
  'empty',
  'running',
  'lastFailed',
  'skippedEmpty',
  'skippedImport',
  'scheduleOff',
  'versionMismatch',
  'restored',
  'future',
] as const satisfies readonly (keyof typeof backupsPages)[];

/** The badge word each state's last run shows (the frozen §4.3 mapping), or the no-run text. */
const LAST_RUN_WORD: Record<(typeof STATES)[number], string> = {
  typical: 'Succeeded',
  empty: 'No backup has run yet',
  running: 'Running',
  lastFailed: 'Failed',
  skippedEmpty: 'Skipped',
  skippedImport: 'Skipped',
  scheduleOff: 'Succeeded',
  versionMismatch: 'Succeeded',
  restored: 'Succeeded',
  future: 'Succeeded',
};

function widthsFor(project: string): readonly number[] {
  return project === 'phone' ? BACKUPS_WIDTHS.phone : BACKUPS_WIDTHS.desktop;
}

async function openState(page: Page, width: number, phone: boolean): Promise<void> {
  if (!phone) await page.setViewportSize({ width, height: 900 });
  await page.goto(SETTINGS_PATH);
  await expect(page.getByTestId('backups-schedule')).toBeVisible();
}

test.describe('backups states (fixtures)', () => {
  let version = '';

  test.beforeAll(async ({ request }) => {
    version = (await health(request)).version;
  });

  for (const name of STATES) {
    test(`backups: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      const phone = testInfo.project.name === 'phone';
      const base: BackupsResponse = backupsPages[name];
      const mismatch = name === 'versionMismatch';
      const serverVersion = mismatch
        ? base.app.version === version
          ? `${version}-other`
          : base.app.version
        : version;
      const fixture = withServerVersion(base, serverVersion);
      await mockBackups(page, fixture);

      for (const width of widthsFor(testInfo.project.name)) {
        await openState(page, width, phone);
        const section = backupsSection(page);
        await expect(page.getByTestId('backups-schedule')).toHaveText(
          scheduleLine(fixture.schedule),
        );
        await expect(page.getByTestId('backups-last-run')).toContainText(LAST_RUN_WORD[name]);
        await expect(backupRows(page)).toHaveCount(
          fixture.backups.length === 0 ? 1 : Math.min(fixture.backups.length, BACKUPS_SHOWN),
        );
        if (name === 'running') {
          await expect(section.getByRole('button', { name: 'Backing up…' })).toBeDisabled();
        }
        if (name === 'lastFailed') {
          await expect(page.getByTestId('backups-last-run')).toContainText(
            'Not enough free space on the server',
          );
        }
        const note = aboutSection(page).getByRole('note', { name: 'New version' });
        await expect(note).toHaveCount(mismatch ? 1 : 0);
        if (name === 'restored') {
          await expect(aboutSection(page)).toContainText(
            'from manual-20300910-180500+1000.db on 15/09/2030 11:00',
          );
        }
        await expectNoHorizontalScroll(page);
        const fits = await tableFits(page);
        expect(fits.scroll, `${name} at ${width}: the table's inner width`).toBeLessThanOrEqual(
          fits.client,
        );
        await section.scrollIntoViewIfNeeded();
        await shot(page, testInfo, 'settings', `backups-state-${name}-${width}`);
      }
      expect(errors).toEqual([]);
    });
  }

  test('backups: typical with every row shown', async ({ page }, testInfo) => {
    const phone = testInfo.project.name === 'phone';
    await mockBackups(page, withServerVersion(backupsPages.typical, version));
    for (const width of widthsFor(testInfo.project.name)) {
      await openState(page, width, phone);
      await backupsSection(page)
        .getByRole('button', { name: `Show all ${backupsPages.typical.backups.length} backups` })
        .click();
      await expect(backupRows(page)).toHaveCount(backupsPages.typical.backups.length);
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'settings', `backups-state-typical-all-${width}`);
    }
  });

  for (const path of ['/', '/history'] as const) {
    test(`the stale-backup callout on ${path}, and its link`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockStatus(page, appStatusBackups.stale);
      await mockBackups(page, withServerVersion(backupsPages.lastFailed, version));
      await page.goto(path);
      const callout = page.getByRole('note', { name: 'Backup overdue' });
      await expect(callout).toBeVisible();
      await expect(callout).toContainText('The nightly backup has not succeeded since 12/09/2030.');
      await expectNoHorizontalScroll(page);
      await shot(
        page,
        testInfo,
        'settings',
        `backups-stale-${path === '/' ? 'networth' : 'history'}`,
      );
      await callout.getByRole('link', { name: 'Open Backups' }).click();
      await expect(page).toHaveURL(/\/settings#backups$/);
      const heading = page.getByRole('heading', { level: 2, name: 'Backups', exact: true });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      expect(errors).toEqual([]);
    });
  }

  test('the stale-backup callout when there has never been a backup', async ({ page }) => {
    await mockStatus(page, appStatusBackups.never);
    await page.goto('/history');
    await expect(page.getByRole('note', { name: 'Backup overdue' })).toContainText(
      'No backup has been taken yet.',
    );
  });
});
