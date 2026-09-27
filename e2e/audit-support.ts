// Cross-page audit helpers for e2e/polish.spec.ts (stage-6.md §6.9 D and F, §7.7 step 3). Drafted
// by tooling; the Integrator owns and finishes them in phase B. Read-only: nothing here writes.
//
// The route list is the app's page registry (`PAGES`) plus one of each detail route, with the ids
// found through the API on the synthetic import, and the style guide.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PAGES, STYLEGUIDE_PAGE } from '../apps/web/src/pages';
import type { InvestmentPageResponse } from '../packages/schema/src/dto/investments';
import { latestCommittedRun } from './records-support';

/** One audited route: a fixed path, or one resolved through the API at run time. */
export interface AuditRoute {
  /** Stable name for test titles and screenshots (`polish-<name>.png`). */
  name: string;
  /** The fixed path, or null when `resolve` finds it. */
  path: string | null;
  /** Finds the path of a detail route (an id from the API); null when there is none to visit. */
  resolve?: (request: APIRequestContext) => Promise<string | null>;
}

async function firstHoldingPath(request: APIRequestContext): Promise<string | null> {
  for (const [kind, path] of [
    ['stock', '/stocks'],
    ['etf', '/etfs'],
    ['managed_fund', '/managed-funds'],
    ['crypto', '/crypto'],
  ] as const) {
    const response = await request.get(`/api/investments/${kind}`);
    expect(response.status(), `GET /api/investments/${kind}`).toBe(200);
    const body = (await response.json()) as InvestmentPageResponse;
    const holding = body.holdings[0];
    if (holding) return `${path}/${holding.instrumentId}`;
  }
  return null;
}

async function latestRunPath(request: APIRequestContext): Promise<string | null> {
  const run = await latestCommittedRun(request);
  return run ? `/import/runs/${run.id}` : null;
}

/** Every route of §6.9 D: the 18 pages, a holding detail, an import run, a records entity, the style guide. */
export const AUDIT_ROUTES: readonly AuditRoute[] = [
  ...PAGES.map((page) => ({ name: page.id, path: page.path })),
  { name: 'holding-detail', path: null, resolve: firstHoldingPath },
  { name: 'import-run', path: null, resolve: latestRunPath },
  { name: 'records-entity', path: '/records/trades' },
  { name: STYLEGUIDE_PAGE.id, path: STYLEGUIDE_PAGE.path },
];

/** The path to visit for `route` (a detail route's id comes from the API). */
export async function auditPath(
  request: APIRequestContext,
  route: AuditRoute,
): Promise<string | null> {
  return route.path ?? (await route.resolve?.(request)) ?? null;
}

// ─── Waiting for a page ─────────────────────────────────────────────────────────────────────────

/**
 * Opens `path` and waits until its first load is over: an h1, no loading status in `main` (the
 * `PageSkeleton`'s and the loading line's `role="status"` "Loading …"; the style guide's sample
 * skeletons carry no status), and the network quiet (the page's queries answered).
 */
export async function openLoaded(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('main [role="status"]')].some(
        (el) => !el.closest('[data-gallery-item]') && /^\s*Loading\b/.test(el.textContent ?? ''),
      ),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** Switches every ChartCard on the page to its table view, so the chart tables are audited too. */
export async function showChartTables(page: Page): Promise<number> {
  const toggles = page.locator('.jf-chart-card__toggle').getByRole('button', { name: 'Table' });
  const count = await toggles.count();
  for (let i = 0; i < count; i++) {
    const toggle = toggles.nth(i);
    if (!(await toggle.isVisible())) continue;
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  return count;
}

// ─── Width checks (§6.9 D) ──────────────────────────────────────────────────────────────────────

/** Findings are strings naming the element, so a failure lists every offender at once. */
export type Findings = string[];

/** No horizontal page scroll: `scrollWidth ≤ clientWidth` on the document. */
export async function pageScrollFindings(page: Page): Promise<Findings> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth
      ? [`page scrolls sideways: scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`]
      : [];
  });
}

/**
 * STYLE-6: a KeyValueTable label never splits a word: its text fits (`scrollWidth ≤ clientWidth`)
 * and its computed `word-break` is `normal`.
 */
export async function kvLabelFindings(page: Page): Promise<Findings> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const label of document.querySelectorAll<HTMLElement>('main .jf-kv__label')) {
      if (!label.checkVisibility()) continue;
      const style = getComputedStyle(label);
      const text = (label.textContent ?? '').trim().slice(0, 40);
      if (style.wordBreak !== 'normal')
        out.push(`KV label "${text}": word-break ${style.wordBreak}`);
      if (label.scrollWidth > label.clientWidth + 1) {
        out.push(`KV label "${text}": scrollWidth ${label.scrollWidth} > ${label.clientWidth}`);
      }
    }
    return out;
  });
}

/**
 * At 375 px: every visible form's submit buttons are at least 0.9 × the form's width, and its
 * fields share one left edge (one per row, stacked); the stat tiles of each grid share one left
 * edge too.
 */
export async function phoneLayoutFindings(page: Page): Promise<Findings> {
  return page.evaluate(() => {
    const out: string[] = [];
    const describe = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''
      } "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const visible = (el: Element): boolean =>
      el instanceof HTMLElement && el.checkVisibility() && el.getBoundingClientRect().width > 0;

    for (const form of document.querySelectorAll('main form')) {
      if (!visible(form)) continue;
      const formWidth = form.getBoundingClientRect().width;
      const submits = [...form.querySelectorAll('button')].filter(
        (b) => (b.getAttribute('type') ?? 'submit') === 'submit' && visible(b),
      );
      for (const button of submits) {
        const width = button.getBoundingClientRect().width;
        if (width < 0.9 * formWidth) {
          out.push(
            `submit ${describe(button)}: ${Math.round(width)} px < 0.9 × form ${Math.round(formWidth)} px`,
          );
        }
      }
      const lefts = [...form.querySelectorAll('.jf-field')]
        .filter((f) => visible(f) && f.parentElement?.closest('.jf-field') === null)
        .map((f) => Math.round(f.getBoundingClientRect().left));
      if (new Set(lefts).size > 1) {
        out.push(`form ${describe(form)}: fields start at ${[...new Set(lefts)].join(', ')} px`);
      }
    }

    const tilesByParent = new Map<Element, number[]>();
    for (const tile of document.querySelectorAll('main .jf-stat-tile')) {
      const group = tile.closest('.jf-grid') ?? tile.parentElement;
      if (!visible(tile) || !group) continue;
      tilesByParent.set(group, [
        ...(tilesByParent.get(group) ?? []),
        Math.round(tile.getBoundingClientRect().left),
      ]);
    }
    for (const [group, lefts] of tilesByParent) {
      if (new Set(lefts).size > 1) {
        out.push(`tiles in ${describe(group)}: start at ${[...new Set(lefts)].join(', ')} px`);
      }
    }
    return out;
  });
}

/**
 * STYLE-11: for every table that scrolls sideways inside its container, after scrolling it 40 px:
 * the first header cell is sticky; `elementFromPoint` just inside it returns that cell; its
 * computed background is opaque (alpha 1); and just below the header row in the first column the
 * point hits a body cell (header cells stack above the body's sticky cells).
 */
export async function stickyTableFindings(page: Page): Promise<Findings> {
  const tables = page.locator('main table');
  const count = await tables.count();
  const out: Findings = [];
  for (let i = 0; i < count; i++) {
    const table = tables.nth(i);
    if (!(await table.isVisible())) continue;
    const finding = await table.evaluate((t: HTMLTableElement) => {
      // The nearest container that scrolls sideways (inside main); none → nothing to check.
      let scroller: HTMLElement | null = t.parentElement;
      while (scroller && scroller.tagName !== 'MAIN') {
        const overflowX = getComputedStyle(scroller).overflowX;
        const canScroll = overflowX === 'auto' || overflowX === 'scroll';
        if (canScroll && scroller.scrollWidth > scroller.clientWidth) break;
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller.tagName === 'MAIN') return null;
      const name =
        t.querySelector('caption')?.textContent?.trim().slice(0, 50) ??
        t.getAttribute('aria-label') ??
        'a table';
      const headRow = t.tHead?.rows[0];
      const headCell = headRow?.cells[0];
      if (!headRow || !headCell || !t.tBodies[0]?.rows[0]) return null; // no header or no body
      if (getComputedStyle(headCell).position !== 'sticky') {
        return `${name}: scrolls sideways but its first header cell is not sticky`;
      }
      // The header row mid-viewport (clear of the app's fixed header), then scroll 40 px.
      headRow.scrollIntoView({ block: 'center', inline: 'nearest' });
      scroller.scrollLeft = 40;
      const cellBox = headCell.getBoundingClientRect();
      const x = cellBox.left + 2;
      const hit = document.elementFromPoint(x, cellBox.top + cellBox.height / 2);
      if (!hit || !headCell.contains(hit)) {
        return `${name}: the point inside the sticky header cell hits ${hit?.tagName ?? 'nothing'}`;
      }
      // Opaque: not transparent, and no alpha below 1 (rgba(…, a) or the modern "/ a" syntax).
      const bg = getComputedStyle(headCell).backgroundColor;
      const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(bg);
      const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(bg);
      const alpha = slash
        ? Number(slash[1]) / (slash[2] === '%' ? 100 : 1)
        : rgba
          ? Number(rgba[1])
          : 1;
      if (bg === 'transparent' || alpha < 1) {
        return `${name}: the sticky header cell's background is not opaque (${bg})`;
      }
      const below = document.elementFromPoint(x, headRow.getBoundingClientRect().bottom + 2);
      const cell = below?.closest('td, th');
      if (!cell || !t.contains(cell) || cell.closest('thead') !== null) {
        return `${name}: just below the header row the point hits ${below?.tagName ?? 'nothing'}, not a body cell`;
      }
      return null;
    });
    if (finding) out.push(finding);
  }
  return out;
}

// ─── Keyboard (§6.9 F) ──────────────────────────────────────────────────────────────────────────

/** The focusable elements in `main` a Tab walk should reach (visible, not `tabindex=-1`). */
export async function tabbableInMain(page: Page): Promise<number> {
  return page.evaluate(() => {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'summary',
      '[tabindex]',
    ].join(',');
    const seenRadioGroups = new Set<string>();
    return [...document.querySelectorAll<HTMLElement>(`main ${selector}`)].filter((el) => {
      if (el.tabIndex < 0 || !el.checkVisibility({ visibilityProperty: true })) return false;
      if (el.closest('[inert]')) return false;
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        if (seenRadioGroups.has(el.name)) return false;
        seenRadioGroups.add(el.name);
      }
      return true;
    }).length;
  });
}

export interface FocusStep {
  /** A short description of the focused element. */
  what: string;
  inMain: boolean;
  /** A visible focus indicator: an outline (style not `none`, width > 0) or a box-shadow ring. */
  ringed: boolean;
  /** False when focus fell back to `body` (left the page's controls) or out of the document. */
  inDocument: boolean;
  /** A stable key for the element, to count distinct stops. */
  key: string;
}

/** Describes the focused element and whether it shows a focus ring. */
export async function focusStep(page: Page): Promise<FocusStep> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { what: 'body', inMain: false, ringed: false, inDocument: false, key: 'body' };
    }
    // The ring may sit on the control, on its frame (an input's `.jf-input:focus-within`, up to
    // three levels up) or on the next sibling (a checkbox's or switch's drawn box).
    // Only an outline counts on a frame or sibling (a card's static box-shadow is not a ring).
    const outlined = (node: Element | null): boolean => {
      if (!node) return false;
      const style = getComputedStyle(node);
      return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth || '0') > 0;
    };
    const own = getComputedStyle(el);
    const frames = [el.parentElement, el.parentElement?.parentElement ?? null];
    frames.push(frames[1]?.parentElement ?? null);
    const ring =
      outlined(el) ||
      (own.boxShadow !== 'none' && own.boxShadow !== '') ||
      frames.some((f) => f !== null && f.matches(':focus-within') && outlined(f)) ||
      outlined(el.nextElementSibling);
    if (!el.dataset.auditKey) el.dataset.auditKey = String(Math.random()).slice(2);
    // The accessible name, roughly: aria-label, then aria-labelledby, then a <label>, then text.
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => (id ? (document.getElementById(id)?.textContent ?? '') : ''))
      .join(' ')
      .trim();
    const labels = el instanceof HTMLInputElement ? el.labels : null;
    const name = (
      el.getAttribute('aria-label') ??
      (labelledBy || labels?.[0]?.textContent || el.textContent || '')
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return {
      what: `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''} "${name}"`,
      inMain: el.closest('main') !== null,
      ringed: ring,
      inDocument: true,
      key: el.dataset.auditKey,
    };
  });
}

/**
 * Focus on `body` after a Tab is either the walk passing the document's last control (the
 * browser then moves focus to its own UI; one more Tab wraps to the skip link) or focus lost
 * inside the page. Presses Tab once and says which.
 */
async function walkedOffTheEnd(page: Page): Promise<boolean> {
  await page.keyboard.press('Tab');
  return page.evaluate(() => document.activeElement?.classList.contains('jf-skip-link') ?? false);
}

/** Tab stops cap per page (§6.9 F). */
export const KEYBOARD_WALK_CAP = 60;

/**
 * Enters `main` through the skip link, then tabs forward through `main` (up to the cap) and back
 * with Shift+Tab over the same stops. Returns every step of both passes.
 */
export async function keyboardWalk(
  page: Page,
): Promise<{ forward: FocusStep[]; backward: FocusStep[] }> {
  // Call right after the page loads, before any click: the first Tab then lands on the skip link.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  // Focus lands on main, or on a target inside it (Settings and History focus their h1).
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('main') !== null))
    .toBe(true);

  const forward: FocusStep[] = [];
  for (let i = 0; i < KEYBOARD_WALK_CAP; i++) {
    await page.keyboard.press('Tab');
    const step = await focusStep(page);
    if (step.inDocument && !step.inMain) break; // walked out of main (the nav or the footer)
    if (!step.inDocument && (await walkedOffTheEnd(page))) break; // past the last control
    forward.push(step);
    if (!step.inDocument) break;
  }
  const backward: FocusStep[] = [];
  // From the last stop in main (focused again: the forward walk may have wrapped to the skip
  // link), walk back over the same stops.
  const last = forward.at(-1);
  if (!last?.inDocument) return { forward, backward };
  await page.locator(`[data-audit-key="${last.key}"]`).focus();
  for (let i = 0; i < forward.length - 1; i++) {
    await page.keyboard.press('Shift+Tab');
    const step = await focusStep(page);
    backward.push(step);
    if (!step.inDocument || !step.inMain) break;
  }
  return { forward, backward };
}

/**
 * Names of the FIRE controls the walk must reach (§6.9 F; names confirmed against the page).
 * Save and Reset are disabled (so not tabbable) until a field differs; the spec leaves out a
 * target whose only matching button is disabled.
 */
export const FIRE_KEYBOARD_TARGETS: readonly RegExp[] = [
  /Balances/, // the view switch
  /Needed vs projected/,
  /^button.*"Table"/, // the Chart | Table toggle
  /Yearly spend/,
  /Withdrawal rate/,
  /Inflation rate/,
  /Market return/,
  /Access age/,
  /Extra savings/,
  /Save as my settings/,
  /Reset/,
  /^summary/, // the months used
];
