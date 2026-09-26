// The Net Worth dashboard on the synthetic import (stage-5.md §7.8 step 3), desktop and phone,
// read-only: the h1, the hero (four tiles, one teal figure), assets − liabilities = net worth on
// screen and against the API, the charts render (an svg, a table or the empty message), the view
// switch (the query and the unit's title, nothing saved), no page-level horizontal scroll, no
// console errors, screenshots; the 768–1199 px check and the 1440 px check (the hero band ≤ 200 px,
// no inner scroll on the assets-and-liabilities table).
// Drafted by web phase A; finished by the Integrator against the real API.
import { expect, test, type Page } from '@playwright/test';
import { netWorthPages } from '../packages/schema/src/fixtures/history';
import { splitWordsInFirstColumn, splitWordsInTable, tableScrolls } from './assets-support';
import {
  FIT_AT_1440_TABLES,
  SCROLL_AT_1440_TABLES,
  WIDTH_CHECK_TABLES,
  expectHistoryApi,
  heroHeight,
  mockHistoryPage,
  netWorthPage,
} from './history-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

test.beforeEach(async ({ request }) => {
  test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  await ensureImported(request);
  await expectHistoryApi(request);
});

/** "$496,810.00" / "−$5.00" → cents. */
function centsOf(text: string): number {
  const t = text.replace(/\s/g, '');
  const negative = t.startsWith('−') || t.startsWith('-');
  const [whole = '0', frac = '0'] = t.replace(/[^0-9.]/g, '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

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

test('Net worth: hero, tables and charts', async ({ page, request }, testInfo) => {
  const errors = trackConsoleErrors(page);
  let api = await netWorthPage(request);
  const table = page.getByRole('table', { name: 'Assets and liabilities', exact: true });
  const value = async (label: string) =>
    centsOf(
      (await table
        .locator('tr', { has: page.getByRole('rowheader', { name: label, exact: true }) })
        .locator('td')
        .first()
        .textContent()) ?? '',
    );
  // Assets − liabilities = net worth, on screen and as the API says. Prices from the post-import
  // refresh can land between the API fetch and the page load, so fetch and load again until the
  // two agree.
  await expect(async () => {
    api = await netWorthPage(request);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Net worth', exact: true }),
    ).toBeVisible();
    const assets = await value('Total assets');
    const liabilities = await value('Total liabilities');
    const net = centsOf((await table.locator('tfoot td').first().textContent()) ?? '');
    expect(assets).toBe(api.assetsCents);
    expect(liabilities).toBe(api.liabilitiesCents);
    expect(net).toBe(assets - liabilities);
    expect(net).toBe(api.live.netWorth.netWorthCents);
  }).toPass({ timeout: 30_000 });
  const hero = page.getByRole('region', { name: 'Net worth summary' });
  await expect(hero.getByRole('group')).toHaveCount(4);
  await expect(page.locator('.jf-stat-tile--key')).toHaveCount(1);
  // The rolling table has one row per recorded month plus the live row; the projection sits in
  // its own collapsed table (§6.3 item 6).
  const shown = api.rolling.filter((row) => row.status !== 'projected');
  const projected = api.rolling.length - shown.length;
  const rolling = page.getByRole('table', { name: 'Rolling net worth', exact: true });
  await expect(rolling.locator('tbody tr')).toHaveCount(shown.length);
  if (api.rolling.some((row) => row.status === 'live')) {
    await expect(rolling.locator('tbody tr').first()).toContainText('Live');
  }
  await expect(
    // Inside a closed <details>, so hidden from the accessibility tree until opened.
    page
      .getByRole('table', { name: 'Projected liquid assets', exact: true, includeHidden: true })
      .locator('tbody tr'),
  ).toHaveCount(projected);
  await expectChartsRender(page);
  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'networth', 'page');
  expect(errors).toEqual([]);
});

test('Net worth: the view switch sends the query, keeps the page and saves nothing', async ({
  page,
}) => {
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: /^Net worth by / })).toBeVisible();
  const query = page.waitForRequest(
    (r) => r.url().includes('/api/net-worth?') && r.url().includes('unit=quarterly'),
  );
  await page
    .getByRole('group', { name: 'Chart view' })
    .getByRole('button', { name: 'Quarterly', exact: true })
    .click();
  await query;
  await expect(page.getByRole('region', { name: 'Net worth by quarter' })).toBeVisible();
  await expect(page.getByText('Loading net worth…')).toHaveCount(0);
  expect(patches).toEqual([]);
});

test('Net worth: the populated fixture draws eight distribution slices', async ({
  page,
}, testInfo) => {
  await mockHistoryPage(page, 'net-worth', netWorthPages.populated);
  await page.goto('/');
  const donut = page.getByRole('region', { name: 'Distribution', exact: true });
  await expect(donut.locator('.jf-chart__legend-item')).toHaveCount(8);
  await shot(page, testInfo, 'networth', 'fixture-populated');
});

// Between 768 and 1199 px the wide tables use the compact grid: the first column keeps at least
// 200 px and whole words; the assets table and the liquid-allocation card take the full tablet
// width (spanTablet 6), so the assets table does not scroll at 1024 px (§6.8).
for (const width of [800, 1024, 1199]) {
  test(`Net worth and History tables keep whole words at ${width} px`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    for (const { path, name } of WIDTH_CHECK_TABLES) {
      await page.goto(path);
      const table = page.getByRole('table', { name }).first();
      await expect(table, String(name)).toBeVisible();
      const first = table.locator('thead th').first();
      await first.scrollIntoViewIfNeeded();
      const box = await first.boundingBox();
      if (/Rolling|Recorded|Audit/.test(String(name))) {
        expect(
          box?.width ?? 0,
          `${String(name)} first column at ${width} px`,
        ).toBeGreaterThanOrEqual(200);
      }
      expect(await splitWordsInFirstColumn(page, name), `${String(name)} at ${width} px`).toEqual(
        [],
      );
      expect(await splitWordsInTable(page, name), `${String(name)} cells at ${width} px`).toEqual(
        [],
      );
      await expectNoHorizontalScroll(page);
    }
    if (width === 1024) {
      await page.goto('/');
      expect(await tableScrolls(page, /^Assets and liabilities$/), 'assets table at 1024').toBe(
        false,
      );
    }
  });
}

test('at 1440 px: the hero band ≤ 200 px; the fitting tables fit; the wide ones scroll sticky', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const height = await heroHeight(page);
  expect(height).toBeGreaterThanOrEqual(140);
  expect(height).toBeLessThanOrEqual(200);
  for (const { path, name } of FIT_AT_1440_TABLES) {
    await page.goto(path);
    const table = page.getByRole('table', { name }).first();
    if ((await table.count()) === 0) continue;
    expect(await tableScrolls(page, name), `${String(name)} scrolls at 1440 px`).toBe(false);
  }
  for (const { path, name } of SCROLL_AT_1440_TABLES) {
    await page.goto(path);
    const cell = page
      .getByRole('table', { name })
      .first()
      .locator('tbody tr > :first-child')
      .first();
    expect(await cell.evaluate((c) => getComputedStyle(c).position)).toBe('sticky');
  }
});

// Fixer round 1 (STYLE-12): with the fixtures' wider figures the assets table still fits at 1440
// and 1024 px, and its figure headers ("Gain %") keep one line.
for (const [state, fixture] of [
  ['populated', netWorthPages.populated],
  ['negativeEquity', netWorthPages.negativeEquity],
] as const) {
  test(`Net worth (${state} fixture): the assets table fits; "Gain %" keeps one line`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The widths are set explicitly; one project.');
    await mockHistoryPage(page, 'net-worth', fixture);
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const name = /^Assets and liabilities$/;
      const table = page.getByRole('table', { name }).first();
      await expect(table).toBeVisible();
      expect(await tableScrolls(page, name), `assets table scrolls at ${width} px`).toBe(false);
      for (const header of ['Value', 'Gain', 'Gain %']) {
        const lines = await table
          .locator('thead th')
          .filter({ hasText: new RegExp(`^${header}$`) })
          .evaluate((th) => {
            const range = document.createRange();
            range.selectNodeContents(th);
            return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
          });
        expect(lines, `"${header}" header lines at ${width} px`).toBe(1);
      }
    }
  });
}
