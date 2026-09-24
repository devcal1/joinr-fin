import { RECORD_ENTITIES, RECORD_ENTITY_IDS } from '@joinr/schema';
import { apiErrors, recordsPageEmpty, recordsPages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';

function recordRoutes() {
  return Object.fromEntries(
    RECORD_ENTITY_IDS.map((id) => [`GET /api/records/${id}`, { body: recordsPages[id] }]),
  );
}

async function findTable(name: string): Promise<HTMLElement> {
  return within(await findMain()).findByRole('table', { name });
}

describe('RecordsEntityPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the h1 "Records" with the entity label as the sub-line', async () => {
    mockApi({ 'GET /api/records/trades': pending });
    renderApp('/records/trades');
    expect(await screen.findByRole('heading', { level: 1, name: 'Records' })).toBeInTheDocument();
    expect(
      screen.getByText('Trades', { selector: '.jf-page-header__subtitle' }),
    ).toBeInTheDocument();
    expect(within(await findMain()).getByRole('status')).toHaveTextContent('Loading trades');
  });

  it('keeps Records marked in the nav on a sub-route', async () => {
    mockApi({ 'GET /api/records/trades': pending });
    renderApp('/records/trades');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const current = within(nav).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Records');
  });

  it('shows the trades table with formatted cells, flags and the default sort', async () => {
    mockApi(recordRoutes());
    renderApp('/records/trades');
    const table = await findTable('Trades');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(RECORD_ENTITIES.trades.columns.map((c) => c.label));
    // Newest first (registry default sort: date, descending).
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual([
      '20/05/2025',
      '03/02/2025',
      '15/01/2025',
      '11/11/2024',
    ]);
    expect(within(table).getByRole('columnheader', { name: /Date/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    const flagged = rows[0] as HTMLElement;
    expect(within(flagged).getByText('Out of order')).toBeInTheDocument();
    expect(within(flagged).getByText('Price outlier')).toBeInTheDocument();
    expect(within(flagged).getByText('$500.00')).toBeInTheDocument();
    // A sell's order value keeps its U+2212 sign in body text, not the stop tint (D33).
    const sellValue = within(rows[1] as HTMLElement).getByText('−$120.00');
    expect(sellValue).toHaveClass('jf-amount');
    expect(sellValue).not.toHaveClass('jf-amount--negative');
    expect(within(rows[1] as HTMLElement).getByText('−20')).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText('0.50%')).toBeInTheDocument();
    expect(within(await findMain()).getByText('4 rows')).toBeInTheDocument();
  });

  it('right-aligns figure columns', async () => {
    mockApi(recordRoutes());
    renderApp('/records/trades');
    const table = await findTable('Trades');
    expect(within(table).getByRole('columnheader', { name: /Units/ })).toHaveClass(
      'jf-table__th--num',
    );
    expect(within(table).getByRole('columnheader', { name: /Symbol/ })).not.toHaveClass(
      'jf-table__th--num',
    );
  });

  it('shows the 36 snapshot value columns', async () => {
    mockApi(recordRoutes());
    renderApp('/records/snapshots');
    const table = await findTable('Snapshots');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(39);
    expect(within(table).getByText('Jul 2026')).toBeInTheDocument();
  });

  it('formats settings values by their type', async () => {
    mockApi(recordRoutes());
    renderApp('/records/settings');
    const table = await findTable('Settings');
    const row = (key: string) =>
      within(table).getByText(key, { selector: 'td .jf-app-nowrap' }).closest('tr') as HTMLElement;
    expect(within(row('pay.netPayCents')).getByText('$3,000.00')).toBeInTheDocument();
    expect(within(row('allocation.etf')).getByText('60.00%')).toBeInTheDocument();
    expect(within(row('features.cash')).getByText('Yes')).toBeInTheDocument();
    expect(within(row('pay.jobStartDate')).getByText('06/01/2020')).toBeInTheDocument();
    expect(within(row('pay.frequency')).getByText('Fortnightly')).toBeInTheDocument();
    // Figures in the (left-aligned) Value column are mono; words are not.
    expect(within(row('allocation.etf')).getByText('60.00%')).toHaveClass('jf-app-num--inline');
    expect(within(row('pay.jobStartDate')).getByText('06/01/2020')).toHaveClass('jf-app-num');
    expect(within(row('features.cash')).getByText('Yes')).not.toHaveClass('jf-app-num');
  });

  it('puts the symbol first in the instruments table (the sticky column)', async () => {
    mockApi(recordRoutes());
    renderApp('/records/instruments');
    const table = await findTable('Instruments');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers[0]).toBe('Symbol');
    expect(headers[1]).toBe('Kind');
  });

  it('puts the label first and then the key in the settings table (D35)', async () => {
    mockApi(recordRoutes());
    renderApp('/records/settings');
    const table = await findTable('Settings');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers.slice(0, 3)).toEqual(['Label', 'Key', 'Category']);
    // The label names each row (the sticky first column); rows stay sorted by key.
    const labels = within(table)
      .getAllByRole('rowheader')
      .map((th) => th.textContent);
    expect(labels[0]).toBe('Target allocation: ETFs');
    expect(within(table).getByRole('columnheader', { name: /Key/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it.each(RECORD_ENTITY_IDS)('renders every column of %s', async (id) => {
    mockApi(recordRoutes());
    renderApp(`/records/${id}`);
    const table = await findTable(RECORD_ENTITIES[id].label);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(
      RECORD_ENTITIES[id].columns.length,
    );
    expect(within(table).getAllByRole('row')).toHaveLength(recordsPages[id].rows.length + 1);
  });

  it('shows an empty table message', async () => {
    mockApi({ 'GET /api/records/trades': { body: recordsPageEmpty } });
    renderApp('/records/trades');
    const table = await findTable('Trades');
    expect(within(table).getByText('No rows in this table.')).toBeInTheDocument();
    expect(within(await findMain()).getByText('0 rows')).toBeInTheDocument();
  });

  it('shows the API error', async () => {
    mockApi({ 'GET /api/records/trades': apiError(500, apiErrors.internal) });
    renderApp('/records/trades');
    expect(
      await within(await findMain()).findByRole('note', { name: 'Could not load trades' }),
    ).toHaveTextContent('Internal server error');
  });

  it('switches tables with the link list on wider screens', async () => {
    mockApi(recordRoutes());
    const { router, user } = renderApp('/records/trades');
    const switcher = await screen.findByRole('navigation', { name: 'Record tables' });
    expect(within(switcher).getByRole('link', { name: 'Trades' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(within(switcher).getByRole('link', { name: 'Dividends' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/records/dividends'));
    expect(await findTable('Dividends')).toBeInTheDocument();
  });

  it('switches tables with a select on a phone', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('max-width: 767'),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    mockApi(recordRoutes());
    const { router, user } = renderApp('/records/trades');
    const select = await screen.findByRole('combobox', { name: 'Table' });
    expect(select).toHaveValue('trades');
    expect(screen.queryByRole('navigation', { name: 'Record tables' })).not.toBeInTheDocument();
    await user.selectOptions(select, 'snapshots');
    await waitFor(() => expect(router.state.location.pathname).toBe('/records/snapshots'));
  });

  it('shows "Page not found" for an unknown entity', async () => {
    mockApi();
    renderApp('/records/not-a-table');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
