// History routes (stage-5.md §4.2, FROZEN endpoints): the History page, the aggregation API, record,
// correct and delete the latest month. Registered with prefix /api; every response is no-store.
// Every mutation answers 409 IMPORT_IN_PROGRESS first while an upload import holds the import lock
// (the record route also through the recorder, which re-checks it after its price wait); corrections
// and deletes then run inside the recorder's mutex (`withLock`), so one snapshot write at a time.
import type { EngineApi } from '@joinr/engine';
import {
  historySeriesQuerySchema,
  makeRecordRequestSchema,
  type CorrectionResponse,
  type DeleteSnapshotResponse,
  type HistoryPageResponse,
  type HistorySeriesResponse,
  type RecordResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { createFinanceContext, financeDeps } from '../cashflow/context';
import { assertNoImportRunning, parsePeriodMonth } from '../cashflow/mutations/common';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { hasAppData } from '../db/queries/domain';
import { parseWith } from '../errors';
import { correctSnapshot, deleteLatestSnapshot, parseCorrection } from '../history/mutations';
import { buildHistoryPage, buildHistorySeries } from '../history/pages';
import { correctionResponse, deleteSnapshotResponse, recordResponse } from '../history/responses';
import type { DividendEventsService } from '../market/dividends/index';
import type { MarketDataService } from '../market/types';

export interface HistoryRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  dividendEvents: DividendEventsService;
  /** Clock for `asOf` (the server-local calendar date of `now()`). */
  now?: () => Date;
  /** The engine function set; defaults to the real `engine` from @joinr/engine (tests inject a fake). */
  engine?: EngineApi;
}

export const historyRoutes: FastifyPluginAsync<HistoryRouteOptions> = async (app, opts) => {
  const deps = financeDeps(opts);
  const db = deps.database.db;
  const recordRequestSchema = makeRecordRequestSchema(deps.now);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/history', async (request): Promise<HistoryPageResponse> =>
    buildHistoryPage(createFinanceContext(deps, request.log), db, {
      recorder: app.recorder.status(),
      hasAppData: hasAppData(db),
    }),
  );

  app.get('/history/series', async (request): Promise<HistorySeriesResponse> => {
    const query = parseWith(historySeriesQuerySchema, request.query);
    return buildHistorySeries(createFinanceContext(deps, request.log), query);
  });

  app.post('/history/record', async (request, reply): Promise<RecordResponse> => {
    assertNoImportRunning();
    const body = parseWith(recordRequestSchema, request.body);
    const recorded = await app.recorder.record({
      periodMonths: body.periodMonths,
      note: body.note ?? null,
    });
    reply.code(201);
    return recordResponse(deps, recorded, request.log);
  });

  app.put('/history/snapshots/:periodMonth', async (request): Promise<CorrectionResponse> => {
    assertNoImportRunning();
    const periodMonth = parsePeriodMonth(request.params);
    const correction = parseCorrection(request.body);
    const outcome = await app.recorder.withLock(() =>
      correctSnapshot(deps, periodMonth, correction, deps.now()),
    );
    return correctionResponse(deps, outcome, correction.note, request.log);
  });

  app.delete(
    '/history/snapshots/:periodMonth',
    async (request): Promise<DeleteSnapshotResponse> => {
      assertNoImportRunning();
      const periodMonth = parsePeriodMonth(request.params);
      const auditId = await app.recorder.withLock(() =>
        deleteLatestSnapshot(deps, periodMonth, deps.now()),
      );
      return deleteSnapshotResponse(deps, periodMonth, auditId);
    },
  );
};
