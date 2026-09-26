// Cash-flow mutations through the UI (stage-3.md §7.8 step 5). Runs only in the
// `cashflow-mutations` Playwright project (desktop viewport, after the `mutations` project), because
// the app rows it creates would make the Stage 1 import spec answer 409 (D34). Every row it creates
// carries E2E_NOTE and is deleted again (an app row's delete writes no marker), and it never edits
// a workbook setting (that would leave an `app` settings row, §3.3), so afterwards
// `hasAppData === false`. Drafted by web phase A; the Integrator adds the project to
// playwright.config.ts and finishes the spec against the real API.
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_NOTE,
  budgetPage,
  cashPage,
  cleanupCashflowRows,
  dividendsPage,
  expectCashflowApi,
  sideIncomePage,
} from './cashflow-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'cashflow-mutations';

/** dd/mm/yyyy of a local date `offset` days from today. */
function localDate(offset = 0): { iso: string; shown: string } {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    shown: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08' → "Aug 2026" (the app's formatMonth; STYLE_GUIDE §8). */
function monthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

async function saved(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('status', { name: 'Save result' })).toContainText(text);
}

async function expectNoAppData(request: Parameters<typeof importRuns>[0]): Promise<void> {
  expect((await importRuns(request)).hasAppData).toBe(false);
}

test.describe('cash-flow mutations', () => {
  const active = (project: string): boolean => project === PROJECT && SYNTHETIC_IMPORT_READY;

  test.beforeAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupCashflowRows(request);
  });

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'runs in the cashflow-mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await expectCashflowApi(request);
  });

  test.afterAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupCashflowRows(request);
    await expectNoAppData(request);
  });

  test('cash: a kind-only change on an imported account is not app data', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await cashPage(request);
    const account = before.accounts.find(
      (a) => a.origin === 'import' && a.kind === 'bank' && !a.isOffset && a.balanceCents > 0,
    );
    expect(account, 'an imported bank account with a positive balance').toBeDefined();
    if (!account) return;
    const editButton = page.getByRole('button', { name: `Edit ${account.name}`, exact: true });
    const formName = `Edit account · ${account.name}`;
    try {
      await page.goto('/cash');
      await editButton.click();
      let form = page.getByRole('form', { name: formName });
      await form.getByRole('combobox', { name: 'Kind' }).selectOption('loan_receivable');
      await expect(form.getByRole('note', { name: 'Import-safe' })).toBeVisible();
      await form.getByRole('button', { name: 'Save' }).click();
      await saved(page, 'Account saved');
      await expectNoAppData(request);
      // D59: a loan you've made stays in Total cash but leaves available cash.
      const lent = await cashPage(request);
      const changed = lent.accounts.find((a) => a.id === account.id);
      expect(changed?.kind).toBe('loan_receivable');
      expect(changed?.origin).toBe('import');
      expect(lent.totals.totalCashCents).toBe(before.totals.totalCashCents);
      expect(lent.totals.availableCashCents).toBe(
        before.totals.availableCashCents - account.balanceCents,
      );
      // Restore the kind.
      await editButton.click();
      form = page.getByRole('form', { name: formName });
      await form.getByRole('combobox', { name: 'Kind' }).selectOption('bank');
      await form.getByRole('button', { name: 'Save' }).click();
      await saved(page, 'Account saved');
      await expectNoAppData(request);
      expect(errors).toEqual([]);
    } finally {
      // A re-import carries a stored kind over (D49), so never leave the synthetic account changed.
      // A no-op save keeps the row's origin.
      const response = await request.put(`/api/cash/accounts/${account.id}`, {
        data: { name: account.name, kind: 'bank', isOffset: account.isOffset, note: account.note },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    expect((await cashPage(request)).accounts.find((a) => a.id === account.id)?.origin).toBe(
      'import',
    );
  });

  test('cash: add an account, update its balance, delete the new entry and the account', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const name = `${E2E_NOTE} account`;
    const before = await cashPage(request);
    await page.goto('/cash');
    await page.getByRole('button', { name: 'Add account' }).click();
    let form = page.getByRole('form', { name: 'Add account' });
    await form.getByRole('textbox', { name: /Name/ }).fill(name);
    await form.getByRole('textbox', { name: /Opening balance/ }).fill('100');
    await form.getByRole('textbox', { name: /As of/ }).fill(localDate(-1).shown);
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Account added');
    const added = await cashPage(request);
    expect(added.totals.totalCashCents).toBe(before.totals.totalCashCents + 10_000);

    // Update balances: a new as-of (today) → a new entry; the provisional period follows.
    const provisionalBefore = added.periods.find((p) => p.status === 'provisional');
    expect(provisionalBefore, 'a provisional period').toBeDefined();
    await page.getByRole('button', { name: 'Update balances' }).click();
    const balances = page.getByRole('form', { name: 'Update balances' });
    await balances.getByRole('textbox', { name: /As of/ }).fill(localDate(0).shown);
    await balances.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await balances.getByRole('textbox', { name: `Balance, ${name}`, exact: true }).fill('250');
    await balances.getByRole('button', { name: 'Save balances' }).click();
    await saved(page, 'Balance saved');
    const updated = await cashPage(request);
    expect(updated.totals.totalCashCents).toBe(before.totals.totalCashCents + 25_000);
    const provisionalAfter = updated.periods.find((p) => p.status === 'provisional');
    // The provisional period's cash is Total cash now, so its gain follows the new balance.
    expect(provisionalAfter?.cashGainCents).toBe((provisionalBefore?.cashGainCents ?? 0) + 15_000);

    // Delete the extra entry in the balance history.
    const account = updated.accounts.find((a) => a.name === name);
    expect(account?.entryCount).toBe(2);
    await page.getByRole('button', { name: `History of ${name}`, exact: true }).click();
    const history = page.getByRole('region', { name: 'Balance history' });
    await history.getByRole('button', { name: 'Table' }).click();
    await history
      .getByRole('button', { name: `Delete the balance of ${localDate(0).shown}`, exact: true })
      .click();
    await history
      .getByRole('group', { name: `Delete the balance of ${localDate(0).shown}?` })
      .getByRole('button', { name: `Delete the balance of ${localDate(0).shown}` })
      .click();
    await expect
      .poll(async () => (await cashPage(request)).totals.totalCashCents)
      .toBe(before.totals.totalCashCents + 10_000);

    // Delete the account.
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    form = page.getByRole('form', { name: `Edit account · ${name}` });
    await form.getByRole('button', { name: 'Delete account' }).click();
    await form.getByRole('button', { name: `Delete the account ${name}` }).click();
    await saved(page, 'Account deleted');
    expect((await cashPage(request)).totals.totalCashCents).toBe(before.totals.totalCashCents);
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });

  test('cash: an adjustment and a goal are overlays (never app data)', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const cash = await cashPage(request);
    const closed = cash.periods.find((p) => p.status === 'closed' && p.adjustment === null);
    expect(closed, 'a closed period without an adjustment').toBeDefined();
    if (!closed) return;
    const month = monthLabel(closed.periodMonth);
    await page.goto('/cash');
    await page.getByRole('button', { name: `Adjust ${month}`, exact: true }).click();
    const form = page.getByRole('form', { name: `Adjust ${month}` });
    await form.getByRole('textbox', { name: /Amount/ }).fill('100');
    await form.getByRole('textbox', { name: /Note/ }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Adjustment saved');
    const adjusted = (await cashPage(request)).periods.find(
      (p) => p.periodMonth === closed.periodMonth,
    );
    expect(adjusted?.adjusted.savingsRatio).not.toBe(closed.adjusted.savingsRatio);
    await expectNoAppData(request);
    await page.getByRole('button', { name: `Adjust ${month}`, exact: true }).click();
    await page
      .getByRole('form', { name: `Adjust ${month}` })
      .getByRole('button', { name: 'Remove' })
      .click();
    await saved(page, 'Adjustment removed');

    await page.getByRole('button', { name: 'Add goal' }).click();
    const goal = page.getByRole('form', { name: 'Add goal' });
    await goal.getByRole('textbox', { name: /Name/ }).fill(`${E2E_NOTE} goal`);
    await goal.getByRole('textbox', { name: 'Target', exact: true }).fill('1000');
    await goal.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Goal saved');
    await expectNoAppData(request);
    const label = `goal ${E2E_NOTE} goal`;
    await page.getByRole('button', { name: `Delete the ${label}`, exact: true }).click();
    await page
      .getByRole('group', { name: `Delete the ${label}?` })
      .getByRole('button', { name: `Delete the ${label}` })
      .click();
    await saved(page, 'Goal deleted');
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });

  test('side income: a deposit dated today moves the provisional period and FY-to-date', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await sideIncomePage(request);
    const stream = before.streams.find((s) => !s.archived);
    expect(stream, 'an active stream').toBeDefined();
    if (!stream) return;
    await page.goto('/side-income');
    await page.getByRole('button', { name: 'Add deposit' }).click();
    const form = page.getByRole('form', { name: 'Add deposit' });
    await form.getByRole('combobox', { name: /Stream/ }).selectOption(String(stream.id));
    await form.getByRole('textbox', { name: /Amount/ }).fill('12.34');
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Deposit added');
    const after = await sideIncomePage(request);
    expect(after.kpis.fyToDateCents).toBe(before.kpis.fyToDateCents + 1234);
    const live = (p: typeof after) => p.periods.find((x) => x.status === 'provisional')?.totalCents;
    expect(live(after)).toBe((live(before) ?? 0) + 1234);
    const deposit = after.deposits.find((d) => d.note === E2E_NOTE);
    expect(deposit?.provisional).toBe(true);
    const label = `the deposit of ${localDate(0).shown} (${stream.name})`;
    await page.getByRole('button', { name: `Delete ${label}`, exact: true }).click();
    await page
      .getByRole('group', { name: `Delete ${label}?` })
      .getByRole('button', { name: `Delete ${label}` })
      .click();
    await saved(page, 'Deposit deleted');
    expect((await sideIncomePage(request)).kpis.fyToDateCents).toBe(before.kpis.fyToDateCents);
    expect(errors).toEqual([]);
  });

  test('budget: an item moves planned spend and the transfers; a yearly expense the fund', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await budgetPage(request);
    const itemName = `${E2E_NOTE} item`;
    await page.goto('/budget');
    await page.getByRole('button', { name: 'Add item' }).click();
    const form = page.getByRole('form', { name: 'Add item' });
    await form.getByRole('textbox', { name: /Name/ }).fill(itemName);
    await form.getByRole('textbox', { name: /Monthly/ }).fill('40');
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Budget item saved');
    const withItem = await budgetPage(request);
    expect(withItem.summary.plannedSpendCents).toBe(before.summary.plannedSpendCents + 4000);
    expect(withItem.unassigned.monthlyCents).toBe(before.unassigned.monthlyCents + 4000);

    await page.getByRole('button', { name: 'Add yearly expense' }).click();
    const yearly = page.getByRole('form', { name: 'Add yearly expense' });
    await yearly.getByRole('textbox', { name: /Name/ }).fill(`${E2E_NOTE} yearly`);
    await yearly.getByRole('textbox', { name: /Year cost/ }).fill('600');
    await yearly.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Yearly expense saved');
    const withYearly = await budgetPage(request);
    expect(withYearly.summary.yearlyFundCents).toBeGreaterThan(withItem.summary.yearlyFundCents);
    const yearlyLabel = `yearly expense ${E2E_NOTE} yearly`;
    await page.getByRole('button', { name: `Delete the ${yearlyLabel}`, exact: true }).click();
    await page
      .getByRole('group', { name: `Delete the ${yearlyLabel}?` })
      .getByRole('button', { name: `Delete the ${yearlyLabel}` })
      .click();
    await saved(page, 'Yearly expense deleted');
    expect((await budgetPage(request)).summary.yearlyFundCents).toBe(
      withItem.summary.yearlyFundCents,
    );

    const itemLabel = `budget row ${itemName}`;
    await page.getByRole('button', { name: `Delete ${itemLabel}`, exact: true }).click();
    await page
      .getByRole('group', { name: `Delete the ${itemLabel}?` })
      .getByRole('button', { name: `Delete the ${itemLabel}` })
      .click();
    await saved(page, 'Budget item deleted');
    expect((await budgetPage(request)).summary.plannedSpendCents).toBe(
      before.summary.plannedSpendCents,
    );
    expect(errors).toEqual([]);
  });

  test('dividends: confirm a fake suggestion, delete it; dismiss and restore one', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const refresh = await request.post('/api/dividends/suggestions/refresh');
    expect(refresh.status(), await refresh.text()).toBe(200);
    const before = await dividendsPage(request);
    const due = before.suggestions.find((s) => s.status === 'due');
    expect(due, 'a due suggestion in fake mode').toBeDefined();
    if (!due) return;
    const exShown = due.exDate.split('-').reverse().join('/');
    const label = `${due.symbol} ex-date ${exShown}`;
    await page.goto('/dividends');
    await page
      .getByRole('button', { name: `Confirm the suggestion ${label}`, exact: true })
      .click();
    const form = page.getByRole('form', { name: `Confirm · ${label}` });
    await expect(form.getByRole('textbox', { name: 'Price at ex-date' })).toHaveValue('');
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Add dividend' }).click();
    await saved(page, 'Dividend added');
    const after = await dividendsPage(request);
    const row = after.dividends.find((d) => d.note === E2E_NOTE);
    expect(row?.exDate).toBe(due.exDate);
    expect(row?.priceAtExManual).toBe(false);
    expect(
      after.suggestions.some((s) => s.instrumentId === due.instrumentId && s.exDate === due.exDate),
    ).toBe(false);
    if (row) {
      const rowLabel = `the dividend of ${row.paymentDate.split('-').reverse().join('/')} (${row.symbol ?? row.ticker})`;
      await page.getByRole('button', { name: `Delete ${rowLabel}`, exact: true }).click();
      await page
        .getByRole('group', { name: `Delete ${rowLabel}?` })
        .getByRole('button', { name: `Delete ${rowLabel}` })
        .click();
      await saved(page, 'Dividend deleted');
    }

    // Dismiss and restore (an overlay).
    const next = (await dividendsPage(request)).suggestions.find((s) => s.status !== 'dismissed');
    expect(next, 'a suggestion to dismiss').toBeDefined();
    if (!next) return;
    const nextLabel = `${next.symbol} ex-date ${next.exDate.split('-').reverse().join('/')}`;
    await page
      .getByRole('button', { name: `Dismiss the suggestion ${nextLabel}`, exact: true })
      .click();
    await saved(page, 'Suggestion dismissed');
    await expectNoAppData(request);
    await page.getByText(/^Dismissed \(\d+\)$/).click();
    await page
      .getByRole('button', { name: `Restore the suggestion ${nextLabel}`, exact: true })
      .click();
    await saved(page, 'Suggestion restored');
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });

  test('dividends: confirming the last active suggestion closes the form; a restore brings no stale form back', async ({
    page,
    request,
  }) => {
    // The refetch drops the confirmed suggestion before the save settles; when it was the last one,
    // the list empties while the form is saving. The form must still close and announce (CODE-1).
    const errors = trackConsoleErrors(page);
    const refresh = await request.post('/api/dividends/suggestions/refresh');
    expect(refresh.status(), await refresh.text()).toBe(200);
    const before = await dividendsPage(request);
    const due = before.suggestions.find((s) => s.status === 'due');
    expect(due, 'a due suggestion in fake mode').toBeDefined();
    if (!due) return;
    const others = before.suggestions.filter(
      (s) =>
        s.status !== 'dismissed' &&
        !(s.instrumentId === due.instrumentId && s.exDate === due.exDate),
    );
    expect(others.length, 'another active suggestion to dismiss and restore').toBeGreaterThan(0);
    const dismissed: { instrumentId: number; exDate: string }[] = [];
    let createdId: number | null = null;
    try {
      for (const s of others) {
        const key = { instrumentId: s.instrumentId, exDate: s.exDate };
        const res = await request.post('/api/dividends/suggestions/dismiss', { data: key });
        expect(res.status(), await res.text()).toBe(200);
        dismissed.push(key);
      }
      const label = `${due.symbol} ex-date ${due.exDate.split('-').reverse().join('/')}`;
      await page.goto('/dividends');
      await page
        .getByRole('button', { name: `Confirm the suggestion ${label}`, exact: true })
        .click();
      const form = page.getByRole('form', { name: `Confirm · ${label}` });
      await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
      // Force the race: hold back another query the save refetches (the import runs), so the
      // dividends refetch (which drops the confirmed suggestion) renders before the save settles.
      await page.route('**/api/import/runs', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await form.getByRole('button', { name: 'Add dividend' }).click();
      await saved(page, 'Dividend added');
      await page.unroute('**/api/import/runs');
      createdId =
        (await dividendsPage(request)).dividends.find((d) => d.note === E2E_NOTE)?.id ?? null;
      expect(createdId, 'the confirmed dividend').not.toBeNull();
      await expect(page.getByTestId('suggestions-none')).toBeVisible();
      await expect(page.getByRole('form', { name: /^Confirm · / })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /^Edit the dividend of / }).first(),
      ).toBeEnabled();

      // Restore one dismissed suggestion: the list has an active row again, and no stale form.
      const back = others[0];
      if (!back) return;
      const backLabel = `${back.symbol} ex-date ${back.exDate.split('-').reverse().join('/')}`;
      await page.getByText(/^Dismissed \(\d+\)$/).click();
      await page
        .getByRole('button', { name: `Restore the suggestion ${backLabel}`, exact: true })
        .click();
      await saved(page, 'Suggestion restored');
      await expect(page.getByRole('table', { name: /^Suggestions from Yahoo: / })).toBeVisible();
      await expect(page.getByRole('form', { name: /^Confirm · / })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      createdId ??=
        (await dividendsPage(request)).dividends.find((d) => d.note === E2E_NOTE)?.id ?? null;
      if (createdId !== null) {
        const res = await request.delete(`/api/dividends/${createdId}`);
        expect(res.status(), await res.text()).toBe(200);
      }
      for (const key of dismissed) {
        const res = await request.post('/api/dividends/suggestions/restore', { data: key });
        expect(res.status(), await res.text()).toBe(200);
      }
    }
    await expectNoAppData(request);
  });
});
