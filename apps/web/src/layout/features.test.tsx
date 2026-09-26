// Stage 5 navigation and header (stage-5.md §3.3, §6.6): the `features.*` switches hide their pages
// (a missing value counts as on); Dividends hides only when ETFs, Stocks and Managed Funds are all
// off; a switched-off page opened by a link still renders, under a note that says so; the header's
// snapshot line says "· auto" while auto-record is on.
import type { AppStatus } from '@joinr/schema';
import { appStatusPopulated } from '@joinr/schema/fixtures';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockOverview } from '../../test/history';
import { renderApp } from '../../test/renderApp';
import { AUTO_MARK, freshnessOf } from './freshness';
import { NAV, navFor, pageSwitchedOff } from './nav';

function hrefs(groups: ReturnType<typeof navFor>): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}

describe('navFor (§6.6)', () => {
  it('shows every page while no feature is off (missing values count as on)', () => {
    expect(hrefs(navFor(undefined))).toEqual(hrefs(NAV));
    expect(hrefs(navFor({}))).toEqual(hrefs(NAV));
  });

  it('hides the pages whose feature is off; Super follows features.retirement', () => {
    const shown = hrefs(
      navFor({ 'features.crypto': false, 'features.retirement': false, 'features.fire': false }),
    );
    expect(shown).not.toContain('/crypto');
    expect(shown).not.toContain('/super');
    expect(shown).not.toContain('/fire');
    expect(shown).toContain('/dividends');
    // The empty Planning group is dropped.
    expect(navFor({ 'features.fire': false }).map((g) => g.id)).not.toContain('planning');
  });

  it('Dividends hides only when ETFs, Stocks and Managed Funds are all off', () => {
    expect(pageSwitchedOff('dividends', { 'features.etfs': false, 'features.stocks': false })).toBe(
      false,
    );
    expect(
      pageSwitchedOff('dividends', {
        'features.etfs': false,
        'features.stocks': false,
        'features.managedFunds': false,
      }),
    ).toBe(true);
    expect(pageSwitchedOff('net-worth', { 'features.cash': false })).toBe(false);
  });
});

describe('the header auto marker (§6.6)', () => {
  it('adds "· auto" to the snapshot while auto-record is on', () => {
    const now = new Date(new Date(appStatusPopulated.prices.lastRefreshAt ?? 0).getTime() + 60_000);
    const on: AppStatus = {
      ...appStatusPopulated,
      history: { autoRecord: true, nextRecordAt: null },
    };
    expect(freshnessOf(on, now).header.endsWith(`Snapshot Aug 2026${AUTO_MARK}`)).toBe(true);
    const off: AppStatus = {
      ...appStatusPopulated,
      history: { autoRecord: false, nextRecordAt: null },
    };
    expect(freshnessOf(off, now).header.endsWith('Snapshot Aug 2026')).toBe(true);
    expect(AUTO_MARK).toBe(' · auto');
  });
});

describe('RootLayout with features (§6.6)', () => {
  it('the nav leaves out a switched-off page; opening it shows the note with a link', async () => {
    mockOverview({
      routes: {
        'GET /api/status': {
          body: { ...appStatusPopulated, features: { 'features.crypto': false } },
        },
      },
    });
    renderApp('/crypto');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const note = await screen.findByRole('note', { name: 'Page switched off' });
    expect(note).toHaveTextContent('This page is switched off in Settings (Pages).');
    expect(within(note).getByRole('link', { name: 'Change it in Settings' })).toHaveAttribute(
      'href',
      '/settings#features',
    );
    expect(within(nav).queryByRole('link', { name: 'Crypto' })).toBeNull();
    // The page itself still renders.
    expect(await screen.findByRole('heading', { level: 1, name: 'Crypto' })).toBeVisible();
  });

  it('no note on a page that is on', async () => {
    mockOverview();
    renderApp('/history');
    await screen.findByRole('heading', { level: 1, name: 'History' });
    expect(screen.queryByRole('note', { name: 'Page switched off' })).toBeNull();
  });
});
