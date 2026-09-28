// Start-up safety (stage-7.md §5.7): `migrateWithBackup` replaces the bare `runMigrations` in
// index.ts and the import CLI.
//   - applied > known → refuse (a newer version migrated this database); nothing is written.
//   - 0 < applied < known → a verified `pre-migrate` backup first (5 kept), then the migrations.
//   - a fresh database (applied = 0) migrates without a backup.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config';
import {
  countAppliedMigrations,
  runMigrations,
  type AppDatabase,
  type MigrationResult,
} from '../db/database';
import { BackupError, writeVerifiedBackup } from './copy';

export interface MigrationJournal {
  /** Each entry's `when` (the `created_at` Drizzle stores for it), in order. */
  whens: number[];
}

/** Reads `<migrationsDir>/meta/_journal.json`. Throws when it is missing or malformed. */
export function readMigrationJournal(migrationsDir: string): MigrationJournal {
  const raw: unknown = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  );
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error('The migrations journal has no entries');
  const whens = entries.map((e: unknown) => {
    const when = (e as { when?: unknown } | null)?.when;
    if (typeof when !== 'number') throw new Error('The migrations journal is malformed');
    return when;
  });
  return { whens };
}

/** The refusal to open a database a newer version migrated (exit 1). */
export class NewerDatabaseError extends Error {
  readonly applied: number;
  readonly known: number;

  constructor(applied: number, known: number) {
    super(
      `This database was updated by a newer version of Joinr Finance (level ${applied}; this version knows ${known}). ` +
        'Install that version or newer, or restore a backup made before the update.',
    );
    this.name = 'NewerDatabaseError';
    this.applied = applied;
    this.known = known;
  }
}

/**
 * The pre-update backup failed (§5.7): nothing was migrated. The message names the step, the
 * category (§4.1) and that the database was not updated (Fixer SPEC-8).
 */
export class PreUpdateBackupError extends Error {
  readonly reason: BackupError['reason'];

  constructor(cause: BackupError) {
    super(`The pre-update backup failed: ${cause.message}. The database was not updated.`);
    this.name = 'PreUpdateBackupError';
    this.reason = cause.reason;
  }
}

export interface MigrateWithBackupResult extends MigrationResult {
  /** The level before this call. */
  from: number;
  /** The pre-migrate backup's file name, when one was taken. */
  backup: string | null;
}

export function migrateWithBackup(
  database: AppDatabase,
  config: Pick<Config, 'dataDir' | 'migrationsDir'>,
  now: Date = new Date(),
  log?: { info(obj: object, msg: string): void },
): MigrateWithBackupResult {
  const applied = countAppliedMigrations(database.sqlite);
  const known = readMigrationJournal(config.migrationsDir).whens.length;
  if (applied > known) throw new NewerDatabaseError(applied, known);
  let backup: string | null = null;
  if (applied > 0 && applied < known) {
    try {
      backup = writeVerifiedBackup(database, config.dataDir, 'pre-migrate', now).name;
    } catch (err) {
      if (err instanceof BackupError) throw new PreUpdateBackupError(err);
      throw err;
    }
    // The two levels and the file name only: never a path or a figure.
    log?.info({ from: applied, to: known, backup }, 'pre-update backup written');
  }
  const result = runMigrations(database, config.migrationsDir);
  return { ...result, from: applied, backup };
}
