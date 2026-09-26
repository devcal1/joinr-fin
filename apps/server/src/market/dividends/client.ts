// Where dividend events come from (stage-3.md §4.6): Yahoo's chart API in mode `live`, the
// deterministic fake events in mode `fake`. A client fetches one target at a time; the run
// (run.ts) owns the concurrency, spacing, cool-down and deadline.
import type { InstrumentKind, IsoDate } from '@joinr/schema';
import { fakeDividendEvents } from '../providers/fake';
import { BROWSER_USER_AGENT, failureFor, getJson } from '../providers/http';
import { YAHOO_CONCURRENCY, YAHOO_SPACING_MS, yahooDividendsUrl } from '../providers/yahoo';
import { parseYahooDividends, type ParsedDividendEvent } from './parse';

/** An instrument the run fetches events for, with its identity when the run chose it. */
export interface EventsTarget {
  id: number;
  kind: InstrumentKind;
  symbol: string;
  providerSymbol: string;
  /** The instrument's earliest trade date. */
  firstTradeDate: IsoDate;
}

export type EventsFetchResult =
  | { kind: 'ok'; events: ParsedDividendEvent[] }
  | { kind: 'failed'; error: string }
  /** 429/403: the run stops and starts the shared Yahoo cool-down. */
  | { kind: 'rate_limited'; retryAfterMs?: number }
  /** Not attempted or aborted by the run (deadline, shutdown). */
  | { kind: 'skipped' };

export interface DividendEventsClient {
  /** Stored as `dividend_events.source`. */
  source: 'yahoo' | 'fake';
  concurrency: number;
  /** Pause between two request starts. */
  spacingMs: number;
  fetchEvents(target: EventsTarget, signal: AbortSignal): Promise<EventsFetchResult>;
}

/** The request starts this many days before the first trade (§4.6). */
export const EVENTS_LOOKBACK_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** `period1` = unix(first trade − 14 days) at 00:00 UTC (never negative); `period2` = unix(now). */
export function eventsPeriod(
  firstTradeDate: IsoDate,
  now: Date,
): { period1: number; period2: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstTradeDate);
  if (!match) throw new RangeError(`eventsPeriod: expected YYYY-MM-DD, got ${firstTradeDate}`);
  const start =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) -
    EVENTS_LOOKBACK_DAYS * MS_PER_DAY;
  const period2 = Math.floor(now.getTime() / 1000);
  const period1 = Math.min(Math.max(0, Math.floor(start / 1000)), period2);
  return { period1, period2 };
}

export function createYahooEventsClient(o: {
  fetchImpl: typeof fetch;
  now: () => Date;
  spacingMs?: number;
  timeoutMs?: number;
  concurrency?: number;
}): DividendEventsClient {
  const headers = { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' };
  return {
    source: 'yahoo',
    concurrency: Math.max(1, o.concurrency ?? YAHOO_CONCURRENCY),
    spacingMs: Math.max(0, o.spacingMs ?? YAHOO_SPACING_MS),
    async fetchEvents(target, signal) {
      const { period1, period2 } = eventsPeriod(target.firstTradeDate, o.now());
      const outcome = await getJson({
        fetchImpl: o.fetchImpl,
        url: yahooDividendsUrl(target.providerSymbol, period1, period2),
        headers,
        runSignal: signal,
        timeoutMs: o.timeoutMs,
        now: o.now,
      });
      if (outcome.kind === 'aborted') return { kind: 'skipped' };
      if (outcome.kind !== 'ok') {
        const failure = failureFor(String(target.id), outcome);
        if (failure.rateLimited) {
          return failure.retryAfterMs === undefined
            ? { kind: 'rate_limited' }
            : { kind: 'rate_limited', retryAfterMs: failure.retryAfterMs };
        }
        return { kind: 'failed', error: failure.error };
      }
      const parsed = parseYahooDividends(outcome.body);
      return parsed.ok
        ? { kind: 'ok', events: parsed.events }
        : { kind: 'failed', error: parsed.error };
    },
  };
}

/** Mode `fake`: `fakeDividendEvents(providerSymbol, now)`; never touches the network. */
export function createFakeEventsClient(o: { now: () => Date }): DividendEventsClient {
  return {
    source: 'fake',
    concurrency: 1,
    spacingMs: 0,
    async fetchEvents(target, signal) {
      if (signal.aborted) return { kind: 'skipped' };
      return { kind: 'ok', events: fakeDividendEvents(target.providerSymbol, o.now()) };
    },
  };
}
