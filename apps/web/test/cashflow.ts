// Helpers for the cash-flow page tests (stage-3.md §7.7 step 3): mock the four page routes (the
// @joinr/schema fixtures by default) and the import runs (`hasAppData`), and read tables.
import type {
  BudgetPageResponse,
  CashPageResponse,
  DividendsPageResponse,
  ImportRunsResponse,
  SideIncomePageResponse,
} from '@joinr/schema';
import {
  budgetPages,
  cashPages,
  dividendsPages,
  importRunsPopulated,
  sideIncomePages,
} from '@joinr/schema/fixtures';
import { screen, within } from '@testing-library/react';
import { mockApi, type MockHandler } from './mockApi';

export type PageBody<T> = T | MockHandler;

function asHandler(value: unknown): MockHandler {
  return typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'status' in value && !('asOf' in value))
    ? (value as MockHandler)
    : { body: value };
}

export interface CashflowMocks {
  cash?: PageBody<CashPageResponse>;
  sideIncome?: PageBody<SideIncomePageResponse>;
  budget?: PageBody<BudgetPageResponse>;
  dividends?: PageBody<DividendsPageResponse>;
  /** Default: imported data, no app data (the new-app-row note shows). */
  importRuns?: PageBody<ImportRunsResponse>;
  routes?: Record<string, MockHandler>;
}

/** Stubs the four cash-flow GETs and `/api/import/runs` (defaults: the populated fixtures). */
export function mockCashflow(options: CashflowMocks = {}) {
  return mockApi({
    'GET /api/cash': asHandler(options.cash ?? cashPages.populated),
    'GET /api/side-income': asHandler(options.sideIncome ?? sideIncomePages.populated),
    'GET /api/budget': asHandler(options.budget ?? budgetPages.autoSplit),
    'GET /api/dividends': asHandler(options.dividends ?? dividendsPages.populated),
    'GET /api/import/runs': asHandler(options.importRuns ?? importRunsPopulated),
    ...options.routes,
  });
}

/** A table by its accessible name (its caption). */
export function tableNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole('table', { name });
}

/** The body rows of a table. */
export function bodyRows(table: HTMLElement): HTMLElement[] {
  return [...table.querySelectorAll<HTMLElement>('tbody tr')];
}

/** The text of every cell in a column (by header), body rows only. */
export function columnTexts(table: HTMLElement, header: string): string[] {
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.trim() ?? '');
  const index = headers.indexOf(header);
  if (index === -1) throw new Error(`No column "${header}" in ${headers.join(', ')}`);
  return bodyRows(table).map((row) => row.children[index]?.textContent?.trim() ?? '');
}

/** Parses "$1,234.56" / "−$5.00" / "—" into cents (null for a dash). */
export function centsOf(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (t === '' || t === '—') return null;
  const negative = t.startsWith('−') || t.startsWith('-');
  const digits = t.replace(/[^0-9.]/g, '');
  const [whole = '0', frac = '0'] = digits.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}
