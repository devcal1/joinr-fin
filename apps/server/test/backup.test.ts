// Pre-import backups (stage-1.md §3.4 step 5), through the Stage 7 verified copy (stage-7.md §5.2,
// §5.3, §11 item 1): named with the local offset, verified, newest 10 kept; the Stage 1
// offset-less names still prune; other files are left alone.
process.env.TZ = 'Australia/Melbourne';

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMITTED_MIGRATION_COUNT } from '@joinr/schema/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupBeforeImport,
  BACKUPS_DIR_NAME,
  PRE_IMPORT_KEEP,
  preImportBackupName,
} from '../src/db/backup';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { recordStartup, setMeta } from '../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from './helpers';

let tempDir: string;
let dataDir: string;
let database: AppDatabase;

beforeEach(async () => {
  tempDir = await makeTempDir();
  dataDir = join(tempDir, 'data');
  database = openDatabase(dataDir);
  runMigrations(database, MIGRATIONS_DIR);
  recordStartup(database.db);
});

afterEach(async () => {
  closeDatabase(database);
  await removeDir(tempDir);
});

describe('backupBeforeImport', () => {
  it('names backups by local time with the offset', () => {
    expect(preImportBackupName(new Date(2026, 8, 4, 7, 5, 9))).toBe(
      'pre-import-20260904-070509+1000.db',
    );
    expect(preImportBackupName(new Date(2026, 11, 4, 7, 5, 9))).toBe(
      'pre-import-20261204-070509+1100.db',
    );
  });

  it('keeps the Stage 1 count (D115)', () => {
    expect(PRE_IMPORT_KEEP).toBe(10);
  });

  it('writes a consistent, verified copy with no sidecars', () => {
    setMeta(database.db, 'example', 'value');
    const path = backupBeforeImport(database, dataDir, new Date(2026, 8, 24, 14, 30, 0));
    expect(path).toBe(join(dataDir, BACKUPS_DIR_NAME, 'pre-import-20260924-143000+1000.db'));
    expect(readdirSync(join(dataDir, BACKUPS_DIR_NAME))).toEqual([
      'pre-import-20260924-143000+1000.db',
    ]);
    const copy = new Database(path, { readonly: true });
    try {
      expect(copy.prepare("SELECT value FROM app_meta WHERE key = 'example'").get()).toEqual({
        value: 'value',
      });
      expect(copy.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
        n: COMMITTED_MIGRATION_COUNT,
      });
      expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    } finally {
      copy.close();
    }
  });

  it('never overwrites a backup taken in the same second', () => {
    const at = new Date(2026, 8, 24, 14, 30, 0);
    const a = backupBeforeImport(database, dataDir, at);
    const b = backupBeforeImport(database, dataDir, at);
    expect(a).not.toBe(b);
    expect(b.endsWith('pre-import-20260924-143000+1000-2.db')).toBe(true);
  });

  it('keeps the newest 10 pre-import backups (legacy names included) and leaves other files alone', () => {
    const dir = join(dataDir, BACKUPS_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    // Two Stage 1 names (no offset), older than everything below.
    writeFileSync(join(dir, 'pre-import-20251231-120000.db'), '');
    writeFileSync(join(dir, 'pre-import-20251231-120000-2.db'), '');
    writeFileSync(join(dir, 'manual-copy.db'), '');
    writeFileSync(join(dir, 'nightly-20251231-023000+1100.db'), '');
    for (let i = 0; i < 11; i++) {
      backupBeforeImport(database, dataDir, new Date(2026, 0, 1, 0, 0, i));
    }
    const names = readdirSync(dir);
    expect(names.filter((n) => n.startsWith('pre-import-'))).toHaveLength(10);
    expect(names).toContain('manual-copy.db');
    expect(names).toContain('nightly-20251231-023000+1100.db');
    expect(existsSync(join(dir, 'pre-import-20251231-120000.db'))).toBe(false);
    expect(existsSync(join(dir, 'pre-import-20251231-120000-2.db'))).toBe(false);
    expect(existsSync(join(dir, 'pre-import-20260101-000000+1100.db'))).toBe(false);
    expect(existsSync(join(dir, 'pre-import-20260101-000001+1100.db'))).toBe(true);
    expect(existsSync(join(dir, 'pre-import-20260101-000010+1100.db'))).toBe(true);
  });
});
