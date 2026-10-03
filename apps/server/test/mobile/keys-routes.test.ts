// The device key and the read-only boundary (stage-9.md §4.2, §6.3, §6.10): missing, malformed,
// unknown and revoked keys (each with its code), `X-Joinr-Key` alone, both headers equal or
// different, the bad-key limiter (a known key is never limited), the last-used time and app
// version, an unreadable store set aside; the exact route set under /api/mobile (Stage 10 adds
// /periods), a route from another plugin failing at start-up, and every method × path. Keys are generated here, never printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BAD_KEY_RATE_MAX,
  BAD_KEY_RATE_WINDOW_MS,
  DEVICE_LAST_USED_FLUSH_MS,
  type PhoneSectionResponse,
} from '@joinr/schema';
import { mobileApiErrors } from '@joinr/schema/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateDeviceKey } from '../../src/mobile/keys';
import { guardPath } from '../../src/routes/mobile';
import { bearer, pairPhone, startMobileApp, type MobileApp } from './helpers';

let t: MobileApp;
beforeEach(async () => {
  t = await startMobileApp({ seed: false });
});
afterEach(() => t.close());

const today = (headers: Record<string, string>) =>
  t.app.inject({ method: 'GET', url: '/api/mobile/today', headers });
const phones = async () =>
  (await t.app.inject({ method: 'GET', url: '/api/phone' })).json<PhoneSectionResponse>();

describe('the key check', () => {
  it('missing → MISSING; malformed or unknown → INVALID; removed → REVOKED; HEAD too', async () => {
    const p = await pairPhone(t.app);
    expect((await today({})).json()).toEqual(mobileApiErrors.deviceKeyMissing);
    expect((await today({})).statusCode).toBe(401);
    for (const headers of <Record<string, string>[]>[
      { authorization: 'Bearer short' },
      { authorization: 'Basic abc' },
      { authorization: `Bearer ${generateDeviceKey()}` },
      { 'x-joinr-key': generateDeviceKey() },
    ]) {
      const res = await today(headers);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(mobileApiErrors.deviceKeyInvalid);
    }
    const head = await t.app.inject({
      method: 'HEAD',
      url: '/api/mobile/today',
      headers: bearer(p.key),
    });
    expect(head.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'HEAD', url: '/api/mobile/device' })).statusCode).toBe(
      401,
    );
    await t.app.inject({ method: 'POST', url: `/api/phone/devices/${p.deviceId}/revoke` });
    expect((await today(bearer(p.key))).json()).toEqual(mobileApiErrors.deviceKeyRevoked);
  });

  it('X-Joinr-Key alone works; both equal → 200; different → INVALID (counted)', async () => {
    const p = await pairPhone(t.app);
    expect((await today({ 'x-joinr-key': p.key })).statusCode).toBe(200);
    expect((await today({ authorization: `Bearer ${p.key}` })).statusCode).toBe(200);
    expect((await today(bearer(p.key))).statusCode).toBe(200);
    const other = generateDeviceKey();
    const res = await today({ authorization: `Bearer ${p.key}`, 'x-joinr-key': other });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(mobileApiErrors.deviceKeyInvalid);
  });

  it(`after ${BAD_KEY_RATE_MAX} unknown keys → 429 with Retry-After; a known key is never limited`, async () => {
    const p = await pairPhone(t.app);
    for (let i = 0; i < BAD_KEY_RATE_MAX; i += 1)
      expect((await today({ authorization: `Bearer ${generateDeviceKey()}` })).statusCode).toBe(
        401,
      );
    const limited = await today({ authorization: `Bearer ${generateDeviceKey()}` });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual(mobileApiErrors.mobileRateLimited);
    expect(Number(limited.headers['retry-after'])).toBe(BAD_KEY_RATE_WINDOW_MS / 1000);
    expect((await today(bearer(p.key))).statusCode).toBe(200);
    // A missing key is not an unknown key.
    expect((await today({})).json()).toEqual(mobileApiErrors.deviceKeyMissing);
    t.clock.advance(BAD_KEY_RATE_WINDOW_MS);
    expect((await today({ authorization: `Bearer ${generateDeviceKey()}` })).statusCode).toBe(401);
  });

  it('records the last use and the app version (X-Joinr-App-Version, well formed only)', async () => {
    const p = await pairPhone(t.app, { appVersion: '1.0.0' });
    expect((await phones()).devices[0]!.lastUsedAt).toBeNull();
    await today({ ...bearer(p.key), 'x-joinr-app-version': '1.0.2' });
    let d = (await phones()).devices[0]!;
    expect(d.lastUsedAt).toBe('2030-09-12T05:20:00.000Z');
    expect(d.appVersion).toBe('1.0.2');
    t.clock.advance(DEVICE_LAST_USED_FLUSH_MS + 1000);
    await today({ ...bearer(p.key), 'x-joinr-app-version': 'bad version!' });
    d = (await phones()).devices[0]!;
    expect(d.lastUsedAt).toBe('2030-09-12T05:30:01.000Z');
    expect(d.appVersion).toBe('1.0.2');
  });

  it('an unreadable store is set aside at start-up: the section says so, old keys are unknown', async () => {
    const p = await pairPhone(t.app);
    await t.app.close();
    const file = join(t.dataDir, 'devices', 'devices.json');
    mkdirSync(join(t.dataDir, 'devices'), { recursive: true });
    writeFileSync(file, '{ broken');
    await t.restart();
    expect((await phones()).storeProblem).toBe('set_aside');
    expect((await today(bearer(p.key))).json()).toEqual(mobileApiErrors.deviceKeyInvalid);
  });
});

describe('the route set (deny by default)', () => {
  it('under /api/mobile there are exactly the four routes, their HEADs and the catch-all', async () => {
    const seen: string[] = [];
    await t.restart({
      mobile: {
        onRoute: (route) => {
          if (!route.url.toLowerCase().includes('/mobile')) return;
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          for (const m of methods) seen.push(`${m} ${route.url}`);
        },
      },
    });
    expect(seen.sort()).toEqual(
      [
        'DELETE /api/mobile/*',
        'GET /api/mobile/device',
        'GET /api/mobile/periods',
        'GET /api/mobile/today',
        'HEAD /api/mobile/device',
        'HEAD /api/mobile/periods',
        'HEAD /api/mobile/today',
        'OPTIONS /api/mobile/*',
        'PATCH /api/mobile/*',
        'POST /api/mobile/*',
        'POST /api/mobile/pair',
        'PUT /api/mobile/*',
      ].sort(),
    );
  });

  it('a route under /api/mobile registered from another plugin throws at start-up', async () => {
    for (const url of ['/api/mobile/x', '/API/Mobile/x', '/api/%6Dobile/x', '/api//mobile/x']) {
      const err = await t.app
        .register(async (p: FastifyInstance) => {
          p.get(url, async () => ({ leaked: true }));
        })
        .ready()
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err, url).toBeInstanceOf(Error);
      expect(String(err)).toContain('deny by default');
      await t.restart();
    }
    expect(guardPath('/API/%2561pi//x')).toBe('/api/api/x');
  });
});

describe('read-only', () => {
  it('every method × /api/mobile/today|device|periods|pair|x gives the expected status (with a key)', async () => {
    const p = await pairPhone(t.app);
    const expected: Record<string, Record<string, number>> = {
      today: { GET: 200, HEAD: 200, POST: 405, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 },
      device: { GET: 200, HEAD: 200, POST: 405, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 },
      periods: { GET: 200, HEAD: 200, POST: 405, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 },
      pair: { GET: 404, HEAD: 404, POST: 401, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 },
      x: { GET: 404, HEAD: 404, POST: 405, PUT: 405, PATCH: 405, DELETE: 405, OPTIONS: 405 },
    };
    for (const [path, byMethod] of Object.entries(expected)) {
      for (const [method, status] of Object.entries(byMethod)) {
        const res = await t.app.inject({
          method: method as 'GET',
          url: `/api/mobile/${path}`,
          headers: bearer(p.key),
          ...(method === 'POST' || method === 'PUT' || method === 'PATCH'
            ? { payload: { code: 'ABCDE12345' } }
            : {}),
        });
        expect(res.statusCode, `${method} ${path}`).toBe(status);
        if (status === 405) {
          expect(res.json()).toEqual(mobileApiErrors.mobileReadOnly);
          expect(res.headers.allow).toBe('GET, HEAD');
        }
        expect(res.headers['cache-control'], `${method} ${path}`).toBe('no-store');
      }
    }
  });

  it('the 405 needs no key and changes nothing', async () => {
    const res = await t.app.inject({ method: 'DELETE', url: '/api/mobile/today' });
    expect(res.statusCode).toBe(405);
    expect((await phones()).devices).toEqual([]);
  });
});
