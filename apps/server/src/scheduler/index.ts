// Generic job scheduler (stage-1.md §5.5). Each job with an interval runs first `initialDelayMs`
// (default 15 s) after start(), then every interval (a setTimeout chain on the injectable clock,
// unref'd). Runs of one job never overlap: run() joins an in-flight run. Every run writes a
// `job_runs` row; the newest 500 rows per job are kept. stop() clears the timers, aborts the
// in-flight runs and waits for them. Nothing here is price-specific.
import type { JobName, JobRunSummary, JobTrigger } from '@joinr/schema';
import { jobRuns, type JoinrDb } from '@joinr/schema/db';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock, JobDefinition, JobResult, Scheduler } from './types';

export type { Clock, JobContext, JobDefinition, JobResult, Scheduler } from './types';

/** Delay before a job's first scheduled run when it sets no `initialDelayMs`. */
export const DEFAULT_INITIAL_DELAY_MS = 15_000;
/** `job_runs` rows kept per job. */
export const JOB_RUNS_KEEP = 500;

/** The real clock; timers are unref'd so they never keep the process alive. */
export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface InFlight {
  controller: AbortController;
  promise: Promise<{ jobRunId: number; result: JobResult }>;
}

interface Timer {
  handle: unknown;
  at: Date;
}

export class SchedulerStoppedError extends Error {
  constructor() {
    super('The scheduler is stopped');
    this.name = 'SchedulerStoppedError';
  }
}

function toSummary(row: typeof jobRuns.$inferSelect): JobRunSummary {
  let detail: Record<string, unknown> | null = null;
  if (row.detailJson) {
    try {
      const parsed: unknown = JSON.parse(row.detailJson);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        detail = parsed as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }
  return {
    id: row.id,
    job: row.job,
    trigger: row.trigger,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    detail,
    error: row.error,
  };
}

export function createScheduler(o: {
  db: JoinrDb;
  log: FastifyBaseLogger;
  clock?: Clock;
}): Scheduler {
  const clock = o.clock ?? systemClock;
  const jobs = new Map<JobName, JobDefinition>();
  const inFlight = new Map<JobName, InFlight>();
  const timers = new Map<JobName, Timer>();
  let started = false;
  let stopped = false;

  function lastRun(name: JobName): JobRunSummary | null {
    const row = o.db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, name))
      .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
      .limit(1)
      .get();
    return row ? toSummary(row) : null;
  }

  function prune(name: JobName): void {
    const keep = o.db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(eq(jobRuns.job, name))
      .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
      .limit(JOB_RUNS_KEEP)
      .all()
      .map((r) => r.id);
    if (keep.length < JOB_RUNS_KEEP) return;
    o.db
      .delete(jobRuns)
      .where(and(eq(jobRuns.job, name), notInArray(jobRuns.id, keep)))
      .run();
  }

  function run(
    name: JobName,
    trigger: JobTrigger = 'manual',
  ): Promise<{ jobRunId: number; result: JobResult }> {
    const running = inFlight.get(name);
    if (running) return running.promise;
    if (stopped) return Promise.reject(new SchedulerStoppedError());
    const job = jobs.get(name);
    if (!job) return Promise.reject(new Error(`Unknown job: ${name}`));

    const controller = new AbortController();
    let jobRunId: number;
    try {
      jobRunId = o.db
        .insert(jobRuns)
        .values({ job: name, trigger, startedAt: clock.now().toISOString(), status: 'running' })
        .returning({ id: jobRuns.id })
        .get().id;
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }

    const promise = (async () => {
      let result: JobResult;
      try {
        result = await job.run({
          signal: controller.signal,
          trigger,
          now: () => clock.now(),
          log: o.log,
        });
      } catch (err) {
        o.log.error({ err, job: name }, 'job failed');
        result = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
      try {
        o.db
          .update(jobRuns)
          .set({
            finishedAt: clock.now().toISOString(),
            status: result.status,
            detailJson: result.detail ? JSON.stringify(result.detail) : null,
            error: result.error ?? null,
          })
          .where(eq(jobRuns.id, jobRunId))
          .run();
        prune(name);
      } catch (err) {
        o.log.error({ err, job: name }, 'could not record the job run');
      }
      return { jobRunId, result };
    })().finally(() => inFlight.delete(name));

    inFlight.set(name, { controller, promise });
    return promise;
  }

  function schedule(job: JobDefinition, delayMs: number): void {
    if (!started || stopped || job.intervalMs <= 0) return;
    const at = new Date(clock.now().getTime() + delayMs);
    const handle = clock.setTimeout(() => {
      timers.delete(job.name);
      run(job.name, 'schedule')
        .catch((err: unknown) => {
          if (!(err instanceof SchedulerStoppedError))
            o.log.error({ err, job: job.name }, 'scheduled run failed');
        })
        .finally(() => schedule(job, job.intervalMs));
    }, delayMs);
    timers.set(job.name, { handle, at });
  }

  function clearTimer(name: JobName): void {
    const timer = timers.get(name);
    if (timer) clock.clearTimeout(timer.handle);
    timers.delete(name);
  }

  return {
    register(job) {
      if (jobs.has(job.name)) throw new Error(`Job already registered: ${job.name}`);
      jobs.set(job.name, job);
      if (started) schedule(job, job.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
    },
    start() {
      if (started && !stopped) return;
      started = true;
      stopped = false;
      for (const job of jobs.values()) {
        clearTimer(job.name);
        schedule(job, job.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
      }
    },
    async stop() {
      stopped = true;
      for (const name of [...timers.keys()]) clearTimer(name);
      const running = [...inFlight.values()];
      for (const r of running) r.controller.abort();
      await Promise.allSettled(running.map((r) => r.promise));
    },
    run,
    isRunning: (name) => inFlight.has(name),
    nextRunAt: (name) => timers.get(name)?.at ?? null,
    lastRun,
  };
}
