// Renders the whole app (router + shell + page) at a path, with a fresh QueryClient.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppRouter } from '../src/router';

/**
 * Loads every lazy route component up front (stage-6.md §6.1: the pages are lazy since Stage 6).
 * The first dynamic import of a page transforms its module graph, which under the full suite's load
 * can take longer than a `findBy*` wait; importing them once per test file keeps the timings the
 * static imports had. The lazy loading itself is tested in router.test.tsx.
 */
export async function preloadRoutes(): Promise<void> {
  const router = createAppRouter({ queryClient: new QueryClient() });
  await Promise.all(
    Object.values(router.routesById).map((route) => {
      const component = route.options.component as { preload?: () => Promise<void> } | undefined;
      return component?.preload?.() ?? Promise.resolve();
    }),
  );
}

await preloadRoutes();

export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient, user };
}

/** The page's main landmark (the routed page, without the nav and header), once rendered. */
export function findMain(): Promise<HTMLElement> {
  return screen.findByRole('main');
}
