// The phone API's fixed sentences (stage-9.md §4.5, §6.8): every error of `/api/mobile/*` and
// `/api/phone*` is one of these, never a value (no key, code, body or header is ever echoed).
import { MOBILE_ERROR_MESSAGES, type MobileErrorCode } from '@joinr/schema';
import { HttpError } from '../errors';

const STATUS: Record<MobileErrorCode, number> = {
  DEVICE_KEY_MISSING: 401,
  DEVICE_KEY_INVALID: 401,
  DEVICE_KEY_REVOKED: 401,
  MOBILE_RATE_LIMITED: 429,
  MOBILE_READ_ONLY: 405,
  PAIRING_CODE_INVALID: 401,
  PAIRING_RATE_LIMITED: 429,
  PHONE_LIMIT_REACHED: 409,
  PHONE_STORE_FAILED: 503,
};

/** An error with one of the §4.5 codes and its fixed sentence (a 503 is exposed as it is). */
export class MobileError extends HttpError {
  /** Seconds for the `Retry-After` header (429 only). */
  readonly retryAfterSeconds: number | null;

  constructor(code: MobileErrorCode, retryAfterSeconds: number | null = null) {
    super(STATUS[code], MOBILE_ERROR_MESSAGES[code], code, { expose: STATUS[code] >= 500 });
    this.name = 'MobileError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** `POST /api/mobile/pair`: a body that is not `{ code, deviceName?, appVersion? }` with short texts. */
export const PAIR_BODY_MESSAGE =
  'Send { "code": "…" } with an optional deviceName (up to 100 characters) and appVersion (up to 20).';

/** `POST /api/phone/pairing` and the revoke: a body other than none or `{}`. */
export const EMPTY_BODY_MESSAGE = 'Send no body, or {}';

/** `POST /api/phone/devices/:id/revoke` with an id that is not `d_` + 16 hex digits. */
export const BAD_DEVICE_ID_MESSAGE = 'Not a phone id';

/** `POST /api/phone/devices/:id/revoke` for an id the store does not know. */
export const UNKNOWN_DEVICE_MESSAGE = 'No such phone';

/** The default label when a phone sends no usable name. */
export const DEFAULT_DEVICE_LABEL = 'Android phone';
