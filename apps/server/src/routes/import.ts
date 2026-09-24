// Import routes (stage-1.md §3.2, §3.4): POST /api/import, GET /api/import/runs,
// GET /api/import/runs/:id.
//
// The upload is the raw workbook bytes (no multipart). The flow: one import at a time → refuse a
// real import over app-entered data (D34; only the CLI can override) → confirm a replace of
// existing data → resolve and parse the corrections file → back up the database (real imports
// over existing data) → importWorkbook() (synchronous, one transaction) → tell the price
// service the instruments may have changed → answer with the run read back from import_runs.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  IMPORTER_VERSION,
  importWorkbook,
  parseCorrectionsFile,
  resolveCorrectionsPath,
} from '@joinr/importer';
import {
  IMPORT_CONTENT_TYPES,
  IMPORT_FILE_NAME_HEADER,
  importQuerySchema,
  UPLOAD_LIMIT_BYTES,
  type CorrectionsFile,
  type ImportRunDetail,
  type ImportRunsResponse,
} from '@joinr/schema';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import { backupBeforeImport } from '../db/backup';
import type { AppDatabase } from '../db/database';
import { hasAppData, hasDomainData } from '../db/queries/domain';
import { getImportRun, listImportRuns, recordFailedImportRun } from '../db/queries/importRuns';
import { errorBody, HttpError, parseWith } from '../errors';
import type { MarketDataService } from '../market/types';

/** The importer functions the route calls; tests inject fakes. */
export interface ImporterApi {
  importWorkbook: typeof importWorkbook;
  parseCorrectionsFile: typeof parseCorrectionsFile;
  resolveCorrectionsPath: typeof resolveCorrectionsPath;
}

export interface ImportRouteOptions {
  database: AppDatabase;
  config: Config;
  market: MarketDataService;
  /** Defaults to the real `@joinr/importer`. */
  importer?: ImporterApi;
  /** Clock for runs the route records itself and for backup names (tests). */
  now?: () => Date;
}

export const DEFAULT_IMPORTER: ImporterApi = {
  importWorkbook,
  parseCorrectionsFile,
  resolveCorrectionsPath,
};

/** The file name used when the upload carries no usable `X-File-Name`. */
export const DEFAULT_UPLOAD_FILE_NAME = 'workbook.xlsx';
export const MAX_FILE_NAME_LENGTH = 200;

/**
 * One import at a time, process-wide (§3.4 step 2). Exported so tests can hold it; the route
 * acquires it before any await and releases it in `finally`.
 */
export const importLock = {
  held: false,
  tryAcquire(): boolean {
    if (this.held) return false;
    this.held = true;
    return true;
  },
  release(): void {
    this.held = false;
  },
};

/**
 * `X-File-Name` → a safe basename: URI-decoded (raw when not decodable), last path segment,
 * control characters removed, trimmed, at most 200 characters; empty → `workbook.xlsx`.
 */
export function sanitiseFileName(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return DEFAULT_UPLOAD_FILE_NAME;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const segments = decoded.split(/[/\\]/);
  const name = (segments[segments.length - 1] ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  return name === '' || name === '.' || name === '..' ? DEFAULT_UPLOAD_FILE_NAME : name;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const runIdParamsSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d{0,15}$/, { error: 'must be a positive whole number' })
    .transform(Number)
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
});

/** The D34 refusal (409 `IMPORT_APP_DATA_EXISTS`). */
export const IMPORT_APP_DATA_EXISTS_MESSAGE =
  'This app holds data entered in the app; an import would replace it. Import from the command line with --yes --replace-app-data to override.';

/** Error codes the importer reports that are the client's fault (422). */
const UNPROCESSABLE_CODES: ReadonlySet<string> = new Set([
  'INVALID_WORKBOOK',
  'INVALID_CORRECTIONS',
]);

interface LoadedCorrections {
  corrections: CorrectionsFile | null;
  source: { name: string; sha256: string } | null;
}

class CorrectionsLoadError extends Error {
  readonly correctionsName: string | null;

  constructor(message: string, correctionsName: string | null) {
    super(message);
    this.name = 'CorrectionsLoadError';
    this.correctionsName = correctionsName;
  }
}

/** §3.4 step 4. Messages name the file by basename only (never a path). */
async function loadCorrections(config: Config, importer: ImporterApi): Promise<LoadedCorrections> {
  const path = importer.resolveCorrectionsPath({
    setting: config.importCorrections,
    dataDir: config.dataDir,
    repoRoot: config.repoRoot,
  });
  if (path === null) return { corrections: null, source: null };
  const name = basename(path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    throw new CorrectionsLoadError(
      missing
        ? `Corrections file not found: ${name}`
        : `Corrections file could not be read: ${name}`,
      name,
    );
  }
  let corrections: CorrectionsFile;
  try {
    corrections = importer.parseCorrectionsFile(bytes.toString('utf8'));
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Invalid corrections file';
    throw new CorrectionsLoadError(message, name);
  }
  return { corrections, source: { name, sha256: sha256(bytes) } };
}

export const importRoutes: FastifyPluginAsync<ImportRouteOptions> = async (app, opts) => {
  const { database, config, market } = opts;
  const { db } = database;
  const importer = opts.importer ?? DEFAULT_IMPORTER;
  const now = opts.now ?? (() => new Date());

  // The upload lives in its own encapsulated context so its body parsers (raw bytes only; JSON
  // and text are removed → 415) apply to this route alone.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      [...IMPORT_CONTENT_TYPES],
      { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT_BYTES },
      (_request, body, done) => done(null, body),
    );

    upload.post(
      '/import',
      { bodyLimit: UPLOAD_LIMIT_BYTES },
      async (request, reply): Promise<ImportRunDetail | FastifyReply> => {
        const query = parseWith(importQuerySchema, request.query);
        const dryRun = query.dryRun === 'true';
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw new HttpError(
            400,
            'The request body is empty; send the .xlsx file',
            'VALIDATION_ERROR',
          );
        }
        const fileName = sanitiseFileName(request.headers[IMPORT_FILE_NAME_HEADER]);

        if (!importLock.tryAcquire()) {
          throw new HttpError(
            409,
            'An import is already running; try again shortly',
            'IMPORT_IN_PROGRESS',
          );
        }
        try {
          // D34: app-entered rows would be replaced; only the CLI may override. Checked before the
          // confirm, and nothing (backup or run row) is written for this refusal.
          if (!dryRun && hasAppData(db)) {
            throw new HttpError(409, IMPORT_APP_DATA_EXISTS_MESSAGE, 'IMPORT_APP_DATA_EXISTS');
          }

          const hasData = hasDomainData(db);
          if (hasData && !dryRun && query.confirmReplace !== 'true') {
            throw new HttpError(
              409,
              'This replaces the imported data; confirm the replace to continue',
              'IMPORT_CONFIRM_REQUIRED',
            );
          }

          const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
          let loaded: LoadedCorrections;
          try {
            loaded = await loadCorrections(config, importer);
          } catch (err) {
            if (!(err instanceof CorrectionsLoadError)) throw err;
            recordFailedImportRun(db, {
              now: now(),
              dryRun,
              trigger: 'upload',
              fileName,
              fileSha256: sha256(bytes),
              fileSize: bytes.byteLength,
              correctionsName: err.correctionsName,
              importerVersion: IMPORTER_VERSION,
              errorCode: 'INVALID_CORRECTIONS',
              error: err.message,
            });
            throw new HttpError(422, err.message, 'INVALID_CORRECTIONS');
          }

          if (!dryRun && hasData) {
            const backup = backupBeforeImport(database, config.dataDir, now());
            request.log.info({ backup: basename(backup) }, 'pre-import backup written');
          }

          const result = importer.importWorkbook(db, {
            bytes,
            fileName,
            trigger: 'upload',
            corrections: loaded.corrections,
            correctionsSource: loaded.source,
            dryRun,
          });

          if (result.status === 'failed') {
            const code = result.errorCode ?? 'IMPORT_FAILED';
            if (UNPROCESSABLE_CODES.has(code)) {
              return reply
                .code(422)
                .send(errorBody(code, result.error ?? 'The workbook could not be imported'));
            }
            request.log.error({ runId: result.runId, code }, 'import failed');
            throw new HttpError(500, 'Import failed');
          }

          if (!result.dryRun) {
            try {
              market.notifyInstrumentsChanged();
            } catch (err) {
              request.log.warn({ err }, 'could not schedule a price refresh after the import');
            }
          }

          const run = getImportRun(db, result.runId);
          if (!run) throw new HttpError(500, `Import run ${result.runId} was not recorded`);
          reply.code(result.dryRun ? 200 : 201);
          return run;
        } finally {
          importLock.release();
        }
      },
    );
  });

  app.get('/import/runs', async (): Promise<ImportRunsResponse> => ({
    runs: listImportRuns(db),
    hasImportedData: hasDomainData(db),
    hasAppData: hasAppData(db),
    inProgress: importLock.held,
  }));

  app.get('/import/runs/:id', async (request): Promise<ImportRunDetail> => {
    const { id } = parseWith(runIdParamsSchema, request.params);
    const run = getImportRun(db, id);
    if (!run) throw new HttpError(404, `Import run ${id} not found`, 'NOT_FOUND');
    return run;
  });
};
