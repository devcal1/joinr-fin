// The cross-page polish audit (stage-6.md §6.9 D and F, §7.7 step 3). Drafted by tooling; the
// Integrator owns and finishes it in phase B. Read-only (desktop + phone): it only opens pages,
// switches chart cards to their table view, scrolls tables and presses Tab.
//
// - Every route (the page registry, a holding detail, an import run, a records entity, the style
//   guide) at the project's width, and at 1024 px on desktop: no horizontal page scroll, no split
//   words in KeyValueTable labels, every sideways-scrolling table keeps an opaque sticky header
//   cell above its body, and at 375 px submit buttons span the form and fields and tiles stack on
//   one left edge; no console errors.
// - Desktop: the keyboard walk through `main` (skip link, Tab and Shift+Tab, capped at 60 stops):
//   a visible focus ring on every stop and focus never lost to the document.
// - Phone: every FIRE fixture (mocked `GET /api/fire`) passes the same width checks.
import { expect, test, type Page } from '@playwright/test';
import { firePages } from '../packages/schema/src/fixtures/fire';
import {
  AUDIT_ROUTES,
  FIRE_KEYBOARD_TARGETS,
  KEYBOARD_WALK_CAP,
  auditPath,
  kvLabelFindings,
  keyboardWalk,
  openLoaded,
  pageScrollFindings,
  phoneLayoutFindings,
  showChartTables,
  stickyTableFindings,
  tabbableInMain,
  type Findings,
} from './audit-support';
import { NOT_READY_REASON, SYNTHETIC_IMPORT_READY, ensureImported } from './records-support';
import { shot, trackConsoleErrors } from './support';

/** The desktop project's second width (§6.9 D). */
const TABLET_WIDTH = { width: 1024, height: 900 };

/** Every width check on the page as it is now, each finding prefixed with `label`. */
async function widthFindings(page: Page, label: string, phone: boolean): Promise<Findings> {
  await showChartTables(page);
  const findings = [
    ...(await pageScrollFindings(page)),
    ...(await kvLabelFindings(page)),
    ...(await stickyTableFindings(page)),
    ...(phone ? await phoneLayoutFindings(page) : []),
  ];
  // Opening every chart table must not make the page scroll sideways either.
  findings.push(...(await pageScrollFindings(page)));
  return [...new Set(findings)].map((f) => `${label}: ${f}`);
}

test.describe('polish: every route at its widths', () => {
  test.beforeEach(() => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
  });

  for (const route of AUDIT_ROUTES) {
    test(`${route.name}: page width, KV labels, sticky tables, phone layout`, async ({
      page,
      request,
    }, testInfo) => {
      test.setTimeout(120_000);
      await ensureImported(request);
      const path = await auditPath(request, route);
      expect(path, `a path for ${route.name} on the synthetic import`).not.toBeNull();
      if (path === null) return;
      const errors = trackConsoleErrors(page);
      const phone = testInfo.project.name === 'phone';
      const findings: Findings = [];

      await openLoaded(page, path);
      const width = page.viewportSize()?.width ?? 0;
      findings.push(...(await widthFindings(page, `${path} at ${width} px`, phone)));
      await shot(page, testInfo, 'polish', route.name);

      if (!phone) {
        await page.setViewportSize(TABLET_WIDTH);
        await openLoaded(page, path);
        findings.push(...(await widthFindings(page, `${path} at ${TABLET_WIDTH.width} px`, false)));
        await shot(page, testInfo, 'polish', `${route.name}-${TABLET_WIDTH.width}`);
      }

      expect(findings).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('polish: keyboard walk through main', () => {
  test.beforeEach(() => {
    test.skip(!SYNTHETIC_IMPORT_READY, NOT_READY_REASON);
    test.skip(test.info().project.name !== 'desktop', 'keyboard walk on desktop');
  });

  for (const route of AUDIT_ROUTES) {
    test(`${route.name}: every stop in main is reachable and shows its focus ring`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await ensureImported(request);
      const path = await auditPath(request, route);
      expect(path, `a path for ${route.name} on the synthetic import`).not.toBeNull();
      if (path === null) return;
      const errors = trackConsoleErrors(page);

      await openLoaded(page, path);
      const expected = await tabbableInMain(page);
      const { forward, backward } = await keyboardWalk(page);

      const lost = [...forward, ...backward].filter((s) => !s.inDocument);
      expect(
        lost.map((s) => s.what),
        'focus left the document',
      ).toEqual([]);
      const unringed = [...forward, ...backward].filter((s) => s.inDocument && !s.ringed);
      expect(
        [...new Set(unringed.map((s) => s.what))],
        'stops without a visible focus ring',
      ).toEqual([]);
      expect(
        backward.filter((s) => !s.inMain).map((s) => s.what),
        'Shift+Tab left main early',
      ).toEqual([]);
      const distinct = new Set(forward.map((s) => s.key)).size;
      expect(
        distinct,
        `Tab stops reached in main (of ${expected} tabbable)`,
      ).toBeGreaterThanOrEqual(Math.min(KEYBOARD_WALK_CAP, expected));

      if (route.name === 'fire') {
        // The synthetic workbook switches FIRE off; the page still renders every control under
        // its switched-off note (Stage 5 §3.3), so the walk runs on the real API.
        const reached = forward.map((s) => s.what);
        const missing: string[] = [];
        for (const re of FIRE_KEYBOARD_TARGETS) {
          if (reached.some((w) => re.test(w))) continue;
          // A disabled button (Save and Reset before any change) is not a tab stop.
          const buttons = page.getByRole('main').getByRole('button', { name: re });
          const count = await buttons.count();
          let allDisabled = count > 0;
          for (let i = 0; i < count; i++) allDisabled &&= await buttons.nth(i).isDisabled();
          if (!allDisabled) missing.push(String(re));
        }
        expect(missing, 'FIRE controls the walk did not reach').toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe('polish: FIRE fixtures at phone width', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'phone', 'the 375 px audit of the FIRE states');
  });

  for (const [name, fixture] of Object.entries(firePages)) {
    test(`fire ${name}: page width, KV labels, sticky tables, phone layout`, async ({
      page,
    }, testInfo) => {
      const errors = trackConsoleErrors(page);
      // Every GET of the FIRE page's query (any what-if string) answers the fixture.
      await page.route(
        (url) => url.pathname === '/api/fire',
        async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fixture),
          });
        },
      );
      await openLoaded(page, '/fire');
      const findings = await widthFindings(page, `/fire (${name}) at 375 px`, true);
      await shot(page, testInfo, 'polish', `fire-${name}`);
      expect(findings).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
