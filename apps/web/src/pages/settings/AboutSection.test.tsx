// The Settings About block (stage-7.md §6.3, §6.7): the web and server versions, the database level
// and the server's zone; the version note with a Reload button when the page and the server
// disagree (set relative to this build's `__APP_VERSION__`); the Restored line after a restore.
import type { BackupsResponse } from '@joinr/schema';
import { backupsPages } from '@joinr/schema/fixtures';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockOverview } from '../../../test/history';
import { renderApp } from '../../../test/renderApp';

function withVersion(page: BackupsResponse, version: string): BackupsResponse {
  return { ...page, app: { ...page.app, version } };
}

async function openAbout(backups: BackupsResponse) {
  mockOverview({ backups });
  const view = renderApp('/settings');
  await screen.findByTestId('backups-schedule');
  return view;
}

function about(): HTMLElement {
  return screen.getByRole('region', { name: 'About' });
}

/** The KV rows as [label, value] pairs. */
function rows(): [string, string][] {
  return within(within(about()).getByRole('table', { name: 'About this app' }))
    .getAllByRole('row')
    .map((row) => [
      within(row).getByRole('rowheader').textContent ?? '',
      within(row).getByRole('cell').textContent ?? '',
    ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('About (§6.3)', () => {
  it('shows the versions, the database level and the time zone', async () => {
    await openAbout(withVersion(backupsPages.typical, __APP_VERSION__));
    expect(within(about()).getByRole('heading', { level: 2, name: 'About' })).toHaveAttribute(
      'id',
      'about',
    );
    expect(rows()).toEqual([
      ['App version', `v${__APP_VERSION__}`],
      ['Server version', `v${__APP_VERSION__}`],
      ['Database level', '6'],
      ['Time zone', 'Australia/Melbourne'],
    ]);
    expect(within(about()).queryByRole('note')).toBeNull();
  });

  it('a version mismatch: the note and a Reload button', async () => {
    const other = `${__APP_VERSION__}-other`;
    const { user } = await openAbout(withVersion(backupsPages.versionMismatch, other));
    const note = within(about()).getByRole('note', { name: 'New version' });
    expect(note).toHaveClass('jf-callout--note');
    expect(note).toHaveTextContent(
      `This page is from v${__APP_VERSION__}; the server runs v${other}. Reload to get the new version.`,
    );
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    await user.click(within(note).getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the versionMismatch fixture differs from this build', async () => {
    // The fixture's 1.0.1 is a mismatch unless this build is 1.0.1 itself.
    await openAbout(backupsPages.versionMismatch);
    const mismatch = __APP_VERSION__ !== backupsPages.versionMismatch.app.version;
    expect(within(about()).queryByRole('note', { name: 'New version' }) !== null).toBe(mismatch);
  });

  it('after a restore: where from and when, in the server zone', async () => {
    await openAbout(withVersion(backupsPages.restored, __APP_VERSION__));
    expect(rows().at(-1)).toEqual([
      'Restored',
      'from manual-20300910-180500+1000.db on 15/09/2030 11:00',
    ]);
  });

  it('no Restored line without a restore', async () => {
    await openAbout(withVersion(backupsPages.typical, __APP_VERSION__));
    expect(rows().map(([label]) => label)).not.toContain('Restored');
  });
});
