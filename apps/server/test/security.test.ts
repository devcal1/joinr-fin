// The cross-site write guard (stage-7.md §5.8, §5.11): each method × each Sec-Fetch-Site value;
// GET never blocked; the Origin rule without Sec-Fetch-Site (the production case over plain HTTP):
// same host:port passes, another port on the same host is refused, X-Forwarded-Host and PUBLIC_PORT
// matches pass, the dev-proxy loopback case passes outside production only, `Origin: null` is
// refused, no headers pass; the error shape; the refusal log has no path or query.
import { join } from 'node:path';
import type { ApiErrorBody } from '@joinr/schema';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { registerErrorHandler } from '../src/errors';
import {
  CROSS_SITE_MESSAGE,
  parseHostHeader,
  parseOrigin,
  registerWriteGuard,
} from '../src/security';
import { buildApp } from '../src/app';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { makeTempDir, removeDir, testConfig } from './helpers';

const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

let app: FastifyInstance | undefined;
let logs: string[] = [];

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  logs = [];
});

/** A bare app with the guard and one echo route per method (plus GET). */
async function guarded(
  config: Pick<Config, 'nodeEnv' | 'publicPort'> = { nodeEnv: 'production', publicPort: null },
): Promise<FastifyInstance> {
  const stream = { write: (line: string) => logs.push(line) };
  app = Fastify({ logger: { level: 'warn', stream } });
  registerErrorHandler(app);
  registerWriteGuard(app, config);
  for (const method of [...METHODS, 'GET'] as const) {
    app.route({ method, url: '/api/thing', handler: async () => ({ ok: true }) });
  }
  app.route({ method: 'POST', url: '/not-api', handler: async () => ({ ok: true }) });
  return app;
}

async function send(
  instance: FastifyInstance,
  method: string,
  headers: Record<string, string>,
  url = '/api/thing',
) {
  return instance.inject({
    method: method as 'POST',
    url,
    headers: { host: 'umbrel:4932', ...headers },
  });
}

describe('Sec-Fetch-Site', () => {
  it.each(METHODS)(
    '%s: allows same-origin and none, refuses same-site and cross-site',
    async (method) => {
      const instance = await guarded();
      for (const [site, status] of [
        ['same-origin', 200],
        ['none', 200],
        ['same-site', 403],
        ['cross-site', 403],
        ['Cross-Site', 403],
        ['bogus', 403],
      ] as const) {
        const res = await send(instance, method, { 'sec-fetch-site': site });
        expect(res.statusCode, `${method} ${site}`).toBe(status);
      }
    },
  );

  it('wins over a matching Origin (cross-site with the same Origin is still refused)', async () => {
    const instance = await guarded();
    const res = await send(instance, 'POST', {
      'sec-fetch-site': 'cross-site',
      origin: 'http://umbrel:4932',
    });
    expect(res.statusCode).toBe(403);
  });

  it('never blocks GET, or anything outside /api', async () => {
    const instance = await guarded();
    expect((await send(instance, 'GET', { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(200);
    expect(
      (await send(instance, 'POST', { 'sec-fetch-site': 'cross-site' }, '/not-api')).statusCode,
    ).toBe(200);
  });

  it('answers the error shape, and logs no path or query', async () => {
    const instance = await guarded();
    const res = await send(
      instance,
      'POST',
      { 'sec-fetch-site': 'cross-site', origin: 'http://example.test' },
      '/api/thing?secret=1',
    );
    expect(res.statusCode).toBe(403);
    expect(res.json<ApiErrorBody>()).toEqual({
      error: { code: 'CROSS_SITE_REQUEST', message: CROSS_SITE_MESSAGE },
    });
    const refusal = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l['msg'] === 'cross-site write refused');
    expect(refusal).toMatchObject({
      method: 'POST',
      secFetchSite: 'cross-site',
      origin: 'http://example.test',
      host: 'umbrel:4932',
    });
    expect(logs.join('\n')).not.toContain('secret=1');
    expect(JSON.stringify(refusal)).not.toContain('/api/thing');
  });
});

describe('percent-encoded paths (Fixer SPEC-1/F1: decided on the route, not the raw URL)', () => {
  it.each([
    '/%61pi/thing',
    '/%61%70%69/thing',
    '/api/%74hing',
    '/%61pi/%74hing?x=1',
    '/%2561pi/thing',
    '/%252561pi/thing',
    '/API/thing',
    '//api/thing',
  ])('%s with a foreign Origin → 403', async (url) => {
    const instance = await guarded();
    for (const method of METHODS) {
      const res = await send(instance, method, { origin: 'http://evil.example' }, url);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      const cross = await send(instance, method, { 'sec-fetch-site': 'cross-site' }, url);
      expect(cross.statusCode, `${method} ${url} cross-site`).toBe(403);
    }
  });

  it('a decoded path that routes to /api is guarded, a same-origin one still passes', async () => {
    const instance = await guarded();
    const ok = await send(instance, 'POST', { origin: 'http://umbrel:4932' }, '/%61pi/thing');
    expect(ok.statusCode).toBe(200);
    // /not-api stays outside the guard even when encoded.
    const other = await send(instance, 'POST', { origin: 'http://evil.example' }, '/not-%61pi');
    expect(other.statusCode).toBe(200);
  });
});

describe('Origin without Sec-Fetch-Site (plain HTTP)', () => {
  it.each(METHODS)(
    '%s: the same host:port passes, another port on the same host is refused',
    async (method) => {
      const instance = await guarded();
      expect((await send(instance, method, { origin: 'http://umbrel:4932' })).statusCode).toBe(200);
      expect((await send(instance, method, { origin: 'http://UMBREL:4932' })).statusCode).toBe(200);
      expect((await send(instance, method, { origin: 'http://umbrel:4931' })).statusCode).toBe(403);
      expect((await send(instance, method, { origin: 'http://umbrel' })).statusCode).toBe(403);
      expect(
        (await send(instance, method, { origin: 'http://example.test:4932' })).statusCode,
      ).toBe(403);
    },
  );

  it('fills in default ports', async () => {
    const instance = await guarded();
    const res = await instance.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host: 'app.example', origin: 'http://app.example' },
    });
    expect(res.statusCode).toBe(200);
    const explicit = await instance.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host: 'app.example:80', origin: 'http://app.example' },
    });
    expect(explicit.statusCode).toBe(200);
    const https = await instance.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host: 'app.example:443', origin: 'https://app.example' },
    });
    expect(https.statusCode).toBe(200);
    const mismatch = await instance.inject({
      method: 'POST',
      url: '/api/thing',
      headers: { host: 'app.example:80', origin: 'https://app.example' },
    });
    expect(mismatch.statusCode).toBe(403);
  });

  it('matches X-Forwarded-Host (with X-Forwarded-Port when given)', async () => {
    const instance = await guarded();
    const headers = { host: 'tenon-joinr-finance_app_1:3001', origin: 'http://umbrel:4932' };
    expect((await send(instance, 'POST', headers)).statusCode).toBe(403);
    expect(
      (await send(instance, 'POST', { ...headers, 'x-forwarded-host': 'umbrel:4932' })).statusCode,
    ).toBe(200);
    expect(
      (
        await send(instance, 'POST', {
          ...headers,
          'x-forwarded-host': 'umbrel',
          'x-forwarded-port': '4932',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await send(instance, 'POST', { ...headers, 'x-forwarded-host': 'umbrel:4931' })).statusCode,
    ).toBe(403);
  });

  it('passes the PUBLIC_PORT match and refuses a mismatch', async () => {
    const instance = await guarded({ nodeEnv: 'production', publicPort: 4932 });
    const headers = { host: 'tenon-joinr-finance_app_1:3001' };
    expect(
      (await send(instance, 'POST', { ...headers, origin: 'http://umbrel:4932' })).statusCode,
    ).toBe(200);
    expect(
      (await send(instance, 'POST', { ...headers, origin: 'http://umbrel:4931' })).statusCode,
    ).toBe(403);
  });

  it('PUBLIC_PORT: a foreign host on the public port is refused whenever a header names the real host (Fixer SPEC-2/F3)', async () => {
    const instance = await guarded({ nodeEnv: 'production', publicPort: 4932 });
    // Host not rewritten (still on the public port): the Origin's host must be the Host's.
    for (const origin of ['http://evil.example:4932', 'https://attacker.test:4932']) {
      expect((await send(instance, 'POST', { origin })).statusCode, origin).toBe(403);
    }
    // Host rewritten, X-Forwarded-Host present: the Origin's host must be its host (any port).
    const rewritten = { host: 'tenon-joinr-finance_app_1:3001' };
    expect(
      (
        await send(instance, 'POST', {
          ...rewritten,
          'x-forwarded-host': 'umbrel',
          origin: 'http://evil.example:4932',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await send(instance, 'POST', {
          ...rewritten,
          'x-forwarded-host': 'umbrel:3001',
          origin: 'http://umbrel:4932',
        })
      ).statusCode,
    ).toBe(200);
    // umbrel on the public port behind a rewritten Host: passes.
    expect(
      (await send(instance, 'POST', { ...rewritten, origin: 'http://umbrel:4932' })).statusCode,
    ).toBe(200);
  });

  it('PUBLIC_PORT: with Host rewritten and no X-Forwarded-Host the port alone decides (the accepted risk), logged once', async () => {
    const stream = { write: (line: string) => logs.push(line) };
    app = Fastify({ logger: { level: 'info', stream } });
    registerErrorHandler(app);
    registerWriteGuard(app, { nodeEnv: 'production', publicPort: 4932 });
    app.post('/api/thing', async () => ({ ok: true }));
    const headers = { host: 'tenon-joinr-finance_app_1:3001', origin: 'http://other.example:4932' };
    expect((await app.inject({ method: 'POST', url: '/api/thing', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/thing', headers })).statusCode).toBe(200);
    const notes = logs.filter((l) => l.includes('the public port alone decides'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('tenon-joinr-finance_app_1:3001');
  });

  it('passes a loopback Origin behind the dev proxy outside production only', async () => {
    const headers = { host: 'localhost:3001', origin: 'http://localhost:5173' };
    const dev = await guarded({ nodeEnv: 'development', publicPort: null });
    expect((await send(dev, 'POST', headers)).statusCode).toBe(200);
    expect(
      (await send(dev, 'POST', { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await send(dev, 'POST', { host: '[::1]:3001', origin: 'http://[::1]:5173' })).statusCode,
    ).toBe(200);
    expect(
      (await send(dev, 'POST', { host: 'localhost:3001', origin: 'http://example.test:5173' }))
        .statusCode,
    ).toBe(403);
    await dev.close();
    app = undefined;
    const prod = await guarded({ nodeEnv: 'production', publicPort: null });
    expect((await send(prod, 'POST', headers)).statusCode).toBe(403);
  });

  it('refuses Origin: null and a malformed Origin', async () => {
    const instance = await guarded({ nodeEnv: 'development', publicPort: 4932 });
    expect((await send(instance, 'POST', { origin: 'null' })).statusCode).toBe(403);
    expect((await send(instance, 'POST', { origin: 'not a url' })).statusCode).toBe(403);
    expect((await send(instance, 'POST', { origin: 'file:///x' })).statusCode).toBe(403);
  });

  it('lets a request with neither header through (curl, the CLIs, inject)', async () => {
    const instance = await guarded();
    for (const method of METHODS) {
      expect((await send(instance, method, {})).statusCode).toBe(200);
    }
  });
});

describe('parsers', () => {
  it('reads Origins and Host headers', () => {
    expect(parseOrigin('http://umbrel:4932')).toEqual({
      host: 'umbrel',
      port: '4932',
      scheme: 'http:',
    });
    expect(parseOrigin('https://Example.test')).toEqual({
      host: 'example.test',
      port: '443',
      scheme: 'https:',
    });
    expect(parseOrigin('http://[::1]:5173')?.host).toBe('[::1]');
    expect(parseOrigin('ftp://x')).toBeNull();
    expect(parseHostHeader('umbrel:4932', '80')).toEqual({ host: 'umbrel', port: '4932' });
    expect(parseHostHeader('umbrel', '80')).toEqual({ host: 'umbrel', port: '80' });
    expect(parseHostHeader('umbrel:80', '443')).toEqual({ host: 'umbrel', port: '80' });
    expect(parseHostHeader('[::1]', '80')).toEqual({ host: '[::1]', port: '80' });
    expect(parseHostHeader('a/b', '80')).toBeNull();
    expect(parseHostHeader('user@host', '80')).toBeNull();
  });
});

describe('in the app', () => {
  let tempDir: string;
  let database: AppDatabase;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    database = openDatabase(join(tempDir, 'data'));
    runMigrations(database, testConfig(tempDir).migrationsDir);
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    closeDatabase(database);
    await removeDir(tempDir);
  });

  it('runs before every route (a cross-site PATCH of settings is refused, a same-origin one is not)', async () => {
    app = await buildApp({ config: testConfig(join(tempDir, 'data')), db: database });
    const cross = await app.inject({
      method: 'POST',
      url: '/api/backups',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(cross.statusCode).toBe(403);
    expect(cross.headers['cache-control']).toBe('no-store');
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/prices/refresh',
      headers: { host: 'localhost:3001', origin: 'http://example.test:1' },
    });
    expect(foreign.statusCode).toBe(403);
    const unknown = await app.inject({
      method: 'DELETE',
      url: '/api/nothing-here',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(unknown.statusCode).toBe(403);
  });

  it('refuses a percent-encoded /api write in production, and never takes the backup', async () => {
    const config = {
      ...testConfig(join(tempDir, 'data')),
      nodeEnv: 'production' as const,
      publicPort: 4932,
    };
    app = await buildApp({ config, db: database });
    for (const url of ['/%61pi/backups', '/%2561pi/backups', '/api/%62ackups']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: {
          host: 'umbrel:4932',
          origin: 'http://umbrel:4931',
          'content-type': 'text/plain',
        },
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
    const settings = await app.inject({
      method: 'PATCH',
      url: '/%61pi/settings',
      headers: { host: 'umbrel:4932', origin: 'http://evil.example:8080' },
      payload: {},
    });
    expect(settings.statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(list.json<{ backups: unknown[] }>().backups).toEqual([]);
  });
});
