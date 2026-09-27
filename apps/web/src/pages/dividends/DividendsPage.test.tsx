import type { DividendEventsRefreshResponse, DividendsPageResponse } from '@joinr/schema';
import { apiErrors, dividendMutationResponse, dividendsPages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyRows, centsOf, columnTexts, mockCashflow, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf, totalRow } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

async function openDividends(
  fixture: DividendsPageResponse = dividendsPages.populated,
  routes = {},
  path = '/dividends',
) {
  const api = mockCashflow({ dividends: fixture, routes });
  const view = renderApp(path);
  await screen.findByRole('group', { name: 'This FY' });
  return { ...view, api };
}

const tile = (name: string): HTMLElement => screen.getByRole('group', { name });

const refreshResult = (
  summary: Partial<DividendEventsRefreshResponse['summary']> = {},
  lastError: string | null = null,
): DividendEventsRefreshResponse => ({
  summary: {
    jobRunId: 1,
    requested: 4,
    ok: 4,
    failed: 0,
    skipped: 0,
    events: 5,
    durationMs: 900,
    ...summary,
  },
  events: { ...dividendsPages.suggestions.events, lastError },
});

beforeEach(() => {
  // Only the clock: the freshness words depend on "now" (React Query and user-event keep real timers).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Dividends page: states', () => {
  it.each(Object.entries(dividendsPages))('renders the %s fixture', async (_name, fixture) => {
    mockCashflow({ dividends: fixture });
    renderApp('/dividends');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dividends' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'This FY' })).toBeVisible();
  });

  it('loading and error', async () => {
    mockCashflow({ dividends: pending });
    renderApp('/dividends');
    expect(await screen.findByText('Loading dividends…')).toBeVisible();
  });

  it('a failed load', async () => {
    mockCashflow({ dividends: apiError(500, apiErrors.internal) });
    renderApp('/dividends');
    expect(await screen.findByRole('note', { name: 'Could not load the dividends' })).toBeVisible();
  });

  it('empty: no dividends yet, nothing to add a dividend to', async () => {
    await openDividends(dividendsPages.empty);
    expect(tableNamed('Dividends: 0 payments')).toHaveTextContent('No dividends yet.');
    // STYLE-13 (stage-6.md §6.9 C): visible but disabled, with the reason and the pages beside it.
    const add = screen.getByRole('button', { name: 'Add dividend' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(
      'Add a holding on the ETFs, Stocks or Managed Funds page first; each dividend belongs to a holding.',
    );
    const reason = document.getElementById(add.getAttribute('aria-describedby')!)!;
    expect(within(reason).getByRole('link', { name: 'ETFs' })).toHaveAttribute('href', '/etfs');
    expect(within(reason).getByRole('link', { name: 'Stocks' })).toHaveAttribute('href', '/stocks');
    expect(within(reason).getByRole('link', { name: 'Managed Funds' })).toHaveAttribute(
      'href',
      '/managed-funds',
    );
    expect(tableNamed('This FY by holding')).toHaveTextContent('No dividends this FY yet.');
  });
});

describe('Dividends page: header and tiles (§6.6 items 1–2)', () => {
  it('This FY is the only teal figure; projected, 12 months, last FY, all time, reinvested', async () => {
    const { container } = await openDividends();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('This FY')).toHaveClass('jf-stat-tile--key');
    expect(tile('This FY')).toHaveTextContent('$378');
    expect(tile('Projected this FY')).toHaveTextContent('$1,603');
    expect(tile('Projected this FY')).toHaveTextContent('From 86 days of the FY');
    expect(tile('Last 12 months')).toHaveTextContent('$673');
    expect(tile('Last FY')).toHaveTextContent('$340');
    expect(tile('All time')).toHaveTextContent('$938');
    expect(tile('Reinvested this FY')).toHaveTextContent('$195');
  });

  it('never checked: the button and the freshness line; no suggestions section yet', async () => {
    await openDividends();
    expect(screen.getByRole('button', { name: 'Check Yahoo' })).toBeEnabled();
    expect(screen.getByTestId('events-freshness')).toHaveTextContent('Yahoo not checked yet');
    expect(screen.queryByRole('heading', { name: 'Suggestions from Yahoo' })).toBeNull();
  });

  it('market data off: the button is hidden and a note says why', async () => {
    await openDividends(dividendsPages.marketOff);
    expect(screen.queryByRole('button', { name: 'Check Yahoo' })).toBeNull();
    expect(screen.getByRole('note', { name: 'Suggestions off' })).toHaveTextContent(
      'Yahoo suggestions are off (market data is switched off).',
    );
    expect(screen.queryByRole('heading', { name: 'Suggestions from Yahoo' })).toBeNull();
  });

  it('fake mode: a Test data pill beside the button', async () => {
    await openDividends(dividendsPages.fakeMode);
    expect(screen.getByText('Test data')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Suggestions from Yahoo' })).toBeVisible();
  });

  it('the freshness line with the holdings covered; stale after a week', async () => {
    await openDividends(dividendsPages.suggestions);
    expect(screen.getByTestId('events-freshness').textContent).toMatch(
      /^Yahoo checked (\d{2}:\d{2}|\d{2}\/\d{2}\/2026) · 4 holdings$/,
    );
  });

  it('events older than 7 days', async () => {
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    await openDividends(dividendsPages.suggestions);
    expect(screen.getByTestId('events-freshness').textContent).toMatch(
      /^Yahoo last checked 1[67] days ago$/,
    );
  });

  it('a check: "Checking…", then the summary', async () => {
    let answer: (value: { body: DividendEventsRefreshResponse }) => void = () => undefined;
    const { user } = await openDividends(dividendsPages.populated, {
      'POST /api/dividends/suggestions/refresh': () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await user.click(screen.getByRole('button', { name: 'Check Yahoo' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    answer({ body: refreshResult() });
    const result = await screen.findByRole('note', { name: 'Yahoo checked' });
    expect(result).toHaveTextContent('Checked 4 holdings: 0 suggestions.');
  });

  it('a partial check shows the error; a refused check shows the message', async () => {
    const { user } = await openDividends(dividendsPages.populated, {
      'POST /api/dividends/suggestions/refresh': {
        body: refreshResult({ ok: 2, failed: 1, skipped: 1 }, 'Yahoo rate limit reached'),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Check Yahoo' }));
    expect(await screen.findByRole('note', { name: 'Check incomplete' })).toHaveTextContent(
      'Yahoo rate limit reached',
    );
  });

  it('a partial check without an error text shows the counts', async () => {
    const { user } = await openDividends(dividendsPages.populated, {
      'POST /api/dividends/suggestions/refresh': { body: refreshResult({ failed: 1, skipped: 2 }) },
    });
    await user.click(screen.getByRole('button', { name: 'Check Yahoo' }));
    expect(await screen.findByRole('note', { name: 'Check incomplete' })).toHaveTextContent(
      '1 holding failed; 2 skipped.',
    );
  });

  it('a refused check', async () => {
    const { user } = await openDividends(dividendsPages.populated, {
      'POST /api/dividends/suggestions/refresh': apiError(503, apiErrors.marketDataDisabled),
    });
    await user.click(screen.getByRole('button', { name: 'Check Yahoo' }));
    expect(await screen.findByRole('note', { name: 'Check failed' })).toHaveTextContent(
      'Market data is switched off',
    );
  });

  it('the last check failed (on load)', async () => {
    await openDividends(dividendsPages.checkFailed);
    expect(screen.getByRole('note', { name: 'Last check had a problem' })).toHaveTextContent(
      'Yahoo rate limit reached; the check stopped early',
    );
  });
});

describe('Dividends page: suggestions (§6.6 item 3, D50)', () => {
  it('Due rows offer Confirm and Dismiss; Upcoming rows the expected date and Dismiss only', async () => {
    await openDividends(dividendsPages.suggestions);
    const table = tableNamed('Suggestions from Yahoo: 2 suggestions');
    expect(headers(table)).toEqual([
      'Holding',
      'Ex-date',
      'Units then',
      'Per unit',
      'Estimated amount',
      'Expected paid',
      'Status',
      'Actions',
    ]);
    const due = rowOf(table, 'ASX:XYZ');
    expect(within(due).getByText('Due')).toBeVisible();
    expect(
      within(due)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Confirm', 'Dismiss']);
    const upcoming = rowOf(table, 'ASX:DEF');
    expect(cell(table, upcoming, 'Status')).toBe('Upcoming');
    expect(cell(table, upcoming, 'Expected paid')).toBe('Expected about 03/10/2026');
    expect(
      within(upcoming)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Dismiss']);
    expect(screen.getByRole('note', { name: 'About suggestions' })).toHaveTextContent(
      'Suggestions cover ASX listings in AUD. Amounts are before any withholding; franking is not tracked.',
    );
  });

  it('Confirm opens the pre-filled form under its row, the price left empty; POST without priceAtEx', async () => {
    const { user, api } = await openDividends(dividendsPages.suggestions, {
      'POST /api/dividends': { status: 201, body: dividendMutationResponse },
    });
    await user.click(
      screen.getByRole('button', { name: 'Confirm the suggestion ASX:XYZ ex-date 01/09/2026' }),
    );
    const form = screen.getByRole('form', { name: 'Confirm · ASX:XYZ ex-date 01/09/2026' });
    // Inline under the table part that ends with its row.
    const table = tableNamed('Suggestions from Yahoo: 2 suggestions');
    expect(table.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(form).getByRole('combobox', { name: /Holding/ })).toHaveValue('3');
    expect(within(form).getByRole('combobox', { name: 'Reinvested' })).toHaveValue('yes');
    expect(within(form).getByRole('textbox', { name: 'Ex-date' })).toHaveValue('01/09/2026');
    expect(within(form).getByRole('textbox', { name: /Payment date/ })).toHaveValue('16/09/2026');
    expect(within(form).getByRole('textbox', { name: 'Price at ex-date' })).toHaveValue('');
    expect(form).toHaveTextContent(
      'Yahoo close before the ex-date: $105.20; left blank, it is filled from Yahoo',
    );
    expect(within(form).getByRole('note', { name: 'Estimate' })).toHaveTextContent(
      'Estimated from Yahoo; enter the amount that reached your account.',
    );
    await user.click(within(form).getByRole('button', { name: 'Add dividend' }));
    await waitFor(() => expect(api.calls('POST /api/dividends')).toHaveLength(1));
    expect(api.calls('POST /api/dividends')[0]?.body).toEqual({
      instrumentId: 3,
      paymentDate: '2026-09-16',
      exDate: '2026-09-01',
      reinvested: true,
      netAmountCents: 4725,
      note: null,
    });
  });

  it('dismiss and restore (dismissed ones sit in a closed disclosure)', async () => {
    const { user, api } = await openDividends(dividendsPages.suggestions, {
      'POST /api/dividends/suggestions/dismiss': {
        body: { instrumentId: 4, exDate: '2026-09-18' },
      },
      'POST /api/dividends/suggestions/restore': {
        body: { instrumentId: 1, exDate: '2026-03-02' },
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Dismiss the suggestion ASX:DEF ex-date 18/09/2026' }),
    );
    await waitFor(() =>
      expect(api.calls('POST /api/dividends/suggestions/dismiss')).toHaveLength(1),
    );
    expect(api.calls('POST /api/dividends/suggestions/dismiss')[0]?.body).toEqual({
      instrumentId: 4,
      exDate: '2026-09-18',
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
      'Suggestion dismissed.',
    );
    const summary = screen.getByText('Dismissed (1)');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    await user.click(summary);
    await user.click(
      screen.getByRole('button', { name: 'Restore the suggestion ASX:ABC ex-date 02/03/2026' }),
    );
    await waitFor(() =>
      expect(api.calls('POST /api/dividends/suggestions/restore')).toHaveLength(1),
    );
    expect(api.calls('POST /api/dividends/suggestions/restore')[0]?.body).toEqual({
      instrumentId: 1,
      exDate: '2026-03-02',
    });
  });

  it('none found after a check', async () => {
    await openDividends(dividendsPages.checkedNoneFound);
    expect(screen.getByTestId('suggestions-none').textContent).toMatch(
      /^No missing dividends found \(checked \d{2}\/\d{2}\/2026 \d{2}:\d{2}\)\.$/,
    );
    expect(screen.getByText('Dismissed (1)')).toBeVisible();
  });

  it('after a failed or partial check, "none found" does not claim every holding was checked', async () => {
    await openDividends(dividendsPages.checkFailed);
    expect(screen.getByTestId('suggestions-none')).toHaveTextContent(
      'No suggestions yet: the last check stopped early, so some holdings were not checked. Try again later.',
    );
  });

  it('confirming the last due suggestion closes the form and announces it; a restore brings no stale form back', async () => {
    // As the real server: the refetch no longer lists the confirmed suggestion, so the list empties
    // before the save settles (in a browser the form could unmount mid-save, CODE-1).
    const due = dividendsPages.suggestions.suggestions.filter((s) => s.status !== 'upcoming');
    const start: DividendsPageResponse = { ...dividendsPages.suggestions, suggestions: due };
    const confirmed: DividendsPageResponse = {
      ...start,
      suggestions: due.filter((s) => s.status === 'dismissed'),
    };
    let saved = false;
    const { user, api } = await openDividends(start, {
      'GET /api/dividends': () => ({ body: saved ? confirmed : start }),
      'POST /api/dividends': () => {
        saved = true;
        return { status: 201, body: dividendMutationResponse };
      },
      'POST /api/dividends/suggestions/restore': {
        body: { instrumentId: 1, exDate: '2026-03-02' },
      },
    });
    await user.click(
      screen.getByRole('button', { name: 'Confirm the suggestion ASX:XYZ ex-date 01/09/2026' }),
    );
    const form = screen.getByRole('form', { name: 'Confirm · ASX:XYZ ex-date 01/09/2026' });
    await user.click(within(form).getByRole('button', { name: 'Add dividend' }));
    await waitFor(() => expect(api.calls('POST /api/dividends')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save result' })).toHaveTextContent(
        'Dividend added',
      ),
    );
    expect(screen.queryByRole('form', { name: /^Confirm · / })).toBeNull();
    for (const edit of screen.getAllByRole('button', { name: /^Edit the dividend of / })) {
      expect(edit).toBeEnabled();
    }
    await user.click(screen.getByText('Dismissed (1)'));
    await user.click(
      screen.getByRole('button', { name: 'Restore the suggestion ASX:ABC ex-date 02/03/2026' }),
    );
    await waitFor(() =>
      expect(api.calls('POST /api/dividends/suggestions/restore')).toHaveLength(1),
    );
    expect(screen.queryByRole('form', { name: /^Confirm · / })).toBeNull();
  });

  it('phone: holding, status, estimate first (§6.9)', async () => {
    emulatePhone();
    await openDividends(dividendsPages.suggestions);
    expect(headers(tableNamed('Suggestions from Yahoo: 2 suggestions'))).toEqual([
      'Holding',
      'Status',
      'Estimated amount',
      'Expected paid',
      'Ex-date',
      'Actions',
      'Units then',
      'Per unit',
    ]);
  });
});

describe('Dividends page: ledger and form (§6.6 items 4–5)', () => {
  it('newest first; unlinked rows show the ticker and "Not linked"; typed vs Yahoo prices', async () => {
    await openDividends();
    const table = tableNamed('Dividends: 14 payments');
    expect(columnTexts(table, 'Paid')[0]).toBe('18/09/2026');
    const unlinked = rowOf(table, '15/08/2026');
    expect(within(unlinked).getByText('Not linked')).toBeVisible();
    expect(cell(table, rowOf(table, '16/07/2026'), 'Price at ex-date')).toMatch(/Typed|Yahoo/);
    // A dividend is a flow: never red.
    expect(table.querySelector('.jf-amount--negative')).toBeNull();
  });

  it('the price source: typed, the workbook (an import row) or Yahoo (an app row); one-decimal yields', async () => {
    const appRow = dividendsPages.populated.dividends.find((d) => d.id === 11);
    if (!appRow || appRow.origin !== 'app') throw new Error('fixture: no app row 11');
    const fixture: DividendsPageResponse = {
      ...dividendsPages.populated,
      dividends: [
        ...dividendsPages.populated.dividends.filter((d) => d.id !== 11),
        // An app row whose price was filled from Yahoo (not typed).
        { ...appRow, priceAtExManual: false, paymentDate: '2026-07-17' },
        // The same row, typed.
        { ...appRow, id: 99, priceAtExManual: true, paymentDate: '2026-07-18' },
      ].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id),
    };
    await openDividends(fixture);
    const table = tableNamed(/^Dividends: \d+ payments$/);
    const price = (paid: string): string => cell(table, rowOf(table, paid), 'Price at ex-date');
    // The import row with a formula price (priceAtExManual false) came from the workbook.
    expect(price('16/07/2026')).toMatch(/Workbook$/);
    expect(price('17/07/2026')).toMatch(/Yahoo$/);
    expect(price('18/07/2026')).toMatch(/Typed$/);
    // Yields use the one-decimal percentage (STYLE_GUIDE §8), as on the holding page.
    expect(cell(table, rowOf(table, '16/07/2026'), 'Yield')).toBe('1.2%');
    const byHolding = tableNamed('This FY by holding');
    expect(cell(byHolding, rowOf(byHolding, 'ASX:DEF'), 'Yield (12 months, annualised)')).toBe(
      '1.0%',
    );
  });

  it('?holding= preselects the holding filter; kind and FY filters', async () => {
    const { user } = await openDividends(dividendsPages.populated, {}, '/dividends?holding=4');
    expect(screen.getByRole('combobox', { name: 'Holding' })).toHaveValue('4');
    const table = tableNamed('Dividends: 4 payments');
    expect(columnTexts(table, 'Holding').every((t) => t.startsWith('ASX:DEF'))).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Holding' }), 'all');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'crypto');
    expect(bodyRows(tableNamed('Dividends: 1 payment'))).toHaveLength(1);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'all');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Financial year' }), '2024');
    expect(bodyRows(tableNamed('Dividends: 2 payments'))).toHaveLength(2);
  });

  it('?holding= scrolls the ledger into view once and focuses its Holding filter', async () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scroll,
    });
    try {
      await openDividends(dividendsPages.populated, {}, '/dividends?holding=4');
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Holding' })).toHaveFocus());
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(
        screen.getByRole('heading', { name: 'Ledger' }).closest('section'),
      );
      expect(screen.getByTestId('ledger-filter-line')).toHaveTextContent(
        'Showing ASX:DEF in the ledger below',
      );
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('without ?holding= the page neither scrolls nor shows the filter line', async () => {
    await openDividends();
    expect(screen.queryByTestId('ledger-filter-line')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Holding' })).not.toHaveFocus();
  });

  it('add: holdings labelled by kind, ex-date after payment refused, API errors mapped', async () => {
    const { user, api } = await openDividends(dividendsPages.populated, {
      'POST /api/dividends': apiError(400, apiErrors.dividendValidation),
    });
    await user.click(screen.getByRole('button', { name: 'Add dividend' }));
    const form = screen.getByRole('form', { name: 'Add dividend' });
    const holding = within(form).getByRole('combobox', { name: /Holding/ });
    expect(
      within(holding)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Choose a holding',
      'Stock · ASX:ABC',
      'ETF · ASX:DEF',
      'ETF · ASX:XYZ',
      'Managed fund · EXAMPLEFUND',
      'Crypto · ETH',
    ]);
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    await user.selectOptions(holding, '4');
    const payment = within(form).getByRole('textbox', { name: /Payment date/ });
    await user.clear(payment);
    await user.type(payment, '01/09/2026');
    await user.type(within(form).getByRole('textbox', { name: 'Ex-date' }), '05/09/2026');
    await user.type(within(form).getByRole('textbox', { name: /Net amount/ }), '120');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('The ex-date is on or before the payment date.')).toBeVisible();
    expect(api.calls('POST /api/dividends')).toHaveLength(0);
    const ex = within(form).getByRole('textbox', { name: 'Ex-date' });
    await user.clear(ex);
    await user.type(ex, '20/08/2026');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('After the payment date.')).toBeVisible();
    expect(within(form).getByText('Must not be zero.')).toBeVisible();
  });

  it('a new dividend on a filtered ledger starts with that holding', async () => {
    const { user } = await openDividends(dividendsPages.populated, {}, '/dividends?holding=3');
    await user.click(screen.getByRole('button', { name: 'Add dividend' }));
    expect(
      within(screen.getByRole('form', { name: 'Add dividend' })).getByRole('combobox', {
        name: /Holding/,
      }),
    ).toHaveValue('3');
  });

  it('edit: a typed price is kept, a Yahoo price stays blank; an unlinked row asks for a holding', async () => {
    const { user } = await openDividends();
    await user.click(
      screen.getByRole('button', { name: 'Edit the dividend of 16/07/2026 (ASX:DEF)' }),
    );
    let form = screen.getByRole('form', { name: /^Edit dividend · ASX:DEF/ });
    expect(within(form).getByRole('textbox', { name: 'Price at ex-date' })).not.toHaveValue('');
    // An app row: no workbook callout.
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(
      screen.getByRole('button', { name: 'Edit the dividend of 16/07/2026 (ASX:XYZ)' }),
    );
    form = screen.getByRole('form', { name: /^Edit dividend · ASX:XYZ/ });
    expect(within(form).getByRole('textbox', { name: 'Price at ex-date' })).toHaveValue('');
    // An import row's price that was not typed came from the workbook, not Yahoo.
    expect(form).toHaveTextContent('From the workbook: $104.00');
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit the dividend of 15/08/2026 (ZZZ)' }));
    form = screen.getByRole('form', { name: /^Edit dividend · ZZZ/ });
    expect(within(form).getByRole('combobox', { name: /Holding/ })).toHaveValue('');
    expect(form).toHaveTextContent('Not linked: typed as “ZZZ”');
  });

  it('delete confirms in the row', async () => {
    const { user, api } = await openDividends(dividendsPages.populated, {
      'DELETE /api/dividends/13': { body: { id: 13 } },
    });
    const label = 'the dividend of 18/09/2026 (ASX:ABC)';
    await user.click(screen.getByRole('button', { name: `Delete ${label}` }));
    await user.click(
      within(screen.getByRole('group', { name: `Delete ${label}?` })).getByRole('button', {
        name: `Delete ${label}`,
      }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/dividends/13')).toHaveLength(1));
  });

  it('phone: paid, holding, net first (§6.9)', async () => {
    emulatePhone();
    await openDividends();
    expect(headers(tableNamed('Dividends: 14 payments'))).toEqual([
      'Paid',
      'Holding',
      'Net',
      'Reinvested',
      'Kind',
      'Ex-date',
      'Yield',
      'Units then',
      'Price at ex-date',
      'Source',
      'Actions',
    ]);
  });
});

describe('Dividends page: summaries (§6.6 items 6–8)', () => {
  it('by financial year: five FYs to this one plus older ones with payments; the all-time row', async () => {
    const { user } = await openDividends();
    const card = screen.getByRole('region', { name: 'Per financial year by kind' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Dividends by financial year' });
    expect(headers(table)).toEqual([
      'FY',
      'ETFs',
      'Stocks',
      'Managed funds',
      'Crypto staking',
      'Total',
    ]);
    expect(columnTexts(table, 'FY')).toEqual([
      'FY2026–27',
      'FY2025–26',
      'FY2024–25',
      'FY2023–24',
      'FY2022–23',
      'FY2020–21',
    ]);
    const total = totalRow(table);
    expect(total).toHaveTextContent('All time');
    expect(centsOf(cell(table, total, 'Total'))).toBe(93750);
    expect(total.querySelector('.jf-table__key')).toBeNull();
  });

  it('last 12 months', async () => {
    const { user } = await openDividends();
    const card = screen.getByRole('region', { name: 'Per month by kind' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Dividends over the last 12 months' });
    expect(bodyRows(table)).toHaveLength(12);
    expect(columnTexts(table, 'Month')[0]).toBe('Oct 2025');
    expect(centsOf(cell(table, totalRow(table), 'Total'))).toBe(67250);
  });

  it('this FY by holding: advice as badges with words; the unlinked line and the 6-month note', async () => {
    await openDividends();
    const table = tableNamed('This FY by holding');
    expect(cell(table, rowOf(table, 'ASX:ABC'), 'Advice')).toBe('Switch DRP on');
    expect(cell(table, rowOf(table, 'ASX:XYZ'), 'Advice')).toBe('Switch DRP off');
    expect(cell(table, rowOf(table, 'ASX:DEF'), 'Advice')).toBe('Keep');
    expect(cell(table, rowOf(table, 'ETH'), 'Advice')).toBe('—');
    expect(rowOf(table, 'ASX:ABC').querySelector('[data-status="check"]')).not.toBeNull();
    expect(rowOf(table, 'ASX:DEF').querySelector('[data-status="go"]')).not.toBeNull();
    expect(cell(table, rowOf(table, 'ASX:DEF'), 'Frequency')).toBe('Every 3 months');
    expect(screen.getByTestId('unlinked-this-fy')).toHaveTextContent(
      'Not linked to a holding this FY: $50.00',
    );
    expect(screen.getByRole('note', { name: 'DRP advice' })).toHaveTextContent('6 months');
  });

  it('phone: holding, advice first (§6.9)', async () => {
    emulatePhone();
    const { user } = await openDividends();
    expect(headers(tableNamed('This FY by holding'))).toEqual([
      'Holding',
      'Advice',
      'Net this FY',
      'Payments',
      'Months to +1 unit',
      'Yield (12 months, annualised)',
      'Frequency',
      'DRP',
    ]);
    const card = screen.getByRole('region', { name: 'Per financial year by kind' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    expect(
      headers(within(card).getByRole('table', { name: 'Dividends by financial year' })),
    ).toEqual(['FY', 'Total', 'ETFs', 'Stocks', 'Managed funds', 'Crypto staking']);
  });
});
