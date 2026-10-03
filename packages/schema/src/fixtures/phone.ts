// Settings → Phone fixtures (stage-9.md §3.6, §4.3): every state the web section renders. Made-up
// labels (never a phone model), device ids `d_000000000000000N` and the code `ABCDE12345`. Times
// are written against PHONE_FIXTURE_NOW (Thursday 12/09/2030 15:20 Melbourne).
import { MOBILE_MAX_DEVICES } from '../mobile';
import type { PhoneDeviceDto, PhoneSectionResponse } from '../dto/phone';

export const PHONE_FIXTURE_NOW = '2030-09-12T05:20:00.000Z';

const deviceId = (n: number) => `d_${n.toString(16).padStart(16, '0')}`;

function device(n: number, over: Partial<PhoneDeviceDto> = {}): PhoneDeviceDto {
  return {
    id: deviceId(n),
    label: n === 1 ? 'Android phone' : `Test phone ${n}`,
    pairedAt: `2030-09-${String(n).padStart(2, '0')}T00:30:00.000Z`,
    lastUsedAt: '2030-09-12T05:10:00.000Z',
    appVersion: '1.0.0',
    revokedAt: null,
    ...over,
  };
}

function section(over: Partial<PhoneSectionResponse> = {}): PhoneSectionResponse {
  return {
    apiVersion: 1,
    maxDevices: MOBILE_MAX_DEVICES,
    devices: [],
    removed: [],
    pairing: null,
    lastPaired: null,
    lastCancelled: null,
    storeProblem: null,
    pendingRemovals: 0,
    ...over,
  };
}

const justPairedDevice = device(1, {
  pairedAt: '2030-09-12T05:18:00.000Z',
  lastUsedAt: '2030-09-12T05:18:05.000Z',
});

export const phoneSections = {
  none: section(),
  /** A code open with 4:32 left. */
  pairingOpen: section({
    pairing: {
      code: 'ABCDE12345',
      createdAt: '2030-09-12T05:19:32.000Z',
      expiresAt: '2030-09-12T05:24:32.000Z',
      failuresLeft: 5,
    },
  }),
  justPaired: section({
    devices: [justPairedDevice],
    lastPaired: {
      id: justPairedDevice.id,
      label: justPairedDevice.label,
      pairedAt: justPairedDevice.pairedAt,
    },
  }),
  cancelledByFailures: section({
    lastCancelled: { at: '2030-09-12T05:19:00.000Z', reason: 'failures' },
  }),
  onePhone: section({ devices: [device(1)] }),
  twoPlusRemoved: section({
    devices: [device(3, { appVersion: null, lastUsedAt: null }), device(1)],
    removed: [
      device(2, { revokedAt: '2030-09-10T02:00:00.000Z', lastUsedAt: '2030-09-09T23:00:00.000Z' }),
      device(4, { revokedAt: '2030-09-08T02:00:00.000Z' }),
    ],
  }),
  limit: section({
    devices: Array.from({ length: MOBILE_MAX_DEVICES }, (_, i) => device(MOBILE_MAX_DEVICES - i)),
  }),
  storeSetAside: section({ storeProblem: 'set_aside' }),
  storeUnwritable: section({
    devices: [device(1)],
    removed: [device(2, { revokedAt: '2030-09-12T05:15:00.000Z' })],
    storeProblem: 'unwritable',
    pendingRemovals: 1,
  }),
} satisfies Record<string, PhoneSectionResponse>;
