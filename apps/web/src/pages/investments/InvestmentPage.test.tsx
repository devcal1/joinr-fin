import type { InstrumentKind } from '@joinr/schema';
import {
  apiErrors,
  investmentPageAllUnpriced,
  investmentPageEmpty,
  investmentPageNulls,
  investmentPageTiming,
  investmentPageUnpriced,
  investmentPages,
  investmentTrades,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  etfPageOverLimit,
  etfPageRefreshing,
  etfPageTargetsOff,
  fundNullsTrades,
  stockPageWatchingOnly,
  stockTradesEmpty,
} from '../../../test/fixtures/investments';
import {
  KIND_PATHS,
  cell,
  headers,
  mockInvestments,
  rowOf,
  totalRow,
} from '../../../test/investments';
import { emulatePhone } from '../../../test/media';
import { apiError, pending } from '../../../test/mockApi';
import { findMain, renderApp } from '../../../test/renderApp';
import { formatMoney } from '@joinr/ui';
import { MORE_COLUMNS_KEY } from './storage';

const KINDS: readonly InstrumentKind[] = ['stock', 'etf', 'managed_fund', 'crypto'];
const TITLES = { stock: 'Stocks', etf: 'ETFs', managed_fund: 'Managed Funds', crypto: 'Crypto' };

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; kept for symmetry with the page code.
  }
});

async function openPage(kind: InstrumentKind): Promise<HTMLElement> {
  renderApp(KIND_PATHS[kind]);
  const main = await findMain();
  await within(main).findByRole('heading', { level: 1, name: TITLES[kind] });
  return main;
}

/** A KPI tile (role group named by its label). */
function tile(label: string): HTMLElement {
  return screen.getByRole('group', { name: label });
}

async function holdingsTable(kind: InstrumentKind): Promise<HTMLElement> {
  return screen.findByRole('table', { name: `${TITLES[kind]} holdings` });
}

describe('InvestmentPage states (§6.8)', () => {
  it.each(KINDS)('%s: loading shows the h1 and a status line', async (kind) => {
    mockInvestments(kind, { page: pending, trades: pending });
    const main = await openPage(kind);
    expect(within(main).getByRole('status')).toHaveTextContent(/^Loading .+…$/);
  });

  it('ETFs: loading says "Loading ETFs…"', async () => {
    mockInvestments('etf', { page: pending, trades: pending });
    const main = await openPage('etf');
    expect(within(main).getByRole('status')).toHaveTextContent('Loading ETFs…');
  });

  it.each(KINDS)('%s: an error shows a callout with a retry', async (kind) => {
    const api = mockInvestments(kind, { page: apiError(500, apiErrors.internal) });
    const main = await openPage(kind);
    const note = await within(main).findByRole('note', { name: /^Could not load the / });
    expect(note).toHaveTextContent('Internal server error');
    const retry = within(note).getByRole('button', { name: 'Try again' });
    const before = api.calls(`GET /api/investments/${kind}`).length;
    retry.click();
    await waitFor(() =>
      expect(api.calls(`GET /api/investments/${kind}`).length).toBeGreaterThan(before),
    );
  });

  it('ETFs: the error title names the ETFs', async () => {
    mockInvestments('etf', { page: apiError(500, apiErrors.internal) });
    const main = await openPage('etf');
    expect(
      await within(main).findByRole('note', { name: 'Could not load the ETFs' }),
    ).toBeVisible();
  });

  it.each(KINDS)('%s: an empty kind explains how to start, with both actions', async (kind) => {
    mockInvestments(kind, {
      page: investmentPageEmpty(kind),
      trades: { kind, asOf: '2026-09-24', trades: [] },
    });
    const main = await openPage(kind);
    const plural = {
      stock: 'stocks',
      etf: 'ETFs',
      managed_fund: 'managed funds',
      crypto: 'crypto holdings',
    }[kind];
    const note = await within(main).findByText(
      `No ${plural} yet. Add a holding, or import the workbook on the`,
      { exact: false },
    );
    const callout = note.closest('.jf-callout') as HTMLElement;
    expect(within(callout).getByRole('link', { name: 'Import page' })).toHaveAttribute(
      'href',
      '/import',
    );
    expect(within(callout).getByRole('button', { name: 'Add holding' })).toBeVisible();
    expect(within(main).queryByRole('button', { name: 'Add trade' })).toBeNull();
    expect(within(main).queryByRole('group', { name: 'Portfolio value' })).toBeNull();
  });

  it.each(KINDS)('%s: the populated page has the h1, the tiles and the sections', async (kind) => {
    mockInvestments(kind);
    const main = await openPage(kind);
    expect(await within(main).findByRole('group', { name: 'Portfolio value' })).toHaveTextContent(
      formatMoney(investmentPages[kind].summary.valueCents, { wholeDollars: true }),
    );
    expect(within(main).getByText('Investments')).toBeVisible();
    for (const name of [
      'Holdings',
      'Next buy & allocation',
      'History',
      'Realised gains by financial year',
      'Trades',
    ]) {
      expect(within(main).getByRole('heading', { level: 2, name })).toBeVisible();
    }
    expect(within(main).getByRole('button', { name: 'Add trade' })).toBeVisible();
    expect(within(main).getByRole('button', { name: 'Add holding' })).toBeVisible();
    expect(await screen.findByRole('table', { name: /trades: \d+ rows?$/ })).toBeVisible();
  });

  it('shows "Refreshing prices…" and the test-prices pill', async () => {
    mockInvestments('etf', { page: etfPageRefreshing });
    const main = await openPage('etf');
    expect(await within(main).findByText('Refreshing prices…')).toBeVisible();
    expect(within(main).getByText('Test prices')).toHaveClass('jf-pill');
  });

  it('shows the price freshness', async () => {
    mockInvestments('etf');
    const main = await openPage('etf');
    expect(
      await within(main).findByText(/^Prices (\d{2}:\d{2}|\d{2}\/\d{2}\/\d{4})$/),
    ).toBeVisible();
  });
});

describe('KPI tiles (§6.3 item 3)', () => {
  it('ETFs: eight tiles; value is the only key figure; counts and fees', async () => {
    mockInvestments('etf');
    const main = await openPage('etf');
    await within(main).findByRole('group', { name: 'Portfolio value' });
    const tiles = main.querySelectorAll('.jf-stat-tile');
    expect(tiles).toHaveLength(8);
    expect(main.querySelectorAll('.jf-stat-tile--key')).toHaveLength(1);
    expect(tile('Portfolio value')).toHaveClass('jf-stat-tile--key');
    expect(tile('Portfolio value')).toHaveTextContent('$5,284');
    expect(tile('Portfolio value')).toHaveTextContent('2 holdings');
    expect(tile('Total return')).toHaveTextContent('$677.00');
    expect(tile('Total return')).toHaveTextContent('+14.2%up on cost');
    expect(tile('Total return')).toHaveTextContent('Unrealised + dividends, priced holdings');
    expect(tile('Realised gains')).toHaveTextContent('−$220.00');
    expect(tile('Realised gains')).toHaveTextContent('This FY $0.00');
    expect(tile('Est. return / yr')).toHaveTextContent('4.4%');
    expect(tile('Invested / month')).toHaveTextContent('$131/month');
    expect(tile('Distributions this FY')).toHaveTextContent('$28.00');
    expect(tile('Distributions this FY')).toHaveTextContent('All time $213.00');
    expect(tile('Holdings')).toHaveTextContent('2 · target 2 · limit 3');
    expect(within(tile('Holdings')).queryByText('Over limit')).toBeNull();
    expect(tile('Est. fees / yr')).toHaveTextContent('$8.00');
  });

  it('ETFs: warns when either count is over the ETF limit', async () => {
    mockInvestments('etf', { page: etfPageOverLimit });
    await openPage('etf');
    await screen.findByRole('group', { name: 'Holdings' });
    expect(within(tile('Holdings')).getByText('Over limit')).toBeVisible();
    expect(tile('Holdings')).toHaveTextContent('2 · target 2 · limit 1');
  });

  it.each(['stock', 'managed_fund', 'crypto'] as const)('%s: six tiles', async (kind) => {
    mockInvestments(kind);
    const main = await openPage(kind);
    await within(main).findByRole('group', { name: 'Portfolio value' });
    expect(main.querySelectorAll('.jf-stat-tile')).toHaveLength(6);
  });

  it('managed funds: the value hint adds the estimated fees', async () => {
    mockInvestments('managed_fund');
    await openPage('managed_fund');
    expect(await screen.findByRole('group', { name: 'Portfolio value' })).toHaveTextContent(
      '1 holding · est. fees $18/yr',
    );
  });

  it('crypto: the staking tile adds the fee rate', async () => {
    mockInvestments('crypto');
    await openPage('crypto');
    expect(await screen.findByRole('group', { name: 'Staking this FY' })).toHaveTextContent(
      'All time $27.00 · fee rate 0.5%',
    );
  });

  it('every held holding unpriced: $0 value, the held hint, XIRR "—" and the price callout', async () => {
    mockInvestments('stock', { page: investmentPageAllUnpriced });
    const main = await openPage('stock');
    const value = await within(main).findByRole('group', { name: 'Portfolio value' });
    expect(value).toHaveTextContent('$0');
    expect(value).toHaveTextContent('2 held · 2 without a price');
    expect(tile('Est. return / yr')).toHaveTextContent('—');
    expect(tile('Est. return / yr')).toHaveTextContent('Needs a priced holding and two dates');
    const callout = within(main).getByRole('note', { name: 'Prices' });
    expect(callout).toHaveTextContent(
      '2 holdings have no price and are left out of the totals: ASX:ABC, ASX:XYZ.',
    );
    expect(within(callout).getByRole('link', { name: 'Check the prices' })).toHaveAttribute(
      'href',
      '/prices',
    );
  });

  it('null tiles: XIRR and the 1Y rate', async () => {
    mockInvestments('managed_fund', { page: investmentPageNulls, trades: fundNullsTrades });
    await openPage('managed_fund');
    await screen.findByRole('group', { name: 'Portfolio value' });
    expect(tile('Est. return / yr')).toHaveTextContent('—');
    expect(tile('Est. return / yr')).toHaveTextContent('Needs a priced holding and two dates');
    expect(tile('Invested / month')).toHaveTextContent('—');
    expect(tile('Invested / month')).toHaveTextContent('No trades in the last 12 months');
  });

  it('the portfolio XIRR shows "—" when the kind’s first trade is under 90 days old', async () => {
    const recent = {
      ...investmentTrades.stock,
      trades: investmentTrades.stock.trades.filter((t) => t.id === 108),
    };
    mockInvestments('stock', { trades: recent });
    await openPage('stock');
    await screen.findByRole('table', { name: /trades: 1 row$/ });
    expect(tile('Est. return / yr')).toHaveTextContent('—');
    expect(tile('Est. return / yr')).toHaveTextContent('Held under 90 days');
  });

  it('watching only (no trades): $0 tiles with "No trades yet"', async () => {
    mockInvestments('stock', { page: stockPageWatchingOnly, trades: stockTradesEmpty });
    await openPage('stock');
    const value = await screen.findByRole('group', { name: 'Portfolio value' });
    expect(value).toHaveTextContent('$0');
    expect(value).toHaveTextContent('No trades yet');
    expect(tile('Total return')).toHaveTextContent('$0.00');
    expect(tile('Total return')).toHaveTextContent('No trades yet');
    expect(tile('Realised gains')).toHaveTextContent('No trades yet');
  });
});

describe('the holdings table (§6.3 item 4)', () => {
  it.each([
    ['populated', investmentPages.etf],
    ['unpriced', investmentPageUnpriced],
  ] as const)('%s: the total row equals the Σ of the visible rows', async (_name, page) => {
    mockInvestments('etf', { page });
    await openPage('etf');
    const table = await holdingsTable('etf');
    const visible = page.holdings.filter((h) => h.status !== 'exited');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(visible.length);
    const total = totalRow(table);
    expect(total).toHaveTextContent('Total (priced holdings)');
    const sum = (pick: (h: (typeof visible)[number]) => number) =>
      formatMoney(visible.reduce((s, h) => s + pick(h), 0));
    expect(cell(table, total, 'Distributions')).toBe(sum((h) => h.dividendsCents));
    expect(cell(table, total, 'Realised')).toBe(sum((h) => h.realisedCents));
    expect(cell(table, total, 'Value')).toBe(formatMoney(page.summary.valueCents));
    expect(cell(table, total, 'Total return')).toBe(formatMoney(page.summary.totalReturnCents));
    // The value total is the table's only teal (key) cell.
    expect(table.querySelectorAll('.jf-table__key')).toHaveLength(1);
    expect(table.querySelector('.jf-table__key')).toHaveTextContent(
      formatMoney(page.summary.valueCents),
    );
  });

  it('exited holdings sit in a closed <details> with their own total', async () => {
    mockInvestments('stock');
    await openPage('stock');
    await holdingsTable('stock');
    const summary = screen.getByText('Exited holdings (1)');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const exited = within(details).getByRole('table', { name: 'Exited stocks', hidden: true });
    const old = rowOf(exited, 'ASX:OLD');
    expect(cell(exited, old, 'Realised')).toBe('$32.00');
    expect(cell(exited, old, 'Last trade')).toBe('03/02/2025');
    expect(within(old).getByText('Oversold')).toBeInTheDocument();
    expect(cell(exited, totalRow(exited), 'Realised')).toBe('$32.00');
    expect(totalRow(exited)).toHaveTextContent('Total');
  });

  it('watching rows: dashes for value cells; a fully sold one keeps realised and dividends', async () => {
    mockInvestments('managed_fund', { page: investmentPageNulls, trades: fundNullsTrades });
    await openPage('managed_fund');
    const table = await holdingsTable('managed_fund');
    const sold = rowOf(table, 'EXAMPLEFUND2');
    for (const header of [
      'Value',
      'Total return',
      'Return %',
      'Est. return / yr',
      'Units',
      'Current',
    ]) {
      expect(cell(table, sold, header)).toBe('—');
    }
    expect(cell(table, sold, 'Realised')).toBe('$200.00');
    expect(cell(table, sold, 'Distributions')).toBe('$50.00');
    expect(cell(table, sold, 'Target')).toBe('50.0%');
    expect(cell(table, sold, 'Difference')).toBe('−50.0%');
    // The held but unwatched fund is flagged.
    expect(within(rowOf(table, 'EXAMPLEFUND3')).getByText('Not watched')).toBeVisible();
  });

  it('shows the flag badges with words', async () => {
    mockInvestments('etf', { page: investmentPageUnpriced });
    await openPage('etf');
    const table = await holdingsTable('etf');
    const def = rowOf(table, 'ASX:DEF');
    expect(within(def).getByText('No price').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'failed',
    );
    expect(cell(table, def, 'Value')).toBe('—');
    const mno = rowOf(table, 'ASX:MNO');
    expect(within(mno).getByText('Stale').closest('.jf-badge')).toHaveAttribute(
      'data-status',
      'stale',
    );
  });

  it('units and prices use the kind’s precision (fund 6 dp, crypto 8 dp)', async () => {
    mockInvestments('managed_fund');
    await openPage('managed_fund');
    const table = await holdingsTable('managed_fund');
    expect(cell(table, rowOf(table, 'EXAMPLEFUND'), 'Units')).toBe('1,500.123456');
    expect(within(rowOf(table, 'EXAMPLEFUND')).getByText('Manual')).toBeVisible();
  });

  it('crypto units show 8 dp', async () => {
    mockInvestments('crypto');
    await openPage('crypto');
    const table = await holdingsTable('crypto');
    expect(cell(table, rowOf(table, 'BTC'), 'Units')).toBe('0.06234567');
    expect(headers(table)).toContain('Staking');
  });

  it('the XIRR display rule: under 90 days shows "—" with a reason', async () => {
    mockInvestments('stock');
    await openPage('stock');
    const table = await holdingsTable('stock');
    await screen.findByRole('table', { name: /trades: 8 rows$/ });
    const xyz = rowOf(table, 'ASX:XYZ');
    expect(cell(table, xyz, 'Est. return / yr')).toBe('—Held under 90 days');
    expect(within(xyz).getByTitle('Held under 90 days')).toBeInTheDocument();
    expect(cell(table, rowOf(table, 'ASX:ABC'), 'Est. return / yr')).toBe('19.4%');
  });

  it('links each holding to its page', async () => {
    mockInvestments('etf');
    await openPage('etf');
    const table = await holdingsTable('etf');
    expect(within(table).getByRole('link', { name: 'ASX:DEF' })).toHaveAttribute('href', '/etfs/4');
  });

  it('"More columns" is off by default and is remembered', async () => {
    mockInvestments('etf');
    const { user } = renderApp('/etfs');
    const table = await holdingsTable('etf');
    expect(headers(table)).not.toContain('Average price');
    const toggle = screen.getByRole('switch', { name: 'More columns' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    const wide = await holdingsTable('etf');
    expect(headers(wide)).toEqual(
      expect.arrayContaining(['Average price', 'Yield', 'Mgmt fee', 'Est. fee / yr', 'Sector']),
    );
    expect(cell(wide, rowOf(wide, 'ASX:DEF'), 'Mgmt fee')).toBe('0.07%');
    expect(window.localStorage.getItem(MORE_COLUMNS_KEY)).toBe('true');
  });

  it('crypto has no sector or fee columns under "More columns"', async () => {
    window.localStorage.setItem(MORE_COLUMNS_KEY, 'true');
    mockInvestments('crypto');
    await openPage('crypto');
    const table = await holdingsTable('crypto');
    expect(headers(table)).toContain('Staking yield');
    expect(headers(table)).not.toContain('Sector');
    expect(headers(table)).not.toContain('Mgmt fee');
  });

  it('phone: status-first column order (D31)', async () => {
    emulatePhone();
    mockInvestments('etf');
    await openPage('etf');
    const table = await holdingsTable('etf');
    expect(headers(table).slice(0, 6)).toEqual([
      'Holding',
      'Value',
      'Total return',
      'Return %',
      'Price',
      'Units',
    ]);
  });

  it('warns when targets do not add up to 100%', async () => {
    mockInvestments('etf', { page: etfPageTargetsOff });
    await openPage('etf');
    expect(await screen.findByRole('note', { name: 'Targets' })).toHaveTextContent(
      'Targets add up to 95%',
    );
  });
});

describe('next buy (§6.3 item 5)', () => {
  async function card(page = investmentPageTiming.wait, kind: InstrumentKind = 'etf') {
    mockInvestments(kind, { page });
    await openPage(kind);
    return screen.findByRole('region', { name: 'Next buy' });
  }

  it('wait: the hint, the countdown and the budget details (ETFs)', async () => {
    const c = await card();
    expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent(
      'Consider ASX:DEF — $4,860.00 parcel',
    );
    expect(within(c).getByTestId('next-buy-countdown')).toHaveTextContent(
      'Wait 56 days (next buy 19/11/2026)',
    );
    const details = within(c).getByRole('table', { name: 'Next buy details' });
    expect(details).toHaveTextContent(
      "$1,620.00$1,500.00 from the budget's investment row + $120.00 side income",
    );
    expect(details).toHaveTextContent('Every 3 months · $4,860.00 (estimate; optimal $3,943.60)');
    expect(details).toHaveTextContent('18/08/2026');
    expect(details).toHaveTextContent('ETFs: 10.4% now vs 60.0% target');
    expect(c).toHaveTextContent('From the imported budget; the live budget arrives in Stage 3.');
  });

  it('invest: days since the last buy; the income-based amount when the budget switch is off', async () => {
    const c = await card(investmentPageTiming.invest);
    expect(within(c).getByTestId('next-buy-countdown')).toHaveTextContent(
      '37 days since the last buy: consider investing',
    );
    expect(c).toHaveTextContent(
      '$9,750.00 of monthly income at the invest share + $250.00 side income',
    );
  });

  it('cash first', async () => {
    const c = await card(investmentPageTiming.cash_first);
    expect(within(c).getByTestId('next-buy-countdown')).toHaveTextContent(
      'Cash first: nothing is left to invest this month',
    );
    expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent(
      'Next: ASX:DEF, once cash allows',
    );
    // Nothing to invest reads $0.00, never a negative amount to invest.
    const amount = within(c).getByRole('rowheader', { name: 'Monthly amount to invest' })
      .nextElementSibling as HTMLElement;
    expect(amount).toHaveTextContent("$0.00the budget's investment row is −$1,000.00");
  });

  it('split off (D46): a status line and why, never a bare "Cash first"', async () => {
    const c = await card(investmentPageTiming.split_off);
    const status = within(c).getByTestId('next-buy-countdown');
    expect(status).toHaveTextContent(/^Automatic investment split is off$/);
    // A status word with an icon, in the check (orange) tone, not red.
    const flag = status.querySelector('[data-status]');
    expect(flag).toHaveAttribute('data-status', 'check');
    expect(flag?.querySelector('svg')).not.toBeNull();
    expect(within(c).getByTestId('next-buy-split-off')).toHaveTextContent(
      'The budget sends the whole leftover to cash, so there is no monthly amount to invest.',
    );
    expect(c).not.toHaveTextContent(/cash first/i);
    expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent(/^Consider ASX:DEF$/);
    const amount = within(c).getByRole('rowheader', { name: 'Monthly amount to invest' })
      .nextElementSibling as HTMLElement;
    expect(amount).toHaveTextContent("$0.00the budget's automatic investment split is off");
  });

  it('cash first keeps its plain line (no split-off status)', async () => {
    const c = await card(investmentPageTiming.cash_first);
    expect(within(c).queryByTestId('next-buy-split-off')).toBeNull();
    expect(within(c).getByTestId('next-buy-countdown').querySelector('[data-status]')).toBeNull();
  });

  it('unavailable: "Not available" and the missing inputs in words', async () => {
    const c = await card(investmentPageTiming.unavailable);
    expect(within(c).getByTestId('next-buy-countdown')).toHaveTextContent('Not available');
    const missing = within(c).getByRole('note', { name: 'Inputs missing' });
    for (const label of [
      'Net pay per pay',
      'Emergency fund (months)',
      'Budget items',
      'Monthly snapshots',
    ]) {
      expect(within(missing).getByText(label)).toBeVisible();
    }
    expect(missing).toHaveTextContent(
      'Set these in the workbook and re-import (only while no app edits exist), or on the Settings page in Stage 5.',
    );
  });

  it('below the emergency fund: top up cash first, and the deferred cash wait', async () => {
    const c = await card(investmentPageTiming.below_emergency_fund);
    expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent(
      'Top up cash first: cash is below the emergency fund ($21,000.00)',
    );
    expect(c).toHaveTextContent(
      'Cash is below its target; the cash-first wait is added in Stage 3.',
    );
  });

  it('no targets', async () => {
    const c = await card(investmentPageTiming.no_targets);
    expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent(
      'Set allocation targets to get a suggestion',
    );
    expect(within(c).getByRole('table', { name: 'Next buy details' })).toHaveTextContent(
      'No suggestion',
    );
  });

  it.each(['stock', 'managed_fund', 'crypto'] as const)(
    '%s: the hint and class only, with a link to the ETFs timing',
    async (kind) => {
      const c = await card(investmentPages[kind], kind);
      expect(within(c).getByTestId('next-buy-hint')).toHaveTextContent('Consider ETFs');
      expect(within(c).queryByTestId('next-buy-countdown')).toBeNull();
      expect(within(c).queryByText('Parcel')).toBeNull();
      expect(
        within(c).getByRole('link', { name: 'See the timing on the ETFs page' }),
      ).toHaveAttribute('href', '/etfs');
    },
  );
});

describe('allocation, charts and the FY table', () => {
  async function allocation(kind: InstrumentKind, page = investmentPages[kind]) {
    mockInvestments(kind, { page });
    await openPage(kind);
    return screen.findByRole('region', { name: 'Allocation' });
  }

  it.each([
    ['stock', ['By sector', 'By holding']],
    ['etf', ['By sector', 'By region', 'By holding']],
    ['managed_fund', ['By sector', 'By region', 'By holding']],
  ] as const)('%s: the grouping switch', async (kind, options) => {
    const c = await allocation(kind);
    const group = within(c).getByRole('group', { name: 'Allocation: group by' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(options);
    expect(within(group).getByRole('button', { name: 'By sector' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('crypto: by coin only, no switch', async () => {
    const c = await allocation('crypto');
    expect(within(c).queryByRole('group', { name: 'Allocation: group by' })).toBeNull();
    expect(c).toHaveTextContent('By coin');
  });

  it('switching to regions changes the table view', async () => {
    mockInvestments('etf');
    const { user } = renderApp('/etfs');
    const c = await screen.findByRole('region', { name: 'Allocation' });
    await user.click(within(c).getByRole('button', { name: 'By region' }));
    await user.click(within(c).getByRole('button', { name: 'Table' }));
    const table = within(c).getByRole('table', { name: 'ETFs allocation, by region' });
    expect(headers(table)).toEqual(['Slice', 'Current', 'Target', 'Difference']);
    const us = rowOf(table, 'US');
    expect(cell(table, us, 'Current')).toBe('53.8%');
    expect(cell(table, us, 'Target')).toBe('56.0%');
    expect(cell(table, us, 'Difference')).toBe('−2.2%');
  });

  it('no priced holding: the card opens on its table view', async () => {
    const c = await allocation('stock', investmentPageAllUnpriced);
    expect(within(c).getByRole('button', { name: 'Table' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(c).getByRole('table', { name: 'Stocks allocation, by sector' })).toBeVisible();
  });

  it('the chart tables label the live point "(live)" and note today’s prices', async () => {
    mockInvestments('etf');
    const { user } = renderApp('/etfs');
    const value = await screen.findByRole('region', { name: 'Value' });
    await user.click(within(value).getByRole('button', { name: 'Table' }));
    const table = within(value).getByRole('table', {
      name: 'ETFs: market value and contributions',
    });
    const live = rowOf(table, 'Sep 2026 (live)');
    expect(cell(table, live, 'Market value')).toBe('$5,284.00');
    expect(cell(table, live, 'Contributions')).toBe('$4,917.00');
    expect(value).toHaveTextContent("The last point uses today's prices.");

    const gain = screen.getByRole('region', { name: 'Gain' });
    await user.click(within(gain).getByRole('button', { name: '%' }));
    expect(within(gain).getByRole('button', { name: '%' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(gain).getByRole('button', { name: 'Table' }));
    const gainTable = within(gain).getByRole('table', { name: 'ETFs: gain' });
    expect(cell(gainTable, rowOf(gainTable, 'Jun 2026'), 'Gain %')).toBe('12.2%');

    const purchases = screen.getByRole('region', { name: 'Net purchases' });
    await user.click(within(purchases).getByRole('button', { name: 'Table' }));
    const purchasesTable = within(purchases).getByRole('table', { name: 'ETFs: net purchases' });
    expect(cell(purchasesTable, rowOf(purchasesTable, 'Aug 2026'), 'Net purchases')).toBe(
      '$720.00',
    );
  });

  it('no history: the charts say so', async () => {
    mockInvestments('stock', { page: stockPageWatchingOnly, trades: stockTradesEmpty });
    await openPage('stock');
    const value = await screen.findByRole('region', { name: 'Value' });
    expect(within(value).getByText('No history yet')).toBeVisible();
  });

  it('the FY table: short and long term, the all-time total and the no-tax note', async () => {
    mockInvestments('stock');
    await openPage('stock');
    const table = await screen.findByRole('table', { name: 'Realised gains by financial year' });
    expect(headers(table)).toEqual([
      'Financial year',
      'Short term',
      'Long term',
      'Total',
      'Disposals',
    ]);
    const fy = rowOf(table, 'FY2024–25');
    expect(cell(table, fy, 'Short term')).toBe('$16.00');
    expect(cell(table, fy, 'Total')).toBe('$32.00');
    const total = totalRow(table);
    expect(total).toHaveTextContent('All time');
    expect(cell(table, total, 'Total')).toBe('$288.00');
    expect(cell(table, total, 'Disposals')).toBe('4');
    expect(table.querySelector('.jf-table__key')).toBeNull();
    expect(
      screen.getByText(
        'No tax is calculated. Long term = held 12 months or more; those gains may be eligible for the CGT discount.',
      ),
    ).toBeVisible();
  });

  it('phone: the FY table puts the total right after the year (D31)', async () => {
    emulatePhone();
    mockInvestments('stock');
    await openPage('stock');
    const table = await screen.findByRole('table', { name: 'Realised gains by financial year' });
    expect(headers(table)).toEqual([
      'Financial year',
      'Total',
      'Short term',
      'Long term',
      'Disposals',
    ]);
  });

  it('names a one-slice donut under the ring; several slices get a legend instead', async () => {
    mockInvestments('managed_fund');
    const { user } = renderApp('/managed-funds');
    const c = await screen.findByRole('region', { name: 'Allocation' });
    expect(within(c).getByTestId('allocation-single-slice')).toHaveTextContent('100% Diversified');
    await user.click(within(c).getByRole('button', { name: 'By region' }));
    expect(within(c).queryByTestId('allocation-single-slice')).toBeNull();
  });

  it('one unpriced holding: the Value and Gain charts say the last point leaves it out', async () => {
    mockInvestments('etf', { page: investmentPageUnpriced });
    await openPage('etf');
    const note = '1 holding without a price is left out of the last point.';
    expect(await screen.findByRole('region', { name: 'Value' })).toHaveTextContent(note);
    expect(screen.getByRole('region', { name: 'Gain' })).toHaveTextContent(note);
    expect(screen.getByRole('region', { name: 'Net purchases' })).not.toHaveTextContent(note);
  });

  it('every holding unpriced: the note counts them', async () => {
    mockInvestments('stock', { page: investmentPageAllUnpriced });
    await openPage('stock');
    const note = '2 holdings without a price are left out of the last point.';
    expect(await screen.findByRole('region', { name: 'Value' })).toHaveTextContent(note);
    expect(screen.getByRole('region', { name: 'Gain' })).toHaveTextContent(note);
  });

  it('every held holding priced: no unpriced note under the charts', async () => {
    mockInvestments('etf');
    await openPage('etf');
    const value = await screen.findByRole('region', { name: 'Value' });
    expect(value).toHaveTextContent("The last point uses today's prices.");
    expect(value).not.toHaveTextContent('left out of the last point');
  });

  it('the FY table when nothing was sold', async () => {
    mockInvestments('managed_fund');
    await openPage('managed_fund');
    expect(await screen.findByText('No realised gains yet.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Realised gains by financial year' })).toBeNull();
  });
});
