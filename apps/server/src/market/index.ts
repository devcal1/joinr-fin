// Market data service entry point (stage-1.md §5.1, frozen signature). Mode `live` fetches from
// Yahoo and CoinGecko, `fake` uses deterministic offline prices, `off` never fetches (refresh()
// throws MarketDataDisabledError) and registers no job.
import type { JoinrDb } from '@joinr/schema/db';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { Scheduler } from '../scheduler/types';
import { createService } from './service';
import type { Clock, MarketDataService } from './types';

export { MarketDataDisabledError } from './types';
export type { Clock, MarketDataService, MarketDataStatus } from './types';

export function createMarketDataService(o: {
  db: JoinrDb;
  config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'>;
  log: FastifyBaseLogger;
  scheduler: Scheduler;
  fetchImpl?: typeof fetch;
  clock?: Clock;
}): MarketDataService {
  return createService(o);
}
