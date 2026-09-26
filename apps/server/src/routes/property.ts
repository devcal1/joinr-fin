// Property routes (stage-4.md §4.2, FROZEN endpoints): the page, properties and valuations, loans
// with the D66 balance log, and the D67 offset links. Registered with prefix /api; every response
// is no-store. Every mutation answers 409 IMPORT_IN_PROGRESS first while an upload import runs,
// then runs in one IMMEDIATE transaction with the D34 origin rules (§3.4).
import type { EngineApi } from '@joinr/engine';
import type {
  DeletedResponse,
  LoanBalancesResponse,
  LoanMutationResponse,
  LoanOffsetsResponse,
  PropertyMutationResponse,
  PropertyPageResponse,
  ValuationsResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import {
  createLoan,
  createProperty,
  deleteLoan,
  deleteLoanBalanceEntry,
  deleteProperty,
  deleteValuationEntry,
  putLoanOffsets,
  saveLoanBalances,
  saveValuations,
  updateLoan,
  updateLoanBalanceEntry,
  updateProperty,
} from '../assets/mutations/property';
import { buildPropertyPage } from '../assets/property';
import {
  loanBalancesResponse,
  loanOffsetsResponse,
  loanResponse,
  propertyResponse,
  valuationsResponse,
} from '../assets/responses';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { parseIdAfterLock } from '../cashflow/mutations/common';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface PropertyRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const propertyRoutes: FastifyPluginAsync<PropertyRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/property', async (request): Promise<PropertyPageResponse> =>
    buildPropertyPage(createFinanceContext(deps, request.log)),
  );

  // ─── Properties and valuations ────────────────────────────────────────────────────────────────

  app.post('/property/properties', async (request, reply): Promise<PropertyMutationResponse> => {
    const id = createProperty(deps, request.body);
    reply.code(201);
    return propertyResponse(deps, id, request.log);
  });

  app.put('/property/properties/:id', async (request): Promise<PropertyMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateProperty(deps, id, request.body);
    return propertyResponse(deps, id, request.log);
  });

  app.delete('/property/properties/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteProperty(deps, id);
    return { id };
  });

  app.put('/property/valuations', async (request): Promise<ValuationsResponse> => {
    const ids = saveValuations(deps, request.body);
    return valuationsResponse(deps, ids, request.log);
  });

  app.delete(
    '/property/valuation-entries/:id',
    async (request): Promise<PropertyMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      const propertyId = deleteValuationEntry(deps, id);
      return propertyResponse(deps, propertyId, request.log);
    },
  );

  // ─── Loans (D66) ──────────────────────────────────────────────────────────────────────────────

  app.post('/property/loans', async (request, reply): Promise<LoanMutationResponse> => {
    const id = createLoan(deps, request.body);
    reply.code(201);
    return loanResponse(deps, id, request.log);
  });

  app.put('/property/loans/:id', async (request): Promise<LoanMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    updateLoan(deps, id, request.body);
    return loanResponse(deps, id, request.log);
  });

  app.delete('/property/loans/:id', async (request): Promise<DeletedResponse> => {
    const id = parseIdAfterLock(request.params);
    deleteLoan(deps, id);
    return { id };
  });

  app.put('/property/loan-balances', async (request): Promise<LoanBalancesResponse> => {
    const ids = saveLoanBalances(deps, request.body);
    return loanBalancesResponse(deps, ids, request.log);
  });

  app.put('/property/loan-balance-entries/:id', async (request): Promise<LoanMutationResponse> => {
    const id = parseIdAfterLock(request.params);
    const loanId = updateLoanBalanceEntry(deps, id, request.body);
    return loanResponse(deps, loanId, request.log);
  });

  app.delete(
    '/property/loan-balance-entries/:id',
    async (request): Promise<LoanMutationResponse> => {
      const id = parseIdAfterLock(request.params);
      const loanId = deleteLoanBalanceEntry(deps, id);
      return loanResponse(deps, loanId, request.log);
    },
  );

  // ─── Offsets (D67) ────────────────────────────────────────────────────────────────────────────

  app.put('/property/loans/:id/offsets', async (request): Promise<LoanOffsetsResponse> => {
    const id = parseIdAfterLock(request.params);
    putLoanOffsets(deps, id, request.body);
    return loanOffsetsResponse(deps, id, request.log);
  });
};
