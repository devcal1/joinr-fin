// History and Settings mutations through the UI (stage-5.md §7.8 step 5). Runs only in the
// `history-mutations` Playwright project (desktop viewport, after `assets-mutations`; the desktop
// and phone projects ignore it), because a recorded month is app data and would make the Stage 1
// import spec answer 409 (D34, D84). Every month it records carries E2E_NOTE and is deleted again
// (the latest app-recorded month can be deleted, D92); it restores the one setting it changes
// (`savings.yearBasis`, app-only); it never switches auto-record on and never edits a workbook
// setting, so afterwards `hasAppData === false`.
// Drafted by web phase A; the Integrator adds the project to playwright.config.ts and finishes the
// spec against the real API.
import { expect, test, type Page } from '@playwright/test';
import { cleanupAssetsRows } from './assets-support';
import { cashPage, cleanupCashflowRows } from './cashflow-support';
import {
  E2E_NOTE,
  cleanupHistoryRows,
  expectHistoryApi,
  historyPage,
  monthLabel,
  netWorthPage,
} from './history-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'history-mutations';

async function announced(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('status', { name: 'History updates' })).toContainText(text);
}

test.describe('history mutations', () => {
  const active = (project: string): boolean => project === PROJECT && SYNTHETIC_IMPORT_READY;
  let month = '';
  // The audit trail outlives a deleted month and earlier runs (a re-import keeps it), so this run's
  // entries are the ones above the newest id seen before it records.
  let auditFloor = 0;
  const ours = <T extends { id: number; periodMonth: string }>(audit: readonly T[]): T[] =>
    audit.filter((a) => a.id > auditFloor && a.periodMonth === month);

  test.beforeAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupHistoryRows(request);
  });

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'runs in the history-mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await expectHistoryApi(request);
  });

  test.afterAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupHistoryRows(request);
    await cleanupAssetsRows(request);
    await cleanupCashflowRows(request);
    const patch = await request.patch('/api/settings', {
      data: { values: { 'savings.yearBasis': 'fy' } },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await importRuns(request)).hasAppData).toBe(false);
  });

  test('1. record the current month only from the History form', async ({ page, request }) => {
    const errors = trackConsoleErrors(page);
    const before = await historyPage(request);
    auditFloor = Math.max(0, ...before.audit.map((a) => a.id));
    // The current month is the last recordable one (§7.8 step 5.1).
    month = before.record.recordable.at(-1) ?? '';
    expect(month, 'a recordable month').not.toBe('');
    await page.goto('/history');
    await page.getByRole('button', { name: 'Record month' }).click();
    const form = page.getByRole('form', { name: 'Record month' });
    for (const m of before.record.recordable) {
      const box = form.getByRole('checkbox', { name: monthLabel(m), exact: true });
      if (m === month) await box.check();
      else await box.uncheck();
    }
    await form.getByRole('textbox', { name: 'Note' }).fill(`${E2E_NOTE} record`);
    await form.getByRole('button', { name: 'Record', exact: true }).click();
    await announced(page, `Recorded ${monthLabel(month)}`);
    expect((await importRuns(request)).hasAppData).toBe(true);
    // The dashboard's rolling table shows it recorded; the Cash page has no provisional period.
    const nw = await netWorthPage(request);
    expect(nw.rolling.find((r) => r.periodMonth === month)?.status).toBe('recorded');
    const cash = await cashPage(request);
    expect(cash.periods.some((p) => p.status === 'provisional')).toBe(false);
    // On screen: the hero says "Recorded today", and the month's rolling row is recorded, not live.
    await page.goto('/');
    await expect(
      page
        .getByRole('region', { name: 'Net worth summary', exact: true })
        .getByRole('group', { name: 'Net worth', exact: true }),
    ).toContainText('Recorded today');
    const rolling = page.getByRole('table', { name: /^Rolling net worth$/ });
    const row = rolling.locator('tbody tr', { hasText: monthLabel(month) }).first();
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Live');
    await expect(rolling.getByText('Live', { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('2. correct its cash value with a reason', async ({ page, request }) => {
    const before = await historyPage(request);
    const row = before.snapshots.find((s) => s.periodMonth === month);
    expect(row, 'the recorded month').toBeDefined();
    await page.goto('/history');
    await page.getByRole('button', { name: `Correct ${monthLabel(month)}` }).click();
    const form = page.getByRole('form', { name: `Correct ${monthLabel(month)}` });
    const cash = form.getByRole('textbox', { name: 'Cash', exact: true });
    const next = (row?.figures.cashValueCents ?? 0) + 12_345;
    await cash.fill((next / 100).toFixed(2));
    await cash.press('Tab');
    await form.getByRole('textbox', { name: 'Reason' }).fill(`${E2E_NOTE} correction`);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await announced(page, 'Correction saved');
    const after = await historyPage(request);
    const corrected = after.snapshots.find((s) => s.periodMonth === month);
    expect(corrected?.revision).toBe(1);
    expect(corrected?.netWorth.netWorthCents).toBe((row?.netWorth.netWorthCents ?? 0) + 12_345);
    expect(ours(after.audit).map((a) => a.action)).toEqual(['correct', 'record']);
    await expect(
      page
        .getByRole('table', { name: /^Recorded months/ })
        .getByText('Corrected')
        .first(),
    ).toBeVisible();
    // The audit trail on screen has the correction, newest first, with its reason.
    const audit = page.getByRole('table', { name: 'Audit trail', exact: true });
    const first = audit.locator('tbody tr').first();
    await expect(first).toContainText(monthLabel(month));
    await expect(first).toContainText('Corrected');
    await expect(first).toContainText(`${E2E_NOTE} correction`);
  });

  test('3. delete it (the latest)', async ({ page, request }) => {
    await page.goto('/history');
    await page.getByRole('button', { name: `Delete ${monthLabel(month)}` }).click();
    await page
      .getByRole('button', { name: `Delete the recorded month ${monthLabel(month)}` })
      .click();
    await announced(page, `${monthLabel(month)} deleted`);
    expect((await importRuns(request)).hasAppData).toBe(false);
    const after = await historyPage(request);
    expect(after.record.recordable).toContain(month);
    expect(ours(after.audit).map((a) => a.action)).toEqual(['delete', 'correct', 'record']);
  });

  test('4. Settings: the year basis to calendar, and back', async ({ page }) => {
    await page.goto('/settings#cash');
    const section = page.getByRole('region', { name: 'Cash and savings', exact: true });
    await section.getByRole('combobox', { name: 'Year basis' }).selectOption('calendar');
    await section.getByRole('button', { name: 'Save cash and savings' }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Settings saved');
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'This year', exact: true })).toBeVisible();
    // The gauge follows: a calendar year ("Savings rate 2026"), not a financial year.
    await expect(page.getByRole('region', { name: /^Savings rate \d{4}$/ })).toBeVisible();
    await page.goto('/settings#cash');
    await section.getByRole('combobox', { name: 'Year basis' }).selectOption('fy');
    await section.getByRole('button', { name: 'Save cash and savings' }).click();
    await expect(page.getByRole('status', { name: 'Save result' })).toContainText('Settings saved');
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'This FY', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Savings rate FY\d{4}–\d{2}$/ })).toBeVisible();
  });
});
