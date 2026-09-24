import type { JobName } from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScheduler,
  JOB_RUNS_KEEP,
  SchedulerStoppedError,
  systemClock,
} from '../../src/scheduler/index';
import type { JobContext, JobDefinition, JobResult, Scheduler } from '../../src/scheduler/types';
import { silentLogger } from '../market/helpers';

const JOB: JobName = 'prices';
const START = new Date('2026-09-24T02:00:00.000Z');

let testDb: TestDb;
let scheduler: Scheduler;

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  testDb = createTestDb();
  scheduler = createScheduler({ db: testDb.db, log: silentLogger(), clock: systemClock });
});

afterEach(async () => {
  await scheduler.stop();
  vi.useRealTimers();
  testDb.close();
});

function rows() {
  return testDb.db.select().from(jobRuns).where(eq(jobRuns.job, JOB)).all();
}

function job(
  run: (ctx: JobContext) => Promise<JobResult>,
  over: Partial<JobDefinition> = {},
): JobDefinition {
  return { name: JOB, intervalMs: 60_000, run, ...over };
}

const ok = async (): Promise<JobResult> => ({ status: 'succeeded', detail: { n: 1 } });

describe('timers', () => {
  it('runs first after 15 s, then every interval', async () => {
    const run = vi.fn((_ctx: JobContext) => ok());
    scheduler.register(job(run));
    expect(scheduler.nextRunAt(JOB)).toBeNull();
    scheduler.start();
    expect(scheduler.nextRunAt(JOB)).toEqual(new Date(START.getTime() + 15_000));

    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].trigger).toBe('schedule');
    expect(scheduler.nextRunAt(JOB)).toEqual(new Date(START.getTime() + 75_000));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(rows().map((r) => [r.trigger, r.status])).toEqual([
      ['schedule', 'succeeded'],
      ['schedule', 'succeeded'],
    ]);
  });

  it('honours initialDelayMs', async () => {
    const run = vi.fn(ok);
    scheduler.register(job(run, { initialDelayMs: 1_000 }));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('schedules a job registered after start()', async () => {
    scheduler.start();
    const run = vi.fn(ok);
    scheduler.register(job(run));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('interval 0 means manual only', async () => {
    const run = vi.fn(ok);
    scheduler.register(job(run, { intervalMs: 0 }));
    scheduler.start();
    expect(scheduler.nextRunAt(JOB)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).not.toHaveBeenCalled();
    const { result } = await scheduler.run(JOB);
    expect(result.status).toBe('succeeded');
    expect(rows().map((r) => r.trigger)).toEqual(['manual']);
  });

  it('never overlaps: the next run is scheduled after the current one ends', async () => {
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async (ctx: JobContext): Promise<JobResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Longer than the interval; ends early when stop() aborts it.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 100_000);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
      active -= 1;
      return { status: 'succeeded' };
    });
    scheduler.register(job(run, { intervalMs: 30_000 }));
    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(scheduler.isRunning(JOB)).toBe(true);
    expect(scheduler.nextRunAt(JOB)).toBeNull();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.nextRunAt(JOB)).toEqual(new Date(START.getTime() + 145_000));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(maxActive).toBe(1);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('run()', () => {
  it('joins an in-flight run', async () => {
    let release!: () => void;
    const run = vi.fn(async (): Promise<JobResult> => {
      await new Promise<void>((r) => (release = r));
      return { status: 'partial', detail: { ok: 1, failed: 1 } };
    });
    scheduler.register(job(run, { intervalMs: 0 }));
    const a = scheduler.run(JOB, 'manual');
    const b = scheduler.run(JOB, 'import');
    expect(scheduler.isRunning(JOB)).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: 'running', trigger: 'manual', finishedAt: null });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.jobRunId).toBe(rb.jobRunId);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning(JOB)).toBe(false);
    expect(scheduler.lastRun(JOB)).toEqual({
      id: ra.jobRunId,
      job: JOB,
      trigger: 'manual',
      startedAt: START.toISOString(),
      finishedAt: START.toISOString(),
      status: 'partial',
      detail: { ok: 1, failed: 1 },
      error: null,
    });
  });

  it('records a job that throws as failed', async () => {
    scheduler.register(
      job(async () => {
        throw new Error('boom');
      }),
    );
    const { result } = await scheduler.run(JOB);
    expect(result).toEqual({ status: 'failed', error: 'boom' });
    expect(scheduler.lastRun(JOB)).toMatchObject({ status: 'failed', error: 'boom', detail: null });
  });

  it('rejects unknown and duplicate jobs', async () => {
    await expect(scheduler.run(JOB)).rejects.toThrow('Unknown job');
    scheduler.register(job(ok));
    expect(() => scheduler.register(job(ok))).toThrow('already registered');
  });

  it('passes the clock to the job', async () => {
    let seen: Date | null = null;
    scheduler.register(
      job(async (ctx) => {
        seen = ctx.now();
        return { status: 'succeeded' };
      }),
    );
    await scheduler.run(JOB);
    expect(seen).toEqual(START);
  });

  it('keeps the newest 500 rows per job', async () => {
    const old = Array.from({ length: JOB_RUNS_KEEP + 5 }, (_, i) => ({
      job: JOB,
      trigger: 'schedule' as const,
      startedAt: new Date(START.getTime() - (i + 1) * 60_000).toISOString(),
      finishedAt: null,
      status: 'succeeded' as const,
    }));
    testDb.db.insert(jobRuns).values(old).run();
    // Another job's rows are left alone.
    testDb.db
      .insert(jobRuns)
      .values({
        job: 'snapshot',
        trigger: 'schedule',
        startedAt: START.toISOString(),
        status: 'succeeded',
      })
      .run();
    scheduler.register(job(ok));
    const { jobRunId } = await scheduler.run(JOB);
    const kept = rows();
    expect(kept).toHaveLength(JOB_RUNS_KEEP);
    expect(kept.some((r) => r.id === jobRunId)).toBe(true);
    const oldest = kept.map((r) => r.startedAt).sort()[0]!;
    expect(oldest).toBe(new Date(START.getTime() - (JOB_RUNS_KEEP - 1) * 60_000).toISOString());
    expect(testDb.db.select().from(jobRuns).where(eq(jobRuns.job, 'snapshot')).all()).toHaveLength(
      1,
    );
  });
});

describe('stop()', () => {
  it('clears the timers, aborts the in-flight run and waits for it', async () => {
    let sawAbort = false;
    let finished = false;
    scheduler.register(
      job(async (ctx) => {
        await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));
        sawAbort = ctx.signal.aborted;
        await Promise.resolve();
        finished = true;
        return { status: 'failed', error: 'aborted' };
      }),
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(scheduler.isRunning(JOB)).toBe(true);

    await scheduler.stop();
    expect(sawAbort).toBe(true);
    expect(finished).toBe(true);
    expect(scheduler.isRunning(JOB)).toBe(false);
    expect(scheduler.nextRunAt(JOB)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(rows()[0]).toMatchObject({ status: 'failed', error: 'aborted' });
    await expect(scheduler.run(JOB)).rejects.toBeInstanceOf(SchedulerStoppedError);
  });

  it('stops pending timers before any run', async () => {
    const run = vi.fn(ok);
    scheduler.register(job(run));
    scheduler.start();
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).not.toHaveBeenCalled();
  });

  it('can be started again after stop()', async () => {
    const run = vi.fn(ok);
    scheduler.register(job(run));
    scheduler.start();
    await scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
