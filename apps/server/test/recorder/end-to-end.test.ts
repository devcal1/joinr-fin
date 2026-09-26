// The recorder end to end with server-api's real writeRecordedMonths and the real engine
// (stage-5.md §7.5 item 4): the generic seed (May–Jul 2026 imported), market data off, a fake clock
// and an in-memory database. Gated on HISTORY_ENGINE_IMPLEMENTED and on the writer being
// implemented (the Scaffolder's stub answers 501).
process.env.TZ = 'Australia/Sydney';

import { engine, HISTORY_ENGINE_IMPLEMENTED } from '@joinr/engine';
import { snapshotAudit, snapshots } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { asc } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/errors';
import { writeRecordedMonths } from '../../src/history/record';
import {
  createSnapshotRecorder,
  SNAPSHOT_STARTUP_DELAY_MS,
  type SnapshotRecorder,
} from '../../src/history/recorder';
import { createMarketDataService } from '../../src/market/index';
import { createScheduler, systemClock } from '../../src/scheduler/index';
import type { Scheduler } from '../../src/scheduler/types';
import { testConfig } from '../helpers';
import { silentLogger } from '../market/helpers';
import { containing, local, setAutoRecordSetting, setSince, snapshotJobRuns } from './helpers';

/** False while server-api's writer is the Scaffolder's 501 stub. */
function writerImplemented(): boolean {
  const probe = createTestDb();
  try {
    const scheduler = createScheduler({ db: probe.db, log: silentLogger() });
    const market = createMarketDataService({
      db: probe.db,
      config: { marketDataMode: 'off', priceRefreshMinutes: 0 },
      log: silentLogger(),
      scheduler,
    });
    writeRecordedMonths(
      { database: { sqlite: probe.sqlite, db: probe.db }, market, engine, now: () => new Date() },
      {
        periodMonths: [],
        source: 'recorded',
        trigger: 'manual',
        note: null,
        now: new Date(),
        detail: {
          pricesAsOf: null,
          marketMode: 'off',
          pricesRefreshed: false,
          pricesAgeMs: null,
          jobRunId: null,
        },
      },
    );
    return true;
  } catch (err) {
    return !(err instanceof HttpError && err.statusCode === 501);
  } finally {
    probe.close();
  }
}

const GATED = HISTORY_ENGINE_IMPLEMENTED && writerImplemented();

interface Setup {
  testDb: TestDb;
  scheduler: Scheduler;
  recorder: SnapshotRecorder;
}

let current: Setup | null = null;

afterEach(async () => {
  if (current) {
    await current.recorder.stop();
    await current.scheduler.stop();
    current.testDb.close();
  }
  current = null;
  vi.useRealTimers();
});

function setup(at: Date, since: string): Setup {
  vi.useFakeTimers({ now: at });
  const testDb = createTestDb();
  seedGenericData(testDb.db, { now: at });
  setAutoRecordSetting(testDb, true);
  setSince(testDb, since);
  const log = silentLogger();
  const scheduler = createScheduler({ db: testDb.db, log, clock: systemClock });
  const market = createMarketDataService({
    db: testDb.db,
    config: { marketDataMode: 'off', priceRefreshMinutes: 0 },
    log,
    scheduler,
  });
  const recorder = createSnapshotRecorder({
    database: { sqlite: testDb.sqlite, db: testDb.db },
    config: testConfig('unused-data-dir'),
    market,
    scheduler,
    engine,
    log,
    clock: systemClock,
  });
  recorder.start();
  current = { testDb, scheduler, recorder };
  return current;
}

function rows(testDb: TestDb) {
  return testDb.db.select().from(snapshots).orderBy(asc(snapshots.periodMonth)).all();
}

describe.skipIf(!GATED)('the recorder with the real writer', { timeout: 60_000 }, () => {
  it('records the month at 23:00 on its last day (job run, snapshot, audit)', async () => {
    const s = setup(local(2026, 8, 31, 22), '2026-08-01');
    await vi.advanceTimersByTimeAsync(local(2026, 8, 31, 23).getTime() - Date.now());
    const all = rows(s.testDb);
    const aug = all.at(-1)!;
    expect(aug).toMatchObject({
      periodMonth: '2026-08',
      runDate: '2026-08-31',
      source: 'recorded',
      origin: 'app',
      recordedAt: local(2026, 8, 31, 23).toISOString(),
      revision: 0,
    });
    expect(aug.cashValueCents).not.toBeNull();
    const previous = all.at(-2)!;
    if (previous.cashValueCents !== null && aug.cashValueCents !== null)
      expect(aug.cashGainCents).toBe(aug.cashValueCents - previous.cashValueCents);

    const runs = snapshotJobRuns(s.testDb);
    expect(runs).toEqual([
      expect.objectContaining({
        trigger: 'schedule',
        status: 'succeeded',
        detail: containing({ recorded: ['2026-08'], pricesRefreshed: false }),
      }),
    ]);
    const audit = s.testDb.db.select().from(snapshotAudit).orderBy(asc(snapshotAudit.id)).all();
    expect(audit.map((a) => [a.periodMonth, a.action, a.trigger])).toEqual([
      ['2026-08', 'record', 'schedule'],
    ]);
    const detail = JSON.parse(audit[0]!.detailJson!) as Record<string, unknown>;
    expect(detail).toMatchObject({
      marketMode: 'off',
      pricesRefreshed: false,
      jobRunId: s.scheduler.lastRun('snapshot')!.id,
    });
    expect(s.recorder.status()).toMatchObject({ blocked: null, running: false });
  });

  it('catches up two missed months at start-up: late, one run date, the later window empty', async () => {
    const s = setup(local(2026, 10, 2, 9), '2026-08-01');
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STARTUP_DELAY_MS);
    const recorded = rows(s.testDb).slice(-2);
    expect(recorded.map((r) => [r.periodMonth, r.runDate, r.source])).toEqual([
      ['2026-08', '2026-10-02', 'late'],
      ['2026-09', '2026-10-02', 'late'],
    ]);
    const sep = recorded[1]!;
    expect(sep.cashGainCents).toBe(0);
    for (const col of [
      sep.stocksMovementsCents,
      sep.etfMovementsCents,
      sep.cryptoMovementsCents,
      sep.mfMovementsCents,
    ])
      expect(col === null || col === 0).toBe(true);
    expect(snapshotJobRuns(s.testDb)).toEqual([
      expect.objectContaining({ trigger: 'startup', status: 'succeeded' }),
    ]);
  });

  it('a manual record of the month just recorded gets SNAPSHOT_EXISTS; a later month 400', async () => {
    const s = setup(local(2026, 8, 31, 22), '2026-08-01');
    await vi.advanceTimersByTimeAsync(local(2026, 8, 31, 23).getTime() - Date.now());
    await expect(
      s.recorder.record({ periodMonths: ['2026-08'], note: null }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SNAPSHOT_EXISTS' });
    await expect(
      s.recorder.record({ periodMonths: ['2026-10'], note: null }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      s.recorder.record({ periodMonths: ['2026-06'], note: null }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SNAPSHOT_EXISTS' });
    expect(rows(s.testDb)).toHaveLength(4);
  });
});
