// Test-only helper (web-polish-ui, stage-6.md §6.9): loads the package's real stylesheets into
// jsdom so a test can read computed styles. jsdom parses `@layer`, `@media` and `@container` blocks
// but never applies the rules inside them, and it has no layout. So this flattens the files into
// one plain sheet, in file order (which follows the `@layer base, core, brand, charts` order), and
// keeps a media or container block only when the simulated environment satisfies its condition.
// A container query is simulated for every container at once: the real per-container behaviour
// and every geometric check live in the e2e (e2e/polish.spec.ts). Never imported by the barrel.

// Vitest blanks CSS modules (even `?raw`) unless `test.css` includes them, so the files are read
// from disk. The specifier is a variable so TypeScript (no Node types here) leaves it untyped.
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string;
};

const { dirname } = import.meta as ImportMeta & { dirname: string };
/** `packages/ui/src`. */
export const UI_SRC = `${dirname}/../..`;

/** The ui stylesheets in `styles.css` order (the imports of each entry file, in order). */
export const UI_STYLESHEETS = {
  tokens: 'core/tokens.css',
  base: 'core/base.css',
  layout: 'core/layout/layout.css',
  shell: 'core/layout/shell.css',
  content: 'core/content/content.css',
  meter: 'core/content/meter.css',
  table: 'core/table/table.css',
  forms: 'core/forms/forms.css',
  milestone: 'brand/milestone.css',
  brand: 'brand/brand.css',
  charts: 'charts/charts.css',
} as const;

export type UiStylesheet = keyof typeof UI_STYLESHEETS;

/** Every stylesheet, in cascade order. */
export const ALL_UI_STYLESHEETS = Object.keys(UI_STYLESHEETS) as UiStylesheet[];

export interface CssEnvironment {
  /** Simulated width (px) of every size container; `@container` blocks apply only when set. */
  containerWidth?: number;
  /** Simulated viewport width (px) for `@media (min/max-width)`; unset → those blocks are skipped. */
  viewportWidth?: number;
  /** `@media (prefers-reduced-motion: reduce)` applies. Default false. */
  reducedMotion?: boolean;
}

/** The raw text of one stylesheet. */
export function readUiCss(sheet: UiStylesheet): string {
  return readFileSync(`${UI_SRC}/${UI_STYLESHEETS[sheet]}`, 'utf8');
}

/** The text before a grouping rule's `{`: "@media (max-width: 767.98px)". */
function preludeOf(rule: CSSRule): string {
  const text = rule.cssText;
  const brace = text.indexOf('{');
  return (brace < 0 ? text : text.slice(0, brace)).trim();
}

/** Whether a width condition list ("(max-width: 479.98px) and (min-width: 1px)") holds. */
function widthsHold(prelude: string, width: number | undefined): boolean | null {
  const conditions = [...prelude.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)];
  if (conditions.length === 0) return null;
  if (width === undefined) return false;
  return conditions.every(([, kind, px]) =>
    kind === 'max' ? width <= Number(px) : width >= Number(px),
  );
}

function applies(rule: CSSRule, env: CssEnvironment): boolean {
  const prelude = preludeOf(rule);
  if (prelude.startsWith('@container')) {
    return widthsHold(prelude, env.containerWidth) ?? false;
  }
  if (prelude.startsWith('@media')) {
    if (/prefers-reduced-motion:\s*reduce/.test(prelude) && !env.reducedMotion) return false;
    if (/prefers-reduced-motion:\s*no-preference/.test(prelude) && env.reducedMotion) return false;
    if (/hover|pointer|print|forced-colors|prefers-contrast/.test(prelude)) return false;
    return widthsHold(prelude, env.viewportWidth) ?? true;
  }
  return false;
}

function isGrouping(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule;
}

/** The plain style rules that apply in `env`, in source order. */
function flatten(rules: CSSRuleList, env: CssEnvironment, out: string[]): void {
  for (const rule of Array.from(rules)) {
    const prelude = preludeOf(rule);
    if (prelude.startsWith('@layer') && isGrouping(rule)) {
      flatten(rule.cssRules, env, out);
    } else if (prelude.startsWith('@media') || prelude.startsWith('@container')) {
      if (isGrouping(rule) && applies(rule, env)) flatten(rule.cssRules, env, out);
    } else if (!prelude.startsWith('@')) {
      out.push(rule.cssText);
    }
    // @import, @keyframes, @font-face, @layer statements: nothing to apply.
  }
}

/**
 * Installs the given stylesheets (flattened for `env`) into the document head and returns a
 * function that removes them. Call it in the test, and the returned function in `afterEach`.
 */
export function installUiCss(
  sheets: readonly UiStylesheet[] = ALL_UI_STYLESHEETS,
  env: CssEnvironment = {},
): () => void {
  const parse = document.createElement('style');
  parse.textContent = sheets.map(readUiCss).join('\n');
  document.head.appendChild(parse);
  const flat: string[] = [];
  if (parse.sheet) flatten(parse.sheet.cssRules, env, flat);
  parse.remove();

  const style = document.createElement('style');
  style.dataset['uiCss'] = sheets.join(' ');
  style.textContent = flat.join('\n');
  document.head.appendChild(style);
  return () => style.remove();
}

/** Every `@keyframes` name the given stylesheets define. */
export function keyframeNames(sheets: readonly UiStylesheet[] = ALL_UI_STYLESHEETS): string[] {
  return sheets.flatMap((sheet) =>
    [...readUiCss(sheet).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1] ?? ''),
  );
}
