import { describe, expect, it } from 'vitest';
import {
  NAV_GROUPS,
  PAGES,
  SCREEN_VARIANTS,
  STYLEGUIDE_PAGE,
  isScreenVariant,
  pageForPath,
} from './pages';

describe('page registry', () => {
  it('has the 18 in-scope pages', () => {
    expect(PAGES).toHaveLength(18);
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
      'Records',
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

  it('finds pages by path', () => {
    expect(pageForPath('/')?.id).toBe('net-worth');
    expect(pageForPath('/stocks')?.title).toBe('Stocks');
    expect(pageForPath('/stocks/')?.title).toBe('Stocks');
    expect(pageForPath('/styleguide')).toBeUndefined();
    expect(pageForPath('/nope')).toBeUndefined();
  });

  it('has the Stage 1 Records group: Records, Import, Prices', () => {
    expect(PAGES.filter((p) => p.group === 'records')).toEqual([
      { id: 'records', path: '/records', title: 'Records', group: 'records' },
      { id: 'import', path: '/import', title: 'Import', group: 'records' },
      { id: 'prices', path: '/prices', title: 'Prices', group: 'records' },
    ]);
  });

  it('maps sub-routes to their page', () => {
    expect(pageForPath('/records/trades')?.id).toBe('records');
    expect(pageForPath('/import/runs/7')?.id).toBe('import');
    expect(pageForPath('/import/runs/7/')?.id).toBe('import');
    expect(pageForPath('/recordsx')).toBeUndefined();
    expect(pageForPath('/nope/deeper')).toBeUndefined();
  });

  it('recognises brand screen variants', () => {
    for (const variant of SCREEN_VARIANTS) expect(isScreenVariant(variant)).toBe(true);
    expect(isScreenVariant('nope')).toBe(false);
    expect(isScreenVariant(undefined)).toBe(false);
  });
});
