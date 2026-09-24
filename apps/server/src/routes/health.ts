// GET /api/health: liveness plus a database check. Never exposes paths or env values.
import type { FastifyPluginAsync } from 'fastify';
import { countAppliedMigrations, type AppDatabase } from '../db/database';

export interface DbHealth {
  ok: boolean;
  journalMode: string | null;
  migrations: number | null;
}

export interface HealthBody {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  time: string;
  db: DbHealth;
}

export interface HealthRouteOptions {
  database: AppDatabase;
  version: string;
  now?: () => Date;
}

/** Throws when the connection is closed or unusable. */
export function readDbHealth(database: AppDatabase): DbHealth {
  const journalMode = database.sqlite.pragma('journal_mode', { simple: true });
  return {
    ok: true,
    journalMode: typeof journalMode === 'string' ? journalMode : String(journalMode),
    migrations: countAppliedMigrations(database.sqlite),
  };
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date());

  app.get('/health', async (request, reply): Promise<HealthBody> => {
    let db: DbHealth;
    try {
      db = readDbHealth(opts.database);
    } catch (err) {
      request.log.warn({ err }, 'health: database check failed');
      db = { ok: false, journalMode: null, migrations: null };
    }
    reply.header('cache-control', 'no-store');
    if (!db.ok) reply.code(503);
    return {
      status: db.ok ? 'ok' : 'degraded',
      version: opts.version,
      uptimeSeconds: Math.floor(process.uptime()),
      time: now().toISOString(),
      db,
    };
  });
};
