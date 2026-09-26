// Side-income mutations (stage-3.md §4.2, §4.5, §3.4, D57): dated deposits and income streams.
// Creates and changed updates write `origin app`; deleting a workbook row writes the marker; a
// stream with deposits cannot be deleted (409 STREAM_IN_USE).
import { incomeStreamInputSchema, makeDepositInputSchema } from '@joinr/schema';
import { incomeStreams, sideIncomeDeposits } from '@joinr/schema/db';
import { count, eq } from 'drizzle-orm';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { parseWith } from '../../errors';
import type { IncomeStreamRow } from '../../investments/load';
import type { MutationDeps } from './cash';
import { assertNoImportRunning, nextSortOrder, normText, notFound, streamInUse } from './common';

function loadStream(tx: Tx, id: number): IncomeStreamRow {
  const row = tx.select().from(incomeStreams).where(eq(incomeStreams.id, id)).get();
  if (!row) throw notFound('Stream', id);
  return row;
}

// ─── Deposits ───────────────────────────────────────────────────────────────────────────────────

export function createDeposit(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeDepositInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      loadStream(tx, input.streamId);
      return tx
        .insert(sideIncomeDeposits)
        .values({
          streamId: input.streamId,
          depositDate: input.date,
          amountCents: input.amountCents,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: sideIncomeDeposits.id })
        .get().id;
    },
    { behavior: 'immediate' },
  );
}

/** PUT …/deposits/:id: a full replace; `origin app` when anything changed (none: no write). */
export function updateDeposit(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(makeDepositInputSchema(deps.now), body);
  deps.database.db.transaction(
    (tx) => {
      const stored = tx
        .select()
        .from(sideIncomeDeposits)
        .where(eq(sideIncomeDeposits.id, id))
        .get();
      if (!stored) throw notFound('Deposit', id);
      loadStream(tx, input.streamId);
      const changed =
        stored.streamId !== input.streamId ||
        stored.depositDate !== input.date ||
        stored.amountCents !== input.amountCents ||
        normText(stored.note) !== normText(input.note);
      if (!changed) return;
      tx.update(sideIncomeDeposits)
        .set({
          streamId: input.streamId,
          depositDate: input.date,
          amountCents: input.amountCents,
          note: input.note,
          origin: 'app',
        })
        .where(eq(sideIncomeDeposits.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function deleteDeposit(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = tx
        .select()
        .from(sideIncomeDeposits)
        .where(eq(sideIncomeDeposits.id, id))
        .get();
      if (!stored) throw notFound('Deposit', id);
      tx.delete(sideIncomeDeposits).where(eq(sideIncomeDeposits.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

// ─── Streams ────────────────────────────────────────────────────────────────────────────────────

export function createStream(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(incomeStreamInputSchema, body);
  return deps.database.db.transaction(
    (tx) =>
      tx
        .insert(incomeStreams)
        .values({
          name: input.name,
          archived: input.archived,
          sortOrder: nextSortOrder(tx, incomeStreams, incomeStreams.sortOrder),
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: incomeStreams.id })
        .get().id,
    { behavior: 'immediate' },
  );
}

/** PUT …/streams/:id: a name or archived change makes the stream `app`. */
export function updateStream(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(incomeStreamInputSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadStream(tx, id);
      if (normText(stored.name) === input.name && stored.archived === input.archived) return;
      tx.update(incomeStreams)
        .set({ name: input.name, archived: input.archived, origin: 'app' })
        .where(eq(incomeStreams.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

/** DELETE …/streams/:id: 409 while deposits exist. */
export function deleteStream(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadStream(tx, id);
      const deposits =
        tx
          .select({ n: count() })
          .from(sideIncomeDeposits)
          .where(eq(sideIncomeDeposits.streamId, id))
          .get()?.n ?? 0;
      if (deposits > 0) throw streamInUse(deposits);
      tx.delete(incomeStreams).where(eq(incomeStreams.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}
