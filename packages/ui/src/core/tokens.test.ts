import { describe, expect, it } from 'vitest';
import styleGuide from '../../../../docs/style/STYLE_GUIDE.md?raw';
import {
  BREAKPOINTS,
  COLORS,
  FONT_MONO,
  FONT_SANS,
  FONT_SIZES,
  MEDIA,
  RADII,
  SPACE,
  SPECTRUM_GRADIENT,
  colorVarName,
  cssVar,
  type ColorToken,
} from './tokens';

// Vitest blanks CSS modules (even `?raw`) unless its `test.css` option includes them, so the
// test reads tokens.css from disk. The specifier is a variable so TypeScript (this package has
// no Node types) leaves the import untyped.
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { dirname } = import.meta as ImportMeta & { dirname: string };
const tokensCss = readFileSync(`${dirname}/tokens.css`, 'utf8');

/** `--name: value;` pairs declared in tokens.css. */
function declaredVars(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return vars;
}

const vars = declaredVars(tokensCss);
const same = (a: string | undefined, b: string): boolean =>
  (a ?? '').toLowerCase().replace(/"/g, "'") === b.toLowerCase().replace(/"/g, "'");

describe('tokens.css ↔ tokens.ts parity', () => {
  it('maps every colour token to its CSS custom property (case-insensitive)', () => {
    for (const [token, hex] of Object.entries(COLORS)) {
      const name = colorVarName(token as ColorToken);
      expect(vars.has(name), `${name} is declared`).toBe(true);
      expect(same(vars.get(name), hex), `${name} = ${hex}`).toBe(true);
    }
  });

  it('declares no hex colour that COLORS does not know', () => {
    const known = new Set(Object.values(COLORS).map((hex) => hex.toLowerCase()));
    for (const [name, value] of vars) {
      if (/^#[0-9a-f]{3,8}$/i.test(value)) {
        expect(known.has(value.toLowerCase()), `${name} ${value} is a §1 colour`).toBe(true);
      }
    }
  });

  it('matches the spectrum gradient and the font stacks', () => {
    expect(same(vars.get('--spectrum'), SPECTRUM_GRADIENT)).toBe(true);
    expect(same(vars.get('--font-sans'), FONT_SANS)).toBe(true);
    expect(same(vars.get('--font-mono'), FONT_MONO)).toBe(true);
  });

  it('matches the type scale, spacing scale and radii', () => {
    for (const [key, px] of Object.entries(FONT_SIZES)) {
      expect(vars.get(`--fs-${key}`), `--fs-${key}`).toBe(`${px}px`);
    }
    for (const [key, px] of Object.entries(SPACE)) {
      expect(vars.get(`--space-${key}`), `--space-${key}`).toBe(`${px}px`);
    }
    for (const [key, px] of Object.entries(RADII)) {
      expect(vars.get(`--radius-${key}`), `--radius-${key}`).toBe(`${px}px`);
    }
  });
});

describe('tokens ↔ STYLE_GUIDE §1', () => {
  it('uses the hex value the style guide gives each token', () => {
    const rows = [...styleGuide.matchAll(/^\| `(--[a-z-]+)` \| `(#[0-9A-Fa-f]{6})` \|/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const [, name = '', hex = ''] of rows) {
      expect(same(vars.get(name), hex), `${name} = ${hex}`).toBe(true);
    }
  });

  it('includes the five light tints and the exact spectrum rule', () => {
    const tints = [
      COLORS.tealTint,
      COLORS.violetTint,
      COLORS.orangeTint,
      COLORS.goTint,
      COLORS.stopTint,
    ];
    for (const hex of tints) {
      expect(styleGuide).toContain(hex);
    }
    expect(styleGuide).toContain(SPECTRUM_GRADIENT);
  });
});

describe('helpers', () => {
  it('names CSS variables in kebab case', () => {
    expect(colorVarName('ink')).toBe('--ink');
    expect(colorVarName('textBright')).toBe('--text-bright');
    expect(colorVarName('pillNa')).toBe('--pill-na');
    expect(cssVar('tealTint')).toBe('var(--teal-tint)');
  });

  it('keeps breakpoints and media queries consistent', () => {
    expect(BREAKPOINTS).toEqual({ tablet: 768, sidebar: 1024, desktop: 1200 });
    expect(MEDIA.phone).toBe(`(max-width: ${BREAKPOINTS.tablet - 0.02}px)`);
    expect(MEDIA.drawer).toBe(`(max-width: ${BREAKPOINTS.sidebar - 0.02}px)`);
    expect(MEDIA.desktop).toBe(`(min-width: ${BREAKPOINTS.desktop}px)`);
  });
});
