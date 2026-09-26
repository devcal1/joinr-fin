// Super mutations (stage-4.md §4.2, §4.5 steps 5–7, §3.4): funds (the SG-fund flag-only exception
// keeps `origin`; archiving needs a closing balance of 0; an app fund's opening balance is a
// transfer in unless it is a rollover), the D69 balance log (upsert by fund and as-of; the fund's
// `balance_cents`/`balance_as_of` follow its latest entry), typed contributions (D71) and SG
// statements (an overlay the import never touches and `hasAppData` never counts).
import {
  isoMonthOf,
  MIN_TRADE_DATE,
  makeSuperBalancesInputSchema,
  makeSuperContributionInputSchema,
  makeSuperFundCreateSchema,
  sgOverrideInputSchema,
  superFundUpdateSchema,
  type IsoDate,
  type IsoMonth,
} from '@joinr/schema';
import {
  snapshots,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
} from '@joinr/schema/db';
import { and, count, eq, inArray, max, ne } from 'drizzle-orm';
import { AFTER_THIS_MONTH } from '../../cashflow/mutations/cash';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { parseWith } from '../../errors';
import { displayDate, localIsoDate } from '../../investments/format';
import type { SuperEntryRow, SuperFundRow } from '../../investments/load';
import { SUPER_CONTRIBUTION_KINDS } from '../constants';
import { isContributionKind } from '../inputs';
import {
  assertNoImportRunning,
  fundInUse,
  lastEntry,
  latestByAsOf,
  nextSortOrder,
  normText,
  notFound,
  parsePeriodMonth,
  validation,
  type MutationDeps,
} from './common';

/** 400 when archiving a fund whose latest balance is not 0 (§4.5 step 5). */
export const ARCHIVE_NEEDS_ZERO = 'archived: enter a closing balance of $0 first';

/** 400 when an SG statement's month is before the entry-date floor (01/1900). */
export const SG_MONTH_TOO_EARLY = `periodMonth: must be on or after ${MIN_TRADE_DATE.slice(5, 7)}/${MIN_TRADE_DATE.slice(0, 4)}`;

/** 400 when deleting an entry would leave an archived fund with a non-zero latest balance. */
export const ARCHIVED_ENTRY_DELETE = 'archived: this fund is archived; unarchive it first';

/** The latest snapshot's run date (the last recorded month), or null without snapshots. */
function lastRunOf(tx: Tx): IsoDate | null {
  return (
    tx
      .select({ runDate: max(snapshots.runDate) })
      .from(snapshots)
      .get()?.runDate ?? null
  );
}

/**
 * 400 unless an archived fund's latest balance is 0 (§2.5 step 1: archiving never moves the
 * total, because the engine leaves archived funds out of it). Called inside the transaction after
 * the write, so the throw rolls the write back; a fund that is not archived passes.
 */
function assertArchivedFundAtZero(tx: Tx, fundId: number, message: string): void {
  const fund = tx.select().from(superFunds).where(eq(superFunds.id, fundId)).get();
  if (!fund?.archived) return;
  const latest = latestByAsOf(
    tx.select().from(superBalanceEntries).where(eq(superBalanceEntries.fundId, fundId)).all(),
  );
  if (latest !== null && latest.balanceCents !== 0) throw validation(message);
}

function loadFund(tx: Tx, id: number): SuperFundRow {
  const row = tx.select().from(superFunds).where(eq(superFunds.id, id)).get();
  if (!row) throw notFound('Fund', id);
  return row;
}

/** A member contribution (never a reported gain), else 404. */
function loadContribution(tx: Tx, id: number): SuperEntryRow {
  const row = tx.select().from(superEntries).where(eq(superEntries.id, id)).get();
  if (!row || !isContributionKind(row.kind)) throw notFound('Contribution', id);
  return row;
}

/** Sets the fund's denormalised balance from its latest entry (the fund's origin is kept). */
export function syncFundBalance(tx: Tx, fundId: number): void {
  const latest = latestByAsOf(
    tx.select().from(superBalanceEntries).where(eq(superBalanceEntries.fundId, fundId)).all(),
  );
  if (!latest) return;
  tx.update(superFunds)
    .set({ balanceCents: latest.balanceCents, balanceAsOf: latest.asOf })
    .where(eq(superFunds.id, fundId))
    .run();
}

/** Clears the SG flag on every other fund (their origin kept: the importer carries the flag). */
function clearOtherSgFunds(tx: Tx, fundId: number): void {
  tx.update(superFunds)
    .set({ receivesSg: false })
    .where(and(ne(superFunds.id, fundId), eq(superFunds.receivesSg, true)))
    .run();
}

/** Contributions (never reported gains) that name the fund. */
function contributionsOf(tx: Tx, fundId: number): number {
  return (
    tx
      .select({ n: count() })
      .from(superEntries)
      .where(
        and(
          eq(superEntries.fundId, fundId),
          inArray(superEntries.kind, [...SUPER_CONTRIBUTION_KINDS]),
        ),
      )
      .get()?.n ?? 0
  );
}

// ─── Funds ──────────────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/super/funds: the fund and its opening balance entry, both `origin app`. The opening
 * balance is money moved in from outside the tracked funds (a transfer in, never a gain) unless it
 * is a rollover from a fund on the page (§2.5 step 1). A non-rollover opening balance must be dated
 * after the last recorded month (400): a closed period's value is the stored History Q, which never
 * held the new fund, so a transfer in inside a closed window would read as a loss there and as a
 * gain in the provisional period (§4.5 step 5).
 */
export function createSuperFund(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeSuperFundCreateSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const lastRun = lastRunOf(tx);
      if (
        lastRun !== null &&
        !input.openingIsRollover &&
        input.openingBalanceCents > 0 &&
        input.asOf <= lastRun
      ) {
        throw validation(
          `asOf: date the opening balance after ${displayDate(lastRun)} (the last recorded month), or mark it a rollover`,
        );
      }
      const id = tx
        .insert(superFunds)
        .values({
          name: input.name,
          balanceCents: input.openingBalanceCents,
          balanceAsOf: input.asOf,
          sortOrder: nextSortOrder(tx, superFunds, superFunds.sortOrder),
          archived: false,
          receivesSg: input.receivesSg,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: superFunds.id })
        .get().id;
      if (input.receivesSg) clearOtherSgFunds(tx, id);
      tx.insert(superBalanceEntries)
        .values({
          fundId: id,
          asOf: input.asOf,
          balanceCents: input.openingBalanceCents,
          transferInCents:
            input.openingIsRollover || input.openingBalanceCents === 0
              ? null
              : input.openingBalanceCents,
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
 * PUT /api/super/funds/:id. A `receivesSg`-only change keeps `origin` (the importer carries the
 * flag by fund name, §3.5); a name or archived change makes the fund `app`; setting the flag clears
 * it on the others (their origin kept); archiving needs a latest balance of 0 (400).
 */
export function updateSuperFund(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(superFundUpdateSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadFund(tx, id);
      const sgChanged = stored.receivesSg !== input.receivesSg;
      const otherChanged =
        normText(stored.name) !== normText(input.name) || stored.archived !== input.archived;
      if (input.archived && !stored.archived) {
        const latest = latestByAsOf(
          tx.select().from(superBalanceEntries).where(eq(superBalanceEntries.fundId, id)).all(),
        );
        if ((latest?.balanceCents ?? stored.balanceCents) !== 0)
          throw validation(ARCHIVE_NEEDS_ZERO);
      }
      if (!sgChanged && !otherChanged) return;
      tx.update(superFunds)
        .set(
          otherChanged
            ? {
                name: input.name,
                archived: input.archived,
                receivesSg: input.receivesSg,
                origin: 'app' as const,
              }
            : { receivesSg: input.receivesSg },
        )
        .where(eq(superFunds.id, id))
        .run();
      if (input.receivesSg) clearOtherSgFunds(tx, id);
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/super/funds/:id: 409 while contributions name it; cascades its balance log. */
export function deleteSuperFund(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadFund(tx, id);
      const n = contributionsOf(tx, id);
      if (n > 0) throw fundInUse(n);
      tx.delete(superFunds).where(eq(superFunds.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

// ─── Balances (D69) ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/super/balances: upserts each `(fund, asOf)` entry (`origin app`; an unchanged entry is
 * not rewritten; an omitted transfer in or note keeps the stored one, null clears it), then sets
 * each fund's balance from its latest entry. Returns the fund ids in body order.
 * - 400 for a new or changed transfer in dated on or before the last recorded month on a fund
 *   created in the app (`sheetRef` null): in Stage 4 such a fund is in no stored History Q, so the
 *   transfer would distort a closed period's gain (§4.5 step 5). An imported fund keeps its
 *   closed-window transfers (its money was in the sheet's Q). Stage 5, which records months with
 *   app funds in them, revisits this rule.
 * - 400 when an archived fund's latest balance would no longer be 0 (§2.5 step 1).
 */
export function saveSuperBalances(deps: MutationDeps, body: unknown): number[] {
  assertNoImportRunning();
  const input = parseWith(makeSuperBalancesInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const lastRun = lastRunOf(tx);
      input.entries.forEach((e, i) => {
        const fund = loadFund(tx, e.fundId);
        const existing = tx
          .select()
          .from(superBalanceEntries)
          .where(
            and(eq(superBalanceEntries.fundId, e.fundId), eq(superBalanceEntries.asOf, input.asOf)),
          )
          .get();
        if (
          lastRun !== null &&
          input.asOf <= lastRun &&
          fund.sheetRef === null &&
          e.transferInCents !== undefined &&
          e.transferInCents !== null &&
          e.transferInCents > 0 &&
          e.transferInCents !== (existing?.transferInCents ?? null)
        ) {
          throw validation(
            `entries.${i}.transferInCents: date a transfer in after ${displayDate(lastRun)} (the last recorded month)`,
          );
        }
        if (existing) {
          const transferInCents =
            e.transferInCents === undefined ? existing.transferInCents : e.transferInCents;
          const note = e.note === undefined ? existing.note : e.note;
          if (
            existing.balanceCents !== e.balanceCents ||
            existing.transferInCents !== transferInCents ||
            normText(existing.note) !== normText(note)
          ) {
            tx.update(superBalanceEntries)
              .set({ balanceCents: e.balanceCents, transferInCents, note, origin: 'app' })
              .where(eq(superBalanceEntries.id, existing.id))
              .run();
          }
        } else {
          tx.insert(superBalanceEntries)
            .values({
              fundId: e.fundId,
              asOf: input.asOf,
              balanceCents: e.balanceCents,
              transferInCents: e.transferInCents ?? null,
              note: e.note ?? null,
              origin: 'app',
              sheetRef: null,
            })
            .run();
        }
        syncFundBalance(tx, e.fundId);
        assertArchivedFundAtZero(
          tx,
          e.fundId,
          `entries.${i}.balanceCents: this fund is archived; unarchive it first`,
        );
      });
      return input.entries.map((e) => e.fundId);
    },
    { behavior: 'immediate' },
  );
}

/**
 * DELETE /api/super/balance-entries/:id: 409 for a fund's only entry; 400 when it would leave an
 * archived fund with a latest balance other than 0. Returns the fund id.
 */
export function deleteSuperBalanceEntry(deps: MutationDeps, id: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx
        .select()
        .from(superBalanceEntries)
        .where(eq(superBalanceEntries.id, id))
        .get();
      if (!entry) throw notFound('Balance entry', id);
      const n =
        tx
          .select({ n: count() })
          .from(superBalanceEntries)
          .where(eq(superBalanceEntries.fundId, entry.fundId))
          .get()?.n ?? 0;
      if (n <= 1) throw lastEntry('fund');
      tx.delete(superBalanceEntries).where(eq(superBalanceEntries.id, id)).run();
      if (entry.sheetRef !== null) markImportRowDeleted(tx, now);
      syncFundBalance(tx, entry.fundId);
      assertArchivedFundAtZero(tx, entry.fundId, ARCHIVED_ENTRY_DELETE);
      return entry.fundId;
    },
    { behavior: 'immediate' },
  );
}

// ─── Contributions (D71) ────────────────────────────────────────────────────────────────────────

/** POST /api/super/contributions: a typed contribution (`origin app`); 404 for an unknown fund. */
export function createSuperContribution(deps: MutationDeps, body: unknown): number {
  assertNoImportRunning();
  const input = parseWith(makeSuperContributionInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      if (input.fundId !== null) loadFund(tx, input.fundId);
      return tx
        .insert(superEntries)
        .values({
          periodMonth: isoMonthOf(input.date),
          kind: input.kind,
          fundId: input.fundId,
          entryDate: input.date,
          amountCents: input.amountCents,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: superEntries.id })
        .get().id;
    },
    { behavior: 'immediate' },
  );
}

/**
 * PUT /api/super/contributions/:id: any change makes it `app`; an imported (untyped) entry saved
 * becomes the typed kind the body names (D71). A no-op save writes nothing.
 */
export function updateSuperContribution(deps: MutationDeps, id: number, body: unknown): void {
  const input = parseWith(makeSuperContributionInputSchema(deps.now), body);
  deps.database.db.transaction(
    (tx) => {
      const stored = loadContribution(tx, id);
      if (input.fundId !== null) loadFund(tx, input.fundId);
      const changed =
        stored.kind !== input.kind ||
        stored.fundId !== input.fundId ||
        stored.entryDate !== input.date ||
        stored.amountCents !== input.amountCents ||
        normText(stored.note) !== normText(input.note);
      if (!changed) return;
      tx.update(superEntries)
        .set({
          periodMonth: isoMonthOf(input.date),
          kind: input.kind,
          fundId: input.fundId,
          entryDate: input.date,
          amountCents: input.amountCents,
          note: input.note,
          origin: 'app',
        })
        .where(eq(superEntries.id, id))
        .run();
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/super/contributions/:id: the marker for a workbook entry. */
export function deleteSuperContribution(deps: MutationDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadContribution(tx, id);
      tx.delete(superEntries).where(eq(superEntries.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

// ─── SG statements (an overlay) ─────────────────────────────────────────────────────────────────

/**
 * PUT /api/super/sg/:periodMonth: the statement's SG for the month earned, upserted by month (an
 * overlay: written `origin app` but never scanned by `hasAppData`). 400 for a month after the as-of
 * month, or before 01/1900 (the entry-date floor; the engine's month arithmetic needs a 4-digit
 * year). Returns the month.
 */
export function putSgOverride(deps: MutationDeps, params: unknown, body: unknown): IsoMonth {
  assertNoImportRunning();
  const periodMonth = parsePeriodMonth(params);
  if (periodMonth < MIN_TRADE_DATE.slice(0, 7)) throw validation(SG_MONTH_TOO_EARLY);
  const input = parseWith(sgOverrideInputSchema, body);
  const asOfMonth = isoMonthOf(localIsoDate(deps.now()));
  if (periodMonth > asOfMonth) throw validation(AFTER_THIS_MONTH);
  deps.database.db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(superSgOverrides)
        .where(eq(superSgOverrides.periodMonth, periodMonth))
        .get();
      if (!existing) {
        tx.insert(superSgOverrides)
          .values({
            periodMonth,
            grossCents: input.grossCents,
            note: input.note,
            origin: 'app',
            sheetRef: null,
          })
          .run();
      } else if (
        existing.grossCents !== input.grossCents ||
        normText(existing.note) !== normText(input.note)
      ) {
        tx.update(superSgOverrides)
          .set({ grossCents: input.grossCents, note: input.note })
          .where(eq(superSgOverrides.id, existing.id))
          .run();
      }
    },
    { behavior: 'immediate' },
  );
  return periodMonth;
}

/** DELETE /api/super/sg/:periodMonth: 404 when the month has no statement (400 before 01/1900). */
export function deleteSgOverride(deps: MutationDeps, params: unknown): IsoMonth {
  assertNoImportRunning();
  const periodMonth = parsePeriodMonth(params);
  if (periodMonth < MIN_TRADE_DATE.slice(0, 7)) throw validation(SG_MONTH_TOO_EARLY);
  deps.database.db.transaction(
    (tx) => {
      const deleted = tx
        .delete(superSgOverrides)
        .where(eq(superSgOverrides.periodMonth, periodMonth))
        .run().changes;
      if (deleted === 0) throw notFound('SG statement for', periodMonth);
    },
    { behavior: 'immediate' },
  );
  return periodMonth;
}
