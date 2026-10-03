// Equality of /api/mobile/periods with the web and with Stage 9 (stage-10.md §6.5, the acceptance),
// and the budgets (§6.4 step 5, §4.1). The synthetic seed (its sold `ASX:OLD` included) plus a
// made-up `NYSE:EXUS` (USD) with `AUDUSD` closes, a `0PEXAMPLE1` fund, a partial sell of a held
// instrument, a sold gold row and a partly sold silver row, with planted prices and closes, all from
// ONE app instance and clock:
// - ALL: each held holding = its web unrealised + realised; each bullion holding = its metal's held
//   rows' gains + all its rows' realised; the Sold figure = the web's non-held realised + the metals
//   no longer held; the ALL total = the pages' sums;
// - values and units equal /today's; /today is byte-identical with and without stored closes;
// - cash accounts and a hand-priced other asset change nothing.
// Then a synthetic 30-holding dataset with three years of closes: the answer in < 2 s and under
// PERIODS_ANSWER_BUDGET_BYTES. Made-up symbols, coin ids and round amounts only.
process.env.TZ = 'Australia/Melbourne';

import {
  INSTRUMENT_KINDS,
  JoinrDecimal,
  PERIODS_ANSWER_BUDGET_BYTES,
  SOLD_HOLDINGS_KEY,
  type InvestmentPageResponse,
  type MobilePeriodsResponse,
  type OtherAssetsPageResponse,
} from '@joinr/schema';
import { cashAccounts, instruments, otherAssets, prices, trades } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bearer,
  getPeriods,
  pairPhone,
  plantAssetSale,
  plantBullion,
  plantCloses,
  plantInstrument,
  plantPrice,
  plantSeriesCloses,
  plantTrade,
  startMobileApp,
  type MobileApp,
} from './helpers';

const NOW = '2030-09-12T05:20:00.000Z';
const D = (v: string | number) => new JoinrDecimal(v);

let t: MobileApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Weekday dates from `from` to `to` inclusive. */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 86_400_000) {
    const d = new Date(ms);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe('equality with the web and with Stage 9 (§6.5)', () => {
  it('ALL equals the investment and Other Assets pages; values equal /today; cash changes nothing', async () => {
    t = await startMobileApp({ seed: true, now: NOW });
    const db = t.database.db;
    const idOf = (symbol: string) =>
      db.select().from(instruments).where(eq(instruments.symbol, symbol)).get()!.id;
    const abc = idOf('ASX:ABC');
    const def = idOf('ASX:DEF');

    // A partial sell of a held instrument (FIFO from the 2025 lot) and a price for the seed's
    // failed listing (so no held holding is unpriced: §6.5).
    plantTrade(db, abc, '2025-08-01', '-30', '13', 1000);
    db.delete(prices).where(eq(prices.instrumentId, def)).run();
    plantPrice(db, def, { price: '55', asOf: '2030-09-12T00:00:00.000Z' });
    // NYSE:EXUS in USD.
    const exus = plantInstrument(db, {
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      code: 'EXUS',
      provider: 'yahoo',
      providerSymbol: 'EXUS',
    });
    plantTrade(db, exus, '2030-01-10', '20', '140', 1000);
    plantPrice(db, exus, {
      price: D(101).div('0.65').toDecimalPlaces(12).toFixed(),
      nativePrice: '101',
      nativeCurrency: 'USD',
      fxRate: D(1).div('0.65').toDecimalPlaces(12).toFixed(),
      asOf: '2030-09-11T20:00:00.000Z',
    });
    // A Yahoo-priced fund.
    const fund = plantInstrument(db, {
      kind: 'managed_fund',
      symbol: '0PEXAMPLE1',
      code: '0PEXAMPLE1',
      provider: 'yahoo',
      providerSymbol: '0PEXAMPLE1',
    });
    plantTrade(db, fund, '2030-01-10', '1000', '1.4');
    plantPrice(db, fund, { price: '1.515', asOf: '2030-09-11T06:00:00.000Z' });
    // A sold gold row and a partly sold silver row (the seed's).
    const gold = plantBullion(db, {
      metal: 'gold',
      units: '1',
      unitCost: '3000',
      purchaseDate: '2029-01-01',
    });
    plantAssetSale(db, gold, '2030-03-01', '1', 310000);
    const silver = db.select().from(otherAssets).where(eq(otherAssets.metal, 'silver')).get()!.id;
    plantAssetSale(db, silver, '2030-04-01', '3', 15000);

    const { key } = await pairPhone(t.app);
    const todayBefore = (
      await t.app.inject({ method: 'GET', url: '/api/mobile/today', headers: bearer(key) })
    ).body;

    // The closes: every listing and the fund on the 1W–12M starts and since, AUDUSD, the spot.
    const days = weekdays('2029-08-20', '2030-09-11');
    plantCloses(
      db,
      abc,
      days.map((d, i) => [d, String(11 + (i % 7) / 10)] as const),
    );
    plantCloses(
      db,
      exus,
      days.filter((d) => d >= '2030-01-01').map((d, i) => [d, String(95 + (i % 5))] as const),
      'USD',
    );
    plantCloses(
      db,
      fund,
      days.filter((d) => d >= '2030-01-01').map((d) => [d, '1.45'] as const),
    );
    plantSeriesCloses(
      db,
      'AUDUSD',
      days.map((d) => [d, '0.64'] as const),
    );
    plantSeriesCloses(
      db,
      'XAG_AUD_OZ',
      days.map((d) => [d, '45'] as const),
      'derived',
    );

    const r = await getPeriods(t.app, key);
    const todayAfter = (
      await t.app.inject({ method: 'GET', url: '/api/mobile/today', headers: bearer(key) })
    ).body;
    // 1D unchanged: /today byte-identical with and without stored closes.
    expect(todayAfter).toBe(todayBefore);
    const today = JSON.parse(todayAfter) as {
      totals: { valueCents: number };
      holdings: { key: string; valueCents: number | null; units: string }[];
    };

    // Values: every holding, in /today's order, with /today's value and units.
    expect(r.holdings.map((h) => h.key)).toEqual(today.holdings.map((h) => h.key));
    for (const h of r.holdings) {
      const m = today.holdings.find((x) => x.key === h.key)!;
      expect(h.valueCents, h.key).toBe(m.valueCents);
      expect(h.units, h.key).toBe(m.units);
    }
    expect(r.valueCents).toBe(today.totals.valueCents);

    const all = r.periods.find((p) => p.period === 'ALL')!;
    const figure = (key: string) => all.figures.find((f) => f.key === key)!;
    let sold = 0;
    let total = 0;
    let soldCount = 0;
    for (const kind of INSTRUMENT_KINDS) {
      const page = (
        await t.app.inject({ method: 'GET', url: `/api/investments/${kind}` })
      ).json<InvestmentPageResponse>();
      total += page.summary.unrealisedCents + page.summary.realisedCents;
      for (const h of page.holdings) {
        if (h.status !== 'held') {
          sold += h.realisedCents;
          if (h.status === 'exited') soldCount += 1; // not held, with lots
          continue;
        }
        const f = figure(`i${h.instrumentId}`);
        expect(f.status, h.symbol).toBe('ok');
        expect(f.cents, h.symbol).toBe(h.unrealisedCents! + h.realisedCents);
        expect(f.unrealisedCents, h.symbol).toBe(h.unrealisedCents);
        expect(f.realisedCents, h.symbol).toBe(h.realisedCents);
      }
    }
    // The partial sell shows on ABC's own card (D162).
    expect(figure(`i${abc}`).realisedCents).not.toBe(0);

    const other = (
      await t.app.inject({ method: 'GET', url: '/api/other-assets' })
    ).json<OtherAssetsPageResponse>();
    for (const metal of ['silver', 'gold'] as const) {
      const rows = other.assets.filter(
        (a) => a.priceSource === 'bullion' && (a.metal ?? 'silver') === metal,
      );
      const heldRows = rows.filter((a) => D(a.remainingUnits).greaterThan(0));
      const realised = rows.reduce((s, a) => s + a.realisedCents, 0);
      const gains = heldRows.reduce((s, a) => s + a.gainCents!, 0);
      total += gains + realised;
      if (heldRows.length === 0) {
        sold += realised;
        soldCount += 1;
        expect(all.figures.some((f) => f.key === `bullion-${metal}`)).toBe(false);
      } else {
        expect(figure(`bullion-${metal}`).cents, metal).toBe(gains + realised);
        expect(figure(`bullion-${metal}`).realisedCents, metal).toBe(realised);
      }
    }
    expect(soldCount).toBe(2); // ASX:OLD and the gold no longer held
    expect(figure(SOLD_HOLDINGS_KEY)).toMatchObject({ cents: sold, soldCount: 2 });
    expect(all.totals.cents).toBe(total);
    expect(all.totals).toMatchObject({ missing: 0, partial: false });
    expect(all.totals.unrealisedCents! + all.totals.realisedCents!).toBe(total);
    // The ALL line ends at the held holdings' unrealised gain (D167).
    expect(all.line).not.toBeNull();
    expect(all.line!.points.at(-1)).toEqual([r.localDate, all.totals.unrealisedCents]);
    // No ALL point on OLD's or the gold row's sale date unless a drawn holding has a close then.
    expect(all.line!.points.some(([d]) => d === '2030-03-01')).toBe(false);

    // The 1W–12M figures: EXUS and the fund are measured from their closes.
    for (const p of r.periods.filter((x) => x.period !== 'ALL')) {
      expect(p.figures.find((f) => f.key === `i${exus}`)!.status, p.period).toBe('ok');
      expect(p.figures.find((f) => f.key === `i${fund}`)!.status, p.period).toBe('ok');
      expect(p.line!.points.at(-1)).toEqual([r.localDate, p.totals.cents]);
    }
    expect(r.closesThrough).toBe('2030-09-11');

    // Cash and the hand-priced other asset change nothing.
    const before = JSON.stringify(r);
    db.update(cashAccounts).set({ balanceCents: 123456789 }).run();
    db.update(otherAssets)
      .set({ unitPrice: '99999' })
      .where(eq(otherAssets.priceSource, 'manual'))
      .run();
    expect(JSON.stringify(await getPeriods(t.app, key))).toBe(before);
  });
});

describe('budgets (§6.4 step 5, §4.1)', () => {
  it('30 holdings × 3 years of closes: answered in < 2 s and under the size budget', async () => {
    t = await startMobileApp({ seed: false, now: NOW });
    const db = t.database.db;
    const days = weekdays('2027-09-01', '2030-09-11');
    const ids: number[] = [];
    for (let n = 1; n <= 30; n += 1) {
      const code = `H${String(n).padStart(2, '0')}`;
      const id = plantInstrument(db, {
        kind: n % 3 === 0 ? 'etf' : 'stock',
        symbol: `SYNTH:${code}`,
        code,
        provider: 'yahoo',
        providerSymbol: `${code}.SYNTH`,
      });
      ids.push(id);
      plantTrade(db, id, '2027-09-15', '100', String(10 + n), 1000);
      plantTrade(db, id, '2029-03-01', '50', String(12 + n), 1000);
      plantTrade(db, id, '2030-09-09', '10', String(14 + n), 1000);
      plantPrice(db, id, { price: String(15 + n), asOf: '2030-09-12T00:00:00.000Z' });
    }
    db.transaction((tx) => {
      ids.forEach((id, n) =>
        plantCloses(
          tx,
          id,
          days.map((d, i) => [d, String(10 + n + (i % 50) / 10)] as const),
        ),
      );
    });
    const { key } = await pairPhone(t.app);
    await getPeriods(t.app, key); // warm-up (module and statement caches)
    const started = performance.now();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/mobile/periods',
      headers: bearer(key),
    });
    const elapsed = performance.now() - started;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(2000);
    expect(Buffer.byteLength(res.body)).toBeLessThan(PERIODS_ANSWER_BUDGET_BYTES);
    const r = res.json<MobilePeriodsResponse>();
    expect(r.holdings).toHaveLength(30);
    expect(r.periods.every((p) => p.line !== null)).toBe(true);
    expect(db.select().from(trades).all()).toHaveLength(90);
  }, 60_000);
});
