// Equality with the web (stage-9.md §6.9, the PLAN acceptance) and the leak test (§6.8, §6.10).
// The synthetic seed plus the made-up `NYSE:EXUS` (USD, an FX previous close, a day row), a fund
// `0PEXAMPLE1` (a `1d` row) and a gold bullion row (with a `series_day_quotes` row), all from one app
// instance and clock: every held holding's value and units equal the investment pages', each
// bullion holding equals the Other Assets page's rows of its metal, the total is the pages' sum, and
// cash and the hand-priced asset change nothing. Then: the captured log, every error body and the
// job_runs rows carry no key, no key hash and no code.
process.env.TZ = 'Australia/Melbourne';

import {
  INSTRUMENT_KINDS,
  JoinrDecimal,
  type InvestmentPageResponse,
  type OtherAssetsPageResponse,
  type PhoneSectionResponse,
} from '@joinr/schema';
import { cashAccounts, jobRuns } from '@joinr/schema/db';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/mobile/keys';
import {
  bearer,
  getToday,
  openCode,
  pairPhone,
  plantBullion,
  plantDay,
  plantInstrument,
  plantPrice,
  plantQuote,
  plantSeriesDay,
  plantTrade,
  startMobileApp,
  unix,
  type MobileApp,
} from './helpers';

const NOW = '2030-09-12T05:20:00.000Z';
const D = (v: string | number) => new JoinrDecimal(v);

let t: MobileApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('equality with the web (§6.9)', () => {
  it('values, units and totals equal the investment and Other Assets pages; cash never counts', async () => {
    t = await startMobileApp({ seed: true, now: NOW });
    const db = t.database.db;
    // NYSE:EXUS in USD with M4's shape.
    const exus = plantInstrument(db, {
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      code: 'EXUS',
      provider: 'yahoo',
      providerSymbol: 'EXUS',
    });
    plantTrade(db, exus, '2030-01-10', '20', '140');
    const p = D(101).div('0.65').toDecimalPlaces(12).toFixed();
    plantPrice(db, exus, {
      price: p,
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: D(1).div('0.65').toDecimalPlaces(12).toFixed(),
      asOf: '2030-09-11T20:00:00.000Z',
    });
    plantDay(db, exus, {
      sessionDate: '2030-09-11',
      timeZone: 'America/New_York',
      nativeCurrency: 'USD',
      previousClose: '100',
      points: [[unix('2030-09-11T19:55:00Z'), '100.9']],
    });
    plantQuote(db, 'AUDUSD', {
      value: '0.65',
      asOf: '2030-09-12T04:50:00.000Z',
      previousClose: '0.64',
      previousCloseDate: '2030-09-11',
    });
    // A Yahoo-priced fund with M7's shape.
    const fund = plantInstrument(db, {
      kind: 'managed_fund',
      symbol: '0PEXAMPLE1',
      code: '0PEXAMPLE1',
      provider: 'yahoo',
      providerSymbol: '0PEXAMPLE1',
    });
    plantTrade(db, fund, '2030-01-10', '1000', '1.4');
    plantPrice(db, fund, { price: '1.515', asOf: '2030-09-11T06:00:00.000Z' });
    plantDay(db, fund, {
      sessionDate: '2030-09-11',
      timeZone: 'Australia/Sydney',
      granularity: '1d',
      previousClose: '1.5',
      points: [[unix('2030-09-11T06:00:00Z'), '1.515']],
    });
    // A gold row (the seed's spot: 2600 USD ÷ 0.65 = 4000 AUD per ounce) and its day since 00:00.
    plantBullion(db, { metal: 'gold', units: '2', unitCost: '3000', purchaseDate: '2029-01-01' });
    plantSeriesDay(db, 'XAU_AUD_OZ', {
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Melbourne',
      previousClose: '3960',
      points: [[unix('2030-09-11T14:00:00Z'), '3960']],
    });
    plantSeriesDay(db, 'GC_USD_OZ', {
      sessionDate: '2030-09-12',
      timeZone: 'Australia/Melbourne',
      nativeCurrency: 'USD',
      previousClose: '2574',
      points: [[unix('2030-09-11T14:00:00Z'), '2574']],
    });

    const { key } = await pairPhone(t.app);
    const before = await getToday(t.app, key);

    let summed = 0;
    let heldCount = 0;
    for (const kind of INSTRUMENT_KINDS) {
      const page = (
        await t.app.inject({ method: 'GET', url: `/api/investments/${kind}` })
      ).json<InvestmentPageResponse>();
      summed += page.summary.valueCents;
      for (const h of page.holdings.filter((x) => x.status === 'held')) {
        heldCount += 1;
        const m = before.holdings.find((x) => x.key === `i${h.instrumentId}`);
        expect(m, `${kind} ${h.symbol}`).toBeDefined();
        expect(m!.valueCents, h.symbol).toBe(h.valueCents);
        expect(m!.units, h.symbol).toBe(h.units);
      }
    }
    const other = (
      await t.app.inject({ method: 'GET', url: '/api/other-assets' })
    ).json<OtherAssetsPageResponse>();
    let bullionCount = 0;
    for (const metal of ['silver', 'gold'] as const) {
      const rows = other.assets.filter(
        (a) =>
          a.priceSource === 'bullion' &&
          (a.metal ?? 'silver') === metal &&
          D(a.remainingUnits).greaterThan(0),
      );
      if (rows.length === 0) continue;
      bullionCount += 1;
      const m = before.holdings.find((x) => x.key === `bullion-${metal}`)!;
      const value = rows.reduce((s, a) => s + (a.valueCents ?? 0), 0);
      summed += value;
      expect(m.valueCents, metal).toBe(value);
      const oz = rows.reduce((s, a) => s.plus(D(a.remainingUnits).times(a.ozPerUnit ?? '1')), D(0));
      expect(m.units, metal).toBe(oz.toFixed());
      expect(m.items).toBe(rows.length);
    }
    expect(bullionCount).toBe(2);
    expect(before.holdings).toHaveLength(heldCount + bullionCount);
    expect(before.totals.valueCents).toBe(summed);
    // The hand-priced asset is never an input.
    expect(before.holdings.some((h) => h.code === 'Example watch')).toBe(false);

    // EXUS follows M4, the fund M7 and gold M21's arithmetic.
    const exusDay = D(20)
      .times(D(p).minus(D(100).div('0.64')))
      .times(100)
      .toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP)
      .toNumber();
    expect(before.holdings.find((h) => h.key === `i${exus}`)).toMatchObject({
      dayStatus: 'ok',
      dayCents: exusDay,
    });
    expect(before.holdings.find((h) => h.key === `i${fund}`)).toMatchObject({
      dayStatus: 'ok',
      dayCents: 1500,
    });
    expect(before.holdings.find((h) => h.key === 'bullion-gold')).toMatchObject({
      dayStatus: 'ok',
      dayCents: 8000,
      previousClose: '3960',
    });

    // Cash balances change nothing.
    db.update(cashAccounts).set({ balanceCents: 123456789 }).run();
    const after = await getToday(t.app, key);
    expect(after.totals).toEqual(before.totals);
    expect(after.holdings.map((h) => h.valueCents)).toEqual(
      before.holdings.map((h) => h.valueCents),
    );
  });
});

describe('leaks (§6.8)', () => {
  it('no key, key hash or code in the log, any error body, the section or job_runs', async () => {
    const lines: string[] = [];
    t = await startMobileApp({ seed: true, now: NOW });
    // The test config logs nothing; restart at info level so every request line is captured.
    await t.restart({
      config: { ...t.config, logLevel: 'info' },
      logStream: { write: (line: string) => void lines.push(line) },
    });
    const bodies: string[] = [];
    const record = async (opts: InjectOptions) => {
      const res = await t!.app.inject(opts);
      bodies.push(res.body);
      return res;
    };
    const code = await openCode(t.app);
    // Wrong, malformed and right codes; a cross-site attempt; a 413.
    await record({
      method: 'POST',
      url: '/api/mobile/pair',
      payload: { code: code.split('').reverse().join('') },
    });
    await record({ method: 'POST', url: '/api/mobile/pair', payload: { code, extra: code } });
    await record({
      method: 'POST',
      url: '/api/mobile/pair',
      payload: { code },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    await record({
      method: 'POST',
      url: '/api/mobile/pair',
      payload: { code, deviceName: code.repeat(200) },
    });
    const paired = await record({
      method: 'POST',
      url: '/api/mobile/pair',
      payload: { code, deviceName: 'Test phone' },
    });
    const key = paired.json<{ key: string; deviceId: string }>().key;
    const deviceId = paired.json<{ deviceId: string }>().deviceId;
    // Good, bad and mismatched keys; read-only; revoke; revoked.
    await record({ method: 'GET', url: '/api/mobile/today', headers: bearer(key) });
    await record({ method: 'GET', url: '/api/mobile/device', headers: bearer(key) });
    await record({
      method: 'GET',
      url: '/api/mobile/today',
      headers: { authorization: `Bearer ${key}x` },
    });
    await record({
      method: 'GET',
      url: '/api/mobile/today',
      headers: { authorization: `Bearer ${key}`, 'x-joinr-key': `${key.slice(0, -1)}A` },
    });
    await record({
      method: 'POST',
      url: '/api/mobile/today',
      headers: bearer(key),
      payload: { key },
    });
    await record({ method: 'POST', url: `/api/phone/devices/${deviceId}/revoke` });
    await record({ method: 'GET', url: '/api/mobile/today', headers: bearer(key) });
    const section = (
      await t.app.inject({ method: 'GET', url: '/api/phone' })
    ).json<PhoneSectionResponse>();

    const hash = sha256Hex(key);
    const runs = JSON.stringify(t.database.db.select().from(jobRuns).all());
    const log = lines.join('\n');
    expect(lines.length).toBeGreaterThan(10);
    for (const needle of [key, hash, code, 'jfk_']) {
      expect(log.includes(needle), 'log').toBe(false);
      expect(runs.includes(needle), 'job_runs').toBe(false);
      expect(JSON.stringify(section).includes(needle), 'section').toBe(false);
    }
    // Every error body (the 201 is the one place the key appears).
    for (const body of bodies) {
      if (body.includes('"key"')) continue;
      for (const needle of [key, hash, code, 'jfk_'])
        expect(body.includes(needle), body).toBe(false);
    }
    expect(bodies.filter((b) => b.includes(key))).toHaveLength(1);
    expect(log).not.toMatch(/authorization|x-joinr-key/i);
  });
});
