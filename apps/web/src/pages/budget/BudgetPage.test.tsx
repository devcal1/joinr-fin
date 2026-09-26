import type { BudgetPageResponse } from '@joinr/schema';
import {
  apiErrors,
  budgetItemMutationResponse,
  budgetPages,
  settingsPatchResponse,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { centsOf, columnTexts, mockCashflow, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf, totalRow } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

async function openBudget(fixture: BudgetPageResponse = budgetPages.autoSplit, routes = {}) {
  const api = mockCashflow({ budget: fixture, routes });
  const view = renderApp('/budget');
  await screen.findByRole('group', { name: 'Left over each month' });
  return { ...view, api };
}

const tile = (name: string): HTMLElement => screen.getByRole('group', { name });
const spending = (): HTMLElement => tableNamed(/^Spending: /);
const split = (): HTMLElement => tableNamed('Leftover split');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Budget page: states', () => {
  it.each(Object.entries(budgetPages))('renders the %s fixture', async (_name, fixture) => {
    mockCashflow({ budget: fixture });
    renderApp('/budget');
    expect(await screen.findByRole('heading', { level: 1, name: 'Budget' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Left over each month' })).toBeVisible();
  });

  it('loading and error', async () => {
    mockCashflow({ budget: pending });
    renderApp('/budget');
    expect(await screen.findByText('Loading the budget…')).toBeVisible();
  });

  it('a failed load', async () => {
    mockCashflow({ budget: apiError(500, apiErrors.internal) });
    renderApp('/budget');
    expect(await screen.findByRole('note', { name: 'Could not load the budget' })).toBeVisible();
  });

  it('no budget items yet', async () => {
    const fixture: BudgetPageResponse = {
      ...budgetPages.autoSplit,
      rows: budgetPages.autoSplit.rows.filter((r) => r.kind !== 'item'),
    };
    await openBudget(fixture);
    expect(screen.getByText('No budget items yet.')).toBeVisible();
  });
});

describe('Budget page: tiles (§6.5 item 2)', () => {
  it('left over each month is the teal figure', async () => {
    const { container } = await openBudget();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Left over each month')).toHaveClass('jf-stat-tile--key');
    expect(tile('Left over each month')).toHaveTextContent('$2,945');
    expect(tile('Monthly income')).toHaveTextContent('$6,500');
    expect(tile('Monthly income')).toHaveTextContent('Net pay × monthly factor');
    expect(tile('Planned spend')).toHaveTextContent('$3,555');
    expect(tile('Emergency fund')).toHaveTextContent('$11,000');
    expect(tile('Emergency fund')).toHaveTextContent('3 months of spending, rounded up to $1,000');
    expect(tile('Planned savings rate')).toHaveTextContent('45.2%');
    expect(tile('Actual spend')).toHaveTextContent('$4,690');
  });

  it('missing pay: dashes and the inputs listed', async () => {
    await openBudget(budgetPages.missingPay);
    expect(tile('Monthly income')).toHaveTextContent(
      '—Set the pay settings in Income and settings below',
    );
    expect(tile('Emergency fund')).toHaveTextContent(
      '—Set pay and budget settings in Income and settings below',
    );
    expect(tile('Left over each month')).toHaveTextContent(
      'Set the pay settings in Income and settings below',
    );
    const missing = screen.getByRole('note', { name: 'Inputs missing' });
    for (const label of ['Net pay per pay', 'Pay frequency', 'Emergency fund (months)']) {
      expect(within(missing).getByText(label)).toBeVisible();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Payday transfers' })).toBeVisible();
    // No pay frequency: the per-pay figures are unknown ("—"), never $0; monthly still shows.
    const transfers = tableNamed('Payday transfers');
    const unassigned = rowOf(transfers, 'Not assigned');
    expect(cell(transfers, unassigned, 'Per pay')).toBe('—');
    expect(cell(transfers, unassigned, 'Monthly')).toBe('$60.00');
    expect(cell(transfers, totalRow(transfers), 'Per pay')).toBe('—');
  });

  it('a negative actual spend carries a check badge and says why; side income in the income hint', async () => {
    await openBudget(budgetPages.negativeActual);
    const actual = tile('Actual spend');
    expect(within(actual).getByText('Check')).toBeVisible();
    expect(actual).toHaveTextContent(
      'Savings exceeded income in some months; add one-off adjustments on the Cash page',
    );
    expect(tile('Monthly income')).toHaveTextContent('Net pay × monthly factor + side income');
  });
});

describe('Budget page: items (§6.5 item 4, D54)', () => {
  it('spending: items and the yearly row; the total equals its visible rows, not teal', async () => {
    await openBudget();
    const table = spending();
    expect(headers(table)).toEqual([
      'Item',
      'Category',
      'Account',
      'Monthly',
      '% of income',
      'Weekly',
      'Yearly',
      'Actions',
    ]);
    const monthly = columnTexts(table, 'Monthly').map((t) => centsOf(t) ?? 0);
    const total = totalRow(table);
    expect(total).toHaveTextContent('Planned spend');
    expect(centsOf(cell(table, total, 'Monthly'))).toBe(monthly.reduce((a, b) => a + b, 0));
    expect(centsOf(cell(table, total, 'Monthly'))).toBe(355500);
    expect(total.querySelector('.jf-table__key')).toBeNull();
    expect(rowOf(table, 'Yearly expenses (automatic)')).toHaveTextContent('Automatic');
    expect(rowOf(table, 'Emergency fund top-up')).toHaveTextContent('Savings');
  });

  it('leftover split: the rows and the rounding line add up to the teal Left over', async () => {
    await openBudget();
    const table = split();
    expect(columnTexts(table, 'Item')).toEqual([
      'Investment savings (automatic)Automatic',
      'Cash savings (automatic)Automatic',
      'Unallocated (rounding)',
    ]);
    const monthly = columnTexts(table, 'Monthly').map((t) => centsOf(t) ?? 0);
    const total = totalRow(table);
    expect(total).toHaveTextContent('Left over');
    expect(centsOf(cell(table, total, 'Monthly'))).toBe(monthly.reduce((a, b) => a + b, 0));
    expect(centsOf(cell(table, total, 'Monthly'))).toBe(294500);
    // The page's one teal table cell (§6.1).
    expect(document.querySelectorAll('.jf-table__key')).toHaveLength(1);
    expect(total.querySelector('.jf-table__key')).toHaveTextContent('$2,945.00');
    expect(screen.getByTestId('budget-split')).toHaveTextContent(
      'Split: 65% investments / 35% cash (target cash 15%, normal)',
    );
    // A stale account name on the investment row.
    expect(rowOf(table, 'Investment savings')).toHaveTextContent('Account not found: choose one');
  });

  it('the D54 manual amount: the row says manual, the split line explains', async () => {
    await openBudget(budgetPages.manualSplit);
    expect(rowOf(split(), 'Investment savings (manual)')).toBeInTheDocument();
    expect(screen.getByTestId('budget-split')).toHaveTextContent(
      'The automatic investment split is off',
    );
  });

  it('an amount above the leftover: the negative cash row warning; the total still adds up', async () => {
    await openBudget(budgetPages.manualOverLeftover);
    expect(screen.getByRole('note', { name: 'Check the investment amount' })).toHaveTextContent(
      'The cash savings row is negative',
    );
    const table = split();
    const monthly = columnTexts(table, 'Monthly').map((t) => centsOf(t) ?? 0);
    expect(centsOf(cell(table, totalRow(table), 'Monthly'))).toBe(
      monthly.reduce((a, b) => a + b, 0),
    );
  });

  it('below the emergency fund: the whole leftover goes to cash', async () => {
    await openBudget(budgetPages.belowEmergencyFund);
    expect(screen.getByRole('note', { name: 'Cash first' })).toHaveTextContent(
      "The cash that counts toward the emergency fund is below it, so the whole leftover goes to cash. Loans you've made don't count; the Cash page shows what does.",
    );
  });

  it('below the fund with the manual split (D54): no "Cash first", the typed amount is invested', async () => {
    const base = budgetPages.belowEmergencyFund;
    const invest = 100000;
    const cash = 194000; // 294,500 left over − 100,000, rounded down to $10
    const fixture: BudgetPageResponse = {
      ...base,
      summary: {
        ...base.summary,
        investManual: true,
        investmentRowCents: invest,
        cashRowCents: cash,
        unallocatedCents: base.summary.leftoverCents - invest - cash,
      },
      rows: base.rows.map((r) =>
        r.kind === 'auto_invest'
          ? { ...r, manual: true, storedMonthlyCents: invest, monthlyCents: invest }
          : r.kind === 'auto_cash'
            ? { ...r, monthlyCents: cash }
            : r,
      ),
      settings: {
        ...base.settings,
        values: { ...base.settings.values, 'budget.autoInvestSplit': false },
      },
    };
    await openBudget(fixture);
    expect(screen.queryByRole('note', { name: 'Cash first' })).toBeNull();
    expect(screen.getByTestId('budget-split')).toHaveTextContent(
      'The automatic investment split is off',
    );
    const table = split();
    expect(centsOf(cell(table, rowOf(table, 'Investment savings (manual)'), 'Monthly'))).toBe(
      invest,
    );
  });

  it('below the fund with the budget not used for the invest amount: no "Cash first"', async () => {
    const base = budgetPages.belowEmergencyFund;
    // The forced cash share applies only when the budget sets the invest amount (SheetOptions H42).
    const invest = 294000; // the leftover rounded down to $10
    const fixture: BudgetPageResponse = {
      ...base,
      summary: {
        ...base.summary,
        investShareRatio: '1',
        cashShareRatio: '0',
        investmentRowCents: invest,
        cashRowCents: 0,
        unallocatedCents: base.summary.leftoverCents - invest,
      },
      rows: base.rows.map((r) =>
        r.kind === 'auto_invest'
          ? { ...r, monthlyCents: invest }
          : r.kind === 'auto_cash'
            ? { ...r, monthlyCents: 0 }
            : r,
      ),
      settings: {
        ...base.settings,
        values: { ...base.settings.values, 'budget.useForInvestAmount': false },
      },
    };
    await openBudget(fixture);
    expect(screen.queryByRole('note', { name: 'Cash first' })).toBeNull();
    expect(screen.getByTestId('budget-split')).toHaveTextContent(
      'Split: 100% investments / 0% cash',
    );
  });

  it('an unmatched account name is flagged on the row and in the transfers', async () => {
    await openBudget(budgetPages.unmatchedAccounts);
    expect(rowOf(spending(), 'Phone')).toHaveTextContent('Old cardAccount not found: choose one');
    expect(rowOf(tableNamed('Payday transfers'), 'Old card')).toHaveTextContent(
      'Account not found: choose one',
    );
  });

  it('add an item: category suggestions, every account, the new-row note, POST body', async () => {
    const { user, api } = await openBudget(budgetPages.autoSplit, {
      'POST /api/budget/items': { status: 201, body: budgetItemMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('form', { name: 'Add item' });
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    const category = within(form).getByRole('combobox', { name: 'Category' });
    const listId = category.getAttribute('list') ?? '';
    const options = [...(document.getElementById(listId)?.querySelectorAll('option') ?? [])].map(
      (o) => o.getAttribute('value'),
    );
    expect(options).toEqual(['Bills', 'Food', 'Housing', 'Investing', 'Savings']);
    const account = within(form).getByRole('combobox', { name: 'Account' });
    expect(
      within(account)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'No account',
      'Everyday account (Bank account)',
      'Savings account (Bank account)',
      'Credit card (Credit card)',
      "Loan to a friend (Loan you've made)",
      'Cash at home (Other)',
    ]);
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Internet');
    await user.type(within(form).getByRole('textbox', { name: /Monthly/ }), '75');
    await user.type(category, 'Bills');
    await user.selectOptions(account, '1');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/budget/items')).toHaveLength(1));
    expect(api.calls('POST /api/budget/items')[0]?.body).toEqual({
      name: 'Internet',
      monthlyCents: 7500,
      category: 'Bills',
      accountId: 1,
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
      'Budget item saved.',
    );
  });

  it('edit an imported item warns; delete an item confirms; reorder sends every id', async () => {
    const { user, api } = await openBudget(budgetPages.autoSplit, {
      'DELETE /api/budget/items/15': { body: { id: 15 } },
      'POST /api/budget/items/reorder': { body: { ids: [] } },
    });
    await user.click(screen.getByRole('button', { name: 'Edit budget row Rent' }));
    const form = screen.getByRole('form', { name: 'Edit item · Rent' });
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete budget row Gym' }));
    await user.click(screen.getByRole('button', { name: 'Delete the budget row Gym' }));
    await waitFor(() => expect(api.calls('DELETE /api/budget/items/15')).toHaveLength(1));
    expect(
      screen.queryByRole('button', { name: 'Delete budget row Yearly expenses (automatic)' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move budget row Groceries up' }));
    await waitFor(() => expect(api.calls('POST /api/budget/items/reorder')).toHaveLength(1));
    expect(api.calls('POST /api/budget/items/reorder')[0]?.body).toEqual({
      ids: [12, 11, 13, 14, 15, 16],
    });
  });

  it('an automatic row (split on): category and account only', async () => {
    const { user, api } = await openBudget(budgetPages.autoSplit, {
      'PUT /api/budget/auto/auto_cash': { body: budgetItemMutationResponse },
    });
    await user.click(
      screen.getByRole('button', { name: 'Edit budget row Cash savings (automatic)' }),
    );
    const form = screen.getByRole('form', { name: 'Edit · Cash savings (automatic)' });
    expect(within(form).queryByRole('textbox', { name: 'Amount per month' })).toBeNull();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Account' }), '1');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/budget/auto/auto_cash')).toHaveLength(1));
    expect(api.calls('PUT /api/budget/auto/auto_cash')[0]?.body).toEqual({
      category: 'Savings',
      accountId: 1,
    });
  });

  it('the investment row with the split off takes an amount (D54); above the leftover it warns', async () => {
    const { user, api } = await openBudget(budgetPages.manualSplit, {
      'PUT /api/budget/auto/auto_invest': { body: budgetItemMutationResponse },
    });
    await user.click(
      screen.getByRole('button', { name: 'Edit budget row Investment savings (manual)' }),
    );
    const form = screen.getByRole('form', { name: 'Edit · Investment savings (manual)' });
    const amount = within(form).getByRole('textbox', { name: 'Amount per month' });
    expect(form).toHaveTextContent('The rest of the leftover goes to cash savings');
    await user.clear(amount);
    await user.type(amount, '3500');
    expect(within(form).getByRole('note', { name: 'Check the amount' })).toHaveTextContent(
      'The cash savings row is negative',
    );
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/budget/auto/auto_invest')).toHaveLength(1));
    expect(api.calls('PUT /api/budget/auto/auto_invest')[0]?.body).toMatchObject({
      manualMonthlyCents: 350000,
    });
  });

  it('phone: item, monthly, account first (§6.9)', async () => {
    emulatePhone();
    await openBudget();
    expect(headers(spending())).toEqual([
      'Item',
      'Monthly',
      'Account',
      'Category',
      '% of income',
      'Weekly',
      'Yearly',
      'Actions',
    ]);
    expect(headers(tableNamed('Yearly expenses'))).toEqual([
      'Name',
      'Monthly',
      'Year cost',
      'Actions',
    ]);
    expect(headers(tableNamed('Payday transfers'))).toEqual(['Account', 'Per pay', 'Monthly']);
  });
});

describe('Budget page: yearly expenses, transfers, settings, charts', () => {
  it('yearly expenses: the fund row (rounded up to $5, not teal); add one', async () => {
    const { user, api } = await openBudget(budgetPages.autoSplit, {
      'POST /api/budget/yearly-expenses': {
        status: 201,
        body: { expense: budgetPages.autoSplit.yearlyExpenses[0] },
      },
    });
    const table = tableNamed('Yearly expenses');
    const total = totalRow(table);
    expect(total).toHaveTextContent('Set aside each month (rounded up to $5)');
    expect(cell(table, total, 'Monthly')).toBe('$195.00');
    expect(cell(table, total, 'Year cost')).toBe('$2,300.00');
    expect(total.querySelector('.jf-table__key')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add yearly expense' }));
    const form = screen.getByRole('form', { name: 'Add yearly expense' });
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Licence');
    await user.type(within(form).getByRole('textbox', { name: /Year cost/ }), '120');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/budget/yearly-expenses')).toHaveLength(1));
    expect(api.calls('POST /api/budget/yearly-expenses')[0]?.body).toEqual({
      name: 'Licence',
      annualCents: 12000,
    });
  });

  it('transfers per pay: the heading names the frequency; the unassigned line; the total vs net pay', async () => {
    await openBudget();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Payday transfers (monthly)' }),
    ).toBeVisible();
    const table = tableNamed('Payday transfers');
    expect(rowOf(table, 'Not assigned')).toHaveTextContent('$60.00');
    const total = totalRow(table);
    expect(cell(table, total, 'Per pay')).toBe('$6,495.00');
    expect(total.querySelector('.jf-table__key')).toBeNull();
    expect(screen.getByTestId('transfers-vs-pay')).toHaveTextContent(
      '$6,495.00 of $6,500.00 each pay',
    );
  });

  it('the fortnightly heading', async () => {
    await openBudget({
      ...budgetPages.autoSplit,
      summary: { ...budgetPages.autoSplit.summary, payFrequency: 'fortnightly' },
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Payday transfers (fortnightly)' }),
    ).toBeVisible();
  });

  it('settings: every key is a workbook setting, so the form warns; PATCH the changed keys', async () => {
    const { user, api } = await openBudget(budgetPages.autoSplit, {
      'PATCH /api/settings': { body: settingsPatchResponse },
    });
    const table = screen.getByRole('table', { name: 'Income and settings' });
    expect(table).toHaveTextContent('Pay frequencyMonthly');
    expect(table).toHaveTextContent('Net pay per pay$6,500.00');
    expect(table).toHaveTextContent(
      'Include side incomeNo365-day side-income average $299.17 a month',
    );
    expect(table).toHaveTextContent(
      'Emergency fund overrideNot set: the months of spending are used',
    );
    await user.click(screen.getByRole('button', { name: 'Edit income and settings' }));
    const form = screen.getByRole('form', { name: 'Edit income and settings' });
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Include side income' }),
      'yes',
    );
    const months = within(form).getByRole('textbox', {
      name: 'Emergency fund (months of spending)',
    });
    await user.clear(months);
    await user.type(months, '6');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'budget.includeSideIncome': true, 'budget.emergencyFundMonths': 6 },
    });
  });

  it('a bad pay day is refused before sending', async () => {
    const { user, api } = await openBudget();
    await user.click(screen.getByRole('button', { name: 'Edit income and settings' }));
    const form = screen.getByRole('form', { name: 'Edit income and settings' });
    const day = within(form).getByRole('textbox', { name: 'Pay day (day of the month)' });
    await user.clear(day);
    await user.type(day, '31');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Enter a whole number from 0 to 28')).toBeVisible();
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });

  it('charts: by item, by category (centre "Monthly") and planned vs actual with the switch', async () => {
    const { user } = await openBudget();
    for (const title of ['By item', 'By category', 'Planned vs actual spend']) {
      expect(screen.getByRole('region', { name: title })).toBeVisible();
    }
    const pair = screen.getByRole('region', { name: 'Planned vs actual spend' });
    await user.click(within(pair).getByRole('button', { name: 'Table' }));
    let table = within(pair).getByRole('table', { name: 'Planned vs actual spend' });
    expect(cell(table, rowOf(table, 'Actual spend'), 'Monthly')).toBe('$4,690.00');
    await user.click(within(pair).getByRole('button', { name: 'Raw' }));
    table = within(pair).getByRole('table', { name: 'Planned vs actual spend' });
    expect(cell(table, rowOf(table, 'Actual spend'), 'Monthly')).toBe('$2,674.00');
    const byCategory = screen.getByRole('region', { name: 'By category' });
    await user.click(within(byCategory).getByRole('button', { name: 'Table' }));
    expect(
      rowOf(
        within(byCategory).getByRole('table', { name: 'Monthly budget by category' }),
        'No category',
      ),
    ).toHaveTextContent('$60.00');
  });
});
