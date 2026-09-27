import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { preloadRoutes } from '../test/renderApp';
import { PAGES } from './pages';
import { PAGE_CASES } from './pages/pageCases';
import { PENDING_MIN_MS, PENDING_MS, createAppRouter } from './router';
import { ROUTE_SKELETONS, pendingFor, type SkeletonRoutePath } from './routes/pending';

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** '/app/etfs/$instrumentId' → '/etfs/$instrumentId'; '/app/' → '/'. */
function routePathOf(routeId: string | undefined): string {
  const path = (routeId ?? '').replace(/^\/app/, '');
  return path === '' ? '/' : path;
}

// The page chunks load once per file (see preloadRoutes); the static-import test below checks that
// the router itself loads them lazily.
beforeAll(preloadRoutes);

describe('router', () => {
  it('renders Net Worth at /', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /net worth/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders the FIRE page at its typed route (stage-6.md §6.1)', async () => {
    const router = renderAt('/fire');
    expect(await screen.findByRole('heading', { level: 1, name: 'FIRE' })).toBeInTheDocument();
    expect(router.state.matches.at(-1)?.routeId).toBe('/app/fire');
  });

  it.each(PAGES.map((page) => [page.path, page.title] as const))(
    'routes %s to its built page (no placeholder route is left, stage-6.md §6.1)',
    async (path, title) => {
      const router = renderAt(path);
      expect(
        await screen.findByRole('heading', { level: 1, name: new RegExp(`^${title}$`, 'i') }),
      ).toBeInTheDocument();
      expect(router.state.matches.at(-1)?.routeId).not.toBe('__root__');
    },
  );

  it.each([
    ['/', 'Net worth', 'Could not load net worth'],
    ['/history', 'History', 'Could not load history'],
    ['/settings', 'Settings', 'Could not load settings'],
  ])(
    'renders the Stage 5 page %s with its h1 even when the API is down',
    async (path, title, error) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(await screen.findByRole('note', { name: error })).toHaveClass('jf-callout--important');
    },
  );

  it.each([
    ['/other-assets', 'Other Assets', 'Could not load other assets'],
    ['/super', 'Super', 'Could not load super'],
    ['/property', 'Property', 'Could not load property'],
  ])(
    'renders the Stage 4 page %s with its h1 even when the API is down',
    async (path, title, error) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(await screen.findByRole('note', { name: error })).toHaveClass('jf-callout--important');
    },
  );

  it.each([
    ['/cash', 'Cash', 'Could not load the cash page'],
    ['/side-income', 'Side Income', 'Could not load the side income page'],
    ['/budget', 'Budget', 'Could not load the budget'],
    ['/dividends', 'Dividends', 'Could not load the dividends'],
    ['/dividends?holding=4', 'Dividends', 'Could not load the dividends'],
  ])(
    'renders the Stage 3 page %s with its h1 even when the API is down',
    async (path, title, error) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(await screen.findByRole('note', { name: error })).toHaveClass('jf-callout--important');
    },
  );

  it.each([
    ['/stocks', 'Stocks'],
    ['/etfs', 'ETFs'],
    ['/managed-funds', 'Managed Funds'],
    ['/crypto', 'Crypto'],
    ['/etfs/4', 'Holding'],
    ['/crypto/7', 'Holding'],
  ])('renders the Stage 2 page %s with its h1 even when the API is down', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await screen.findByRole('note')).toHaveClass('jf-callout--important');
  });

  it.each(['/etfs/0', '/etfs/abc', '/stocks/07', '/crypto/-1'])(
    'shows "Page not found" for the holding path %s',
    async (path) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    },
  );

  it('renders the style guide', async () => {
    renderAt('/styleguide');
    expect(
      await screen.findByRole('heading', { level: 1, name: /style guide/i }),
    ).toBeInTheDocument();
  });

  it('renders a brand screen preview outside the shell', async () => {
    renderAt('/preview/screen/empty');
    await waitFor(() => expect(document.querySelector('.jf-brand-screen')).not.toBeNull());
    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
  });

  it('shows "Page not found" for an unknown path', async () => {
    renderAt('/definitely-not-a-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows "Page not found" for an unknown screen variant', async () => {
    renderAt('/preview/screen/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it.each([
    ['/records', 'Records'],
    ['/records/trades', 'Records'],
    ['/import', 'Import'],
    ['/import/runs/3', 'Import'],
    ['/prices', 'Prices'],
  ])('renders the Stage 1 page %s with its h1 even when the API is down', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(await screen.findByRole('note')).toHaveClass('jf-callout--important');
  });

  it.each(['/records/nope', '/import/runs/abc', '/import/runs/0'])(
    'shows "Page not found" for %s',
    async (path) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    },
  );
});

describe('lazy routes (stage-6.md §6.1, §6.9 H)', () => {
  it('statically imports no page module except NotFoundPage and ErrorPage', () => {
    const source = readFileSync(join(__dirname, 'router.tsx'), 'utf8');
    const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map(
      (m) => m[1]!,
    );
    const pageImports = staticImports.filter((spec) => spec.startsWith('./pages/'));
    expect(pageImports.sort()).toEqual(['./pages/ErrorPage', './pages/NotFoundPage']);
    // Route modules are lazy too: only the params and the pending wrappers load up front.
    expect(staticImports.filter((spec) => spec.startsWith('./routes/')).sort()).toEqual([
      './routes/params',
      './routes/pending',
    ]);
    expect(source).toMatch(/lazyRouteComponent\(\(\) => import\('\.\/pages\/cash\/CashPage'\)/);
  });

  it('the route modules import no page statically from the router', () => {
    const pending = readFileSync(join(__dirname, 'routes', 'pending.tsx'), 'utf8');
    expect(pending).not.toMatch(/from '\.\.\/pages\//);
  });

  it('waits 150 ms before a pending skeleton and keeps it at least 300 ms', () => {
    const router = createAppRouter({ queryClient: new QueryClient() });
    expect(router.options.defaultPendingMs).toBe(PENDING_MS);
    expect(router.options.defaultPendingMinMs).toBe(PENDING_MIN_MS);
    expect([PENDING_MS, PENDING_MIN_MS]).toEqual([150, 300]);
  });

  it('gives every shell route a pending skeleton', () => {
    const router = createAppRouter({ queryClient: new QueryClient() });
    const shellRoutes = Object.values(router.routesById).filter(
      (route) => route.id.startsWith('/app/') && route.id !== '/app',
    );
    expect(shellRoutes.length).toBe(Object.keys(ROUTE_SKELETONS).length);
    for (const route of shellRoutes) {
      const path = routePathOf(route.id);
      expect(Object.keys(ROUTE_SKELETONS), route.id).toContain(path);
      expect(route.options.pendingComponent, route.id).toBeTypeOf('function');
    }
  });

  it.each(Object.keys(ROUTE_SKELETONS) as SkeletonRoutePath[])(
    'the pending wrapper for %s draws the header area and its label',
    (path) => {
      const Pending = pendingFor(path);
      render(<Pending />);
      const skeleton = document.querySelector<HTMLElement>('[data-skeleton-layout]')!;
      expect(skeleton.dataset.skeletonLayout).toBe(ROUTE_SKELETONS[path].layout);
      expect(within(skeleton).getByTestId('skeleton-header')).toBeInTheDocument();
      expect(within(skeleton).getByRole('status')).toHaveTextContent(ROUTE_SKELETONS[path].label);
    },
  );

  it.each(PAGE_CASES.map((c) => [c.path, c] as const))(
    "the pending wrapper for %s uses the page's own skeleton layout",
    async (path, page) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => undefined)),
      );
      const router = renderAt(path);
      const main = await screen.findByRole('main');
      await screen.findByRole('heading', { level: 1, name: page.title });
      const own = await waitFor(() => {
        const found = main.querySelector<HTMLElement>('[data-skeleton-layout]');
        expect(found).not.toBeNull();
        return found!;
      });
      const routeId = router.state.matches.at(-1)?.routeId;
      const route = Object.values(router.routesById).find((r) => r.id === routeId);
      const Pending = route?.options.pendingComponent as ComponentType | undefined;
      expect(Pending, String(routeId)).toBeTypeOf('function');
      const { container } = render(Pending ? <Pending /> : null);
      const wrapper = container.querySelector<HTMLElement>('[data-skeleton-layout]');
      expect(wrapper?.dataset.skeletonLayout).toBe(own.dataset.skeletonLayout);
      expect(ROUTE_SKELETONS[routePathOf(routeId) as SkeletonRoutePath].layout).toBe(page.layout);
    },
  );
});
