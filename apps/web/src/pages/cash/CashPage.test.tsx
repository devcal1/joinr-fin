import type { CashPageResponse } from '@joinr/schema';
import {
  apiErrors,
  balancesResponse,
  cashAccountMutationResponse,
  cashPages,
  importRunsWithAppData,
  settingsPatchResponse,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyRows, centsOf, columnTexts, mockCashflow, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf, totalRow } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const M = '−';

async function openCash(fixture: CashPageResponse = cashPages.populated, routes = {}) {
  const api = mockCashflow({ cash: fixture, routes });
  const view = renderApp('/cash');
  await screen.findByRole('group', { name: 'Total cash' });
  return { ...view, api };
}

function tile(name: string | RegExp): HTMLElement {
  return screen.getByRole('group', { name });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cash page: states (§6.10)', () => {
  it.each(Object.entries(cashPages))('renders the %s fixture', async (_name, fixture) => {
    mockCashflow({ cash: fixture });
    renderApp('/cash');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cash' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Total cash' })).toBeVisible();
    for (const title of ['Accounts', 'Savings', 'Goals', 'Settings for this page']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
  });

  it('loading and error', async () => {
    mockCashflow({ cash: pending });
    renderApp('/cash');
    expect(await screen.findByText('Loading cash…')).toBeVisible();
  });

  it('a failed load offers Retry', async () => {
    mockCashflow({ cash: apiError(500, apiErrors.internal) });
    renderApp('/cash');
    const callout = await screen.findByRole('note', { name: 'Could not load the cash page' });
    expect(within(callout).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('empty: no accounts, no recorded months, no goals', async () => {
    await openCash(cashPages.empty);
    expect(screen.getByRole('note', { name: 'No accounts' })).toHaveTextContent(
      'No cash accounts yet. Add one, or import the workbook on the Import page.',
    );
    expect(screen.getByRole('link', { name: 'Import page' })).toHaveAttribute('href', '/import');
    expect(screen.getByRole('note', { name: 'No recorded months' })).toHaveTextContent(
      'Savings start after the first recorded month. Import the workbook for past months; recording arrives in Stage 5.',
    );
    expect(screen.getByText('No goals yet. Add one to track saving toward it.')).toBeVisible();
    // Nothing to update yet: only Add account.
    expect(screen.queryByRole('button', { name: 'Update balances' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeVisible();
  });

  it('no snapshots: the accounts show, the savings say when they start', async () => {
    await openCash(cashPages.noSnapshots);
    expect(tableNamed('Bank accounts: 2 accounts')).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'No recorded months' })).toBeVisible();
    expect(tile('Last period saved')).toHaveTextContent('Needs a recorded month');
    expect(tile('3-month trend')).toHaveTextContent('—Needs two recorded periods');
  });
});

describe('Cash page: tiles (§6.3 item 2)', () => {
  it('Total cash is the only teal figure, with the offsets hint', async () => {
    const { container } = await openCash();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Total cash')).toHaveClass('jf-stat-tile--key');
    expect(tile('Total cash')).toHaveTextContent('$30,900');
    expect(tile('Total cash')).toHaveTextContent('Offsets $10,000 not included');
  });

  it('last period, average, year rate and the 3-month trend', async () => {
    await openCash();
    expect(tile('Last period saved')).toHaveTextContent('$1,200');
    expect(tile('Last period saved')).toHaveTextContent('17.9% of income · Aug 2026');
    expect(tile('Saved per month')).toHaveTextContent('$1,800');
    expect(tile('Saved per month')).toHaveTextContent('12-month average · 5 periods');
    expect(tile('FY2026–27 savings rate')).toHaveTextContent('29.0%');
    expect(tile('FY2026–27 savings rate')).toHaveTextContent('2 periods');
    const trend = tile('3-month trend');
    expect(trend).toHaveTextContent(`${M}7.8 points / month`);
    expect(trend).toHaveTextContent('Decreasing');
    // An arrow and a word, never colour only.
    expect(trend.querySelector('.jf-stat-tile__delta svg')).not.toBeNull();
  });

  it('the emergency fund follows loansIncluded and offsetsIncluded (D59, D56)', async () => {
    await openCash();
    const fund = tile('Emergency fund');
    expect(fund).toHaveTextContent('$11,000');
    expect(within(fund).getByText('Covered')).toBeVisible();
    // The figure is the target; the hint says so, then what counts toward it.
    expect(fund).toHaveTextContent(
      "Target. Counts total cash except loans you've made (credit cards and other accounts count)",
    );
    expect(fund).not.toHaveTextContent('plus offsets');
  });

  it('short of the emergency fund, offsets counted', async () => {
    await openCash(cashPages.emergencyShort);
    const fund = tile('Emergency fund');
    expect(fund).toHaveTextContent('$40,000');
    expect(within(fund).getByText('Short by $2,100')).toBeVisible();
    expect(fund).toHaveTextContent(', plus offsets');
  });

  it('loans included: the basis says total cash', async () => {
    const fixture: CashPageResponse = {
      ...cashPages.populated,
      totals: {
        ...cashPages.populated.totals,
        emergencyFund: { ...cashPages.populated.totals.emergencyFund, loansIncluded: true },
      },
    };
    await openCash(fixture);
    expect(tile('Emergency fund')).toHaveTextContent('Target. Counts total cash');
    expect(tile('Emergency fund')).not.toHaveTextContent("except loans you've made");
  });

  it.each(['1.25', '-0.1'])(
    'a year rate of %s carries a Check badge and says why',
    async (ratio) => {
      await openCash({
        ...cashPages.populated,
        kpis: { ...cashPages.populated.kpis, yearSavingsRatio: ratio },
      });
      const rate = tile('FY2026–27 savings rate');
      expect(within(rate).getByText('Check')).toBeVisible();
      expect(rate).toHaveTextContent(
        '2 periods · Check: a one-off inflow or outflow usually causes this; add an adjustment',
      );
    },
  );

  it('a year rate within 0–100 % has no Check badge', async () => {
    await openCash();
    expect(within(tile('FY2026–27 savings rate')).queryByText('Check')).toBeNull();
  });

  it('once the last recorded month’s year has ended, the year figures say which year they follow', async () => {
    // The year follows the last recorded month (§2.6): here Aug 2026's FY, which ended on 30/06/2027.
    await openCash({ ...cashPages.populated, asOf: '2027-07-01' });
    expect(tile('FY2026–27 savings rate')).toHaveTextContent(
      '2 periods · the year of the last recorded month (Aug 2026)',
    );
    const eoy = screen.getByRole('region', { name: 'End-of-year cash goal' });
    expect(eoy).toHaveTextContent(
      'Per month over the 10 months left after the last recorded month',
    );
    expect(within(eoy).getByTestId('eoy-anchor-note')).toHaveTextContent(
      'Projected from the last recorded month (Aug 2026); recording a month arrives in Stage 5.',
    );
  });

  it('while the year of the last recorded month includes today, nothing extra is said', async () => {
    await openCash();
    expect(tile('FY2026–27 savings rate')).not.toHaveTextContent('the year of the last recorded');
    expect(screen.queryByTestId('eoy-anchor-note')).toBeNull();
  });

  it('null figures: early in the year and without an emergency-fund target', async () => {
    await openCash(cashPages.earlyYear);
    expect(tile('FY2026–27 savings rate')).toHaveTextContent(
      '—No recorded months in FY2026–27 yet',
    );
  });

  it('missing settings: the calendar basis, a flat trend and no emergency-fund target', async () => {
    await openCash(cashPages.missingSettings);
    expect(tile('2026 savings rate')).toHaveTextContent('33.5%');
    expect(tile('3-month trend')).toHaveTextContent('0.0 points / month');
    expect(tile('3-month trend')).toHaveTextContent('Flat');
    expect(tile('Emergency fund')).toHaveTextContent(
      '—Set pay and budget settings on the Budget page',
    );
  });
});

describe('Cash page: accounts (§6.3 item 3)', () => {
  it('one table per kind group, offsets last, each subtotal the Σ of its rows', async () => {
    await openCash();
    const captions = screen
      .getAllByRole('table')
      .map((t) => t.querySelector('caption')?.textContent ?? '')
      .filter((c) => / accounts?$/.test(c));
    expect(captions).toEqual([
      'Bank accounts: 2 accounts',
      'Credit cards: 1 account',
      "Loans you've made: 1 account",
      'Other: 1 account',
      'Offset accounts (not in Total cash): 1 account',
    ]);
    for (const caption of captions) {
      const table = tableNamed(caption);
      const sum = columnTexts(table, 'Balance').reduce((s, t) => s + (centsOf(t) ?? 0), 0);
      const total = totalRow(table);
      expect(centsOf(cell(table, total, 'Balance'))).toBe(sum);
      // White bold, never teal (§6.1).
      expect(total.querySelector('.jf-table__key')).toBeNull();
    }
    expect(headers(tableNamed('Bank accounts: 2 accounts'))).toEqual([
      'Account',
      'Balance',
      'As of',
      'Source',
      'Actions',
    ]);
  });

  it('a negative balance (money owed) is red on any kind; the markers and totals', async () => {
    await openCash();
    const cards = tableNamed('Credit cards: 1 account');
    const card = rowOf(cards, 'Credit card');
    expect(cell(cards, card, 'Balance')).toBe(`${M}$1,500.00`);
    expect(card.querySelector('.jf-amount--negative')).not.toBeNull();
    const loans = tableNamed("Loans you've made: 1 account");
    expect(rowOf(loans, 'Loan to a friend')).toHaveTextContent('Not in the emergency fund');
    const bank = tableNamed('Bank accounts: 2 accounts');
    expect(rowOf(bank, 'Everyday account')).not.toHaveTextContent('Not in the emergency fund');
    expect(cell(bank, rowOf(bank, 'Everyday account'), 'Source')).toBe('Workbook');
    expect(
      cell(
        tableNamed('Other: 1 account'),
        rowOf(tableNamed('Other: 1 account'), 'Cash at home'),
        'Source',
      ),
    ).toBe('App');
    const totals = screen.getByRole('table', { name: 'Cash totals' });
    expect(totals).toHaveTextContent('Total cash$30,900.00');
    expect(totals).toHaveTextContent("Available cash (total − loans you've made)$27,900.00");
    expect(totals).toHaveTextContent('Emergency-fund cash$27,900.00');
  });

  it('phone: status-first column order (§6.9)', async () => {
    emulatePhone();
    await openCash();
    expect(headers(tableNamed('Bank accounts: 2 accounts'))).toEqual([
      'Account',
      'Balance',
      'As of',
      'Actions',
      'Source',
    ]);
  });

  it('balance history: the account with most entries first, its last entry has no Delete', async () => {
    const { user } = await openCash();
    const card = screen.getByRole('region', { name: 'Balance history' });
    expect(within(card).getByRole('combobox', { name: 'Account' })).toHaveValue('1');
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Balance history: Everyday account' });
    expect(bodyRows(table)).toHaveLength(2);
    expect(within(table).getAllByRole('button', { name: /^Delete the balance of/ })).toHaveLength(
      2,
    );
    // History on the credit card row picks that account: one entry, no Delete.
    await user.click(screen.getByRole('button', { name: 'History of Credit card' }));
    const one = within(card).getByRole('table', { name: 'Balance history: Credit card' });
    expect(within(one).queryByRole('button', { name: /^Delete/ })).toBeNull();
    expect(one).toHaveTextContent('Last balance');
  });

  it('deleting a history entry confirms in its cell and sends DELETE', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'DELETE /api/cash/balance-entries/7': { body: cashAccountMutationResponse },
    });
    const card = screen.getByRole('region', { name: 'Balance history' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    await user.click(
      within(card).getByRole('button', { name: 'Delete the balance of 20/09/2026' }),
    );
    const confirm = within(card).getByRole('group', { name: 'Delete the balance of 20/09/2026?' });
    expect(within(confirm).getByRole('button', { name: /^Cancel/ })).toHaveFocus();
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete the balance of 20/09/2026' }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/cash/balance-entries/7')).toHaveLength(1));
  });
});

describe('Cash page: update balances (D58)', () => {
  it('every balance becomes a field named "Balance, <account>"; Save sends the changed rows only', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PUT /api/cash/balances': { body: balancesResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    const form = screen.getByRole('form', { name: 'Update balances' });
    const save = within(form).getByRole('button', { name: 'Save balances' });
    expect(save).toBeDisabled();
    expect(within(form).getByRole('textbox', { name: 'As of' })).toHaveFocus();
    for (const name of ['Everyday account', 'Credit card', 'Loan to a friend', 'Offset account']) {
      expect(within(form).getByRole('textbox', { name: `Balance, ${name}` })).toBeVisible();
    }
    const everyday = within(form).getByRole('textbox', { name: 'Balance, Everyday account' });
    await user.clear(everyday);
    await user.type(everyday, '5300');
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Payday');
    expect(save).toBeEnabled();
    // An imported account's balance: the workbook callout only (it already says a re-import is
    // blocked), never a second "App data" note with the same consequence.
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.click(save);
    await waitFor(() => expect(api.calls('PUT /api/cash/balances')).toHaveLength(1));
    const body = api.calls('PUT /api/cash/balances')[0]?.body as {
      asOf: string;
      entries: unknown[];
    };
    expect(body.entries).toEqual([{ accountId: 1, balanceCents: 530000, note: 'Payday' }]);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Balance saved.');
  });

  it('Enter saves; a date before an account’s latest balance shows the older-than note', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PUT /api/cash/balances': { body: balancesResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    const form = screen.getByRole('form', { name: 'Update balances' });
    const asOf = within(form).getByRole('textbox', { name: 'As of' });
    await user.clear(asOf);
    await user.type(asOf, '10/09/2026');
    const everyday = within(form).getByRole('textbox', { name: 'Balance, Everyday account' });
    await user.clear(everyday);
    await user.type(everyday, '5100');
    expect(form).toHaveTextContent(
      'Older than the latest balance (20/09/2026): added to the history only.',
    );
    await user.type(everyday, '{Enter}');
    await waitFor(() => expect(api.calls('PUT /api/cash/balances')).toHaveLength(1));
    expect(api.calls('PUT /api/cash/balances')[0]?.body).toEqual({
      asOf: '2026-09-10',
      entries: [{ accountId: 1, balanceCents: 510000 }],
    });
  });

  it('Cancel restores the table; errors map to the fields and the form', async () => {
    const { user } = await openCash(cashPages.populated, {
      'PUT /api/cash/balances': apiError(400, apiErrors.cashValidation),
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    let form = screen.getByRole('form', { name: 'Update balances' });
    const cash = within(form).getByRole('textbox', { name: 'Balance, Cash at home' });
    await user.clear(cash);
    await user.type(cash, '250');
    await user.click(within(form).getByRole('button', { name: 'Save balances' }));
    expect(await within(form).findByText('Must not be after tomorrow.')).toBeVisible();
    expect(within(form).getByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'Entries: an account appears twice.',
    );
    // An app account: no workbook callout; no app data yet, so the new-row note (§6.8).
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Update balances' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Update balances' })).toHaveFocus();
    form = tableNamed('Other: 1 account');
    expect(within(form).queryByRole('textbox')).toBeNull();
  });

  it('an import running answers in plain words', async () => {
    const { user } = await openCash(cashPages.populated, {
      'PUT /api/cash/balances': apiError(409, apiErrors.inProgress),
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    const form = screen.getByRole('form', { name: 'Update balances' });
    const cash = within(form).getByRole('textbox', { name: 'Balance, Cash at home' });
    await user.clear(cash);
    await user.type(cash, '250');
    await user.click(within(form).getByRole('button', { name: 'Save balances' }));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'An import is running; try again shortly.',
    );
  });
});

describe('Cash page: account form (§6.3 item 3, §3.4, §6.8)', () => {
  it('a kind-only change on a workbook account shows the import-safe note, not the workbook callout', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PUT /api/cash/accounts/4': { body: cashAccountMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit Loan to a friend' }));
    const form = screen.getByRole('form', { name: 'Edit account · Loan to a friend' });
    expect(within(form).getByRole('textbox', { name: /Name/ })).toHaveFocus();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'bank');
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Changing only the kind keeps re-import available.',
    );
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    // Any other change is an app edit.
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), ' 2');
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.clear(within(form).getByRole('textbox', { name: /Name/ }));
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Loan to a friend');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/cash/accounts/4')).toHaveLength(1));
    expect(api.calls('PUT /api/cash/accounts/4')[0]?.body).toEqual({
      name: 'Loan to a friend',
      kind: 'bank',
      isOffset: false,
      note: 'Repaid monthly',
    });
  });

  it('create: opening balance and date, the new-app-row note, POST body', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'POST /api/cash/accounts': { status: 201, body: cashAccountMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const form = screen.getByRole('form', { name: 'Add account' });
    expect(within(form).getByRole('note', { name: 'App data' })).toHaveTextContent(
      'Saving adds app data: re-importing the workbook will then be blocked.',
    );
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Travel card');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'credit_card');
    await user.type(within(form).getByRole('textbox', { name: /Opening balance/ }), '-45.50');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/cash/accounts')).toHaveLength(1));
    const body = api.calls('POST /api/cash/accounts')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Travel card',
      kind: 'credit_card',
      isOffset: false,
      note: null,
      openingBalanceCents: -4550,
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Account added.');
  });

  it('no new-app-row note once app data exists', async () => {
    mockCashflow({ importRuns: importRunsWithAppData });
    const { user } = renderApp('/cash');
    await user.click(await screen.findByRole('button', { name: 'Add account' }));
    const form = screen.getByRole('form', { name: 'Add account' });
    await waitFor(() => expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull());
  });

  it('delete: disabled while budget rows use it; a 409 shows the server message', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'DELETE /api/cash/accounts/6': apiError(409, apiErrors.accountInUse),
    });
    await user.click(screen.getByRole('button', { name: 'Edit Everyday account' }));
    let form = screen.getByRole('form', { name: 'Edit account · Everyday account' });
    expect(within(form).getByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(form).toHaveTextContent('Used by 3 budget rows');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Cash at home' }));
    form = screen.getByRole('form', { name: 'Edit account · Cash at home' });
    await user.click(within(form).getByRole('button', { name: 'Delete account' }));
    await user.click(within(form).getByRole('button', { name: 'Delete the account Cash at home' }));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'This account is used by 2 budget rows; move them first',
    );
    expect(api.calls('DELETE /api/cash/accounts/6')).toHaveLength(1);
  });
});

describe('Cash page: savings (§6.3 item 4, D51)', () => {
  function savingsTable(): HTMLElement {
    return tableNamed(/^Savings by period/);
  }

  it('the provisional row has Details only; the baseline Note only; closed rows all three', async () => {
    await openCash();
    const table = savingsTable();
    const live = rowOf(table, 'Sep 2026');
    expect(live).toHaveTextContent('Provisional');
    expect(
      within(live)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Details']);
    const first = rowOf(table, 'Mar 2026');
    expect(first).toHaveTextContent('Baseline');
    expect(
      within(first)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Note']);
    const closed = rowOf(table, 'Aug 2026');
    expect(
      within(closed)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Details', 'Adjust', 'Note']);
  });

  it('a rate above 100 % or below 0 % carries a Check badge described by a visible note', async () => {
    const { user } = await openCash();
    const table = savingsTable();
    const may = rowOf(table, 'May 2026');
    expect(cell(table, may, 'Savings rate')).toContain(`${M}5.0%`);
    const badge = may.querySelector('.jf-app-rate-check');
    const noteId = badge?.getAttribute('aria-describedby') ?? '';
    expect(noteId).not.toBe('');
    const note = document.getElementById(noteId);
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(
      'Check: a one-off inflow or outflow usually causes a rate above 100 % or below 0 %; add an adjustment.',
    );
    // Adjusted, June is fine; the raw view shows the sheet's 190 %.
    expect(within(rowOf(table, 'Jun 2026')).queryByText('Check')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Raw (as the sheet)' }));
    const raw = tableNamed(/^Savings by period.*\(as the sheet\)$/);
    const june = rowOf(raw, 'Jun 2026');
    expect(cell(raw, june, 'Savings rate')).toContain('190.0%');
    expect(within(june).getByText('Check')).toBeVisible();
  });

  it('the Adjusted | Raw switch changes the figures and drops the adjustment column', async () => {
    const { user } = await openCash();
    let table = savingsTable();
    const june = rowOf(table, 'Jun 2026');
    expect(cell(table, june, 'Savings')).toBe('$2,200.00');
    expect(cell(table, june, 'Income')).toBe('$6,500.00');
    expect(headers(table)).toContain('Adjustment');
    await user.click(screen.getByRole('button', { name: 'Raw (as the sheet)' }));
    table = tableNamed(/\(as the sheet\)$/);
    expect(cell(table, rowOf(table, 'Jun 2026'), 'Savings')).toBe('$12,200.00');
    expect(cell(table, rowOf(table, 'Jun 2026'), 'Income')).toBe('$6,420.00');
    expect(headers(table)).not.toContain('Adjustment');
  });

  it('negative savings are red; flows (cash gain, spend) stay in body text (D33)', async () => {
    await openCash();
    const table = savingsTable();
    const may = rowOf(table, 'May 2026');
    const savingsIndex = headers(table).indexOf('Savings');
    expect(may.children[savingsIndex]?.querySelector('.jf-amount--negative')).not.toBeNull();
    const aug = rowOf(table, 'Aug 2026');
    const gainIndex = headers(table).indexOf('Cash gain');
    expect(cell(table, aug, 'Cash gain')).toBe(`${M}$2,000.00`);
    expect(aug.children[gainIndex]?.querySelector('.jf-amount--negative')).toBeNull();
  });

  it('Details shows the parts of added investments and income', async () => {
    const { user } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Details of Aug 2026' }));
    const details = screen.getByRole('table', { name: 'Parts of Aug 2026' });
    expect(details).toHaveTextContent('Trades$3,000.00');
    expect(details).toHaveTextContent('Super$200.00');
    expect(details).toHaveTextContent('= Added investments$3,200.00');
    expect(details).toHaveTextContent('Salary$6,500.00');
    expect(details).toHaveTextContent('Side income$200.00');
    expect(details).toHaveTextContent('= Income$6,700.00');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Details of Aug 2026' })).toHaveFocus();
  });

  it('the read-only Details card locks nothing: Adjust on its row replaces it', async () => {
    const { user } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Details of Aug 2026' }));
    expect(screen.getByRole('table', { name: 'Parts of Aug 2026' })).toBeVisible();
    const adjust = screen.getByRole('button', { name: 'Adjust Aug 2026' });
    expect(adjust).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Note for Aug 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Details of Jul 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit Everyday account' })).toBeEnabled();
    await user.click(adjust);
    expect(screen.getByRole('form', { name: 'Adjust Aug 2026' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Parts of Aug 2026' })).toBeNull();
    // A form is open: the other row actions wait for it (one form at a time, §6.8).
    expect(screen.getByRole('button', { name: 'Details of Jul 2026' })).toBeDisabled();
  });

  it('an adjustment on a closed period: kept on re-import, PUT, Remove', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PUT /api/cash/adjustments/2026-07': {
        body: { periodMonth: '2026-07', amountCents: 25000, note: 'Asset sale' },
      },
      'DELETE /api/cash/adjustments/2026-06': { body: { periodMonth: '2026-06' } },
    });
    await user.click(screen.getByRole('button', { name: 'Adjust Jul 2026' }));
    let form = screen.getByRole('form', { name: 'Adjust Jul 2026' });
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Adjustments are kept when you re-import the workbook.',
    );
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.type(within(form).getByRole('textbox', { name: /Amount/ }), '250');
    await user.type(within(form).getByRole('textbox', { name: /Note/ }), 'Asset sale');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/cash/adjustments/2026-07')).toHaveLength(1));
    expect(api.calls('PUT /api/cash/adjustments/2026-07')[0]?.body).toEqual({
      amountCents: 25000,
      note: 'Asset sale',
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
      'Adjustment saved.',
    );
    await user.click(screen.getByRole('button', { name: 'Adjust Jun 2026' }));
    form = screen.getByRole('form', { name: 'Adjust Jun 2026' });
    // The first field has focus, so it shows its raw text.
    expect(within(form).getByRole('textbox', { name: /Amount/ })).toHaveValue('10000.00');
    await user.click(within(form).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.calls('DELETE /api/cash/adjustments/2026-06')).toHaveLength(1));
  });

  it('zero and an empty note are refused before sending', async () => {
    const { user, api } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Adjust Jul 2026' }));
    const form = screen.getByRole('form', { name: 'Adjust Jul 2026' });
    await user.type(within(form).getByRole('textbox', { name: /Amount/ }), '0');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Enter an amount other than zero.')).toBeVisible();
    expect(within(form).getByText('Say what the one-off was.')).toBeVisible();
    expect(api.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('a note on a recorded period; saving it empty removes it', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PUT /api/period-notes/spend/2026-07': { body: { note: null } },
    });
    await user.click(screen.getByRole('button', { name: 'Note for Jul 2026' }));
    const form = screen.getByRole('form', { name: 'Note for Jul 2026' });
    // An imported note: the workbook callout.
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.clear(within(form).getByRole('textbox', { name: 'Note' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/period-notes/spend/2026-07')).toHaveLength(1));
    expect(api.calls('PUT /api/period-notes/spend/2026-07')[0]?.body).toEqual({ note: '' });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Note removed.');
  });

  it('an orphan adjustment can be removed', async () => {
    // As the real server: once deleted, the refetch no longer lists the orphan. In a browser its
    // callout can unmount before the mutation settles; the page must still announce the removal.
    let removed = false;
    const { user, api } = await openCash(cashPages.populated, {
      'GET /api/cash': () => ({
        body: removed ? { ...cashPages.populated, orphanAdjustments: [] } : cashPages.populated,
      }),
      'DELETE /api/cash/adjustments/2025-12': () => {
        removed = true;
        return { body: { periodMonth: '2025-12' } };
      },
    });
    const orphan = screen.getByRole('note', { name: 'Adjustment without a period' });
    expect(orphan).toHaveTextContent('An adjustment for Dec 2025 has no recorded period');
    await user.click(
      within(orphan).getByRole('button', { name: 'Remove the adjustment for Dec 2025' }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/cash/adjustments/2025-12')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save result' })).toHaveTextContent(
        'Adjustment removed',
      ),
    );
    expect(screen.queryByRole('note', { name: 'Adjustment without a period' })).toBeNull();
  });

  it('charts and foot notes: the live point, and no Stage 4 note (staticUntilStage4 false)', async () => {
    const { user } = await openCash();
    for (const title of ['Cash value history', 'Savings history', 'Savings rate']) {
      expect(screen.getByRole('region', { name: title })).toBeVisible();
    }
    const rate = screen.getByRole('region', { name: 'Savings rate' });
    await user.click(within(rate).getByRole('button', { name: 'Table' }));
    const table = within(rate).getByRole('table', { name: 'Savings rate' });
    expect(rowOf(table, 'Sep 2026 (live)')).toBeInTheDocument();
    expect(headers(table)).toEqual(['Period', 'Savings rate', '3-month trend']);
    expect(rate).toHaveTextContent("The last point is provisional: it uses today's balances.");
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('The first recorded month is the baseline.');
    expect(main).toHaveTextContent(
      'Recording a month arrives in Stage 5; until then the current period stays provisional.',
    );
    // Stage 4 (stage-4.md §6.6): the live engines feed the provisional period; the note is gone.
    expect(main).not.toHaveTextContent(
      'Other assets, super and the mortgage use the imported figures until Stage 4.',
    );
  });

  it('phone: the savings table leads with the period, rate and savings (§6.9)', async () => {
    emulatePhone();
    await openCash();
    expect(headers(savingsTable())).toEqual([
      'Period',
      'Savings rate',
      'Savings',
      'Cash gain',
      'Cash',
      'Added investments',
      'Income',
      'Spend',
      'Adjustment',
      'Note',
      'Actions',
    ]);
  });
});

describe('Cash page: goals (§6.3 item 5, D55, D59)', () => {
  it('the cash target and end-of-year goal measure available cash', async () => {
    await openCash();
    const target = screen.getByRole('region', { name: 'Cash target' });
    const meter = within(target).getByRole('meter', { name: 'Available cash' });
    expect(meter).toHaveAttribute('aria-valuetext', '$27,900 of $50,000');
    expect(within(target).getByText('Short by $22,100')).toBeVisible();
    expect(within(target).getByTestId('cash-target-status')).toHaveTextContent(
      '56 months to go · Apr 2031',
    );
    const eoy = screen.getByRole('region', { name: 'End-of-year cash goal' });
    expect(within(eoy).getByRole('meter', { name: 'Available cash' })).toHaveAttribute(
      'aria-valuetext',
      '$27,900 of $35,000',
    );
    expect(eoy).toHaveTextContent('Projected at 30 June 2027$31,900.00');
    expect(eoy).toHaveTextContent('Per month over the 10 months left$310.00 a month behind');
    expect(within(eoy).getByText('Behind')).toBeVisible();
    expect(screen.getByRole('main')).toHaveTextContent(
      "Available cash is total cash minus loans you've made. The projections add your average monthly cash saved.",
    );
  });

  it('a meter over its target keeps the true figure: "Over by", fill clamped', async () => {
    await openCash({
      ...cashPages.populated,
      kpis: {
        ...cashPages.populated.kpis,
        cashTarget: {
          targetCents: 2_000_000,
          progressRatio: '1.395',
          monthsToTarget: null,
          arrival: null,
          status: 'reached',
        },
      },
    });
    const target = screen.getByRole('region', { name: 'Cash target' });
    const meter = within(target).getByRole('meter', { name: 'Available cash' });
    expect(meter).toHaveAttribute('aria-valuenow', '20000');
    expect(meter).toHaveAttribute('aria-valuetext', '$27,900 of $20,000. Over by $7,900');
    expect(within(target).getByText('Over by $7,900')).toBeVisible();
    expect(within(target).getByTestId('cash-target-status')).toHaveTextContent('Reached');
  });

  it('savings goals in waterfall order: meters, ETA, on track / behind, required per month', async () => {
    await openCash();
    const list = screen.getByRole('list', { name: 'Savings goals, in the order they are filled' });
    const goals = within(list).getAllByRole('listitem');
    expect(goals.map((g) => within(g).getByRole('heading').textContent)).toEqual([
      'Emergency buffer',
      'Holiday',
      'New car',
    ]);
    expect(within(goals[0] as HTMLElement).getByText('Reached')).toBeVisible();
    expect(within(goals[1] as HTMLElement).getByText('On track')).toBeVisible();
    const car = goals[2] as HTMLElement;
    expect(within(car).getByRole('meter')).toHaveAttribute('aria-valuetext', '$8,900 of $25,000');
    expect(car).toHaveTextContent('About Aug 2028 at $680 a month toward goals');
    expect(within(car).getByText('Behind')).toBeVisible();
    expect(car).toHaveTextContent('Needs $1,006 a month to reach it by 31/12/2027');
    expect(screen.getByTestId('goals-saved-line')).toHaveTextContent(
      "Saved toward goals: $26,900.00 = cash above the emergency fund, excluding loans you've made, + 20% of investments.",
    );
  });

  it('goal states: no progress, a past date, stale and unpriced investments', async () => {
    await openCash(cashPages.goalStates);
    const list = screen.getByRole('list', { name: /Savings goals/ });
    const holiday = within(list).getAllByRole('listitem')[3] as HTMLElement;
    expect(holiday).toHaveTextContent('No ETA: nothing is going toward goals at the moment');
    expect(holiday).toHaveTextContent('No target date');
    expect(within(holiday).queryByText('On track')).toBeNull();
    expect(screen.getByTestId('goals-saved-line')).toHaveTextContent(
      'Investments use stale prices. 1 holding without a price is left out.',
    );
  });

  it('goal states: the cash target says cash is not growing; a passed target date', async () => {
    await openCash(cashPages.goalStates);
    const target = screen.getByRole('region', { name: 'Cash target' });
    // The average cash gain is negative although "Saved per month" (which adds investments) is not.
    expect(within(target).getByTestId('cash-target-status')).toHaveTextContent(
      `Cash isn't growing at the moment (average cash gain ${M}$400 a month)`,
    );
    const list = screen.getByRole('list', { name: /Savings goals/ });
    const wedding = within(list).getAllByRole('listitem')[1] as HTMLElement;
    expect(within(wedding).getByRole('heading')).toHaveTextContent('Wedding');
    expect(wedding).toHaveTextContent('The target date (30/06/2026) has passed; $100 still to go');
    expect(wedding).not.toHaveTextContent('Needs $');
    expect(within(wedding).getByText('Behind')).toBeVisible();
  });

  it('no recorded months: the cash target and the goals say progress is not known yet', async () => {
    await openCash(cashPages.noSnapshots);
    const target = screen.getByRole('region', { name: 'Cash target' });
    expect(within(target).getByTestId('cash-target-status')).toHaveTextContent(
      'Needs recorded months',
    );
    const list = screen.getByRole('list', { name: /Savings goals/ });
    const car = within(list).getAllByRole('listitem')[2] as HTMLElement;
    expect(car).toHaveTextContent('No ETA yet: needs recorded months');
    expect(car).not.toHaveTextContent('nothing is going toward goals');
    // Progress is unknown, not behind (as the end-of-year card's "Not known yet").
    expect(within(car).queryByText('Behind')).toBeNull();
    expect(within(car).queryByText('On track')).toBeNull();
    expect(car).toHaveTextContent('Needs $1,073 a month to reach it by 31/12/2027');
  });

  it('the total-cash basis words (goals.cashBasis)', async () => {
    await openCash({
      ...cashPages.populated,
      goals: { ...cashPages.populated.goals, cashBasis: 'total' },
    });
    expect(screen.getByTestId('goals-saved-line')).toHaveTextContent(
      'Saved toward goals: $26,900.00 = total cash above the emergency fund + 20% of investments.',
    );
  });

  it('no goals yet', async () => {
    await openCash(cashPages.noGoals);
    expect(screen.getByTestId('goals-empty')).toHaveTextContent(
      'No goals yet. Add one to track saving toward it.',
    );
  });

  it('reorder sends every id in the new order; add a goal (an overlay: no app-data note)', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'POST /api/savings-goals/reorder': { body: { ids: [2, 1, 3] } },
      'POST /api/savings-goals': {
        status: 201,
        body: { goal: cashPages.populated.goals.items[0] },
      },
    });
    expect(
      screen.getByRole('button', { name: 'Move the goal Emergency buffer up' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move the goal New car down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move the goal Holiday up' }));
    await waitFor(() => expect(api.calls('POST /api/savings-goals/reorder')).toHaveLength(1));
    expect(api.calls('POST /api/savings-goals/reorder')[0]?.body).toEqual({ ids: [2, 1, 3] });
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    const form = screen.getByRole('form', { name: 'Add goal' });
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Goals are kept when you re-import the workbook.',
    );
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Bike');
    await user.type(within(form).getByRole('textbox', { name: 'Target' }), '1500');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/savings-goals')).toHaveLength(1));
    expect(api.calls('POST /api/savings-goals')[0]?.body).toEqual({
      name: 'Bike',
      targetCents: 150000,
      targetDate: null,
      note: null,
    });
  });

  it('delete a goal confirms first', async () => {
    // As the real server: the refetch drops the goal. In a browser its card can unmount before the
    // mutation settles (the e2e caught it); the page must still announce the delete.
    let deleted = false;
    const withoutGoal: CashPageResponse = {
      ...cashPages.populated,
      goals: {
        ...cashPages.populated.goals,
        items: cashPages.populated.goals.items.filter((g) => g.id !== 3),
      },
    };
    const { user, api } = await openCash(cashPages.populated, {
      'GET /api/cash': () => ({ body: deleted ? withoutGoal : cashPages.populated }),
      'DELETE /api/savings-goals/3': () => {
        deleted = true;
        return { body: { id: 3 } };
      },
    });
    await user.click(screen.getByRole('button', { name: 'Delete the goal New car' }));
    await user.click(screen.getByRole('button', { name: 'Delete the goal New car' }));
    await waitFor(() => expect(api.calls('DELETE /api/savings-goals/3')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save result' })).toHaveTextContent('Goal deleted'),
    );
    expect(screen.queryByRole('button', { name: 'Edit the goal New car' })).toBeNull();
  });
});

describe('Cash page: settings (§6.3 item 6, §3.3)', () => {
  it('lists the page settings with their defaults', async () => {
    await openCash();
    const table = screen.getByRole('table', { name: 'Settings for this page' });
    expect(table).toHaveTextContent('Year basisFinancial year (default)');
    expect(table).toHaveTextContent('Cash savings target$50,000.00');
    expect(table).toHaveTextContent('Share of investments counted toward goals20%');
    expect(table).toHaveTextContent('Offsets count toward the emergency fundNo');
  });

  it('the year basis alone is import-safe; a workbook key shows the workbook callout; PATCH sends changed keys only', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PATCH /api/settings': { body: settingsPatchResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit settings for this page' }));
    const form = screen.getByRole('form', { name: 'Edit settings for this page' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    // An unstored key shows its registry default, as the table does, not "Not set"; the draft
    // stays unset, so an untouched form sends nothing.
    const basis = within(form).getByRole('combobox', { name: 'Year basis' });
    expect(basis).toHaveValue('');
    expect(basis).toHaveDisplayValue('Financial year (default)');
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Year basis' }),
      'calendar',
    );
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'savings.yearBasis': 'calendar' },
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Settings saved.');
  });

  it('a workbook setting change warns and sends the parsed value', async () => {
    const { user, api } = await openCash(cashPages.populated, {
      'PATCH /api/settings': { body: settingsPatchResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit settings for this page' }));
    const form = screen.getByRole('form', { name: 'Edit settings for this page' });
    const share = within(form).getByRole('textbox', {
      name: 'Share of investments counted toward goals',
    });
    await user.clear(share);
    await user.type(share, '25');
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'goals.houseDepositInvestmentShare': '0.25' },
    });
  });
});

describe('Cash page: Stage 4 changes (stage-4.md §6.6, D67, D78)', () => {
  it('an offset account says which loan it is linked to; Offset off says it removes the link', async () => {
    const { user } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Edit Offset account' }));
    const form = screen.getByRole('form', { name: 'Edit account · Offset account' });
    expect(form).toHaveTextContent(
      'Linked to Example property mortgage (change it on the Property page)',
    );
    await user.click(
      within(form).getByRole('switch', { name: 'Offset account: kept out of Total cash' }),
    );
    expect(within(form).getByRole('note', { name: 'Offset link' })).toHaveTextContent(
      'This also removes its link to Example property mortgage.',
    );
    expect(form).not.toHaveTextContent('Linked to Example property mortgage (change it');
  });

  it('an offset account linked to no loan says where to link it', async () => {
    const fixture: CashPageResponse = {
      ...cashPages.populated,
      accounts: cashPages.populated.accounts.map((a) =>
        a.isOffset ? { ...a, linkedLoan: null } : a,
      ),
    };
    const { user } = await openCash(fixture);
    await user.click(screen.getByRole('button', { name: 'Edit Offset account' }));
    const form = screen.getByRole('form', { name: 'Edit account · Offset account' });
    expect(form).toHaveTextContent('Not linked to a loan: link it on the Property page.');
    await user.click(
      within(form).getByRole('switch', { name: 'Offset account: kept out of Total cash' }),
    );
    expect(within(form).queryByRole('note', { name: 'Offset link' })).toBeNull();
  });

  it('Offset on for an account with history up to the last recorded month warns (FEAS-12)', async () => {
    const { user } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Edit Savings account' }));
    let form = screen.getByRole('form', { name: 'Edit account · Savings account' });
    await user.click(
      within(form).getByRole('switch', { name: 'Offset account: kept out of Total cash' }),
    );
    expect(within(form).getByRole('note', { name: 'Offset account' })).toHaveTextContent(
      'Its balance leaves Total Cash now; until the next month is recorded, this month’s savings read that as spending.',
    );
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    // An account whose history starts after the last recorded month: no warning.
    await user.click(screen.getByRole('button', { name: 'Edit Cash at home' }));
    form = screen.getByRole('form', { name: 'Edit account · Cash at home' });
    await user.click(
      within(form).getByRole('switch', { name: 'Offset account: kept out of Total cash' }),
    );
    expect(within(form).queryByRole('note', { name: 'Offset account' })).toBeNull();
  });

  it('the savings Details list Offsets between Mortgage principal and Property deposit', async () => {
    const { user } = await openCash();
    await user.click(screen.getByRole('button', { name: 'Details of Sep 2026' }));
    const details = screen.getByRole('table', { name: 'Parts of Sep 2026' });
    const labels = within(details)
      .getAllByRole('rowheader')
      .map((th) => th.textContent);
    const at = labels.indexOf('Offsets');
    expect(at).toBeGreaterThan(-1);
    expect(labels[at - 1]).toBe('Mortgage principal');
    expect(labels[at + 1]).toBe('Property deposit');
    expect(details).toHaveTextContent('Offsets$500.00');
  });
});
