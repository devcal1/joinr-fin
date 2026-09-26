// Shared e2e helpers for the assets pages (stage-4.md §7.8 step 2). Drafted by web phase A; the
// Integrator owns and finishes them. Every row an assets spec creates carries E2E_NOTE (in its
// note, or its name or description when the row has no note), so `cleanupAssetsRows` can remove
// what a crashed run left behind (an app row makes the Stage 1 import answer 409, D34).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  OtherAssetsPageResponse,
  PropertyPageResponse,
  SuperPageResponse,
} from '../packages/schema/src/dto/assets';
import { E2E_NOTE } from './investments-support';

export { E2E_NOTE };

export type AssetsRoute = 'other-assets' | 'super' | 'property';

export const ASSETS_PAGES: Readonly<
  Record<AssetsRoute, { path: string; title: string; keyTile: string }>
> = {
  'other-assets': { path: '/other-assets', title: 'Other Assets', keyTile: 'Current value' },
  super: { path: '/super', title: 'Super', keyTile: 'Total super' },
  property: { path: '/property', title: 'Property', keyTile: 'Equity' },
};

export const ASSETS_ROUTES = Object.keys(ASSETS_PAGES) as AssetsRoute[];

export const isE2e = (text: string | null | undefined): boolean =>
  typeof text === 'string' && text.startsWith(E2E_NOTE);

/**
 * Fails the run when an assets API is missing (e.g. the scaffold's 501 stubs, or an engine that
 * still throws): the specs must fail then, never skip.
 */
export async function expectAssetsApi(request: APIRequestContext): Promise<void> {
  for (const route of ASSETS_ROUTES) {
    const response = await request.get(`/api/${route}`);
    expect(response.status(), `GET /api/${route}: ${await response.text()}`).toBe(200);
  }
}

async function getPage<T>(request: APIRequestContext, route: AssetsRoute): Promise<T | null> {
  const response = await request.get(`/api/${route}`);
  return response.status() === 200 ? ((await response.json()) as T) : null;
}

async function mustGet<T>(request: APIRequestContext, route: AssetsRoute): Promise<T> {
  const response = await request.get(`/api/${route}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as T;
}

export function otherAssetsPage(request: APIRequestContext): Promise<OtherAssetsPageResponse> {
  return mustGet<OtherAssetsPageResponse>(request, 'other-assets');
}

export function superPage(request: APIRequestContext): Promise<SuperPageResponse> {
  return mustGet<SuperPageResponse>(request, 'super');
}

export function propertyPage(request: APIRequestContext): Promise<PropertyPageResponse> {
  return mustGet<PropertyPageResponse>(request, 'property');
}

async function remove(request: APIRequestContext, path: string, ok: number[] = [200, 404]) {
  const response = await request.delete(path);
  expect(ok, `DELETE ${path}: ${await response.text()}`).toContain(response.status());
}

/**
 * Removes every assets row whose note, name or description starts with E2E_NOTE: other assets
 * (their prices and sales go with them), sales and price entries of other items, super
 * contributions, balance entries, SG statements and funds, loan entries, loans, valuations and
 * properties; and unlinks from the loans that stay any offset account an e2e spec created (the
 * cash accounts themselves are removed by `cleanupCashflowRows`). Safe with nothing to delete, and
 * before any import (a page that does not answer 200 is skipped).
 */
export async function cleanupAssetsRows(request: APIRequestContext): Promise<void> {
  const other = await getPage<OtherAssetsPageResponse>(request, 'other-assets');
  if (other) {
    const e2eAssets = new Set(
      other.assets.filter((a) => isE2e(a.description) || isE2e(a.note)).map((a) => a.id),
    );
    for (const sale of other.sales.filter((s) => isE2e(s.note) && !e2eAssets.has(s.assetId))) {
      await remove(request, `/api/other-assets/sales/${sale.id}`);
    }
    for (const entry of other.priceEntries.filter(
      (e) => isE2e(e.note) && !e2eAssets.has(e.assetId),
    )) {
      await remove(request, `/api/other-assets/price-entries/${entry.id}`);
    }
    for (const id of e2eAssets) await remove(request, `/api/other-assets/${id}`);
  }

  const sup = await getPage<SuperPageResponse>(request, 'super');
  if (sup) {
    for (const contribution of sup.contributions.filter((c) => isE2e(c.note))) {
      await remove(request, `/api/super/contributions/${contribution.id}`);
    }
    for (const month of sup.sgMonths.filter((m) => m.source === 'statement' && isE2e(m.note))) {
      await remove(request, `/api/super/sg/${month.month}`);
    }
    const e2eFunds = new Set(sup.funds.filter((f) => isE2e(f.name)).map((f) => f.id));
    for (const entry of sup.balanceEntries.filter(
      (e) => isE2e(e.note) && !e2eFunds.has(e.fundId),
    )) {
      // A fund's only entry answers 409 LAST_BALANCE_ENTRY and is kept.
      await remove(request, `/api/super/balance-entries/${entry.id}`, [200, 404, 409]);
    }
    for (const id of e2eFunds) await remove(request, `/api/super/funds/${id}`, [200, 404, 409]);
  }

  const property = await getPage<PropertyPageResponse>(request, 'property');
  if (property) {
    const e2eLoans = new Set(property.loans.filter((l) => isE2e(l.name)).map((l) => l.id));
    const e2eOffsets = new Set(
      property.offsetAccounts.filter((a) => isE2e(a.name)).map((a) => a.id),
    );
    for (const loan of property.loans.filter((l) => !e2eLoans.has(l.id))) {
      const kept = loan.offsetAccountIds.filter((id) => !e2eOffsets.has(id));
      if (kept.length !== loan.offsetAccountIds.length) {
        const response = await request.put(`/api/property/loans/${loan.id}/offsets`, {
          data: { accountIds: kept },
        });
        expect([200, 404], await response.text()).toContain(response.status());
      }
    }
    for (const entry of property.loanEntries.filter(
      (e) => e.id !== null && isE2e(e.note) && !e2eLoans.has(e.loanId),
    )) {
      await remove(request, `/api/property/loan-balance-entries/${entry.id}`, [200, 404, 409]);
    }
    for (const id of e2eLoans) await remove(request, `/api/property/loans/${id}`);
    const e2eProperties = new Set(
      property.properties.filter((p) => isE2e(p.name)).map((p) => p.id),
    );
    for (const valuation of property.valuations.filter(
      (v) => isE2e(v.note) && !e2eProperties.has(v.propertyId),
    )) {
      await remove(request, `/api/property/valuation-entries/${valuation.id}`, [200, 404, 409]);
    }
    for (const id of e2eProperties) {
      await remove(request, `/api/property/properties/${id}`, [200, 404, 409]);
    }
  }
}

/**
 * Renders a fixture-only state in a real browser: `/api/<route>` answers `fixture`. No data is
 * touched (the rest of the API, e.g. the header status and the import runs, stays live).
 */
export async function mockAssetsPage(
  page: Page,
  route: AssetsRoute,
  fixture: OtherAssetsPageResponse | SuperPageResponse | PropertyPageResponse,
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

/**
 * The tables §6.8 checks from 768 to 1199 px (UX-20): the first column holds a name or date and
 * keeps at least 200 px with whole words. `name` matches the table's caption; `path` is its page;
 * `open` reveals it when it sits behind a Table toggle.
 */
export const WIDTH_CHECK_TABLES: readonly {
  path: string;
  name: RegExp;
  open?: { card: string };
}[] = [
  { path: '/other-assets', name: /^Assets: / },
  { path: '/other-assets', name: /^Sales: / },
  { path: '/super', name: /^Funds: / },
  { path: '/super', name: /^Balance history: /, open: { card: 'Balance history' } },
  { path: '/super', name: /^Contributions: / },
  { path: '/super', name: /^Employer SG by month$/ },
  { path: '/super', name: /^Super by period: / },
  { path: '/property', name: /^Valuations: /, open: { card: 'Valuations' } },
  { path: '/property', name: /^Balance log: / },
];

/**
 * The tables that must fit the 1152 px content area at 1440 px without inner scroll (UX-20); the
 * assets and contributions tables may scroll inside their container with the first column sticky.
 */
export const FIT_AT_1440_TABLES: readonly {
  path: string;
  name: RegExp;
  open?: { card: string };
}[] = [
  { path: '/other-assets', name: /^Sales: / },
  { path: '/other-assets', name: /^Price history: /, open: { card: 'Price history' } },
  { path: '/super', name: /^Funds: / },
  { path: '/super', name: /^Balance history: /, open: { card: 'Balance history' } },
  { path: '/super', name: /^Employer SG by month$/ },
  { path: '/super', name: /^Super by period: / },
  { path: '/property', name: /^Valuations: /, open: { card: 'Valuations' } },
  { path: '/property', name: /^Balance log: / },
];

/** The two wide tables that may scroll inside their container at 1440 px, first column sticky. */
export const SCROLL_AT_1440_TABLES: readonly {
  path: string;
  name: RegExp;
  open?: { card: string };
}[] = [
  { path: '/other-assets', name: /^Assets: / },
  { path: '/super', name: /^Contributions: / },
];

/** Switches a chart card to its table view (the card is a region named by its title). */
export async function showTable(page: Page, card: string): Promise<void> {
  const region = page.getByRole('region', { name: card, exact: true }).first();
  await region.getByRole('button', { name: 'Table', exact: true }).click();
}

/** The words in a table's cells (`cellSelector`) that land on more than one line (split mid-word). */
async function splitWordsIn(page: Page, name: RegExp, cellSelector: string): Promise<string[]> {
  const table = page.getByRole('table', { name }).first();
  return table.evaluate((element, selector) => {
    const split: string[] = [];
    const cells = element.querySelectorAll(selector);
    for (const cell of cells) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // Visually hidden reasons are absolutely positioned; skip them.
        const parent = node.parentElement;
        if (parent?.closest('.jf-visually-hidden')) continue;
        const text = node.textContent ?? '';
        let start = 0;
        for (const word of text.split(' ')) {
          if (word) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + word.length);
            const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (lines.size > 1) split.push(word);
          }
          start += word.length + 1;
        }
      }
    }
    return split;
  }, cellSelector);
}

/** The words of a table's first column that land on more than one line (split mid-word). */
export async function splitWordsInFirstColumn(page: Page, name: RegExp): Promise<string[]> {
  return splitWordsIn(page, name, 'tbody tr > :first-child');
}

/**
 * The words of every body cell of a table that land on more than one line (split mid-word): the
 * 768–1199 px rule covers every column, not only the first (UX-20; Fixer round 1, STYLE-3).
 */
export async function splitWordsInTable(page: Page, name: RegExp): Promise<string[]> {
  return splitWordsIn(page, name, 'tbody tr > *');
}

/** True when a table scrolls sideways inside its container. */
export async function tableScrolls(page: Page, name: RegExp): Promise<boolean> {
  const scroller = page.getByRole('table', { name }).first().locator('xpath=..');
  return scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
}
