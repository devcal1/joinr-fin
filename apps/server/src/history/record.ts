// Recording months (stage-5.md §4.5, FROZEN signature): `writeRecordedMonths` composes and inserts
// the named months in one IMMEDIATE transaction, with one audit `record` row each. Called only by
// the recorder's mutex (§4.6), which checks the import lock and refreshes prices first.
//
// 1. Re-check, in ascending month order, that no month is recorded (409 SNAPSHOT_EXISTS) and that
//    each is in `recordableMonths(snapshots, today)` (400), `today` being the server-local date of
//    `now`.
// 2. Per month: a fresh finance context inside the transaction (so it reads the months written
//    before it), `composeSnapshot` for that month at asOf = today, then `deriveSnapshotColumns` (the
//    stored derived columns agree with their inputs by construction), and an insert with
//    `run_date = today`, `recorded_at = now`, origin `app`, the source and revision 0; one audit
//    `record` row with the full row and the record context.
// 3. The source: the current month is always `recorded`; an earlier month is `late` when the
//    request says `late` (the scheduler's catch-up, D82) and `lookback` otherwise (a manual record).
import type { EngineSnapshot } from '@joinr/engine';
import {
  isoMonthOf,
  type IsoMonth,
  type MarketDataMode,
  type RecordTrigger,
  type SnapshotSource,
} from '@joinr/schema';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { createFinanceContext, type FinanceDeps } from '../cashflow/context';
import { HttpError } from '../errors';
import { localIsoDate } from '../investments/format';
import { NOT_RECORDABLE_MESSAGE, snapshotExistsMessage } from './constants';
import { engineSnapshots, figuresOf } from './inputs';

/** The record context stored in `snapshot_audit.detail_json` (§3.1, §4.4). */
export interface RecordDetail {
  pricesAsOf: string | null;
  marketMode: MarketDataMode;
  pricesRefreshed: boolean;
  pricesAgeMs: number | null;
  jobRunId: number | null;
}

/** One recorded month: the new snapshot row and its audit row. */
export interface RecordedMonth {
  id: number;
  periodMonth: IsoMonth;
  auditId: number;
}

/** The stored source of a recorded month (step 3). */
export function recordSourceOf(
  month: IsoMonth,
  currentMonth: IsoMonth,
  requested: 'recorded' | 'lookback' | 'late',
): Exclude<SnapshotSource, 'migrated'> {
  if (month === currentMonth) return 'recorded';
  return requested === 'late' ? 'late' : 'lookback';
}

/**
 * Step 1: throws 409 SNAPSHOT_EXISTS for a month already recorded and 400 for a month outside
 * `recordable`, checking the months in ascending order (`periodMonths.N` names the request index).
 */
export function assertRecordable(
  periodMonths: readonly IsoMonth[],
  stored: readonly Pick<EngineSnapshot, 'periodMonth' | 'runDate'>[],
  recordable: readonly IsoMonth[],
): void {
  const runDateOf = new Map(stored.map((s) => [s.periodMonth, s.runDate]));
  const allowed = new Set(recordable);
  const ordered = periodMonths
    .map((month, index) => ({ month, index }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.index - b.index));
  for (const { month, index } of ordered) {
    const runDate = runDateOf.get(month);
    if (runDate !== undefined) {
      throw new HttpError(409, snapshotExistsMessage(month, runDate), 'SNAPSHOT_EXISTS');
    }
    if (!allowed.has(month)) {
      throw new HttpError(
        400,
        `periodMonths.${index}: ${NOT_RECORDABLE_MESSAGE}`,
        'VALIDATION_ERROR',
      );
    }
  }
}

/**
 * Records the months (ascending) with today's run date; throws `HttpError`s for the §4.1 and 400
 * cases (a month not recordable, SNAPSHOT_EXISTS). Synchronous.
 */
export function writeRecordedMonths(
  deps: FinanceDeps,
  req: {
    periodMonths: readonly IsoMonth[];
    source: 'recorded' | 'lookback' | 'late';
    trigger: RecordTrigger;
    note: string | null;
    now: Date;
    detail: RecordDetail;
  },
): RecordedMonth[] {
  const today = localIsoDate(req.now);
  const currentMonth = isoMonthOf(today);
  const recordedAt = req.now.toISOString();
  // Every context of this record reads the same clock (the recorder's `now`, §4.6 item 4).
  const recordDeps: FinanceDeps = { ...deps, now: () => req.now };
  const months = [...new Set(req.periodMonths)].sort();
  const db = deps.database.db;
  return db.transaction(
    (tx) => {
      const stored = engineSnapshots(tx.select().from(snapshots).all());
      assertRecordable(req.periodMonths, stored, deps.engine.recordableMonths(stored, today));
      const out: RecordedMonth[] = [];
      for (const periodMonth of months) {
        // A fresh context per month: it sees the months written before it (their run date is
        // today, so the later months' windows are empty, §2.9).
        const ctx = createFinanceContext(recordDeps);
        const figures = ctx.compose(periodMonth);
        const previous = ctx.snapshots().at(-1);
        const derived = ctx.engine.deriveSnapshotColumns({
          figures,
          previousCashValueCents: previous === undefined ? undefined : previous.cashValueCents,
        });
        const inserted = tx
          .insert(snapshots)
          .values({
            ...figuresOf(figures),
            ...derived,
            runDate: today,
            periodMonth,
            source: recordSourceOf(periodMonth, currentMonth, req.source),
            recordedAt,
            origin: 'app',
            sheetRef: null,
            note: req.note,
            revision: 0,
          })
          .returning()
          .get();
        const auditId = tx
          .insert(snapshotAudit)
          .values({
            periodMonth,
            snapshotId: inserted.id,
            action: 'record',
            trigger: req.trigger,
            at: recordedAt,
            changesJson: null,
            snapshotJson: JSON.stringify(inserted),
            note: req.note,
            detailJson: JSON.stringify(req.detail),
          })
          .returning({ id: snapshotAudit.id })
          .get().id;
        out.push({ id: inserted.id, periodMonth, auditId });
      }
      return out;
    },
    { behavior: 'immediate' },
  );
}
