// The Net Worth dashboard (stage-5.md §5, §6.3, §6.8, §6.9, §7.7 step 3) against the
// @joinr/schema fixtures: every state renders, the hero (one teal figure, the deltas with arrow,
// word and tint), the callouts (D84, D94), assets − liabilities = net worth on screen, the donut
// (eight slices, no "Other", D93; the centre label; the exclusion note), the gauge, the allocation,
// the view switch (the query, nothing saved, no Loading line), the chart titles and live note, the
// class colours on every chart, the trend captions and the rolling table.
import {
  NET_WORTH_CLASS_SLOTS,
  NET_WORTH_STACK_ORDER,
  type NetWorthPageResponse,
} from '@joinr/schema';
import { netWorthPages } from '@joinr/schema/fixtures';
import { CHART_OTHER, CHART_PALETTE } from '@joinr/ui';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legendOf, rgbOf } from '../../../test/assets';
import { centsOf } from '../../../test/cashflow';
import { mockOverview } from '../../../test/history';
import { cell, headers, rowOf, totalRow } from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { pending } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';
import { ROLLING_ORDER_KEY } from './RollingSection';
import { allocationDifferenceText } from './netWorthText';

const populated = netWorthPages.populated;

async function openPage(fixture: NetWorthPageResponse = populated, routes = {}) {
  const api = mockOverview({ netWorth: fixture, routes });
  const view = renderApp('/');
  await screen.findByRole('group', { name: 'Net worth' });
  return { ...view, api };
}

function tile(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

function card(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** The hex slot colour of a stack class. */
function slot(key: keyof typeof NET_WORTH_CLASS_SLOTS): string {
  return CHART_PALETTE[NET_WORTH_CLASS_SLOTS[key] - 1] ?? '';
}

const STACK_NAMES: Record<keyof typeof NET_WORTH_CLASS_SLOTS, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  crypto: 'Crypto',
  cash: 'Cash',
  managed_fund: 'Managed funds',
  other_assets: 'Other assets',
  super: 'Super',
  property: 'Property equity',
};

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});

describe('Net Worth: states (§6.9)', () => {
  it.each(Object.entries(netWorthPages))('renders the %s fixture', async (_name, fixture) => {
    mockOverview({ netWorth: fixture });
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Net worth' })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Net worth summary' })).toBeVisible();
    for (const title of ['Where it stands', 'Over time', 'Rolling net worth']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    // stage-5.md §6.7: no page shows "Stage 5".
    expect(screen.getByRole('main')).not.toHaveTextContent('Stage 5');
  });

  it('loading, then an error with Retry', async () => {
    mockOverview({ netWorth: pending });
    const { unmount } = renderApp('/');
    expect(await screen.findByText('Loading net worth…')).toBeVisible();
    unmount();
    mockOverview({
      netWorth: { status: 500, body: { error: { code: 'INTERNAL', message: 'Boom' } } },
    });
    renderApp('/');
    const error = await screen.findByRole('note', { name: 'Could not load net worth' });
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('no data at all: the brand empty screen with links', async () => {
    mockOverview({
      netWorth: {
        ...netWorthPages.noSnapshots,
        assetsCents: 0,
        liabilitiesCents: 0,
        rolling: [],
      },
    });
    renderApp('/');
    expect(
      await screen.findByText('Import the workbook or add accounts to see your net worth'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Import the workbook' })).toHaveAttribute(
      'href',
      '/import',
    );
  });
});

describe('Net Worth: header and hero (§6.3 items 1–2)', () => {
  it('Record month links to /history#record while a month is recordable; History always', async () => {
    await openPage();
    expect(screen.getByRole('link', { name: 'Record month' })).toHaveAttribute(
      'href',
      '/history#record',
    );
    const header = screen
      .getByRole('heading', { level: 1 })
      .closest('.jf-page-header') as HTMLElement;
    expect(within(header).getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/history',
    );
  });

  it('no Record month action when nothing is recordable', async () => {
    await openPage(netWorthPages.recordedToday);
    expect(screen.queryByRole('link', { name: 'Record month' })).toBeNull();
  });

  it('four tiles; net worth is the one teal figure', async () => {
    const { container } = await openPage();
    expect(container.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Net worth')).toHaveClass('jf-stat-tile--key');
    expect(tile('Net worth')).toHaveTextContent('$496,810');
    expect(tile('Net worth')).toHaveTextContent('Live · 24/09/2026');
    expect(tile('Liquid assets')).toHaveTextContent('$89,360');
    expect(tile('Liquid assets')).toHaveTextContent('Excludes super and property');
    const hero = screen.getByRole('region', { name: 'Net worth summary' });
    expect(within(hero).getAllByRole('group')).toHaveLength(4);
  });

  it('the changes carry an arrow, a word and the go tint; no literal arrows in the text', async () => {
    await openPage();
    const since = tile('Since Aug 2026');
    expect(since).toHaveTextContent('+$4,500');
    expect(since).toHaveTextContent('0.9%');
    expect(since).toHaveTextContent('up since 31/08/2026');
    expect(since.querySelector('.jf-stat-tile__delta--go')).not.toBeNull();
    expect(since.querySelector('.jf-stat-tile__delta svg')).not.toBeNull();
    const year = tile('This FY');
    expect(year).toHaveTextContent('+$28,100');
    expect(year).toHaveTextContent('6.0%');
    expect(year).toHaveTextContent('up since 30/06/2026');
    for (const t of [since, year]) expect(t.textContent).not.toMatch(/[▲▼]/);
    // At most one line under each figure: the delta, no hint.
    expect(since.querySelector('.jf-stat-tile__hint')).toBeNull();
  });

  it('a fall uses the stop tint on the figure and the delta', async () => {
    await openPage({
      ...populated,
      sinceLastRecord: { ...populated.sinceLastRecord, cents: -80_000, ratio: '-0.0016' },
    });
    const since = tile('Since Aug 2026');
    expect(within(since).getByText('−$800')).toHaveClass('jf-app-negative');
    expect(since.querySelector('.jf-stat-tile__delta--stop')).not.toBeNull();
    expect(since).toHaveTextContent('0.2%');
    expect(since).toHaveTextContent('down since 31/08/2026');
  });

  it('no snapshots: the changes are "—" with their hints; recorded today says so', async () => {
    const { unmount } = await openPage(netWorthPages.noSnapshots);
    expect(tile('Since last record')).toHaveTextContent('—No recorded month yet');
    expect(tile('This FY')).toHaveTextContent('—No month recorded before 1 July');
    unmount();
    await openPage(netWorthPages.recordedToday);
    expect(tile('Net worth')).toHaveTextContent('Recorded today');
  });

  it('the calendar basis names the tile "This year"', async () => {
    await openPage(netWorthPages.calendarYear);
    expect(tile('This year')).toBeVisible();
  });
});

describe('Net Worth: callouts (§6.3 item 3, D84, D94)', () => {
  it('no months recorded: a note that points to the History page', async () => {
    await openPage(netWorthPages.noSnapshots);
    const note = screen.getByRole('note', { name: 'No recorded months' });
    expect(note).toHaveTextContent(
      'No months recorded yet. Changes and history start after the first recorded month; record one on the History page.',
    );
    expect(within(note).getByRole('link', { name: 'History page' })).toHaveAttribute(
      'href',
      '/history',
    );
  });

  it('an ended month unrecorded with auto-record off: a Note while there is no app data', async () => {
    await openPage(netWorthPages.autoRecordOffNoAppData);
    const note = screen.getByRole('note', { name: 'Not recorded in the app' });
    expect(note).toHaveClass('jf-callout--note');
    expect(note).toHaveTextContent(
      'Aug 2026 is not recorded in the app. Recording adds app data and blocks re-importing the workbook: keep using the workbook until the cutover, or record it on the History page.',
    );
  });

  it('… and Important once there is app data', async () => {
    await openPage({ ...netWorthPages.autoRecordOffNoAppData, hasAppData: true });
    const important = screen.getByRole('note', { name: 'Month not recorded' });
    expect(important).toHaveClass('jf-callout--important');
    expect(important).toHaveTextContent(
      'Aug 2026 has not been recorded. Record it on the History page.',
    );
    expect(screen.queryByRole('note', { name: 'Not recorded in the app' })).toBeNull();
  });

  it('auto-record waiting for an earlier month (D94)', async () => {
    await openPage({
      ...populated,
      recorder: {
        ...populated.recorder,
        blocked: { periodMonth: '2026-09', missing: ['2026-08'] },
      },
    });
    expect(screen.getByRole('note', { name: 'Auto-record is waiting' })).toHaveTextContent(
      'Auto-record is waiting: Aug 2026 is not recorded. Record it, or record Sep 2026 alone (Aug 2026 then becomes a gap), on the History page.',
    );
  });

  it('prices missing, and market data off', async () => {
    await openPage({
      ...populated,
      prices: { ...populated.prices, unpricedCount: 2, stalePriceCount: 1, mode: 'off' },
    });
    expect(screen.getByRole('note', { name: 'Prices' })).toHaveTextContent(
      '2 holdings have no current price, so net worth may be understated. 1 price is stale.',
    );
    expect(screen.getByRole('note', { name: 'Market data off' })).toHaveTextContent(
      'Market data is off: values use the last known prices.',
    );
  });
});

describe('Net Worth: assets and liabilities (§6.3 item 4)', () => {
  it('assets − liabilities = net worth on screen', async () => {
    await openPage();
    const table = screen.getByRole('table', { name: 'Assets and liabilities' });
    expect(headers(table)).toEqual(['Item', 'Value', 'Gain', 'Gain %']);
    const assets = centsOf(cell(table, rowOf(table, 'Total assets'), 'Value'));
    const liabilities = centsOf(cell(table, rowOf(table, 'Total liabilities'), 'Value'));
    const net = centsOf(totalRow(table).children[1]?.textContent ?? '');
    expect(assets).toBe(97_061_000);
    expect(liabilities).toBe(47_380_000);
    expect(net).toBe((assets ?? 0) - (liabilities ?? 0));
    expect(totalRow(table)).toHaveTextContent('Net worth');
    // No teal in the table: the hero holds the key figure.
    expect(table.querySelector('.jf-table__key')).toBeNull();
  });

  it('cash has no gain, offsets show when non-zero, liabilities are positive owed figures', async () => {
    await openPage();
    const table = screen.getByRole('table', { name: 'Assets and liabilities' });
    expect(cell(table, rowOf(table, 'Cash'), 'Gain')).toBe('—');
    expect(cell(table, rowOf(table, 'Offset accounts'), 'Value')).toBe('$5,000.00');
    const mortgages = rowOf(table, 'Mortgages');
    expect(mortgages).toHaveTextContent('Gross $483,500.00 less linked offsets $10,000.00');
    expect(cell(table, mortgages, 'Value')).toBe('$473,500.00');
    expect(mortgages.querySelector('.jf-amount--negative')).toBeNull();
    expect(cell(table, rowOf(table, 'Accounts in debit'), 'Value')).toBe('$300.00');
    // Other debts are zero here: no row.
    expect(() => rowOf(table, 'Other debts')).toThrow();
    expect(screen.getByRole('table', { name: 'Liquid assets' })).toHaveTextContent(
      'Assets excluding super$905,660.00',
    );
  });

  it('one muted line per mortgage loan under Mortgages (SPEC-1)', async () => {
    await openPage();
    const table = screen.getByRole('table', { name: 'Assets and liabilities' });
    const mortgages = rowOf(table, 'Mortgages');
    const lines = within(mortgages)
      .getAllByTestId('asset-detail')
      .map((l) => l.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      'Example home loan (Example property): $340,000.00 (gross $350,000.00 less offsets $10,000.00)',
    );
    expect(lines[2]).toBe('Example investment loan (Example property): $133,500.00');
    for (const line of within(mortgages).getAllByTestId('asset-detail')) {
      expect(line).toHaveClass('jf-app-meta');
    }
    expect(mortgages.querySelector('.jf-amount--negative')).toBeNull();
  });

  it('no loan lines when the field is absent or empty', async () => {
    const { unmount } = await openPage({ ...populated, mortgageLoans: [] });
    let mortgages = rowOf(
      screen.getByRole('table', { name: 'Assets and liabilities' }),
      'Mortgages',
    );
    expect(within(mortgages).getAllByTestId('asset-detail')).toHaveLength(1);
    unmount();
    const withoutLoans: NetWorthPageResponse = { ...populated };
    delete withoutLoans.mortgageLoans;
    await openPage(withoutLoans);
    mortgages = rowOf(screen.getByRole('table', { name: 'Assets and liabilities' }), 'Mortgages');
    expect(within(mortgages).getAllByTestId('asset-detail')).toHaveLength(1);
    expect(mortgages).not.toHaveTextContent('Example home loan');
  });

  it('imported other debts are a liability row', async () => {
    await openPage(netWorthPages.otherDebts);
    const table = screen.getByRole('table', { name: 'Assets and liabilities' });
    expect(cell(table, rowOf(table, 'Other debts (imported)'), 'Value')).toBe('$15,000.00');
  });

  it('a property loss is tinted', async () => {
    await openPage(netWorthPages.negativeEquity);
    const table = screen.getByRole('table', { name: 'Assets and liabilities' });
    const property = rowOf(table, 'Property');
    expect(within(property).getByText('−$39,000.00')).toHaveClass('jf-amount--negative');
  });
});

describe('Net Worth: distribution (§5, D93)', () => {
  it('eight slices in the stack order, each in its class colour, no "Other"', async () => {
    await openPage();
    const legend = legendOf(card('Distribution'));
    expect(legend.map((l) => l.name)).toEqual(NET_WORTH_STACK_ORDER.map((k) => STACK_NAMES[k]));
    expect(legend.map((l) => l.color)).toEqual(NET_WORTH_STACK_ORDER.map((k) => rgbOf(slot(k))));
    expect(legend.map((l) => l.name)).not.toContain('Other');
    const centre = card('Distribution').querySelector('.jf-chart__center');
    expect(centre).toHaveTextContent('$496,810');
    expect(centre).toHaveTextContent('Net worth');
  });

  it('a zero class is left out of the donut; the table still lists it', async () => {
    const slices = populated.distribution.slices.filter((s) => s.key !== 'crypto');
    const user = (
      await openPage({
        ...populated,
        distribution: {
          ...populated.distribution,
          values: populated.distribution.values.map((v) =>
            v.key === 'crypto' ? { ...v, valueCents: 0 } : v,
          ),
          slices,
        },
      })
    ).user;
    const donut = card('Distribution');
    expect(legendOf(donut).map((l) => l.name)).not.toContain('Crypto');
    await user.click(within(donut).getByRole('button', { name: 'Table' }));
    const table = within(donut).getByRole('table', { name: 'Distribution' });
    expect(cell(table, rowOf(table, 'Crypto'), 'Share')).toBe('—');
  });

  it('negative equity: "Assets shown" in the centre, a foot note and the exclusion note', async () => {
    await openPage(netWorthPages.negativeEquity);
    const donut = card('Distribution');
    expect(legendOf(donut).map((l) => l.name)).not.toContain('Property equity');
    const centre = donut.querySelector('.jf-chart__center');
    expect(centre).toHaveTextContent('Assets shown');
    expect(centre).toHaveTextContent('$159,310');
    expect(donut).toHaveTextContent('Net worth $96,810 after property equity (−$62,500)');
    expect(within(donut).getByRole('note', { name: 'Left out of the chart' })).toHaveTextContent(
      'Property equity is negative (−$62,500) and is left out of the chart.',
    );
  });
});

describe('Net Worth: savings rate and allocation (§6.3 item 4)', () => {
  it('the gauge with its target and the averages', async () => {
    await openPage();
    const gauge = card('Savings rate FY2026–27');
    expect(gauge).toHaveTextContent('28.1%');
    expect(gauge).toHaveTextContent('Income-weighted over 2 recorded months');
    expect(gauge).toHaveTextContent('Average savings a month$2,030.00over the last 10 months');
    expect(gauge).toHaveTextContent('Average savings a year$24,360.00');
  });

  it('the target reads "Budget plan 30.0%" once, in the gauge; the averages note is prose (STYLE-5)', async () => {
    await openPage();
    const gauge = card('Savings rate FY2026–27');
    expect(within(gauge).getAllByText('Budget plan 30.0%')).toHaveLength(1);
    expect(gauge).not.toHaveTextContent('Target ');
    expect(gauge).not.toHaveTextContent('Budget plan 30%');
    expect(within(gauge).getByTestId('average-note')).toHaveClass('jf-app-meta--prose');
  });

  it('no closed period this FY: "—" with the reason', async () => {
    await openPage(netWorthPages.noSavings);
    expect(card('Savings rate FY2026–27')).toHaveTextContent('No recorded month this FY yet');
  });

  it("the allocation: status in words, the targets' total, consider next and the link", async () => {
    await openPage();
    const allocation = card('Liquid allocation');
    const table = within(allocation).getByRole('table', { name: 'Liquid allocation' });
    expect(headers(table)).toEqual(['Class', 'Current', 'Target', 'Difference']);
    expect(cell(table, rowOf(table, 'ETFs'), 'Difference')).toBe('Under by 9.0%');
    expect(cell(table, rowOf(table, 'Cash savings'), 'Difference')).toBe('Over by 12.3%');
    expect(within(allocation).getByTestId('consider-next')).toHaveTextContent(
      'Consider next: ETFs (most under target)',
    );
    expect(within(allocation).getByRole('link', { name: 'Targets in Settings' })).toHaveAttribute(
      'href',
      '/settings#allocation',
    );
    expect(allocation).not.toHaveTextContent('Targets add up to');
  });

  it('the difference follows the Stage 2 sign, current − target (negative is under)', () => {
    // Integrator (Stage 5 e2e): the real API's rows read inverted when the page assumed
    // target − current. Every fixture row agrees with the engine's ConsiderNextRow rule.
    expect(allocationDifferenceText('-0.2')).toBe('Under by 20.0%');
    expect(allocationDifferenceText('0.05')).toBe('Over by 5.0%');
    expect(allocationDifferenceText('0')).toBe('On target');
    for (const fixture of Object.values(netWorthPages)) {
      for (const row of fixture.allocation.rows) {
        if (row.targetRatio === null || row.deltaRatio === null) continue;
        const expected = Number(row.currentRatio) - Number(row.targetRatio);
        expect(Math.abs(Number(row.deltaRatio) - expected)).toBeLessThan(1e-9);
      }
    }
  });

  it('targets that do not add up to 100 % point to Settings', async () => {
    await openPage({
      ...populated,
      allocation: { ...populated.allocation, targetSumRatio: '1.02' },
    });
    expect(card('Liquid allocation')).toHaveTextContent(
      'Targets add up to 102%: edit them in Settings',
    );
  });

  it('phone: Class, Difference, Current, Target', async () => {
    emulatePhone();
    await openPage();
    const table = screen.getByRole('table', { name: 'Liquid allocation' });
    expect(headers(table)).toEqual(['Class', 'Difference', 'Current', 'Target']);
  });
});

describe('Net Worth: over time (§5, §6.3 item 5)', () => {
  it('titles follow the unit; the live note shows only with a live group', async () => {
    const { unmount } = await openPage();
    expect(card('Net worth by month')).toHaveTextContent(
      "The last bar is live: today's prices and balances.",
    );
    unmount();
    await openPage(netWorthPages.recordedToday);
    expect(card('Net worth by month')).not.toHaveTextContent('The last bar is live');
  });

  it('a table view names the live period, never "the last bar" (STYLE-10)', async () => {
    const { user } = await openPage();
    for (const title of ['Net worth by month', 'Liquid assets', 'Savings tracker']) {
      const chart = card(title);
      await user.click(within(chart).getByRole('button', { name: 'Table' }));
      expect(chart).toHaveTextContent("The period marked (live) uses today's prices and balances.");
      expect(chart).not.toHaveTextContent('The last bar is live');
    }
  });

  it('switching the unit sends the query, saves nothing and never shows the Loading line', async () => {
    let release: () => void = () => undefined;
    const api = mockOverview({
      netWorth: (req) =>
        req.query.get('unit') === 'quarterly'
          ? new Promise((resolve) => {
              release = () => resolve({ body: netWorthPages.quarterly });
            })
          : { body: populated },
    });
    const { user } = renderApp('/');
    await screen.findByRole('group', { name: 'Net worth' });
    const view = screen.getByRole('group', { name: 'Chart view' });
    await user.click(within(view).getByRole('button', { name: 'Quarterly' }));
    await waitFor(() => expect(api.calls('GET /api/net-worth')).toHaveLength(2));
    expect(api.calls('GET /api/net-worth')[1]?.query.get('unit')).toBe('quarterly');
    // The page stays mounted while the view loads: no Loading line, the hero stays.
    expect(screen.queryByText('Loading net worth…')).toBeNull();
    expect(tile('Net worth')).toBeVisible();
    expect(card('Net worth by month').querySelector('.jf-chart--refreshing')).not.toBeNull();
    release();
    expect(await screen.findByRole('region', { name: 'Net worth by quarter' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Chart view' })).toHaveTextContent(
      'Showing quarterly',
    );
    expect(api.calls('PATCH /api/settings')).toHaveLength(0);
  });

  it('the count is sent too', async () => {
    const api = await openPage().then((v) => v.api);
    const view = screen.getByRole('group', { name: 'Chart view' });
    const select = within(view).getByRole('combobox', { name: 'Show' });
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.selectOptions(select, '6');
    await waitFor(() => expect(api.calls('GET /api/net-worth')).toHaveLength(2));
    expect(api.calls('GET /api/net-worth')[1]?.query.get('count')).toBe('6');
  });

  it('yearly groups: "by year"', async () => {
    await openPage(netWorthPages.yearly);
    expect(card('Net worth by year')).toBeVisible();
  });

  it('each class keeps its colour on the stacked chart and the tracker', async () => {
    await openPage();
    const stack = legendOf(card('Net worth by month'));
    expect(stack.map((l) => l.name)).toEqual(NET_WORTH_STACK_ORDER.map((k) => STACK_NAMES[k]));
    expect(stack.map((l) => l.color)).toEqual(NET_WORTH_STACK_ORDER.map((k) => rgbOf(slot(k))));
    const tracker = legendOf(card('Savings tracker'));
    const five = NET_WORTH_STACK_ORDER.slice(0, 5);
    expect(tracker.map((l) => l.name)).toEqual([...five.map((k) => STACK_NAMES[k]), 'Trend']);
    expect(tracker.map((l) => l.color)).toEqual([
      ...five.map((k) => rgbOf(slot(k))),
      rgbOf(CHART_OTHER),
    ]);
    // The trend is a dashed grey reference line.
    expect(
      card('Savings tracker').querySelector('.jf-chart__legend-key--dashed-line'),
    ).not.toBeNull();
  });

  it('other debts are the grey ninth series, below zero', async () => {
    await openPage(netWorthPages.otherDebts);
    const legend = legendOf(card('Net worth by month'));
    expect(legend.at(-1)).toEqual({ name: 'Other debts', color: rgbOf(CHART_OTHER) });
  });

  it('the liquid chart: slot 1 bars, the trend and its caption', async () => {
    await openPage();
    const liquid = card('Liquid assets');
    expect(legendOf(liquid)).toEqual([
      { name: 'Liquid assets', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Trend', color: rgbOf(CHART_OTHER) },
    ]);
    expect(liquid).toHaveTextContent('Trend: +$1,368 a month');
    expect(card('Savings tracker')).toHaveTextContent('Trend: +$1,845 a month');
  });

  it('savings and the savings rate (slot 1 bars, slot 2 line) with its table', async () => {
    const { user } = await openPage();
    const savings = card('Savings and savings rate');
    expect(legendOf(savings)).toEqual([
      { name: 'Savings', color: rgbOf(CHART_PALETTE[0] ?? '') },
      { name: 'Savings rate', color: rgbOf(CHART_PALETTE[1] ?? '') },
    ]);
    await user.click(within(savings).getByRole('button', { name: 'Table' }));
    const table = within(savings).getByRole('table');
    expect(headers(table)).toEqual(['Period', 'Savings', 'Income', 'Rate']);
  });

  it('the stacked table lists every series and the "Net worth" total per group', async () => {
    const { user } = await openPage();
    const chart = card('Net worth by month');
    await user.click(within(chart).getByRole('button', { name: 'Table' }));
    const table = within(chart).getByRole('table', { name: 'Net worth by month' });
    expect(headers(table)).toEqual([
      'Period',
      ...NET_WORTH_STACK_ORDER.map((k) => STACK_NAMES[k]),
      'Net worth',
    ]);
    const live = rowOf(table, 'Sep 2026 (live)');
    expect(cell(table, live, 'Net worth')).toBe('$496,810.00');
    expect(cell(table, live, 'Cash')).toBe('$29,400.00');
  });
});

describe('Net Worth: rolling net worth (§6.3 item 6)', () => {
  it('newest first: the projection above, then the live row, then the recorded months', async () => {
    await openPage();
    const projection = screen.getByTestId('rolling-projection');
    expect(projection).not.toHaveAttribute('open');
    expect(projection).toHaveTextContent(
      'Projection: 12 more months at $2,030 a month (your average savings)',
    );
    const table = screen.getByRole('table', { name: 'Rolling net worth' });
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows[0]).toHaveTextContent('Sep 2026');
    expect(rows[0]).toHaveTextContent('Live (provisional)');
    expect(rows[1]).toHaveTextContent('Aug 2026');
    expect(rows.at(-1)).toHaveTextContent('Oct 2025');
    expect(headers(table)).toContain('Offsets');
    // Liabilities are positive owed figures.
    expect(cell(table, rows[0] as HTMLElement, 'Liabilities')).toBe('$483,500.00');
    expect(cell(table, rowOf(table, 'Aug 2026'), 'Note')).toBe('Holiday flights');
  });

  it('projected rows are muted, marked "Projected" and show only the projected liquid assets', async () => {
    await openPage();
    const projected = screen.getByRole('table', { name: 'Projected liquid assets' });
    const first = projected.querySelector('tbody tr') as HTMLElement;
    expect(first).toHaveTextContent('Sep 2027');
    expect(first).toHaveTextContent('Projected');
    expect(cell(projected, first, 'Projected liquid assets')).toBe('$113,720.00');
    expect(cell(projected, first, 'Net worth')).toBe('—');
    // §6.3 item 6: the projected figures are muted (STYLE-6).
    const figure = within(first).getByTestId('projected-figure');
    expect(figure).toHaveClass('jf-app-muted');
    expect(figure).toHaveTextContent('$113,720.00');
  });

  it('the toggle reverses the order and is remembered per browser', async () => {
    const { user, unmount } = await openPage();
    await user.click(screen.getByRole('switch', { name: 'Oldest first (as the sheet)' }));
    let rows = [
      ...screen.getByRole('table', { name: 'Rolling net worth' }).querySelectorAll('tbody tr'),
    ];
    expect(rows[0]).toHaveTextContent('Oct 2025');
    expect(window.localStorage.getItem(ROLLING_ORDER_KEY)).toBe('true');
    unmount();
    await openPage();
    rows = [
      ...screen.getByRole('table', { name: 'Rolling net worth' }).querySelectorAll('tbody tr'),
    ];
    expect(rows[0]).toHaveTextContent('Oct 2025');
  });

  it('no offsets anywhere: no Offsets column', async () => {
    await openPage({
      ...populated,
      rolling: populated.rolling.map((row) =>
        row.netWorth ? { ...row, netWorth: { ...row.netWorth, offsetsCents: 0 } } : row,
      ),
    });
    expect(headers(screen.getByRole('table', { name: 'Rolling net worth' }))).not.toContain(
      'Offsets',
    );
  });

  it('late months carry "Recorded late"', async () => {
    await openPage({
      ...populated,
      rolling: populated.rolling.map((row) =>
        row.periodMonth === '2026-08' ? { ...row, source: 'late' } : row,
      ),
    });
    const table = screen.getByRole('table', { name: 'Rolling net worth' });
    expect(rowOf(table, 'Aug 2026')).toHaveTextContent('Recorded late');
  });

  it('phone: the status-first column order', async () => {
    emulatePhone();
    await openPage();
    expect(headers(screen.getByRole('table', { name: 'Rolling net worth' }))).toEqual([
      'Month',
      'Net worth',
      'Change',
      'Liquid assets',
      'Savings rate',
      'Super',
      'Property',
      'Liabilities',
      'Offsets',
      'Liquid change',
      'Note',
    ]);
  });
});
