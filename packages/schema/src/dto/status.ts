// `GET /api/status` (stage-1.md §3.3, frozen): header freshness and import state.
import type { MarketDataMode, RunStatus } from '../enums';

export interface AppStatus {
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  snapshots: { count: number; latestPeriod: string | null };
  import: { lastRunAt: string | null; lastStatus: RunStatus | null; hasImportedData: boolean };
}
