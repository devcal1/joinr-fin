// Display helpers for the prices page (stage-1.md §5.6, §6.5).
import type {
  InstrumentKind,
  MarketQuoteItem,
  PriceItem,
  PriceProvider,
  PricesResponse,
  RefreshSummary,
} from '@joinr/schema';
import { formatDate, formatPrice, formatQuantity } from '@joinr/ui';
import { formatTimeOrDateTime, parseTimestamp } from '../../formatting';

export const KIND_LABELS: Readonly<Record<InstrumentKind, string>> = {
  stock: 'Stock',
  etf: 'ETF',
  managed_fund: 'Managed fund',
  crypto: 'Crypto',
};

export function kindLabel(kind: string): string {
  return (KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

export const PROVIDER_LABELS: Readonly<Record<PriceProvider, string>> = {
  yahoo: 'Yahoo',
  coingecko: 'CoinGecko',
  none: 'None',
};

/** Where the effective price came from, in words. */
export function sourceLabel(item: Pick<PriceItem, 'priceSource'>): string | null {
  switch (item.priceSource) {
    case 'yahoo':
      return 'Yahoo';
    case 'coingecko':
      return 'CoinGecko';
    case 'manual':
      return 'Manual';
    case 'sheet':
      return 'From workbook';
    case 'fake':
      return 'Test prices';
    default:
      return null;
  }
}

/** A price with 2–4 decimals, or up to 8 below $1 (small coins and unit prices). */
export function formatItemPrice(price: string): string {
  const small = Math.abs(Number(price)) < 1;
  return formatPrice(price, { maxDp: small ? 8 : 4 });
}

/** A timestamp or IsoDate as a date only (`24/09/2026`). */
function dateOf(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  const date = parseTimestamp(value);
  return date ? formatDate(date) : null;
}

/**
 * Why an item is not fresh, in words ("From workbook 31/08/2026", "No price source", the last
 * error), or null when the badge says it all.
 */
export function statusReason(item: PriceItem): string | null {
  switch (item.status) {
    case 'none':
      if (item.provider === 'none') return 'No price source';
      return item.lastError ?? 'Not fetched yet';
    case 'failed':
      return item.lastError ?? 'The last fetch failed';
    case 'stale': {
      if (item.priceSource === 'sheet') {
        const date = dateOf(item.asOf);
        return date ? `From workbook ${date}` : 'From workbook';
      }
      if (item.priceSource === 'manual') {
        const date = dateOf(item.asOf);
        return date ? `Manual price from ${date}` : 'Manual price is old';
      }
      return item.lastError;
    }
    default:
      return null;
  }
}

/** "Refreshed 14:32 · next 15:32", "Refreshed 22/09/2026 09:15", or "Not refreshed yet". */
export function refreshLine(prices: PricesResponse, now: Date): string {
  const last = prices.lastRun ? (prices.lastRun.finishedAt ?? prices.lastRun.startedAt) : null;
  const refreshed = formatTimeOrDateTime(last, now);
  const next = prices.mode === 'off' ? null : formatTimeOrDateTime(prices.nextRefreshAt, now);
  const head = refreshed ? `Refreshed ${refreshed}` : 'Not refreshed yet';
  return next ? `${head} · next ${next}` : head;
}

/** "18 prices updated; 1 failed." (the callout title already says "Prices refreshed"). */
export function refreshSummaryText(summary: RefreshSummary): string {
  const parts = [`${summary.ok} price${summary.ok === 1 ? '' : 's'} updated`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  return `${parts.join('; ')}.`;
}

/** Built-in series first (AUD/USD, silver and gold in AUD, then the raw USD futures), then FX. */
const SERIES_ORDER = ['AUDUSD', 'XAG_AUD_OZ', 'XAU_AUD_OZ', 'SI_USD_OZ', 'GC_USD_OZ'];

export function orderSeries(series: readonly MarketQuoteItem[]): MarketQuoteItem[] {
  const rank = (id: string): number => {
    const index = SERIES_ORDER.indexOf(id);
    return index === -1 ? SERIES_ORDER.length : index;
  };
  return [...series].sort(
    (a, b) => rank(a.seriesId) - rank(b.seriesId) || a.seriesId.localeCompare(b.seriesId),
  );
}

/** `$46.15` (AUD per …), `US$2,600.00` (USD per …), otherwise `0.65 USD per AUD`. */
export function formatSeriesValue(item: Pick<MarketQuoteItem, 'value' | 'unit'>): string | null {
  if (item.value === null) return null;
  try {
    if (item.unit.startsWith('AUD per')) return formatPrice(item.value, { maxDp: 2 });
    if (item.unit.startsWith('USD per') && item.unit !== 'USD per AUD') {
      return `US${formatPrice(item.value, { maxDp: 2 })}`;
    }
    return `${formatQuantity(item.value, { maxDp: 4 })} ${item.unit}`;
  } catch {
    return item.value;
  }
}

/** Held units with up to 8 decimals. */
export function formatUnits(units: string): string {
  try {
    return formatQuantity(units, { maxDp: 8 });
  } catch {
    return units;
  }
}
