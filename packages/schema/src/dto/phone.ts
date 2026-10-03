// Settings → Phone (stage-9.md §4.1, §4.3, FROZEN): `GET /api/phone`, `POST`/`DELETE
// /api/phone/pairing` and `POST /api/phone/devices/:id/revoke` all answer `PhoneSectionResponse`.
// Behind the Umbrel login; no key or key hash ever travels here (only the open pairing code).

export interface PhoneDeviceDto {
  id: string;
  label: string;
  pairedAt: string;
  lastUsedAt: string | null;
  appVersion: string | null;
  revokedAt: string | null;
}

export interface PhonePairingDto {
  code: string;
  createdAt: string;
  expiresAt: string;
  failuresLeft: number;
}

export interface PhoneSectionResponse {
  apiVersion: 1;
  maxDevices: number;
  /** Active, newest pairedAt first. */
  devices: PhoneDeviceDto[];
  /** Newest revokedAt first, ≤ MOBILE_KEEP_REMOVED. */
  removed: PhoneDeviceDto[];
  /** The open code, or null (none, used, expired, cancelled). */
  pairing: PhonePairingDto | null;
  /** Within LAST_PAIRED_SHOWN_MS. */
  lastPaired: { id: string; label: string; pairedAt: string } | null;
  /** The last code closed other than by use or expiry, within LAST_PAIRED_SHOWN_MS. */
  lastCancelled: { at: string; reason: 'failures' | 'replaced' } | null;
  storeProblem: 'set_aside' | 'unwritable' | null;
  /** Removals applied in memory but not yet saved (0 normally). */
  pendingRemovals: number;
}
