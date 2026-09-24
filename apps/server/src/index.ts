// Server entry point: load config → open DB → migrate → build → listen.
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { closeDatabase, openDatabase, runMigrations } from './db/database';
import { recordStartup } from './db/meta';
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
  let migrations: ReturnType<typeof runMigrations>;
  try {
    migrations = runMigrations(database, config.migrationsDir);
    recordStartup(database.db);
    app = await buildApp({ config, db: database });
  } catch (err) {
    closeDatabase(database);
    throw err;
  }

  app.log.info(
    {
      version: APP_VERSION,
      nodeEnv: config.nodeEnv,
      dataDir: config.dataDir,
      migrationsApplied: migrations.applied,
      migrationsTotal: migrations.total,
      serveWeb: config.serveWeb,
    },
    'database ready',
  );
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
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
