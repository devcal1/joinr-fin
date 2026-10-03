// Stage 10 closes targets and the derived spot (stage-10.md §5.1, §5.5): held instruments only,
// hand-priced none (a hand price over a provider still counts), crypto's needFrom capped at 364
// days, the FX and futures series 10 days before their dependants, undated bullion 380 days back;
// backfill, top-up or skip; the derived AUD spot on weekdays with the 10-day staleness, never over a
// `midnight` row; the midnight capture. The generic seed (made-up values), an in-memory database.
process.env.TZ = 'Australia/Melbourne';

import {
  otherAssets,
  prices,
  priceSources,
  seriesCloses,
  seriesDayQuotes,
  trades,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureMidnight,
  deriveSpotCloses,
  writeDerivedSpot,
} from '../../src/market/closes/derive';
import {
  ClosesMemory,
  instrumentCloseTargets,
  instrumentCoveredFrom,
  metalCloseNeeds,
  planTarget,
  seriesCloseTargets,
} from '../../src/market/closes/targets';

it('runs with the process in Melbourne time (the TZ line above)', () => {
  expect(new Date(2030, 8, 12).toISOString()).toBe('2030-09-11T14:00:00.000Z');
});

const LOCAL = '2030-09-12';
const open: TestDb[] = [];
afterEach(() => {
  for (const t of open.splice(0)) t.close();
});

function seeded() {
  const t = createTestDb();
  open.push(t);
  const { instrumentIds: ids } = seedGenericData(t.db, { now: new Date('2030-09-12T06:52:00Z') });
  return { t, ids };
}

describe('instrument targets (§5.1)', () => {
  it('held Yahoo and CoinGecko instruments only; hand-priced (provider none) and sold ones never', () => {
    const { t } = seeded();
    const targets = instrumentCloseTargets(t.db, LOCAL);
    expect(targets.map((x) => [x.symbol, x.provider, x.providerSymbol, x.needFrom])).toEqual([
      ['ASX:ABC', 'yahoo', 'ABC.AX', '2025-01-05'],
      ['ASX:XYZ', 'yahoo', 'XYZ.AX', '2024-06-21'],
      ['ASX:DEF', 'yahoo', 'DEF.AX', '2025-05-10'],
      // Crypto: never more than 364 days back (the keyless reach).
      ['BTC', 'coingecko', 'bitcoin', '2029-09-13'],
      ['ETH', 'coingecko', 'ethereum', '2029-09-13'],
    ]);
  });

  it('a hand price over a provider keeps the provider target; a coin held for weeks starts 10 days before', () => {
    const { t, ids } = seeded();
    t.db
      .update(priceSources)
      .set({ manualPrice: '13', manualPriceAsOf: '2030-09-10', manualOrigin: 'user' })
      .where(eq(priceSources.instrumentId, ids['ASX:ABC']!))
      .run();
    t.db
      .update(trades)
      .set({ tradeDate: '2030-08-20' })
      .where(eq(trades.instrumentId, ids.BTC!))
      .run();
    const targets = instrumentCloseTargets(t.db, LOCAL);
    expect(targets.find((x) => x.symbol === 'ASX:ABC')).toBeDefined();
    expect(targets.find((x) => x.symbol === 'BTC')!.needFrom).toBe('2030-08-10');
  });
});

describe('series targets (§5.1)', () => {
  it('AUDUSD and the futures for held bullion, 10 days before the rows’ needFrom', () => {
    const { t } = seeded();
    const metals = metalCloseNeeds(t.db, LOCAL);
    expect(metals).toEqual([
      {
        metal: 'silver',
        futuresSeries: 'SI_USD_OZ',
        spotSeries: 'XAG_AUD_OZ',
        needFrom: '2024-01-22',
      },
    ]);
    const series = seriesCloseTargets(instrumentCloseTargets(t.db, LOCAL), metals);
    expect(series.map((s) => [s.seriesId, s.yahooSymbol, s.needFrom, s.coveredFrom])).toEqual([
      ['AUDUSD', 'AUDUSD=X', '2024-01-12', '2024-01-22'],
      ['SI_USD_OZ', 'SI=F', '2024-01-12', '2024-01-22'],
    ]);
  });

  it('USD → AUDUSD, GBp → FX_GBPAUD, from 10 days before the instrument’s needFrom', () => {
    const { t, ids } = seeded();
    t.db
      .update(otherAssets)
      .set({ soldUnits: '10' })
      .where(eq(otherAssets.priceSource, 'bullion'))
      .run();
    t.db
      .update(prices)
      .set({ nativeCurrency: 'USD' })
      .where(eq(prices.instrumentId, ids['ASX:XYZ']!))
      .run();
    t.db
      .update(prices)
      .set({ nativeCurrency: 'GBp' })
      .where(eq(prices.instrumentId, ids['ASX:ABC']!))
      .run();
    const metals = metalCloseNeeds(t.db, LOCAL);
    expect(metals).toEqual([]);
    const series = seriesCloseTargets(instrumentCloseTargets(t.db, LOCAL), metals);
    expect(series.map((s) => [s.seriesId, s.yahooSymbol, s.needFrom])).toEqual([
      ['FX_GBPAUD', 'GBPAUD=X', '2024-12-26'],
      ['AUDUSD', 'AUDUSD=X', '2024-06-11'],
    ]);
  });

  it('an undated held bullion row reaches 380 days back; a gold row adds GC_USD_OZ', () => {
    const { t } = seeded();
    t.db
      .update(otherAssets)
      .set({ purchaseDate: null })
      .where(eq(otherAssets.priceSource, 'bullion'))
      .run();
    t.db
      .insert(otherAssets)
      .values({
        description: 'Gold coin',
        purchaseDate: '2030-06-03',
        units: '1',
        soldUnits: '0',
        currency: 'AUD',
        unitCost: '3000',
        priceSource: 'bullion',
        metal: 'gold',
        unitOfMeasure: 'oz',
        ozPerUnit: '1',
        sortOrder: 9,
        origin: 'app',
      })
      .run();
    const metals = metalCloseNeeds(t.db, LOCAL);
    expect(metals.map((m) => [m.metal, m.needFrom])).toEqual([
      ['silver', '2029-08-28'],
      ['gold', '2030-05-24'],
    ]);
    expect(seriesCloseTargets([], metals).map((s) => [s.seriesId, s.needFrom])).toEqual([
      ['AUDUSD', '2029-08-18'],
      ['SI_USD_OZ', '2029-08-18'],
      ['GC_USD_OZ', '2030-05-14'],
    ]);
  });
});

describe('backfill, top-up or skip (§5.1)', () => {
  const stored = (earliest: string, latest = '2030-09-11') => ({ earliest, latest });

  it('no rows → backfill; no rows and tried today → skip', () => {
    expect(
      planTarget({ stored: null, coveredFrom: '2030-01-10', triedToday: false, complete: false }),
    ).toBe('backfill');
    expect(
      planTarget({ stored: null, coveredFrom: '2030-01-10', triedToday: true, complete: false }),
    ).toBe('skip');
  });

  it('earliest after coveredFrom → backfill once a day, never after a successful one', () => {
    const base = { stored: stored('2030-02-03'), coveredFrom: '2030-01-10' };
    expect(planTarget({ ...base, triedToday: false, complete: false })).toBe('backfill');
    expect(planTarget({ ...base, triedToday: true, complete: false })).toBe('topup');
    expect(planTarget({ ...base, triedToday: false, complete: true })).toBe('topup');
    expect(
      planTarget({
        stored: stored('2030-01-10'),
        coveredFrom: '2030-01-10',
        triedToday: false,
        complete: false,
      }),
    ).toBe('topup');
  });

  it('a listing younger than the lot: coveredFrom is its listing date (then a top-up)', () => {
    const { t } = seeded();
    const abc = instrumentCloseTargets(t.db, LOCAL).find((x) => x.symbol === 'ASX:ABC')!;
    const memory = new ClosesMemory();
    expect(instrumentCoveredFrom(abc, memory, LOCAL)).toBe('2025-01-15');
    memory.setFirstTradeDate(abc.key, '2025-03-03');
    const coveredFrom = instrumentCoveredFrom(abc, memory, LOCAL);
    expect(coveredFrom).toBe('2025-03-03');
    expect(
      planTarget({ stored: stored('2025-03-03'), coveredFrom, triedToday: false, complete: false }),
    ).toBe('topup');
    // A coin: max(earliest trade, localDate − 364).
    const btc = instrumentCloseTargets(t.db, LOCAL).find((x) => x.symbol === 'BTC')!;
    expect(instrumentCoveredFrom(btc, memory, LOCAL)).toBe('2029-09-13');
  });

  it('a coin more than 87 days behind takes the backfill path (once a day)', () => {
    const base = { coveredFrom: '2029-09-13', complete: true, coinLocalDate: LOCAL };
    expect(
      planTarget({ ...base, stored: stored('2029-09-12', '2030-06-16'), triedToday: false }),
    ).toBe('backfill');
    expect(
      planTarget({ ...base, stored: stored('2029-09-12', '2030-06-16'), triedToday: true }),
    ).toBe('topup');
    expect(
      planTarget({ ...base, stored: stored('2029-09-12', '2030-06-17'), triedToday: false }),
    ).toBe('topup');
  });

  it('ClosesMemory remembers tries per server-local date', () => {
    const m = new ClosesMemory();
    m.markTried('k', '2030-09-12');
    expect(m.triedOn('k', '2030-09-12')).toBe(true);
    expect(m.triedOn('k', '2030-09-13')).toBe(false);
  });
});

describe('the derived AUD spot (§5.5)', () => {
  it('weekdays only; F ÷ X with each at most 10 days old', () => {
    const futures: Array<[string, string]> = [
      ['2030-08-29', '32.5'], // Thu
      ['2030-09-02', '33'], // Mon
    ];
    const audUsd: Array<[string, string]> = [
      ['2030-08-30', '0.65'], // Fri
      ['2030-09-03', '0.66'], // Tue
    ];
    expect(deriveSpotCloses(futures, audUsd, '2030-08-29', '2030-09-13')).toEqual([
      // 29/08: no AUDUSD on or before it.
      ['2030-08-30', '50'], // 32.5 ÷ 0.65
      ['2030-09-02', '50.769230769231'], // 33 ÷ 0.65 (Mon; the weekend skipped)
      ['2030-09-03', '50'], // 33 ÷ 0.66
      ['2030-09-04', '50'],
      ['2030-09-05', '50'],
      ['2030-09-06', '50'],
      ['2030-09-09', '50'],
      ['2030-09-10', '50'],
      ['2030-09-11', '50'],
      ['2030-09-12', '50'], // F is 10 days old: still used
      // 13/09: F is 11 days old → no value.
    ]);
  });

  it('never replaces a midnight row; the capture writes the 00:00 base as the close of yesterday', () => {
    const t = createTestDb();
    open.push(t);
    const at = '2030-09-12T06:52:00.000Z';
    t.db
      .insert(seriesCloses)
      .values({
        seriesId: 'XAG_AUD_OZ',
        date: '2030-09-10',
        value: '51.2',
        source: 'midnight',
        fetchedAt: at,
      })
      .run();
    const n = t.db.transaction((tx) =>
      writeDerivedSpot(
        tx,
        'XAG_AUD_OZ',
        [
          ['2030-09-09', '50'],
          ['2030-09-10', '50.5'],
          ['2030-09-11', '50.7'],
        ],
        at,
      ),
    );
    expect(n).toBe(2);
    const rows = () =>
      t.db
        .select({ date: seriesCloses.date, value: seriesCloses.value, source: seriesCloses.source })
        .from(seriesCloses)
        .where(eq(seriesCloses.seriesId, 'XAG_AUD_OZ'))
        .orderBy(seriesCloses.date)
        .all();
    expect(rows()).toEqual([
      { date: '2030-09-09', value: '50', source: 'derived' },
      { date: '2030-09-10', value: '51.2', source: 'midnight' },
      { date: '2030-09-11', value: '50.7', source: 'derived' },
    ]);
    // Unchanged derived rows are not rewritten.
    expect(
      t.db.transaction((tx) => writeDerivedSpot(tx, 'XAG_AUD_OZ', [['2030-09-09', '50']], at)),
    ).toBe(0);
    // The midnight capture: series_day_quotes for session 12/09 carries the 00:00 spot.
    t.db
      .insert(seriesDayQuotes)
      .values({
        seriesId: 'XAG_AUD_OZ',
        sessionDate: '2030-09-12',
        timeZone: 'Australia/Melbourne',
        granularity: '5m',
        nativeCurrency: 'AUD',
        previousClose: '51.9',
        points: '[]',
        source: 'yahoo',
        fetchedAt: at,
      })
      .run();
    expect(t.db.transaction((tx) => captureMidnight(tx, 'XAG_AUD_OZ', '2030-09-12', at))).toBe(1);
    expect(rows().at(-1)).toEqual({ date: '2030-09-11', value: '51.9', source: 'midnight' });
    // A day row from another session (or none) captures nothing.
    expect(t.db.transaction((tx) => captureMidnight(tx, 'XAG_AUD_OZ', '2030-09-13', at))).toBe(0);
    expect(t.db.transaction((tx) => captureMidnight(tx, 'XAU_AUD_OZ', '2030-09-12', at))).toBe(0);
    // And a later derived write leaves the captured row alone.
    t.db.transaction((tx) => writeDerivedSpot(tx, 'XAG_AUD_OZ', [['2030-09-11', '49']], at));
    expect(
      t.db
        .select({ source: seriesCloses.source })
        .from(seriesCloses)
        .where(and(eq(seriesCloses.seriesId, 'XAG_AUD_OZ'), eq(seriesCloses.date, '2030-09-11')))
        .get(),
    ).toEqual({ source: 'midnight' });
  });
});
