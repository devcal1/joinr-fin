// Super routes (stage-4.md §4.2, FROZEN endpoints): the page, funds, the D69 balance log, typed
// contributions (D71) and SG statements (an overlay). Registered with prefix /api; every response
// is no-store. The `super_option` notes use the Stage 3 period-notes route. Every mutation answers
// 409 IMPORT_IN_PROGRESS first while an upload import runs, then runs in one IMMEDIATE transaction
// with the D34 origin rules (§3.4: the SG-fund flag alone keeps `origin`).
import type { EngineApi } from '@joinr/engine';
import type {
  DeletedResponse,
  IsoMonth,
  SgOverrideResponse,
  SuperBalancesResponse,
  SuperContributionMutationResponse,
  SuperFundMutationResponse,
  SuperPageResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import {
  createSuperContribution,
  createSuperFund,
  deleteSgOverride,
  deleteSuperBalanceEntry,
  deleteSuperContribution,
  deleteSuperFund,
  putSgOverride,
  saveSuperBalances,
  updateSuperContribution,
  updateSuperFund,
} from '../assets/mutations/super';
import {
  sgOverrideResponse,
  superBalancesResponse,
  superContributionResponse,
  superFundResponse,
} from '../assets/responses';
import { buildSuperPage } from '../assets/super';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface SuperRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const superRoutes: FastifyPluginAsync<SuperRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/super', async (request): Promise<SuperPageResponse> =>
    buildSuperPage(createFinanceContext(deps, request.log)),
  );

  // ─── Funds and balances (D69) ─────────────────────────────────────────────────────────────────

  app.post('/super/funds', async (request, reply): Promise<SuperFundMutationResponse> => {
    const id = createSuperFund(deps, request.body);
    reply.code(201);
    return superFundResponse(deps, id, request.log);
  });

  app.put('/super/funds/:id', async (request): Promise<SuperFundMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateSuperFund(deps, id, request.body);
    return superFundResponse(deps, id, request.log);
  });

  app.delete('/super/funds/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteSuperFund(deps, id);
    return { id };
  });

  app.put('/super/balances', async (request): Promise<SuperBalancesResponse> => {
    const ids = saveSuperBalances(deps, request.body);
    return superBalancesResponse(deps, ids, request.log);
  });

  app.delete('/super/balance-entries/:id', async (request): Promise<SuperFundMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    const fundId = deleteSuperBalanceEntry(deps, id);
    return superFundResponse(deps, fundId, request.log);
  });

  // ─── Contributions (D71) ──────────────────────────────────────────────────────────────────────

  app.post(
    '/super/contributions',
    async (request, reply): Promise<SuperContributionMutationResponse> => {
      const id = createSuperContribution(deps, request.body);
      reply.code(201);
      return superContributionResponse(deps, id, request.log);
    },
  );

  app.put(
    '/super/contributions/:id',
    async (request): Promise<SuperContributionMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      updateSuperContribution(deps, id, request.body);
      return superContributionResponse(deps, id, request.log);
    },
  );

  app.delete('/super/contributions/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteSuperContribution(deps, id);
    return { id };
  });

  // ─── SG statements (an overlay) ───────────────────────────────────────────────────────────────

  app.put('/super/sg/:periodMonth', async (request): Promise<SgOverrideResponse> => {
    const month = putSgOverride(deps, request.params, request.body);
    return sgOverrideResponse(deps, month, request.log);
  });

  app.delete('/super/sg/:periodMonth', async (request): Promise<{ periodMonth: IsoMonth }> => ({
    periodMonth: deleteSgOverride(deps, request.params),
  }));
};
