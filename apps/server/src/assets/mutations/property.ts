// Property mutations (stage-4.md §4.2, §4.5 steps 3, 7 and 8, §3.4): properties and their
// valuations (the property's `current_value_cents`/`valuation_date` follow its latest entry),
// loans (one stored entry at create; the start fields give the log's start point, D66), the loan
// balance log (typed or default repayments) and the D67 offset links (replaced as a set; an account
// linked to another loan moves).
import {
  makeLoanBalancesInputSchema,
  makeLoanCreateSchema,
  makeLoanUpdateSchema,
  makePropertyCreateSchema,
  makePropertyUpdateSchema,
  makeValuationsInputSchema,
  loanBalanceEntryUpdateSchema,
  loanOffsetsInputSchema,
} from '@joinr/schema';
import {
  cashAccounts,
  loanBalanceEntries,
  loanOffsetLinks,
  loans,
  properties,
  propertyValuations,
} from '@joinr/schema/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { parseWith } from '../../errors';
import type { LoanRow, PropertyRow } from '../../investments/load';
import {
  assertNoImportRunning,
  lastEntry,
  latestByAsOf,
  nextSortOrder,
  normText,
  notFound,
  propertyHasLoan,
  sameDecimal,
  validation,
  type MutationDeps,
} from './common';

function loadProperty(tx: Tx, id: number): PropertyRow {
  const row = tx.select().from(properties).where(eq(properties.id, id)).get();
  if (!row) throw notFound('Property', id);
  return row;
}

function loadLoan(tx: Tx, id: number): LoanRow {
  const row = tx.select().from(loans).where(eq(loans.id, id)).get();
  if (!row) throw notFound('Loan', id);
  return row;
}

/** Sets the property's denormalised value from its latest valuation (its origin is kept). */
export function syncPropertyValue(tx: Tx, propertyId: number): void {
  const latest = latestByAsOf(
    tx.select().from(propertyValuations).where(eq(propertyValuations.propertyId, propertyId)).all(),
  );
  if (!latest) return;
  tx.update(properties)
    .set({ currentValueCents: latest.valueCents, valuationDate: latest.asOf })
    .where(eq(properties.id, propertyId))
    .run();
}

/** Sets the loan's denormalised balance from its latest entry (its origin is kept). */
export function syncLoanBalance(tx: Tx, loanId: number): void {
  const latest = latestByAsOf(
    tx.select().from(loanBalanceEntries).where(eq(loanBalanceEntries.loanId, loanId)).all(),
  );
  if (!latest) return;
  tx.update(loans)
    .set({ currentBalanceCents: latest.balanceCents, balanceAsOf: latest.asOf })
    .where(eq(loans.id, loanId))
    .run();
}

// ─── Properties ─────────────────────────────────────────────────────────────────────────────────

/** POST /api/property/properties: the property and its opening valuation, both `origin app`. */
export function createProperty(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makePropertyCreateSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const id = tx
        .insert(properties)
        .values({
          name: input.name,
          purchaseDate: input.purchaseDate,
          isPrimaryResidence: input.isPrimaryResidence,
          purchaseValueCents: input.purchaseValueCents,
          currentValueCents: input.valueCents,
          valuationDate: input.asOf,
          netRentToDateCents: input.netRentToDateCents,
          sortOrder: nextSortOrder(tx, properties, properties.sortOrder),
          archived: false,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: properties.id })
        .get().id;
      tx.insert(propertyValuations)
        .values({
          propertyId: id,
          asOf: input.asOf,
          valueCents: input.valueCents,
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

/** PUT /api/property/properties/:id: any change makes it `app`; a no-op save writes nothing. */
export function updateProperty(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(makePropertyUpdateSchema(deps.now), body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadProperty(tx, id);
      const changed =
        normText(stored.name) !== normText(input.name) ||
        stored.purchaseDate !== input.purchaseDate ||
        stored.isPrimaryResidence !== input.isPrimaryResidence ||
        stored.purchaseValueCents !== input.purchaseValueCents ||
        stored.netRentToDateCents !== input.netRentToDateCents ||
        normText(stored.note) !== normText(input.note);
      if (!changed) return;
      tx.update(properties)
        .set({
          name: input.name,
          purchaseDate: input.purchaseDate,
          isPrimaryResidence: input.isPrimaryResidence,
          purchaseValueCents: input.purchaseValueCents,
          netRentToDateCents: input.netRentToDateCents,
          note: input.note,
          origin: 'app',
        })
        .where(eq(properties.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/property/properties/:id: 409 while a loan references it; cascades valuations. */
export function deleteProperty(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadProperty(tx, id);
      const n = tx.select({ n: count() }).from(loans).where(eq(loans.propertyId, id)).get()?.n ?? 0;
      if (n > 0) throw propertyHasLoan(n);
      tx.delete(properties).where(eq(properties.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/property/valuations: upserts each `(property, asOf)` valuation (`origin app`; an
 * unchanged entry is not rewritten), then sets each property's value from its latest entry.
 * Returns the property ids in body order.
 */
export function saveValuations(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const input = parseWith(makeValuationsInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      for (const e of input.entries) {
        loadProperty(tx, e.propertyId);
        const existing = tx
          .select()
          .from(propertyValuations)
          .where(
            and(
              eq(propertyValuations.propertyId, e.propertyId),
              eq(propertyValuations.asOf, input.asOf),
            ),
          )
          .get();
        if (existing) {
          const note = e.note === undefined ? existing.note : e.note;
          if (existing.valueCents !== e.valueCents || normText(existing.note) !== normText(note)) {
            tx.update(propertyValuations)
              .set({ valueCents: e.valueCents, note, origin: 'app' })
              .where(eq(propertyValuations.id, existing.id))
              .run();
          }
        } else {
          tx.insert(propertyValuations)
            .values({
              propertyId: e.propertyId,
              asOf: input.asOf,
              valueCents: e.valueCents,
              note: e.note ?? null,
              origin: 'app',
              sheetRef: null,
            })
            .run();
        }
        syncPropertyValue(tx, e.propertyId);
      }
      return input.entries.map((e) => e.propertyId);
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/property/valuation-entries/:id: 409 for the only one. Returns the property id. */
export function deleteValuationEntry(deps: MutationDeps, id: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx.select().from(propertyValuations).where(eq(propertyValuations.id, id)).get();
      if (!entry) throw notFound('Valuation', id);
      const n =
        tx
          .select({ n: count() })
          .from(propertyValuations)
          .where(eq(propertyValuations.propertyId, entry.propertyId))
          .get()?.n ?? 0;
      if (n <= 1) throw lastEntry('property');
      tx.delete(propertyValuations).where(eq(propertyValuations.id, id)).run();
      if (entry.sheetRef !== null) markImportRowDeleted(tx, now);
      syncPropertyValue(tx, entry.propertyId);
      return entry.propertyId;
    },
    { behavior: 'immediate' },
  );
}

// ─── Loans (D66) ────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/property/loans: the loan and one stored entry, its current balance at `asOf` (both
 * `origin app`); no start entry (the start fields give the log's start point). 404 for an unknown
 * property.
 */
export function createLoan(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeLoanCreateSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      loadProperty(tx, input.propertyId);
      const id = tx
        .insert(loans)
        .values({
          propertyId: input.propertyId,
          name: input.name,
          lender: input.lender,
          startDate: input.startDate,
          interestPeriodsPerYear: input.compoundingPerYear,
          annualRate: input.annualRate,
          paymentCents: input.paymentCents,
          paymentFrequency: input.paymentFrequency,
          startBalanceCents: input.startBalanceCents,
          currentBalanceCents: input.balanceCents,
          balanceAsOf: input.asOf,
          paymentsPaidCents: null,
          paymentsPaidDerived: false,
          sortOrder: nextSortOrder(tx, loans, loans.sortOrder),
          archived: false,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: loans.id })
        .get().id;
      tx.insert(loanBalanceEntries)
        .values({
          loanId: id,
          asOf: input.asOf,
          balanceCents: input.balanceCents,
          repaymentsCents: null,
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
 * PUT /api/property/loans/:id: any change makes it `app` (a changed start or regular repayment
 * re-derives the log, D76; nothing else is written). 404 for an unknown property.
 */
export function updateLoan(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(makeLoanUpdateSchema(deps.now), body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadLoan(tx, id);
      loadProperty(tx, input.propertyId);
      const changed =
        stored.propertyId !== input.propertyId ||
        normText(stored.name) !== normText(input.name) ||
        normText(stored.lender) !== normText(input.lender) ||
        stored.startDate !== input.startDate ||
        stored.startBalanceCents !== input.startBalanceCents ||
        !sameDecimal(stored.annualRate, input.annualRate) ||
        stored.interestPeriodsPerYear !== input.compoundingPerYear ||
        stored.paymentCents !== input.paymentCents ||
        stored.paymentFrequency !== input.paymentFrequency ||
        normText(stored.note) !== normText(input.note);
      if (!changed) return;
      tx.update(loans)
        .set({
          propertyId: input.propertyId,
          name: input.name,
          lender: input.lender,
          startDate: input.startDate,
          startBalanceCents: input.startBalanceCents,
          annualRate: input.annualRate,
          interestPeriodsPerYear: input.compoundingPerYear,
          paymentCents: input.paymentCents,
          paymentFrequency: input.paymentFrequency,
          note: input.note,
          origin: 'app',
        })
        .where(eq(loans.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/property/loans/:id: cascades its entries and offset links. */
export function deleteLoan(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadLoan(tx, id);
      tx.delete(loans).where(eq(loans.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/property/loan-balances: upserts each `(loan, asOf)` entry (`origin app`; unchanged is
 * not rewritten; an omitted repayments figure or note keeps the stored one, null clears it back to
 * the default), then sets each loan's balance from its latest entry. Returns the loan ids.
 */
export function saveLoanBalances(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const input = parseWith(makeLoanBalancesInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      for (const e of input.entries) {
        loadLoan(tx, e.loanId);
        const existing = tx
          .select()
          .from(loanBalanceEntries)
          .where(
            and(eq(loanBalanceEntries.loanId, e.loanId), eq(loanBalanceEntries.asOf, input.asOf)),
          )
          .get();
        if (existing) {
          const repaymentsCents =
            e.repaymentsCents === undefined ? existing.repaymentsCents : e.repaymentsCents;
          const note = e.note === undefined ? existing.note : e.note;
          if (
            existing.balanceCents !== e.balanceCents ||
            existing.repaymentsCents !== repaymentsCents ||
            normText(existing.note) !== normText(note)
          ) {
            tx.update(loanBalanceEntries)
              .set({ balanceCents: e.balanceCents, repaymentsCents, note, origin: 'app' })
              .where(eq(loanBalanceEntries.id, existing.id))
              .run();
          }
        } else {
          tx.insert(loanBalanceEntries)
            .values({
              loanId: e.loanId,
              asOf: input.asOf,
              balanceCents: e.balanceCents,
              repaymentsCents: e.repaymentsCents ?? null,
              note: e.note ?? null,
              origin: 'app',
              sheetRef: null,
            })
            .run();
        }
        syncLoanBalance(tx, e.loanId);
      }
      return input.entries.map((e) => e.loanId);
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/property/loan-balance-entries/:id: the balance, repayments or note (the date is fixed);
 * a change makes the entry `app`. Returns the loan id.
 */
export function updateLoanBalanceEntry(deps: MutationDeps, id: number, body: unknown): number {
  const input = parseWith(loanBalanceEntryUpdateSchema, body);
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx.select().from(loanBalanceEntries).where(eq(loanBalanceEntries.id, id)).get();
      if (!entry) throw notFound('Loan balance entry', id);
      if (
        entry.balanceCents !== input.balanceCents ||
        entry.repaymentsCents !== input.repaymentsCents ||
        normText(entry.note) !== normText(input.note)
      ) {
        tx.update(loanBalanceEntries)
          .set({
            balanceCents: input.balanceCents,
            repaymentsCents: input.repaymentsCents,
            note: input.note,
            origin: 'app',
          })
          .where(eq(loanBalanceEntries.id, id))
          .run();
        syncLoanBalance(tx, entry.loanId);
      }
      return entry.loanId;
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/property/loan-balance-entries/:id: 409 for the only one. Returns the loan id. */
export function deleteLoanBalanceEntry(deps: MutationDeps, id: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx.select().from(loanBalanceEntries).where(eq(loanBalanceEntries.id, id)).get();
      if (!entry) throw notFound('Loan balance entry', id);
      const n =
        tx
          .select({ n: count() })
          .from(loanBalanceEntries)
          .where(eq(loanBalanceEntries.loanId, entry.loanId))
          .get()?.n ?? 0;
      if (n <= 1) throw lastEntry('loan');
      tx.delete(loanBalanceEntries).where(eq(loanBalanceEntries.id, id)).run();
      if (entry.sheetRef !== null) markImportRowDeleted(tx, now);
      syncLoanBalance(tx, entry.loanId);
      return entry.loanId;
    },
    { behavior: 'immediate' },
  );
}

// ─── Offsets (D67) ──────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/property/loans/:id/offsets: replaces the loan's links with the listed accounts (each
 * must be flagged Offset: 400 otherwise); an account linked to another loan moves to this one.
 */
export function putLoanOffsets(deps: MutationDeps, loanId: number, body: unknown): void {
  const input = parseWith(loanOffsetsInputSchema, body);
  deps.database.db.transaction(
    (tx) => {
      loadLoan(tx, loanId);
      if (input.accountIds.length > 0) {
        const offsets = new Set(
          tx
            .select({ id: cashAccounts.id })
            .from(cashAccounts)
            .where(and(inArray(cashAccounts.id, input.accountIds), eq(cashAccounts.isOffset, true)))
            .all()
            .map((a) => a.id),
        );
        const bad = input.accountIds.find((id) => !offsets.has(id));
        if (bad !== undefined) throw validation(`accountIds: ${bad} is not an offset account`);
      }
      const want = new Set(input.accountIds);
      const current = tx
        .select()
        .from(loanOffsetLinks)
        .where(eq(loanOffsetLinks.loanId, loanId))
        .all();
      for (const link of current) {
        if (!want.has(link.accountId)) {
          tx.delete(loanOffsetLinks).where(eq(loanOffsetLinks.accountId, link.accountId)).run();
        }
      }
      const linked = new Set(current.map((l) => l.accountId));
      for (const accountId of input.accountIds) {
        if (linked.has(accountId)) continue;
        tx.insert(loanOffsetLinks)
          .values({ accountId, loanId, origin: 'app', sheetRef: null })
          .onConflictDoUpdate({
            target: loanOffsetLinks.accountId,
            set: { loanId, origin: 'app', sheetRef: null },
          })
          .run();
      }
    },
    { behavior: 'immediate' },
  );
}
