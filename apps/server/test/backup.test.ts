import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMITTED_MIGRATION_COUNT } from '@joinr/schema/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupBeforeImport,
  BACKUPS_DIR_NAME,
  preImportBackupName,
  prunePreImportBackups,
} from '../src/db/backup';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { setMeta } from '../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from './helpers';

let tempDir: string;
let dataDir: string;
let database: AppDatabase;

beforeEach(async () => {
  tempDir = await makeTempDir();
  dataDir = join(tempDir, 'data');
  database = openDatabase(dataDir);
  runMigrations(database, MIGRATIONS_DIR);
});

afterEach(async () => {
  closeDatabase(database);
  await removeDir(tempDir);
});

describe('backupBeforeImport', () => {
  it('names backups by local time', () => {
    expect(preImportBackupName(new Date(2026, 8, 4, 7, 5, 9))).toBe(
      'pre-import-20260904-070509.db',
    );
  });

  it('writes a consistent copy with VACUUM INTO', () => {
    setMeta(database.db, 'example', 'value');
    const path = backupBeforeImport(database, dataDir, new Date(2026, 8, 24, 14, 30, 0));
    expect(path).toBe(join(dataDir, BACKUPS_DIR_NAME, 'pre-import-20260924-143000.db'));
    const copy = new Database(path, { readonly: true });
    try {
      expect(copy.prepare("SELECT value FROM app_meta WHERE key = 'example'").get()).toEqual({
        value: 'value',
      });
      expect(copy.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
        n: COMMITTED_MIGRATION_COUNT,
      });
    } finally {
      copy.close();
    }
  });

  it('never overwrites a backup taken in the same second', () => {
    const at = new Date(2026, 8, 24, 14, 30, 0);
    const a = backupBeforeImport(database, dataDir, at);
    const b = backupBeforeImport(database, dataDir, at);
    expect(a).not.toBe(b);
    expect(b.endsWith('pre-import-20260924-143000-2.db')).toBe(true);
  });

  it('keeps the newest 10 pre-import backups and leaves other files alone', () => {
    const dir = join(dataDir, BACKUPS_DIR_NAME);
    for (let i = 0; i < 12; i++) {
      backupBeforeImport(database, dataDir, new Date(2026, 0, 1, 0, 0, i));
    }
    writeFileSync(join(dir, 'manual-copy.db'), '');
    const names = readdirSync(dir);
    expect(names.filter((n) => n.startsWith('pre-import-'))).toHaveLength(10);
    expect(names).toContain('manual-copy.db');
    expect(existsSync(join(dir, 'pre-import-20260101-000000.db'))).toBe(false);
    expect(existsSync(join(dir, 'pre-import-20260101-000001.db'))).toBe(false);
    expect(existsSync(join(dir, 'pre-import-20260101-000011.db'))).toBe(true);
  });

  it('prunes by time, then by the same-second suffix', () => {
    const dir = join(tempDir, 'prune');
    mkdirSync(dir);
    for (const f of [
      'pre-import-20260101-000000-2.db',
      'pre-import-20260101-000000-10.db',
      'pre-import-20260101-000000.db',
    ]) {
      writeFileSync(join(dir, f), '');
    }
    expect(prunePreImportBackups(dir, 1)).toEqual([
      'pre-import-20260101-000000.db',
      'pre-import-20260101-000000-2.db',
    ]);
    expect(readdirSync(dir)).toEqual(['pre-import-20260101-000000-10.db']);
  });
});
