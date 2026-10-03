// Settings → Phone (stage-9.md §8.2, §8.3) through the whole Settings page: every phoneSections
// state (the failures cancel and the pending removals included), the QR (crisp edges, a module-unit
// viewBox, an integer number of pixels per module), the address notes, the countdown and the expiry,
// pairing, cancelling, a new code, removing (with the focus after it), and the index and hash target.
import type { PhoneSectionResponse } from '@joinr/schema';
import { MOBILE_ERROR_MESSAGES, normaliseServerUrl, parsePairingUrl } from '@joinr/schema';
import { PHONE_FIXTURE_NOW, phoneSections } from '@joinr/schema/fixtures';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockOverview } from '../../../test/history';
import { emulatePhone } from '../../../test/media';
import { apiError, type MockHandler } from '../../../test/mockApi';
import { renderApp } from '../../../test/renderApp';
import {
  EXPIRED_TEXT,
  FAILURES_TEXT,
  NO_PHONE_TEXT,
  PENDING_REMOVALS_TEXT,
  PHONE_LEAD,
  QR_CAPTION,
  SET_ASIDE_TEXT,
  UNWRITABLE_TEXT,
  defaultAddress,
  limitText,
} from './phoneDisplay';
import { qrModel } from './qrModel';

const NOW = new Date(PHONE_FIXTURE_NOW);

beforeEach(() => {
  // Only the clock is fake (the fixtures' 2030 times); timers stay real so polls and user events run.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openPhone(
  phone: PhoneSectionResponse | MockHandler,
  routes: Record<string, MockHandler> = {},
  path = '/settings',
) {
  const api = mockOverview({ phone, routes });
  const view = renderApp(path);
  await screen.findByTestId('phone-pair');
  return { ...view, api };
}

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Phone' });
}

function pairButton(): HTMLElement {
  return within(section()).getByRole('button', { name: 'Pair a phone' });
}

describe('Settings → Phone: the states (§8.2)', () => {
  it.each(Object.entries(phoneSections))('renders %s', async (_name, fixture) => {
    await openPhone(fixture);
    expect(within(section()).getByRole('heading', { level: 2, name: 'Phone' })).toHaveAttribute(
      'id',
      'phone',
    );
    expect(section()).toHaveTextContent(PHONE_LEAD);
    // The page never shows a key (it never has one).
    expect(section()).not.toHaveTextContent(/jfk_/);
  });

  it('sits between Backups and About, and the index links it before About', async () => {
    await openPhone(phoneSections.none);
    const ids = [...document.querySelectorAll('h2[id]')].map((h) => h.id);
    expect(ids.slice(-3)).toEqual(['backups', 'phone', 'about']);
    const index = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(index)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(links.slice(-3)).toEqual(['#nas-copy', '#phone', '#about']);
  });

  it('/settings#phone focuses the Phone heading once loaded', async () => {
    await openPhone(phoneSections.onePhone, {}, '/settings#phone');
    await waitFor(() =>
      expect(within(section()).getByRole('heading', { level: 2, name: 'Phone' })).toHaveFocus(),
    );
  });

  it('none: "No phone is paired." and the Pair button', async () => {
    await openPhone(phoneSections.none);
    expect(within(section()).getByTestId('phone-none')).toHaveTextContent(NO_PHONE_TEXT);
    expect(pairButton()).toBeEnabled();
    expect(within(section()).queryByRole('table')).toBeNull();
  });

  it('two phones and two removed: the dense list, "Not yet", the Removed disclosure', async () => {
    await openPhone(phoneSections.twoPlusRemoved);
    const table = within(section()).getByRole('table', { name: 'Paired phones' });
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Test phone 3', '03/09/2030', 'Not yet', '—', 'Remove'],
      ['Android phone', '01/09/2030', '12/09/2030 15:10', '1.0.0', 'Remove'],
    ]);
    const removed = within(section()).getByTestId('phone-removed');
    expect(removed.tagName).toBe('DETAILS');
    expect(removed).not.toHaveAttribute('open');
    expect(within(removed).getByText('Removed (2)')).toBeInTheDocument();
    const removedRows = within(within(removed).getByRole('table', { name: 'Removed phones' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(removedRows).toEqual(['Test phone 210/09/2030', 'Test phone 408/09/2030']);
  });

  it('at the limit: Pair a phone is unavailable, with the reason', async () => {
    await openPhone(phoneSections.limit);
    expect(pairButton()).toBeDisabled();
    expect(pairButton()).toHaveAccessibleDescription(limitText(10));
  });

  it('a set-aside list: the important callout', async () => {
    await openPhone(phoneSections.storeSetAside);
    const note = within(section()).getByRole('note', { name: 'Phones need pairing again' });
    expect(note).toHaveClass('jf-callout--important');
    expect(note).toHaveTextContent(SET_ASIDE_TEXT);
  });

  it('an unwritable list with a pending removal: both sentences, and no pairing', async () => {
    await openPhone(phoneSections.storeUnwritable);
    const note = within(section()).getByRole('note', { name: 'Cannot save the list of phones' });
    expect(note).toHaveClass('jf-callout--important');
    expect(note).toHaveTextContent(UNWRITABLE_TEXT);
    expect(note).toHaveTextContent(PENDING_REMOVALS_TEXT);
    expect(pairButton()).toBeDisabled();
  });

  it('cancelled after 5 wrong attempts: the important callout, not an expiry', async () => {
    await openPhone(phoneSections.cancelledByFailures);
    const note = within(section()).getByRole('note', { name: 'Code cancelled' });
    expect(note).toHaveClass('jf-callout--important');
    expect(note).toHaveTextContent(FAILURES_TEXT);
    expect(section()).not.toHaveTextContent(EXPIRED_TEXT);
  });

  it('just paired: the "Paired:" note', async () => {
    await openPhone(phoneSections.justPaired);
    const note = within(section()).getByRole('note', { name: 'Paired' });
    expect(note).toHaveClass('jf-callout--note');
    expect(note).toHaveTextContent('Paired: Android phone.');
  });

  it('a removed last pairing: no "Paired:" note', async () => {
    const { justPaired } = phoneSections;
    const gone = { ...justPaired.devices[0]!, revokedAt: '2030-09-12T05:19:00.000Z' };
    await openPhone({ ...justPaired, devices: [], removed: [gone] });
    expect(within(section()).queryByRole('note', { name: 'Paired' })).toBeNull();
    expect(section()).not.toHaveTextContent('Paired: Android phone.');
    expect(within(section()).getByTestId('phone-none')).toHaveTextContent(NO_PHONE_TEXT);
  });

  it('on a phone: the version under the name, Remove as an icon button (no App column)', async () => {
    emulatePhone();
    await openPhone(phoneSections.twoPlusRemoved);
    const table = within(within(section()).getByTestId('phone-paired')).getAllByRole('table')[0]!;
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Phone', 'Paired', 'Last used', 'Remove']);
    const buttons = within(table).getAllByRole('button', { name: /^Remove / });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b).toHaveClass('jf-button--icon');
      expect(b).toHaveAttribute('title', b.getAttribute('aria-label'));
      expect(b.textContent).toBe('');
    }
    expect(table.querySelectorAll('.jf-app-phone-label__app')).toHaveLength(2);
  });
});

describe('Settings → Phone: an open code (§8.2)', () => {
  it('the QR: one path on a white tile, crisp edges, module units, 4 px per module', async () => {
    await openPhone(phoneSections.pairingOpen);
    const qr = within(section()).getByRole('img', { name: 'QR code for pairing a phone' });
    const address = defaultAddress(window.location.origin);
    const model = qrModel(`joinrfinance://pair?v=1&u=${encodeURIComponent(address)}&c=ABCDE12345`);
    expect(qr).toHaveAttribute('viewBox', `0 0 ${model.size} ${model.size}`);
    expect(qr).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(qr).toHaveAttribute('width', String(model.size * 4));
    expect(qr).toHaveAttribute('height', String(model.size * 4));
    expect(Number(qr.getAttribute('width')) % model.size).toBe(0);
    expect(qr.querySelectorAll('path')).toHaveLength(1);
    expect(qr.querySelector('path')).toHaveAttribute('d', model.path);
    expect(qr.querySelector('rect')).toHaveClass('jf-app-phone-qr__tile');
    // The payload decodes back through the frozen rule (the QR is drawn from it).
    expect(
      parsePairingUrl(`joinrfinance://pair?v=1&u=${encodeURIComponent(address)}&c=ABCDE12345`),
    ).toEqual({
      serverUrl: address,
      code: 'ABCDE12345',
    });
    // Never a link, never markup from the library.
    expect(section().querySelector('a[href^="joinrfinance:"]')).toBeNull();
    expect(section()).toHaveTextContent(QR_CAPTION);
  });

  it('on a phone: 3 px per module', async () => {
    emulatePhone();
    await openPhone(phoneSections.pairingOpen);
    const qr = within(section()).getByRole('img', { name: 'QR code for pairing a phone' });
    const size = Number(qr.getAttribute('viewBox')?.split(' ')[2]);
    expect(qr).toHaveAttribute('width', String(size * 3));
  });

  it('the code as text, the countdown, and the address prefilled from this page', async () => {
    await openPhone(phoneSections.pairingOpen);
    expect(within(section()).getByTestId('phone-code')).toHaveTextContent('ABCDE-12345');
    expect(within(section()).getByTestId('phone-countdown')).toHaveTextContent('Valid for 4:32');
    expect(
      within(section()).getByRole('textbox', { name: 'Address the phone will use' }),
    ).toHaveValue(defaultAddress(window.location.origin));
    // The test page is on localhost: the loopback warning.
    expect(within(section()).getByRole('note', { name: 'Use the Tailscale name' })).toHaveClass(
      'jf-callout--important',
    );
  });

  it('the countdown ticks, and at 0:00 the code is shown as expired', async () => {
    const { api } = await openPhone(phoneSections.pairingOpen);
    vi.setSystemTime(NOW.getTime() + 2_000);
    // The clock ticks once a second (a real interval), so allow a few seconds under load.
    await waitFor(
      () =>
        expect(within(section()).getByTestId('phone-countdown')).toHaveTextContent(
          'Valid for 4:30',
        ),
      { timeout: 4_000 },
    );
    const before = api.calls('GET /api/phone').length;
    vi.setSystemTime(NOW.getTime() + 273_000);
    expect(
      await within(section()).findByTestId('phone-expired', {}, { timeout: 4_000 }),
    ).toHaveTextContent(EXPIRED_TEXT);
    expect(within(section()).queryByTestId('phone-pairing')).toBeNull();
    // The page asks the server at once.
    await waitFor(() => expect(api.calls('GET /api/phone').length).toBeGreaterThan(before));
  });

  it('the address: a .ts.net name is plain; a short name warns; a bad one is a field error', async () => {
    const { user } = await openPhone(phoneSections.pairingOpen);
    const field = within(section()).getByRole('textbox', { name: 'Address the phone will use' });
    const before = section().querySelector('path')?.getAttribute('d');

    await user.clear(field);
    await user.type(field, 'http://umbrel.example-tailnet.ts.net:4932');
    expect(within(section()).getByTestId('phone-address-note')).toHaveTextContent(
      'The phone reaches this over Tailscale.',
    );
    expect(within(section()).queryByRole('note', { name: 'Use the Tailscale name' })).toBeNull();
    // The QR follows the address.
    expect(section().querySelector('path')?.getAttribute('d')).not.toBe(before);
    expect(section().querySelector('path')).toHaveAttribute(
      'd',
      qrModel(
        `joinrfinance://pair?v=1&u=${encodeURIComponent('http://umbrel.example-tailnet.ts.net:4932')}&c=ABCDE12345`,
      ).path,
    );

    await user.clear(field);
    await user.type(field, 'http://umbrel:4932');
    expect(
      within(section()).getByRole('note', { name: 'Use the Tailscale name' }),
    ).toHaveTextContent("Use the Umbrel's full Tailscale name, ending in .ts.net.");

    await user.clear(field);
    await user.type(field, 'http://umbrel:4932/path');
    expect(normaliseServerUrl('http://umbrel:4932/path').ok).toBe(false);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/no path/);
    expect(
      within(section()).queryByRole('img', { name: 'QR code for pairing a phone' }),
    ).toBeNull();
    expect(within(section()).getByTestId('phone-qr-missing')).toBeInTheDocument();
  });
});

describe('Settings → Phone: pairing, cancelling, removing', () => {
  it('Pair a phone opens a code (POST, no body); the poll then shows "Paired:"', async () => {
    let gets = 0;
    let opened = false;
    const { user, api } = await openPhone(
      () => {
        gets += 1;
        if (!opened) return { body: phoneSections.none };
        // The first read after opening still sees the code; the poll then sees the phone paired.
        return { body: gets <= 2 ? phoneSections.pairingOpen : phoneSections.justPaired };
      },
      {
        'POST /api/phone/pairing': () => {
          opened = true;
          gets = 1;
          return { status: 201, body: phoneSections.pairingOpen };
        },
      },
    );
    await user.click(pairButton());
    expect(await within(section()).findByTestId('phone-pairing')).toHaveFocus();
    const posts = api.calls('POST /api/phone/pairing');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toBeUndefined();
    // Polled every 2 s while the code is open.
    const note = await within(section()).findByRole('note', { name: 'Paired' }, { timeout: 6_000 });
    expect(note).toHaveTextContent('Paired: Android phone.');
    expect(within(section()).queryByTestId('phone-pairing')).toBeNull();
  });

  it('Cancel closes the code (DELETE) and gives the focus back to Pair a phone', async () => {
    let open = true;
    const { user, api } = await openPhone(
      () => ({ body: open ? phoneSections.pairingOpen : phoneSections.none }),
      {
        'DELETE /api/phone/pairing': () => {
          open = false;
          return { body: phoneSections.none };
        },
      },
    );
    await user.click(within(section()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(pairButton()).toHaveFocus());
    expect(api.calls('DELETE /api/phone/pairing')).toHaveLength(1);
    expect(section()).not.toHaveTextContent(EXPIRED_TEXT);
  });

  it('New code replaces the open one', async () => {
    const replaced = {
      ...phoneSections.pairingOpen,
      pairing: {
        code: 'FGHJK67890',
        createdAt: PHONE_FIXTURE_NOW,
        expiresAt: '2030-09-12T05:25:00.000Z',
        failuresLeft: 5,
      },
    };
    let current: PhoneSectionResponse = phoneSections.pairingOpen;
    const { user } = await openPhone(() => ({ body: current }), {
      'POST /api/phone/pairing': () => {
        current = replaced;
        return { status: 201, body: replaced };
      },
    });
    await user.click(within(section()).getByRole('button', { name: 'New code' }));
    await waitFor(() =>
      expect(within(section()).getByTestId('phone-code')).toHaveTextContent('FGHJK-67890'),
    );
    expect(within(section()).getByTestId('phone-countdown')).toHaveTextContent('Valid for 5:00');
  });

  it('a code opened minutes after the page loaded counts from 5:00, never more', async () => {
    const later = NOW.getTime() + 3 * 60_000;
    const opened: PhoneSectionResponse = {
      ...phoneSections.none,
      pairing: {
        code: 'ABCDE12345',
        createdAt: new Date(later).toISOString(),
        expiresAt: new Date(later + 5 * 60_000).toISOString(),
        failuresLeft: 5,
      },
    };
    let current: PhoneSectionResponse = phoneSections.none;
    const { user } = await openPhone(() => ({ body: current }), {
      'POST /api/phone/pairing': () => {
        current = opened;
        return { status: 201, body: opened };
      },
    });
    vi.setSystemTime(later);
    await user.click(pairButton());
    // Well before the first one-second tick: the clock is read as the countdown starts.
    await waitFor(
      () =>
        expect(within(section()).getByTestId('phone-countdown')).toHaveTextContent(
          'Valid for 5:00',
        ),
      { timeout: 700 },
    );
  });

  it('a refused code (409): the server’s sentence in a callout', async () => {
    const { user } = await openPhone(phoneSections.none, {
      'POST /api/phone/pairing': apiError(409, {
        error: { code: 'PHONE_LIMIT_REACHED', message: MOBILE_ERROR_MESSAGES.PHONE_LIMIT_REACHED },
      }),
    });
    await user.click(pairButton());
    const note = await within(section()).findByRole('note', { name: 'No code' });
    expect(note).toHaveClass('jf-callout--do-not');
    expect(note).toHaveTextContent(MOBILE_ERROR_MESSAGES.PHONE_LIMIT_REACHED);
  });

  it('Remove asks first; Cancel keeps the phone and returns the focus to its button', async () => {
    const { user, api } = await openPhone(phoneSections.twoPlusRemoved);
    const remove = within(section()).getByRole('button', { name: 'Remove Test phone 3' });
    await user.click(remove);
    const confirm = within(section()).getByRole('group', {
      name: 'Remove Test phone 3? Its app and widgets stop at their next refresh. You can pair it again later.',
    });
    expect(
      within(confirm).getByRole('button', { name: 'Cancel: keep the phone Test phone 3' }),
    ).toHaveFocus();
    expect(remove).toHaveAttribute('aria-expanded', 'true');
    await user.click(
      within(confirm).getByRole('button', { name: 'Cancel: keep the phone Test phone 3' }),
    );
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: 'Remove Test phone 3' })).toHaveFocus(),
    );
    expect(api.calls('POST /api/phone/devices/d_0000000000000003/revoke')).toHaveLength(0);
  });

  it('Remove → confirm: the revoke call, the announcement, the focus on the list heading', async () => {
    let removed = false;
    const after: PhoneSectionResponse = {
      ...phoneSections.twoPlusRemoved,
      devices: phoneSections.twoPlusRemoved.devices.slice(1),
    };
    const { user, api } = await openPhone(
      () => ({ body: removed ? after : phoneSections.twoPlusRemoved }),
      {
        'POST /api/phone/devices/d_0000000000000003/revoke': () => {
          removed = true;
          return { body: after };
        },
      },
    );
    await user.click(within(section()).getByRole('button', { name: 'Remove Test phone 3' }));
    await user.click(
      within(section()).getByRole('button', { name: 'Remove the phone Test phone 3' }),
    );
    expect(await within(section()).findByTestId('phone-done')).toHaveTextContent(
      'Removed Test phone 3.',
    );
    await waitFor(() =>
      expect(
        within(section()).getByRole('heading', { level: 3, name: 'Paired phones' }),
      ).toHaveFocus(),
    );
    expect(api.calls('POST /api/phone/devices/d_0000000000000003/revoke')).toHaveLength(1);
    expect(within(section()).queryByRole('button', { name: 'Remove Test phone 3' })).toBeNull();
  });
});
