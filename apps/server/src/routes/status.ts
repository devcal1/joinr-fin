// GET /api/status (stage-1.md §3.2, §3.3): header freshness (prices, snapshots) and import state.
// Stage 5 (stage-5.md §3.2, §4.5, additive): every `features.*` switch (default true; the navigation
// hides a page that is off, §6.6) and the recorder's switch with its next month-end record time.
import { SETTING_KEYS, type AppStatus, type FeatureKey, type SettingKey } from '@joinr/schema';
import { importRuns, snapshots } from '@joinr/schema/db';
import { count, desc, max } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase, Db } from '../db/database';
import { hasDomainData } from '../db/queries/domain';
import { booleanSetting, readSettings } from '../db/queries/settings';
import type { SnapshotRecorder } from '../history/recorder';
import type { MarketDataService } from '../market/types';

export interface StatusRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
}

/** The 11 `features.*` keys, in registry order. */
export const FEATURE_KEYS = SETTING_KEYS.filter((k: SettingKey): k is FeatureKey =>
  k.startsWith('features.'),
);

/** Every feature switch: the stored value, else on (the registry default, §3.3). */
export function readFeatures(db: Db): Record<FeatureKey, boolean> {
  const values = readSettings(db);
  return Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, booleanSetting(values, k) ?? true]),
  ) as Record<FeatureKey, boolean>;
}

/**
 * The status body: market data from the service, the rest from the database; the recorder's switch
 * when the app has one (a bare status plugin in a test has none, so `history` is left out).
 */
export function readAppStatus(
  db: Db,
  market: MarketDataService,
  recorder?: Pick<SnapshotRecorder, 'status'>,
): AppStatus {
  const price = market.status();
  const snap = db
    .select({ n: count(), latest: max(snapshots.periodMonth) })
    .from(snapshots)
    .get();
  const lastRun = db
    .select({ startedAt: importRuns.startedAt, status: importRuns.status })
    .from(importRuns)
    .orderBy(desc(importRuns.startedAt), desc(importRuns.id))
    .limit(1)
    .get();
  const status: AppStatus = {
    prices: { mode: price.mode, lastRefreshAt: price.lastRefreshAt, running: price.running },
    snapshots: { count: snap?.n ?? 0, latestPeriod: snap?.latest ?? null },
    import: {
      lastRunAt: lastRun?.startedAt ?? null,
      lastStatus: lastRun?.status ?? null,
      hasImportedData: hasDomainData(db),
    },
    features: readFeatures(db),
  };
  if (recorder) {
    const r = recorder.status();
    status.history = { autoRecord: r.autoRecord.enabled, nextRecordAt: r.nextRunAt };
  }
  return status;
}

export const statusRoutes: FastifyPluginAsync<StatusRouteOptions> = async (app, opts) => {
  app.get('/status', async (): Promise<AppStatus> =>
    readAppStatus(
      opts.database.db,
      opts.market,
      app.hasDecorator('recorder') ? app.recorder : undefined,
    ),
  );
};
