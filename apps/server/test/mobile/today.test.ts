// GET /api/mobile/today end to end (stage-9.md §2.7, §4.3, §6.5, §6.10): the worked examples M1–M26
// through the route with planted rows (prices, `day_quotes`, FX previous closes, and
// `series_day_quotes` for bullion), the response's shape against the fixtures, the empty
// portfolio, a manual and a stale holding, and crypto after midnight before a chart run. The
// engine's own suite owns the arithmetic; this one owns the plumbing from the database to the
// response. Made-up symbols (`NYSE:EXUS`, `0PEXAMPLE1`, `LSE:EXL`) and round amounts only.
process.env.TZ = 'Australia/Melbourne';

import {
  JoinrDecimal,
  LINE_MAX_POINTS,
  type MobileHoldingDto,
  type MobileTodayResponse,
} from '@joinr/schema';
import { mobileToday } from '@joinr/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bars,
  getToday,
  pairPhone,
  plantBullion,
  plantDay,
  plantInstrument,
  plantManual,
  plantPrice,
  plantQuote,
  plantSeriesDay,
  plantTrade,
  startMobileApp,
  unix,
  type MobileApp,
} from './helpers';

const MEL = 'Australia/Melbourne';
const SYD = 'Australia/Sydney';
const NY = 'America/New_York';
const D = (v: string | number) => new JoinrDecimal(v);
const cents = (d: InstanceType<typeof JoinrDecimal>) =>
  d.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
/** roundDerived (12 dp at or above 1, else 12 significant digits). */
const derived = (d: InstanceType<typeof JoinrDecimal>) =>
  (d.abs().greaterThanOrEqualTo(1) ? d.toDecimalPlaces(12) : d.toSignificantDigits(12)).toFixed();
const ratio = (d: InstanceType<typeof JoinrDecimal>) =>
  d.toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP).toFixed();

let t: MobileApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function scene(
  nowIso: string,
): Promise<{ app: MobileApp; db: MobileApp['database']['db']; key: string }> {
  t = await startMobileApp({ seed: false, now: nowIso });
  const { key } = await pairPhone(t.app);
  return { app: t, db: t.database.db, key };
}

const byKey = (r: MobileTodayResponse, id: number | string): MobileHoldingDto => {
  const key = typeof id === 'number' ? `i${id}` : id;
  const h = r.holdings.find((x) => x.key === key);
  if (!h) throw new Error(`no holding ${key}`);
  return h;
};

/** The ASX session of Thursday 12/09/2030: 10:00–15:15 AEST (00:00Z–05:15Z). */
const THU_ASX = (a: number, b: number) =>
  bars('2030-09-12T00:00:00Z', '2030-09-12T05:15:00Z', a, b);

describe('the process zone', () => {
  it('this file runs in Melbourne (fails if the TZ line is missing)', () => {
    expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-02T14:00:00.000Z');
  });
});

describe('Thursday 12/09/2030 15:20 (M1–M8, M10, M18)', () => {
  it('each holding through the route', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    const asOf = '2030-09-12T05:15:00.000Z';
    // M1: an ASX ETF, nothing new.
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf });
    plantDay(db, xyz, {
      sessionDate: '2030-09-12',
      timeZone: SYD,
      previousClose: '50',
      points: THU_ASX(50, 50.5),
    });
    // M2: bought in the session.
    const def = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:DEF',
      code: 'DEF',
      provider: 'yahoo',
      providerSymbol: 'DEF.AX',
    });
    plantTrade(db, def, '2030-01-10', '100', '40');
    plantTrade(db, def, '2030-09-12', '10', '50.2');
    plantPrice(db, def, { price: '50.5', asOf });
    plantDay(db, def, {
      sessionDate: '2030-09-12',
      timeZone: SYD,
      previousClose: '50',
      points: THU_ASX(50, 50.5),
    });
    // M3: sold in the session (FIFO).
    const abc = plantInstrument(db, {
      kind: 'stock',
      symbol: 'ASX:ABC',
      code: 'ABC',
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
    });
    plantTrade(db, abc, '2030-01-10', '100', '40');
    plantTrade(db, abc, '2030-09-12', '-40', '50.4');
    plantPrice(db, abc, { price: '50.5', asOf });
    plantDay(db, abc, {
      sessionDate: '2030-09-12',
      timeZone: SYD,
      previousClose: '50',
      points: THU_ASX(50, 50.5),
    });
    // M4: a US listing with an FX move (Wednesday's NY session).
    const exus = plantInstrument(db, {
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      code: 'EXUS',
      provider: 'yahoo',
      providerSymbol: 'EXUS',
    });
    plantTrade(db, exus, '2030-01-10', '20', '140');
    const exusPrice = derived(D(101).div('0.65'));
    plantPrice(db, exus, {
      price: exusPrice,
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: derived(D(1).div('0.65')),
      asOf: '2030-09-11T20:00:00.000Z',
    });
    plantDay(db, exus, {
      sessionDate: '2030-09-11',
      timeZone: NY,
      nativeCurrency: 'USD',
      previousClose: '100',
      points: bars('2030-09-11T13:30:00Z', '2030-09-11T20:00:00Z', 100, 101),
    });
    plantQuote(db, 'AUDUSD', {
      value: '0.65',
      asOf,
      previousClose: '0.64',
      previousCloseDate: '2030-09-11',
    });
    // M18: a GBp listing.
    const exl = plantInstrument(db, {
      kind: 'stock',
      symbol: 'LSE:EXL',
      code: 'EXL',
      provider: 'yahoo',
      providerSymbol: 'EXL.L',
    });
    plantTrade(db, exl, '2030-01-10', '100', '4');
    plantPrice(db, exl, {
      price: '4.775',
      nativePrice: '250',
      nativeCurrency: 'GBp',
      fxRate: '0.0191',
      asOf: '2030-09-11T15:30:00.000Z',
    });
    plantDay(db, exl, {
      sessionDate: '2030-09-11',
      timeZone: 'Europe/London',
      nativeCurrency: 'GBp',
      previousClose: '245',
      points: bars('2030-09-11T07:00:00Z', '2030-09-11T15:30:00Z', 245, 250),
    });
    plantQuote(db, 'FX_GBPAUD', {
      value: '1.91',
      asOf,
      previousClose: '1.9',
      previousCloseDate: '2030-09-11',
    });
    // M5: crypto since 00:00 Melbourne (11/09 14:00Z).
    const btc = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'bitcoin',
    });
    plantTrade(db, btc, '2030-01-10', '0.5', '100000');
    plantPrice(db, btc, { price: '164000', asOf, source: 'coingecko' });
    plantDay(db, btc, {
      sessionDate: '2030-09-12',
      timeZone: MEL,
      previousClose: '160000',
      points: bars('2030-09-11T14:00:00Z', '2030-09-12T05:15:00Z', 160000, 164000),
    });
    // M6: crypto, no chart since midnight.
    const eth = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'ETH',
      code: 'ETH',
      provider: 'coingecko',
      providerSymbol: 'ethereum',
    });
    plantTrade(db, eth, '2030-01-10', '2', '3000');
    plantPrice(db, eth, { price: '4000', asOf, source: 'coingecko' });
    plantDay(db, eth, {
      sessionDate: '2030-09-11',
      timeZone: MEL,
      previousClose: '3900',
      points: [],
    });
    // M7: a fund priced daily by Yahoo (Wednesday's NAV).
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
      timeZone: SYD,
      granularity: '1d',
      previousClose: '1.5',
      points: [[unix('2030-09-11T06:00:00Z'), '1.515']],
    });
    // M8: a hand-priced fund.
    const manual = plantInstrument(db, {
      kind: 'managed_fund',
      symbol: 'EXAMPLEFUND2',
      code: 'EXAMPLEFUND2',
      provider: 'none',
      providerSymbol: null,
    });
    plantTrade(db, manual, '2030-01-10', '100', '2');
    plantManual(db, manual, '2.5', '2030-09-10');

    const r = await getToday(app.app, key);

    const m1 = byKey(r, xyz);
    expect(m1).toMatchObject({
      dayStatus: 'ok',
      dayCents: 5000,
      dayRatio: '0.01',
      previousClose: '50',
      changePerUnit: '0.5',
      newUnits: '0',
      code: 'XYZ',
      symbol: 'ASX:XYZ',
      kind: 'etf',
      instrumentId: xyz,
      session: { date: '2030-09-12', timeZone: SYD, daily: false },
    });
    expect(m1.line!.points.length).toBeLessThanOrEqual(LINE_MAX_POINTS);
    expect(m1.line!.base).toBe('50');
    expect(byKey(r, def)).toMatchObject({
      dayCents: 5300,
      changePerUnit: '0.5',
      dayRatio: '0.01',
      newUnits: '10',
    });
    expect(byKey(r, abc)).toMatchObject({ dayCents: 3000, units: '60' });

    const m4 = byKey(r, exus);
    const B4 = D(100).times(D(1).div('0.64'));
    expect(m4).toMatchObject({
      dayStatus: 'ok',
      dayCents: -1731,
      previousClose: B4.toFixed(),
      dayRatio: ratio(D(exusPrice).minus(B4).div(B4)),
      native: { currency: 'USD', price: '101', previousClose: '100', dayRatio: '0.01' },
      session: { date: '2030-09-11', timeZone: NY, daily: false },
    });

    expect(byKey(r, exl)).toMatchObject({
      dayStatus: 'ok',
      dayCents: 1200,
      previousClose: '4.655',
      native: { currency: 'GBp', price: '250', previousClose: '245', dayRatio: '0.0204081632653' },
      dayRatio: '0.0257787325456',
    });
    expect(byKey(r, btc)).toMatchObject({ dayStatus: 'ok', dayCents: 200000, dayRatio: '0.025' });
    expect(byKey(r, btc).line!.base).toBe('160000');
    expect(byKey(r, eth)).toMatchObject({
      dayStatus: 'no_base',
      dayCents: null,
      valueCents: 800000,
    });
    expect(byKey(r, fund)).toMatchObject({
      dayStatus: 'ok',
      dayCents: 1500,
      line: null,
      session: { date: '2030-09-11', timeZone: SYD, daily: true },
    });
    expect(byKey(r, manual)).toMatchObject({
      dayStatus: 'manual',
      priceStatus: 'manual',
      dayCents: null,
      valueCents: 25000,
    });

    // M10: the totals are exact sums of the ok holdings; the line ends at the total.
    const ok = r.holdings.filter((h) => h.dayStatus === 'ok');
    const dayCents = ok.reduce((s, h) => s + h.dayCents!, 0);
    expect(dayCents).toBe(5000 + 5300 + 3000 - 1731 + 1200 + 200000 + 1500);
    expect(r.totals.dayCents).toBe(dayCents);
    const base = ok.reduce((s, h) => s + h.valueCents! - h.dayCents!, 0);
    expect(r.totals.dayRatio).toBe(ratio(D(dayCents).div(base)));
    expect(r.totals).toMatchObject({ up: 6, down: 1, flat: 0, noChange: 2, holdings: 9 });
    expect(r.totals.valueCents).toBe(r.holdings.reduce((s, h) => s + (h.valueCents ?? 0), 0));
    expect(r.portfolioLine!.points.at(-1)![1]).toBe(dayCents);
    expect(r.portfolioLine!.sessionDate).toBe('2030-09-12');
    // Weights sum to 1; the order is value desc.
    const weights = r.holdings.reduce((s, h) => s.plus(h.weightRatio ?? 0), D(0));
    expect(weights.minus(1).abs().lessThan(1e-9)).toBe(true);
    const values = r.holdings.map((h) => h.valueCents ?? -1);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // The market and the freshness.
    expect(r.market).toEqual({ asx: 'open', asxSessionDate: '2030-09-12' });
    expect(r.freshness).toMatchObject({ manual: 1, stale: 0, failed: 0, unpriced: 0 });
    expect(r.freshness.latestPriceAt).toBe(asOf);
    expect(r.freshness.oldestPriceAt).toBe('2030-09-11T06:00:00.000Z');
    expect(r).toMatchObject({
      apiVersion: 1,
      timeZone: MEL,
      localDate: '2030-09-12',
      generatedAt: '2030-09-12T05:20:00.000Z',
    });
    // Positions.
    expect(m1.position).toEqual({
      costCents: 400000,
      unrealisedCents: 105000,
      unrealisedRatio: '0.2625',
      averagePrice: '40',
    });
  });
});

describe('M9, M17, M19: stale, a lagging NAV, a price newer than the day row', () => {
  it('M9: a Friday price on Tuesday is stale (no day figure)', async () => {
    const { app, db, key } = await scene('2030-09-17T02:00:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-13T06:10:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-13',
      timeZone: SYD,
      previousClose: '50',
      points: [],
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, xyz)).toMatchObject({
      priceStatus: 'stale',
      dayStatus: 'stale',
      dayCents: null,
      valueCents: 505000,
    });
    expect(r.freshness.stale).toBe(1);
    expect(r.totals).toMatchObject({ dayCents: null, noChange: 1 });
    expect(r.portfolioLine).toBeNull();
  });

  it("M17: Thursday's NAV is a day figure on Monday (daily), stale on Tuesday", async () => {
    const plant = (db: MobileApp['database']['db']) => {
      const fund = plantInstrument(db, {
        kind: 'managed_fund',
        symbol: '0PEXAMPLE1',
        code: '0PEXAMPLE1',
        provider: 'yahoo',
        providerSymbol: '0PEXAMPLE1',
      });
      plantTrade(db, fund, '2030-01-10', '1000', '1.4');
      plantPrice(db, fund, { price: '1.515', asOf: '2030-09-12T06:00:00.000Z' });
      plantDay(db, fund, {
        sessionDate: '2030-09-12',
        timeZone: SYD,
        granularity: '1d',
        previousClose: '1.5',
        points: [[unix('2030-09-12T06:00:00Z'), '1.515']],
      });
      return fund;
    };
    const mon = await scene('2030-09-16T02:00:00.000Z');
    const fund = plant(mon.db);
    expect(byKey(await getToday(mon.app.app, mon.key), fund)).toMatchObject({
      priceStatus: 'stale',
      dayStatus: 'ok',
      dayCents: 1500,
      session: { date: '2030-09-12', daily: true },
    });
    mon.app.clock.set('2030-09-17T02:00:00.000Z');
    expect(byKey(await getToday(mon.app.app, mon.key), fund)).toMatchObject({
      dayStatus: 'stale',
      dayCents: null,
    });
  });

  it("M19: a price newer than the day row (Tuesday's 5d fallback vs Monday's row) → no_base", async () => {
    const { app, db, key } = await scene('2030-09-17T00:30:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.6', asOf: '2030-09-17T00:25:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-16',
      timeZone: SYD,
      previousClose: '50',
      points: bars('2030-09-16T00:00:00Z', '2030-09-16T06:10:00Z', 50, 50.5),
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, xyz)).toMatchObject({
      priceStatus: 'fresh',
      dayStatus: 'no_base',
      dayCents: null,
    });
  });
});

describe('closed markets and the portfolio line (M11–M13, M20)', () => {
  it("M11: Saturday 11:00 — the ETF shows Friday's move; the line runs 00:00 → now with the ETF throughout", async () => {
    const { app, db, key } = await scene('2030-09-14T01:00:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-13T06:10:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-13',
      timeZone: SYD,
      previousClose: '50',
      points: bars('2030-09-13T00:00:00Z', '2030-09-13T06:10:00Z', 50, 50.5),
    });
    const btc = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'bitcoin',
    });
    plantTrade(db, btc, '2030-01-10', '0.5', '100000');
    plantPrice(db, btc, { price: '161000', asOf: '2030-09-14T00:55:00.000Z', source: 'coingecko' });
    plantDay(db, btc, {
      sessionDate: '2030-09-14',
      timeZone: MEL,
      previousClose: '160000',
      points: bars('2030-09-13T14:00:00Z', '2030-09-14T00:55:00Z', 160000, 161000),
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, xyz)).toMatchObject({
      dayStatus: 'ok',
      dayCents: 5000,
      session: { date: '2030-09-13' },
    });
    expect(byKey(r, btc)).toMatchObject({ dayStatus: 'ok', dayCents: 50000 });
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2030-09-13T14:00:00.000Z',
      to: '2030-09-14T01:00:00.000Z',
      sessionDate: '2030-09-14',
    });
    expect(line.points[0]).toEqual([unix('2030-09-13T14:00:00Z'), 5000]);
    expect(line.points.at(-1)).toEqual([unix('2030-09-14T01:00:00Z'), 55000]);
    expect(r.market.asx).toBe('closed');
  });

  it("M12/M13: Monday 08:00, no crypto — the line is Friday's session; market pre_open; the stored row is used", async () => {
    const { app, db, key } = await scene('2030-09-15T22:00:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, {
      price: '50.5',
      asOf: '2030-09-13T06:10:00.000Z',
      fetchedAt: '2030-09-15T21:55:00.000Z',
    });
    plantDay(db, xyz, {
      sessionDate: '2030-09-13',
      timeZone: SYD,
      previousClose: '50',
      points: bars('2030-09-13T00:00:00Z', '2030-09-13T06:10:00Z', 50, 50.5),
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, xyz)).toMatchObject({ dayStatus: 'ok', dayCents: 5000 });
    expect(r.portfolioLine).toMatchObject({
      from: '2030-09-13T00:00:00.000Z',
      to: '2030-09-13T06:10:00.000Z',
      sessionDate: '2030-09-13',
    });
    expect(r.portfolioLine!.points.at(-1)![1]).toBe(5000);
    expect(r.market).toEqual({ asx: 'pre_open', asxSessionDate: '2030-09-13' });
    expect(r.freshness.lastFetchAt).toBe('2030-09-15T21:55:00.000Z');
  });

  it('M20: Saturday 08:00, an ASX line and an EXUS line from Friday — the window comes from EXUS', async () => {
    const { app, db, key } = await scene('2030-09-13T22:00:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-13T06:10:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-13',
      timeZone: SYD,
      previousClose: '50',
      points: bars('2030-09-13T00:00:00Z', '2030-09-13T06:10:00Z', 50, 50.5),
    });
    const exus = plantInstrument(db, {
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      code: 'EXUS',
      provider: 'yahoo',
      providerSymbol: 'EXUS',
    });
    plantTrade(db, exus, '2030-01-10', '20', '140');
    plantPrice(db, exus, {
      price: derived(D(101).div('0.65')),
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: derived(D(1).div('0.65')),
      asOf: '2030-09-13T20:00:00.000Z',
    });
    plantDay(db, exus, {
      sessionDate: '2030-09-13',
      timeZone: NY,
      nativeCurrency: 'USD',
      previousClose: '100',
      points: bars('2030-09-13T13:30:00Z', '2030-09-13T20:00:00Z', 100, 101),
    });
    plantQuote(db, 'AUDUSD', {
      value: '0.65',
      asOf: '2030-09-13T20:00:00.000Z',
      previousClose: '0.65',
      previousCloseDate: '2030-09-12',
    });
    const r = await getToday(app.app, key);
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2030-09-13T14:00:00.000Z',
      to: '2030-09-13T22:00:00.000Z',
      sessionDate: '2030-09-14',
    });
    expect(line.points.at(-1)![1]).toBe(r.totals.dayCents);
    // The ASX line ended before `from`: its final value throughout (5000 at the first point).
    const exusAtFrom = cents(
      D(20).times(
        D(bars('2030-09-13T13:30:00Z', '2030-09-13T20:00:00Z', 100, 101)[6]![1])
          .times(derived(D(1).div('0.65')))
          .minus(D(100).times(derived(D(1).div('0.65')))),
      ),
    );
    expect(line.points[0]).toEqual([unix('2030-09-13T14:00:00Z'), 5000 + exusAtFrom]);
  });
});

describe('rounding and lots (M14–M16)', () => {
  it('M14: three holdings of 0.005 each → 1 cent each, total 3', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    for (const code of ['ABC', 'DEF', 'XYZ']) {
      const id = plantInstrument(db, {
        kind: 'etf',
        symbol: `ASX:${code}`,
        code,
        provider: 'yahoo',
        providerSymbol: `${code}.AX`,
      });
      plantTrade(db, id, '2030-01-10', '1', '9');
      plantPrice(db, id, { price: '10.005', asOf: '2030-09-12T05:15:00.000Z' });
      plantDay(db, id, {
        sessionDate: '2030-09-12',
        timeZone: SYD,
        previousClose: '10',
        points: [],
      });
    }
    const r = await getToday(app.app, key);
    expect(r.holdings.map((h) => h.dayCents)).toEqual([1, 1, 1]);
    expect(r.totals.dayCents).toBe(3);
  });

  it("M15: a lot bought after the fund's session adds 0 (value counts; base excludes it)", async () => {
    const { app, db, key } = await scene('2030-09-13T02:00:00.000Z');
    const fund = plantInstrument(db, {
      kind: 'managed_fund',
      symbol: '0PEXAMPLE1',
      code: '0PEXAMPLE1',
      provider: 'yahoo',
      providerSymbol: '0PEXAMPLE1',
    });
    plantTrade(db, fund, '2030-01-10', '1000', '1.4');
    plantTrade(db, fund, '2030-09-13', '200', '1.51');
    plantPrice(db, fund, { price: '1.515', asOf: '2030-09-12T06:00:00.000Z' });
    plantDay(db, fund, {
      sessionDate: '2030-09-12',
      timeZone: SYD,
      granularity: '1d',
      previousClose: '1.5',
      points: [[unix('2030-09-12T06:00:00Z'), '1.515']],
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, fund)).toMatchObject({ dayCents: 1500, valueCents: 181800, newUnits: '0' });
    expect(r.totals.dayRatio).toBe('0.01'); // 1500 ÷ (181800 − 1500 − 30300)
  });

  it("M16: a US lot dated the next Melbourne day adds 0 in Thursday's session, then counts from its price", async () => {
    const { app, db, key } = await scene('2030-09-13T00:00:00.000Z');
    const exus = plantInstrument(db, {
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      code: 'EXUS',
      provider: 'yahoo',
      providerSymbol: 'EXUS',
    });
    plantTrade(db, exus, '2030-01-10', '20', '140');
    plantTrade(db, exus, '2030-09-13', '10', '150');
    plantPrice(db, exus, {
      price: derived(D(101).div('0.65')),
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: derived(D(1).div('0.65')),
      asOf: '2030-09-12T20:00:00.000Z',
    });
    plantDay(db, exus, {
      sessionDate: '2030-09-12',
      timeZone: NY,
      nativeCurrency: 'USD',
      previousClose: '100',
      points: [],
    });
    plantQuote(db, 'AUDUSD', {
      value: '0.65',
      asOf: '2030-09-12T20:00:00.000Z',
      previousClose: '0.64',
      previousCloseDate: '2030-09-12',
    });
    let h = byKey(await getToday(app.app, key), exus);
    expect(h).toMatchObject({ dayCents: -1731, newUnits: '0', units: '30' });
    // Saturday 08:00: Friday's NY session stored.
    app.clock.set('2030-09-13T22:00:00.000Z');
    const p = derived(D(102).div('0.65'));
    plantPrice(db, exus, {
      price: p,
      nativePrice: '102',
      nativeCurrency: 'USD',
      fxRate: derived(D(1).div('0.65')),
      asOf: '2030-09-13T20:00:00.000Z',
    });
    plantDay(db, exus, {
      sessionDate: '2030-09-13',
      timeZone: NY,
      nativeCurrency: 'USD',
      previousClose: '101',
      points: [],
    });
    plantQuote(db, 'AUDUSD', {
      value: '0.65',
      asOf: '2030-09-13T20:00:00.000Z',
      previousClose: '0.65',
      previousCloseDate: '2030-09-13',
    });
    h = byKey(await getToday(app.app, key), exus);
    const B = D(101).times(derived(D(1).div('0.65')));
    const expected = cents(
      D(20)
        .times(D(p).minus(B))
        .plus(D(10).times(D(p).minus(150))),
    );
    expect(h).toMatchObject({ dayStatus: 'ok', dayCents: expected, newUnits: '10' });
  });
});

// ─── Bullion (M21–M26) ──────────────────────────────────────────────────────────────────────────

const B21 = '3076.923076923077';
const P21 = '3045.454545454545';

function plantGold(
  db: MobileApp['database']['db'],
  asOf: string,
  session: string,
  midnightIso: string,
) {
  plantQuote(db, 'AUDUSD', { value: '0.66', asOf });
  plantQuote(db, 'GC_USD_OZ', { value: '2010', asOf });
  plantQuote(db, 'XAU_AUD_OZ', { value: P21, asOf });
  plantSeriesDay(db, 'XAU_AUD_OZ', {
    sessionDate: session,
    timeZone: MEL,
    previousClose: B21,
    points: [
      [unix(midnightIso), B21],
      [unix(asOf), P21],
    ],
  });
  plantSeriesDay(db, 'GC_USD_OZ', {
    sessionDate: session,
    timeZone: MEL,
    nativeCurrency: 'USD',
    previousClose: '2000',
    points: [
      [unix(midnightIso), '2000'],
      [unix(asOf), '2010'],
    ],
  });
  plantBullion(db, { metal: 'gold', units: '6', unitCost: '2500', purchaseDate: '2029-05-01' });
  plantBullion(db, { metal: 'gold', units: '4', unitCost: '2600', purchaseDate: null });
}

describe('bullion (M21–M26)', () => {
  it('M21: one GOLD holding of 10 oz, its day since 00:00 Melbourne in AUD, Day % in USD', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    plantGold(db, '2030-09-12T05:15:00.000Z', '2030-09-12', '2030-09-11T14:00:00Z');
    const r = await getToday(app.app, key);
    const g = byKey(r, 'bullion-gold');
    expect(g).toMatchObject({
      instrumentId: null,
      kind: 'bullion',
      code: 'GOLD',
      symbol: 'GC=F',
      name: 'Gold bullion',
      items: 2,
      units: '10',
      price: P21,
      priceStatus: 'fresh',
      dayStatus: 'ok',
      previousClose: B21,
      dayCents: -31469,
      changePerUnit: '-31.468531468532',
      dayRatio: '-0.0102272727273',
      valueCents: 1827273 + 1218182,
      native: { currency: 'USD', price: '2010', previousClose: '2000', dayRatio: '0.005' },
      session: { date: '2030-09-12', timeZone: MEL, daily: false },
    });
    expect(g.line).toMatchObject({ sessionDate: '2030-09-12', timeZone: MEL, base: B21 });
    expect(g.position).toEqual({
      costCents: 6 * 250000 + 4 * 260000,
      unrealisedCents: 3045455 - 2540000,
      unrealisedRatio: ratio(D(3045455 - 2540000).div(2540000)),
      averagePrice: '2540',
    });
    expect(r.totals).toMatchObject({ valueCents: 3045455, dayCents: -31469, down: 1, holdings: 1 });
    expect(r.portfolioLine!.from).toBe('2030-09-11T14:00:00.000Z');
    expect(r.freshness.latestPriceAt).toBe('2030-09-12T05:15:00.000Z');
  });

  it('M22: a row bought today counts from its cost; M23: a future-dated row adds 0', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    plantGold(db, '2030-09-12T05:15:00.000Z', '2030-09-12', '2030-09-11T14:00:00Z');
    const today = plantBullion(db, {
      metal: 'gold',
      units: '2',
      unitCost: '3050',
      purchaseDate: '2030-09-12',
    });
    let g = byKey(await getToday(app.app, key), 'bullion-gold');
    expect(g).toMatchObject({ dayCents: -32378, newUnits: '2', items: 3 });
    // M23: the same 2 oz dated tomorrow.
    const { otherAssets } = await import('@joinr/schema/db');
    const { eq } = await import('drizzle-orm');
    db.update(otherAssets)
      .set({ purchaseDate: '2030-09-13' })
      .where(eq(otherAssets.id, today))
      .run();
    const r = await getToday(app.app, key);
    g = byKey(r, 'bullion-gold');
    expect(g).toMatchObject({ dayCents: -31469, newUnits: '0', valueCents: 3654546 });
    expect(r.totals.dayRatio).toBe(ratio(D(-31469).div(3076924)));
  });

  it('M24: Saturday the move to the close; Sunday 0 (flat, one point); Monday the move since the kept base', async () => {
    // Saturday 14/09 11:00 AEST: the futures closed at 07:00 (13/09 21:00Z).
    const { app, db, key } = await scene('2030-09-14T01:00:00.000Z');
    const close = '3060';
    plantQuote(db, 'AUDUSD', { value: '0.65', asOf: '2030-09-13T21:00:00.000Z' });
    plantQuote(db, 'GC_USD_OZ', { value: '1989', asOf: '2030-09-13T21:00:00.000Z' });
    plantQuote(db, 'XAU_AUD_OZ', { value: close, asOf: '2030-09-13T21:00:00.000Z' });
    plantSeriesDay(db, 'XAU_AUD_OZ', {
      sessionDate: '2030-09-14',
      timeZone: MEL,
      previousClose: '3050',
      points: [
        [unix('2030-09-13T14:00:00Z'), '3050'],
        [unix('2030-09-13T21:00:00Z'), close],
      ],
    });
    plantBullion(db, { metal: 'gold', units: '10', unitCost: '2500', purchaseDate: '2029-05-01' });
    let r = await getToday(app.app, key);
    expect(byKey(r, 'bullion-gold')).toMatchObject({ dayStatus: 'ok', dayCents: 10000 });
    // Sunday 15/09 11:00: the 00:00 slot wrote base = the closing spot.
    app.clock.set('2030-09-15T01:00:00.000Z');
    plantSeriesDay(db, 'XAU_AUD_OZ', {
      sessionDate: '2030-09-15',
      timeZone: MEL,
      previousClose: close,
      points: [[unix('2030-09-14T14:00:00Z'), close]],
    });
    r = await getToday(app.app, key);
    const sunday = byKey(r, 'bullion-gold');
    expect(sunday).toMatchObject({ dayStatus: 'ok', dayCents: 0, dayRatio: '0' });
    expect(sunday.line!.points).toEqual([[unix('2030-09-14T14:00:00Z'), close]]);
    expect(r.totals).toMatchObject({ flat: 1, up: 0, down: 0 });
    // Monday 16/09 09:30 after the reopen: the base kept from the 00:00 slot.
    app.clock.set('2030-09-15T23:30:00.000Z');
    plantQuote(db, 'XAU_AUD_OZ', { value: '3070', asOf: '2030-09-15T23:25:00.000Z' });
    plantSeriesDay(db, 'XAU_AUD_OZ', {
      sessionDate: '2030-09-16',
      timeZone: MEL,
      previousClose: close,
      points: [
        [unix('2030-09-15T14:00:00Z'), close],
        [unix('2030-09-15T23:25:00Z'), '3070'],
      ],
    });
    r = await getToday(app.app, key);
    expect(byKey(r, 'bullion-gold')).toMatchObject({
      dayStatus: 'ok',
      dayCents: 10000,
      previousClose: close,
    });
  });

  it('M25: Monday 08:00, no crypto, gold shut since midnight — the window 00:00 → 08:00; ASX final throughout', async () => {
    const { app, db, key } = await scene('2030-09-15T22:00:00.000Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-13T06:10:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-13',
      timeZone: SYD,
      previousClose: '50',
      points: bars('2030-09-13T00:00:00Z', '2030-09-13T06:10:00Z', 50, 50.5),
    });
    plantQuote(db, 'AUDUSD', { value: '0.65', asOf: '2030-09-13T21:00:00.000Z' });
    plantQuote(db, 'GC_USD_OZ', { value: '1989', asOf: '2030-09-13T21:00:00.000Z' });
    plantQuote(db, 'XAU_AUD_OZ', { value: '3060', asOf: '2030-09-13T21:00:00.000Z' });
    plantSeriesDay(db, 'XAU_AUD_OZ', {
      sessionDate: '2030-09-16',
      timeZone: MEL,
      previousClose: '3060',
      points: [[unix('2030-09-15T14:00:00Z'), '3060']],
    });
    plantBullion(db, { metal: 'gold', units: '10', unitCost: '2500', purchaseDate: '2029-05-01' });
    const r = await getToday(app.app, key);
    expect(byKey(r, 'bullion-gold')).toMatchObject({ dayStatus: 'ok', dayCents: 0 });
    expect(r.portfolioLine).toMatchObject({
      from: '2030-09-15T14:00:00.000Z',
      to: '2030-09-15T22:00:00.000Z',
      sessionDate: '2030-09-16',
    });
    expect(r.portfolioLine!.points[0]![1]).toBe(5000);
    expect(r.portfolioLine!.points.at(-1)![1]).toBe(r.totals.dayCents);
    expect(r.market.asx).toBe('pre_open');
  });

  it("M26: no spot — the rows' fallback values, stale, no day figure", async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    plantQuote(db, 'AUDUSD', { value: '0.66', asOf: '2030-09-12T05:15:00.000Z' });
    plantBullion(db, {
      metal: 'gold',
      units: '6',
      unitCost: '2500',
      purchaseDate: '2029-05-01',
      unitPrice: '3000',
    });
    const r = await getToday(app.app, key);
    expect(byKey(r, 'bullion-gold')).toMatchObject({
      priceStatus: 'stale',
      dayStatus: 'stale',
      dayCents: null,
      price: '3000',
      valueCents: 1800000,
    });
    expect(r.totals).toMatchObject({ noChange: 1, dayCents: null, valueCents: 1800000 });
  });
});

describe('shapes and edge cases', () => {
  it("the response has exactly the fixture's fields (top level, totals, holdings)", async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    plantGold(db, '2030-09-12T05:15:00.000Z', '2030-09-12', '2030-09-11T14:00:00Z');
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-12T05:15:00.000Z' });
    plantDay(db, xyz, {
      sessionDate: '2030-09-12',
      timeZone: SYD,
      previousClose: '50',
      points: THU_ASX(50, 50.5),
    });
    const r = await getToday(app.app, key);
    const f = mobileToday.open;
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(r)).toEqual(keys(f));
    expect(keys(r.totals)).toEqual(keys(f.totals));
    expect(keys(r.freshness)).toEqual(keys(f.freshness));
    expect(keys(r.market)).toEqual(keys(f.market));
    expect(keys(r.portfolioLine!)).toEqual(keys(f.portfolioLine!));
    for (const h of r.holdings) {
      expect(keys(h)).toEqual(keys(f.holdings[0]!));
      expect(keys(h.position)).toEqual(keys(f.holdings[0]!.position));
    }
    expect(JSON.stringify(r)).not.toContain('jfk_');
  });

  it('an empty portfolio: totals 0, no day, no line', async () => {
    const { app, key } = await scene('2030-09-12T05:20:00.000Z');
    const r = await getToday(app.app, key);
    expect(r.holdings).toEqual([]);
    expect(r.totals).toEqual({
      valueCents: 0,
      dayCents: null,
      dayRatio: null,
      up: 0,
      down: 0,
      flat: 0,
      noChange: 0,
      holdings: 0,
    });
    expect(r.portfolioLine).toBeNull();
    expect(r.market.asxSessionDate).toBeNull();
    expect(r.freshness).toEqual({
      latestPriceAt: null,
      oldestPriceAt: null,
      lastFetchAt: null,
      stale: 0,
      failed: 0,
      manual: 0,
      unpriced: 0,
    });
  });

  it('an unpriced holding is listed last with no value; a watched-only listing never counts', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    const none = plantInstrument(db, {
      kind: 'stock',
      symbol: 'ASX:MNO',
      code: 'MNO',
      provider: 'yahoo',
      providerSymbol: 'MNO.AX',
    });
    plantTrade(db, none, '2030-01-10', '5', '10');
    const watched = plantInstrument(db, {
      kind: 'stock',
      symbol: 'ASX:ABC',
      code: 'ABC',
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
    });
    plantPrice(db, watched, { price: '12', asOf: '2030-09-12T05:15:00.000Z' });
    plantDay(db, watched, {
      sessionDate: '2030-09-11',
      timeZone: SYD,
      previousClose: '11',
      points: [],
    });
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-12T05:15:00.000Z' });
    const r = await getToday(app.app, key);
    expect(r.holdings.map((h) => h.code)).toEqual(['XYZ', 'MNO']);
    expect(byKey(r, none)).toMatchObject({ dayStatus: 'unpriced', valueCents: null, price: null });
    expect(r.freshness.unpriced).toBe(1);
    expect(r.market.asxSessionDate).toBeNull(); // the watched-only row never counts
  });

  it("crypto after midnight before a chart run → no_base (yesterday's row); the value still counts", async () => {
    const { app, db, key } = await scene('2030-09-12T14:05:00.000Z'); // 00:05 Friday
    const btc = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'bitcoin',
    });
    plantTrade(db, btc, '2030-01-10', '0.5', '100000');
    plantPrice(db, btc, { price: '164000', asOf: '2030-09-12T14:00:00.000Z', source: 'coingecko' });
    plantDay(db, btc, {
      sessionDate: '2030-09-12',
      timeZone: MEL,
      previousClose: '160000',
      points: bars('2030-09-11T14:00:00Z', '2030-09-12T13:55:00Z', 160000, 164000),
    });
    const r = await getToday(app.app, key);
    expect(r.localDate).toBe('2030-09-13');
    expect(byKey(r, btc)).toMatchObject({ dayStatus: 'no_base', valueCents: 8200000 });
    expect(r.totals.valueCents).toBe(8200000);
  });

  it("crypto at 00:05 with today's chart row but a price as-of before midnight → no_base (accepted, §15)", async () => {
    // CoinGecko's `last_updated_at` can trail the 00:00:20 slot: until the 00:15 run the price's
    // as-of date (23:59:40, yesterday) differs from the row's session date, so rule 4 says no_base.
    const { app, db, key } = await scene('2030-09-12T14:05:00.000Z'); // 00:05 Friday
    const btc = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'bitcoin',
    });
    plantTrade(db, btc, '2030-01-10', '0.5', '100000');
    plantPrice(db, btc, {
      price: '164000',
      asOf: '2030-09-12T13:59:40.000Z',
      fetchedAt: '2030-09-12T14:00:20.000Z',
      source: 'coingecko',
    });
    plantDay(db, btc, {
      sessionDate: '2030-09-13',
      timeZone: MEL,
      previousClose: '164000',
      points: bars('2030-09-12T14:00:00Z', '2030-09-12T14:00:00Z', 164000, 164000),
    });
    const r = await getToday(app.app, key);
    expect(r.localDate).toBe('2030-09-13');
    expect(byKey(r, btc)).toMatchObject({
      priceStatus: 'fresh',
      dayStatus: 'no_base',
      dayCents: null,
      valueCents: 8200000,
    });
  });

  it('a stale hand price over a newer fetch: no priceAsOf and the fetch never counts (SPEC-4)', async () => {
    const now = '2030-09-12T05:20:00.000Z';
    const { app, db, key } = await scene(now);
    const xyz = plantInstrument(db, {
      kind: 'etf',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      provider: 'yahoo',
      providerSymbol: 'XYZ.AX',
    });
    plantTrade(db, xyz, '2030-01-10', '100', '40');
    plantPrice(db, xyz, { price: '50.5', asOf: '2030-09-12T05:00:00.000Z' });
    const abc = plantInstrument(db, {
      kind: 'stock',
      symbol: 'ASX:ABC',
      code: 'ABC',
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
    });
    plantTrade(db, abc, '2030-01-10', '100', '40');
    // A newer fetched row underneath a 40-day-old hand price (older than MANUAL_FRESH_DAYS).
    plantPrice(db, abc, {
      price: '60',
      asOf: '2030-09-12T05:15:00.000Z',
      fetchedAt: '2030-09-12T05:16:00.000Z',
    });
    plantManual(db, abc, '45', '2030-08-03');
    const r = await getToday(app.app, key);
    expect(byKey(r, abc)).toMatchObject({
      price: '45',
      priceStatus: 'stale',
      priceAsOf: null,
      dayStatus: 'stale',
      dayCents: null,
      valueCents: 450000,
    });
    expect(r.freshness).toMatchObject({
      stale: 1,
      manual: 0,
      latestPriceAt: '2030-09-12T05:00:00.000Z',
      oldestPriceAt: '2030-09-12T05:00:00.000Z',
      lastFetchAt: '2030-09-12T05:00:00.000Z',
    });
  });

  it('features.* page switches do not hide classes (D95)', async () => {
    const { app, db, key } = await scene('2030-09-12T05:20:00.000Z');
    const btc = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'bitcoin',
    });
    plantTrade(db, btc, '2030-01-10', '0.5', '100000');
    plantPrice(db, btc, { price: '164000', asOf: '2030-09-12T05:15:00.000Z', source: 'coingecko' });
    const res = await app.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { values: { 'features.crypto': false } },
    });
    expect(res.statusCode).toBe(200);
    expect(byKey(await getToday(app.app, key), btc).valueCents).toBe(8200000);
  });
});
