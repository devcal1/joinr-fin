// Builds the Fastify app. No side effects at import; nothing listens until index.ts says so.
import type { EngineApi } from '@joinr/engine';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { closeDatabase, type AppDatabase } from './db/database';
import { registerErrorHandler } from './errors';
import {
  createDividendEventsService,
  createOffDividendEventsService,
  type DividendEventsService,
} from './market/dividends/index';
import { createMarketDataService } from './market/index';
import { Cooldowns } from './market/refresh';
import { createService } from './market/service';
import type { MarketDataService } from './market/types';
import { budgetRoutes } from './routes/budget';
import { cashRoutes } from './routes/cash';
import { dividendsRoutes } from './routes/dividends';
import { healthRoutes } from './routes/health';
import { importRoutes } from './routes/import';
import { investmentsRoutes } from './routes/investments';
import { otherAssetsRoutes } from './routes/otherAssets';
import { pricesRoutes } from './routes/prices';
import { propertyRoutes } from './routes/property';
import { recordsRoutes } from './routes/records';
import { settingsRoutes } from './routes/settings';
import { sideIncomeRoutes } from './routes/sideIncome';
import { statusRoutes } from './routes/status';
import { superRoutes } from './routes/super';
import { createScheduler } from './scheduler/index';
import type { Scheduler } from './scheduler/types';
import { APP_VERSION } from './version';
import { assertWebDist, createNotFoundHandler, registerWebApp } from './web';

/** The long-lived services the routes share (stage-1.md §5.1). */
export interface AppServices {
  scheduler: Scheduler;
  market: MarketDataService;
  /**
   * Stage 3 (stage-3.md §4.6): the dividend-events market data. Optional so existing test
   * factories keep compiling; buildApp falls back to the off-mode service.
   */
  dividendEvents?: DividendEventsService;
}

export interface ServiceDeps {
  database: AppDatabase;
  /** The app's logger (it exists only inside buildApp). */
  log: FastifyBaseLogger;
  config: Config;
}

export type ServicesFactory = (deps: ServiceDeps) => AppServices;

declare module 'fastify' {
  interface FastifyInstance {
    market: MarketDataService;
    scheduler: Scheduler;
  }
}

export interface BuildAppOptions {
  config: Config;
  /** The open database. The app owns it from here on: `app.close()` closes it. */
  db: AppDatabase;
  /** Defaults to the root package.json version. */
  version?: string;
  /** Clock for the health timestamp and the investments as-of date (tests). */
  now?: () => Date;
  /** Builds the scheduler and market data service. Defaults to `offServices` (tests). */
  services?: ServicesFactory;
  /**
   * The engine function set for the investments and cash-flow routes; defaults to the real engine
   * (tests inject a fake).
   */
  engine?: EngineApi;
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
} as const;

/** True for `/api` and everything below it (query string ignored). */
export function isApiUrl(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}

/**
 * The real services, in the config's market data mode (index.ts). The price and dividend-events
 * services share one set of provider cool-downs, so a Yahoo 429/403 pauses both jobs (§4.6).
 */
export function defaultServices({ database, log, config }: ServiceDeps): AppServices {
  const scheduler = createScheduler({ db: database.db, log });
  const cooldowns = new Cooldowns();
  // createService is the frozen createMarketDataService plus the optional shared cool-downs.
  const market = createService({ db: database.db, config, log, scheduler, cooldowns });
  const dividendEvents = createDividendEventsService({
    db: database.db,
    config,
    log,
    scheduler,
    cooldowns,
  });
  return { scheduler, market, dividendEvents };
}

/** Market data off and no refresh timer: the default when `services` is omitted (tests). */
export function offServices({ database, log }: ServiceDeps): AppServices {
  const scheduler = createScheduler({ db: database.db, log });
  const market = createMarketDataService({
    db: database.db,
    config: { marketDataMode: 'off', priceRefreshMinutes: 0 },
    log,
    scheduler,
  });
  return { scheduler, market, dividendEvents: createOffDividendEventsService() };
}

export async function buildApp({
  config,
  db,
  version = APP_VERSION,
  now,
  services = offServices,
  engine,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Fail before creating anything, so the caller only has the database to clean up.
  if (config.serveWeb) assertWebDist(config.webDistDir);

  const app = Fastify({ logger: { level: config.logLevel } });
  const built = services({ database: db, log: app.log, config });
  const { scheduler, market } = built;
  const dividendEvents = built.dividendEvents ?? createOffDividendEventsService();
  app.decorate('scheduler', scheduler);
  app.decorate('market', market);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    // Every API response (errors included) is live data: never cached (§3).
    if (isApiUrl(request.url) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });
  // Stop the scheduler (abort and await an in-flight job) before the database closes.
  app.addHook('preClose', async () => {
    await scheduler.stop();
  });
  app.addHook('onClose', async () => {
    closeDatabase(db);
  });

  registerErrorHandler(app);
  await app.register(healthRoutes, { prefix: '/api', database: db, version, now });
  await app.register(recordsRoutes, { prefix: '/api', database: db, config, market });
  await app.register(importRoutes, { prefix: '/api', database: db, config, market });
  await app.register(statusRoutes, { prefix: '/api', database: db, config, market });
  await app.register(pricesRoutes, { prefix: '/api', market });
  await app.register(investmentsRoutes, {
    prefix: '/api',
    database: db,
    config,
    market,
    now,
    engine,
  });
  // Stage 3 (stage-3.md §4.2).
  const cashflow = { prefix: '/api', database: db, config, market, dividendEvents, now, engine };
  await app.register(cashRoutes, cashflow);
  await app.register(sideIncomeRoutes, cashflow);
  await app.register(budgetRoutes, cashflow);
  await app.register(dividendsRoutes, cashflow);
  await app.register(settingsRoutes, cashflow);
  // Stage 4 (stage-4.md §4.2): the same options object.
  await app.register(otherAssetsRoutes, cashflow);
  await app.register(superRoutes, cashflow);
  await app.register(propertyRoutes, cashflow);
  if (config.serveWeb) await registerWebApp(app, config.webDistDir);
  app.setNotFoundHandler(createNotFoundHandler(config.serveWeb));

  return app;
}
