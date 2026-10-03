// Import routes with a fake importer (stage-1.md §3.4, §7.5): content types, the upload limit,
// confirmation, the lock, dry runs, corrections resolution, backups and the runs list.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCorrectionsFile,
  resolveCorrectionsPath,
  type ImportOptions,
  type ImportResult,
} from '@joinr/importer';
import {
  IMPORT_RUNS_LIST_CAP,
  totalsOf,
  UPLOAD_LIMIT_BYTES,
  XLSX_MIME,
  type ImportRunDetail,
  type ImportRunsResponse,
} from '@joinr/schema';
import { cashAccounts, importRuns, instruments, type JoinrDb } from '@joinr/schema/db';
import { sampleReport } from '@joinr/schema/fixtures';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { BACKUPS_DIR_NAME } from '../src/db/backup';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { registerErrorHandler } from '../src/errors';
import type { MarketDataService } from '../src/market/types';
import {
  DEFAULT_UPLOAD_FILE_NAME,
  IMPORT_APP_DATA_EXISTS_MESSAGE,
  importLock,
  importRoutes,
  sanitiseFileName,
  type ImporterApi,
} from '../src/routes/import';
import { makeTempDir, removeDir, testConfig } from './helpers';

const NOW = new Date('2026-09-24T04:00:00.000Z');
const WORKBOOK = Buffer.from('PK\u0003\u0004 generic test bytes');

const VALID_CORRECTIONS = JSON.stringify({
  version: 1,
  corrections: [
    {
      id: 'C1',
      target: 'trade',
      match: { sheet: 'Crypto', symbol: 'ETH', date: '2025-11-03' },
      set: { date: '2025-03-11' },
      reason: 'Synthetic day/month swap',
    },
  ],
});

interface FakeImporterState {
  calls: ImportOptions[];
  /** What the next call returns (default: succeeded). */
  outcome: 'succeeded' | 'invalid_workbook' | 'other_failure' | 'throw';
}

/** A fake importWorkbook that records a run row like the real one and, on a commit, adds data. */
function fakeImporter(state: FakeImporterState): ImporterApi {
  return {
    parseCorrectionsFile,
    resolveCorrectionsPath,
    importWorkbook: (db: JoinrDb, options: ImportOptions): ImportResult => {
      state.calls.push(options);
      if (state.outcome === 'throw') throw new Error('boom at /some/internal/path');
      const failed = state.outcome !== 'succeeded';
      const errorCode =
        state.outcome === 'invalid_workbook' ? 'INVALID_WORKBOOK' : failed ? 'INTERNAL' : null;
      const error =
        state.outcome === 'invalid_workbook'
          ? 'Missing sheet: History'
          : failed
            ? 'Unexpected importer error'
            : null;
      const dryRun = options.dryRun ?? false;
      const id = db
        .insert(importRuns)
        .values({
          startedAt: NOW.toISOString(),
          finishedAt: NOW.toISOString(),
          status: failed ? 'failed' : 'succeeded',
          dryRun,
          trigger: options.trigger,
          fileName: options.fileName,
          fileSha256: createHash('sha256').update(options.bytes).digest('hex'),
          fileSize: options.bytes.byteLength,
          workbookAsOf: failed ? null : '2026-08-31',
          correctionsName: options.correctionsSource?.name ?? null,
          correctionsSha256: options.correctionsSource?.sha256 ?? null,
          importerVersion: '1.0.0',
          totalsJson: failed ? null : JSON.stringify(sampleReport.totals),
          reportJson: failed ? null : JSON.stringify(sampleReport),
          errorCode,
          error,
        })
        .returning({ id: importRuns.id })
        .get().id;
      if (!failed && !dryRun) {
        db.insert(instruments)
          .values({
            kind: 'etf',
            symbol: 'ASX:ABC',
            code: 'ABC',
            exchange: 'ASX',
            sortOrder: 1,
            origin: 'import',
          })
          .onConflictDoNothing()
          .run();
      }
      return {
        runId: id,
        status: failed ? 'failed' : 'succeeded',
        dryRun,
        report: failed ? null : sampleReport,
        errorCode,
        error,
      };
    },
  };
}

function fakeMarket(notify: () => void): MarketDataService {
  const fail = (): never => {
    throw new Error('not used');
  };
  return {
    refresh: () => Promise.reject(new Error('not used')),
    getPrices: fail,
    getSeries: fail,
    setManualPrice: fail,
    clearManualPrice: fail,
    setPriceSource: fail,
    notifyInstrumentsChanged: notify,
    status: () => ({ mode: 'off', running: false, lastRefreshAt: null, nextRefreshAt: null }),
    stop: () => undefined,
  };
}

let tempDir: string;
let config: Config;
let database: AppDatabase;
let app: FastifyInstance;
let state: FakeImporterState;
let market: MarketDataService;
let notify: Mock<() => void>;

async function start(overrides: Partial<Config> = {}): Promise<FastifyInstance> {
  await app?.close();
  config = testConfig(join(tempDir, 'data'), overrides);
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(importRoutes, {
    prefix: '/api',
    database,
    config,
    market,
    importer: fakeImporter(state),
    now: () => NOW,
  });
  await app.ready();
  return app;
}

function post(
  query = '',
  payload: Buffer | string = WORKBOOK,
  headers: Record<string, string> = { 'content-type': 'application/octet-stream' },
) {
  return app.inject({ method: 'POST', url: `/api/import${query}`, payload, headers });
}

/** Imported data (origin 'import'): a replace needs confirmation but is not blocked. */
function addDomainData(): void {
  database.db
    .insert(instruments)
    .values({
      kind: 'stock',
      symbol: 'ASX:XYZ',
      code: 'XYZ',
      exchange: 'ASX',
      sortOrder: 1,
      origin: 'import',
    })
    .run();
}

/** An app-entered row (origin 'app'): a real import is refused (D34). */
function addAppData(): void {
  database.db
    .insert(cashAccounts)
    .values({ name: 'Example Bank', balanceCents: 0, sortOrder: 1, origin: 'app' })
    .run();
}

const importRunCount = (): number => database.db.select().from(importRuns).all().length;

const backups = (): string[] => {
  const dir = join(config.dataDir, BACKUPS_DIR_NAME);
  return existsSync(dir) ? readdirSync(dir) : [];
};

beforeEach(async () => {
  tempDir = await makeTempDir();
  mkdirSync(join(tempDir, 'data'), { recursive: true });
  database = openDatabase(join(tempDir, 'data'));
  runMigrations(database, testConfig(tempDir).migrationsDir);
  state = { calls: [], outcome: 'succeeded' };
  notify = vi.fn<() => void>();
  market = fakeMarket(notify);
  importLock.release();
  await start();
});

afterEach(async () => {
  await app.close();
  importLock.release();
  closeDatabase(database);
  await removeDir(tempDir);
});

describe('POST /api/import', () => {
  it('imports into an empty database: 201, the run read back, prices notified', async () => {
    const res = await post('', WORKBOOK, {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('Example workbook (1).xlsx'),
    });
    expect(res.statusCode).toBe(201);
    const run = res.json<ImportRunDetail>();
    expect(run).toMatchObject({
      status: 'succeeded',
      dryRun: false,
      trigger: 'upload',
      fileName: 'Example workbook (1).xlsx',
      fileSizeBytes: WORKBOOK.length,
      workbookAsOf: '2026-08-31',
      correctionsName: null,
      totals: sampleReport.totals,
      error: null,
    });
    expect(run.report?.checks.length).toBe(sampleReport.checks.length);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      fileName: 'Example workbook (1).xlsx',
      trigger: 'upload',
      dryRun: false,
      corrections: null,
      correctionsSource: null,
    });
    expect(Buffer.from(state.calls[0]!.bytes).equals(WORKBOOK)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(backups()).toEqual([]); // nothing to back up yet
  });

  it('accepts the xlsx MIME type and defaults the file name', async () => {
    const res = await post('', WORKBOOK, { 'content-type': XLSX_MIME });
    expect(res.statusCode).toBe(201);
    expect(res.json<ImportRunDetail>().fileName).toBe(DEFAULT_UPLOAD_FILE_NAME);
  });

  it('answers a dry run with 200 and does not notify the price service', async () => {
    const res = await post('?dryRun=true');
    expect(res.statusCode).toBe(200);
    expect(res.json<ImportRunDetail>().dryRun).toBe(true);
    expect(state.calls[0]?.dryRun).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['application/json', '{"a":1}'],
    ['text/plain', 'hello'],
    ['multipart/form-data; boundary=x', '--x--'],
  ])('rejects %s with 415', async (contentType, payload) => {
    const res = await post('', payload, { 'content-type': contentType });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    expect(state.calls).toHaveLength(0);
  });

  it('rejects a body without a content type with 415', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: WORKBOOK });
    expect(res.statusCode).toBe(415);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects an empty body with 400', async () => {
    const res = await post('', Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const none = await app.inject({ method: 'POST', url: '/api/import' });
    expect(none.statusCode).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects an invalid query with 400', async () => {
    const res = await post('?dryRun=yes');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('answers 413 for UPLOAD_LIMIT_BYTES + 1 bytes and accepts exactly the limit', async () => {
    const tooBig = await post('', Buffer.alloc(UPLOAD_LIMIT_BYTES + 1, 1));
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(state.calls).toHaveLength(0);

    const atLimit = await post('', Buffer.alloc(UPLOAD_LIMIT_BYTES, 1));
    expect(atLimit.statusCode).toBe(201);
    expect(state.calls[0]?.bytes.byteLength).toBe(UPLOAD_LIMIT_BYTES);
  });

  describe('replacing existing data', () => {
    beforeEach(addDomainData);

    it('requires confirmReplace=true (409) and does not call the importer', async () => {
      const res = await post();
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'IMPORT_CONFIRM_REQUIRED' } });
      const no = await post('?confirmReplace=false');
      expect(no.statusCode).toBe(409);
      expect(state.calls).toHaveLength(0);
      expect(backups()).toEqual([]);
    });

    it('backs up the database first when confirmed', async () => {
      const res = await post('?confirmReplace=true');
      expect(res.statusCode).toBe(201);
      const files = backups();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^pre-import-\d{8}-\d{6}[+-]\d{4}\.db$/);
    });

    it('allows a dry run without confirmation and takes no backup', async () => {
      const res = await post('?dryRun=true');
      expect(res.statusCode).toBe(200);
      expect(backups()).toEqual([]);
    });
  });

  describe('over app-entered data (D34)', () => {
    beforeEach(() => {
      addDomainData();
      addAppData();
    });

    it('refuses a real import with 409 IMPORT_APP_DATA_EXISTS, even when confirmed', async () => {
      for (const query of ['', '?confirmReplace=true', '?dryRun=false&confirmReplace=true']) {
        const res = await post(query);
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({
          error: { code: 'IMPORT_APP_DATA_EXISTS', message: IMPORT_APP_DATA_EXISTS_MESSAGE },
        });
      }
      expect(IMPORT_APP_DATA_EXISTS_MESSAGE).toBe(
        'This app holds data entered in the app; an import would replace it. Import from the command line with --yes --replace-app-data to override.',
      );
      expect(state.calls).toHaveLength(0);
      expect(backups()).toEqual([]);
      expect(importRunCount()).toBe(0);
      expect(importLock.held).toBe(false);
    });

    it('checks before the confirm (409 IMPORT_APP_DATA_EXISTS, not IMPORT_CONFIRM_REQUIRED)', async () => {
      const res = await post();
      expect(res.json()).toMatchObject({ error: { code: 'IMPORT_APP_DATA_EXISTS' } });
    });

    it('checks after the lock (409 IMPORT_IN_PROGRESS while an import runs)', async () => {
      expect(importLock.tryAcquire()).toBe(true);
      try {
        const res = await post('?confirmReplace=true');
        expect(res.json()).toMatchObject({ error: { code: 'IMPORT_IN_PROGRESS' } });
      } finally {
        importLock.release();
      }
    });

    it('still allows a dry run, without a backup', async () => {
      const res = await post('?dryRun=true');
      expect(res.statusCode).toBe(200);
      expect(state.calls).toHaveLength(1);
      expect(backups()).toEqual([]);
    });

    it('reports hasAppData in the runs list', async () => {
      const body = (
        await app.inject({ method: 'GET', url: '/api/import/runs' })
      ).json<ImportRunsResponse>();
      expect(body).toMatchObject({ hasImportedData: true, hasAppData: true });
    });
  });

  it('allows a confirmed replace when only imported rows exist (hasAppData false)', async () => {
    addDomainData();
    const runs = (
      await app.inject({ method: 'GET', url: '/api/import/runs' })
    ).json<ImportRunsResponse>();
    expect(runs.hasAppData).toBe(false);
    expect((await post('?confirmReplace=true')).statusCode).toBe(201);
  });

  it('rejects a second import while one runs (409) and reports it in the runs list', async () => {
    expect(importLock.tryAcquire()).toBe(true);
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'IMPORT_IN_PROGRESS' } });
    const runs = await app.inject({ method: 'GET', url: '/api/import/runs' });
    expect(runs.json<ImportRunsResponse>().inProgress).toBe(true);
    importLock.release();
    expect((await post()).statusCode).toBe(201);
  });

  it('holds the lock during the import and releases it afterwards', async () => {
    let heldDuring = false;
    const importer = fakeImporter(state);
    await app.close();
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(importRoutes, {
      prefix: '/api',
      database,
      config,
      market,
      importer: {
        ...importer,
        importWorkbook: (db, options) => {
          heldDuring = importLock.held;
          return importer.importWorkbook(db, options);
        },
      },
    });
    expect((await post()).statusCode).toBe(201);
    expect(heldDuring).toBe(true);
    expect(importLock.held).toBe(false);
  });

  it('answers 422 INVALID_WORKBOOK with the importer message and records the failed run', async () => {
    state.outcome = 'invalid_workbook';
    const res = await post();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_WORKBOOK', message: 'Missing sheet: History' },
    });
    expect(notify).not.toHaveBeenCalled();
    const runs = (
      await app.inject({ method: 'GET', url: '/api/import/runs' })
    ).json<ImportRunsResponse>();
    expect(runs.runs[0]).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_WORKBOOK', message: 'Missing sheet: History' },
    });
    expect(importLock.held).toBe(false);
  });

  it('hides other importer failures behind a generic 500 and releases the lock', async () => {
    state.outcome = 'other_failure';
    const failed = await post();
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
    });
    state.outcome = 'throw';
    const thrown = await post();
    expect(thrown.statusCode).toBe(500);
    expect(thrown.body).not.toContain('internal/path');
    expect(importLock.held).toBe(false);
  });

  it('still answers 201 when scheduling the price refresh throws', async () => {
    notify.mockImplementation(() => {
      throw new Error('scheduler gone');
    });
    expect((await post()).statusCode).toBe(201);
  });
});

describe('corrections resolution', () => {
  const writeFile = (path: string, text: string): string => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return path;
  };

  it('off: imports without corrections even when files exist', async () => {
    writeFile(join(tempDir, 'data', 'import-corrections.json'), VALID_CORRECTIONS);
    await start({ importCorrections: { kind: 'off' } });
    expect((await post()).statusCode).toBe(201);
    expect(state.calls[0]?.corrections).toBeNull();
  });

  it('file: passes the parsed corrections and their basename + sha256', async () => {
    const path = writeFile(join(tempDir, 'elsewhere', 'my-corrections.json'), VALID_CORRECTIONS);
    await start({ importCorrections: { kind: 'file', path } });
    const res = await post();
    expect(res.statusCode).toBe(201);
    expect(res.json<ImportRunDetail>().correctionsName).toBe('my-corrections.json');
    expect(state.calls[0]?.corrections?.corrections[0]?.id).toBe('C1');
    expect(state.calls[0]?.correctionsSource).toEqual({
      name: 'my-corrections.json',
      sha256: createHash('sha256').update(VALID_CORRECTIONS).digest('hex'),
    });
  });

  it('file: a missing file is 422 INVALID_CORRECTIONS, recorded as a failed run, no path leaked', async () => {
    const dir = join(tempDir, 'nowhere');
    await start({ importCorrections: { kind: 'file', path: join(dir, 'missing.json') } });
    const res = await post();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_CORRECTIONS', message: 'Corrections file not found: missing.json' },
    });
    expect(res.body).not.toContain(tempDir.replace(/\\/g, '\\\\'));
    expect(state.calls).toHaveLength(0);
    const runs = (
      await app.inject({ method: 'GET', url: '/api/import/runs' })
    ).json<ImportRunsResponse>();
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({
      status: 'failed',
      trigger: 'upload',
      fileSizeBytes: WORKBOOK.length,
      correctionsName: 'missing.json',
      totals: null,
      error: { code: 'INVALID_CORRECTIONS' },
    });
  });

  it.each([
    ['not JSON', '{nope'],
    ['the wrong shape', JSON.stringify({ version: 2, corrections: [] })],
  ])('file: %s is 422 INVALID_CORRECTIONS', async (_label, text) => {
    const path = writeFile(join(tempDir, 'bad', 'corrections.json'), text);
    await start({ importCorrections: { kind: 'file', path } });
    const res = await post();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CORRECTIONS' } });
    expect(state.calls).toHaveLength(0);
    expect(importLock.held).toBe(false);
  });

  it('auto: DATA_DIR first, then <repoRoot>/reference, else none', async () => {
    const repoRoot = join(tempDir, 'repo');
    await start({ importCorrections: { kind: 'auto' }, repoRoot });
    expect((await post()).statusCode).toBe(201);
    expect(state.calls[0]?.corrections).toBeNull();

    writeFile(join(repoRoot, 'reference', 'import-corrections.json'), VALID_CORRECTIONS);
    expect((await post('?dryRun=true')).statusCode).toBe(200);
    expect(state.calls[1]?.correctionsSource?.name).toBe('import-corrections.json');
    const referenceSha = state.calls[1]?.correctionsSource?.sha256;

    const dataFile = VALID_CORRECTIONS.replace('Synthetic day/month swap', 'Synthetic, data dir');
    writeFile(join(config.dataDir, 'import-corrections.json'), dataFile);
    expect((await post('?dryRun=true')).statusCode).toBe(200);
    const dataSha = state.calls[2]?.correctionsSource?.sha256;
    expect(dataSha).toBe(createHash('sha256').update(dataFile).digest('hex'));
    expect(dataSha).not.toBe(referenceSha);
  });

  it('auto without a repo root never looks in a checkout', async () => {
    await start({ importCorrections: { kind: 'auto' }, repoRoot: null });
    expect((await post()).statusCode).toBe(201);
    expect(state.calls[0]?.corrections).toBeNull();
  });
});

describe('GET /api/import/runs and /api/import/runs/:id', () => {
  it('lists nothing on a fresh database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/import/runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runs: [],
      hasImportedData: false,
      hasAppData: false,
      inProgress: false,
    });
  });

  it('lists runs newest first (at most 50) and reports imported data', async () => {
    for (let i = 0; i < IMPORT_RUNS_LIST_CAP + 2; i++) {
      database.db
        .insert(importRuns)
        .values({
          startedAt: new Date(NOW.getTime() + i * 60_000).toISOString(),
          status: 'succeeded',
          trigger: 'cli',
          fileName: `run-${i}.xlsx`,
          fileSha256: 'b'.repeat(64),
          fileSize: 10,
          importerVersion: '1.0.0',
          totalsJson: JSON.stringify(totalsOf([])),
        })
        .run();
    }
    addDomainData();
    const body = (
      await app.inject({ method: 'GET', url: '/api/import/runs' })
    ).json<ImportRunsResponse>();
    expect(body.runs).toHaveLength(IMPORT_RUNS_LIST_CAP);
    expect(body.runs[0]?.fileName).toBe(`run-${IMPORT_RUNS_LIST_CAP + 1}.xlsx`);
    expect(body.runs[0]).not.toHaveProperty('report');
    expect(body.runs[0]?.totals).toEqual({
      match: 0,
      explained: 0,
      unexplained: 0,
      suspect: 0,
      info: 0,
    });
    expect(body.hasImportedData).toBe(true);
    expect(body.inProgress).toBe(false);
  });

  it('returns one run with its report', async () => {
    const created = (await post()).json<ImportRunDetail>();
    const res = await app.inject({ method: 'GET', url: `/api/import/runs/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<ImportRunDetail>()).toEqual(created);
  });

  it('answers 404 for an unknown run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/import/runs/999' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999999999999'])(
    'answers 400 for id %s',
    async (id) => {
      const res = await app.inject({ method: 'GET', url: `/api/import/runs/${id}` });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    },
  );
});

describe('wired into buildApp', () => {
  it('serves the import routes with cache-control: no-store', async () => {
    const real = await buildApp({ config: testConfig(join(tempDir, 'data')), db: database });
    try {
      const res = await real.inject({ method: 'GET', url: '/api/import/runs' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const bad = await real.inject({ method: 'GET', url: '/api/import/runs/0' });
      expect(bad.headers['cache-control']).toBe('no-store');
    } finally {
      // buildApp owns the database: re-open it for afterEach.
      await real.close();
      database = openDatabase(join(tempDir, 'data'));
    }
  });
});

describe('sanitiseFileName', () => {
  it.each<[string | undefined, string]>([
    [undefined, DEFAULT_UPLOAD_FILE_NAME],
    ['', DEFAULT_UPLOAD_FILE_NAME],
    ['   ', DEFAULT_UPLOAD_FILE_NAME],
    ['..', DEFAULT_UPLOAD_FILE_NAME],
    ['book.xlsx', 'book.xlsx'],
    [encodeURIComponent('My book – 2026.xlsx'), 'My book – 2026.xlsx'],
    ['C%3A%5Cusers%5Cx%5Cbook.xlsx', 'book.xlsx'],
    ['..%2F..%2Fetc%2Fpasswd', 'passwd'],
    ['a/b\\c.xlsx', 'c.xlsx'],
    ['bad%E0%A4%A.xlsx', 'bad%E0%A4%A.xlsx'],
    ['line%0Abreak.xlsx', 'linebreak.xlsx'],
  ])('%s → %s', (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected);
  });

  it('caps the name at 200 characters', () => {
    expect(sanitiseFileName(`${'x'.repeat(300)}.xlsx`)).toHaveLength(200);
  });
});
