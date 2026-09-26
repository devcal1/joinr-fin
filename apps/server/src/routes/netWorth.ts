// Net Worth route (stage-5.md §4.2, FROZEN endpoint): the dashboard. Registered with prefix /api;
// every response is no-store. The query (`unit`, `count`) is a view-only override of the chart
// settings: nothing is saved.
import type { EngineApi } from '@joinr/engine';
import { netWorthQuerySchema, type NetWorthPageResponse } from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { hasAppData } from '../db/queries/domain';
import { parseWith } from '../errors';
import { buildNetWorthPage } from '../history/pages';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface NetWorthRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const netWorthRoutes: FastifyPluginAsync<NetWorthRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/net-worth', async (request): Promise<NetWorthPageResponse> => {
    const query = parseWith(netWorthQuerySchema, request.query);
    return buildNetWorthPage(createFinanceContext(deps, request.log), query, {
      recorder: app.recorder.status(),
      hasAppData: hasAppData(deps.database.db),
    });
  });
};
