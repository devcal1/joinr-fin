import { describe, expect, it } from 'vitest';
import {
  NAV_GROUPS,
  PAGES,
  SCREEN_VARIANTS,
  STAGE_TITLES,
  STYLEGUIDE_PAGE,
  isScreenVariant,
  pageForPath,
} from './pages';

describe('page registry', () => {
  it('has the 15 in-scope pages', () => {
    expect(PAGES).toHaveLength(15);
  });

  it('has unique ids and paths', () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
    expect(PAGES.map((p) => p.path)).not.toContain(STYLEGUIDE_PAGE.path);
  });

  it('lists nav groups in STYLE_GUIDE §4 order', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Overview',
      'Investments',
      'Cash flow',
      'Assets',
      'Planning',
      'Settings',
    ]);
  });

  it('keeps pages grouped and in nav-group order', () => {
    const groupOrder = NAV_GROUPS.map((g) => g.id);
    const indices = PAGES.map((p) => groupOrder.indexOf(p.group));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    for (const group of NAV_GROUPS) {
      expect(PAGES.some((p) => p.group === group.id)).toBe(true);
    }
  });

  it('gives every page a known stage', () => {
    for (const page of PAGES) {
      expect(STAGE_TITLES[page.stage], page.id).toBeTruthy();
    }
  });

  it('finds pages by path', () => {
    expect(pageForPath('/')?.id).toBe('net-worth');
    expect(pageForPath('/stocks')?.title).toBe('Stocks');
    expect(pageForPath('/stocks/')?.title).toBe('Stocks');
    expect(pageForPath('/styleguide')).toBeUndefined();
    expect(pageForPath('/nope')).toBeUndefined();
  });

  it('recognises brand screen variants', () => {
    for (const variant of SCREEN_VARIANTS) expect(isScreenVariant(variant)).toBe(true);
    expect(isScreenVariant('nope')).toBe(false);
    expect(isScreenVariant(undefined)).toBe(false);
  });
});
