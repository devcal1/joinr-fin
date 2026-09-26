// Cash mutations (stage-3.md §4.2, §4.5, §3.4): accounts (the kind-only exception keeps `origin`),
// balance entries (D58: upsert by account and as-of, the account's balance follows its latest
// entry), savings adjustments (D51, an overlay on closed periods), period notes (spend and side
// income: recorded periods only; Stage 4's super option log: any month up to the as-of month) and
// savings goals (D55, an overlay). Stage 4 (stage-4.md §4.5 step 8): turning an account's Offset
// flag off removes its offset link (D67) in the same transaction.
import {
  EDITABLE_NOTE_KINDS,
  isoMonthOf,
  makeCashAccountCreateSchema,
  makeCashBalancesInputSchema,
  cashAccountUpdateSchema,
  periodNoteInputSchema,
  reorderSchema,
  savingsAdjustmentInputSchema,
  savingsGoalInputSchema,
  type EditableNoteKind,
  type IsoMonth,
  type PeriodNoteDto,
  type SavingsAdjustmentDto,
} from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
  loanOffsetLinks,
  periodNotes,
  savingsAdjustments,
  savingsGoals,
  snapshots,
} from '@joinr/schema/db';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/database';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { HttpError, parseWith } from '../../errors';
import { localIsoDate } from '../../investments/format';
import type { CashAccountRow } from '../../investments/load';
import { periodNoteDto } from '../cash';
import {
  accountInUse,
  assertNoImportRunning,
  assertSameIds,
  closedPeriodMonths,
  lastBalanceEntry,
  nextSortOrder,
  normText,
  notFound,
  NOT_A_RECORDED_PERIOD,
  parsePeriodMonth,
  recordedPeriodMonths,
  validation,
} from './common';

/** What the mutations need: the database and the clock (the date schemas and timestamps). */
export interface MutationDeps {
  database: AppDatabase;
  now: () => Date;
}

function loadAccount(tx: Tx, id: number): CashAccountRow {
  const row = tx.select().from(cashAccounts).where(eq(cashAccounts.id, id)).get();
  if (!row) throw notFound('Account', id);
  return row;
}

/** Sets the account's denormalised balance from its latest entry (the account's origin is kept). */
export function syncAccountBalance(tx: Tx, accountId: number): void {
  const latest = tx
    .select({ asOf: cashBalanceEntries.asOf, balanceCents: cashBalanceEntries.balanceCents })
    .from(cashBalanceEntries)
    .where(eq(cashBalanceEntries.accountId, accountId))
    .orderBy(desc(cashBalanceEntries.asOf), desc(cashBalanceEntries.id))
    .limit(1)
    .get();
  if (!latest) return;
  tx.update(cashAccounts)
    .set({ balanceCents: latest.balanceCents, balanceAsOf: latest.asOf })
    .where(eq(cashAccounts.id, accountId))
    .run();
}

// ─── Accounts ───────────────────────────────────────────────────────────────────────────────────

/** POST /api/cash/accounts: the account and its opening balance entry, both `origin app`. */
export function createCashAccount(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeCashAccountCreateSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const id = tx
        .insert(cashAccounts)
        .values({
          name: input.name,
          kind: input.kind,
          currency: 'AUD',
          balanceCents: input.openingBalanceCents,
          balanceAsOf: input.asOf,
          isOffset: input.isOffset,
          archived: false,
          sortOrder: nextSortOrder(tx, cashAccounts, cashAccounts.sortOrder),
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: cashAccounts.id })
        .get().id;
      tx.insert(cashBalanceEntries)
        .values({
          accountId: id,
          asOf: input.asOf,
          balanceCents: input.openingBalanceCents,
          note: null,
          origin: 'app',
          sheetRef: null,
        })
        .run();
      return id;
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/cash/accounts/:id. A kind-only change keeps `origin` (the importer keeps the kind,
 * §3.5); a name, offset or note change makes the account `app`; a no-op save writes nothing.
 */
export function updateCashAccount(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(cashAccountUpdateSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadAccount(tx, id);
      const kindChanged = stored.kind !== input.kind;
      const otherChanged =
        normText(stored.name) !== normText(input.name) ||
        stored.isOffset !== input.isOffset ||
        normText(stored.note) !== normText(input.note);
      if (!kindChanged && !otherChanged) return;
      tx.update(cashAccounts)
        .set(
          otherChanged
            ? {
                name: input.name,
                kind: input.kind,
                isOffset: input.isOffset,
                note: input.note,
                origin: 'app' as const,
              }
            : { kind: input.kind },
        )
        .where(eq(cashAccounts.id, id))
        .run();
      // D67: an account no longer flagged Offset loses its offset link.
      if (stored.isOffset && !input.isOffset) {
        tx.delete(loanOffsetLinks).where(eq(loanOffsetLinks.accountId, id)).run();
      }
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/cash/accounts/:id: 409 while budget rows use it; cascades its entries. */
export function deleteCashAccount(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadAccount(tx, id);
      const rows =
        tx.select({ n: count() }).from(budgetItems).where(eq(budgetItems.cashAccountId, id)).get()
          ?.n ?? 0;
      if (rows > 0) throw accountInUse(rows);
      tx.delete(cashAccounts).where(eq(cashAccounts.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

// ─── Balances (D58) ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/cash/balances: upserts each `(account, asOf)` entry (`origin app`; an unchanged entry
 * is not rewritten), then sets each account's balance from its latest entry. Returns the account
 * ids in body order.
 */
export function saveBalances(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const input = parseWith(makeCashBalancesInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      for (const e of input.entries) {
        loadAccount(tx, e.accountId);
        const existing = tx
          .select()
          .from(cashBalanceEntries)
          .where(
            and(
              eq(cashBalanceEntries.accountId, e.accountId),
              eq(cashBalanceEntries.asOf, input.asOf),
            ),
          )
          .get();
        if (existing) {
          const note = e.note === undefined ? existing.note : e.note;
          if (
            existing.balanceCents !== e.balanceCents ||
            normText(existing.note) !== normText(note)
          ) {
            tx.update(cashBalanceEntries)
              .set({ balanceCents: e.balanceCents, note, origin: 'app' })
              .where(eq(cashBalanceEntries.id, existing.id))
              .run();
          }
        } else {
          tx.insert(cashBalanceEntries)
            .values({
              accountId: e.accountId,
              asOf: input.asOf,
              balanceCents: e.balanceCents,
              note: e.note ?? null,
              origin: 'app',
              sheetRef: null,
            })
            .run();
        }
        syncAccountBalance(tx, e.accountId);
      }
      return input.entries.map((e) => e.accountId);
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/cash/balance-entries/:id: 409 for an account's only entry. Returns the account id. */
export function deleteBalanceEntry(deps: MutationDeps, id: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx.select().from(cashBalanceEntries).where(eq(cashBalanceEntries.id, id)).get();
      if (!entry) throw notFound('Balance entry', id);
      const n =
        tx
          .select({ n: count() })
          .from(cashBalanceEntries)
          .where(eq(cashBalanceEntries.accountId, entry.accountId))
          .get()?.n ?? 0;
      if (n <= 1) throw lastBalanceEntry();
      tx.delete(cashBalanceEntries).where(eq(cashBalanceEntries.id, id)).run();
      if (entry.sheetRef !== null) markImportRowDeleted(tx, now);
      syncAccountBalance(tx, entry.accountId);
      return entry.accountId;
    },
    { behavior: 'immediate' },
  );
}

// ─── Adjustments (D51, overlay) ─────────────────────────────────────────────────────────────────

function snapshotRows(tx: Tx) {
  return tx.select().from(snapshots).all();
}

/** PUT /api/cash/adjustments/:periodMonth: a closed period's month only (400 otherwise). */
export function putAdjustment(
  deps: MutationDeps,
  params: unknown,
  body: unknown,
): SavingsAdjustmentDto {
  assertNoImportRunning();
  const periodMonth = parsePeriodMonth(params);
  const input = parseWith(savingsAdjustmentInputSchema, body);
  return deps.database.db.transaction(
    (tx) => {
      if (!closedPeriodMonths(snapshotRows(tx)).has(periodMonth)) {
        throw validation(NOT_A_RECORDED_PERIOD);
      }
      const existing = tx
        .select()
        .from(savingsAdjustments)
        .where(eq(savingsAdjustments.periodMonth, periodMonth))
        .get();
      if (!existing) {
        tx.insert(savingsAdjustments)
          .values({
            periodMonth,
            amountCents: input.amountCents,
            note: input.note,
            origin: 'app',
            sheetRef: null,
          })
          .run();
      } else if (existing.amountCents !== input.amountCents || existing.note !== input.note) {
        tx.update(savingsAdjustments)
          .set({ amountCents: input.amountCents, note: input.note })
          .where(eq(savingsAdjustments.id, existing.id))
          .run();
      }
      return { periodMonth, amountCents: input.amountCents, note: input.note };
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/cash/adjustments/:periodMonth (also removes an orphan). 404 when none. */
export function deleteAdjustment(deps: MutationDeps, params: unknown): IsoMonth {
  assertNoImportRunning();
  const periodMonth = parsePeriodMonth(params);
  deps.database.db.transaction(
    (tx) => {
      const deleted = tx
        .delete(savingsAdjustments)
        .where(eq(savingsAdjustments.periodMonth, periodMonth))
        .run().changes;
      if (deleted === 0) throw notFound('Adjustment for', periodMonth);
    },
    { behavior: 'immediate' },
  );
  return periodMonth;
}

// ─── Period notes ───────────────────────────────────────────────────────────────────────────────

/** `:kind` of the period-notes route: an editable note kind, else 404 (as an unknown page). */
export function parseNoteKind(params: unknown): EditableNoteKind {
  const kind = (params as { kind?: unknown } | null)?.kind;
  if (typeof kind === 'string' && (EDITABLE_NOTE_KINDS as readonly string[]).includes(kind)) {
    return kind as EditableNoteKind;
  }
  throw new HttpError(404, 'No period notes of this kind', 'NOT_FOUND');
}

/** 400 for a `super_option` note month after the as-of month (stage-4.md §4.2). */
export const AFTER_THIS_MONTH = 'periodMonth: after this month';

/**
 * PUT /api/period-notes/:kind/:periodMonth: `spend` and `side_income` take a recorded period's
 * month only (a snapshot has it); `super_option` (the D69 option log) takes any month up to the
 * as-of month. `''` deletes the note (the marker for a workbook note); an unchanged note writes
 * nothing.
 */
export function putPeriodNote(
  deps: MutationDeps,
  params: unknown,
  body: unknown,
): PeriodNoteDto | null {
  assertNoImportRunning();
  const kind = parseNoteKind(params);
  const periodMonth = parsePeriodMonth(params);
  const input = parseWith(periodNoteInputSchema, body);
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      if (kind === 'super_option') {
        if (periodMonth > isoMonthOf(localIsoDate(now))) throw validation(AFTER_THIS_MONTH);
      } else if (!recordedPeriodMonths(snapshotRows(tx)).has(periodMonth)) {
        throw validation(NOT_A_RECORDED_PERIOD);
      }
      const where = and(eq(periodNotes.periodMonth, periodMonth), eq(periodNotes.kind, kind));
      const existing = tx.select().from(periodNotes).where(where).get();
      if (input.note === '') {
        if (existing) {
          tx.delete(periodNotes).where(eq(periodNotes.id, existing.id)).run();
          if (existing.sheetRef !== null) markImportRowDeleted(tx, now);
        }
        return null;
      }
      if (!existing) {
        const row = tx
          .insert(periodNotes)
          .values({ periodMonth, kind, note: input.note, origin: 'app', sheetRef: null })
          .returning()
          .get();
        return periodNoteDto(row);
      }
      if (normText(existing.note) === input.note) return periodNoteDto(existing);
      const row = tx
        .update(periodNotes)
        .set({ note: input.note, origin: 'app' })
        .where(eq(periodNotes.id, existing.id))
        .returning()
        .get();
      return periodNoteDto(row);
    },
    { behavior: 'immediate' },
  );
}

// ─── Savings goals (D55, overlay) ───────────────────────────────────────────────────────────────

export function createGoal(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(savingsGoalInputSchema, body);
  return deps.database.db.transaction(
    (tx) =>
      tx
        .insert(savingsGoals)
        .values({
          name: input.name,
          targetCents: input.targetCents,
          targetDate: input.targetDate,
          sortOrder: nextSortOrder(tx, savingsGoals, savingsGoals.sortOrder),
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: savingsGoals.id })
        .get().id,
    { behavior: 'immediate' },
  );
}

export function updateGoal(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(savingsGoalInputSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(savingsGoals).where(eq(savingsGoals.id, id)).get();
      if (!stored) throw notFound('Goal', id);
      tx.update(savingsGoals)
        .set({
          name: input.name,
          targetCents: input.targetCents,
          targetDate: input.targetDate,
          note: input.note,
        })
        .where(eq(savingsGoals.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function deleteGoal(deps: MutationDeps, id: number): void {
  deps.database.db.transaction(
    (tx) => {
      const deleted = tx.delete(savingsGoals).where(eq(savingsGoals.id, id)).run().changes;
      if (deleted === 0) throw notFound('Goal', id);
    },
    { behavior: 'immediate' },
  );
}

/** POST /api/savings-goals/reorder: every goal id exactly once; the waterfall follows the list. */
export function reorderGoals(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const { ids } = parseWith(reorderSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = tx
        .select({ id: savingsGoals.id })
        .from(savingsGoals)
        .orderBy(asc(savingsGoals.id))
        .all();
      assertSameIds(
        ids,
        stored.map((g) => g.id),
        'goal',
      );
      ids.forEach((id, i) => {
        tx.update(savingsGoals)
          .set({ sortOrder: i + 1 })
          .where(eq(savingsGoals.id, id))
          .run();
      });
    },
    { behavior: 'immediate' },
  );
  return ids;
}
