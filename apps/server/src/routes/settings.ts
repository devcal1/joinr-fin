// Settings routes (stage-3.md §3.3, §4.2 and stage-5.md §4.2, FROZEN endpoints): PATCH the editable
// keys; GET the Settings page (Stage 5). Registered with prefix /api; every response is no-store.
// The PATCH answers 409 IMPORT_IN_PROGRESS first while an upload import runs; after the commit, a
// written `history.autoRecord` tells the recorder to re-read its switch (§4.5, §4.6).
import type { EngineApi } from '@joinr/engine';
import type { SettingsPageResponse, SettingsPatchResponse } from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { financeDeps } from '../cashflow/context';
import { patchSettings } from '../cashflow/mutations/settings';
import { settingsResponse } from '../cashflow/responses';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';
import { buildSettingsPage } from '../settings/page';

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

  app.get('/settings', async (request): Promise<SettingsPageResponse> =>
    buildSettingsPage(deps, opts.config, app.recorder.status(), request.log),
  );

  app.patch('/settings', async (request): Promise<SettingsPatchResponse> => {
    const { keys, written } = patchSettings(deps, request.body, {
      autoRecordLocked: opts.config.autoRecord !== null,
    });
    if (written.includes('history.autoRecord')) app.recorder.settingsChanged();
    return settingsResponse(deps, keys, request.log);
  });
};
