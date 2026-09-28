// The NAS copy service (stage-8.md §5.9–§5.11, §5.13) in Melbourne time, on a fake clock, a fake
// NAS and a real temp database: S1–S15, the retries (1 h / 2 h / 4 h, then settled), no_rsync,
// configuration failures, stops, the refusal lock, which failures retry, whenIdle, stop() within
// its budget, the DST Sundays, the join, a crash-left row, stale, nextRunAt, `off` writing nothing,
// and problem().lastSuccessAt with its offset.
process.env.TZ = 'Australia/Melbourne';

import { EventEmitter } from 'node:events';
import { readdirSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  NAS_COPY_FIX_FIRST_MESSAGE,
  NAS_COPY_OFF_MESSAGE,
  nasCopyFailureMessage,
  type NasCopyFailureReason,
  type NasCopyJobDetail,
} from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markInterruptedRuns } from '../../src/db/queries/domain';
import { HttpError } from '../../src/errors';
import { type copyToNas } from '../../src/nascopy/copy';
import { NAS_COPY_STOP_BUDGET_MS, NAS_COPY_TIMEOUT_MS } from '../../src/nascopy/constants';
import {
  RsyncMissingError,
  runRsync,
  type RsyncResult,
  type RsyncRunner,
} from '../../src/nascopy/runner';
import { slotAt, slotIso } from '../../src/nascopy/schedule';
import { sentenceFor } from '../../src/nascopy/sentences';
import { createNasCopyService, type NasCopyService } from '../../src/nascopy/service';
import { createScheduler, systemClock } from '../../src/scheduler/index';
import type { Scheduler } from '../../src/scheduler/types';
import { makeLiveDb, recordingLogger, type LiveDb } from '../backups/helpers';
import {
  expectNoLeak,
  FakeNas,
  localBackupsDir,
  passwordFile,
  PLANTED,
  plantBackup,
  plantNasFiles,
  plantTypical,
  urlFile,
  writeSecret,
  type PlantedBackup,
} from './helpers';

const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date =>
  new Date(y, m - 1, d, h, min, s);
const MIN = 60_000;
const H = 60 * MIN;
const FILES_AT = new Date('2030-08-01T00:00:00.000Z');

/** Test seams: a wrapped scheduler (a run that cannot start) and the copy itself. */
interface HarnessSeams {
  wrapScheduler?: (real: Scheduler) => Scheduler;
  copy?: typeof copyToNas;
}

interface Harness {
  live: LiveDb;
  scheduler: Scheduler;
  service: NasCopyService;
  nas: FakeNas;
  local: PlantedBackup[];
  log: ReturnType<typeof recordingLogger>;
  idle: { whenIdle: ReturnType<typeof vi.fn<() => Promise<void>>> };
  /** Swaps the runner the service uses (the fake NAS by default). */
  setRunner(runner: RsyncRunner): void;
}

let h: Harness | null = null;
const lives: LiveDb[] = [];

afterEach(async () => {
  if (h) {
    const hh = h;
    const stopping = (async () => {
      await hh.service.stop();
      await hh.scheduler.stop();
    })();
    // A copy still waiting on a fake timer finishes (as stopped) when the clock moves on.
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(NAS_COPY_STOP_BUDGET_MS + 5 * MIN);
    await stopping;
    expect(h.nas.violations).toEqual([]);
    expectNoLeak(JSON.stringify(h.log.calls), 'log');
    for (const r of rows(h.live)) expectNoLeak(JSON.stringify(r), 'job_runs');
  }
  vi.useRealTimers();
  for (const l of lives.splice(0)) await l.cleanup();
  h = null;
});

async function harness(
  at: Date,
  o: {
    enabled?: boolean;
    files?: 'ready' | 'none' | 'url-only';
    start?: boolean;
    live?: LiveDb;
    plantLocal?: boolean;
  } & HarnessSeams = {},
): Promise<Harness> {
  const live = o.live ?? (await makeLiveDb());
  if (!o.live) lives.push(live);
  vi.useFakeTimers({ now: at });
  const log = recordingLogger();
  const realScheduler = createScheduler({ db: live.database.db, log, clock: systemClock });
  const scheduler = o.wrapScheduler ? o.wrapScheduler(realScheduler) : realScheduler;
  const files = o.files ?? 'ready';
  if (files === 'ready') plantNasFiles(live.dataDir, { at: FILES_AT });
  if (files === 'url-only') plantNasFiles(live.dataDir, { password: null, at: FILES_AT });
  const planted = o.plantLocal === false ? [] : o.live ? [] : plantTypical(live.dataDir);
  const nas = new FakeNas(live.dataDir);
  let runner: RsyncRunner = nas.runner;
  const idle = { whenIdle: vi.fn(() => Promise.resolve()) };
  const service = createNasCopyService({
    database: live.database,
    config: { dataDir: live.dataDir, weeklyNasCopy: o.enabled ?? true },
    scheduler,
    backups: idle,
    log,
    runner: (args, opts) => runner(args, opts),
    ...(o.copy ? { copy: o.copy } : {}),
  });
  h = {
    live,
    scheduler,
    service,
    nas,
    local: planted,
    log,
    idle,
    setRunner: (r) => {
      runner = r;
    },
  };
  if (o.start ?? true) service.start();
  return h;
}

async function advanceTo(at: Date): Promise<void> {
  const ms = at.getTime() - Date.now();
  if (ms < 0) throw new Error(`advanceTo: ${at.toISOString()} is in the past`);
  await vi.advanceTimersByTimeAsync(ms);
}

interface Row {
  id: number;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  detail: NasCopyJobDetail | null;
  error: string | null;
}

function rows(live: LiveDb): Row[] {
  return live.database.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.job, 'nas-copy'))
    .orderBy(asc(jobRuns.id))
    .all()
    .map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as NasCopyJobDetail) : null,
      error: r.error,
    }));
}

/** Inserts a finished `nas-copy` row. */
function seedRun(
  live: LiveDb,
  o: {
    status: 'succeeded' | 'failed';
    startedAt: Date;
    trigger?: 'schedule' | 'startup' | 'manual';
    detail?: Partial<NasCopyJobDetail> | null;
    error?: string | null;
  },
): void {
  const detail =
    o.detail === null
      ? null
      : {
          configured: 'ready',
          attempted: true,
          localFiles: 27,
          alreadyThere: 27,
          sent: 0,
          missingAfter: o.status === 'succeeded' ? 0 : null,
          vanished: 0,
          onNas: o.status === 'succeeded' ? 27 : null,
          bytes: 0,
          durationMs: 5000,
          ...o.detail,
        };
  live.database.db
    .insert(jobRuns)
    .values({
      job: 'nas-copy',
      trigger: o.trigger ?? 'schedule',
      startedAt: o.startedAt.toISOString(),
      finishedAt: new Date(o.startedAt.getTime() + 5000).toISOString(),
      status: o.status,
      detailJson: detail ? JSON.stringify(detail) : null,
      error:
        o.error !== undefined
          ? o.error
          : o.status === 'failed' && detail
            ? sentenceFor(detail)
            : null,
    })
    .run();
}

/** A success for last Sunday's slot (so the current week starts settled). */
const seedSuccess = (live: LiveDb, slotLocal: Date): void =>
  seedRun(live, {
    status: 'succeeded',
    startedAt: slotLocal,
    detail: { slot: slotIso(slotLocal), attempt: 1 },
  });

/** A runner answering every listing with this exit code (a NAS that is off, refuses, …). */
const answering =
  (code: number, err = ''): RsyncRunner =>
  () =>
    Promise.resolve<RsyncResult>({ code, out: '', err, outTruncated: false });

const at = (r: Row): string => new Date(r.startedAt).toISOString();

function expectHttp409(fn: () => unknown, code: string, message: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpError);
  expect((caught as HttpError).statusCode).toBe(409);
  expect((caught as HttpError).code).toBe(code);
  expect((caught as HttpError).message).toBe(message);
}

// ─── S1–S15 ─────────────────────────────────────────────────────────────────────────────────────

describe('the worked examples (§5.9)', () => {
  it('S1: up all week: one run at Sunday 03:00 (schedule, attempt 1), settled by (a)', async () => {
    const { live } = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    await advanceTo(local(2030, 9, 16, 12));
    const r = rows(live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(at(r[0]!)).toBe('2030-09-14T17:00:00.000Z');
    expect(r[0]?.detail).toMatchObject({ slot: '2030-09-15T03:00:00+10:00', attempt: 1, sent: 27 });
  });

  it('S2: down Saturday 22:00 to Monday 10:00: the copy at 10:05 (startup); the next Sunday as usual', async () => {
    const { live } = await harnessWith(local(2030, 9, 16, 10), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    await advanceTo(local(2030, 9, 16, 10, 4, 59));
    expect(rows(live)).toHaveLength(1);
    await advanceTo(local(2030, 9, 22, 12));
    const r = rows(live).slice(1);
    expect(r.map((x) => [x.trigger, at(x), x.detail?.slot])).toEqual([
      ['startup', '2030-09-16T00:05:00.000Z', '2030-09-15T03:00:00+10:00'],
      ['schedule', '2030-09-21T17:00:00.000Z', '2030-09-22T03:00:00+10:00'],
    ]);
  });

  it('S3: down for three Sundays: one copy 5 minutes after the start', async () => {
    const { live } = await harnessWith(local(2030, 9, 16, 10), (l) =>
      seedSuccess(l, local(2030, 8, 25, 3)),
    );
    await advanceTo(local(2030, 9, 21, 12));
    const r = rows(live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trigger: 'startup', status: 'succeeded' });
    expect(r[0]?.detail?.sent).toBe(27);
  });

  it('S4: started Sunday 02:58 with last week settled: the new slot runs on time (schedule)', async () => {
    const { live } = await harnessWith(local(2030, 9, 15, 2, 58), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    await advanceTo(local(2030, 9, 15, 2, 59, 59));
    expect(rows(live)).toHaveLength(1);
    await advanceTo(local(2030, 9, 15, 4));
    const r = rows(live).slice(1);
    expect(r.map((x) => [x.trigger, at(x)])).toEqual([['schedule', '2030-09-14T17:00:00.000Z']]);
  });

  it('S5: the NAS off Saturday to Tuesday: 03:00, 04:00, 06:00, 10:00, then settled; stale from Monday 03:00', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(answering(35));
    await advanceTo(local(2030, 9, 15, 23));
    const r = rows(hh.live).slice(1);
    expect(r.map((x) => [x.trigger, at(x), x.detail?.attempt, x.detail?.reason])).toEqual([
      ['schedule', '2030-09-14T17:00:00.000Z', 1, 'unreachable'],
      ['schedule', '2030-09-14T18:00:00.000Z', 2, 'unreachable'],
      ['schedule', '2030-09-14T20:00:00.000Z', 3, 'unreachable'],
      ['schedule', '2030-09-15T00:00:00.000Z', 4, 'unreachable'],
    ]);
    expect(hh.service.problem().stale).toBe(false);
    await advanceTo(local(2030, 9, 16, 3, 1));
    expect(hh.service.problem().stale).toBe(true);
    expect(hh.service.status().stale).toBe(true);
    // Back on Tuesday: nothing runs by itself before Sunday; the next Sunday copies everything.
    hh.setRunner(hh.nas.runner);
    await advanceTo(local(2030, 9, 21, 23));
    expect(rows(hh.live)).toHaveLength(5);
    await advanceTo(local(2030, 9, 22, 4));
    const last = rows(hh.live).at(-1);
    expect(last).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(last?.detail?.sent).toBe(27);
    expect(hh.service.problem().stale).toBe(false);
  });

  it('S6: a wrong password: no retry, the lock holds (409, no row, nothing timed); re-placing allows one login', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(answering(5, '@ERROR: auth failed on module x'));
    await advanceTo(local(2030, 9, 15, 12));
    expect(
      rows(hh.live)
        .slice(1)
        .map((x) => x.detail?.reason),
    ).toEqual(['auth']);
    expectHttp409(() => hh.service.copyNow(), 'NAS_COPY_FIX_FIRST', NAS_COPY_FIX_FIRST_MESSAGE);
    expect(rows(hh.live)).toHaveLength(2);
    const status = hh.service.status();
    expect(status.blockedUntilFilesChange).toBe(true);
    expect(status.schedule.nextRunAt).toBeNull();
    expect(hh.service.problem().blocked).toBe(true);
    await advanceTo(local(2030, 9, 17, 12));
    expect(rows(hh.live)).toHaveLength(2);
    // The helper places the password again (a new mtime): one login within the hour.
    writeSecret(passwordFile(hh.live.dataDir), `${PLANTED.password}\n`, new Date());
    expect(hh.service.status().blockedUntilFilesChange).toBe(false);
    expect(hh.service.status().schedule.nextRunAt).not.toBeNull();
    await advanceTo(local(2030, 9, 17, 13, 1));
    const r = rows(hh.live).slice(1);
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ trigger: 'schedule', status: 'failed' });
    expect(r[1]?.detail).toMatchObject({ reason: 'auth', attempt: 2 });
    // Still wrong: locked again after that single login.
    await advanceTo(local(2030, 9, 19, 12));
    expect(rows(hh.live)).toHaveLength(3);
    expect(hh.service.status().blockedUntilFilesChange).toBe(true);
  });

  it('S7: the files placed on a Wednesday: one copy within the hour (schedule)', async () => {
    const hh = await harnessWith(
      local(2030, 9, 16, 10),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        files: 'none',
      },
    );
    await advanceTo(local(2030, 9, 18, 12));
    expect(rows(hh.live)).toHaveLength(1);
    plantNasFiles(hh.live.dataDir, { at: new Date() });
    await advanceTo(local(2030, 9, 18, 13, 1));
    const r = rows(hh.live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(r[0]?.detail?.slot).toBe('2030-09-15T03:00:00+10:00');
  });

  it('S8: a manual copy on Saturday; Sunday still runs and sends only what is new', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    expect(hh.service.copyNow()).toEqual({ joined: false });
    await advanceTo(local(2030, 9, 14, 12, 1));
    plantBackup(hh.live.dataDir, 'nightly', local(2030, 9, 15, 2, 30), 5555);
    await advanceTo(local(2030, 9, 15, 4));
    const r = rows(hh.live).slice(1);
    expect(r.map((x) => [x.trigger, x.status, x.detail?.sent])).toEqual([
      ['manual', 'succeeded', 27],
      ['schedule', 'succeeded', 1],
    ]);
    expect(r[0]?.detail?.slot).toBeUndefined();
  });

  it('S8b: a manual success after a failed 03:00 attempt settles the slot; the retry finds nothing due', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(answering(35));
    await advanceTo(local(2030, 9, 15, 3, 30));
    hh.setRunner(hh.nas.runner);
    hh.service.copyNow();
    await advanceTo(local(2030, 9, 15, 12));
    const r = rows(hh.live).slice(1);
    expect(r.map((x) => [x.trigger, x.status])).toEqual([
      ['schedule', 'failed'],
      ['manual', 'succeeded'],
    ]);
  });

  it('S9: a run dated in the future settles nothing; the re-lived slot runs once', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) => {
      seedSuccess(l, local(2030, 9, 8, 3));
      seedRun(l, { status: 'succeeded', startedAt: local(2030, 9, 15, 9) });
    });
    await advanceTo(local(2030, 9, 16, 12));
    const r = rows(hh.live).slice(2);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
  });

  it('S10: after a restore of an older database: one catch-up that sends only what the NAS lacks', async () => {
    const hh = await harnessWith(local(2030, 9, 17, 10), (l) =>
      seedSuccess(l, local(2030, 9, 1, 3)),
    );
    hh.nas.hold(hh.local.slice(2));
    await advanceTo(local(2030, 9, 17, 11));
    const r = rows(hh.live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]?.detail).toMatchObject({ sent: 2, alreadyThere: 25 });
    expect(r[0]?.trigger).toBe('startup');
  });

  it('S11: WEEKLY_NAS_COPY off: no timer, no catch-up, no nextRunAt; the button works', async () => {
    const hh = await harness(local(2030, 9, 14, 12), { enabled: false });
    await advanceTo(local(2030, 9, 16, 12));
    expect(rows(hh.live)).toHaveLength(0);
    const status = hh.service.status();
    expect(status.schedule).toMatchObject({ enabled: false, nextRunAt: null });
    expect(status.stale).toBe(false);
    expect(hh.service.copyNow()).toEqual({ joined: false });
    await advanceTo(local(2030, 9, 16, 12, 1));
    expect(rows(hh.live).map((x) => [x.trigger, x.status])).toEqual([['manual', 'succeeded']]);
  });

  it('S12: half set up at the slot: one configuration failure, no retries; completed → attempt 1', async () => {
    const hh = await harnessWith(
      local(2030, 9, 14, 12),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        files: 'url-only',
      },
    );
    await advanceTo(local(2030, 9, 16, 12));
    const r = rows(hh.live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trigger: 'schedule', status: 'failed' });
    expect(r[0]?.detail).toMatchObject({
      attempted: false,
      reason: 'password_missing',
      configured: 'partial',
    });
    expect(r[0]?.error).toBe(nasCopyFailureMessage('password_missing'));
    expect(hh.nas.calls).toEqual([]);
    plantNasFiles(hh.live.dataDir, { at: new Date() });
    await advanceTo(local(2030, 9, 16, 13, 1));
    const after = rows(hh.live).slice(1);
    expect(after).toHaveLength(2);
    expect(after[1]?.detail).toMatchObject({ attempt: 1, slot: '2030-09-15T03:00:00+10:00' });
    expect(after[1]?.status).toBe('succeeded');
  });

  it('S13: a manual copy from 02:59 to 03:01: the wake starts nothing, then exactly one schedule run', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 58), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    await advanceTo(local(2030, 9, 15, 2, 59));
    const slow: RsyncRunner = (args, opts) =>
      new Promise((resolve) => setTimeout(resolve, MIN)).then(() => hh.nas.runner(args, opts));
    hh.setRunner(slow);
    hh.service.copyNow();
    await advanceTo(local(2030, 9, 15, 3, 0, 30));
    expect(rows(hh.live)).toHaveLength(2);
    hh.setRunner(hh.nas.runner);
    await advanceTo(local(2030, 9, 15, 4));
    const r = rows(hh.live).slice(1);
    expect(r.map((x) => [x.trigger, x.status, x.detail?.attempt, x.detail?.slot])).toEqual([
      ['manual', 'succeeded', undefined, undefined],
      ['schedule', 'succeeded', 1, '2030-09-15T03:00:00+10:00'],
    ]);
    expect(r[1]?.detail?.sent).toBe(0);
  });

  it('S13b: the same manual copy refused: the lock holds and nothing follows', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 58), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    await advanceTo(local(2030, 9, 15, 2, 59));
    hh.setRunner((...a) =>
      new Promise((resolve) => setTimeout(resolve, 2 * MIN)).then(() =>
        answering(5, 'auth failed')(...a),
      ),
    );
    hh.service.copyNow();
    await advanceTo(local(2030, 9, 15, 12));
    expect(
      rows(hh.live)
        .slice(1)
        .map((x) => [x.trigger, x.detail?.reason]),
    ).toEqual([['manual', 'auth']]);
  });

  it('S14: three restarts during a slot (each copy stopped): no stop counts; the slot still gets 4 real attempts', async () => {
    const live = await makeLiveDb();
    lives.push(live);
    seedSuccess(live, local(2030, 9, 8, 3));
    plantTypical(live.dataDir);
    let t = local(2030, 9, 15, 2, 59);
    for (let i = 0; i < 3; i++) {
      const hh = await harness(t, { live });
      hh.setRunner(hangingRunner());
      await advanceTo(new Date(Math.max(Date.now() + 6 * MIN, local(2030, 9, 15, 3, 1).getTime())));
      await hh.service.stop();
      await hh.scheduler.stop();
      h = null;
      vi.useRealTimers();
      t = new Date(t.getTime() + 30 * MIN);
    }
    const stopped = rows(live).slice(1);
    expect(stopped).toHaveLength(3);
    for (const r of stopped) {
      expect(r.status).toBe('failed');
      expect(r.detail).toMatchObject({ reason: 'stopped', attempt: 1 });
    }
    // A fourth start with the NAS off: four real attempts, then settled.
    const hh = await harness(t, { live });
    hh.setRunner(answering(35));
    await advanceTo(local(2030, 9, 16, 12));
    const real = rows(live).slice(4);
    expect(real.map((x) => x.detail?.attempt)).toEqual([1, 2, 3, 4]);
    expect(real[0]?.trigger).toBe('startup');
  });

  it('S15: a refused manual click at 02:58 Sunday: the 03:00 slot starts nothing', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 58), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(answering(5, '@ERROR: auth failed'));
    hh.service.copyNow();
    await advanceTo(local(2030, 9, 15, 6));
    expect(
      rows(hh.live)
        .slice(1)
        .map((x) => [x.trigger, x.detail?.reason]),
    ).toEqual([['manual', 'auth']]);
    expect(hh.service.problem().blocked).toBe(true);
  });
});

/** A harness whose database is prepared (rows seeded) before the service starts. */
async function harnessWith(
  at: Date,
  prepare: (live: LiveDb) => void,
  o: { files?: 'ready' | 'none' | 'url-only'; enabled?: boolean } & HarnessSeams = {},
): Promise<Harness> {
  const live = await makeLiveDb();
  lives.push(live);
  prepare(live);
  const hh = await harness(at, { ...o, live, start: false });
  hh.local.push(...plantTypical(live.dataDir));
  hh.service.start();
  return hh;
}

/** A runner that never answers until the signal aborts (then rejects like the real one). */
function hangingRunner(): RsyncRunner {
  return (_args, opts) =>
    new Promise<RsyncResult>((_resolve, reject) => {
      const fail = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (opts.signal.aborted) fail();
      else opts.signal.addEventListener('abort', fail, { once: true });
    });
}

// ─── Retries, settles and the lock ──────────────────────────────────────────────────────────────

describe('retries and settles', () => {
  const cases: ReadonlyArray<[string, RsyncRunner | 'missing', NasCopyFailureReason, boolean]> = [
    ['C13 unknown module', answering(5, "@ERROR: Unknown module 'x'"), 'unknown_module', false],
    ['C14 refused', answering(5, '@ERROR: access denied'), 'refused', false],
    ['C15 unreachable', answering(10), 'unreachable', true],
    ['C17 timeout', answering(30), 'timeout', true],
    [
      'max connections',
      answering(5, '@ERROR: max connections (4) reached -- try again later'),
      'other',
      true,
    ],
    ['read only module', answering(5, 'ERROR: module is read only'), 'nas_io', true],
    ['C12 no rsync', 'missing', 'no_rsync', false],
  ];

  it.each(cases)('%s: retried=%s', async (_name, runner, reason, retried) => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(runner === 'missing' ? () => Promise.reject(new RsyncMissingError()) : runner);
    await advanceTo(local(2030, 9, 15, 3, 1));
    await advanceTo(local(2030, 9, 15, 4, 1));
    const r = rows(hh.live).slice(1);
    expect(r[0]?.detail?.reason).toBe(reason);
    expect(r).toHaveLength(retried ? 2 : 1);
    if (reason === 'no_rsync') {
      await advanceTo(local(2030, 9, 20, 12));
      expect(rows(hh.live)).toHaveLength(2);
    }
  });

  it('C16/C20–C22 (send and proof failures) are retried', async () => {
    for (const [step, reason] of [
      [{ code: 10, noEffect: true }, 'broken'],
      [{ code: 12, noEffect: true }, 'broken'],
      [{ code: 11, noEffect: true }, 'nas_io'],
    ] as const) {
      const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
        seedSuccess(l, local(2030, 9, 8, 3)),
      );
      hh.nas.steps[1] = step;
      await advanceTo(local(2030, 9, 15, 4, 1));
      const r = rows(hh.live).slice(1);
      expect(r.map((x) => x.detail?.reason)).toEqual([reason, undefined]);
      expect(r[1]?.status).toBe('succeeded');
      await hh.service.stop();
      await hh.scheduler.stop();
      h = null;
      vi.useRealTimers();
    }
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.nas.steps[2] = { code: 23 };
    await advanceTo(local(2030, 9, 15, 4, 1));
    expect(
      rows(hh.live)
        .slice(1)
        .map((x) => x.detail?.reason),
    ).toEqual(['readback_failed', undefined]);
  });

  it('a configuration failure is not an attempt; stops are not attempts', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 12), (l) => {
      seedSuccess(l, local(2030, 9, 8, 3));
      const slot = slotIso(local(2030, 9, 15, 3));
      seedRun(l, {
        status: 'failed',
        startedAt: local(2030, 9, 15, 3),
        detail: {
          slot,
          attempt: 1,
          attempted: false,
          reason: 'url_missing',
          configured: 'partial',
        },
      });
      seedRun(l, {
        status: 'failed',
        startedAt: local(2030, 9, 15, 4),
        detail: { slot, attempt: 1, reason: 'stopped' },
      });
      seedRun(l, {
        status: 'failed',
        startedAt: local(2030, 9, 15, 5),
        detail: { slot, attempt: 1, reason: 'unreachable' },
      });
    });
    await advanceTo(local(2030, 9, 15, 12, 6));
    const last = rows(hh.live).at(-1);
    expect(last).toMatchObject({ trigger: 'startup', status: 'succeeded' });
    expect(last?.detail?.attempt).toBe(2);
  });

  it('off writes no row at any slot', async () => {
    const hh = await harness(local(2030, 9, 14, 12), { files: 'none' });
    await advanceTo(local(2030, 10, 14, 12));
    expect(rows(hh.live)).toEqual([]);
    const status = hh.service.status();
    expect(status).toMatchObject({ configured: 'off', lastRun: null, stale: false });
    expect(status.schedule.nextRunAt).toBeNull();
    expectHttp409(() => hh.service.copyNow(), 'NAS_COPY_NOT_READY', NAS_COPY_OFF_MESSAGE);
    expect(rows(hh.live)).toEqual([]);
  });
});

describe('runs that are not attempts, the attempt count after a restart, the deadline', () => {
  it('a slot run that cannot start (the row insert fails) is held back 1 h, 2 h, 4 h, never re-run at once', async () => {
    let rejecting = true;
    let calls = 0;
    const hh = await harnessWith(
      local(2030, 9, 15, 2, 59),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        wrapScheduler: (real) => ({
          ...real,
          run: (name, trigger) => {
            if (name !== 'nas-copy' || !rejecting) return real.run(name, trigger);
            calls += 1;
            return Promise.reject(Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' }));
          },
        }),
      },
    );
    await advanceTo(local(2030, 9, 15, 3, 59));
    expect(calls).toBe(1);
    await advanceTo(local(2030, 9, 15, 4, 1));
    expect(calls).toBe(2);
    await advanceTo(local(2030, 9, 15, 5, 59));
    expect(calls).toBe(2);
    await advanceTo(local(2030, 9, 15, 6, 1));
    expect(calls).toBe(3);
    const errors = hh.log.calls.filter((c) => c.msg === 'nas-copy: the job could not run');
    expect(errors).toHaveLength(3);
    expect(errors.every((c) => JSON.stringify(c).includes('SQLITE_FULL'))).toBe(true);
    expect(rows(hh.live)).toHaveLength(1);
    // Once the database is back, the held-back slot runs at the next gate as attempt 1.
    rejecting = false;
    await advanceTo(local(2030, 9, 15, 10, 1));
    expect(calls).toBe(3);
    const last = rows(hh.live).at(-1);
    expect(last).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(last?.detail).toMatchObject({ slot: slotIso(local(2030, 9, 15, 3)), attempt: 1 });
    expect(at(last!)).toBe(local(2030, 9, 15, 10).toISOString());
  });

  it('a slot run whose copy throws (attempted: false, other) is held back, stays attempt 1, and records the configuration at its start', async () => {
    const hh = await harnessWith(
      local(2030, 9, 15, 2, 59),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        copy: () => {
          throw new Error('boom');
        },
      },
    );
    await advanceTo(local(2030, 9, 15, 3, 59));
    expect(rows(hh.live).slice(1)).toHaveLength(1);
    await advanceTo(local(2030, 9, 15, 14, 1));
    const r = rows(hh.live).slice(1);
    expect(r.map(at)).toEqual(
      [
        local(2030, 9, 15, 3),
        local(2030, 9, 15, 4),
        local(2030, 9, 15, 6),
        local(2030, 9, 15, 10),
        local(2030, 9, 15, 14),
      ].map((d) => d.toISOString()),
    );
    for (const row of r) {
      expect(row).toMatchObject({ trigger: 'schedule', status: 'failed' });
      expect(row.detail).toMatchObject({
        configured: 'ready',
        attempted: false,
        reason: 'other',
        attempt: 1,
      });
    }
  });

  it('the wrapper failure while half set up records configured: partial, and is held back too', async () => {
    const hh = await harnessWith(
      local(2030, 9, 15, 2, 59),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        files: 'url-only',
        copy: () => {
          throw new Error('boom');
        },
      },
    );
    await advanceTo(local(2030, 9, 15, 3, 59));
    const r = rows(hh.live).slice(1);
    expect(r).toHaveLength(1);
    expect(r[0]?.detail).toMatchObject({
      configured: 'partial',
      attempted: false,
      reason: 'other',
    });
  });

  it('a backup that never goes idle: the 15-minute deadline records timeout (not an attempt), then waits 1 h, 2 h', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 59), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.idle.whenIdle.mockImplementation(() => new Promise<void>(() => {}));
    await advanceTo(local(2030, 9, 15, 4, 0));
    expect(rows(hh.live).slice(1)).toHaveLength(1);
    await advanceTo(local(2030, 9, 15, 9, 0));
    const r = rows(hh.live).slice(1);
    expect(r.map(at)).toEqual(
      [local(2030, 9, 15, 3), local(2030, 9, 15, 4, 15), local(2030, 9, 15, 6, 30)].map((d) =>
        d.toISOString(),
      ),
    );
    for (const row of r) {
      expect(row.detail).toMatchObject({ reason: 'timeout', attempted: false, attempt: 1 });
      expect(row.detail?.exitCode).toBeUndefined();
    }
    expect(hh.nas.calls).toEqual([]);
  });

  it('the service deadline on the injectable clock: a hung rsync records timeout at +15 min (no exit code), retried +1 h as attempt 2', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 59), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.nas.steps[0] = { hang: true };
    await advanceTo(local(2030, 9, 15, 3, 14));
    expect(hh.service.status().running).toBe(true);
    await advanceTo(local(2030, 9, 15, 3, 16));
    const first = rows(hh.live)[1];
    expect(first).toMatchObject({ trigger: 'schedule', status: 'failed' });
    expect(first?.detail).toMatchObject({ reason: 'timeout', attempted: true, attempt: 1 });
    expect(first?.detail?.exitCode).toBeUndefined();
    expect(first?.error).toBe(nasCopyFailureMessage('timeout'));
    expect(new Date(first!.finishedAt!).getTime() - new Date(first!.startedAt).getTime()).toBe(
      NAS_COPY_TIMEOUT_MS,
    );
    await advanceTo(local(2030, 9, 15, 4, 16));
    const second = rows(hh.live)[2];
    expect(at(second!)).toBe(local(2030, 9, 15, 4, 15).toISOString());
    expect(second).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(second?.detail?.attempt).toBe(2);
  });

  it('a restart between attempts 2 and 3: the catch-up is attempt 3, the +4 h retry attempt 4, then settled', async () => {
    const slot = slotIso(local(2030, 9, 15, 3));
    const hh = await harnessWith(local(2030, 9, 15, 5), (l) => {
      seedSuccess(l, local(2030, 9, 8, 3));
      for (const [hour, attempt] of [
        [3, 1],
        [4, 2],
      ] as const) {
        seedRun(l, {
          status: 'failed',
          startedAt: local(2030, 9, 15, hour),
          detail: { slot, attempt, reason: 'unreachable', exitCode: 10 },
        });
      }
    });
    hh.setRunner(answering(10));
    await advanceTo(local(2030, 9, 16, 12));
    const r = rows(hh.live).slice(3);
    expect(r.map((x) => [x.trigger, at(x), x.detail?.attempt])).toEqual([
      ['startup', local(2030, 9, 15, 5, 5).toISOString(), 3],
      ['schedule', local(2030, 9, 15, 9, 5).toISOString(), 4],
    ]);
    expect(hh.service.status().schedule.nextRunAt).toBe('2030-09-22T03:00:00+10:00');
  });
});

describe('the refusal lock (§5.9)', () => {
  for (const [reason, err] of [
    ['auth', '@ERROR: auth failed'],
    ['unknown_module', "@ERROR: Unknown module 'x'"],
    ['refused', '@ERROR: access denied'],
  ] as const) {
    it(`after a manual ${reason}: 409 FIX_FIRST, no row, no rsync, nothing timed; a new password unlocks once`, async () => {
      const hh = await harnessWith(local(2030, 9, 17, 12), (l) =>
        seedSuccess(l, local(2030, 9, 15, 3)),
      );
      hh.setRunner(answering(5, err));
      hh.service.copyNow();
      await advanceTo(local(2030, 9, 17, 12, 1));
      const runner = vi.fn(hh.nas.runner);
      hh.setRunner(runner);
      expectHttp409(() => hh.service.copyNow(), 'NAS_COPY_FIX_FIRST', NAS_COPY_FIX_FIRST_MESSAGE);
      expect(rows(hh.live)).toHaveLength(2);
      expect(runner).not.toHaveBeenCalled();
      expect(hh.service.status()).toMatchObject({ blockedUntilFilesChange: true });
      expect(hh.service.status().schedule.nextRunAt).toBeNull();
      // Not due (the slot is settled), and the timer starts nothing while locked anyway.
      await advanceTo(local(2030, 9, 21, 12));
      expect(rows(hh.live)).toHaveLength(2);
      writeSecret(
        urlFile(hh.live.dataDir),
        'rsync://planted-user@planted-host/planted-module\n',
        new Date(),
      );
      expect(hh.service.copyNow()).toEqual({ joined: false });
      await advanceTo(local(2030, 9, 21, 12, 1));
      expect(rows(hh.live).at(-1)?.status).toBe('succeeded');
    });
  }

  it('a future-dated refused row locks nothing', async () => {
    const hh = await harnessWith(local(2030, 9, 17, 12), (l) => {
      seedSuccess(l, local(2030, 9, 15, 3));
      seedRun(l, {
        status: 'failed',
        trigger: 'manual',
        startedAt: local(2030, 9, 19, 12),
        detail: { reason: 'auth', exitCode: 5 },
      });
    });
    expect(hh.service.status().blockedUntilFilesChange).toBe(false);
    expect(hh.service.copyNow()).toEqual({ joined: false });
  });

  it('refuses a copy while not ready with the configuration sentence and writes no row', async () => {
    const hh = await harness(local(2030, 9, 17, 12), { files: 'url-only' });
    expectHttp409(
      () => hh.service.copyNow(),
      'NAS_COPY_NOT_READY',
      nasCopyFailureMessage('password_missing'),
    );
    plantNasFiles(hh.live.dataDir, { password: `${PLANTED.password}\u0000` });
    expectHttp409(
      () => hh.service.copyNow(),
      'NAS_COPY_NOT_READY',
      nasCopyFailureMessage('password_invalid'),
    );
    expect(rows(hh.live)).toEqual([]);
  });
});

// ─── Concurrency and shutdown ───────────────────────────────────────────────────────────────────

describe('concurrency and shutdown (§5.10)', () => {
  it('a click while a copy runs joins it: one row', async () => {
    const hh = await harness(local(2030, 9, 17, 12), { enabled: false });
    hh.setRunner((args, opts) =>
      new Promise((r) => setTimeout(r, MIN)).then(() => hh.nas.runner(args, opts)),
    );
    expect(hh.service.copyNow()).toEqual({ joined: false });
    expect(hh.service.status().running).toBe(true);
    expect(hh.service.copyNow()).toEqual({ joined: true });
    await advanceTo(local(2030, 9, 17, 12, 5));
    expect(rows(hh.live)).toHaveLength(1);
  });

  it('waits for backups.whenIdle() before the copy', async () => {
    const hh = await harness(local(2030, 9, 17, 12), { enabled: false });
    let release!: () => void;
    hh.idle.whenIdle.mockImplementation(() => new Promise<void>((r) => (release = r)));
    hh.service.copyNow();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(hh.idle.whenIdle).toHaveBeenCalledTimes(1);
    expect(hh.nas.calls).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(hh.nas.calls.length).toBeGreaterThan(0);
    expect(rows(hh.live)[0]?.status).toBe('succeeded');
  });

  it('stop() during a copy whose rsync ignores SIGTERM resolves within 4 s, records stopped and no retry', async () => {
    const hh = await harnessWith(local(2030, 9, 15, 2, 59), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    const child = new (class extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill = vi.fn(() => true);
    })();
    hh.setRunner((args, opts) => runRsync(args, opts, () => child as unknown as ChildProcess));
    await advanceTo(local(2030, 9, 15, 3, 0, 10));
    expect(hh.service.status().running).toBe(true);
    const t0 = Date.now();
    let doneAt: number | null = null;
    const stopping = hh.service.stop().then(() => (doneAt = Date.now()));
    await vi.advanceTimersByTimeAsync(NAS_COPY_STOP_BUDGET_MS - 1);
    await stopping;
    expect(doneAt).not.toBeNull();
    expect(doneAt! - t0).toBeLessThanOrEqual(2_500);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await hh.scheduler.stop();
    const r = rows(hh.live).at(-1);
    expect(r).toMatchObject({ status: 'failed' });
    expect(r?.detail).toMatchObject({ reason: 'stopped', attempted: true, attempt: 1 });
    expect(r?.error).toBe(nasCopyFailureMessage('stopped'));
    expect(
      hh.log.calls.some((c) => c.msg === 'nas-copy: the copy did not stop within its budget'),
    ).toBe(false);
  });

  it('stop() with a runner that never settles gives up after its budget and warns', async () => {
    const hh = await harness(local(2030, 9, 17, 12), { enabled: false });
    hh.setRunner(() => new Promise<RsyncResult>(() => {}));
    hh.service.copyNow();
    await vi.advanceTimersByTimeAsync(1);
    let done = false;
    const stopping = hh.service.stop().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(NAS_COPY_STOP_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    // The scheduler's own stop would wait forever on this run: detach it from afterEach.
    h = null;
    expect(
      hh.log.calls.some((c) => c.msg === 'nas-copy: the copy did not stop within its budget'),
    ).toBe(true);
  });

  it('a crash-left `interrupted` row reads as the stopped sentence', async () => {
    const hh = await harness(local(2030, 9, 17, 12), { enabled: false });
    hh.live.database.db
      .insert(jobRuns)
      .values({
        job: 'nas-copy',
        trigger: 'manual',
        startedAt: new Date().toISOString(),
        status: 'running',
      })
      .run();
    markInterruptedRuns(hh.live.database.db, new Date());
    expect(hh.service.status().lastRun?.error).toBe(nasCopyFailureMessage('stopped'));
    expect(rows(hh.live)[0]?.error).toBe('interrupted');
  });
});

// ─── DST on the fake clock ──────────────────────────────────────────────────────────────────────

describe('DST (§5.9 table, §5.13)', () => {
  it('October 06/10/2030: the copy at 03:00 AEDT (05/10 16:00Z) before that day’s 03:30 nightly, which goes next week', async () => {
    const live = await makeLiveDb();
    lives.push(live);
    seedSuccess(live, local(2030, 9, 29, 3));
    const hh = await harness(local(2030, 10, 5, 12), { live });
    for (let d = 1; d <= 5; d++)
      plantBackup(live.dataDir, 'nightly', local(2030, 10, d, 2, 30), 1000 + d);
    await advanceTo(new Date('2030-10-05T16:20:00Z'));
    const first = rows(live).at(-1);
    expect(first?.startedAt).toBe('2030-10-05T16:00:00.000Z');
    expect(first?.detail).toMatchObject({ slot: '2030-10-06T03:00:00+11:00', sent: 5 });
    // The Stage 7 nightly of that day, at 03:30 AEDT (16:30Z).
    await advanceTo(new Date('2030-10-05T16:30:00Z'));
    const nightly = plantBackup(live.dataDir, 'nightly', new Date('2030-10-05T16:30:00Z'), 4242);
    expect(nightly).toBe('nightly-20301006-033000+1100.db');
    await advanceTo(local(2030, 10, 13, 4));
    const next = rows(live).at(-1);
    expect(next?.startedAt).toBe('2030-10-12T16:00:00.000Z');
    expect(next?.detail).toMatchObject({ slot: '2030-10-13T03:00:00+11:00', sent: 1 });
    expect(hh.nas.files.get(nightly)).toBe(4242);
  });

  for (const startZ of ['2030-04-06T15:30:00Z', '2030-04-06T16:30:00Z']) {
    it(`April 07/04/2030: a start at ${startZ} (02:30, ${startZ.includes('15:30') ? 'AEDT' : 'AEST'}) keeps W at 31/03; the new slot runs at 17:00Z as schedule`, async () => {
      const live = await makeLiveDb();
      lives.push(live);
      seedSuccess(live, local(2030, 3, 31, 3));
      const start = new Date(startZ);
      expect(slotIso(slotAt(start))).toBe('2030-03-31T03:00:00+11:00');
      const hh = await harness(start, { live });
      await advanceTo(new Date('2030-04-06T18:00:00Z'));
      const r = rows(live).slice(1);
      expect(r.map((x) => [x.trigger, x.startedAt, x.detail?.slot])).toEqual([
        ['schedule', '2030-04-06T17:00:00.000Z', '2030-04-07T03:00:00+10:00'],
      ]);
      void hh;
    });
  }
});

// ─── Status ─────────────────────────────────────────────────────────────────────────────────────

describe('status() and problem()', () => {
  it('nextRunAt: the next slot when settled', async () => {
    const hh = await harnessWith(local(2030, 9, 17, 12), (l) =>
      seedSuccess(l, local(2030, 9, 15, 3)),
    );
    expect(hh.service.status().schedule.nextRunAt).toBe('2030-09-22T03:00:00+10:00');
  });

  it('nextRunAt: the armed wake when due (within the hour), the run after a running one', async () => {
    const hh = await harnessWith(
      local(2030, 9, 18, 12),
      (l) => seedSuccess(l, local(2030, 9, 8, 3)),
      {
        files: 'none',
      },
    );
    expect(hh.service.status().schedule.nextRunAt).toBeNull();
    await advanceTo(local(2030, 9, 18, 12, 20));
    plantNasFiles(hh.live.dataDir, { at: new Date() });
    // The timer woke for the catch-up check at 12:05 and re-armed an hour later.
    expect(hh.service.status().schedule.nextRunAt).toBe('2030-09-18T13:05:00+10:00');
    hh.setRunner((args, opts) =>
      new Promise((r) => setTimeout(r, MIN)).then(() => hh.nas.runner(args, opts)),
    );
    hh.service.copyNow();
    expect(hh.service.status().running).toBe(true);
    expect(hh.service.status().schedule.nextRunAt).toBe('2030-09-22T03:00:00+10:00');
  });

  it('problem(): lastSuccessAt local ISO with the offset; stale; not-ready states', async () => {
    const hh = await harnessWith(local(2030, 9, 24, 12), (l) =>
      seedRun(l, { status: 'succeeded', startedAt: new Date('2030-09-14T17:00:00.000Z') }),
    );
    expect(hh.service.problem()).toEqual({
      configured: 'ready',
      configReason: null,
      blocked: false,
      stale: true,
      lastSuccessAt: '2030-09-15T03:00:05+10:00',
    });
    expect(hh.service.status().lastSuccessAt).toBe('2030-09-14T17:00:05.000Z');
    rmSync(passwordFile(hh.live.dataDir));
    expect(hh.service.problem()).toMatchObject({
      configured: 'partial',
      configReason: 'password_missing',
      stale: false,
    });
    expect(hh.service.status()).toMatchObject({
      missing: ['nas-password'],
      blockedUntilFilesChange: false,
    });
    expect(hh.service.status().schedule.nextRunAt).toBeNull();
  });

  it('stale at 7 d 23 h is false, at 8 d 1 h true', async () => {
    const hh = await harnessWith(local(2030, 9, 18, 10), (l) =>
      seedRun(l, {
        status: 'succeeded',
        startedAt: local(2030, 9, 15, 3),
        detail: { slot: slotIso(local(2030, 9, 15, 3)) },
      }),
    );
    const success = new Date(local(2030, 9, 15, 3).getTime() + 5000);
    vi.setSystemTime(new Date(success.getTime() + (7 * 24 + 23) * H));
    expect(hh.service.problem().stale).toBe(false);
    vi.setSystemTime(new Date(success.getTime() + (8 * 24 + 1) * H));
    expect(hh.service.problem().stale).toBe(true);
  });

  it('never carries a planted value, and the local backups are untouched by a failure', async () => {
    const hh = await harnessWith(local(2030, 9, 14, 12), (l) =>
      seedSuccess(l, local(2030, 9, 8, 3)),
    );
    hh.setRunner(
      answering(5, `@ERROR: auth failed for ${PLANTED.user}@${PLANTED.host} ${PLANTED.password}`),
    );
    const before = readdirSync(localBackupsDir(hh.live.dataDir)).sort();
    await advanceTo(local(2030, 9, 15, 4));
    expect(rows(hh.live).at(-1)?.detail?.reason).toBe('auth');
    expectNoLeak(JSON.stringify(hh.service.status()), 'status');
    expectNoLeak(JSON.stringify(hh.service.problem()), 'problem');
    expect(readdirSync(localBackupsDir(hh.live.dataDir)).sort()).toEqual(before);
  });
});
