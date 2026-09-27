// `GET /api/other-assets` (stage-4.md §4.2, §4.4, §6.3): the assets with their price log (D72) and
// sales, the totals, the D73 assumed date, the bullion spot and FX tiles, the spot history and the
// charts. Every figure comes from the engine (`computeOtherAssets`); the server adds descriptions,
// notes, origins and counts, and the market tiles straight from the price service.
import type {
  OtherAssetResult,
  OtherAssetSaleResult,
  OtherAssetsChartPoint,
  OtherAssetsResult,
} from '@joinr/engine';
import {
  normaliseDecimal,
  type FxRateDto,
  type MarketQuoteItem,
  type OtherAssetDto,
  type OtherAssetPriceEntryDto,
  type OtherAssetSaleDto,
  type OtherAssetsChartPointDto,
  type OtherAssetsPageResponse,
  type OtherAssetsTotalsDto,
  type SpotDto,
} from '@joinr/schema';
import type { FinanceContext } from '../cashflow/context';
import { settingsSliceDto } from '../cashflow/settings';
import type { OtherAssetPriceRow, OtherAssetRow, OtherAssetSaleRow } from '../investments/load';
import { sumValidDecimalStrings } from '../lib/sums';
import { OTHER_ASSETS_PAGE_SETTING_KEYS, SPOT_METALS, SPOT_SERIES_BY_METAL } from './constants';
import {
  chartOf,
  foreignCurrencies,
  fxRateOf,
  fxSeriesIdOf,
  groupBy,
  metalsInUse,
  seriesById,
} from './inputs';

/** A stored decimal normalised for the DTO (a malformed value is passed through unchanged). */
function norm(v: string): string {
  try {
    return normaliseDecimal(v);
  } catch {
    return v;
  }
}

function normOrNull(v: string | null): string | null {
  return v === null ? null : norm(v);
}

export function otherAssetDto(
  a: OtherAssetRow,
  r: OtherAssetResult,
  o: {
    /** The manual price the engine was given (the latest entry at the as-of date). */
    unitPrice: string | null;
    sales: readonly OtherAssetSaleRow[];
    priceEntryCount: number;
  },
): OtherAssetDto {
  return {
    id: a.id,
    description: a.description,
    url: a.url,
    note: a.note,
    purchaseDate: a.purchaseDate,
    effectiveDate: r.effectiveDate,
    dateAssumed: r.dateAssumed,
    heldDays: r.heldDays,
    units: norm(a.units),
    legacySoldUnits: norm(a.soldUnits),
    soldUnits: sumValidDecimalStrings(o.sales.map((s) => s.units)),
    remainingUnits: r.remainingUnits,
    currency: a.currency,
    unitCost: normOrNull(a.unitCost),
    purchaseFxRate: normOrNull(a.purchaseFxRate),
    purchaseFxSource: a.purchaseFxSource,
    purchaseFxDate: a.purchaseFxDate,
    priceSource: a.priceSource,
    metal: a.metal,
    ozPerUnit: normOrNull(a.ozPerUnit),
    unitOfMeasure: a.unitOfMeasure,
    unitPrice: a.priceSource === 'manual' ? normOrNull(o.unitPrice) : null,
    priceAsOf: r.priceAsOf,
    unitPriceAud: r.unitPriceAud,
    priceStatus: r.priceStatus,
    costCents: r.costCents,
    valueCents: r.valueCents,
    gainCents: r.gainCents,
    gainRatio: r.gainRatio,
    cagrRatio: r.cagrRatio,
    realisedCents: r.realisedCents,
    saleCount: o.sales.length,
    priceEntryCount: o.priceEntryCount,
    flags: [...r.flags],
    sortOrder: a.sortOrder,
    origin: a.origin,
    sheetRef: a.sheetRef,
  };
}

/** Every asset the engine returned, in sort order, as DTOs. */
export function otherAssetDtos(ctx: FinanceContext): OtherAssetDto[] {
  const { data } = ctx;
  const result = ctx.otherAssets();
  const byId = new Map(result.assets.map((r) => [r.id, r]));
  const inputs = new Map(ctx.otherAssetsInput().assets.map((a) => [a.id, a]));
  const sales = groupBy(data.otherAssetSales, (s) => s.otherAssetId);
  const prices = groupBy(data.otherAssetPrices, (p) => p.otherAssetId);
  const out: OtherAssetDto[] = [];
  for (const a of data.otherAssets) {
    const r = byId.get(a.id);
    if (!r) continue;
    const pricing = inputs.get(a.id)?.pricing;
    out.push(
      otherAssetDto(a, r, {
        unitPrice: pricing?.source === 'manual' ? pricing.unitPrice : null,
        sales: sales.get(a.id) ?? [],
        priceEntryCount: prices.get(a.id)?.length ?? 0,
      }),
    );
  }
  return out;
}

export function priceEntryDto(p: OtherAssetPriceRow, currency: string): OtherAssetPriceEntryDto {
  return {
    id: p.id,
    assetId: p.otherAssetId,
    asOf: p.asOf,
    unitPrice: norm(p.unitPrice),
    currency,
    note: p.note,
    origin: p.origin,
    sheetRef: p.sheetRef,
  };
}

/** Every price entry, asOf desc, then id desc. */
export function priceEntryDtos(
  prices: readonly OtherAssetPriceRow[],
  assets: readonly OtherAssetRow[],
): OtherAssetPriceEntryDto[] {
  const currency = new Map(assets.map((a) => [a.id, a.currency]));
  return [...prices]
    .sort((a, b) => (a.asOf !== b.asOf ? (a.asOf < b.asOf ? 1 : -1) : b.id - a.id))
    .map((p) => priceEntryDto(p, currency.get(p.otherAssetId) ?? 'AUD'));
}

export function saleDto(
  s: OtherAssetSaleRow,
  r: OtherAssetSaleResult | undefined,
): OtherAssetSaleDto {
  return {
    id: s.id,
    assetId: s.otherAssetId,
    saleDate: s.saleDate,
    units: norm(s.units),
    proceedsCents: s.proceedsCents,
    costCents: r?.costCents ?? null,
    realisedCents: r?.realisedCents ?? null,
    note: s.note,
    origin: s.origin,
  };
}

/** Every sale, sale date desc, then id desc, with the engine's cost and realised gain. */
export function saleDtos(
  sales: readonly OtherAssetSaleRow[],
  result: OtherAssetsResult,
): OtherAssetSaleDto[] {
  const byId = new Map<number, OtherAssetSaleResult>();
  for (const a of result.assets) for (const s of a.sales) byId.set(s.id, s);
  return [...sales]
    .sort((a, b) => (a.saleDate !== b.saleDate ? (a.saleDate < b.saleDate ? 1 : -1) : b.id - a.id))
    .map((s) => saleDto(s, byId.get(s.id)));
}

export function otherAssetsTotalsDto(t: OtherAssetsResult['totals']): OtherAssetsTotalsDto {
  return {
    valueCents: t.valueCents,
    costCents: t.costCents,
    gainCents: t.gainCents,
    gainRatio: t.gainRatio,
    realisedCents: t.realisedCents,
    proceedsCents: t.proceedsCents,
    unpricedCount: t.unpricedCount,
    staleCount: t.staleCount,
    assumedDateCount: t.assumedDateCount,
    fxMissingCount: t.fxMissingCount,
    liveFxMissingCount: t.liveFxMissingCount,
  };
}

export function otherAssetsChartPointDto(p: OtherAssetsChartPoint): OtherAssetsChartPointDto {
  return {
    label: p.label,
    period: p.period,
    date: p.date,
    live: p.live,
    costCents: p.costCents,
    valueCents: p.valueCents,
    gainCents: p.gainCents,
    gainRatio: p.gainRatio,
  };
}

/** The spot tiles (§4.4): silver, then gold, always both, straight from the price service. */
export function spotDtos(series: readonly MarketQuoteItem[]): SpotDto[] {
  const byId = seriesById(series);
  return SPOT_METALS.map((metal) => {
    const item = byId.get(SPOT_SERIES_BY_METAL[metal]);
    return {
      metal,
      audPerOz: item?.value ?? null,
      asOf: item?.value != null ? item.asOf : null,
      status: item?.status ?? 'none',
    };
  });
}

/** The FX tiles (§4.4): the foreign currencies the assets use, in code order (GBX as itself). */
export function fxDtos(
  assets: readonly OtherAssetRow[],
  series: readonly MarketQuoteItem[],
): FxRateDto[] {
  const byId = seriesById(series);
  return foreignCurrencies(assets).map((currency) => {
    const item = byId.get(fxSeriesIdOf(currency));
    const audPerUnit = fxRateOf(byId, currency);
    return {
      currency,
      audPerUnit,
      asOf: audPerUnit === null ? null : (item?.asOf ?? null),
      status: item?.status ?? 'none',
    };
  });
}

export function buildOtherAssetsPage(ctx: FinanceContext): OtherAssetsPageResponse {
  const { data } = ctx;
  const result = ctx.otherAssets();
  const history = ctx.spotHistory();
  const { unit, count } = chartOf(data.settings);
  return {
    asOf: ctx.asOf,
    generatedAt: ctx.now.toISOString(),
    assets: otherAssetDtos(ctx),
    priceEntries: priceEntryDtos(data.otherAssetPrices, data.otherAssets),
    sales: saleDtos(data.otherAssetSales, result),
    totals: otherAssetsTotalsDto(result.totals),
    assumedDate: ctx.otherAssetsInput().assumedDate,
    spot: spotDtos(ctx.series),
    fx: fxDtos(data.otherAssets, ctx.series),
    spotHistory: metalsInUse(data.otherAssets).map((metal) => ({
      metal,
      points: (history[SPOT_SERIES_BY_METAL[metal]] ?? []).map((p) => ({
        date: p.date,
        audPerOz: p.value,
      })),
    })),
    market: { mode: ctx.market.mode, lastRefreshAt: ctx.market.lastRefreshAt },
    charts: { unit, count, points: result.chart.map(otherAssetsChartPointDto) },
    settings: settingsSliceDto(data.settings, data.settingOrigins, OTHER_ASSETS_PAGE_SETTING_KEYS),
  };
}
