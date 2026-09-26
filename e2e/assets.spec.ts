// The three assets pages on the synthetic import (stage-4.md §7.8 step 3), desktop and phone,
// read-only: each page's h1, KPI tiles (one teal figure), the main tables against the API (their
// captions and row counts), charts (an svg, a table or the empty message), no page-level
// horizontal scroll, no console errors, screenshots; the 768–1199 px check (the first column of
// every table §6.8 lists keeps at least 200 px, and every cell keeps whole words) and the 1440 px
// fit check.
// Drafted by web phase A; finished by the Integrator against the real API.
import { expect, test, type Page } from '@playwright/test';
import {
  otherAssetsPages,
  propertyPages,
  superPages,
} from '../packages/schema/src/fixtures/assets';
import {
  ASSETS_PAGES,
  ASSETS_ROUTES,
  FIT_AT_1440_TABLES,
  SCROLL_AT_1440_TABLES,
  WIDTH_CHECK_TABLES,
  expectAssetsApi,
  mockAssetsPage,
  otherAssetsPage,
  propertyPage,
  showTable,
  splitWordsInFirstColumn,
  splitWordsInTable,
  superPage,
  tableScrolls,
} from './assets-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

/** "12 items" / "1 item", as the page's captions count (plural() in apps/web). */
function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-AU')} ${count === 1 ? one : many}`;
}

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
  await expectAssetsApi(request);
});

/** Every chart card shows a chart (an svg), its table, or its empty message. */
async function expectChartsRender(page: Page): Promise<void> {
  const cards = page.locator('.jf-chart-card');
  const count = await cards.count();
  expect(count, 'chart cards on the page').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    await expect(
      card.locator('.jf-chart__host svg, .jf-chart__state, table').first(),
    ).toBeAttached();
  }
}

for (const route of ASSETS_ROUTES) {
  const { path, title, keyTile } = ASSETS_PAGES[route];
  test(`${title}: tiles, tables and charts`, async ({ page }, testInfo) => {
    const errors = trackConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: keyTile, exact: true })).toBeVisible();
    await expect(page.locator('.jf-app-kpis .jf-stat-tile')).toHaveCount(6);
    // The key figure is the page's only teal tile.
    await expect(page.locator('.jf-stat-tile--key')).toHaveCount(1);
    await expectChartsRender(page);
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'assets', route);
    expect(errors).toEqual([]);
  });
}

test('Other Assets: the items against the API; the URL-named item has one link', async ({
  page,
  request,
}) => {
  const other = await otherAssetsPage(request);
  expect(other.assets.length, 'the synthetic items').toBeGreaterThan(0);
  await page.goto('/other-assets');
  const table = page.getByRole('table', {
    name: `Assets: ${counted(other.assets.length, 'item')}`,
  });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(other.assets.length);
  const urlNamed = other.assets.find((a) => /^https?:\/\//.test(a.description));
  if (urlNamed) {
    await expect(
      table.getByRole('link', { name: `${urlNamed.description} (valuation source)` }),
    ).toHaveCount(1);
  }
});

test('Super: the funds and the periods against the API', async ({ page, request }) => {
  const sup = await superPage(request);
  await page.goto('/super');
  const funds = page.getByRole('table', { name: `Funds: ${counted(sup.funds.length, 'fund')}` });
  await expect(funds).toBeVisible();
  await expect(funds.locator('tbody tr')).toHaveCount(sup.funds.length);
  if (sup.periods.length > 0) {
    const periods = page.getByRole('table', {
      name: `Super by period: ${counted(sup.periods.length, 'row')}`,
    });
    await expect(periods.locator('tbody tr')).toHaveCount(sup.periods.length);
    await expect(periods.getByText('Baseline')).toBeVisible();
  }
  await expect(
    page.getByRole('meter', { name: /^Concessional contributions FY\d{4}–\d{2}$/ }),
  ).toBeVisible();
});

test('Property: the properties and each loan’s balance log against the API', async ({
  page,
  request,
}) => {
  const property = await propertyPage(request);
  await page.goto('/property');
  for (const p of property.properties) {
    await expect(page.getByRole('region', { name: p.name, exact: true })).toBeVisible();
  }
  for (const loan of property.loans) {
    const stored = property.loanEntries.filter((e) => e.loanId === loan.id && e.id !== null);
    const log = page.getByRole('table', {
      name: `Balance log: ${loan.name}, ${counted(stored.length, 'entry', 'entries')}`,
    });
    await expect(log).toBeVisible();
    const all = property.loanEntries.filter((e) => e.loanId === loan.id);
    await expect(log.locator('tbody tr')).toHaveCount(all.length);
    if (all.some((e) => e.start)) await expect(log.getByText('Loan start')).toBeVisible();
  }
});

// Between 768 and 1199 px (the Browser pane's width) the wide tables use compact grids so the
// first column keeps at least 200 px and never breaks a word (the Stage 3 demo lesson, UX-20). The
// check runs on the synthetic import (a table it lacks, e.g. sales, is left out) and on the
// populated fixtures, where every listed table must be present (the URL-named item included).
const SOURCES = ['synthetic import', 'populated fixtures'] as const;
type Source = (typeof SOURCES)[number];

async function useSource(page: Page, source: Source): Promise<void> {
  if (source !== 'populated fixtures') return;
  await mockAssetsPage(page, 'other-assets', otherAssetsPages.populated);
  await mockAssetsPage(page, 'super', superPages.populated);
  await mockAssetsPage(page, 'property', propertyPages.populated);
}

/** Opens a table's page (and its card's Table view); false when the table is absent. */
async function openTable(
  page: Page,
  { path, name, open }: { path: string; name: RegExp; open?: { card: string } },
  required: boolean,
): Promise<boolean> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (open) {
    const card = page.getByRole('region', { name: open.card, exact: true });
    if (!required && (await card.count()) === 0) return false;
    await showTable(page, open.card);
  }
  const table = page.getByRole('table', { name }).first();
  if (required) await expect(table, String(name)).toBeVisible();
  return (await table.count()) > 0;
}

for (const source of SOURCES) {
  // One test per width (nine page loads each), so a full parallel run stays within the timeout.
  for (const width of [800, 1024, 1199]) {
    test(`assets tables keep whole words at ${width} px (${source})`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
      test.setTimeout(90_000);
      await useSource(page, source);
      const required = source === 'populated fixtures';
      await page.setViewportSize({ width, height: 900 });
      for (const entry of WIDTH_CHECK_TABLES) {
        const { name } = entry;
        if (!(await openTable(page, entry, required))) continue;
        const first = page.getByRole('table', { name }).first().locator('thead th').first();
        await first.scrollIntoViewIfNeeded();
        const box = await first.boundingBox();
        expect(
          box?.width ?? 0,
          `${String(name)} first column at ${width} px`,
        ).toBeGreaterThanOrEqual(200);
        expect(
          await splitWordsInFirstColumn(page, name),
          `${String(name)}: words split at ${width} px`,
        ).toEqual([]);
        // Every other column keeps whole words too (labels, FY labels, dates, short status words
        // and notes; STYLE-3).
        expect(
          await splitWordsInTable(page, name),
          `${String(name)}: words split in a cell at ${width} px`,
        ).toEqual([]);
        await expectNoHorizontalScroll(page);
      }
    });
  }

  // At 1440 px the log tables fit the 1152 px content area; the assets and contributions tables
  // (11 and 10 columns) may scroll inside their container, with the first column sticky (UX-20).
  test(`at 1440 px the log tables fit the content area (${source})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
    test.setTimeout(90_000);
    await useSource(page, source);
    const required = source === 'populated fixtures';
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const entry of FIT_AT_1440_TABLES) {
      if (!(await openTable(page, entry, required))) continue;
      expect(await tableScrolls(page, entry.name), `${String(entry.name)} scrolls at 1440 px`).toBe(
        false,
      );
    }
    for (const entry of SCROLL_AT_1440_TABLES) {
      if (!(await openTable(page, entry, required))) continue;
      const position = await page
        .getByRole('table', { name: entry.name })
        .first()
        .locator('tbody tr > :first-child')
        .first()
        .evaluate((cell) => getComputedStyle(cell).position);
      expect(position, `${String(entry.name)}: the first column is sticky`).toBe('sticky');
    }
    // The assets table may scroll, but a stale row's Mark current (UX-6, in its Price cell) and
    // its Sell action are fully in view without scrolling it (STYLE-10).
    await page.goto('/other-assets');
    const assets = page.getByRole('table', { name: /^Assets: / }).first();
    await expect(assets).toBeVisible();
    const markName = /^Mark the price of .+ current$/;
    const row = assets
      .locator('tbody tr')
      .filter({ has: page.getByRole('button', { name: markName }) })
      .first();
    if (required) await expect(row, 'a stale row with Mark current').toBeVisible();
    if ((await row.count()) > 0) {
      const mark = row.getByRole('button', { name: markName });
      const sell = row.getByRole('button', { name: /^Sell / });
      const scroller = await assets.locator('xpath=..').boundingBox();
      for (const [label, button] of [
        ['Mark current', mark],
        ['Sell', sell],
      ] as const) {
        const box = await button.boundingBox();
        expect(box, `${label} has a box`).not.toBeNull();
        expect(box!.x, `${label} starts inside the table's visible box`).toBeGreaterThanOrEqual(
          scroller!.x - 0.5,
        );
        expect(
          box!.x + box!.width,
          `${label} ends inside the table's visible box at 1440 px`,
        ).toBeLessThanOrEqual(scroller!.x + scroller!.width + 0.5);
      }
    }
  });
}
