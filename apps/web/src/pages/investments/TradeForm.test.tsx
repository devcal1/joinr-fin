import type { TradeInputBody } from '@joinr/schema';
import {
  apiErrors,
  deletedResponse,
  investmentTrades,
  tradeMutationResponse,
} from '@joinr/schema/fixtures';
import { toIsoDate } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cell, headers, mockInvestments, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending, type MockHandler } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { ENTRY_MODE_KEY_PREFIX, LEGACY_ENTRY_MODE_KEY, entryModeKey } from './storage';
import { WORKBOOK_ROW_NOTE } from './TradeForm';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const created: MockHandler = { status: 201, body: tradeMutationResponse };

async function openAddTrade(path: string) {
  const view = renderApp(path);
  const main = await findMain();
  const add = await within(main).findByRole('button', { name: 'Add trade' });
  await view.user.click(add);
  const form = await screen.findByRole('form', { name: 'Add trade' });
  return { ...view, form, add };
}

const holdingSelect = (form: HTMLElement) =>
  within(form).getByRole('combobox', { name: /Holding/ });
const saveButton = (form: HTMLElement) => within(form).getByRole('button', { name: 'Save' });
const preview = (form: HTMLElement) => within(form).getByTestId('trade-preview');

describe('the trade form (§6.6, D38)', () => {
  it('opens with focus on the Holding field and Save disabled while pristine', async () => {
    mockInvestments('etf');
    const { form } = await openAddTrade('/etfs');
    expect(holdingSelect(form)).toHaveFocus();
    expect(saveButton(form)).toBeDisabled();
    expect(within(form).getByRole('textbox', { name: /Date/ })).toHaveValue(
      toIsoDate(new Date()).split('-').reverse().join('/'),
    );
  });

  it('a $0-fee holding pre-fills $0.00 and opens in Amount mode; the preview and the body', async () => {
    const api = mockInvestments('etf', { routes: { 'POST /api/trades': created } });
    const { form, user, add } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '4');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('0.00');
    expect(within(form).getByText('Default for this holding')).toBeVisible();
    expect(within(form).getByRole('textbox', { name: /Price per unit/ })).toHaveValue('62');
    expect(within(form).getByText('Current price $62.00')).toBeVisible();

    await user.type(within(form).getByRole('textbox', { name: /^Amount/ }), '500');
    expect(preview(form)).toHaveTextContent(
      '≈ 8.0645 units · order $500.00 · fee $0.00 · total $500.00',
    );

    await user.click(saveButton(form));
    await waitFor(() => expect(api.calls('POST /api/trades')).toHaveLength(1));
    expect(api.calls('POST /api/trades')[0]?.body).toEqual({
      instrumentId: 4,
      side: 'buy',
      tradeDate: toIsoDate(new Date()),
      quantity: { mode: 'amount', amountCents: 50000 },
      price: '62',
      fee: { kind: 'flat', cents: 0 },
      note: '',
    } satisfies TradeInputBody);
    expect(await screen.findByRole('status', { name: 'Save result' })).toHaveTextContent(
      'Trade added.',
    );
    expect(screen.queryByRole('form', { name: 'Add trade' })).toBeNull();
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('units mode: the body, the flat default fee and the preview', async () => {
    const api = mockInvestments('stock', { routes: { 'POST /api/trades': created } });
    const { form, user } = await openAddTrade('/stocks');
    await user.selectOptions(holdingSelect(form), '1');
    expect(within(form).getByRole('button', { name: 'Units' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('10.00');
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '10');
    expect(preview(form)).toHaveTextContent(
      '10 units · order $125.00 · fee $10.00 · total $135.00',
    );
    await user.type(within(form).getByRole('textbox', { name: /^Note/ }), 'A note');
    await user.click(saveButton(form));
    await waitFor(() => expect(api.calls('POST /api/trades')).toHaveLength(1));
    expect(api.calls('POST /api/trades')[0]?.body).toMatchObject({
      instrumentId: 1,
      side: 'buy',
      quantity: { mode: 'units', units: '10' },
      price: '12.5',
      fee: { kind: 'flat', cents: 1000 },
      note: 'A note',
    });
  });

  it('re-fills the price, fee and mode on a holding change, but never a field the owner edited', async () => {
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '12');
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('10.00');
    expect(within(form).getByRole('button', { name: 'Units' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.selectOptions(holdingSelect(form), '4');
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('0.00');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByRole('textbox', { name: /Price per unit/ })).toHaveValue('62');

    const price = within(form).getByRole('textbox', { name: /Price per unit/ });
    await user.clear(price);
    await user.type(price, '99');
    await user.tab();
    await user.selectOptions(holdingSelect(form), '12');
    expect(within(form).getByRole('textbox', { name: /Price per unit/ })).toHaveValue('99');
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('10.00');
  });

  it('remembers the explicit entry mode per holding; another holding keeps its own (D47)', async () => {
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    const pressed = (f: HTMLElement, name: 'Units' | 'Amount') =>
      expect(within(f).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    const reopen = async () => {
      await user.click(screen.getByRole('button', { name: 'Add trade' }));
      return screen.findByRole('form', { name: 'Add trade' });
    };

    // ASX:MNO (a $10 default fee) opens in Units; Amount is chosen and remembered for it only.
    await user.selectOptions(holdingSelect(form), '12');
    pressed(form, 'Units');
    await user.click(within(form).getByRole('button', { name: 'Amount' }));
    expect(window.localStorage.getItem(entryModeKey(12))).toBe('amount');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    // The $0-fee ASX:DEF keeps its own default (Amount); Units is chosen for it.
    let again = await reopen();
    await user.selectOptions(holdingSelect(again), '4');
    pressed(again, 'Amount');
    await user.click(within(again).getByRole('button', { name: 'Units' }));
    expect(window.localStorage.getItem(entryModeKey(4))).toBe('units');
    await user.click(within(again).getByRole('button', { name: 'Cancel' }));

    // Each holding now opens in its own last choice, also on a holding change in one form.
    again = await reopen();
    await user.selectOptions(holdingSelect(again), '12');
    pressed(again, 'Amount');
    await user.selectOptions(holdingSelect(again), '4');
    pressed(again, 'Units');
    expect(window.localStorage.getItem(LEGACY_ENTRY_MODE_KEY)).toBeNull();
  });

  it('a choice made before the holding is remembered for the holding the trade is saved on', async () => {
    const api = mockInvestments('etf', { routes: { 'POST /api/trades': created } });
    const { form, user } = await openAddTrade('/etfs');
    await user.click(within(form).getByRole('button', { name: 'Amount' }));
    // No holding yet: nothing is stored.
    expect(
      Object.keys(window.localStorage).filter((k) => k.startsWith(ENTRY_MODE_KEY_PREFIX)),
    ).toEqual([]);
    await user.selectOptions(holdingSelect(form), '12');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.type(within(form).getByRole('textbox', { name: /^Amount/ }), '500');
    await user.click(saveButton(form));
    await waitFor(() => expect(api.calls('POST /api/trades')).toHaveLength(1));
    await screen.findByRole('status', { name: 'Save result' });
    expect(window.localStorage.getItem(entryModeKey(12))).toBe('amount');
    expect(window.localStorage.getItem(entryModeKey(4))).toBeNull();
  });

  it('ignores the old browser-wide choice and removes it when the form opens', async () => {
    window.localStorage.setItem(LEGACY_ENTRY_MODE_KEY, 'units');
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    expect(window.localStorage.getItem(LEGACY_ENTRY_MODE_KEY)).toBeNull();
    await user.selectOptions(holdingSelect(form), '4');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('works without browser storage: holding defaults apply and nothing throws', async () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '4');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(form).getByRole('button', { name: 'Units' }));
    expect(within(form).getByRole('button', { name: 'Units' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Save is disabled while saving: a double click sends one request', async () => {
    const api = mockInvestments('etf', { routes: { 'POST /api/trades': pending } });
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '4');
    await user.type(within(form).getByRole('textbox', { name: /^Amount/ }), '500');
    await user.dblClick(saveButton(form));
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'true'));
    expect(saveButton(form)).toBeDisabled();
    expect(api.calls('POST /api/trades')).toHaveLength(1);
  });

  it('Cancel closes the form and returns focus to the button that opened it', async () => {
    mockInvestments('etf');
    const { form, user, add } = await openAddTrade('/etfs');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add trade' })).toBeNull();
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('crypto: a % fee converted with ratioFromPercentText, and "Flat fee instead"', async () => {
    const api = mockInvestments('crypto', { routes: { 'POST /api/trades': created } });
    const { form, user } = await openAddTrade('/crypto');
    await user.selectOptions(holdingSelect(form), '7');
    const percent = within(form).getByRole('textbox', { name: /^Fee %/ });
    expect(percent).toHaveValue('0.25');
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '0.01');
    expect(preview(form)).toHaveTextContent(
      '0.01 units · order $1,600.00 · fee $4.00 · total $1,604.00',
    );
    await user.clear(percent);
    await user.type(percent, '0.5');
    expect(preview(form)).toHaveTextContent('fee $8.00');
    await user.click(saveButton(form));
    await waitFor(() => expect(api.calls('POST /api/trades')).toHaveLength(1));
    expect(api.calls('POST /api/trades')[0]?.body).toMatchObject({
      instrumentId: 7,
      fee: { kind: 'rate', rate: '0.005' },
      quantity: { mode: 'units', units: '0.01' },
    });
  });

  it('crypto: the flat-fee switch swaps the % field for money', async () => {
    mockInvestments('crypto');
    const { form, user } = await openAddTrade('/crypto');
    await user.selectOptions(holdingSelect(form), '8');
    await user.click(within(form).getByRole('switch', { name: 'Flat fee instead' }));
    expect(within(form).queryByRole('textbox', { name: /^Fee %/ })).toBeNull();
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toBeVisible();
  });

  it('a sell shows the units held now', async () => {
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '4');
    await user.click(within(form).getByRole('button', { name: 'Sell' }));
    expect(within(form).getByText('Held now: 32 units')).toBeVisible();
  });

  it('shows client errors under the fields', async () => {
    mockInvestments('etf');
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '12');
    await user.click(saveButton(form));
    expect(within(form).getByText('Enter the units.')).toBeVisible();
  });

  it('an order value beyond the limit shows no preview and a units error, never a crash', async () => {
    const api = mockInvestments('stock', { routes: { 'POST /api/trades': created } });
    const { form, user } = await openAddTrade('/stocks');
    await user.selectOptions(holdingSelect(form), '1');
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '1000000');
    const price = within(form).getByRole('textbox', { name: /Price per unit/ });
    await user.clear(price);
    await user.type(price, '1000000000');
    // Each value is within its own limit; their product is past safe-integer cents.
    expect(screen.getByRole('form', { name: 'Add trade' })).toBe(form);
    expect(preview(form)).toHaveTextContent('');
    await user.click(saveButton(form));
    expect(within(form).getByText('The order value is too large.')).toBeVisible();
    expect(api.calls('POST /api/trades')).toHaveLength(0);
  });

  it('maps the server’s field errors onto the fields', async () => {
    mockInvestments('etf', {
      routes: { 'POST /api/trades': apiError(400, apiErrors.tradeValidation) },
    });
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '12');
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '5');
    await user.click(saveButton(form));
    expect(await within(form).findByText('Must be a positive number.')).toBeVisible();
    expect(within(form).getByText('Must be greater than zero.')).toBeVisible();
    expect(within(form).getByRole('textbox', { name: /^Units/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows the oversell message', async () => {
    mockInvestments('etf', {
      routes: { 'POST /api/trades': apiError(422, apiErrors.tradeOversell) },
    });
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '12');
    await user.click(within(form).getByRole('button', { name: 'Sell' }));
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '50');
    await user.click(saveButton(form));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      apiErrors.tradeOversell.error.message,
    );
  });

  it('names a running import in plain words', async () => {
    mockInvestments('etf', { routes: { 'POST /api/trades': apiError(409, apiErrors.inProgress) } });
    const { form, user } = await openAddTrade('/etfs');
    await user.selectOptions(holdingSelect(form), '12');
    await user.type(within(form).getByRole('textbox', { name: /^Units/ }), '1');
    await user.click(saveButton(form));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'An import is running; try again shortly.',
    );
  });
});

describe('editing and deleting trades (§6.3 item 8, §6.6)', () => {
  async function ledger(kind: 'etf' | 'stock' = 'etf', routes: Record<string, MockHandler> = {}) {
    const api = mockInvestments(kind, { routes });
    const view = renderApp(kind === 'etf' ? '/etfs' : '/stocks');
    const table = await screen.findByRole('table', { name: /trades: \d+ rows?$/ });
    return { ...view, api, table };
  }

  it('lists the ledger newest first with side, result, flags and source', async () => {
    const { table } = await ledger();
    expect(headers(table)).toEqual([
      'Date',
      'Holding',
      'Side',
      'Units',
      'Price',
      'Order value',
      'Fee',
      'Result',
      'Flags',
      'Source',
      'Actions',
    ]);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(investmentTrades.etf.trades.length);
    const first = rows[0] as HTMLElement;
    expect(cell(table, first, 'Date')).toBe('18/08/2026');
    expect(cell(table, first, 'Side')).toBe('Buy');
    expect(cell(table, first, 'Result')).toBe('12 of 12 left$24.00unrealised');
    // Right-aligned like every money column.
    expect(first.querySelectorAll('td')[6]).toHaveClass('jf-table__cell--num');
    expect(cell(table, first, 'Source')).toBe('App');
    const sell = rowOf(table, '01/12/2025');
    expect(cell(table, sell, 'Order value')).toBe('$1,400.00');
    expect(within(sell).getByText('−$220.00')).toHaveClass('jf-amount--negative');
    expect(cell(table, sell, 'Result')).toBe('−$220.00realised');
    expect(cell(table, sell, 'Source')).toBe('Workbook');
    expect(within(rowOf(table, '20/05/2025')).getByText('Out of order')).toBeVisible();
  });

  it('shows an oversold sell with its badge', async () => {
    const { table } = await ledger('stock');
    const oversold = rowOf(table, '03/02/2025');
    // One badge for the condition: the result's "Oversold 5", not also the review flag.
    expect(within(oversold).getByText('Oversold 5')).toBeVisible();
    expect(within(oversold).queryByText('Oversell')).toBeNull();
    expect(cell(table, oversold, 'Flags')).toBe('—');
  });

  it('filters by holding and side', async () => {
    const { table, user } = await ledger();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Holding' }), '3');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Sells' }));
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByRole('table', { name: /trades: 1 row$/ })).toBe(table);
  });

  it('phone: status-first ledger columns, flags inside the Holding cell (D31)', async () => {
    emulatePhone();
    const { table } = await ledger();
    expect(headers(table)).toEqual([
      'Date',
      'Holding',
      'Side',
      'Order value',
      'Actions',
      'Units',
      'Price',
      'Fee',
      'Result',
      'Source',
    ]);
    expect(within(rowOf(table, '20/05/2025')).getByText('Out of order')).toBeVisible();
  });

  it('edit: a workbook row warns, opens in Units mode, and Save waits for a change', async () => {
    const { user, api } = await ledger('etf', {
      'PUT /api/trades/115': { body: tradeMutationResponse },
    });
    const edit = screen.getByRole('button', { name: 'Edit ASX:DEF trade of 10/02/2026' });
    await user.click(edit);
    const form = await screen.findByRole('form', { name: 'Edit trade · ASX:DEF 10/02/2026' });
    expect(within(form).getByRole('note', { name: 'Workbook row' })).toHaveTextContent(
      WORKBOOK_ROW_NOTE,
    );
    expect(within(form).getByRole('button', { name: 'Units' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(holdingSelect(form)).toBeDisabled();
    expect(saveButton(form)).toBeDisabled();
    const units = within(form).getByRole('textbox', { name: /^Units/ });
    await user.clear(units);
    await user.type(units, '5');
    await user.click(saveButton(form));
    await waitFor(() => expect(api.calls('PUT /api/trades/115')).toHaveLength(1));
    expect(api.calls('PUT /api/trades/115')[0]?.body).toEqual({
      instrumentId: 4,
      side: 'buy',
      tradeDate: '2026-02-10',
      quantity: { mode: 'units', units: '5' },
      price: '55',
      fee: { kind: 'flat', cents: 0 },
      note: '',
    });
    expect(await screen.findByRole('status', { name: 'Save result' })).toHaveTextContent(
      'Trade updated.',
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit ASX:DEF trade of 10/02/2026' }),
      ).toHaveFocus(),
    );
  });

  it('edit: an app row has no workbook warning', async () => {
    const { user } = await ledger();
    await user.click(screen.getByRole('button', { name: 'Edit ASX:DEF trade of 18/08/2026' }));
    const form = await screen.findByRole('form', { name: 'Edit trade · ASX:DEF 18/08/2026' });
    expect(within(form).queryByRole('note', { name: 'Workbook row' })).toBeNull();
  });

  it('delete: confirm in the Actions cell; focus on Cancel; Escape cancels', async () => {
    const { user } = await ledger();
    const del = screen.getByRole('button', { name: 'Delete ASX:DEF trade of 10/02/2026' });
    await user.click(del);
    // The visible question names the trade, and is the group's name.
    const confirm = screen.getByRole('group', { name: 'Delete the ASX:DEF buy of 10/02/2026?' });
    expect(within(confirm).getByText('Delete the ASX:DEF buy of 10/02/2026?')).toBeVisible();
    // Cancel's accessible name starts with its visible word (WCAG 2.5.3).
    const cancel = within(confirm).getByRole('button', {
      name: 'Cancel: keep the ASX:DEF trade of 10/02/2026',
    });
    expect(cancel).toHaveTextContent('Cancel');
    expect(cancel).toHaveFocus();
    expect(within(confirm).getByRole('button', { name: /^Cancel/ })).toBe(cancel);
    expect(screen.getByRole('note', { name: 'Workbook row' })).toHaveTextContent(WORKBOOK_ROW_NOTE);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /^Delete the/ })).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Delete ASX:DEF trade of 10/02/2026' }),
      ).toHaveFocus(),
    );
  });

  it('delete: sends DELETE, announces it and moves focus to the Trades heading', async () => {
    const { user, api } = await ledger('etf', {
      'DELETE /api/trades/116': { body: deletedResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Delete ASX:DEF trade of 18/08/2026' }));
    expect(screen.queryByRole('note', { name: 'Workbook row' })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Delete the ASX:DEF trade of 18/08/2026' }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/trades/116')).toHaveLength(1));
    expect(await screen.findByRole('status', { name: 'Save result' })).toHaveTextContent(
      'Trade deleted.',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Trades' })).toHaveFocus();
  });

  it('delete: a buy a later sell needs shows the oversell message', async () => {
    const { user } = await ledger('etf', {
      'DELETE /api/trades/113': apiError(422, apiErrors.tradeOversell),
    });
    await user.click(screen.getByRole('button', { name: 'Delete ASX:DEF trade of 20/05/2025' }));
    await user.click(
      screen.getByRole('button', { name: 'Delete the ASX:DEF trade of 20/05/2025' }),
    );
    expect(await screen.findByRole('note', { name: 'Not deleted' })).toHaveTextContent(
      apiErrors.tradeOversell.error.message,
    );
  });
});
