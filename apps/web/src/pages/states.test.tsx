// stage-6.md §6.9 A–B: every data page (FIRE included) shows its skeleton with a status
// label on the first load (never the bare Loading line), `LoadError` (important, Try again) when the
// first load fails, and keeps its figures under a "Couldn't refresh" callout when a refetch fails.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, type MockHandler } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { refreshErrorText } from '../components/queryStateText';
import { PAGE_CASES } from './pageCases';

const SERVER_ERROR = {
  status: 500,
  body: { error: { code: 'INTERNAL', message: 'The server had a problem.' } },
};

describe('first load: the page skeleton (§6.9 A)', () => {
  it.each(PAGE_CASES.map((c) => [c.id, c] as const))('%s', async (_id, page) => {
    // Every request (the page's and the shell's) stays in flight.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderApp(page.path);
    const main = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: page.title });
    const skeleton = await waitFor(() => {
      const found = main.querySelector<HTMLElement>('[data-skeleton-layout]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(skeleton.dataset.skeletonLayout).toBe(page.layout);
    expect(within(skeleton).getByRole('status')).toHaveTextContent(page.loading);
    expect(skeleton.querySelectorAll('.jf-skeleton').length).toBeGreaterThan(0);
    expect(main.querySelector('.jf-app-loading')).toBeNull();
    // The page's own skeleton sits under its real header: no header block of its own.
    expect(within(skeleton).queryByTestId('skeleton-header')).toBeNull();
  });
});

describe('first load fails: LoadError (§6.9 B)', () => {
  it.each(PAGE_CASES.map((c) => [c.id, c] as const))('%s', async (_id, page) => {
    const api = mockApi({ [page.primary]: SERVER_ERROR });
    const { user } = renderApp(page.path);
    const callout = await screen.findByRole('note', { name: page.errorTitle });
    expect(callout).toHaveClass('jf-callout--important');
    expect(callout).toHaveTextContent('The server had a problem.');
    expect(document.querySelector('[data-skeleton-layout]')).toBeNull();
    const before = api.calls(page.primary).length;
    await user.click(within(callout).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.calls(page.primary).length).toBe(before + 1));
  });
});

describe('a refetch fails: the figures stay under a callout (§6.9 B)', () => {
  it.each(PAGE_CASES.map((c) => [c.id, c] as const))('%s', async (_id, page) => {
    const state = Object.values(page.states)[0]!;
    let failing = false;
    const routes: Record<string, MockHandler> = {};
    for (const [route, body] of Object.entries(state)) {
      routes[route] = route === page.primary ? () => (failing ? SERVER_ERROR : { body }) : { body };
    }
    mockApi(routes);
    const { queryClient } = renderApp(page.path);
    const main = await screen.findByRole('main');
    await waitFor(() => expect(main.querySelector('[data-skeleton-layout]')).toBeNull());
    // The page's content: its sections and tables.
    const content = (): number => main.querySelectorAll('h2, table').length;
    await waitFor(() => expect(content()).toBeGreaterThan(0));
    const sections = content();

    failing = true;
    await act(async () => {
      await queryClient.refetchQueries({ type: 'active' });
    });
    const callout = await screen.findByRole('note', { name: "Couldn't refresh" });
    expect(callout).toHaveClass('jf-callout--important');
    expect(callout).toHaveTextContent(
      /^Couldn't refresh\s*The server had a problem\. Showing the figures from \d{2}:\d{2}\./,
    );
    // The page keeps its content (never replaced by the error or a skeleton).
    expect(content()).toBe(sections);
    expect(main.querySelector('[data-skeleton-layout]')).toBeNull();
    expect(screen.queryByRole('note', { name: page.errorTitle })).toBeNull();
  });
});

describe('refreshErrorText', () => {
  const now = new Date(2026, 8, 24, 15, 0);
  it('gives the time for figures loaded today', () => {
    const at = new Date(2026, 8, 24, 14, 32).getTime();
    expect(refreshErrorText(new Error('Network down.'), at, now)).toBe(
      'Network down. Showing the figures from 14:32.',
    );
  });

  it('adds the date for figures from an earlier day', () => {
    const at = new Date(2026, 8, 23, 9, 5).getTime();
    expect(refreshErrorText(new Error('Offline'), at, now)).toBe(
      'Offline. Showing the figures from 23/09/2026 09:05.',
    );
  });

  it('never prints an empty time', () => {
    expect(refreshErrorText(new Error('Offline'), 0, now)).toBe(
      'Offline. Showing the last figures loaded.',
    );
  });
});
