// Test helpers for the market data and scheduler suites: a silent logger, a mocked fetch that
// routes by URL, response builders shaped like the real Yahoo/CoinGecko JSON (generic values
// only) and controllable clocks. No network: the server setup file makes the global fetch throw.
import type { FastifyBaseLogger } from 'fastify';
import type { Sleep } from '../../src/market/providers/types';
import type { Clock } from '../../src/scheduler/types';

function noop(): void {}

export function silentLogger(): FastifyBaseLogger {
  const logger: FastifyBaseLogger = {
    level: 'silent',
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
  };
  return logger;
}

export interface FetchCall {
  url: URL;
  init: RequestInit | undefined;
}

export type FetchHandler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

/** A `fetch` that records every call and answers through `handler`. */
export function mockFetch(handler: FetchHandler): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A response that never arrives: rejects when the request's signal aborts (timeouts, deadline). */
export function hangingResponse(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const onAbort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Unix seconds. */
export function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** A Yahoo chart body like the real `v8/finance/chart` response (only the fields we read). */
export function yahooChart(o: {
  symbol: string;
  price?: number | null;
  currency?: string | null;
  time?: string;
  /** Raw `regularMarketTime` override (e.g. 0 for a degraded meta). */
  marketTime?: number | null;
  closes?: Array<number | null>;
  timestamps?: string[];
}): unknown {
  const time = o.time ?? '2026-09-24T06:10:00.000Z';
  const timestamps = o.timestamps ?? [time];
  return {
    chart: {
      result: [
        {
          meta: {
            currency: o.currency === undefined ? 'AUD' : o.currency,
            symbol: o.symbol,
            exchangeName: 'ASX',
            instrumentType: 'ETF',
            regularMarketPrice: o.price === undefined ? 12.34 : o.price,
            regularMarketTime: o.marketTime === undefined ? unix(time) : o.marketTime,
            chartPreviousClose: 12,
          },
          timestamp: timestamps.map(unix),
          indicators: { quote: [{ close: o.closes ?? [o.price ?? 12.34] }] },
        },
      ],
      error: null,
    },
  };
}

/** Yahoo's body for an unknown symbol (sent with a 404). */
export function yahooNotFound(): unknown {
  return {
    chart: {
      result: null,
      error: { code: 'Not Found', description: 'No data found, symbol may be delisted' },
    },
  };
}

/** The Yahoo symbol of a chart URL (`/v8/finance/chart/<symbol>`). */
export function yahooSymbolOf(url: URL): string {
  return decodeURIComponent(url.pathname.split('/').pop() ?? '');
}

export const noSleep: Sleep = async () => undefined;

/**
 * A clock whose `now()` is set by the test; timers are real `setTimeout`s (short delays only),
 * so request deadlines and aborts behave as in production.
 */
export function settableClock(start: string): Clock & {
  set(iso: string): void;
  advance(ms: number): void;
} {
  let now = Date.parse(start);
  return {
    now: () => new Date(now),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    set(iso) {
      now = Date.parse(iso);
    },
    advance(ms) {
      now += ms;
    },
  };
}

/** A clock whose timers only fire when the test calls `fire()`. */
export function manualClock(start: string): Clock & {
  pending(): Array<{ ms: number }>;
  fire(): void;
} {
  const now = Date.parse(start);
  let timers: Array<{ id: number; fn: () => void; ms: number }> = [];
  let nextId = 1;
  return {
    now: () => new Date(now),
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
    pending: () => timers.map((t) => ({ ms: t.ms })),
    fire() {
      const due = timers;
      timers = [];
      for (const t of due) t.fn();
    },
  };
}
