// The app's page registry (Scaffolder): one entry per in-scope page, in nav order.
// Dependency-free so the router, the nav and the e2e specs can all share it.

export type NavGroupId =
  'overview' | 'investments' | 'cashflow' | 'assets' | 'planning' | 'settings';

export interface PageDef {
  id: string;
  path: string;
  title: string;
  group: NavGroupId;
  stage: number;
}

export const NAV_GROUPS: readonly { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'investments', label: 'Investments' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'assets', label: 'Assets' },
  { id: 'planning', label: 'Planning' },
  { id: 'settings', label: 'Settings' },
];

export const PAGES: readonly PageDef[] = [
  { id: 'net-worth', path: '/', title: 'Net Worth', group: 'overview', stage: 5 },
  { id: 'history', path: '/history', title: 'History', group: 'overview', stage: 5 },
  { id: 'stocks', path: '/stocks', title: 'Stocks', group: 'investments', stage: 2 },
  { id: 'etfs', path: '/etfs', title: 'ETFs', group: 'investments', stage: 2 },
  {
    id: 'managed-funds',
    path: '/managed-funds',
    title: 'Managed Funds',
    group: 'investments',
    stage: 2,
  },
  { id: 'crypto', path: '/crypto', title: 'Crypto', group: 'investments', stage: 2 },
  { id: 'cash', path: '/cash', title: 'Cash', group: 'cashflow', stage: 3 },
  { id: 'side-income', path: '/side-income', title: 'Side Income', group: 'cashflow', stage: 3 },
  { id: 'dividends', path: '/dividends', title: 'Dividends', group: 'cashflow', stage: 3 },
  { id: 'budget', path: '/budget', title: 'Budget', group: 'cashflow', stage: 3 },
  { id: 'other-assets', path: '/other-assets', title: 'Other Assets', group: 'assets', stage: 4 },
  { id: 'super', path: '/super', title: 'Super', group: 'assets', stage: 4 },
  { id: 'property', path: '/property', title: 'Property', group: 'assets', stage: 4 },
  { id: 'fire', path: '/fire', title: 'FIRE', group: 'planning', stage: 6 },
  { id: 'settings', path: '/settings', title: 'Settings', group: 'settings', stage: 5 },
];

export const STYLEGUIDE_PAGE: { id: 'styleguide'; path: '/styleguide'; title: 'Style guide' } = {
  id: 'styleguide',
  path: '/styleguide',
  title: 'Style guide',
};

/** Stage titles from PLAN.md. */
export const STAGE_TITLES: Record<number, string> = {
  0: 'Foundations & design system',
  1: 'Data model, importer & market data',
  2: 'Investments: Stocks, ETFs, Managed Funds, Crypto',
  3: 'Cash flow & income: Cash, Side Income, Dividends, Budget',
  4: 'Other Assets, Super & Property',
  5: 'History, Net Worth dashboard & Settings',
  6: 'FIRE planner & polish',
  7: 'Umbrel deployment & cutover',
};

/** Brand screen variants previewable at `/preview/screen/$variant` (same union as BrandScreenVariant). */
export const SCREEN_VARIANTS = ['loading', 'empty', 'error', 'login'] as const;
export type ScreenVariant = (typeof SCREEN_VARIANTS)[number];

export function isScreenVariant(value: unknown): value is ScreenVariant {
  return typeof value === 'string' && (SCREEN_VARIANTS as readonly string[]).includes(value);
}

/** The page for a pathname (trailing slash tolerated), or undefined (e.g. `/styleguide`, 404s). */
export function pageForPath(pathname: string): PageDef | undefined {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  return PAGES.find((page) => page.path === normalised);
}
