// The Stage 9 fixtures (stage-9.md §3.6): the shapes and invariants the app, the widgets and the
// web section rely on, the coverage of every state and the error bodies; the Android JSON copies
// have their own drift check (android-fixtures.test.ts). The arithmetic of `mobileToday` (totals,
// weights, the line's last point, each holding's day figure) is checked by the engine's
// consistency test.
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  BULLION_HOLDINGS,
  DAY_STATUSES,
  DEVICE_ID_RE,
  LINE_MAX_POINTS,
  MARKET_STATES,
  MOBILE_ERROR_MESSAGES,
  MOBILE_HOLDING_KINDS,
  MOBILE_KEEP_REMOVED,
  MOBILE_KEY_RE,
  MOBILE_MAX_DEVICES,
  NORMALISED_DECIMAL_RE,
  holdingKey,
  isApiErrorBody,
  isIsoDateString,
  isIsoTimestampString,
  normalisePairingCode,
  type MobileHoldingDto,
} from '../src/index';
import {
  FIXTURE_COVERAGE,
  FIXTURE_DEVICE_ID,
  FIXTURE_DEVICE_KEY,
  mobileApiErrors,
  mobileDevice,
  mobilePair,
  mobilePairRequests,
  mobileToday,
  phoneSections,
} from '../src/fixtures/index';

const decimal = (v: string | null) => v === null || NORMALISED_DECIMAL_RE.test(v);

describe('mobileToday (§3.6, §4.3)', () => {
  const moments = Object.entries(mobileToday);

  it('has the six moments', () => {
    expect(Object.keys(mobileToday)).toEqual([
      'open',
      'saturday',
      'preOpenNoCrypto',
      'holiday',
      'allStale',
      'empty',
    ]);
  });

  it.each(moments)('%s: envelope, order and keys', (_name, t) => {
    expect(t.apiVersion).toBe(1);
    expect(isIsoTimestampString(t.generatedAt)).toBe(true);
    expect(isIsoDateString(t.localDate)).toBe(true);
    expect(t.timeZone).toBe('Australia/Melbourne');
    expect(MARKET_STATES).toContain(t.market.asx);
    expect(t.totals.holdings).toBe(t.holdings.length);
    const keys = t.holdings.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    // valueCents desc, unpriced last, then code.
    const sorted = [...t.holdings].sort((a, b) => {
      if ((a.valueCents === null) !== (b.valueCents === null))
        return a.valueCents === null ? 1 : -1;
      if (a.valueCents !== b.valueCents) return (b.valueCents ?? 0) - (a.valueCents ?? 0);
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
    expect(keys).toEqual(sorted.map((h) => h.key));
  });

  const holdings: [string, MobileHoldingDto][] = moments.flatMap(([name, t]) =>
    t.holdings.map((h) => [`${name} ${h.key}`, h] as [string, MobileHoldingDto]),
  );

  it.each(holdings)('%s: fields follow the contract', (_name, h) => {
    expect(MOBILE_HOLDING_KINDS).toContain(h.kind);
    expect(DAY_STATUSES).toContain(h.dayStatus);
    if (h.kind === 'bullion') {
      const def = Object.values(BULLION_HOLDINGS).find((d) => d.key === h.key)!;
      expect(def).toBeDefined();
      expect(h).toMatchObject({
        instrumentId: null,
        code: def.code,
        symbol: def.symbol,
        name: def.name,
      });
      expect(h.items).toBeGreaterThan(0);
      expect(h.session?.daily).toBe(false);
    } else {
      expect(h.key).toBe(holdingKey(h.instrumentId!));
      expect(h.items).toBeNull();
    }
    for (const v of [
      h.units,
      h.price,
      h.weightRatio,
      h.previousClose,
      h.changePerUnit,
      h.dayRatio,
      h.newUnits,
    ])
      expect(decimal(v), String(v)).toBe(true);
    if (h.dayStatus === 'ok') {
      expect(h.dayCents).not.toBeNull();
      expect(h.previousClose).not.toBeNull();
    } else {
      expect([h.dayCents, h.dayRatio, h.changePerUnit, h.line]).toEqual([null, null, null, null]);
    }
    if (h.dayStatus === 'unpriced')
      expect([h.price, h.valueCents, h.weightRatio]).toEqual([null, null, null]);
    if (h.kind === 'managed_fund') {
      expect(h.line).toBeNull();
      if (h.session !== null) expect(h.session.daily).toBe(true);
    }
    if (h.line !== null) {
      expect(h.line.points.length).toBeLessThanOrEqual(LINE_MAX_POINTS);
      const times = h.line.points.map(([t]) => t);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
      for (const [, p] of h.line.points) expect(decimal(p)).toBe(true);
    }
    if (h.native !== null) expect(h.native.currency).not.toBe('AUD');
  });

  it('open: the listed shapes (§3.6)', () => {
    const by = new Map(mobileToday.open.holdings.map((h) => [h.code, h]));
    expect(by.get('ABC')).toMatchObject({ dayStatus: 'ok', newUnits: '10' });
    expect(by.get('ABC')!.dayCents!).toBeGreaterThan(0);
    expect(by.get('XYZ')!.dayCents!).toBeLessThan(0);
    expect(by.get('DEF')!.dayCents!).toBeGreaterThan(0);
    expect(by.get('MNO')!.dayCents).toBe(0);
    const exus = by.get('EXUS')!;
    expect(exus.dayCents!).toBeLessThan(0);
    expect(Number(exus.native!.dayRatio)).toBeGreaterThan(0);
    expect(by.get('0PEXAMPLE1')).toMatchObject({
      dayStatus: 'ok',
      line: null,
      session: { daily: true },
    });
    expect(by.get('EXAMPLEFUND2')!.dayStatus).toBe('manual');
    expect(by.get('BTC')!.dayStatus).toBe('ok');
    expect(by.get('ETH')!.dayStatus).toBe('no_base');
    const silver = by.get('SILVER')!;
    expect(silver).toMatchObject({ kind: 'bullion', items: 2, dayStatus: 'ok' });
    expect(silver.dayCents!).toBeLessThan(0);
    expect(Number(silver.native!.dayRatio)).toBeGreaterThan(0);
    expect(silver.line!.points[0]![1]).toBe(silver.line!.base);
    expect(mobileToday.open.holdings.filter((h) => h.dayStatus === 'stale')).toHaveLength(1);
    expect(mobileToday.open.holdings.filter((h) => h.dayStatus === 'unpriced')).toHaveLength(1);
  });

  it('the other moments: windows and empties', () => {
    expect(mobileToday.saturday.portfolioLine!.sessionDate).toBe(mobileToday.saturday.localDate);
    expect(mobileToday.preOpenNoCrypto.market.asx).toBe('pre_open');
    expect(mobileToday.preOpenNoCrypto.portfolioLine!.sessionDate).toBe('2030-09-13');
    expect(
      mobileToday.preOpenNoCrypto.holdings.every(
        (h) => h.kind !== 'crypto' && h.kind !== 'bullion',
      ),
    ).toBe(true);
    expect(mobileToday.holiday.market).toEqual({ asx: 'closed', asxSessionDate: '2030-09-17' });
    expect(mobileToday.allStale.holdings.every((h) => h.dayStatus !== 'ok')).toBe(true);
    expect(mobileToday.allStale.holdings.find((h) => h.code === 'SILVER')!.dayStatus).toBe('stale');
    expect(mobileToday.allStale.portfolioLine).toBeNull();
    expect(mobileToday.empty).toMatchObject({
      holdings: [],
      portfolioLine: null,
      totals: { valueCents: 0, dayCents: null, dayRatio: null, holdings: 0 },
    });
  });

  it('covers every day status, market state and holding kind', () => {
    expect([...FIXTURE_COVERAGE.dayStatuses].sort()).toEqual([...DAY_STATUSES].sort());
    expect([...FIXTURE_COVERAGE.marketStates].sort()).toEqual([...MARKET_STATES].sort());
    expect([...FIXTURE_COVERAGE.mobileHoldingKinds].sort()).toEqual(
      [...MOBILE_HOLDING_KINDS].sort(),
    );
  });
});

describe('device, pair and the requests', () => {
  it('uses the obviously fake key and device id', () => {
    expect(FIXTURE_DEVICE_KEY).toBe(`jfk_${'0'.repeat(43)}`);
    expect(MOBILE_KEY_RE.test(mobilePair.ok.key)).toBe(true);
    expect(mobilePair.ok.deviceId).toBe(FIXTURE_DEVICE_ID);
    expect(DEVICE_ID_RE.test(mobileDevice.ok.deviceId)).toBe(true);
    expect(JSON.stringify(mobileDevice)).not.toContain('jfk_');
  });

  it('normalises each request code as recorded', () => {
    for (const r of Object.values(mobilePairRequests))
      expect(normalisePairingCode(r.body.code)).toBe(r.normalisedCode);
  });
});

describe('phoneSections (§3.6)', () => {
  it.each(Object.entries(phoneSections))('%s', (_name, p) => {
    expect(p.apiVersion).toBe(1);
    expect(p.maxDevices).toBe(MOBILE_MAX_DEVICES);
    expect(p.devices.length).toBeLessThanOrEqual(MOBILE_MAX_DEVICES);
    expect(p.removed.length).toBeLessThanOrEqual(MOBILE_KEEP_REMOVED);
    for (const d of [...p.devices, ...p.removed]) expect(DEVICE_ID_RE.test(d.id)).toBe(true);
    expect(p.devices.every((d) => d.revokedAt === null)).toBe(true);
    expect(p.removed.every((d) => d.revokedAt !== null)).toBe(true);
    const paired = p.devices.map((d) => d.pairedAt);
    expect(paired).toEqual([...paired].sort().reverse());
    const revoked = p.removed.map((d) => d.revokedAt!);
    expect(revoked).toEqual([...revoked].sort().reverse());
    if (p.pairing !== null) expect(normalisePairingCode(p.pairing.code)).toBe(p.pairing.code);
    expect(p.pendingRemovals > 0).toBe(p.storeProblem === 'unwritable');
    expect(JSON.stringify(p)).not.toContain('jfk_');
  });

  it('shows the frozen states', () => {
    expect(phoneSections.pairingOpen.pairing).toMatchObject({
      code: 'ABCDE12345',
      failuresLeft: 5,
    });
    const { createdAt, expiresAt } = phoneSections.pairingOpen.pairing!;
    expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(300_000);
    expect(Date.parse(expiresAt) - Date.parse('2030-09-12T05:20:00.000Z')).toBe(272_000); // 4:32
    expect(phoneSections.limit.devices).toHaveLength(MOBILE_MAX_DEVICES);
    expect(phoneSections.storeUnwritable).toMatchObject({
      storeProblem: 'unwritable',
      pendingRemovals: 1,
    });
    expect(FIXTURE_COVERAGE.phoneStoreProblems).toEqual(
      expect.arrayContaining([null, 'set_aside', 'unwritable']),
    );
    expect([...FIXTURE_COVERAGE.phoneCancelReasons]).toEqual(['failures']);
    expect(phoneSections.justPaired.lastPaired?.id).toBe(phoneSections.justPaired.devices[0]!.id);
  });
});

describe('error bodies of the Stage 9 codes (§4.5)', () => {
  it('has one body per new code with its fixed sentence', () => {
    const bodies = Object.values(mobileApiErrors);
    expect(bodies.map((b) => b.error.code)).toEqual(API_ERROR_CODES.slice(-9));
    for (const body of bodies) {
      expect(isApiErrorBody(body)).toBe(true);
      expect(body.error.message).toBe(
        MOBILE_ERROR_MESSAGES[body.error.code as keyof typeof MOBILE_ERROR_MESSAGES],
      );
    }
  });
});
