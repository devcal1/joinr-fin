// Domain-data helpers for the import flow (stage-1.md §3.4, §4.8) and the D34 deletion marker
// (stage-2.md §3.3).
import { isPreferenceSettingKey, isSettingKey, isWorkbookSetting } from '@joinr/schema';
import {
  appMeta,
  DOMAIN_TABLES_DELETE_ORDER,
  importRuns,
  instruments,
  jobRuns,
  settings,
} from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { Db } from '../database';

/** A Drizzle transaction handle (the `tx` of `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The error recorded on runs that were still `running` when the server started. */
export const INTERRUPTED_ERROR = 'interrupted';
export const INTERRUPTED_CODE = 'INTERRUPTED';

/**
 * The app_meta key written when a row that came from the workbook (`sheet_ref` set) is deleted in
 * the app: `{"count": n, "lastAt": "<ISO>"}`. While it exists `hasAppData` is true, so a re-import
 * can no longer silently undo the deletion (D34).
 */
export const DELETED_IMPORT_ROWS_KEY = 'app_edits.deleted_import_rows';

/** The marker's value: how many workbook rows were deleted in the app, and when the last was. */
export interface DeletedImportRowsMarker {
  count: number;
  lastAt: string;
}

/** The marker, or null when absent. A malformed value reads as zero deletions so far. */
export function readAppEditMarker(db: Db | Tx): DeletedImportRowsMarker | null {
  const row = db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, DELETED_IMPORT_ROWS_KEY))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<Record<keyof DeletedImportRowsMarker, unknown>>;
    const count =
      typeof parsed.count === 'number' && Number.isSafeInteger(parsed.count) && parsed.count > 0
        ? parsed.count
        : 0;
    return { count, lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : '' };
  } catch {
    return { count: 0, lastAt: '' };
  }
}

/**
 * Records that a workbook row was deleted in the app: writes the marker, or adds one to its count.
 * Call it inside the deleting transaction.
 */
export function markImportRowDeleted(tx: Db | Tx, now: Date): void {
  const count = (readAppEditMarker(tx)?.count ?? 0) + 1;
  const lastAt = now.toISOString();
  const value = JSON.stringify({ count, lastAt } satisfies DeletedImportRowsMarker);
  tx.insert(appMeta)
    .values({ key: DELETED_IMPORT_ROWS_KEY, value, updatedAt: lastAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: lastAt } })
    .run();
}

/** Deletes the marker. Called after a committed, successful import (never after a dry run). */
export function clearAppEditMarker(db: Db | Tx): void {
  db.delete(appMeta).where(eq(appMeta.key, DELETED_IMPORT_ROWS_KEY)).run();
}

/** True when any imported/domain table (or instruments) holds a row. */
export function hasDomainData(db: Db): boolean {
  for (const table of [instruments, ...DOMAIN_TABLES_DELETE_ORDER]) {
    if (db.select().from(table).limit(1).all().length > 0) return true;
  }
  return false;
}

/**
 * True when any app-entered row (`origin = 'app'`) exists in the import-owned tables
 * (`DOMAIN_TABLES_DELETE_ORDER`, so the Stage 3 balance entries and deposits count automatically)
 * or instruments, when a WORKBOOK setting was edited in the app, or when the deletion marker exists
 * (a workbook row was deleted in the app). A re-import would undo these, so the upload route
 * refuses it (D34). An app-only setting (`savings.yearBasis`), the overlays (savings adjustments
 * and goals) and the dividend-events cache never count: an import never touches them
 * (stage-3.md §3.3 rule 2, §3.4). Stage 5 (stage-5.md §3.4): a recorded month counts (it is an
 * `origin app` row of `snapshots`); the snapshot audit log and the recorder's `app_meta` keys never
 * do, nor does an app edit of a preference key (`charts.*`, `features.*`: a re-import keeps it,
 * D95).
 */
export function hasAppData(db: Db | Tx): boolean {
  if (readAppEditMarker(db) !== null) return true;
  for (const table of [instruments, ...DOMAIN_TABLES_DELETE_ORDER]) {
    const row = db
      .select({ origin: table.origin })
      .from(table)
      .where(eq(table.origin, 'app'))
      .limit(1)
      .get();
    if (row) return true;
  }
  const appSettings = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.origin, 'app'))
    .all();
  return appSettings.some(
    (s) => isSettingKey(s.key) && isWorkbookSetting(s.key) && !isPreferenceSettingKey(s.key),
  );
}

/**
 * Marks import and job runs left `running` by a crash or restart as `failed` (`interrupted`).
 * Call once at start-up, before anything can start a new run.
 */
export function markInterruptedRuns(db: Db, now: Date): { importRuns: number; jobRuns: number } {
  const finishedAt = now.toISOString();
  return db.transaction((tx) => {
    const imports = tx
      .update(importRuns)
      .set({ status: 'failed', finishedAt, errorCode: INTERRUPTED_CODE, error: INTERRUPTED_ERROR })
      .where(eq(importRuns.status, 'running'))
      .run().changes;
    const jobs = tx
      .update(jobRuns)
      .set({ status: 'failed', finishedAt, error: INTERRUPTED_ERROR })
      .where(eq(jobRuns.status, 'running'))
      .run().changes;
    return { importRuns: imports, jobRuns: jobs };
  });
}
