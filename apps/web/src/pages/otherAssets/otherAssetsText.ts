// The Other Assets page's one open editor (stage-4.md §6.7: one inline form at a time), the
// row-action keys focus returns to, and the page's words (§6.3, §6.9). No components.
import {
  OTHER_ASSET_STALE_DAYS_DEFAULT,
  type IsoDate,
  type OtherAssetDto,
  type OtherAssetSaleDto,
  type OtherAssetsPageResponse,
  type Metal,
} from '@joinr/schema';
import { formatDate, formatMoney, formatQuantity } from '@joinr/ui';
import { parseTimestamp, plural } from '../../formatting';
import { daysBetween } from '../investments/display';
import { shortName, type MarkerId } from '../assets/display';

export type OtherAssetsEditor =
  | { form: 'asset'; asset?: OtherAssetDto; opener: string }
  | { form: 'prices'; opener: string }
  | { form: 'sale'; asset: OtherAssetDto; sale?: OtherAssetSaleDto; opener: string }
  | { form: 'settings'; opener: string };

/** The data-cf-action key of an item row's or a sale row's buttons (focus returns there). */
export function assetActionKey(
  action: 'edit' | 'sell' | 'history' | 'current',
  id: number,
): string {
  return `asset-${action}-${id}`;
}

export function saleActionKey(action: 'edit' | 'delete', id: number): string {
  return `sale-${action}-${id}`;
}

export const METAL_LABELS: Readonly<Record<Metal, string>> = { silver: 'Silver', gold: 'Gold' };

export const NO_ASSETS = 'No other assets yet. Add one, or import the workbook on the';
export const COST_FOOTNOTE =
  'Cost counts items from their purchase date; undated items from the first recorded month (assumed).';
export const COST_TOTAL_NOTE =
  'Cost is the AUD cost of the units you still hold. The totals count items with both a value and a cost, so Value − Cost = Gain.';
export const MARKET_OFF_NOTE =
  'Market data is off: bullion uses its last known price and foreign items are unvalued.';
export const SPOT_EMPTY = 'Spot history starts with the first price refresh';

/** The Assumed callout (D73). */
export function assumedText(count: number, date: string): string {
  return `${count === 1 ? '1 item has' : `${count} items have`} no purchase date. Their return and the cost line count from the first recorded month (${formatDate(date)}), marked Assumed. Add a purchase date to replace it.`;
}

/** The purchase-FX callout. */
export function purchaseFxText(count: number): string {
  return `${count === 1 ? '1 item needs' : `${count} items need`} the exchange rate on their purchase date. It is fetched from Yahoo on the next price refresh, or type it in the item's form.`;
}

/** The live-FX callout (market on). */
export function liveFxText(count: number): string {
  return `${count === 1 ? '1 foreign item has' : `${count} foreign items have`} no current exchange rate yet, so ${count === 1 ? 'it shows' : 'they show'} no value until the next price refresh.`;
}

/** The markers of an item row, in cell order (Bought, Price, Return / yr). */
export function assetMarkers(asset: OtherAssetDto): MarkerId[] {
  const ids: MarkerId[] = [];
  if (asset.dateAssumed) ids.push('assumed');
  ids.push(...priceMarkers(asset));
  return ids;
}

/** The Price cell's marker: Stale, Spot, Last known or No price yet (never "Manual"). */
export function priceMarkers(asset: OtherAssetDto): MarkerId[] {
  if (asset.priceStatus === 'none') return ['noPriceYet'];
  if (asset.priceSource === 'bullion') {
    if (asset.flags.includes('spot_unavailable')) return ['lastKnown'];
    return asset.priceStatus === 'stale' ? ['stale'] : ['spot'];
  }
  return asset.priceStatus === 'stale' ? ['stale'] : [];
}

/** The price history's item: the chosen one, else the one with the most price entries. */
export function chosenHistoryAsset(
  page: Pick<OtherAssetsPageResponse, 'assets'>,
  assetId: number | null,
): OtherAssetDto | null {
  const chosen = page.assets.find((a) => a.id === assetId);
  if (chosen) return chosen;
  return [...page.assets].sort((a, b) => b.priceEntryCount - a.priceEntryCount)[0] ?? null;
}

/** Oz held per metal (remaining units × oz per unit), in metal order. */
export function ozHeld(assets: readonly OtherAssetDto[]): { metal: Metal; oz: number }[] {
  const totals = new Map<Metal, number>();
  for (const asset of assets) {
    if (asset.priceSource !== 'bullion' || asset.metal === null) continue;
    const oz = Number(asset.remainingUnits) * Number(asset.ozPerUnit ?? '0');
    if (!Number.isFinite(oz) || oz <= 0) continue;
    totals.set(asset.metal, (totals.get(asset.metal) ?? 0) + oz);
  }
  return (['silver', 'gold'] as const)
    .filter((metal) => totals.has(metal))
    .map((metal) => ({ metal, oz: totals.get(metal) ?? 0 }));
}

/** "You hold 10 oz of silver · 1 oz of gold", or "No bullion held". */
export function ozHeldText(assets: readonly OtherAssetDto[]): string {
  const held = ozHeld(assets);
  if (held.length === 0) return 'No bullion held';
  return `You hold ${held
    .map(({ metal, oz }) => `${formatQuantity(oz)} oz of ${METAL_LABELS[metal].toLowerCase()}`)
    .join(' · ')}`;
}

/** The local calendar date of a market timestamp ('2026-09-21T04:00:00Z' → '2026-09-21'). */
export function localDateOf(timestamp: string | null): string | null {
  const date = parseTimestamp(timestamp);
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Gold spot 3 days old" for each stale metal (days from its date to the page's as-of). */
export function staleSpotTexts(page: OtherAssetsPageResponse): string[] {
  return page.spot.flatMap((spot) => {
    if (spot.status !== 'stale') return [];
    const date = localDateOf(spot.asOf);
    const days = date ? Math.max(0, daysBetween(date, page.asOf)) : null;
    return [
      days === null
        ? `${METAL_LABELS[spot.metal]} spot is stale`
        : `${METAL_LABELS[spot.metal]} spot ${plural(days, 'day')} old`,
    ];
  });
}

/** "Silver $50.00/oz · Gold $4,000.00/oz" (a missing metal shows "—"). */
export function spotLine(page: OtherAssetsPageResponse): string | null {
  if (page.spot.every((spot) => spot.audPerOz === null)) return null;
  return page.spot
    .map((spot) => {
      const cents = spot.audPerOz === null ? null : Math.round(Number(spot.audPerOz) * 100);
      return `${METAL_LABELS[spot.metal]} ${cents === null || !Number.isFinite(cents) ? '—' : `${formatMoney(cents)}/oz`}`;
    })
    .join(' · ');
}

/** The latest spot date shown under the line. */
export function spotAsOf(page: OtherAssetsPageResponse): string | null {
  const dates = page.spot.map((spot) => localDateOf(spot.asOf)).filter((d): d is string => !!d);
  return dates.sort().at(-1) ?? null;
}

/** "Showing <short name> price history" (the live region after a row's Price history). */
export function historyAnnouncement(asset: OtherAssetDto): string {
  return `Showing ${shortName(asset.description)} price history`;
}

/** The stale-price days in force (the setting, else 90; D77). */
export function staleDaysOf(page: Pick<OtherAssetsPageResponse, 'settings'>): number {
  const value = page.settings.values['otherAssets.stalePriceDays'];
  return typeof value === 'number' ? value : OTHER_ASSET_STALE_DAYS_DEFAULT;
}

/** The units a sale may take: those left, plus the sale's own when editing it. */
export function sellableUnits(asset: OtherAssetDto, sale?: OtherAssetSaleDto): number {
  return Number(asset.remainingUnits) + (sale ? Number(sale.units) : 0);
}

export interface PriceEdit {
  /** Price text per hand-priced item (the item's currency). */
  drafts: Readonly<Record<number, string>>;
  /** Still current ticked (save the unchanged price at the shared date). */
  current: Readonly<Record<number, boolean>>;
  asOf: IsoDate | null;
  pending: boolean;
  onDraft: (id: number, value: string) => void;
  onCurrent: (id: number, checked: boolean) => void;
}

/** A hand-priced row whose price changed, or whose Still current box is ticked. */
export function priceRowChanged(edit: PriceEdit, asset: OtherAssetDto): boolean {
  if (asset.priceSource !== 'manual') return false;
  const draft = edit.drafts[asset.id] ?? '';
  if (draft !== '' && (asset.unitPrice === null || Number(draft) !== Number(asset.unitPrice))) {
    return true;
  }
  return edit.current[asset.id] === true && asset.unitPrice !== null;
}
