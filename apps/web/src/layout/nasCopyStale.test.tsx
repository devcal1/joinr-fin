// The NAS-copy callout (stage-8.md §8.4, §8.6; D132: no heartbeat): above every page while
// `/api/status` says the copy is overdue, half set up, unusable or locked, with the server-local
// date of the last success (15/09/2030 for a success at 2030-09-14T17:00:05Z, whatever the
// machine's zone), a text from `configReason` or the lock (never a run's error), a link to
// Settings → Backups → NAS copy, and its place under the Stage 7 backup callout.
import type { AppStatus } from '@joinr/schema';
import {
  appStatusBackups,
  appStatusNasCopy,
  appStatusPopulated,
  backupsPages,
  nasCopyStates,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockOverview } from '../../test/history';
import { renderApp } from '../../test/renderApp';
import {
  NAS_BLOCKED_TEXT,
  NAS_NEVER_SUCCEEDED,
  nasCopyProblem,
  staleNasCopyText,
} from './nasCopyStale';

function withStatus(status: AppStatus) {
  const base = backupsPages.nasReady;
  return mockOverview({
    backups: { ...base, app: { ...base.app, version: __APP_VERSION__ } },
    routes: { 'GET /api/status': { body: status } },
  });
}

const savedTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = savedTz;
});

describe('staleNasCopyText', () => {
  it('names the server-local date of the last success, whatever the machine zone', () => {
    process.env.TZ = 'UTC';
    // 2030-09-14T17:00:05Z is 03:00:05 on Sunday 15/09/2030 in Melbourne (§3.4: local with offset).
    expect(staleNasCopyText('2030-09-15T03:00:05+10:00')).toBe(
      'The weekly copy to the NAS has not succeeded since 15/09/2030.',
    );
  });

  it('says so when there has never been one', () => {
    expect(staleNasCopyText(null)).toBe(NAS_NEVER_SUCCEEDED);
    expect(staleNasCopyText(undefined)).toBe(NAS_NEVER_SUCCEEDED);
    expect(staleNasCopyText('garbage')).toBe(NAS_NEVER_SUCCEEDED);
    expect(NAS_NEVER_SUCCEEDED).toBe('The weekly copy to the NAS has not succeeded yet.');
  });
});

describe('nasCopyProblem', () => {
  it('none without the block, when fine, or off', () => {
    expect(nasCopyProblem(undefined)).toBeNull();
    expect(nasCopyProblem(appStatusPopulated)).toBeNull();
    expect(nasCopyProblem(appStatusNasCopy.ok)).toBeNull();
    expect(
      nasCopyProblem({
        ...appStatusPopulated,
        nasCopy: {
          configured: 'off',
          configReason: null,
          blocked: false,
          stale: false,
          lastSuccessAt: null,
        },
      }),
    ).toBeNull();
  });

  it('stale: overdue with the date', () => {
    expect(nasCopyProblem(appStatusNasCopy.stale)).toEqual({
      title: 'NAS copy overdue',
      text: 'The weekly copy to the NAS has not succeeded since 15/09/2030.',
    });
  });

  it.each([
    ['url_missing', 'The copy to the NAS is half set up, so nothing is being copied.'],
    ['password_missing', 'The copy to the NAS is half set up, so nothing is being copied.'],
    ['url_invalid', 'The NAS address is not usable, so nothing is being copied.'],
    ['password_invalid', 'The NAS password file is not usable, so nothing is being copied.'],
  ] as const)('not working: %s', (reason, text) => {
    const configured = reason.endsWith('missing') ? 'partial' : 'invalid';
    expect(
      nasCopyProblem({
        ...appStatusPopulated,
        nasCopy: {
          configured,
          configReason: reason,
          blocked: false,
          stale: false,
          lastSuccessAt: null,
        },
      }),
    ).toEqual({ title: 'NAS copy not working', text });
  });

  it('blocked: the refusal lock sentence', () => {
    expect(nasCopyProblem(appStatusNasCopy.blocked)).toEqual({
      title: 'NAS copy not working',
      text: NAS_BLOCKED_TEXT,
    });
    expect(NAS_BLOCKED_TEXT).toBe(
      "The NAS refused the last copy's password or module, so nothing is copied until the NAS files are placed again.",
    );
  });

  it('not working is named before overdue', () => {
    const both: AppStatus = {
      ...appStatusPopulated,
      nasCopy: { ...appStatusNasCopy.blocked.nasCopy, stale: true },
    };
    expect(nasCopyProblem(both)?.title).toBe('NAS copy not working');
  });
});

describe('the callout on the pages (§8.4)', () => {
  it.each([
    ['stale', '/history', 'History', 'NAS copy overdue', 'since 15/09/2030'],
    ['stale', '/settings', 'Settings', 'NAS copy overdue', 'since 15/09/2030'],
    ['partial', '/history', 'History', 'NAS copy not working', 'half set up'],
    ['partial', '/settings', 'Settings', 'NAS copy not working', 'half set up'],
    ['invalidPassword', '/history', 'History', 'NAS copy not working', 'file is not usable'],
    ['blocked', '/', 'Net worth', 'NAS copy not working', 'refused'],
    ['blocked', '/settings', 'Settings', 'NAS copy not working', 'refused'],
  ] as const)('%s on %s', async (state, path, title, name, text) => {
    const status = appStatusNasCopy[state];
    process.env.TZ = 'UTC';
    withStatus(status);
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: title });
    const callout = await screen.findByRole('note', { name });
    expect(callout).toHaveClass('jf-callout--important');
    expect(callout).toHaveTextContent(text);
    expect(within(callout).getByRole('link', { name: 'Open NAS copy' })).toHaveAttribute(
      'href',
      '/settings#nas-copy',
    );
    expect(screen.getByRole('main').contains(callout)).toBe(true);
  });

  it('not shown while the copy is fine, or on a status without the block', async () => {
    withStatus(appStatusNasCopy.ok);
    const view = renderApp('/history');
    await screen.findByRole('heading', { level: 1, name: 'History' });
    await waitFor(() => expect(screen.getByRole('banner')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Open NAS copy' })).toBeNull();
    view.unmount();
    withStatus(appStatusPopulated);
    renderApp('/history');
    await screen.findByRole('heading', { level: 1, name: 'History' });
    expect(screen.queryByRole('link', { name: 'Open NAS copy' })).toBeNull();
  });

  it('sits under the backup callout when both show', async () => {
    withStatus({ ...appStatusBackups.stale, nasCopy: appStatusNasCopy.stale.nasCopy });
    renderApp('/history');
    const nas = await screen.findByRole('note', { name: 'NAS copy overdue' });
    const backup = screen.getByRole('note', { name: 'Backup overdue' });
    expect(backup.compareDocumentPosition(nas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the link lands on the NAS copy subheading', async () => {
    withStatus(appStatusNasCopy.blocked);
    const { user, router } = renderApp('/history');
    const callout = await screen.findByRole('note', { name: 'NAS copy not working' });
    await user.click(within(callout).getByRole('link', { name: 'Open NAS copy' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.location.hash).toBe('nas-copy');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3, name: 'Copy to the NAS' })).toHaveFocus(),
    );
  });

  it('the fixture a stale page is built on is the ready, succeeded one', () => {
    expect(backupsPages.nasReady.nasCopy).toBe(nasCopyStates.succeeded);
  });
});
