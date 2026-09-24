// Shared helpers for the importer tests (synthetic data only; never the owner's workbook or
// corrections file).
import type { CorrectionsFile, ReconciliationCheck, ReconciliationReport } from '@joinr/schema';
import type { JoinrDb } from '@joinr/schema/db';
import { importWorkbook, type ImportOptions, type ImportResult } from '../src/index';

export const FIXED_NOW = new Date('2026-03-21T01:02:03.000Z');

export function runImport(
  db: JoinrDb,
  bytes: Uint8Array,
  opts: Partial<ImportOptions> & { corrections?: CorrectionsFile | null } = {},
): ImportResult {
  return importWorkbook(db, {
    bytes,
    fileName: 'synthetic.xlsx',
    trigger: 'cli',
    now: () => FIXED_NOW,
    ...opts,
  });
}

export function reportOf(result: ImportResult): ReconciliationReport {
  if (result.status !== 'succeeded' || result.report === null) {
    throw new Error(`import failed: ${result.errorCode ?? '?'} ${result.error ?? ''}`);
  }
  return result.report;
}

export function checkById(report: ReconciliationReport, id: string): ReconciliationCheck {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

/** A compact view of the non-match checks, for assertion messages. */
export function problems(report: ReconciliationReport, statuses = ['unexplained']): string[] {
  return report.checks
    .filter((c) => statuses.includes(c.status))
    .map(
      (c) =>
        `${c.id} [${c.status}${c.reasonCode ? ` ${c.reasonCode}` : ''}] exp=${String(c.expected)} act=${String(c.actual)} ${c.reason ?? ''}`,
    );
}
