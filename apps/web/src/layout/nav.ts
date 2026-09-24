// The sidebar nav, built from the page registry, with one lucide icon per page (STYLE_GUIDE §9).
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
