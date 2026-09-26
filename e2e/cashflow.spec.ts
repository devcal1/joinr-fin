// The four cash-flow pages on the synthetic import (stage-3.md §7.8 step 3), desktop and phone,
// read-only: each page's h1, KPI tiles, main tables (their row counts equal the API's), charts (an
// svg or the empty message), no page-level horizontal scroll, no console errors, screenshots. The
// Dividends check runs one suggestion refresh in fake mode (it writes the events cache and a job
// run, never app data). Drafted by web phase A; finished by the Integrator against the real API.
import { expect, test, type Page } from '@playwright/test';
import {
  CASHFLOW_PAGES,
  CASHFLOW_ROUTES,
  budgetPage,
  cashPage,
  dividendsPage,
  expectCashflowApi,
  sideIncomePage,
} from './cashflow-support';
import { SYNTHETIC_HELD } from './investments-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

/** "12 rows" / "1 row", as the page's captions count (plural() in apps/web). */
function counted(count: number, one: string): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : `${one}s`}`;
}

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
  await expectCashflowApi(request);
});

/** Every chart card shows a chart (an svg) or its empty message. */
async function expectChartsRender(page: Page): Promise<void> {
  const cards = page.locator('.jf-chart-card');
  const count = await cards.count();
  expect(count, 'chart cards on the page').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    // A table-first card has no chart until toggled; a chart shows an svg or its empty state.
    await expect(
      card.locator('.jf-chart__host svg, .jf-chart__state, table').first(),
    ).toBeAttached();
  }
}

for (const route of CASHFLOW_ROUTES) {
  const { path, title, keyTile } = CASHFLOW_PAGES[route];
  test(`${title}: tiles, tables and charts`, async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: keyTile, exact: true })).toBeVisible();
    // Six KPI tiles on every cash-flow page.
    await expect(page.locator('.jf-app-kpis .jf-stat-tile')).toHaveCount(6);
    // The key figure is the page's only teal tile.
    await expect(page.locator('.jf-stat-tile--key')).toHaveCount(1);
    await expectChartsRender(page);
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'cashflow', route);
    expect(errors).toEqual([]);
  });
}

test('Cash: the accounts by kind and the savings table', async ({ page, request }) => {
  const cash = await cashPage(request);
  // The synthetic workbook has snapshots and today is after the last one: a provisional period.
  expect(cash.periods.some((p) => p.status === 'provisional')).toBe(true);
  const bank = cash.accounts.filter((a) => a.kind === 'bank' && !a.isOffset);
  await page.goto('/cash');
  await expect(
    page.getByRole('table', { name: `Bank accounts: ${counted(bank.length, 'account')}` }),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: 'Cash totals' })).toContainText('Total cash');
  const savings = page.getByRole('table', {
    name: `Savings by period: ${counted(cash.periods.length, 'row')}`,
  });
  await expect(savings).toBeVisible();
  await expect(savings.locator('tbody tr')).toHaveCount(cash.periods.length);
  // The synthetic workbook's first month is the baseline; the current period is provisional.
  await expect(savings.getByText('Baseline')).toBeVisible();
  await expect(savings.getByText('Provisional')).toBeVisible();
});

// Between 768 and 1199 px the account tables use a compact column grid; the fixed desktop widths
// left the Account column about 80 px wide there and broke names mid-word.
test('Cash: account names keep whole words from 768 to 1199 px', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The widths are set explicitly; one project is enough.',
  );
  for (const width of [800, 1024, 1199]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/cash');
    await expect(page.getByRole('heading', { level: 1, name: 'Cash', exact: true })).toBeVisible();
    const firstHeader = page.locator('.jf-app-account-group thead th').first();
    await expect(firstHeader).toBeVisible();
    const accountWidth = (await firstHeader.boundingBox())?.width ?? 0;
    expect(accountWidth, `Account column at ${width} px`).toBeGreaterThanOrEqual(180);
    // A word whose characters land on more than one line was broken mid-word.
    const splitWords = await page.evaluate(() => {
      const split: string[] = [];
      const names = document.querySelectorAll('.jf-app-account-group .jf-app-account-cell > span');
      for (const name of names) {
        const text = name.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) continue;
        let start = 0;
        for (const word of (text.textContent ?? '').split(' ')) {
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + word.length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (word && lines.size > 1) split.push(word);
          start += word.length + 1;
        }
      }
      return split;
    });
    expect(splitWords, `words split across lines at ${width} px`).toEqual([]);
    await expectNoHorizontalScroll(page);
  }
});

test('Side Income: deposits and periods', async ({ page, request }) => {
  const side = await sideIncomePage(request);
  expect(side.deposits.length, 'the synthetic deposits').toBeGreaterThan(0);
  await page.goto('/side-income');
  const deposits = page.getByRole('table', {
    name: `Deposits: ${counted(side.deposits.length, 'deposit')}`,
  });
  await expect(deposits).toBeVisible();
  await expect(deposits.locator('tbody tr')).toHaveCount(side.deposits.length);
  const periods = page.getByRole('table', { name: 'Side income periods' });
  await expect(periods).toBeVisible();
  await expect(periods.locator('tbody tr')).toHaveCount(side.periods.length);
});

test('Budget: the spending and leftover tables add up', async ({ page, request }) => {
  const budget = await budgetPage(request);
  await page.goto('/budget');
  const spending = page.getByRole('table', { name: /^Spending: \d+ rows?$/ });
  await expect(spending.locator('tfoot')).toContainText('Planned spend');
  await expect(page.getByRole('table', { name: 'Leftover split' }).locator('tfoot')).toContainText(
    'Left over',
  );
  const transfers = page.getByRole('table', { name: 'Payday transfers' });
  await expect(transfers).toBeVisible();
  // One line per transfer group, plus "Not assigned" when some rows have no account.
  await expect(transfers.locator('tbody tr')).toHaveCount(
    budget.transfers.length + (budget.unassigned.rows > 0 ? 1 : 0),
  );
});

test('Dividends: a fake-mode check suggests dividends for the synthetic ETFs', async ({
  page,
  request,
}, testInfo) => {
  const errors = trackConsoleErrors(page);
  const refresh = await request.post('/api/dividends/suggestions/refresh');
  expect(refresh.status(), await refresh.text()).toBe(200);
  const dividends = await dividendsPage(request);
  expect(dividends.events.mode).toBe('fake');
  expect(dividends.events.lastRefreshAt).not.toBeNull();
  const active = dividends.suggestions.filter((s) => s.status !== 'dismissed');
  // The fake provider gives every held Yahoo-priced ETF quarterly events; crypto is never fetched.
  for (const symbol of SYNTHETIC_HELD.etf) {
    expect(
      active.some((s) => s.symbol === symbol),
      `a suggestion for ${symbol}`,
    ).toBe(true);
  }
  expect(active.every((s) => s.kind !== 'crypto')).toBe(true);
  await page.goto('/dividends');
  await expect(page.getByText('Test data')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggestions from Yahoo' })).toBeVisible();
  const table = page.getByRole('table', {
    name: `Suggestions from Yahoo: ${counted(active.length, 'suggestion')}`,
  });
  await expect(table).toBeVisible();
  for (const symbol of SYNTHETIC_HELD.etf) {
    await expect(table.getByText(symbol, { exact: true }).first()).toBeVisible();
  }
  const ledger = page.getByRole('table', {
    name: `Dividends: ${counted(dividends.dividends.length, 'payment')}`,
  });
  await expect(ledger).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'cashflow', 'dividends-suggestions');
  expect(errors).toEqual([]);
});
