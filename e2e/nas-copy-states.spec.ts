// Fixture-only "Copy to the NAS" states in a real browser (stage-8.md §8.7; D132: no heartbeat),
// desktop (1440 and 1024) and phone (375), read-only: `GET /api/backups` answers the typical backups
// page with each `nasCopyStates` fixture spliced in (and `backupsPages.nasReady` itself), with the
// server version set to the web build's, so every state of the block can be seen and shot although
// the e2e server has no NAS files. A click on an unavailable button is checked to send no POST (the
// POST route is intercepted and counted, never reaching the server). Then the NAS-copy callout on
// two pages (`/api/status` mocked: stale, partial, blocked) and its link to `#nas-copy`.
// Screenshots: artifacts/screenshots/<project>/settings-nas-copy-<state>-<width>.png and
// settings-nas-copy-callout-<status>-<page>.png.
// Drafted by web-nas (phase A); run in phase B.
import { expect, test, type Page } from '@playwright/test';
import type { BackupsResponse } from '../packages/schema/src/dto/backups';
import type { NasCopyStatusDto } from '../packages/schema/src/dto/nasCopy';
import { backupsPages } from '../packages/schema/src/fixtures/backups';
import { appStatusNasCopy, nasCopyStates } from '../packages/schema/src/fixtures/nasCopy';
import {
  BACKUPS_WIDTHS,
  SETTINGS_PATH,
  countNasCopyPosts,
  health,
  mockBackups,
  mockStatus,
  nasCopyBlock,
  nasCopyButton,
  nasTableFits,
  withServerVersion,
} from './backups-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

type StateName = keyof typeof nasCopyStates;

/** The Copy row each state shows (§8.2 item 1: from the state, configReason and the lock). */
const COPY_ROW: Record<StateName, string> = {
  off: 'Not set up: the NAS files are not on the server. Place them with the NAS set-up helper (see the runbook).',
  partialPassword: 'Half set up: nas-password is missing. Nothing is copied.',
  partialUrl: 'Half set up: nas-url is missing. Nothing is copied.',
  invalidUrl: 'The NAS address in nas-url is not usable. Nothing is copied.',
  invalidPassword: 'The password file nas-password is not usable. Nothing is copied.',
  blocked:
    'Stopped: the NAS refused the password or module. Place the NAS files again with the NAS set-up helper first.',
  readyNever: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  succeeded: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  succeededNoOnNas: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  running: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  failedUnreachable: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  notVerified: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  stale: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
  scheduleOff: 'Weekly copy off (turned off in the server settings); Copy to NAS now still works',
  stopped: 'Weekly, Sunday at 03:00 (Australia/Melbourne)',
};

/** The Last copy row's badge word (§4.5), or the no-copy text. */
function lastCopyWord(status: NasCopyStatusDto): string {
  const run = status.lastRun;
  if (!run) return 'No copy yet';
  return run.status === 'running' ? 'Running' : run.status === 'succeeded' ? 'Succeeded' : 'Failed';
}

/** The frozen form phrase of the url_invalid sentence (§4.4): a placeholder, not an address. */
const FORM_PHRASE = 'an rsync://user@host/module address';

function widthsFor(project: string): readonly number[] {
  return project === 'phone' ? BACKUPS_WIDTHS.phone : BACKUPS_WIDTHS.desktop;
}

function pageWith(status: NasCopyStatusDto, version: string): BackupsResponse {
  return withServerVersion({ ...backupsPages.typical, nasCopy: status }, version);
}

async function openBlock(page: Page, width: number, phone: boolean): Promise<void> {
  if (!phone) await page.setViewportSize({ width, height: 900 });
  await page.goto(SETTINGS_PATH);
  await expect(page.getByTestId('nas-copy-state')).toBeVisible();
}

test.describe('NAS copy states (fixtures)', () => {
  let version = '';

  test.beforeAll(async ({ request }) => {
    version = (await health(request)).version;
  });

  for (const name of Object.keys(nasCopyStates) as StateName[]) {
    test(`nas copy: ${name}`, async ({ page }, testInfo) => {
      // A full Settings load and shot per width (two on desktop): 14–17 s per test under the full
      // suite, close to the default 30 s.
      test.setTimeout(90_000);
      const errors = trackConsoleErrors(page);
      const phone = testInfo.project.name === 'phone';
      const status: NasCopyStatusDto = nasCopyStates[name];
      await mockBackups(page, pageWith(status, version));
      const posts = await countNasCopyPosts(page);
      const available = status.configured === 'ready' && !status.blockedUntilFilesChange;

      for (const width of widthsFor(testInfo.project.name)) {
        await openBlock(page, width, phone);
        const block = nasCopyBlock(page);
        await expect(
          block.getByRole('heading', { level: 3, name: 'Copy to the NAS', exact: true }),
        ).toHaveAttribute('id', 'nas-copy');
        await expect(page.getByTestId('nas-copy-state')).toHaveText(COPY_ROW[name]);
        await expect(page.getByTestId('nas-copy-last')).toContainText(lastCopyWord(status));
        await expect(page.getByTestId('nas-copy-next')).toHaveCount(
          status.schedule.nextRunAt ? 1 : 0,
        );
        await expect(block).toContainText('Adds only: nothing on the NAS is ever deleted');

        const button = nasCopyButton(page);
        if (status.running) {
          await expect(button).toHaveText('Copying…');
          await expect(button).toHaveAttribute('aria-busy', 'true');
          await expect(button).toHaveAttribute('aria-disabled', 'true');
        } else if (available) {
          await expect(button).not.toHaveAttribute('aria-disabled', 'true');
        } else {
          // Unavailable: focusable, described by the Copy row, and a click sends nothing.
          await expect(button).toHaveAttribute('aria-disabled', 'true');
          await expect(button).toHaveAttribute('aria-describedby', 'nas-copy-state');
          await button.focus();
          await expect(button).toBeFocused();
          // Playwright treats aria-disabled as disabled for actionability: force the click.
          await button.click({ force: true });
          await page.waitForTimeout(500);
          expect(posts(), `${name}: an unavailable click sends no POST`).toBe(0);
        }

        // Nothing that looks like an address (the url_invalid sentence's form phrase aside).
        const html = (await block.innerHTML()).split(FORM_PHRASE).join('');
        expect(html).not.toMatch(/rsync:\/\/|@/);

        await expectNoHorizontalScroll(page);
        const fits = await nasTableFits(page);
        expect(fits.scroll, `${name} at ${width}: the NAS table's width`).toBeLessThanOrEqual(
          fits.client,
        );
        await block.scrollIntoViewIfNeeded();
        await shot(page, testInfo, 'settings', `nas-copy-${name}-${width}`);
      }
      expect(errors).toEqual([]);
    });
  }

  test('nas copy: backupsPages.nasReady (the ready page as the server would send it)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const phone = testInfo.project.name === 'phone';
    await mockBackups(page, withServerVersion(backupsPages.nasReady, version));
    for (const width of widthsFor(testInfo.project.name)) {
      await openBlock(page, width, phone);
      await expect(page.getByTestId('nas-copy-last')).toContainText(
        '5 sent · 22 already there · proved on the NAS · 27 on the NAS',
      );
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'settings', `nas-copy-nasReady-${width}`);
    }
  });

  const CALLOUTS = [
    ['stale', 'NAS copy overdue', 'has not succeeded since 15/09/2030.'],
    ['partial', 'NAS copy not working', 'half set up, so nothing is being copied.'],
    ['blocked', 'NAS copy not working', 'so nothing is copied until the NAS files are placed'],
  ] as const;

  for (const [state, title, text] of CALLOUTS) {
    for (const path of ['/', '/history'] as const) {
      test(`the NAS-copy callout (${state}) on ${path}, and its link`, async ({
        page,
      }, testInfo) => {
        const errors = trackConsoleErrors(page);
        await mockStatus(page, appStatusNasCopy[state]);
        await mockBackups(page, withServerVersion(backupsPages.nasReady, version));
        await page.goto(path);
        const callout = page.getByRole('note', { name: title });
        await expect(callout).toBeVisible();
        await expect(callout).toContainText(text);
        await expectNoHorizontalScroll(page);
        await shot(
          page,
          testInfo,
          'settings',
          `nas-copy-callout-${state}-${path === '/' ? 'networth' : 'history'}`,
        );
        await callout.getByRole('link', { name: 'Open NAS copy' }).click();
        await expect(page).toHaveURL(/\/settings#nas-copy$/);
        const heading = page.getByRole('heading', {
          level: 3,
          name: 'Copy to the NAS',
          exact: true,
        });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        expect(errors).toEqual([]);
      });
    }
  }
});
