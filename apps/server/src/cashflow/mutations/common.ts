// Shared helpers for the Stage 3 mutations (stage-3.md §4.5 "Mutations"): the import-lock check,
// params, 404s, the "changed" comparison after normalising both sides, and sort orders. Every
// mutation runs in one synchronous `BEGIN IMMEDIATE` transaction.
import { idParamsSchema, IsoMonthSchema, type IsoMonth } from '@joinr/schema';
import { sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Db } from '../../db/database';
import type { Tx } from '../../db/queries/domain';
import { HttpError, parseWith } from '../../errors';
import { assertNoImportRunning } from '../../investments/mutations';
import type { SnapshotRow } from '../../investments/load';

export { assertNoImportRunning };

/** Mutation `:id`: the import-lock 409 comes before anything else, then 400 for a bad id. */
export function parseIdAfterLock(params: unknown): number {
  assertNoImportRunning();
  return parseWith(idParamsSchema, params).id;
}

const periodMonthParamsSchema = z.object({ periodMonth: IsoMonthSchema });

/** `:periodMonth` (400 when it is not `YYYY-MM`). */
export function parsePeriodMonth(params: unknown): IsoMonth {
  return parseWith(periodMonthParamsSchema, params).periodMonth;
}

export function notFound(what: string, id: number | string): HttpError {
  return new HttpError(404, `${what} ${id} not found`, 'NOT_FOUND');
}

export function validation(message: string): HttpError {
  return new HttpError(400, message, 'VALIDATION_ERROR');
}

/** Trimmed text with `''` → null: both sides of a "changed" comparison go through this. */
export function normText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** `1 + max(sort_order)` of a table (1 when empty). */
export function nextSortOrder(tx: Db | Tx, table: SQLiteTable, column: SQLiteColumn): number {
  const row = tx
    .select({ max: sql<number | null>`max(${column})` })
    .from(table)
    .get();
  return (row?.max ?? 0) + 1;
}

/** Snapshots in run-date order (then period). */
function byRunDate(snapshots: readonly SnapshotRow[]): SnapshotRow[] {
  return [...snapshots].sort((a, b) =>
    a.runDate !== b.runDate
      ? a.runDate < b.runDate
        ? -1
        : 1
      : a.periodMonth < b.periodMonth
        ? -1
        : a.periodMonth > b.periodMonth
          ? 1
          : 0,
  );
}

/**
 * The months of the CLOSED savings periods: every snapshot's month except the first snapshot's
 * (the baseline, §2.3). The provisional period's month is never a snapshot month.
 */
export function closedPeriodMonths(snapshots: readonly SnapshotRow[]): Set<IsoMonth> {
  return new Set(
    byRunDate(snapshots)
      .slice(1)
      .map((s) => s.periodMonth),
  );
}

/** The months of the recorded periods (every snapshot's month, the baseline included). */
export function recordedPeriodMonths(snapshots: readonly SnapshotRow[]): Set<IsoMonth> {
  return new Set(snapshots.map((s) => s.periodMonth));
}

export const NOT_A_RECORDED_PERIOD = 'periodMonth: not a recorded period';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 409 ACCOUNT_IN_USE (§4.1). */
export function accountInUse(rows: number): HttpError {
  return new HttpError(
    409,
    `This account is used by ${rows} budget ${plural(rows, 'row', 'rows')}; move ${plural(rows, 'it', 'them')} first`,
    'ACCOUNT_IN_USE',
  );
}

/** 409 STREAM_IN_USE (§4.1). */
export function streamInUse(deposits: number): HttpError {
  return new HttpError(
    409,
    `This stream has ${deposits} ${plural(deposits, 'deposit', 'deposits')}`,
    'STREAM_IN_USE',
  );
}

/** 409 LAST_BALANCE_ENTRY (§4.1). */
export function lastBalanceEntry(): HttpError {
  return new HttpError(409, 'An account keeps at least one balance', 'LAST_BALANCE_ENTRY');
}

/** A reorder body's ids must be exactly the given set (every id once; the schema checks repeats). */
export function assertSameIds(
  ids: readonly number[],
  expected: readonly number[],
  what: string,
): void {
  const want = new Set(expected);
  if (ids.length !== want.size || ids.some((id) => !want.has(id))) {
    throw validation(`ids: must list every ${what} exactly once`);
  }
}
