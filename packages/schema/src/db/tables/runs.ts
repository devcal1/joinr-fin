// Run logs: workbook imports and scheduler jobs (§2.4).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { IMPORT_TRIGGERS, JOB_STATUSES, JOB_TRIGGERS, RUN_STATUSES } from '../../enums';
import { idColumn } from './common';

export const importRuns = sqliteTable(
  'import_runs',
  {
    id: idColumn(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
    trigger: text('trigger', { enum: IMPORT_TRIGGERS }).notNull(),
    /** Basename only. */
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    fileSize: integer('file_size').notNull(),
    workbookAsOf: text('workbook_as_of'),
    /** Basename only. */
    correctionsName: text('corrections_name'),
    correctionsSha256: text('corrections_sha256'),
    importerVersion: text('importer_version').notNull(),
    totalsJson: text('totals_json'),
    reportJson: text('report_json'),
    errorCode: text('error_code'),
    error: text('error'),
  },
  (t) => [index('import_runs_started_at_idx').on(t.startedAt)],
);

/** Scheduler log (Stage 5 snapshots and Stage 7 backups reuse it). */
export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: idColumn(),
    job: text('job').notNull(),
    trigger: text('trigger', { enum: JOB_TRIGGERS }).notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    detailJson: text('detail_json'),
    error: text('error'),
  },
  (t) => [index('job_runs_job_started_at_idx').on(t.job, t.startedAt)],
);
