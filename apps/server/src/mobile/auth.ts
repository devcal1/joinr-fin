// The device-key check (stage-9.md §4.2, §6.3). The app sends both `Authorization: Bearer <key>`
// and `X-Joinr-Key: <key>`; `Authorization` is used when present, else `X-Joinr-Key`; two
// different values are refused. Unknown or malformed keys are counted (`BAD_KEY_RATE_MAX` per
// window → 429 for unknown keys only: a known key is never limited). The key itself is hashed at
// once and never logged, stored or echoed.
import { BAD_KEY_RATE_MAX, BAD_KEY_RATE_WINDOW_MS } from '@joinr/schema';
import type { IncomingHttpHeaders } from 'node:http';
import type { DeviceRecord, DeviceStore } from './devices';
import { isWellFormedKey, sha256Hex } from './keys';
import { SlidingWindowLimiter } from './limits';
import { APP_VERSION_RE } from './pairing';
import { MobileError } from './sentences';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type KeyFromHeaders =
  | { kind: 'missing' }
  /** Present but unusable (not a Bearer value, or the two headers disagree). */
  | { kind: 'bad' }
  | { kind: 'key'; key: string };

/** The key the request carries (§4.2). */
export function keyFromHeaders(headers: IncomingHttpHeaders): KeyFromHeaders {
  const authorization = single(headers.authorization);
  const joinrKey = single(headers['x-joinr-key']);
  let fromAuthorization: string | undefined;
  if (authorization !== undefined) {
    const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization);
    if (m === null) return { kind: 'bad' };
    fromAuthorization = m[1]!;
  }
  const fromHeader = joinrKey?.trim();
  if (fromAuthorization !== undefined && fromHeader !== undefined && fromHeader !== '') {
    if (fromAuthorization !== fromHeader) return { kind: 'bad' };
  }
  const key = fromAuthorization ?? (fromHeader === '' ? undefined : fromHeader);
  return key === undefined ? { kind: 'missing' } : { kind: 'key', key };
}

/** `X-Joinr-App-Version` when well formed (≤ 20 of `[0-9A-Za-z.+-]`), else null. */
export function appVersionFromHeaders(headers: IncomingHttpHeaders): string | null {
  const value = single(headers['x-joinr-app-version'])?.trim();
  return value !== undefined && APP_VERSION_RE.test(value) ? value : null;
}

export interface KeyCheckOptions {
  store: DeviceStore;
  now: () => Date;
}

export class KeyCheck {
  private readonly badKeys = new SlidingWindowLimiter(BAD_KEY_RATE_MAX, BAD_KEY_RATE_WINDOW_MS);

  constructor(private readonly o: KeyCheckOptions) {}

  /** The active device for these headers; throws the §4.2 `MobileError` otherwise. */
  check(headers: IncomingHttpHeaders): DeviceRecord {
    const found = keyFromHeaders(headers);
    if (found.kind === 'missing') throw new MobileError('DEVICE_KEY_MISSING');
    const device =
      found.kind === 'key' && isWellFormedKey(found.key)
        ? this.o.store.findByHash(sha256Hex(found.key))
        : undefined;
    if (device !== undefined) {
      if (device.revokedAt !== null) throw new MobileError('DEVICE_KEY_REVOKED');
      this.o.store.touch(device, appVersionFromHeaders(headers));
      return device;
    }
    // Unknown or malformed: counted; over the limit → 429 for the rest of the window.
    const decision = this.badKeys.hit(this.o.now().getTime());
    if (!decision.allowed) throw new MobileError('MOBILE_RATE_LIMITED', decision.retryAfterSeconds);
    throw new MobileError('DEVICE_KEY_INVALID');
  }
}
