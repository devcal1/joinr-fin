// The phone API's secrets (stage-9.md §3.4, §4.2, §6.1, §6.2): device keys, device ids, pairing
// codes and their digests. Node's `crypto` only. A key or code is never logged, stored or kept
// after the response that hands it out: the server keeps the SHA-256 of a key (hex) and the digest
// of the open code.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  MOBILE_KEY_PREFIX,
  MOBILE_KEY_RE,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
} from '@joinr/schema';

/** A new device key: `jfk_` + 32 random bytes as base64url without padding (43 characters). */
export function generateDeviceKey(): string {
  return `${MOBILE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** A new device id: `d_` + 16 hex digits. */
export function generateDeviceId(): string {
  return `d_${randomBytes(8).toString('hex')}`;
}

/** A new pairing code: `PAIRING_CODE_LENGTH` characters drawn uniformly from the alphabet. */
export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** SHA-256 of a text (hex). Keys are 256-bit random values, so a fast hash is the right one. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of a text (raw bytes), for constant-time comparison. */
export function sha256Bytes(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** Constant-time equality of two digests of the same length (false for different lengths). */
export function digestsEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the text has the shape of a device key (the hash lookup decides whether it is known). */
export function isWellFormedKey(key: string): boolean {
  return MOBILE_KEY_RE.test(key);
}
