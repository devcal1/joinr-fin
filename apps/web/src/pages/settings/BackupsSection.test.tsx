// The Settings Backups section (stage-7.md §6.2, §6.7) against the @joinr/schema fixtures: every
// fixture state (the schedule line, each badge of the §4.3 mapping with both Skipped reasons, the
// failure's category message, the off text keeping the time, the empty texts), the space and
// retention lines, the uninstall warning, the Monthly and Future pills, "Show all", the download
// links (encoding, `download`, the label), "Back up now" (pending, success, joined, 409, 500, one
// POST per click, the refreshes), the phone columns, the index links and hash targets, a failed
// settings query leaving Backups and About in place, the keyboard walk, times in the server's zone
// whatever the machine's zone, and no raw ISO dates on the page.
import type { BackupsResponse } from '@joinr/schema';
import { apiErrors, backupNowResponses, backupsPages, settingsPages } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockOverview } from '../../../test/history';
import { emulatePhone } from '../../../test/media';
import { apiError, pending, type MockHandler, type MockReply } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

/** A fixture with the server version equal to this build's, so no version note shows. */
function sameVersion(page: BackupsResponse): BackupsResponse {
  return { ...page, app: { ...page.app, version: __APP_VERSION__ } };
}

const STATES = Object.entries(backupsPages).filter(([name]) => name !== 'versionMismatch');

async function openBackups(
  backups: BackupsResponse | MockHandler = sameVersion(backupsPages.typical),
  routes: Record<string, MockHandler> = {},
  path = '/settings',
) {
  const api = mockOverview({ backups, routes });
  const view = renderApp(path);
  await screen.findByTestId('backups-schedule');
  return { ...view, api };
}

/** The Backups section (labelled by its section bar). */
function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Backups' });
}

function tableRows(): HTMLElement[] {
  const table = within(screen.getByTestId('backups-table')).getByRole('table');
  return within(table).getAllByRole('row').slice(1);
}

const savedTz = process.env.TZ;

afterEach(() => {
  vi.restoreAllMocks();
  process.env.TZ = savedTz;
});

describe('Backups: every fixture state (§6.2, §6.7)', () => {
  it.each(STATES)('renders %s', async (_name, fixture) => {
    await openBackups(sameVersion(fixture));
    const backups = section();
    expect(within(backups).getByRole('heading', { level: 2, name: 'Backups' })).toHaveAttribute(
      'id',
      'backups',
    );
    expect(screen.getByTestId('backups-schedule')).toHaveTextContent(
      /02:30 \(Australia\/Melbourne\)/,
    );
    expect(within(backups).getByRole('button', { name: /Back up now|Backing up…/ })).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(screen.getByRole('main')).not.toHaveTextContent(/T\d{2}:\d{2}:\d{2}/);
  });

  it('typical: the schedule, next, last run, space, retention and warning', async () => {
    await openBackups();
    expect(screen.getByTestId('backups-schedule')).toHaveTextContent(
      'Nightly at 02:30 (Australia/Melbourne)',
    );
    expect(screen.getByTestId('backups-next')).toHaveTextContent('16/09/2030 02:30');
    const lastRun = screen.getByTestId('backups-last-run');
    expect(lastRun).toHaveTextContent('15/09/2030 02:30');
    expect(within(lastRun).getByText('Succeeded').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'go',
    );
    expect(screen.getByTestId('backups-space')).toHaveTextContent(
      '110.0 MB in 27 backups · 120.0 GB free on the server',
    );
    expect(screen.getByTestId('backups-retention')).toHaveTextContent(
      'Keeps the newest nightly copy of each of the last 14 days it ran and of each of the last 12 months, plus the newest 10 by hand, 10 before an import, 5 before a restore and 5 before an update.',
    );
    const warning = within(section()).getByRole('note', { name: 'Stored on the server' });
    expect(warning).toHaveClass('jf-callout--important');
    expect(warning).toHaveTextContent(
      "These backups are stored on the server, in this app's data folder. Uninstalling the app deletes them. Download the newest one before you uninstall, and keep a copy off the server: the weekly NAS copy does this once it is set up.",
    );
    expect(within(warning).getByText('Uninstalling the app deletes them.').tagName).toBe('STRONG');
  });

  it('running: the Running badge, and the button busy', async () => {
    await openBackups(sameVersion(backupsPages.running));
    const lastRun = screen.getByTestId('backups-last-run');
    expect(within(lastRun).getByText('Running').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'pending',
    );
    const button = within(section()).getByRole('button', { name: 'Backing up…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('lastFailed: the Failed badge and the category message in the stop tint', async () => {
    await openBackups(sameVersion(backupsPages.lastFailed));
    const lastRun = screen.getByTestId('backups-last-run');
    expect(within(lastRun).getByText('Failed').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'failed',
    );
    expect(within(lastRun).getByText('Not enough free space on the server')).toHaveClass(
      'jf-app-backups-error',
    );
    expect(screen.getByTestId('backups-space')).toHaveTextContent(
      '46.1 MB in 11 backups · 6.0 MB free on the server',
    );
  });

  it.each([
    ['skippedEmpty', 'nothing to back up yet'],
    ['skippedImport', 'an import was running'],
  ] as const)('%s: Skipped with its reason', async (fixture, reason) => {
    await openBackups(sameVersion(backupsPages[fixture]));
    const lastRun = screen.getByTestId('backups-last-run');
    expect(within(lastRun).getByText('Skipped').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'pending',
    );
    expect(within(lastRun).getByText(reason)).toHaveClass('jf-app-muted');
  });

  it('skippedImport: Next is the retry 15 minutes on', async () => {
    await openBackups(sameVersion(backupsPages.skippedImport));
    expect(screen.getByTestId('backups-next')).toHaveTextContent('16/09/2030 02:45');
  });

  it('empty: no runs, the catch-up next, the empty table text', async () => {
    await openBackups(sameVersion(backupsPages.empty));
    expect(screen.getByTestId('backups-last-run')).toHaveTextContent('No backup has run yet');
    expect(screen.getByTestId('backups-next')).toHaveTextContent('15/09/2030 10:02');
    expect(
      within(section()).getByText('No backups yet. The first nightly backup runs at 02:30.'),
    ).toBeVisible();
    expect(within(section()).queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('scheduleOff: the off text keeps the time; no next run', async () => {
    await openBackups(sameVersion(backupsPages.scheduleOff));
    expect(screen.getByTestId('backups-schedule')).toHaveTextContent(
      'Off (turned off in the server settings); would run at 02:30 (Australia/Melbourne)',
    );
    expect(screen.getByTestId('backups-next')).toHaveTextContent('Not scheduled');
    expect(screen.getByRole('main')).not.toHaveTextContent('NIGHTLY_BACKUPS');
  });

  it('scheduleOff with no files: the off empty text', async () => {
    await openBackups(
      sameVersion({ ...backupsPages.scheduleOff, backups: [], totalBytes: 0, lastRun: null }),
    );
    expect(within(section()).getByText('No backups yet. Nightly backups are off.')).toBeVisible();
  });

  it('shows every time in the server zone whatever the machine zone', async () => {
    process.env.TZ = 'America/New_York';
    await openBackups();
    expect(screen.getByTestId('backups-next')).toHaveTextContent('16/09/2030 02:30');
    expect(within(tableRows()[0]!).getByRole('rowheader')).toHaveTextContent('15/09/2030 02:30');
  });
});

describe('Backups: the table (§6.2 items 5–7)', () => {
  it('shows the newest 12 rows, newest first, and "Show all" the rest', async () => {
    const { user } = await openBackups();
    expect(tableRows()).toHaveLength(12);
    expect(within(tableRows()[0]!).getByRole('rowheader')).toHaveTextContent('15/09/2030 02:30');
    const more = within(section()).getByRole('button', { name: 'Show all 27 backups' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', 'backups-table');
    await user.click(more);
    expect(tableRows()).toHaveLength(27);
    const less = within(section()).getByRole('button', { name: 'Show the newest 12' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(within(tableRows()[26]!).getByRole('rowheader')).toHaveTextContent('10/01/2030 09:30');
  });

  it('columns When, Kind, Size, Download; kind words; sizes', async () => {
    await openBackups();
    const table = within(screen.getByTestId('backups-table')).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['When', 'Kind', 'Size', 'Download']);
    const first = tableRows()[0]!;
    expect(first).toHaveTextContent('Nightly');
    expect(first).toHaveTextContent('4.2 MB');
    expect(within(tableRows()[5]!).getByText('By hand')).toBeVisible();
    // The file name is not a column.
    expect(table).not.toHaveTextContent('nightly-20300915');
  });

  it('the Monthly pill: not on the newest row; on an earlier month’s copy', async () => {
    const { user } = await openBackups();
    // The newest row is also September's newest (daily_and_monthly) in the current month of 2030.
    // The machine's current month is earlier than 2030, so the pill rule leaves it out as well.
    expect(within(tableRows()[0]!).queryByText('Monthly')).toBeNull();
    await user.click(within(section()).getByRole('button', { name: 'Show all 27 backups' }));
    const monthEnd = tableRows().find((row) => row.textContent?.includes('31/08/2030 02:30'))!;
    expect(within(monthEnd).getByText('Monthly')).toBeVisible();
    const daily = tableRows().find((row) => row.textContent?.includes('14/09/2030 02:30'))!;
    expect(within(daily).queryByText('Monthly')).toBeNull();
  });

  it('the Monthly pill on a daily-and-monthly copy of an earlier month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2030-10-02T00:00:00Z') });
    try {
      await openBackups(sameVersion(backupsPages.lastFailed));
      // 12/09/2030 is September's newest; on 02/10/2030 September is an earlier month.
      expect(within(tableRows()[0]!).getByText('Monthly')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a future-dated file shows a muted "Future date" pill', async () => {
    await openBackups(sameVersion(backupsPages.future));
    const first = tableRows()[0]!;
    expect(within(first).getByRole('rowheader')).toHaveTextContent('15/09/2031 02:30');
    expect(within(first).getByText('Future date')).toHaveClass('jf-pill--na');
    expect(within(first).queryByText('Monthly')).toBeNull();
  });

  it('download links: encoded href, download attribute, label and title', async () => {
    await openBackups();
    const link = within(tableRows()[0]!).getByRole('link', {
      name: 'Download the backup of 15/09/2030 02:30:00',
    });
    expect(link).toHaveAttribute('href', '/api/backups/nightly-20300915-023000%2B1000.db');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAttribute('title', 'nightly-20300915-023000+1000.db');
    expect(link).toHaveTextContent('Download');
    expect(link).toHaveClass('jf-button', 'jf-button--sm');
  });

  it('on a phone: When (with the size under it) · Kind · an icon-only download; no Size', async () => {
    emulatePhone();
    await openBackups();
    const table = within(screen.getByTestId('backups-table')).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['When', 'Kind', 'Download']);
    const first = tableRows()[0]!;
    expect(within(first).getByRole('rowheader')).toHaveTextContent('15/09/2030 02:30');
    expect(within(first).getByRole('rowheader')).toHaveTextContent('4.2 MB');
    const link = within(first).getByRole('link', {
      name: 'Download the backup of 15/09/2030 02:30:00',
    });
    expect(link).toHaveClass('jf-button--icon');
    expect(link.querySelector('.jf-button__label')).toBeNull();
  });
});

describe('Back up now (§6.2 item 4)', () => {
  it('pending: disabled, "Backing up…", aria-busy; one POST for two clicks', async () => {
    const { user, api } = await openBackups(sameVersion(backupsPages.typical), {
      'POST /api/backups': pending,
    });
    const button = within(section()).getByRole('button', { name: 'Back up now' });
    await user.click(button);
    const busy = await within(section()).findByRole('button', { name: 'Backing up…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(api.calls('POST /api/backups')).toHaveLength(1);
  });

  it('gives the keyboard focus back to the button when the backup finishes (Fixer A11Y-1)', async () => {
    let finish: (reply: MockReply) => void = () => undefined;
    const { user } = await openBackups(sameVersion(backupsPages.typical), {
      'POST /api/backups': () =>
        new Promise<MockReply>((resolve) => {
          finish = resolve;
        }),
    });
    const button = within(section()).getByRole('button', { name: 'Back up now' });
    button.focus();
    await user.keyboard('{Enter}');
    await within(section()).findByRole('button', { name: 'Backing up…' });
    // A browser moves the focus to <body> when the focused button becomes disabled (jsdom keeps it
    // on the disabled button, and will not blur it): put it on <body> as a browser does.
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    expect(document.activeElement).toBe(document.body);
    finish({ status: 201, body: backupNowResponses.created });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Backup result' })).toHaveTextContent(
        'Backup taken',
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(section()).getByRole('button', { name: 'Back up now' }),
      ),
    );
  });

  it('success: the result in the live region, and the list and status refetch', async () => {
    const { user, api } = await openBackups(sameVersion(backupsPages.typical), {
      'POST /api/backups': { status: 201, body: backupNowResponses.created },
    });
    const listsBefore = api.calls('GET /api/backups').length;
    const statusBefore = api.calls('GET /api/status').length;
    await user.click(within(section()).getByRole('button', { name: 'Back up now' }));
    const region = screen.getByRole('status', { name: 'Backup result' });
    await waitFor(() =>
      expect(region).toHaveTextContent('Backup taken: 15/09/2030 14:32, 4.2 MB.'),
    );
    expect(api.calls('POST /api/backups')).toHaveLength(1);
    await waitFor(() => expect(api.calls('GET /api/backups').length).toBe(listsBefore + 1));
    await waitFor(() => expect(api.calls('GET /api/status').length).toBe(statusBefore + 1));
    expect(within(section()).getByRole('button', { name: 'Back up now' })).toBeEnabled();
  });

  it('joined: says a backup was already running', async () => {
    const { user } = await openBackups(sameVersion(backupsPages.typical), {
      'POST /api/backups': { status: 201, body: backupNowResponses.joined },
    });
    await user.click(within(section()).getByRole('button', { name: 'Back up now' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Backup result' })).toHaveTextContent(
        'A backup was already running; it finished: 16/09/2030 02:30, 4.2 MB.',
      ),
    );
  });

  it.each([
    [
      '409 (an import running)',
      apiError(409, apiErrors.inProgress),
      'An import is already running',
    ],
    [
      '500 (the category message)',
      apiError(500, apiErrors.backupFailed),
      'Not enough free space on the server',
    ],
  ])('%s: an error callout, and the list and status still refetch', async (_n, reply, text) => {
    const { user, api } = await openBackups(sameVersion(backupsPages.typical), {
      'POST /api/backups': reply,
    });
    const listsBefore = api.calls('GET /api/backups').length;
    const statusBefore = api.calls('GET /api/status').length;
    await user.click(within(section()).getByRole('button', { name: 'Back up now' }));
    const callout = await within(section()).findByRole('note', { name: 'Not backed up' });
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(callout).toHaveTextContent(text);
    await waitFor(() => expect(api.calls('GET /api/backups').length).toBe(listsBefore + 1));
    await waitFor(() => expect(api.calls('GET /api/status').length).toBe(statusBefore + 1));
  });
});

describe('Backups and the rest of Settings (§6.2)', () => {
  it('the in-page index ends with Backups, NAS copy, Phone and About (stage-8.md §8.3, stage-9.md §8.2)', async () => {
    await openBackups();
    const index = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(index).getAllByRole('link');
    expect(links.at(-4)).toHaveTextContent('Backups');
    expect(links.at(-4)).toHaveAttribute('href', '#backups');
    expect(links.at(-3)).toHaveTextContent('NAS copy');
    expect(links.at(-3)).toHaveAttribute('href', '#nas-copy');
    expect(links.at(-2)).toHaveTextContent('Phone');
    expect(links.at(-2)).toHaveAttribute('href', '#phone');
    expect(links.at(-1)).toHaveTextContent('About');
    expect(links.at(-1)).toHaveAttribute('href', '#about');
  });

  it.each([
    ['/settings#backups', 'Backups'],
    ['/settings#about', 'About'],
  ])('%s focuses its heading once both queries settle', async (path, name) => {
    await openBackups(sameVersion(backupsPages.typical), {}, path);
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name })).toHaveFocus());
  });

  it('a settings failure still shows Backups and About', async () => {
    mockOverview({
      settings: apiError(500, {
        error: { code: 'INTERNAL', message: 'The server had a problem.' },
      }),
      backups: sameVersion(backupsPages.typical),
    });
    renderApp('/settings');
    expect(await screen.findByRole('note', { name: 'Could not load settings' })).toBeVisible();
    expect(await screen.findByTestId('backups-schedule')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Backups' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'About' })).toBeVisible();
  });

  it('a backups failure keeps the settings groups and the About version', async () => {
    mockOverview({
      settings: settingsPages.populated,
      backups: apiError(500, { error: { code: 'INTERNAL', message: 'The server had a problem.' } }),
    });
    renderApp('/settings');
    const callout = await screen.findByRole('note', { name: 'Could not load backups' });
    expect(callout).toHaveTextContent('The server had a problem.');
    expect(screen.getByRole('heading', { level: 2, name: 'Pay and tax' })).toBeVisible();
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByRole('table')).toHaveTextContent(`v${__APP_VERSION__}`);
  });

  it('a backups failure keeps the #nas-copy target: /settings#nas-copy focuses its subheading', async () => {
    mockOverview({
      settings: settingsPages.populated,
      backups: apiError(500, { error: { code: 'INTERNAL', message: 'The server had a problem.' } }),
    });
    renderApp('/settings#nas-copy');
    await screen.findByRole('note', { name: 'Could not load backups' });
    const heading = within(section()).getByRole('heading', { level: 3, name: 'Copy to the NAS' });
    expect(heading).toHaveAttribute('id', 'nas-copy');
    expect(within(section()).getByText('Shown once the backups have loaded.')).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Copy to NAS now' })).toBeNull();
  });

  it('loading: the section bar and its own skeleton', async () => {
    mockOverview({ backups: pending });
    renderApp('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Pay and tax' });
    expect(screen.getByRole('heading', { level: 2, name: 'Backups' })).toBeVisible();
    expect(within(section()).getByText('Loading backups…')).toBeInTheDocument();
    // The index's "NAS copy" link has its target while the list loads.
    expect(
      within(section()).getByRole('heading', { level: 3, name: 'Copy to the NAS' }),
    ).toHaveAttribute('id', 'nas-copy');
  });

  it('the keyboard reaches "Back up now", "Copy to NAS now", each download link and "Show all"', async () => {
    const { user } = await openBackups();
    const button = within(section()).getByRole('button', { name: 'Back up now' });
    button.focus();
    // The NAS button stays focusable while unavailable (aria-disabled, stage-8.md §8.2 item 2).
    await user.tab();
    expect(within(section()).getByRole('button', { name: 'Copy to NAS now' })).toHaveFocus();
    const links = within(screen.getByTestId('backups-table')).getAllByRole('link');
    expect(links).toHaveLength(12);
    for (const link of links) {
      await user.tab();
      expect(link).toHaveFocus();
    }
    await user.tab();
    expect(within(section()).getByRole('button', { name: 'Show all 27 backups' })).toHaveFocus();
  });
});
