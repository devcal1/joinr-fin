// GET /api/mobile/periods end to end (stage-10.md §2.7, §4, §6.4–§6.6): the worked examples
// P1–P19 and P21–P23 through the route with planted closes, splits and FX; the fixture shapes
// (noHistory, soldOnly and empty to the value; open's field sets); partial totals; a coin held
// past CoinGecko's reach (flat in the ALL line); the key check on the new path; the leak check.
// The engine's own suite owns the arithmetic; this one owns the plumbing from the database to the
// response. Made-up symbols and coin ids, round amounts and 2030 dates only (the repo is public).
process.env.TZ = 'Australia/Melbourne';

import {
  SERVER_PERIODS,
  SOLD_HOLDINGS_KEY,
  type MobilePeriodDto,
  type MobilePeriodsResponse,
  type ServerPeriod,
} from '@joinr/schema';
import { otherAssets, seriesCloses } from '@joinr/schema/db';
import { mobileApiErrors, mobilePeriods } from '@joinr/schema/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/mobile/keys';
import {
  bearer,
  getPeriods,
  pairPhone,
  plantBullion,
  plantCloses,
  plantInstrument,
  plantManual,
  plantPrice,
  plantQuote,
  plantSeriesCloses,
  plantSplit,
  plantTrade,
  startMobileApp,
  type MobileApp,
} from './helpers';

const NOW = '2030-09-12T05:20:00.000Z'; // Thursday 12/09/2030 15:20 Melbourne
const PRICE_AS_OF = '2030-09-12T04:00:00.000Z';

let t: MobileApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Db = MobileApp['database']['db'];

async function scene(nowIso = NOW): Promise<{ db: Db; key: string; app: MobileApp }> {
  t = await startMobileApp({ seed: false, now: nowIso });
  const { key } = await pairPhone(t.app);
  return { db: t.database.db, key, app: t };
}

const periods = async (key: string) => {
  const res = await getPeriods(t!.app, key);
  checkSums(res);
  return res;
};

const period = (r: MobilePeriodsResponse, p: ServerPeriod): MobilePeriodDto =>
  r.periods.find((x) => x.period === p)!;

const fig = (r: MobilePeriodsResponse, p: ServerPeriod, key: string | number) =>
  period(r, p).figures.find((f) => f.key === (typeof key === 'number' ? `i${key}` : key))!;

function listing(db: Db, symbol: string, code: string, providerSymbol: string, kind = 'stock') {
  return plantInstrument(db, {
    kind: kind as 'stock',
    symbol,
    code,
    provider: 'yahoo',
    providerSymbol,
  });
}

/**
 * Every answer adds up (§2.4, §4.2): seven periods in order; one figure per holding in the
 * holdings' order (then the Sold figure under ALL); totals = sums; the last line point.
 */
function checkSums(r: MobilePeriodsResponse): void {
  expect(r.apiVersion).toBe(1);
  expect(r.periods.map((p) => p.period)).toEqual([...SERVER_PERIODS]);
  const keys = r.holdings.map((h) => h.key);
  expect(r.valueCents).toBe(r.holdings.reduce((s, h) => s + (h.valueCents ?? 0), 0));
  for (const p of r.periods) {
    const label = p.period;
    const held = p.figures.filter((f) => f.key !== SOLD_HOLDINGS_KEY);
    expect(
      held.map((f) => f.key),
      label,
    ).toEqual(keys);
    expect(p.totals.holdings, label).toBe(keys.length);
    expect(p.totals.missing, label).toBe(held.filter((f) => f.status !== 'ok').length);
    expect(p.totals.partial, label).toBe(p.totals.missing > 0);
    const counted = p.figures.filter(
      (f) =>
        f.cents !== null && (f.status === 'ok' || (p.period !== 'ALL' && f.status === 'no_start')),
    );
    const sum = counted.reduce((s, f) => s + f.cents!, 0);
    expect(p.totals.cents, label).toBe(counted.length === 0 ? null : sum);
    if (p.period === 'ALL') {
      if (p.totals.cents !== null)
        expect(p.totals.unrealisedCents! + p.totals.realisedCents!, label).toBe(p.totals.cents);
      if (p.line !== null)
        expect(p.line.points.at(-1), label).toEqual([r.localDate, p.totals.unrealisedCents]);
    } else {
      expect(p.totals.unrealisedCents, label).toBeNull();
      if (p.line !== null)
        expect(p.line.points.at(-1), label).toEqual([r.localDate, p.totals.cents]);
    }
  }
}

describe('the worked examples through the route (§2.7)', () => {
  it('P1 held throughout; P15 a future-dated lot; P17 a stale price still counts', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40', 1000);
    plantCloses(db, abc, [['2030-09-05', '50']]);
    plantPrice(db, abc, { price: '50.5', asOf: PRICE_AS_OF });
    let r = await periods(key);
    expect(fig(r, '1W', abc)).toMatchObject({
      status: 'ok',
      cents: 5000,
      ratio: '0.01',
      startClose: '50',
      startCloseDate: '2030-09-05',
      changePerUnit: '0.5',
      priceRatio: '0.01',
      startUnits: '100',
      newUnits: '0',
      laterUnits: '0',
      newCostCents: null,
      unrealisedCents: null,
    });
    expect(r.holdings[0]!.valueCents).toBe(505000);
    expect(period(r, '1W').totals).toMatchObject({ cents: 5000, baseCents: 500000, up: 1 });
    expect(r.closesThrough).toBe('2030-09-05');

    // P17: a stale price (as-of 10/09, after b) still gives the figure.
    plantPrice(db, abc, { price: '50.5', asOf: '2030-09-10T06:00:00.000Z' });
    r = await periods(key);
    expect(r.holdings[0]!.priceStatus).toBe('stale');
    expect(fig(r, '1W', abc)).toMatchObject({ status: 'ok', cents: 5000 });

    // P15: + 10 units dated 20/09 add nothing and stay outside the base.
    plantTrade(db, abc, '2030-09-20', '10', '50');
    r = await periods(key);
    expect(r.holdings[0]!.valueCents).toBe(555500);
    expect(fig(r, '1W', abc)).toMatchObject({ cents: 5000, laterUnits: '10', ratio: '0.01' });
    expect(period(r, '1W').totals.baseCents).toBe(500000);
  });

  it('P2 bought within; P3 sold within (D160)', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40', 1000);
    plantTrade(db, abc, '2030-09-09', '20', '49', 950);
    plantCloses(db, abc, [['2030-09-05', '50']]);
    plantPrice(db, abc, { price: '50.5', asOf: PRICE_AS_OF });
    const xyz = listing(db, 'ASX:XYZ', 'XYZ', 'XYZ.AX');
    plantTrade(db, xyz, '2030-02-01', '60', '40');
    plantTrade(db, xyz, '2030-03-01', '40', '45');
    plantTrade(db, xyz, '2030-09-10', '-40', '52');
    plantCloses(db, xyz, [['2030-09-05', '50']]);
    plantPrice(db, xyz, { price: '50.5', asOf: PRICE_AS_OF });
    const r = await periods(key);
    expect(fig(r, '1W', abc)).toMatchObject({
      status: 'ok',
      cents: 8000,
      ratio: '0.0133779264214',
      startUnits: '100',
      newUnits: '20',
      newCostCents: 98000,
    });
    expect(r.holdings.find((h) => h.key === `i${abc}`)!.valueCents).toBe(606000);
    expect(fig(r, '1W', xyz)).toMatchObject({
      status: 'ok',
      cents: 3000,
      ratio: '0.01',
      startUnits: '60',
    });
  });

  it('P4 a weekend start (Saturday localDate)', async () => {
    const { db, key } = await scene('2030-09-14T05:20:00.000Z');
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40');
    plantCloses(db, abc, [
      ['2030-09-05', '49'],
      ['2030-09-06', '49.5'],
    ]);
    plantPrice(db, abc, { price: '50', asOf: '2030-09-13T06:00:00.000Z' });
    const r = await periods(key);
    expect(r.localDate).toBe('2030-09-14');
    expect(period(r, '1W').startDate).toBe('2030-09-07');
    expect(fig(r, '1W', abc)).toMatchObject({
      status: 'ok',
      cents: 5000,
      startClose: '49.5',
      startCloseDate: '2030-09-06',
    });
  });

  it('P5 a USD listing measured with AUDUSD at the start (D143); P16 an FX close too old', async () => {
    const { db, key } = await scene();
    const exus = listing(db, 'NYSE:EXUS', 'EXUS', 'EXUS');
    plantTrade(db, exus, '2030-05-01', '20', '150');
    plantCloses(db, exus, [['2030-08-12', '100']], 'USD');
    plantSeriesCloses(db, 'AUDUSD', [['2030-08-12', '0.64']]);
    plantPrice(db, exus, {
      price: '155.384615384615',
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: '1.538461538462',
      asOf: '2030-09-11T20:00:00.000Z',
    });
    let r = await periods(key);
    expect(period(r, '1M').startDate).toBe('2030-08-12');
    expect(fig(r, '1M', exus)).toMatchObject({
      status: 'ok',
      cents: -1731,
      ratio: '-0.0055392',
      startClose: '156.25',
      startCloseDate: '2030-08-12',
      changePerUnit: '-0.865384615385',
      priceRatio: '-0.00553846153846',
    });
    expect(r.holdings[0]!.valueCents).toBe(310769);
    expect(period(r, '1M').totals.baseCents).toBe(312500);
    // The FX series counts towards closesThrough.
    expect(r.closesThrough).toBe('2030-08-12');

    // P16: the last AUDUSD close 11 days before b.
    db.delete(seriesCloses).run();
    plantSeriesCloses(db, 'AUDUSD', [['2030-08-01', '0.64']]);
    r = await periods(key);
    expect(fig(r, '1M', exus)).toMatchObject({ status: 'no_start', cents: null });
  });

  it('P6 crypto: the close of a date is the AUD price at 00:00 Melbourne the next day (D142)', async () => {
    const { db, key } = await scene();
    const coin = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'example-coin',
    });
    plantTrade(db, coin, '2030-02-01', '0.5', '90000');
    plantCloses(db, coin, [['2030-08-29', '150000']], 'AUD', 'coingecko');
    plantPrice(db, coin, { price: '164000', asOf: PRICE_AS_OF, source: 'coingecko' });
    const r = await periods(key);
    expect(period(r, '2W').startDate).toBe('2030-08-29');
    expect(fig(r, '2W', coin)).toMatchObject({
      status: 'ok',
      cents: 700000,
      ratio: '0.0933333333333',
      startCloseDate: '2030-08-29',
    });
  });

  it('P7 bullion; P8 a row without a date; P19 a within row of unknown cost; P23 no B', async () => {
    const { db, key } = await scene();
    plantQuote(db, 'XAG_AUD_OZ', { value: '55', asOf: PRICE_AS_OF });
    plantBullion(db, { metal: 'silver', units: '10', unitCost: '40', purchaseDate: '2030-01-20' });
    plantBullion(db, { metal: 'silver', units: '5', unitCost: '52', purchaseDate: '2030-09-02' });
    plantSeriesCloses(db, 'XAG_AUD_OZ', [['2030-08-12', '50']], 'derived');
    let r = await periods(key);
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'ok',
      cents: 6500,
      ratio: '0.0855263157895',
      startClose: '50',
      startUnits: '10',
      newUnits: '5',
    });
    expect(r.holdings[0]!.valueCents).toBe(82500);

    // P8: + 2 oz with no purchase date at 30/oz: start units in every period.
    plantBullion(db, { metal: 'silver', units: '2', unitCost: '30', purchaseDate: null });
    r = await periods(key);
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({ cents: 7500, startUnits: '12' });

    // P19 (on P7's rows): a 1 oz row bought within with no cost counts as a start lot.
    db.delete(otherAssets).run();
    plantBullion(db, { metal: 'silver', units: '10', unitCost: '40', purchaseDate: '2030-01-20' });
    plantBullion(db, { metal: 'silver', units: '5', unitCost: '52', purchaseDate: '2030-09-02' });
    plantBullion(db, { metal: 'silver', units: '1', unitCost: null, purchaseDate: '2030-09-03' });
    r = await periods(key);
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'ok',
      cents: 7000,
      startUnits: '11',
      newUnits: '5',
    });

    // P23: no XAG_AUD_OZ close on or before S within 10 days.
    db.delete(seriesCloses).run();
    plantSeriesCloses(db, 'XAG_AUD_OZ', [['2030-08-01', '50']], 'derived');
    r = await periods(key);
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'no_start',
      cents: 1500,
      newCostCents: 26000,
      startClose: null,
    });
    expect(period(r, '1M').totals).toMatchObject({ missing: 1, partial: true, cents: 1500 });
  });

  it('P9 a fund NAV gap: the last NAV on or before S', async () => {
    const { db, key } = await scene();
    const fund = listing(db, '0PEXAMPLE1', '0PEXAMPLE1', '0PEXAMPLE1', 'managed_fund');
    plantTrade(db, fund, '2030-01-15', '1000', '1.4');
    plantCloses(db, fund, [
      ['2030-09-04', '1.49'],
      ['2030-09-06', '1.5'],
    ]);
    plantPrice(db, fund, { price: '1.515', asOf: '2030-09-11T06:00:00.000Z' });
    const r = await periods(key);
    expect(fig(r, '1W', fund)).toMatchObject({
      status: 'ok',
      cents: 2500,
      startClose: '1.49',
      startCloseDate: '2030-09-04',
    });
  });

  it('P10, P11, P13, P14: a no-start fund with an in-period buy, a flat buy, totals and the line', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40', 1000);
    plantPrice(db, abc, { price: '50.5', asOf: PRICE_AS_OF });
    const mno = listing(db, 'ASX:MNO', 'MNO', 'MNO.AX');
    plantTrade(db, mno, '2030-09-09', '50', '10');
    plantPrice(db, mno, { price: '10.4', asOf: PRICE_AS_OF });
    const fund = plantInstrument(db, {
      kind: 'managed_fund',
      symbol: 'EXAMPLEFUND2',
      code: 'EXAMPLEFUND2',
      provider: 'none',
      providerSymbol: null,
    });
    plantTrade(db, fund, '2030-01-01', '500', '1.8');
    plantTrade(db, fund, '2030-09-09', '100', '2');
    plantManual(db, fund, '2.1', '2030-09-11');
    plantCloses(db, abc, [['2030-09-05', '50']]);

    // P11 (MNO without closes) and P13.
    let r = await periods(key);
    expect(fig(r, '1W', fund)).toMatchObject({
      status: 'no_start',
      cents: 1000,
      newCostCents: 20000,
      ratio: '0.05',
      startUnits: '500',
      newUnits: '100',
      startClose: null,
    });
    expect(fig(r, '1W', mno)).toMatchObject({
      status: 'ok',
      cents: 2000,
      startClose: null,
      line: null,
    });
    expect(period(r, '1W').totals).toMatchObject({
      cents: 8000,
      baseCents: 570000,
      ratio: '0.0140350877193',
      up: 2,
      down: 0,
      missing: 1,
      holdings: 3,
      partial: true,
    });
    expect(r.closesThrough).toBe('2030-09-05');

    // P14: the line.
    plantCloses(db, abc, [
      ['2030-09-06', '50.2'],
      ['2030-09-09', '49.8'],
      ['2030-09-10', '50.1'],
      ['2030-09-11', '50.3'],
    ]);
    plantCloses(db, mno, [
      ['2030-09-09', '10.1'],
      ['2030-09-10', '10.2'],
      ['2030-09-11', '10.3'],
    ]);
    r = await periods(key);
    expect(period(r, '1W').line).toEqual({
      from: '2030-09-05',
      to: '2030-09-12',
      points: [
        ['2030-09-05', 1000],
        ['2030-09-06', 3000],
        ['2030-09-09', -500],
        ['2030-09-10', 3000],
        ['2030-09-11', 5500],
        ['2030-09-12', 8000],
      ],
    });
    expect(fig(r, '1W', abc).line).toEqual({
      base: '50',
      points: [
        ['2030-09-05', '50'],
        ['2030-09-06', '50.2'],
        ['2030-09-09', '49.8'],
        ['2030-09-10', '50.1'],
        ['2030-09-11', '50.3'],
        ['2030-09-12', '50.5'],
      ],
    });
    expect(fig(r, '1W', mno).line?.base).toBe('10');
    // closesThrough: the oldest per-series newest close (the fund has no provider: not a target).
    expect(r.closesThrough).toBe('2030-09-11');
  });

  it('P12 a split inside the period: "split" in 1W–12M, the engine figure under ALL', async () => {
    const { db, key } = await scene();
    const xyz = listing(db, 'ASX:XYZ', 'XYZ', 'XYZ.AX');
    plantTrade(db, xyz, '2030-01-02', '30', '100');
    plantSplit(db, xyz, '2030-09-10');
    plantCloses(db, xyz, [['2030-01-02', '100']]);
    plantPrice(db, xyz, { price: '55', asOf: PRICE_AS_OF });
    const r = await periods(key);
    for (const p of ['1W', '2W', '1M', '3M', '6M', '12M'] as const)
      expect(fig(r, p, xyz), p).toMatchObject({ status: 'split', cents: null });
    expect(fig(r, 'ALL', xyz)).toMatchObject({ status: 'ok', cents: 30 * 55 * 100 - 300000 });
  });

  it('P18 one rounding per holding, totals never rounded separately', async () => {
    const { db, key } = await scene();
    for (const [symbol, code] of [
      ['ASX:ABC', 'ABC'],
      ['ASX:XYZ', 'XYZ'],
      ['ASX:MNO', 'MNO'],
    ] as const) {
      const id = listing(db, symbol, code, `${code}.AX`);
      plantTrade(db, id, '2030-01-10', '1', '9');
      plantCloses(db, id, [['2030-09-05', '10']]);
      plantPrice(db, id, { price: '10.005', asOf: PRICE_AS_OF });
    }
    const r = await periods(key);
    expect(period(r, '1W').figures.map((f) => f.cents)).toEqual([1, 1, 1]);
    expect(period(r, '1W').totals.cents).toBe(3);
  });

  it('P21 units bought after a split are measured; a lot spanning it is "split"', async () => {
    const { db, key } = await scene();
    const mno = listing(db, 'ASX:MNO', 'MNO', 'MNO.AX');
    plantSplit(db, mno, '2030-09-09');
    plantTrade(db, mno, '2030-09-10', '50', '10');
    plantPrice(db, mno, { price: '10.4', asOf: PRICE_AS_OF });
    let r = await periods(key);
    expect(fig(r, '1W', mno)).toMatchObject({ status: 'ok', cents: 2000 });
    plantTrade(db, mno, '2030-09-06', '10', '19');
    r = await periods(key);
    expect(fig(r, '1W', mno)).toMatchObject({ status: 'split', cents: null });
  });

  it('P22 a hand price dated before the start: no figure in 1W, counted in 3M', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40', 1000);
    plantCloses(db, abc, [
      ['2030-06-12', '45'],
      ['2030-09-05', '50'],
    ]);
    plantManual(db, abc, '50.5', '2030-08-01');
    const r = await periods(key);
    // A hand price this old is "stale" (still the holding's price: the hand price wins).
    expect(r.holdings[0]!.priceStatus).toBe('stale');
    expect(r.holdings[0]!.price).toBe('50.5');
    expect(fig(r, '1W', abc)).toMatchObject({ status: 'no_start', cents: null, line: null });
    expect(period(r, '1W').totals).toMatchObject({ cents: null, missing: 1, partial: true });
    expect(fig(r, '3M', abc)).toMatchObject({
      status: 'ok',
      cents: 55000,
      startCloseDate: '2030-06-12',
    });
  });
});

describe('the fixture shapes (§3.6)', () => {
  it('empty: every period null or zero, no figures, the same answer as the fixture', async () => {
    const { key } = await scene();
    const r = await periods(key);
    expect(r.periods).toEqual(mobilePeriods.empty.periods);
    expect(r).toMatchObject({
      holdings: [],
      valueCents: 0,
      closesThrough: null,
      localDate: '2030-09-12',
    });
    expect(Object.keys(r).sort()).toEqual(Object.keys(mobilePeriods.empty).sort());
  });

  it('soldOnly: no held holding, the Sold figure alone under ALL (A2), its line null', async () => {
    const { db, key } = await scene();
    const old = listing(db, 'ASX:OLD', 'OLD', 'OLD.AX');
    plantTrade(db, old, '2030-01-07', '100', '20', 1000);
    plantTrade(db, old, '2030-06-03', '-100', '25', 1000);
    plantCloses(db, old, [['2030-06-03', '25']]);
    const r = await periods(key);
    expect(r.periods).toEqual(mobilePeriods.soldOnly.periods);
    expect(r.holdings).toEqual([]);
  });

  it('noHistory: no closes yet; held-at-start "no_start", bought-within flat, ALL whole, its line null', async () => {
    t = await startMobileApp({ seed: true, now: NOW });
    const db = t.database.db;
    const { key } = await pairPhone(t.app);
    const mno = listing(db, 'ASX:MNO', 'MNO', 'MNO.AX');
    plantTrade(db, mno, '2030-09-10', '50', '10');
    plantPrice(db, mno, { price: '10.4', asOf: PRICE_AS_OF });
    const r = await periods(key);
    expect(r.closesThrough).toBeNull();
    for (const p of r.periods) {
      if (p.period === 'ALL') continue;
      for (const f of p.figures) {
        if (f.key === `i${mno}`) {
          expect(f, p.period).toMatchObject({ status: 'ok', cents: 2000, line: null });
          continue;
        }
        expect(['no_start', 'unpriced'], `${p.period} ${f.key}`).toContain(f.status);
        expect(f.cents, `${p.period} ${f.key}`).toBeNull();
      }
      expect(p.totals).toMatchObject({ cents: 2000, partial: true });
      expect(p.line).toBeNull();
    }
    const all = period(r, 'ALL');
    expect(all.line).toBeNull();
    expect(all.totals.cents).not.toBeNull();
    expect(fig(r, 'ALL', SOLD_HOLDINGS_KEY)).toMatchObject({ status: 'ok', soldCount: 1 });
    // The same field sets as the fixture.
    expect(Object.keys(r).sort()).toEqual(Object.keys(mobilePeriods.noHistory).sort());
  });

  it('every object has the fixtures’ exact field set (open)', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-01-10', '100', '40', 1000);
    // A close on every period's start and one since, so every period draws a line.
    plantCloses(db, abc, [
      ['2030-01-10', '40'],
      ['2030-03-12', '42'],
      ['2030-06-12', '45'],
      ['2030-08-12', '48'],
      ['2030-08-29', '49'],
      ['2030-09-05', '50'],
      ['2030-09-11', '50.3'],
    ]);
    plantPrice(db, abc, { price: '50.5', asOf: PRICE_AS_OF });
    const r = await periods(key);
    const open = mobilePeriods.open;
    const keysOf = (o: object) => Object.keys(o).sort();
    expect(keysOf(r)).toEqual(keysOf(open));
    expect(keysOf(r.holdings[0]!)).toEqual(keysOf(open.holdings[0]!));
    for (const p of r.periods) {
      const fp = open.periods.find((x) => x.period === p.period)!;
      expect(keysOf(p)).toEqual(keysOf(fp));
      expect(keysOf(p.totals)).toEqual(keysOf(fp.totals));
      expect(keysOf(p.line!)).toEqual(keysOf(fp.line!));
      const f = p.figures[0]!;
      expect(keysOf(f)).toEqual(keysOf(fp.figures[0]!));
      expect(keysOf(f.line!)).toEqual(keysOf(fp.figures.find((x) => x.line !== null)!.line!));
    }
  });
});

describe('ALL (§2.3, §2.6)', () => {
  it('a coin held past CoinGecko’s reach is flat in the ALL line; the line ends at the unrealised gain', async () => {
    const { db, key } = await scene();
    const abc = listing(db, 'ASX:ABC', 'ABC', 'ABC.AX');
    plantTrade(db, abc, '2030-02-04', '60', '40', 1000);
    plantCloses(db, abc, [
      ['2030-02-04', '41'],
      ['2030-02-05', '42'],
    ]);
    plantPrice(db, abc, { price: '43', asOf: PRICE_AS_OF });
    const coin = plantInstrument(db, {
      kind: 'crypto',
      symbol: 'BTC',
      code: 'BTC',
      provider: 'coingecko',
      providerSymbol: 'example-coin',
    });
    plantTrade(db, coin, '2029-01-15', '0.5', '60000');
    // Closes only within the keyless API's year: the first is far more than 10 days after the lot.
    const closes: Array<[string, string]> = [];
    for (let d = Date.parse('2029-09-13'); d < Date.parse('2030-09-12'); d += 86_400_000)
      closes.push([new Date(d).toISOString().slice(0, 10), '150000']);
    plantCloses(db, coin, closes, 'AUD', 'coingecko');
    plantPrice(db, coin, { price: '160000', asOf: PRICE_AS_OF, source: 'coingecko' });
    const r = await periods(key);
    const all = period(r, 'ALL');
    expect(fig(r, 'ALL', coin)).toMatchObject({ status: 'ok', line: null });
    expect(fig(r, 'ALL', abc).line).not.toBeNull();
    const coinUnrealised = fig(r, 'ALL', coin).unrealisedCents!;
    expect(coinUnrealised).toBe(0.5 * (160000 - 60000) * 100);
    // A9's points (ABC: 5000 at 04/02, 11000 at 05/02, then 17000 less the fee) + the coin flat.
    const fee = 1000;
    expect(all.line!.points[0]).toEqual(['2030-02-04', 6000 - fee + coinUnrealised]);
    expect(all.line!.points.at(-1)).toEqual(['2030-09-12', all.totals.unrealisedCents]);
    expect(all.totals.unrealisedCents).toBe(60 * 300 - fee + coinUnrealised);
    // The coin's own 12M figure has no start close (none on or before 12/09/2029 within 10 days).
    expect(fig(r, '12M', coin).status).toBe('no_start');
  });
});

describe('the key check on /periods (§4.1)', () => {
  it('missing → MISSING; invalid → INVALID; revoked → REVOKED; HEAD 200; read-only', async () => {
    const { key, app } = await scene();
    const get = (headers: Record<string, string>) =>
      app.app.inject({ method: 'GET', url: '/api/mobile/periods', headers });
    let res = await get({});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(mobileApiErrors.deviceKeyMissing);
    res = await get({ authorization: 'Bearer short' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(mobileApiErrors.deviceKeyInvalid);
    expect((await get(bearer(key))).statusCode).toBe(200);
    expect((await get(bearer(key))).headers['cache-control']).toBe('no-store');
    const head = await app.app.inject({
      method: 'HEAD',
      url: '/api/mobile/periods',
      headers: bearer(key),
    });
    expect(head.statusCode).toBe(200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const ro = await app.app.inject({ method, url: '/api/mobile/periods' });
      expect(ro.statusCode, method).toBe(405);
      expect(ro.json()).toEqual(mobileApiErrors.mobileReadOnly);
    }
    const devices = (await app.app.inject({ method: 'GET', url: '/api/phone' })).json<{
      devices: { id: string }[];
    }>();
    await app.app.inject({
      method: 'POST',
      url: `/api/phone/devices/${devices.devices[0]!.id}/revoke`,
    });
    res = await get(bearer(key));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(mobileApiErrors.deviceKeyRevoked);
  });

  it('leaks: no key, key hash or code in the log or any body of /periods', async () => {
    const lines: string[] = [];
    t = await startMobileApp({ seed: true, now: NOW });
    await t.restart({
      config: { ...t.config, logLevel: 'info' },
      logStream: { write: (line: string) => void lines.push(line) },
    });
    const { key } = await pairPhone(t.app);
    const bodies: string[] = [];
    for (const headers of [
      bearer(key),
      { authorization: `Bearer ${key}x` },
      { authorization: `Bearer ${key}`, 'x-joinr-key': `${key.slice(0, -1)}A` },
    ]) {
      bodies.push(
        (await t.app.inject({ method: 'GET', url: '/api/mobile/periods', headers })).body,
      );
      bodies.push(
        (
          await t.app.inject({
            method: 'POST',
            url: '/api/mobile/periods',
            headers,
            payload: { key },
          })
        ).body,
      );
    }
    const hash = sha256Hex(key);
    const log = lines.join('\n');
    expect(log).toContain('/api/mobile/periods');
    for (const needle of [key, hash, 'jfk_']) {
      expect(log.includes(needle), 'log').toBe(false);
      for (const body of bodies) expect(body.includes(needle), 'body').toBe(false);
    }
    expect(log).not.toMatch(/authorization|x-joinr-key/i);
    expect(JSON.parse(bodies[0]!) as MobilePeriodsResponse).toMatchObject({ apiVersion: 1 });
  });
});
