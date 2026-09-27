// FIRE routes (stage-6.md §4.2, FROZEN endpoints): `GET /api/fire` (saved settings, or a what-if
// query that saves nothing, D100) and `POST /api/fire/use-workbook-contribution` (owner question 1,
// D105). Registered with prefix /api and the cash-flow options; every response is no-store. The
// page answers whatever `features.fire` says (`featureOn` tells the web).
import type { EngineApi } from '@joinr/engine';
import { fireQuerySchema, type FirePageResponse, type SettingsPatchResponse } from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { hasAppData } from '../db/queries/domain';
import { parseWith } from '../errors';
import { buildFirePage } from '../fire/page';
import { readAccessAgeMarker } from '../fire/upgrade';
import { useWorkbookContribution } from '../fire/workbook';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface FireRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const fireRoutes: FastifyPluginAsync<FireRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);
  const { db } = opts.database;

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/fire', async (request): Promise<FirePageResponse> => {
    const query = parseWith(fireQuerySchema, request.query);
    return buildFirePage(createFinanceContext(deps, request.log), query, {
      hasAppData: hasAppData(db),
      marker: readAccessAgeMarker(db),
    });
  });

  app.post('/fire/use-workbook-contribution', async (request): Promise<SettingsPatchResponse> =>
    useWorkbookContribution(deps, request.log),
  );
};
