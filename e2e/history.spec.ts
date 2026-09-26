// The History page on the synthetic import (stage-5.md §7.8 step 3), desktop and phone, read-only:
// the h1, the status card (one teal figure), the recorded months against the API (caption and
// row count), the consistency headline, the audit trail, the chart (an svg, a table or the empty
// message) and its view switch, `/history#record` (the form opens and its heading is focused, when
// a month is recordable), no page-level horizontal scroll, no console errors, screenshots.
// Nothing is recorded here (history-mutations.spec.ts does that in its own project).
// Drafted by web phase A; finished by the Integrator against the real API.
import { expect, test } from '@playwright/test';
import { historyPages } from '../packages/schema/src/fixtures/history';
import { expectHistoryApi, historyPage, mockHistoryPage } from './history-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
  await expectHistoryApi(request);
});

function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`;
}

test('History: status, recorded months, consistency, audit and chart', async ({
  page,
  request,
}, testInfo) => {
  const errors = trackConsoleErrors(page);
  const api = await historyPage(request);
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1, name: 'History', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Latest recorded' })).toBeVisible();
  await expect(page.locator('.jf-stat-tile--key')).toHaveCount(api.snapshots.length > 0 ? 1 : 0);
  if (api.snapshots.length > 0) {
    const table = page.getByRole('table', {
      name: `Recorded months: ${counted(api.snapshots.length, 'month')}`,
    });
    await expect(table.locator('tbody tr')).toHaveCount(api.snapshots.length);
    // Imported months are never deletable (D92).
    await expect(table.getByRole('button', { name: /^Delete / })).toHaveCount(
      api.snapshots.filter((s) => s.deletable).length,
    );
  }
  await expect(page.getByTestId('consistency-headline')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Audit trail', exact: true })).toBeVisible();
  const chart = page.getByRole('region', { name: /^What you own by / });
  await chart.scrollIntoViewIfNeeded();
  await expect(
    chart.locator('.jf-chart__host svg, .jf-chart__state, table').first(),
  ).toBeAttached();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'history', 'page');
  expect(errors).toEqual([]);
});

test('History: the chart view switch reads the series API', async ({ page }) => {
  await page.goto('/history');
  const section = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: 'What you own over time' }),
  });
  const query = page.waitForRequest((r) => r.url().includes('/api/history/series?'));
  await section.getByRole('button', { name: 'Yearly', exact: true }).click();
  await query;
  await expect(page.getByRole('region', { name: 'What you own by year' })).toBeVisible();
});

test('History: /history#record opens the form and focuses its heading', async ({
  page,
  request,
}) => {
  const api = await historyPage(request);
  test.skip(api.record.recordable.length === 0, 'nothing is recordable on this data');
  await page.goto('/history#record');
  await expect(page.getByRole('form', { name: 'Record month' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Record month' })).toBeFocused();
  // Opening the form records nothing.
  expect((await historyPage(request)).snapshots.length).toBe(api.snapshots.length);
});

// Fixer round 1 (STYLE-1): at 1440 px the sticky Actions column (Details · Correct, then Delete)
// covers no figure column when the table first renders, and Delete stays inside the table's box.
test('History at 1440 px: the sticky Actions column covers no figure', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockHistoryPage(page, 'history', historyPages.populated);
  await page.goto('/history');
  const table = page.getByRole('table', { name: /^Recorded months: / });
  await expect(table.getByRole('button', { name: 'Delete Jul 2026' })).toBeVisible();
  const result = await table.evaluate((t) => {
    const headers = [...t.querySelectorAll('thead th')] as HTMLElement[];
    const box = (name: string) =>
      headers.find((h) => h.textContent?.trim() === name)?.getBoundingClientRect() ?? null;
    const actions = box('Actions');
    const overlaps = [
      'Net worth',
      'Liquid assets',
      'Cash',
      'Super',
      'Property equity',
      'Savings rate',
    ]
      .map((name) => ({ name, b: box(name) }))
      .filter(
        ({ b }) =>
          b === null ||
          actions === null ||
          (b.right > actions.left + 0.5 && b.left < actions.right - 0.5),
      )
      .map(({ name }) => name);
    const scroller = (t.closest('.jf-table__scroll') ?? t.parentElement) as HTMLElement;
    const s = scroller.getBoundingClientRect();
    const del = t.querySelector('button[aria-label="Delete Jul 2026"]')?.getBoundingClientRect();
    const inside = del !== undefined && del.left >= s.left - 0.5 && del.right <= s.right + 0.5;
    return { overlaps, inside, scrollLeft: scroller.scrollLeft };
  });
  expect(result.scrollLeft).toBe(0);
  expect(result.overlaps, 'figure headers under the sticky Actions column').toEqual([]);
  expect(result.inside, 'Delete inside the table box').toBe(true);
});
