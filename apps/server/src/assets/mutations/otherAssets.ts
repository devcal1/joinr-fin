// Other Assets mutations (stage-4.md §4.2, §4.5 step 4, §3.4): assets (the purchase-FX rules), the
// D72 price log (upsert by asset and as-of; a manual asset's `unit_price`/`unit_price_as_of`
// follow its latest entry), sales (422 SALE_OVERSELL past the remaining units) and the order.
// After a create or update that needs a purchase-date FX rate, or of a bullion asset, the price
// job is asked to run (§4.6 fetches the rate and the spot).
import {
  assetValueTooLarge,
  JoinrDecimal,
  makeOtherAssetCreateSchema,
  makeOtherAssetPricesInputSchema,
  makeOtherAssetSaleInputSchema,
  makeOtherAssetUpdateSchema,
  normaliseDecimal,
  reorderSchema,
  type DecimalValue,
  type FxRateSource,
  type IsoDate,
  type UnitOfMeasure,
} from '@joinr/schema';
import { otherAssetPrices, otherAssets, otherAssetSales } from '@joinr/schema/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FinanceDeps } from '../../cashflow/context';
import { markImportRowDeleted, type Tx } from '../../db/queries/domain';
import { parseWith } from '../../errors';
import type { OtherAssetRow } from '../../investments/load';
import {
  assertNoImportRunning,
  assertSameIds,
  latestByAsOf,
  nextSortOrder,
  normDecimal,
  normText,
  notFound,
  sameDecimal,
  saleOversell,
  sumDecimal,
  validation,
} from './common';
import { HttpError } from '../../errors';

/** What the other-asset mutations need: the database, the clock and the price service. */
export type OtherAssetsDeps = Pick<FinanceDeps, 'database' | 'market' | 'now'>;

function loadAsset(tx: Tx, id: number): OtherAssetRow {
  const row = tx.select().from(otherAssets).where(eq(otherAssets.id, id)).get();
  if (!row) throw notFound('Asset', id);
  return row;
}

/** Asks the price job to run (the FX backfill and the spot); a failure only logs. */
function notifyMarket(deps: OtherAssetsDeps, log?: FastifyBaseLogger): void {
  try {
    deps.market.notifyInstrumentsChanged();
  } catch (err) {
    log?.warn({ err }, 'could not schedule a price refresh after an other-assets change');
  }
}

/** A non-AUD asset with a purchase date and no rate, or a bullion asset, needs the price job. */
export function needsMarketRun(a: {
  currency: string;
  purchaseDate: IsoDate | null;
  purchaseFxRate: string | null;
  priceSource: string;
}): boolean {
  return (
    a.priceSource === 'bullion' ||
    (a.currency !== 'AUD' && a.purchaseDate !== null && a.purchaseFxRate === null)
  );
}

export interface PurchaseFx {
  purchaseFxRate: string | null;
  purchaseFxSource: FxRateSource | null;
  purchaseFxDate: IsoDate | null;
}

const NO_FX: PurchaseFx = { purchaseFxRate: null, purchaseFxSource: null, purchaseFxDate: null };

/**
 * The purchase-FX columns after a create or update (§4.5 step 4). AUD → none. A typed rate that
 * differs from the stored one is `user`, dated at the purchase date. When the currency or the
 * purchase date changes, a rate equal to the stored one counts as not typed (the form echoed it):
 * the columns are cleared so the backfill fetches the new date's close. When neither changes, an
 * echoed rate keeps the stored rate, source and date. A null rate clears them.
 */
export function purchaseFxAfter(
  stored: Pick<
    OtherAssetRow,
    'currency' | 'purchaseDate' | 'purchaseFxRate' | 'purchaseFxSource' | 'purchaseFxDate'
  > | null,
  input: { currency: string; purchaseDate: IsoDate | null; purchaseFxRate: string | null },
): PurchaseFx {
  if (input.currency === 'AUD' || input.purchaseFxRate === null) return NO_FX;
  const typed: PurchaseFx = {
    purchaseFxRate: normaliseDecimal(input.purchaseFxRate),
    purchaseFxSource: 'user',
    purchaseFxDate: input.purchaseDate,
  };
  if (stored === null) return typed;
  const echoed = sameDecimal(input.purchaseFxRate, stored.purchaseFxRate);
  if (!echoed) return typed;
  const moved = stored.currency !== input.currency || stored.purchaseDate !== input.purchaseDate;
  if (moved) return NO_FX;
  return {
    purchaseFxRate: stored.purchaseFxRate,
    purchaseFxSource: stored.purchaseFxSource,
    purchaseFxDate: stored.purchaseFxDate,
  };
}

/** Bullion held as whole ounces reads "oz"; everything else is counted "each". */
function unitOfMeasureFor(priceSource: string, ozPerUnit: string | null): UnitOfMeasure {
  return priceSource === 'bullion' && sameDecimal(ozPerUnit, '1') ? 'oz' : 'each';
}

/** Sets a manual asset's denormalised price from its latest entry (the asset's origin is kept). */
export function syncAssetPrice(tx: Tx, assetId: number): void {
  const asset = tx.select().from(otherAssets).where(eq(otherAssets.id, assetId)).get();
  if (!asset || asset.priceSource !== 'manual') return;
  const latest = latestByAsOf(
    tx.select().from(otherAssetPrices).where(eq(otherAssetPrices.otherAssetId, assetId)).all(),
  );
  const unitPrice = latest?.unitPrice ?? null;
  const unitPriceAsOf = latest?.asOf ?? null;
  if (asset.unitPrice === unitPrice && asset.unitPriceAsOf === unitPriceAsOf) return;
  tx.update(otherAssets).set({ unitPrice, unitPriceAsOf }).where(eq(otherAssets.id, assetId)).run();
}

/** Σ the asset's recorded sales' units, leaving out `exceptSaleId`. */
function soldUnits(tx: Tx, assetId: number, exceptSaleId: number | null = null): DecimalValue {
  return sumDecimal(
    tx
      .select({ id: otherAssetSales.id, units: otherAssetSales.units })
      .from(otherAssetSales)
      .where(eq(otherAssetSales.otherAssetId, assetId))
      .all()
      .filter((s) => s.id !== exceptSaleId)
      .map((s) => s.units),
  );
}

/** The largest unit price in the asset's price log (null without entries or with malformed ones). */
function largestPrice(tx: Tx, assetId: number): string | null {
  let best: DecimalValue | null = null;
  for (const { unitPrice } of tx
    .select({ unitPrice: otherAssetPrices.unitPrice })
    .from(otherAssetPrices)
    .where(eq(otherAssetPrices.otherAssetId, assetId))
    .all()) {
    try {
      const d = new JoinrDecimal(unitPrice);
      if (best === null || d.greaterThan(best)) best = d;
    } catch {
      // A malformed stored price is left out.
    }
  }
  return best === null ? null : best.toString();
}

/** The units still held before a sale: bought − the workbook's sold units − the other sales. */
function unitsLeft(tx: Tx, asset: OtherAssetRow, exceptSaleId: number | null): DecimalValue {
  let left = new JoinrDecimal(0);
  try {
    left = new JoinrDecimal(asset.units).minus(asset.soldUnits);
  } catch {
    // A malformed stored decimal leaves nothing to sell.
  }
  return left.minus(soldUnits(tx, asset.id, exceptSaleId));
}

/** 422 when a sale of `units` would take the asset below 0 units. */
function assertCanSell(tx: Tx, asset: OtherAssetRow, units: string, exceptSaleId: number | null) {
  const left = unitsLeft(tx, asset, exceptSaleId);
  if (new JoinrDecimal(units).greaterThan(left)) {
    throw saleOversell(normaliseDecimal(JoinrDecimal.max(left, 0)));
  }
}

// ─── Assets ─────────────────────────────────────────────────────────────────────────────────────

/** POST /api/other-assets: the asset (`origin app`) and, for a manual price, its first entry. */
export function createOtherAsset(
  deps: OtherAssetsDeps,
  body: unknown,
  log?: FastifyBaseLogger,
): number {
  assertNoImportRunning();
  const input = parseWith(makeOtherAssetCreateSchema(deps.now), body);
  const fx = purchaseFxAfter(null, input);
  const id = deps.database.db.transaction(
    (tx) => {
      const price = input.priceSource === 'manual' ? input.price : null;
      const assetId = tx
        .insert(otherAssets)
        .values({
          description: input.description,
          url: input.url,
          purchaseDate: input.purchaseDate,
          units: input.units,
          soldUnits: '0',
          currency: input.currency,
          unitCost: input.unitCost,
          unitPrice: price?.unitPrice ?? null,
          unitPriceAsOf: price?.asOf ?? null,
          priceSource: input.priceSource,
          metal: input.metal,
          unitOfMeasure: unitOfMeasureFor(input.priceSource, input.ozPerUnit),
          ozPerUnit: input.ozPerUnit,
          sortOrder: nextSortOrder(tx, otherAssets, otherAssets.sortOrder),
          note: input.note,
          origin: 'app',
          sheetRef: null,
          ...fx,
        })
        .returning({ id: otherAssets.id })
        .get().id;
      if (price) {
        tx.insert(otherAssetPrices)
          .values({
            otherAssetId: assetId,
            asOf: price.asOf,
            unitPrice: price.unitPrice,
            note: null,
            origin: 'app',
            sheetRef: null,
          })
          .run();
      }
      return assetId;
    },
    { behavior: 'immediate' },
  );
  if (needsMarketRun({ ...input, purchaseFxRate: fx.purchaseFxRate })) notifyMarket(deps, log);
  return id;
}

/**
 * PUT /api/other-assets/:id: any changed field makes the asset `app`; a no-op save (both sides
 * normalised, an echoed FX rate) writes nothing. Fewer units than the recorded sales → 422. A
 * manual asset whose units (or price source) change is checked against its price log: the new
 * units × the largest stored price must stay within the order-value bound (400, Fixer round 1).
 */
export function updateOtherAsset(
  deps: OtherAssetsDeps,
  id: number,
  body: unknown,
  log?: FastifyBaseLogger,
): void {
  const input = parseWith(makeOtherAssetUpdateSchema(deps.now), body);
  const after = deps.database.db.transaction(
    (tx) => {
      const stored = loadAsset(tx, id);
      const fx = purchaseFxAfter(stored, input);
      const unitsChanged = !sameDecimal(stored.units, input.units);
      if (unitsChanged) {
        const sold = new JoinrDecimal(stored.soldUnits).plus(soldUnits(tx, id));
        if (new JoinrDecimal(input.units).lessThan(sold)) {
          throw new HttpError(
            422,
            `The sales already use ${normaliseDecimal(sold)} units; keep at least that many`,
            'SALE_OVERSELL',
          );
        }
      }
      if (
        input.priceSource === 'manual' &&
        (unitsChanged || stored.priceSource !== input.priceSource) &&
        assetValueTooLarge([input.units, largestPrice(tx, id)])
      ) {
        throw validation("units: too large for this item's prices");
      }
      const changed =
        normText(stored.description) !== normText(input.description) ||
        normText(stored.url) !== normText(input.url) ||
        normText(stored.note) !== normText(input.note) ||
        stored.purchaseDate !== input.purchaseDate ||
        unitsChanged ||
        stored.currency !== input.currency ||
        !sameDecimal(stored.unitCost, input.unitCost) ||
        stored.priceSource !== input.priceSource ||
        stored.metal !== input.metal ||
        !sameDecimal(stored.ozPerUnit, input.ozPerUnit) ||
        normDecimal(stored.purchaseFxRate) !== normDecimal(fx.purchaseFxRate) ||
        stored.purchaseFxSource !== fx.purchaseFxSource ||
        stored.purchaseFxDate !== fx.purchaseFxDate;
      if (!changed) return null;
      const sourceChanged = stored.priceSource !== input.priceSource;
      tx.update(otherAssets)
        .set({
          description: input.description,
          url: input.url,
          note: input.note,
          purchaseDate: input.purchaseDate,
          units: input.units,
          currency: input.currency,
          unitCost: input.unitCost,
          priceSource: input.priceSource,
          metal: input.metal,
          ozPerUnit: input.ozPerUnit,
          unitOfMeasure: sourceChanged
            ? unitOfMeasureFor(input.priceSource, input.ozPerUnit)
            : stored.unitOfMeasure,
          // Now priced from spot: the hand price copy is dropped, so it never becomes the bullion
          // fallback (§2.2: the last known AUD unit price), which it is not (another currency,
          // another unit). Without spot the item then reads as unpriced (Fixer round 1).
          ...(sourceChanged && input.priceSource === 'bullion'
            ? { unitPrice: null, unitPriceAsOf: null }
            : {}),
          ...fx,
          origin: 'app',
        })
        .where(eq(otherAssets.id, id))
        .run();
      // The manual price entries are kept for a switch back: back to a hand price, the copy
      // follows the price log again.
      if (sourceChanged) syncAssetPrice(tx, id);
      return fx;
    },
    { behavior: 'immediate' },
  );
  if (after && needsMarketRun({ ...input, purchaseFxRate: after.purchaseFxRate })) {
    notifyMarket(deps, log);
  }
}

/** DELETE /api/other-assets/:id: cascades its prices and sales; the marker for a workbook row. */
export function deleteOtherAsset(deps: OtherAssetsDeps, id: number): void {
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const stored = loadAsset(tx, id);
      tx.delete(otherAssets).where(eq(otherAssets.id, id)).run();
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
}

/**
 * POST /api/other-assets/reorder: every asset id exactly once. The assets take their existing sort
 * orders in the new order; an asset whose position changes becomes `app` (a re-import would undo
 * the order, D34).
 */
export function reorderOtherAssets(deps: OtherAssetsDeps, body: unknown): number[] {
  assertNoImportRunning();
  const { ids } = parseWith(reorderSchema, body);
  deps.database.db.transaction(
    (tx) => {
      const rows = tx
        .select({ id: otherAssets.id, sortOrder: otherAssets.sortOrder })
        .from(otherAssets)
        .orderBy(asc(otherAssets.sortOrder), asc(otherAssets.id))
        .all();
      assertSameIds(
        ids,
        rows.map((r) => r.id),
        'asset',
      );
      let slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
      // Repeated sort orders cannot express an order: use consecutive values from the lowest.
      if (new Set(slots).size !== slots.length) slots = slots.map((_, i) => (slots[0] ?? 1) + i);
      const byId = new Map(rows.map((r) => [r.id, r]));
      ids.forEach((id, i) => {
        const slot = slots[i]!;
        if (byId.get(id)!.sortOrder === slot) return;
        tx.update(otherAssets)
          .set({ sortOrder: slot, origin: 'app' })
          .where(eq(otherAssets.id, id))
          .run();
      });
    },
    { behavior: 'immediate' },
  );
  return ids;
}

// ─── Prices (D72) ───────────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/other-assets/prices: writes or replaces each asset's entry at the shared as-of date
 * (`origin app`; an unchanged entry is not rewritten), then sets each asset's price copy from its
 * latest entry. A bullion asset is priced from spot (400); units × the price must stay within the
 * order-value bound (400, Fixer round 1). Returns the asset ids in body order.
 */
export function saveOtherAssetPrices(deps: OtherAssetsDeps, body: unknown): number[] {
  assertNoImportRunning();
  const input = parseWith(makeOtherAssetPricesInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      input.entries.forEach((e, i) => {
        const asset = loadAsset(tx, e.assetId);
        if (asset.priceSource === 'bullion') {
          throw validation(`entries.${i}.assetId: priced from spot`);
        }
        if (assetValueTooLarge([asset.units, e.unitPrice])) {
          throw validation(`entries.${i}.unitPrice: too large for this item's units`);
        }
        const existing = tx
          .select()
          .from(otherAssetPrices)
          .where(
            and(
              eq(otherAssetPrices.otherAssetId, e.assetId),
              eq(otherAssetPrices.asOf, input.asOf),
            ),
          )
          .get();
        if (existing) {
          const note = e.note === undefined ? existing.note : e.note;
          if (
            !sameDecimal(existing.unitPrice, e.unitPrice) ||
            normText(existing.note) !== normText(note)
          ) {
            tx.update(otherAssetPrices)
              .set({ unitPrice: e.unitPrice, note, origin: 'app' })
              .where(eq(otherAssetPrices.id, existing.id))
              .run();
          }
        } else {
          tx.insert(otherAssetPrices)
            .values({
              otherAssetId: e.assetId,
              asOf: input.asOf,
              unitPrice: e.unitPrice,
              note: e.note ?? null,
              origin: 'app',
              sheetRef: null,
            })
            .run();
        }
        syncAssetPrice(tx, e.assetId);
      });
      return input.entries.map((e) => e.assetId);
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/other-assets/price-entries/:id (an asset may be unpriced). Returns the asset id. */
export function deleteOtherAssetPriceEntry(deps: OtherAssetsDeps, id: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const entry = tx.select().from(otherAssetPrices).where(eq(otherAssetPrices.id, id)).get();
      if (!entry) throw notFound('Price entry', id);
      tx.delete(otherAssetPrices).where(eq(otherAssetPrices.id, id)).run();
      if (entry.sheetRef !== null) markImportRowDeleted(tx, now);
      syncAssetPrice(tx, entry.otherAssetId);
      return entry.otherAssetId;
    },
    { behavior: 'immediate' },
  );
}

// ─── Sales (D72) ────────────────────────────────────────────────────────────────────────────────

/** POST /api/other-assets/:id/sales (`origin app`; 422 past the remaining units). */
export function createOtherAssetSale(
  deps: OtherAssetsDeps,
  assetId: number,
  body: unknown,
): number {
  const input = parseWith(makeOtherAssetSaleInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const asset = loadAsset(tx, assetId);
      assertCanSell(tx, asset, input.units, null);
      tx.insert(otherAssetSales)
        .values({
          otherAssetId: assetId,
          saleDate: input.saleDate,
          units: input.units,
          proceedsCents: input.proceedsCents,
          note: input.note,
          origin: 'app',
          sheetRef: null,
        })
        .run();
      return assetId;
    },
    { behavior: 'immediate' },
  );
}

/** PUT /api/other-assets/sales/:id (the same check without this sale). Returns the asset id. */
export function updateOtherAssetSale(deps: OtherAssetsDeps, saleId: number, body: unknown): number {
  const input = parseWith(makeOtherAssetSaleInputSchema(deps.now), body);
  return deps.database.db.transaction(
    (tx) => {
      const sale = tx.select().from(otherAssetSales).where(eq(otherAssetSales.id, saleId)).get();
      if (!sale) throw notFound('Sale', saleId);
      const asset = loadAsset(tx, sale.otherAssetId);
      assertCanSell(tx, asset, input.units, saleId);
      const changed =
        sale.saleDate !== input.saleDate ||
        !sameDecimal(sale.units, input.units) ||
        sale.proceedsCents !== input.proceedsCents ||
        normText(sale.note) !== normText(input.note);
      if (changed) {
        tx.update(otherAssetSales)
          .set({
            saleDate: input.saleDate,
            units: input.units,
            proceedsCents: input.proceedsCents,
            note: input.note,
            origin: 'app',
          })
          .where(eq(otherAssetSales.id, saleId))
          .run();
      }
      return sale.otherAssetId;
    },
    { behavior: 'immediate' },
  );
}

/** DELETE /api/other-assets/sales/:id. Returns the asset id. */
export function deleteOtherAssetSale(deps: OtherAssetsDeps, saleId: number): number {
  const now = deps.now();
  return deps.database.db.transaction(
    (tx) => {
      const sale = tx.select().from(otherAssetSales).where(eq(otherAssetSales.id, saleId)).get();
      if (!sale) throw notFound('Sale', saleId);
      tx.delete(otherAssetSales).where(eq(otherAssetSales.id, saleId)).run();
      if (sale.sheetRef !== null) markImportRowDeleted(tx, now);
      return sale.otherAssetId;
    },
    { behavior: 'immediate' },
  );
}
