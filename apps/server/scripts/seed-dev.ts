// `pnpm seed:dev`: replaces the data in DATA_DIR with the generic seed (stage-1.md §1.4), for UI
// work without the importer. Uses the same config rules as the server (DATA_DIR, MIGRATIONS_DIR).
// Like the import CLI, it refuses to replace existing data without `--yes`, and with `--yes` it
// backs the database up first (the default DATA_DIR is the working database `pnpm dev` uses).
import { basename } from 'node:path';
import { importRuns } from '@joinr/schema/db';
import { seedGenericData } from '@joinr/schema/testing';
import { ne } from 'drizzle-orm';
import { ConfigError, loadConfig } from '../src/config';
import { backupBeforeImport } from '../src/db/backup';
import { closeDatabase, openDatabase, runMigrations } from '../src/db/database';
import { hasDomainData } from '../src/db/queries/domain';

/** The fake workbook hash the generic seed stamps on its own import run. */
const SEED_FILE_SHA256 = 'a'.repeat(64);
/** Exit code when confirmation is needed (as the import CLI). */
const EXIT_NEEDS_YES = 3;

function run(): void {
  const config = loadConfig();
  const yes = process.argv.includes('--yes');
  const database = openDatabase(config.dataDir);
  try {
    const migrations = runMigrations(database, config.migrationsDir);
    const realImports =
      database.db
        .select({ id: importRuns.id })
        .from(importRuns)
        .where(ne(importRuns.fileSha256, SEED_FILE_SHA256))
        .limit(1)
        .all().length > 0;
    if (hasDomainData(database.db) || realImports) {
      if (!yes) {
        console.error(`This replaces the data in ${config.dataDir}; re-run with --yes`);
        process.exitCode = EXIT_NEEDS_YES;
        return;
      }
      const backup = backupBeforeImport(database, config.dataDir);
      console.log(`Backed up the database to backups/${basename(backup)}.`);
    }
    const result = seedGenericData(database.db);
    console.log(
      `Seeded generic data into ${config.dbFile} ` +
        `(${Object.keys(result.instrumentIds).length} instruments; ` +
        `${migrations.total} migrations applied).`,
    );
  } finally {
    closeDatabase(database);
  }
}

try {
  run();
} catch (err) {
  console.error(
    `seed:dev failed: ${err instanceof ConfigError || err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
}
