// stage-6.md §6.9 G: the number-format audit (STYLE_GUIDE §8). Every data page (FIRE
// included) is rendered with every fixture state and its visible text is scanned for the forms the style
// guide rules out. Each hit names the page, the fixture and the text around it.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { PAGE_CASES } from './pageCases';

interface Rule {
  name: string;
  pattern: RegExp;
}

/** The forms STYLE_GUIDE §8 rules out in displayed text. */
export const FORMAT_RULES: readonly Rule[] = [
  { name: 'ASCII hyphen as a minus (use U+2212)', pattern: /(^|[\s(])-\$?\d/g },
  { name: 'ISO date (use dd/mm/yyyy)', pattern: /\b\d{4}-\d{2}-\d{2}\b/g },
  { name: 'NaN', pattern: /\bNaN\b/g },
  { name: 'undefined', pattern: /\bundefined\b/g },
  { name: 'Infinity', pattern: /\bInfinity\b/g },
  { name: '[object …]', pattern: /\[object/g },
  { name: 'money with one decimal', pattern: /\$\d[\d,]*\.\d(?!\d)/g },
  { name: 'percentage with two or more decimals', pattern: /\d\.\d{2,}%/g },
  { name: '$- (a minus after the dollar sign)', pattern: /\$-/g },
  { name: 'financial year with a hyphen (use the en dash)', pattern: /\bFY\d{4}-\d{2}\b/g },
];

/**
 * Where two-decimal percentages are the documented `formatRate` places (§6.9 G): the tax bands and
 * the marginal-rate suggestion (Settings). Text inside an element marked
 * `data-format-audit="rate-dp"` skips the percentage rule only.
 */
const RATE_DP_ALLOWED = '[data-format-audit="rate-dp"]';

/** The visible text runs of a subtree, each with whether the rate rule applies. */
function textRuns(root: HTMLElement): { text: string; rateAllowed: boolean }[] {
  const runs: { text: string; rateAllowed: boolean }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, template')) continue;
    const text = node.textContent ?? '';
    if (text.trim() === '') continue;
    runs.push({ text, rateAllowed: parent.closest(RATE_DP_ALLOWED) !== null });
  }
  return runs;
}

/** Every rule hit in a subtree's text: "rule: …context…". */
export function formatHits(root: HTMLElement): string[] {
  const runs = textRuns(root);
  const hits: string[] = [];
  const scan = (text: string, rules: readonly Rule[]): void => {
    for (const rule of rules) {
      for (const match of text.matchAll(rule.pattern)) {
        const at = match.index ?? 0;
        hits.push(`${rule.name}: "${text.slice(Math.max(0, at - 30), at + 30)}"`);
      }
    }
  };
  // Each run alone, then the runs joined with spaces (a figure split across elements).
  const allRules = FORMAT_RULES;
  const noRate = FORMAT_RULES.filter((r) => !r.name.startsWith('percentage'));
  for (const run of runs) scan(run.text, run.rateAllowed ? noRate : allRules);
  const joined = runs
    .filter((r) => !r.rateAllowed)
    .map((r) => r.text)
    .join(' ');
  const joinedHits: string[] = [];
  const before = hits.length;
  scan(joined, allRules);
  joinedHits.push(...hits.splice(before));
  for (const hit of joinedHits) if (!hits.includes(hit)) hits.push(hit);
  return hits;
}

const CASES = PAGE_CASES.flatMap((page) =>
  Object.entries(page.states).map(([state, routes]) => [page.id, state, page, routes] as const),
);

describe('number-format audit (§6.9 G)', () => {
  it.each(CASES)('%s · %s', async (_id, state, page, routes) => {
    mockApi(Object.fromEntries(Object.entries(routes).map(([route, body]) => [route, { body }])));
    renderApp(page.paths?.[state] ?? page.path);
    const main = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: page.title });
    await waitFor(() => expect(main.querySelector('[data-skeleton-layout]')).toBeNull());
    await waitFor(() => expect(main.querySelectorAll('h2, table').length).toBeGreaterThan(0));
    expect(formatHits(main)).toEqual([]);
  });
});

describe('the audit catches each form', () => {
  it.each([
    ['-$5', 'ASCII hyphen'],
    ['(-12)', 'ASCII hyphen'],
    ['2026-09-24', 'ISO date'],
    ['NaN', 'NaN'],
    ['undefined', 'undefined'],
    ['Infinity', 'Infinity'],
    ['[object Object]', '[object'],
    ['$1,234.5 a year', 'one decimal'],
    ['7.25%', 'two or more decimals'],
    ['$-4', '$-'],
    ['FY2026-27', 'en dash'],
  ])('%s', (text, rule) => {
    const root = document.createElement('div');
    root.textContent = text;
    expect(formatHits(root).join('\n')).toContain(rule);
  });

  it.each(['−$5', '24/09/2026', '$1,234.50', '7.3%', 'FY2026–27', '1-2 of 3', 'v1.2.3'])(
    'passes %s',
    (text) => {
      const root = document.createElement('div');
      root.textContent = text;
      expect(formatHits(root)).toEqual([]);
    },
  );

  it('allows two-decimal rates inside a marked tax place only', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-format-audit="rate-dp">34.50%</p><p>1.25%</p>';
    expect(formatHits(root)).toEqual(['percentage with two or more decimals: "1.25%"']);
  });
});
