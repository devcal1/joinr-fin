// Corrections and deletes through the routes (stage-5.md §4.2, §4.5, §7.4 step 4, D92) on the
// generic seed (three migrated months) with a FAKE engine: only changed columns are written, a no-op
// writes nothing, the corrected row's derived columns and the next row's cash change follow, the
// revision and origin, the audit before/after, the offset extras' row rules, the identity trigger,
// delete of the latest app-recorded month only (it becomes recordable again), the import-lock check
// before anything else, and every snapshot write inside the recorder's mutex. Generic values only.
import { engine as realEngine } from '@joinr/engine';
import type {
  CorrectionResponse,
  DeleteSnapshotResponse,
  HistoryPageResponse,
  RecordResponse,
} from '@joinr/schema';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { seedRecordedMonth } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineSnapshots, figuresOf } from '../../src/history/inputs';
import { writeRecordedMonths } from '../../src/history/record';
import { importLock } from '../../src/routes/import';
import {
  call,
  deriveRule,
  errorOf,
  hasAppDataOf,
  historyFakeEngine,
  NOW,
  sheetRatio,
  startApp,
  type TestApp,
} from './helpers';
import { fakeMarket } from '../investments/helpers';

let ctx: TestApp;
let withLock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const engine = historyFakeEngine();
  ctx = await startApp({ engine });
  // Count the mutex's uses (the recorder's own lock runs the function).
  const original = ctx.app.recorder.withLock.bind(ctx.app.recorder);
  withLock = vi.fn(<T>(fn: () => T) => original(fn));
  ctx.app.recorder.withLock = withLock as typeof ctx.app.recorder.withLock;
  // A manual record through the real writer (the recorder's price wait is its own owner's).
  ctx.app.recorder.record = async (req) =>
    writeRecordedMonths(
      { database: ctx.database, market: fakeMarket(), engine, now: () => NOW },
      {
        periodMonths: req.periodMonths,
        source: 'lookback',
        trigger: 'manual',
        note: req.note,
        now: NOW,
        detail: {
          pricesAsOf: null,
          marketMode: 'off',
          pricesRefreshed: false,
          pricesAgeMs: null,
          jobRunId: null,
        },
      },
    );
});
afterEach(async () => {
  importLock.release();
  await ctx.close();
});

const db = () => ctx.database.db;
const row = (month: string) =>
  db().select().from(snapshots).where(eq(snapshots.periodMonth, month)).get()!;
const auditRows = () => db().select().from(snapshotAudit).all();

function correct(month: string, values: Record<string, number | null>, note = 'Bank statement') {
  return call<CorrectionResponse>(ctx.app, {
    method: 'PUT',
    url: `/api/history/snapshots/${month}`,
    payload: { values, note },
  });
}
const remove = (month: string) =>
  call<DeleteSnapshotResponse>(ctx.app, {
    method: 'DELETE',
    url: `/api/history/snapshots/${month}`,
  });

describe('corrections (§4.5 "Corrections")', () => {
  it('writes the changed column, re-derives the row and the next row’s cash change', async () => {
    const before = row('2026-06');
    const next = row('2026-07');
    const res = await correct('2026-06', { cashValueCents: before.cashValueCents! + 10000 });
    expect(res.status).toBe(200);
    const after = row('2026-06');
    expect(after).toMatchObject({
      cashValueCents: before.cashValueCents! + 10000,
      revision: 1,
      origin: 'app',
      runDate: before.runDate,
      source: 'migrated',
    });
    // Derived: O against May's cash, P from the new O and N.
    expect(after.cashGainCents).toBe(after.cashValueCents! - row('2026-05').cashValueCents!);
    // The next month's cash change follows; nothing else of it moves and it stays imported.
    const nextAfter = row('2026-07');
    expect(nextAfter.cashGainCents).toBe(next.cashValueCents! - after.cashValueCents!);
    expect(nextAfter).toMatchObject({
      revision: 0,
      origin: 'import',
      etfGainRatio: next.etfGainRatio,
    });

    const audit = auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      periodMonth: '2026-06',
      snapshotId: before.id,
      action: 'correct',
      trigger: 'manual',
      note: 'Bank statement',
      at: NOW.toISOString(),
    });
    const changes = JSON.parse(audit[0]!.changesJson!) as Record<string, unknown>;
    expect(changes.cashValueCents).toEqual({
      before: before.cashValueCents,
      after: before.cashValueCents! + 10000,
    });
    expect(changes['2026-07.cashGainCents']).toEqual({
      before: next.cashGainCents,
      after: nextAfter.cashGainCents,
    });
    expect(changes['2026-07.cashIncreaseRatio']).toMatchObject({ before: next.cashIncreaseRatio });

    // The response: the corrected month, the next month and the audit entry.
    expect(res.body.snapshot).toMatchObject({ periodMonth: '2026-06', revision: 1, origin: 'app' });
    expect(res.body.next?.periodMonth).toBe('2026-07');
    expect(res.body.audit).toMatchObject({
      id: audit[0]!.id,
      action: 'correct',
      note: 'Bank statement',
    });
    expect(res.body.audit.changes[0]).toEqual({
      key: 'cashValueCents',
      before: before.cashValueCents,
      after: before.cashValueCents! + 10000,
    });
    // A corrected migrated month is app data (D34).
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    expect(withLock).toHaveBeenCalledTimes(1);
  });

  it('drops values equal to the stored ones; nothing left → no audit row, no revision change', async () => {
    const before = row('2026-06');
    const res = await correct('2026-06', { etfValueCents: before.etfValueCents });
    expect(res.status).toBe(200);
    expect(row('2026-06')).toEqual(before);
    expect(auditRows()).toHaveLength(0);
    expect(res.body.audit).toMatchObject({ id: 0, changes: [], note: 'Bank statement' });
    expect(await hasAppDataOf(ctx.app)).toBe(false);

    await correct('2026-06', { etfValueCents: before.etfValueCents, stocksGainCents: 1234 });
    const changes = JSON.parse(auditRows()[0]!.changesJson!) as Record<string, unknown>;
    expect(Object.keys(changes)).toContain('stocksGainCents');
    expect(Object.keys(changes)).not.toContain('etfValueCents');
  });

  it('null clears a cell (and its ratio follows the sheet rule)', async () => {
    await correct('2026-07', { cryptoGainCents: null });
    expect(row('2026-07')).toMatchObject({ cryptoGainCents: null, cryptoGainRatio: '0' });
  });

  it('the offset extras: refused on an imported month, required on a recorded one', async () => {
    const migrated = await correct('2026-07', { offsetCents: 1000 });
    expect(migrated.status).toBe(400);
    expect(errorOf(migrated.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'values.offsetCents: not recorded for imported months',
    });
    seedRecordedMonth(db(), { periodMonth: '2026-08', runDate: '2026-08-31' });
    const cleared = await correct('2026-08', { cashDebtCents: null });
    expect(cleared.status).toBe(400);
    expect(errorOf(cleared.body).message).toBe('values.cashDebtCents: required');
    const ok = await correct('2026-08', { cashDebtCents: -50000, offsetCents: 1600000 });
    expect(ok.status).toBe(200);
    expect(row('2026-08')).toMatchObject({
      cashDebtCents: -50000,
      offsetCents: 1600000,
      revision: 1,
    });
    // The savings seam is unchanged: the migrated rows still have no offset figure.
    expect(row('2026-07').offsetCents).toBeNull();
  });

  it('validates the body, the month and the reason', async () => {
    expect((await correct('2026-07', { mortgageBalanceCents: 5 })).status).toBe(400);
    expect((await correct('2026-07', {})).status).toBe(400);
    const noReason = await correct('2026-07', { cashValueCents: 1 }, '  ');
    expect(errorOf(noReason.body).message).toBe('note: say why');
    const bad = await correct('2026-7', { cashValueCents: 1 });
    expect(bad.status).toBe(400);
    const missing = await correct('2026-01', { cashValueCents: 1 });
    expect(missing.status).toBe(404);
    expect(errorOf(missing.body)).toEqual({
      code: 'NOT_FOUND',
      message: 'Jan 2026 is not recorded',
    });
  });

  it('the identity trigger refuses a run-date change at the database level', () => {
    expect(() =>
      ctx.database.sqlite.exec(
        "UPDATE snapshots SET run_date = '2026-07-30' WHERE period_month = '2026-07'",
      ),
    ).toThrow(/snapshot identity is immutable/);
  });
});

describe('deletes (§4.5 "Deletes", D92)', () => {
  it('refuses an imported month and a month that is not the latest', async () => {
    const imported = await remove('2026-07');
    expect(imported.status).toBe(409);
    expect(errorOf(imported.body)).toEqual({
      code: 'SNAPSHOT_NOT_DELETABLE',
      message: 'Imported months can be corrected but not deleted',
    });
    seedRecordedMonth(db(), { periodMonth: '2026-08', runDate: '2026-08-31' });
    seedRecordedMonth(db(), { periodMonth: '2026-09', runDate: '2026-09-24' });
    const older = await remove('2026-08');
    expect(older.status).toBe(409);
    expect(errorOf(older.body)).toEqual({
      code: 'SNAPSHOT_NOT_LATEST',
      message: 'Only the latest recorded month can be deleted',
    });
    expect((await remove('2025-01')).status).toBe(404);
  });

  it('deletes the latest recorded month with an audit copy; it becomes recordable again', async () => {
    const rec = await call<RecordResponse>(ctx.app, {
      method: 'POST',
      url: '/api/history/record',
      payload: { periodMonths: ['2026-08'], note: 'E2E-like note' },
    });
    expect(rec.status).toBe(201);
    expect(rec.body.hasAppData).toBe(true);
    const stored = row('2026-08');
    const res = await remove('2026-08');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ periodMonth: '2026-08', hasAppData: false });
    expect(res.body.audit).toMatchObject({
      action: 'delete',
      periodMonth: '2026-08',
      trigger: 'manual',
    });
    expect(
      db().select().from(snapshots).where(eq(snapshots.periodMonth, '2026-08')).get(),
    ).toBeUndefined();
    const audit = auditRows();
    expect(audit.map((a) => a.action)).toEqual(['record', 'delete']);
    expect(audit[1]!.snapshotId).toBeNull();
    expect(JSON.parse(audit[1]!.snapshotJson!)).toEqual(stored);
    // No D34 marker: a recorded month has no sheet_ref.
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const page = await call<HistoryPageResponse>(ctx.app, { method: 'GET', url: '/api/history' });
    expect(page.body.record.recordable).toContain('2026-08');
    expect(page.body.audit.map((a) => a.action)).toEqual(['delete', 'record']);
  });

  it('for months sharing a run date, the latest month is the deletable one', async () => {
    seedRecordedMonth(db(), { periodMonth: '2026-08', runDate: '2026-09-24' });
    seedRecordedMonth(db(), { periodMonth: '2026-09', runDate: '2026-09-24' });
    expect((await remove('2026-08')).status).toBe(409);
    expect((await remove('2026-09')).status).toBe(200);
    expect((await remove('2026-08')).status).toBe(200);
  });
});

describe('the import lock comes first; every write is inside the mutex (§4.2)', () => {
  it('PUT, DELETE and POST answer 409 IMPORT_IN_PROGRESS before validating anything', async () => {
    expect(importLock.tryAcquire()).toBe(true);
    const put = await call(ctx.app, {
      method: 'PUT',
      url: '/api/history/snapshots/bad',
      payload: {},
    });
    const del = await call(ctx.app, { method: 'DELETE', url: '/api/history/snapshots/bad' });
    const post = await call(ctx.app, { method: 'POST', url: '/api/history/record', payload: {} });
    for (const res of [put, del, post]) {
      expect(res.status).toBe(409);
      expect(errorOf(res.body).code).toBe('IMPORT_IN_PROGRESS');
    }
    expect(withLock).not.toHaveBeenCalled();
  });

  it('a delete runs inside the recorder’s mutex; a refused one writes nothing', async () => {
    await remove('2026-07');
    expect(withLock).toHaveBeenCalledTimes(1);
    expect(auditRows()).toHaveLength(0);
  });
});

// ─── Fixer round 1 (SPEC-3, CODE-1, CODE-6) ─────────────────────────────────────────────────────

/** A generic typed seed for the first month's cash change (History O). */
const SEED_O = 40000;

/**
 * Makes the seed's stored derived columns follow §2.5 (the generic seed's migrated ratios are
 * hand-typed) and gives the first month a typed O seed, so the real engine's check starts clean.
 */
function consistentSeed(): void {
  const ordered = db()
    .select()
    .from(snapshots)
    .all()
    .sort((a, b) => a.runDate.localeCompare(b.runDate));
  ordered.forEach((r, k) => {
    const prev = k === 0 ? r.cashValueCents! - SEED_O : ordered[k - 1]!.cashValueCents;
    const derived = deriveRule({ figures: figuresOf(r), previousCashValueCents: prev });
    db().update(snapshots).set(derived).where(eq(snapshots.id, r.id)).run();
  });
}

/** The real engine's derived differences over every stored snapshot ("YYYY-MM.column"). */
function derivedDifferences(): string[] {
  const rows = db().select().from(snapshots).all();
  const result = realEngine.checkSnapshots({
    snapshots: engineSnapshots(rows),
    trades: { stock: [], etf: [], crypto: [], managed_fund: [] },
  });
  return result.rows.flatMap((r) =>
    r.differences.filter((d) => d.kind === 'derived').map((d) => `${r.periodMonth}.${d.column}`),
  );
}

const auditKeys = () => Object.keys(JSON.parse(auditRows().at(-1)!.changesJson!) as object);

describe('corrections recompute only the derived columns whose inputs changed (SPEC-3, CODE-1)', () => {
  beforeEach(() => {
    consistentSeed();
    expect(derivedDifferences()).toEqual([]);
  });

  it('an unrelated figure on the first month keeps its O seed and P byte-identical', async () => {
    const before = row('2026-05');
    expect(before.cashGainCents).toBe(SEED_O);
    const res = await correct('2026-05', { stocksValueCents: before.stocksValueCents! + 5000 });
    expect(res.status).toBe(200);
    const after = row('2026-05');
    expect(after.cashGainCents).toBe(before.cashGainCents);
    expect(after.cashIncreaseRatio).toBe(before.cashIncreaseRatio);
    expect(after.stocksGainRatio).not.toBe(before.stocksGainRatio);
    expect(auditKeys().sort()).toEqual(['stocksGainRatio', 'stocksValueCents']);
    expect(derivedDifferences()).toEqual([]);
  });

  it('a corrected N on the first month shifts its O seed by the same amount; P follows', async () => {
    const before = row('2026-05');
    const next = row('2026-06');
    const res = await correct('2026-05', { cashValueCents: before.cashValueCents! + 7000 });
    expect(res.status).toBe(200);
    const after = row('2026-05');
    expect(after.cashGainCents).toBe(SEED_O + 7000);
    expect(after.cashIncreaseRatio).toBe(sheetRatio(SEED_O + 7000, after.cashValueCents));
    // The next month's O is its N less the new N.
    expect(row('2026-06').cashGainCents).toBe(next.cashValueCents! - after.cashValueCents!);
    expect(auditKeys().sort()).toEqual([
      '2026-06.cashGainCents',
      '2026-06.cashIncreaseRatio',
      'cashGainCents',
      'cashIncreaseRatio',
      'cashValueCents',
    ]);
    expect(derivedDifferences()).toEqual([]);
  });

  it('N corrected to null on the first month keeps the O seed (P is 0 by the sheet rule)', async () => {
    await correct('2026-05', { cashValueCents: null });
    expect(row('2026-05')).toMatchObject({ cashGainCents: SEED_O, cashIncreaseRatio: '0' });
  });

  it('a first month with no O seed keeps a null O', async () => {
    db()
      .update(snapshots)
      .set({ cashGainCents: null, cashIncreaseRatio: '0' })
      .where(eq(snapshots.periodMonth, '2026-05'))
      .run();
    await correct('2026-05', { cashValueCents: row('2026-05').cashValueCents! + 100 });
    expect(row('2026-05')).toMatchObject({ cashGainCents: null, cashIncreaseRatio: '0' });
  });

  it('on a migrated middle month, hand-typed ratios that match stay byte-identical', async () => {
    // A ratio typed with fewer digits than the sheet rule's: it passes the §2.5 match rule.
    const typed = '0.07382550336';
    const m = row('2026-06');
    expect(sheetRatio(m.stocksGainCents, m.stocksValueCents)).not.toBe(typed);
    db()
      .update(snapshots)
      .set({ stocksGainRatio: typed })
      .where(eq(snapshots.periodMonth, '2026-06'))
      .run();
    expect(derivedDifferences()).toEqual([]);
    const before = row('2026-06');
    const res = await correct('2026-06', { otherGainCents: before.otherGainCents! + 100 });
    expect(res.status).toBe(200);
    const after = row('2026-06');
    for (const column of [
      'stocksGainRatio',
      'etfGainRatio',
      'cryptoGainRatio',
      'cashGainCents',
      'cashIncreaseRatio',
      'superGainRatio',
      'propertyEquityCents',
      'propertyGainRatio',
      'mfGainRatio',
    ] as const) {
      expect(after[column]).toBe(before[column]);
    }
    expect(after.stocksGainRatio).toBe(typed);
    expect(auditKeys()).toEqual(['otherGainCents']);
    expect(derivedDifferences()).toEqual([]);
  });

  it('a corrected mortgage balance recomputes the equity (Z) and nothing else', async () => {
    const before = row('2026-07');
    await correct('2026-07', { mortgageBalanceCents: before.mortgageBalanceCents! - 1000 });
    const after = row('2026-07');
    expect(after.propertyEquityCents).toBe(before.propertyEquityCents! - 1000);
    expect(auditKeys().sort()).toEqual(['mortgageBalanceCents', 'propertyEquityCents']);
    expect(derivedDifferences()).toEqual([]);
  });
});

describe('a failure part-way through a correction rolls everything back (CODE-6)', () => {
  it('the next row’s derivation throws: both rows and the audit log are unchanged', async () => {
    await ctx.close();
    let armed = false;
    let calls = 0;
    ctx = await startApp({
      engine: historyFakeEngine({
        deriveSnapshotColumns: (i) => {
          if (armed) {
            calls += 1;
            if (calls === 2) throw new Error('derive failed');
          }
          return deriveRule(i);
        },
      }),
    });
    const before = row('2026-06');
    const next = row('2026-07');
    armed = true;
    const res = await correct('2026-06', { cashValueCents: before.cashValueCents! + 10000 });
    expect(res.status).toBe(500);
    expect(calls).toBe(2);
    expect(row('2026-06')).toEqual(before);
    expect(row('2026-07')).toEqual(next);
    expect(auditRows()).toHaveLength(0);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});

describe('the record body always carries `note` (SPEC-4; §4.3 optionalText(200))', () => {
  it('a body without `note` is 400 naming it; `note: null` records the month', async () => {
    const without = await call(ctx.app, {
      method: 'POST',
      url: '/api/history/record',
      payload: { periodMonths: ['2026-08'] },
    });
    expect(without.status).toBe(400);
    expect(errorOf(without.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(without.body).message).toMatch(/^note: /);
    expect(row('2026-08')).toBeUndefined();
    const withNull = await call<RecordResponse>(ctx.app, {
      method: 'POST',
      url: '/api/history/record',
      payload: { periodMonths: ['2026-08'], note: null },
    });
    expect(withNull.status).toBe(201);
    expect(row('2026-08').periodMonth).toBe('2026-08');
  });
});
