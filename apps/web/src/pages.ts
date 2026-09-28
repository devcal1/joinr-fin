// The app's page registry (Scaffolder): one entry per in-scope page, in nav order.
// Dependency-free so the router, the nav and the e2e specs can all share it.

export type NavGroupId =
  'overview' | 'investments' | 'cashflow' | 'assets' | 'planning' | 'records' | 'settings';

export interface PageDef {
  id: string;
  path: string;
  title: string;
  group: NavGroupId;
}

export const NAV_GROUPS: readonly { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'investments', label: 'Investments' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'assets', label: 'Assets' },
  { id: 'planning', label: 'Planning' },
  { id: 'records', label: 'Records' },
  { id: 'settings', label: 'Settings' },
];

export const PAGES: readonly PageDef[] = [
  { id: 'net-worth', path: '/', title: 'Net Worth', group: 'overview' },
  { id: 'history', path: '/history', title: 'History', group: 'overview' },
  { id: 'stocks', path: '/stocks', title: 'Stocks', group: 'investments' },
  { id: 'etfs', path: '/etfs', title: 'ETFs', group: 'investments' },
  {
    id: 'managed-funds',
    path: '/managed-funds',
    title: 'Managed Funds',
    group: 'investments',
  },
  { id: 'crypto', path: '/crypto', title: 'Crypto', group: 'investments' },
  { id: 'cash', path: '/cash', title: 'Cash', group: 'cashflow' },
  { id: 'side-income', path: '/side-income', title: 'Side Income', group: 'cashflow' },
  { id: 'dividends', path: '/dividends', title: 'Dividends', group: 'cashflow' },
  { id: 'budget', path: '/budget', title: 'Budget', group: 'cashflow' },
  { id: 'other-assets', path: '/other-assets', title: 'Other Assets', group: 'assets' },
  { id: 'super', path: '/super', title: 'Super', group: 'assets' },
  { id: 'property', path: '/property', title: 'Property', group: 'assets' },
  { id: 'fire', path: '/fire', title: 'FIRE', group: 'planning' },
  { id: 'records', path: '/records', title: 'Records', group: 'records' },
  { id: 'import', path: '/import', title: 'Import', group: 'records' },
  { id: 'prices', path: '/prices', title: 'Prices', group: 'records' },
  { id: 'settings', path: '/settings', title: 'Settings', group: 'settings' },
];

export const STYLEGUIDE_PAGE: { id: 'styleguide'; path: '/styleguide'; title: 'Style guide' } = {
  id: 'styleguide',
  path: '/styleguide',
  title: 'Style guide',
};

/** Brand screen variants previewable at `/preview/screen/$variant` (same union as BrandScreenVariant). */
export const SCREEN_VARIANTS = ['loading', 'empty', 'error', 'login'] as const;
export type ScreenVariant = (typeof SCREEN_VARIANTS)[number];

export function isScreenVariant(value: unknown): value is ScreenVariant {
  return typeof value === 'string' && (SCREEN_VARIANTS as readonly string[]).includes(value);
}

/**
 * The page for a pathname (trailing slash tolerated), or undefined (e.g. `/styleguide`, 404s).
 * Sub-routes belong to their page: `/records/trades` → Records, `/import/runs/7` → Import.
 */
export function pageForPath(pathname: string): PageDef | undefined {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  return (
    PAGES.find((page) => page.path === normalised) ??
    PAGES.find((page) => page.path !== '/' && normalised.startsWith(`${page.path}/`))
  );
}
