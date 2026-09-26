// Corrections and deletes of recorded months (stage-5.md §4.5, D92). Each runs in one synchronous
// IMMEDIATE transaction inside the recorder's mutex (`app.recorder.withLock`); the routes check the
// import lock and parse the request before entering it (§4.2).
//
// A correction changes figures only (the identity trigger refuses anything else, §3.1): the named
// primary columns whose value differs from the stored one, then only the derived columns whose
// inputs changed, recomputed by `deriveSnapshotColumns` (a derived column whose inputs did not
// change keeps its stored value byte for byte, so imported ratio strings are never rewritten) and,
// when the cash value moved, the next snapshot's cash change and its ratio (O, P). The first
// snapshot's cash change (O) is a typed seed (§9.3 rule 1): it is never nulled; a corrected N
// shifts it by the same amount (the change from the month before the history), and P follows
// (Fixer round 1, SPEC-3 / CODE-1). The corrected row's revision goes up by one and its
// origin becomes `app` (a migrated row no longer matches the workbook, D34); one audit `correct`
// row records every before/after (the next row's keyed "YYYY-MM.column") and the reason. A
// correction that changes nothing writes nothing.
//
// A delete removes the latest snapshot in run-date order only, never a migrated one (D92), with an
// audit `delete` row holding the full row; no D34 marker (a recorded month has no sheet_ref). The
// month becomes recordable again.
import type { DerivedSnapshotColumns, EngineApi } from '@joinr/engine';
import {
  SNAPSHOT_OFFSET_EXTRAS,
  snapshotCorrectionSchema,
  type CorrectableSnapshotColumn,
  type IsoMonth,
  type SnapshotCorrection,
} from '@joinr/schema';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { snapshotsByRunDate } from '../assets/inputs';
import type { AppDatabase } from '../db/database';
import { HttpError, parseWith } from '../errors';
import type { SnapshotRow } from '../investments/load';
import type { AuditChange } from './audit';
import {
  EXTRA_ON_MIGRATED_MESSAGE,
  EXTRA_REQUIRED_MESSAGE,
  SNAPSHOT_NOT_DELETABLE_MESSAGE,
  SNAPSHOT_NOT_LATEST_MESSAGE,
  snapshotNotFoundMessage,
} from './constants';
import { figuresOf } from './inputs';

export interface HistoryMutationDeps {
  database: AppDatabase;
  engine: EngineApi;
}

/** The derived columns (§2.5) in a fixed order. */
const DERIVED_COLUMNS = [
  'stocksGainRatio',
  'etfGainRatio',
  'cryptoGainRatio',
  'cashGainCents',
  'cashIncreaseRatio',
  'superGainRatio',
  'propertyEquityCents',
  'propertyGainRatio',
  'mfGainRatio',
] as const satisfies readonly (keyof DerivedSnapshotColumns)[];

/**
 * The inputs of each derived column (§2.5; the ratio pairs are the engine's `RATIO_CHECKS`). A
 * derived column is recomputed only when one of its inputs is among the corrected columns; P also
 * follows a recomputed O.
 */
const DERIVED_INPUTS: Readonly<
  Record<(typeof DERIVED_COLUMNS)[number], readonly (keyof SnapshotRow)[]>
> = {
  stocksGainRatio: ['stocksGainCents', 'stocksValueCents'],
  etfGainRatio: ['etfGainCents', 'etfValueCents'],
  cryptoGainRatio: ['cryptoGainCents', 'cryptoValueCents'],
  cashGainCents: ['cashValueCents'],
  cashIncreaseRatio: ['cashGainCents', 'cashValueCents'],
  superGainRatio: ['superGainCents', 'superValueCents'],
  propertyEquityCents: ['propertyValueCents', 'mortgageBalanceCents', 'mortgageOffsetCents'],
  propertyGainRatio: ['propertyGainCents', 'propertyValueCents'],
  mfGainRatio: ['mfGainCents', 'mfValueCents'],
};

/**
 * The previous cash value to derive the FIRST snapshot's O and P against: the stored seed O read as
 * `N − the month before the history`, so a corrected N shifts O by the same amount. Undefined (O
 * stays null) when the stored O is null. When the stored N was null, the new N less the seed keeps
 * O as typed.
 */
function seedPreviousCash(row: SnapshotRow, newCash: number | null): number | undefined {
  if (row.cashGainCents === null) return undefined;
  if (row.cashValueCents !== null) return row.cashValueCents - row.cashGainCents;
  return newCash === null ? undefined : newCash - row.cashGainCents;
}

/** The next snapshot's columns that follow a corrected cash value (O, P). */
const NEXT_ROW_COLUMNS = ['cashGainCents', 'cashIncreaseRatio'] as const;

const EXTRAS: ReadonlySet<string> = new Set(SNAPSHOT_OFFSET_EXTRAS);

function notFound(month: IsoMonth): HttpError {
  return new HttpError(404, snapshotNotFoundMessage(month), 'NOT_FOUND');
}

/** The body of `PUT /api/history/snapshots/:periodMonth` (400 VALIDATION_ERROR when invalid). */
export function parseCorrection(body: unknown): SnapshotCorrection {
  return parseWith(snapshotCorrectionSchema, body);
}

/** The row-dependent rules of §4.3: the offset extras on a migrated row, or null elsewhere. */
export function assertExtrasAllowed(
  source: SnapshotRow['source'],
  values: SnapshotCorrection['values'],
): void {
  for (const [column, value] of Object.entries(values)) {
    if (!EXTRAS.has(column) || value === undefined) continue;
    if (source === 'migrated') {
      throw new HttpError(
        400,
        `values.${column}: ${EXTRA_ON_MIGRATED_MESSAGE}`,
        'VALIDATION_ERROR',
      );
    }
    if (value === null) {
      throw new HttpError(400, `values.${column}: ${EXTRA_REQUIRED_MESSAGE}`, 'VALIDATION_ERROR');
    }
  }
}

export interface CorrectionOutcome {
  /** The corrected month. */
  periodMonth: IsoMonth;
  /** The next snapshot in run-date order, or null. */
  nextMonth: IsoMonth | null;
  /** The audit row written; null when nothing changed (no audit row, no revision change). */
  auditId: number | null;
}

/** Applies a parsed correction (§4.5 "Corrections"). */
export function correctSnapshot(
  deps: HistoryMutationDeps,
  periodMonth: IsoMonth,
  correction: SnapshotCorrection,
  now: Date,
): CorrectionOutcome {
  return deps.database.db.transaction(
    (tx) => {
      const ordered = snapshotsByRunDate(tx.select().from(snapshots).all());
      const index = ordered.findIndex((r) => r.periodMonth === periodMonth);
      if (index < 0) throw notFound(periodMonth);
      const row = ordered[index]!;
      const previous = index > 0 ? ordered[index - 1]! : null;
      const next = ordered[index + 1] ?? null;
      assertExtrasAllowed(row.source, correction.values);

      // The named columns whose value differs from the stored one.
      const changed = new Map<CorrectableSnapshotColumn, number | null>();
      for (const [column, value] of Object.entries(correction.values) as [
        CorrectableSnapshotColumn,
        number | null | undefined,
      ][]) {
        if (value === undefined || row[column] === value) continue;
        changed.set(column, value);
      }
      const outcome = { periodMonth, nextMonth: next?.periodMonth ?? null };
      if (changed.size === 0) return { ...outcome, auditId: null };

      const changes: Record<string, AuditChange> = {};
      const set: Record<string, number | string | null> = {};
      for (const [column, value] of changed) {
        changes[column] = { before: row[column], after: value };
        set[column] = value;
      }
      const updated: SnapshotRow = {
        ...row,
        ...(Object.fromEntries(changed) as Partial<SnapshotRow>),
      };
      const cashChanged = changed.has('cashValueCents');
      const derived: DerivedSnapshotColumns = {
        ...deps.engine.deriveSnapshotColumns({
          figures: figuresOf(updated),
          previousCashValueCents:
            previous === null
              ? seedPreviousCash(row, updated.cashValueCents)
              : previous.cashValueCents,
        }),
      };
      // The first row's O is a seed: never nulled by a corrected N (P is then '0' by the sheet rule).
      if (previous === null && derived.cashGainCents === null) {
        derived.cashGainCents = row.cashGainCents;
      }
      for (const column of DERIVED_COLUMNS) {
        const inputs = DERIVED_INPUTS[column];
        const dependent =
          inputs.some((input) => changed.has(input as CorrectableSnapshotColumn)) ||
          (column === 'cashIncreaseRatio' && cashChanged);
        if (!dependent) continue;
        const after = derived[column];
        if (row[column] === after) continue;
        changes[column] = { before: row[column], after };
        set[column] = after;
      }
      tx.update(snapshots)
        .set({ ...set, revision: row.revision + 1, origin: 'app' })
        .where(eq(snapshots.id, row.id))
        .run();

      // The next month's cash change follows a corrected cash value (§4.5).
      if (next !== null && updated.cashValueCents !== row.cashValueCents) {
        const nextDerived = deps.engine.deriveSnapshotColumns({
          figures: figuresOf(next),
          previousCashValueCents: updated.cashValueCents,
        });
        const nextSet: Record<string, number | string | null> = {};
        for (const column of NEXT_ROW_COLUMNS) {
          const after = nextDerived[column];
          if (next[column] === after) continue;
          changes[`${next.periodMonth}.${column}`] = { before: next[column], after };
          nextSet[column] = after;
        }
        if (Object.keys(nextSet).length > 0) {
          tx.update(snapshots).set(nextSet).where(eq(snapshots.id, next.id)).run();
        }
      }

      const auditId = tx
        .insert(snapshotAudit)
        .values({
          periodMonth,
          snapshotId: row.id,
          action: 'correct',
          trigger: 'manual',
          at: now.toISOString(),
          changesJson: JSON.stringify(changes),
          snapshotJson: null,
          note: correction.note,
          detailJson: null,
        })
        .returning({ id: snapshotAudit.id })
        .get().id;
      return { ...outcome, auditId };
    },
    { behavior: 'immediate' },
  );
}

/** Deletes the latest app-recorded month (§4.5 "Deletes", D92); returns the audit row's id. */
export function deleteLatestSnapshot(
  deps: HistoryMutationDeps,
  periodMonth: IsoMonth,
  now: Date,
): number {
  return deps.database.db.transaction(
    (tx) => {
      const ordered = snapshotsByRunDate(tx.select().from(snapshots).all());
      const row = ordered.find((r) => r.periodMonth === periodMonth);
      if (!row) throw notFound(periodMonth);
      if (row.source === 'migrated') {
        throw new HttpError(409, SNAPSHOT_NOT_DELETABLE_MESSAGE, 'SNAPSHOT_NOT_DELETABLE');
      }
      if (ordered.at(-1) !== row) {
        throw new HttpError(409, SNAPSHOT_NOT_LATEST_MESSAGE, 'SNAPSHOT_NOT_LATEST');
      }
      tx.delete(snapshots).where(eq(snapshots.id, row.id)).run();
      return tx
        .insert(snapshotAudit)
        .values({
          periodMonth,
          // The row is gone (§3.1: null after a delete); snapshot_json keeps it.
          snapshotId: null,
          action: 'delete',
          trigger: 'manual',
          at: now.toISOString(),
          changesJson: null,
          snapshotJson: JSON.stringify(row),
          note: null,
          detailJson: null,
        })
        .returning({ id: snapshotAudit.id })
        .get().id;
    },
    { behavior: 'immediate' },
  );
}
