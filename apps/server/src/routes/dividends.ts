// Dividends routes (stage-3.md §4.2, FROZEN endpoints): the page, the ledger CRUD and the Yahoo
// suggestions (D50): refresh (through the §4.6 DividendEventsService only), dismiss and restore.
// Registered with prefix /api; every response is no-store. Every mutation but the refresh answers
// 409 IMPORT_IN_PROGRESS first while an upload import runs.
import type { EngineApi } from '@joinr/engine';
import type {
  DeletedResponse,
  DividendEventKey,
  DividendEventsRefreshResponse,
  DividendMutationResponse,
  DividendsPageResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { buildDividendsPage, readEventsStatus } from '../cashflow/dividends';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import {
  createDividend,
  deleteDividend,
  setSuggestionDismissed,
  updateDividend,
} from '../cashflow/mutations/dividends';
import { dividendResponse } from '../cashflow/responses';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { errorBody } from '../errors';
import type { DividendEventsService } from '../market/dividends/index';
import { MarketDataDisabledError, type MarketDataService } from '../market/types';

export interface DividendsRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const dividendsRoutes: FastifyPluginAsync<DividendsRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);
  const service = opts.dividendEvents;

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/dividends', async (request): Promise<DividendsPageResponse> =>
    buildDividendsPage(createFinanceContext(deps, request.log), service),
  );

  // ─── The ledger ───────────────────────────────────────────────────────────────────────────────

  app.post('/dividends', async (request, reply): Promise<DividendMutationResponse> => {
    const id = createDividend(deps, request.body);
    reply.code(201);
    return dividendResponse(deps, id, request.log);
  });

  app.put('/dividends/:id', async (request): Promise<DividendMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateDividend(deps, id, request.body);
    return dividendResponse(deps, id, request.log);
  });

  app.delete('/dividends/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteDividend(deps, id);
    return { id };
  });

  // ─── Yahoo suggestions (D50) ──────────────────────────────────────────────────────────────────

  // Awaits the run (joining one in flight); works whatever PRICE_REFRESH_MINUTES is. Not blocked
  // by the import lock: it writes only the events cache.
  app.post('/dividends/suggestions/refresh', async (_request, reply) => {
    try {
      const summary = await service.refresh({ trigger: 'manual' });
      const response: DividendEventsRefreshResponse = {
        summary,
        events: readEventsStatus(opts.database.db, service),
      };
      return response;
    } catch (err) {
      if (err instanceof MarketDataDisabledError) {
        // Answered here: the error handler turns every 5xx into a generic message.
        return reply.code(503).send(errorBody(err.code, err.message));
      }
      throw err;
    }
  });

  app.post('/dividends/suggestions/dismiss', async (request): Promise<DividendEventKey> =>
    setSuggestionDismissed(deps, request.body, true),
  );

  app.post('/dividends/suggestions/restore', async (request): Promise<DividendEventKey> =>
    setSuggestionDismissed(deps, request.body, false),
  );
};
