// Cash routes (stage-3.md §4.2, FROZEN endpoints): accounts, balances, adjustments, period notes
// and savings goals. Registered with prefix /api; every response is no-store. The page is built
// from the DB and the price service by the engine (`cashflow/**`); every mutation answers 409
// IMPORT_IN_PROGRESS first while an upload import runs, then runs in one IMMEDIATE transaction
// with the D34 origin rules (§3.4).
import type { EngineApi } from '@joinr/engine';
import type {
  CashAccountMutationResponse,
  CashBalancesResponse,
  CashPageResponse,
  DeletedResponse,
  IsoMonth,
  PeriodNoteResponse,
  SavingsAdjustmentDto,
  SavingsGoalMutationResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { buildCashPage } from '../cashflow/cash';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import {
  createCashAccount,
  createGoal,
  deleteAdjustment,
  deleteBalanceEntry,
  deleteCashAccount,
  deleteGoal,
  putAdjustment,
  putPeriodNote,
  reorderGoals,
  saveBalances,
  updateCashAccount,
  updateGoal,
} from '../cashflow/mutations/cash';
import { accountResponse, balancesResponse, goalResponse } from '../cashflow/responses';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface CashRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const cashRoutes: FastifyPluginAsync<CashRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/cash', async (request): Promise<CashPageResponse> =>
    buildCashPage(createFinanceContext(deps, request.log)),
  );

  // ─── Accounts and balances ────────────────────────────────────────────────────────────────────

  app.post('/cash/accounts', async (request, reply): Promise<CashAccountMutationResponse> => {
    const id = createCashAccount(deps, request.body);
    reply.code(201);
    return accountResponse(deps, id, request.log);
  });

  app.put('/cash/accounts/:id', async (request): Promise<CashAccountMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateCashAccount(deps, id, request.body);
    return accountResponse(deps, id, request.log);
  });

  app.delete('/cash/accounts/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteCashAccount(deps, id);
    return { id };
  });

  app.put('/cash/balances', async (request): Promise<CashBalancesResponse> => {
    const ids = saveBalances(deps, request.body);
    return balancesResponse(deps, ids, request.log);
  });

  app.delete('/cash/balance-entries/:id', async (request): Promise<CashAccountMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    const accountId = deleteBalanceEntry(deps, id);
    return accountResponse(deps, accountId, request.log);
  });

  // ─── Adjustments (D51) and period notes ───────────────────────────────────────────────────────

  app.put('/cash/adjustments/:periodMonth', async (request): Promise<SavingsAdjustmentDto> =>
    putAdjustment(deps, request.params, request.body),
  );

  app.delete(
    '/cash/adjustments/:periodMonth',
    async (request): Promise<{ periodMonth: IsoMonth }> => ({
      periodMonth: deleteAdjustment(deps, request.params),
    }),
  );

  app.put('/period-notes/:kind/:periodMonth', async (request): Promise<PeriodNoteResponse> => ({
    note: putPeriodNote(deps, request.params, request.body),
  }));

  // ─── Savings goals (D55) ──────────────────────────────────────────────────────────────────────

  app.post('/savings-goals', async (request, reply): Promise<SavingsGoalMutationResponse> => {
    const id = createGoal(deps, request.body);
    reply.code(201);
    return goalResponse(deps, id, request.log);
  });

  app.post('/savings-goals/reorder', async (request): Promise<{ ids: number[] }> => ({
    ids: reorderGoals(deps, request.body),
  }));

  app.put('/savings-goals/:id', async (request): Promise<SavingsGoalMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateGoal(deps, id, request.body);
    return goalResponse(deps, id, request.log);
  });

  app.delete('/savings-goals/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteGoal(deps, id);
    return { id };
  });
};
