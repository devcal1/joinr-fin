// stage-5.md §6.7 and stage-6.md §6.8: every user-facing "Stage 5" and "Stage 6" text is now a
// present-tense line. This renders every data page (FIRE included) with every fixture state
// and asserts no page shows "Stage 5" or "Stage 6" ("Stage 7" mentions stay allowed).
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { PAGE_CASES } from './pageCases';

const CASES = PAGE_CASES.flatMap((page) =>
  Object.entries(page.states).map(([state, routes]) => [page.id, state, page, routes] as const),
);

describe('no page shows "Stage 5" or "Stage 6" (stage-5.md §6.7, stage-6.md §6.8)', () => {
  it.each(CASES)('%s · %s', async (_id, state, page, routes) => {
    mockApi(Object.fromEntries(Object.entries(routes).map(([route, body]) => [route, { body }])));
    renderApp(page.paths?.[state] ?? page.path);
    const main = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: page.title });
    await waitFor(() => expect(main.querySelector('[data-skeleton-layout]')).toBeNull());
    await waitFor(() => expect(main.querySelectorAll('h2, table').length).toBeGreaterThan(0));
    expect(main).not.toHaveTextContent('Stage 5');
    expect(main).not.toHaveTextContent('Stage 6');
    expect(document.title).not.toMatch(/Stage [56]/);
  });
});
