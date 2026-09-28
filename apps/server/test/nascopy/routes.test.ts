// The NAS copy routes (stage-8.md §4, §5.11–§5.13): the `nasCopy` block of GET /api/backups in
// each configuration state (built from planted files and job_runs, the fixtures' shapes), POST
// /api/backups/nas-copy (202 started / joined with the running row, 409 off / partial / invalid
// with the exact messages and no row, 409 FIX_FIRST while locked, 400 for a body, 403 cross-site),
// a malformed nas-url never turning a status call into a 500, GET /api/status `nasCopy`, and the
// leak test across bodies, rows and the app's whole log output (the leak-object cases included).
process.env.TZ = 'Australia/Melbourne';

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  NAS_COPY_FIX_FIRST_MESSAGE,
  NAS_COPY_OFF_MESSAGE,
  nasCopyFailureMessage,
  type ApiErrorBody,
  type AppStatus,
  type BackupsResponse,
  type NasCopyJobDetail,
  type NasCopyNowResponse,
} from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import { nasCopyStates } from '@joinr/schema/fixtures';
import { asc, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import type { Config } from '../../src/config';
import { runRsync, type RsyncResult, type RsyncRunner } from '../../src/nascopy/runner';
import { createNasCopyService } from '../../src/nascopy/service';
import { createScheduler } from '../../src/scheduler/index';
import { testConfig } from '../helpers';
import { makeLiveDb, type LiveDb } from '../backups/helpers';
import {
  expectNoLeak,
  FakeNas,
  passwordFile,
  PLANTED,
  PLANTED_URL,
  plantNasFiles,
  plantTypical,
  writeSecret,
} from './helpers';

let live: LiveDb;
let app: FastifyInstance | undefined;
let logLines: string[];
let nas: FakeNas;
let runner: RsyncRunner;

beforeEach(async () => {
  live = await makeLiveDb({ seed: true });
  plantTypical(live.dataDir);
  logLines = [];
  nas = new FakeNas(live.dataDir);
  runner = nas.runner;
});

afterEach(async () => {
  if (app) await settle(app);
  // The leak test (§5.12): every row, and the whole log output of every test.
  const all: unknown[] = live.database.sqlite.open
    ? live.database.sqlite.prepare("SELECT * FROM job_runs WHERE job = 'nas-copy'").all()
    : [];
  if (app) await app.close();
  app = undefined;
  for (const row of all) expectNoLeak(JSON.stringify(row), 'job_runs');
  expectNoLeak(logLines.join('\n'), 'log');
  expect(nas.violations).toEqual([]);
  await live.cleanup();
});

async function start(overrides: Partial<Config> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    config: testConfig(live.dataDir, { logLevel: 'trace', ...overrides }),
    db: live.database,
    version: '1.2.3',
    nasCopyRunner: (args, opts) => runner(args, opts),
    logStream: { write: (line: string) => void logLines.push(line) },
  });
  return app;
}

/** Waits (real time) until no copy runs. */
async function settle(instance: FastifyInstance): Promise<void> {
  for (let i = 0; i < 400 && instance.scheduler.isRunning('nas-copy'); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function getJson<T>(
  instance: FastifyInstance,
  url: string,
): Promise<{ status: number; body: T; raw: string }> {
  const res = await instance.inject({ method: 'GET', url });
  expectNoLeak(res.body, `GET ${url}`);
  return { status: res.statusCode, body: res.json<T>(), raw: res.body };
}

async function post(
  instance: FastifyInstance,
  o: { body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await instance.inject({
    method: 'POST',
    url: '/api/backups/nas-copy',
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...o.headers,
    },
    payload: o.body,
  });
  expectNoLeak(res.body, 'POST body');
  return { status: res.statusCode, body: res.json() };
}

interface Row {
  id: number;
  trigger: string;
  status: string;
  detail: NasCopyJobDetail | null;
  error: string | null;
}

function rows(): Row[] {
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
      detail: r.detailJson ? (JSON.parse(r.detailJson) as NasCopyJobDetail) : null,
      error: r.error,
    }));
}

/** A runner the test releases by hand. */
function gatedRunner(): { runner: RsyncRunner; release: () => void } {
  const waiting: Array<() => void> = [];
  return {
    runner: (args, opts) =>
      new Promise<void>((resolve) => waiting.push(resolve)).then(() => nas.runner(args, opts)),
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
  };
}

const answering =
  (code: number, err = ''): RsyncRunner =>
  () =>
    Promise.resolve<RsyncResult>({ code, out: '', err, outTruncated: false });

describe('GET /api/backups: the nasCopy block', () => {
  it('off: the fixture shape, no row', async () => {
    const { status, body } = await getJson<BackupsResponse>(await start(), '/api/backups');
    expect(status).toBe(200);
    expect(Object.keys(body.nasCopy).sort()).toEqual(Object.keys(nasCopyStates.off).sort());
    expect(body.nasCopy).toEqual({
      ...nasCopyStates.off,
      schedule: { ...nasCopyStates.off.schedule, enabled: false, timeZone: 'Australia/Melbourne' },
    });
  });

  it.each([
    ['partial (password)', { password: null }, 'partial', 'password_missing', ['nas-password']],
    ['partial (url)', { url: null }, 'partial', 'url_missing', ['nas-url']],
    ['invalid (url)', { url: 'rsync://u:pw@h/m' }, 'invalid', 'url_invalid', []],
    ['invalid (password)', { password: 'a\u0000b' }, 'invalid', 'password_invalid', []],
    ['ready', {}, 'ready', null, []],
  ] as const)('%s', async (_name, files, configured, configReason, missing) => {
    plantNasFiles(live.dataDir, files);
    const instance = await start({ weeklyNasCopy: true });
    const { body } = await getJson<BackupsResponse>(instance, '/api/backups');
    expect(body.nasCopy).toMatchObject({
      configured,
      configReason,
      missing,
      blockedUntilFilesChange: false,
    });
    expect(body.nasCopy.schedule.enabled).toBe(true);
    if (configured === 'ready') expect(body.nasCopy.schedule.nextRunAt).toMatch(/[+-]\d{2}:\d{2}$/);
    else expect(body.nasCopy.schedule.nextRunAt).toBeNull();
    const status = await getJson<AppStatus>(instance, '/api/status');
    expect(status.body.nasCopy).toEqual({
      configured,
      configReason,
      blocked: false,
      stale: false,
      lastSuccessAt: null,
    });
  });

  it('a malformed nas-url (rsync://u%zz@h/m): both status calls 200 with invalid / url_invalid', async () => {
    plantNasFiles(live.dataDir, { url: 'rsync://u%zz@h/m' });
    const instance = await start();
    const backups = await getJson<BackupsResponse>(instance, '/api/backups');
    expect(backups.status).toBe(200);
    expect(backups.body.nasCopy).toMatchObject({
      configured: 'invalid',
      configReason: 'url_invalid',
    });
    const status = await getJson<AppStatus>(instance, '/api/status');
    expect(status.status).toBe(200);
    expect(status.body.nasCopy).toMatchObject({
      configured: 'invalid',
      configReason: 'url_invalid',
    });
  });
});

describe('POST /api/backups/nas-copy', () => {
  it('202 started: the running row with its id; then succeeded, proved', async () => {
    plantNasFiles(live.dataDir);
    const gate = gatedRunner();
    runner = gate.runner;
    const instance = await start();
    const res = await post(instance);
    expect(res.status).toBe(202);
    const body = res.body as NasCopyNowResponse;
    expect(body.joined).toBe(false);
    expect(body.nasCopy.running).toBe(true);
    expect(body.nasCopy.lastRun).toMatchObject({
      job: 'nas-copy',
      trigger: 'manual',
      status: 'running',
    });
    expect(body.nasCopy.lastRun?.id).toBe(rows()[0]?.id);
    // A second click joins the same run.
    const again = await post(instance, { body: '{}' });
    expect(again.status).toBe(202);
    expect((again.body as NasCopyNowResponse).joined).toBe(true);
    expect((again.body as NasCopyNowResponse).nasCopy.lastRun?.id).toBe(body.nasCopy.lastRun?.id);
    gate.release();
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      gate.release();
    }
    await settle(instance);
    expect(rows()).toHaveLength(1);
    const { body: after } = await getJson<BackupsResponse>(instance, '/api/backups');
    expect(after.nasCopy.running).toBe(false);
    expect(after.nasCopy.lastRun).toMatchObject({ status: 'succeeded', error: null });
    expect(after.nasCopy.lastRun?.detail).toMatchObject({
      sent: 27,
      alreadyThere: 0,
      onNas: 27,
      missingAfter: 0,
    });
    expect(after.nasCopy.lastSuccessAt).toBe(after.nasCopy.lastRun?.finishedAt);
  });

  it.each([
    ['off', { url: null, password: null }, NAS_COPY_OFF_MESSAGE],
    ['url_missing', { url: null }, nasCopyFailureMessage('url_missing')],
    ['password_missing', { password: null }, nasCopyFailureMessage('password_missing')],
    [
      'url_invalid',
      { url: `rsync://${PLANTED.user}:${PLANTED.password}@${PLANTED.host}/${PLANTED.module}` },
      nasCopyFailureMessage('url_invalid'),
    ],
    [
      'password_invalid',
      { password: `${PLANTED.password}\u0000` },
      nasCopyFailureMessage('password_invalid'),
    ],
  ] as const)(
    '409 NAS_COPY_NOT_READY when %s, with no row written',
    async (_name, files, message) => {
      plantNasFiles(live.dataDir, files);
      const res = await post(await start());
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'NAS_COPY_NOT_READY', message },
      } satisfies ApiErrorBody);
      expect(rows()).toEqual([]);
      expect(nas.calls).toEqual([]);
    },
  );

  it('409 NAS_COPY_FIX_FIRST while the refusal lock holds; placing the files again unlocks it', async () => {
    plantNasFiles(live.dataDir, { at: new Date(Date.now() - 60_000) });
    runner = answering(5, `@ERROR: auth failed on module ${PLANTED.module}`);
    const instance = await start();
    expect((await post(instance)).status).toBe(202);
    await settle(instance);
    expect(rows().map((r) => r.detail?.reason)).toEqual(['auth']);
    const locked = await post(instance);
    expect(locked.status).toBe(409);
    expect(locked.body).toEqual({
      error: { code: 'NAS_COPY_FIX_FIRST', message: NAS_COPY_FIX_FIRST_MESSAGE },
    });
    expect(rows()).toHaveLength(1);
    const { body } = await getJson<BackupsResponse>(instance, '/api/backups');
    expect(body.nasCopy.blockedUntilFilesChange).toBe(true);
    expect(body.nasCopy.lastRun?.error).toBe(nasCopyFailureMessage('auth', { code: 5 }));
    const status = await getJson<AppStatus>(instance, '/api/status');
    expect(status.body.nasCopy?.blocked).toBe(true);
    writeSecret(passwordFile(live.dataDir), `${PLANTED.password}\n`, new Date(Date.now() + 1000));
    runner = nas.runner;
    expect((await post(instance)).status).toBe(202);
    await settle(instance);
    expect(rows().at(-1)?.status).toBe('succeeded');
  });

  it('400 for a body other than none or {}', async () => {
    plantNasFiles(live.dataDir);
    const instance = await start();
    for (const body of ['{"x":1}', '[]', '"x"', 'not json']) {
      const res = await post(instance, { body });
      expect(res.status).toBe(400);
      expect((res.body as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
    }
    expect(rows()).toEqual([]);
  });

  it('403 cross-site (Fetch Metadata, and a foreign Origin in production)', async () => {
    plantNasFiles(live.dataDir);
    const instance = await start({ nodeEnv: 'production' });
    const fetchSite = await post(instance, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(fetchSite.status).toBe(403);
    expect((fetchSite.body as ApiErrorBody).error.code).toBe('CROSS_SITE_REQUEST');
    const origin = await post(instance, { headers: { origin: 'http://elsewhere.invalid' } });
    expect(origin.status).toBe(403);
    expect(rows()).toEqual([]);
  });

  it('GET /api/backups/nas-copy is a name that fails the rule (400)', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/api/backups/nas-copy' });
    expect(res.statusCode).toBe(400);
  });
});

describe('the leak test (§5.12)', () => {
  const hostile = (): Error =>
    Object.assign(new Error(`planted message ${PLANTED_URL} ${PLANTED.password}`), {
      code: 'EACCES',
      spawnargs: ['rsync', PLANTED_URL],
      path: `/home/${PLANTED.user}/rsync`,
      cause: new Error(`${PLANTED.host} ${PLANTED.module} ${PLANTED.password}`),
      planted: PLANTED,
    });

  class ErrorChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    kill(): boolean {
      return true;
    }
  }

  it('(a) a spawn error carrying spawnargs, path, cause and a planted message', async () => {
    plantNasFiles(live.dataDir);
    for (const code of ['EACCES', 'ENOENT']) {
      runner = (args, opts) =>
        runRsync(args, opts, () => {
          const child = new ErrorChild();
          const err = Object.assign(hostile(), { code });
          setImmediate(() => child.emit('error', err));
          return child as unknown as ChildProcess;
        });
      const instance = app ?? (await start());
      expect((await post(instance)).status).toBe(202);
      await settle(instance);
    }
    expect(rows().map((r) => r.detail?.reason)).toEqual(['other', 'no_rsync']);
    expect(rows().map((r) => r.error)).toEqual([
      nasCopyFailureMessage('other'),
      nasCopyFailureMessage('no_rsync'),
    ]);
    const all = await getJson<BackupsResponse>(app!, '/api/backups');
    expect(all.status).toBe(200);
    expect(logLines.join('\n')).not.toContain('"msg":"job failed"');
  });

  it('(b) a password with a NUL: password_invalid, the runner never called', async () => {
    plantNasFiles(live.dataDir, { password: `${PLANTED.password}\u0000tail` });
    const instance = await start({ weeklyNasCopy: true });
    const res = await post(instance);
    expect(res.status).toBe(409);
    expect(nas.calls).toEqual([]);
    const { body } = await getJson<BackupsResponse>(instance, '/api/backups');
    expect(body.nasCopy.configReason).toBe('password_invalid');
  });

  it('(d) a runner throwing an error that carries every planted value: the job still returns a result', async () => {
    plantNasFiles(live.dataDir);
    runner = () => {
      throw hostile();
    };
    const instance = await start();
    expect((await post(instance)).status).toBe(202);
    await settle(instance);
    expect(rows()).toMatchObject([{ status: 'failed', error: nasCopyFailureMessage('other') }]);
    expect(logLines.join('\n')).not.toContain('"msg":"job failed"');
    expect(logLines.join('\n')).toContain('"code":"EACCES"');
  });

  it("(d'') an error whose own code and name carry planted values: logged as unknown", async () => {
    plantNasFiles(live.dataDir);
    runner = () => {
      throw Object.assign(hostile(), { code: PLANTED_URL, name: `${PLANTED.host}Error` });
    };
    const instance = await start();
    expect((await post(instance)).status).toBe(202);
    await settle(instance);
    expect(rows()).toMatchObject([{ status: 'failed', error: nasCopyFailureMessage('other') }]);
    expect(logLines.join('\n')).toContain('"code":"unknown"');
    // A runner start error built from a free-form code keeps only UNKNOWN.
    runner = (args, opts) =>
      runRsync(args, opts, () => {
        const child = new ErrorChild();
        const err = Object.assign(hostile(), { code: `E${PLANTED.password}` });
        setImmediate(() => child.emit('error', err));
        return child as unknown as ChildProcess;
      });
    expect((await post(instance)).status).toBe(202);
    await settle(instance);
    expect(rows().map((r) => r.detail?.reason)).toEqual(['other', 'other']);
    expect(logLines.join('\n')).toContain('"code":"UNKNOWN"');
  });

  it("(d') the job's own wrapper: a copy that throws never reaches the scheduler's `{ err }` log", async () => {
    plantNasFiles(live.dataDir);
    const logger = Fastify({
      logger: { level: 'trace', stream: { write: (l: string) => void logLines.push(l) } },
    });
    const scheduler = createScheduler({ db: live.database.db, log: logger.log });
    const service = createNasCopyService({
      database: live.database,
      config: { dataDir: live.dataDir, weeklyNasCopy: false },
      scheduler,
      backups: { whenIdle: () => Promise.resolve() },
      log: logger.log,
      copy: () => {
        throw hostile();
      },
    });
    service.copyNow();
    for (let i = 0; i < 100 && scheduler.isRunning('nas-copy'); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await scheduler.stop();
    await logger.close();
    expect(rows()).toMatchObject([{ status: 'failed', error: nasCopyFailureMessage('other') }]);
    expect(rows()[0]?.detail).toMatchObject({ reason: 'other' });
    const text = logLines.join('\n');
    expect(text).not.toContain('"msg":"job failed"');
    expect(text).toContain('nas-copy: the job failed unexpectedly');
  });

  it('every body, row and log line of a full copy is free of the planted values', async () => {
    plantNasFiles(live.dataDir);
    nas.steps[0] = { code: 23, err: `rsync: ${PLANTED_URL} ${PLANTED.password}`, out: PLANTED_URL };
    const instance = await start({ weeklyNasCopy: true });
    await post(instance);
    await settle(instance);
    nas.steps = [];
    await post(instance);
    await settle(instance);
    await getJson(instance, '/api/backups');
    await getJson(instance, '/api/status');
    expect(rows().map((r) => r.status)).toEqual(['failed', 'succeeded']);
    // The address and the password reached rsync (argv / env), and nothing else.
    expect(nas.calls.every((c) => c.password === PLANTED.password)).toBe(true);
    expect(logLines.length).toBeGreaterThan(0);
  });
});
