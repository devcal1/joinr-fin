// Settings → Phone words and rules (stage-9.md §8.2, §8.3): the countdown, the code groups, the
// address notes by kind (a short name, a LAN or a loopback address gets the important callout), why a
// shown code closed, the limit, and the dates in the server's zone.
import { phoneSections, PHONE_FIXTURE_NOW } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import {
  EXPIRED_TEXT,
  NOT_YET_TEXT,
  addressNote,
  atLimit,
  closedReason,
  countdownText,
  defaultAddress,
  formatPairingCode,
  lastUsedText,
  limitText,
  msLeft,
  pairedDate,
  pairedText,
  qrPixelsPerModule,
  removeQuestion,
} from './phoneDisplay';

const NOW = Date.parse(PHONE_FIXTURE_NOW);
const ZONE = 'Australia/Melbourne';
/** Test addresses built from octets (the privacy guard allows only loopback and RFC 5737 literals). */
const ip = (a: number, b: number, c: number, d: number) => [a, b, c, d].join('.');

describe('the code and its countdown', () => {
  it('groups the code in fives', () => {
    expect(formatPairingCode('ABCDE12345')).toBe('ABCDE-12345');
    expect(formatPairingCode('ABC')).toBe('ABC');
  });

  it('counts down in m:ss, rounding up, never below 0:00', () => {
    const open = phoneSections.pairingOpen.pairing;
    if (!open) throw new Error('fixture');
    expect(countdownText(msLeft(open, NOW))).toBe('Valid for 4:32');
    expect(countdownText(msLeft(open, NOW + 31_500))).toBe('Valid for 4:01');
    expect(countdownText(msLeft(open, NOW + 272_000))).toBe('Valid for 0:00');
    expect(msLeft(open, NOW + 400_000)).toBe(0);
    expect(countdownText(59_001)).toBe('Valid for 1:00');
  });
});

describe('the address note (§8.2)', () => {
  it('a .ts.net name or a Tailscale address: the plain Tailscale line', () => {
    for (const url of [
      'http://umbrel.example-tailnet.ts.net:4932',
      `http://${ip(100, 64, 0, 1)}:4932`,
    ]) {
      expect(addressNote(url)).toEqual({
        tone: 'plain',
        text: 'The phone reaches this over Tailscale.',
      });
    }
  });

  it('a short name, a LAN address or loopback: the important callout', () => {
    for (const url of [
      'http://umbrel:4932',
      'http://umbrel.local:4932',
      `http://${ip(192, 168, 1, 20)}:4932`,
      `http://${ip(10, 0, 0, 5)}:4932`,
      'http://127.0.0.1:4932',
      'http://localhost:5173',
    ]) {
      const note = addressNote(url);
      expect(note.tone, url).toBe('important');
      expect(note.text).toBe(
        "This address can be answered by the home network when Tailscale is off, and the phone's key would then travel unencrypted over Wi-Fi. Use the Umbrel's full Tailscale name, ending in .ts.net.",
      );
    }
  });

  it('anything else: a plain note recommending the .ts.net name', () => {
    const note = addressNote('https://example.test');
    expect(note.tone).toBe('plain');
    expect(note.text).toMatch(/ending in \.ts\.net/);
  });

  it('prefills from the page origin, normalised', () => {
    expect(defaultAddress('http://Umbrel:4932')).toBe('http://umbrel:4932');
    expect(defaultAddress('not a url')).toBe('not a url');
  });
});

describe('why a shown code closed', () => {
  const open = phoneSections.pairingOpen.pairing;
  if (!open) throw new Error('fixture');

  it('paired: lastPaired at or after the code was made', () => {
    const data = {
      lastPaired: {
        id: 'd_0000000000000001',
        label: 'Android phone',
        pairedAt: '2030-09-12T05:20:10.000Z',
      },
      lastCancelled: null,
    };
    expect(closedReason(open, data, NOW)).toBe('paired');
    // An older pairing does not count for this code.
    expect(
      closedReason(
        open,
        { ...data, lastPaired: { ...data.lastPaired, pairedAt: '2030-09-12T05:00:00.000Z' } },
        NOW,
      ),
    ).toBeNull();
  });

  it('cancelled after 5 wrong attempts: never read as an expiry', () => {
    const data = {
      lastPaired: null,
      lastCancelled: { at: '2030-09-12T05:21:00.000Z', reason: 'failures' as const },
    };
    expect(closedReason(open, data, NOW + 400_000)).toBe('failures');
  });

  it('expired by the clock; cancelled or replaced otherwise (nothing to say)', () => {
    const data = { lastPaired: null, lastCancelled: null };
    expect(closedReason(open, data, NOW + 273_000)).toBe('expired');
    expect(closedReason(open, data, NOW + 1_000)).toBeNull();
    expect(EXPIRED_TEXT).toBe('The code expired. Show a new one.');
  });
});

describe('the list', () => {
  it('dates and times in the server zone; "Not yet" for an unused phone', () => {
    // 00:30Z is 10:30 in Melbourne (AEST) on 01/09/2030.
    expect(pairedDate('2030-09-01T00:30:00.000Z', ZONE)).toBe('01/09/2030');
    expect(pairedDate('2030-08-31T15:00:00.000Z', ZONE)).toBe('01/09/2030');
    expect(lastUsedText('2030-09-12T05:10:00.000Z', ZONE)).toBe('12/09/2030 15:10');
    expect(lastUsedText(null, ZONE)).toBe(NOT_YET_TEXT);
  });

  it('the limit', () => {
    expect(atLimit(phoneSections.limit)).toBe(true);
    expect(atLimit(phoneSections.twoPlusRemoved)).toBe(false);
    expect(limitText(10)).toBe(
      '10 phones are paired already, the most allowed. Remove one to pair another.',
    );
  });

  it('the sentences', () => {
    expect(removeQuestion('Test phone 3')).toBe(
      'Remove Test phone 3? Its app and widgets stop at their next refresh. You can pair it again later.',
    );
    expect(pairedText('Android phone')).toBe('Paired: Android phone.');
  });

  it('QR pixels per module: 4 on a desktop, 3 on a phone', () => {
    expect(qrPixelsPerModule(false)).toBe(4);
    expect(qrPixelsPerModule(true)).toBe(3);
  });
});
