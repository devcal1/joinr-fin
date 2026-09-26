// The Other Assets routes through buildApp + inject on the generic seed with a structural FAKE
// engine (stage-4.md §4.2, §4.5 step 4, §3.4, §7.4 step 3): assets (origins, no-op saves, the
// purchase-FX rules with echoed rates, the notify call), the D72 price log (upserts, the asset's
// denormalised copy, the bullion 400, the marker), sales (the 422), the order, the import lock and
// the error shapes. Generic values only.
import type {
  OtherAssetMutationResponse,
  OtherAssetPricesResponse,
  OtherAssetsPageResponse,
} from '@joinr/schema';
import { otherAssetPrices, otherAssets, otherAssetSales } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { importLock } from '../../src/routes/import';
import { spyServices } from '../investments/helpers';
import { assetsFakeEngine, call, errorOf, hasAppDataOf, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp({ engine: assetsFakeEngine() });
});
afterEach(async () => {
  await ctx.close();
});

const db = () => ctx.database.db;

function asset(description: string) {
  const row = db().select().from(otherAssets).where(eq(otherAssets.description, description)).get();
  if (!row) throw new Error(`no asset ${description}`);
  return row;
}

const WATCH = 'Example watch';
const BAR = 'Silver bar';

/** An update body echoing the stored row, with overrides. */
function updateBody(a: ReturnType<typeof asset>, over: Record<string, unknown> = {}) {
  return {
    description: a.description,
    url: a.url,
    note: a.note,
    purchaseDate: a.purchaseDate,
    units: a.units,
    currency: a.currency,
    unitCost: a.unitCost,
    purchaseFxRate: a.purchaseFxRate,
    priceSource: a.priceSource,
    metal: a.metal,
    ozPerUnit: a.ozPerUnit,
    ...over,
  };
}

function createBody(over: Record<string, unknown> = {}) {
  return {
    description: 'Sealed box',
    url: '',
    note: null,
    purchaseDate: '2025-06-01',
    units: '2',
    currency: 'AUD',
    unitCost: '100',
    purchaseFxRate: null,
    priceSource: 'manual',
    metal: null,
    ozPerUnit: null,
    price: { unitPrice: '150', asOf: '2026-09-20' },
    ...over,
  };
}

describe('GET /api/other-assets', () => {
  it('answers the page with no-store (structural figures from the engine)', async () => {
    const res = await call<OtherAssetsPageResponse>(ctx.app, {
      method: 'GET',
      url: '/api/other-assets',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.assets.map((a) => a.description)).toEqual([WATCH, BAR]);
    expect(res.body.priceEntries.map((p) => p.asOf)).toEqual(['2026-08-31', '2026-03-31']);
    expect(res.body.assumedDate).toBe('2026-05-31');
  });
});

describe('POST /api/other-assets', () => {
  it('creates an app asset with its first price entry', async () => {
    const res = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody(),
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.asset).toMatchObject({
      description: 'Sealed box',
      url: null,
      purchaseDate: '2025-06-01',
      units: '2',
      soldUnits: '0',
      legacySoldUnits: '0',
      currency: 'AUD',
      unitCost: '100',
      unitPrice: '150',
      priceSource: 'manual',
      unitOfMeasure: 'each',
      priceEntryCount: 1,
      saleCount: 0,
      sortOrder: 3,
      origin: 'app',
      sheetRef: null,
      purchaseFxRate: null,
      purchaseFxSource: null,
      // From the (structural) engine: 2 × 150.
      valueCents: 30000,
      costCents: 20000,
    });
    const row = asset('Sealed box');
    expect(row).toMatchObject({ unitPrice: '150', unitPriceAsOf: '2026-09-20' });
    const prices = db()
      .select()
      .from(otherAssetPrices)
      .where(eq(otherAssetPrices.otherAssetId, row.id))
      .all();
    expect(prices).toEqual([
      expect.objectContaining({ asOf: '2026-09-20', unitPrice: '150', origin: 'app' }),
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('a typed purchase rate is `user`, dated at the purchase date', async () => {
    await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Typed', currency: 'usd', purchaseFxRate: '1.50' }),
    });
    expect(asset('Typed')).toMatchObject({
      currency: 'USD',
      purchaseFxRate: '1.5',
      purchaseFxSource: 'user',
      purchaseFxDate: '2025-06-01',
    });
  });

  it('bullion: no price, oz when 1 oz per unit; 400 for a price, a foreign currency or no metal', async () => {
    const ok = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({
        description: 'Gold coin',
        priceSource: 'bullion',
        metal: 'gold',
        ozPerUnit: '1',
        price: null,
      }),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.asset).toMatchObject({
      priceSource: 'bullion',
      metal: 'gold',
      unitOfMeasure: 'oz',
      unitPrice: null,
      priceEntryCount: 0,
    });
    const bad = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({
        priceSource: 'bullion',
        currency: 'USD',
        metal: null,
        ozPerUnit: null,
      }),
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(bad.body).message).toContain('metal: is required for bullion');
    expect(errorOf(bad.body).message).toContain('currency: bullion is priced in AUD');
    expect(errorOf(bad.body).message).toContain('price: bullion is priced from spot');
  });
});

describe('the price job notify (§4.5 step 4)', () => {
  it('is called after a foreign asset with a date and no rate, and after a bullion asset', async () => {
    await ctx.close();
    const spy = spyServices();
    ctx = await startApp({ engine: assetsFakeEngine(), services: spy.factory });
    await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Needs FX', currency: 'EUR', price: null }),
    });
    expect(spy.notify).toHaveBeenCalledTimes(1);
    await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Has FX', currency: 'EUR', purchaseFxRate: '1.6' }),
    });
    expect(spy.notify).toHaveBeenCalledTimes(1);
    await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'AUD item' }),
    });
    expect(spy.notify).toHaveBeenCalledTimes(1);
    const bar = asset(BAR);
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${bar.id}`,
      payload: updateBody(bar, { note: 'Kept in the safe' }),
    });
    expect(spy.notify).toHaveBeenCalledTimes(2);
  });
});

describe('PUT /api/other-assets/:id (§3.4, §4.5 step 4)', () => {
  it('a no-op save (echoed and normalised) keeps the workbook origin', async () => {
    const watch = asset(WATCH);
    const res = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${watch.id}`,
      payload: updateBody(watch, { units: '1.000', unitCost: '1500.0', description: ` ${WATCH} ` }),
    });
    expect(res.status).toBe(200);
    expect(res.body.asset.origin).toBe('import');
    expect(asset(WATCH).origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('any change makes the asset app', async () => {
    const watch = asset(WATCH);
    const res = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${watch.id}`,
      payload: updateBody(watch, { note: 'Serviced', url: 'https://example.com/watch' }),
    });
    expect(res.body.asset).toMatchObject({
      note: 'Serviced',
      url: 'https://example.com/watch',
      origin: 'app',
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('echoed FX rate: kept when neither currency nor date changes; cleared when either does', async () => {
    const created = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Foreign', currency: 'USD', purchaseFxRate: '1.5' }),
    });
    const id = created.body.asset.id;
    // The backfill filled it: a `market` rate at an earlier close.
    db()
      .update(otherAssets)
      .set({ purchaseFxRate: '1.48', purchaseFxSource: 'market', purchaseFxDate: '2025-05-30' })
      .where(eq(otherAssets.id, id))
      .run();
    const stored = () => db().select().from(otherAssets).where(eq(otherAssets.id, id)).get()!;
    // Echoed, nothing else moved: kept with its source and date.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(stored(), { purchaseFxRate: '1.480', note: 'x' }),
    });
    expect(stored()).toMatchObject({
      purchaseFxRate: '1.48',
      purchaseFxSource: 'market',
      purchaseFxDate: '2025-05-30',
    });
    // Echoed with a new purchase date: not typed, cleared (the backfill fetches the new close).
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(stored(), { purchaseDate: '2025-07-01' }),
    });
    expect(stored()).toMatchObject({
      purchaseFxRate: null,
      purchaseFxSource: null,
      purchaseFxDate: null,
    });
    // A different typed rate: user, dated at the purchase date.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(stored(), { purchaseFxRate: '1.55' }),
    });
    expect(stored()).toMatchObject({
      purchaseFxRate: '1.55',
      purchaseFxSource: 'user',
      purchaseFxDate: '2025-07-01',
    });
    // Echoed with a new currency: cleared again.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(stored(), { currency: 'EUR' }),
    });
    expect(stored()).toMatchObject({ currency: 'EUR', purchaseFxRate: null });
    // Back to AUD: a rate is refused (400).
    const bad = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(stored(), { currency: 'AUD', purchaseFxRate: '1.2' }),
    });
    expect(errorOf(bad.body).message).toBe('purchaseFxRate: only for a foreign currency');
  });

  it('refuses fewer units than the recorded sales (422) and answers 404/400 shapes', async () => {
    const watch = asset(WATCH);
    await call(ctx.app, {
      method: 'POST',
      url: `/api/other-assets/${watch.id}/sales`,
      payload: { saleDate: '2026-09-01', units: '1', proceedsCents: 200000, note: null },
    });
    const res = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${watch.id}`,
      payload: updateBody(watch, { units: '0.5' }),
    });
    expect(res.status).toBe(422);
    expect(errorOf(res.body).code).toBe('SALE_OVERSELL');
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/999',
      payload: updateBody(watch),
    });
    expect(missing.status).toBe(404);
    const badId = await call(ctx.app, { method: 'PUT', url: '/api/other-assets/x', payload: {} });
    expect(badId.status).toBe(400);
  });
});

describe('DELETE /api/other-assets/:id', () => {
  it('cascades the prices and sales; a workbook row writes the marker', async () => {
    const watch = asset(WATCH);
    const res = await call(ctx.app, { method: 'DELETE', url: `/api/other-assets/${watch.id}` });
    expect(res.body).toEqual({ id: watch.id });
    expect(
      db().select().from(otherAssetPrices).where(eq(otherAssetPrices.otherAssetId, watch.id)).all(),
    ).toEqual([]);
    expect(readAppEditMarker(db())?.count).toBe(1);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    const again = await call(ctx.app, { method: 'DELETE', url: `/api/other-assets/${watch.id}` });
    expect(again.status).toBe(404);
  });

  it('an app asset deleted writes no marker', async () => {
    const created = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody(),
    });
    await call(ctx.app, { method: 'DELETE', url: `/api/other-assets/${created.body.asset.id}` });
    expect(readAppEditMarker(db())).toBeNull();
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});

describe('POST /api/other-assets/reorder', () => {
  it('takes every id once; a moved row becomes app', async () => {
    const watch = asset(WATCH);
    const bar = asset(BAR);
    const res = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets/reorder',
      payload: { ids: [bar.id, watch.id] },
    });
    expect(res.body).toEqual({ ids: [bar.id, watch.id] });
    expect(asset(BAR)).toMatchObject({ sortOrder: 1, origin: 'app' });
    expect(asset(WATCH)).toMatchObject({ sortOrder: 2, origin: 'app' });
    const bad = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets/reorder',
      payload: { ids: [bar.id] },
    });
    expect(errorOf(bad.body).message).toBe('ids: must list every asset exactly once');
  });
});

describe('PUT /api/other-assets/prices (D72)', () => {
  it('upserts by (asset, asOf), follows the latest entry and leaves an unchanged entry alone', async () => {
    const watch = asset(WATCH);
    // The same price at the stored date: no write, the origin stays.
    const same = await call<OtherAssetPricesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: { asOf: '2026-08-31', entries: [{ assetId: watch.id, unitPrice: '1800.00' }] },
    });
    expect(same.status).toBe(200);
    expect(same.body.assets.map((a) => a.id)).toEqual([watch.id]);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    // A new date ("still current"): a new app entry, and the copy follows it.
    const res = await call<OtherAssetPricesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: {
        asOf: '2026-09-24',
        entries: [{ assetId: watch.id, unitPrice: '1850', note: 'Dealer quote' }],
      },
    });
    expect(res.body.assets[0]).toMatchObject({ unitPrice: '1850', priceEntryCount: 3 });
    expect(asset(WATCH)).toMatchObject({
      unitPrice: '1850',
      unitPriceAsOf: '2026-09-24',
      origin: 'import',
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    // A back-dated entry does not move the copy.
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: { asOf: '2026-01-31', entries: [{ assetId: watch.id, unitPrice: '1600' }] },
    });
    expect(asset(WATCH)).toMatchObject({ unitPrice: '1850', unitPriceAsOf: '2026-09-24' });
  });

  it('refuses a bullion asset (priced from spot), an unknown asset (404) and repeats (400)', async () => {
    const watch = asset(WATCH);
    const bar = asset(BAR);
    const bullion = await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: {
        asOf: '2026-09-24',
        entries: [
          { assetId: watch.id, unitPrice: '1' },
          { assetId: bar.id, unitPrice: '1' },
        ],
      },
    });
    expect(bullion.status).toBe(400);
    expect(errorOf(bullion.body).message).toBe('entries.1.assetId: priced from spot');
    // Nothing was written (one transaction).
    expect(asset(WATCH).unitPrice).toBe('1800');
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: { asOf: '2026-09-24', entries: [{ assetId: 999, unitPrice: '1' }] },
    });
    expect(missing.status).toBe(404);
    const twice = await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: {
        asOf: '2026-09-24',
        entries: [
          { assetId: watch.id, unitPrice: '1' },
          { assetId: watch.id, unitPrice: '2' },
        ],
      },
    });
    expect(errorOf(twice.body).message).toBe('entries: an asset appears twice');
  });

  it('deleting a price entry recomputes the copy; a workbook entry writes the marker', async () => {
    const watch = asset(WATCH);
    const entries = db()
      .select()
      .from(otherAssetPrices)
      .where(eq(otherAssetPrices.otherAssetId, watch.id))
      .all();
    const latest = entries.find((e) => e.asOf === '2026-08-31')!;
    const res = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/other-assets/price-entries/${latest.id}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.asset).toMatchObject({ id: watch.id, unitPrice: '1700', priceEntryCount: 1 });
    expect(asset(WATCH)).toMatchObject({ unitPrice: '1700', unitPriceAsOf: '2026-03-31' });
    expect(readAppEditMarker(db())?.count).toBe(1);
    // The last entry may go too (an asset may be unpriced); that one has no sheet ref.
    const other = entries.find((e) => e.asOf === '2026-03-31')!;
    await call(ctx.app, { method: 'DELETE', url: `/api/other-assets/price-entries/${other.id}` });
    expect(asset(WATCH)).toMatchObject({ unitPrice: null, unitPriceAsOf: null });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const missing = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/other-assets/price-entries/${other.id}`,
    });
    expect(missing.status).toBe(404);
  });
});

describe('sales (D72)', () => {
  it('records, edits and deletes a sale; 422 past the remaining units', async () => {
    const bar = asset(BAR);
    const created = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: `/api/other-assets/${bar.id}/sales`,
      payload: { saleDate: '2026-09-10', units: '4', proceedsCents: 20000, note: 'Coin shop' },
    });
    expect(created.status).toBe(201);
    expect(created.body.asset).toMatchObject({ saleCount: 1, soldUnits: '4', remainingUnits: '6' });
    const sale = db().select().from(otherAssetSales).get()!;
    expect(sale).toMatchObject({ units: '4', proceedsCents: 20000, origin: 'app' });

    const over = await call(ctx.app, {
      method: 'POST',
      url: `/api/other-assets/${bar.id}/sales`,
      payload: { saleDate: '2026-09-11', units: '7', proceedsCents: 1, note: null },
    });
    expect(over.status).toBe(422);
    expect(errorOf(over.body)).toEqual({
      code: 'SALE_OVERSELL',
      message: 'Only 6 units are left to sell',
    });
    // Editing the sale counts the other sales only: 10 are available to it.
    const edited = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/sales/${sale.id}`,
      payload: { saleDate: '2026-09-10', units: '10', proceedsCents: 50000, note: null },
    });
    expect(edited.body.asset).toMatchObject({ soldUnits: '10', remainingUnits: '0' });
    const tooMany = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/sales/${sale.id}`,
      payload: { saleDate: '2026-09-10', units: '10.5', proceedsCents: 50000, note: null },
    });
    expect(errorOf(tooMany.body).message).toBe('Only 10 units are left to sell');
    const removed = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/other-assets/sales/${sale.id}`,
    });
    expect(removed.body.asset).toMatchObject({ saleCount: 0, soldUnits: '0' });
    const missing = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/other-assets/sales/${sale.id}`,
    });
    expect(missing.status).toBe(404);
    const noAsset = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets/999/sales',
      payload: { saleDate: '2026-09-10', units: '1', proceedsCents: 1, note: null },
    });
    expect(noAsset.status).toBe(404);
  });
});

describe('joint bounds: cost and value within safe cents (Fixer round 1)', () => {
  const assetCount = () => db().select().from(otherAssets).all().length;
  const pricesOf = (id: number) =>
    db().select().from(otherAssetPrices).where(eq(otherAssetPrices.otherAssetId, id)).all();

  it('refuses a create whose units × unit cost or units × price is too large (400, nothing written)', async () => {
    const before = assetCount();
    const cost = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ units: '100000', unitCost: '1000000000', price: null }),
    });
    expect(cost.status).toBe(400);
    expect(errorOf(cost.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'unitCost: units × unit cost is too large',
    });
    const price = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({
        units: '100000',
        unitCost: '1',
        price: { unitPrice: '1000000000', asOf: '2026-09-20' },
      }),
    });
    expect(price.status).toBe(400);
    expect(errorOf(price.body).message).toBe('price.unitPrice: units × price is too large');
    const oz = await call(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({
        units: '1000000000',
        unitCost: '1',
        priceSource: 'bullion',
        metal: 'silver',
        ozPerUnit: '1000000',
        price: null,
      }),
    });
    expect(oz.status).toBe(400);
    expect(errorOf(oz.body).message).toBe('ozPerUnit: units × oz per unit is too large');
    expect(assetCount()).toBe(before);
  });

  it("refuses a price or a units change that makes the item's value too large (400, nothing written)", async () => {
    const created = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Big lot', units: '1000' }),
    });
    const id = created.body.asset.id;
    const prices = await call(ctx.app, {
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: { asOf: '2026-09-22', entries: [{ assetId: id, unitPrice: '1000000000' }] },
    });
    expect(prices.status).toBe(400);
    expect(errorOf(prices.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: "entries.0.unitPrice: too large for this item's units",
    });
    expect(pricesOf(id)).toHaveLength(1);
    // 1e9 units × $100 cost is at the bound (the schema passes), but × the $150 price is not.
    const units = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(asset('Big lot'), { units: '1000000000' }),
    });
    expect(units.status).toBe(400);
    expect(errorOf(units.body).message).toBe("units: too large for this item's prices");
    expect(asset('Big lot')).toMatchObject({ units: '1000', unitPrice: '150' });
  });
});

describe('a switch to bullion drops the hand price copy (Fixer round 1)', () => {
  it('keeps the price entries for a switch back, which restores the copy', async () => {
    const created = await call<OtherAssetMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/other-assets',
      payload: createBody({ description: 'Coin set', currency: 'USD', purchaseFxRate: '1.5' }),
    });
    const id = created.body.asset.id;
    expect(asset('Coin set')).toMatchObject({ unitPrice: '150', unitPriceAsOf: '2026-09-20' });
    const toBullion = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(asset('Coin set'), {
        currency: 'AUD',
        purchaseFxRate: null,
        priceSource: 'bullion',
        metal: 'silver',
        ozPerUnit: '1',
      }),
    });
    expect(toBullion.status).toBe(200);
    expect(asset('Coin set')).toMatchObject({
      priceSource: 'bullion',
      unitPrice: null,
      unitPriceAsOf: null,
    });
    expect(
      db().select().from(otherAssetPrices).where(eq(otherAssetPrices.otherAssetId, id)).all(),
    ).toEqual([expect.objectContaining({ asOf: '2026-09-20', unitPrice: '150' })]);
    const back = await call(ctx.app, {
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: updateBody(asset('Coin set'), {
        currency: 'USD',
        purchaseFxRate: '1.5',
        priceSource: 'manual',
        metal: null,
        ozPerUnit: null,
      }),
    });
    expect(back.status).toBe(200);
    expect(asset('Coin set')).toMatchObject({
      priceSource: 'manual',
      unitPrice: '150',
      unitPriceAsOf: '2026-09-20',
    });
  });
});

describe('the import lock (§4.2)', () => {
  it('answers 409 IMPORT_IN_PROGRESS before anything else', async () => {
    importLock.tryAcquire();
    try {
      for (const [method, url] of [
        ['POST', '/api/other-assets'],
        ['PUT', '/api/other-assets/x'],
        ['DELETE', '/api/other-assets/1'],
        ['POST', '/api/other-assets/reorder'],
        ['PUT', '/api/other-assets/prices'],
        ['DELETE', '/api/other-assets/price-entries/1'],
        ['POST', '/api/other-assets/1/sales'],
        ['PUT', '/api/other-assets/sales/1'],
        ['DELETE', '/api/other-assets/sales/1'],
      ] as const) {
        const res = await call(ctx.app, { method, url, payload: {} });
        expect(res.status, `${method} ${url}`).toBe(409);
        expect(errorOf(res.body).code).toBe('IMPORT_IN_PROGRESS');
      }
    } finally {
      importLock.release();
    }
  });
});
