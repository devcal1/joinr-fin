// Investments routes (stage-2.md §4.2, FROZEN endpoints). Registered with prefix /api. Every
// response is no-store. Page data, the ledger and the holding detail are built from the DB and
// the price service by the engine (`investments/**`); trade and instrument mutations run in
// IMMEDIATE transactions with the D34 origin rules.
import { engine as defaultEngine, type EngineApi } from '@joinr/engine';
import {
  idParamsSchema,
  investmentKindParamsSchema,
  type DeletedResponse,
  type HoldingDetailResponse,
  type InstrumentDto,
  type InstrumentKind,
  type InvestmentPageResponse,
  type InvestmentTradesResponse,
  type TradeMutationResponse,
} from '@joinr/schema';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { HttpError, parseWith } from '../errors';
import { createInvestmentsContext, type InvestmentsDeps } from '../investments/context';
import { buildHoldingDetail } from '../investments/detail';
import {
  assertNoImportRunning,
  createInstrument,
  createTrade,
  deleteInstrument,
  deleteTrade,
  loadInstrumentDto,
  updateInstrument,
  updateTrade,
} from '../investments/mutations';
import { buildInvestmentPage } from '../investments/page';
import { buildTradesResponse, tradeRowById } from '../investments/trades';
import type { MarketDataService } from '../market/types';

export interface InvestmentsRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

/** `:kind` → an instrument kind; anything else is 404 (not 400), as for an unknown page. */
function parseKind(params: unknown): InstrumentKind {
  const parsed = investmentKindParamsSchema.safeParse(params);
  if (!parsed.success) throw new HttpError(404, 'No investments page for this kind', 'NOT_FOUND');
  return parsed.data.kind;
}

/** Mutation `:id`: the import-lock 409 comes before anything else, then 400 for a bad id. */
function parseIdAfterLock(params: unknown): { id: number } {
  assertNoImportRunning();
  return parseWith(idParamsSchema, params);
}

function tradeResponse(
  deps: InvestmentsDeps,
  tradeId: number,
  log: FastifyBaseLogger,
): TradeMutationResponse {
  const trade = tradeRowById(createInvestmentsContext(deps, log), tradeId);
  // Only a concurrent CLI import could remove the row between the commit and this read.
  if (!trade) throw new HttpError(404, `Trade ${tradeId} not found`, 'NOT_FOUND');
  return { trade };
}

function instrumentResponse(
  deps: InvestmentsDeps,
  instrumentId: number,
  log: FastifyBaseLogger,
): InstrumentDto {
  const dto = loadInstrumentDto(deps, instrumentId, log);
  if (!dto) throw new HttpError(404, `Instrument ${instrumentId} not found`, 'NOT_FOUND');
  return dto;
}

export const investmentsRoutes: FastifyPluginAsync<InvestmentsRouteOptions> = async (app, opts) => {
  const deps: InvestmentsDeps = {
    database: opts.database,
    market: opts.market,
    engine: opts.engine ?? defaultEngine,
    now: opts.now ?? (() => new Date()),
  };

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  // ─── Reads ────────────────────────────────────────────────────────────────────────────────────

  app.get('/investments/:kind', async (request): Promise<InvestmentPageResponse> => {
    const kind = parseKind(request.params);
    return buildInvestmentPage(createInvestmentsContext(deps, request.log), kind);
  });

  app.get('/investments/:kind/trades', async (request): Promise<InvestmentTradesResponse> => {
    const kind = parseKind(request.params);
    return buildTradesResponse(createInvestmentsContext(deps, request.log), kind);
  });

  app.get('/instruments/:id', async (request): Promise<HoldingDetailResponse> => {
    const { id } = parseWith(idParamsSchema, request.params);
    const detail = buildHoldingDetail(createInvestmentsContext(deps, request.log), id);
    if (!detail) throw new HttpError(404, `Instrument ${id} not found`, 'NOT_FOUND');
    return detail;
  });

  // ─── Instruments ──────────────────────────────────────────────────────────────────────────────

  app.post('/instruments', async (request, reply): Promise<InstrumentDto> => {
    const id = createInstrument(deps, request.body, request.log);
    reply.code(201);
    return instrumentResponse(deps, id, request.log);
  });

  app.put('/instruments/:id', async (request): Promise<InstrumentDto> => {
    const { id } = parseIdAfterLock(request.params);
    updateInstrument(deps, id, request.body, request.log);
    return instrumentResponse(deps, id, request.log);
  });

  app.delete('/instruments/:id', async (request): Promise<DeletedResponse> => {
    const { id } = parseIdAfterLock(request.params);
    deleteInstrument(deps, id, request.log);
    return { id };
  });

  // ─── Trades ───────────────────────────────────────────────────────────────────────────────────

  app.post('/trades', async (request, reply): Promise<TradeMutationResponse> => {
    const { tradeId } = createTrade(deps, request.body, request.log);
    reply.code(201);
    return tradeResponse(deps, tradeId, request.log);
  });

  app.put('/trades/:id', async (request): Promise<TradeMutationResponse> => {
    const { id } = parseIdAfterLock(request.params);
    updateTrade(deps, id, request.body, request.log);
    return tradeResponse(deps, id, request.log);
  });

  app.delete('/trades/:id', async (request): Promise<DeletedResponse> => {
    const { id } = parseIdAfterLock(request.params);
    deleteTrade(deps, id, request.log);
    return { id };
  });
};
