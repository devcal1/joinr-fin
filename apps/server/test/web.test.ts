import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, SECURITY_HEADERS } from '../src/app';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import {
  cacheControlFor,
  IMMUTABLE_CACHE,
  isApiPath,
  isStaticFilePath,
  pathnameOf,
  REVALIDATE_CACHE,
} from '../src/web';
import { makeTempDir, removeDir, testConfig } from './helpers';

const INDEX_HTML =
  '<!doctype html><html><head><title>SPA fixture</title></head><body></body></html>';
const ASSET_JS = 'console.log("fixture");\n';

let tempDir: string;
let database: AppDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  tempDir = await makeTempDir();
  const webDistDir = join(tempDir, 'web-dist');
  await mkdir(join(webDistDir, 'assets'), { recursive: true });
  await writeFile(join(webDistDir, 'index.html'), INDEX_HTML);
  await writeFile(join(webDistDir, 'assets', 'index-AbC123.js'), ASSET_JS);
  await writeFile(join(webDistDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const config = testConfig(join(tempDir, 'data'), {
    nodeEnv: 'production',
    serveWeb: true,
    webDistDir,
  });
  database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  app = await buildApp({ config, db: database });
});

afterAll(async () => {
  await app.close();
  closeDatabase(database);
  await removeDir(tempDir);
});

describe('SPA serving', () => {
  it.each([
    '/',
    '/stocks',
    '/stocks?tab=trades',
    '/preview/screen/loading',
    '/styleguide/',
    '/stocks/ABC.AX', // a dotted route parameter (a market symbol) is a page, not a file
    '/crypto/XYZ.v2',
  ])('%s serves index.html without long-term caching', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe(REVALIDATE_CACHE);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('answers HEAD for a deep link without a body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/stocks' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toBe('');
  });

  it('serves hashed assets as immutable', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-AbC123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe(IMMUTABLE_CACHE);
    expect(res.body).toBe(ASSET_JS);
  });

  it('serves other files with revalidation', async () => {
    const res = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe(REVALIDATE_CACHE);
  });

  it.each([
    '/assets/missing.js',
    '/assets/missing',
    '/missing.png',
    '/stocks/export.csv',
    '/x.MJS',
  ])('%s is a plain 404, never index.html', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.body).toBe('Not found');
  });

  it('keeps /api JSON: unknown routes 404, health still works', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/x' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /api/x' },
    });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });
  });

  it.each(['/API/nope', '//api/nope', '/api%2Fnope', '/Api'])(
    'treats the non-canonical API path %s as API (JSON 404, not the SPA)',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    },
  );

  it.each(['POST', 'PUT', 'DELETE'] as const)(
    '%s to a client route is a JSON 404',
    async (method) => {
      const res = await app.inject({ method, url: '/stocks' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    },
  );

  it('adds the security headers to static responses', async () => {
    for (const url of ['/', '/stocks', '/assets/index-AbC123.js', '/assets/missing.js']) {
      const res = await app.inject({ method: 'GET', url });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers[name]).toBe(value);
      }
    }
  });
});

describe('SPA helpers', () => {
  it('picks the cache policy by folder', () => {
    expect(cacheControlFor('assets/index-AbC123.js')).toBe(IMMUTABLE_CACHE);
    expect(cacheControlFor('assets\\index-AbC123.css')).toBe(IMMUTABLE_CACHE);
    expect(cacheControlFor('/assets/x.woff2')).toBe(IMMUTABLE_CACHE);
    expect(cacheControlFor('index.html')).toBe(REVALIDATE_CACHE);
    expect(cacheControlFor('favicon.svg')).toBe(REVALIDATE_CACHE);
    expect(cacheControlFor('not-assets/x.js')).toBe(REVALIDATE_CACHE);
  });

  it('treats /assets/* and known file extensions (last segment only) as static files', () => {
    expect(isStaticFilePath('/assets/app.js')).toBe(true);
    expect(isStaticFilePath('/assets/no-extension')).toBe(true);
    expect(isStaticFilePath('/favicon.svg')).toBe(true);
    expect(isStaticFilePath('/Logo.PNG')).toBe(true);
    expect(isStaticFilePath('/stocks')).toBe(false);
    expect(isStaticFilePath('/stocks/ABC.AX')).toBe(false);
    expect(isStaticFilePath('/v1.2/stocks')).toBe(false);
    expect(isStaticFilePath('/')).toBe(false);
    expect(isStaticFilePath('/.well-known')).toBe(false);
  });

  it('recognises API paths', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/health')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/stocks/api')).toBe(false);
    // Non-canonical spellings of the same path.
    expect(isApiPath('//api/x')).toBe(true);
    expect(isApiPath('/API/x')).toBe(true);
    expect(isApiPath('/api%2Fx')).toBe(true);
    expect(isApiPath('/api%zz')).toBe(false); // malformed escape, checked raw
    expect(isApiPath('/%2Fapi')).toBe(true);
  });

  it('strips the query and fragment', () => {
    expect(pathnameOf('/stocks?x=1')).toBe('/stocks');
    expect(pathnameOf('/stocks#top')).toBe('/stocks');
    expect(pathnameOf('/stocks')).toBe('/stocks');
  });
});
