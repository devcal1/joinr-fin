// Pairing (stage-9.md §6.2): the one-time code the owner opens in Settings → Phone and the
// exchange the phone makes with it. The code lives in memory only (a restart cancels it); only its
// digest is compared, in constant time. Every step of the exchange is synchronous, so the code is
// consumed before anything else can run and two requests with one code give exactly one 201.
import {
  DEVICE_LABEL_MAX,
  LAST_PAIRED_SHOWN_MS,
  MOBILE_API_VERSION,
  MOBILE_MAX_DEVICES,
  normalisePairingCode,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_FAILURES,
  PAIRING_RATE_MAX,
  PAIRING_RATE_WINDOW_MS,
  type MobilePairResponse,
  type PhoneSectionResponse,
} from '@joinr/schema';
import { z } from 'zod';
import { HttpError } from '../errors';
import { toDeviceDto, type DeviceStore } from './devices';
import {
  digestsEqual,
  generateDeviceId,
  generateDeviceKey,
  generatePairingCode,
  sha256Bytes,
  sha256Hex,
} from './keys';
import { SlidingWindowLimiter } from './limits';
import { DEFAULT_DEVICE_LABEL, MobileError, PAIR_BODY_MESSAGE } from './sentences';

/** `X-Joinr-App-Version` and the pair body's `appVersion`: ≤ 20 of `[0-9A-Za-z.+-]`. */
export const APP_VERSION_RE = /^[0-9A-Za-z.+-]{1,20}$/;

/** The pair body (FROZEN shape, §4.3): unknown fields are refused. */
export const pairRequestSchema = z.strictObject({
  code: z.string().max(40),
  deviceName: z.string().max(100).optional(),
  appVersion: z.string().max(20).optional(),
});

/**
 * The label (§6.2): Unicode Cc, Cf, Zl and Zp removed (control, bidi and zero-width format
 * characters, line and paragraph separators), whitespace collapsed, trimmed, cut to
 * `DEVICE_LABEL_MAX` characters; empty → "Android phone".
 */
export function cleanDeviceLabel(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_DEVICE_LABEL;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const cut = Array.from(cleaned).slice(0, DEVICE_LABEL_MAX).join('').trim();
  return cut === '' ? DEFAULT_DEVICE_LABEL : cut;
}

interface OpenCode {
  code: string;
  digest: Buffer;
  createdAt: Date;
  expiresAt: Date;
  failuresLeft: number;
}

export interface PairingOptions {
  store: DeviceStore;
  now: () => Date;
  serverVersion: string;
}

export class PairingService {
  private open: OpenCode | null = null;
  private lastCancelled: { at: Date; reason: 'failures' | 'replaced' } | null = null;
  private lastPaired: { id: string; label: string; pairedAt: string } | null = null;
  private readonly limiter = new SlidingWindowLimiter(PAIRING_RATE_MAX, PAIRING_RATE_WINDOW_MS);

  constructor(private readonly o: PairingOptions) {}

  /** The open code, after dropping an expired one. */
  private current(now: Date): OpenCode | null {
    if (this.open !== null && now.getTime() >= this.open.expiresAt.getTime()) this.open = null;
    return this.open;
  }

  /** `POST /api/phone/pairing`: a new code (any open code is replaced); 409 at the device limit. */
  openCode(): void {
    const now = this.o.now();
    if (this.o.store.isFull()) throw new MobileError('PHONE_LIMIT_REACHED');
    if (this.current(now) !== null) this.lastCancelled = { at: now, reason: 'replaced' };
    const code = generatePairingCode();
    this.open = {
      code,
      digest: sha256Bytes(code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
      failuresLeft: PAIRING_MAX_FAILURES,
    };
  }

  /** `DELETE /api/phone/pairing`: closes the open code (by the owner: not a `lastCancelled`). */
  cancel(): void {
    this.open = null;
  }

  /**
   * `POST /api/mobile/pair`, in the FROZEN order of §6.2. Returns the 201 body; throws a
   * `MobileError` (401/409/429/503) or a 400 `HttpError`. Synchronous throughout.
   */
  exchange(body: unknown): MobilePairResponse {
    const now = this.o.now();
    // 1. Nothing open (or expired): nothing to guess, so nothing is counted.
    const open = this.current(now);
    if (open === null) throw new MobileError('PAIRING_CODE_INVALID');
    // 2. The rate window, counted only while a code is open.
    const decision = this.limiter.hit(now.getTime());
    if (!decision.allowed)
      throw new MobileError('PAIRING_RATE_LIMITED', decision.retryAfterSeconds);
    // 3. The body.
    const parsed = pairRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, PAIR_BODY_MESSAGE, 'VALIDATION_ERROR');
    // 4. The code: a malformed one is a wrong one (401, never 400), and both count as a failure.
    const code = normalisePairingCode(parsed.data.code);
    const matches = code !== null && digestsEqual(sha256Bytes(code), open.digest);
    if (!matches) {
      open.failuresLeft -= 1;
      if (open.failuresLeft <= 0) {
        this.open = null;
        this.lastCancelled = { at: now, reason: 'failures' };
      }
      throw new MobileError('PAIRING_CODE_INVALID');
    }
    // 5. The device limit (the code stays open).
    if (this.o.store.isFull()) throw new MobileError('PHONE_LIMIT_REACHED');
    // 6. Consumed now, before anything else can run.
    this.open = null;
    const key = generateDeviceKey();
    const id = generateDeviceId();
    const label = cleanDeviceLabel(parsed.data.deviceName);
    const appVersion =
      parsed.data.appVersion !== undefined && APP_VERSION_RE.test(parsed.data.appVersion)
        ? parsed.data.appVersion
        : null;
    const pairedAt = now.toISOString();
    const added = this.o.store.add({ id, label, keyHash: sha256Hex(key), pairedAt, appVersion });
    if (!added.ok) {
      // Fails closed; the code is re-opened only while still inside its TTL.
      if (this.o.now().getTime() < open.expiresAt.getTime()) this.open = open;
      throw new MobileError('PHONE_STORE_FAILED');
    }
    this.lastPaired = { id, label, pairedAt };
    return {
      apiVersion: MOBILE_API_VERSION,
      serverVersion: this.o.serverVersion,
      deviceId: id,
      label,
      key,
    };
  }

  /** The Settings → Phone section (§4.3). */
  section(): PhoneSectionResponse {
    const now = this.o.now();
    const open = this.current(now);
    const recent = (iso: string | Date) =>
      now.getTime() - (typeof iso === 'string' ? Date.parse(iso) : iso.getTime()) <=
      LAST_PAIRED_SHOWN_MS;
    const store = this.o.store;
    return {
      apiVersion: MOBILE_API_VERSION,
      maxDevices: MOBILE_MAX_DEVICES,
      devices: store.active().map(toDeviceDto),
      removed: store.removed().map(toDeviceDto),
      pairing:
        open === null
          ? null
          : {
              code: open.code,
              createdAt: open.createdAt.toISOString(),
              expiresAt: open.expiresAt.toISOString(),
              failuresLeft: open.failuresLeft,
            },
      lastPaired:
        this.lastPaired !== null && recent(this.lastPaired.pairedAt)
          ? { ...this.lastPaired }
          : null,
      lastCancelled:
        this.lastCancelled !== null && recent(this.lastCancelled.at)
          ? { at: this.lastCancelled.at.toISOString(), reason: this.lastCancelled.reason }
          : null,
      storeProblem: store.storeProblem,
      pendingRemovals: store.pendingRemovals,
    };
  }
}
