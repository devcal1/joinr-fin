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
    renderAt('/history');
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
  });

  it.each([
    ['/other-assets', 'Other Assets', 'Could not load other assets'],
    ['/super', 'Super', 'Could not load super'],
    ['/property', 'Property', 'Could not load property'],
  ])(
    'renders the Stage 4 page %s with its h1 even when the API is down',
    async (path, title, error) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(await screen.findByRole('note', { name: error })).toHaveClass('jf-callout--do-not');
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
      expect(await screen.findByRole('note', { name: error })).toHaveClass('jf-callout--do-not');
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
    expect(await screen.findByRole('note')).toHaveClass('jf-callout--do-not');
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
    expect(await screen.findByRole('note')).toHaveClass('jf-callout--do-not');
  });

  it.each(['/records/nope', '/import/runs/abc', '/import/runs/0'])(
    'shows "Page not found" for %s',
    async (path) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    },
  );
});
