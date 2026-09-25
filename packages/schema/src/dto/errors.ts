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
