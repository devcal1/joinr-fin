import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from './router';

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

describe('router', () => {
  it('renders Net Worth at /', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /net worth/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders a placeholder page with its name', async () => {
    renderAt('/stocks');
    expect(await screen.findByRole('heading', { level: 1, name: 'Stocks' })).toBeInTheDocument();
  });

  it('renders the style guide', async () => {
    renderAt('/styleguide');
    expect(
      await screen.findByRole('heading', { level: 1, name: /style guide/i }),
    ).toBeInTheDocument();
  });

  it('shows "Page not found" for an unknown path', async () => {
    renderAt('/definitely-not-a-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows "Page not found" for an unknown screen variant', async () => {
    renderAt('/preview/screen/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
