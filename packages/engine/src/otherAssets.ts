// Other assets (stage-4.md §2.4; D72, D73; spec 04 §1.3): the remaining units after legacy and
// recorded sales, the cost of those units at the FX rate on the purchase date, today's AUD value
// (a hand price with its as-of date and stale rule, or bullion from spot × oz per unit), gain and
// CAGR (FX included; undated items from the D73 assumed date), sales with a realised gain, the
// dated flows the savings engine takes, the cost-held line and the chart.
import {
  isoMonthOf,
  OTHER_ASSET_FLAGS,
  type IsoDate,
  type OtherAssetFlag,
  type PriceStatus,
} from '@joinr/schema';
import {
  annualise,
  compareIso,
  groupChart,
  negateCents,
  orderedFlags,
  sumDec,
} from './assetsCommon';
import {
  centsOf,
  checkCents,
  dayNumber,
  daysBetween,
  dec,
  decimalString,
  decN,
  ONE,
  priceString,
  ratioString,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import { provisionalMonth, sortByRunDate } from './periods';
import type {
  Cents,
  EngineOtherAsset,
  OtherAssetResult,
  OtherAssetSaleResult,
  OtherAssetsChartPoint,
  OtherAssetsInput,
  OtherAssetsResult,
} from './types';

/** AUD per 1 unit of the asset's currency at purchase: 1 for AUD; null when unknown (§2.4 step 3). */
function purchaseFxOf(a: EngineOtherAsset): Dec | null {
  if (a.currency === 'AUD') return ONE;
  return a.purchaseFxRate === null ? null : dec(a.purchaseFxRate, `asset ${a.id} purchaseFxRate`);
}

/** Today's AUD per 1 unit of the asset's currency: 1 for AUD; null when no live rate (§2.4 step 5). */
function liveFxOf(currency: string, fxRates: Readonly<Record<string, string>>): Dec | null {
  if (currency === 'AUD') return ONE;
  return Object.hasOwn(fxRates, currency) ? dec(fxRates[currency]!, `fxRates.${currency}`) : null;
}

function unitCostOf(a: EngineOtherAsset): Dec | null {
  return a.unitCost === null ? null : dec(a.unitCost, `asset ${a.id} unitCost`);
}

/** The units bought less the workbook's sold units (the full purchase of §2.4 step 9). */
function boughtUnits(a: EngineOtherAsset): Dec {
  return dec(a.units, `asset ${a.id} units`).minus(
    dec(a.legacySoldUnits, `asset ${a.id} legacySoldUnits`),
  );
}

/** The asset's sales in sale-date order (ties: id). Validates dates and amounts. */
function salesInOrder(a: EngineOtherAsset): EngineOtherAsset['sales'][number][] {
  for (const s of a.sales) {
    dayNumber(s.saleDate);
    dec(s.units, `sale ${s.id} units`);
    checkCents(s.proceedsCents, `sale ${s.id} proceedsCents`);
  }
  return [...a.sales].sort((x, y) => compareIso(x.saleDate, y.saleDate) || x.id - y.id);
}

/** One row's figures plus the unrounded cost and value the totals and ratios need. */
interface RowCalc {
  result: OtherAssetResult;
  cost: Dec | null;
  value: Dec | null;
  manualStale: boolean;
}

function assetRow(a: EngineOtherAsset, input: OtherAssetsInput): RowCalc {
  const flags = new Set<OtherAssetFlag>();
  const sales = salesInOrder(a);

  // Step 1: units.
  const legacySold = dec(a.legacySoldUnits, `asset ${a.id} legacySoldUnits`);
  let remaining = boughtUnits(a).minus(
    sumDec(sales.map((s) => dec(s.units, `sale ${s.id} units`))),
  );
  if (remaining.isNegative() && !remaining.isZero()) {
    remaining = ZERO;
    flags.add('oversold');
  }
  if (legacySold.greaterThan(0)) flags.add('legacy_sold');
  const held = remaining.greaterThan(0);

  // Steps 3–4: purchase FX and cost.
  const purchaseFx = purchaseFxOf(a);
  if (purchaseFx === null) flags.add('purchase_fx_missing');
  const unitCost = unitCostOf(a);
  if (unitCost === null) flags.add('no_cost');
  const cost =
    held && unitCost !== null && purchaseFx !== null
      ? remaining.times(unitCost).times(purchaseFx)
      : null;

  // Step 5: today's AUD price per unit and its status.
  let unitPriceAud: Dec | null = null;
  let priceStatus: PriceStatus = 'none';
  let priceAsOf: IsoDate | null = null;
  const pricing = a.pricing;
  if (pricing.source === 'manual') {
    if (pricing.unitPrice === null) {
      flags.add('unpriced');
    } else {
      priceAsOf = pricing.priceAsOf;
      const fx = liveFxOf(a.currency, input.fxRates);
      if (fx === null) flags.add('live_fx_missing');
      else unitPriceAud = dec(pricing.unitPrice, `asset ${a.id} unitPrice`).times(fx);
      const current =
        pricing.priceAsOf !== null &&
        daysBetween(pricing.priceAsOf, input.asOf) <= input.stalePriceDays;
      priceStatus = current ? 'manual' : 'stale';
      if (!current) flags.add('stale_price');
    }
  } else if (pricing.spot !== null) {
    dayNumber(pricing.spot.asOf);
    unitPriceAud = dec(pricing.spot.audPerOz, `asset ${a.id} spot`).times(
      dec(pricing.ozPerUnit, `asset ${a.id} ozPerUnit`),
    );
    priceStatus = pricing.spot.fresh ? 'fresh' : 'stale';
    priceAsOf = pricing.spot.asOf;
    if (!pricing.spot.fresh) flags.add('stale_price');
  } else if (pricing.fallbackUnitPrice !== null) {
    unitPriceAud = dec(pricing.fallbackUnitPrice, `asset ${a.id} fallbackUnitPrice`);
    priceStatus = 'stale';
    priceAsOf = pricing.fallbackAsOf;
    flags.add('stale_price');
    flags.add('spot_unavailable');
  } else {
    flags.add('unpriced');
  }

  // Step 6: value, gain and the gain ratio from unrounded values.
  const value = held && unitPriceAud !== null ? remaining.times(unitPriceAud) : null;
  const costCents = cost === null ? null : centsOf(cost);
  const valueCents = value === null ? null : centsOf(value);
  const gainCents = costCents !== null && valueCents !== null ? valueCents - costCents : null;
  const gainRatio =
    cost !== null && value !== null && cost.greaterThan(0)
      ? ratioString(value.minus(cost).div(cost))
      : null;

  // Step 7: CAGR from the effective date (D73: the assumed date for an undated item), FX included.
  if (a.purchaseDate === null) flags.add('no_purchase_date');
  else dayNumber(a.purchaseDate);
  const effectiveDate = a.purchaseDate ?? input.assumedDate;
  const heldDays = effectiveDate === null ? null : daysBetween(effectiveDate, input.asOf);
  const cagr =
    cost !== null && value !== null && cost.greaterThan(0) && heldDays !== null
      ? annualise(value.div(cost), heldDays)
      : null;

  // Step 8: sales and their realised gains (the cost of the units sold at the purchase FX).
  const saleResults: OtherAssetSaleResult[] = sales.map((s) => {
    const saleCost =
      unitCost !== null && purchaseFx !== null
        ? centsOf(dec(s.units, `sale ${s.id} units`).times(unitCost).times(purchaseFx))
        : null;
    return {
      id: s.id,
      saleDate: s.saleDate,
      units: decimalString(dec(s.units, `sale ${s.id} units`)),
      proceedsCents: s.proceedsCents,
      costCents: saleCost,
      realisedCents: saleCost === null ? null : s.proceedsCents - saleCost,
    };
  });

  return {
    result: {
      id: a.id,
      remainingUnits: decimalString(remaining),
      costCents,
      // A computed price (hand price × FX, spot × oz): 12 significant digits, as Stage 2's prices.
      unitPriceAud: unitPriceAud === null ? null : priceString(unitPriceAud),
      valueCents,
      gainCents,
      gainRatio,
      cagrRatio: cagr === null ? null : ratioString(cagr),
      effectiveDate,
      dateAssumed: a.purchaseDate === null && input.assumedDate !== null,
      heldDays,
      priceStatus,
      priceAsOf,
      sales: saleResults,
      realisedCents: sumCents(saleResults.map((s) => s.realisedCents ?? 0)),
      flags: orderedFlags(OTHER_ASSET_FLAGS, flags),
    },
    cost,
    value,
    manualStale: pricing.source === 'manual' && priceStatus === 'stale',
  };
}

/**
 * §2.4 step 9: a purchase flow at the real purchase date for the full purchase (units less the
 * workbook's sold units) at the purchase-date FX, when the cost and FX are known; a negative flow at
 * each sale's date. Undated assets never produce a purchase flow (their D73 date lies in the
 * baseline window). Date, asset, id order (a purchase before a sale on the same day).
 */
function savingsFlowsOf(assets: readonly EngineOtherAsset[]): OtherAssetsResult['savingsFlows'] {
  const flows: (OtherAssetsResult['savingsFlows'][number] & { order: number })[] = [];
  for (const a of assets) {
    const fx = purchaseFxOf(a);
    const unitCost = unitCostOf(a);
    const bought = boughtUnits(a);
    if (a.purchaseDate !== null && fx !== null && unitCost !== null && bought.greaterThan(0)) {
      flows.push({
        assetId: a.id,
        date: a.purchaseDate,
        amountCents: centsOf(bought.times(unitCost).times(fx)),
        kind: 'purchase',
        order: -1,
      });
    }
    for (const s of salesInOrder(a)) {
      flows.push({
        assetId: a.id,
        date: s.saleDate,
        amountCents: negateCents(s.proceedsCents),
        kind: 'sale',
        order: s.id,
      });
    }
  }
  return flows
    .sort((x, y) => compareIso(x.date, y.date) || x.assetId - y.assetId || x.order - y.order)
    .map(({ assetId, date, amountCents, kind }) => ({ assetId, date, amountCents, kind }));
}

/**
 * The history chart's cost line (§2.4 step 11; the sheet's Z fixed, §11 fix 13): for each date,
 * Σ over assets whose effective date (the real date, else the assumed date) is on or before it of
 * the units held then (bought − workbook sold − sales dated on or before it, never below 0) × unit
 * cost × purchase FX; unknown cost or FX left out; rounded once per date.
 */
export function otherAssetsCostHeldAt(i: {
  assets: readonly EngineOtherAsset[];
  assumedDate: IsoDate | null;
  dates: readonly IsoDate[];
}): Cents[] {
  if (i.assumedDate !== null) dayNumber(i.assumedDate);
  const lines = i.assets.flatMap((a) => {
    const effective = a.purchaseDate ?? i.assumedDate;
    const fx = purchaseFxOf(a);
    const unitCost = unitCostOf(a);
    if (effective === null || fx === null || unitCost === null) return [];
    return [
      {
        effective,
        bought: boughtUnits(a),
        unitCostAud: unitCost.times(fx),
        sales: salesInOrder(a).map((s) => ({
          date: s.saleDate,
          units: dec(s.units, `sale ${s.id} units`),
        })),
      },
    ];
  });
  return i.dates.map((d) => {
    dayNumber(d);
    let total = ZERO;
    for (const l of lines) {
      if (l.effective > d) continue;
      const sold = sumDec(l.sales.filter((s) => s.date <= d).map((s) => s.units));
      const units = l.bought.minus(sold);
      if (units.greaterThan(0)) total = total.plus(units.times(l.unitCostAud));
    }
    return centsOf(total);
  });
}

/** gain ÷ (value − gain) (History AC); null when either is unknown or the denominator is 0. */
function gainOnCost(valueCents: Cents | null, gainCents: Cents | null): string | null {
  if (valueCents === null || gainCents === null || valueCents - gainCents === 0) return null;
  return ratioString(
    decN(checkCents(gainCents, 'gain')).div(checkCents(valueCents, 'value') - gainCents),
  );
}

export function computeOtherAssets(input: OtherAssetsInput): OtherAssetsResult {
  dayNumber(input.asOf);
  if (input.assumedDate !== null) dayNumber(input.assumedDate);
  if (!Number.isInteger(input.stalePriceDays) || input.stalePriceDays < 1) {
    throw new RangeError(
      `engine: stalePriceDays must be a whole number ≥ 1: ${input.stalePriceDays}`,
    );
  }

  const rows = input.assets.map((a) => assetRow(a, input));
  const assets = rows.map((r) => r.result);

  // Step 10: totals (Σ of rounded rows; the ratio from unrounded sums over rows with both).
  const both = rows.filter((r) => r.cost !== null && r.value !== null);
  const costSum = sumDec(both.map((r) => r.cost!));
  const gainSum = sumDec(both.map((r) => r.value!.minus(r.cost!)));
  const has = (f: OtherAssetFlag) => assets.filter((a) => a.flags.includes(f)).length;
  const totals: OtherAssetsResult['totals'] = {
    valueCents: sumCents(assets.map((a) => a.valueCents ?? 0)),
    costCents: sumCents(both.map((r) => r.result.costCents!)),
    gainCents: sumCents(both.map((r) => r.result.gainCents!)),
    gainRatio: costSum.greaterThan(0) ? ratioString(gainSum.div(costSum)) : null,
    realisedCents: sumCents(assets.map((a) => a.realisedCents)),
    proceedsCents: sumCents(assets.flatMap((a) => a.sales.map((s) => s.proceedsCents))),
    unpricedCount: has('unpriced'),
    staleCount: rows.filter((r) => r.manualStale).length,
    assumedDateCount: assets.filter((a) => a.dateAssumed).length,
    fxMissingCount: has('purchase_fx_missing'),
    liveFxMissingCount: has('live_fx_missing'),
  };

  // Step 12: the chart: one point per snapshot plus the live point, grouped (all `end`).
  const snapshots = sortByRunDate(input.snapshots);
  const costs = otherAssetsCostHeldAt({
    assets: input.assets,
    assumedDate: input.assumedDate,
    dates: [...snapshots.map((s) => s.runDate), input.asOf],
  });
  const points: OtherAssetsChartPoint[] = snapshots.map((s, i) => ({
    label: '',
    period: s.periodMonth,
    date: s.runDate,
    live: false,
    costCents: costs[i]!,
    valueCents: s.otherValueCents,
    gainCents: s.otherGainCents,
    gainRatio: gainOnCost(s.otherValueCents, s.otherGainCents),
  }));
  points.push({
    label: '',
    period:
      snapshots.length === 0 ? isoMonthOf(input.asOf) : provisionalMonth(snapshots, input.asOf),
    date: input.asOf,
    live: true,
    costCents: costs[snapshots.length]!,
    valueCents: totals.valueCents,
    gainCents: totals.gainCents,
    gainRatio: gainOnCost(totals.valueCents, totals.gainCents),
  });
  const chart = groupChart(points, input.chart.unit, input.chart.count).map((g) => ({
    ...g.last,
    label: g.label,
  }));

  return {
    assets,
    totals,
    savingsFlows: savingsFlowsOf(input.assets),
    chart,
    snapshot: { otherValueCents: totals.valueCents, otherGainCents: totals.gainCents },
  };
}
