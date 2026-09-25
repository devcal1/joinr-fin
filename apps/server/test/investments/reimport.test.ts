// D34 across the import paths (stage-2.md §3.3, §4.5, §7.4 step 5): the deletion marker blocks the
// upload, the upload re-checks hasAppData right before importing (after the corrections load),
// a committed import clears the marker (upload and CLI --yes --replace-app-data), and a re-import
// keeps a holding's default fee (the importer never writes those columns).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importWorkbook,
  parseCorrectionsFile,
  resolveCorrectionsPath,
  type ImportOptions,
} from '@joinr/importer';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  instrumentEditableFromDto,
  type HoldingDetailResponse,
  type ImportRunsResponse,
  type InstrumentDto,
} from '@joinr/schema';
import { cashAccounts, instruments } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { EXIT, main, type CliIo } from '../../src/cli/import';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import {
  clearAppEditMarker,
  DELETED_IMPORT_ROWS_KEY,
  hasAppData,
  markImportRowDeleted,
  readAppEditMarker,
} from '../../src/db/queries/domain';
import { registerErrorHandler } from '../../src/errors';
import {
  IMPORT_APP_DATA_EXISTS_MESSAGE,
  importRoutes,
  type ImporterApi,
} from '../../src/routes/import';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { fakeEngine, fakeMarket, NOW } from './helpers';

const CAN_IMPORT = SYNTHETIC_WORKBOOK_IMPLEMENTED && IMPORTER_IMPLEMENTED;

describe('the deletion marker helpers', () => {
  let tempDir: string;
  let database: AppDatabase;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    database = openDatabase(join(tempDir, 'data'));
    runMigrations(database, testConfig(tempDir).migrationsDir);
  });
  afterEach(async () => {
    closeDatabase(database);
    await removeDir(tempDir);
  });

  it('counts deletions, makes hasAppData true, and clears', () => {
    const db = database.db;
    expect(readAppEditMarker(db)).toBeNull();
    expect(hasAppData(db)).toBe(false);
    markImportRowDeleted(db, NOW);
    markImportRowDeleted(db, new Date(NOW.getTime() + 1000));
    expect(readAppEditMarker(db)).toEqual({
      count: 2,
      lastAt: new Date(NOW.getTime() + 1000).toISOString(),
    });
    expect(hasAppData(db)).toBe(true);
    clearAppEditMarker(db);
    expect(readAppEditMarker(db)).toBeNull();
    expect(hasAppData(db)).toBe(false);
  });

  it('reads a malformed marker as present with zero deletions', () => {
    database.sqlite
      .prepare('INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run(DELETED_IMPORT_ROWS_KEY, '{oops', NOW.toISOString());
    expect(readAppEditMarker(database.db)).toEqual({ count: 0, lastAt: '' });
    expect(hasAppData(database.db)).toBe(true);
    markImportRowDeleted(database.db, NOW);
    expect(readAppEditMarker(database.db)?.count).toBe(1);
  });
});

describe('the upload route re-checks hasAppData after loading the corrections', () => {
  let tempDir: string;
  let database: AppDatabase;
  let app: FastifyInstance;
  let calls: ImportOptions[];

  beforeEach(async () => {
    tempDir = await makeTempDir();
    const corrections = join(tempDir, 'corrections.json');
    writeFileSync(corrections, JSON.stringify({ version: 1, corrections: [] }));
    const config = testConfig(join(tempDir, 'data'), {
      importCorrections: { kind: 'file', path: corrections },
    });
    database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    calls = [];
    const importer: ImporterApi = {
      resolveCorrectionsPath,
      // Runs after the async file read: a mutation that commits in that gap.
      parseCorrectionsFile: (json) => {
        database.db
          .insert(cashAccounts)
          .values({ name: 'Example Bank', balanceCents: 0, sortOrder: 1, origin: 'app' })
          .run();
        return parseCorrectionsFile(json);
      },
      importWorkbook: (db, options) => {
        calls.push(options);
        return importWorkbook(db, options);
      },
    };
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(importRoutes, {
      prefix: '/api',
      database,
      config,
      market: fakeMarket(),
      importer,
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(database);
    await removeDir(tempDir);
  });

  it('answers 409 IMPORT_APP_DATA_EXISTS and never imports', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: Buffer.from('PK\u0003\u0004 generic test bytes'),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'IMPORT_APP_DATA_EXISTS', message: IMPORT_APP_DATA_EXISTS_MESSAGE },
    });
    expect(calls).toHaveLength(0);
  });
});

describe.skipIf(!CAN_IMPORT)(
  're-imports and the marker (synthetic workbook)',
  { timeout: 60_000 },
  () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    const workbook = CAN_IMPORT ? Buffer.from(buildSyntheticWorkbook()) : Buffer.alloc(0);

    beforeEach(async () => {
      tempDir = await makeTempDir();
      const config = testConfig(join(tempDir, 'data'));
      database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      app = await buildApp({ config, db: database, now: () => NOW, engine: fakeEngine() });
    });

    afterEach(async () => {
      await app.close();
      await removeDir(tempDir);
    });

    const upload = (query = '') =>
      app.inject({
        method: 'POST',
        url: `/api/import${query}`,
        payload: workbook,
        headers: { 'content-type': 'application/octet-stream' },
      });

    const runs = async () =>
      (await app.inject({ method: 'GET', url: '/api/import/runs' })).json<ImportRunsResponse>();

    const etfId = (symbol: string): number => {
      const row = database.db
        .select({ id: instruments.id })
        .from(instruments)
        .where(and(eq(instruments.kind, 'etf'), eq(instruments.symbol, symbol)))
        .get();
      if (!row) throw new Error(`no ETF ${symbol}`);
      return row.id;
    };

    it('keeps a default fee across a re-import (a default-fee-only change is not app data)', async () => {
      expect((await upload()).statusCode).toBe(201);
      const def = etfId('ASX:DEF');
      const dto = (
        await app.inject({ method: 'GET', url: `/api/instruments/${def}` })
      ).json<HoldingDetailResponse>().instrument;
      const put = await app.inject({
        method: 'PUT',
        url: `/api/instruments/${def}`,
        payload: { ...instrumentEditableFromDto(dto), defaultFee: { kind: 'flat', cents: 0 } },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json<InstrumentDto>().origin).toBe('import');
      expect((await runs()).hasAppData).toBe(false);

      const again = await upload('?confirmReplace=true');
      expect(again.statusCode).toBe(201);
      expect(etfId('ASX:DEF')).toBe(def);
      const after = (
        await app.inject({ method: 'GET', url: `/api/instruments/${def}` })
      ).json<HoldingDetailResponse>().instrument;
      expect(after.defaultFee).toEqual({ kind: 'flat', cents: 0 });
      expect(after.effectiveDefaultFee).toEqual({ kind: 'flat', cents: 0 });
      expect(after.origin).toBe('import');
    });

    it('refuses the upload while the marker exists (409), however it was written', async () => {
      expect((await upload()).statusCode).toBe(201);
      // A workbook trade deleted in the app writes the marker (and nothing else is app data).
      const trade = database.sqlite
        .prepare("SELECT id FROM trades WHERE origin = 'import' ORDER BY id LIMIT 1")
        .get() as { id: number };
      const del = await app.inject({ method: 'DELETE', url: `/api/trades/${trade.id}` });
      expect(del.statusCode).toBe(200);
      expect(readAppEditMarker(database.db)?.count).toBe(1);
      expect((await runs()).hasAppData).toBe(true);
      const res = await upload('?confirmReplace=true');
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        error: { code: 'IMPORT_APP_DATA_EXISTS', message: IMPORT_APP_DATA_EXISTS_MESSAGE },
      });
      // A dry run is still allowed and leaves the marker.
      expect((await upload('?dryRun=true')).statusCode).toBe(200);
      expect(readAppEditMarker(database.db)).not.toBeNull();
    });
  },
);

describe.skipIf(!CAN_IMPORT)(
  'the CLI clears the marker after a committed import',
  { timeout: 60_000 },
  () => {
    let root: string;
    let workbook: string;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'joinr-inv-cli-'));
      workbook = join(root, 'synthetic.xlsx');
      writeFileSync(workbook, buildSyntheticWorkbook());
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    const run = (argv: string[], dataDir: string) => {
      const io: CliIo = {
        stdout: { write: () => true },
        stderr: { write: () => true },
        env: { NODE_ENV: 'test', DATA_DIR: dataDir, IMPORT_CORRECTIONS_FILE: 'none' },
        cwd: root,
      };
      return main(argv, io);
    };

    const withDb = <T>(dataDir: string, fn: (database: AppDatabase) => T): T => {
      const database = openDatabase(dataDir);
      try {
        return fn(database);
      } finally {
        closeDatabase(database);
      }
    };

    it('exits 3 while the marker exists; --yes --replace-app-data imports and clears it', async () => {
      const dataDir = join(root, 'data-marker');
      expect(await run([workbook], dataDir)).toBe(EXIT.ok);
      withDb(dataDir, (d) => markImportRowDeleted(d.db, NOW));

      expect(await run([workbook, '--yes'], dataDir)).toBe(EXIT.confirm);
      // A dry run leaves the marker.
      expect(await run([workbook, '--dry-run'], dataDir)).toBe(EXIT.ok);
      expect(withDb(dataDir, (d) => readAppEditMarker(d.db))).not.toBeNull();

      expect(await run([workbook, '--yes', '--replace-app-data'], dataDir)).toBe(EXIT.ok);
      expect(withDb(dataDir, (d) => readAppEditMarker(d.db))).toBeNull();
      expect(withDb(dataDir, (d) => hasAppData(d.db))).toBe(false);
    });
  },
);
