// GET /api/status (stage-1.md §3.2, §3.3): header freshness (prices, snapshots) and import state.
import type { AppStatus } from '@joinr/schema';
import { importRuns, snapshots } from '@joinr/schema/db';
import { count, desc, max } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase, Db } from '../db/database';
import { hasDomainData } from '../db/queries/domain';
import type { MarketDataService } from '../market/types';

export interface StatusRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
}

/** The status body: market data from the service, the rest from the database. */
export function readAppStatus(db: Db, market: MarketDataService): AppStatus {
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
  return {
    prices: { mode: price.mode, lastRefreshAt: price.lastRefreshAt, running: price.running },
    snapshots: { count: snap?.n ?? 0, latestPeriod: snap?.latest ?? null },
    import: {
      lastRunAt: lastRun?.startedAt ?? null,
      lastStatus: lastRun?.status ?? null,
      hasImportedData: hasDomainData(db),
    },
  };
}

export const statusRoutes: FastifyPluginAsync<StatusRouteOptions> = async (app, opts) => {
  app.get('/status', async (): Promise<AppStatus> => readAppStatus(opts.database.db, opts.market));
};
