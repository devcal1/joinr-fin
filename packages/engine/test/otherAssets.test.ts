// Other assets (stage-4.md §2.4; §7.3 step 1): units after legacy and recorded sales, every pricing
// and status branch, FX at purchase and today, gain and CAGR from unrounded values, sales, the
// savings flows, the totals, the cost-held line and the chart. Generic, round figures only.
import { describe, expect, it } from 'vitest';
import {
  computeOtherAssets,
  otherAssetsCostHeldAt,
  type EngineOtherAsset,
  type OtherAssetsInput,
} from '../src/index';
import { cents, D, ratio } from './helpers';

const AS_OF = '2026-09-24';

function asset(id: number, over: Partial<EngineOtherAsset> = {}): EngineOtherAsset {
  return {
    id,
    purchaseDate: '2024-09-24',
    units: '1',
    legacySoldUnits: '0',
    unitCost: '100',
    currency: 'AUD',
    purchaseFxRate: null,
    pricing: { source: 'manual', unitPrice: '120', priceAsOf: '2026-09-01' },
    sales: [],
    ...over,
  };
}

function input(assets: EngineOtherAsset[], over: Partial<OtherAssetsInput> = {}): OtherAssetsInput {
  return {
    asOf: AS_OF,
    assets,
    fxRates: { USD: '1.52', GBX: '0.0195' },
    assumedDate: '2026-03-31',
    stalePriceDays: 90,
    snapshots: [],
    chart: { unit: 'monthly', count: null },
    ...over,
  };
}

const one = (a: EngineOtherAsset, over: Partial<OtherAssetsInput> = {}) =>
  computeOtherAssets(input([a], over)).assets[0]!;

/** The sheet's RRI(n, pv, fv) = (fv ÷ pv)^(1 ÷ n) − 1 (a float, as the sheet computes it). */
const rri = (years: number, pv: number, fv: number) => Math.pow(fv / pv, 1 / years) - 1;

describe('computeOtherAssets: units (§2.4 steps 1–2)', () => {
  it('takes the workbook sold units and the recorded sales off the units bought', () => {
    const r = one(
      asset(1, {
        units: '5',
        legacySoldUnits: '1',
        sales: [{ id: 1, saleDate: '2026-05-01', units: '1', proceedsCents: 15_000 }],
      }),
    );
    expect(r.remainingUnits).toBe('3');
    expect(r.costCents).toBe(30_000);
    expect(r.valueCents).toBe(36_000);
    expect(r.flags).toEqual(['legacy_sold']);
  });

  it('never goes below 0 units: an oversold item keeps only its sales', () => {
    const r = one(
      asset(1, {
        units: '2',
        legacySoldUnits: '1',
        sales: [{ id: 1, saleDate: '2026-05-01', units: '2', proceedsCents: 30_000 }],
      }),
    );
    expect(r).toMatchObject({
      remainingUnits: '0',
      costCents: null,
      valueCents: null,
      gainCents: null,
      gainRatio: null,
      cagrRatio: null,
      realisedCents: 10_000,
    });
    expect(r.flags).toEqual(['legacy_sold', 'oversold']);
    expect(r.sales).toEqual([
      {
        id: 1,
        saleDate: '2026-05-01',
        units: '2',
        proceedsCents: 30_000,
        costCents: 20_000,
        realisedCents: 10_000,
      },
    ]);
  });

  it('leaves a sold-out item without figures but with its sales', () => {
    const r = one(
      asset(1, {
        units: '1',
        sales: [{ id: 3, saleDate: '2026-06-01', units: '1', proceedsCents: 9_000 }],
      }),
    );
    expect(r).toMatchObject({
      remainingUnits: '0',
      costCents: null,
      valueCents: null,
      realisedCents: -1_000,
    });
    expect(r.flags).toEqual([]);
  });
});

describe('computeOtherAssets: pricing and status (§2.4 step 5)', () => {
  it('keeps a hand price current for the stale-days setting and marks it stale after', () => {
    const at = (priceAsOf: string | null) =>
      one(asset(1, { pricing: { source: 'manual', unitPrice: '120', priceAsOf } }));
    expect(at('2026-06-26')).toMatchObject({
      priceStatus: 'manual',
      priceAsOf: '2026-06-26',
      flags: [],
    }); // 90 days
    expect(at('2026-06-25')).toMatchObject({ priceStatus: 'stale', flags: ['stale_price'] }); // 91 days
    expect(at('2026-09-25')).toMatchObject({ priceStatus: 'manual' }); // an entry dated tomorrow
    expect(at(null)).toMatchObject({ priceStatus: 'stale', priceAsOf: null, valueCents: 12_000 });
    const custom = computeOtherAssets(
      input(
        [asset(1, { pricing: { source: 'manual', unitPrice: '120', priceAsOf: '2026-09-10' } })],
        {
          stalePriceDays: 7,
        },
      ),
    );
    expect(custom.assets[0]!.priceStatus).toBe('stale');
  });

  it('leaves a hand-priced item without a price unpriced', () => {
    const r = one(asset(1, { pricing: { source: 'manual', unitPrice: null, priceAsOf: null } }));
    expect(r).toMatchObject({
      priceStatus: 'none',
      unitPriceAud: null,
      valueCents: null,
      gainCents: null,
      priceAsOf: null,
    });
    expect(r.costCents).toBe(10_000);
    expect(r.flags).toEqual(['unpriced']);
  });

  it('prices bullion from spot × oz per unit, fresh or stale', () => {
    const bullion = (
      spot: { audPerOz: string; asOf: string; fresh: boolean } | null,
      fallback: string | null,
    ) =>
      one(
        asset(1, {
          units: '10',
          unitCost: '90',
          pricing: {
            source: 'bullion',
            metal: 'silver',
            ozPerUnit: '2',
            spot,
            fallbackUnitPrice: fallback,
            fallbackAsOf: fallback === null ? null : '2026-08-31',
          },
        }),
      );
    expect(bullion({ audPerOz: '50', asOf: '2026-09-24', fresh: true }, '95')).toMatchObject({
      unitPriceAud: '100',
      valueCents: 100_000,
      costCents: 90_000,
      gainCents: 10_000,
      priceStatus: 'fresh',
      priceAsOf: '2026-09-24',
      flags: [],
    });
    expect(bullion({ audPerOz: '50', asOf: '2026-09-21', fresh: false }, '95')).toMatchObject({
      priceStatus: 'stale',
      priceAsOf: '2026-09-21',
      flags: ['stale_price'],
    });
    expect(bullion(null, '95')).toMatchObject({
      unitPriceAud: '95',
      valueCents: 95_000,
      priceStatus: 'stale',
      priceAsOf: '2026-08-31',
      flags: ['stale_price', 'spot_unavailable'],
    });
    expect(bullion(null, null)).toMatchObject({
      unitPriceAud: null,
      valueCents: null,
      priceStatus: 'none',
      priceAsOf: null,
      flags: ['unpriced'],
    });
  });
});

describe('computeOtherAssets: FX (§2.4 steps 3–5)', () => {
  const usd = asset(1, {
    units: '2',
    currency: 'USD',
    unitCost: '400',
    purchaseFxRate: '1.5',
    pricing: { source: 'manual', unitPrice: '450', priceAsOf: '2026-09-01' },
  });
  const gbx = asset(2, {
    units: '100',
    currency: 'GBX',
    unitCost: '150',
    purchaseFxRate: '0.019',
    pricing: { source: 'manual', unitPrice: '180', priceAsOf: '2026-09-01' },
  });

  it('costs at the purchase-date rate and values at today’s rate (USD and UK pence)', () => {
    const r = computeOtherAssets(input([usd, gbx])).assets;
    expect(r[0]).toMatchObject({
      costCents: 120_000,
      unitPriceAud: '684',
      valueCents: 136_800,
      gainCents: 16_800,
    });
    expect(r[1]).toMatchObject({
      costCents: 28_500,
      unitPriceAud: '3.51',
      valueCents: 35_100,
      gainCents: 6_600,
    });
  });

  it('flags a missing live rate (value unknown) and keeps the purchase flow', () => {
    const eur = asset(3, { currency: 'EUR', purchaseFxRate: '1.6', purchaseDate: '2026-05-10' });
    const r = computeOtherAssets(input([eur]));
    expect(r.assets[0]).toMatchObject({
      costCents: 16_000,
      valueCents: null,
      unitPriceAud: null,
      gainCents: null,
      priceStatus: 'manual',
    });
    expect(r.assets[0]!.flags).toEqual(['live_fx_missing']);
    expect(r.totals).toMatchObject({
      liveFxMissingCount: 1,
      fxMissingCount: 0,
      valueCents: 0,
      costCents: 0,
    });
    expect(r.savingsFlows).toEqual([
      { assetId: 3, date: '2026-05-10', amountCents: 16_000, kind: 'purchase' },
    ]);
  });

  it('flags a missing purchase rate (cost unknown) and gives no purchase flow', () => {
    const r = computeOtherAssets(input([{ ...usd, purchaseFxRate: null }]));
    expect(r.assets[0]).toMatchObject({
      costCents: null,
      valueCents: 136_800,
      gainCents: null,
      gainRatio: null,
      cagrRatio: null,
    });
    expect(r.assets[0]!.flags).toEqual(['purchase_fx_missing']);
    expect(r.totals).toMatchObject({
      fxMissingCount: 1,
      liveFxMissingCount: 0,
      valueCents: 136_800,
      costCents: 0,
    });
    expect(r.savingsFlows).toEqual([]);
  });

  it('ignores a purchase rate on an AUD item', () => {
    expect(one(asset(1, { purchaseFxRate: '2' })).costCents).toBe(10_000);
  });

  it('gives a computed AUD unit price 12 significant digits and values from the unrounded price', () => {
    const r = one(
      asset(1, {
        units: '3',
        currency: 'USD',
        purchaseFxRate: '1.5',
        pricing: { source: 'manual', unitPrice: '333.33', priceAsOf: '2026-09-01' },
      }),
      { fxRates: { USD: '1.53846153846' } },
    );
    const price = D('333.33').times('1.53846153846');
    expect(r.unitPriceAud).toBe(ratio(price));
    expect(r.valueCents).toBe(cents(price.times(3)));
  });
});

describe('computeOtherAssets: gain, ratio and CAGR (§2.4 steps 6–7)', () => {
  it('rounds cost and value per row and takes the ratio from the unrounded figures', () => {
    // Cost 3 × 0.335 = 1.005 (101 cents); value 1.50; the gain adds up in cents.
    const r = one(
      asset(1, {
        units: '3',
        unitCost: '0.335',
        pricing: { source: 'manual', unitPrice: '0.5', priceAsOf: '2026-09-01' },
      }),
    );
    expect(r).toMatchObject({ costCents: 101, valueCents: 150, gainCents: 49 });
    expect(r.gainRatio).toBe(ratio(D('1.5').minus('1.005').div('1.005')));
  });

  it('equals the sheet’s RRI for a dated AUD item', () => {
    const r = one(asset(1)); // 100 → 120 over 730 days
    expect(r.heldDays).toBe(730);
    expect(Number(r.cagrRatio)).toBeCloseTo(rri(730 / 365.25, 100, 120), 11);
    expect(r).toMatchObject({ effectiveDate: '2024-09-24', dateAssumed: false });
  });

  it('includes FX in a foreign item’s CAGR', () => {
    const r = one(
      asset(1, {
        currency: 'USD',
        unitCost: '400',
        purchaseFxRate: '1.5',
        pricing: { source: 'manual', unitPrice: '450', priceAsOf: '2026-09-01' },
      }),
    );
    const growth = D('450').times('1.52').div(D('400').times('1.5'));
    expect(r.cagrRatio).toBe(ratio(growth.pow(D('365.25').div(730)).minus(1)));
  });

  it('annualises an undated item from the assumed date (D73)', () => {
    const r = one(asset(1, { purchaseDate: null }));
    expect(r).toMatchObject({
      effectiveDate: '2026-03-31',
      dateAssumed: true,
      heldDays: 177,
      flags: ['no_purchase_date'],
    });
    expect(r.cagrRatio).toBe(ratio(D('1.2').pow(D('365.25').div(177)).minus(1)));
  });

  it('has no CAGR without a date and a recorded month, or when held no days', () => {
    const undated = one(asset(1, { purchaseDate: null }), { assumedDate: null });
    expect(undated).toMatchObject({
      effectiveDate: null,
      dateAssumed: false,
      heldDays: null,
      cagrRatio: null,
    });
    expect(undated.flags).toEqual(['no_purchase_date']);
    expect(undated.valueCents).toBe(12_000);
    expect(one(asset(1, { purchaseDate: AS_OF }))).toMatchObject({ heldDays: 0, cagrRatio: null });
    expect(one(asset(1, { purchaseDate: '2026-09-25' }))).toMatchObject({
      heldDays: -1,
      cagrRatio: null,
    });
    expect(one(asset(1, { unitCost: '0' }))).toMatchObject({
      costCents: 0,
      gainRatio: null,
      cagrRatio: null,
    });
  });

  it('flags an item without a unit cost', () => {
    const r = one(asset(1, { unitCost: null }));
    expect(r).toMatchObject({ costCents: null, valueCents: 12_000, gainCents: null });
    expect(r.flags).toEqual(['no_cost']);
  });
});

describe('computeOtherAssets: sales and the savings flows (§2.4 steps 8–9)', () => {
  const camera = asset(1, {
    purchaseDate: '2026-04-15',
    units: '3',
    unitCost: '500',
    sales: [
      { id: 2, saleDate: '2026-08-01', units: '1', proceedsCents: 45_000 },
      { id: 1, saleDate: '2026-07-15', units: '1', proceedsCents: 70_000 },
    ],
  });

  it('gives each sale the cost of its units and a realised gain, in sale-date order', () => {
    const r = one(camera);
    expect(r.sales.map((s) => [s.id, s.costCents, s.realisedCents])).toEqual([
      [1, 50_000, 20_000],
      [2, 50_000, -5_000],
    ]);
    expect(r.realisedCents).toBe(15_000);
    expect(r.remainingUnits).toBe('1');
    const noCost = one({ ...camera, unitCost: null });
    expect(noCost.sales.map((s) => s.realisedCents)).toEqual([null, null]);
    expect(noCost.realisedCents).toBe(0);
  });

  it('flows the full purchase at its date and each sale negative; undated purchases never flow', () => {
    const r = computeOtherAssets(
      input([
        camera,
        asset(5, { purchaseDate: '2026-04-15', units: '4', legacySoldUnits: '1', unitCost: '100' }),
        asset(3, {
          purchaseDate: null,
          sales: [{ id: 9, saleDate: '2026-07-15', units: '1', proceedsCents: 12_000 }],
        }),
        asset(4, { unitCost: null, purchaseDate: '2026-05-01' }),
      ]),
    );
    expect(r.savingsFlows).toEqual([
      { assetId: 1, date: '2026-04-15', amountCents: 150_000, kind: 'purchase' },
      { assetId: 5, date: '2026-04-15', amountCents: 30_000, kind: 'purchase' },
      { assetId: 1, date: '2026-07-15', amountCents: -70_000, kind: 'sale' },
      { assetId: 3, date: '2026-07-15', amountCents: -12_000, kind: 'sale' },
      { assetId: 1, date: '2026-08-01', amountCents: -45_000, kind: 'sale' },
    ]);
  });
});

describe('computeOtherAssets: totals (§2.4 step 10)', () => {
  it('sums rounded rows and takes the gain ratio from the unrounded sums of rows with both', () => {
    const r = computeOtherAssets(
      input([
        asset(1, {
          units: '3',
          unitCost: '0.335',
          pricing: { source: 'manual', unitPrice: '0.5', priceAsOf: '2026-09-01' },
        }),
        asset(2, {
          units: '3',
          unitCost: '0.335',
          pricing: { source: 'manual', unitPrice: '0.5', priceAsOf: '2026-01-01' },
        }),
        asset(3, { unitCost: null }), // valued, no cost: in the value only
        asset(4, { pricing: { source: 'manual', unitPrice: null, priceAsOf: null } }), // unpriced
        asset(5, { purchaseDate: null }),
        asset(6, {
          currency: 'USD',
          purchaseFxRate: null,
          sales: [{ id: 1, saleDate: '2026-02-01', units: '0.5', proceedsCents: 5_000 }],
        }),
        asset(7, {
          pricing: {
            source: 'bullion',
            metal: 'gold',
            ozPerUnit: '1',
            spot: { audPerOz: '100', asOf: '2026-09-01', fresh: false },
            fallbackUnitPrice: null,
            fallbackAsOf: null,
          },
        }),
      ]),
    );
    const rows = r.assets;
    expect(r.totals.valueCents).toBe(rows.reduce((s, a) => s + (a.valueCents ?? 0), 0));
    const both = rows.filter((a) => a.costCents !== null && a.valueCents !== null);
    expect(both.map((a) => a.id)).toEqual([1, 2, 5, 7]);
    expect(r.totals.costCents).toBe(both.reduce((s, a) => s + a.costCents!, 0));
    expect(r.totals.gainCents).toBe(both.reduce((s, a) => s + a.gainCents!, 0));
    const cost = D('1.005').times(2).plus(100).plus(100);
    const value = D('1.5').times(2).plus(120).plus(100);
    expect(r.totals.gainRatio).toBe(ratio(value.minus(cost).div(cost)));
    expect(r.totals).toMatchObject({
      realisedCents: 0, // the USD sale's cost is unknown
      proceedsCents: 5_000,
      unpricedCount: 1,
      staleCount: 1, // the stale hand price only: a stale spot shows on the spot tile
      assumedDateCount: 1,
      fxMissingCount: 1,
      liveFxMissingCount: 0,
    });
    expect(r.snapshot).toEqual({
      otherValueCents: r.totals.valueCents,
      otherGainCents: r.totals.gainCents,
    });
  });

  it('has no gain ratio without a costed, valued row', () => {
    const r = computeOtherAssets(input([]));
    expect(r.totals).toMatchObject({ valueCents: 0, costCents: 0, gainCents: 0, gainRatio: null });
    expect(r.chart).toEqual([
      {
        label: 'Sep 2026',
        period: '2026-09',
        date: AS_OF,
        live: true,
        costCents: 0,
        valueCents: 0,
        gainCents: 0,
        gainRatio: null,
      },
    ]);
  });

  it('rejects a stale-days setting below 1', () => {
    expect(() => computeOtherAssets(input([], { stalePriceDays: 0 }))).toThrow(RangeError);
    expect(() => computeOtherAssets(input([], { stalePriceDays: 1.5 }))).toThrow(RangeError);
  });
});

describe('otherAssetsCostHeldAt (§2.4 step 11)', () => {
  const dated = asset(1, { purchaseDate: '2026-05-31', units: '4', unitCost: '100' });
  const undated = asset(2, { purchaseDate: null, unitCost: '50' });
  const sold = asset(3, {
    purchaseDate: '2026-01-10',
    units: '3',
    unitCost: '10',
    currency: 'USD',
    purchaseFxRate: '1.5',
    sales: [{ id: 1, saleDate: '2026-06-15', units: '1', proceedsCents: 2_000 }],
  });

  it('counts an item from its purchase date (≤), undated items from the assumed date, sales as of each date', () => {
    const at = (dates: string[], assumedDate: string | null = '2026-03-31') =>
      otherAssetsCostHeldAt({ assets: [dated, undated, sold], assumedDate, dates });
    expect(
      at(['2026-02-28', '2026-03-31', '2026-05-30', '2026-05-31', '2026-06-15', '2026-09-24']),
    ).toEqual([
      4_500, // the USD item: 3 × 10 × 1.5
      9_500, // + the undated item from the assumed date
      9_500,
      49_500, // a purchase on the date counts (§11 fix 13)
      48_000, // a sale on the date counts: 1 × 10 × 1.5 less
      48_000,
    ]);
    expect(at(['2026-04-01'], null)).toEqual([4_500]); // no assumed date: undated items left out
  });

  it('leaves out items with an unknown cost or purchase rate, and never counts negative units', () => {
    const r = otherAssetsCostHeldAt({
      assets: [
        asset(1, { unitCost: null }),
        asset(2, { currency: 'EUR', purchaseFxRate: null }),
        asset(3, {
          units: '2',
          legacySoldUnits: '1',
          sales: [{ id: 1, saleDate: '2026-01-01', units: '2', proceedsCents: 10_000 }],
        }),
      ],
      assumedDate: null,
      dates: ['2025-12-31', '2026-01-01'],
    });
    expect(r).toEqual([10_000, 0]);
  });

  it('rounds once per date', () => {
    const tiny = [1, 2, 3].map((id) => asset(id, { unitCost: '0.004' }));
    expect(otherAssetsCostHeldAt({ assets: tiny, assumedDate: null, dates: [AS_OF] })).toEqual([1]);
  });
});

describe('computeOtherAssets: the chart (§2.4 step 12, §2.10)', () => {
  const snapshots = [
    {
      periodMonth: '2026-06',
      runDate: '2026-06-30',
      otherValueCents: 20_000,
      otherGainCents: 5_000,
    },
    { periodMonth: '2026-03', runDate: '2026-03-31', otherValueCents: 10_000, otherGainCents: 0 },
    { periodMonth: '2026-07', runDate: '2026-07-31', otherValueCents: null, otherGainCents: null },
    {
      periodMonth: '2026-08',
      runDate: '2026-08-31',
      otherValueCents: 21_000,
      otherGainCents: 1_000,
    },
  ];
  const assets = [
    asset(1, { purchaseDate: '2026-05-10' }),
    asset(2, { purchaseDate: null, unitCost: '50' }),
  ];

  it('has one point per snapshot (the stored value and gain) and the live point from the totals', () => {
    const r = computeOtherAssets(input(assets, { snapshots }));
    expect(r.chart).toEqual([
      {
        label: 'Mar 2026',
        period: '2026-03',
        date: '2026-03-31',
        live: false,
        costCents: 5_000,
        valueCents: 10_000,
        gainCents: 0,
        gainRatio: '0',
      },
      {
        label: 'Jun 2026',
        period: '2026-06',
        date: '2026-06-30',
        live: false,
        costCents: 15_000,
        valueCents: 20_000,
        gainCents: 5_000,
        gainRatio: ratio(D(5_000).div(15_000)),
      },
      {
        label: 'Jul 2026',
        period: '2026-07',
        date: '2026-07-31',
        live: false,
        costCents: 15_000,
        valueCents: null,
        gainCents: null,
        gainRatio: null,
      },
      {
        label: 'Aug 2026',
        period: '2026-08',
        date: '2026-08-31',
        live: false,
        costCents: 15_000,
        valueCents: 21_000,
        gainCents: 1_000,
        gainRatio: '0.05',
      },
      {
        label: 'Sep 2026',
        period: '2026-09',
        date: AS_OF,
        live: true,
        costCents: 15_000,
        valueCents: 24_000,
        gainCents: 9_000,
        gainRatio: '0.6',
      },
    ]);
  });

  it('groups by quarter and by financial year (the last point of each group), keeping the last N', () => {
    const quarterly = computeOtherAssets(
      input(assets, { snapshots, chart: { unit: 'quarterly', count: null } }),
    ).chart;
    expect(quarterly.map((p) => [p.label, p.date, p.live, p.valueCents])).toEqual([
      ['Q1 2026', '2026-03-31', false, 10_000],
      ['Q2 2026', '2026-06-30', false, 20_000],
      ['Q3 2026', AS_OF, true, 24_000],
    ]);
    const yearly = computeOtherAssets(
      input(assets, { snapshots, chart: { unit: 'yearly', count: null } }),
    ).chart;
    expect(yearly.map((p) => [p.label, p.date])).toEqual([
      ['FY2025–26', '2026-06-30'],
      ['FY2026–27', AS_OF],
    ]);
    const lastTwo = computeOtherAssets(
      input(assets, { snapshots, chart: { unit: 'monthly', count: 2 } }),
    ).chart;
    expect(lastTwo.map((p) => p.period)).toEqual(['2026-08', '2026-09']);
  });

  it('labels the live point with the month after a snapshot of the as-of month (the Stage 3 rule)', () => {
    const r = computeOtherAssets(
      input(assets, {
        snapshots: [
          { periodMonth: '2026-09', runDate: '2026-09-20', otherValueCents: 1, otherGainCents: 0 },
        ],
      }),
    );
    expect(r.chart.map((p) => [p.period, p.live])).toEqual([
      ['2026-09', false],
      ['2026-10', true],
    ]);
    expect(r.chart[1]!.costCents).toBe(cents(D(150)));
  });
});
