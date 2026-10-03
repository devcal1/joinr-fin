// The market data service contract (stage-1.md §5.1, frozen).
import type {
  JobTrigger,
  ManualPriceInput,
  MarketDataMode,
  MarketQuoteItem,
  PriceItem,
  PriceSourceInput,
  PricesResponse,
  RefreshSummary,
} from '@joinr/schema';

export type { Clock } from '../scheduler/types';

export interface MarketDataStatus {
  mode: MarketDataMode;
  running: boolean;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
}

export interface MarketDataService {
  /** Throws MarketDataDisabledError in mode 'off'. Joins a run already in flight. */
  refresh(opts?: {
    instrumentIds?: number[];
    force?: boolean;
    trigger?: JobTrigger;
  }): Promise<RefreshSummary>;
  getPrices(): PricesResponse;
  getSeries(): MarketQuoteItem[];
  /** Throws HttpError(404) when the instrument is unknown. */
  setManualPrice(instrumentId: number, input: ManualPriceInput): PriceItem;
  clearManualPrice(instrumentId: number): PriceItem;
  setPriceSource(instrumentId: number, input: PriceSourceInput): PriceItem;
  /** Schedules a refresh in ~5 s (mode live/fake), coalesced. */
  notifyInstrumentsChanged(): void;
  status(): MarketDataStatus;
  /**
   * Stage 9 (stage-9.md §5.6, FROZEN): clears the `intraday` timer; idempotent. server-api calls it
   * first in `preClose`. A no-op until the intraday job lands.
   */
  stop(): void;
}

/** `POST /api/prices/refresh` in mode `off` → 503 MARKET_DATA_DISABLED. */
export class MarketDataDisabledError extends Error {
  readonly code = 'MARKET_DATA_DISABLED';
  readonly statusCode = 503;

  constructor(message = 'Market data is switched off (MARKET_DATA_MODE=off)') {
    super(message);
    this.name = 'MarketDataDisabledError';
  }
}
