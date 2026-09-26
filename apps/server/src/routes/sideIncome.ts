// Side Income routes (stage-3.md §4.2, FROZEN endpoints): the page, dated deposits (D57) and
// income streams. Registered with prefix /api; every response is no-store. Every mutation answers
// 409 IMPORT_IN_PROGRESS first while an upload import runs.
import type { EngineApi } from '@joinr/engine';
import type {
  DeletedResponse,
  DepositMutationResponse,
  IncomeStreamMutationResponse,
  SideIncomePageResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import {
  createDeposit,
  createStream,
  deleteDeposit,
  deleteStream,
  updateDeposit,
  updateStream,
} from '../cashflow/mutations/sideIncome';
import { depositResponse, streamResponse } from '../cashflow/responses';
import { buildSideIncomePage } from '../cashflow/sideIncome';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface SideIncomeRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const sideIncomeRoutes: FastifyPluginAsync<SideIncomeRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/side-income', async (request): Promise<SideIncomePageResponse> =>
    buildSideIncomePage(createFinanceContext(deps, request.log)),
  );

  // ─── Deposits ─────────────────────────────────────────────────────────────────────────────────

  app.post('/side-income/deposits', async (request, reply): Promise<DepositMutationResponse> => {
    const id = createDeposit(deps, request.body);
    reply.code(201);
    return depositResponse(deps, id, request.log);
  });

  app.put('/side-income/deposits/:id', async (request): Promise<DepositMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateDeposit(deps, id, request.body);
    return depositResponse(deps, id, request.log);
  });

  app.delete('/side-income/deposits/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteDeposit(deps, id);
    return { id };
  });

  // ─── Streams ──────────────────────────────────────────────────────────────────────────────────

  app.post(
    '/side-income/streams',
    async (request, reply): Promise<IncomeStreamMutationResponse> => {
      const id = createStream(deps, request.body);
      reply.code(201);
      return streamResponse(deps, id, request.log);
    },
  );

  app.put('/side-income/streams/:id', async (request): Promise<IncomeStreamMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateStream(deps, id, request.body);
    return streamResponse(deps, id, request.log);
  });

  app.delete('/side-income/streams/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteStream(deps, id);
    return { id };
  });
};
