// Domain-data helpers for the import flow (stage-1.md §3.4, §4.8).
import {
  DOMAIN_TABLES_DELETE_ORDER,
  importRuns,
  instruments,
  jobRuns,
  settings,
} from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { Db } from '../database';

/** The error recorded on runs that were still `running` when the server started. */
export const INTERRUPTED_ERROR = 'interrupted';
export const INTERRUPTED_CODE = 'INTERRUPTED';

/** True when any imported/domain table (or instruments) holds a row. */
export function hasDomainData(db: Db): boolean {
  for (const table of [instruments, ...DOMAIN_TABLES_DELETE_ORDER]) {
    if (db.select().from(table).limit(1).all().length > 0) return true;
  }
  return false;
}

/**
 * True when any app-entered row (`origin = 'app'`) exists in the domain tables, instruments or
 * settings. A re-import would replace these, so the upload route refuses it (D34).
 */
export function hasAppData(db: Db): boolean {
  for (const table of [instruments, settings, ...DOMAIN_TABLES_DELETE_ORDER]) {
    const row = db
      .select({ origin: table.origin })
      .from(table)
      .where(eq(table.origin, 'app'))
      .limit(1)
      .get();
    if (row) return true;
  }
  return false;
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
