// Backups routes (stage-7.md §4, §5.10, §5.11): the list (order, keptAs by the §4.3 reference
// rule, sizes, the app block, no folder, statfs failing, foreign entries), "Back up now" (201,
// joined, 409 under the import lock, 500 per category with no path), the download (headers,
// bytes, every rejected name, a missing file, a folder, a symlink), and never a path in a body.
process.env.TZ = 'Australia/Melbourne';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BACKUP_FAILURE_MESSAGES,
  BACKUP_RETENTION,
  type ApiErrorBody,
  type BackupNowResponse,
  type BackupsResponse,
} from '@joinr/schema';
import { nasCopyStates } from '@joinr/schema/fixtures';
import { COMMITTED_MIGRATION_COUNT } from '@joinr/schema/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { vacuumInto, type CopyFn } from '../../src/backups/copy';
import { formatBackupName } from '../../src/backups/names';
import type { BackupService } from '../../src/backups/service';
import { META_KEYS, setMeta } from '../../src/db/meta';
import { registerErrorHandler } from '../../src/errors';
import { backupsRoutes } from '../../src/routes/backups';
import { importLock } from '../../src/routes/import';
import { markInterruptedRuns } from '../../src/db/queries/domain';
import { testConfig } from '../helpers';
import { makeLiveDb, type LiveDb } from './helpers';

const NOW = new Date(2030, 8, 15, 14, 30, 0);

/** Symlinks need Developer Mode (or admin) on Windows: probe once, skip with a reason. */
const canSymlink = ((): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), 'x');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
if (!canSymlink) {
  console.warn(
    'routes.test: symlinks are not permitted here (Windows without Developer Mode, EPERM); the symlink download test is skipped. It runs on Linux and in the live smoke (§9 step S).',
  );
}

let live: LiveDb;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  live = await makeLiveDb({ seed: true });
});

afterEach(async () => {
  importLock.release();
  if (app) await app.close();
  app = undefined;
  await live.cleanup();
});

async function start(o: { copy?: CopyFn; nightly?: boolean } = {}): Promise<FastifyInstance> {
  app = await buildApp({
    config: testConfig(live.dataDir, { nightlyBackups: o.nightly ?? false }),
    db: live.database,
    now: () => NOW,
    version: '1.2.3',
    backupCopy: o.copy,
  });
  return app;
}

const backupsDir = (): string => join(live.dataDir, 'backups');

function plant(name: string, bytes = 1000): void {
  mkdirSync(backupsDir(), { recursive: true });
  writeFileSync(join(backupsDir(), name), Buffer.alloc(bytes, 1));
}

async function list(instance: FastifyInstance): Promise<BackupsResponse> {
  const res = await instance.inject({ method: 'GET', url: '/api/backups' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<BackupsResponse>();
}

function expectNoPath(body: string): void {
  expect(body).not.toContain(live.tempDir);
  expect(body).not.toContain(live.tempDir.replace(/\\/g, '\\\\'));
  expect(body).not.toMatch(/[A-Za-z]:\\|\/tmp\/|\/data\//);
}

describe('GET /api/backups', () => {
  it('answers an empty list when there is no backups folder', async () => {
    const body = await list(await start());
    expect(body).toEqual({
      backups: [],
      totalBytes: 0,
      freeBytes: expect.any(Number) as unknown,
      schedule: {
        enabled: false,
        hour: 2,
        minute: 30,
        timeZone: 'Australia/Melbourne',
        nextRunAt: null,
      },
      running: false,
      lastRun: null,
      lastBackupAt: null,
      stale: false,
      retention: BACKUP_RETENTION,
      app: { version: '1.2.3', migrations: COMMITTED_MIGRATION_COUNT, restoredFrom: null },
      nasCopy: {
        configured: 'off',
        configReason: null,
        missing: [],
        blockedUntilFilesChange: false,
        schedule: {
          enabled: false,
          weekday: 0,
          hour: 3,
          minute: 0,
          timeZone: 'Australia/Melbourne',
          nextRunAt: null,
        },
        running: false,
        lastRun: null,
        lastSuccessAt: null,
        stale: false,
      },
    });
  });

  it('lists newest first with sizes and keptAs by the §4.3 reference rule', async () => {
    // The last prune ran at 15/09 02:30: the dailies 02/09 → 15/09 and the month-ends before.
    for (let d = 2; d <= 15; d++)
      plant(formatBackupName('nightly', new Date(2030, 8, d, 2, 30)), 100);
    plant(formatBackupName('nightly', new Date(2030, 7, 31, 2, 30)), 90);
    plant(formatBackupName('nightly', new Date(2030, 6, 31, 2, 30)), 80);
    // A prune could not delete this one (a download held it): listed as recent.
    plant(formatBackupName('nightly', new Date(2030, 7, 30, 2, 30)), 70);
    plant(formatBackupName('manual', new Date(2030, 8, 10, 18, 5)), 60);
    plant('pre-import-20300110-093000.db', 50);
    plant(formatBackupName('nightly', new Date(2031, 8, 15, 2, 30)), 40); // next year
    const body = await list(await start());
    const byName = new Map(body.backups.map((b) => [b.name, b]));
    expect(body.backups[0]?.name).toBe('nightly-20310915-023000+1000.db');
    expect(byName.get('nightly-20310915-023000+1000.db')?.keptAs).toBe('future');
    expect(byName.get('nightly-20300915-023000+1000.db')?.keptAs).toBe('daily_and_monthly');
    expect(byName.get('nightly-20300902-023000+1000.db')?.keptAs).toBe('daily');
    expect(byName.get('nightly-20300831-023000+1000.db')?.keptAs).toBe('monthly');
    expect(byName.get('nightly-20300731-023000+1000.db')?.keptAs).toBe('monthly');
    expect(byName.get('nightly-20300830-023000+1000.db')?.keptAs).toBe('recent');
    expect(byName.get('manual-20300910-180500+1000.db')).toEqual({
      name: 'manual-20300910-180500+1000.db',
      kind: 'manual',
      createdAt: '2030-09-10T18:05:00+10:00',
      sizeBytes: 60,
      keptAs: 'recent',
    });
    expect(byName.get('pre-import-20300110-093000.db')).toMatchObject({
      kind: 'pre-import',
      createdAt: '2030-01-10T09:30:00+11:00',
      keptAs: 'recent',
    });
    const instants = body.backups.map((b) => Date.parse(b.createdAt));
    expect([...instants].sort((a, b) => b - a)).toEqual(instants);
    expect(body.totalBytes).toBe(14 * 100 + 90 + 80 + 70 + 60 + 50 + 40);
    // lastBackupAt ignores the future file.
    expect(body.lastBackupAt).toBe('2030-09-15T02:30:00+10:00');
  });

  it('neither lists nor counts foreign entries (a sub-folder, a stray .db, a partial)', async () => {
    plant(formatBackupName('manual', new Date(2030, 8, 10, 18, 5)), 60);
    mkdirSync(join(backupsDir(), 'pre-stage7-2030-09-15'));
    writeFileSync(join(backupsDir(), 'pre-stage7-2030-09-15', 'finance.db'), 'x');
    mkdirSync(join(backupsDir(), 'nightly-20300915-023000+1000.db')); // a folder with a valid name
    plant('x.db', 500);
    plant('.manual-20300915-143000+1000.db.partial', 500);
    const body = await list(await start());
    expect(body.backups.map((b) => b.name)).toEqual(['manual-20300910-180500+1000.db']);
    expect(body.totalBytes).toBe(60);
  });

  it('reports the restore marker and the schedule when on', async () => {
    setMeta(
      live.database.db,
      META_KEYS.restoreLast,
      JSON.stringify({ name: 'manual-20300910-180500+1000.db', at: '2030-09-15T11:00:00+10:00' }),
    );
    plant(formatBackupName('nightly', new Date(2030, 8, 15, 2, 30)));
    const body = await list(await start({ nightly: true }));
    expect(body.app.restoredFrom).toEqual({
      name: 'manual-20300910-180500+1000.db',
      at: '2030-09-15T11:00:00+10:00',
    });
    expect(body.schedule.enabled).toBe(true);
    expect(body.schedule.nextRunAt).toBe('2030-09-16T02:30:00+10:00');
  });

  it('answers freeBytes null when statfs fails', async () => {
    const stub: BackupService = {
      start: () => {},
      stop: () => Promise.resolve(),
      backupNow: () => Promise.reject(new Error('not used')),
      status: () => ({ enabled: false, nextRunAt: null, running: false, lastRun: null }),
      staleness: () => ({ stale: false, lastBackupAt: null }),
      whenIdle: () => Promise.resolve(),
    };
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(backupsRoutes, {
      prefix: '/api',
      database: live.database,
      config: testConfig(live.dataDir),
      backups: stub,
      nasCopy: {
        status: () => nasCopyStates.off,
        copyNow: () => ({ joined: false }),
      },
      version: '1.2.3',
      now: () => NOW,
      statfs: () => null,
    });
    const res = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(res.json<BackupsResponse>().freeBytes).toBeNull();
  });
});

describe('lastRun.error (§4.3: a category message, never raw text)', () => {
  it('a backup run left running by a crash reads as "The copy could not be written"', async () => {
    live.database.sqlite
      .prepare(
        "INSERT INTO job_runs (job, trigger, started_at, status) VALUES ('backup', 'schedule', ?, 'running')",
      )
      .run(new Date(NOW.getTime() - 60_000).toISOString());
    markInterruptedRuns(live.database.db, NOW);
    const body = await list(await start());
    expect(body.lastRun).toMatchObject({ job: 'backup', status: 'failed' });
    expect(body.lastRun?.error).toBe(BACKUP_FAILURE_MESSAGES.io);
    expect(JSON.stringify(body)).not.toContain('interrupted');
  });
});

describe('POST /api/backups', () => {
  it('takes a backup by hand (201) and lists it with its run', async () => {
    const instance = await start();
    const res = await instance.inject({ method: 'POST', url: '/api/backups' });
    expect(res.statusCode).toBe(201);
    const body = res.json<BackupNowResponse>();
    expect(body).toEqual({
      backup: {
        name: 'manual-20300915-143000+1000.db',
        kind: 'manual',
        createdAt: '2030-09-15T14:30:00+10:00',
        sizeBytes: expect.any(Number) as unknown,
        keptAs: 'recent',
      },
      joined: false,
    });
    const after = await list(instance);
    expect(after.backups.map((b) => b.name)).toEqual(['manual-20300915-143000+1000.db']);
    expect(after.lastRun).toMatchObject({ job: 'backup', trigger: 'manual', status: 'succeeded' });
    expect(after.lastBackupAt).toBe('2030-09-15T14:30:00+10:00');
  });

  it('accepts no body, an empty JSON body and {}; refuses anything else', async () => {
    const instance = await start();
    const empty = await instance.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(empty.statusCode).toBe(201);
    const obj = await instance.inject({ method: 'POST', url: '/api/backups', payload: {} });
    expect(obj.statusCode).toBe(201);
    const other = await instance.inject({ method: 'POST', url: '/api/backups', payload: { x: 1 } });
    expect(other.statusCode).toBe(400);
    expect(other.json<ApiErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('joins a backup in flight (joined: true)', async () => {
    const waiting: (() => void)[] = [];
    const copy: CopyFn = (sqlite, target) =>
      new Promise<void>((resolve) => {
        waiting.push(() => {
          vacuumInto(sqlite, target);
          resolve();
        });
      });
    const instance = await start({ copy });
    const first = instance.inject({ method: 'POST', url: '/api/backups' });
    await new Promise((r) => setTimeout(r, 20));
    const second = instance.inject({ method: 'POST', url: '/api/backups' });
    await new Promise((r) => setTimeout(r, 20));
    for (const go of waiting.splice(0)) go();
    const [a, b] = await Promise.all([first, second]);
    expect(a.json<BackupNowResponse>().joined).toBe(false);
    expect(b.json<BackupNowResponse>().joined).toBe(true);
    expect(b.json<BackupNowResponse>().backup.name).toBe(a.json<BackupNowResponse>().backup.name);
    expect((await list(instance)).backups).toHaveLength(1);
  });

  it('answers 409 while an import holds the lock', async () => {
    const instance = await start();
    importLock.tryAcquire();
    const res = await instance.inject({ method: 'POST', url: '/api/backups' });
    expect(res.statusCode).toBe(409);
    expect(res.json<ApiErrorBody>().error.code).toBe('IMPORT_IN_PROGRESS');
  });

  it.each([
    ['ENOSPC', 'no_space'],
    ['SQLITE_CORRUPT', 'verify_failed'],
    ['EACCES', 'io'],
  ] as const)(
    'answers 500 BACKUP_FAILED for %s with the category and no path',
    async (code, reason) => {
      const secret = join(live.tempDir, 'private-folder', 'x.db');
      const copy: CopyFn = () => {
        throw Object.assign(new Error(`${code}: failed at ${secret}`), { code });
      };
      const instance = await start({ copy });
      const res = await instance.inject({ method: 'POST', url: '/api/backups' });
      expect(res.statusCode).toBe(500);
      expect(res.json<ApiErrorBody>()).toEqual({
        error: { code: 'BACKUP_FAILED', message: BACKUP_FAILURE_MESSAGES[reason] },
      });
      expectNoPath(res.body);
      const after = await list(instance);
      expect(after.lastRun?.status).toBe('failed');
      expect(after.lastRun?.error).toBe(BACKUP_FAILURE_MESSAGES[reason]);
      expect(JSON.stringify(after)).not.toContain('private-folder');
    },
  );
});

describe('GET /api/backups/:name', () => {
  it('streams the file with the download headers', async () => {
    const instance = await start();
    const made = (
      await instance.inject({ method: 'POST', url: '/api/backups' })
    ).json<BackupNowResponse>();
    const name = made.backup.name;
    const res = await instance.inject({
      method: 'GET',
      url: `/api/backups/${encodeURIComponent(name)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.sqlite3');
    expect(res.headers['content-length']).toBe(String(made.backup.sizeBytes));
    expect(res.headers['content-disposition']).toBe(`attachment; filename="joinr-finance-${name}"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
    expect(res.rawPayload.length).toBe(made.backup.sizeBytes);
    // `+` unencoded works too.
    const raw = await instance.inject({ method: 'GET', url: `/api/backups/${name}` });
    expect(raw.statusCode).toBe(200);
  });

  it.each([
    '..%2Ffinance.db',
    '..%2F..%2Fetc%2Fpasswd',
    '%2e%2e%2ffinance.db',
    '%2E%2E%2Ffinance.db',
    '..%5cfinance.db',
    '..%5C..%5Cfinance.db',
    '%252e%252e%252ffinance.db',
    '%2e%2e',
    '..',
    'finance.db',
    'finance.db-wal',
    '.finance.db.restoring',
    'nightly-20300915-023000%2B1000.db%00',
    'nightly-20300915-023000%2B1000.db%00.txt',
    '%00',
    'nightly-20300915-023000.db',
    'NIGHTLY-20300915-023000%2B1000.db',
    '.nightly-20300915-023000%2B1000.db.partial',
    `nightly-20300915-023000%2B1000-2${'9'.repeat(60)}.db`,
    'nightly-20300915-023000%2B1000.db%0A',
    '%2Fetc%2Fpasswd',
    'C%3A%5Cdata%5Cfinance.db',
  ])('refuses %s with 400 and no path', async (encoded) => {
    const instance = await start();
    const res = await instance.inject({ method: 'GET', url: `/api/backups/${encoded}` });
    expect([400, 404]).toContain(res.statusCode);
    if (res.statusCode === 404) {
      // Only the router may answer 404 (an encoding it would not route), never the file lookup.
      expect(res.json<ApiErrorBody>().error.message).not.toBe('No such backup');
    }
    expectNoPath(res.body);
  });

  it('answers 400 VALIDATION_ERROR for a name that breaks the rule', async () => {
    const instance = await start();
    const res = await instance.inject({ method: 'GET', url: '/api/backups/..%2Ffinance.db' });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Not a backup file name' },
    });
  });

  it.each([101, 200, 300])(
    'answers a %i-character name (over the router limit) with 400 VALIDATION_ERROR in the Stage 0 shape',
    async (length) => {
      const instance = await start();
      const name = 'x'.repeat(length);
      const res = await instance.inject({ method: 'GET', url: `/api/backups/${name}` });
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiErrorBody>()).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'Not a backup file name' },
      });
      expect(res.body).not.toContain('xxxx');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    },
  );

  it('answers 404 for a well-formed name with no file, and for a folder', async () => {
    const instance = await start();
    const missing = await instance.inject({
      method: 'GET',
      url: '/api/backups/nightly-20300915-023000%2B1000.db',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiErrorBody>()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such backup' },
    });
    mkdirSync(join(backupsDir(), 'nightly-20300915-023000+1000.db'), { recursive: true });
    const folder = await instance.inject({
      method: 'GET',
      url: '/api/backups/nightly-20300915-023000%2B1000.db',
    });
    expect(folder.statusCode).toBe(404);
  });

  it.skipIf(!canSymlink)('answers 404 for a symlink planted in the folder', async () => {
    const instance = await start();
    mkdirSync(backupsDir(), { recursive: true });
    symlinkSync(
      join(live.dataDir, 'finance.db'),
      join(backupsDir(), 'manual-20300915-120000+1000.db'),
    );
    const res = await instance.inject({
      method: 'GET',
      url: '/api/backups/manual-20300915-120000%2B1000.db',
    });
    expect(res.statusCode).toBe(404);
    expect((await list(instance)).backups).toEqual([]);
  });
});
