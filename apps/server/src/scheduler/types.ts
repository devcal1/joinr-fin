// The scheduler contract (stage-1.md §5.1, frozen). Nothing here is price-specific: Stage 5
// (month-end snapshot) and Stage 7 (backups) register further jobs.
import type { JobName, JobRunSummary, JobTrigger } from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';

/** Time and timers, injectable for tests (fake timers). */
export interface Clock {
  now(): Date;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface JobContext {
  /** Aborted by `Scheduler.stop()` (and by a job's own deadline). */
  signal: AbortSignal;
  trigger: JobTrigger;
  now: () => Date;
  log: FastifyBaseLogger;
}

export interface JobResult {
  status: 'succeeded' | 'partial' | 'failed';
  detail?: Record<string, unknown>;
  error?: string;
}

export interface JobDefinition {
  name: JobName;
  /** 0 = manual only. */
  intervalMs: number;
  initialDelayMs?: number;
  run(ctx: JobContext): Promise<JobResult>;
}

export interface Scheduler {
  register(job: JobDefinition): void;
  start(): void;
  stop(): Promise<void>;
  /** Runs a job now; joins a run already in flight. Every run writes a `job_runs` row. */
  run(name: JobName, trigger?: JobTrigger): Promise<{ jobRunId: number; result: JobResult }>;
  isRunning(name: JobName): boolean;
  nextRunAt(name: JobName): Date | null;
  lastRun(name: JobName): JobRunSummary | null;
}
