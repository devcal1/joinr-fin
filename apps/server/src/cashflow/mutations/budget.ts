// Budget mutations (stage-3.md §4.2, §4.5, §3.4, D54): items (kind `item` only), the automatic
// rows (category, account and the D54 manual investment amount; created on first save when
// missing, never deleted), the display order and the yearly expenses.
import {
  BUDGET_AUTO_KINDS,
  budgetAutoRowInputSchema,
  budgetItemInputSchema,
  reorderSchema,
  yearlyExpenseInputSchema,
  type BudgetAutoKind,
} from '@joinr/schema';
import { budgetItems, cashAccounts, yearlyExpenses } from '@joinr/schema/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { HttpError, parseWith } from '../../errors';
import type { BudgetItemRow } from '../../investments/load';
import { BUDGET_AUTO_ROW_NAMES } from '../constants';
import type { MutationDeps } from './cash';
import {
  assertNoImportRunning,
  assertSameIds,
  nextSortOrder,
  normText,
  notFound,
  validation,
} from './common';

export const AUTOMATIC_ROW_MESSAGE = 'id: an automatic row';
export const MANUAL_AMOUNT_MESSAGE = 'manualMonthlyCents: only the investment row takes an amount';

/** The account columns a chosen account writes (404 for an unknown account). */
function accountColumns(
  tx: Tx,
  accountId: number | null,
  stored: Pick<BudgetItemRow, 'cashAccountId' | 'accountName'> | null,
): { cashAccountId: number | null; accountName: string | null } {
  if (accountId !== null) {
    const account = tx
      .select({ id: cashAccounts.id, name: cashAccounts.name })
      .from(cashAccounts)
      .where(eq(cashAccounts.id, accountId))
      .get();
    if (!account) throw notFound('Account', accountId);
    return { cashAccountId: account.id, accountName: account.name };
  }
  // "No account": an unlinked row keeps its typed account text (a stale name stays visible in the
  // transfers until relinked); a linked row is unlinked.
  if (stored !== null && stored.cashAccountId === null) {
    return { cashAccountId: null, accountName: stored.accountName };
  }
  return { cashAccountId: null, accountName: null };
}

function loadRow(tx: Tx, id: number): BudgetItemRow {
  const row = tx.select().from(budgetItems).where(eq(budgetItems.id, id)).get();
  if (!row) throw notFound('Budget row', id);
  return row;
}

// ─── Items ──────────────────────────────────────────────────────────────────────────────────────

export function createItem(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(budgetItemInputSchema, body);
  return deps.database.db.transaction(
    (tx) =>
      tx
        .insert(budgetItems)
        .values({
          name: input.name,
          kind: 'item',
          monthlyCents: input.monthlyCents,
          category: input.category,
          ...accountColumns(tx, input.accountId, null),
          sortOrder: nextSortOrder(tx, budgetItems, budgetItems.sortOrder),
          reviewFlags: null,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: budgetItems.id })
        .get().id,
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/budget/items/:id (kind `item` only; an auto row → 400). A change makes the row `app`
 * and clears its review flags; a no-op save writes nothing. A linked row compares by account id
 * (a renamed account is not a change).
 */
export function updateItem(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(budgetItemInputSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadRow(tx, id);
      if (stored.kind !== 'item') throw validation(AUTOMATIC_ROW_MESSAGE);
      const account = accountColumns(tx, input.accountId, stored);
      const changed =
        normText(stored.name) !== input.name ||
        stored.monthlyCents !== input.monthlyCents ||
        normText(stored.category) !== input.category ||
        stored.cashAccountId !== account.cashAccountId;
      if (!changed) return;
      tx.update(budgetItems)
        .set({
          name: input.name,
          monthlyCents: input.monthlyCents,
          category: input.category,
          ...account,
          reviewFlags: null,
          origin: 'app',
        })
        .where(eq(budgetItems.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/budget/items/:id (items only; an auto row → 400). */
export function deleteItem(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadRow(tx, id);
      if (stored.kind !== 'item') throw validation(AUTOMATIC_ROW_MESSAGE);
      tx.delete(budgetItems).where(eq(budgetItems.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

/**
 * POST /api/budget/items/reorder: every `item` and `auto_yearly` id exactly once. The rows take
 * their existing sort orders in the new order (the investment and cash rows keep theirs); a row
 * whose position changes becomes `app` (a re-import would undo the order, D34).
 */
export function reorderItems(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const { ids } = parseWith(reorderSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const rows = tx
        .select()
        .from(budgetItems)
        .where(inArray(budgetItems.kind, ['item', 'auto_yearly']))
        .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.id))
        .all();
      assertSameIds(
        ids,
        rows.map((r) => r.id),
        'budget item and the yearly row',
      );
      let slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
      // Repeated sort orders cannot express an order: use consecutive values from the lowest.
      if (new Set(slots).size !== slots.length) slots = slots.map((_, i) => (slots[0] ?? 1) + i);
      const byId = new Map(rows.map((r) => [r.id, r]));
      ids.forEach((id, i) => {
        const slot = slots[i]!;
        if (byId.get(id)!.sortOrder === slot) return;
        tx.update(budgetItems)
          .set({ sortOrder: slot, origin: 'app' })
          .where(eq(budgetItems.id, id))
          .run();
      });
    },
    { behavior: 'immediate' },
  );
  return ids;
}

// ─── Automatic rows ─────────────────────────────────────────────────────────────────────────────

/** `:kind` of the automatic-row route: an automatic kind, else 404. */
export function parseAutoKind(params: unknown): BudgetAutoKind {
  const kind = (params as { kind?: unknown } | null)?.kind;
  if (typeof kind === 'string' && (BUDGET_AUTO_KINDS as readonly string[]).includes(kind)) {
    return kind as BudgetAutoKind;
  }
  throw new HttpError(404, 'No automatic budget row of this kind', 'NOT_FOUND');
}

/**
 * PUT /api/budget/auto/:kind: category and account, and the D54 amount for `auto_invest`
 * (`manualMonthlyCents` omitted keeps the stored amount; null clears it). The row is created on
 * first save when missing. Returns the row id.
 */
export function putAutoRow(deps: MutationDeps, params: unknown, body: unknown): number {
  assertNoImportRunning();
  const kind = parseAutoKind(params);
  const input = parseWith(budgetAutoRowInputSchema, body);
  if (input.manualMonthlyCents !== undefined && kind !== 'auto_invest') {
    throw validation(MANUAL_AMOUNT_MESSAGE);
  }
  return deps.database.db.transaction(
    (tx) => {
      const stored =
        tx
          .select()
          .from(budgetItems)
          .where(eq(budgetItems.kind, kind))
          .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.id))
          .limit(1)
          .get() ?? null;
      const account = accountColumns(tx, input.accountId, stored);
      if (stored === null) {
        return tx
          .insert(budgetItems)
          .values({
            name: BUDGET_AUTO_ROW_NAMES[kind],
            kind,
            monthlyCents: input.manualMonthlyCents ?? null,
            category: input.category,
            ...account,
            sortOrder: nextSortOrder(tx, budgetItems, budgetItems.sortOrder),
            reviewFlags: null,
            origin: 'app',
            sheetRef: null,
          })
          .returning({ id: budgetItems.id })
          .get().id;
      }
      const monthlyCents =
        input.manualMonthlyCents === undefined ? stored.monthlyCents : input.manualMonthlyCents;
      const changed =
        normText(stored.category) !== input.category ||
        stored.cashAccountId !== account.cashAccountId ||
        stored.monthlyCents !== monthlyCents;
      if (changed) {
        tx.update(budgetItems)
          .set({
            category: input.category,
            ...account,
            monthlyCents,
            reviewFlags: null,
            origin: 'app',
          })
          .where(eq(budgetItems.id, stored.id))
          .run();
      }
      return stored.id;
    },
    { behavior: 'immediate' },
  );
}

// ─── Yearly expenses ────────────────────────────────────────────────────────────────────────────

export function createYearlyExpense(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(yearlyExpenseInputSchema, body);
  return deps.database.db.transaction(
    (tx) =>
      tx
        .insert(yearlyExpenses)
        .values({
          name: input.name,
          annualCents: input.annualCents,
          sortOrder: nextSortOrder(tx, yearlyExpenses, yearlyExpenses.sortOrder),
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: yearlyExpenses.id })
        .get().id,
    { behavior: 'immediate' },
  );
}

export function updateYearlyExpense(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(yearlyExpenseInputSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(yearlyExpenses).where(eq(yearlyExpenses.id, id)).get();
      if (!stored) throw notFound('Yearly expense', id);
      if (normText(stored.name) === input.name && stored.annualCents === input.annualCents) return;
      tx.update(yearlyExpenses)
        .set({ name: input.name, annualCents: input.annualCents, origin: 'app' })
        .where(eq(yearlyExpenses.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function deleteYearlyExpense(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(yearlyExpenses).where(eq(yearlyExpenses.id, id)).get();
      if (!stored) throw notFound('Yearly expense', id);
      tx.delete(yearlyExpenses).where(eq(yearlyExpenses.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}
