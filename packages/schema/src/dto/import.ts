// Import run DTOs and the upload query (stage-1.md §3.2–3.4, frozen).
import { z } from 'zod';
import type { CheckStatus, ImportTrigger, RunStatus } from '../enums';
import type { ReconciliationReport } from './report';

export interface ImportRunSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  dryRun: boolean;
  trigger: ImportTrigger;
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  workbookAsOf: string | null;
  correctionsName: string | null;
  totals: Record<CheckStatus, number> | null;
  error: { code: string; message: string } | null;
}

export interface ImportRunDetail extends ImportRunSummary {
  report: ReconciliationReport | null;
}

export interface ImportRunsResponse {
  /** Newest first, at most 50. */
  runs: ImportRunSummary[];
  hasImportedData: boolean;
  /** True when any app-entered row (`origin = 'app'`) exists; a non-dry-run upload is then refused (D34). */
  hasAppData: boolean;
  inProgress: boolean;
}

const booleanString = z.enum(['true', 'false']);

/** `POST /api/import` query string. Unknown keys are ignored. */
export const importQuerySchema = z.object({
  dryRun: booleanString.optional(),
  confirmReplace: booleanString.optional(),
});
export type ImportQuery = z.output<typeof importQuerySchema>;

/** The `Content-Type`s `POST /api/import` accepts. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const IMPORT_CONTENT_TYPES = ['application/octet-stream', XLSX_MIME] as const;

/** The request header carrying the (URI-encoded) original file name. */
export const IMPORT_FILE_NAME_HEADER = 'x-file-name';
