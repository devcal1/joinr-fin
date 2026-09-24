// import_runs → the import DTOs (stage-1.md §3.3), plus recording runs the route rejects before the
// importer is called (an invalid corrections file).
import {
  CHECK_STATUSES,
  IMPORT_RUNS_LIST_CAP,
  type CheckStatus,
  type ImportRunDetail,
  type ImportRunSummary,
  type ImportTrigger,
  type ReconciliationReport,
} from '@joinr/schema';
import { importRuns } from '@joinr/schema/db';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../database';

type ImportRunRow = typeof importRuns.$inferSelect;

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `totals_json` → a count per CheckStatus (missing statuses count 0); null when absent/invalid. */
function parseTotals(text: string | null): Record<CheckStatus, number> | null {
  const value = parseJson(text);
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const totals = {} as Record<CheckStatus, number>;
  for (const status of CHECK_STATUSES) {
    const n = source[status];
    totals[status] = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }
  return totals;
}

export function toImportRunSummary(r: ImportRunRow): ImportRunSummary {
  return {
    id: r.id,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    dryRun: r.dryRun,
    trigger: r.trigger,
    fileName: r.fileName,
    fileSha256: r.fileSha256,
    fileSizeBytes: r.fileSize,
    workbookAsOf: r.workbookAsOf,
    correctionsName: r.correctionsName,
    totals: parseTotals(r.totalsJson),
    error:
      r.errorCode !== null || r.error !== null
        ? { code: r.errorCode ?? 'ERROR', message: r.error ?? '' }
        : null,
  };
}

export function toImportRunDetail(r: ImportRunRow): ImportRunDetail {
  const report = parseJson(r.reportJson);
  return {
    ...toImportRunSummary(r),
    report: typeof report === 'object' && report !== null ? (report as ReconciliationReport) : null,
  };
}

/** Newest first, at most IMPORT_RUNS_LIST_CAP. */
export function listImportRuns(db: Db): ImportRunSummary[] {
  return db
    .select()
    .from(importRuns)
    .orderBy(desc(importRuns.startedAt), desc(importRuns.id))
    .limit(IMPORT_RUNS_LIST_CAP)
    .all()
    .map(toImportRunSummary);
}

export function getImportRun(db: Db, id: number): ImportRunDetail | null {
  const r = db.select().from(importRuns).where(eq(importRuns.id, id)).get();
  return r ? toImportRunDetail(r) : null;
}

export interface FailedRunInput {
  now: Date;
  dryRun: boolean;
  trigger: ImportTrigger;
  fileName: string;
  fileSha256: string;
  fileSize: number;
  correctionsName: string | null;
  importerVersion: string;
  errorCode: string;
  error: string;
}

/** Records a run that failed before the importer ran (e.g. INVALID_CORRECTIONS); returns its id. */
export function recordFailedImportRun(db: Db, input: FailedRunInput): number {
  const at = input.now.toISOString();
  return db
    .insert(importRuns)
    .values({
      startedAt: at,
      finishedAt: at,
      status: 'failed',
      dryRun: input.dryRun,
      trigger: input.trigger,
      fileName: input.fileName,
      fileSha256: input.fileSha256,
      fileSize: input.fileSize,
      correctionsName: input.correctionsName,
      importerVersion: input.importerVersion,
      errorCode: input.errorCode,
      error: input.error,
    })
    .returning({ id: importRuns.id })
    .get().id;
}
