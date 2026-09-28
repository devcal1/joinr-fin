// The Settings "Copy to the NAS" block (stage-8.md §8.2, §8.3, §8.6; D132: no heartbeat) against the
// @joinr/schema fixtures: every `nasCopyStates` state renders (the Copy row for all four states and
// each configReason, blocked and schedule off; Next only when present; the §4.5 badges and texts;
// Last success), the button (enabled, unavailable with aria-disabled and still focusable, a click
// then sending nothing, busy, aria-describedby, one POST per click), the 202 started and joined
// texts, the finished texts driven by a second fixture and the fast path, the 409 callouts, the
// refetches on done, focus return, the index link and `#nas-copy`, the phone layout, the formats,
// and no address-like value in the DOM.
import { nasCopyFailureMessage, type BackupsResponse, type NasCopyStatusDto } from '@joinr/schema';
import {
  apiErrors,
  backupsPages,
  nasCopyNowResponses,
  nasCopyStates,
} from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockOverview } from '../../../test/history';
import { emulatePhone } from '../../../test/media';
import { apiError, pending, type MockHandler, type MockReply } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';

/** The typical backups page with a NAS state (the server version equal to this build's). */
function pageWith(nasCopy: NasCopyStatusDto): BackupsResponse {
  const base = backupsPages.typical;
  return { ...base, nasCopy, app: { ...base.app, version: __APP_VERSION__ } };
}

async function openNas(
  backups: BackupsResponse | MockHandler = pageWith(nasCopyStates.succeeded),
  routes: Record<string, MockHandler> = {},
  path = '/settings',
) {
  const api = mockOverview({ backups, routes });
  const view = renderApp(path);
  await screen.findByTestId('nas-copy-state');
  return { ...view, api };
}

/** The block (a group labelled by its subheading). */
function block(): HTMLElement {
  return screen.getByRole('group', { name: 'Copy to the NAS' });
}

function copyButton(name: RegExp | string = /^(Copy to NAS now|Copying…)$/): HTMLElement {
  return within(block()).getByRole('button', { name });
}

/** A `GET /api/backups` that answers `first` until `next()` switches it to the following page. */
function sequence(...pages: BackupsResponse[]): { handler: MockHandler; next: () => void } {
  let index = 0;
  return {
    handler: () => ({ body: pages[Math.min(index, pages.length - 1)] }),
    next: () => {
      index += 1;
    },
  };
}

/** A running page whose last run is the 202 body's row, then that row finished as `run`. */
function finishedAs(status: NasCopyStatusDto): NasCopyStatusDto {
  return {
    ...status,
    running: false,
    lastRun: { ...status.lastRun!, id: nasCopyNowResponses.started.nasCopy.lastRun.id },
  };
}

/**
 * The frozen url_invalid sentence (§4.4) names the address FORM, "an rsync://user@host/module
 * address": a placeholder, not a value. The guard removes that one phrase, then finds no
 * rsync:// and no @ anywhere.
 */
const FORM_PHRASE = 'an rsync://user@host/module address';

function addressFree(html: string): boolean {
  return !/rsync:\/\/|@/.test(html.split(FORM_PHRASE).join(''));
}

const savedTz = process.env.TZ;

afterEach(() => {
  vi.restoreAllMocks();
  process.env.TZ = savedTz;
});

describe('every state renders (§8.2 item 1)', () => {
  it.each(Object.entries(nasCopyStates))('%s', async (_name, status) => {
    await openNas(pageWith(status));
    const heading = within(block()).getByRole('heading', { level: 3, name: 'Copy to the NAS' });
    expect(heading).toHaveAttribute('id', 'nas-copy');
    expect(within(block()).getByRole('table', { name: 'NAS copy status' })).toBeVisible();
    expect(copyButton()).toBeVisible();
    expect(within(block()).getByTestId('nas-copy-note')).toHaveTextContent(
      'Adds only: nothing on the NAS is ever deleted or changed. The NAS address and password are never shown here.',
    );
    // §8 formats: no raw ISO dates.
    expect(block()).not.toHaveTextContent(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(block()).not.toHaveTextContent(/T\d{2}:\d{2}:\d{2}/);
    // Nothing that looks like an address, an account or a module (§8.2 item 6).
    expect(addressFree(block().innerHTML)).toBe(true);
    expect(within(block()).queryByRole('textbox')).toBeNull();
  });

  it.each([
    ['succeeded', 'Weekly, Sunday at 03:00 (Australia/Melbourne)'],
    [
      'scheduleOff',
      'Weekly copy off (turned off in the server settings); Copy to NAS now still works',
    ],
    [
      'off',
      'Not set up: the NAS files are not on the server. Place them with the NAS set-up helper (see the runbook).',
    ],
    ['partialUrl', 'Half set up: nas-url is missing. Nothing is copied.'],
    ['partialPassword', 'Half set up: nas-password is missing. Nothing is copied.'],
    ['invalidUrl', 'The NAS address in nas-url is not usable. Nothing is copied.'],
    ['invalidPassword', 'The password file nas-password is not usable. Nothing is copied.'],
    [
      'blocked',
      'Stopped: the NAS refused the password or module. Place the NAS files again with the NAS set-up helper first.',
    ],
  ] as const)('the Copy row: %s', async (name, text) => {
    await openNas(pageWith(nasCopyStates[name]));
    const row = screen.getByTestId('nas-copy-state');
    expect(row).toHaveTextContent(text);
    if (name === 'blocked') expect(row).toHaveClass('jf-app-backups-error');
    else expect(row).not.toHaveClass('jf-app-backups-error');
  });

  it('the Copy row never comes from the last run: invalidPassword shows an older success', async () => {
    await openNas(pageWith(nasCopyStates.invalidPassword));
    expect(screen.getByTestId('nas-copy-state')).toHaveTextContent(/nas-password is not usable/);
    expect(within(screen.getByTestId('nas-copy-last')).getByText('Succeeded')).toBeVisible();
  });

  it('Next only when present, in the server zone', async () => {
    process.env.TZ = 'UTC';
    const { unmount } = await openNas(pageWith(nasCopyStates.succeeded));
    expect(screen.getByTestId('nas-copy-next')).toHaveTextContent('22/09/2030 03:00');
    expect(within(block()).getByRole('table')).toHaveTextContent('Next');
    unmount();
    await openNas(pageWith(nasCopyStates.blocked));
    expect(screen.queryByTestId('nas-copy-next')).toBeNull();
    expect(within(block()).getByRole('table')).not.toHaveTextContent('Next');
  });

  it('succeeded: the go badge and the counts with the NAS count', async () => {
    process.env.TZ = 'America/New_York';
    await openNas(pageWith(nasCopyStates.succeeded));
    const last = screen.getByTestId('nas-copy-last');
    expect(within(last).getByText('Succeeded').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'go',
    );
    expect(last).toHaveTextContent(
      '15/09/2030 03:00Succeeded5 sent · 22 already there · proved on the NAS · 27 on the NAS',
    );
    expect(screen.queryByTestId('nas-copy-last-success')).toBeNull();
  });

  it('succeededNoOnNas: the removed-here count, no NAS count', async () => {
    await openNas(pageWith(nasCopyStates.succeededNoOnNas));
    expect(screen.getByTestId('nas-copy-last')).toHaveTextContent(
      '6 sent · 20 already there · proved on the NAS · 1 removed here first',
    );
    expect(screen.getByTestId('nas-copy-last')).not.toHaveTextContent(/\d+ on the NAS/);
  });

  it('running: the pending badge and the busy button', async () => {
    await openNas(pageWith(nasCopyStates.running));
    const last = screen.getByTestId('nas-copy-last');
    expect(within(last).getByText('Running').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'pending',
    );
    const button = copyButton('Copying…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('nas-copy-last-success')).toHaveTextContent('15/09/2030 03:00');
  });

  it.each([
    'failedUnreachable',
    'notVerified',
    'blocked',
    'stale',
    'stopped',
    'partialPassword',
  ] as const)('%s: the failed badge and the sentence in the stop tint', async (name) => {
    const status = nasCopyStates[name];
    await openNas(pageWith(status));
    const last = screen.getByTestId('nas-copy-last');
    expect(within(last).getByText('Failed').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'failed',
    );
    expect(within(last).getByText(status.lastRun.error!)).toHaveClass('jf-app-backups-error');
  });

  it('Last success: the time after a failure, or Never', async () => {
    const { unmount } = await openNas(pageWith(nasCopyStates.failedUnreachable));
    expect(screen.getByTestId('nas-copy-last-success')).toHaveTextContent('08/09/2030 03:00');
    unmount();
    await openNas(pageWith(nasCopyStates.partialPassword));
    expect(screen.getByTestId('nas-copy-last-success')).toHaveTextContent('Never');
  });

  it('no copy yet', async () => {
    await openNas(pageWith(nasCopyStates.readyNever));
    expect(screen.getByTestId('nas-copy-last')).toHaveTextContent('No copy yet');
    expect(screen.getByTestId('nas-copy-next')).toHaveTextContent('15/09/2030 03:00');
  });

  it('the block sits after "Back up now" and before the backups table', async () => {
    await openNas();
    const backUp = screen.getByRole('button', { name: 'Back up now' });
    const nas = block();
    const table = screen.getByTestId('backups-table');
    expect(backUp.compareDocumentPosition(nas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nas.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('"Copy to NAS now" (§8.2 item 2)', () => {
  it.each([
    'off',
    'partialUrl',
    'partialPassword',
    'invalidUrl',
    'invalidPassword',
    'blocked',
  ] as const)(
    '%s: unavailable, focusable, described by the Copy row, and a click sends nothing',
    async (name) => {
      const { user, api } = await openNas(pageWith(nasCopyStates[name]), {
        'POST /api/backups/nas-copy': { status: 202, body: nasCopyNowResponses.started },
      });
      const button = copyButton('Copy to NAS now');
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('aria-describedby', 'nas-copy-state');
      expect(button).toHaveAccessibleDescription(screen.getByTestId('nas-copy-state').textContent);
      button.focus();
      expect(button).toHaveFocus();
      await user.click(button);
      await user.keyboard('{Enter}');
      expect(api.calls('POST /api/backups/nas-copy')).toHaveLength(0);
    },
  );

  it('blocked: described by the helper sentence', async () => {
    await openNas(pageWith(nasCopyStates.blocked));
    expect(copyButton('Copy to NAS now')).toHaveAccessibleDescription(
      /Place the NAS files again with the NAS set-up helper first\./,
    );
  });

  it.each(['succeeded', 'scheduleOff', 'readyNever', 'failedUnreachable'] as const)(
    '%s: available, no aria-disabled or description',
    async (name) => {
      await openNas(pageWith(nasCopyStates[name]));
      const button = copyButton('Copy to NAS now');
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(button).toHaveAttribute('aria-busy', 'false');
    },
  );

  it('pending: "Copying…", aria-busy and aria-disabled; one POST for two clicks, no body', async () => {
    const { user, api } = await openNas(pageWith(nasCopyStates.succeeded), {
      'POST /api/backups/nas-copy': pending,
    });
    await user.click(copyButton('Copy to NAS now'));
    const busy = await within(block()).findByRole('button', { name: 'Copying…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    const posts = api.calls('POST /api/backups/nas-copy');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBeUndefined();
  });

  it.each([
    ['started', nasCopyNowResponses.started, 'Copy started.'],
    ['joined', nasCopyNowResponses.joined, 'A copy was already running.'],
  ] as const)(
    '%s: the 202 text, then "Copied: …" when the followed copy ends',
    async (_n, body, text) => {
      const pages = sequence(
        pageWith(nasCopyStates.succeeded),
        pageWith(nasCopyStates.running),
        pageWith(finishedAs(nasCopyStates.succeeded)),
      );
      const { user, api } = await openNas(pages.handler, {
        'POST /api/backups/nas-copy': () => {
          pages.next();
          return { status: 202, body };
        },
      });
      await user.click(copyButton('Copy to NAS now'));
      const region = screen.getByRole('status', { name: 'NAS copy result' });
      await waitFor(() => expect(region).toHaveTextContent(text));
      await waitFor(() => expect(copyButton('Copying…')).toHaveAttribute('aria-busy', 'true'));
      const statusBefore = api.calls('GET /api/status').length;
      pages.next();
      // The 2 s poll (nasCopy.running) picks the finished row up.
      await waitFor(() => expect(region).toHaveTextContent('Copied: 5 sent, 22 already there.'), {
        timeout: 5_000,
      });
      expect(within(region).getByRole('note', { name: 'Copied to the NAS' })).toBeVisible();
      // On done, the header status refetches (the every-page callout updates at once).
      await waitFor(() =>
        expect(api.calls('GET /api/status').length).toBeGreaterThan(statusBefore),
      );
      expect(copyButton('Copy to NAS now')).toHaveAttribute('aria-busy', 'false');
      expect(api.calls('POST /api/backups/nas-copy')).toHaveLength(1);
    },
  );

  it('a failed copy: "Copy failed: <sentence>" announced, a short pointer to Last copy on screen', async () => {
    const pages = sequence(
      pageWith(nasCopyStates.succeeded),
      pageWith(nasCopyStates.running),
      pageWith(finishedAs(nasCopyStates.notVerified)),
    );
    const { user } = await openNas(pages.handler, {
      'POST /api/backups/nas-copy': () => {
        pages.next();
        return { status: 202, body: nasCopyNowResponses.started };
      },
    });
    await user.click(copyButton('Copy to NAS now'));
    const region = screen.getByRole('status', { name: 'NAS copy result' });
    await waitFor(() => expect(region).toHaveTextContent('Copy started.'));
    pages.next();
    const callout = await within(region).findByRole(
      'note',
      { name: 'Not copied' },
      { timeout: 5_000 },
    );
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(callout).toHaveTextContent(`Copy failed: ${nasCopyStates.notVerified.lastRun.error}`);
    // On screen the sentence shows once (in the Last copy row); the callout points at it.
    const shown = within(callout).getByText('Copy failed: see Last copy above.');
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    const announced = within(callout).getByText(
      `Copy failed: ${nasCopyStates.notVerified.lastRun.error}`,
    );
    expect(announced).toHaveClass('jf-visually-hidden');
    expect(screen.getByTestId('nas-copy-last')).toHaveTextContent(
      nasCopyStates.notVerified.lastRun.error ?? 'a sentence',
    );
  });

  it('the fast path: the first refetch after the 202 already shows the copy finished', async () => {
    const pages = sequence(
      pageWith(nasCopyStates.succeeded),
      pageWith(finishedAs(nasCopyStates.succeeded)),
    );
    const { user, api, queryClient } = await openNas(pages.handler, {
      'POST /api/backups/nas-copy': () => {
        pages.next();
        return { status: 202, body: nasCopyNowResponses.started };
      },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(copyButton('Copy to NAS now'));
    const region = screen.getByRole('status', { name: 'NAS copy result' });
    await waitFor(() => expect(region).toHaveTextContent('Copied: 5 sent, 22 already there.'));
    expect(copyButton('Copy to NAS now')).toHaveAttribute('aria-busy', 'false');
    // The mutation's settle and the done both refresh ['backups'] and ['status'].
    const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys.filter((key) => key === '["backups"]').length).toBeGreaterThanOrEqual(2);
    expect(keys.filter((key) => key === '["status"]').length).toBeGreaterThanOrEqual(2);
    expect(api.calls('POST /api/backups/nas-copy')).toHaveLength(1);
  });

  it.each([
    ['NAS_COPY_NOT_READY', apiErrors.nasCopyNotReady],
    ['NAS_COPY_FIX_FIRST', apiErrors.nasCopyFixFirst],
  ] as const)('409 %s: the server’s message in a do-not callout', async (_code, error) => {
    const { user, api } = await openNas(pageWith(nasCopyStates.succeeded), {
      'POST /api/backups/nas-copy': apiError(409, error),
    });
    const statusBefore = api.calls('GET /api/status').length;
    await user.click(copyButton('Copy to NAS now'));
    const callout = await within(block()).findByRole('note', { name: 'Not copied' });
    expect(callout).toHaveClass('jf-callout--do-not');
    expect(callout).toHaveTextContent(error.error.message);
    await waitFor(() => expect(api.calls('GET /api/status').length).toBe(statusBefore + 1));
    expect(copyButton('Copy to NAS now')).toHaveAttribute('aria-busy', 'false');
  });

  it('keeps the keyboard focus on the button through the copy, and gives it back if lost', async () => {
    let finish: (reply: MockReply) => void = () => undefined;
    const pages = sequence(
      pageWith(nasCopyStates.succeeded),
      pageWith(finishedAs(nasCopyStates.succeeded)),
    );
    const { user } = await openNas(pages.handler, {
      'POST /api/backups/nas-copy': () =>
        new Promise<MockReply>((resolve) => {
          finish = resolve;
        }),
    });
    const button = copyButton('Copy to NAS now');
    button.focus();
    await user.keyboard('{Enter}');
    await within(block()).findByRole('button', { name: 'Copying…' });
    // aria-disabled keeps the focus in a browser; were it moved to <body>, it comes back.
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    pages.next();
    finish({ status: 202, body: nasCopyNowResponses.started });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'NAS copy result' })).toHaveTextContent(
        'Copied: 5 sent, 22 already there.',
      ),
    );
    await waitFor(() => expect(copyButton('Copy to NAS now')).toHaveFocus());
  });
});

describe('the index, the hash and the phone (§8.2 item 5, §8.3)', () => {
  it('/settings#nas-copy focuses the subheading once both queries settle', async () => {
    await openNas(pageWith(nasCopyStates.succeeded), {}, '/settings#nas-copy');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 3, name: 'Copy to the NAS' })).toHaveFocus(),
    );
  });

  it('the index link points at #nas-copy', async () => {
    await openNas();
    const index = screen.getByRole('navigation', { name: 'On this page' });
    expect(within(index).getByRole('link', { name: 'NAS copy' })).toHaveAttribute(
      'href',
      '#nas-copy',
    );
  });

  it('a phone: the "Jump to" list names NAS copy; the block keeps its rows', async () => {
    emulatePhone();
    await openNas();
    const jump = screen.getByTestId('settings-jump');
    expect(within(jump).getByRole('link', { name: 'NAS copy', hidden: true })).toHaveAttribute(
      'href',
      '#nas-copy',
    );
    expect(within(block()).getByRole('table')).toHaveTextContent('Copy');
    expect(copyButton()).toBeVisible();
  });

  it('times in the server zone whatever the machine zone', async () => {
    process.env.TZ = 'Europe/London';
    await openNas(pageWith(nasCopyStates.failedUnreachable));
    expect(screen.getByTestId('nas-copy-next')).toHaveTextContent('15/09/2030 06:00');
    expect(screen.getByTestId('nas-copy-last')).toHaveTextContent('15/09/2030 04:00');
  });
});

describe('the uninstall text (§8.2 item 4)', () => {
  it('mentions the weekly NAS copy', async () => {
    await openNas(pageWith(nasCopyStates.off));
    const warning = screen.getByRole('note', { name: 'Stored on the server' });
    expect(warning).toHaveTextContent(
      "These backups are stored on the server, in this app's data folder. Uninstalling the app deletes them. Download the newest one before you uninstall, and keep a copy off the server: the weekly NAS copy does this once it is set up.",
    );
  });
});

describe('the poll switches on nasCopy.running (§8.1)', () => {
  it('polls while a copy runs, and not once it has ended', async () => {
    const pages = sequence(pageWith(nasCopyStates.running), pageWith(nasCopyStates.succeeded));
    const { api } = await openNas(pages.handler);
    await waitFor(() => expect(api.calls('GET /api/backups').length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
    pages.next();
    await waitFor(
      () => expect(screen.getByTestId('nas-copy-last')).toHaveTextContent('Succeeded'),
      {
        timeout: 5_000,
      },
    );
    const settled = api.calls('GET /api/backups').length;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(api.calls('GET /api/backups')).toHaveLength(settled);
  });
});

describe('no address-like value in the DOM (§8.2 item 6)', () => {
  it('the one form phrase is the frozen url_invalid sentence', () => {
    expect(nasCopyFailureMessage('url_invalid')).toContain(FORM_PHRASE);
    expect(addressFree('x rsync://planted-user@planted-host/m/')).toBe(false);
    expect(addressFree('planted-user@planted-host')).toBe(false);
    expect(addressFree(nasCopyFailureMessage('url_invalid'))).toBe(true);
  });

  it('across every state and the 202 bodies', async () => {
    for (const status of [
      ...Object.values(nasCopyStates),
      ...Object.values(nasCopyNowResponses).map((r) => r.nasCopy),
    ]) {
      const { unmount } = await openNas(pageWith(status));
      expect(addressFree(screen.getByRole('main').innerHTML)).toBe(true);
      unmount();
    }
  });
});
