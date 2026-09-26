import type { PropertyPageResponse } from '@joinr/schema';
import {
  apiErrors,
  appStatusEmpty,
  loanBalancesResponse,
  loanMutationResponse,
  loanOffsetsResponse,
  propertyMutationResponse,
  propertyPages,
  valuationsResponse,
} from '@joinr/schema/fixtures';
import { CHART_PALETTE } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legendOf, mockAssets, rgbOf } from '../../../test/assets';
import { bodyRows, tableNamed } from '../../../test/cashflow';
import { cell, headers, rowOf } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const populated = propertyPages.populated;
const LOG = 'Balance log: Example property mortgage, 3 entries';

async function openPage(fixture: PropertyPageResponse = populated, routes = {}) {
  const api = mockAssets({ property: fixture, routes });
  const view = renderApp('/property');
  await screen.findByRole('group', { name: 'Equity' });
  return { ...view, api };
}

function tile(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

function loanCard(name = 'Example property mortgage'): HTMLElement {
  return screen.getByRole('region', { name });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Property page: states (§6.9)', () => {
  it.each(Object.entries(propertyPages))('renders the %s fixture', async (_name, fixture) => {
    mockAssets({ property: fixture });
    renderApp('/property');
    expect(await screen.findByRole('heading', { level: 1, name: 'Property' })).toBeVisible();
    expect(await screen.findByRole('group', { name: 'Equity' })).toBeVisible();
    for (const title of ['Properties', 'Mortgages', 'Value over time', 'Settings for this page']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
  });

  it('loading', async () => {
    mockAssets({ property: pending });
    renderApp('/property');
    expect(await screen.findByText('Loading property…')).toBeVisible();
  });

  it('empty: no properties; a loan needs a property first', async () => {
    await openPage(propertyPages.empty);
    expect(screen.getByRole('note', { name: 'No properties' })).toHaveTextContent(
      'No properties yet.',
    );
    expect(screen.getByRole('button', { name: 'Add loan' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Update balances' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update values' })).toBeNull();
    expect(
      screen.getAllByText('History starts after the first recorded month (Stage 5 records months).')
        .length,
    ).toBeGreaterThan(0);
  });

  it('a property without a loan: "No mortgage on this property."', async () => {
    await openPage(propertyPages.noLoan);
    const card = screen.getByRole('region', { name: 'Example property' });
    expect(card).toHaveTextContent('No mortgage on this property.');
    expect(screen.getByRole('note', { name: 'No loans' })).toBeVisible();
  });
});

describe('Property page: tiles (§6.5 item 2)', () => {
  it('Equity is the only teal figure; the mortgage net of offsets; the payoff', async () => {
    const { container } = await openPage();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Equity')).toHaveClass('jf-stat-tile--key');
    expect(tile('Equity')).toHaveTextContent('$219,100');
    expect(tile('Property value')).toHaveTextContent('$600,000');
    expect(tile('Property value')).toHaveTextContent('Valued 31/08/2026');
    expect(tile('Mortgage')).toHaveTextContent('$380,900');
    expect(tile('Mortgage')).toHaveTextContent('Offsets $10,000 · balance $390,900');
    expect(tile('Loan to value')).toHaveTextContent('63.5%');
    expect(tile('Principal paid')).toHaveTextContent('$59,100');
    expect(tile('Principal paid')).toHaveTextContent('Interest and fees $157,100, estimated');
    expect(tile('Paid off')).toHaveTextContent('Jan 2046');
    expect(tile('Paid off')).toHaveTextContent(
      'In 19 years 3 months · 8 months sooner with your offset',
    );
  });

  it('no payoff: "—" with the flag’s words', async () => {
    await openPage(propertyPages.paymentBelowInterest);
    expect(tile('Paid off')).toHaveTextContent('—The repayment does not cover the interest');
  });
});

describe('Property page: callouts (§6.5 item 3)', () => {
  it('estimated repayments (D66)', async () => {
    await openPage();
    expect(screen.getByRole('note', { name: 'Estimated repayments' })).toHaveTextContent(
      'Interest and fees are estimated from your repayments: the regular payment × the payments due. Enter the actual repayments on an entry to replace the estimate.',
    );
  });

  it('an unlinked offset: a Link action opens the offsets form', async () => {
    const { user } = await openPage(propertyPages.unlinkedOffset);
    const callout = screen.getByRole('note', { name: 'Offset not linked' });
    expect(callout).toHaveTextContent('1 offset account is not linked to a loan');
    await user.click(within(callout).getByRole('button', { name: 'Link' }));
    const form = screen.getByRole('form', { name: 'Offset accounts · Example property mortgage' });
    expect(within(form).getByRole('checkbox', { name: 'Offset account' })).not.toBeChecked();
  });

  it('a loan without a property; missing fields', async () => {
    await openPage(propertyPages.loanWithoutProperty);
    expect(screen.getByRole('note', { name: 'Loans without a property' })).toHaveTextContent(
      '1 loan is not linked to a property. The app tracks mortgages only.',
    );
    expect(screen.getByRole('note', { name: 'Loan details missing' })).toHaveTextContent(
      'Example car loan has no repayment amount, so no payoff date is shown.',
    );
    expect(loanCard('Example car loan')).toHaveTextContent('Not linked to a property');
  });

  it('a repayment below the interest: important', async () => {
    await openPage(propertyPages.paymentBelowInterest);
    expect(screen.getByRole('note', { name: 'Repayment below the interest' })).toBeVisible();
  });

  it('no rate', async () => {
    await openPage(propertyPages.noRate);
    expect(screen.getByRole('note', { name: 'Loan details missing' })).toHaveTextContent(
      'Example property mortgage has no interest rate, so no payoff date is shown. Edit the loan to add it.',
    );
  });
});

describe('Property page: properties (§6.5 item 4, D68)', () => {
  it('the facts of a property', async () => {
    await openPage();
    const facts = screen.getByRole('table', { name: 'Example property: facts' });
    expect(facts).toHaveTextContent('Purchased15/03/2020');
    expect(facts).toHaveTextContent(
      'Primary residenceYesCounted in net worth; the FIRE planner (Stage 6) leaves it out',
    );
    expect(facts).toHaveTextContent('Value$600,000.00as of 31/08/2026');
    expect(facts).toHaveTextContent('Gain$100,000.0020.0%');
    expect(facts).toHaveTextContent('Annualised gain2.8%');
    expect(facts).toHaveTextContent('Mortgage (net)$380,900.00');
    expect(facts).toHaveTextContent('Loan to value63.5%');
  });

  it('the annualised gain is "—" under 90 days held', async () => {
    const fixture: PropertyPageResponse = {
      ...populated,
      properties: populated.properties.map((p) => ({ ...p, heldDays: 30 })),
    };
    await openPage(fixture);
    expect(screen.getByRole('table', { name: 'Example property: facts' })).toHaveTextContent(
      'Annualised gain—Held under 90 days',
    );
  });

  it('Update values sends the changed values with the shared date', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/property/valuations': { body: valuationsResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update values' }));
    const form = screen.getByRole('form', { name: 'Update values' });
    const value = within(form).getByRole('textbox', { name: 'Value, Example property' });
    await user.clear(value);
    await user.type(value, '620000');
    await user.click(within(form).getByRole('button', { name: 'Save values' }));
    await waitFor(() => expect(api.calls('PUT /api/property/valuations')).toHaveLength(1));
    expect(api.calls('PUT /api/property/valuations')[0]?.body).toMatchObject({
      entries: [{ propertyId: 1, valueCents: 62000000 }],
    });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Values saved.');
  });

  it('the property form: delete disabled while it has loans; net rent may be negative', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/property/properties/1': { body: propertyMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example property' }));
    const form = screen.getByRole('form', { name: 'Edit property · Example property' });
    expect(within(form).getByRole('button', { name: 'Delete property' })).toBeDisabled();
    expect(form).toHaveTextContent('This property has 1 loan; delete them first.');
    expect(form).toHaveTextContent('Rent less costs, to date; may be negative');
    const rent = within(form).getByRole('textbox', { name: /Net rent to date/ });
    await user.clear(rent);
    await user.type(rent, '-1200');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/property/properties/1')).toHaveLength(1));
    expect(api.calls('PUT /api/property/properties/1')[0]?.body).toMatchObject({
      netRentToDateCents: -120000,
      isPrimaryResidence: true,
    });
  });

  it('a 409 PROPERTY_HAS_LOAN shows the server message', async () => {
    const { user } = await openPage(propertyPages.noLoan, {
      'DELETE /api/property/properties/1': apiError(409, apiErrors.propertyHasLoan),
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example property' }));
    const form = screen.getByRole('form', { name: 'Edit property · Example property' });
    await user.click(within(form).getByRole('button', { name: 'Delete property' }));
    await user.click(
      within(form).getByRole('button', { name: 'Delete the property Example property' }),
    );
    expect(await within(form).findByRole('note', { name: 'Not saved' })).toHaveTextContent(
      'This property has 1 loans; delete them first',
    );
  });

  it('Valuations: focus moves to the card, the last one has no Delete', async () => {
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Valuations of Example property' }));
    const card = screen.getByRole('region', { name: 'Valuations' });
    expect(within(card).getByRole('heading', { name: 'Valuations' })).toHaveFocus();
    // A read-only action: announced in the hidden "Page updates" region, not a "Saved" callout.
    const updates = screen.getByRole('status', { name: 'Page updates' });
    expect(updates).toHaveTextContent('Showing Example property valuations');
    expect(updates).toHaveClass('jf-visually-hidden');
    expect(screen.queryByRole('note', { name: 'Saved' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Save result' })).toBeEmptyDOMElement();
    await user.click(within(card).getByRole('button', { name: 'Table' }));
    const table = within(card).getByRole('table', { name: 'Valuations: Example property' });
    expect(headers(table)).toEqual(['As of', 'Value', 'Note', 'Source', 'Actions']);
    expect(bodyRows(table)).toHaveLength(2);
    expect(within(table).getAllByRole('button', { name: /^Delete the valuation/ })).toHaveLength(2);
  });
});

describe('Property page: the mortgage card (§6.5 item 5, D66, D67, UX-21)', () => {
  it('the facts: rates in words, the next repayment’s interest, the offset savings', async () => {
    await openPage();
    const facts = screen.getByRole('table', { name: 'Example property mortgage: facts' });
    expect(facts).toHaveTextContent('Interest rate6% a year, compounding monthly');
    expect(facts).toHaveTextContent('Repayment$2,800.00 monthly');
    expect(facts).toHaveTextContent('Started15/03/2020 · $450,000.00');
    expect(facts).toHaveTextContent('Offset accountsOffset account · $10,000.00');
    expect(facts).toHaveTextContent('Interest and fees (estimated)$157,100.00');
    expect(facts).toHaveTextContent(
      'Next repayment’s interest$1,904.50on 15/09/2026, from the balance at 31/08/2026',
    );
    expect(facts).toHaveTextContent('Paid off (with the offset)Jan 2046');
    expect(facts).toHaveTextContent('Without the offsetPaid off Sep 2046');
    expect(facts).toHaveTextContent('Interest saved$22,253.498 months sooner with your offset');
    expect(facts).toHaveTextContent(
      'Imported “payments paid”The workbook’s figure: $59,100.00, principal only',
    );
  });

  it('the balance log: the start point first, estimated and entered repayments, the Check badge', async () => {
    await openPage();
    const table = tableNamed(LOG);
    expect(headers(table)).toEqual([
      'As of',
      'Balance',
      'Payments',
      'Repayments',
      'Principal',
      'Interest and fees',
      'Note',
      'Source',
      'Actions',
    ]);
    const rows = bodyRows(table);
    expect(rows).toHaveLength(4);
    const start = rows[0] as HTMLElement;
    expect(cell(table, start, 'As of')).toBe('15/03/2020Loan start');
    expect(cell(table, start, 'Actions')).toBe('Edit it in the loan form');
    const estimated = rowOf(table, '28/02/2026');
    expect(cell(table, estimated, 'Repayments')).toBe('$198,800.00Estimate');
    const entered = rowOf(table, '31/08/2026');
    expect(cell(table, entered, 'Repayments')).toBe('$9,000.00Entered');
    const check = rowOf(table, '31/05/2026');
    const badge = within(check.children[0] as HTMLElement).getByText('Check');
    const note = document.getElementById(
      badge.closest('[aria-describedby]')?.getAttribute('aria-describedby') ?? '',
    );
    expect(note).toHaveTextContent(
      'The estimated repayments are below the principal repaid: enter the actual repayments for that period.',
    );
    // Balances owed and flows stay in body text (only a loss is red).
    expect(table.querySelector('.jf-amount--negative')).toBeNull();
  });

  it('a balance that went up says so in the As of cell', async () => {
    await openPage(propertyPages.twoLoans);
    const table = tableNamed('Balance log: Example top-up loan, 2 entries');
    expect(cell(table, rowOf(table, '31/08/2026'), 'As of')).toContain(
      'Balance went up (a redraw or added costs)',
    );
  });

  it('phone: status-first, the markers in the first cell', async () => {
    emulatePhone();
    await openPage();
    const table = tableNamed(LOG);
    expect(headers(table)).toEqual([
      'As of',
      'Balance',
      'Interest and fees',
      'Repayments',
      'Principal',
      'Payments',
      'Note',
      'Source',
      'Actions',
    ]);
    const first = (date: string) => rowOf(table, date).children[0] as HTMLElement;
    expect(within(first('15/03/2020')).getByText('Loan start')).toBeVisible();
    expect(within(first('28/02/2026')).getByText('Estimate')).toBeVisible();
    expect(within(first('31/05/2026')).getByText('Check')).toBeVisible();
  });

  it('Update balance: the repayments placeholder is the engine’s estimate; empty leaves it out', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/property/loan-balances': { body: loanBalancesResponse },
    });
    await user.click(
      screen.getByRole('button', { name: 'Update the balance of Example property mortgage' }),
    );
    const form = screen.getByRole('form', { name: 'Update balance · Example property mortgage' });
    const asOf = within(form).getByRole('textbox', { name: 'As of' });
    await user.clear(asOf);
    await user.type(asOf, '20/09/2026');
    await user.tab();
    expect(within(form).getByRole('textbox', { name: 'Repayments' })).toHaveAttribute(
      'placeholder',
      'Estimated 2,800.00 (1 payment)',
    );
    await user.type(within(form).getByRole('textbox', { name: /Balance/ }), '387000');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/property/loan-balances')).toHaveLength(1));
    expect(api.calls('PUT /api/property/loan-balances')[0]?.body).toEqual({
      asOf: '2026-09-20',
      entries: [{ loanId: 1, balanceCents: 38700000 }],
    });
  });

  it('Edit entry: the date is fixed; empty repayments go back to the estimate (null)', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/property/loan-balance-entries/3': { body: loanMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit the balance of 31/08/2026' }));
    const form = screen.getByRole('form', {
      name: 'Edit entry · Example property mortgage · 31/08/2026',
    });
    expect(within(form).queryByRole('textbox', { name: 'As of' })).toBeNull();
    const repayments = within(form).getByRole('textbox', { name: 'Repayments' });
    expect(repayments).toHaveAttribute('placeholder', 'Estimated 8,400.00 (3 payments)');
    await user.clear(repayments);
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.calls('PUT /api/property/loan-balance-entries/3')).toHaveLength(1),
    );
    expect(api.calls('PUT /api/property/loan-balance-entries/3')[0]?.body).toEqual({
      balanceCents: 39090000,
      repaymentsCents: null,
      note: null,
    });
    // A workbook entry: the workbook callout.
  });

  it('the page’s Update balances: every loan, optional repayments', async () => {
    const { user, api } = await openPage(propertyPages.twoLoans, {
      'PUT /api/property/loan-balances': { body: loanBalancesResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Update balances' }));
    const form = screen.getByRole('form', { name: 'Update balances' });
    expect(
      within(form).getByRole('textbox', { name: 'Balance, Example property mortgage' }),
    ).toBeVisible();
    const topUp = within(form).getByRole('textbox', { name: 'Balance, Example top-up loan' });
    expect(
      within(form).getByRole('textbox', { name: 'Repayments, Example top-up loan' }),
    ).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/^Estimated [\d,.]+ \(\d+ payments?\)$/),
    );
    await user.clear(topUp);
    await user.type(topUp, '40000');
    await user.type(
      within(form).getByRole('textbox', { name: 'Repayments, Example top-up loan' }),
      '1500',
    );
    await user.click(within(form).getByRole('button', { name: 'Save balances' }));
    await waitFor(() => expect(api.calls('PUT /api/property/loan-balances')).toHaveLength(1));
    expect(api.calls('PUT /api/property/loan-balances')[0]?.body).toMatchObject({
      entries: [{ loanId: 3, balanceCents: 4000000, repaymentsCents: 150000 }],
    });
  });

  it('the loan form: rates as percent, compounding choices, the repayment-change note', async () => {
    const { user, api } = await openPage(populated, {
      'PUT /api/property/loans/1': { body: loanMutationResponse },
    });
    await user.click(screen.getByRole('button', { name: 'Edit Example property mortgage' }));
    const form = screen.getByRole('form', { name: 'Edit loan · Example property mortgage' });
    expect(within(form).getByRole('textbox', { name: 'Interest rate' })).toHaveValue('6');
    const compounding = within(form).getByRole('combobox', { name: 'Interest compounds' });
    expect(compounding).toHaveValue('12');
    expect([...compounding.querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Monthly', 'Fortnightly', 'Weekly', 'Daily']),
    );
    expect(within(form).queryByRole('note', { name: 'Repayment changed' })).toBeNull();
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Repayment frequency' }),
      'fortnightly',
    );
    expect(within(form).getByRole('note', { name: 'Repayment changed' })).toHaveTextContent(
      'Changing the repayment re-estimates every entry without entered repayments. Enter the actual repayments on past entries to keep them.',
    );
    const rate = within(form).getByRole('textbox', { name: 'Interest rate' });
    await user.clear(rate);
    await user.type(rate, '5.89');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /api/property/loans/1')).toHaveLength(1));
    expect(api.calls('PUT /api/property/loans/1')[0]?.body).toMatchObject({
      propertyId: 1,
      annualRate: '0.0589',
      compoundingPerYear: 12,
      paymentFrequency: 'fortnightly',
      paymentCents: 280000,
    });
  });

  it('a stored compounding value outside the choices stays selectable', async () => {
    const fixture: PropertyPageResponse = {
      ...populated,
      loans: populated.loans.map((l) => ({ ...l, compoundingPerYear: 4 })),
    };
    const { user } = await openPage(fixture);
    await user.click(screen.getByRole('button', { name: 'Edit Example property mortgage' }));
    const form = screen.getByRole('form', { name: 'Edit loan · Example property mortgage' });
    const compounding = within(form).getByRole('combobox', { name: 'Interest compounds' });
    expect(compounding).toHaveValue('4');
    expect(within(compounding).getByRole('option', { name: '4 times a year' })).toBeInTheDocument();
  });
});

describe('Property page: deleting a loan (CODE-2)', () => {
  it('unlocks the other cards and announces the delete when the status refetch lands late', async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const twoLoans = propertyPages.twoLoans;
    const gone = twoLoans.loans[1]!;
    const kept = twoLoans.loans[0]!;
    const afterDelete: PropertyPageResponse = {
      ...twoLoans,
      loans: twoLoans.loans.filter((l) => l.id !== gone.id),
      loanEntries: twoLoans.loanEntries.filter((e) => e.loanId !== gone.id),
      properties: twoLoans.properties.map((p) => ({
        ...p,
        loanIds: p.loanIds.filter((id) => id !== gone.id),
      })),
    };
    let deleted = false;
    mockAssets({
      property: () => ({ body: deleted ? afterDelete : twoLoans }),
      routes: {
        // The header's status answers after the page refetch has dropped the loan's card.
        'GET /api/status': async () => {
          if (deleted) await sleep(150);
          return { body: appStatusEmpty };
        },
        [`DELETE /api/property/loans/${gone.id}`]: () => {
          deleted = true;
          return { body: { id: gone.id } };
        },
      },
    });
    const { user } = renderApp('/property');
    await screen.findByRole('group', { name: 'Equity' });
    await user.click(screen.getByRole('button', { name: `Edit ${gone.name}` }));
    const form = screen.getByRole('form', { name: `Edit loan · ${gone.name}` });
    await user.click(within(form).getByRole('button', { name: 'Delete loan' }));
    await user.click(within(form).getByRole('button', { name: `Delete the loan ${gone.name}` }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `Edit ${gone.name}` })).toBeNull(),
    );
    await sleep(400);
    expect(screen.getByRole('button', { name: `Edit ${kept.name}` })).toBeEnabled();
    expect(screen.getByRole('note', { name: 'Saved' })).toHaveTextContent('Loan deleted.');
  });
});

describe('Property page: offsets (D67)', () => {
  it('link an account: the ticked set is sent', async () => {
    const { user, api } = await openPage(propertyPages.unlinkedOffset, {
      'PUT /api/property/loans/1/offsets': { body: loanOffsetsResponse },
    });
    await user.click(
      screen.getByRole('button', { name: 'Link offset accounts to Example property mortgage' }),
    );
    const form = screen.getByRole('form', { name: 'Offset accounts · Example property mortgage' });
    const save = within(form).getByRole('button', { name: 'Save links' });
    expect(save).toBeDisabled();
    await user.click(within(form).getByRole('checkbox', { name: 'Offset account' }));
    await user.click(save);
    await waitFor(() => expect(api.calls('PUT /api/property/loans/1/offsets')).toHaveLength(1));
    expect(api.calls('PUT /api/property/loans/1/offsets')[0]?.body).toEqual({ accountIds: [5] });
    expect(await screen.findByRole('note', { name: 'Saved' })).toHaveTextContent('Offsets linked.');
  });

  it('an account linked to another loan says it moves', async () => {
    const { user } = await openPage(propertyPages.twoLoans);
    await user.click(
      screen.getByRole('button', { name: 'Link offset accounts to Example top-up loan' }),
    );
    const form = screen.getByRole('form', { name: 'Offset accounts · Example top-up loan' });
    expect(form).toHaveTextContent('now linked to Example property mortgage: saving moves it here');
  });

  it('none available: mark one on the Cash page first', async () => {
    const fixture: PropertyPageResponse = { ...propertyPages.unlinkedOffset, offsetAccounts: [] };
    const { user } = await openPage(fixture);
    await user.click(
      screen.getByRole('button', { name: 'Link offset accounts to Example property mortgage' }),
    );
    const form = screen.getByRole('form', { name: 'Offset accounts · Example property mortgage' });
    expect(form).toHaveTextContent('Mark an account as an offset on the Cash page first');
    expect(within(form).getByRole('link', { name: 'go to the Cash page' })).toHaveAttribute(
      'href',
      '/cash',
    );
  });
});

describe('Property page: charts (§5)', () => {
  it('Value and purchase price: Value slot 1, Purchase price slot 2; the offsets foot note', async () => {
    await openPage();
    const card = screen.getByRole('region', { name: 'Value and purchase price' });
    expect(legendOf(card)).toEqual([
      { name: 'Value', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Purchase price', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    expect(card).toHaveTextContent(
      'Past points come from your recorded months; the last point is live.',
    );
    expect(screen.getByRole('region', { name: 'Loan to value' })).toHaveTextContent(
      'Past points are before offsets; the live point is net of your offsets.',
    );
  });

  it('the loan charts: repaid so far (principal 1, interest 2), payoff with and without the offset', async () => {
    await openPage();
    const card = loanCard();
    const repaid = within(card).getByRole('region', { name: 'Repaid so far' });
    expect(legendOf(repaid)).toEqual([
      { name: 'Principal', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Interest and fees', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    const payoff = within(card).getByRole('region', { name: 'Payoff projection' });
    expect(legendOf(payoff)).toEqual([
      { name: 'With your offset', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Without the offset', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    expect(within(card).getByRole('region', { name: 'Loan balance' })).toBeVisible();
  });
});
