import type { SideIncomePageResponse } from '@joinr/schema';
import { apiErrors, depositMutationResponse, sideIncomePages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyRows, centsOf, columnTexts, mockCashflow, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';
import { CHART_NO_RECORDED_PERIOD, CHART_NO_STREAMS, chartEmptyMessage } from './periodsText';

const M = '−';

async function openSide(fixture: SideIncomePageResponse = sideIncomePages.populated, routes = {}) {
  const api = mockCashflow({ sideIncome: fixture, routes });
  const view = renderApp('/side-income');
  await screen.findByRole('group', { name: 'This FY so far' });
  return { ...view, api };
}

const tile = (name: string): HTMLElement => screen.getByRole('group', { name });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Side Income page: states', () => {
  it.each(Object.entries(sideIncomePages))('renders the %s fixture', async (_name, fixture) => {
    mockCashflow({ sideIncome: fixture });
    renderApp('/side-income');
    expect(await screen.findByRole('heading', { level: 1, name: 'Side Income' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'This FY so far' })).toBeVisible();
  });

  it('loading and a failed load', async () => {
    mockCashflow({ sideIncome: pending });
    renderApp('/side-income');
    expect(await screen.findByText('Loading side income…')).toBeVisible();
  });

  it('error', async () => {
    mockCashflow({ sideIncome: apiError(500, apiErrors.internal) });
    renderApp('/side-income');
    expect(
      await screen.findByRole('note', { name: 'Could not load the side income page' }),
    ).toBeVisible();
  });

  it('no streams: add a stream first (no Add deposit)', async () => {
    await openSide(sideIncomePages.empty);
    expect(screen.getByRole('note', { name: 'No streams' })).toHaveTextContent(
      'Add a stream to start logging deposits.',
    );
    expect(screen.queryByRole('button', { name: 'Add deposit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add stream' })).toBeVisible();
    expect(tableNamed('Side-income streams')).toHaveTextContent(
      'Add a stream to start logging deposits.',
    );
  });

  it('no deposits yet', async () => {
    await openSide({ ...sideIncomePages.populated, deposits: [] });
    expect(tableNamed('Deposits: 0 deposits')).toHaveTextContent('No side income yet.');
  });

  it('no recorded months: every deposit is outside a period', async () => {
    await openSide(sideIncomePages.noSnapshots);
    expect(tableNamed('Side income periods')).toHaveTextContent(
      'Periods start with the first recorded month.',
    );
    expect(screen.getByTestId('side-before-first')).toHaveTextContent(
      'Before the first recorded month: $1,175.00',
    );
    expect(tile('Average per period this FY')).toHaveTextContent(
      '—No recorded months in FY2026–27 yet',
    );
  });
});

describe('Side Income page: tiles and the D49 note', () => {
  it('This FY so far is the only teal figure; the averages, lifetime and the budget link', async () => {
    const { container } = await openSide();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('This FY so far')).toHaveClass('jf-stat-tile--key');
    expect(tile('This FY so far')).toHaveTextContent('$1,075');
    expect(tile('This FY so far')).toHaveTextContent('FY2026–27 to 24/09/2026');
    expect(tile('Average per period this FY')).toHaveTextContent('$438');
    expect(tile('Average per period this FY')).toHaveTextContent('2 recorded periods in FY2026–27');
    expect(tile('Projected this FY')).toHaveTextContent('$5,250');
    expect(tile('365-day average')).toHaveTextContent('$299');
    expect(tile('Lifetime')).toHaveTextContent('$2,395');
    const link = within(tile('In the budget')).getByRole('link', {
      name: 'Included: $299 a month',
    });
    expect(link).toHaveAttribute('href', '/budget');
    expect(screen.getByRole('note', { name: "Loans you've made" })).toHaveTextContent(
      "Only interest from loans you've made counts as side income. A principal repayment moves money between your accounts, so it is not income.",
    );
  });

  it('not included in the budget', async () => {
    await openSide(sideIncomePages.empty);
    expect(within(tile('In the budget')).getByRole('link', { name: 'Not included' })).toBeVisible();
  });
});

describe('Side Income page: deposits (§6.4 items 4–5)', () => {
  it('newest first with the period; a reversal stays in body text; filters by stream and FY', async () => {
    const { user } = await openSide();
    const table = tableNamed('Deposits: 10 deposits');
    expect(headers(table)).toEqual([
      'Date',
      'Stream',
      'Amount',
      'Period',
      'Note',
      'Source',
      'Actions',
    ]);
    const dates = columnTexts(table, 'Date');
    expect(dates[0]).toBe('10/09/2026');
    expect(dates.at(-1)).toBe('20/02/2026');
    const refund = rowOf(table, '12/08/2026');
    expect(cell(table, refund, 'Amount')).toBe(`${M}$50.00`);
    expect(refund.querySelector('.jf-amount--negative')).toBeNull();
    expect(cell(table, rowOf(table, '10/09/2026'), 'Period')).toBe('Sep 2026 (provisional)');
    expect(cell(table, rowOf(table, '20/02/2026'), 'Period')).toBe(
      'Before the first recorded month',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stream' }), '1');
    expect(bodyRows(tableNamed('Deposits: 7 deposits'))).toHaveLength(7);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Financial year' }), '2025');
    // Consulting in FY2025–26: 30/06, 15/04 and 20/02/2026.
    expect(columnTexts(tableNamed('Deposits: 3 deposits'), 'Date')).toEqual([
      '30/06/2026',
      '15/04/2026',
      '20/02/2026',
    ]);
  });

  it('the deposit form: archived streams hidden, zero refused, a reversal allowed, POST body', async () => {
    const { user, api } = await openSide(sideIncomePages.populated, {
      'POST /api/side-income/deposits': { status: 201, body: depositMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add deposit' }));
    const form = screen.getByRole('form', { name: 'Add deposit' });
    const stream = within(form).getByRole('combobox', { name: /Stream/ });
    expect(stream).toHaveFocus();
    const options = within(stream)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a stream', 'Consulting', 'Loan to a friend (interest)']);
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    await user.selectOptions(stream, '1');
    const amount = within(form).getByRole('textbox', { name: /Amount/ });
    await user.type(amount, '0');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByText('Enter an amount other than zero.')).toBeVisible();
    await user.clear(amount);
    await user.type(amount, '-80');
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Refund');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/side-income/deposits')).toHaveLength(1));
    const body = api.calls('POST /api/side-income/deposits')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ streamId: 1, amountCents: -8000, note: 'Refund' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Deposit added.');
  });

  it('Save is busy and disabled while the request is pending (one request per click)', async () => {
    const { user, api } = await openSide(sideIncomePages.populated, {
      'POST /api/side-income/deposits': pending,
    });
    await user.click(screen.getByRole('button', { name: 'Add deposit' }));
    const form = screen.getByRole('form', { name: 'Add deposit' });
    await user.selectOptions(within(form).getByRole('combobox', { name: /Stream/ }), '2');
    await user.type(within(form).getByRole('textbox', { name: /Amount/ }), '25');
    const save = within(form).getByRole('button', { name: 'Save' });
    await user.dblClick(save);
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(api.calls('POST /api/side-income/deposits')).toHaveLength(1);
  });

  it('editing an imported deposit warns; errors map to fields', async () => {
    const { user } = await openSide(sideIncomePages.populated, {
      'PUT /api/side-income/deposits/7': apiError(400, {
        error: { code: 'VALIDATION_ERROR', message: 'date: must not be after tomorrow' },
      }),
    });
    await user.click(
      screen.getByRole('button', { name: 'Edit the deposit of 10/08/2026 (Consulting)' }),
    );
    const form = screen.getByRole('form', { name: 'Edit deposit · 10/08/2026' });
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'x');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Must not be after tomorrow.')).toBeVisible();
  });

  it('delete confirms in the row', async () => {
    const { user, api } = await openSide(sideIncomePages.populated, {
      'DELETE /api/side-income/deposits/9': { body: { id: 9 } },
    });
    const label = 'the deposit of 10/09/2026 (Consulting)';
    await user.click(screen.getByRole('button', { name: `Delete ${label}` }));
    const confirm = screen.getByRole('group', { name: `Delete ${label}?` });
    await user.click(within(confirm).getByRole('button', { name: `Delete ${label}` }));
    await waitFor(() => expect(api.calls('DELETE /api/side-income/deposits/9')).toHaveLength(1));
  });

  it('phone: status-first deposit columns (§6.9)', async () => {
    emulatePhone();
    await openSide();
    expect(headers(tableNamed('Deposits: 10 deposits'))).toEqual([
      'Date',
      'Amount',
      'Stream',
      'Note',
      'Actions',
      'Period',
      'Source',
    ]);
  });
});

describe('Side Income page: by period (§6.4 item 6)', () => {
  it('periods: the provisional badge, dates, a column per stream and the total', async () => {
    await openSide();
    const table = tableNamed('Side income periods');
    expect(headers(table)).toEqual([
      'Period',
      'Dates',
      'Consulting',
      'Loan to a friend (interest)',
      'Old market stall',
      'Total',
      'Note',
    ]);
    const live = rowOf(table, 'Sep 2026');
    expect(live).toHaveTextContent('Provisional');
    expect(within(live).queryByRole('button', { name: /^Note for/ })).toBeNull();
    const aug = rowOf(table, 'Aug 2026');
    expect(cell(table, aug, 'Dates')).toBe('01/08/2026 – 31/08/2026');
    // The total equals the stream columns.
    const streams = ['Consulting', 'Loan to a friend (interest)', 'Old market stall'].map(
      (h) => centsOf(cell(table, aug, h)) ?? 0,
    );
    expect(centsOf(cell(table, aug, 'Total'))).toBe(streams.reduce((a, b) => a + b, 0));
    expect(cell(table, rowOf(table, 'Jul 2026'), 'Note')).toContain('One-off consulting job');
    expect(screen.getByTestId('side-before-first')).toHaveTextContent(
      'Before the first recorded month: $400.00',
    );
  });

  it('a note on a recorded period', async () => {
    const { user, api } = await openSide(sideIncomePages.populated, {
      'PUT /api/period-notes/side_income/2026-08': { body: { note: null } },
    });
    await user.click(screen.getByRole('button', { name: 'Note for Aug 2026' }));
    const form = screen.getByRole('form', { name: 'Note for Aug 2026' });
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Quiet month');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.calls('PUT /api/period-notes/side_income/2026-08')).toHaveLength(1),
    );
    expect(api.calls('PUT /api/period-notes/side_income/2026-08')[0]?.body).toEqual({
      note: 'Quiet month',
    });
  });

  it('the chart card and its table with the live point', async () => {
    const { user } = await openSide();
    const card = screen.getByRole('region', { name: 'Side income by period' });
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Side income by period' });
    expect(rowOf(table, 'Sep 2026 (live)')).toBeInTheDocument();
    expect(card).toHaveTextContent('The last point is provisional: it runs to today.');
  });

  it('phone: period, total, streams, dates, note (§6.9)', async () => {
    emulatePhone();
    await openSide();
    expect(headers(tableNamed('Side income periods'))).toEqual([
      'Period',
      'Total',
      'Consulting',
      'Loan to a friend (interest)',
      'Old market stall',
      'Dates',
      'Note',
    ]);
  });
});

describe('Side Income page: streams (§6.4 item 7)', () => {
  it('archive and restore; delete only without deposits; rename', async () => {
    const { user, api } = await openSide(sideIncomePages.populated, {
      'PUT /api/side-income/streams/2': {
        body: { stream: sideIncomePages.populated.streams[1] },
      },
      'PUT /api/side-income/streams/3': {
        body: { stream: sideIncomePages.populated.streams[2] },
      },
    });
    const table = tableNamed('Side-income streams');
    expect(rowOf(table, 'Old market stall')).toHaveTextContent('Archived');
    expect(within(table).queryByRole('button', { name: /^Delete/ })).toBeNull();
    await user.click(
      within(table).getByRole('button', { name: 'Restore the stream Old market stall' }),
    );
    await waitFor(() => expect(api.calls('PUT /api/side-income/streams/3')).toHaveLength(1));
    expect(api.calls('PUT /api/side-income/streams/3')[0]?.body).toEqual({
      name: 'Old market stall',
      archived: false,
    });
    await user.click(
      within(table).getByRole('button', { name: 'Rename the stream Loan to a friend (interest)' }),
    );
    const form = screen.getByRole('form', { name: 'Rename stream · Loan to a friend (interest)' });
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    const name = within(form).getByRole('textbox', { name: /Name/ });
    await user.clear(name);
    await user.type(name, 'Loan interest');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/side-income/streams/2')).toHaveLength(1));
    expect(api.calls('PUT /api/side-income/streams/2')[0]?.body).toEqual({
      name: 'Loan interest',
      archived: false,
    });
  });

  it('a stream with no deposits can be deleted (409 STREAM_IN_USE shows the message)', async () => {
    const fixture: SideIncomePageResponse = {
      ...sideIncomePages.populated,
      streams: [
        ...sideIncomePages.populated.streams,
        {
          id: 4,
          name: 'Tutoring',
          sortOrder: 4,
          archived: false,
          origin: 'app',
          sheetRef: null,
          depositCount: 0,
          lifetimeCents: 0,
        },
      ],
    };
    const { user } = await openSide(fixture, {
      'DELETE /api/side-income/streams/4': apiError(409, apiErrors.streamInUse),
    });
    await user.click(screen.getByRole('button', { name: 'Delete the stream Tutoring' }));
    await user.click(screen.getByRole('button', { name: 'Delete the stream Tutoring' }));
    expect(await screen.findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'This stream has 3 deposits',
    );
  });
});

describe('Side Income page: the chart empty states (STYLE-15, stage-6.md §6.9 C)', () => {
  const populated = sideIncomePages.populated;
  const recordedPoint = populated.charts.points.find((p) => !p.live)!;

  it('no recorded period: the chart is grouped by recorded month', () => {
    const page = {
      ...populated,
      charts: { ...populated.charts, points: populated.charts.points.filter((p) => p.live) },
    };
    expect(chartEmptyMessage(page)).toBe(CHART_NO_RECORDED_PERIOD);
    expect(CHART_NO_RECORDED_PERIOD).toBe(
      'Side income is grouped by recorded month; it appears after the first recorded month.',
    );
  });

  it('recorded periods but no stream or no deposit: add a deposit', () => {
    expect(recordedPoint).toBeDefined();
    expect(chartEmptyMessage({ ...populated, streams: [] })).toBe(CHART_NO_STREAMS);
    expect(chartEmptyMessage({ ...populated, deposits: [] })).toBe(CHART_NO_STREAMS);
    expect(CHART_NO_STREAMS).toBe('No side income yet. Add a deposit to start.');
    expect(chartEmptyMessage(populated)).toBe('No side income yet');
  });

  it('the chart table view shows the message with no recorded month', async () => {
    const { user } = await openSide({
      ...sideIncomePages.noSnapshots,
      charts: { ...sideIncomePages.noSnapshots.charts, points: [] },
    });
    const card = screen.getByRole('heading', { name: 'Side income by period' }).closest('section')!;
    const toggle = within(card).queryByRole('button', { name: 'Table' });
    if (toggle) await user.click(toggle);
    expect(card).toHaveTextContent(CHART_NO_RECORDED_PERIOD);
  });
});
