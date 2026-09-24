import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from '../router';

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

describe('RootLayout', () => {
  it('marks the current page in the nav and names it in the header and the tab title', async () => {
    renderAt('/stocks');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const current = within(nav).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Stocks');
    expect(within(screen.getByRole('banner')).getByText('Stocks')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Stocks · Joinr Finance'));
  });

  it('shows the brand block, freshness, footer version and every nav page', async () => {
    renderAt('/');
    const banner = await screen.findByRole('banner');
    expect(within(banner).getByText('FINANCE')).toBeInTheDocument();
    expect(within(banner).getByText('No prices yet · No snapshots yet')).toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(`Joinr Finance v${__APP_VERSION__}`);
    expect(footer).toHaveTextContent('Last snapshot — · Prices —');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(16);
    expect(within(nav).getByRole('link', { name: 'Net Worth' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('navigates through the nav and moves aria-current', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Budget' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/budget'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Budget');
    expect(within(nav).getByRole('link', { name: 'Net Worth' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('names the style guide page', async () => {
    renderAt('/styleguide');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Style guide');
  });
});
