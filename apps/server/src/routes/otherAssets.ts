// Other Assets routes (stage-4.md §4.2, FROZEN endpoints): the page, assets, the D72 price log and
// sales. Registered with prefix /api; every response is no-store. The page is built from the DB,
// the price service's series and the engine (`assets/**`); every mutation answers 409
// IMPORT_IN_PROGRESS first while an upload import runs, then runs in one IMMEDIATE transaction
// with the D34 origin rules (§3.4).
import type { EngineApi } from '@joinr/engine';
import type {
  DeletedResponse,
  OtherAssetMutationResponse,
  OtherAssetPricesResponse,
  OtherAssetsPageResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import {
  createOtherAsset,
  createOtherAssetSale,
  deleteOtherAsset,
  deleteOtherAssetPriceEntry,
  deleteOtherAssetSale,
  reorderOtherAssets,
  saveOtherAssetPrices,
  updateOtherAsset,
  updateOtherAssetSale,
} from '../assets/mutations/otherAssets';
import { buildOtherAssetsPage } from '../assets/otherAssets';
import { otherAssetPricesResponse, otherAssetResponse } from '../assets/responses';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface OtherAssetsRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const otherAssetsRoutes: FastifyPluginAsync<OtherAssetsRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/other-assets', async (request): Promise<OtherAssetsPageResponse> =>
    buildOtherAssetsPage(createFinanceContext(deps, request.log)),
  );

  // ─── Assets ───────────────────────────────────────────────────────────────────────────────────

  app.post('/other-assets', async (request, reply): Promise<OtherAssetMutationResponse> => {
    const id = createOtherAsset(deps, request.body, request.log);
    reply.code(201);
    return otherAssetResponse(deps, id, request.log);
  });

  app.post('/other-assets/reorder', async (request): Promise<{ ids: number[] }> => ({
    ids: reorderOtherAssets(deps, request.body),
  }));

  app.put('/other-assets/:id', async (request): Promise<OtherAssetMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateOtherAsset(deps, id, request.body, request.log);
    return otherAssetResponse(deps, id, request.log);
  });

  app.delete('/other-assets/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteOtherAsset(deps, id);
    return { id };
  });

  // ─── Prices (D72) ─────────────────────────────────────────────────────────────────────────────

  app.put('/other-assets/prices', async (request): Promise<OtherAssetPricesResponse> => {
    const ids = saveOtherAssetPrices(deps, request.body);
    return otherAssetPricesResponse(deps, ids, request.log);
  });

  app.delete(
    '/other-assets/price-entries/:id',
    async (request): Promise<OtherAssetMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      const assetId = deleteOtherAssetPriceEntry(deps, id);
      return otherAssetResponse(deps, assetId, request.log);
    },
  );

  // ─── Sales (D72) ──────────────────────────────────────────────────────────────────────────────

  app.post(
    '/other-assets/:id/sales',
    async (request, reply): Promise<OtherAssetMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      const assetId = createOtherAssetSale(deps, id, request.body);
      reply.code(201);
      return otherAssetResponse(deps, assetId, request.log);
    },
  );

  app.put('/other-assets/sales/:id', async (request): Promise<OtherAssetMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    const assetId = updateOtherAssetSale(deps, id, request.body);
    return otherAssetResponse(deps, assetId, request.log);
  });

  app.delete('/other-assets/sales/:id', async (request): Promise<OtherAssetMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    const assetId = deleteOtherAssetSale(deps, id);
    return otherAssetResponse(deps, assetId, request.log);
  });
};
