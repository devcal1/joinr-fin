// `GET /api/status` (stage-1.md §3.3, frozen): header freshness and import state. Stage 5
// (stage-5.md §3.2, §4.5) adds two optional fields, so the Stage 1 fixtures still compile.
import type { MarketDataMode, RunStatus } from '../enums';
import type { FeatureKey } from '../history';

export interface AppStatus {
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  snapshots: { count: number; latestPeriod: string | null };
  import: { lastRunAt: string | null; lastStatus: RunStatus | null; hasImportedData: boolean };
  /** Stage 5: every `features.*` value (default true). */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** Stage 5: the recorder's switch and its next month-end record time (ISO with offset). */
  history?: { autoRecord: boolean; nextRecordAt: string | null };
}
