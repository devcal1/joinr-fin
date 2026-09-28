// Pre-import backups are verified (stage-7.md §8.2 step 1, §11 item 1): a copy that fails its
// check stops the import (the upload answers 500 BACKUP_FAILED, the CLI exits 1) and no run row is
// written. The verified copy is replaced here by a module mock that fails like a bad check.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSyntheticWorkbook } from '@joinr/importer/testing';
import type { ApiErrorBody, ImportRunsResponse } from '@joinr/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { main, type CliIo } from '../../src/cli/import';
import { openDatabase, runMigrations } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

const control = vi.hoisted(() => ({ fail: false }));

vi.mock('../../src/backups/copy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/backups/copy')>();
  return {
    ...original,
    writeVerifiedBackup: ((...args: Parameters<typeof original.writeVerifiedBackup>) => {
      if (control.fail) throw new original.BackupError('verify_failed', 'SQLITE_CORRUPT');
      return original.writeVerifiedBackup(...args);
    }) as typeof original.writeVerifiedBackup,
  };
});

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir('joinr-import-backup-test-');
  control.fail = false;
});

afterEach(async () => {
  control.fail = false;
  await removeDir(tempDir);
});

describe('a pre-import backup that fails its check', () => {
  it('stops an upload with 500 BACKUP_FAILED and writes no run row', async () => {
    const config = testConfig(join(tempDir, 'data'));
    const database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    const app = await buildApp({ config, db: database });
    try {
      const workbook = Buffer.from(buildSyntheticWorkbook());
      const upload = (query: string) =>
        app.inject({
          method: 'POST',
          url: `/api/import${query}`,
          payload: workbook,
          headers: { 'content-type': 'application/octet-stream' },
        });
      expect((await upload('')).statusCode).toBe(201); // empty database: no backup needed
      const runsBefore = (
        await app.inject({ method: 'GET', url: '/api/import/runs' })
      ).json<ImportRunsResponse>().runs.length;
      control.fail = true;
      const res = await upload('?confirmReplace=true');
      expect(res.statusCode).toBe(500);
      expect(res.json<ApiErrorBody>()).toEqual({
        error: { code: 'BACKUP_FAILED', message: 'The copy failed its check' },
      });
      const after = (
        await app.inject({ method: 'GET', url: '/api/import/runs' })
      ).json<ImportRunsResponse>();
      expect(after.runs).toHaveLength(runsBefore);
      expect(after.inProgress).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('stops the CLI with exit 1 and writes no run row', async () => {
    const dataDir = join(tempDir, 'cli-data');
    const workbook = join(tempDir, 'synthetic.xlsx');
    writeFileSync(workbook, buildSyntheticWorkbook());
    let out = '';
    let err = '';
    const io: CliIo = {
      stdout: { write: (s: string) => (out += s) },
      stderr: { write: (s: string) => (err += s) },
      env: { NODE_ENV: 'test', DATA_DIR: dataDir, IMPORT_CORRECTIONS_FILE: 'none' },
      cwd: tempDir,
    };
    expect(await main([workbook, '--no-corrections'], io)).toBe(0);
    control.fail = true;
    out = '';
    const code = await main([workbook, '--no-corrections', '--yes'], io);
    expect(code).toBe(1);
    expect(err).toContain(
      'The pre-import backup failed: The copy failed its check. Nothing was imported.',
    );
    expect(out).not.toContain('Run #');
    const db = openDatabase(dataDir);
    try {
      const n = db.sqlite.prepare('SELECT count(*) AS n FROM import_runs').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      db.sqlite.close();
    }
  });
});
