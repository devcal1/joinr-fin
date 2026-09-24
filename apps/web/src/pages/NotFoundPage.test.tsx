import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
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

describe('NotFoundPage', () => {
  it('is a full-viewport brand error screen for an unknown path', async () => {
    renderAt('/no-such-page');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    const main = screen.getByRole('main');
    expect(main).toContainElement(heading);
    expect(main).toHaveClass('jf-brand-screen', 'jf-brand-screen--full', 'jf-brand-screen--error');
    expect(screen.getByText(/no page at this address/i)).toBeInTheDocument();
    expect(document.title).toBe('Page not found · Joinr Finance');
  });

  it('links back to Net Worth', async () => {
    const router = renderAt('/no-such-page');
    const link = await screen.findByRole('link', { name: 'Back to Net Worth' });
    expect(link).toHaveAttribute('href', '/');
    await userEvent.click(link);
    expect(
      await screen.findByRole('heading', { level: 1, name: /net worth/i }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
