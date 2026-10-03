// The `closes` job (stage-10.md §5.7): the daily price history behind the phone's periods. It is
// registered by the market service in modes `live` and `fake` (so `scheduler.run('closes')` always
// works); only its timers depend on CLOSES_REFRESH: daily at 16:52 server-local, one start-up run
// after CLOSES_STARTUP_DELAY_MS (the 1.3.0 backfill; a restart re-runs the job), and, when a run
// left targets (deadline or cool-down), one follow-up at least CLOSES_FOLLOW_UP_MS later snapped to
// xx:07/22/37/52 (at most CLOSES_FOLLOW_UPS_MAX a day).
//
// Before every request a run pauses while `prices`, `intraday` or `dividends` runs (bounded by its
// deadline; it never waits for a `prices` run that is itself waiting for this one). Before a
// CoinGecko call it also waits out an intraday crypto slot firing within CLOSES_COIN_SLOT_GUARD_MS,
// then that run, then CLOSES_COIN_SPACING_MS.
import {
  CLOSES_COIN_SLOT_GUARD_MS,
  CLOSES_COIN_SPACING_MS,
  CLOSES_FOLLOW_UPS_MAX,
  CLOSES_RUN_DEADLINE_MS,
  CLOSES_STARTUP_DELAY_MS,
  dateInZone,
  INTRADAY_WAKE_MAX_MS,
  type IsoDate,
  type JobName,
} from '@joinr/schema';
import type { JoinrDb } from '@joinr/schema/db';
import type { FastifyBaseLogger } from 'fastify';
import { SchedulerStoppedError } from '../../scheduler/index';
import type { Clock, JobContext, JobResult, Scheduler } from '../../scheduler/types';
import type { Sleep } from '../providers/types';
import type { Cooldowns } from '../refresh';
import { closesStatus, runCloses, type ClosesClients } from './run';
import { followUpAtMs, nextCryptoSlotFireMs, nextDailyRunMs } from './schedule';
import { ClosesMemory } from './targets';

export const CLOSES_JOB = 'closes' as const;
/** After an intraday slot's fire time, how long the coin guard waits before looking for its run. */
export const CLOSES_SLOT_SETTLE_MS = 1_000;

export type { ClosesClients, ClosesDetail } from './run';

export interface ClosesJobOptions {
  db: JoinrDb;
  scheduler: Scheduler;
  clients: ClosesClients;
  cooldowns: Cooldowns;
  clock: Clock;
  sleep: Sleep;
  log: FastifyBaseLogger;
  timeZone: string;
  /** CLOSES_REFRESH: arm the daily, start-up and follow-up timers. Off: manual runs only. */
  timerEnabled: boolean;
  /** The intraday job: its run in flight, and whether its slot timer fires (INTRADAY_REFRESH). */
  intraday: { inFlight(): Promise<void> | null; slotsEnabled: boolean } | null;
  /** True while the `prices` job waits for this job's run in flight (never pause for it then). */
  pricesAwaitingCloses(): boolean;
  /** Test knobs. */
  runDeadlineMs?: number;
  coinSpacingMs?: number;
  startupDelayMs?: number;
}

export interface ClosesJob {
  /** Clears the timers (idempotent); a run in flight is the scheduler's to abort. */
  stop(): void;
  /** The run in flight, or null (the `prices` job waits for it). */
  inFlight(): Promise<void> | null;
  /** Wakes a run paused on another job (the `prices` job calls it when it starts waiting). */
  wake(): void;
}

const PAUSE_JOBS: readonly JobName[] = ['prices', 'dividends'];
const noop = (): void => undefined;

export function createClosesJob(o: ClosesJobOptions): ClosesJob {
  const { db, scheduler, clock, log, timeZone } = o;
  const deadlineMs = o.runDeadlineMs ?? CLOSES_RUN_DEADLINE_MS;
  const coinSpacingMs = o.coinSpacingMs ?? CLOSES_COIN_SPACING_MS;
  const memory = new ClosesMemory();

  let stopped = false;
  let current: Promise<void> | null = null;
  let dailyTimer: unknown = null;
  let startupTimer: unknown = null;
  let followUpTimer: unknown = null;
  let followUps: { date: IsoDate | null; count: number } = { date: null, count: 0 };
  let wakers: Array<() => void> = [];

  function wake(): void {
    const due = wakers;
    wakers = [];
    for (const w of due) w();
  }

  /** Resolves when `signal` aborts; `cancel` removes the listener. */
  function onAbort(signal: AbortSignal): { promise: Promise<void>; cancel(): void } {
    let cancel = noop;
    const promise = new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = (): void => resolve();
      signal.addEventListener('abort', done, { once: true });
      cancel = () => signal.removeEventListener('abort', done);
    });
    return { promise, cancel: () => cancel() };
  }

  /** §5.7: waits while `prices`, `intraday` or `dividends` runs (bounded by the run's signal). */
  async function pause(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) return;
      const waits: Array<Promise<unknown>> = [];
      if (scheduler.isRunning('intraday')) {
        waits.push(o.intraday?.inFlight() ?? scheduler.run('intraday'));
      }
      // A `prices` run waiting for this run would wait for us while we wait for it (and a
      // `dividends` run waits for `prices`): while it waits, only intraday pauses this run.
      if (!o.pricesAwaitingCloses()) {
        for (const job of PAUSE_JOBS) if (scheduler.isRunning(job)) waits.push(scheduler.run(job));
      }
      if (waits.length === 0) return;
      const aborted = onAbort(signal);
      let waker = noop;
      const woken = new Promise<void>((resolve) => {
        waker = resolve;
        wakers.push(resolve);
      });
      try {
        await Promise.race([...waits.map((p) => p.then(noop, noop)), woken, aborted.promise]);
      } finally {
        aborted.cancel();
        wakers = wakers.filter((w) => w !== waker);
      }
    }
  }

  /** §5.7: the CoinGecko slot guard (only while the intraday slots fire). */
  async function coinSlotGuard(signal: AbortSignal): Promise<void> {
    if (!o.intraday?.slotsEnabled || signal.aborted) return;
    const now = clock.now().getTime();
    const fireAt = nextCryptoSlotFireMs(now, timeZone);
    if (fireAt - now > CLOSES_COIN_SLOT_GUARD_MS) return;
    await o.sleep(fireAt - now + CLOSES_SLOT_SETTLE_MS, signal);
    await pause(signal);
    await o.sleep(coinSpacingMs, signal);
  }

  async function beforeRequest(provider: 'yahoo' | 'coingecko', signal: AbortSignal) {
    await pause(signal);
    if (provider === 'coingecko') await coinSlotGuard(signal);
  }

  async function runJob(ctx: JobContext): Promise<JobResult> {
    let release!: () => void;
    current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deadline = new AbortController();
    const deadlineHandle = clock.setTimeout(() => deadline.abort(), deadlineMs);
    const signal = AbortSignal.any([ctx.signal, deadline.signal]);
    try {
      const out = await runCloses({
        db,
        clients: o.clients,
        cooldowns: o.cooldowns,
        now: () => clock.now(),
        sleep: o.sleep,
        signal,
        log,
        timeZone,
        memory,
        beforeRequest: (provider) => beforeRequest(provider, signal),
        coinSpacingMs,
      });
      const status = closesStatus(out.detail, out.aborted);
      log.info(
        {
          job: CLOSES_JOB,
          trigger: ctx.trigger,
          status,
          backfills: out.detail.backfills,
          topUps: out.detail.topUps,
          rows: out.detail.rows,
          left: out.detail.left,
        },
        'daily closes finished',
      );
      const result: JobResult = { status, detail: { ...out.detail } };
      if (deadline.signal.aborted) result.error = 'Run deadline reached';
      else if (ctx.signal.aborted) result.error = 'Run aborted';
      scheduleFollowUp(out.detail.left);
      return result;
    } finally {
      clock.clearTimeout(deadlineHandle);
      current = null;
      release();
    }
  }

  scheduler.register({ name: CLOSES_JOB, intervalMs: 0, run: runJob });

  function trigger(): void {
    if (stopped || scheduler.isRunning(CLOSES_JOB)) return;
    scheduler.run(CLOSES_JOB, 'schedule').catch((err: unknown) => {
      if (!(err instanceof SchedulerStoppedError)) {
        log.error({ job: CLOSES_JOB }, 'scheduled closes run failed');
      }
    });
  }

  /** The daily 16:52 timer, waking at least hourly so a sleeping host still finds its time. */
  function armDaily(target?: number): void {
    if (stopped) return;
    const now = clock.now().getTime();
    const at = target ?? nextDailyRunMs(now, timeZone);
    if (at === null) return;
    dailyTimer = clock.setTimeout(
      () => {
        dailyTimer = null;
        if (stopped) return;
        if (clock.now().getTime() < at) {
          armDaily(at);
          return;
        }
        trigger();
        armDaily();
      },
      Math.min(Math.max(0, at - now), INTRADAY_WAKE_MAX_MS),
    );
  }

  /** One follow-up after a run that left targets (at most CLOSES_FOLLOW_UPS_MAX a day). */
  function scheduleFollowUp(left: number): void {
    if (!o.timerEnabled || stopped || left === 0 || followUpTimer !== null) return;
    const end = clock.now().getTime();
    const at = followUpAtMs(end, timeZone);
    const day = dateInZone(at, timeZone);
    if (followUps.date !== day) followUps = { date: day, count: 0 };
    if (followUps.count >= CLOSES_FOLLOW_UPS_MAX) return;
    followUps.count += 1;
    followUpTimer = clock.setTimeout(() => {
      followUpTimer = null;
      if (!stopped) trigger();
    }, at - end);
  }

  if (o.timerEnabled) {
    startupTimer = clock.setTimeout(() => {
      startupTimer = null;
      if (!stopped) trigger();
    }, o.startupDelayMs ?? CLOSES_STARTUP_DELAY_MS);
    armDaily();
  }

  return {
    stop() {
      stopped = true;
      for (const t of [dailyTimer, startupTimer, followUpTimer]) {
        if (t !== null) clock.clearTimeout(t);
      }
      dailyTimer = null;
      startupTimer = null;
      followUpTimer = null;
      wake();
    },
    inFlight: () => current,
    wake,
  };
}
