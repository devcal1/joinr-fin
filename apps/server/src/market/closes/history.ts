// The Yahoo part of a `closes` run (stage-10.md §5.1, §5.2, §5.6): one daily-history request per
// series or instrument target, a backfill from its `needFrom` or a top-up re-reading the last
// CLOSES_TOPUP_OVERLAP_DAYS days, then one IMMEDIATE transaction for the target. A 429/403 starts the
// shared Yahoo cool-down and the rest of the run's Yahoo targets are left for a follow-up.
import { CLOSES_TOPUP_OVERLAP_DAYS, type IsoDate } from '@joinr/schema';
import { addDaysIso } from '../../lib/dates';
import type { YahooHistory } from '../providers/types';
import type { ClosesRun } from './run';
import {
  instrumentCoveredFrom,
  planTarget,
  type ClosesAction,
  type InstrumentCloseTarget,
  type SeriesCloseTarget,
  type StoredRange,
} from './targets';
import { writeInstrumentCloses, writeSeriesCloses } from './writes';

/** The request's first date: the backfill's `needFrom`, or the newest stored close − 10 days. */
function requestFrom(action: ClosesAction, needFrom: IsoDate, stored: StoredRange | null): IsoDate {
  if (action === 'backfill' || stored === null) return needFrom;
  return addDaysIso(stored.latest, -CLOSES_TOPUP_OVERLAP_DAYS);
}

/**
 * Plans, fetches and writes one Yahoo target. Returns the history (for an instrument's currency)
 * when the request succeeded, else null.
 */
async function runYahooTarget(
  run: ClosesRun,
  o: {
    key: string;
    symbol: string;
    needFrom: IsoDate;
    coveredFrom: IsoDate;
    stored: StoredRange | null;
    daily: boolean;
    /** null: the instrument changed during the fetch; `{ error }`: the answer cannot be stored. */
    write: (history: YahooHistory) => { rows: number; splits: number } | { error: string } | null;
  },
): Promise<YahooHistory | null> {
  const { ctx, detail, localDate } = run;
  const counts = detail.yahoo;
  const action = planTarget({
    stored: o.stored,
    coveredFrom: o.coveredFrom,
    triedToday: ctx.memory.triedOn(o.key, localDate),
    complete: ctx.memory.isComplete(o.key),
  });
  if (action === 'skip') {
    counts.skipped += 1;
    return null;
  }
  const blocked = (): boolean => ctx.signal.aborted || ctx.cooldowns.isCooling('yahoo', ctx.now());
  if (blocked()) {
    counts.skipped += 1;
    detail.left += 1;
    return null;
  }
  await ctx.beforeRequest('yahoo');
  if (blocked()) {
    counts.skipped += 1;
    detail.left += 1;
    return null;
  }
  if (action === 'backfill') detail.backfills += 1;
  else detail.topUps += 1;
  const result = await ctx.clients.yahoo.fetchHistory(
    { symbol: o.symbol, from: requestFrom(action, o.needFrom, o.stored), daily: o.daily },
    ctx.signal,
  );
  // The once-a-day rule counts a backfill that got an answer; a cool-down or the deadline does
  // not use up the day's try.
  if (action === 'backfill' && (result.ok || result.kind === 'failed')) {
    ctx.memory.markTried(o.key, localDate);
  }
  if (!result.ok) {
    if (result.kind === 'rate_limited') {
      ctx.cooldowns.start('yahoo', ctx.now(), result.retryAfterMs);
      counts.skipped += 1;
      detail.left += 1;
    } else if (result.kind === 'skipped') {
      counts.skipped += 1;
      detail.left += 1;
    } else {
      counts.failed += 1;
      run.errors.push(result.error);
    }
    return null;
  }
  const written = o.write(result.history);
  if (written === null) {
    // The instrument changed (deleted, re-created or re-sourced) during the fetch.
    counts.skipped += 1;
    return null;
  }
  if ('error' in written) {
    counts.failed += 1;
    run.errors.push(written.error);
    return null;
  }
  counts.ok += 1;
  detail.rows += written.rows;
  detail.splits += written.splits;
  if (action === 'backfill') {
    ctx.memory.markComplete(o.key);
    ctx.memory.setFirstTradeDate(o.key, result.history.firstTradeDate);
  }
  return result.history;
}

/** A market series (`AUDUSD`, `FX_<CCY>AUD`, the futures): its closes only (no splits). */
export async function runSeriesTarget(
  run: ClosesRun,
  t: SeriesCloseTarget,
  stored: StoredRange | null,
): Promise<void> {
  const source = run.ctx.clients.yahoo.id;
  await runYahooTarget(run, {
    key: t.key,
    symbol: t.yahooSymbol,
    needFrom: t.needFrom,
    coveredFrom: t.coveredFrom,
    stored,
    daily: false,
    write: (history) => ({
      rows: writeSeriesCloses(run.ctx.db, t.seriesId, history.closes, source, run.fetchedAt),
      splits: 0,
    }),
  });
}

/**
 * A Yahoo-priced instrument (a listing or a fund): its closes in the answer's currency (else the
 * stored native currency; a failure when neither is known) and its split events. Returns the
 * currency the closes were written in, or null.
 */
export async function runYahooInstrument(
  run: ClosesRun,
  t: InstrumentCloseTarget,
  stored: StoredRange | null,
): Promise<string | null> {
  let currency: string | null = null;
  const source = run.ctx.clients.yahoo.id;
  await runYahooTarget(run, {
    key: t.key,
    symbol: t.providerSymbol,
    needFrom: t.needFrom,
    coveredFrom: instrumentCoveredFrom(t, run.ctx.memory, run.localDate),
    stored,
    daily: t.instrumentKind === 'managed_fund',
    write: (history) => {
      currency = history.currency ?? t.nativeCurrency;
      // The readers compare currencies (§5.9): closes without one are not stored.
      if (currency === null) return { error: 'No currency in response' };
      return writeInstrumentCloses(
        run.ctx.db,
        { target: t, closes: history.closes, currency, splits: history.splits, source },
        run.fetchedAt,
      );
    },
  });
  return currency;
}
