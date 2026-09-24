// Design tokens for JavaScript consumers (ECharts, inline SVG). Mirrors tokens.css exactly;
// tokens.test.ts asserts parity. Hex values keep the STYLE_GUIDE §1 case (CSS is lower-cased
// by Prettier, so the parity test compares case-insensitively).

export type ColorToken =
  | 'ink'
  | 'surface'
  | 'raised'
  | 'hairline'
  | 'textBright'
  | 'text'
  | 'textSecondary'
  | 'textMuted'
  | 'teal'
  | 'violet'
  | 'fuchsia'
  | 'orange'
  | 'go'
  | 'stop'
  | 'pillNa'
  | 'tealTint'
  | 'violetTint'
  | 'orangeTint'
  | 'goTint'
  | 'stopTint';

/** STYLE_GUIDE §1 colours. CSS custom property = kebab-case of the key (`textBright` → `--text-bright`). */
export const COLORS = {
  ink: '#101019',
  surface: '#191A24',
  raised: '#262735',
  hairline: '#24252F',
  textBright: '#FFFFFF',
  text: '#D3D4DC',
  textSecondary: '#9A9BA8',
  textMuted: '#838494',
  teal: '#17C8A0',
  violet: '#8B5CF6',
  fuchsia: '#D946EF',
  orange: '#F97316',
  go: '#22C55E',
  stop: '#EF4444',
  pillNa: '#2E2F3C',
  tealTint: '#6EE7C9',
  violetTint: '#A855F7',
  orangeTint: '#FB923C',
  goTint: '#4ADE80',
  stopTint: '#F87171',
} as const satisfies Readonly<Record<ColorToken, string>>;

/** The spectrum rule (`--spectrum`). Only for the top/bottom rules, the logo and brand moments. */
export const SPECTRUM_GRADIENT =
  'linear-gradient(90deg, #17C8A0 0%, #8B5CF6 30%, #D946EF 55%, #F97316 100%)';

export const FONT_SANS = 'Arial, Helvetica, sans-serif';
export const FONT_MONO = "ui-monospace, Consolas, 'Courier New', monospace";

/** Breakpoint lower bounds in px: tablet ≥ 768, sidebar (no drawer) ≥ 1024, desktop ≥ 1200. */
export const BREAKPOINTS = { tablet: 768, sidebar: 1024, desktop: 1200 } as const;

/** Media queries matching the literal ones in the CSS (phone ends at 767.98px, drawer at 1023.98px). */
export const MEDIA = {
  phone: '(max-width: 767.98px)',
  drawer: '(max-width: 1023.98px)',
  desktop: '(min-width: 1200px)',
} as const;

/** Type scale in px (STYLE_GUIDE §2, print pt × 1.6). CSS: `--fs-<key>`. */
export const FONT_SIZES = {
  h1: 31,
  subline: 15,
  h2: 16,
  h3: 13.5,
  body: 14.5,
  dense: 13,
  header: 13,
  badge: 12,
  small: 11,
  kpi: 26,
} as const;

/** Spacing scale in px (STYLE_GUIDE §3). CSS: `--space-<key>`. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 9: 36 } as const;

/** Corner radii in px (STYLE_GUIDE §3). CSS: `--radius-card`, `--radius-bar`, `--radius-pill`. */
export const RADII = { card: 6, bar: 5, pill: 999 } as const;

/** `textBright` → `--text-bright`. */
export function colorVarName(token: ColorToken): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** `var(--text-bright)`, for inline styles that must follow the CSS tokens. */
export function cssVar(token: ColorToken): string {
  return `var(${colorVarName(token)})`;
}
