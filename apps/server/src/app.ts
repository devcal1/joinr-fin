// Builds the Fastify app. No side effects at import; nothing listens until index.ts says so.
import { engine as defaultEngine, type EngineApi } from '@joinr/engine';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { CopyFn } from './backups/copy';
import { createBackupService, type BackupService } from './backups/service';
import type { Config } from './config';
import { closeDatabase, type AppDatabase } from './db/database';
import { deleteMeta, META_KEYS, setMeta } from './db/meta';
import { frameworkErrorHandler, registerErrorHandler } from './errors';
import { applySettingUpgrades, logSettingUpgrades } from './fire/upgrade';
import { createSnapshotRecorder, type SnapshotRecorder } from './history/recorder';
import {
  createDividendEventsService,
  createOffDividendEventsService,
  type DividendEventsService,
} from './market/dividends/index';
import { createMarketDataService } from './market/index';
import type { RsyncRunner } from './nascopy/runner';
import { createNasCopyService, type NasCopyService } from './nascopy/service';
import { Cooldowns } from './market/refresh';
import { createService } from './market/service';
import type { MarketDataService } from './market/types';
import { budgetRoutes } from './routes/budget';
import { cashRoutes } from './routes/cash';
import { dividendsRoutes } from './routes/dividends';
import { fireRoutes } from './routes/fire';
import { healthRoutes } from './routes/health';
import { historyRoutes } from './routes/history';
import { importRoutes } from './routes/import';
import { investmentsRoutes } from './routes/investments';
import { netWorthRoutes } from './routes/netWorth';
import { otherAssetsRoutes } from './routes/otherAssets';
import { pricesRoutes } from './routes/prices';
import { propertyRoutes } from './routes/property';
import { recordsRoutes } from './routes/records';
import { settingsRoutes } from './routes/settings';
import { sideIncomeRoutes } from './routes/sideIncome';
import { statusRoutes } from './routes/status';
import { superRoutes } from './routes/super';
import { createScheduler, systemClock } from './scheduler/index';
import type { Clock, Scheduler } from './scheduler/types';
import { APP_VERSION } from './version';
import { backupsRoutes } from './routes/backups';
import { isApiRequest, registerWriteGuard } from './security';
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
    /** Stage 5 (stage-5.md §4.6): the month-end recorder; index.ts starts it. */
    recorder: SnapshotRecorder;
    /** Stage 7 (stage-7.md §5.4): the nightly backup and "Back up now"; index.ts starts it. */
    backups: BackupService;
    /** Stage 8 (stage-8.md §5.11): the weekly copy to the NAS; index.ts starts it. */
    nasCopy: NasCopyService;
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
  /**
   * Stage 5 (stage-5.md §4.6): the recorder's timer clock (tests; default `systemClock`). Its dates
   * and hours come from `now`.
   */
  recorderClock?: Clock;
  /** Stage 7 (stage-7.md §5.8): the backup service's timer clock (tests; default `systemClock`). */
  backupClock?: Clock;
  /** Stage 7 (stage-7.md §5.3 step 2): the backup copy seam (tests pass an async fake). */
  backupCopy?: CopyFn;
  /** Stage 8 (stage-8.md §5.11): the NAS copy's timer clock (tests; default `systemClock`). */
  nasCopyClock?: Clock;
  /** Stage 8 (stage-8.md §5.11): the rsync runner (tests pass a fake; default the real one). */
  nasCopyRunner?: RsyncRunner;
  /**
   * Stage 8 (stage-8.md §5.12, tests only): where the app's log lines go (default stdout), so the
   * leak test can read every line the app wrote.
   */
  logStream?: { write(line: string): void };
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
} as const;

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
  recorderClock,
  backupClock,
  backupCopy,
  nasCopyClock,
  nasCopyRunner,
  logStream,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Fail before creating anything, so the caller only has the database to clean up.
  if (config.serveWeb) assertWebDist(config.webDistDir);

  // frameworkErrors: the router's own errors (a too-long download name) in the Stage 0 shape.
  const app = Fastify({
    logger: logStream ? { level: config.logLevel, stream: logStream } : { level: config.logLevel },
    frameworkErrors: frameworkErrorHandler,
  });
  // Stage 7 (stage-7.md §5.8): the cross-site write guard runs before anything else.
  registerWriteGuard(app, config);
  const built = services({ database: db, log: app.log, config });
  const { scheduler, market } = built;
  const dividendEvents = built.dividendEvents ?? createOffDividendEventsService();
  app.decorate('scheduler', scheduler);
  app.decorate('market', market);
  const recorder = createSnapshotRecorder({
    database: db,
    config,
    market,
    scheduler,
    engine: engine ?? defaultEngine,
    log: app.log,
    now,
    clock: recorderClock ?? systemClock,
  });
  app.decorate('recorder', recorder);
  const backups = createBackupService({
    database: db,
    config,
    scheduler,
    log: app.log,
    now,
    clock: backupClock ?? systemClock,
    copy: backupCopy,
  });
  app.decorate('backups', backups);
  const nasCopy = createNasCopyService({
    database: db,
    config,
    scheduler,
    backups,
    log: app.log,
    now,
    clock: nasCopyClock ?? systemClock,
    runner: nasCopyRunner,
  });
  app.decorate('nasCopy', nasCopy);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    // Every API response (errors included) is live data: never cached (§3).
    // Decided on the matched route and the decoded path, as the write guard (security.ts).
    if (isApiRequest(request) && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });
  // Stop the NAS copy first (it aborts its own copy and waits at most 4 s, stage-8.md §5.10), the
  // backups, the recorder (it aborts its own price wait) and then the scheduler (abort and await
  // an in-flight job) before the database closes (stage-5.md §4.6).
  app.addHook('preClose', async () => {
    await nasCopy.stop();
    await backups.stop();
    await recorder.stop();
    await scheduler.stop();
  });
  // Stage 7 (stage-7.md §5.8): the running marker the restore and import CLIs read. Set when the
  // server listens, deleted on a clean close (a crash leaves it: the CLIs' --force).
  app.addHook('onListen', async () => {
    setMeta(db.db, META_KEYS.runningSince, (now ?? (() => new Date()))().toISOString());
  });
  app.addHook('onClose', async () => {
    try {
      if (db.sqlite.open) deleteMeta(db.db, META_KEYS.runningSince);
    } catch (err) {
      app.log.warn(
        { code: (err as { code?: unknown }).code },
        'could not clear the running marker',
      );
    }
    closeDatabase(db);
  });

  // Stage 6 (stage-6.md §3.4): the D98 one-off, once the database is ready (a CLI import made while
  // the server was down is upgraded at the next start).
  logSettingUpgrades(app.log, applySettingUpgrades(db, (now ?? (() => new Date()))()));

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
  // Stage 5 (stage-5.md §4.2): the same options object (`GET /settings` is in settingsRoutes).
  await app.register(netWorthRoutes, cashflow);
  await app.register(historyRoutes, cashflow);
  // Stage 6 (stage-6.md §4.2): the same options object.
  await app.register(fireRoutes, cashflow);
  // Stage 7 (stage-7.md §5.10).
  await app.register(backupsRoutes, {
    prefix: '/api',
    database: db,
    config,
    backups,
    nasCopy,
    version,
    now,
  });
  if (config.serveWeb) await registerWebApp(app, config.webDistDir);
  app.setNotFoundHandler(createNotFoundHandler(config.serveWeb));

  return app;
}
