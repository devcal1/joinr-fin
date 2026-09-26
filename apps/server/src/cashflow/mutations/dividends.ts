// Dividend mutations (stage-3.md §4.2, §4.5 step 4, §3.4, D50): the ledger rows (the ticker and
// holding kind follow the chosen holding; an omitted price at the ex-date is filled from the
// dividend-events cache) and the suggestion dismiss/restore flags (an overlay on the cache).
import {
  compareDecimals,
  dividendEventKeySchema,
  makeDividendInputSchema,
  type DividendEventKey,
} from '@joinr/schema';
import { dividendEvents, dividends, instruments } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { parseWith } from '../../errors';
import type { DividendRow, InstrumentRow } from '../../investments/load';
import type { MutationDeps } from './cash';
import { assertNoImportRunning, normText, notFound } from './common';

function loadInstrument(tx: Tx, id: number): InstrumentRow {
  const row = tx.select().from(instruments).where(eq(instruments.id, id)).get();
  if (!row) throw notFound('Instrument', id);
  return row;
}

/** The cached close before the ex-date for `(instrument, exDate)`, or null. */
function cachedClose(tx: Tx, instrumentId: number, exDate: string | null): string | null {
  if (exDate === null) return null;
  return (
    tx
      .select({ close: dividendEvents.closeBeforeEx })
      .from(dividendEvents)
      .where(and(eq(dividendEvents.instrumentId, instrumentId), eq(dividendEvents.exDate, exDate)))
      .get()?.close ?? null
  );
}

function sameDecimal(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  try {
    return compareDecimals(a, b) === 0;
  } catch {
    return a === b;
  }
}

/**
 * The stored price columns (§4.5 step 4). Given → stored as typed (`manual`), unless it equals the
 * stored price, which keeps the stored row's flag (a form that echoes the price back is no change).
 * Omitted (or null) → the cached close for the ex-date (`manual` false), else null; except that an
 * update of the same holding and ex-date keeps a stored price that was not typed (a workbook
 * formula's cached value), so saving an unchanged row never drops it.
 */
function priceColumns(
  tx: Tx,
  instrumentId: number,
  exDate: string | null,
  given: string | null | undefined,
  stored: Pick<DividendRow, 'instrumentId' | 'exDate' | 'priceAtEx' | 'priceAtExManual'> | null,
): { priceAtEx: string | null; priceAtExManual: boolean } {
  if (given !== undefined && given !== null) {
    if (stored !== null && sameDecimal(stored.priceAtEx, given)) {
      return { priceAtEx: stored.priceAtEx, priceAtExManual: stored.priceAtExManual };
    }
    return { priceAtEx: given, priceAtExManual: true };
  }
  const close = cachedClose(tx, instrumentId, exDate);
  if (
    close === null &&
    stored !== null &&
    !stored.priceAtExManual &&
    stored.instrumentId === instrumentId &&
    stored.exDate === exDate
  ) {
    return { priceAtEx: stored.priceAtEx, priceAtExManual: false };
  }
  return { priceAtEx: close, priceAtExManual: false };
}

export function createDividend(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeDividendInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const instrument = loadInstrument(tx, input.instrumentId);
      return tx
        .insert(dividends)
        .values({
          instrumentId: instrument.id,
          ticker: instrument.symbol,
          holdingKind: instrument.kind,
          paymentDate: input.paymentDate,
          exDate: input.exDate,
          reinvested: input.reinvested,
          netAmountCents: input.netAmountCents,
          ...priceColumns(tx, instrument.id, input.exDate, input.priceAtEx, null),
          reviewFlags: null,
          correctionId: null,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: dividends.id })
        .get().id;
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/dividends/:id: the holding may change (the ticker and kind then follow it; an
 * unchanged holding keeps the stored ticker text). A change makes the row `app` and clears its
 * review flags; a no-op save writes nothing.
 */
export function updateDividend(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(makeDividendInputSchema(deps.now), body);
  deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(dividends).where(eq(dividends.id, id)).get();
      if (!stored) throw notFound('Dividend', id);
      const instrument = loadInstrument(tx, input.instrumentId);
      const holdingChanged = stored.instrumentId !== instrument.id;
      const price = priceColumns(tx, instrument.id, input.exDate, input.priceAtEx, stored);
      const changed =
        holdingChanged ||
        stored.paymentDate !== input.paymentDate ||
        stored.exDate !== input.exDate ||
        stored.reinvested !== input.reinvested ||
        stored.netAmountCents !== input.netAmountCents ||
        !sameDecimal(stored.priceAtEx, price.priceAtEx) ||
        stored.priceAtExManual !== price.priceAtExManual ||
        normText(stored.note) !== normText(input.note);
      if (!changed) return;
      tx.update(dividends)
        .set({
          instrumentId: instrument.id,
          ticker: holdingChanged ? instrument.symbol : stored.ticker,
          holdingKind: holdingChanged ? instrument.kind : stored.holdingKind,
          paymentDate: input.paymentDate,
          exDate: input.exDate,
          reinvested: input.reinvested,
          netAmountCents: input.netAmountCents,
          ...price,
          reviewFlags: null,
          note: input.note,
          origin: 'app',
        })
        .where(eq(dividends.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function deleteDividend(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(dividends).where(eq(dividends.id, id)).get();
      if (!stored) throw notFound('Dividend', id);
      tx.delete(dividends).where(eq(dividends.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

/**
 * POST /api/dividends/suggestions/dismiss (`dismissed = true`) and …/restore (false): sets or
 * clears `dividend_events.dismissed_at` (an overlay: never app data). 404 for an unknown event.
 */
export function setSuggestionDismissed(
  deps: MutationDeps,
  body: unknown,
  dismissed: boolean,
): DividendEventKey {
  assertNoImportRunning();
  const key = parseWith(dividendEventKeySchema, body);
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const where = and(
        eq(dividendEvents.instrumentId, key.instrumentId),
        eq(dividendEvents.exDate, key.exDate),
      );
      const event = tx
        .select({ dismissedAt: dividendEvents.dismissedAt })
        .from(dividendEvents)
        .where(where)
        .get();
      if (!event) throw notFound('Dividend event', `${key.instrumentId} ${key.exDate}`);
      // Dismissing twice keeps the first time; restoring an active event is a no-op.
      if (dismissed && event.dismissedAt === null) {
        tx.update(dividendEvents).set({ dismissedAt: now.toISOString() }).where(where).run();
      } else if (!dismissed && event.dismissedAt !== null) {
        tx.update(dividendEvents).set({ dismissedAt: null }).where(where).run();
      }
    },
    { behavior: 'immediate' },
  );
  return { instrumentId: key.instrumentId, exDate: key.exDate };
}
