// Code-based TanStack Router route tree (Scaffolder; stage-0.md §1). Stage 6 (stage-6.md §6.1,
// §6.9 H, D104): every page route loads its component lazily (its own chunk) except the root
// layout, NotFoundPage and ErrorPage; routes whose component needs props or route APIs load a small
// route module under ./routes. Each lazy route shows its pending skeleton (./routes/pending) while
// the chunk loads. A missing chunk makes `lazyRouteComponent` reload the page once before an error
// reaches ErrorPage.
import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  type RouterHistory,
} from '@tanstack/react-router';
import { isRecordEntityId } from '@joinr/schema';
import { RootLayout } from './layout/RootLayout';
import { STYLEGUIDE_PAGE, isScreenVariant } from './pages';
import { ErrorPage } from './pages/ErrorPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { POSITIVE_INT_RE } from './routes/params';
import { pendingFor } from './routes/pending';

export interface RouterContext {
  queryClient: QueryClient;
}

/** The router's pending timing (stage-6.md §6.1): no skeleton flash on a fast chunk load. */
export const PENDING_MS = 150;
export const PENDING_MIN_MS = 300;

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

// Pathless layout: every shell page renders inside the AppShell.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: RootLayout,
});

// Stage 1: records, import, prices.
const recordsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/records',
  component: lazyRouteComponent(
    () => import('./pages/records/RecordsIndexPage'),
    'RecordsIndexPage',
  ),
  pendingComponent: pendingFor('/records'),
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import',
  component: lazyRouteComponent(() => import('./pages/import/ImportPage'), 'ImportPage'),
  pendingComponent: pendingFor('/import'),
});

const pricesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/prices',
  component: lazyRouteComponent(() => import('./pages/prices/PricesPage'), 'PricesPage'),
  pendingComponent: pendingFor('/prices'),
});

// Stage 2: the four investment pages (stage-2.md §6.1), one route module component per kind.
const investments = () => import('./routes/investments');

const stocksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stocks',
  component: lazyRouteComponent(investments, 'StocksRoute'),
  pendingComponent: pendingFor('/stocks'),
});

const etfsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/etfs',
  component: lazyRouteComponent(investments, 'EtfsRoute'),
  pendingComponent: pendingFor('/etfs'),
});

const managedFundsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/managed-funds',
  component: lazyRouteComponent(investments, 'ManagedFundsRoute'),
  pendingComponent: pendingFor('/managed-funds'),
});

const cryptoRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/crypto',
  component: lazyRouteComponent(investments, 'CryptoRoute'),
  pendingComponent: pendingFor('/crypto'),
});

// Stage 3: the four cash-flow pages (stage-3.md §6.1).
const cashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cash',
  component: lazyRouteComponent(() => import('./pages/cash/CashPage'), 'CashPage'),
  pendingComponent: pendingFor('/cash'),
});

const sideIncomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/side-income',
  component: lazyRouteComponent(
    () => import('./pages/sideIncome/SideIncomePage'),
    'SideIncomePage',
  ),
  pendingComponent: pendingFor('/side-income'),
});

const budgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/budget',
  component: lazyRouteComponent(() => import('./pages/budget/BudgetPage'), 'BudgetPage'),
  pendingComponent: pendingFor('/budget'),
});

/** `/dividends?holding=<id>`: a positive-int holding filter; anything else is dropped. */
function validateDividendsSearch(search: Record<string, unknown>): { holding?: number } {
  const raw = search.holding;
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  return POSITIVE_INT_RE.test(text) ? { holding: Number(text) } : {};
}

const dividendsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/dividends',
  validateSearch: validateDividendsSearch,
  component: lazyRouteComponent(() => import('./routes/dividends'), 'DividendsRoute'),
  pendingComponent: pendingFor('/dividends'),
});

// Stage 4: the three assets pages (stage-4.md §6.1).
const otherAssetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/other-assets',
  component: lazyRouteComponent(
    () => import('./pages/otherAssets/OtherAssetsPage'),
    'OtherAssetsPage',
  ),
  pendingComponent: pendingFor('/other-assets'),
});

const superRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/super',
  component: lazyRouteComponent(() => import('./pages/super/SuperPage'), 'SuperPage'),
  pendingComponent: pendingFor('/super'),
});

const propertyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/property',
  component: lazyRouteComponent(() => import('./pages/property/PropertyPage'), 'PropertyPage'),
  pendingComponent: pendingFor('/property'),
});

// Stage 5: the Net Worth dashboard, History and Settings (stage-5.md §6.1).
const netWorthRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages/netWorth/NetWorthPage'), 'NetWorthPage'),
  pendingComponent: pendingFor('/'),
});

const historyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/history',
  component: lazyRouteComponent(() => import('./pages/history/HistoryPage'), 'HistoryPage'),
  pendingComponent: pendingFor('/history'),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./pages/settings/SettingsPage'), 'SettingsPage'),
  pendingComponent: pendingFor('/settings'),
});

// Stage 6 (stage-6.md §6.1): the FIRE page.
const fireRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/fire',
  component: lazyRouteComponent(() => import('./pages/fire/FirePage'), 'FirePage'),
  pendingComponent: pendingFor('/fire'),
});

const recordsEntityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/records/$entity',
  beforeLoad: ({ params }) => {
    if (!isRecordEntityId(params.entity)) throw notFound();
  },
  component: lazyRouteComponent(() => import('./routes/recordsEntity'), 'RecordsEntityRoute'),
  pendingComponent: pendingFor('/records/$entity'),
});

const importRunRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import/runs/$runId',
  beforeLoad: ({ params }) => {
    if (!POSITIVE_INT_RE.test(params.runId)) throw notFound();
  },
  component: lazyRouteComponent(() => import('./routes/importRun'), 'ImportRunRoute'),
  pendingComponent: pendingFor('/import/runs/$runId'),
});

// A holding's detail page under each investment path; beforeLoad accepts a positive int only.
const holdingDetail = () => import('./routes/holdingDetail');

const rejectNonPositiveId = ({ params }: { params: { instrumentId: string } }): void => {
  if (!POSITIVE_INT_RE.test(params.instrumentId)) throw notFound();
};

const stockDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stocks/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: lazyRouteComponent(holdingDetail, 'StockDetailRoute'),
  pendingComponent: pendingFor('/stocks/$instrumentId'),
});

const etfDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/etfs/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: lazyRouteComponent(holdingDetail, 'EtfDetailRoute'),
  pendingComponent: pendingFor('/etfs/$instrumentId'),
});

const managedFundDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/managed-funds/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: lazyRouteComponent(holdingDetail, 'ManagedFundDetailRoute'),
  pendingComponent: pendingFor('/managed-funds/$instrumentId'),
});

const cryptoDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/crypto/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: lazyRouteComponent(holdingDetail, 'CryptoDetailRoute'),
  pendingComponent: pendingFor('/crypto/$instrumentId'),
});

const styleguideRoute = createRoute({
  getParentRoute: () => appRoute,
  path: STYLEGUIDE_PAGE.path,
  component: lazyRouteComponent(
    () => import('./pages/styleguide/StyleguidePage'),
    'StyleguidePage',
  ),
  pendingComponent: pendingFor('/styleguide'),
});

// Full-viewport brand screen preview, outside the shell (no pending skeleton: it has no shell).
const screenPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/preview/screen/$variant',
  beforeLoad: ({ params }) => {
    if (!isScreenVariant(params.variant)) throw notFound();
  },
  component: lazyRouteComponent(() => import('./routes/screenPreview'), 'ScreenPreviewRoute'),
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    recordsRoute,
    importRoute,
    pricesRoute,
    stocksRoute,
    etfsRoute,
    managedFundsRoute,
    cryptoRoute,
    cashRoute,
    sideIncomeRoute,
    budgetRoute,
    dividendsRoute,
    otherAssetsRoute,
    superRoute,
    propertyRoute,
    netWorthRoute,
    historyRoute,
    settingsRoute,
    fireRoute,
    recordsEntityRoute,
    importRunRoute,
    stockDetailRoute,
    etfDetailRoute,
    managedFundDetailRoute,
    cryptoDetailRoute,
    styleguideRoute,
  ]),
  screenPreviewRoute,
]);

export function createAppRouter({
  queryClient,
  history,
}: {
  queryClient: QueryClient;
  history?: RouterHistory;
}) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    notFoundMode: 'root',
    defaultErrorComponent: ErrorPage,
    defaultPreload: 'intent',
    defaultPendingMs: PENDING_MS,
    defaultPendingMinMs: PENDING_MIN_MS,
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
