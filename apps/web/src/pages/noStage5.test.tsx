// stage-5.md §6.7: every user-facing "Stage 5" text is now a present-tense line with a link. This
// renders every page with the fixture states that carried one (no recorded months, the provisional
// period, the end-of-year anchor, the next-buy footer) and asserts no page shows "Stage 5" (Stage 6
// and 7 mentions stay allowed).
import {
  budgetPages,
  cashPages,
  dividendsPages,
  historyPages,
  investmentPageTiming,
  investmentPages,
  investmentTrades,
  netWorthPages,
  otherAssetsPages,
  propertyPages,
  settingsPages,
  sideIncomePages,
  superPages,
} from '@joinr/schema/fixtures';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

function mockEverything(variant: 'populated' | 'empty'): void {
  const pick = (populated: unknown, empty: unknown): unknown =>
    variant === 'populated' ? populated : empty;
  mockApi({
    'GET /api/net-worth': { body: pick(netWorthPages.populated, netWorthPages.noSnapshots) },
    'GET /api/history': { body: pick(historyPages.populated, historyPages.noSnapshots) },
    'GET /api/settings': { body: settingsPages.populated },
    'GET /api/cash': { body: pick(cashPages.populated, cashPages.noSnapshots) },
    'GET /api/side-income': { body: pick(sideIncomePages.populated, sideIncomePages.noSnapshots) },
    'GET /api/budget': { body: budgetPages.autoSplit },
    'GET /api/dividends': { body: pick(dividendsPages.populated, dividendsPages.empty) },
    'GET /api/other-assets': {
      body: pick(otherAssetsPages.populated, otherAssetsPages.noSnapshots),
    },
    'GET /api/super': { body: pick(superPages.populated, superPages.noSnapshots) },
    'GET /api/property': { body: pick(propertyPages.populated, propertyPages.empty) },
    'GET /api/investments/etf': {
      body: pick(investmentPages.etf, investmentPageTiming.unavailable),
    },
    'GET /api/investments/etf/trades': { body: investmentTrades.etf },
    'GET /api/investments/stock': { body: investmentPages.stock },
    'GET /api/investments/stock/trades': { body: investmentTrades.stock },
    'GET /api/import/runs': {
      body: { runs: [], inProgress: false, hasImportedData: true, hasAppData: false },
    },
  });
}

const PAGES = [
  '/',
  '/history',
  '/settings',
  '/cash',
  '/side-income',
  '/budget',
  '/dividends',
  '/other-assets',
  '/super',
  '/property',
  '/etfs',
  '/stocks',
];

describe('no page shows "Stage 5" (§6.7)', () => {
  it.each(PAGES.flatMap((path) => [[path, 'populated'] as const, [path, 'empty'] as const]))(
    '%s (%s)',
    async (path, variant) => {
      mockEverything(variant);
      renderApp(path);
      const main = await screen.findByRole('main');
      await waitFor(() => expect(main.querySelector('.jf-app-loading')).toBeNull());
      await waitFor(() => expect(main.querySelectorAll('h2').length).toBeGreaterThan(0));
      expect(main).not.toHaveTextContent('Stage 5');
    },
  );
});
