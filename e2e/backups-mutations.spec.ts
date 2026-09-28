// "Back up now" and the backups API's guards against the real server (stage-7.md §6.8). Runs only in
// the `backups-mutations` Playwright project (desktop viewport, after `fire-mutations`, retries 0;
// the desktop and phone projects ignore it): it writes backup files (a backup is not app data, so
// `hasAppData` stays as it was and the workbook can still be re-imported). Then a download (the
// SQLite header), a bad name (400, no path in the body), and two cross-site POSTs (403): one marked
// by `Sec-Fetch-Site`, one with a foreign `Origin` and no fetch metadata (the production case of the
// write guard's Origin rule; the same-host-other-port case is a server unit test, since the e2e
// server runs in development, where a loopback Origin passes).
// Stage 8 (stage-8.md §8.7): "Copy to NAS now" with no NAS files on the e2e server → 409
// `NAS_COPY_NOT_READY` with the off message and no `nas-copy` run written; a cross-site POST → 403;
// a body other than none or `{}` → 400.
// Drafted by web-backups (phase A); run in phase B.
import { expect, test } from '@playwright/test';
import type { BackupNowResponse } from '../packages/schema/src/dto/backups';
import { NAS_COPY_OFF_MESSAGE } from '../packages/schema/src/nasCopy';
import {
  BACKUPS_API,
  NAS_COPY_API,
  SETTINGS_PATH,
  backupRows,
  backupsList,
  backupsSection,
  downloadLink,
  downloadPath,
} from './backups-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'backups-mutations';
const SQLITE_HEADER = 'SQLite format 3\0';

/** No error body may carry a file-system path. */
function expectNoPath(text: string): void {
  expect(text).not.toMatch(/[A-Za-z]:\\|\/data\/|artifacts[\\/]|\\backups\\|\/backups\//);
}

test.describe('backups mutations', () => {
  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'runs in the backups-mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
  });

  test('Back up now adds a "By hand" row and its file downloads', async ({ page, request }) => {
    const errors = trackConsoleErrors(page);
    const runsBefore = await importRuns(request);

    await page.goto(SETTINGS_PATH);
    const section = backupsSection(page);
    const button = section.getByRole('button', { name: 'Back up now' });
    await expect(button).toBeEnabled();
    const posted = page.waitForResponse(
      (res) => new URL(res.url()).pathname === BACKUPS_API && res.request().method() === 'POST',
    );
    await button.click();
    const response = await posted;
    expect(response.status(), await response.text()).toBe(201);
    const created = (await response.json()) as BackupNowResponse;
    expect(created.joined).toBe(false);
    expect(created.backup.kind).toBe('manual');

    await expect(page.getByRole('status', { name: 'Backup result' })).toContainText(
      /^Backed up\s*Backup taken: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}, [\d.]+ (B|kB|MB)\.$/,
    );
    // The list refetched: the new copy is the newest row, "By hand".
    const link = downloadLink(page, created.backup.name);
    await expect(link).toBeVisible();
    await expect(backupRows(page).first()).toContainText('By hand');
    await expect(backupRows(page).first().locator(`a[title="${created.backup.name}"]`)).toHaveCount(
      1,
    );
    await expect(link).toHaveAttribute('href', downloadPath(created.backup.name));
    const list = await backupsList(request);
    expect(list.backups.map((file) => file.name)).toContain(created.backup.name);
    expect(list.lastRun?.status).toBe('succeeded');

    // The download: the file itself, as an attachment.
    const download = await request.get(downloadPath(created.backup.name));
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('application/vnd.sqlite3');
    expect(download.headers()['content-disposition']).toBe(
      `attachment; filename="joinr-finance-${created.backup.name}"`,
    );
    expect(download.headers()['x-content-type-options']).toBe('nosniff');
    expect(download.headers()['cache-control']).toContain('no-store');
    const bytes = await download.body();
    expect(bytes.length).toBe(created.backup.sizeBytes);
    expect(bytes.subarray(0, 16).toString('latin1')).toBe(SQLITE_HEADER);

    // A backup is not app data: the workbook can still be re-imported (D34).
    expect((await importRuns(request)).hasAppData).toBe(runsBefore.hasAppData);
    expect(errors).toEqual([]);
  });

  test('a bad download name → 400, a missing one → 404, never a path in the body', async ({
    request,
  }) => {
    const bad = await request.get(`${BACKUPS_API}/..%2Ffinance.db`);
    expect(bad.status()).toBe(400);
    const badText = await bad.text();
    expect((JSON.parse(badText) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expectNoPath(badText);

    const missing = await request.get(downloadPath('manual-20000101-000000+1000.db'));
    expect(missing.status()).toBe(404);
    expectNoPath(await missing.text());
  });

  test('cross-site POSTs are refused (403) and write nothing', async ({ request }) => {
    const before = (await backupsList(request)).backups.map((file) => file.name);

    const marked = await request.post(BACKUPS_API, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(marked.status()).toBe(403);
    expect(((await marked.json()) as { error: { code: string } }).error.code).toBe(
      'CROSS_SITE_REQUEST',
    );

    const foreign = await request.post(BACKUPS_API, {
      headers: { origin: 'http://example.test:1' },
    });
    expect(foreign.status()).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      'CROSS_SITE_REQUEST',
    );

    const after = (await backupsList(request)).backups.map((file) => file.name);
    expect(after).toEqual(before);
  });

  test('Copy to NAS now without the NAS files → 409 NAS_COPY_NOT_READY, and no run is written', async ({
    request,
  }) => {
    const before = await backupsList(request);
    expect(before.nasCopy.configured).toBe('off');
    expect(before.nasCopy.lastRun).toBeNull();

    for (const data of [undefined, {}]) {
      const response = await request.post(NAS_COPY_API, data === undefined ? {} : { data });
      expect(response.status(), await response.text()).toBe(409);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error).toEqual({ code: 'NAS_COPY_NOT_READY', message: NAS_COPY_OFF_MESSAGE });
    }

    const after = await backupsList(request);
    expect(after.nasCopy.lastRun).toBeNull();
    expect(after.nasCopy.running).toBe(false);
    expect(after.backups.map((file) => file.name)).toEqual(before.backups.map((file) => file.name));
  });

  test('Copy to NAS now: a cross-site POST → 403, a body → 400, nothing written', async ({
    request,
  }) => {
    const marked = await request.post(NAS_COPY_API, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(marked.status()).toBe(403);
    expect(((await marked.json()) as { error: { code: string } }).error.code).toBe(
      'CROSS_SITE_REQUEST',
    );

    const foreign = await request.post(NAS_COPY_API, {
      headers: { origin: 'http://example.test:1' },
    });
    expect(foreign.status()).toBe(403);

    const withBody = await request.post(NAS_COPY_API, { data: { x: 1 } });
    expect(withBody.status(), await withBody.text()).toBe(400);
    expect(((await withBody.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    expect((await backupsList(request)).nasCopy.lastRun).toBeNull();
  });
});
