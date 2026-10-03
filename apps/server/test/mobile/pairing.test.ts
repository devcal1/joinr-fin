// Pairing through the routes (stage-9.md §4.1, §6.2, §6.10): the full flow, expiry, five wrong codes
// cancel the code, hyphens and lower case, the device limit, the store failure re-opening the code,
// a second open replacing the first, a restart cancelling it, two concurrent requests with one code,
// junk posts that are not counted, the body limit, the label cleaning, and Settings → Phone's
// section and revoke. Codes and keys are generated at run time and never printed.
import {
  DEVICE_LABEL_MAX,
  MOBILE_MAX_DEVICES,
  MOBILE_KEY_RE,
  PAIRING_CODE_TTL_MS,
  PAIRING_RATE_MAX,
  type MobilePairResponse,
  type PhoneSectionResponse,
} from '@joinr/schema';
import { mobileApiErrors, mobilePairRequests } from '@joinr/schema/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultDeviceStoreFs } from '../../src/mobile/devices';
import { cleanDeviceLabel } from '../../src/mobile/pairing';
import { bearer, openCode, pairPhone, startMobileApp, type MobileApp } from './helpers';

let t: MobileApp;
const failing = { fail: false };

beforeEach(async () => {
  failing.fail = false;
  t = await startMobileApp({
    seed: false,
    build: {
      mobile: {
        fs: {
          renameSync: (from, to) => {
            if (failing.fail) throw Object.assign(new Error('denied'), { code: 'EACCES' });
            defaultDeviceStoreFs.renameSync(from, to);
          },
        },
      },
    },
  });
});
afterEach(() => t.close());

const pair = (payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url: '/api/mobile/pair', payload: payload as object, headers });
const section = async () =>
  (await t.app.inject({ method: 'GET', url: '/api/phone' })).json<PhoneSectionResponse>();

/** A code that differs from `code` (same alphabet and length). */
const wrong = (code: string) => (code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`);

describe('the full flow', () => {
  it('open → pair (201, key once) → today and device with the key → the section lists the phone', async () => {
    expect((await section()).pairing).toBeNull();
    const code = await openCode(t.app);
    const open = await section();
    expect(open.pairing).toMatchObject({ code, failuresLeft: 5 });
    expect(Date.parse(open.pairing!.expiresAt) - Date.parse(open.pairing!.createdAt)).toBe(
      PAIRING_CODE_TTL_MS,
    );
    const res = await pair({ code, deviceName: 'Test phone', appVersion: '1.0.0' });
    expect(res.statusCode).toBe(201);
    const body = res.json<MobilePairResponse>();
    expect(body).toMatchObject({ apiVersion: 1, label: 'Test phone' });
    expect(MOBILE_KEY_RE.test(body.key)).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');

    const device = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/device',
      headers: bearer(body.key),
    });
    expect(device.statusCode).toBe(200);
    expect(device.json()).toMatchObject({
      apiVersion: 1,
      deviceId: body.deviceId,
      label: 'Test phone',
    });
    const today = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/today',
      headers: bearer(body.key),
    });
    expect(today.statusCode).toBe(200);

    const after = await section();
    expect(after.pairing).toBeNull();
    expect(after.lastPaired).toMatchObject({ id: body.deviceId, label: 'Test phone' });
    expect(after.devices).toHaveLength(1);
    expect(after.devices[0]).toMatchObject({
      id: body.deviceId,
      appVersion: '1.0.0',
      revokedAt: null,
    });
    expect(JSON.stringify(after)).not.toContain(body.key);
    // The code is used: a second exchange is refused.
    const again = await pair({ code });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual(mobileApiErrors.pairingCodeInvalid);
  });

  it('accepts a hyphenated and a lower-case code (the fixture requests)', async () => {
    for (const req of [mobilePairRequests.validHyphenated, mobilePairRequests.lowercase]) {
      const code = await openCode(t.app);
      const typed = req.body.code.includes('-')
        ? `${code.slice(0, 5)}-${code.slice(5)}`
        : code.toLowerCase();
      const res = await pair({ ...req.body, code: typed });
      expect(res.statusCode).toBe(201);
    }
  });

  it('a malformed code is a 401 like a wrong one (never 400) and counts as a failure', async () => {
    await openCode(t.app);
    for (const req of [mobilePairRequests.tooShort, mobilePairRequests.wrongAlphabet]) {
      const res = await pair(req.body);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(mobileApiErrors.pairingCodeInvalid);
    }
    expect((await section()).pairing!.failuresLeft).toBe(3);
  });
});

describe('the code', () => {
  it('expires after 5 minutes', async () => {
    const code = await openCode(t.app);
    t.clock.advance(PAIRING_CODE_TTL_MS);
    expect((await pair({ code })).statusCode).toBe(401);
    expect((await section()).pairing).toBeNull();
  });

  it('five wrong codes cancel it (lastCancelled = failures); the right code is then refused', async () => {
    const code = await openCode(t.app);
    for (let i = 0; i < 5; i += 1) expect((await pair({ code: wrong(code) })).statusCode).toBe(401);
    const s = await section();
    expect(s.pairing).toBeNull();
    expect(s.lastCancelled).toEqual({ at: '2030-09-12T05:20:00.000Z', reason: 'failures' });
    expect((await pair({ code })).statusCode).toBe(401);
  });

  it('a second open replaces the first (lastCancelled = replaced)', async () => {
    const first = await openCode(t.app);
    const second = await openCode(t.app);
    const s = await section();
    expect(s.pairing!.code).toBe(second);
    expect(s.lastCancelled?.reason).toBe('replaced');
    if (first !== second) expect((await pair({ code: first })).statusCode).toBe(401);
    expect((await pair({ code: second })).statusCode).toBe(201);
  });

  it('DELETE /api/phone/pairing cancels it', async () => {
    const code = await openCode(t.app);
    const res = await t.app.inject({ method: 'DELETE', url: '/api/phone/pairing' });
    expect(res.statusCode).toBe(200);
    expect(res.json<PhoneSectionResponse>().pairing).toBeNull();
    expect((await pair({ code })).statusCode).toBe(401);
  });

  it('a restart cancels it', async () => {
    const code = await openCode(t.app);
    await t.restart();
    expect((await pair({ code })).statusCode).toBe(401);
  });

  it('two concurrent requests with one code: exactly one 201 and one 401', async () => {
    const code = await openCode(t.app);
    const results = await Promise.all([pair({ code }), pair({ code })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 401]);
    expect((await section()).devices).toHaveLength(1);
  });

  it('attempts with no open code are not counted (21 junk posts, then a code pairs)', async () => {
    for (let i = 0; i < PAIRING_RATE_MAX + 1; i += 1) {
      const res = await pair({ code: 'ABCDE12345' });
      expect(res.statusCode).toBe(401);
    }
    const code = await openCode(t.app);
    expect((await pair({ code })).statusCode).toBe(201);
  });

  it(`more than ${PAIRING_RATE_MAX} attempts while a code is open → 429 with Retry-After`, async () => {
    for (let n = 0; n < 4; n += 1) {
      const code = await openCode(t.app);
      for (let i = 0; i < 5; i += 1) await pair({ code: wrong(code) });
    }
    // 20 counted; the next one (a code open) is refused.
    const code = await openCode(t.app);
    const res = await pair({ code });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual(mobileApiErrors.pairingRateLimited);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('the body', () => {
  it('a 2 KB body → 413; unknown fields and long values → 400 with a fixed sentence', async () => {
    const code = await openCode(t.app);
    const big = await pair({ code, deviceName: 'x'.repeat(2048) });
    expect(big.statusCode).toBe(413);
    for (const body of [
      { code, extra: true },
      { code, deviceName: 'x'.repeat(101) },
      { code, appVersion: 'x'.repeat(21) },
      { code: 5 },
      { code: 'x'.repeat(41) },
    ]) {
      const res = await pair(body);
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(code);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    }
    // The code is still open.
    expect((await pair({ code })).statusCode).toBe(201);
  });

  it('a cross-site browser post is refused by the write guard (403)', async () => {
    const code = await openCode(t.app);
    const res = await pair({ code }, { 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(403);
  });

  it('cleans the label: bidi, zero-width and control characters removed, whitespace collapsed, cut', async () => {
    expect(cleanDeviceLabel('‮enohP‬​  Test\tphone \u0007')).toBe('enohP Testphone');
    expect(cleanDeviceLabel('  ​ ')).toBe('Android phone');
    expect(cleanDeviceLabel(undefined)).toBe('Android phone');
    expect(cleanDeviceLabel('y'.repeat(60))).toHaveLength(DEVICE_LABEL_MAX);
    const code = await openCode(t.app);
    const res = await pair({ code, deviceName: '‮x​y z' });
    expect(res.json<MobilePairResponse>().label).toBe('xyz');
  });
});

describe('the limit and the store', () => {
  it(`${MOBILE_MAX_DEVICES} active phones: opening → 409; pairing with an open code → 409 (the code stays)`, async () => {
    for (let i = 0; i < MOBILE_MAX_DEVICES - 1; i += 1) await pairPhone(t.app);
    const code = await openCode(t.app);
    await pairPhone(t.app); // the tenth (replaces the open code)
    expect((await t.app.inject({ method: 'POST', url: '/api/phone/pairing' })).json()).toEqual(
      mobileApiErrors.phoneLimitReached,
    );
    expect((await pair({ code })).statusCode).toBe(401); // replaced
    // Remove one, open a code, fill the slot from elsewhere → the open code's exchange is a 409.
    const s = await section();
    await t.app.inject({ method: 'POST', url: `/api/phone/devices/${s.devices[0]!.id}/revoke` });
    const open = await openCode(t.app);
    t.app.devices.add({
      id: 'd_00000000000000aa',
      label: 'x',
      keyHash: 'a'.repeat(64),
      pairedAt: '2030-09-12T05:20:00.000Z',
      appVersion: null,
    });
    const res = await pair({ code: open });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(mobileApiErrors.phoneLimitReached);
    expect((await section()).pairing?.code).toBe(open);
  });

  it('a store write failure → 503, no key; the code re-opens inside its TTL', async () => {
    const code = await openCode(t.app);
    failing.fail = true;
    const res = await pair({ code });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(mobileApiErrors.phoneStoreFailed);
    expect(res.body).not.toContain('jfk_');
    const s = await section();
    expect(s.devices).toEqual([]);
    expect(s.storeProblem).toBe('unwritable');
    expect(s.pairing?.code).toBe(code);
    failing.fail = false;
    expect((await pair({ code })).statusCode).toBe(201);
    expect((await section()).storeProblem).toBeNull();
  });
});

describe('Settings → Phone', () => {
  it('POST /api/phone/pairing takes no body or {}; the revoke checks the id', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/phone/pairing', payload: { a: 1 } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/phone/pairing', payload: {} })).statusCode,
    ).toBe(201);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/phone/devices/phone1/revoke' })).statusCode,
    ).toBe(400);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/phone/devices/d_00000000000000ff/revoke' }))
        .statusCode,
    ).toBe(404);
  });

  it('revoke → 200 (idempotent), the key gets 401 REVOKED, the phone is listed as removed', async () => {
    const p = await pairPhone(t.app);
    const url = `/api/phone/devices/${p.deviceId}/revoke`;
    const first = await t.app.inject({ method: 'POST', url });
    expect(first.statusCode).toBe(200);
    const s = first.json<PhoneSectionResponse>();
    expect(s.devices).toEqual([]);
    expect(s.removed[0]).toMatchObject({ id: p.deviceId, revokedAt: '2030-09-12T05:20:00.000Z' });
    expect((await t.app.inject({ method: 'POST', url })).statusCode).toBe(200);
    const today = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/today',
      headers: bearer(p.key),
    });
    expect(today.statusCode).toBe(401);
    expect(today.json()).toEqual(mobileApiErrors.deviceKeyRevoked);
  });

  it('the revoke fail-safe: unwritable → 200 + pendingRemovals, 401 at once; saved by the next write and kept after a restart', async () => {
    const p = await pairPhone(t.app);
    failing.fail = true;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/phone/devices/${p.deviceId}/revoke`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<PhoneSectionResponse>()).toMatchObject({
      storeProblem: 'unwritable',
      pendingRemovals: 1,
    });
    const now = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/today',
      headers: bearer(p.key),
    });
    expect(now.json()).toEqual(mobileApiErrors.deviceKeyRevoked);
    failing.fail = false;
    // preClose saves it (the restart closes the app first).
    await t.restart();
    const after = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/today',
      headers: bearer(p.key),
    });
    expect(after.json()).toEqual(mobileApiErrors.deviceKeyRevoked);
    expect((await section()).pendingRemovals).toBe(0);
  });
});
