import type { SuperCapYearDto, SuperPageResponse } from '@joinr/schema';
import {
  apiErrors,
  appStatusEmpty,
  sgOverrideResponse,
  superBalancesResponse,
  superContributionMutationResponse,
  superFundMutationResponse,
  superPages,
} from '@joinr/schema/fixtures';
import { CHART_PALETTE } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legendOf, mockAssets, rgbOf } from '../../../test/assets';
import { bodyRows, centsOf, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const populated = superPages.populated;
const PERIODS = 'Super by period: 7 rows';
const CONTRIBUTIONS = 'Contributions: 9 contributions';

async function openPage(fixture: SuperPageResponse = populated, routes = {}) {
  const api = mockAssets({ super: fixture, routes });
  const view = renderApp('/super');
  await screen.findByRole('group', { name: 'Total super' });
  return { ...view, api };
}

function tile(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

/** A money cell's cents; a dash (with or without its reason) is null. */
function money(text: string): number | null {
  return text.startsWith('—') ? null : centsOf(text);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Super page: states (§6.9)', () => {
  it.each(Object.entries(superPages))('renders the %s fixture', async (_name, fixture) => {
    mockAssets({ super: fixture });
    renderApp('/super');
    expect(await screen.findByRole('heading', { level: 1, name: 'Super' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Total super' })).toBeVisible();
    for (const title of ['Funds', 'Contributions', 'Performance', 'Settings for this page']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
  });

  it('loading', async () => {
    mockAssets({ super: pending });
    renderApp('/super');
    expect(await screen.findByText('Loading super…')).toBeVisible();
  });

  it('empty: no funds, no recorded months', async () => {
    await openPage(superPages.empty);
    expect(screen.getByRole('note', { name: 'No funds' })).toHaveTextContent('No super funds yet.');
    expect(screen.getByRole('note', { name: 'No recorded months' })).toHaveTextContent(
      'History starts after the first recorded month (Stage 5 records months).',
    );
    expect(screen.queryByRole('button', { name: 'Update balances' })).toBeNull();
  });
});

describe('Super page: tiles (§6.4 item 2)', () => {
  it('Total super is the only teal figure; the six tiles', async () => {
    const { container } = await openPage();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Total super')).toHaveClass('jf-stat-tile--key');
    expect(tile('Total super')).toHaveTextContent('$64,500');
    expect(tile('Total super')).toHaveTextContent('2 funds · 20/09/2026');
    expect(tile('Latest gain')).toHaveTextContent('$293');
    // D79: the provisional gain is measured to the latest balances (20/09), not the as-of.
    expect(tile('Latest gain')).toHaveTextContent('Sep 2026 · to 20/09/2026');
    expect(tile('Return per year')).toHaveTextContent('7.2%');
    expect(tile('Return per year')).toHaveTextContent('since Mar 2026 · 173 days');
    const contributed = tile('Contributed this FY');
    expect(contributed).toHaveTextContent('$2,371');
    expect(within(contributed).getByText('Estimate')).toBeVisible();
    expect(contributed).toHaveTextContent('Fund receives $2,136 · take-home cost $1,900');
    const sg = tile('Employer SG this FY');
    expect(sg).toHaveTextContent('$9,330');
    expect(sg).toHaveTextContent('To the fund $7,931 · Partly from statements');
    expect(sg).toHaveTextContent('includes Apr–Jun 2026, paid in July');
    const cap = tile('Concessional cap');
    expect(cap).toHaveTextContent('33.5% used');
    expect(within(cap).getByText('Near')).toBeVisible();
    expect(cap).toHaveTextContent('projected 93.3% by 30 June');
  });

  it('the provisional gain says it runs to the oldest latest balance of the funds held (D79)', async () => {
    const [main, second] = populated.funds;
    await openPage({
      ...populated,
      funds: [
        main!,
        { ...second!, balanceAsOf: '2026-09-12' },
        {
          ...second!,
          id: 3,
          name: 'Closed Super',
          archived: true,
          balanceCents: 0,
          balanceAsOf: '2026-07-01',
        },
      ],
    });
    // The archived fund's older date does not count; dd/mm/yyyy (STYLE_GUIDE §8).
    expect(tile('Latest gain')).toHaveTextContent('Sep 2026 · to 12/09/2026');
  });

  it('not updated: the last closed gain, and why', async () => {
    await openPage(superPages.notUpdated);
    expect(tile('Latest gain')).toHaveTextContent('$897');
    expect(tile('Latest gain')).toHaveTextContent(
      'Aug 2026 · Update your balances to see this month’s gain',
    );
    // A closed month's gain runs to its run date: no "to" date.
    expect(tile('Latest gain')).not.toHaveTextContent(/ · to \d/);
  });

  it('under 90 days: the annual return is "—" with "Needs 90 days of history"', async () => {
    await openPage({ ...populated, annualised: { ...populated.annualised, days: 60 } });
    expect(tile('Return per year')).toHaveTextContent('—Needs 90 days of history');
  });

  it('a negative return per year is a loss (the stop tint)', async () => {
    await openPage({ ...populated, annualised: { ...populated.annualised, returnRatio: '-0.05' } });
    const figure = within(tile('Return per year')).getByText('−5.0%');
    expect(figure).toHaveClass('jf-app-negative');
  });

  it('the cap tile keeps one decimal on a whole percentage', async () => {
    const [current, previous] = populated.capYears as [SuperCapYearDto, SuperCapYearDto];
    await openPage({
      ...populated,
      capYears: [{ ...current, ratio: '0.33', projectedRatio: '0.9' }, previous],
    });
    expect(tile('Concessional cap')).toHaveTextContent('33.0% used');
    expect(tile('Concessional cap')).toHaveTextContent('projected 90.0% by 30 June');
  });

  it('no SG this FY: the Employer SG hint says so', async () => {
    await openPage(superPages.empty);
    expect(tile('Employer SG this FY')).toHaveTextContent('No SG this financial year');
    expect(tile('Employer SG this FY')).not.toHaveTextContent('To the fund');
  });
});

describe('Super page: callouts (§6.4 item 3)', () => {
  it('imported estimates name the reading; the setting switches it', async () => {
    await openPage();
    expect(screen.getByRole('note', { name: 'Imported contributions' })).toHaveTextContent(
      '6 imported contributions have no type: counted as salary sacrifice, grossed up at your marginal tax rate. Change this in Settings for this page.',
    );
    screen.getByRole('note', { name: 'Imported contributions' });
  });

  it('read as after-tax', async () => {
    await openPage({
      ...populated,
      settings: {
        ...populated.settings,
        values: { ...populated.settings.values, 'super.importedContributionType': 'after_tax' },
      },
    });
    expect(screen.getByRole('note', { name: 'Imported contributions' })).toHaveTextContent(
      'counted as after-tax.',
    );
  });

  it('no salary, no marginal rate, not updated', async () => {
    await openPage(superPages.noSalary);
    expect(screen.getByRole('note', { name: 'No salary' })).toHaveTextContent(
      'Set your gross salary in Settings for this page to estimate employer SG.',
    );
  });

  it('no marginal rate: important; take-home cost "—" with the reason', async () => {
    await openPage(superPages.noMarginalRate);
    expect(screen.getByRole('note', { name: 'No marginal tax rate' })).toHaveTextContent(
      'salary-sacrifice contributions are left out of your savings rate until then',
    );
    const table = tableNamed(CONTRIBUTIONS);
    const sacrifice = rowOf(table, '15/07/2026');
    expect(cell(table, sacrifice, 'Take-home cost')).toBe('—No marginal rate');
  });

  it('balances not updated', async () => {
    await openPage(superPages.notUpdated);
    expect(screen.getByRole('note', { name: 'Balances not updated' })).toHaveTextContent(
      'Balances have not been updated since the last recorded month',
    );
  });
});

describe('Super page: the SG fund (UX-24)', () => {
  it('no SG fund: a Select + Save in the callout and the section bar; it sends receivesSg only', async () => {
    const { user, api } = await openPage(superPages.noSgFund, {
      'PUT /api/super/funds/1': { body: superFundMutationResponse },
    });
    const callout = screen.getByRole('note', { name: 'SG fund' });
    expect(callout).toHaveTextContent('Choose the fund that receives employer SG.');
    expect(callout).toHaveTextContent('Choosing the SG fund keeps re-import available.');
    const bar = screen.getByRole('heading', { level: 2, name: 'Funds' })
      .parentElement as HTMLElement;
    expect(within(bar).getByRole('combobox', { name: 'SG fund' })).toBeVisible();
    const select = within(callout).getByRole('combobox', { name: 'Fund that receives SG' });
    await user.selectOptions(select, '1');
    await user.click(within(callout).getByRole('button', { name: 'Save: Fund that receives SG' }));
    await waitFor(() => expect(api.calls('PUT /api/super/funds/1')).toHaveLength(1));
    expect(api.calls('PUT /api/super/funds/1')[0]?.body).toEqual({
      name: 'Example Super',
      receivesSg: true,
      archived: false,
    });
  });

  it('the callout picker announces the save after the callout goes (late status refetch)', async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const before = superPages.noSgFund;
    const fund = before.funds[0]!;
    const after: SuperPageResponse = {
      ...before,
      flags: before.flags.filter((f) => f !== 'no_sg_fund'),
      funds: before.funds.map((f) => ({ ...f, receivesSg: f.id === fund.id })),
    };
    let saved = false;
    mockAssets({
      super: () => ({ body: saved ? after : before }),
      routes: {
        // The header's status answers after the page refetch has dropped the callout.
        'GET /api/status': async () => {
          if (saved) await sleep(150);
          return { body: appStatusEmpty };
        },
        [`PUT /api/super/funds/${fund.id}`]: () => {
          saved = true;
          return { body: { fund: { ...fund, receivesSg: true } } };
        },
      },
    });
    const { user } = renderApp('/super');
    const callout = await screen.findByRole('note', { name: 'SG fund' });
    await user.selectOptions(
      within(callout).getByRole('combobox', { name: 'Fund that receives SG' }),
      String(fund.id),
    );
    await user.click(within(callout).getByRole('button', { name: 'Save: Fund that receives SG' }));
    await waitFor(() => expect(screen.queryByRole('note', { name: 'SG fund' })).toBeNull());
    await sleep(400);
    expect(screen.getByRole('note', { name: 'Saved' })).toHaveTextContent('SG fund saved.');
    // The section bar's picker was never touched, so it follows the saved fund.
    const bar = screen.getByRole('heading', { level: 2, name: 'Funds' })
      .parentElement as HTMLElement;
    expect(within(bar).getByRole('combobox', { name: 'SG fund' })).toHaveValue(String(fund.id));
  });

  it('the fund form: the SG switch alone keeps re-import (a note, not the workbook callout)', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Edit Example Super' }));
    const form = screen.getByRole('form', { name: 'Edit fund · Example Super' });
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.click(within(form).getByRole('switch', { name: 'Receives employer SG' }));
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Choosing the SG fund keeps re-import available.',
    );
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    // A name change is an app edit again.
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), ' 2');
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'Import-safe' })).toBeNull();
  });
});

describe('Super page: funds (§6.4 item 4)', () => {
  it('the table and its total; phone order', async () => {
    await openPage();
    const table = tableNamed('Funds: 2 funds');
    expect(headers(table)).toEqual([
      'Fund',
      'Balance',
      'As of',
      'Receives SG',
      'Source',
      'Actions',
    ]);
    expect(cell(table, rowOf(table, 'Example Super'), 'Receives SG')).toBe('Yes');
    expect(cell(table, table.querySelector('tfoot tr') as HTMLElement, 'Balance')).toBe(
      '$64,500.00',
    );
  });

  it('phone: status-first', async () => {
    emulatePhone();
    await openPage();
    expect(headers(tableNamed('Funds: 2 funds'))).toEqual([
      'Fund',
      'Balance',
      'As of',
      'Actions',
      'Receives SG',
      'Source',
    ]);
  });

  it('Update balances sends the changed funds with the shared date and note', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/super/balances': { body: superBalancesResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    const form = screen.getByRole('form', { name: 'Update balances' });
    expect(within(form).getByRole('button', { name: 'Save balances' })).toBeDisabled();
    const second = within(form).getByRole('textbox', { name: 'Balance, Second Super' });
    await user.clear(second);
    await user.type(second, '2900');
    // An app fund only: the new-app-data note, not the workbook callout.
    expect(within(form).getByRole('note', { name: 'App data' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Statement');
    await user.click(within(form).getByRole('button', { name: 'Save balances' }));
    await waitFor(() => expect(api.calls('PUT /api/super/balances')).toHaveLength(1));
    expect(api.calls('PUT /api/super/balances')[0]?.body).toMatchObject({
      entries: [{ fundId: 2, balanceCents: 290000, note: 'Statement' }],
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Balances saved.');
  });

  it('create: an opening balance is a transfer in unless it is a rollover', async () => {
    const { user, api } = await openPage(populated, {
      'POST /api/super/funds': { status: 201, body: superFundMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add fund' }));
    const form = screen.getByRole('form', { name: 'Add fund' });
    expect(form).toHaveTextContent('Off: the opening balance is money you already had, not a gain');
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Example Fund');
    await user.type(within(form).getByRole('textbox', { name: /Opening balance/ }), '1000');
    await user.click(within(form).getByRole('switch', { name: /a rollover/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/super/funds')).toHaveLength(1));
    expect(api.calls('POST /api/super/funds')[0]?.body).toMatchObject({
      name: 'Example Fund',
      receivesSg: false,
      openingBalanceCents: 100000,
      openingIsRollover: true,
    });
  });

  it('create: an opening balance that is not a rollover is dated after the last recorded month', async () => {
    const { user, api } = await openPage(populated, {
      'POST /api/super/funds': { status: 201, body: superFundMutationResponse },
    });
    expect(populated.lastRun).toBe('2026-08-31');
    await user.click(screen.getByRole('button', { name: 'Add fund' }));
    const form = screen.getByRole('form', { name: 'Add fund' });
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Example Fund');
    await user.type(within(form).getByRole('textbox', { name: /Opening balance/ }), '1000');
    const asOf = within(form).getByRole('textbox', { name: /As of/ });
    await user.clear(asOf);
    await user.type(asOf, '31/08/2026');
    await user.tab();
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(form).toHaveTextContent(
      'Date the opening balance after 31/08/2026 (the last recorded month), or mark it a rollover.',
    );
    expect(asOf).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('POST /api/super/funds')).toHaveLength(0);
    // A rollover may carry the statement's earlier date.
    await user.click(within(form).getByRole('switch', { name: /a rollover/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/super/funds')).toHaveLength(1));
    expect(api.calls('POST /api/super/funds')[0]?.body).toMatchObject({
      asOf: '2026-08-31',
      openingIsRollover: true,
    });
  });

  it('create: the server’s date error lands on As of', async () => {
    const { user } = await openPage(
      { ...populated, lastRun: null },
      {
        'POST /api/super/funds': apiError(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'asOf: date the opening balance after 31/08/2026 (the last recorded month), or mark it a rollover',
          },
        }),
      },
    );
    await user.click(screen.getByRole('button', { name: 'Add fund' }));
    const form = screen.getByRole('form', { name: 'Add fund' });
    await user.type(within(form).getByRole('textbox', { name: /Name/ }), 'Example Fund');
    await user.type(within(form).getByRole('textbox', { name: /Opening balance/ }), '1000');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(form).getByRole('textbox', { name: /As of/ })).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(form).toHaveTextContent(/date the opening balance after 31\/08\/2026/i);
  });

  it('archive needs a closing balance of $0; delete is disabled while contributions use the fund', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Edit Second Super' }));
    const form = screen.getByRole('form', { name: 'Edit fund · Second Super' });
    expect(within(form).getByRole('switch', { name: 'Archived' })).toBeDisabled();
    expect(form).toHaveTextContent('Enter a closing balance of $0 first (after a rollover)');
    expect(within(form).getByRole('button', { name: 'Delete fund' })).toBeDisabled();
    expect(form).toHaveTextContent('This fund has 2 contributions; move or delete them first.');
  });

  it('a 409 FUND_IN_USE shows the server message', async () => {
    const fixture: SuperPageResponse = {
      ...populated,
      funds: populated.funds.map((f) => (f.id === 2 ? { ...f, contributionCount: 0 } : f)),
    };
    const { user } = await openPage(fixture, {
      'DELETE /api/super/funds/2': apiError(409, apiErrors.fundInUse),
    });
    await user.click(screen.getByRole('button', { name: 'Edit Second Super' }));
    const form = screen.getByRole('form', { name: 'Edit fund · Second Super' });
    await user.click(within(form).getByRole('button', { name: 'Delete fund' }));
    await user.click(within(form).getByRole('button', { name: 'Delete the fund Second Super' }));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'This fund has 2 contributions; move or delete them first',
    );
  });

  it('Balance history: moves focus to the card and announces; the table adds up', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Balance history of Second Super' }));
    const card = screen.getByRole('region', { name: 'Balance history' });
    expect(within(card).getByRole('heading', { name: 'Balance history' })).toHaveFocus();
    // A read-only action: announced in the hidden "Page updates" region, not a "Saved" callout.
    const updates = screen.getByRole('status', { name: 'Page updates' });
    expect(updates).toHaveTextContent('Showing Second Super balance history');
    expect(updates).toHaveClass('jf-visually-hidden');
    expect(screen.queryByRole('note', { name: 'Saved' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Save result' })).toBeEmptyDOMElement();
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Balance history: Second Super' });
    expect(headers(table)).toEqual([
      'As of',
      'Balance',
      'Change',
      'Flows in',
      'Transfer in',
      'Gain',
      'Note',
      'Source',
      'Actions',
    ]);
    const opening = rowOf(table, '15/06/2026');
    expect(cell(table, opening, 'Transfer in')).toBe('$2,000.00');
    // Each later entry: Change − Flows in = Gain.
    for (const row of bodyRows(table).slice(0, -1)) {
      const change = money(cell(table, row, 'Change')) ?? 0;
      const flows = money(cell(table, row, 'Flows in')) ?? 0;
      expect(money(cell(table, row, 'Gain'))).toBe(change - flows);
    }
  });
});

describe('Super page: contributions (§6.4 item 5, D71)', () => {
  it('the table: type pills, the Estimate marker on imported rows, the cap column', async () => {
    await openPage();
    const table = tableNamed(CONTRIBUTIONS);
    expect(headers(table)).toEqual([
      'Date',
      'Fund',
      'Type',
      'Pre-tax',
      'Fund receives',
      'Take-home cost',
      'Toward the cap',
      'Period',
      'Note',
      'Actions',
    ]);
    const imported = rowOf(table, '31/08/2026');
    expect(cell(table, imported, 'Type')).toBe('ImportedEstimate');
    expect(cell(table, imported, 'Fund')).toBe('Not assigned');
    const afterTax = rowOf(table, '15/09/2026');
    expect(cell(table, afterTax, 'Type')).toBe('After-tax');
    expect(cell(table, afterTax, 'Pre-tax')).toContain('—');
    expect(cell(table, afterTax, 'Toward the cap')).toBe('Non-concessional');
    expect(cell(table, afterTax, 'Period')).toBe('Sep 2026Provisional');
    expect(cell(table, rowOf(table, '15/07/2026'), 'Toward the cap')).toBe('Concessional');
  });

  it('phone: status-first, the Estimate and Provisional markers in the first cell', async () => {
    emulatePhone();
    await openPage();
    const table = tableNamed(CONTRIBUTIONS);
    expect(headers(table)).toEqual([
      'Date',
      'Type',
      'Pre-tax',
      'Fund receives',
      'Take-home cost',
      'Fund',
      'Toward the cap',
      'Period',
      'Note',
      'Actions',
    ]);
    const first = (date: string) => rowOf(table, date).children[0] as HTMLElement;
    expect(within(first('31/08/2026')).getByText('Estimate')).toBeVisible();
    expect(within(first('15/09/2026')).getByText('Provisional')).toBeVisible();
  });

  it('the form labels the amount by type and names the rates in use', async () => {
    const { user, api } = await openPage(populated, {
      'POST /api/super/contributions': { status: 201, body: superContributionMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Add contribution' }));
    const form = screen.getByRole('form', { name: 'Add contribution' });
    expect(
      within(form).getByRole('textbox', { name: /Pre-tax amount, as on your payslip/ }),
    ).toBeVisible();
    expect(form).toHaveTextContent(
      'Take-home cost at your 30% marginal rate; the fund receives it less 15% contributions tax',
    );
    expect(form).toHaveTextContent('The date your fund received it, for the cap');
    await user.click(within(form).getByRole('button', { name: 'After-tax' }));
    expect(
      within(form).getByRole('textbox', { name: /Amount paid from your take-home pay/ }),
    ).toBeVisible();
    await user.type(
      within(form).getByRole('textbox', { name: /Amount paid from your take-home pay/ }),
      '500',
    );
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Fund' }), '2');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /api/super/contributions')).toHaveLength(1));
    expect(api.calls('POST /api/super/contributions')[0]?.body).toMatchObject({
      kind: 'after_tax',
      fundId: 2,
      amountCents: 50000,
      note: null,
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
      'Contribution saved.',
    );
  });

  it('without a marginal rate the hint asks for it', async () => {
    const { user } = await openPage(superPages.noMarginalRate);
    await user.click(screen.getByRole('button', { name: 'Add contribution' }));
    expect(screen.getByRole('form', { name: 'Add contribution' })).toHaveTextContent(
      'Set your marginal tax rate to see the take-home cost',
    );
  });

  it('editing an imported entry asks for its type, pre-filled with the current reading', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Edit the contribution of 31/08/2026' }));
    const form = screen.getByRole('form', { name: 'Edit contribution' });
    expect(within(form).getByRole('button', { name: 'Salary sacrifice' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(form).getByRole('textbox', { name: /Pre-tax amount/ })).toHaveValue('285.71');
    expect(form).toHaveTextContent('Imported as $200.00 take-home cost');
    // Saving turns it into a typed entry: Save is allowed as it stands.
    expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
  });
});

describe('Super page: the cap meters (D70, D75, UX-1)', () => {
  it('this FY: the cap meter, its figures, the projection tick and the transition note', async () => {
    await openPage();
    const meter = screen.getByRole('meter', { name: 'Concessional contributions FY2026–27' });
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining('left under the cap'));
    expect(meter.closest('.jf-meter')).toHaveAttribute('data-tone', 'check');
    expect(meter.closest('.jf-meter')).toHaveTextContent('so far (includes estimates)');
    expect(meter.closest('.jf-meter')).toHaveTextContent('Projected by 30 June $30,335.68');
    expect(screen.getByRole('note', { name: 'Near the cap' })).toHaveTextContent(
      'On track for 93.3% of the concessional cap by 30 June. Contributions over the cap are taxed at your marginal rate.',
    );
    const facts = screen.getByRole('table', { name: 'Concessional cap FY2026–27' });
    expect(facts).toHaveTextContent('Employer SG (counted when the fund receives it)$9,330.00');
    expect(facts).toHaveTextContent('Cap$32,500.00ATO figure for FY2026–27, checked 26/09/2026');
    expect(
      screen.getByText(/Includes the April–June 2026 quarter’s SG, due by 28 July 2026/),
    ).toBeVisible();
    // The FY before sits in a closed <details>.
    const details = screen.getByText('FY2025–26', { selector: 'summary' }).closest('details');
    expect(details).not.toHaveAttribute('open');
  });

  it('over the cap: the callout says so, the meter is stop', async () => {
    await openPage(superPages.overCap);
    expect(screen.getByRole('note', { name: 'Over the cap' })).toHaveTextContent('over the cap');
    // Under the cap so far, projected over it: the words follow the projection, as the badge.
    expect(screen.getByRole('note', { name: 'Over the cap' })).toHaveTextContent(
      'On track to go over the concessional cap by 30 June (241.0% of it). Contributions over the cap are taxed at your marginal rate.',
    );
    const meter = screen.getByRole('meter', { name: 'Concessional contributions FY2026–27' });
    const root = meter.closest('.jf-meter') as HTMLElement;
    expect(root).toHaveAttribute('data-tone', 'stop');
    expect(root).toHaveTextContent('Projected over the cap by $45,835.68');
    expect(root).not.toHaveTextContent('left under the cap');
    expect(meter.getAttribute('aria-valuetext')).toMatch(/^Over\. /);
  });

  it('over the cap already: the callout names the excess', async () => {
    const [current, previous] = superPages.overCap.capYears as [SuperCapYearDto, SuperCapYearDto];
    await openPage({
      ...superPages.overCap,
      capYears: [{ ...current, totalCents: current.capCents + 50000 }, previous],
    });
    expect(screen.getByRole('note', { name: 'Over the cap' })).toHaveTextContent(
      'Over the concessional cap by $500.00 already. Contributions over the cap are taxed at your marginal rate.',
    );
  });

  it('the FY before, complete, reads "for the year" (not "so far")', async () => {
    await openPage();
    const details = screen.getByText('FY2025–26', { selector: 'summary' }).closest('details')!;
    const meter = within(details as HTMLElement).getByRole('meter', {
      name: 'Concessional contributions FY2025–26',
    });
    const root = meter.closest('.jf-meter') as HTMLElement;
    expect(root).toHaveTextContent('for the year (includes estimates)');
    expect(root).not.toHaveTextContent('so far');
  });

  it('a cap set by you; an override for the FY before no longer applies', async () => {
    await openPage(superPages.capOverride);
    expect(screen.getByRole('table', { name: 'Concessional cap FY2026–27' })).toHaveTextContent(
      'Set by you for FY2026–27',
    );
  });

  it('an override for the FY before', async () => {
    await openPage(superPages.capOverrideLastFy);
    expect(
      screen.getByText(
        'Your FY2025–26 cap override no longer applies; this year uses the ATO figure.',
      ),
    ).toBeVisible();
  });
});

describe('Super page: employer SG (D69)', () => {
  it('estimates and a statement; the cap year; Enter statement sends the gross (an overlay)', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/super/sg/2026-08': { body: sgOverrideResponse },
    });
    const table = tableNamed('Employer SG by month');
    expect(headers(table)).toEqual([
      'Month (earned)',
      'Source',
      'Before tax',
      'Fund receives',
      'Fund',
      'Cap year',
      'Actions',
    ]);
    const july = rowOf(table, 'Jul 2026');
    expect(cell(table, july, 'Source')).toBe('Statement');
    expect(cell(table, july, 'Cap year')).toBe('FY2026–27');
    expect(cell(table, rowOf(table, 'Mar 2026'), 'Cap year')).toBe('FY2025–26');
    expect(cell(table, rowOf(table, 'Aug 2026'), 'Source')).toBe('Estimate');
    await user.click(screen.getByRole('button', { name: 'Enter a statement for Aug 2026' }));
    const form = screen.getByRole('form', { name: 'Statement · Aug 2026' });
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Statement figures are kept when you re-import',
    );
    expect(within(form).queryByRole('note', { name: 'App data' })).toBeNull();
    await user.type(
      within(form).getByRole('textbox', { name: /Employer contribution before tax/ }),
      '1650',
    );
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/super/sg/2026-08')).toHaveLength(1));
    expect(api.calls('PUT /api/super/sg/2026-08')[0]?.body).toEqual({
      grossCents: 165000,
      note: null,
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent(
      'Statement saved.',
    );
  });

  it('every month an estimate: one foot-noted marker for the column', async () => {
    const fixture: SuperPageResponse = {
      ...populated,
      sgMonths: populated.sgMonths.map((m) => ({ ...m, source: 'estimate' as const, note: null })),
    };
    await openPage(fixture);
    const table = tableNamed('Employer SG by month');
    expect(within(table).queryByText('Statement')).toBeNull();
    expect(screen.getByText(/Every month here is an estimate/)).toBeVisible();
  });

  it('phone: status-first, the markers in the first cell', async () => {
    emulatePhone();
    await openPage();
    const table = tableNamed('Employer SG by month');
    expect(headers(table)).toEqual([
      'Month (earned)',
      'Source',
      'Fund receives',
      'Before tax',
      'Fund',
      'Cap year',
      'Actions',
    ]);
    expect(
      within(rowOf(table, 'Jul 2026').children[0] as HTMLElement).getByText('Statement'),
    ).toBeVisible();
  });
});

describe('Super page: performance (§6.4 item 6, UX-11)', () => {
  it('every valuation row adds up: Change − SG − yours − transfers = Gain', async () => {
    await openPage();
    const table = tableNamed(PERIODS);
    expect(headers(table)).toEqual([
      'Period',
      'Value',
      'Change',
      'Employer SG (to fund)',
      'Your contributions (to fund)',
      'Transfers in',
      'Gain',
      'Return',
      'Option note',
      'Actions',
    ]);
    let checked = 0;
    for (const row of bodyRows(table)) {
      const gain = money(cell(table, row, 'Gain'));
      if (gain === null) continue;
      const change = money(cell(table, row, 'Change')) ?? 0;
      const sg = money(cell(table, row, 'Employer SG (to fund)')) ?? 0;
      const yours = money(cell(table, row, 'Your contributions (to fund)')) ?? 0;
      const transfers = money(cell(table, row, 'Transfers in')) ?? 0;
      expect(gain).toBe(change - sg - yours - transfers);
      checked += 1;
    }
    expect(checked).toBe(5);
  });

  it('badges: Provisional, Baseline, Not updated; a merged row says since when', async () => {
    await openPage();
    const table = tableNamed(PERIODS);
    expect(cell(table, rowOf(table, 'Sep 2026'), 'Period')).toContain('Provisional');
    expect(cell(table, rowOf(table, 'Mar 2026'), 'Period')).toContain('Baseline');
    const may = rowOf(table, 'May 2026');
    expect(cell(table, may, 'Period')).toContain('Not updated');
    expect(cell(table, may, 'Period')).toContain('Merged into the next month');
    expect(cell(table, rowOf(table, 'Jun 2026'), 'Period')).toContain('since 30/04/2026');
    // A loss is red.
    const june = rowOf(table, 'Jun 2026');
    expect(
      june.children[headers(table).indexOf('Gain')]?.querySelector('.jf-amount--negative'),
    ).not.toBeNull();
  });

  it('phone: status-first, the badges in the first cell', async () => {
    emulatePhone();
    await openPage();
    const table = tableNamed(PERIODS);
    expect(headers(table).slice(0, 4)).toEqual(['Period', 'Gain', 'Value', 'Return']);
    const may = rowOf(table, 'May 2026').children[0] as HTMLElement;
    expect(within(may).getByText('Not updated')).toBeVisible();
  });

  it('option notes by month: the list, and a note sent for its month', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/period-notes/super_option/2026-09': {
        body: {
          note: {
            periodMonth: '2026-09',
            kind: 'super_option',
            note: 'Moved to growth',
            origin: 'app',
            sheetRef: null,
          },
        },
      },
    });
    const list = screen
      .getByRole('heading', { name: 'Investment option notes' })
      .closest('section');
    expect(list).toHaveTextContent('Aug 2026Added a second fund');
    expect(list).toHaveTextContent('Jun 2026Switched to the balanced option');
    await user.click(screen.getByRole('button', { name: 'Option note for Sep 2026' }));
    const form = screen.getByRole('form', { name: 'Investment option note' });
    expect(within(form).getByRole('combobox', { name: 'Month' })).toHaveValue('2026-09');
    await user.type(within(form).getByRole('textbox', { name: /Note/ }), 'Moved to growth');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.calls('PUT /api/period-notes/super_option/2026-09')).toHaveLength(1),
    );
    expect(api.calls('PUT /api/period-notes/super_option/2026-09')[0]?.body).toEqual({
      note: 'Moved to growth',
    });
  });

  it('the charts: Into the fund stacks SG (slot 1) and yours (slot 2); the foot notes', async () => {
    await openPage();
    const card = screen.getByRole('region', { name: 'Into the fund' });
    expect(legendOf(card)).toEqual([
      { name: 'Employer SG', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Your contributions', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    for (const title of ['Super value', 'Gains', 'Return']) {
      expect(screen.getByRole('region', { name: title })).toBeVisible();
    }
    expect(
      screen.getByText(/Gains are derived: the change in balance minus employer SG/),
    ).toBeVisible();
    expect(
      screen.getByText('Return per year chains each period’s Modified Dietz return.'),
    ).toBeVisible();
  });
});

describe('Super page: settings (§6.4 item 7)', () => {
  it('the rates as the ATO quotes them; workbook and app-only keys', async () => {
    const { user } = await openPage();
    const table = screen.getByRole('table', { name: 'Settings for this page' });
    expect(table).toHaveTextContent('Marginal tax rate30%');
    expect(table).toHaveTextContent(
      'Your employer’s SG rateNot set: the legal minimum (12% this month)',
    );
    expect(table).toHaveTextContent(
      'Concessional cap override (this financial year only)Not set: the ATO figure ($32,500)',
    );
    await user.click(screen.getByRole('button', { name: 'Edit settings for this page' }));
    const form = screen.getByRole('form', { name: 'Edit settings for this page' });
    // Pristine with workbook keys: the workbook callout.
    expect(within(form).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    expect(within(form).getByPlaceholderText('Legal minimum 12')).toBeVisible();
    expect(within(form).getByPlaceholderText('ATO 32,500')).toBeVisible();
    // An app-only change alone: import-safe.
    await user.type(within(form).getByRole('textbox', { name: /Contributions tax/ }), '15.5');
    expect(within(form).getByRole('note', { name: 'Import-safe' })).toBeVisible();
    expect(within(form).queryByRole('note', { name: 'From the workbook' })).toBeNull();
  });

  it('an error on a failed save keeps the form open', async () => {
    const { user } = await openPage(populated, {
      'PATCH /api/settings': apiError(409, apiErrors.inProgress),
    });
    await user.click(screen.getByRole('button', { name: 'Edit settings for this page' }));
    const form = screen.getByRole('form', { name: 'Edit settings for this page' });
    await user.type(within(form).getByRole('textbox', { name: /Contributions tax/ }), '16');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'An import is running; try again shortly.',
    );
  });
});
