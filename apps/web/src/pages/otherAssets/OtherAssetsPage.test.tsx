import type { OtherAssetsPageResponse } from '@joinr/schema';
import {
  apiErrors,
  appStatusEmpty,
  importRunsWithAppData,
  otherAssetMutationResponse,
  otherAssetPricesResponse,
  otherAssetsPages,
} from '@joinr/schema/fixtures';
import { CHART_PALETTE } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legendOf, mockAssets, rgbOf } from '../../../test/assets';
import { bodyRows, centsOf, columnTexts, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf, totalRow } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const populated = otherAssetsPages.populated;
const ASSETS_TABLE = 'Assets: 14 items';
const URL_NAME =
  'https://example.com/collectibles/items/1234567890/a-very-long-generic-item-name-for-the-width-checks';

async function openPage(fixture: OtherAssetsPageResponse = populated, routes = {}) {
  const api = mockAssets({ otherAssets: fixture, routes });
  const view = renderApp('/other-assets');
  await screen.findByRole('group', { name: 'Current value' });
  return { ...view, api };
}

/** A money cell's cents; a dash (with or without its reason) is null. */
function money(text: string): number | null {
  return text.startsWith('—') ? null : centsOf(text);
}

function tile(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Other Assets page: states (§6.9)', () => {
  it.each(Object.entries(otherAssetsPages))('renders the %s fixture', async (_name, fixture) => {
    mockAssets({ otherAssets: fixture });
    renderApp('/other-assets');
    expect(await screen.findByRole('heading', { level: 1, name: 'Other Assets' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Current value' })).toBeVisible();
    for (const title of ['Assets', 'Value over time', 'Settings for this page']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
  });

  it('loading', async () => {
    mockAssets({ otherAssets: pending });
    renderApp('/other-assets');
    expect(await screen.findByText('Loading other assets…')).toBeVisible();
  });

  it('a failed load offers Retry', async () => {
    mockAssets({ otherAssets: apiError(500, apiErrors.internal) });
    renderApp('/other-assets');
    const callout = await screen.findByRole('note', { name: 'Could not load other assets' });
    expect(within(callout).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('empty: the words and the import link; nothing to price', async () => {
    await openPage(otherAssetsPages.empty);
    expect(screen.getByRole('note', { name: 'No other assets' })).toHaveTextContent(
      'No other assets yet. Add one, or import the workbook on the Import page.',
    );
    expect(screen.queryByRole('button', { name: 'Update prices' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add asset' })).toBeVisible();
    expect(
      screen.getAllByText('History starts after the first recorded month.').length,
    ).toBeGreaterThan(0);
  });

  it('no snapshots: an undated item has no assumed date, so no return', async () => {
    await openPage(otherAssetsPages.noSnapshots);
    const table = tableNamed('Assets: 2 items');
    const box = rowOf(table, 'Sealed box');
    expect(cell(table, box, 'Bought')).toBe('—No purchase date and no recorded month');
    expect(cell(table, box, 'Return / yr')).toContain('—');
  });

  it('market off: the callout replaces the live-FX one; bullion shows Last known', async () => {
    await openPage(otherAssetsPages.marketOff);
    expect(screen.getByRole('note', { name: 'Market data off' })).toHaveTextContent(
      'Market data is off: bullion uses its last known price and foreign items are unvalued.',
    );
    expect(screen.queryByRole('note', { name: 'No current exchange rate' })).toBeNull();
    const table = tableNamed('Assets: 3 items');
    expect(cell(table, rowOf(table, 'Silver bar'), 'Price')).toContain('Last known');
    expect(tile('Bullion spot')).toHaveTextContent('Spot unavailable: last known prices');
  });
});

describe('Other Assets page: tiles and callouts (§6.3 items 2–3)', () => {
  it('Current value is the only teal figure; the six tiles read as §6.3 says', async () => {
    const { container } = await openPage();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Current value')).toHaveClass('jf-stat-tile--key');
    expect(tile('Current value')).toHaveTextContent('$12,869');
    expect(tile('Current value')).toHaveTextContent('14 items · 2 without a price');
    expect(tile('Gain')).toHaveTextContent('$2,758');
    expect(tile('Gain')).toHaveTextContent('28.5% on cost');
    expect(tile('Cost')).toHaveTextContent('Undated items count from 31/03/2026 (assumed)');
    expect(tile('Realised on sales')).toHaveTextContent('$320');
    expect(tile('Realised on sales')).toHaveTextContent('2 sales');
    const spot = tile('Bullion spot');
    expect(spot).toHaveTextContent('Silver $50.00/oz · Gold $4,000.00/oz');
    expect(within(spot).getByText('Stale')).toBeVisible();
    expect(spot).toHaveTextContent('You hold 10 oz of silver · 1 oz of gold');
    expect(tile('Prices to update')).toHaveTextContent('1 older than 90 days');
  });

  it('no sales: "No sales yet"; every price current', async () => {
    await openPage(otherAssetsPages.noSnapshots);
    expect(tile('Realised on sales')).toHaveTextContent('No sales yet');
    expect(tile('Prices to update')).toHaveTextContent('All prices current');
    expect(tile('Bullion spot')).toHaveTextContent('No bullion held');
  });

  it('the assumed-date, purchase-FX and live-FX callouts', async () => {
    await openPage();
    expect(screen.getByRole('note', { name: 'Assumed dates' })).toHaveTextContent(
      '1 item has no purchase date. Their return and the cost line count from the first recorded month (31/03/2026), marked Assumed. Add a purchase date to replace it.',
    );
    expect(screen.getByRole('note', { name: 'Exchange rate needed' })).toHaveTextContent(
      "1 item needs the exchange rate on their purchase date. It is fetched from Yahoo on the next price refresh, or type it in the item's form.",
    );
    expect(screen.getByRole('note', { name: 'No current exchange rate' })).toHaveTextContent(
      '1 foreign item has no current exchange rate yet, so it shows no value until the next price refresh.',
    );
  });
});

describe('Other Assets page: the assets table (§6.3 item 4, UX-5, UX-13)', () => {
  it('desktop columns; the totals are the Σ of the visible rows', async () => {
    await openPage();
    const table = tableNamed(ASSETS_TABLE);
    expect(headers(table)).toEqual([
      'Item',
      'Bought',
      'Units',
      'Unit cost',
      'Price',
      'Cost',
      'Value',
      'Gain',
      'Gain %',
      'Return / yr',
      'Actions',
    ]);
    expect(bodyRows(table)).toHaveLength(14);
    const sum = (header: string) =>
      columnTexts(table, header)
        .map(money)
        .reduce<number>((total, cents) => total + (cents ?? 0), 0);
    const total = totalRow(table);
    expect(centsOf(cell(table, total, 'Value'))).toBe(sum('Value'));
    expect(centsOf(cell(table, total, 'Gain'))).toBe(sum('Gain'));
    // Cost totals the rows with both a value and a cost, so Value − Cost = Gain.
    const withGain = bodyRows(table).filter((row) => money(cell(table, row, 'Gain')) !== null);
    const costs = withGain.map((row) => money(cell(table, row, 'Cost')) ?? 0);
    expect(centsOf(cell(table, total, 'Cost'))).toBe(costs.reduce((a, b) => a + b, 0));
    // White bold, never teal: no key cell in the total row.
    expect(total.querySelector('.jf-table__key')).toBeNull();
  });

  it('units, the unit cost with its FX line, the price with its date and marker', async () => {
    await openPage();
    const table = tableNamed(ASSETS_TABLE);
    const silver = rowOf(table, 'Silver bar');
    expect(cell(table, silver, 'Item')).toContain('Silver · 1 oz each');
    expect(cell(table, silver, 'Units')).toBe('10 oz');
    expect(cell(table, silver, 'Price')).toContain('Spot');
    const print = rowOf(table, 'Example print');
    expect(cell(table, print, 'Unit cost')).toBe('400.00 USD1 USD = A$1.50 on 10/05/2024');
    const painting = rowOf(table, 'Example painting');
    expect(cell(table, painting, 'Price')).toContain('31/03/2026');
    expect(cell(table, painting, 'Price')).toContain('Stale');
    // Hand pricing is the normal state: never a "Manual" badge.
    expect(within(table).queryByText('Manual')).toBeNull();
    const stamp = rowOf(table, 'Example stamp');
    expect(cell(table, stamp, 'Price')).toContain('No price yet');
    expect(cell(table, stamp, 'Value')).toBe('—No price yet');
    const lamp = rowOf(table, 'Example lamp');
    expect(cell(table, lamp, 'Item')).toContain('1 sold in the workbook');
    const banknote = rowOf(table, 'Example banknote');
    expect(cell(table, banknote, 'Unit cost')).toContain(
      'No exchange rate on the purchase date yet',
    );
    expect(cell(table, banknote, 'Cost')).toBe('—No exchange rate on the purchase date');
    const figurine = rowOf(table, 'Example figurine');
    expect(cell(table, figurine, 'Price')).toContain('320.00 EUR');
    expect(cell(table, figurine, 'Value')).toBe('—No current exchange rate');
  });

  it('Assumed marks an undated item’s date and return; the return shows "—" under 90 days', async () => {
    const fixture: OtherAssetsPageResponse = {
      ...populated,
      assets: populated.assets.map((a) => (a.id === 1 ? { ...a, heldDays: 60 } : a)),
    };
    await openPage(fixture);
    const table = tableNamed(ASSETS_TABLE);
    const box = rowOf(table, 'Sealed box');
    expect(cell(table, box, 'Bought')).toBe('31/03/2026Assumed');
    expect(cell(table, box, 'Return / yr')).toContain('Assumed');
    expect(cell(table, rowOf(table, 'Example watch'), 'Return / yr')).toBe('—Held under 90 days');
  });

  it('a URL-named item: its short name, one link to the valuation source', async () => {
    await openPage();
    const table = tableNamed(ASSETS_TABLE);
    const links = within(table).getAllByRole('link', { name: `${URL_NAME} (valuation source)` });
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLElement;
    expect(link).toHaveTextContent('example.com/collectibles/items/1234567890/a-ver…');
    expect(link).toHaveAttribute('href', URL_NAME);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('title', URL_NAME);
    // The row actions use the short name.
    expect(
      within(table).getByRole('button', {
        name: 'Edit example.com/collectibles/items/1234567890/a-ver…',
      }),
    ).toBeVisible();
  });

  it('only a loss is red: a negative gain in the stop tint, cost and value in body text', async () => {
    const fixture: OtherAssetsPageResponse = {
      ...populated,
      assets: populated.assets.map((a) =>
        a.id === 1 ? { ...a, gainCents: -30000, gainRatio: '-0.2', cagrRatio: '-0.05' } : a,
      ),
    };
    await openPage(fixture);
    const table = tableNamed(ASSETS_TABLE);
    const row = rowOf(table, 'Example watch');
    const index = headers(table).indexOf('Gain');
    expect(row.children[index]?.querySelector('.jf-amount--negative')).not.toBeNull();
    const ratio = row.children[headers(table).indexOf('Gain %')];
    expect(ratio?.querySelector('.jf-app-negative')).not.toBeNull();
    for (const header of ['Cost', 'Value']) {
      expect(
        row.children[headers(table).indexOf(header)]?.querySelector('.jf-amount--negative'),
      ).toBeNull();
    }
  });

  it('phone: status-first columns, every marker in the first cell', async () => {
    emulatePhone();
    await openPage();
    const table = tableNamed(ASSETS_TABLE);
    expect(headers(table)).toEqual([
      'Item',
      'Value',
      'Gain',
      'Price',
      'Actions',
      'Cost',
      'Bought',
      'Units',
      'Unit cost',
      'Gain %',
      'Return / yr',
    ]);
    const first = (name: string) => rowOf(table, name).children[0] as HTMLElement;
    expect(within(first('Sealed box')).getByText('Assumed')).toBeVisible();
    expect(within(first('Example painting')).getByText('Stale')).toBeVisible();
    expect(within(first('Silver bar')).getByText('Spot')).toBeVisible();
    expect(within(first('Example stamp')).getByText('No price yet')).toBeVisible();
    // The Price cell no longer repeats them.
    expect(cell(table, rowOf(table, 'Example painting'), 'Price')).not.toContain('Stale');
  });
});

describe('Other Assets page: Update prices (D72, UX-6)', () => {
  it('hand-priced rows become fields; bullion reads Spot; Save sends the changed rows with the shared date and note', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/other-assets/prices': { body: otherAssetPricesResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update prices' }));
    const form = screen.getByRole('form', { name: 'Update prices' });
    const save = within(form).getByRole('button', { name: 'Save prices' });
    expect(save).toBeDisabled();
    expect(within(form).getByRole('textbox', { name: 'Price, Example watch' })).toHaveFocus();
    expect(within(form).queryByRole('textbox', { name: 'Price, Silver bar' })).toBeNull();
    const table = tableNamed(ASSETS_TABLE);
    expect(cell(table, rowOf(table, 'Silver bar'), 'Price')).toBe('Spot');
    // A foreign item's price is in its currency (the suffix names it).
    expect(within(form).getByRole('textbox', { name: 'Price, Example print' })).toBeVisible();
    const watch = within(form).getByRole('textbox', { name: 'Price, Example watch' });
    await user.clear(watch);
    await user.type(watch, '1900');
    await user.click(
      within(form).getByRole('checkbox', { name: 'Still current, Example painting' }),
    );
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Yearly check');
    expect(form).toHaveTextContent('2 prices to save.');
    // Imported rows: the workbook callout only (never the app-data note as well).
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.click(save);
    await waitFor(() => expect(api.calls('PUT /api/other-assets/prices')).toHaveLength(1));
    const body = api.calls('PUT /api/other-assets/prices')[0]?.body as {
      asOf: string;
      entries: unknown[];
    };
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.entries).toEqual([
      { assetId: 1, unitPrice: '1900', note: 'Yearly check' },
      { assetId: 2, unitPrice: '2600', note: 'Yearly check' },
    ]);
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Prices saved.');
  });

  it('a stale row still shows Stale and its price date in Update prices mode (STYLE-9)', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Update prices' }));
    const table = tableNamed(ASSETS_TABLE);
    const painting = cell(table, rowOf(table, 'Example painting'), 'Price');
    expect(painting).toContain('31/03/2026');
    expect(painting).toContain('Stale');
    // A current row shows its date but no Stale marker.
    const watch = cell(table, rowOf(table, 'Example watch'), 'Price');
    expect(watch).toContain('01/09/2026');
    expect(watch).not.toContain('Stale');
    // Mark current is a view-mode action: none while the prices are being updated.
    expect(screen.queryByRole('button', { name: /^Mark the price of/ })).toBeNull();
  });

  it('a date before a row’s latest price notes it only adds history', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Update prices' }));
    const form = screen.getByRole('form', { name: 'Update prices' });
    const asOf = within(form).getByRole('textbox', { name: 'As of' });
    await user.clear(asOf);
    await user.type(asOf, '15/08/2026');
    const watch = within(form).getByRole('textbox', { name: 'Price, Example watch' });
    await user.clear(watch);
    await user.type(watch, '1750');
    expect(form).toHaveTextContent(
      'Older than the latest price (01/09/2026): added to the history only.',
    );
  });

  it('an app row only: the new-app-data note (no workbook callout); errors map to the form', async () => {
    const { user } = await openPage(populated, {
      'PUT /api/other-assets/prices': apiError(400, apiErrors.assetsValidation),
    });
    await user.click(screen.getByRole('button', { name: 'Update prices' }));
    const form = screen.getByRole('form', { name: 'Update prices' });
    const medal = within(form).getByRole('textbox', { name: 'Price, Example medal' });
    await user.clear(medal);
    await user.type(medal, '95');
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Save prices' }));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toBeVisible();
  });

  it('Mark current saves a stale row’s price again at today’s date (clears Stale)', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/other-assets/prices': { body: otherAssetPricesResponse },
    });
    expect(
      screen.queryByRole('button', { name: 'Mark the price of Example watch current' }),
    ).toBeNull();
    // It sits in the Price cell, under the Stale marker it clears (STYLE-10), not in Actions.
    const table = tableNamed(ASSETS_TABLE);
    const row = rowOf(table, 'Example painting');
    const priceCell = row.children[headers(table).indexOf('Price')] as HTMLElement;
    const actionsCell = row.children[headers(table).indexOf('Actions')] as HTMLElement;
    const mark = within(priceCell).getByRole('button', {
      name: 'Mark the price of Example painting current',
    });
    expect(within(actionsCell).queryByRole('button', { name: /^Mark the price of/ })).toBeNull();
    expect(
      within(actionsCell).getByRole('button', { name: 'Price history of Example painting' }),
    ).toBeVisible();
    await user.click(mark);
    await waitFor(() => expect(api.calls('PUT /api/other-assets/prices')).toHaveLength(1));
    const body = api.calls('PUT /api/other-assets/prices')[0]?.body as {
      asOf: string;
      entries: unknown[];
    };
    expect(body.entries).toEqual([{ assetId: 2, unitPrice: '2600' }]);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Prices saved.');
  });
});

describe('Other Assets page: the asset form (§6.3 item 4, §6.7)', () => {
  it('Bullion spot sets AUD, disables the currency and hides FX and the price fields', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Add asset' }));
    const form = screen.getByRole('form', { name: 'Add asset' });
    expect(within(form).getByRole('textbox', { name: /Description/ })).toHaveFocus();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Currency' }), 'USD');
    expect(within(form).getByRole('textbox', { name: 'FX at purchase' })).toBeVisible();
    expect(form).toHaveTextContent(
      'AUD per 1 USD on the purchase date. Left blank, it is fetched from Yahoo.',
    );
    expect(within(form).getByRole('textbox', { name: 'Current price' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Bullion spot' }));
    const currency = within(form).getByRole('combobox', { name: 'Currency' });
    expect(currency).toHaveValue('AUD');
    expect(currency).toBeDisabled();
    expect(within(form).queryByRole('textbox', { name: 'FX at purchase' })).toBeNull();
    expect(within(form).queryByRole('textbox', { name: 'Current price' })).toBeNull();
    expect(within(form).getByRole('combobox', { name: 'Metal' })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: 'Oz per unit' })).toBeVisible();
  });

  it('create: a manual item with its first price; the new-app-data note only', async () => {
    const { user, api } = await openPage(populated, {
      'POST /api/other-assets': { status: 201, body: otherAssetMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add asset' }));
    const form = screen.getByRole('form', { name: 'Add asset' });
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: /Description/ }), 'Example vase');
    await user.type(within(form).getByRole('textbox', { name: /Units/ }), '1');
    await user.type(within(form).getByRole('textbox', { name: 'Unit cost' }), '100');
    await user.type(within(form).getByRole('textbox', { name: 'Current price' }), '120');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/other-assets')).toHaveLength(1));
    const body = api.calls('POST /api/other-assets')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      description: 'Example vase',
      units: '1',
      currency: 'AUD',
      unitCost: '100',
      priceSource: 'manual',
      metal: null,
      ozPerUnit: null,
      purchaseFxRate: null,
      purchaseDate: null,
    });
    expect(body.price).toMatchObject({ unitPrice: '120' });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Asset saved.');
  });

  it('edit a foreign item: FX blanks when the date changes; GBX asks per GBP and sends ÷ 100', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/other-assets/11': { body: otherAssetMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example print' }));
    let form = screen.getByRole('form', { name: 'Edit item · Example print' });
    const fx = within(form).getByRole('textbox', { name: 'FX at purchase' });
    expect(fx).toHaveValue('1.5');
    const date = within(form).getByRole('textbox', { name: 'Purchase date' });
    await user.clear(date);
    await user.type(date, '11/05/2024');
    await user.tab();
    expect(within(form).getByRole('textbox', { name: 'FX at purchase' })).toHaveValue('');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Example banknote' }));
    form = screen.getByRole('form', { name: 'Edit item · Example banknote' });
    expect(form).toHaveTextContent('AUD per 1 GBP on the purchase date');
    await user.type(within(form).getByRole('textbox', { name: 'FX at purchase' }), '1.9012');
    // A workbook row: the workbook callout only.
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/other-assets/11')).toHaveLength(1));
    expect(api.calls('PUT /api/other-assets/11')[0]?.body).toMatchObject({
      currency: 'GBX',
      purchaseFxRate: '0.019012',
    });
  });

  it('a validation error maps to its field; Save stays disabled while pending', async () => {
    let release: () => void = () => undefined;
    const { user } = await openPage(populated, {
      'PUT /api/other-assets/1': () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              status: 400,
              body: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'units: must be a number such as 12.5',
                },
              },
            });
        }),
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example watch' }));
    const form = screen.getByRole('form', { name: 'Edit item · Example watch' });
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: /Units/ }), '0');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await within(form).findByText('Must be a number such as 12.5.')).toBeVisible();
  });

  it('delete sits in the edit form with an inline confirm', async () => {
    const { user, api } = await openPage(populated, {
      'DELETE /api/other-assets/13': { body: { id: 13 } },
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example medal' }));
    const form = screen.getByRole('form', { name: 'Edit item · Example medal' });
    await user.click(within(form).getByRole('button', { name: 'Delete item' }));
    const confirm = within(form).getByRole('group', {
      name: 'Delete Example medal with its prices and sales?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete the item Example medal' }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/other-assets/13')).toHaveLength(1));
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Asset deleted.');
  });

  it('no new-app-data note once app data exists', async () => {
    mockAssets({ importRuns: importRunsWithAppData });
    const { user } = renderApp('/other-assets');
    await user.click(await screen.findByRole('button', { name: 'Add asset' }));
    const form = screen.getByRole('form', { name: 'Add asset' });
    await waitFor(() => expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull());
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
  });
});

describe('Other Assets page: sales (D72)', () => {
  it('Sell: units at most those left; a 422 shows "Only N units are left to sell"', async () => {
    const { user, api } = await openPage(populated, {
      'POST /api/other-assets/8/sales': apiError(422, apiErrors.saleOversell),
    });
    await user.click(screen.getByRole('button', { name: 'Sell Example camera' }));
    const form = screen.getByRole('form', { name: 'Sell · Example camera' });
    expect(form.closest('section')).toHaveTextContent('2 units left to sell');
    await user.type(within(form).getByRole('textbox', { name: /Units/ }), '3');
    await user.type(within(form).getByRole('textbox', { name: /Proceeds received/ }), '900');
    await user.click(within(form).getByRole('button', { name: 'Record sale' }));
    expect(await within(form).findByText('Only 2 units are left to sell.')).toBeVisible();
    expect(api.calls('POST /api/other-assets/8/sales')).toHaveLength(0);
    const units = within(form).getByRole('textbox', { name: /Units/ });
    await user.clear(units);
    await user.type(units, '2');
    await user.click(within(form).getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.calls('POST /api/other-assets/8/sales')).toHaveLength(1));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'Only 2 units are left to sell',
    );
    expect(api.calls('POST /api/other-assets/8/sales')[0]?.body).toMatchObject({
      units: '2',
      proceedsCents: 90000,
      note: null,
    });
  });

  it('a sold-out item cannot be sold', async () => {
    await openPage();
    expect(screen.getByRole('button', { name: 'Sell Example ring' })).toBeDisabled();
  });

  it('the sales table: realised gains, a loss in the stop tint, totals', async () => {
    const fixture: OtherAssetsPageResponse = {
      ...populated,
      sales: populated.sales.map((s) => (s.id === 2 ? { ...s, realisedCents: -8000 } : s)),
    };
    await openPage(fixture);
    const table = tableNamed('Sales: 2 sales');
    expect(headers(table)).toEqual([
      'Date',
      'Item',
      'Units',
      'Proceeds',
      'Cost',
      'Realised gain',
      'Note',
      'Actions',
    ]);
    const loss = rowOf(table, '20/02/2026');
    expect(
      loss.children[headers(table).indexOf('Realised gain')]?.querySelector('.jf-amount--negative'),
    ).not.toBeNull();
    expect(cell(table, totalRow(table), 'Proceeds')).toBe('$1,400.00');
  });

  it('deleting the only sale announces it after the table goes (late status refetch)', async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const only = populated.sales[0]!;
    const before: OtherAssetsPageResponse = { ...populated, sales: [only] };
    let deleted = false;
    mockAssets({
      otherAssets: () => ({ body: deleted ? { ...before, sales: [] } : before }),
      routes: {
        // The header's status answers after the page refetch has dropped the table.
        'GET /api/status': async () => {
          if (deleted) await sleep(150);
          return { body: appStatusEmpty };
        },
        [`DELETE /api/other-assets/sales/${only.id}`]: () => {
          deleted = true;
          return { body: otherAssetMutationResponse };
        },
      },
    });
    const { user } = renderApp('/other-assets');
    const table = await screen.findByRole('table', { name: 'Sales: 1 sale' });
    await user.click(within(table).getByRole('button', { name: /^Delete the sale of/ }));
    await user.click(within(table).getByRole('button', { name: /^Delete the sale of/ }));
    await waitFor(() => expect(screen.queryByRole('table', { name: /^Sales:/ })).toBeNull());
    await sleep(400);
    expect(screen.getByRole('note', { name: 'Saved' })).toHaveTextContent('Sale deleted.');
  });

  it('phone: the sales table is status-first', async () => {
    emulatePhone();
    await openPage();
    expect(headers(tableNamed('Sales: 2 sales'))).toEqual([
      'Date',
      'Item',
      'Realised gain',
      'Proceeds',
      'Units',
      'Cost',
      'Note',
      'Actions',
    ]);
  });
});

describe('Other Assets page: price history (UX-18)', () => {
  it('defaults to the item with the most entries; the row action moves focus and announces', async () => {
    const { user } = await openPage();
    const card = screen.getByRole('region', { name: 'Price history' });
    expect(within(card).getByRole('combobox', { name: 'Item' })).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Price history of Example print' }));
    expect(within(card).getByRole('combobox', { name: 'Item' })).toHaveValue('3');
    expect(within(card).getByRole('heading', { name: 'Price history' })).toHaveFocus();
    // A read-only action: announced in the hidden "Page updates" region, not a "Saved" callout.
    const updates = screen.getByRole('status', { name: 'Page updates' });
    expect(updates).toHaveTextContent('Showing Example print price history');
    expect(updates).toHaveClass('jf-visually-hidden');
    expect(screen.queryByRole('note', { name: 'Saved' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Save result' })).toBeEmptyDOMElement();
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Price history: Example print' });
    expect(headers(table)).toEqual(['As of', 'Price', 'Note', 'Source', 'Actions']);
    expect(cell(table, bodyRows(table)[0] as HTMLElement, 'Price')).toBe('450.00 USD');
  });

  it('bullion: the spot history × oz per unit, with its note', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Price history of Silver bar' }));
    const card = screen.getByRole('region', { name: 'Price history' });
    expect(card).toHaveTextContent('Priced from the silver spot price (AUD per ounce) × 1 oz');
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    expect(
      bodyRows(within(card).getByRole('table', { name: 'Price history: Silver bar' })),
    ).toHaveLength(3);
  });
});

describe('Other Assets page: charts (§5)', () => {
  it('Cost and value: Value slot 1, Cost slot 2; the live point and the foot notes', async () => {
    await openPage();
    const card = screen.getByRole('region', { name: 'Cost and value' });
    expect(legendOf(card)).toEqual([
      { name: 'Value', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Cost', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    expect(card).toHaveTextContent(
      'Cost counts items from their purchase date; undated items from the first recorded month (assumed).',
    );
    expect(card).toHaveTextContent("The last point is live: it uses today's prices and balances.");
  });

  it('the tables label the live point', async () => {
    const { user } = await openPage();
    const card = screen.getByRole('region', { name: 'Gain' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Other assets: gain' });
    expect(bodyRows(table).at(-1)).toHaveTextContent('Sep 2026 (live)');
  });
});

describe('Other Assets page: settings (§6.3 item 6)', () => {
  it('the stale-price days: an app-only key, import-safe', async () => {
    const { user } = await openPage();
    const section = screen.getByRole('heading', { level: 2, name: 'Settings for this page' });
    expect(section).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit settings for this page' }));
    const form = screen.getByRole('form', { name: 'Edit settings for this page' });
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
  });
});
