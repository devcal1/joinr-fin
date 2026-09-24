// Price routes (stage-1.md §3.2, §5.1). Registered with prefix /api. Every response is no-store.
import {
  manualPriceInputSchema,
  priceSourceInputSchema,
  refreshRequestSchema,
  type MarketSeriesResponse,
  type PriceItem,
  type PricesResponse,
  type RefreshResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { errorBody, parseWith } from '../errors';
import { MarketDataDisabledError, type MarketDataService } from '../market/types';

export interface PricesRouteOptions {
  market: MarketDataService;
}

const instrumentParamsSchema = z.object({
  instrumentId: z
    .string()
    .regex(/^[1-9]\d{0,15}$/, { error: 'must be a positive integer' })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: 'must be a positive integer' }),
});

export const pricesRoutes: FastifyPluginAsync<PricesRouteOptions> = async (app, { market }) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/prices', async (): Promise<PricesResponse> => market.getPrices());

  app.post('/prices/refresh', async (request, reply) => {
    const body = parseWith(refreshRequestSchema, request.body ?? {});
    try {
      const summary = await market.refresh({ ...body, trigger: 'manual' });
      const response: RefreshResponse = { summary, prices: market.getPrices() };
      return response;
    } catch (err) {
      if (err instanceof MarketDataDisabledError) {
        // Answered here: the error handler turns every 5xx into a generic message.
        return reply.code(503).send(errorBody(err.code, err.message));
      }
      throw err;
    }
  });

  app.put('/prices/:instrumentId/manual', async (request): Promise<PriceItem> => {
    const { instrumentId } = parseWith(instrumentParamsSchema, request.params);
    const input = parseWith(manualPriceInputSchema, request.body);
    return market.setManualPrice(instrumentId, input);
  });

  app.delete('/prices/:instrumentId/manual', async (request): Promise<PriceItem> => {
    const { instrumentId } = parseWith(instrumentParamsSchema, request.params);
    return market.clearManualPrice(instrumentId);
  });

  app.put('/prices/:instrumentId/source', async (request): Promise<PriceItem> => {
    const { instrumentId } = parseWith(instrumentParamsSchema, request.params);
    const input = parseWith(priceSourceInputSchema, request.body);
    return market.setPriceSource(instrumentId, input);
  });

  app.get('/market/series', async (): Promise<MarketSeriesResponse> => ({
    series: market.getSeries(),
  }));
};
