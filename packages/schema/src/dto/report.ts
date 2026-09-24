// The reconciliation report (stage-1.md §3.3, §4.9; frozen field list). Stored as
// `import_runs.report_json` and shown on the import report page.
import { z } from 'zod';
import {
  CHECK_STATUSES,
  REASON_CODES,
  REPORT_SECTIONS,
  REVIEW_FLAGS,
  type CheckStatus,
  type ReasonCode,
  type ReportSection,
  type ReviewFlag,
} from '../enums';
import { RECORD_ENTITY_IDS, type RecordEntityId } from '../records';

export const CHECK_UNITS = ['count', 'cents', 'units', 'ratio', 'date', 'text', 'none'] as const;
export type CheckUnit = (typeof CHECK_UNITS)[number];

export interface ReconciliationCheck {
  /** Stable across runs, e.g. 'movements.2026-02.crypto'. */
  id: string;
  section: ReportSection;
  label: string;
  sheetRef: string | null;
  unit: CheckUnit;
  /** Sheet side. */
  expected: string | number | null;
  /** App side (read back from the DB inside the import transaction). */
  actual: string | number | null;
  diff: string | number | null;
  status: CheckStatus;
  reasonCode: ReasonCode | null;
  reason: string | null;
  refs: {
    decision?: string;
    correctionId?: string;
    entity?: RecordEntityId;
    recordId?: number;
    flags?: ReviewFlag[];
  } | null;
}

export interface ReconciliationReport {
  version: 1;
  generatedAt: string;
  workbook: {
    fileName: string;
    sha256: string;
    sizeBytes: number;
    asOf: string | null;
    templateVersion: string | null;
  };
  corrections: { name: string | null; sha256: string | null; entries: number; applied: number };
  /** Rows written per entity. */
  counts: Partial<Record<RecordEntityId, number>>;
  totals: Record<CheckStatus, number>;
  checks: ReconciliationCheck[];
}

const scalar = z.union([z.string(), z.number()]).nullable();

export const ReconciliationCheckSchema = z.strictObject({
  id: z.string().min(1),
  section: z.enum(REPORT_SECTIONS),
  label: z.string(),
  sheetRef: z.string().nullable(),
  unit: z.enum(CHECK_UNITS),
  expected: scalar,
  actual: scalar,
  diff: scalar,
  status: z.enum(CHECK_STATUSES),
  reasonCode: z.enum(REASON_CODES).nullable(),
  reason: z.string().nullable(),
  refs: z
    .strictObject({
      decision: z.string().optional(),
      correctionId: z.string().optional(),
      entity: z.enum(RECORD_ENTITY_IDS).optional(),
      recordId: z.number().int().optional(),
      flags: z.array(z.enum(REVIEW_FLAGS)).optional(),
    })
    .nullable(),
});

const countField = z.number().int().min(0);

export const CheckTotalsSchema = z.strictObject({
  match: countField,
  explained: countField,
  unexplained: countField,
  suspect: countField,
  info: countField,
});

export const ReconciliationReportSchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.string(),
  workbook: z.strictObject({
    fileName: z.string(),
    sha256: z.string(),
    sizeBytes: z.number().int().min(0),
    asOf: z.string().nullable(),
    templateVersion: z.string().nullable(),
  }),
  corrections: z.strictObject({
    name: z.string().nullable(),
    sha256: z.string().nullable(),
    entries: countField,
    applied: countField,
  }),
  counts: z.partialRecord(z.enum(RECORD_ENTITY_IDS), countField),
  totals: CheckTotalsSchema,
  checks: z.array(ReconciliationCheckSchema),
});

/** Zeroed totals for every status. */
export function emptyCheckTotals(): Record<CheckStatus, number> {
  return { match: 0, explained: 0, unexplained: 0, suspect: 0, info: 0 };
}

/** Counts checks per status. */
export function totalsOf(checks: readonly Pick<ReconciliationCheck, 'status'>[]) {
  const totals = emptyCheckTotals();
  for (const check of checks) totals[check.status] += 1;
  return totals;
}
