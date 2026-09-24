import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, PAGES, STYLEGUIDE_PAGE } from '../pages';
import { NAV, PAGE_ICONS, SECONDARY_NAV, titleForPath } from './nav';

describe('nav', () => {
  it('lists the groups in STYLE_GUIDE §4 order with every page once', () => {
    expect(NAV.map((group) => group.label)).toEqual(NAV_GROUPS.map((group) => group.label));
    const items = NAV.flatMap((group) => group.items);
    expect(items.map((item) => item.href)).toEqual(PAGES.map((page) => page.path));
  });

  it('gives every page, and the style guide, an icon', () => {
    for (const item of [...NAV.flatMap((group) => group.items), ...SECONDARY_NAV]) {
      expect(item.icon, item.id).toBeDefined();
    }
    expect(Object.keys(PAGE_ICONS).sort()).toEqual(
      [...PAGES.map((page) => page.id), STYLEGUIDE_PAGE.id].sort(),
    );
  });

  it('puts the style guide in the secondary nav', () => {
    expect(SECONDARY_NAV).toEqual([
      expect.objectContaining({ href: '/styleguide', label: 'Style guide' }),
    ]);
  });
});

describe('titleForPath', () => {
  it('names shell pages and the style guide, tolerating a trailing slash', () => {
    expect(titleForPath('/')).toBe('Net Worth');
    expect(titleForPath('/stocks')).toBe('Stocks');
    expect(titleForPath('/stocks/')).toBe('Stocks');
    expect(titleForPath('/styleguide')).toBe('Style guide');
    expect(titleForPath('/styleguide/')).toBe('Style guide');
    expect(titleForPath('/nope')).toBe('');
  });
});
