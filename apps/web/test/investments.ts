// Helpers for the investment page tests: mock the page and ledger routes, and read table cells by
// column header.
import type {
  HoldingDetailResponse,
  InstrumentKind,
  InvestmentPageResponse,
  InvestmentTradesResponse,
} from '@joinr/schema';
import { investmentPages, investmentTrades } from '@joinr/schema/fixtures';
import { within } from '@testing-library/react';
import { mockApi, type MockHandler } from './mockApi';

export const KIND_PATHS: Readonly<Record<InstrumentKind, string>> = {
  stock: '/stocks',
  etf: '/etfs',
  managed_fund: '/managed-funds',
  crypto: '/crypto',
};

/** Stubs `GET /api/investments/:kind` and its ledger (defaults: the populated fixtures). */
export function mockInvestments(
  kind: InstrumentKind,
  options: {
    page?: InvestmentPageResponse | MockHandler;
    trades?: InvestmentTradesResponse | MockHandler;
    routes?: Record<string, MockHandler>;
  } = {},
) {
  const page = options.page ?? investmentPages[kind];
  const trades = options.trades ?? investmentTrades[kind];
  const asHandler = (value: unknown): MockHandler =>
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'status' in value)
      ? (value as MockHandler)
      : { body: value };
  return mockApi({
    [`GET /api/investments/${kind}`]: asHandler(page),
    [`GET /api/investments/${kind}/trades`]: asHandler(trades),
    ...options.routes,
  });
}

/** Stubs `GET /api/instruments/:id` with a holding detail. */
export function detailRoute(detail: HoldingDetailResponse): Record<string, MockHandler> {
  return { [`GET /api/instruments/${detail.instrument.id}`]: { body: detail } };
}

/** The column headers' text, in order. */
export function headers(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.trim() ?? '');
}

/** The body row whose first cell contains `text`. */
export function rowOf(table: HTMLElement, text: string): HTMLElement {
  const row = [...table.querySelectorAll('tbody tr')].find((tr) =>
    tr.firstElementChild?.textContent?.includes(text),
  );
  if (!row) throw new Error(`No row "${text}"`);
  return row as HTMLElement;
}

/** The total (tfoot) row. */
export function totalRow(table: HTMLElement): HTMLElement {
  const row = table.querySelector('tfoot tr');
  if (!row) throw new Error('No total row');
  return row as HTMLElement;
}

/** The text of a row's cell under the column with this header. */
export function cell(table: HTMLElement, row: HTMLElement, header: string): string {
  const index = headers(table).indexOf(header);
  if (index === -1) throw new Error(`No column "${header}" in ${headers(table).join(', ')}`);
  return row.children[index]?.textContent?.trim() ?? '';
}
