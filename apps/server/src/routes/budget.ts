// Budget routes (stage-3.md §4.2, FROZEN endpoints): the live Budget page, items, the automatic
// rows (D54), the display order and the yearly expenses. Registered with prefix /api; every
// response is no-store. Every mutation answers 409 IMPORT_IN_PROGRESS first while an upload import
// runs.
import type { EngineApi } from '@joinr/engine';
import type {
  BudgetItemMutationResponse,
  BudgetPageResponse,
  DeletedResponse,
  YearlyExpenseMutationResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { buildBudgetPage } from '../cashflow/budget';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import {
  createItem,
  createYearlyExpense,
  deleteItem,
  deleteYearlyExpense,
  putAutoRow,
  reorderItems,
  updateItem,
  updateYearlyExpense,
} from '../cashflow/mutations/budget';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import { budgetRowResponse, yearlyExpenseResponse } from '../cashflow/responses';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface BudgetRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const budgetRoutes: FastifyPluginAsync<BudgetRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/budget', async (request): Promise<BudgetPageResponse> =>
    buildBudgetPage(createFinanceContext(deps, request.log)),
  );

  // ─── Items and the automatic rows ─────────────────────────────────────────────────────────────

  app.post('/budget/items', async (request, reply): Promise<BudgetItemMutationResponse> => {
    const id = createItem(deps, request.body);
    reply.code(201);
    return budgetRowResponse(deps, id, request.log);
  });

  app.post('/budget/items/reorder', async (request): Promise<{ ids: number[] }> => ({
    ids: reorderItems(deps, request.body),
  }));

  app.put('/budget/items/:id', async (request): Promise<BudgetItemMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateItem(deps, id, request.body);
    return budgetRowResponse(deps, id, request.log);
  });

  app.delete('/budget/items/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteItem(deps, id);
    return { id };
  });

  app.put('/budget/auto/:kind', async (request): Promise<BudgetItemMutationResponse> => {
    const id = putAutoRow(deps, request.params, request.body);
    return budgetRowResponse(deps, id, request.log);
  });

  // ─── Yearly expenses ──────────────────────────────────────────────────────────────────────────

  app.post(
    '/budget/yearly-expenses',
    async (request, reply): Promise<YearlyExpenseMutationResponse> => {
      const id = createYearlyExpense(deps, request.body);
      reply.code(201);
      return yearlyExpenseResponse(deps, id, request.log);
    },
  );

  app.put(
    '/budget/yearly-expenses/:id',
    async (request): Promise<YearlyExpenseMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      updateYearlyExpense(deps, id, request.body);
      return yearlyExpenseResponse(deps, id, request.log);
    },
  );

  app.delete('/budget/yearly-expenses/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteYearlyExpense(deps, id);
    return { id };
  });
};
