// Records (stage-1.md §6.3, §7.6 phase B): the read-only data browser over the synthetic
// workbook. Read-only, so it runs on desktop and phone.
import { expect, test } from '@playwright/test';
import { RECORD_ENTITIES, RECORD_ENTITY_IDS } from '../packages/schema/src/records';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

const GROUPS = ['Investments', 'Cash flow', 'Assets', 'History', 'Settings'];

const ENTITIES = [
  { id: 'trades', label: 'Trades' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'settings', label: 'Settings' },
] as const;

test.describe('records', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
  });

  test('the index lists every group with row counts', async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/records');
    await expect(page.getByRole('heading', { level: 1, name: 'Records' })).toBeVisible();
    const main = page.getByRole('main');
    for (const group of GROUPS) {
      const heading = main.getByRole('heading', { level: 2, name: group });
      await expect(heading).toBeVisible();
      // Reference / raw data: violet section bars (D33).
      await expect(heading.locator('xpath=..')).toHaveClass(/jf-section-bar--reference/);
    }
    // Imported data: counts are links, and Trades has rows.
    await expect(main.getByRole('link', { name: /^Trades: [\d,]+ rows?$/ })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Trades: 0 rows' })).toHaveCount(0);
    await expect(main.getByText('Nothing imported yet.')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'records', 'index');
    expect(errors).toEqual([]);
  });

  for (const entity of ENTITIES) {
    test(`opens ${entity.label} from the index`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await page.goto('/records');
      const main = page.getByRole('main');
      await main.getByRole('link', { name: new RegExp(`^${entity.label}: `) }).click();
      await expect(page).toHaveURL(new RegExp(`/records/${entity.id}$`));
      await expect(page.getByRole('heading', { level: 1, name: 'Records' })).toBeVisible();
      const table = main.getByRole('table', { name: entity.label, exact: true });
      await expect(table).toBeVisible();
      // A header row plus at least one data row.
      expect(await table.getByRole('row').count()).toBeGreaterThan(1);
      await expect(table.getByText('No rows in this table.')).toHaveCount(0);
      if (entity.id === 'settings') {
        // The readable label first (the sticky column), then the key (D35).
        const headers = await table.getByRole('columnheader').allTextContents();
        expect(headers.slice(0, 2)).toEqual(['Label', 'Key']);
      }
      // Wide tables scroll inside their container; the page itself never does.
      await expectNoHorizontalScroll(page);
      await shot(page, testInfo, 'records', entity.id);
      expect(errors).toEqual([]);
    });
  }

  test('every record table renders from the real API', async ({ page }) => {
    // 28 record pages since Stage 5 added snapshot-audit (stage-3.md §7.8 step 6, stage-4.md §7.8
    // step 6, stage-5.md §7.8 step 6).
    test.setTimeout(120_000);
    expect(RECORD_ENTITY_IDS).toHaveLength(28);
    expect(RECORD_ENTITY_IDS).toContain('snapshot-audit');
    const errors = trackConsoleErrors(page);
    for (const id of RECORD_ENTITY_IDS) {
      const { label } = RECORD_ENTITIES[id];
      await page.goto(`/records/${id}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Records' })).toBeVisible();
      await expect(page.getByRole('table', { name: label, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    expect(errors).toEqual([]);
  });

  test('the table switcher moves between tables', async ({ page }) => {
    await page.goto('/records/trades');
    await expect(page.getByRole('table', { name: 'Trades', exact: true })).toBeVisible();
    if (test.info().project.name === 'phone') {
      await page.getByRole('combobox', { name: 'Table' }).selectOption('dividends');
    } else {
      await page
        .getByRole('navigation', { name: 'Record tables' })
        .getByRole('link', { name: 'Dividends' })
        .click();
    }
    await expect(page).toHaveURL(/\/records\/dividends$/);
    await expect(page.getByRole('table', { name: 'Dividends', exact: true })).toBeVisible();
  });
});
