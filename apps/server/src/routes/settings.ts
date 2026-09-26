// Settings route (stage-3.md §3.3, §4.2, FROZEN endpoint): PATCH the editable keys. Registered
// with prefix /api; every response is no-store. Answers 409 IMPORT_IN_PROGRESS first while an
// upload import runs.
import type { EngineApi } from '@joinr/engine';
import type { SettingsPatchResponse } from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { financeDeps } from '../cashflow/context';
import { patchSettings } from '../cashflow/mutations/settings';
import { settingsResponse } from '../cashflow/responses';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface SettingsRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const settingsRoutes: FastifyPluginAsync<SettingsRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.patch('/settings', async (request): Promise<SettingsPatchResponse> => {
    const keys = patchSettings(deps, request.body);
    return settingsResponse(deps, keys, request.log);
  });
};
