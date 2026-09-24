// Builds the Fastify app. No side effects at import; nothing listens until index.ts says so.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { closeDatabase, type AppDatabase } from './db/database';
import { registerErrorHandler } from './errors';
import { healthRoutes } from './routes/health';
import { APP_VERSION } from './version';
import { assertWebDist, createNotFoundHandler, registerWebApp } from './web';

export interface BuildAppOptions {
  config: Config;
  /** The open database. The app owns it from here on: `app.close()` closes it. */
  db: AppDatabase;
  /** Defaults to the root package.json version. */
  version?: string;
  /** Clock for the health timestamp (tests). */
  now?: () => Date;
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
} as const;

export async function buildApp({
  config,
  db,
  version = APP_VERSION,
  now,
}: BuildAppOptions): Promise<FastifyInstance> {
  // Fail before creating anything, so the caller only has the database to clean up.
  if (config.serveWeb) assertWebDist(config.webDistDir);

  const app = Fastify({ logger: { level: config.logLevel } });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.headers(SECURITY_HEADERS);
    return payload;
  });
  app.addHook('onClose', async () => {
    closeDatabase(db);
  });

  registerErrorHandler(app);
  await app.register(healthRoutes, { prefix: '/api', database: db, version, now });
  if (config.serveWeb) await registerWebApp(app, config.webDistDir);
  app.setNotFoundHandler(createNotFoundHandler(config.serveWeb));

  return app;
}
