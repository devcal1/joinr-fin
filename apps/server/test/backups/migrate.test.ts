// Start-up safety (stage-7.md §5.7, §5.11): a fresh database migrates without a backup; a database
// behind gets one verified `pre-migrate` copy first (5 kept); a database ahead is refused and
// nothing is written.
process.env.TZ = 'Australia/Melbourne';

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMITTED_MIGRATION_COUNT } from '@joinr/schema/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrateWithBackup,
  NewerDatabaseError,
  PreUpdateBackupError,
  readMigrationJournal,
} from '../../src/backups/migrate';
import { formatBackupName } from '../../src/backups/names';
import {
  closeDatabase,
  countAppliedMigrations,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from '../helpers';

const AT = new Date(2030, 8, 15, 10, 0, 0);

let tempDir: string;
let dataDir: string;
let database: AppDatabase;
const config = () => ({ dataDir, migrationsDir: MIGRATIONS_DIR });

beforeEach(async () => {
  tempDir = await makeTempDir('joinr-migrate-test-');
  dataDir = join(tempDir, 'data');
  database = openDatabase(dataDir);
});

afterEach(async () => {
  closeDatabase(database);
  await removeDir(tempDir);
});

/** A copy of the migrations folder whose journal stops after `n` entries. */
function truncatedMigrations(n: number): string {
  const dir = join(tempDir, `migrations-${n}`);
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, n);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const backups = (): string[] => {
  const dir = join(dataDir, 'backups');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

describe('readMigrationJournal', () => {
  it('reads every entry of the committed journal', () => {
    expect(readMigrationJournal(MIGRATIONS_DIR).whens).toHaveLength(COMMITTED_MIGRATION_COUNT);
  });
});

describe('migrateWithBackup', () => {
  it('migrates a fresh database without a backup', () => {
    const r = migrateWithBackup(database, config(), AT);
    expect(r).toEqual({
      applied: COMMITTED_MIGRATION_COUNT,
      total: COMMITTED_MIGRATION_COUNT,
      from: 0,
      backup: null,
    });
    expect(backups()).toEqual([]);
  });

  it('does nothing on an up-to-date database', () => {
    runMigrations(database, MIGRATIONS_DIR);
    const r = migrateWithBackup(database, config(), AT);
    expect(r.backup).toBeNull();
    expect(r.applied).toBe(0);
    expect(backups()).toEqual([]);
  });

  it('takes one verified pre-migrate copy of a database one level behind, then migrates', () => {
    runMigrations(database, truncatedMigrations(COMMITTED_MIGRATION_COUNT - 1));
    expect(countAppliedMigrations(database.sqlite)).toBe(COMMITTED_MIGRATION_COUNT - 1);
    const logged: unknown[] = [];
    const r = migrateWithBackup(database, config(), AT, { info: (obj) => logged.push(obj) });
    expect(r.backup).toBe('pre-migrate-20300915-100000+1000.db');
    expect(r.from).toBe(COMMITTED_MIGRATION_COUNT - 1);
    expect(r.total).toBe(COMMITTED_MIGRATION_COUNT);
    expect(backups()).toEqual(['pre-migrate-20300915-100000+1000.db']);
    const copy = new Database(join(dataDir, 'backups', r.backup!), { readonly: true });
    try {
      expect(countAppliedMigrations(copy)).toBe(COMMITTED_MIGRATION_COUNT - 1);
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      copy.close();
    }
    expect(logged).toEqual([
      { from: COMMITTED_MIGRATION_COUNT - 1, to: COMMITTED_MIGRATION_COUNT, backup: r.backup },
    ]);
  });

  it('refuses a database a newer version migrated, and writes nothing', () => {
    runMigrations(database, MIGRATIONS_DIR);
    database.sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('f'.repeat(64), 4_000_000_000_000);
    let err: unknown;
    try {
      migrateWithBackup(database, config(), AT);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NewerDatabaseError);
    expect((err as Error).message).toBe(
      `This database was updated by a newer version of Joinr Finance (level ${COMMITTED_MIGRATION_COUNT + 1}; this version knows ${COMMITTED_MIGRATION_COUNT}). Install that version or newer, or restore a backup made before the update.`,
    );
    expect(backups()).toEqual([]);
    expect(countAppliedMigrations(database.sqlite)).toBe(COMMITTED_MIGRATION_COUNT + 1);
  });

  it('a failed pre-update backup says so, and migrates nothing (Fixer SPEC-8)', () => {
    runMigrations(database, truncatedMigrations(COMMITTED_MIGRATION_COUNT - 1));
    // A file where the backups folder should be: the copy cannot be written.
    writeFileSync(join(dataDir, 'backups'), 'not a folder');
    let err: unknown;
    try {
      migrateWithBackup(database, config(), AT);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PreUpdateBackupError);
    expect((err as Error).message).toBe(
      'The pre-update backup failed: The copy could not be written. The database was not updated.',
    );
    expect(countAppliedMigrations(database.sqlite)).toBe(COMMITTED_MIGRATION_COUNT - 1);
  });

  it('keeps the newest 5 pre-migrate copies', () => {
    runMigrations(database, truncatedMigrations(COMMITTED_MIGRATION_COUNT - 1));
    mkdirSync(join(dataDir, 'backups'), { recursive: true });
    const old = Array.from({ length: 5 }, (_, i) =>
      formatBackupName('pre-migrate', new Date(2030, 0, 1 + i)),
    );
    for (const n of old) writeFileSync(join(dataDir, 'backups', n), 'x');
    const r = migrateWithBackup(database, config(), AT);
    expect(backups()).toEqual([...old.slice(1), r.backup!].sort());
  });
});
