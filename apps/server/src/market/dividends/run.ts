// One `dividends` job run (stage-3.md §4.6): choose the targets, fetch their events (sharing the
// Yahoo cool-down with the price job), then upsert every event in one synchronous transaction.
// `dismissed_at` is never written here: a refresh keeps the owner's dismissals.
import type { InstrumentKind } from '@joinr/schema';
import { dividendEvents, instruments, trades, type JoinrDb } from '@joinr/schema/db';
import { inArray, min } from 'drizzle-orm';
import { effectiveSource, loadInstrumentPriceRows } from '../items';
import { truncateError } from '../providers/http';
import type { Sleep } from '../providers/types';
import type { Cooldowns } from '../refresh';
import type { DividendEventsClient, EventsFetchResult, EventsTarget } from './client';
import type { ParsedDividendEvent } from './parse';

/** The kinds with dividend events on Yahoo. Crypto is never fetched. */
export const EVENT_KINDS: readonly InstrumentKind[] = ['stock', 'etf', 'managed_fund'];

/**
 * Stock, ETF and managed-fund instruments whose effective price source is `yahoo` with a
 * provider symbol and that have at least one trade (any date), in id order. `instrumentIds`
 * narrows the set; ids that do not qualify are ignored.
 */
export function selectEventTargets(db: JoinrDb, instrumentIds?: readonly number[]): EventsTarget[] {
  const wanted = instrumentIds ? new Set(instrumentIds) : null;
  const firstTrade = new Map(
    db
      .select({ id: trades.instrumentId, first: min(trades.tradeDate) })
      .from(trades)
      .groupBy(trades.instrumentId)
      .all()
      .map((r) => [r.id, r.first] as const),
  );
  const out: EventsTarget[] = [];
  for (const row of loadInstrumentPriceRows(db)) {
    const { id, kind, symbol } = row.instrument;
    if (!EVENT_KINDS.includes(kind) || (wanted && !wanted.has(id))) continue;
    const src = effectiveSource(row);
    const providerSymbol = src.providerSymbol?.trim() ?? '';
    const firstTradeDate = firstTrade.get(id);
    if (src.provider !== 'yahoo' || providerSymbol === '' || !firstTradeDate) continue;
    out.push({ id, kind, symbol, providerSymbol, firstTradeDate });
  }
  return out;
}

export interface EventsRunContext {
  db: JoinrDb;
  client: DividendEventsClient;
  cooldowns: Cooldowns;
  now: () => Date;
  sleep: Sleep;
  /** The job's signal combined with the run deadline. */
  signal: AbortSignal;
}

export interface EventsRunOutcome {
  requested: number;
  /** Targets fetched and written. */
  ok: number;
  failed: number;
  /** `interrupted` + instruments that vanished or changed during the run. */
  skipped: number;
  /** Targets not fetched because of a rate limit, the cool-down, the deadline or shutdown. */
  interrupted: number;
  /** Event rows upserted. */
  events: number;
  /** This run hit a 429/403 and started the shared cool-down. */
  rateLimited: boolean;
  /** Targets were skipped because the shared Yahoo cool-down was active. */
  cooling: boolean;
  aborted: boolean;
  /** The first failure's text (≤ 200 chars, never a URL or body). */
  firstError: string | null;
}

export async function runDividendEvents(
  ctx: EventsRunContext,
  opts: { instrumentIds?: readonly number[] } = {},
): Promise<EventsRunOutcome> {
  const { db, client, cooldowns, signal } = ctx;
  const targets = selectEventTargets(db, opts.instrumentIds);
  const targetOf = new Map(targets.map((t) => [t.id, t]));
  const results = new Map<number, ParsedDividendEvent[]>();
  const failures = new Map<number, string>();
  let interrupted = 0;
  let rateLimited = false;
  let cooling = false;

  /** True when the target must be skipped now (and counts it). */
  const stopHere = (): boolean => {
    if (rateLimited || signal.aborted) {
      interrupted += 1;
      return true;
    }
    // Checked before every request: a cool-down the price job starts mid-run stops this run too.
    if (cooldowns.isCooling('yahoo', ctx.now())) {
      cooling = true;
      interrupted += 1;
      return true;
    }
    return false;
  };

  let next = 0;
  let started = 0;
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const target = targets[next++]!;
      if (stopHere()) continue;
      if (started++ > 0 && client.spacingMs > 0) {
        await ctx.sleep(client.spacingMs, signal);
        if (stopHere()) continue;
      }
      let result: EventsFetchResult;
      try {
        result = await client.fetchEvents(target, signal);
      } catch {
        // A client never throws for a response; this guards the run against a bug or bad data
        // (e.g. an unreadable trade date) so the other targets are still written.
        result = { kind: 'failed', error: 'Unexpected error' };
      }
      switch (result.kind) {
        case 'ok':
          results.set(target.id, result.events);
          break;
        case 'failed':
          failures.set(target.id, truncateError(result.error));
          break;
        case 'rate_limited':
          rateLimited = true;
          cooldowns.start('yahoo', ctx.now(), result.retryAfterMs);
          interrupted += 1;
          break;
        case 'skipped':
          interrupted += 1;
          break;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, client.concurrency), targets.length) }, worker),
  );

  // One synchronous write transaction. IMMEDIATE takes the write lock up front, so a concurrent
  // writer (a CLI import) is waited for via busy_timeout instead of failing with SQLITE_BUSY.
  let written = 0;
  let vanished = 0;
  if (results.size > 0) {
    const fetchedAt = ctx.now().toISOString();
    db.transaction(
      (tx) => {
        // The Stage 2 identity check: only instruments that still exist with the kind and symbol
        // captured when the run chose them (ids can be reused after an import or a delete).
        const current = new Map(
          tx
            .select({ id: instruments.id, kind: instruments.kind, symbol: instruments.symbol })
            .from(instruments)
            .where(inArray(instruments.id, [...results.keys()]))
            .all()
            .map((r) => [r.id, r]),
        );
        for (const [id, events] of results) {
          const target = targetOf.get(id)!;
          const row = current.get(id);
          if (!row || row.kind !== target.kind || row.symbol !== target.symbol) {
            vanished += 1;
            continue;
          }
          for (const e of events) {
            const values = {
              amountPerUnit: e.amountPerUnit,
              currency: e.currency,
              closeBeforeEx: e.closeBeforeEx,
              closeDate: e.closeDate,
              source: client.source,
              fetchedAt,
            };
            tx.insert(dividendEvents)
              .values({ instrumentId: id, exDate: e.exDate, ...values })
              .onConflictDoUpdate({
                target: [dividendEvents.instrumentId, dividendEvents.exDate],
                set: values,
              })
              .run();
            written += 1;
          }
        }
      },
      { behavior: 'immediate' },
    );
  }

  const firstFailed = targets.find((t) => failures.has(t.id));
  return {
    requested: targets.length,
    ok: results.size - vanished,
    failed: failures.size,
    skipped: interrupted + vanished,
    interrupted,
    events: written,
    rateLimited,
    cooling,
    aborted: signal.aborted,
    firstError: firstFailed ? failures.get(firstFailed.id)! : null,
  };
}
