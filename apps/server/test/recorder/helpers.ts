// Recorder test helpers (stage-5.md §7.5): an in-memory database, a fake market, a reference
// `recordingsDue` (§2.9) so the timing tests do not depend on the engine owner's progress, and a
// fake `writeRecordedMonths` that inserts minimal rows. Every value is generic.
//
// Time: each test file pins `process.env.TZ` before its first Date and drives the timers with
// Vitest's fake timers on `systemClock`, so the recorder's `now` (default `clock.now()`) and its
// timers share the fake time unless a test injects them apart.
import { engine as realEngine, type EngineApi, type RecordingPlan } from '@joinr/engine';
import {
  isoMonthOf,
  monthEndOf,
  type IsoDate,
  type IsoMonth,
  type MarketDataMode,
  type RefreshSummary,
} from '@joinr/schema';
import { appMeta, jobRuns, settings, snapshotAudit, snapshots } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { asc, eq } from 'drizzle-orm';
import { expect, vi, type Mock } from 'vitest';
import type { Config } from '../../src/config';
import { HttpError } from '../../src/errors';
import {
  AUTO_RECORD_SINCE_META_KEY,
  createSnapshotRecorderWith,
  type SnapshotRecorder,
  type SnapshotRecorderSeams,
} from '../../src/history/recorder';
import { localIsoDate } from '../../src/investments/format';
import { MarketDataDisabledError, type MarketDataService } from '../../src/market/types';
import { createScheduler, systemClock } from '../../src/scheduler/index';
import type { Clock, Scheduler } from '../../src/scheduler/types';
import { testConfig } from '../helpers';
import { silentLogger } from '../market/helpers';

/** `expect.objectContaining` typed as unknown (the lint's no-unsafe-assignment). */
export function containing(o: Record<string, unknown>): unknown {
  return expect.objectContaining(o) as unknown;
}

// ─── Month arithmetic (test-local) ──────────────────────────────────────────────────────────────

export function addMonth(month: IsoMonth, n = 1): IsoMonth {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  return `${String(ny).padStart(4, '0')}-${String(index - ny * 12 + 1).padStart(2, '0')}`;
}

/** §2.9 `nextRecordMonth`. */
export function refNextRecordMonth(
  list: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth {
  const latest = list
    .map((s) => s.periodMonth)
    .sort()
    .at(-1);
  return latest === undefined ? isoMonthOf(today) : addMonth(latest);
}

/** §2.9 `recordableMonths`. */
export function refRecordableMonths(
  list: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth[] {
  const out: IsoMonth[] = [];
  const current = isoMonthOf(today);
  for (let m = refNextRecordMonth(list, today); m <= current; m = addMonth(m)) out.push(m);
  return out;
}

/** §2.9 `recordingsDue` (D82, D94), written from the plan so the recorder can be tested alone. */
export const refRecordingsDue: EngineApi['recordingsDue'] = ({
  snapshots: list,
  today,
  recordTimeReached,
  autoRecordSince,
}): RecordingPlan => {
  if (autoRecordSince === null) return { due: [], blocked: null };
  const current = isoMonthOf(today);
  const would: RecordingPlan['due'] = [];
  const missing: IsoMonth[] = [];
  for (const m of refRecordableMonths(list, today)) {
    const end = monthEndOf(m);
    if (end < today) {
      if (end >= autoRecordSince) would.push({ periodMonth: m, source: 'late' });
      else missing.push(m);
    } else if (m === current && end === today && recordTimeReached) {
      would.push({ periodMonth: m, source: 'recorded' });
    }
  }
  if (would.length > 0 && missing.length > 0)
    return { due: [], blocked: { periodMonth: would[0]!.periodMonth, missing } };
  return { due: would, blocked: null };
};

/** The real engine with the reference recording rule (the other members are never called). */
export const testEngine: EngineApi = { ...realEngine, recordingsDue: refRecordingsDue };

// ─── Fake market ────────────────────────────────────────────────────────────────────────────────

export interface FakeMarket extends MarketDataService {
  /** Underlying refresh runs started (joined calls do not count). */
  runs: number;
  mode: MarketDataMode;
  lastRefreshAt: string | null;
  /** How long a refresh takes (fake timers); null = never finishes; 'fail' = rejects at once. */
  behaviour: number | null | 'fail';
  /** Starts a run as the hourly price job would (the recorder then joins it). */
  startPriceJob(): Promise<RefreshSummary>;
  refreshCalls: Mock<(opts: unknown) => void>;
}

const SUMMARY: RefreshSummary = {
  jobRunId: null,
  requested: 0,
  ok: 0,
  failed: 0,
  skipped: 0,
  durationMs: 0,
};

export function fakeMarket(
  init: Partial<Pick<FakeMarket, 'mode' | 'lastRefreshAt' | 'behaviour'>> = {},
): FakeMarket {
  let inFlight: Promise<RefreshSummary> | null = null;
  const unsupported = (): never => {
    throw new Error('not used by the recorder');
  };
  const market: FakeMarket = {
    runs: 0,
    mode: init.mode ?? 'fake',
    lastRefreshAt: init.lastRefreshAt ?? null,
    behaviour: init.behaviour === undefined ? 1_000 : init.behaviour,
    refreshCalls: vi.fn<(opts: unknown) => void>(),
    startPriceJob() {
      return run();
    },
    refresh(opts) {
      market.refreshCalls(opts);
      if (market.mode === 'off') return Promise.reject(new MarketDataDisabledError());
      return run();
    },
    getPrices: unsupported,
    getSeries: unsupported,
    setManualPrice: unsupported,
    clearManualPrice: unsupported,
    setPriceSource: unsupported,
    notifyInstrumentsChanged: () => {},
    status() {
      return {
        mode: market.mode,
        running: inFlight !== null,
        lastRefreshAt: market.lastRefreshAt,
        nextRefreshAt: null,
      };
    },
  };
  function run(): Promise<RefreshSummary> {
    if (inFlight) return inFlight;
    market.runs += 1;
    const behaviour = market.behaviour;
    if (behaviour === 'fail') return Promise.reject(new Error('provider unavailable'));
    const p = new Promise<RefreshSummary>((resolve) => {
      if (behaviour === null) return;
      setTimeout(() => {
        market.lastRefreshAt = new Date().toISOString();
        inFlight = null;
        resolve(SUMMARY);
      }, behaviour);
    });
    inFlight = p;
    return p;
  }
  return market;
}

// ─── Fake writer ────────────────────────────────────────────────────────────────────────────────

export type WriteCall = Parameters<SnapshotRecorderSeams['writeMonths']>[1];

/**
 * A fake `writeRecordedMonths` (§4.5's rules that matter to the recorder): refuses a recorded month
 * (409 SNAPSHOT_EXISTS), inserts one minimal row per month with today's run date (the current
 * month `recorded`, any other month the request's source) and one audit row.
 */
export function fakeWriter(): {
  write: SnapshotRecorderSeams['writeMonths'];
  calls: WriteCall[];
  failNext: number;
} {
  const state = {
    calls: [] as WriteCall[],
    failNext: 0,
    write: ((deps, req) => {
      state.calls.push(req);
      if (state.failNext > 0) {
        state.failNext -= 1;
        throw new Error('write failed (test)');
      }
      const db = deps.database.db;
      const today = localIsoDate(req.now);
      const current = isoMonthOf(today);
      return db.transaction((tx) => {
        return [...req.periodMonths].sort().map((periodMonth) => {
          const exists = tx
            .select({ id: snapshots.id })
            .from(snapshots)
            .where(eq(snapshots.periodMonth, periodMonth))
            .get();
          if (exists)
            throw new HttpError(409, `${periodMonth} is already recorded`, 'SNAPSHOT_EXISTS');
          const id = tx
            .insert(snapshots)
            .values({
              periodMonth,
              runDate: today,
              source: periodMonth === current ? 'recorded' : req.source,
              recordedAt: req.now.toISOString(),
              origin: 'app',
              note: req.note,
            })
            .returning({ id: snapshots.id })
            .get().id;
          const auditId = tx
            .insert(snapshotAudit)
            .values({
              periodMonth,
              snapshotId: id,
              action: 'record',
              trigger: req.trigger,
              at: req.now.toISOString(),
              note: req.note,
              detailJson: JSON.stringify(req.detail),
            })
            .returning({ id: snapshotAudit.id })
            .get().id;
          return { id, periodMonth, auditId };
        });
      });
    }) as SnapshotRecorderSeams['writeMonths'],
  };
  return state;
}

// ─── Harness ────────────────────────────────────────────────────────────────────────────────────

export interface Harness {
  testDb: TestDb;
  scheduler: Scheduler;
  market: FakeMarket;
  writer: ReturnType<typeof fakeWriter>;
  recorder: SnapshotRecorder;
  config: Config;
  close(): Promise<void>;
}

export function makeHarness(
  o: {
    autoRecord?: boolean | null;
    setting?: boolean;
    since?: IsoDate;
    months?: readonly {
      periodMonth: IsoMonth;
      runDate: IsoDate;
      source?: 'migrated' | 'recorded';
    }[];
    market?: FakeMarket;
    engine?: EngineApi;
    now?: () => Date;
    clock?: Clock;
    writeMonths?: SnapshotRecorderSeams['writeMonths'];
  } = {},
): Harness {
  const testDb = createTestDb();
  const database = { sqlite: testDb.sqlite, db: testDb.db };
  const config = testConfig('unused-data-dir', { autoRecord: o.autoRecord ?? null });
  if (o.setting !== undefined) setAutoRecordSetting(testDb, o.setting);
  if (o.since !== undefined) setSince(testDb, o.since);
  for (const m of o.months ?? []) insertMonth(testDb, m.periodMonth, m.runDate, m.source);
  const scheduler = createScheduler({
    db: testDb.db,
    log: silentLogger(),
    clock: o.clock ?? systemClock,
  });
  const market = o.market ?? fakeMarket();
  const writer = fakeWriter();
  const recorder = createSnapshotRecorderWith(
    {
      database,
      config,
      market,
      scheduler,
      engine: o.engine ?? testEngine,
      log: silentLogger(),
      now: o.now,
      clock: o.clock ?? systemClock,
    },
    { writeMonths: o.writeMonths ?? writer.write },
  );
  return {
    testDb,
    scheduler,
    market,
    writer,
    recorder,
    config,
    async close() {
      await recorder.stop();
      await scheduler.stop();
      testDb.close();
    },
  };
}

export function setAutoRecordSetting(testDb: TestDb, value: boolean): void {
  testDb.db
    .insert(settings)
    .values({
      key: 'history.autoRecord',
      valueJson: JSON.stringify(value),
      updatedAt: new Date().toISOString(),
      origin: 'app',
    })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(value) } })
    .run();
}

export function setSince(testDb: TestDb, since: IsoDate): void {
  testDb.db
    .insert(appMeta)
    .values({ key: AUTO_RECORD_SINCE_META_KEY, value: since, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: since } })
    .run();
}

export function readSinceMeta(testDb: TestDb): string | null {
  return (
    testDb.db
      .select({ value: appMeta.value })
      .from(appMeta)
      .where(eq(appMeta.key, AUTO_RECORD_SINCE_META_KEY))
      .get()?.value ?? null
  );
}

export function insertMonth(
  testDb: TestDb,
  periodMonth: IsoMonth,
  runDate: IsoDate,
  source: 'migrated' | 'recorded' = 'migrated',
): void {
  testDb.db
    .insert(snapshots)
    .values({
      periodMonth,
      runDate,
      source,
      recordedAt: source === 'migrated' ? null : `${runDate}T12:00:00.000Z`,
      origin: source === 'migrated' ? 'import' : 'app',
    })
    .run();
}

export function snapshotRows(testDb: TestDb) {
  return testDb.db
    .select({
      periodMonth: snapshots.periodMonth,
      runDate: snapshots.runDate,
      source: snapshots.source,
    })
    .from(snapshots)
    .orderBy(asc(snapshots.periodMonth))
    .all();
}

export function snapshotJobRuns(testDb: TestDb) {
  return testDb.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.job, 'snapshot'))
    .orderBy(asc(jobRuns.id))
    .all()
    .map((r) => ({
      trigger: r.trigger,
      status: r.status,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as Record<string, unknown>) : null,
      error: r.error,
    }));
}

export function auditRows(testDb: TestDb) {
  return testDb.db.select().from(snapshotAudit).orderBy(asc(snapshotAudit.id)).all();
}

/** A local Date (the file's TZ). */
export function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s, 0);
}
