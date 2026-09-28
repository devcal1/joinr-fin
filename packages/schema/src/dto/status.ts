// `GET /api/status` (stage-1.md §3.3, frozen): header freshness and import state. Stage 5
// (stage-5.md §3.2, §4.5) adds two optional fields, Stage 7 (stage-7.md §3.3) and Stage 8
// (stage-8.md §3.4) one more each, so the Stage 1 fixtures still compile.
import type { MarketDataMode, RunStatus } from '../enums';
import type { FeatureKey } from '../history';
import type { NasCopyConfigReason, NasCopyConfigState } from '../nasCopy';

export interface AppStatus {
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  snapshots: { count: number; latestPeriod: string | null };
  import: { lastRunAt: string | null; lastStatus: RunStatus | null; hasImportedData: boolean };
  /** Stage 5: every `features.*` value (default true). */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** Stage 5: the recorder's switch and its next month-end record time (ISO with offset). */
  history?: { autoRecord: boolean; nextRecordAt: string | null };
  /** Stage 7: the stale-backup flag (§5.4) and the newest nightly or manual file's createdAt. */
  backups?: { stale: boolean; lastBackupAt: string | null };
  /**
   * Stage 8: the NAS copy's problem flags for the every-page callout. `lastSuccessAt` is local ISO
   * with the server's offset (the page takes the date as `slice(0, 10)`), unlike the UTC
   * `NasCopyStatusDto.lastSuccessAt`.
   */
  nasCopy?: {
    configured: NasCopyConfigState;
    configReason: NasCopyConfigReason | null;
    blocked: boolean;
    stale: boolean;
    lastSuccessAt: string | null;
  };
}
