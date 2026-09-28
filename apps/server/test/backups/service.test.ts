// The backup service (stage-7.md §5.4, §5.11) in Melbourne time: the slot and planNext on an
// ordinary day, the October gap day (one run, 03:30 AEDT) and the April repeat day (one run, the
// first 02:30), the 6 h cap, the start-up catch-up, the empty-database skip (also after a
// restart), a future file, the clock jumping back, nextRunAt with a retry and with the catch-up,
// retries (15 min, 3 attempts), the import-lock skip, manual ⇄ nightly joins (async copy seam),
// stop waiting for a run, job_runs rows, no path in job_runs.error, and the stale rule.
process.env.TZ = 'Australia/Melbourne';

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_FAILURE_MESSAGES, type BackupJobDetail } from '@joinr/schema';
import { importRuns, jobRuns } from '@joinr/schema/db';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vacuumInto, type CopyFn } from '../../src/backups/copy';
import { formatBackupName } from '../../src/backups/names';
import {
  BACKUP_WAKE_MAX_MS,
  createBackupService,
  currentSlot,
  nextSlotAfter,
  planNext,
  slotOf,
  type BackupService,
} from '../../src/backups/service';
import { importLock } from '../../src/routes/import';
import { createScheduler, systemClock } from '../../src/scheduler/index';
import type { Scheduler } from '../../src/scheduler/types';
import { seedGenericData } from '@joinr/schema/testing';
import { makeLiveDb, recordingLogger, type LiveDb } from './helpers';

/** A local Melbourne time. */
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date =>
  new Date(y, m - 1, d, h, min, s);

interface H {
  live: LiveDb;
  scheduler: Scheduler;
  service: BackupService;
  log: ReturnType<typeof recordingLogger>;
}

let h: H | null = null;
const extra: LiveDb[] = [];

afterEach(async () => {
  if (h) {
    await h.service.stop();
    await h.scheduler.stop();
  }
  importLock.release();
  vi.useRealTimers();
  if (h) await h.live.cleanup();
  for (const l of extra.splice(0)) await l.cleanup();
  h = null;
});

async function harness(
  at: Date,
  o: { seed?: boolean; enabled?: boolean; copy?: CopyFn; live?: LiveDb; start?: boolean } = {},
): Promise<H> {
  const live = o.live ?? (await makeLiveDb({ seed: o.seed ?? true }));
  vi.useFakeTimers({ now: at });
  const log = recordingLogger();
  const scheduler = createScheduler({ db: live.database.db, log, clock: systemClock });
  const service = createBackupService({
    database: live.database,
    config: { dataDir: live.dataDir, nightlyBackups: o.enabled ?? true },
    scheduler,
    log,
    copy: o.copy,
  });
  h = { live, scheduler, service, log };
  if (o.start ?? true) service.start();
  return h;
}

async function advanceTo(at: Date): Promise<void> {
  const ms = at.getTime() - Date.now();
  if (ms < 0) throw new Error(`advanceTo: ${at.toString()} is in the past`);
  await vi.advanceTimersByTimeAsync(ms);
}

const backupsDir = (live: LiveDb): string => join(live.dataDir, 'backups');

function files(live: LiveDb): string[] {
  try {
    return readdirSync(backupsDir(live)).sort();
  } catch {
    return [];
  }
}

const nightlyFiles = (live: LiveDb): string[] =>
  files(live).filter((f) => f.startsWith('nightly-'));

/** Plants a (dummy) nightly file named for `at`. */
function plantNightly(live: LiveDb, at: Date): string {
  mkdirSync(backupsDir(live), { recursive: true });
  const name = formatBackupName('nightly', at);
  writeFileSync(join(backupsDir(live), name), 'x');
  return name;
}

interface RunRow {
  trigger: string;
  status: string;
  detail: BackupJobDetail | null;
  error: string | null;
}

function runs(live: LiveDb): RunRow[] {
  return live.database.db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.job, 'backup'))
    .orderBy(asc(jobRuns.id))
    .all()
    .map((r) => ({
      trigger: r.trigger,
      status: r.status,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as BackupJobDetail) : null,
      error: r.error,
    }));
}

/** Data arrives (the generic seed, as a first import), keeping the `job_runs` rows it would clear. */
function seedKeepingRuns(live: LiveDb): void {
  const sqlite = live.database.sqlite;
  const rows = sqlite.prepare('SELECT * FROM job_runs ORDER BY id').all() as Record<
    string,
    unknown
  >[];
  seedGenericData(live.database.db, { now: new Date('2030-09-01T00:00:00.000Z') });
  sqlite.prepare('DELETE FROM job_runs').run();
  for (const row of rows) {
    const cols = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO job_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      .run(...cols.map((c) => row[c]));
  }
}

/** An async copy that waits for `release()` (the join tests, §5.3 step 2). */
function gatedCopy(): { copy: CopyFn; release: () => void; started: () => number } {
  const waiting: (() => void)[] = [];
  let count = 0;
  return {
    copy: (sqlite, target) =>
      new Promise<void>((resolve, reject) => {
        count += 1;
        waiting.push(() => {
          try {
            vacuumInto(sqlite, target);
            resolve();
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      }),
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
    started: () => count,
  };
}

// ─── The slot and the plan (pure) ───────────────────────────────────────────────────────────────

describe('slots', () => {
  it('is 02:30 local on an ordinary day; S(now) is today once reached, else yesterday', () => {
    expect(slotOf(local(2030, 9, 15, 14)).getTime()).toBe(local(2030, 9, 15, 2, 30).getTime());
    expect(currentSlot(local(2030, 9, 15, 2, 29)).getTime()).toBe(
      local(2030, 9, 14, 2, 30).getTime(),
    );
    expect(currentSlot(local(2030, 9, 15, 2, 30)).getTime()).toBe(
      local(2030, 9, 15, 2, 30).getTime(),
    );
    expect(nextSlotAfter(local(2030, 9, 15, 2, 30)).getTime()).toBe(
      local(2030, 9, 16, 2, 30).getTime(),
    );
    expect(nextSlotAfter(local(2030, 9, 15, 1)).getTime()).toBe(
      local(2030, 9, 15, 2, 30).getTime(),
    );
  });

  it('is 03:30 AEDT on the October gap day (02:30 does not exist)', () => {
    const slot = slotOf(local(2030, 10, 6, 12));
    expect(slot.toISOString()).toBe('2030-10-05T16:30:00.000Z');
    expect(slot.getHours()).toBe(3);
    expect(nextSlotAfter(local(2030, 10, 6, 1)).toISOString()).toBe('2030-10-05T16:30:00.000Z');
  });

  it('is the first 02:30 (AEDT) on the April repeat day', () => {
    expect(slotOf(local(2030, 4, 7, 12)).toISOString()).toBe('2030-04-06T15:30:00.000Z');
    // The second 02:30 (AEST, 16:30Z) is still inside the same slot day.
    const second = new Date(Date.UTC(2030, 3, 6, 16, 30));
    expect(currentSlot(second).toISOString()).toBe('2030-04-06T15:30:00.000Z');
  });
});

describe('planNext', () => {
  const base = { enabled: true, settled: true, retryAt: null, catchUpAt: null };

  it('sleeps until the next slot (capped at 6 h) when settled', () => {
    const now = local(2030, 9, 15, 23);
    const p = planNext(now, base);
    expect(p.runNow).toBe(false);
    expect(p.wakeAt?.getTime()).toBe(local(2030, 9, 16, 2, 30).getTime());
    expect(p.nextRunAt?.getTime()).toBe(local(2030, 9, 16, 2, 30).getTime());
    const noon = local(2030, 9, 15, 12);
    expect(planNext(noon, base).wakeAt?.getTime()).toBe(noon.getTime() + BACKUP_WAKE_MAX_MS);
  });

  it('runs now when due', () => {
    const now = local(2030, 9, 15, 2, 30);
    const p = planNext(now, { ...base, settled: false });
    expect(p).toEqual({ runNow: true, wakeAt: now, nextRunAt: now });
  });

  it('waits for a pending retry and shows it as the next run', () => {
    const now = local(2030, 9, 15, 2, 31);
    const retryAt = local(2030, 9, 15, 2, 45);
    const p = planNext(now, { ...base, settled: false, retryAt });
    expect(p.runNow).toBe(false);
    expect(p.wakeAt?.getTime()).toBe(retryAt.getTime());
    expect(p.nextRunAt?.getTime()).toBe(retryAt.getTime());
    // A retry of a settled slot is ignored.
    expect(planNext(now, { ...base, retryAt }).nextRunAt?.getTime()).toBe(
      local(2030, 9, 16, 2, 30).getTime(),
    );
  });

  it('waits for the armed catch-up and shows it as the next run', () => {
    const now = local(2030, 9, 15, 10);
    const catchUpAt = local(2030, 9, 15, 10, 2);
    const p = planNext(now, { ...base, settled: false, catchUpAt });
    expect(p.runNow).toBe(false);
    expect(p.wakeAt?.getTime()).toBe(catchUpAt.getTime());
    expect(p.nextRunAt?.getTime()).toBe(catchUpAt.getTime());
    // Settled: the catch-up still wakes the timer, but the next run is the slot.
    const settled = planNext(now, { ...base, catchUpAt });
    expect(settled.wakeAt?.getTime()).toBe(catchUpAt.getTime());
    expect(settled.nextRunAt?.getTime()).toBe(local(2030, 9, 16, 2, 30).getTime());
  });

  it('plans nothing when disabled', () => {
    expect(
      planNext(local(2030, 9, 15, 2, 30), { ...base, enabled: false, settled: false }),
    ).toEqual({
      runNow: false,
      wakeAt: null,
      nextRunAt: null,
    });
  });
});

// ─── The service ────────────────────────────────────────────────────────────────────────────────

describe('the nightly run', () => {
  it('runs once at the slot on an ordinary day, and again the next night', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const t = await harness(local(2030, 9, 15, 1), { live });
    await advanceTo(local(2030, 9, 15, 2, 29));
    expect(runs(live)).toEqual([]); // the catch-up at 01:02 found yesterday's copy
    await advanceTo(local(2030, 9, 15, 2, 31));
    expect(nightlyFiles(live)).toContain('nightly-20300915-023000+1000.db');
    expect(runs(live)).toHaveLength(1);
    expect(runs(live)[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    await advanceTo(local(2030, 9, 16, 2, 29));
    expect(runs(live)).toHaveLength(1);
    await advanceTo(local(2030, 9, 16, 3));
    expect(runs(live)).toHaveLength(2);
    expect(nightlyFiles(t.live)).toContain('nightly-20300916-023000+1000.db');
  });

  it('runs once on the October gap day, at 03:30 AEDT', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 10, 5, 2, 30));
    await harness(local(2030, 10, 6, 1), { live });
    await advanceTo(new Date(Date.UTC(2030, 9, 5, 16, 29))); // 03:29 AEDT
    expect(runs(live)).toEqual([]);
    await advanceTo(local(2030, 10, 6, 12));
    expect(runs(live)).toHaveLength(1);
    expect(nightlyFiles(live)).toEqual([
      'nightly-20301005-023000+1000.db',
      'nightly-20301006-033000+1100.db',
    ]);
    expect(runs(live)[0]?.detail?.slot).toBe('2030-10-06T03:30:00+11:00');
  });

  it('runs once on the April repeat day, at the first 02:30; the second 02:30 does nothing', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 4, 6, 2, 30));
    await harness(local(2030, 4, 7, 1), { live });
    await advanceTo(new Date(Date.UTC(2030, 3, 6, 15, 31))); // the first 02:31 (AEDT)
    expect(runs(live)).toHaveLength(1);
    expect(nightlyFiles(live)).toContain('nightly-20300407-023000+1100.db');
    await advanceTo(new Date(Date.UTC(2030, 3, 6, 16, 45))); // the second 02:45 (AEST)
    await advanceTo(local(2030, 4, 7, 23));
    expect(runs(live)).toHaveLength(1);
    expect(nightlyFiles(live)).not.toContain('nightly-20300407-023000+1000.db');
  });

  it('never sleeps longer than 6 h', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 15, 2, 30));
    await harness(local(2030, 9, 15, 3), { live });
    const spy = vi.spyOn(systemClock, 'setTimeout');
    await advanceTo(local(2030, 9, 16, 2, 0));
    const delays = spy.mock.calls.map((c) => c[1]);
    spy.mockRestore();
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(BACKUP_WAKE_MAX_MS);
  });
});

describe('the start-up catch-up', () => {
  it('takes one backup 2 minutes after a start that missed the slot', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const t = await harness(local(2030, 9, 15, 10), { live });
    expect(t.service.status().nextRunAt).toBe('2030-09-15T10:02:00+10:00');
    await advanceTo(local(2030, 9, 15, 10, 1, 59));
    expect(runs(live)).toEqual([]);
    await advanceTo(local(2030, 9, 15, 10, 3));
    expect(runs(live)).toHaveLength(1);
    expect(runs(live)[0]).toMatchObject({ trigger: 'startup', status: 'succeeded' });
    expect(nightlyFiles(live)).toContain('nightly-20300915-100200+1000.db');
    expect(runs(live)[0]?.detail?.slot).toBe('2030-09-15T02:30:00+10:00');
    await advanceTo(local(2030, 9, 16, 2, 0));
    expect(runs(live)).toHaveLength(1);
    expect(t.service.status().nextRunAt).toBe('2030-09-16T02:30:00+10:00');
  });

  it('takes one backup only, however many slots were missed', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 10, 2, 30));
    await harness(local(2030, 9, 15, 10), { live });
    await advanceTo(local(2030, 9, 15, 23));
    expect(runs(live)).toHaveLength(1);
    expect(nightlyFiles(live)).toHaveLength(2);
  });

  it('does nothing before the slot when yesterday has its copy', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    await harness(local(2030, 9, 15, 0, 30), { live });
    await advanceTo(local(2030, 9, 15, 2, 29));
    expect(runs(live)).toEqual([]);
    await advanceTo(local(2030, 9, 15, 2, 31));
    expect(runs(live)).toHaveLength(1);
    expect(runs(live)[0]?.trigger).toBe('schedule');
  });

  it('is not armed when the schedule is off (no timer at all)', async () => {
    const live = await makeLiveDb({ seed: true });
    const t = await harness(local(2030, 9, 15, 10), { live, enabled: false });
    expect(t.service.status()).toMatchObject({ enabled: false, nextRunAt: null });
    await advanceTo(local(2030, 9, 17, 10));
    expect(runs(live)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('special cases', () => {
  it('skips an empty database (settled through job_runs, also after a restart)', async () => {
    const live = await makeLiveDb({ seed: false });
    const t = await harness(local(2030, 9, 15, 10), { live });
    await advanceTo(local(2030, 9, 15, 10, 3));
    expect(runs(live)).toEqual([
      {
        trigger: 'startup',
        status: 'succeeded',
        detail: {
          kind: 'nightly',
          slot: '2030-09-15T02:30:00+10:00',
          attempt: 1,
          skipped: 'empty',
        },
        error: null,
      },
    ]);
    expect(files(live)).toEqual([]);
    // A restart later that day: the slot is settled by the run row.
    await t.service.stop();
    await t.scheduler.stop();
    h = null;
    await harness(local(2030, 9, 15, 12), { live });
    await advanceTo(local(2030, 9, 15, 12, 5));
    expect(runs(live)).toHaveLength(1);
    // "Back up now" still copies an empty database.
    const { file } = await h!.service.backupNow();
    expect(file.kind).toBe('manual');
  });

  it('an empty skip stops settling the slot once data arrives (install day: skip, import, restart → one copy)', async () => {
    const live = await makeLiveDb({ seed: false });
    const t = await harness(local(2030, 9, 15, 10), { live });
    await advanceTo(local(2030, 9, 15, 10, 3));
    expect(runs(live).map((r) => r.detail?.skipped)).toEqual(['empty']);
    await t.service.stop();
    await t.scheduler.stop();
    h = null;
    // The first import, with the server down (as the CLI) or before the next check.
    seedKeepingRuns(live);
    // First restart: the slot's empty skip no longer settles it → one start-up copy.
    await harness(local(2030, 9, 15, 12), { live });
    await advanceTo(local(2030, 9, 15, 12, 3));
    expect(runs(live)).toHaveLength(2);
    expect(runs(live)[1]).toMatchObject({ trigger: 'startup', status: 'succeeded' });
    expect(nightlyFiles(live)).toHaveLength(1);
    await h!.service.stop();
    await h!.scheduler.stop();
    h = null;
    // Second restart: settled by that file → nothing.
    await harness(local(2030, 9, 15, 13), { live });
    await advanceTo(local(2030, 9, 15, 13, 5));
    expect(runs(live)).toHaveLength(2);
  });

  it('data arriving while the server runs is copied at the next wake (within the 6 h cap), once', async () => {
    const live = await makeLiveDb({ seed: false });
    await harness(local(2030, 9, 15, 10), { live });
    await advanceTo(local(2030, 9, 15, 10, 3));
    seedKeepingRuns(live);
    await advanceTo(local(2030, 9, 15, 16, 5));
    expect(runs(live)).toHaveLength(2);
    expect(runs(live)[1]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    await advanceTo(local(2030, 9, 16, 2, 0));
    expect(runs(live)).toHaveLength(2);
  });

  it('is not suppressed by a nightly file dated next year', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const future = plantNightly(live, local(2031, 9, 15, 2, 30));
    await harness(local(2030, 9, 15, 10), { live });
    await advanceTo(local(2030, 9, 15, 10, 3));
    expect(runs(live)).toHaveLength(1);
    expect(nightlyFiles(live)).toContain(future); // never pruned
  });

  it('takes one run when the clock jumps back a day, named with the real time', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    // Taken while the clock ran a day ahead: dated 16/09 although it was really 15/09.
    const ahead = plantNightly(live, local(2030, 9, 16, 2, 30));
    await harness(local(2030, 9, 16, 3), { live });
    await advanceTo(local(2030, 9, 16, 3, 5));
    expect(runs(live)).toEqual([]); // settled by the 16/09 file
    // The clock is corrected back a day. The 16/09 file is now ahead of now by more than the
    // slack, so it does not settle S(now) = 15/09 02:30: one run, within the 6 h wake cap.
    vi.setSystemTime(local(2030, 9, 15, 3, 5));
    await vi.advanceTimersByTimeAsync(BACKUP_WAKE_MAX_MS + 60_000);
    expect(runs(live)).toHaveLength(1);
    expect(runs(live)[0]?.detail?.slot).toBe('2030-09-15T02:30:00+10:00');
    expect(runs(live)[0]?.detail?.name).toMatch(/^nightly-20300915-0[3-9]\d{4}\+1000\.db$/);
    expect(nightlyFiles(live)).toContain(ahead);
    // The re-lived 16/09 slot is settled by the file dated then: no second run.
    await advanceTo(local(2030, 9, 16, 23));
    expect(runs(live)).toHaveLength(1);
  });
});

describe('failures and retries', () => {
  it('retries after 15 min, at most 3 attempts per slot, then waits for the next slot', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const secret = join(live.tempDir, 'secret-folder', 'x.db');
    let fail = true;
    const copy: CopyFn = (sqlite, target) => {
      if (fail)
        throw Object.assign(new Error(`SQLITE_CANTOPEN: ${secret}`), { code: 'SQLITE_CANTOPEN' });
      vacuumInto(sqlite, target);
    };
    const t = await harness(local(2030, 9, 15, 2), { live, copy });
    await advanceTo(local(2030, 9, 15, 2, 31));
    expect(runs(live)).toHaveLength(1);
    expect(t.service.status().nextRunAt).toBe('2030-09-15T02:45:00+10:00');
    await advanceTo(local(2030, 9, 15, 2, 46));
    expect(runs(live)).toHaveLength(2);
    await advanceTo(local(2030, 9, 15, 3, 1));
    expect(runs(live)).toHaveLength(3);
    await advanceTo(local(2030, 9, 15, 23));
    expect(runs(live)).toHaveLength(3);
    expect(runs(live).map((r) => [r.status, r.detail?.attempt, r.detail?.reason, r.error])).toEqual(
      [
        ['failed', 1, 'io', BACKUP_FAILURE_MESSAGES.io],
        ['failed', 2, 'io', BACKUP_FAILURE_MESSAGES.io],
        ['failed', 3, 'io', BACKUP_FAILURE_MESSAGES.io],
      ],
    );
    expect(t.service.status().nextRunAt).toBe('2030-09-16T02:30:00+10:00');
    // No path, no raw text anywhere: job_runs, lastRun, the log.
    expect(JSON.stringify(runs(live))).not.toContain('secret-folder');
    expect(JSON.stringify(t.service.status().lastRun)).not.toContain('secret-folder');
    expect(JSON.stringify(t.log.calls)).not.toContain('secret-folder');
    expect(t.log.calls.find((c) => c.msg === 'backup failed')?.obj).toEqual({
      kind: 'nightly',
      reason: 'io',
      code: 'SQLITE_CANTOPEN',
    });
    // The next night works again.
    fail = false;
    await advanceTo(local(2030, 9, 16, 2, 31));
    expect(runs(live).at(-1)).toMatchObject({ status: 'succeeded' });
    expect(runs(live).at(-1)?.detail?.attempt).toBe(1);
  });

  it('skips while an import holds the lock, retries after 15 min, and does not count it', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const t = await harness(local(2030, 9, 15, 2), { live });
    importLock.tryAcquire();
    await advanceTo(local(2030, 9, 15, 2, 31));
    await advanceTo(local(2030, 9, 15, 2, 46));
    await advanceTo(local(2030, 9, 15, 3, 1));
    await advanceTo(local(2030, 9, 15, 3, 16));
    expect(runs(live).map((r) => [r.status, r.detail?.skipped])).toEqual([
      ['partial', 'import_in_progress'],
      ['partial', 'import_in_progress'],
      ['partial', 'import_in_progress'],
      ['partial', 'import_in_progress'],
    ]);
    expect(t.service.status().nextRunAt).toBe('2030-09-15T03:30:00+10:00');
    importLock.release();
    await advanceTo(local(2030, 9, 15, 3, 31));
    expect(runs(live).at(-1)).toMatchObject({ status: 'succeeded' });
    expect(runs(live).at(-1)?.detail?.attempt).toBe(1);
    expect(nightlyFiles(live)).toContain('nightly-20300915-033000+1000.db');
  });
});

describe('manual and nightly together (async copy seam)', () => {
  it('a click during the nightly run joins it and returns the nightly file', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const gate = gatedCopy();
    const t = await harness(local(2030, 9, 15, 2, 29), { live, copy: gate.copy });
    await advanceTo(local(2030, 9, 15, 2, 30));
    expect(t.service.status().running).toBe(true);
    expect(t.service.status().nextRunAt).toBe('2030-09-16T02:30:00+10:00');
    const click = t.service.backupNow();
    gate.release();
    const result = await click;
    expect(result.joined).toBe(true);
    expect(result.file.kind).toBe('nightly');
    expect(result.file.name).toBe('nightly-20300915-023000+1000.db');
    expect(runs(live)).toHaveLength(1);
    expect(gate.started()).toBe(1);
  });

  it('a slot reached during a manual run joins it, then runs its own nightly copy', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 14, 2, 30));
    const gate = gatedCopy();
    const t = await harness(local(2030, 9, 15, 2, 29, 50), { live, copy: gate.copy });
    const click = t.service.backupNow();
    await advanceTo(local(2030, 9, 15, 2, 30, 5));
    expect(runs(live)).toHaveLength(1); // the slot joined the manual run
    gate.release();
    const result = await click;
    expect(result).toMatchObject({ joined: false, file: { kind: 'manual' } });
    await vi.advanceTimersByTimeAsync(10);
    gate.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(runs(live).map((r) => [r.trigger, r.detail?.kind, r.status])).toEqual([
      ['manual', 'manual', 'succeeded'],
      ['schedule', 'nightly', 'succeeded'],
    ]);
    expect(nightlyFiles(live)).toContain('nightly-20300915-023005+1000.db');
  });

  it('stop() waits for a run in flight', async () => {
    const live = await makeLiveDb({ seed: true });
    const gate = gatedCopy();
    const t = await harness(local(2030, 9, 15, 12), { live, copy: gate.copy });
    const click = t.service.backupNow();
    let stopped = false;
    const stopping = t.service.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);
    gate.release();
    await click;
    await stopping;
    expect(stopped).toBe(true);
    expect(files(live).filter((f) => f.startsWith('manual-'))).toHaveLength(1);
  });
});

describe('backupNow', () => {
  it('writes a manual copy and records the run with its detail', async () => {
    const live = await makeLiveDb({ seed: true });
    const t = await harness(local(2030, 9, 15, 14, 32), { live, start: false });
    const { file, joined } = await t.service.backupNow();
    expect(joined).toBe(false);
    expect(file).toMatchObject({
      name: 'manual-20300915-143200+1000.db',
      kind: 'manual',
      createdAt: '2030-09-15T14:32:00+10:00',
      keptAs: 'recent',
    });
    const [run] = runs(live);
    expect(run).toMatchObject({ trigger: 'manual', status: 'succeeded', error: null });
    expect(run?.detail).toMatchObject({
      kind: 'manual',
      name: 'manual-20300915-143200+1000.db',
      sizeBytes: file.sizeBytes,
      verified: true,
      pruned: [],
    });
    expect(typeof run?.detail?.durationMs).toBe('number');
    expect(run?.detail?.slot).toBeUndefined();
  });

  it('answers 409 while an import holds the lock', async () => {
    const t = await harness(local(2030, 9, 15, 14), { start: false });
    importLock.tryAcquire();
    await expect(t.service.backupNow()).rejects.toMatchObject({
      statusCode: 409,
      code: 'IMPORT_IN_PROGRESS',
    });
    expect(runs(t.live)).toEqual([]);
  });

  it('maps a failed run to a BackupError without the raw text', async () => {
    const copy: CopyFn = () => {
      throw Object.assign(new Error('disk full at /some/private/place'), { code: 'ENOSPC' });
    };
    const t = await harness(local(2030, 9, 15, 14), { start: false, copy });
    await expect(t.service.backupNow()).rejects.toMatchObject({
      statusCode: 500,
      code: 'BACKUP_FAILED',
      reason: 'no_space',
      message: BACKUP_FAILURE_MESSAGES.no_space,
    });
    expect(runs(t.live)[0]?.error).toBe(BACKUP_FAILURE_MESSAGES.no_space);
  });
});

describe('stale (§5.4)', () => {
  function addImportRun(live: LiveDb, startedAt: Date, dryRun = false): void {
    live.database.db
      .insert(importRuns)
      .values({
        startedAt: startedAt.toISOString(),
        finishedAt: startedAt.toISOString(),
        status: 'succeeded',
        dryRun,
        trigger: 'upload',
        fileName: 'workbook.xlsx',
        fileSha256: 'a'.repeat(64),
        fileSize: 1,
        importerVersion: '1.0.0',
      })
      .run();
  }

  it('is not stale on a fresh install (no data)', async () => {
    const live = await makeLiveDb({ seed: false });
    const t = await harness(local(2030, 9, 20, 10), { live, start: false });
    expect(t.service.staleness()).toEqual({ stale: false, lastBackupAt: null });
  });

  it('counts from the first committed import when there is no copy yet', async () => {
    const live = await makeLiveDb({ seed: true });
    live.database.db.delete(importRuns).run();
    addImportRun(live, local(2030, 9, 10, 10), true); // a dry run does not count
    addImportRun(live, local(2030, 9, 13, 10));
    const t = await harness(local(2030, 9, 15, 9), { live, start: false });
    expect(t.service.staleness()).toEqual({ stale: false, lastBackupAt: null });
    vi.setSystemTime(local(2030, 9, 15, 11));
    expect(t.service.staleness()).toEqual({ stale: true, lastBackupAt: null });
  });

  it('is stale 49 h after the newest nightly or manual copy (not a pre-import one)', async () => {
    const live = await makeLiveDb({ seed: true });
    plantNightly(live, local(2030, 9, 12, 2, 30));
    writeFileSync(
      join(backupsDir(live), formatBackupName('pre-import', local(2030, 9, 14, 10))),
      'x',
    );
    const t = await harness(local(2030, 9, 14, 2, 29), { live, start: false });
    expect(t.service.staleness()).toEqual({
      stale: false,
      lastBackupAt: '2030-09-12T02:30:00+10:00',
    });
    vi.setSystemTime(local(2030, 9, 14, 3, 30));
    expect(t.service.staleness().stale).toBe(true);
    // A future file never counts as fresh.
    plantNightly(live, local(2031, 9, 14, 2, 30));
    expect(t.service.staleness()).toEqual({
      stale: true,
      lastBackupAt: '2030-09-12T02:30:00+10:00',
    });
    // A manual copy counts.
    writeFileSync(join(backupsDir(live), formatBackupName('manual', local(2030, 9, 14, 3))), 'x');
    expect(t.service.staleness()).toEqual({
      stale: false,
      lastBackupAt: '2030-09-14T03:00:00+10:00',
    });
  });

  it('is never stale with the schedule off, and copes with no backups folder', async () => {
    const live = await makeLiveDb({ seed: true });
    addImportRun(live, local(2030, 1, 1, 10));
    const off = await harness(local(2030, 9, 15, 10), { live, start: false, enabled: false });
    expect(off.service.staleness()).toEqual({ stale: false, lastBackupAt: null });
    await off.service.stop();
    await off.scheduler.stop();
    h = null;
    const on = await harness(local(2030, 9, 15, 10), { live, start: false });
    expect(on.service.staleness()).toEqual({ stale: true, lastBackupAt: null });
  });
});
