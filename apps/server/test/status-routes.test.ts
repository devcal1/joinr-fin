// GET /api/status (stage-1.md §3.3) and the start-up stale-run cleanup (§4.8, §7.5 step 3).
import { join } from 'node:path';
import type { AppStatus } from '@joinr/schema';
import { importRuns, jobRuns, settings } from '@joinr/schema/db';
import { seedGenericData } from '@joinr/schema/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { markInterruptedRuns } from '../src/db/queries/domain';
import { registerErrorHandler } from '../src/errors';
import type { MarketDataService, MarketDataStatus } from '../src/market/types';
import { FEATURE_KEYS, statusRoutes } from '../src/routes/status';
import { makeTempDir, removeDir, testConfig } from './helpers';

const NOW = new Date('2026-09-24T04:00:00.000Z');

let tempDir: string;
let config: Config;
let database: AppDatabase;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  tempDir = await makeTempDir();
  config = testConfig(join(tempDir, 'data'));
  database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  closeDatabase(database);
  await removeDir(tempDir);
});

function marketWithStatus(status: MarketDataStatus): MarketDataService {
  const fail = (): never => {
    throw new Error('not used');
  };
  return {
    refresh: () => Promise.reject(new Error('not used')),
    getPrices: fail,
    getSeries: fail,
    setManualPrice: fail,
    clearManualPrice: fail,
    setPriceSource: fail,
    notifyInstrumentsChanged: () => undefined,
    status: () => status,
    stop: () => undefined,
  };
}

async function getStatus(instance: FastifyInstance): Promise<AppStatus> {
  const res = await instance.inject({ method: 'GET', url: '/api/status' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<AppStatus>();
}

describe('GET /api/status', () => {
  it('reports an empty database (market data off in tests)', async () => {
    app = await buildApp({ config, db: database });
    expect(await getStatus(app)).toEqual({
      prices: { mode: 'off', lastRefreshAt: null, running: false },
      snapshots: { count: 0, latestPeriod: null },
      import: { lastRunAt: null, lastStatus: null, hasImportedData: false },
      // Stage 5 (stage-5.md §3.2, §4.5): every feature on by default; the recorder off.
      features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])),
      history: { autoRecord: false, nextRecordAt: null },
      // Stage 7 (stage-7.md §3.3): no backup yet, and nothing to be stale about.
      backups: { stale: false, lastBackupAt: null },
      // Stage 8 (stage-8.md §3.4): no NAS files, nothing locked or stale.
      nasCopy: {
        configured: 'off',
        configReason: null,
        blocked: false,
        stale: false,
        lastSuccessAt: null,
      },
    });
  });

  it('reports a feature switched off and the recorder status (Stage 5)', async () => {
    expect(FEATURE_KEYS).toHaveLength(11);
    database.db
      .insert(settings)
      .values([
        { key: 'features.crypto', valueJson: 'false', updatedAt: NOW.toISOString(), origin: 'app' },
        { key: 'features.fire', valueJson: 'null', updatedAt: NOW.toISOString(), origin: 'import' },
      ])
      .run();
    app = await buildApp({ config, db: database });
    app.recorder.status = () => ({
      autoRecord: { enabled: true, source: 'env' },
      since: '2026-09-01',
      recordHour: 23,
      nextRunAt: '2026-09-30T23:00:00+10:00',
      running: false,
      lastRun: null,
      blocked: null,
    });
    const status = await getStatus(app);
    expect(status.features).toMatchObject({
      'features.crypto': false,
      'features.fire': true,
      'features.cash': true,
    });
    expect(status.history).toEqual({ autoRecord: true, nextRecordAt: '2026-09-30T23:00:00+10:00' });
  });

  it('reports snapshots, the latest import run and imported data', async () => {
    seedGenericData(database.db, { now: NOW });
    database.db
      .insert(importRuns)
      .values({
        startedAt: '2026-09-24T05:00:00.000Z',
        status: 'failed',
        dryRun: true,
        trigger: 'upload',
        fileName: 'later.xlsx',
        fileSha256: 'c'.repeat(64),
        fileSize: 1,
        importerVersion: '1.0.0',
        errorCode: 'INVALID_WORKBOOK',
        error: 'Missing sheet',
      })
      .run();
    app = await buildApp({ config, db: database });
    const status = await getStatus(app);
    expect(status.snapshots.count).toBe(3);
    expect(status.snapshots.latestPeriod).toMatch(/^\d{4}-\d{2}$/);
    expect(status.import).toEqual({
      lastRunAt: '2026-09-24T05:00:00.000Z',
      lastStatus: 'failed',
      hasImportedData: true,
    });
  });

  // Stage 7 (stage-7.md §3.3, §5.4): the stale-backup flag for the callout.
  it('reports stale backups when nightly backups are on and nothing was copied for 48 h', async () => {
    seedGenericData(database.db, { now: NOW });
    database.db
      .insert(importRuns)
      .values({
        startedAt: new Date(NOW.getTime() - 72 * 3_600_000).toISOString(),
        finishedAt: NOW.toISOString(),
        status: 'succeeded',
        dryRun: false,
        trigger: 'upload',
        fileName: 'first.xlsx',
        fileSha256: 'd'.repeat(64),
        fileSize: 1,
        importerVersion: '1.0.0',
      })
      .run();
    app = await buildApp({
      config: { ...config, nightlyBackups: true },
      db: database,
      now: () => NOW,
    });
    expect((await getStatus(app)).backups).toEqual({ stale: true, lastBackupAt: null });
    await app.inject({ method: 'POST', url: '/api/backups' });
    expect((await getStatus(app)).backups).toEqual({
      stale: false,
      lastBackupAt: expect.stringMatching(
        /^2026-09-2[34]T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/,
      ) as unknown,
    });
  });

  it('takes the price freshness from the market data service', async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    const market = marketWithStatus({
      mode: 'fake',
      running: true,
      lastRefreshAt: '2026-09-24T03:59:00.000Z',
      nextRefreshAt: '2026-09-24T04:59:00.000Z',
    });
    await app.register(statusRoutes, { prefix: '/api', database, config, market });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.json<AppStatus>().prices).toEqual({
      mode: 'fake',
      lastRefreshAt: '2026-09-24T03:59:00.000Z',
      running: true,
    });
    // A bare status plugin (no recorder decorated) leaves the recorder field out.
    expect(res.json<AppStatus>().history).toBeUndefined();
    // …and the NAS copy's (Stage 8: no decorator, no field).
    expect(res.json<AppStatus>().nasCopy).toBeUndefined();
  });
});

describe('start-up stale-run cleanup', () => {
  it('marks running import and job runs as failed (interrupted) and leaves the others', () => {
    const base = {
      trigger: 'cli' as const,
      fileName: 'x.xlsx',
      fileSha256: 'd'.repeat(64),
      fileSize: 1,
      importerVersion: '1.0.0',
    };
    database.db
      .insert(importRuns)
      .values([
        { ...base, startedAt: '2026-09-24T01:00:00.000Z', status: 'running' },
        { ...base, startedAt: '2026-09-24T00:00:00.000Z', status: 'succeeded' },
      ])
      .run();
    database.db
      .insert(jobRuns)
      .values([
        {
          job: 'prices',
          trigger: 'schedule',
          startedAt: '2026-09-24T01:00:00.000Z',
          status: 'running',
        },
        {
          job: 'prices',
          trigger: 'manual',
          startedAt: '2026-09-24T00:00:00.000Z',
          status: 'partial',
        },
      ])
      .run();

    expect(markInterruptedRuns(database.db, NOW)).toEqual({ importRuns: 1, jobRuns: 1 });
    const imports = database.db.select().from(importRuns).all();
    expect(imports.map((r) => r.status).sort()).toEqual(['failed', 'succeeded']);
    expect(imports.find((r) => r.status === 'failed')).toMatchObject({
      errorCode: 'INTERRUPTED',
      error: 'interrupted',
      finishedAt: NOW.toISOString(),
    });
    const jobs = database.db.select().from(jobRuns).all();
    expect(jobs.map((r) => r.status).sort()).toEqual(['failed', 'partial']);
    expect(markInterruptedRuns(database.db, NOW)).toEqual({ importRuns: 0, jobRuns: 0 });
  });
});
