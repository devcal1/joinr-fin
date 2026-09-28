// Server entry point: load config → open DB → migrate (a pre-update backup first; a refusal on a
// database a newer version migrated, stage-7.md §5.7) → clean up interrupted runs → build →
// listen → start the scheduler, the snapshot recorder (stage-5.md §4.6), then the backup service
// (stage-7.md §5.4) and the weekly NAS copy (stage-8.md §5.11).
import type { FastifyInstance } from 'fastify';
import { buildApp, defaultServices } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { migrateWithBackup, NewerDatabaseError, PreUpdateBackupError } from './backups/migrate';
import { closeDatabase, openDatabase } from './db/database';
import { recordStartup } from './db/meta';
import { markInterruptedRuns } from './db/queries/domain';
import { APP_VERSION } from './version';

/** A stuck shutdown is abandoned after this long. */
const FORCE_EXIT_MS = 10_000;

function fail(message: string): never {
  console.error(`Joinr Finance failed to start: ${message}`);
  process.exit(1);
}

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }
}

/** The first signal closes the app (and with it SQLite); a second one, or a timeout, forces exit. */
function installShutdownHandlers(app: FastifyInstance): void {
  let closing = false;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  if (process.platform === 'win32') signals.push('SIGBREAK');

  const onSignal = (signal: NodeJS.Signals): void => {
    if (closing) {
      app.log.warn(`${signal} received again; forcing exit`);
      process.exit(1);
    }
    closing = true;
    app.log.info(`${signal} received; shutting down`);
    setTimeout(() => {
      app.log.error(`shutdown took longer than ${FORCE_EXIT_MS / 1000} s; forcing exit`);
      process.exit(1);
    }, FORCE_EXIT_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error while shutting down');
        process.exit(1);
      },
    );
  };

  for (const signal of signals) process.on(signal, onSignal);
}

async function main(): Promise<void> {
  const config = readConfig();

  const database = openDatabase(config.dataDir);
  let app: FastifyInstance;
  let migrations: ReturnType<typeof migrateWithBackup>;
  let interrupted: ReturnType<typeof markInterruptedRuns>;
  try {
    // The pre-update backup (if any) is logged below with both levels (no path, no figure).
    migrations = migrateWithBackup(database, config);
    recordStartup(database.db);
    interrupted = markInterruptedRuns(database.db, new Date());
    app = await buildApp({ config, db: database, services: defaultServices });
  } catch (err) {
    closeDatabase(database);
    if (err instanceof NewerDatabaseError || err instanceof PreUpdateBackupError) fail(err.message);
    throw err;
  }

  app.log.info(
    {
      version: APP_VERSION,
      nodeEnv: config.nodeEnv,
      dataDir: config.dataDir,
      migrationsApplied: migrations.applied,
      migrationsTotal: migrations.total,
      migrationsBefore: migrations.from,
      preUpdateBackup: migrations.backup,
      serveWeb: config.serveWeb,
      marketDataMode: config.marketDataMode,
      priceRefreshMinutes: config.priceRefreshMinutes,
      weeklyNasCopy: config.weeklyNasCopy,
      interruptedRuns: interrupted,
    },
    'database ready',
  );
  if (interrupted.importRuns > 0 || interrupted.jobRuns > 0) {
    app.log.warn(interrupted, 'marked runs left running by the last shutdown as failed');
  }
  installShutdownHandlers(app);

  try {
    await app.listen({
      host: config.host,
      port: config.port,
      listenTextResolver: (address) => `Joinr Finance listening on ${address}`,
    });
  } catch (err) {
    app.log.error({ err }, 'could not listen');
    await app.close();
    process.exit(1);
  }
  app.scheduler.start();
  app.recorder.start();
  app.backups.start();
  app.nasCopy.start();
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
