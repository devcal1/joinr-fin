// The sidebar nav, built from the page registry, with one lucide icon per page (STYLE_GUIDE §9).
// Stage 5 (stage-5.md §3.3, §6.6): the `features.*` settings hide their pages from the nav (a
// missing value counts as on); Dividends hides only when ETFs, Stocks and Managed Funds are all off.
import type { AppStatus, FeatureKey } from '@joinr/schema';
import type { NavGroup, NavItem } from '@joinr/ui';
import {
  BadgeDollarSign,
  Bitcoin,
  Briefcase,
  ChartCandlestick,
  Coins,
  FileSpreadsheet,
  Flame,
  Gem,
  HandCoins,
  History,
  House,
  Layers,
  LayoutDashboard,
  Palette,
  PiggyBank,
  Settings,
  Table2,
  Umbrella,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { NAV_GROUPS, PAGES, STYLEGUIDE_PAGE, pageForPath } from '../pages';

export const PAGE_ICONS: Readonly<Record<string, LucideIcon>> = {
  'net-worth': LayoutDashboard,
  history: History,
  stocks: ChartCandlestick,
  etfs: Layers,
  'managed-funds': Briefcase,
  crypto: Bitcoin,
  cash: Wallet,
  'side-income': HandCoins,
  dividends: Coins,
  budget: PiggyBank,
  'other-assets': Gem,
  super: Umbrella,
  property: House,
  fire: Flame,
  records: Table2,
  import: FileSpreadsheet,
  prices: BadgeDollarSign,
  settings: Settings,
  styleguide: Palette,
};

export const NAV: NavGroup[] = NAV_GROUPS.map((group) => ({
  id: group.id,
  label: group.label,
  items: PAGES.filter((page) => page.group === group.id).map((page) => ({
    id: page.id,
    label: page.title,
    href: page.path,
    icon: PAGE_ICONS[page.id],
  })),
}));

/** The feature switch of each page it hides (the sheet's First Time Setup toggles). */
export const PAGE_FEATURES: Readonly<Record<string, FeatureKey>> = {
  cash: 'features.cash',
  etfs: 'features.etfs',
  stocks: 'features.stocks',
  'managed-funds': 'features.managedFunds',
  crypto: 'features.crypto',
  budget: 'features.budget',
  'side-income': 'features.sideIncome',
  'other-assets': 'features.otherAssets',
  property: 'features.property',
  super: 'features.retirement',
  fire: 'features.fire',
};

/** Dividends shows while any of these is on (the sheet's rule). */
export const DIVIDEND_FEATURES: readonly FeatureKey[] = [
  'features.etfs',
  'features.stocks',
  'features.managedFunds',
];

export type Features = AppStatus['features'];

/** A feature is on unless the status says `false` (a missing value counts as on). */
export function featureOn(features: Features, key: FeatureKey): boolean {
  return features?.[key] !== false;
}

/** True when the page is switched off in Settings (Pages). */
export function pageSwitchedOff(pageId: string, features: Features): boolean {
  if (pageId === 'dividends') return DIVIDEND_FEATURES.every((key) => !featureOn(features, key));
  const key = PAGE_FEATURES[pageId];
  return key !== undefined && !featureOn(features, key);
}

/** The nav without the switched-off pages (empty groups dropped). */
export function navFor(features: Features): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !pageSwitchedOff(item.id, features)),
  })).filter((group) => group.items.length > 0);
}

export const SECONDARY_NAV: NavItem[] = [
  {
    id: STYLEGUIDE_PAGE.id,
    label: STYLEGUIDE_PAGE.title,
    href: STYLEGUIDE_PAGE.path,
    icon: PAGE_ICONS[STYLEGUIDE_PAGE.id],
  },
];

/** The running header's page name for a pathname ('' when the path is not a shell page). */
export function titleForPath(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  if (path === STYLEGUIDE_PAGE.path) return STYLEGUIDE_PAGE.title;
  return pageForPath(path)?.title ?? '';
}
