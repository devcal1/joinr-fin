// Price service DTOs and request schemas (stage-1.md §3.2–3.3, frozen).
import { z } from 'zod';
import {
  PRICE_PROVIDERS,
  type InstrumentKind,
  type JobStatus,
  type JobTrigger,
  type ManualOrigin,
  type MarketDataMode,
  type PriceProvider,
  type PriceSource,
  type PriceStatus,
  type SymbolOrigin,
} from '../enums';
import { IsoDateSchema, PositiveDecimalSchema } from '../primitives';

export interface PriceItem {
  instrumentId: number;
  kind: InstrumentKind;
  symbol: string;
  name: string | null;
  watched: boolean;
  held: boolean;
  heldUnits: string;
  provider: PriceProvider;
  providerSymbol: string | null;
  symbolOrigin: SymbolOrigin;
  status: PriceStatus;
  /** Effective AUD price: manual wins, else the last good fetched price. */
  price: string | null;
  priceSource: 'manual' | PriceSource | null;
  /** Of the effective price. */
  asOf: string | null;
  fetched: {
    price: string;
    nativePrice: string | null;
    nativeCurrency: string | null;
    fxRate: string | null;
    asOf: string;
    fetchedAt: string;
    source: PriceSource;
  } | null;
  manual: { price: string; asOf: string; note: string | null; origin: ManualOrigin } | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export type MarketQuoteStatus = 'fresh' | 'stale' | 'failed' | 'none';

export interface MarketQuoteItem {
  seriesId: string;
  label: string;
  value: string | null;
  unit: string;
  asOf: string | null;
  fetchedAt: string | null;
  source: string | null;
  status: MarketQuoteStatus;
  lastError: string | null;
}

export interface JobRunSummary {
  id: number;
  job: string;
  trigger: JobTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  detail: Record<string, unknown> | null;
  error: string | null;
}

export interface PricesResponse {
  mode: MarketDataMode;
  refreshIntervalMinutes: number;
  running: boolean;
  lastRun: JobRunSummary | null;
  nextRefreshAt: string | null;
  /** Held first, then kind order (INSTRUMENT_KINDS), then instrument sort order. */
  items: PriceItem[];
  series: MarketQuoteItem[];
}

export interface RefreshSummary {
  jobRunId: number | null;
  requested: number;
  ok: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface RefreshResponse {
  summary: RefreshSummary;
  prices: PricesResponse;
}

export interface MarketSeriesResponse {
  series: MarketQuoteItem[];
}

/** `POST /api/prices/refresh` body (an empty body is `{}`). */
export const refreshRequestSchema = z.strictObject({
  instrumentIds: z.array(z.number().int().positive()).max(500).optional(),
  force: z.boolean().optional(),
});
export type RefreshRequest = z.output<typeof refreshRequestSchema>;

function localIsoDate(d: Date): string {
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}`;
}

/** The manual-price body schema with an injectable clock (the as-of date may not be after tomorrow). */
export function makeManualPriceInputSchema(now: () => Date = () => new Date()) {
  return z.strictObject({
    price: PositiveDecimalSchema(8, 1e9),
    asOf: IsoDateSchema.refine(
      (asOf) => {
        const n = now();
        const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
        return asOf <= localIsoDate(tomorrow);
      },
      { error: 'must not be after tomorrow' },
    ),
    note: z.string().trim().max(200).optional(),
  });
}

/** `PUT /api/prices/:instrumentId/manual` body: price > 0 (≤ 8 dp, ≤ 1e9), as-of date, note. */
export const manualPriceInputSchema = makeManualPriceInputSchema();
export type ManualPriceInput = z.output<typeof manualPriceInputSchema>;

export const PROVIDER_SYMBOL_RE = /^[A-Za-z0-9.^=\-_:]+$/;

/** `PUT /api/prices/:instrumentId/source` body; a symbol is required unless the provider is `none`. */
export const priceSourceInputSchema = z
  .strictObject({
    provider: z.enum(PRICE_PROVIDERS),
    providerSymbol: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(PROVIDER_SYMBOL_RE, { error: 'may contain only letters, digits and . ^ = - _ :' })
      .nullable(),
  })
  .refine((v) => v.provider === 'none' || v.providerSymbol !== null, {
    error: 'a symbol is required for this provider',
    path: ['providerSymbol'],
  });
export type PriceSourceInput = z.output<typeof priceSourceInputSchema>;
