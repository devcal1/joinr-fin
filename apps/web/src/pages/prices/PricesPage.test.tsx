import type { PricesResponse } from '@joinr/schema';
import {
  apiErrors,
  priceItemManualSet,
  priceItems,
  pricesEmpty,
  pricesFake,
  pricesLive,
  pricesOff,
  pricesRunning,
  refreshResponse,
} from '@joinr/schema/fixtures';
import { toIsoDate } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRICES_POLL_MS, queryKeys } from '../../api/hooks';
import { emulatePhone } from '../../../test/media';
import { apiError, mockApi, pending, type MockHandler } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { MODE_OFF_NOTE } from './PricesPage';
import { PRICE_NOT_POSITIVE, PRICE_REQUIRED, SYMBOL_INVALID } from './validation';

const heldCount = priceItems.filter((item) => item.held).length;

function withPrices(prices: PricesResponse, extra: Record<string, MockHandler> = {}) {
  return mockApi({ 'GET /api/prices': { body: prices }, ...extra });
}

async function pricesTable(): Promise<HTMLElement> {
  return within(await findMain()).findByRole('table', { name: /^Prices of/ });
}

async function rowFor(symbol: string): Promise<HTMLElement> {
  const table = await pricesTable();
  return within(table)
    .getByText(symbol, { selector: '.jf-app-instrument__symbol' })
    .closest('tr') as HTMLElement;
}

function badgeStatus(row: HTMLElement): string | null {
  return row.querySelector('.jf-badge')?.getAttribute('data-status') ?? null;
}

describe('PricesPage', () => {
  it('shows a loading line', async () => {
    mockApi({ 'GET /api/prices': pending });
    renderApp('/prices');
    expect(await screen.findByRole('heading', { level: 1, name: 'Prices' })).toBeInTheDocument();
    expect(within(await findMain()).getByRole('status')).toHaveTextContent('Loading prices');
  });

  it('shows the error when prices cannot load', async () => {
    mockApi({ 'GET /api/prices': apiError(500, apiErrors.internal) });
    renderApp('/prices');
    expect(
      await within(await findMain()).findByRole('note', { name: 'Could not load prices' }),
    ).toHaveTextContent('Internal server error');
  });

  it('lists held instruments with price, source, as-of and a status badge with a reason', async () => {
    withPrices(pricesLive);
    renderApp('/prices');
    const table = await pricesTable();
    expect(within(table).getAllByRole('row')).toHaveLength(heldCount + 1);
    expect(screen.getByRole('switch', { name: 'Held only' })).toBeChecked();

    const abc = await rowFor('ASX:ABC');
    expect(abc).toHaveTextContent('ABC Example Ltd');
    expect(within(abc).getByText('Stock')).toHaveClass('jf-pill');
    expect(within(abc).getByText('$12.50')).toBeInTheDocument();
    expect(within(abc).getByText('Yahoo')).toBeInTheDocument();
    expect(within(abc).getByText('Fresh')).toBeInTheDocument();
    expect(badgeStatus(abc)).toBe('fresh');

    const xyz = await rowFor('ASX:XYZ');
    expect(badgeStatus(xyz)).toBe('stale');
    expect(within(xyz).getByText('From workbook 31/08/2026')).toBeInTheDocument();
    expect(within(xyz).getAllByText('From workbook').length).toBeGreaterThan(0);

    const def = await rowFor('ASX:DEF');
    expect(badgeStatus(def)).toBe('failed');
    expect(within(def).getByText('Symbol not found')).toBeInTheDocument();

    const fund = await rowFor('EXAMPLEFUND');
    expect(badgeStatus(fund)).toBe('go');
    expect(within(fund).getByText('Manual', { selector: '.jf-badge__label' })).toBeInTheDocument();
    expect(within(fund).getByText('21/09/2026')).toBeInTheDocument();

    const btc = await rowFor('BTC');
    expect(within(btc).getByText('0.05')).toBeInTheDocument();
    expect(within(btc).getByText('$100,000.00')).toBeInTheDocument();
    expect(within(btc).getByText('CoinGecko')).toBeInTheDocument();
  });

  it('shows watched instruments too when "Held only" is off', async () => {
    withPrices(pricesLive);
    const { user } = renderApp('/prices');
    await pricesTable();
    await user.click(screen.getByRole('switch', { name: 'Held only' }));
    const table = await pricesTable();
    expect(within(table).getAllByRole('row')).toHaveLength(priceItems.length + 1);
    const none = await rowFor('EXAMPLEFUND2');
    expect(within(none).getByText('No price')).toBeInTheDocument();
    expect(badgeStatus(none)).toBe('failed');
    expect(within(none).getByText('No price source')).toBeInTheDocument();
  });

  it('shows the refresh line and marks fake prices', async () => {
    withPrices(pricesFake);
    renderApp('/prices');
    const main = await findMain();
    expect(await within(main).findByText(/^Refreshed /)).toBeInTheDocument();
    expect(within(main).getByText('Test prices', { selector: '.jf-pill' })).toBeInTheDocument();
    const abc = await rowFor('ASX:ABC');
    expect(within(abc).getByText('Test prices')).toBeInTheDocument();
  });

  it('hides "Refresh now" and explains when market data is off', async () => {
    withPrices(pricesOff);
    renderApp('/prices');
    expect(await screen.findByText(MODE_OFF_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
    expect(screen.getByText('Not refreshed yet')).toBeInTheDocument();
  });

  it('refreshes on demand (forced) and reports the result', async () => {
    const api = withPrices(pricesLive, {
      'POST /api/prices/refresh': { body: refreshResponse },
    });
    const { user } = renderApp('/prices');
    await pricesTable();
    await user.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByRole('note', { name: 'Prices refreshed' })).toHaveTextContent(
      '6 prices updated; 2 failed.',
    );
    // Announced: the summary sits in a persistent polite live region.
    expect(screen.getByRole('status', { name: 'Refresh result' })).toHaveTextContent(
      '6 prices updated; 2 failed.',
    );
    expect(api.calls('POST /api/prices/refresh')[0]?.body).toEqual({ force: true });
  });

  it('shows the refresh button busy while a refresh runs', async () => {
    withPrices(pricesLive, { 'POST /api/prices/refresh': pending });
    const { user } = renderApp('/prices');
    await pricesTable();
    await user.click(screen.getByRole('button', { name: 'Refresh now' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
  });

  it('shows a scheduled run as busy too', async () => {
    withPrices(pricesRunning);
    renderApp('/prices');
    expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeDisabled();
  });

  it('shows a refresh error', async () => {
    withPrices(pricesLive, {
      'POST /api/prices/refresh': apiError(503, apiErrors.marketDataDisabled),
    });
    const { user } = renderApp('/prices');
    await pricesTable();
    await user.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByRole('note', { name: 'Refresh failed' })).toHaveTextContent(
      'Market data is switched off',
    );
    expect(screen.getByRole('alert', { name: 'Refresh error' })).toHaveTextContent(
      'Market data is switched off',
    );
  });

  it('shows the market series with values, badges and as-of', async () => {
    withPrices(pricesLive);
    renderApp('/prices');
    const series = await screen.findByRole('table', { name: 'Market series' });
    const labels = within(series)
      .getAllByRole('rowheader')
      .map((th) => th.textContent);
    expect(labels).toEqual([
      'AUD/USD',
      'Silver (AUD/oz)',
      'Gold (AUD/oz)',
      'Silver (USD/oz)',
      'Gold (USD/oz)',
    ]);
    expect(within(series).getByText('$46.15')).toBeInTheDocument();
    expect(within(series).getByText('US$2,600.00')).toBeInTheDocument();
    expect(within(series).getAllByText('Failed')).toHaveLength(1);
  });

  it('explains an empty database', async () => {
    withPrices(pricesEmpty);
    renderApp('/prices');
    const table = await pricesTable();
    expect(table).toHaveTextContent('No instruments yet. Import a workbook first.');
    expect(within(table).getByRole('link', { name: 'Import a workbook' })).toHaveAttribute(
      'href',
      '/import',
    );
    const series = screen.getByRole('table', { name: 'Market series' });
    // Never fetched is not a failure: a neutral "Not fetched" badge, no red.
    const notFetched = within(series).getAllByText('Not fetched');
    expect(notFetched).toHaveLength(5);
    for (const label of notFetched) {
      expect(label.closest('.jf-badge')).toHaveAttribute('data-status', 'pending');
    }
    expect(within(series).queryByText('Failed')).toBeNull();
  });

  it('refetches every minute while the page is open', async () => {
    withPrices(pricesLive);
    const { queryClient } = renderApp('/prices');
    await pricesTable();
    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.prices });
    const options = query?.options as
      { refetchInterval?: unknown; refetchIntervalInBackground?: unknown } | undefined;
    const interval = options?.refetchInterval;
    expect(
      typeof interval === 'function' ? (interval as (q: unknown) => unknown)(query) : interval,
    ).toBe(PRICES_POLL_MS);
    expect(options?.refetchIntervalInBackground).toBe(false);
  });

  describe('manual price form', () => {
    it('validates, then saves a manual price', async () => {
      const api = withPrices(pricesLive, {
        'PUT /api/prices/1/manual': { body: priceItemManualSet },
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Set price for ASX:ABC' }));
      const form = await screen.findByRole('form', { name: 'Set price for ASX:ABC' });
      const price = within(form).getByRole('textbox', { name: /Price \(AUD\)/ });
      expect(price).toHaveFocus();
      expect(within(form).getByRole('textbox', { name: /As of/ })).toHaveValue(
        toIsoDate(new Date()).split('-').reverse().join('/'),
      );

      await user.click(within(form).getByRole('button', { name: 'Save' }));
      expect(within(form).getByText(PRICE_REQUIRED)).toBeInTheDocument();
      expect(api.calls('PUT /api/prices/1/manual')).toHaveLength(0);

      await user.type(price, '0');
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      expect(within(form).getByText(PRICE_NOT_POSITIVE)).toBeInTheDocument();

      await user.clear(price);
      await user.type(price, '13');
      await user.type(within(form).getByRole('textbox', { name: 'Note' }), ' Broker quote ');
      await user.click(within(form).getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
        'Manual price saved for ASX:ABC.',
      );
      expect(screen.getByRole('status', { name: 'Save result' })).toHaveTextContent(
        'Manual price saved for ASX:ABC.',
      );
      // Focus goes back to the row button that opened the form.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Set price for ASX:ABC' })).toHaveFocus(),
      );
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
      expect(api.calls('PUT /api/prices/1/manual')[0]?.body).toEqual({
        price: '13',
        asOf: toIsoDate(new Date()),
        note: 'Broker quote',
      });
    });

    it('shows server validation errors under the field', async () => {
      withPrices(pricesLive, {
        'PUT /api/prices/1/manual': apiError(400, apiErrors.validation),
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Set price for ASX:ABC' }));
      const form = await screen.findByRole('form', { name: 'Set price for ASX:ABC' });
      const price = within(form).getByRole('textbox', { name: /Price \(AUD\)/ });
      await user.type(price, '5');
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(price).toHaveAttribute('aria-invalid', 'true'));
      expect(within(form).getByText('Must be greater than zero.')).toBeInTheDocument();
    });

    it('clears an existing manual price', async () => {
      const api = withPrices(pricesLive, {
        'DELETE /api/prices/5/manual': { body: priceItems[4] },
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Set price for EXAMPLEFUND' }));
      const form = await screen.findByRole('form', { name: 'Set price for EXAMPLEFUND' });
      expect(within(form).getByRole('textbox', { name: /Price \(AUD\)/ })).toHaveValue('1.5');
      await user.click(within(form).getByRole('button', { name: 'Clear manual price' }));
      expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
        'Manual price cleared for EXAMPLEFUND.',
      );
      expect(api.calls('DELETE /api/prices/5/manual')).toHaveLength(1);
    });

    it('offers no clear button without a manual price, and cancels', async () => {
      withPrices(pricesLive);
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Set price for ASX:ABC' }));
      const form = await screen.findByRole('form', { name: 'Set price for ASX:ABC' });
      expect(within(form).queryByRole('button', { name: 'Clear manual price' })).toBeNull();
      await user.click(within(form).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
      // Keyboard users keep their place: focus returns to the button that opened the form.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Set price for ASX:ABC' })).toHaveFocus(),
      );
      expect(document.body).not.toHaveFocus();
    });
  });

  describe('price source form', () => {
    it('edits a CoinGecko id', async () => {
      const api = withPrices(pricesLive, {
        'PUT /api/prices/7/source': { body: priceItems[5] },
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Source for BTC' }));
      const form = await screen.findByRole('form', { name: 'Price source for BTC' });
      expect(within(form).getByRole('combobox', { name: 'Provider' })).toHaveValue('coingecko');
      const id = within(form).getByRole('textbox', { name: /CoinGecko id/ });
      expect(id).toHaveValue('bitcoin');

      await user.clear(id);
      await user.type(id, 'bit coin');
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      expect(within(form).getByText(SYMBOL_INVALID)).toBeInTheDocument();
      expect(api.calls('PUT /api/prices/7/source')).toHaveLength(0);

      await user.clear(id);
      await user.type(id, 'bitcoin');
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
        'Price source saved for BTC.',
      );
      expect(api.calls('PUT /api/prices/7/source')[0]?.body).toEqual({
        provider: 'coingecko',
        providerSymbol: 'bitcoin',
      });
    });

    it('switches an instrument to manual only', async () => {
      const api = withPrices(pricesLive, {
        'PUT /api/prices/1/source': { body: priceItems[0] },
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Source for ASX:ABC' }));
      const form = await screen.findByRole('form', { name: 'Price source for ASX:ABC' });
      await user.selectOptions(within(form).getByRole('combobox', { name: 'Provider' }), 'none');
      expect(within(form).getByRole('textbox', { name: 'Symbol' })).toBeDisabled();
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(api.calls('PUT /api/prices/1/source')).toHaveLength(1));
      expect(api.calls('PUT /api/prices/1/source')[0]?.body).toEqual({
        provider: 'none',
        providerSymbol: null,
      });
    });

    it('shows an API error on the form', async () => {
      withPrices(pricesLive, {
        'PUT /api/prices/1/source': apiError(404, apiErrors.notFound),
      });
      const { user } = renderApp('/prices');
      await pricesTable();
      await user.click(screen.getByRole('button', { name: 'Source for ASX:ABC' }));
      const form = await screen.findByRole('form', { name: 'Price source for ASX:ABC' });
      await user.click(within(form).getByRole('button', { name: 'Save' }));
      expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
        'No instrument 999',
      );
    });
  });
});

describe('PricesPage column order', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const headers = async (): Promise<(string | null)[]> =>
    within(await pricesTable())
      .getAllByRole('columnheader')
      .map((th) => th.textContent);

  it('keeps the reading order on wider screens', async () => {
    withPrices(pricesLive);
    renderApp('/prices');
    expect(await headers()).toEqual([
      'Instrument',
      'Kind',
      'Held units',
      'Price',
      'Source',
      'As of',
      'Status',
      'Last error',
      'Actions',
    ]);
  });

  it('puts the price, status and actions first on a phone', async () => {
    emulatePhone();
    withPrices(pricesLive);
    renderApp('/prices');
    expect(await headers()).toEqual([
      'Instrument',
      'Price',
      'Status',
      'Actions',
      'Kind',
      'Held units',
      'Source',
      'As of',
      'Last error',
    ]);
    // The instrument still names the row (the sticky first column).
    const table = await pricesTable();
    const first = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(within(first).getByRole('rowheader').querySelector('.jf-app-instrument')).not.toBeNull();
  });
});
