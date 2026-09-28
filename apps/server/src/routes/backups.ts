// Backups routes (stage-7.md §4, §5.10): GET /api/backups, POST /api/backups ("Back up now"),
// GET /api/backups/:name (download one file).
//
// The download validates the name (at most 64 characters, the name rule, which admits no `/`,
// `\`, `..`, NUL or control character), requires a regular file (`lstat`: a symlink is not one)
// whose real parent is the backups folder's real path, and opens it with O_NOFOLLOW where the
// platform has it. No error body ever carries a path.
import { constants as fsConstants, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BACKUP_DOWNLOAD_PREFIX,
  BACKUP_NIGHTLY_HOUR,
  BACKUP_NIGHTLY_MINUTE,
  BACKUP_RETENTION,
  type BackupNowResponse,
  type BackupsResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { defaultStatfs, type StatfsFn } from '../backups/copy';
import { backupsDir, computeStaleness, listBackupFiles, toBackupDtos } from '../backups/list';
import { isBackupFileName } from '../backups/names';
import type { BackupService } from '../backups/service';
import type { Config } from '../config';
import { countAppliedMigrations, type AppDatabase } from '../db/database';
import { readRestoreLast } from '../db/meta';
import { HttpError, parseWith } from '../errors';
import { importLock } from './import';
import { IMPORT_IN_PROGRESS_MESSAGE } from '../investments/mutations';

export interface BackupsRouteOptions {
  database: AppDatabase;
  config: Config;
  backups: BackupService;
  /** The server's version (the About block). */
  version: string;
  now?: () => Date;
  statfs?: StatfsFn;
}

export const INVALID_BACKUP_NAME_MESSAGE = 'Not a backup file name';
export const BACKUP_NOT_FOUND_MESSAGE = 'No such backup';

/** The server's zone (the schedule and every time on the page). */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const nameParams = z.object({ name: z.string() });

/** POST body: none, or an empty object. */
function assertEmptyBody(body: unknown): void {
  if (body === undefined || body === null || body === '') return;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new HttpError(400, 'Send no body, or {}', 'VALIDATION_ERROR');
}

function badName(): HttpError {
  return new HttpError(400, INVALID_BACKUP_NAME_MESSAGE, 'VALIDATION_ERROR');
}

function notFound(): HttpError {
  return new HttpError(404, BACKUP_NOT_FOUND_MESSAGE, 'NOT_FOUND');
}

export const backupsRoutes: FastifyPluginAsync<BackupsRouteOptions> = async (app, opts) => {
  const { database, config, backups, version } = opts;
  const now = opts.now ?? (() => new Date());
  const statfs = opts.statfs ?? defaultStatfs;

  app.get('/backups', async (): Promise<BackupsResponse> => {
    const at = now();
    const files = listBackupFiles(config.dataDir);
    const status = backups.status();
    const staleness = computeStaleness(database.db, files, at, status.enabled);
    const dtos = toBackupDtos(files, at);
    return {
      backups: dtos,
      totalBytes: dtos.reduce((sum, f) => sum + f.sizeBytes, 0),
      freeBytes: statfs(config.dataDir),
      schedule: {
        enabled: status.enabled,
        hour: BACKUP_NIGHTLY_HOUR,
        minute: BACKUP_NIGHTLY_MINUTE,
        timeZone: serverTimeZone(),
        nextRunAt: status.nextRunAt,
      },
      running: status.running,
      lastRun: status.lastRun,
      lastBackupAt: staleness.lastBackupAt,
      stale: staleness.stale,
      retention: BACKUP_RETENTION,
      app: {
        version,
        migrations: countAppliedMigrations(database.sqlite),
        restoredFrom: readRestoreLast(database.db),
      },
    };
  });

  // "Back up now": no body or `{}`. Its own context accepts an empty JSON body.
  await app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 1024 },
      (_request, body, done) => {
        const text = typeof body === 'string' ? body.trim() : '';
        if (text === '') {
          done(null, undefined);
          return;
        }
        try {
          done(null, JSON.parse(text) as unknown);
        } catch {
          done(new HttpError(400, 'The body is not valid JSON', 'VALIDATION_ERROR'), undefined);
        }
      },
    );
    scope.post('/backups', async (request, reply): Promise<BackupNowResponse> => {
      assertEmptyBody(request.body);
      if (importLock.held) {
        throw new HttpError(409, IMPORT_IN_PROGRESS_MESSAGE, 'IMPORT_IN_PROGRESS');
      }
      const { file, joined } = await backups.backupNow();
      reply.code(201);
      return { backup: file, joined };
    });
  });

  app.get('/backups/:name', async (request, reply) => {
    const { name } = parseWith(nameParams, request.params);
    if (!isBackupFileName(name)) throw badName();
    const dir = backupsDir(config.dataDir);
    const path = join(dir, name);
    let st;
    try {
      st = await lstat(path);
    } catch {
      throw notFound();
    }
    if (!st.isFile()) throw notFound();
    try {
      if (dirname(realpathSync(path)) !== realpathSync(dir)) throw notFound();
    } catch {
      throw notFound();
    }
    const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    let handle;
    try {
      handle = await open(path, fsConstants.O_RDONLY | noFollow);
    } catch {
      throw notFound();
    }
    const opened = await handle.stat();
    if (!opened.isFile()) {
      await handle.close();
      throw notFound();
    }
    reply
      .code(200)
      .header('content-type', 'application/vnd.sqlite3')
      .header('content-length', String(opened.size))
      .header('content-disposition', `attachment; filename="${BACKUP_DOWNLOAD_PREFIX}${name}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
    return reply.send(handle.createReadStream({ autoClose: true }));
  });
};
