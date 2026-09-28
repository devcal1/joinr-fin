// The API error shape and codes (stage-1.md §3.1).

export const API_ERROR_CODES = [
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'IMPORT_CONFIRM_REQUIRED',
  'IMPORT_IN_PROGRESS',
  'IMPORT_APP_DATA_EXISTS',
  'INVALID_WORKBOOK',
  'INVALID_CORRECTIONS',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'MARKET_DATA_DISABLED',
  'INTERNAL_SERVER_ERROR',
  // Stage 2 (stage-2.md §4.1): 422 · 409 · 409.
  'TRADE_OVERSELL',
  'INSTRUMENT_EXISTS',
  'INSTRUMENT_IN_USE',
  // Stage 3 (stage-3.md §4.1): 409 · 409 · 409.
  'ACCOUNT_IN_USE',
  'STREAM_IN_USE',
  'LAST_BALANCE_ENTRY',
  // Stage 4 (stage-4.md §4.1): 409 · 409 · 422.
  'FUND_IN_USE',
  'PROPERTY_HAS_LOAN',
  'SALE_OVERSELL',
  // Stage 5 (stage-5.md §4.1): 409 · 409 · 409 · 409.
  'SNAPSHOT_EXISTS',
  'SNAPSHOT_NOT_LATEST',
  'SNAPSHOT_NOT_DELETABLE',
  'RECORD_IN_PROGRESS',
  // Stage 7 (stage-7.md §4.1): 500 (a category message, never a path) · 403 (the cross-site write guard).
  'BACKUP_FAILED',
  'CROSS_SITE_REQUEST',
  // Stage 8 (stage-8.md §4.1): 409 (the copy is not set up, or half set up, or unusable) · 409 (the
  // refusal lock holds). The message is a fixed sentence, never a value.
  'NAS_COPY_NOT_READY',
  'NAS_COPY_FIX_FIRST',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Every non-2xx API response: `{ error: { code, message } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
