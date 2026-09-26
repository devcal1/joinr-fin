// The History page (stage-5.md §6.4, §6.8, §6.9, §7.7 step 3) against the @joinr/schema fixtures:
// every state renders; the lead; the status card (one teal figure, auto-record, the last run, the
// missing months and "Record them now"); the record form (the fieldset, defaults, the notes, the
// D34 note, the one pending text, the 409s, the hash target); the live row; the recorded months
// (markers, shared dates, delete only on the deletable row with its confirm); Details and Correct
// as cards after the table with focus moved and returned; the owed sign round trip; the read-only
// extras; the consistency panel; the audit trail; the chart and its view switch; phone orders.
import { NET_WORTH_CLASS_SLOTS, type HistoryPageResponse } from '@joinr/schema';
import {
  apiErrors,
  correctionResponse,
  deleteSnapshotResponse,
  historyPages,
  netWorthPages,
  recordResponse,
} from '@joinr/schema/fixtures';
import { CHART_PALETTE } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legendOf, rgbOf } from '../../../test/assets';
import { mockOverview } from '../../../test/history';
import { cell, headers, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending, type MockHandler } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const populated = historyPages.populated;

async function openPage(
  fixture: HistoryPageResponse = populated,
  routes: Record<string, MockHandler> = {},
  path = '/history',
) {
  const api = mockOverview({ history: fixture, routes });
  const view = renderApp(path);
  await screen.findByRole('group', { name: 'Latest recorded' });
  return { ...view, api };
}

function monthsTable(): HTMLElement {
  return screen.getByRole('table', { name: /^Recorded months/ });
}

function statusRow(label: string): HTMLElement {
  const table = screen.getByRole('table', { name: 'Recording status' });
  const th = within(table).getByRole('rowheader', { name: label });
  return th.closest('tr') as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('History: states (§6.9)', () => {
  it.each(Object.entries(historyPages))('renders the %s fixture', async (_name, fixture) => {
    mockOverview({ history: fixture });
    renderApp('/history');
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Latest recorded' })).toBeVisible();
    for (const title of [
      'Recorded months',
      'What you own over time',
      'Consistency check',
      'Audit trail',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    expect(screen.getByRole('main')).not.toHaveTextContent('Stage 5');
  });

  it('loading', async () => {
    mockOverview({ history: pending });
    renderApp('/history');
    expect(await screen.findByText('Loading history…')).toBeVisible();
  });

  it('no snapshots: the empty note', async () => {
    await openPage(historyPages.noSnapshots);
    expect(screen.getByRole('note', { name: 'No recorded months' })).toHaveTextContent(
      'No months recorded yet. Import the workbook for past months, or record this month.',
    );
  });
});

describe('History: lead and status card (§6.4 items 1–2)', () => {
  it('the lead says recording freezes a month and Correct does not recalculate', async () => {
    await openPage();
    expect(screen.getByTestId('history-lead')).toHaveTextContent(
      "Recording a month freezes its figures. Later edits to trades, balances or prices don't change a recorded month; to change one, use Correct (you type the figures, and every change is logged below). The live row is today's provisional position.",
    );
  });

  it('the latest recorded net worth is the one teal figure', async () => {
    const { container } = await openPage();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    const latest = screen.getByRole('group', { name: 'Latest recorded' });
    expect(latest).toHaveTextContent('$488,210');
    expect(latest).toHaveTextContent('Jul 2026 · recorded 03/08/2026');
  });

  it('auto-record on with the next run, and a link to change it', async () => {
    await openPage();
    const row = statusRow('Auto-record');
    expect(row).toHaveTextContent(/On · next 30\/09\/2026 at 23:00/);
    expect(within(row).getByRole('link', { name: 'Change in Settings' })).toHaveAttribute(
      'href',
      '/settings#history',
    );
  });

  it('auto-record off, or set by the server (no link then)', async () => {
    const { unmount } = await openPage(historyPages.autoRecordOff);
    expect(statusRow('Auto-record')).toHaveTextContent('Off');
    unmount();
    await openPage(historyPages.envLocked);
    const row = statusRow('Auto-record');
    expect(row).toHaveTextContent('On (set by the server)');
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('blocked (D94): the last run says what it waits for', async () => {
    await openPage(historyPages.autoRecordBlocked);
    expect(statusRow('Last automatic run')).toHaveTextContent('Waiting: Aug 2026 is not recorded');
  });

  it('blocked (D94): an Important callout asks to record it or skip; its button opens the form (STYLE-7)', async () => {
    const { user, api } = await openPage(historyPages.autoRecordBlocked);
    const callout = screen.getByTestId('history-blocked-callout');
    expect(callout).toHaveTextContent(
      'Auto-record is waiting: Aug 2026 is not recorded. Record it, or record Sep 2026 alone (Aug 2026 then becomes a gap).',
    );
    expect(callout).not.toHaveTextContent('on the History page');
    await user.click(screen.getByRole('button', { name: 'Record it now' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    expect(within(form).getByRole('checkbox', { name: 'Aug 2026' })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Sep 2026' })).not.toBeChecked();
    expect(api.calls('POST /api/history/record')).toHaveLength(0);
  });

  it('no blocked callout when auto-record is not waiting', async () => {
    await openPage();
    expect(screen.queryByTestId('history-blocked-callout')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record it now' })).toBeNull();
  });

  it('a record in progress: "Recording…" disabled, "Recording now"', async () => {
    await openPage(historyPages.recordInProgress);
    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    expect(statusRow('Last automatic run')).toHaveTextContent('Recording now');
  });

  it('nothing to record: the action is disabled and says why', async () => {
    await openPage(historyPages.nothingToRecord);
    const button = screen.getByRole('button', { name: 'Record month' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/is already recorded; the next month to record is/);
  });

  it('missing months: "Record them now" opens the form with them ticked and focuses it', async () => {
    const { user, api } = await openPage();
    expect(statusRow('Missing months')).toHaveTextContent('Aug 2026 is not recorded');
    await user.click(screen.getByRole('button', { name: 'Record them now' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    expect(within(form).getByRole('checkbox', { name: 'Aug 2026' })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Sep 2026' })).not.toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Aug 2026' })).toHaveFocus();
    // It never records by itself.
    expect(api.calls('POST /api/history/record')).toHaveLength(0);
  });
});

describe('History: the record form (§6.4 item 3)', () => {
  it('the fieldset, the default months and the notes the ticked months need', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Record month' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    expect(within(form).getByRole('group', { name: 'Months to record' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Record month' })).toHaveTextContent(
      "Recording freezes these figures; later edits won't change them.",
    );
    expect(within(form).getByRole('checkbox', { name: 'Aug 2026' })).toBeChecked();
    expect(form).toHaveTextContent(
      "Aug 2026 will be recorded with today's (24/09/2026) values and date, not its month-end figures.",
    );
    await user.click(within(form).getByRole('checkbox', { name: 'Sep 2026' }));
    expect(form).toHaveTextContent(
      'The months are recorded together; the later ones will show no change (recorded late).',
    );
    expect(form).toHaveTextContent(
      'Recording before the month ends closes Sep 2026 now; the rest of the month counts toward Oct 2026.',
    );
    await user.click(within(form).getByRole('checkbox', { name: 'Aug 2026' }));
    expect(form).toHaveTextContent('Leaving Aug 2026 out makes it a permanent gap.');
    // The preview admits the price refresh.
    expect(within(form).getByRole('table', { name: 'Preview' })).toHaveTextContent(
      'they are refreshed before recording, so the recorded figures can differ slightly',
    );
    // App data exists: no D34 note.
    expect(within(form).queryByTestId('record-app-data-note')).toBeNull();
  });

  it('the D34 note while there is no app data', async () => {
    const { user } = await openPage(historyPages.noSnapshots);
    await user.click(screen.getByRole('button', { name: 'Record month' }));
    expect(screen.getByTestId('record-app-data-note')).toHaveTextContent(
      'Recording a month adds app data: re-importing the workbook will then be blocked.',
    );
  });

  it('records the ticked months with one pending text, announces and closes', async () => {
    let release: () => void = () => undefined;
    const { user, api } = await openPage(populated, {
      'POST /api/history/record': () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 201, body: recordResponse });
        }),
    });
    await user.click(screen.getByRole('button', { name: 'Record month' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Month end');
    await user.click(within(form).getByRole('button', { name: 'Record' }));
    expect(
      await within(form).findByRole('button', { name: 'Refreshing prices and recording…' }),
    ).toBeDisabled();
    expect(api.calls('POST /api/history/record')[0]?.body).toEqual({
      periodMonths: ['2026-08'],
      note: 'Month end',
    });
    release();
    expect(await screen.findByRole('status', { name: 'History updates' })).toHaveTextContent(
      'Recorded Aug 2026',
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Record month' })).toBeNull());
  });

  it('still announces when a refetch unmounts the form before the record settles', async () => {
    // Integrator (Stage 5 e2e): recording the last recordable month empties `recordable` in a
    // refetch that can land before the mutation settles, which unmounts the form.
    let recorded = false;
    let release: () => void = () => undefined;
    const { user, queryClient } = await openPage(populated, {
      'GET /api/history': () => ({ body: recorded ? historyPages.nothingToRecord : populated }),
      'POST /api/history/record': () =>
        new Promise((resolve) => {
          recorded = true;
          release = () => resolve({ status: 201, body: recordResponse });
        }),
    });
    await user.click(screen.getByRole('button', { name: 'Record month' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    await user.click(within(form).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(recorded).toBe(true));
    await queryClient.invalidateQueries({ queryKey: ['history'] });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Record month' })).toBeNull());
    release();
    expect(await screen.findByRole('status', { name: 'History updates' })).toHaveTextContent(
      'Recorded Aug 2026',
    );
  });

  it.each([
    ['SNAPSHOT_EXISTS', apiErrors.snapshotExists],
    ['RECORD_IN_PROGRESS', apiErrors.recordInProgress],
  ])('a 409 %s shows as a "Do not" callout', async (_code, body) => {
    const { user } = await openPage(populated, {
      'POST /api/history/record': apiError(409, body),
    });
    await user.click(screen.getByRole('button', { name: 'Record month' }));
    const form = screen.getByRole('form', { name: 'Record month' });
    await user.click(within(form).getByRole('button', { name: 'Record' }));
    const callout = await within(form).findByRole('note', { name: 'Not saved' });
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(callout).toHaveTextContent(body.error.message);
  });

  it('/history#record opens the form after load and focuses its heading', async () => {
    await openPage(populated, {}, '/history#record');
    const form = await screen.findByRole('form', { name: 'Record month' });
    expect(form).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3, name: 'Record month' })).toHaveFocus(),
    );
  });
});

describe('History: the live row (§6.4 item 4)', () => {
  it('"Live (provisional)" with its figures and when it will be recorded', async () => {
    const { unmount } = await openPage();
    const live = screen.getByRole('region', { name: "Aug 2026: today's position" });
    expect(live).toHaveTextContent('Live (provisional)');
    expect(live).toHaveTextContent('$492,310.00');
    expect(within(live).getByTestId('live-row-note')).toHaveTextContent(
      /Not recorded yet: auto-record on 30\/09\/2026 at 23:00/,
    );
    unmount();
    await openPage(historyPages.autoRecordOff);
    expect(screen.getByTestId('live-row-note')).toHaveTextContent('Record it with Record month');
  });

  it('no provisional period: no live card', async () => {
    await openPage(historyPages.nothingToRecord);
    expect(screen.queryByTestId('live-row-note')).toBeNull();
  });
});

describe('History: recorded months (§6.4 item 5)', () => {
  it('newest first, the desktop columns and the source markers', async () => {
    await openPage();
    const table = monthsTable();
    expect(headers(table)).toEqual([
      'Month',
      'Recorded',
      'Source',
      'Net worth',
      'Liquid assets',
      'Cash',
      'Super',
      'Property equity',
      'Savings rate',
      'Actions',
    ]);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows[0]).toHaveTextContent('Jul 2026');
    expect(cell(table, rowOf(table, 'Jul 2026'), 'Source')).toBe('Recorded late');
    expect(cell(table, rowOf(table, 'Jun 2026'), 'Source')).toBe('RecordedCorrected1 correction');
    expect(cell(table, rowOf(table, 'Jan 2026'), 'Source')).toBe('ImportedCorrected1 correction');
    expect(cell(table, rowOf(table, 'Dec 2025'), 'Source')).toBe('Imported');
    expect(rowOf(table, 'May 2026')).toHaveTextContent('Recorded together with Apr 2026');
  });

  it('delete only on the deletable row, with its confirm', async () => {
    const { user, api } = await openPage(populated, {
      'DELETE /api/history/snapshots/2026-07': { body: deleteSnapshotResponse },
    });
    const table = monthsTable();
    expect(within(rowOf(table, 'Jun 2026')).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(within(rowOf(table, 'Mar 2026')).queryByRole('button', { name: /Delete/ })).toBeNull();
    await user.click(
      within(rowOf(table, 'Jul 2026')).getByRole('button', { name: 'Delete Jul 2026' }),
    );
    const confirm = within(rowOf(table, 'Jul 2026')).getByRole('group');
    expect(confirm).toHaveTextContent(
      'Delete Jul 2026? It becomes recordable again; the audit trail keeps a copy.',
    );
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete the recorded month Jul 2026' }),
    );
    await waitFor(() => expect(api.calls('DELETE /api/history/snapshots/2026-07')).toHaveLength(1));
    expect(await screen.findByRole('status', { name: 'History updates' })).toHaveTextContent(
      'Jul 2026 deleted',
    );
  });

  it('Details opens after the table, focuses its heading and returns focus on close', async () => {
    const { user } = await openPage();
    const table = monthsTable();
    const button = within(rowOf(table, 'Jun 2026')).getByRole('button', {
      name: 'Details of Jun 2026',
    });
    await user.click(button);
    const heading = screen.getByRole('heading', { level: 3, name: 'Jun 2026 details' });
    await waitFor(() => expect(heading).toHaveFocus());
    const details = heading.closest('section') as HTMLElement;
    // The card sits after the table.
    expect(table.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Owed figures are positive and never tinted.
    const property = within(details).getByRole('table', { name: 'Jun 2026: Property' });
    expect(property).toHaveTextContent('Mortgage owed$488,000.00');
    expect(property.querySelector('.jf-amount--negative')).toBeNull();
    expect(within(details).getByTestId('details-check')).toHaveTextContent(
      'Every stored figure reproduces',
    );
    expect(
      within(details).getByRole('list', { name: 'Jun 2026: audit entries' }),
    ).toHaveTextContent('Corrected · You');
    await user.click(within(details).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('Details of an imported month: the extras "Not recorded (imported month)"; a movement difference', async () => {
    const { user } = await openPage();
    await user.click(
      within(rowOf(monthsTable(), 'Feb 2026')).getByRole('button', { name: 'Details of Feb 2026' }),
    );
    const cash = screen.getByRole('table', { name: 'Feb 2026: Cash' });
    expect(cash).toHaveTextContent('Offset accounts—Not recorded (imported month)');
    const diffs = screen.getByRole('table', { name: 'Feb 2026: differences' });
    expect(headers(diffs)).toEqual(['Column', 'Stored', 'Recomputed', 'Why']);
    expect(diffs).toHaveTextContent('ETF movements$1,000.00$1,200.00');
  });

  it('Correct a recorded month: owed figures positive, sent negative; changed columns only', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/history/snapshots/2026-06': { body: correctionResponse },
    });
    await user.click(
      within(rowOf(monthsTable(), 'Jun 2026')).getByRole('button', { name: 'Correct Jun 2026' }),
    );
    const form = screen.getByRole('form', { name: 'Correct Jun 2026' });
    expect(within(form).getByRole('note', { name: 'Audit trail' })).toHaveTextContent(
      'Corrections are kept in the audit trail.',
    );
    // The group titles are sub-headings, not field labels (STYLE-9).
    const legends = [...form.querySelectorAll('legend')];
    expect(legends.map((l) => l.textContent)).toContain('Cash');
    for (const legend of legends) {
      expect(legend).toHaveClass('jf-app-fieldset__legend');
      expect(legend).not.toHaveClass('jf-field__label');
    }
    expect(screen.getByRole('region', { name: 'Correct Jun 2026' })).toHaveTextContent(
      'This replaces the stored figures; it does not recalculate from your current data.',
    );
    expect(form).toHaveTextContent(
      "Recalculated when you save: gain %, cash change, equity (and next month's cash change)",
    );
    const mortgage = within(form).getByRole('textbox', { name: 'Mortgage owed' });
    expect(mortgage).toHaveValue('488,000.00');
    await user.clear(mortgage);
    await user.type(mortgage, '487000');
    await user.tab();
    expect(form).toHaveTextContent('was $488,000.00');
    // The reason is required.
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('textbox', { name: 'Reason' })).toHaveAccessibleDescription(
      /Say why/,
    );
    expect(api.calls('PUT /api/history/snapshots/2026-06')).toHaveLength(0);
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Statement');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/history/snapshots/2026-06')).toHaveLength(1));
    expect(api.calls('PUT /api/history/snapshots/2026-06')[0]?.body).toEqual({
      values: { mortgageBalanceCents: -48_700_000 },
      note: 'Statement',
    });
    expect(await screen.findByRole('status', { name: 'History updates' })).toHaveTextContent(
      'Correction saved',
    );
  });

  it('a correction the server finds unchanged (audit id 0) says so', async () => {
    const { user } = await openPage(populated, {
      'PUT /api/history/snapshots/2026-06': {
        body: { ...correctionResponse, audit: { ...correctionResponse.audit, id: 0, changes: [] } },
      },
    });
    await user.click(
      within(rowOf(monthsTable(), 'Jun 2026')).getByRole('button', { name: 'Correct Jun 2026' }),
    );
    const form = screen.getByRole('form', { name: 'Correct Jun 2026' });
    const cash = within(form).getByRole('textbox', { name: 'Cash' });
    await user.clear(cash);
    await user.type(cash, '23200.01');
    await user.tab();
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Check');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status', { name: 'History updates' })).toHaveTextContent(
      'Nothing changed',
    );
  });

  it('Correct an imported month: the extras read-only and the workbook callout', async () => {
    const { user } = await openPage();
    await user.click(
      within(rowOf(monthsTable(), 'Mar 2026')).getByRole('button', { name: 'Correct Mar 2026' }),
    );
    const form = screen.getByRole('form', { name: 'Correct Mar 2026' });
    for (const column of ['offsetCents', 'mortgageOffsetCents', 'cashDebtCents']) {
      expect(within(form).getByTestId(`readonly-${column}`)).toHaveTextContent(
        'Not recorded (imported month)',
      );
    }
    expect(within(form).queryByRole('textbox', { name: 'Offset accounts' })).toBeNull();
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toHaveTextContent(
      'This came from the workbook. Saving a correction counts as an app edit: re-importing the workbook will then be blocked.',
    );
  });

  it('a server issue on an owed figure keeps the positive wording', async () => {
    const { user } = await openPage(populated, {
      'PUT /api/history/snapshots/2026-06': apiError(400, {
        error: { code: 'VALIDATION_ERROR', message: 'values.cashDebtCents: must not be positive' },
      }),
    });
    await user.click(
      within(rowOf(monthsTable(), 'Jun 2026')).getByRole('button', { name: 'Correct Jun 2026' }),
    );
    const form = screen.getByRole('form', { name: 'Correct Jun 2026' });
    const debit = within(form).getByRole('textbox', { name: 'Accounts in debit (owed)' });
    await user.clear(debit);
    await user.type(debit, '50');
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Fix');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Enter an amount of zero or more.')).toBeVisible();
  });

  it('phone: Month, Net worth, Source, Actions first; the markers only in Source (STYLE-4)', async () => {
    emulatePhone();
    await openPage();
    const table = monthsTable();
    expect(headers(table).slice(0, 4)).toEqual(['Month', 'Net worth', 'Source', 'Actions']);
    expect(headers(table)).toHaveLength(10);
    const row = rowOf(table, 'Jul 2026');
    const first = row.firstElementChild as HTMLElement;
    expect(first).not.toHaveTextContent('Recorded late');
    expect(cell(table, row, 'Source')).toContain('Recorded late');
    // The shared-run-date line stays under the month.
    expect(rowOf(table, 'May 2026').firstElementChild).toHaveTextContent(
      'Recorded together with Apr 2026',
    );
  });

  it('the deletable row pairs its actions: Details · Correct, then Delete (STYLE-1)', async () => {
    await openPage();
    const table = monthsTable();
    const actions = rowOf(table, 'Jul 2026').querySelector('.jf-app-row-actions--pairs');
    expect(actions).not.toBeNull();
    const pairs = [...(actions as HTMLElement).querySelectorAll('.jf-app-row-actions__pair')];
    expect(pairs).toHaveLength(2);
    expect(
      within(pairs[0] as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Details', 'Correct']);
    expect(
      within(pairs[1] as HTMLElement).getByRole('button', { name: 'Delete Jul 2026' }),
    ).toBeVisible();
    // A row that cannot be deleted has one pair.
    const jun = rowOf(table, 'Jun 2026').querySelectorAll('.jf-app-row-actions__pair');
    expect(jun).toHaveLength(1);
  });
});

describe('History: what you own over time (§5, §6.4 item 6)', () => {
  it('the stacked area uses the class colours; the view switch reads the series API', async () => {
    const { user, api } = await openPage(populated, {
      'GET /api/history/series': {
        body: {
          unit: 'quarterly',
          count: null,
          yearBasis: 'fy',
          groups: netWorthPages.quarterly.charts.groups,
          modes: {},
        },
      },
    });
    const chart = screen.getByRole('region', { name: 'What you own by month' });
    const legend = legendOf(chart);
    expect(legend[0]).toEqual({
      name: 'Stocks',
      color: rgbOf(CHART_PALETTE[NET_WORTH_CLASS_SLOTS.stock - 1] ?? ''),
    });
    expect(legend.find((l) => l.name === 'Property equity')?.color).toBe(
      rgbOf(CHART_PALETTE[NET_WORTH_CLASS_SLOTS.property - 1] ?? ''),
    );
    const section = screen.getByRole('heading', { level: 2, name: 'What you own over time' })
      .parentElement as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Quarterly' }));
    await waitFor(() => expect(api.calls('GET /api/history/series')).toHaveLength(1));
    expect(api.calls('GET /api/history/series')[0]?.query.get('unit')).toBe('quarterly');
    expect(await screen.findByRole('region', { name: 'What you own by quarter' })).toBeVisible();
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });

  it('the area chart says "the last point" is live; its table names the live period (STYLE-10)', async () => {
    const { user } = await openPage();
    const chart = screen.getByRole('region', { name: 'What you own by month' });
    expect(chart).toHaveTextContent("The last point is live: today's prices and balances.");
    expect(chart).not.toHaveTextContent('last bar');
    await user.click(within(chart).getByRole('button', { name: 'Table' }));
    expect(chart).toHaveTextContent("The period marked (live) uses today's prices and balances.");
    expect(chart).not.toHaveTextContent('last bar');
  });
});

describe('History: consistency and audit (§6.4 items 7–8)', () => {
  it('the headline counts derived figures; movements are information', async () => {
    await openPage();
    expect(screen.getByTestId('consistency-headline')).toHaveTextContent(
      'Every stored figure reproduces (6 of 6 imported months)',
    );
    expect(screen.getByTestId('consistency-movements')).toHaveTextContent(
      "1 month's movements differ from today's trades: a trade dated in that month was edited or corrected after it was recorded. Nothing to do; the recorded figure stands.",
    );
    expect(screen.queryByRole('note', { name: 'Stored figure differs' })).toBeNull();
  });

  it('a derived difference asks to be reported', async () => {
    const snapshots = populated.snapshots.map((s) =>
      s.periodMonth === '2025-12'
        ? {
            ...s,
            check: {
              checked: 13,
              differences: [
                {
                  column: 'cashGainCents' as const,
                  kind: 'derived' as const,
                  storedCents: 40_000,
                  recomputedCents: 40_500,
                  storedRatio: null,
                  recomputedRatio: null,
                },
              ],
            },
          }
        : s,
    );
    await openPage({
      ...populated,
      snapshots,
      consistency: { ...populated.consistency, derivedMatchedMonths: 5, derivedDifferences: 1 },
    });
    expect(screen.getByTestId('consistency-headline')).toHaveTextContent(
      '5 of 6 imported months reproduce every stored figure',
    );
    expect(screen.getByRole('note', { name: 'Stored figure differs' })).toHaveTextContent(
      'A stored figure of Dec 2025 does not match its recomputation. Please report it.',
    );
  });

  it('the audit trail: words for the action and who, and "+N more" changes', async () => {
    const { user } = await openPage();
    const table = screen.getByRole('table', { name: 'Audit trail' });
    expect(headers(table)).toEqual(['When', 'Month', 'Action', 'By', 'Changes', 'Note']);
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(cell(table, rows[0] as HTMLElement, 'Action')).toBe('Deleted');
    expect(cell(table, rows[0] as HTMLElement, 'By')).toBe('You');
    const correction = rows.find((r) =>
      r.textContent?.includes('Cash balance was entered twice'),
    ) as HTMLElement;
    expect(correction).toHaveTextContent('Cash $25,200.00 → $23,200.00');
    await user.click(within(correction).getByRole('button', { name: '+3 more' }));
    expect(correction).toHaveTextContent('Jul 2026 Cash change −$1,600.00 → $400.00');
    const startup = rows.find((r) => r.textContent?.includes('At start-up'));
    expect(startup).toBeDefined();
  });

  it('phone: When, Month, Action, Changes, By, Note', async () => {
    emulatePhone();
    await openPage();
    expect(headers(screen.getByRole('table', { name: 'Audit trail' }))).toEqual([
      'When',
      'Month',
      'Action',
      'Changes',
      'By',
      'Note',
    ]);
  });
});
