// The Settings page (stage-5.md §6.5, §6.9, §7.7 step 3; D84–D86, D90, D91, D95) against the
// @joinr/schema fixtures: every group and field type, the hints (default and origin), the
// one-or-the-other callout, the preference and app-only notes, the tax suggestion per Medicare band
// with its buttons filling the field without saving, the "suggested" label and "In use", the LITO
// line, the allocation sum, the auto-record switch (the record hour, the D84 note, the env lock),
// the features note, the unused group (editable, the workbook callout, "Not used by the app"), the
// used-on links, the pristine/pending Save sending only the changed keys, errors by path, the hash
// target and the phone "Jump to".
import { SETTING_GROUPS, type SettingsPageResponse } from '@joinr/schema';
import { apiErrors, autoRecordPatchResponse, settingsPages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockOverview } from '../../../test/history';
import { emulatePhone } from '../../../test/media';
import { apiError, pending, type MockHandler } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

const populated = settingsPages.populated;

async function openPage(
  fixture: SettingsPageResponse = populated,
  routes: Record<string, MockHandler> = {},
  path = '/settings',
) {
  const api = mockOverview({ settings: fixture, routes });
  const view = renderApp(path);
  await screen.findByRole('heading', { level: 2, name: 'Pay and tax' });
  return { ...view, api };
}

/** A group's section (labelled by its section bar). */
function group(label: string): HTMLElement {
  return screen.getByRole('region', { name: label });
}

function form(label: string): HTMLElement {
  return within(group(label)).getByRole('form', { name: `${label} settings` });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings: states and groups (§6.5 items 1–2, §6.9)', () => {
  it.each(Object.entries(settingsPages))('renders the %s fixture', async (_name, fixture) => {
    await openPage(fixture);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    for (const g of SETTING_GROUPS) {
      expect(screen.getByRole('heading', { level: 2, name: g.label })).toHaveAttribute('id', g.id);
    }
    expect(screen.getByRole('main')).not.toHaveTextContent('Stage 5');
  });

  it('loading', async () => {
    mockOverview({ settings: pending });
    renderApp('/settings');
    expect(await screen.findByText('Loading settings…')).toBeVisible();
  });

  it('an in-page index of the groups; on a phone a "Jump to" disclosure', async () => {
    const { unmount } = await openPage();
    const index = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(index).getByRole('link', { name: 'Pay and tax' })).toHaveAttribute(
      'href',
      '#pay',
    );
    unmount();
    emulatePhone();
    await openPage();
    const jump = screen.getByTestId('settings-jump');
    expect(jump.tagName).toBe('DETAILS');
    expect(jump).toHaveTextContent('Jump to');
    expect(screen.queryByRole('combobox', { name: /jump/i })).toBeNull();
  });

  it('/settings#pay focuses the group heading once loaded', async () => {
    await openPage(populated, {}, '/settings#pay');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Pay and tax' })).toHaveFocus(),
    );
  });
});

describe('Settings: fields (§6.5 item 2)', () => {
  it('a field per key by type, labelled with the registry label', async () => {
    await openPage();
    const pay = form('Pay and tax');
    expect(within(pay).getByRole('combobox', { name: 'Pay frequency' })).toHaveDisplayValue(
      'Fortnightly',
    );
    expect(within(pay).getByRole('textbox', { name: 'Net pay per pay' })).toHaveValue('3,000.00');
    expect(within(pay).getByRole('textbox', { name: 'Pay day (day of the month)' })).toHaveValue(
      '15',
    );
    expect(within(pay).getByRole('textbox', { name: 'Job start date' })).toHaveValue('06/01/2020');
    expect(within(pay).getByRole('textbox', { name: 'Marginal tax rate' })).toHaveValue('32');
    const budget = form('Budget');
    expect(
      within(budget).getByRole('switch', { name: 'Use the budget for the amount to invest' }),
    ).toBeChecked();
  });

  it('hints give the default and where the value came from', async () => {
    await openPage();
    const history = form('History and charts');
    expect(
      within(history).getByRole('combobox', { name: 'Chart grouping' }),
    ).toHaveAccessibleDescription(/Default: Monthly/);
    expect(
      within(history).getByRole('textbox', { name: 'Groups shown in charts' }),
    ).toHaveAccessibleDescription(/Blank = automatic: 12 months, 8 quarters or every year/);
    const pay = form('Pay and tax');
    expect(
      within(pay).getByRole('textbox', { name: 'Net pay per pay' }),
    ).toHaveAccessibleDescription(/From the workbook/);
    const app = populated.settings.find((s) => s.workbook && s.origin === 'app');
    if (app) {
      const section = screen
        .getByRole('heading', {
          level: 2,
          name: SETTING_GROUPS.find((g) => g.id === app.group)?.label ?? '',
        })
        .closest('section') as HTMLElement;
      expect(section).toHaveTextContent('Changed in the app');
    }
  });

  it('the pages that use a key are links; the unused keys say so', async () => {
    await openPage();
    const used = screen.getByTestId('used-on-pay.dayOfMonth');
    expect(within(used).getByRole('link', { name: 'Budget' })).toHaveAttribute('href', '/budget');
    expect(form('Kept from the workbook (editable, not used by the app)')).toHaveTextContent(
      'Not used by the app',
    );
  });

  it('the server-written cap FY is read-only beside the cap', async () => {
    await openPage();
    expect(within(form('Super')).getByTestId('readonly-super.concessionalCapFy')).toBeVisible();
    expect(
      within(form('Super')).queryByRole('textbox', {
        name: 'Concessional cap override: financial year',
      }),
    ).toBeNull();
  });
});

describe('Settings: callouts (§6.5 item 2, D34, D95)', () => {
  it('a workbook group shows the workbook callout; an app-only or preference group the import-safe note', async () => {
    await openPage();
    expect(
      within(form('Pay and tax')).getByRole('note', { name: 'From the workbook' }),
    ).toHaveTextContent(
      'Saving counts as an app edit: re-importing the workbook will then be blocked.',
    );
    for (const label of ['History and charts', 'Pages', 'Other assets']) {
      expect(within(form(label)).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
        'Kept when you re-import',
      );
      expect(within(form(label)).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    }
  });

  it('one or the other: editing only an app-only key of a mixed group shows the import-safe note', async () => {
    const { user } = await openPage();
    const cash = form('Cash and savings');
    expect(within(cash).getByRole('note', { name: 'From the workbook' })).toBeVisible();
    await user.selectOptions(
      within(cash).getByRole('combobox', { name: 'Year basis' }),
      'calendar',
    );
    expect(within(cash).queryByRole('note', { name: 'From the workbook' })).toBeNull();
    expect(within(cash).getByRole('note', { name: 'Import-safe' })).toBeVisible();
  });

  it('the unused group is editable with the workbook callout and its note (D91)', async () => {
    await openPage();
    const unused = form('Kept from the workbook (editable, not used by the app)');
    expect(unused).toHaveTextContent(
      "The app does not use these; they are kept so the workbook's settings stay complete.",
    );
    expect(within(unused).getByRole('textbox', { name: 'House price target' })).toBeEnabled();
    expect(within(unused).getByRole('note', { name: 'From the workbook' })).toBeVisible();
  });

  it('pages: the feature switches with their note', async () => {
    await openPage(settingsPages.featuresOff);
    const pages = form('Pages');
    expect(pages).toHaveTextContent('Hidden pages still count in your net worth.');
    expect(within(pages).getByRole('switch', { name: 'Show the Crypto page' })).not.toBeChecked();
    expect(within(pages).getByRole('switch', { name: 'Show the Cash page' })).toBeChecked();
  });

  it('FIRE: editable with its note, in present tense (stage-6.md §6.7–6.8)', async () => {
    await openPage();
    const fire = form('FIRE');
    expect(fire).toHaveTextContent(
      'Used by the FIRE planner; its what-if panel can save them too.',
    );
    expect(fire).not.toHaveTextContent('Stage 6');
    // Every fire.* key is a preference: the import-safe note, never the workbook callout (D103).
    expect(within(fire).getByRole('note', { name: 'Import-safe' })).toHaveTextContent(
      'Kept when you re-import.',
    );
    expect(within(fire).queryByRole('note', { name: 'From the workbook' })).toBeNull();
  });

  it("FIRE: a setting's notice is a muted line under its field, with used-on links to FIRE (§6.7)", async () => {
    const notice =
      'Access age changed from 65 (the workbook) to 60 on 27 September 2026: 60 is the preservation age for anyone born after 30 June 1964.';
    const fixture: SettingsPageResponse = {
      ...populated,
      settings: populated.settings.map((s) =>
        s.key === 'fire.preservationAge'
          ? { ...s, notice, usedOn: ['fire'] }
          : s.group === 'fire'
            ? { ...s, usedOn: ['fire'] }
            : s,
      ),
    };
    await openPage(fixture);
    const fire = form('FIRE');
    const line = within(fire).getByTestId('notice-fire.preservationAge');
    expect(line).toHaveTextContent(notice);
    expect(line).toHaveClass('jf-app-meta');
    // Under the field: after the input in the setting's block.
    const input = within(fire).getByRole('textbox', { name: /Access age/ });
    expect(input.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(fire).queryAllByTestId(/^notice-/)).toHaveLength(1);
    const usedOn = within(fire).getByTestId('used-on-fire.preservationAge');
    expect(within(usedOn).getByRole('link', { name: 'FIRE' })).toHaveAttribute('href', '/fire');
  });
});

describe('Settings: the tax suggestion (§6.5 item 3, D85, D90)', () => {
  it('full band: the bracket plus the levy is suggested; "In use" when it is the current rate', async () => {
    await openPage();
    const tax = screen.getByTestId('tax-suggestion');
    expect(tax).toHaveTextContent(
      'For a gross salary of $100,000 in FY2026–27: the 30% bracket plus the 2% Medicare levy = 32%',
    );
    expect(within(tax).getByRole('button', { name: 'In use (suggested)' })).toBeDisabled();
    expect(within(tax).getByRole('button', { name: 'Use 30% (without the levy)' })).toBeEnabled();
    expect(tax).toHaveTextContent('ATO rates checked 26/09/2026');
    expect(tax).toHaveTextContent(
      "The 2026–27 Medicare threshold is not out yet; using 2025–26's.",
    );
  });

  it('a button fills the field without saving', async () => {
    const { user, api } = await openPage();
    const pay = form('Pay and tax');
    await user.click(within(pay).getByRole('button', { name: 'Use 30% (without the levy)' }));
    expect(within(pay).getByRole('textbox', { name: 'Marginal tax rate' })).toHaveValue('30');
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
    expect(within(pay).getByRole('button', { name: 'In use (without the levy)' })).toBeDisabled();
    expect(within(pay).getByRole('button', { name: 'Use 32% (suggested)' })).toBeEnabled();
    expect(within(pay).getByRole('button', { name: 'Save pay and tax' })).toBeEnabled();
  });

  it('shade-in band', async () => {
    await openPage(settingsPages.taxShadeIn);
    const tax = screen.getByTestId('tax-suggestion');
    expect(tax).toHaveTextContent(
      'the 15% bracket plus the Medicare levy shade-in (10c per dollar between $28,011 and $35,014) = 25%; the full 2% applies above $35,014',
    );
    expect(within(tax).getAllByRole('button', { name: /^Use / })).toHaveLength(2);
  });

  it('no levy: the bracket alone and one button', async () => {
    await openPage(settingsPages.taxNoLevy);
    const tax = screen.getByTestId('tax-suggestion');
    expect(tax).toHaveTextContent('the 15% bracket; no Medicare levy below $28,011');
    expect(within(tax).getAllByRole('button', { name: /^Use / })).toHaveLength(1);
    expect(within(tax).getByRole('button', { name: 'Use 15%' })).toBeVisible();
  });

  it('the LITO line in its phase-out range', async () => {
    await openPage(settingsPages.taxLito);
    expect(screen.getByTestId('tax-suggestion')).toHaveTextContent(
      'The low income tax offset is not included: between $37,500 and $66,667 it adds up to 5 points to your true marginal rate.',
    );
  });

  it('the suggested rate is bold and the FY label never breaks, per band (STYLE-8)', async () => {
    for (const [fixture, rate] of [
      [settingsPages.populated, '32%'],
      [settingsPages.taxShadeIn, '25%'],
      [settingsPages.taxNoLevy, null],
    ] as const) {
      const { unmount } = await openPage(fixture);
      const text = screen.getByTestId('tax-suggestion-text');
      const strong = text.querySelector('strong');
      if (rate === null) expect(strong).toBeNull();
      else {
        expect(strong).toHaveTextContent(rate);
        expect(strong).toHaveClass('jf-app-strong');
      }
      expect(text.querySelector('.jf-app-nowrap')).toHaveTextContent('FY2026–27');
      unmount();
    }
  });

  it('phone: the "Use N%" buttons sit in the full-width container (STYLE-8)', async () => {
    emulatePhone();
    await openPage();
    const actions = screen.getByTestId('tax-actions');
    expect(actions).toHaveClass('jf-app-tax-actions');
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
  });

  it('no salary: no suggestion', async () => {
    await openPage(settingsPages.noSalary);
    expect(screen.getByTestId('tax-suggestion-none')).toHaveTextContent(
      'Set your gross salary to see a suggestion',
    );
  });
});

describe('Settings: allocation, history and saving (§6.5 items 4–5)', () => {
  it("the targets' sum is live: 100 % (go) or not (check)", async () => {
    const { user, unmount } = await openPage();
    expect(screen.getByTestId('allocation-sum')).toHaveTextContent('Targets add up to 100%');
    expect(screen.getByTestId('allocation-sum')).toHaveClass('jf-app-sum--go');
    const field = within(form('Allocation targets')).getByRole('textbox', {
      name: 'Target allocation: ETFs',
    });
    await user.clear(field);
    await user.type(field, '52');
    await user.tab();
    expect(screen.getByTestId('allocation-sum')).toHaveTextContent(
      'Targets add up to 102%: they should total 100%',
    );
    unmount();
    await openPage(settingsPages.unbalanced);
    expect(screen.getByTestId('allocation-sum')).toHaveClass('jf-app-sum--check');
  });

  it('the auto-record switch reads the record hour; the D84 note while there is no app data', async () => {
    const { unmount } = await openPage({ ...populated, hasAppData: false });
    const history = form('History and charts');
    expect(
      within(history).getByRole('switch', {
        name: 'Record each month automatically on its last day at 23:00, server time',
      }),
    ).toBeChecked();
    expect(history).toHaveTextContent(
      'Recorded months are app data: once a month is recorded, re-importing the workbook is blocked. Switch this on when you stop using the workbook.',
    );
    unmount();
    await openPage(populated);
    expect(form('History and charts')).not.toHaveTextContent('Recorded months are app data');
  });

  it('set by the server: the switch is disabled and says so', async () => {
    await openPage(settingsPages.envLocked);
    const toggle = within(form('History and charts')).getByRole('switch', {
      name: /Record each month automatically/,
    });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription('Set by the server (AUTO_RECORD)');
  });

  it('Save is disabled while pristine and sends only the changed keys', async () => {
    const { user, api } = await openPage(populated, {
      'PATCH /api/settings': { body: autoRecordPatchResponse },
    });
    const history = form('History and charts');
    const save = within(history).getByRole('button', { name: 'Save history and charts' });
    expect(save).toBeDisabled();
    await user.click(within(history).getByRole('switch', { name: /Record each month/ }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.calls('PATCH /api/settings')).toHaveLength(1));
    expect(api.calls('PATCH /api/settings')[0]?.body).toEqual({
      values: { 'history.autoRecord': false },
    });
    expect(await screen.findByRole('status', { name: 'Save result' })).toHaveTextContent(
      'Settings saved',
    );
  });

  it('a validation error is mapped to its field', async () => {
    const { user } = await openPage(populated, {
      'PATCH /api/settings': apiError(400, {
        error: { code: 'VALIDATION_ERROR', message: 'values.pay.netPayCents: is too large' },
      }),
    });
    const pay = form('Pay and tax');
    const net = within(pay).getByRole('textbox', { name: 'Net pay per pay' });
    await user.clear(net);
    await user.type(net, '3100');
    await user.tab();
    await user.click(within(pay).getByRole('button', { name: 'Save pay and tax' }));
    await waitFor(() => expect(net).toHaveAccessibleDescription(/Is too large/));
  });

  it('another error shows as a form callout', async () => {
    const { user } = await openPage(populated, {
      'PATCH /api/settings': apiError(409, apiErrors.recordInProgress),
    });
    const history = form('History and charts');
    await user.click(within(history).getByRole('switch', { name: /Record each month/ }));
    await user.click(within(history).getByRole('button', { name: 'Save history and charts' }));
    expect(await within(history).findByRole('note', { name: 'Not saved' })).toBeVisible();
  });
});
