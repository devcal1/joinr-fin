import type { CheckStatus, ImportRunDetail, ReconciliationCheck } from '@joinr/schema';
import {
  apiErrors,
  importRunDryRun,
  importRunFailed,
  importRunRunning,
  importRunSucceeded,
  sampleReport,
} from '@joinr/schema/fixtures';
import { formatMoney } from '@joinr/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emulatePhone } from '../../../test/media';
import { apiError, mockApi, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { NEEDS_REVIEW_LABEL, RECONCILED_HINT } from './ImportBadges';
import { CheckValue, NOTHING_NEEDS_ATTENTION, NO_MATCHING_CHECKS } from './ImportRunPage';
import { orderSections, sectionLabel, sectionStartsOpen } from './checks';

const RUN_3 = 'GET /api/import/runs/3';

/** The per-section check tables (captioned "<Section> checks"). */
function sectionTables(): HTMLElement[] {
  return screen
    .queryAllByRole('table')
    .filter((table) => table.querySelector('caption')?.textContent?.endsWith(' checks'));
}

function checkRows(): HTMLElement[] {
  return sectionTables().flatMap((table) => within(table).getAllByRole('row').slice(1));
}

function statusFilters(): HTMLElement {
  return screen.getByRole('group', { name: 'Filter checks by status' });
}

function findStatusFilters(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: 'Filter checks by status' });
}

/** Picks the "All" filter and opens every collapsed section. */
async function showEverything(user: UserEvent): Promise<void> {
  await user.click(within(await findStatusFilters()).getByRole('button', { name: /^All/ }));
  for (const button of screen.queryAllByRole('button', { name: /^Show .* checks$/ })) {
    await user.click(button);
  }
}

function headersOf(table: HTMLElement | undefined): (string | null)[] {
  return within(table as HTMLElement)
    .getAllByRole('columnheader')
    .map((th) => th.textContent);
}

const ATTENTION: ReadonlySet<CheckStatus> = new Set(['unexplained', 'suspect']);
const attentionCount = sampleReport.checks.filter((c) => ATTENTION.has(c.status)).length;

/** A clean run: every check matched or is explained (no suspect, no unexplained). */
const cleanTotals = { ...sampleReport.totals, suspect: 0, unexplained: 0 };
const cleanRun: ImportRunDetail = {
  ...importRunDryRun,
  id: 5,
  totals: cleanTotals,
  report: {
    ...sampleReport,
    totals: cleanTotals,
    checks: sampleReport.checks.filter((c) => !ATTENTION.has(c.status)),
  },
};

describe('ImportRunPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading line with the run number', async () => {
    mockApi({ [RUN_3]: pending });
    renderApp('/import/runs/3');
    expect(await screen.findByRole('heading', { level: 1, name: 'Import' })).toBeInTheDocument();
    expect(
      screen.getByText('Run #3', { selector: '.jf-page-header__subtitle' }),
    ).toBeInTheDocument();
    expect(within(await findMain()).getByRole('status')).toHaveTextContent('Loading run #3');
  });

  it('keeps Import marked in the nav', async () => {
    mockApi({ [RUN_3]: pending });
    renderApp('/import/runs/3');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Import');
  });

  it('shows the totals as tiles with Unexplained as the key figure', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    expect(
      await screen.findByText('Run #3 · example-workbook.xlsx', {
        selector: '.jf-page-header__subtitle',
      }),
    ).toBeInTheDocument();
    const totals = sampleReport.totals;
    const tile = (name: string) => screen.getByRole('group', { name });
    expect(tile('Checks')).toHaveTextContent(String(sampleReport.checks.length));
    expect(tile('Match')).toHaveTextContent(String(totals.match));
    expect(tile('Explained')).toHaveTextContent(String(totals.explained));
    expect(tile('Suspect')).toHaveTextContent(String(totals.suspect));
    expect(tile('Unexplained')).toHaveTextContent(String(totals.unexplained));
    expect(tile('Unexplained')).toHaveClass('jf-stat-tile--key');
    expect(tile('Match')).not.toHaveClass('jf-stat-tile--key');
    // Unexplained above 0 says so in words, beside an alert icon (D33).
    expect(tile('Unexplained')).toHaveTextContent(NEEDS_REVIEW_LABEL);
    expect(tile('Unexplained').querySelector('.jf-app-tile-flag svg')).not.toBeNull();
  });

  it('puts the tiles, then the run facts, then the checks', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    const tile = await screen.findByRole('group', { name: 'Checks' });
    const facts = screen.getByRole('table', { name: 'Run #3' });
    const follows = (a: Node, b: Node): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(tile, facts)).toBe(true);
    expect(follows(facts, statusFilters())).toBe(true);
  });

  it('opens on "Needs attention": the unexplained and suspect checks, every section open', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    const filters = await findStatusFilters();
    const attention = within(filters).getByRole('button', { name: /^Needs attention/ });
    expect(attention).toHaveAttribute('aria-pressed', 'true');
    expect(attention).toHaveTextContent(`Needs attention (${attentionCount})`);
    expect(within(filters).getAllByRole('button')[0]).toBe(attention);
    expect(within(filters).getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const rows = checkRows();
    expect(rows).toHaveLength(attentionCount);
    for (const row of rows) expect(row).toHaveTextContent(/Unexplained|Suspect/);
    expect(screen.queryByRole('button', { name: /^Show .* checks$/ })).toBeNull();
  });

  it('says when nothing needs attention, with a way to show every check', async () => {
    mockApi({ 'GET /api/import/runs/5': { body: cleanRun } });
    const { user } = renderApp('/import/runs/5');
    const note = await screen.findByRole('note', { name: 'All clear' });
    expect(note).toHaveClass('jf-callout--note');
    expect(note).toHaveTextContent(NOTHING_NEEDS_ATTENTION);
    expect(checkRows()).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Unexplained' })).toHaveTextContent(RECONCILED_HINT);
    await user.click(within(note).getByRole('button', { name: 'Show all checks' }));
    expect(within(statusFilters()).getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('note', { name: 'All clear' })).not.toBeInTheDocument();
    expect(sectionTables().length).toBeGreaterThan(0);
  });

  it('collapses the sections with only match and info lines under "All"', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    await user.click(within(await findStatusFilters()).getByRole('button', { name: /^All/ }));

    // Workbook has two matches: collapsed, showing its name and counts but not its table.
    const workbook = screen
      .getByRole('heading', { level: 3, name: 'Workbook · 2' })
      .closest('section') as HTMLElement;
    expect(workbook).toHaveTextContent('2 match');
    const show = within(workbook).getByRole('button', { name: 'Show Workbook checks' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(within(workbook).queryByRole('table')).toBeNull();
    const body = document.getElementById(show.getAttribute('aria-controls') ?? '');
    expect(body).not.toBeNull();
    expect(body).not.toBeVisible();

    // Holdings has an unexplained line: open.
    const holdings = screen
      .getByRole('heading', { level: 3, name: /^Holdings/ })
      .closest('section') as HTMLElement;
    expect(holdings).toHaveTextContent('1 unexplained · 1 explained · 1 match · 1 info');
    const hide = within(holdings).getByRole('button', { name: 'Hide Holdings checks' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(within(holdings).getByRole('table', { name: 'Holdings checks' })).toBeInTheDocument();

    const sections = orderSections(sampleReport.checks.map((c) => c.section));
    const open = sections.filter((id) =>
      sectionStartsOpen(
        sampleReport.checks.filter((c) => c.section === id),
        'all',
      ),
    );
    expect(open.length).toBeLessThan(sections.length);
    expect(sectionTables()).toHaveLength(open.length);

    // The reader can open and close any section.
    await user.click(show);
    expect(within(workbook).getByRole('button', { name: 'Hide Workbook checks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(workbook).getByRole('table', { name: 'Workbook checks' })).toBeVisible();
    await user.click(hide);
    expect(within(holdings).queryByRole('table')).toBeNull();
  });

  it('opens every section under a single-status filter such as Match', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    await user.click(within(await findStatusFilters()).getByRole('button', { name: /^Match/ }));
    // Workbook has only matches: collapsed under "All", open here.
    expect(screen.getByRole('button', { name: 'Hide Workbook checks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByRole('button', { name: /^Show .* checks$/ })).toBeNull();
    expect(checkRows()).toHaveLength(sampleReport.totals.match);
  });

  it('orders the report columns status-first on a phone', async () => {
    emulatePhone();
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    await findStatusFilters();
    expect(headersOf(sectionTables()[0])).toEqual([
      'Check',
      'Status',
      'Diff',
      'Expected',
      'Actual',
      'Sheet ref',
      'Reason',
    ]);
  });

  it('keeps the sheet order on wider screens', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    await findStatusFilters();
    expect(headersOf(sectionTables()[0])).toEqual([
      'Check',
      'Sheet ref',
      'Expected',
      'Actual',
      'Diff',
      'Status',
      'Reason',
    ]);
  });

  it('groups checks by section with formatted values and status badges', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    await showEverything(user);
    const sections = orderSections(sampleReport.checks.map((c) => c.section));
    for (const section of sections) {
      const count = sampleReport.checks.filter((c) => c.section === section).length;
      expect(
        screen.getByRole('heading', { level: 3, name: `${sectionLabel(section)} · ${count}` }),
      ).toBeInTheDocument();
    }
    expect(checkRows()).toHaveLength(sampleReport.checks.length);

    const units = screen
      .getByText('ASX:XYZ units', { selector: 'th' })
      .closest('tr') as HTMLElement;
    expect(within(units).getByText('ETFs!F2')).toBeInTheDocument();
    expect(within(units).getByText('29.5')).toBeInTheDocument();
    expect(within(units).getByText('−0.5')).toBeInTheDocument();
    expect(within(units).getByText('Unexplained').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'stop',
    );

    const value = screen.getByText('ETF value', { selector: 'th' }).closest('tr') as HTMLElement;
    // Actual and diff are the same figure; expected is $0.00.
    const etfValue = sampleReport.checks.find((c) => c.id === 'holdings.value.etf')!;
    const shown = formatMoney(Number(etfValue.actual));
    expect(within(value).getAllByText(shown, { selector: '.jf-amount' })).toHaveLength(2);
    expect(within(value).getByText('$0.00', { selector: '.jf-amount' })).toBeInTheDocument();
    expect(within(value).getByText('Explained').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'recorded',
    );

    const info = screen.getByText('Stocks gain', { selector: 'th' }).closest('tr') as HTMLElement;
    expect(within(info).getByText('Info')).toHaveClass('jf-pill--na');

    const suspect = screen
      .getByText('Dividend ticker ZZZ', { selector: 'th' })
      .closest('tr') as HTMLElement;
    expect(within(suspect).getByText('Suspect').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'check',
    );

    const match = screen.getByText('Cash total', { selector: 'th' }).closest('tr') as HTMLElement;
    expect(within(match).getByText('Match').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'go',
    );

    const excluded = screen
      .getByText('Silver futures feed row', { selector: 'th' })
      .closest('tr') as HTMLElement;
    expect(excluded).toHaveTextContent('(D23)');
  });

  it('filters by status with pressed buttons that show their counts', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    const filters = await findStatusFilters();
    const all = within(filters).getByRole('button', { name: /^All/ });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(all).toHaveTextContent(`All (${sampleReport.checks.length})`);

    const suspect = within(filters).getByRole('button', { name: /^Suspect/ });
    expect(suspect).toHaveTextContent(`Suspect (${sampleReport.totals.suspect})`);
    await user.click(suspect);
    expect(suspect).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    const rows = checkRows();
    expect(rows).toHaveLength(sampleReport.totals.suspect);
    for (const row of rows) expect(within(row).getByText('Suspect')).toBeInTheDocument();

    await user.click(within(filters).getByRole('button', { name: /^Unexplained/ }));
    expect(checkRows()).toHaveLength(sampleReport.totals.unexplained);
  });

  it('filters by section, and says when nothing matches', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    const select = await screen.findByRole('combobox', { name: 'Section' });
    await user.selectOptions(select, 'holdings');
    // "Needs attention" within Holdings: its one unexplained line.
    expect(checkRows()).toHaveLength(1);
    const filters = statusFilters();
    const holdings = sampleReport.checks.filter((c) => c.section === 'holdings');
    // Counts follow the section.
    expect(within(filters).getByRole('button', { name: /^All/ })).toHaveTextContent(
      `All (${holdings.length})`,
    );
    await user.click(within(filters).getByRole('button', { name: /^All/ }));
    expect(checkRows()).toHaveLength(holdings.length);
    await user.click(within(filters).getByRole('button', { name: /^Suspect/ }));
    expect(checkRows()).toHaveLength(0);
    expect(screen.getByText(NO_MATCHING_CHECKS)).toBeInTheDocument();

    // "Needs attention" in a section with nothing to review says so for that section.
    await user.selectOptions(select, 'cash');
    await user.click(within(filters).getByRole('button', { name: /^Needs attention/ }));
    expect(screen.getByRole('note', { name: 'All clear' })).toHaveTextContent(
      'Nothing in Cash needs attention.',
    );
  });

  it('shows the run facts', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    renderApp('/import/runs/3');
    const facts = await screen.findByRole('table', { name: 'Run #3' });
    // Succeeded with unexplained checks: an orange "Needs review" badge, not green (D33).
    expect(within(facts).getByText('Needs review').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'check',
    );
    expect(within(facts).queryByText('Succeeded')).toBeNull();
    expect(within(facts).getByText('31/08/2026')).toHaveClass('jf-app-num--inline');
    // One left-aligned value column: no right-aligned numeric cells.
    expect(facts.querySelector('.jf-kv__value--num, .jf-table__cell--num')).toBeNull();
    expect(within(facts).getByText('import-corrections.json')).toBeInTheDocument();
    expect(within(facts).getByText('Upload')).toBeInTheDocument();
  });

  it('notes a preview', async () => {
    mockApi({ 'GET /api/import/runs/2': { body: importRunDryRun } });
    renderApp('/import/runs/2');
    expect(await screen.findByText('This was a preview: nothing was saved.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Unexplained' })).toHaveTextContent('0');
    // A clean run keeps the green Succeeded badge.
    const facts = screen.getByRole('table', { name: 'Run #2' });
    expect(within(facts).getByText('Succeeded').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'go',
    );
  });

  it('shows a failed run with its error and no report', async () => {
    mockApi({ 'GET /api/import/runs/1': { body: importRunFailed } });
    renderApp('/import/runs/1');
    const callout = await screen.findByRole('note', { name: 'Import failed' });
    expect(callout).toHaveTextContent('Missing required sheet "History"');
    expect(callout).toHaveTextContent('Code INVALID_WORKBOOK');
    expect(screen.queryByRole('group', { name: 'Unexplained' })).not.toBeInTheDocument();
    // The run facts still show without a report.
    expect(screen.getByRole('table', { name: 'Run #1' })).toHaveTextContent('Failed');
  });

  it('shows a running run and polls until it finishes', async () => {
    let calls = 0;
    mockApi({
      'GET /api/import/runs/4': () => {
        calls += 1;
        return { body: calls === 1 ? importRunRunning : { ...importRunSucceeded, id: 4 } };
      },
    });
    renderApp('/import/runs/4');
    expect(await screen.findByText(/This import is still running/)).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole('group', { name: 'Unexplained' })).toBeInTheDocument(),
      {
        timeout: 4000,
      },
    );
  });

  it('says a missing run does not exist, with a way back and no retry', async () => {
    mockApi({ 'GET /api/import/runs/9': apiError(404, apiErrors.notFound) });
    renderApp('/import/runs/9');
    const note = await screen.findByRole('note', { name: 'Run not found' });
    expect(note).toHaveTextContent('There is no run #9.');
    expect(within(note).getByRole('link', { name: 'See all imports' })).toHaveAttribute(
      'href',
      '/import',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry when the run cannot be loaded for another reason', async () => {
    mockApi({ 'GET /api/import/runs/9': apiError(500, apiErrors.internal) });
    renderApp('/import/runs/9');
    const note = await screen.findByRole('note', { name: 'Could not load run #9' });
    expect(within(note).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('sets figures in mono and words in the body face in the value columns', async () => {
    mockApi({ [RUN_3]: { body: importRunSucceeded } });
    const { user } = renderApp('/import/runs/3');
    await showEverything(user);
    const cellsOf = (label: string) =>
      within(screen.getByText(label, { selector: 'th' }).closest('tr') as HTMLElement).getAllByRole(
        'cell',
      );
    // Columns after the row header: Sheet ref, Expected, Actual, Diff, Status, Reason.
    const [, textExpected] = cellsOf('Template version');
    expect(textExpected).toHaveTextContent('2.15.4');
    expect(textExpected?.querySelector('.jf-app-num')).toBeNull();
    expect(textExpected?.querySelector('.jf-app-text-value')).not.toBeNull();
    expect(textExpected).not.toHaveClass('jf-table__cell--num');
    const [, centsExpected] = cellsOf('Cash total');
    expect(centsExpected?.querySelector('.jf-app-num')).not.toBeNull();
    const [, dateExpected] = cellsOf('Workbook as-of date');
    expect(dateExpected?.querySelector('.jf-app-num--inline')).not.toBeNull();
  });

  it.each(['abc', '0', '07', '-1'])('shows "Page not found" for run id %s', async (id) => {
    mockApi();
    renderApp(`/import/runs/${id}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('CheckValue', () => {
  it('shows review flags as words', () => {
    const check = {
      id: 'suspects.trades.ETFs!A24',
      section: 'suspects',
      label: 'Trade ETFs!A24 flagged',
      sheetRef: 'ETFs!A24',
      unit: 'text',
      expected: null,
      actual: 'out_of_order, price_outlier',
      diff: null,
      status: 'suspect',
      reasonCode: 'suspect_row',
      reason: null,
      refs: { flags: ['out_of_order', 'price_outlier'] },
    } satisfies ReconciliationCheck;
    render(<CheckValue check={check} field="actual" />);
    expect(screen.getByText('Out of order, Price outlier')).toBeInTheDocument();
  });
});
