import { instrumentEditableFromDto } from '@joinr/schema';
import {
  apiErrors,
  deletedResponse,
  holdingDetails,
  instrumentDtoById,
  investmentPages,
  investmentTrades,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cell, detailRoute, headers, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, mockApi, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { WORKBOOK_HOLDING_NOTE } from './HoldingForm';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function tile(label: string): HTMLElement {
  return screen.getByRole('group', { name: label });
}

async function openDetail(path: string, id: number, extra = {}) {
  const detail = holdingDetails[id]!;
  const api = mockApi({ ...detailRoute(detail), ...extra });
  const view = renderApp(path);
  const main = await findMain();
  await within(main).findByRole('heading', { level: 1, name: detail.instrument.symbol });
  return { ...view, api, main, detail };
}

describe('HoldingDetailPage (§6.5)', () => {
  it('loading and error states keep the page header', async () => {
    mockApi({ 'GET /api/instruments/1': pending });
    renderApp('/stocks/1');
    const main = await findMain();
    expect(await within(main).findByRole('status')).toHaveTextContent('Loading the holding…');
    expect(within(main).getByRole('link', { name: 'All Stocks' })).toHaveAttribute(
      'href',
      '/stocks',
    );
  });

  it('an API error offers a retry', async () => {
    mockApi({ 'GET /api/instruments/1': apiError(500, apiErrors.internal) });
    renderApp('/stocks/1');
    expect(await screen.findByRole('note', { name: 'Could not load the holding' })).toBeVisible();
  });

  it('an unknown id shows "Page not found"', async () => {
    mockApi({ 'GET /api/instruments/999': apiError(404, apiErrors.notFound) });
    renderApp('/stocks/999');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  it('an instrument of another kind shows "Page not found"', async () => {
    mockApi(detailRoute(holdingDetails[4]!));
    renderApp('/stocks/4');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  it('header, tiles and the detail facts', async () => {
    const { main } = await openDetail('/stocks/1', 1);
    expect(within(main).getByText('ABC Example Ltd')).toBeVisible();
    expect(within(main).getByRole('button', { name: 'Add trade' })).toBeVisible();
    expect(within(main).getByRole('button', { name: 'Edit holding' })).toBeVisible();
    expect(main.querySelectorAll('.jf-stat-tile')).toHaveLength(6);
    expect(tile('Value')).toHaveClass('jf-stat-tile--key');
    expect(tile('Value')).toHaveTextContent('$1,375');
    expect(tile('Units')).toHaveTextContent('110');
    expect(tile('Total return')).toHaveTextContent('$257.00');
    expect(tile('Realised')).toHaveTextContent('$256.00');
    expect(tile('Est. return / yr')).toHaveTextContent('19.4%');
    expect(tile('Average price')).toHaveTextContent('$10.9091');
    const facts = within(main).getByRole('table', { name: 'ASX:ABC details' });
    expect(facts).toHaveTextContent('Materials');
    expect(facts).toHaveTextContent('$10.00 (the global default)');
  });

  it('parcels: open and closed, the term if sold today, return vs original cost', async () => {
    await openDetail('/stocks/1', 1);
    const lots = screen.getByRole('table', { name: 'Parcels' });
    expect(headers(lots)).toEqual([
      'Bought',
      'Units',
      'Left',
      'Price',
      'Fee',
      'Cost left',
      'Unrealised',
      'Return %',
      'Held (days)',
      'If sold today',
      'Status',
    ]);
    const partly = rowOf(lots, '15/01/2025');
    expect(cell(lots, partly, 'Left')).toBe('60');
    expect(cell(lots, partly, 'Cost left')).toBe('$606.00');
    expect(cell(lots, partly, 'Return %')).toBe('14.4%');
    expect(within(partly).getByText('Long term')).toHaveClass('jf-pill');
    expect(cell(lots, partly, 'Status')).toBe('Open');
    const closed = rowOf(lots, '03/06/2024');
    expect(cell(lots, closed, 'Status')).toBe('Closed');
    expect(cell(lots, closed, 'If sold today')).toBe('—');
  });

  it('phone: parcels lead with what is left (D31)', async () => {
    emulatePhone();
    await openDetail('/stocks/1', 1);
    const lots = screen.getByRole('table', { name: 'Parcels' });
    expect(headers(lots).slice(0, 4)).toEqual(['Bought', 'Left', 'Unrealised', 'If sold today']);
  });

  it('disposals, with losses in red only', async () => {
    await openDetail('/etfs/3', 3);
    const disposals = screen.getByRole('table', { name: 'Disposals' });
    const row = rowOf(disposals, '01/12/2025');
    expect(cell(disposals, row, 'Gain')).toBe('−$220.00');
    expect(within(row).getByText('−$220.00')).toHaveClass('jf-amount--negative');
    expect(within(row).getByText('$1,390.00')).not.toHaveClass('jf-amount--negative');
    expect(cell(disposals, row, 'Term')).toBe('Long term');
    expect(cell(disposals, row, 'FY')).toBe('FY2025–26');
  });

  it('the holding’s trades without a Holding column, and its dividends (read-only)', async () => {
    await openDetail('/crypto/8', 8);
    // The caption names the holding, not the kind (every row is this holding's).
    const trades = screen.getByRole('table', { name: 'ETH trades: 2 rows' });
    expect(headers(trades)).not.toContain('Holding');
    expect(screen.getByRole('button', { name: 'Edit ETH trade of 10/04/2026' })).toBeVisible();
    const dividends = screen.getByRole('table', { name: 'Staking' });
    const paid = rowOf(dividends, '31/08/2026');
    expect(cell(dividends, paid, 'Net')).toBe('$15.00');
    expect(cell(dividends, paid, 'Units at ex-date')).toBe('1');
    expect(cell(dividends, paid, 'Yield')).toBe('0.4%');
    // Stage 3 (§6.7): a link to the Dividends page, filtered to this holding.
    const edit = screen.getByRole('link', { name: 'Edit on the Dividends page' });
    expect(edit).toBeVisible();
    expect(edit).toHaveAttribute('href', '/dividends?holding=8');
  });

  it('managed fund units show 6 dp', async () => {
    await openDetail('/managed-funds/5', 5);
    expect(tile('Units')).toHaveTextContent('1,500.123456');
  });

  it('the holding under 90 days: the XIRR tile shows "—"', async () => {
    const detail = holdingDetails[4]!;
    const recent = {
      ...detail,
      trades: detail.trades.filter((t) => t.id === 116),
    };
    mockApi(detailRoute(recent));
    renderApp('/etfs/4');
    await screen.findByRole('heading', { level: 1, name: 'ASX:DEF' });
    expect(tile('Est. return / yr')).toHaveTextContent('—');
    expect(tile('Est. return / yr')).toHaveTextContent('Held under 90 days');
  });

  it('Add trade opens the form with this holding pre-selected', async () => {
    const { user } = await openDetail('/etfs/4', 4, {
      'GET /api/investments/etf': { body: investmentPages.etf },
      'GET /api/investments/etf/trades': { body: investmentTrades.etf },
    });
    await user.click(screen.getByRole('button', { name: 'Add trade' }));
    const form = await screen.findByRole('form', { name: 'Add trade' });
    expect(within(form).getByRole('combobox', { name: /Holding/ })).toHaveValue('4');
    expect(within(form).getByRole('textbox', { name: /^Fee/ })).toHaveValue('0.00');
    expect(within(form).getByRole('button', { name: 'Amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Edit holding moves focus into the holding settings form', async () => {
    const { user } = await openDetail('/etfs/4', 4);
    await user.click(screen.getByRole('button', { name: 'Edit holding' }));
    const form = screen.getByRole('form', { name: 'Holding settings for ASX:DEF' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });
});

describe('the holding form on the detail page (§6.6)', () => {
  it('a default-fee-only change keeps the rest of the body exactly as the DTO holds it', async () => {
    const dto = instrumentDtoById[12]!;
    const detail = {
      ...holdingDetails[4]!,
      instrument: dto,
      holding: investmentPages.etf.holdings[1]!,
      trades: investmentTrades.etf.trades.filter((t) => t.instrumentId === 12),
    };
    const api = mockApi({ ...detailRoute(detail), 'PUT /api/instruments/12': { body: dto } });
    const { user } = renderApp('/etfs/12');
    const form = await screen.findByRole('form', { name: 'Holding settings for ASX:MNO' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(form).getByRole('checkbox', { name: 'Use the global default fee' }));
    const fee = within(form).getByRole('textbox', { name: 'Default fee' });
    await user.type(fee, '0');
    // A default-fee-only change is not an app edit: no workbook warning.
    expect(within(form).queryByRole('note', { name: 'Workbook holding' })).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/instruments/12')).toHaveLength(1));
    const body = api.calls('PUT /api/instruments/12')[0]?.body as ReturnType<
      typeof instrumentEditableFromDto
    >;
    // Equal to the DTO's editable fields except the default fee.
    expect({ ...body, defaultFee: null }).toEqual({
      ...instrumentEditableFromDto(dto),
      defaultFee: null,
    });
    expect(body.defaultFee).toEqual({ kind: 'flat', cents: 0 });
    expect(await screen.findByRole('status', { name: 'Holding save result' })).toHaveTextContent(
      'Holding saved.',
    );
  });

  it('announces "Holding saved" beside the form even when the save remounts the form', async () => {
    // The refetch after the PUT brings a changed default fee, so the form's key changes and it
    // remounts while the mutation settles; the confirmation must still appear.
    const dto = instrumentDtoById[12]!;
    const before = {
      ...holdingDetails[4]!,
      instrument: dto,
      holding: investmentPages.etf.holdings[1]!,
      trades: investmentTrades.etf.trades.filter((t) => t.instrumentId === 12),
    };
    const saved = { ...dto, defaultFee: { kind: 'flat' as const, cents: 0 } };
    let put = false;
    const api = mockApi({
      'GET /api/instruments/12': () => ({
        body: put ? { ...before, instrument: saved } : before,
      }),
      'PUT /api/instruments/12': () => {
        put = true;
        return { body: saved };
      },
    });
    const { user } = renderApp('/etfs/12');
    const form = await screen.findByRole('form', { name: 'Holding settings for ASX:MNO' });
    await user.click(within(form).getByRole('checkbox', { name: 'Use the global default fee' }));
    await user.type(within(form).getByRole('textbox', { name: 'Default fee' }), '0');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/instruments/12')).toHaveLength(1));
    const result = await screen.findByRole('status', { name: 'Holding save result' });
    await waitFor(() => expect(result).toHaveTextContent('Holding saved.'));
    // Beside the form, inside the Holding settings section.
    expect(result.closest('#holding-settings')).not.toBeNull();
    // The form started again from the saved values (it remounted).
    const fresh = screen.getByRole('form', { name: 'Holding settings for ASX:MNO' });
    expect(within(fresh).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('warns on a workbook holding when anything but the default fee changes; % → ratio', async () => {
    const api = mockApi({
      ...detailRoute(holdingDetails[4]!),
      'PUT /api/instruments/4': { body: instrumentDtoById[4] },
    });
    const { user } = renderApp('/etfs/4');
    const form = await screen.findByRole('form', { name: 'Holding settings for ASX:DEF' });
    const target = within(form).getByRole('textbox', { name: /^Target/ });
    expect(target).toHaveValue('60');
    await user.clear(target);
    await user.type(target, '12.5');
    expect(within(form).getByRole('note', { name: 'Workbook holding' })).toHaveTextContent(
      WORKBOOK_HOLDING_NOTE,
    );
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/instruments/4')).toHaveLength(1));
    expect(api.calls('PUT /api/instruments/4')[0]?.body).toMatchObject({ targetRatio: '0.125' });
  });

  it('shows the running regions total and the server-matching regions error', async () => {
    mockApi(detailRoute(holdingDetails[4]!));
    const { user } = renderApp('/etfs/4');
    const form = await screen.findByRole('form', { name: 'Holding settings for ASX:DEF' });
    expect(within(form).getByTestId('regions-total')).toHaveTextContent('Regions add up to 100%');
    const us = within(form).getByRole('textbox', { name: /Region: US/ });
    await user.clear(us);
    await user.type(us, '75');
    expect(within(form).getByTestId('regions-total')).toHaveTextContent('Regions add up to 115%');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Must add up to at most 100%.')).toBeVisible();
  });

  it('Cancel undoes the changes', async () => {
    mockApi(detailRoute(holdingDetails[4]!));
    const { user } = renderApp('/etfs/4');
    const form = await screen.findByRole('form', { name: 'Holding settings for ASX:DEF' });
    const name = within(form).getByRole('textbox', { name: 'Name' });
    await user.type(name, ' more');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(name).toHaveValue('DEF Example ETF');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('crypto: no sector or regions; the default fee is a percentage', async () => {
    const { detail } = await openDetail('/crypto/8', 8);
    const form = screen.getByRole('form', {
      name: `Holding settings for ${detail.instrument.symbol}`,
    });
    expect(within(form).queryByRole('textbox', { name: 'Sector' })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: /Region/ })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: 'Location' })).toBeNull();
    expect(
      within(form).getByRole('checkbox', { name: 'Use the global default fee' }),
    ).toBeChecked();
    expect(within(form).getByText('Trades pre-fill 0.5%')).toBeVisible();
  });

  it('stocks: no location, management fee or regions', async () => {
    await openDetail('/stocks/1', 1);
    const form = screen.getByRole('form', { name: 'Holding settings for ASX:ABC' });
    expect(within(form).getByRole('textbox', { name: 'Sector' })).toBeVisible();
    expect(within(form).queryByRole('textbox', { name: /Region/ })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: /Management fee/ })).toBeNull();
  });

  it('Delete holding is offered only without trades or dividends, behind a confirm', async () => {
    await openDetail('/stocks/1', 1);
    expect(screen.queryByRole('button', { name: 'Delete holding' })).toBeNull();
    expect(screen.getByText(/cannot be deleted/)).toBeVisible();
  });

  it('deletes a holding with no trades and goes back to the kind page', async () => {
    const dto = instrumentDtoById[13]!;
    const detail = {
      ...holdingDetails[1]!,
      instrument: dto,
      holding: investmentPages.stock.holdings[2]!,
      lots: [],
      disposals: [],
      trades: [],
      dividends: [],
    };
    const api = mockApi({
      ...detailRoute(detail),
      'DELETE /api/instruments/13': { body: { ...deletedResponse, id: 13 } },
      'GET /api/investments/stock': pending,
      'GET /api/investments/stock/trades': pending,
    });
    const { user, router } = renderApp('/stocks/13');
    await user.click(await screen.findByRole('button', { name: 'Delete holding' }));
    const confirm = screen.getByRole('note', { name: 'Delete holding' });
    expect(confirm).toHaveTextContent('Delete ASX:GHI? This cannot be undone.');
    // Created in the app: no workbook warning.
    expect(confirm).not.toHaveTextContent('came from the workbook');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Delete holding' }));
    await waitFor(() => expect(api.calls('DELETE /api/instruments/13')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks'));
  });
});
