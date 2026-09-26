// Code-based TanStack Router route tree (Scaffolder; stage-0.md §1).
import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  useParams,
  type RouterHistory,
} from '@tanstack/react-router';
import { isRecordEntityId, type InstrumentKind } from '@joinr/schema';
import type { JSX } from 'react';
import { RootLayout } from './layout/RootLayout';
import { PAGES, STYLEGUIDE_PAGE, isScreenVariant, type PageDef } from './pages';
import { BudgetPage } from './pages/budget/BudgetPage';
import { CashPage } from './pages/cash/CashPage';
import { DividendsPage } from './pages/dividends/DividendsPage';
import { ErrorPage } from './pages/ErrorPage';
import { HistoryPage } from './pages/history/HistoryPage';
import { ImportPage } from './pages/import/ImportPage';
import { ImportRunPage } from './pages/import/ImportRunPage';
import { HoldingDetailPage } from './pages/investments/HoldingDetailPage';
import { InvestmentPage } from './pages/investments/InvestmentPage';
import { NetWorthPage } from './pages/netWorth/NetWorthPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OtherAssetsPage } from './pages/otherAssets/OtherAssetsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PricesPage } from './pages/prices/PricesPage';
import { PropertyPage } from './pages/property/PropertyPage';
import { RecordsEntityPage } from './pages/records/RecordsEntityPage';
import { RecordsIndexPage } from './pages/records/RecordsIndexPage';
import { ScreenPreviewPage } from './pages/ScreenPreviewPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { SideIncomePage } from './pages/sideIncome/SideIncomePage';
import { StyleguidePage } from './pages/styleguide/StyleguidePage';
import { SuperPage } from './pages/super/SuperPage';

export interface RouterContext {
  queryClient: QueryClient;
}

/** A positive integer path segment or search value (`7`; not `07`, `0` or `-1`). */
const POSITIVE_INT_RE = /^[1-9]\d{0,15}$/;

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

function placeholderFor(page: PageDef): () => JSX.Element {
  function Placeholder(): JSX.Element {
    return <PlaceholderPage page={page} />;
  }
  Placeholder.displayName = `Placeholder(${page.id})`;
  return Placeholder;
}

// Stage 1 pages have their own typed routes (literal paths, so links to them are type-checked).
const recordsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/records',
  component: RecordsIndexPage,
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import',
  component: ImportPage,
});

const pricesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/prices',
  component: PricesPage,
});

// Stage 2: the four investment pages (stage-2.md §6.1), one component per kind.
function investmentPageFor(kind: InstrumentKind): () => JSX.Element {
  function Investments(): JSX.Element {
    return <InvestmentPage kind={kind} />;
  }
  Investments.displayName = `InvestmentPage(${kind})`;
  return Investments;
}

const stocksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stocks',
  component: investmentPageFor('stock'),
});

const etfsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/etfs',
  component: investmentPageFor('etf'),
});

const managedFundsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/managed-funds',
  component: investmentPageFor('managed_fund'),
});

const cryptoRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/crypto',
  component: investmentPageFor('crypto'),
});

// Stage 3: the four cash-flow pages (stage-3.md §6.1).
const cashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cash',
  component: CashPage,
});

const sideIncomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/side-income',
  component: SideIncomePage,
});

const budgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/budget',
  component: BudgetPage,
});

/** `/dividends?holding=<id>`: a positive-int holding filter; anything else is dropped. */
function validateDividendsSearch(search: Record<string, unknown>): { holding?: number } {
  const raw = search.holding;
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  return POSITIVE_INT_RE.test(text) ? { holding: Number(text) } : {};
}

// eslint-disable-next-line react-refresh/only-export-components
function DividendsRoute(): JSX.Element {
  const { holding } = dividendsRoute.useSearch();
  return holding === undefined ? <DividendsPage /> : <DividendsPage holding={holding} />;
}

const dividendsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/dividends',
  validateSearch: validateDividendsSearch,
  component: DividendsRoute,
});

// Stage 4: the three assets pages (stage-4.md §6.1).
const otherAssetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/other-assets',
  component: OtherAssetsPage,
});

const superRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/super',
  component: SuperPage,
});

const propertyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/property',
  component: PropertyPage,
});

// Stage 5: the Net Worth dashboard, History and Settings (stage-5.md §6.1).
const netWorthRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: NetWorthPage,
});

const historyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/history',
  component: HistoryPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const BUILT_PAGE_ROUTES = [
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
];
const BUILT_PATHS: ReadonlySet<string> = new Set([
  '/records',
  '/import',
  '/prices',
  '/stocks',
  '/etfs',
  '/managed-funds',
  '/crypto',
  '/cash',
  '/side-income',
  '/budget',
  '/dividends',
  '/other-assets',
  '/super',
  '/property',
  '/',
  '/history',
  '/settings',
]);

// Every other page renders its placeholder until its stage lands.
const pageRoutes = PAGES.filter((page) => !BUILT_PATHS.has(page.path)).map((page) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: page.path,
    component: placeholderFor(page),
  }),
);

// eslint-disable-next-line react-refresh/only-export-components
function RecordsEntityRoute(): JSX.Element {
  const { entity } = recordsEntityRoute.useParams();
  // beforeLoad has already rejected unknown ids; this guard only narrows the type.
  return isRecordEntityId(entity) ? <RecordsEntityPage entity={entity} /> : <NotFoundPage />;
}

const recordsEntityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/records/$entity',
  beforeLoad: ({ params }) => {
    if (!isRecordEntityId(params.entity)) throw notFound();
  },
  component: RecordsEntityRoute,
});

// eslint-disable-next-line react-refresh/only-export-components
function ImportRunRoute(): JSX.Element {
  const { runId } = importRunRoute.useParams();
  return <ImportRunPage key={runId} runId={Number(runId)} />;
}

const importRunRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import/runs/$runId',
  beforeLoad: ({ params }) => {
    if (!POSITIVE_INT_RE.test(params.runId)) throw notFound();
  },
  component: ImportRunRoute,
});

// A holding's detail page under each investment path; beforeLoad accepts a positive int only.
function holdingDetailFor(kind: InstrumentKind): () => JSX.Element {
  function HoldingDetail(): JSX.Element {
    const { instrumentId } = useParams({ strict: false });
    // beforeLoad has already rejected anything else; this guard only narrows the type.
    return instrumentId !== undefined && POSITIVE_INT_RE.test(instrumentId) ? (
      <HoldingDetailPage key={instrumentId} kind={kind} instrumentId={Number(instrumentId)} />
    ) : (
      <NotFoundPage />
    );
  }
  HoldingDetail.displayName = `HoldingDetailPage(${kind})`;
  return HoldingDetail;
}

const rejectNonPositiveId = ({ params }: { params: { instrumentId: string } }): void => {
  if (!POSITIVE_INT_RE.test(params.instrumentId)) throw notFound();
};

const stockDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stocks/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: holdingDetailFor('stock'),
});

const etfDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/etfs/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: holdingDetailFor('etf'),
});

const managedFundDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/managed-funds/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: holdingDetailFor('managed_fund'),
});

const cryptoDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/crypto/$instrumentId',
  beforeLoad: rejectNonPositiveId,
  component: holdingDetailFor('crypto'),
});

const styleguideRoute = createRoute({
  getParentRoute: () => appRoute,
  path: STYLEGUIDE_PAGE.path,
  component: StyleguidePage,
});

// A route adapter, not a page: this module is the route tree and always full-reloads on edit.
// eslint-disable-next-line react-refresh/only-export-components
function ScreenPreviewRoute(): JSX.Element {
  const { variant } = useParams({ strict: false });
  // beforeLoad has already rejected unknown variants; this guard only narrows the type.
  // pages.ts keeps its own copy of the variant union (it stays dependency-free); the typed
  // `variant` prop of ScreenPreviewPage (BrandScreenVariant) keeps the two in sync.
  return isScreenVariant(variant) ? <ScreenPreviewPage variant={variant} /> : <NotFoundPage />;
}

// Full-viewport brand screen preview, outside the shell.
const screenPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/preview/screen/$variant',
  beforeLoad: ({ params }) => {
    if (!isScreenVariant(params.variant)) throw notFound();
  },
  component: ScreenPreviewRoute,
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    ...pageRoutes,
    ...BUILT_PAGE_ROUTES,
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
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
