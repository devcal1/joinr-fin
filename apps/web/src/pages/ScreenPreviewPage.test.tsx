import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from '../router';
import { SCREEN_VARIANTS } from '../pages';

function renderAt(path: string): void {
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
}

const TITLES = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
  login: 'Sign in',
} as const;

describe('ScreenPreviewPage', () => {
  it.each(SCREEN_VARIANTS)(
    'previews the %s screen at full viewport, outside the shell',
    async (variant) => {
      renderAt(`/preview/screen/${variant}`);
      const heading = await screen.findByRole('heading', { level: 1, name: TITLES[variant] });
      const main = screen.getByRole('main');
      expect(main).toContainElement(heading);
      expect(main).toHaveClass('jf-brand-screen--full', `jf-brand-screen--${variant}`);
      // Outside the AppShell: no navigation landmark.
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Back to style guide' })).toHaveAttribute(
        'href',
        '/styleguide#brand',
      );
      expect(document.title).toBe(`${TITLES[variant]} (preview) · Joinr Finance`);
    },
  );

  it('announces the loading preview as a status', async () => {
    renderAt('/preview/screen/loading');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading');
  });

  it('shows sample actions on the other variants', async () => {
    renderAt('/preview/screen/empty');
    expect(await screen.findByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });
});
