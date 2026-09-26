// `writeRecordedMonths` (stage-5.md §4.5 "Recording", §7.4 step 3) with a FAKE engine that follows
// the §2.9 recording rules and copies its inputs into the composed figures: one month, two months
// sharing a run date (the second's context sees the first, so its windows are empty), the stored
// source per case, the refusals (a month already recorded → 409 SNAPSHOT_EXISTS, a month before the
// latest or after this month → 400; nothing written), the stored derived columns equal
// `deriveSnapshotColumns`, the audit row, origin `app`, and the recorded row equal to the live row
// composed just before under the same clock. Generic values only.
import type { ComposeSnapshotInput } from '@joinr/engine';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import { HttpError } from '../../src/errors';
import { figuresOf } from '../../src/history/inputs';
import { recordSourceOf, writeRecordedMonths, type RecordDetail } from '../../src/history/record';
import { AS_OF, fakeMarket, NOW, type FakeEngine } from '../investments/helpers';
import { composeRule, deriveRule, historyFakeEngine } from './helpers';

let t: TestDb;
let engine: FakeEngine;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
  engine = historyFakeEngine();
});
afterEach(() => t.close());

const deps = (): FinanceDeps => ({ database: t, market: fakeMarket(), engine, now: () => NOW });

const DETAIL: RecordDetail = {
  pricesAsOf: '2026-09-24T01:55:00.000Z',
  marketMode: 'fake',
  pricesRefreshed: true,
  pricesAgeMs: 120000,
  jobRunId: 17,
};

function record(
  periodMonths: string[],
  o: { source?: 'recorded' | 'lookback' | 'late'; note?: string | null; now?: Date } = {},
) {
  return writeRecordedMonths(deps(), {
    periodMonths,
    source: o.source ?? 'lookback',
    trigger: 'manual',
    note: o.note ?? null,
    now: o.now ?? NOW,
    detail: DETAIL,
  });
}

const row = (month: string) =>
  t.db.select().from(snapshots).where(eq(snapshots.periodMonth, month)).get();

function thrown(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected an HttpError');
}

describe('recording one month (§4.5 steps 1–3)', () => {
  it('stores the composed figures with today’s run date, origin app and one audit row', () => {
    const before = createFinanceContext(deps()).composeLive()!;
    const [out] = record(['2026-08'], { note: 'Month-end' });
    const stored = row('2026-08')!;
    expect(out).toEqual({ id: stored.id, periodMonth: '2026-08', auditId: out!.auditId });
    expect(stored).toMatchObject({
      runDate: AS_OF,
      periodMonth: '2026-08',
      source: 'lookback',
      recordedAt: NOW.toISOString(),
      origin: 'app',
      sheetRef: null,
      note: 'Month-end',
      revision: 0,
    });
    // The recorded row equals the live row composed just before (same clock, no price change).
    expect(figuresOf(stored)).toEqual(before);
    const audit = t.db.select().from(snapshotAudit).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      id: out!.auditId,
      periodMonth: '2026-08',
      snapshotId: stored.id,
      action: 'record',
      trigger: 'manual',
      at: NOW.toISOString(),
      changesJson: null,
      note: 'Month-end',
    });
    expect(JSON.parse(audit[0]!.snapshotJson!)).toEqual(stored);
    expect(JSON.parse(audit[0]!.detailJson!)).toEqual(DETAIL);
  });

  it('stores the derived columns of deriveSnapshotColumns (they agree with their inputs)', () => {
    record(['2026-08']);
    const stored = row('2026-08')!;
    const derived = deriveRule({
      figures: figuresOf(stored),
      previousCashValueCents: row('2026-07')!.cashValueCents,
    });
    expect(stored).toMatchObject(derived);
    const call = engine.calls.deriveSnapshotColumns.at(-1)![0] as {
      previousCashValueCents: unknown;
    };
    expect(call.previousCashValueCents).toBe(row('2026-07')!.cashValueCents);
  });

  it('the current month is `recorded`; earlier months `lookback`, or `late` from the scheduler', () => {
    expect(recordSourceOf('2026-09', '2026-09', 'lookback')).toBe('recorded');
    expect(recordSourceOf('2026-09', '2026-09', 'late')).toBe('recorded');
    expect(recordSourceOf('2026-08', '2026-09', 'recorded')).toBe('lookback');
    expect(recordSourceOf('2026-08', '2026-09', 'lookback')).toBe('lookback');
    expect(recordSourceOf('2026-08', '2026-09', 'late')).toBe('late');
    writeRecordedMonths(deps(), {
      periodMonths: ['2026-08'],
      source: 'late',
      trigger: 'startup',
      note: null,
      now: NOW,
      detail: DETAIL,
    });
    expect(row('2026-08')!.source).toBe('late');
    expect(t.db.select().from(snapshotAudit).get()!.trigger).toBe('startup');
  });
});

describe('two months recorded together share the run date (§2.9)', () => {
  it('ascending, each composed by a fresh context that sees the months written before it', () => {
    const out = record(['2026-09', '2026-08']);
    expect(out.map((r) => r.periodMonth)).toEqual(['2026-08', '2026-09']);
    expect(row('2026-08')).toMatchObject({ runDate: AS_OF, source: 'lookback' });
    expect(row('2026-09')).toMatchObject({ runDate: AS_OF, source: 'recorded' });
    const inputs = engine.calls.composeSnapshot.map((c) => c[0] as ComposeSnapshotInput);
    expect(inputs.map((i) => i.periodMonth)).toEqual(['2026-08', '2026-09']);
    // The second month's previous snapshot is the first (recorded today): empty windows.
    expect(inputs[0]!.previous?.runDate).toBe('2026-07-31');
    expect(inputs[1]!.previous).toEqual({
      runDate: AS_OF,
      cashValueCents: row('2026-08')!.cashValueCents,
    });
    expect(row('2026-09')).toMatchObject({
      cashGainCents: 0,
      stocksMovementsCents: 0,
      etfMovementsCents: 0,
      cryptoMovementsCents: 0,
      mfMovementsCents: 0,
    });
    expect(t.db.select().from(snapshotAudit).all()).toHaveLength(2);
  });
});

describe('refusals (§4.5 step 1; nothing is written)', () => {
  it('409 SNAPSHOT_EXISTS for a month already recorded, checked in ascending order', () => {
    const err = thrown(() => record(['2026-08', '2026-07']));
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('SNAPSHOT_EXISTS');
    expect(err.message).toBe('Jul 2026 is already recorded (31/07/2026). Correct it instead.');
    expect(row('2026-08')).toBeUndefined();
    expect(t.db.select().from(snapshotAudit).all()).toHaveLength(0);
  });

  it('400 for a month after this month, or a gap month before the latest', () => {
    const future = thrown(() => record(['2026-08', '2026-10']));
    expect(future.statusCode).toBe(400);
    expect(future.code).toBe('VALIDATION_ERROR');
    expect(future.message).toMatch(/^periodMonths\.1: cannot be recorded/);
    expect(row('2026-08')).toBeUndefined();

    record(['2026-09'], { note: null });
    // August is now a gap: a month before the latest recorded month can never be filled.
    const gap = thrown(() => record(['2026-08']));
    expect(gap.statusCode).toBe(400);
    expect(gap.message).toMatch(/^periodMonths\.0: cannot be recorded/);
  });

  it('a month recorded twice is refused the second time', () => {
    record(['2026-08']);
    expect(thrown(() => record(['2026-08'])).code).toBe('SNAPSHOT_EXISTS');
  });
});

describe('a failure part-way through a record rolls everything back (CODE-6)', () => {
  it('the second month’s composition throws: neither month nor any audit row is written', () => {
    let calls = 0;
    engine = historyFakeEngine({
      composeSnapshot: (input) => {
        calls += 1;
        if (calls === 2) throw new Error('compose failed');
        return composeRule(input);
      },
    });
    expect(() => record(['2026-08', '2026-09'])).toThrow('compose failed');
    expect(calls).toBe(2);
    expect(row('2026-08')).toBeUndefined();
    expect(row('2026-09')).toBeUndefined();
    expect(t.db.select().from(snapshotAudit).all()).toHaveLength(0);
  });
});
