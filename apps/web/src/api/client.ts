// The web's fetch wrapper for the JSON API (stage-1.md §6.2). Every non-2xx response becomes an
// ApiError carrying the server's `{ error: { code, message } }` body.
import { IMPORT_FILE_NAME_HEADER, type ApiErrorBody } from '@joinr/schema';

/** A failed API call: the HTTP status (0 = the server could not be reached), code and message. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The message to show for any error a query or mutation throws. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** `/api/import` + `{ dryRun: true }` → `/api/import?dryRun=true` (undefined values are dropped). */
export function withQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: BodyInit;
  headers?: Record<string, string>;
}

async function request<T>(path: string, init: RequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that it is running.');
  }
  const body = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message);
    }
    throw new ApiError(
      response.status,
      `HTTP_${response.status}`,
      `The server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    );
  }
  if (body === undefined) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server sent a response that is not JSON.',
    );
  }
  return body as T;
}

/** GET a JSON resource. */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/** POST/PUT/DELETE with an optional JSON body. */
export function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(
    path,
    body === undefined
      ? { method }
      : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  );
}

/** POST a file's raw bytes (`application/octet-stream`) with its name in `X-File-Name`. */
export function apiUpload<T>(path: string, file: File, query?: QueryParams): Promise<T> {
  return request<T>(withQuery(path, query), {
    method: 'POST',
    body: file,
    headers: {
      'content-type': 'application/octet-stream',
      [IMPORT_FILE_NAME_HEADER]: encodeURIComponent(file.name),
    },
  });
}
