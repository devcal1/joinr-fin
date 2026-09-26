// importWorkbook() (stage-1.md §4.8): parse and extract (pure) → record the run → one
// transaction that replaces the imported data and reconciles it (rolled back for a dry run) →
// finish the run row. Never throws for workbook problems; returns a failed result instead.
import { createHash } from 'node:crypto';
import {
  totalsOf,
  type CorrectionsFile,
  type ImportTrigger,
  type ReconciliationReport,
} from '@joinr/schema';
import { importRuns, type JoinrDb } from '@joinr/schema/db';
import { eq, TransactionRollbackError } from 'drizzle-orm';
import { WorkbookFormatError } from './errors';
import {
  cryptoFeeRate,
  extractBudget,
  extractCash,
  extractDividends,
  extractInvestments,
  extractLiabilities,
  extractOtherAssets,
  extractProperty,
  extractSettings,
  extractSideIncome,
  extractSnapshots,
  extractSpareLiability,
  extractSuper,
  ExtractContext,
  readMeta,
  validateLayout,
} from './extract';
import type { WorkbookModel } from './model';
import {
  applyCorrections,
  buildInstruments,
  flagSuspects,
  linkBudgetAccounts,
  mergeNotes,
  rekeyDividends,
} from './process';
import { openWorkbook, type SheetReader } from './reader';
import { reconcile } from './reconcile';
import { writeModel } from './writer';

export const IMPORTER_VERSION: string = '1.0.0';

export interface ImportOptions {
  bytes: Uint8Array;
  fileName: string;
  trigger: ImportTrigger;
  corrections?: CorrectionsFile | null;
  correctionsSource?: { name: string; sha256: string } | null;
  dryRun?: boolean;
  now?: () => Date;
}

export interface ImportResult {
  runId: number;
  status: 'succeeded' | 'failed';
  dryRun: boolean;
  report: ReconciliationReport | null;
  errorCode: string | null;
  error: string | null;
}

/** Extracts every in-scope tab into the sheet model (pure; no DB). */
export function extractWorkbook(r: SheetReader, now: Date): WorkbookModel {
  validateLayout(r);
  const meta = readMeta(r, now);
  const ctx = new ExtractContext(r, meta.asOf);
  const settings = extractSettings(r, meta);
  const investments = extractInvestments(ctx, cryptoFeeRate(settings));
  const cash = extractCash(ctx);
  const side = extractSideIncome(ctx);
  const budget = extractBudget(ctx);
  const sup = extractSuper(ctx, meta);
  const property = extractProperty(ctx);
  const model: WorkbookModel = {
    meta,
    watch: investments.watch,
    ledger: investments.ledger,
    instruments: [],
    exclusions: [],
    dividends: extractDividends(ctx),
    cashAccounts: cash.accounts,
    notes: mergeNotes([...cash.notes, ...side.notes, ...sup.notes]),
    budgetItems: budget.items,
    yearlyExpenses: budget.yearly,
    streams: side.streams,
    sideIncome: side.deposits,
    otherAssets: extractOtherAssets(ctx),
    superFunds: sup.funds,
    superEntries: sup.entries,
    properties: property.properties,
    loans: [...property.loans, ...extractLiabilities(ctx), ...extractSpareLiability(ctx)],
    snapshots: extractSnapshots(ctx),
    settings,
    checks: ctx.checks,
  };
  return model;
}

/** The last path segment (either separator), at most 200 characters. */
function baseName(name: string): string {
  const last = name.split(/[\\/]/).pop()?.trim() ?? '';
  return (last === '' ? 'workbook.xlsx' : last).slice(0, 200);
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function importWorkbook(db: JoinrDb, options: ImportOptions): ImportResult {
  const now = options.now ?? (() => new Date());
  const started = now();
  const runStart = started.toISOString();
  const dryRun = options.dryRun ?? false;
  const fileName = baseName(options.fileName);
  const fileSha256 = sha256(options.bytes);
  const source = options.correctionsSource ?? null;
  const runId = Number(
    db
      .insert(importRuns)
      .values({
        startedAt: runStart,
        status: 'running',
        dryRun,
        trigger: options.trigger,
        fileName,
        fileSha256,
        fileSize: options.bytes.byteLength,
        correctionsName: source ? baseName(source.name) : null,
        correctionsSha256: source?.sha256 ?? null,
        importerVersion: IMPORTER_VERSION,
      })
      .run().lastInsertRowid,
  );

  try {
    const r = openWorkbook(options.bytes);
    const model = extractWorkbook(r, started);
    const corrections = options.corrections ?? null;
    const outcomes = applyCorrections(model, corrections);
    buildInstruments(model, model.checks);
    flagSuspects(model);
    rekeyDividends(model);
    linkBudgetAccounts(model);

    let report: ReconciliationReport | null = null;
    try {
      db.transaction((tx) => {
        const written = writeModel(tx, model, runStart);
        const rec = reconcile({ r, model, outcomes, written, tx });
        report = {
          version: 1,
          generatedAt: now().toISOString(),
          workbook: {
            fileName,
            sha256: fileSha256,
            sizeBytes: options.bytes.byteLength,
            asOf: model.meta.asOf,
            templateVersion: model.meta.templateVersion,
          },
          corrections: {
            name: source ? baseName(source.name) : null,
            sha256: source?.sha256 ?? null,
            entries: corrections?.corrections.length ?? 0,
            applied: outcomes.filter((o) => o.applied).length,
          },
          counts: rec.counts,
          totals: totalsOf(rec.checks),
          checks: rec.checks,
        };
        if (dryRun) tx.rollback();
      });
    } catch (err) {
      if (!(dryRun && err instanceof TransactionRollbackError)) throw err;
    }
    const final = report as ReconciliationReport | null;
    if (final === null) throw new Error('The import produced no report');
    db.update(importRuns)
      .set({
        status: 'succeeded',
        finishedAt: now().toISOString(),
        workbookAsOf: model.meta.asOf,
        totalsJson: JSON.stringify(final.totals),
        reportJson: JSON.stringify(final),
        // A server start during a CLI import may have marked this run INTERRUPTED meanwhile.
        errorCode: null,
        error: null,
      })
      .where(eq(importRuns.id, runId))
      .run();
    return { runId, status: 'succeeded', dryRun, report: final, errorCode: null, error: null };
  } catch (err) {
    const known = err instanceof WorkbookFormatError;
    const errorCode = known ? err.code : 'IMPORT_FAILED';
    const detail = err instanceof Error ? err.message.slice(0, 160) : 'unknown error';
    const error = known
      ? err.message
      : `The import failed unexpectedly (${detail}); no data was changed`;
    db.update(importRuns)
      .set({ status: 'failed', finishedAt: now().toISOString(), errorCode, error })
      .where(eq(importRuns.id, runId))
      .run();
    return { runId, status: 'failed', dryRun, report: null, errorCode, error };
  }
}
