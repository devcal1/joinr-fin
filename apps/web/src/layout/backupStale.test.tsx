// The stale-backup callout (stage-7.md §6.4, §11 item 5): above every page while `/api/status`
// reports stale backups, with the last good date (the server-local date) or "No backup has been
// taken yet", and a link to Settings → Backups that lands on the section's heading.
import type { AppStatus } from '@joinr/schema';
import { appStatusBackups, appStatusPopulated, backupsPages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockOverview } from '../../test/history';
import { renderApp } from '../../test/renderApp';
import { backupsStale, staleBackupText } from './backupStale';

function withStatus(status: AppStatus) {
  return mockOverview({
    backups: {
      ...backupsPages.lastFailed,
      app: { ...backupsPages.lastFailed.app, version: __APP_VERSION__ },
    },
    routes: { 'GET /api/status': { body: status } },
  });
}

describe('staleBackupText', () => {
  it('names the server-local date of the last good backup', () => {
    expect(staleBackupText('2030-09-12T02:30:00+10:00')).toBe(
      'The nightly backup has not succeeded since 12/09/2030.',
    );
    // 23:30 on 30/06 in Melbourne is 30/06, whatever the viewer's zone.
    expect(staleBackupText('2030-06-30T23:30:00+10:00')).toBe(
      'The nightly backup has not succeeded since 30/06/2030.',
    );
  });

  it('says so when there has never been one', () => {
    expect(staleBackupText(null)).toBe('No backup has been taken yet.');
    expect(staleBackupText(undefined)).toBe('No backup has been taken yet.');
    expect(staleBackupText('garbage')).toBe('No backup has been taken yet.');
  });

  it('reads the flag only when the status carries it', () => {
    expect(backupsStale(undefined)).toBe(false);
    expect(backupsStale(appStatusPopulated)).toBe(false);
    expect(backupsStale(appStatusBackups.fresh)).toBe(false);
    expect(backupsStale(appStatusBackups.stale)).toBe(true);
    expect(backupsStale(appStatusBackups.never)).toBe(true);
  });
});

describe('the callout on the pages (§6.4)', () => {
  it.each([
    ['/history', 'History'],
    ['/settings', 'Settings'],
  ])('shows on %s with a link to Backups', async (path, title) => {
    withStatus(appStatusBackups.stale);
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: title });
    const callout = await screen.findByRole('note', { name: 'Backup overdue' });
    expect(callout).toHaveClass('jf-callout--important');
    expect(callout).toHaveTextContent('The nightly backup has not succeeded since 12/09/2030.');
    expect(within(callout).getByRole('link', { name: 'Open Backups' })).toHaveAttribute(
      'href',
      '/settings#backups',
    );
    // Above the page's own content.
    const main = screen.getByRole('main');
    expect(main.contains(callout)).toBe(true);
  });

  it('never backed up: "No backup has been taken yet."', async () => {
    withStatus(appStatusBackups.never);
    renderApp('/history');
    const callout = await screen.findByRole('note', { name: 'Backup overdue' });
    expect(callout).toHaveTextContent('No backup has been taken yet.');
  });

  it('not shown while the backups are fresh, or on a status without the block', async () => {
    withStatus(appStatusBackups.fresh);
    const view = renderApp('/history');
    await screen.findByRole('heading', { level: 1, name: 'History' });
    await waitFor(() => expect(screen.getByRole('banner')).toBeInTheDocument());
    expect(screen.queryByRole('note', { name: 'Backup overdue' })).toBeNull();
    view.unmount();
    withStatus(appStatusPopulated);
    renderApp('/history');
    await screen.findByRole('heading', { level: 1, name: 'History' });
    expect(screen.queryByRole('note', { name: 'Backup overdue' })).toBeNull();
  });

  it('the link lands on the Backups heading', async () => {
    withStatus(appStatusBackups.stale);
    const { user, router } = renderApp('/history');
    const callout = await screen.findByRole('note', { name: 'Backup overdue' });
    await user.click(within(callout).getByRole('link', { name: 'Open Backups' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.location.hash).toBe('backups');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Backups' })).toHaveFocus(),
    );
  });
});
