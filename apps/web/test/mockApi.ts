// A tiny fake of the JSON API for page tests: routes keyed "METHOD /path" (no query string).
// Bodies come from @joinr/schema/fixtures, so the pages are tested against the frozen DTOs.
import { appStatusEmpty } from '@joinr/schema/fixtures';
import { vi, type Mock } from 'vitest';

export interface MockReply {
  status?: number;
  body?: unknown;
}

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  /** Parsed JSON for string bodies; the Blob/File itself for uploads; undefined when empty. */
  body: unknown;
}

export type MockHandler = MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>);

export interface MockApi {
  fetch: Mock;
  requests: MockRequest[];
  /** Requests to one route ("METHOD /path"). */
  calls: (route: string) => MockRequest[];
}

/** A handler that never answers: the page stays in its loading state. */
export const pending: MockHandler = () => new Promise<MockReply>(() => undefined);

/** An error reply in the API's `{ error: { code, message } }` shape. */
export function apiError(status: number, body: { error: { code: string; message: string } }) {
  return { status, body } satisfies MockReply;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function bodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  return body;
}

/**
 * Stubs `fetch` with the given routes. `GET /api/status` answers the empty status unless a test
 * overrides it (the shell asks for it on every page). Unknown routes answer 404 NOT_FOUND.
 */
export function mockApi(routes: Record<string, MockHandler> = {}): MockApi {
  const table: Record<string, MockHandler> = {
    'GET /api/status': { body: appStatusEmpty },
    ...routes,
  };
  const requests: MockRequest[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://localhost');
    const request: MockRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: headersOf(init),
      body: bodyOf(init),
    };
    requests.push(request);
    const handler = table[`${request.method} ${request.path}`];
    const reply: MockReply = !handler
      ? {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: `No route for ${request.path}` } },
        }
      : typeof handler === 'function'
        ? await handler(request)
        : handler;
    const status = reply.status ?? 200;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    requests,
    calls: (route) => requests.filter((r) => `${r.method} ${r.path}` === route),
  };
}
