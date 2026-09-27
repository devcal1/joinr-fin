// Fixture-only FIRE states in a real browser (stage-6.md §7.5 step 4): `GET /api/fire` answers each
// `firePages` fixture (mockFirePage), so no data is touched. Every state at 1440 and 1024 (desktop
// project) and 375 (phone): the h1, the sections, no console errors, no page-level horizontal
// scroll, and a full-page screenshot (artifacts/screenshots/<project>/fire-state-<name>-<width>.png).
// Then the what-if in use, both chart views and the months used (screenshots for the style review).
// Drafted by web-fire (phase A); the Integrator finishes it.
import { expect, test, type Page } from '@playwright/test';
import { firePages } from '../packages/schema/src/fixtures/fire';
import { FIRE_API, FIRE_PATH, FIRE_WIDTHS, mockFirePage, stripText } from './fire-support';
import { expectNoHorizontalScroll, shot, trackConsoleErrors } from './support';

function widthsFor(project: string): readonly number[] {
  return project === 'phone' ? FIRE_WIDTHS.phone : FIRE_WIDTHS.desktop;
}

/** No milestone segment shows clipped words: each either fits or is hidden whole (STYLE-7). */
async function expectNoClippedSegments(page: Page): Promise<void> {
  const clipped = await page.locator('.jf-milestone-line__segment').evaluateAll((spans) =>
    spans
      .filter((s) => getComputedStyle(s).visibility !== 'hidden')
      .filter((s) => s.scrollWidth > s.clientWidth + 0.5)
      .map((s) => s.textContent),
  );
  expect(clipped).toEqual([]);
}

/**
 * Focuses the 'Extra savings a year' slider (the last field), then checks the result strip is in
 * view below the header and on top at its own point (triage STYLE-1, STYLE-2).
 */
async function expectStripInViewAtLastSlider(page: Page): Promise<void> {
  const slider = page.getByRole('slider', { name: 'Extra savings a year' });
  await slider.focus();
  await slider.scrollIntoViewIfNeeded();
  const strip = page.locator('.jf-app-fire-strip');
  await expect(strip).toHaveText(stripText(firePages.onTrack));
  const geometry = await strip.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const header = document.querySelector('.jf-shell__header')!.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 12, box.top + 3);
    return {
      top: box.top,
      bottom: box.bottom,
      headerBottom: header.bottom,
      innerHeight: window.innerHeight,
      onTop: hit !== null && el.contains(hit),
      hit: hit?.className ?? null,
    };
  });
  expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(
    geometry.headerBottom - 0.5,
  );
  expect(geometry.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.innerHeight);
  expect(geometry.onTop, JSON.stringify(geometry)).toBe(true);
}

test.describe('fire states (fixtures)', () => {
  for (const [name, fixture] of Object.entries(firePages)) {
    test(`fire: ${name}`, async ({ page }, testInfo) => {
      const errors = trackConsoleErrors(page);
      await mockFirePage(page, fixture);
      for (const width of widthsFor(testInfo.project.name)) {
        if (testInfo.project.name !== 'phone') await page.setViewportSize({ width, height: 900 });
        await page.goto(FIRE_PATH);
        await expect(
          page.getByRole('heading', { level: 1, name: 'FIRE', exact: true }),
        ).toBeVisible();
        if (fixture.isEmpty) {
          await expect(
            page.getByText('Import the workbook or add accounts to plan FIRE'),
          ).toBeVisible();
        } else {
          for (const title of ['Your path', 'What if', 'How it’s worked out', 'Year by year']) {
            await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
          }
          await expect(page.getByRole('group', { name: 'Years to FIRE' })).toBeVisible();
        }
        await expectNoHorizontalScroll(page);
        await expectNoClippedSegments(page);
        await shot(page, testInfo, 'fire', `state-${name}-${width}`);
      }
      expect(errors).toEqual([]);
    });
  }

  test('fire: the what-if in use, both chart views and the months used', async ({
    page,
  }, testInfo) => {
    const errors = trackConsoleErrors(page);
    // The saved plan without a query; the what-if fixture for any query.
    await mockFirePage(page, (query) =>
      [...query.keys()].length === 0 ? firePages.onTrack : firePages.whatIf,
    );
    await page.goto(FIRE_PATH);
    const spend = page.getByRole('textbox', { name: 'Yearly spend' });
    await spend.fill('50000');
    await spend.press('Enter');
    await expect(page.getByText('What-if (not saved)', { exact: true })).toBeVisible();
    await expect(page.getByText('Saves: yearly spend $50,000')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'fire', 'whatif-in-use');

    const card = page.getByRole('region', { name: 'Your path by year' });
    await card.getByRole('button', { name: 'Needed vs projected' }).click();
    await expect(card.locator('svg').first()).toBeVisible();
    await shot(page, testInfo, 'fire', 'chart-needed');
    await card.getByRole('button', { name: 'Table' }).click();
    await expect(card.getByRole('table')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'fire', 'chart-needed-table');

    await page.locator('summary', { hasText: 'The months used' }).click();
    await expect(page.getByRole('table', { name: 'The months used' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, testInfo, 'fire', 'months-used');
    expect(errors).toEqual([]);
  });

  test('fire: the result strip stays in view at the last slider (desktop)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'the phone case is below (STYLE-2)');
    await mockFirePage(page, firePages.onTrack);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(FIRE_PATH);
      await expectStripInViewAtLastSlider(page);
      await shot(page, testInfo, 'fire', `strip-lastslider-${size.width}`);
    }
  });

  test('fire: the result strip clears the two-row phone header (phone)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the desktop case is above (STYLE-1)');
    await mockFirePage(page, firePages.onTrack);
    await page.goto(FIRE_PATH);
    await expectStripInViewAtLastSlider(page);
    await shot(page, testInfo, 'fire', 'strip-lastslider-375');
  });

  test('fire: the sliders are a flat track with a teal disc (desktop)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'checked once; the phone shot is below');
    await mockFirePage(page, firePages.onTrack);
    await page.goto(FIRE_PATH);
    const slider = page.locator('.jf-app-fire-slider').first();
    expect(await slider.evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
    await slider.scrollIntoViewIfNeeded();
    await slider.screenshot({
      path: `artifacts/stage6/fixer/slider-${testInfo.project.name}-1440.png`,
    });
  });

  test('fire: the slider close-up (phone)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the desktop close-up is above');
    await mockFirePage(page, firePages.onTrack);
    await page.goto(FIRE_PATH);
    const slider = page.locator('.jf-app-fire-slider').first();
    expect(await slider.evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
    await slider.scrollIntoViewIfNeeded();
    await slider.screenshot({ path: 'artifacts/stage6/fixer/slider-phone-375.png' });
  });

  test('fire: a loading what-if dims the chart once, like the rest of the column', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === FIRE_API,
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const query = new URL(route.request().url()).searchParams;
        const whatIf = [...query.keys()].length > 0;
        if (whatIf) await held;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(whatIf ? firePages.whatIf : firePages.onTrack),
        });
      },
    );
    await page.goto(FIRE_PATH);
    await expect(page.locator('.jf-app-fire-chart .jf-chart__host').first()).toBeVisible();
    const spend = page.getByRole('textbox', { name: 'Yearly spend' });
    await spend.fill('50000');
    await spend.press('Enter');
    await expect(page.locator('.jf-app-fire-strip')).toHaveText(/Updating…/);
    const chart = page.locator('.jf-app-fire-chart .jf-chart').first();
    await expect(chart).toHaveClass(/jf-chart--refreshing/);
    // The product of the opacities from the plot up to body (polled: the dim is a transition).
    const host = page.locator('.jf-app-fire-chart .jf-chart__host').first();
    const plotOpacity = () =>
      host.evaluate((el) => {
        let product = 1;
        for (
          let n: Element | null = el;
          n && n !== document.body.parentElement;
          n = n.parentElement
        ) {
          product *= Number(getComputedStyle(n).opacity);
        }
        return product;
      });
    await expect.poll(plotOpacity).toBeCloseTo(0.6, 1);
    // Settled: a second dim (the chart's own) would keep falling past the transition.
    await page.waitForTimeout(500);
    const settled = await plotOpacity();
    expect(settled).toBeGreaterThanOrEqual(0.55);
    expect(settled).toBeLessThanOrEqual(0.65);
    await expect(page.locator('.jf-app-fire-strip')).toHaveText(/Updating…/);
    release();
    await expect(page.getByText('What-if (not saved)', { exact: true })).toBeVisible();
  });
});
