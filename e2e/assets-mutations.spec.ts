// Assets mutations through the UI (stage-4.md §7.8 step 5). Runs only in the `assets-mutations`
// Playwright project (desktop viewport, after `cashflow-mutations`), because the app rows it
// creates would make the Stage 1 import spec answer 409 (D34). Every row it creates carries
// E2E_NOTE and is deleted again (an app row's delete writes no marker), it restores the one
// import-safe edit it makes (the SG fund), and it never edits a workbook setting, so afterwards
// `hasAppData === false`. Drafted by web phase A; the Integrator adds the project to
// playwright.config.ts and finishes the spec against the real API.
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_NOTE,
  cleanupAssetsRows,
  expectAssetsApi,
  otherAssetsPage,
  propertyPage,
  superPage,
} from './assets-support';
import { cashPage, cleanupCashflowRows } from './cashflow-support';
import {
  NOT_READY_REASON,
  SYNTHETIC_IMPORT_READY,
  ensureImported,
  importRuns,
} from './records-support';
import { trackConsoleErrors } from './support';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'assets-mutations';

/** A local date `offset` days from today, as the API and the forms write it. */
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

test.describe('assets mutations', () => {
  const active = (project: string): boolean => project === PROJECT && SYNTHETIC_IMPORT_READY;

  test.beforeAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupAssetsRows(request);
  });

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== PROJECT, 'runs in the assets-mutations project only');
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    await ensureImported(request);
    await expectAssetsApi(request);
  });

  test.afterAll(async ({ request }, testInfo) => {
    if (!active(testInfo.project.name)) return;
    await cleanupAssetsRows(request);
    await cleanupCashflowRows(request);
    await expectNoAppData(request);
  });

  test('other assets: a USD item gets its FX at purchase; price, sale, oversell, delete', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const name = `${E2E_NOTE} print`;
    await page.goto('/other-assets');
    await page.getByRole('button', { name: 'Add asset' }).click();
    const form = page.getByRole('form', { name: 'Add asset' });
    await form.getByRole('textbox', { name: /Description/ }).fill(name);
    await form.getByRole('textbox', { name: 'Purchase date' }).fill(localDate(-30).shown);
    await form.getByRole('textbox', { name: /Units/ }).fill('3');
    await form.getByRole('combobox', { name: 'Currency' }).selectOption('USD');
    await form.getByRole('textbox', { name: 'Unit cost' }).fill('100');
    await form.getByRole('textbox', { name: 'Current price' }).fill('120');
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Asset saved');

    // The fake price job fills the FX at purchase (market) and the cost appears.
    const refresh = await request.post('/api/prices/refresh', { data: {} });
    expect(refresh.status(), await refresh.text()).toBe(200);
    await expect
      .poll(async () => {
        const item = (await otherAssetsPage(request)).assets.find((a) => a.description === name);
        return item?.purchaseFxSource ?? null;
      })
      .toBe('market');
    let item = (await otherAssetsPage(request)).assets.find((a) => a.description === name);
    expect(item?.costCents).not.toBeNull();
    const valueBefore = item?.valueCents ?? null;

    // Update its price: the value changes.
    await page.reload();
    await page.getByRole('button', { name: 'Update prices' }).click();
    const prices = page.getByRole('form', { name: 'Update prices' });
    await prices.getByRole('textbox', { name: `Price, ${name}`, exact: true }).fill('150');
    await prices.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await prices.getByRole('button', { name: 'Save prices' }).click();
    await saved(page, 'Prices saved');
    item = (await otherAssetsPage(request)).assets.find((a) => a.description === name);
    expect(item?.valueCents).not.toBe(valueBefore);

    // Sell part: a realised gain, fewer units left.
    await page.getByRole('button', { name: `Sell ${name}`, exact: true }).click();
    let sale = page.getByRole('form', { name: `Sell · ${name}` });
    await sale.getByRole('textbox', { name: /Units/ }).fill('1');
    await sale.getByRole('textbox', { name: /Proceeds received/ }).fill('250');
    await sale.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await sale.getByRole('button', { name: 'Record sale' }).click();
    await saved(page, 'Sale recorded');
    const afterSale = await otherAssetsPage(request);
    item = afterSale.assets.find((a) => a.description === name);
    expect(item?.remainingUnits).toBe('2');
    expect(item?.saleCount).toBe(1);
    // The realised gain: the proceeds less the cost of the unit sold (at the purchase FX rate).
    const recorded = afterSale.sales.find((s) => s.assetId === item?.id);
    expect(recorded?.costCents, 'the sold unit’s cost').not.toBeNull();
    expect(recorded?.realisedCents).toBe(25_000 - (recorded?.costCents ?? 0));
    expect(item?.realisedCents).toBe(recorded?.realisedCents);
    await expect(
      page.getByRole('table', { name: /^Sales: / }).getByRole('row', { name: new RegExp(name) }),
    ).toBeVisible();

    // A sale past the units left: the 422 in the server's words.
    const response = await request.post(`/api/other-assets/${item?.id ?? 0}/sales`, {
      data: { saleDate: localDate(0).iso, units: '5', proceedsCents: 100, note: E2E_NOTE },
    });
    expect(response.status(), await response.text()).toBe(422);
    await page.getByRole('button', { name: `Sell ${name}`, exact: true }).click();
    sale = page.getByRole('form', { name: `Sell · ${name}` });
    await sale.getByRole('textbox', { name: /Units/ }).fill('5');
    await sale.getByRole('textbox', { name: /Proceeds received/ }).fill('1');
    await sale.getByRole('button', { name: 'Record sale' }).click();
    await expect(sale).toContainText('Only 2 units are left to sell');
    await sale.getByRole('button', { name: 'Cancel' }).click();

    // Delete it (its prices and sales go with it).
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    const edit = page.getByRole('form', { name: `Edit item · ${name}` });
    await edit.getByRole('button', { name: 'Delete item' }).click();
    await edit.getByRole('button', { name: `Delete the item ${name}` }).click();
    await saved(page, 'Asset deleted');
    expect(
      (await otherAssetsPage(request)).assets.find((a) => a.description === name),
    ).toBeUndefined();
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });

  test('super: the SG fund and an SG statement are import-safe; a contribution moves savings', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await superPage(request);
    const imported = before.funds.filter((f) => f.origin === 'import' && !f.archived);
    expect(imported.length, 'an imported fund').toBeGreaterThan(0);
    const current = before.funds.find((f) => f.receivesSg) ?? null;
    const target = imported.find((f) => f.id !== current?.id) ?? imported[0];
    if (!target) return;
    try {
      if (target.id === current?.id) {
        // The only imported fund already receives SG: clear the flag first (a flag-only edit is
        // import-safe too), so the picker has a change to save.
        const cleared = await request.put(`/api/super/funds/${target.id}`, {
          data: { name: target.name, receivesSg: false, archived: target.archived },
        });
        expect(cleared.status(), await cleared.text()).toBe(200);
      }
      // The SG fund (the section bar's picker): a flag-only edit keeps re-import available.
      await page.goto('/super');
      await page.getByRole('combobox', { name: 'SG fund' }).selectOption(String(target.id));
      await page.getByRole('button', { name: 'Save: SG fund' }).click();
      await saved(page, 'SG fund saved');
      await expectNoAppData(request);
      expect((await superPage(request)).funds.find((f) => f.id === target.id)?.receivesSg).toBe(
        true,
      );
    } finally {
      // Restore the SG fund as it was (a flag-only edit keeps each row's origin).
      const restore = current ?? target;
      const response = await request.put(`/api/super/funds/${restore.id}`, {
        data: { name: restore.name, receivesSg: current !== null, archived: restore.archived },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await expectNoAppData(request);

    // An SG statement for this month (an overlay): still no app data; then remove it.
    const month = localDate(0).iso.slice(0, 7);
    await page.reload();
    await page
      .getByRole('button', { name: `Enter a statement for ${monthLabel(month)}`, exact: true })
      .click();
    const statement = page.getByRole('form', { name: `Statement · ${monthLabel(month)}` });
    await statement.getByRole('textbox', { name: /Employer contribution before tax/ }).fill('1000');
    await statement.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await statement.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Statement saved');
    await expectNoAppData(request);
    await page
      .getByRole('button', { name: `Remove the statement for ${monthLabel(month)}`, exact: true })
      .click();
    await saved(page, 'Statement removed');

    // A salary-sacrifice contribution dated today moves the provisional super part by its
    // take-home cost (D71); then delete it.
    const cashBefore = await cashPage(request);
    const provisionalBefore = cashBefore.periods.find((p) => p.status === 'provisional');
    expect(provisionalBefore, 'a provisional period').toBeDefined();
    await page.getByRole('button', { name: 'Add contribution' }).click();
    const form = page.getByRole('form', { name: 'Add contribution' });
    await form.getByRole('textbox', { name: /Pre-tax amount/ }).fill('1000');
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Contribution saved');
    const added = (await superPage(request)).contributions.find((c) => c.note === E2E_NOTE);
    expect(added, 'the new contribution').toBeDefined();
    expect(added?.kind).toBe('salary_sacrifice');
    expect(added?.date).toBe(localDate(0).iso);
    // The synthetic workbook sets a marginal rate, so the take-home cost is known and positive:
    // the pre-tax amount less the tax it saved (D71).
    expect(added?.netPayCostCents ?? 0).toBeGreaterThan(0);
    expect(added?.netPayCostCents ?? 0).toBeLessThan(100_000);
    const provisionalAfter = (await cashPage(request)).periods.find(
      (p) => p.status === 'provisional',
    );
    expect(provisionalAfter?.added?.superCents).toBe(
      (provisionalBefore?.added?.superCents ?? 0) + (added?.netPayCostCents ?? 0),
    );
    await page
      .getByRole('button', { name: `Delete the contribution of ${localDate(0).shown}` })
      .first()
      .click();
    await page
      .getByRole('group', { name: `Delete the contribution of ${localDate(0).shown}?` })
      .getByRole('button', { name: `Delete the contribution of ${localDate(0).shown}` })
      .click();
    await saved(page, 'Contribution deleted');
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });

  test('property: a loan entry with estimated then entered repayments; an offset link', async ({
    page,
    request,
  }) => {
    const errors = trackConsoleErrors(page);
    const before = await propertyPage(request);
    const loan = before.loans.find((l) => l.propertyId !== null);
    expect(loan, 'a mortgage in the synthetic workbook').toBeDefined();
    if (!loan) return;

    // A balance entry dated today: a new log row with estimated repayments; the payoff changes.
    await page.goto('/property');
    await page
      .getByRole('button', { name: `Update the balance of ${loan.name}`, exact: true })
      .click();
    let form = page.getByRole('form', { name: `Update balance · ${loan.name}` });
    const lower = Math.max(0, loan.balanceCents - 500_000) / 100;
    await form.getByRole('textbox', { name: /^Balance/ }).fill(String(lower));
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill(E2E_NOTE);
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Balances saved');
    let entry = (await propertyPage(request)).loanEntries.find(
      (e) => e.loanId === loan.id && e.note === E2E_NOTE,
    );
    expect(entry?.repaymentsTyped).toBe(false);
    const afterEntry = (await propertyPage(request)).loans.find((l) => l.id === loan.id);
    expect(afterEntry?.schedule?.payoffDate).not.toBe(loan.schedule?.payoffDate ?? null);

    // Edit its repayments: interest and fees follow (repayments − principal).
    await page.getByRole('button', { name: `Edit the balance of ${localDate(0).shown}` }).click();
    form = page.getByRole('form', {
      name: `Edit entry · ${loan.name} · ${localDate(0).shown}`,
    });
    await form.getByRole('textbox', { name: 'Repayments' }).fill('6000');
    await form.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Loan saved');
    entry = (await propertyPage(request)).loanEntries.find(
      (e) => e.loanId === loan.id && e.note === E2E_NOTE,
    );
    expect(entry?.repaymentsTyped).toBe(true);
    expect(entry?.interestFeesCents).toBe(600_000 - (entry?.principalCents ?? 0));

    // Delete it.
    await page.getByRole('button', { name: `Delete the balance of ${localDate(0).shown}` }).click();
    await page
      .getByRole('group', { name: `Delete the balance of ${localDate(0).shown}?` })
      .getByRole('button', { name: `Delete the balance of ${localDate(0).shown}` })
      .click();
    await saved(page, 'Balance deleted');

    // An offset account (Cash), linked here: the net balance, LVR and payoff move; then unlink
    // it by turning Offset off, and delete the account.
    const accountName = `${E2E_NOTE} offset`;
    const created = await request.post('/api/cash/accounts', {
      data: {
        name: accountName,
        kind: 'bank',
        isOffset: true,
        note: E2E_NOTE,
        openingBalanceCents: 1_000_000,
        asOf: localDate(0).iso,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.reload();
    await page
      .getByRole('button', { name: `Link offset accounts to ${loan.name}`, exact: true })
      .click();
    const offsets = page.getByRole('form', { name: `Offset accounts · ${loan.name}` });
    await offsets.getByRole('checkbox', { name: accountName }).check();
    await offsets.getByRole('button', { name: 'Save links' }).click();
    await saved(page, 'Offsets linked');
    const linkedPage = await propertyPage(request);
    const linked = linkedPage.loans.find((l) => l.id === loan.id);
    expect(linked?.offsetAccountIds).toHaveLength(loan.offsetAccountIds.length + 1);
    expect(linked?.netBalanceCents).toBe(Math.max(0, loan.balanceCents - 1_000_000));
    expect(linked?.schedule?.payoffDate).not.toBe(loan.schedule?.payoffDate ?? null);
    expect(linked?.interestSavedCents ?? 0).toBeGreaterThan(0);
    // The loan to value is net of the linked offsets (D67), so it drops.
    const lvrBefore = before.properties.find((p) => p.id === loan.propertyId)?.lvrRatio;
    const lvrAfter = linkedPage.properties.find((p) => p.id === loan.propertyId)?.lvrRatio;
    expect(Number(lvrAfter)).toBeLessThan(Number(lvrBefore));
    expect(Number(linkedPage.totals.lvrRatio)).toBeLessThan(Number(before.totals.lvrRatio));

    await page.goto('/cash');
    await page.getByRole('button', { name: `Edit ${accountName}`, exact: true }).click();
    const account = page.getByRole('form', { name: `Edit account · ${accountName}` });
    await expect(account).toContainText(`Linked to ${loan.name}`);
    await account.getByRole('switch', { name: 'Offset account: kept out of Total cash' }).click();
    await expect(account.getByRole('note', { name: 'Offset link' })).toBeVisible();
    await account.getByRole('button', { name: 'Save' }).click();
    await saved(page, 'Account saved');
    expect(
      (await propertyPage(request)).loans.find((l) => l.id === loan.id)?.offsetAccountIds,
    ).toEqual(loan.offsetAccountIds);
    await cleanupCashflowRows(request);
    await expectNoAppData(request);
    expect(errors).toEqual([]);
  });
});
