import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorPage } from './ErrorPage';

// A miniature of the app's route tree: a pathless `app` layout (standing in for the AppShell) with
// a page that can fail, plus a page outside the layout. ErrorPage is the default error component.
const failure = { active: true };

function Boom(): JSX.Element {
  if (failure.active) throw new Error('Example failure for the test');
  return <p>Recovered page</p>;
}

function makeRouter(path: string) {
  const queryClient = new QueryClient();
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });
  const app = createRoute({
    getParentRoute: () => root,
    id: 'app',
    component: () => (
      <div data-testid="shell">
        <Outlet />
      </div>
    ),
  });
  const home = createRoute({ getParentRoute: () => app, path: '/', component: () => <p>Home</p> });
  const inside = createRoute({ getParentRoute: () => app, path: '/inside', component: Boom });
  const outside = createRoute({ getParentRoute: () => root, path: '/outside', component: Boom });
  const router = createRouter({
    routeTree: root.addChildren([app.addChildren([home, inside]), outside]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
    defaultErrorComponent: ErrorPage,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('ErrorPage', () => {
  beforeEach(() => {
    failure.active = true;
    document.title = 'Before';
    // React logs caught render errors; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays inside the shell when a page fails, so the navigation remains usable', async () => {
    makeRouter('/inside');
    const heading = await screen.findByRole('heading', { name: 'Something went wrong' });
    expect(screen.getByTestId('shell')).toContainElement(heading);
    expect(screen.queryByRole('main')).toBeNull();
    expect(heading.tagName).toBe('H2');
    // The shell's layout owns the tab title here.
    expect(document.title).toBe('Before');
  });

  it('takes the full viewport when the failure is outside the shell', async () => {
    makeRouter('/outside');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(screen.getByRole('main')).toContainElement(heading);
    expect(screen.queryByTestId('shell')).toBeNull();
    expect(document.title).toBe('Something went wrong · Joinr Finance');
  });

  it('shows the technical detail, collapsed', async () => {
    makeRouter('/inside');
    const summary = await screen.findByText('Technical details');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(
      within(details as HTMLElement).getByText('Example failure for the test'),
    ).toBeInTheDocument();
  });

  it('"Try again" re-renders the page once the fault clears', async () => {
    makeRouter('/inside');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    failure.active = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Recovered page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  });

  it('links back to Net Worth', async () => {
    const router = makeRouter('/inside');
    await userEvent.click(await screen.findByRole('link', { name: 'Back to Net Worth' }));
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
