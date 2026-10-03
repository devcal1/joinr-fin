// Bullion as its own class (stage-9.md §2.1, §6.5 step 2a; D148, D153; pure). The Other Assets
// rows priced from the spot (`pricing.source === 'bullion'`) with units left are grouped by the
// metal the web prices them with, and each group becomes one `BullionInput`: the engine's own row
// results (so the value is the Other Assets page's to the cent), ounces per unit, purchase dates
// and AUD costs per unit; the spot the web used, the futures' USD price and the live AUD per USD;
// the AUD spot's day row and the futures' USD row from `series_day_quotes`. It never reads a page
// response and never changes `assets/**`.
import type {
  BullionInput,
  BullionRowInput,
  DayRowInput,
  EngineOtherAsset,
  OtherAssetResult,
} from '@joinr/engine';
import {
  BULLION_HOLDINGS,
  JoinrDecimal,
  normaliseDecimal,
  type DecimalString,
  type MarketQuoteItem,
  type Metal,
} from '@joinr/schema';
import type { DayQuoteRow } from '../db/queries/dayQuotes';
import { convertToAud, roundDerived } from '../market/fx';

const METAL_ORDER: readonly Metal[] = ['silver', 'gold'];

/** A stored series day as the engine takes it (`fxPrev` given: '1' for the AUD spot). */
export function seriesDayRow(row: DayQuoteRow | undefined, fxPrev: DecimalString | null) {
  if (row === undefined) return null;
  return {
    sessionDate: row.sessionDate,
    timeZone: row.timeZone,
    granularity: row.granularity,
    nativeCurrency: row.nativeCurrency,
    previousCloseNative: row.previousClose,
    fxPrev,
    points: row.points,
  } satisfies DayRowInput;
}

/** A UTC ISO instant with milliseconds, or null when the text is not a valid instant. */
export function isoInstant(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** unitCost × purchase FX (1 for AUD); null when either is unknown. */
export function unitCostAudOf(a: EngineOtherAsset): DecimalString | null {
  if (a.unitCost === null) return null;
  if (a.currency === 'AUD') return a.unitCost;
  if (a.purchaseFxRate === null) return null;
  return normaliseDecimal(new JoinrDecimal(a.unitCost).times(a.purchaseFxRate));
}

export interface BullionInputsArgs {
  /** `otherAssetsInput().assets` (the rows' pricing, ounces, dates, costs). */
  assets: readonly EngineOtherAsset[];
  /** `otherAssets().assets` (the engine results the Other Assets page shows). */
  results: readonly OtherAssetResult[];
  /** The price service's market series. */
  series: readonly MarketQuoteItem[];
  /** `loadSeriesDayQuotes`. */
  seriesDays: ReadonlyMap<string, DayQuoteRow>;
}

export interface BullionGroup {
  input: BullionInput;
  /** The spot series' `fetched_at` (freshness), or null. */
  fetchedAt: string | null;
}

/** One `BullionInput` per metal with at least one held bullion row (silver, then gold). */
export function bullionInputs(args: BullionInputsArgs): BullionGroup[] {
  const resultById = new Map(args.results.map((r) => [r.id, r]));
  const series = new Map(args.series.map((s) => [s.seriesId, s]));
  const rowsByMetal = new Map<Metal, BullionRowInput[]>();
  for (const a of args.assets) {
    if (a.pricing.source !== 'bullion') continue;
    const result = resultById.get(a.id);
    if (result === undefined || !new JoinrDecimal(result.remainingUnits).greaterThan(0)) continue;
    const list = rowsByMetal.get(a.pricing.metal) ?? [];
    list.push({
      asset: result,
      ozPerUnit: a.pricing.ozPerUnit,
      purchaseDate: a.purchaseDate,
      unitCostAud: unitCostAudOf(a),
    });
    rowsByMetal.set(a.pricing.metal, list);
  }

  const audUsd = series.get('AUDUSD')?.value ?? null;
  const usdFx = audUsd === null ? null : convertToAud('1', 'USD', { audUsd, cross: () => null });
  const fxNow = usdFx !== null && 'fxRate' in usdFx ? usdFx.fxRate : null;

  const out: BullionGroup[] = [];
  for (const metal of METAL_ORDER) {
    const rows = rowsByMetal.get(metal);
    if (rows === undefined || rows.length === 0) continue;
    const def = BULLION_HOLDINGS[metal];
    const spotItem = series.get(def.spotSeries);
    const futures = series.get(def.futuresSeries)?.value ?? null;
    const spotAsOf = isoInstant(spotItem?.asOf);
    let spot: BullionInput['spot'] = null;
    if (spotItem !== undefined && spotItem.value !== null && spotAsOf !== null) {
      // The futures' USD price (for "Day % in USD"); when the series has no value, the spot back
      // in USD (it is the futures ÷ AUDUSD), else the spot itself.
      const nativePerOz =
        futures ??
        (audUsd !== null
          ? roundDerived(new JoinrDecimal(spotItem.value).times(audUsd))
          : spotItem.value);
      spot = {
        audPerOz: spotItem.value,
        nativePerOz,
        fxNow: fxNow ?? '1',
        asOf: spotAsOf,
      };
    }
    out.push({
      input: {
        metal,
        rows,
        spot,
        day: seriesDayRow(args.seriesDays.get(def.spotSeries), '1'),
        nativeDay: seriesDayRow(args.seriesDays.get(def.futuresSeries), null),
      },
      fetchedAt: isoInstant(spotItem?.fetchedAt),
    });
  }
  return out;
}
