// Record browser routes (stage-1.md §3.2): GET /api/records and GET /api/records/:entity.
// Read-only; the registry in @joinr/schema decides the entities and their columns.
import {
  isRecordEntityId,
  type RecordsIndexResponse,
  type RecordsPageResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config';
import type { AppDatabase } from '../db/database';
import { HttpError } from '../errors';
import type { MarketDataService } from '../market/types';
import { recordsIndex, recordsPage } from '../records/index';

export interface RecordsRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
}

export const recordsRoutes: FastifyPluginAsync<RecordsRouteOptions> = async (app, opts) => {
  const { db } = opts.database;

  app.get('/records', async (): Promise<RecordsIndexResponse> => recordsIndex(db));

  app.get<{ Params: { entity: string } }>(
    '/records/:entity',
    async (request): Promise<RecordsPageResponse> => {
      const { entity } = request.params;
      if (!isRecordEntityId(entity)) {
        throw new HttpError(404, `Unknown record type: ${entity.slice(0, 64)}`, 'NOT_FOUND');
      }
      return recordsPage(db, entity);
    },
  );
};
