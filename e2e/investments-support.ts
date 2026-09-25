// Shared e2e helpers for the investment pages (stage-2.md §7.6 step 2). Drafted by web phase A;
// the Integrator owns and finishes them. Every row an e2e spec creates carries E2E_NOTE, so
// `cleanupE2eRows` can remove what a crashed run left behind (an app row makes the Stage 1 import
// answer 409, D34).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  InvestmentPageResponse,
  InvestmentTradesResponse,
} from '../packages/schema/src/dto/investments';
import type { PricesResponse } from '../packages/schema/src/dto/prices';
import type { InstrumentKind } from '../packages/schema/src/enums';
import { investmentTrades } from '../packages/schema/src/fixtures/investments';

export const E2E_NOTE = 'e2e-temp';

export const INVESTMENT_KINDS: readonly InstrumentKind[] = [
  'stock',
  'etf',
  'managed_fund',
  'crypto',
];

export const KIND_PAGES: Readonly<Record<InstrumentKind, { path: string; title: string }>> = {
  stock: { path: '/stocks', title: 'Stocks' },
  etf: { path: '/etfs', title: 'ETFs' },
  managed_fund: { path: '/managed-funds', title: 'Managed Funds' },
  crypto: { path: '/crypto', title: 'Crypto' },
};

/** The generic symbols the synthetic workbook holds (and the exited ETF), per kind. */
export const SYNTHETIC_HELD: Readonly<Record<InstrumentKind, readonly string[]>> = {
  stock: ['ASX:ABC', 'ASX:XYZ'],
  etf: ['ASX:DEF', 'ASX:MNO'],
  managed_fund: ['EXAMPLEFUND'],
  crypto: ['BTC', 'ETH'],
};
export const SYNTHETIC_EXITED_ETF = 'ASX:OLD';

const POLL_MS = 1_000;
const MAX_WAIT_MS = 60_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fails the run when the investments API is missing (e.g. an accidental revert to the scaffold's
 * 501 stubs): the specs must fail then, never skip.
 */
export async function expectInvestmentsApi(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/investments/etf');
  expect(response.status(), 'GET /api/investments/etf').toBe(200);
}

export async function investmentPage(
  request: APIRequestContext,
  kind: InstrumentKind,
): Promise<InvestmentPageResponse> {
  const response = await request.get(`/api/investments/${kind}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as InvestmentPageResponse;
}

export async function investmentLedger(
  request: APIRequestContext,
  kind: InstrumentKind,
): Promise<InvestmentTradesResponse> {
  const response = await request.get(`/api/investments/${kind}/trades`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as InvestmentTradesResponse;
}

const isE2eNote = (note: string | null): boolean => note !== null && note.startsWith(E2E_NOTE);

/**
 * Deletes every trade whose note starts with E2E_NOTE (each kind's ledger), then every instrument
 * whose note starts with it and that has no trades left. Safe to run when there is nothing to
 * delete, or before any import (a 404/501 page is skipped).
 */
export async function cleanupE2eRows(request: APIRequestContext): Promise<void> {
  for (const kind of INVESTMENT_KINDS) {
    const ledger = await request.get(`/api/investments/${kind}/trades`);
    if (ledger.status() !== 200) continue;
    const { trades } = (await ledger.json()) as InvestmentTradesResponse;
    // Newest first, so a sell goes before the buy it needs (no 422 on the way).
    for (const trade of trades.filter((t) => isE2eNote(t.note))) {
      const response = await request.delete(`/api/trades/${trade.id}`);
      expect([200, 404], await response.text()).toContain(response.status());
    }
  }
  for (const kind of INVESTMENT_KINDS) {
    const page = await request.get(`/api/investments/${kind}`);
    if (page.status() !== 200) continue;
    const { holdings } = (await page.json()) as InvestmentPageResponse;
    const ledger = await investmentLedger(request, kind);
    for (const holding of holdings.filter((h) => isE2eNote(h.note))) {
      if (ledger.trades.some((t) => t.instrumentId === holding.instrumentId)) continue;
      const response = await request.delete(`/api/instruments/${holding.instrumentId}`);
      expect([200, 404, 409], await response.text()).toContain(response.status());
    }
  }
}

/** Polls `/api/prices` until no refresh is running. */
export async function waitForPrices(request: APIRequestContext): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const response = await request.get('/api/prices');
    expect(response.status(), await response.text()).toBe(200);
    const prices = (await response.json()) as PricesResponse;
    if (!prices.running || Date.now() > deadline) return;
    await sleep(POLL_MS);
  }
}

/**
 * Renders a fixture-only state in a real browser: `/api/investments/<kind>` answers `fixture`, and
 * its ledger answers the kind's fixture ledger (or `trades`). No data is touched.
 */
export async function mockInvestmentPage(
  page: Page,
  fixture: InvestmentPageResponse,
  trades?: InvestmentTradesResponse,
): Promise<void> {
  const ledger = trades ?? investmentTrades[fixture.kind];
  await page.route('**/api/investments/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/trades') ? ledger : fixture;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}
