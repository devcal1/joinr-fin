// Settings → Phone (stage-9.md §8.2): the section's words and the pure rules behind them. Plain,
// specific sentences; nothing here suggests the page shows or stores a phone's key (it never sees
// one: only the open pairing code travels to this page).
import {
  normaliseServerUrl,
  serverAddressKind,
  type PhoneDeviceDto,
  type PhonePairingDto,
  type PhoneSectionResponse,
  type ServerAddressKind,
} from '@joinr/schema';
import { formatServerDateTime } from './backupsDisplay';

export const PHONE_SECTION_ID = 'phone';
export const PHONE_INDEX_LABEL = 'Phone';

export const PHONE_LEAD =
  "The Joinr Finance phone app shows today's change in your holdings. It can only read: it never changes anything here.";
export const NO_PHONE_TEXT = 'No phone is paired.';
export const NOT_YET_TEXT = 'Not yet';
export const PAIRED_PHONES_TITLE = 'Paired phones';
export const REMOVED_PHONES_TITLE = 'Removed';
export const PAIR_TITLE = 'Pair a phone';
export const PAIR_BUTTON = 'Pair a phone';
export const NEW_CODE_BUTTON = 'New code';
export const CANCEL_BUTTON = 'Cancel';
export const QR_ARIA_LABEL = 'QR code for pairing a phone';
export const QR_CAPTION = 'Scan this with the Joinr Finance app (Scan, in its pairing screen).';
export const ADDRESS_LABEL = 'Address the phone will use';
export const ADDRESS_ERROR =
  'Enter an address like http://name:4932: a name or address and a port, no path.';
export const CODE_LABEL = 'Code for pairing by hand';
export const EXPIRED_TEXT = 'The code expired. Show a new one.';
export const FAILURES_TITLE = 'Code cancelled';
export const FAILURES_TEXT = 'The code was cancelled after 5 wrong attempts from another device.';
export const SET_ASIDE_TITLE = 'Phones need pairing again';
export const SET_ASIDE_TEXT =
  'The list of paired phones could not be read and was set aside. Pair your phone again.';
export const UNWRITABLE_TITLE = 'Cannot save the list of phones';
export const UNWRITABLE_TEXT =
  'The list of paired phones cannot be saved on the server. Pairing is not possible until this is fixed (see the runbook).';
export const PENDING_REMOVALS_TEXT =
  'Removed phones are blocked now, but the removal is not saved yet: a restart of the app would bring them back.';
export const ADDRESS_WARNING_TITLE = 'Use the Tailscale name';

/** The Remove confirmation (§8.2). */
export function removeQuestion(label: string): string {
  return `Remove ${label}? Its app and widgets stop at their next refresh. You can pair it again later.`;
}

/** The live announcement after a removal. */
export function removedText(label: string): string {
  return `Removed ${label}.`;
}

/** The note after a pairing (prominent: an unexpected pairing must be noticed). */
export function pairedText(label: string): string {
  return `Paired: ${label}.`;
}

/** Why "Pair a phone" is unavailable at the limit. */
export function limitText(max: number): string {
  return `${max} phones are paired already, the most allowed. Remove one to pair another.`;
}

/** The code for pairing by hand, in two groups of five: `ABCDE-12345`. */
export function formatPairingCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Milliseconds left on an open code (never below 0). */
export function msLeft(pairing: Pick<PhonePairingDto, 'expiresAt'>, nowMs: number): number {
  const end = Date.parse(pairing.expiresAt);
  return Number.isNaN(end) ? 0 : Math.max(0, end - nowMs);
}

/** "Valid for 4:32" (whole seconds, rounded up, so 0:00 means expired). */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `Valid for ${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** dd/mm/yyyy in the server's zone (the browser's when the zone is not known yet). */
export function pairedDate(iso: string, timeZone: string | undefined): string {
  return formatServerDateTime(iso, timeZone ?? localZone()).slice(0, 10);
}

/** dd/mm/yyyy HH:mm in the server's zone, or "Not yet". */
export function lastUsedText(iso: string | null, timeZone: string | undefined): string {
  return iso ? formatServerDateTime(iso, timeZone ?? localZone()) : NOT_YET_TEXT;
}

/** The app version as reported by the phone, or a dash. */
export function appVersionText(device: Pick<PhoneDeviceDto, 'appVersion'>): string {
  return device.appVersion ?? '—';
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The address prefill: this page's own origin (the owner edits it to the .ts.net name). */
export function defaultAddress(origin: string): string {
  const n = normaliseServerUrl(origin);
  return n.ok ? n.url : origin;
}

export type AddressNote =
  { tone: 'plain'; text: string } | { tone: 'important'; title: string; text: string };

const ADDRESS_NOTES: Record<ServerAddressKind, AddressNote> = {
  tailscale: { tone: 'plain', text: 'The phone reaches this over Tailscale.' },
  short_name: {
    tone: 'important',
    title: ADDRESS_WARNING_TITLE,
    text: "This address can be answered by the home network when Tailscale is off, and the phone's key would then travel unencrypted over Wi-Fi. Use the Umbrel's full Tailscale name, ending in .ts.net.",
  },
  lan: {
    tone: 'important',
    title: ADDRESS_WARNING_TITLE,
    text: "This address can be answered by the home network when Tailscale is off, and the phone's key would then travel unencrypted over Wi-Fi. Use the Umbrel's full Tailscale name, ending in .ts.net.",
  },
  loopback: {
    tone: 'important',
    title: ADDRESS_WARNING_TITLE,
    text: "This address can be answered by the home network when Tailscale is off, and the phone's key would then travel unencrypted over Wi-Fi. Use the Umbrel's full Tailscale name, ending in .ts.net.",
  },
  other: {
    tone: 'plain',
    text: "Check that the phone can reach this address. The Umbrel's full Tailscale name, ending in .ts.net, keeps the phone's key inside Tailscale.",
  },
};

/** The note under the address (§8.2): only a Tailscale address keeps the key inside Tailscale. */
export function addressNote(url: string): AddressNote {
  return ADDRESS_NOTES[serverAddressKind(url)];
}

/** What the "Pair a phone" block shows after a code it displayed is no longer open. */
export type ClosedReason = 'paired' | 'failures' | 'expired' | null;

/**
 * Why the code this page showed (`shown`) closed, from the section the poll returned: paired
 * (`lastPaired` at or after the code's `createdAt`), cancelled by wrong attempts, expired (by the
 * clock), else null (cancelled here or replaced in another tab: nothing to say).
 */
export function closedReason(
  shown: Pick<PhonePairingDto, 'createdAt' | 'expiresAt'>,
  data: Pick<PhoneSectionResponse, 'lastPaired' | 'lastCancelled'>,
  nowMs: number,
): ClosedReason {
  const created = Date.parse(shown.createdAt);
  if (data.lastPaired && Date.parse(data.lastPaired.pairedAt) >= created) return 'paired';
  if (data.lastCancelled?.reason === 'failures' && Date.parse(data.lastCancelled.at) >= created)
    return 'failures';
  if (msLeft(shown, nowMs) === 0) return 'expired';
  return null;
}

/** True when no more phones may be paired. */
export function atLimit(data: Pick<PhoneSectionResponse, 'devices' | 'maxDevices'>): boolean {
  return data.devices.length >= data.maxDevices;
}

/** Pixels per QR module: 4 on a desktop, 3 on a phone (§8.2; integer, so no seams at 150 %). */
export function qrPixelsPerModule(phone: boolean): number {
  return phone ? 3 : 4;
}

/** The quiet zone around the QR, in modules (the standard four). */
export const QR_QUIET_MODULES = 4;
