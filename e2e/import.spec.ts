// Import (stage-1.md §6.4, §7.6 phase B). Uploading through the page mutates the shared
// DATA_DIR, so it runs on desktop only; both projects open the latest report read-only.
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  NOT_READY_REASON,
  SYNTHETIC_FILE_NAME,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  latestCommittedRun,
  syntheticWorkbookBuffer,
} from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The report's per-section check tables (captioned "<Section> checks"), not the run facts. */
function checkTables(page: Page): Locator {
  return page
    .getByRole('main')
    .locator('table')
    .filter({ has: page.locator('caption', { hasText: / checks$/ }) });
}

async function chooseWorkbook(page: Page): Promise<void> {
  await page.getByLabel('Workbook file').setInputFiles({
    name: SYNTHETIC_FILE_NAME,
    mimeType: XLSX_MIME,
    buffer: syntheticWorkbookBuffer(),
  });
}

test.describe('import', () => {
  test.beforeEach(() => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  });

  test('preview, import and read the report through the page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'mutates shared data');
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import' })).toBeVisible();

    // Preview (dry run): the clean synthetic workbook reconciles with 0 unexplained.
    await chooseWorkbook(page);
    await page.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('region', { name: 'Preview result' });
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await expect(preview.getByRole('group', { name: 'Unexplained' })).toContainText(
      /^Unexplained\s*0/,
    );
    await shot(page, testInfo, 'import', 'preview');

    // Import: tick "Replace the imported data" when the page asks for it.
    const replace = page.getByRole('checkbox', { name: 'Replace the imported data' });
    if (await replace.isVisible()) await replace.check();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const result = page.getByRole('region', { name: 'Import result' });
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result.getByRole('group', { name: 'Unexplained' })).toContainText(
      /^Unexplained\s*0/,
    );

    // The run is listed, newest first.
    const runs = page.getByRole('table', { name: 'Import runs, newest first' });
    const newest = runs.getByRole('row').nth(1);
    await expect(newest).toContainText(SYNTHETIC_FILE_NAME);
    await expect(newest).toContainText('Succeeded');

    // Open the report: it starts on "Needs attention" (D32); then filter to the suspect rows.
    await result.getByRole('link', { name: /Open the full report/ }).click();
    await expect(page).toHaveURL(/\/import\/runs\/\d+$/);
    const filters = page.getByRole('group', { name: 'Filter checks by status' });
    await expect(filters.getByRole('button', { name: /^Needs attention/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const suspect = filters.getByRole('button', { name: /^Suspect/ });
    await suspect.click();
    await expect(suspect).toHaveAttribute('aria-pressed', 'true');
    const firstCheck = checkTables(page).locator('tbody tr').first();
    await expect(firstCheck).toContainText('Suspect');
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'import', 'report-suspects');
    expect(errors).toEqual([]);
  });

  test('the import page and the latest report render read-only', async ({
    page,
    request,
  }, testInfo) => {
    await ensureImported(request);
    const errors = trackConsoleErrors(page);

    await page.goto('/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Import runs, newest first' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'import', 'page');

    const run = await latestCommittedRun(request);
    expect(run, 'a committed run').toBeTruthy();
    if (!run) return;
    await page.goto(`/import/runs/${run.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Import' })).toBeVisible();
    await expect(page.getByText(`Run #${run.id} · ${run.fileName}`)).toBeVisible();
    for (const tile of ['Checks', 'Match', 'Explained', 'Suspect', 'Unexplained']) {
      await expect(page.getByRole('group', { name: tile, exact: true })).toBeVisible();
    }
    const filters = page.getByRole('group', { name: 'Filter checks by status' });
    await expect(filters).toBeVisible();
    // The run facts sit above the filters (D32).
    const facts = page.getByRole('table', { name: `Run #${run.id}` });
    await expect(facts).toBeVisible();
    const factsBox = await facts.boundingBox();
    const filtersBox = await filters.boundingBox();
    expect(factsBox?.y ?? Infinity).toBeLessThan(filtersBox?.y ?? 0);

    // "Needs attention" is the default: its rows, or a note that nothing needs attention.
    const main = page.getByRole('main');
    const attention = filters.getByRole('button', { name: /^Needs attention/ });
    await expect(attention).toHaveAttribute('aria-pressed', 'true');
    const attentionText = (await attention.textContent()) ?? '';
    if (/\(0\)$/.test(attentionText.trim())) {
      await expect(page.getByRole('note', { name: 'All clear' })).toBeVisible();
    } else {
      await expect(
        checkTables(page)
          .locator('tbody tr')
          .filter({ hasText: /Unexplained|Suspect/ })
          .first(),
      ).toBeVisible();
    }

    // Under "All", match-only sections are collapsed behind a disclosure button.
    await filters.getByRole('button', { name: /^All/ }).click();
    const show = main.getByRole('button', { name: /^Show .* checks$/ });
    if ((await show.count()) > 0) {
      const first = show.first();
      const name = (await first.getAttribute('aria-label')) ?? '';
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await first.click();
      await expect(
        main.getByRole('button', { name: name.replace(/^Show/, 'Hide'), exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(checkTables(page).first()).toBeVisible();

    if (testInfo.project.name === 'phone') {
      // Status-first on a phone (D31): the Status header shows without scrolling sideways.
      const table = checkTables(page).first();
      const headers = await table.getByRole('columnheader').allTextContents();
      expect(headers.slice(0, 3)).toEqual(['Check', 'Status', 'Diff']);
      const status = await table.getByRole('columnheader', { name: 'Status' }).boundingBox();
      const viewport = page.viewportSize();
      expect(status && viewport ? status.x + status.width : Infinity).toBeLessThanOrEqual(
        viewport?.width ?? 0,
      );
    }
    await attention.click();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'import', 'report');
    // The full report is very long; also keep the first screen (tiles and filters) for review.
    const full = await shot(page, testInfo, 'import', 'report-top');
    await page.screenshot({ path: full, fullPage: false });
    expect(errors).toEqual([]);
  });
});
