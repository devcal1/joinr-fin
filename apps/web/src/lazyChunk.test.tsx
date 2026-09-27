// A lazy route chunk that fails to load (stage-6.md §7.9, triage CODE-6): the router's
// lazyRouteComponent reloads the page once for a missing module (a new deployment replaced the
// chunk), remembering it in sessionStorage; the second failure, or any other import error, reaches
// the app's ErrorPage. jsdom's Location is unforgeable, so the reload is observed through the key.
import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorPage } from './pages/ErrorPage';
import { createAppRouter } from './router';

const MISSING = 'Failed to fetch dynamically imported module: /x.js';
const RELOAD_KEY = `tanstack_router_reload:${MISSING}`;

/** A root with one lazy route at `/` whose chunk import rejects with `error`. */
function renderFailingChunk(error: Error) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: lazyRouteComponent(() => Promise.reject(error)),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: ErrorPage,
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('lazy route chunks (§7.9)', () => {
  it('the app router renders ErrorPage for a route error', () => {
    const router = createAppRouter({ queryClient: new QueryClient() });
    expect(router.options.defaultErrorComponent).toBe(ErrorPage);
  });

  it('a missing chunk reloads the page once (the key is set, no error screen yet)', async () => {
    // jsdom cannot navigate: it reports "Not implemented: navigation" on the reload.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderFailingChunk(new TypeError(MISSING));
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1'));
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  });

  it('after the one reload, the same missing chunk shows ErrorPage', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sessionStorage.setItem(RELOAD_KEY, '1');
    renderFailingChunk(new TypeError(MISSING));
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  });

  it('any other import error shows ErrorPage at once and sets no reload key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderFailingChunk(new Error('boom'));
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(sessionStorage.length).toBe(0);
  });
});
