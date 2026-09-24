// The upload path end to end with the real importer and the generic synthetic workbook
// (stage-1.md §7.5 step 2). Gated until the importer reports both flags implemented; the Verifier
// confirms it ran. Corrections are off (testConfig), so the owner's file is never read.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import type {
  AppStatus,
  ImportRunDetail,
  ImportRunsResponse,
  RecordsIndexResponse,
} from '@joinr/schema';
import { dumpDomainTablesJson } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { BACKUPS_DIR_NAME } from '../src/db/backup';
import { openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { makeTempDir, removeDir, testConfig } from './helpers';

describe.skipIf(!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED)(
  'POST /api/import with the real importer (synthetic workbook)',
  { timeout: 60_000 },
  () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    let workbook: Buffer;

    beforeAll(async () => {
      tempDir = await makeTempDir();
      const config = testConfig(join(tempDir, 'data'));
      database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      app = await buildApp({ config, db: database });
      workbook = Buffer.from(buildSyntheticWorkbook());
    });

    afterAll(async () => {
      await app?.close(); // closes the database too
      if (tempDir) await removeDir(tempDir);
    });

    const upload = (query: string, body: Buffer = workbook) =>
      app.inject({
        method: 'POST',
        url: `/api/import${query}`,
        payload: body,
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent('synthetic workbook.xlsx'),
        },
      });

    const dump = (): string => dumpDomainTablesJson(database.db);
    const backups = (): string[] => {
      const dir = join(tempDir, 'data', BACKUPS_DIR_NAME);
      return existsSync(dir) ? readdirSync(dir) : [];
    };

    let firstDump: string;

    it('imports the clean workbook into an empty database with zero unexplained', async () => {
      const res = await upload('');
      expect(res.statusCode).toBe(201);
      const run = res.json<ImportRunDetail>();
      expect(run).toMatchObject({
        status: 'succeeded',
        dryRun: false,
        trigger: 'upload',
        fileName: 'synthetic workbook.xlsx',
        fileSizeBytes: workbook.length,
        error: null,
      });
      expect(run.totals?.unexplained).toBe(0);
      expect(run.report?.totals.unexplained).toBe(0);
      expect(run.report?.checks.length).toBeGreaterThan(0);
      expect(backups()).toEqual([]);
      firstDump = dump();
    });

    it('shows the imported data in the record browser and the status', async () => {
      const index = (
        await app.inject({ method: 'GET', url: '/api/records' })
      ).json<RecordsIndexResponse>();
      const counts = Object.fromEntries(index.entities.map((e) => [e.id, e.count]));
      for (const id of [
        'instruments',
        'trades',
        'dividends',
        'cash-accounts',
        'snapshots',
        'settings',
      ]) {
        expect(counts[id], id).toBeGreaterThan(0);
      }
      for (const e of index.entities) {
        const page = await app.inject({ method: 'GET', url: `/api/records/${e.id}` });
        expect(page.statusCode, e.id).toBe(200);
      }
      const status = (await app.inject({ method: 'GET', url: '/api/status' })).json<AppStatus>();
      expect(status.import).toMatchObject({ lastStatus: 'succeeded', hasImportedData: true });
      expect(status.snapshots.count).toBeGreaterThan(0);
    });

    it('requires confirmation to replace, and a dry run changes nothing', async () => {
      const refused = await upload('');
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: { code: 'IMPORT_CONFIRM_REQUIRED' } });

      const dry = await upload('?dryRun=true');
      expect(dry.statusCode).toBe(200);
      expect(dry.json<ImportRunDetail>()).toMatchObject({ dryRun: true, status: 'succeeded' });
      expect(dry.json<ImportRunDetail>().totals?.unexplained).toBe(0);
      expect(dump()).toBe(firstDump);
      expect(backups()).toEqual([]);
    });

    it('re-imports idempotently after a pre-import backup', async () => {
      const res = await upload('?confirmReplace=true');
      expect(res.statusCode).toBe(201);
      expect(res.json<ImportRunDetail>().totals?.unexplained).toBe(0);
      expect(backups()).toHaveLength(1);
      expect(dump()).toBe(firstDump);
    });

    it('rejects a body that is not a workbook with 422 and records the failed run', async () => {
      const res = await upload('?confirmReplace=true', Buffer.from('this is not a workbook'));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'INVALID_WORKBOOK' } });
      expect(dump()).toBe(firstDump);

      const runs = (
        await app.inject({ method: 'GET', url: '/api/import/runs' })
      ).json<ImportRunsResponse>();
      expect(runs.runs.map((r) => r.status)).toEqual([
        'failed',
        'succeeded',
        'succeeded',
        'succeeded',
      ]);
      expect(runs.runs.map((r) => r.dryRun)).toEqual([false, false, true, false]);
      expect(runs).toMatchObject({ hasImportedData: true, inProgress: false });
      const detail = await app.inject({
        method: 'GET',
        url: `/api/import/runs/${runs.runs[1]!.id}`,
      });
      expect(detail.json<ImportRunDetail>().report?.totals.unexplained).toBe(0);
    });
  },
);
