// The running marker (stage-7.md §5.8): set when the server listens, gone after a clean close; a
// crash (no close) leaves it, which the CLIs read without changing the database.
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { readRunningMarker } from '../../src/backups/live';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { META_KEYS } from '../../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir, testConfig } from '../helpers';
import { liveHashes } from './helpers';

const NOW = new Date('2030-09-15T01:00:00.000Z');

let tempDir: string;
let dataDir: string;
let database: AppDatabase;

beforeEach(async () => {
  tempDir = await makeTempDir('joinr-marker-test-');
  dataDir = join(tempDir, 'data');
  database = openDatabase(dataDir);
  runMigrations(database, MIGRATIONS_DIR);
});

afterEach(async () => {
  closeDatabase(database);
  await removeDir(tempDir);
});

const markerIn = (db: AppDatabase): unknown =>
  db.sqlite.prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEYS.runningSince);

describe('server.running_since', () => {
  it('is set on listen and deleted on close', async () => {
    const app = await buildApp({ config: testConfig(dataDir), db: database, now: () => NOW });
    expect(markerIn(database)).toBeUndefined();
    await app.listen({ port: 0, host: '127.0.0.1' });
    expect(markerIn(database)).toEqual({ value: NOW.toISOString() });
    // Another process sees it (read-only, through the -wal).
    expect(readRunningMarker(join(dataDir, 'finance.db'))).toEqual({
      state: 'set',
      since: NOW.toISOString(),
    });
    await app.close();
    const after = new Database(join(dataDir, 'finance.db'), { readonly: true });
    try {
      expect(
        after.prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEYS.runningSince),
      ).toBeUndefined();
    } finally {
      after.close();
    }
  });

  it('is left by a crash (no close), and read without changing the database', () => {
    database.sqlite
      .prepare('INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run(META_KEYS.runningSince, NOW.toISOString(), NOW.toISOString());
    closeDatabase(database); // the WAL is checkpointed: finance.db alone holds the marker
    const before = liveHashes(dataDir);
    expect(readRunningMarker(join(dataDir, 'finance.db'))).toEqual({
      state: 'set',
      since: NOW.toISOString(),
    });
    expect(liveHashes(dataDir)).toEqual(before);
    database = openDatabase(dataDir);
  });

  it('reports a missing or unreadable database', () => {
    expect(readRunningMarker(join(tempDir, 'nothing', 'finance.db'))).toEqual({ state: 'missing' });
  });
});
