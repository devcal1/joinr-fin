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
import { isRecordEntityId } from '@joinr/schema';
import type { JSX } from 'react';
import { RootLayout } from './layout/RootLayout';
import { PAGES, STYLEGUIDE_PAGE, isScreenVariant, type PageDef } from './pages';
import { ErrorPage } from './pages/ErrorPage';
import { ImportPage } from './pages/import/ImportPage';
import { ImportRunPage } from './pages/import/ImportRunPage';
import { NetWorthPage } from './pages/NetWorthPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PricesPage } from './pages/prices/PricesPage';
import { RecordsEntityPage } from './pages/records/RecordsEntityPage';
import { RecordsIndexPage } from './pages/records/RecordsIndexPage';
import { ScreenPreviewPage } from './pages/ScreenPreviewPage';
import { StyleguidePage } from './pages/styleguide/StyleguidePage';

export interface RouterContext {
  queryClient: QueryClient;
}

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

const BUILT_PAGE_ROUTES = [recordsRoute, importRoute, pricesRoute];
const BUILT_PATHS: ReadonlySet<string> = new Set(['/records', '/import', '/prices']);

// Every other page renders its placeholder until its stage lands.
const pageRoutes = PAGES.filter((page) => !BUILT_PATHS.has(page.path)).map((page) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: page.path,
    component: page.id === 'net-worth' ? NetWorthPage : placeholderFor(page),
  }),
);

/** A positive integer path segment (`7`; not `07`, `0` or `-1`). */
const POSITIVE_INT_RE = /^[1-9]\d{0,15}$/;

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
