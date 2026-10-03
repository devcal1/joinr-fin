// The Stage 9 fixtures (stage-9.md §3.6): the shapes and invariants the app, the widgets and the
// web section rely on, the coverage of every state and the error bodies; the Android JSON copies
// have their own drift check (android-fixtures.test.ts). The arithmetic of `mobileToday` (totals,
// weights, the line's last point, each holding's day figure) is checked by the engine's
// consistency test. Stage 10 adds the `mobilePeriods` shapes (stage-10.md §3.6); their arithmetic is
// checked by the engine's periodChangeFixtures test.
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
  PERIOD_HOLDING_POINTS,
  PERIOD_STATUSES,
  SERVER_PERIODS,
  SOLD_HOLDINGS_KEY,
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
  mobilePeriods,
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

// ─── Stage 10: mobilePeriods (stage-10.md §3.6, §4.2) ──────────────────────────────────────────

describe('mobilePeriods (stage-10.md §3.6, §4.2)', () => {
  const answers = Object.entries(mobilePeriods);

  it('has the four answers', () => {
    expect(Object.keys(mobilePeriods)).toEqual(['open', 'noHistory', 'soldOnly', 'empty']);
  });

  it.each(answers)('%s: the frozen shape', (_name, r) => {
    expect(r.apiVersion).toBe(1);
    expect(r.timeZone).toBe('Australia/Melbourne');
    expect(r.localDate).toBe('2030-09-12');
    expect(isIsoTimestampString(r.generatedAt)).toBe(true);
    if (r.closesThrough !== null) expect(isIsoDateString(r.closesThrough)).toBe(true);
    expect(r.periods.map((p) => p.period)).toEqual([...SERVER_PERIODS]);
    expect(r.valueCents).toBe(r.holdings.reduce((a, h) => a + (h.valueCents ?? 0), 0));
    const keys = r.holdings.map((h) => h.key);
    for (const p of r.periods) {
      if (p.period === 'ALL') expect(p.startDate).toBeNull();
      else expect(isIsoDateString(p.startDate!)).toBe(true);
      const sold = p.figures.filter((f) => f.key === SOLD_HOLDINGS_KEY);
      expect(sold.length).toBeLessThanOrEqual(p.period === 'ALL' ? 1 : 0);
      expect(p.figures.filter((f) => f.key !== SOLD_HOLDINGS_KEY).map((f) => f.key)).toEqual(keys);
      if (sold.length === 1) expect(p.figures.at(-1)!.key).toBe(SOLD_HOLDINGS_KEY);
      if (p.line !== null) expect(p.line.points.length).toBeLessThanOrEqual(LINE_MAX_POINTS);
      for (const f of p.figures) {
        expect(PERIOD_STATUSES).toContain(f.status);
        for (const v of [f.ratio, f.startClose, f.changePerUnit, f.priceRatio, f.startUnits])
          expect(decimal(v)).toBe(true);
        if (f.line !== null) {
          expect(f.line.points.length).toBeLessThanOrEqual(PERIOD_HOLDING_POINTS);
          for (const [d, v] of f.line.points) {
            expect(isIsoDateString(d)).toBe(true);
            expect(decimal(v)).toBe(true);
          }
        }
        if (p.period === 'ALL') {
          expect([f.startClose, f.startCloseDate, f.changePerUnit, f.priceRatio]).toEqual([
            null,
            null,
            null,
            null,
          ]);
          expect([f.startUnits, f.newUnits, f.laterUnits]).toEqual(['0', '0', '0']);
        } else {
          expect([f.unrealisedCents, f.realisedCents, f.costEverCents]).toEqual([null, null, null]);
        }
        expect(f.soldCount === null).toBe(f.key !== SOLD_HOLDINGS_KEY);
      }
    }
  });

  it('open: the same holdings as mobileToday.open, the listed shapes', () => {
    const r = mobilePeriods.open;
    const today = mobileToday.open;
    expect(r.holdings.map((h) => h.key)).toEqual(today.holdings.map((h) => h.key));
    expect(r.valueCents).toBe(today.totals.valueCents);
    for (const h of r.holdings) {
      const t = today.holdings.find((x) => x.key === h.key)!;
      expect(h).toEqual({
        key: t.key,
        instrumentId: t.instrumentId,
        kind: t.kind,
        code: t.code,
        symbol: t.symbol,
        name: t.name,
        items: t.items,
        units: t.units,
        priceStatus: t.priceStatus,
        price: t.price,
        priceAsOf: t.priceAsOf,
        valueCents: t.valueCents,
        weightRatio: t.weightRatio,
      });
    }
    const fig = (period: string, key: string) =>
      r.periods.find((p) => p.period === period)!.figures.find((f) => f.key === key)!;
    for (const p of ['1W', '2W', '1M', '3M', '6M', '12M']) {
      expect(fig(p, 'i2').status).toBe('split');
      // D166: the bought-in part is counted on the card, marked partial.
      expect(fig(p, 'i12').status).toBe('no_start');
      expect(fig(p, 'i12').cents).toBeGreaterThan(0);
      expect(fig(p, 'i16').status).toBe('unpriced');
    }
    expect(fig('1W', 'i1')).toMatchObject({ status: 'ok', newUnits: '10', startUnits: '100' });
    expect(fig('1W', 'i4')).toMatchObject({ status: 'ok', startUnits: '0', line: null });
    expect(fig('1W', 'i15').status).toBe('ok');
    expect(fig('1M', 'i10')).toMatchObject({ status: 'ok', startClose: '156.25' });
    expect(fig('ALL', 'i3').realisedCents).toBeGreaterThan(0);
    expect(fig('ALL', SOLD_HOLDINGS_KEY)).toMatchObject({ soldCount: 2 });
    const all = r.periods.at(-1)!;
    expect(all.totals.realisedCents).not.toBe(0);
    expect(all.line!.points.at(-1)![1]).toBe(all.totals.unrealisedCents);
    for (const p of r.periods) {
      expect(p.totals.partial).toBe(true);
      expect(p.line).not.toBeNull();
    }
  });

  it('noHistory: lines null, ALL complete with a null line', () => {
    const r = mobilePeriods.noHistory;
    expect(r.closesThrough).toBeNull();
    for (const p of r.periods) {
      expect(p.line).toBeNull();
      for (const f of p.figures) expect(f.line).toBeNull();
    }
    const all = r.periods.at(-1)!;
    expect(all.totals.cents).toBe(mobilePeriods.open.periods.at(-1)!.totals.cents);
  });

  it('soldOnly and empty', () => {
    const sold = mobilePeriods.soldOnly;
    expect(sold.holdings).toEqual([]);
    for (const p of sold.periods.slice(0, -1))
      expect(p.totals).toMatchObject({ cents: null, holdings: 0, partial: false });
    const all = sold.periods.at(-1)!;
    expect(all.figures.map((f) => f.key)).toEqual([SOLD_HOLDINGS_KEY]);
    expect(all.totals).toMatchObject({ unrealisedCents: 0, holdings: 0 });
    expect(all.line).toBeNull();
    for (const p of mobilePeriods.empty.periods) {
      expect(p.figures).toEqual([]);
      expect(p.line).toBeNull();
      expect(p.totals).toMatchObject({ cents: null, baseCents: null, holdings: 0 });
    }
  });

  it('covers every period status but no_cost', () => {
    expect([...FIXTURE_COVERAGE.periodStatuses].sort()).toEqual(
      PERIOD_STATUSES.filter((s) => s !== 'no_cost').sort(),
    );
  });
});
