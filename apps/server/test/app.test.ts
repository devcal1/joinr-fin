import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, SECURITY_HEADERS } from '../src/app';
import type { Config } from '../src/config';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { codeForStatus, HttpError } from '../src/errors';
import type { HealthBody } from '../src/routes/health';
import { makeTempDir, removeDir, testConfig } from './helpers';

const FIXED_NOW = new Date('2026-08-18T04:32:00.000Z');

let tempDir: string;
let config: Config;
let database: AppDatabase;
let app: FastifyInstance | undefined;

async function start(): Promise<FastifyInstance> {
  app = await buildApp({ config, db: database, version: '9.8.7', now: () => FIXED_NOW });
  return app;
}

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

describe('GET /api/health', () => {
  it('reports ok with version, uptime, time and the database state', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');

    const body = res.json<HealthBody>();
    expect(body).toEqual({
      status: 'ok',
      version: '9.8.7',
      uptimeSeconds: expect.any(Number) as number,
      time: FIXED_NOW.toISOString(),
      db: { ok: true, journalMode: 'wal', migrations: expect.any(Number) as number },
    });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.db.migrations).toBeGreaterThanOrEqual(1);
  });

  it('never exposes paths or environment values', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/api/health' });
    expect(res.body).not.toContain(tempDir);
    expect(res.body).not.toContain('finance.db');
    expect(res.body).not.toContain(config.migrationsDir);
  });

  it('answers HEAD', async () => {
    const res = await (await start()).inject({ method: 'HEAD', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('reports degraded with 503 when the database is unusable', async () => {
    const instance = await start();
    closeDatabase(database);
    const res = await instance.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json<HealthBody>()).toMatchObject({
      status: 'degraded',
      version: '9.8.7',
      db: { ok: false, journalMode: null, migrations: null },
    });
  });
});

describe('errors and not-found', () => {
  it.each(['/api/unknown', '/api', '/api/health/extra', '/api/unknown?x=1'])(
    '%s is a JSON 404',
    async (url) => {
      const res = await (await start()).inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.json()).toEqual({
        error: { code: 'NOT_FOUND', message: `No route for GET ${url.split('?')[0]}` },
      });
    },
  );

  it('answers every path with JSON when the SPA is off', async () => {
    const instance = await start();
    const res = await instance.inject({ method: 'GET', url: '/stocks' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const post = await instance.inject({ method: 'POST', url: '/api/health' });
    expect(post.statusCode).toBe(404);
  });

  it('hides the detail of unexpected errors', async () => {
    const instance = await start();
    instance.get('/api/boom', () => {
      throw new Error('secret detail at /some/internal/path');
    });
    const res = await instance.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
    });
    expect(res.body).not.toContain('secret');
  });

  it('passes HttpError status, code and message through', async () => {
    const instance = await start();
    instance.get('/api/teapot', () => {
      throw new HttpError(422, 'Amount must be positive', 'INVALID_AMOUNT');
    });
    const res = await instance.inject({ method: 'GET', url: '/api/teapot' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_AMOUNT', message: 'Amount must be positive' },
    });
  });

  it('formats Fastify client errors (bad JSON) in the same shape', async () => {
    const instance = await start();
    instance.post('/api/echo', (request) => request.body);
    const res = await instance.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('adds the security headers to every response', async () => {
    const instance = await start();
    for (const url of ['/api/health', '/api/unknown']) {
      const res = await instance.inject({ method: 'GET', url });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers[name]).toBe(value);
      }
    }
  });

  it('maps status codes to error codes', () => {
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(500)).toBe('INTERNAL_SERVER_ERROR');
    expect(codeForStatus(413)).toBe('PAYLOAD_TOO_LARGE');
    expect(codeForStatus(418)).toBe('I_M_A_TEAPOT');
    expect(codeForStatus(599)).toBe('ERROR');
  });
});

describe('lifecycle', () => {
  it('closes SQLite on app.close() and releases the database file', async () => {
    const instance = await start();
    await instance.inject({ method: 'GET', url: '/api/health' });
    await instance.close();
    app = undefined;

    expect(database.sqlite.open).toBe(false);
    // The WAL is checkpointed and removed when the last connection closes.
    expect(readdirSync(config.dataDir).filter((f) => f.endsWith('-wal'))).toEqual([]);
    // On Windows an open SQLite file cannot be deleted, so this proves the handle is gone.
    await removeDir(config.dataDir);
    expect(existsSync(config.dataDir)).toBe(false);
  });

  it('fails fast when the SPA is on but the build is missing', async () => {
    config = { ...config, serveWeb: true, webDistDir: join(tempDir, 'missing-dist') };
    await expect(start()).rejects.toThrow(/web app build is missing: no index\.html/);
  });
});
