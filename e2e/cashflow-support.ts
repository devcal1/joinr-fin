// Shared e2e helpers for the cash-flow pages (stage-3.md §7.8 step 2). Drafted by web phase A; the
// Integrator owns and finishes them. Every row a cash-flow spec creates carries E2E_NOTE (in its
// note, or its name when the row has no note), so `cleanupCashflowRows` can remove what a crashed
// run left behind (an app row makes the Stage 1 import answer 409, D34).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  BudgetPageResponse,
  CashPageResponse,
  DividendsPageResponse,
  SideIncomePageResponse,
} from '../packages/schema/src/dto/cashflow';
import { E2E_NOTE } from './investments-support';

export { E2E_NOTE };

export type CashflowRoute = 'cash' | 'side-income' | 'budget' | 'dividends';

export const CASHFLOW_PAGES: Readonly<
  Record<CashflowRoute, { path: string; title: string; keyTile: string }>
> = {
  cash: { path: '/cash', title: 'Cash', keyTile: 'Total cash' },
  'side-income': { path: '/side-income', title: 'Side Income', keyTile: 'This FY so far' },
  budget: { path: '/budget', title: 'Budget', keyTile: 'Left over each month' },
  dividends: { path: '/dividends', title: 'Dividends', keyTile: 'This FY' },
};

export const CASHFLOW_ROUTES = Object.keys(CASHFLOW_PAGES) as CashflowRoute[];

const isE2e = (text: string | null | undefined): boolean =>
  typeof text === 'string' && text.startsWith(E2E_NOTE);

/**
 * Fails the run when a cash-flow API is missing (e.g. the scaffold's 501 stubs): the specs must
 * fail then, never skip.
 */
export async function expectCashflowApi(request: APIRequestContext): Promise<void> {
  for (const route of CASHFLOW_ROUTES) {
    const response = await request.get(`/api/${route}`);
    expect(response.status(), `GET /api/${route}`).toBe(200);
  }
}

async function getPage<T>(request: APIRequestContext, route: CashflowRoute): Promise<T | null> {
  const response = await request.get(`/api/${route}`);
  return response.status() === 200 ? ((await response.json()) as T) : null;
}

export async function cashPage(request: APIRequestContext): Promise<CashPageResponse> {
  const response = await request.get('/api/cash');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as CashPageResponse;
}

export async function sideIncomePage(request: APIRequestContext): Promise<SideIncomePageResponse> {
  const response = await request.get('/api/side-income');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as SideIncomePageResponse;
}

export async function budgetPage(request: APIRequestContext): Promise<BudgetPageResponse> {
  const response = await request.get('/api/budget');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as BudgetPageResponse;
}

export async function dividendsPage(request: APIRequestContext): Promise<DividendsPageResponse> {
  const response = await request.get('/api/dividends');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as DividendsPageResponse;
}

async function remove(request: APIRequestContext, path: string, ok: number[] = [200, 404]) {
  const response = await request.delete(path);
  expect(ok, `DELETE ${path}: ${await response.text()}`).toContain(response.status());
}

/**
 * Removes every cash-flow row whose note (accounts, deposits, dividends, balance entries,
 * adjustments) or name (budget items, yearly expenses, streams, goals) starts with E2E_NOTE.
 * Safe with nothing to delete, and before any import (a page that does not answer 200 is skipped).
 */
export async function cleanupCashflowRows(request: APIRequestContext): Promise<void> {
  const dividends = await getPage<DividendsPageResponse>(request, 'dividends');
  for (const row of dividends?.dividends.filter((d) => isE2e(d.note)) ?? []) {
    await remove(request, `/api/dividends/${row.id}`);
  }

  const budget = await getPage<BudgetPageResponse>(request, 'budget');
  for (const row of budget?.rows.filter((r) => r.kind === 'item' && isE2e(r.name)) ?? []) {
    if (row.id !== null) await remove(request, `/api/budget/items/${row.id}`);
  }
  for (const expense of budget?.yearlyExpenses.filter((e) => isE2e(e.name)) ?? []) {
    await remove(request, `/api/budget/yearly-expenses/${expense.id}`);
  }

  const side = await getPage<SideIncomePageResponse>(request, 'side-income');
  for (const deposit of side?.deposits.filter((d) => isE2e(d.note)) ?? []) {
    await remove(request, `/api/side-income/deposits/${deposit.id}`);
  }
  for (const stream of side?.streams.filter((s) => isE2e(s.name)) ?? []) {
    // A stream keeps its deposits' 409 (STREAM_IN_USE) when a deposit was not an e2e one.
    await remove(request, `/api/side-income/streams/${stream.id}`, [200, 404, 409]);
  }

  const cash = await getPage<CashPageResponse>(request, 'cash');
  if (cash) {
    for (const goal of cash.goals.items.filter((g) => isE2e(g.name))) {
      await remove(request, `/api/savings-goals/${goal.id}`);
    }
    const adjustments = [
      ...cash.periods.flatMap((p) => (p.adjustment ? [p.adjustment] : [])),
      ...cash.orphanAdjustments,
    ];
    for (const adjustment of adjustments.filter((a) => isE2e(a.note))) {
      await remove(request, `/api/cash/adjustments/${adjustment.periodMonth}`);
    }
    const e2eAccounts = new Set(cash.accounts.filter((a) => isE2e(a.note)).map((a) => a.id));
    // Entries first (of accounts that stay); an account's last entry answers 409 and is kept.
    for (const entry of cash.entries.filter(
      (e) => isE2e(e.note) && !e2eAccounts.has(e.accountId),
    )) {
      await remove(request, `/api/cash/balance-entries/${entry.id}`, [200, 404, 409]);
    }
    for (const id of e2eAccounts)
      await remove(request, `/api/cash/accounts/${id}`, [200, 404, 409]);
  }
}

/**
 * Renders a fixture-only state in a real browser: `/api/<route>` answers `fixture`. No data is
 * touched (the rest of the API, e.g. the header status and the import runs, stays live).
 */
export async function mockCashflowPage(
  page: Page,
  route: CashflowRoute,
  fixture: CashPageResponse | SideIncomePageResponse | BudgetPageResponse | DividendsPageResponse,
): Promise<void> {
  await page.route(`**/api/${route}`, async (request) => {
    if (request.request().method() !== 'GET') return request.fallback();
    await request.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
}

/** The text of a table's cell under `header` in the first row whose text contains `rowText`. */
export async function cellOf(
  page: Page,
  table: string | RegExp,
  rowText: string,
  header: string,
): Promise<string> {
  const locator = page.getByRole('table', { name: table });
  const headers = (await locator.getByRole('columnheader').allTextContents()).map((h) => h.trim());
  const index = headers.indexOf(header);
  expect(index, `column "${header}" in ${headers.join(', ')}`).toBeGreaterThanOrEqual(0);
  const row = locator.locator('tbody tr').filter({ hasText: rowText }).first();
  return ((await row.locator('th, td').nth(index).textContent()) ?? '').trim();
}
