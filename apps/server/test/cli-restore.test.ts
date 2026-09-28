// The restore CLI (stage-7.md §5.5, §5.11), in-process via main(argv, io) on temp DATA_DIRs:
// every exit code; a round trip (the setting is back, the pre-restore copy holds the change, the
// markers); a bare name, a `joinr-finance-` name and a path; --json; the running marker (exit 6,
// then --force); the lock check against an idle WAL connection; newer, other-lineage, truncated
// and WAL-with-sidecar candidates (exit 5); a damaged live database with and without --force; a
// pre-migrate copy one level behind; a restored manual backup whose last run is not "failed"; and
// the live database untouched (sha256 of finance.db and finance.db-wal) on every refusal.
process.env.TZ = 'Australia/Melbourne';

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BackupNowResponse, BackupsResponse } from '@joinr/schema';
import { COMMITTED_MIGRATION_COUNT, seedGenericData } from '@joinr/schema/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { writeVerifiedBackup } from '../src/backups/copy';
import { RESTORE_EXIT, restoreBackup } from '../src/backups/restore';
import { main, parseArgs, USAGE, type RestoreCliIo } from '../src/cli/restore';
import { closeDatabase, openDatabase, runMigrations, type AppDatabase } from '../src/db/database';
import { META_KEYS, recordStartup, setMeta } from '../src/db/meta';
import { makeTempDir, MIGRATIONS_DIR, removeDir, testConfig } from './helpers';
import { liveHashes } from './backups/helpers';

const NOW = new Date(2030, 8, 15, 11, 0, 0);
const TAKEN = new Date(2030, 8, 15, 10, 0, 0);

let tempDir: string;
let dataDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir('joinr-restore-test-');
  dataDir = join(tempDir, 'data');
});

afterEach(async () => {
  await removeDir(tempDir);
});

function withDb<T>(fn: (db: AppDatabase) => T, dir = dataDir): T {
  const database = openDatabase(dir);
  try {
    return fn(database);
  } finally {
    closeDatabase(database);
  }
}

/** A seeded live database with `example = before`, and a verified manual backup of it. */
function seedWithBackup(): string {
  return withDb((db) => {
    runMigrations(db, MIGRATIONS_DIR);
    recordStartup(db.db, new Date('2030-01-01T00:00:00.000Z'));
    seedGenericData(db.db, { now: new Date('2030-09-01T00:00:00.000Z') });
    setMeta(db.db, 'example', 'before');
    return writeVerifiedBackup(db, dataDir, 'manual', TAKEN).name;
  });
}

function setExample(value: string): void {
  withDb((db) => setMeta(db.db, 'example', value));
}

function readMeta(key: string, file = join(dataDir, 'finance.db')): string | undefined {
  const db = new Database(file, { readonly: true });
  try {
    return (
      db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;
  } finally {
    db.close();
  }
}

async function run(argv: string[], env: Record<string, string> = {}, cwd = tempDir) {
  let out = '';
  let err = '';
  const io: RestoreCliIo = {
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    env: { NODE_ENV: 'test', DATA_DIR: dataDir, IMPORT_CORRECTIONS_FILE: 'none', ...env },
    cwd,
    now: () => NOW,
  };
  const code = await main(argv, io);
  return { code, out, err };
}

const backupsList = (): string[] =>
  existsSync(join(dataDir, 'backups')) ? readdirSync(join(dataDir, 'backups')).sort() : [];

const noStaging = (): void => {
  expect(readdirSync(dataDir).filter((f) => f.startsWith('.finance.db.restoring'))).toEqual([]);
};

describe('arguments', () => {
  it('parses flags and one backup', () => {
    expect(parseArgs(['x.db', '--yes', '--force', '--json'])).toEqual({
      backup: 'x.db',
      yes: true,
      force: true,
      json: true,
      help: false,
    });
    expect(parseArgs(['a', 'b'])).toBe('Give one backup');
    expect(parseArgs(['--nope'])).toBe('Unknown option --nope');
  });

  it('prints help in the checkout form (exit 0)', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Usage: pnpm restore:backup <backup> [--yes] [--force] [--json]');
    expect(USAGE).toBe('Usage: pnpm restore:backup <backup> [--yes] [--force] [--json]');
  });

  it('exits 2 for usage and configuration errors', async () => {
    expect((await run([])).code).toBe(RESTORE_EXIT.usage);
    expect((await run(['--bogus'])).code).toBe(RESTORE_EXIT.usage);
    expect((await run(['a.db', 'b.db'])).code).toBe(RESTORE_EXIT.usage);
    const bad = await run(['x.db'], { PORT: 'eighty' });
    expect(bad.code).toBe(RESTORE_EXIT.usage);
    expect(bad.err).toContain('PORT');
  });

  it('exits 2 for a missing backup, the live database itself and a folder', async () => {
    seedWithBackup();
    const before = liveHashes(dataDir);
    const missing = await run(['nightly-20300915-023000+1000.db', '--yes']);
    expect(missing.code).toBe(RESTORE_EXIT.usage);
    expect(missing.err).toContain('No backup named nightly-20300915-023000+1000.db was found');
    expect((await run([join(dataDir, 'finance.db'), '--yes'])).code).toBe(RESTORE_EXIT.usage);
    mkdirSync(join(tempDir, 'folder.db'));
    expect((await run([join(tempDir, 'folder.db'), '--yes'])).code).toBe(RESTORE_EXIT.usage);
    expect(liveHashes(dataDir)).toEqual(before);
  });
});

describe('a round trip', () => {
  it('without --yes: prints the summary, exits 3 and changes nothing', async () => {
    const name = seedWithBackup();
    setExample('after');
    const before = liveHashes(dataDir);
    const r = await run([name]);
    expect(r.code).toBe(RESTORE_EXIT.confirm);
    expect(r.out).toContain(`Backup:   ${name} (15/09/2030 10:00,`);
    expect(r.out).toContain(`database level ${COMMITTED_MIGRATION_COUNT})`);
    expect(r.out).toMatch(
      /Current: {2}database level 6; (last import \d{2}\/\d{2}\/\d{4}|no import); /,
    );
    expect(r.out).toContain('Running marker: not set');
    expect(r.out).toContain('Re-run with --yes to restore.');
    expect(liveHashes(dataDir)).toEqual(before);
    expect(existsSync(join(dataDir, 'finance.db-wal'))).toBe(before.wal !== null);
    expect(readMeta('example')).toBe('after');
    noStaging();
  });

  it('restores: the setting is back, the pre-restore copy holds the change, the markers are set', async () => {
    const name = seedWithBackup();
    setExample('after');
    setMetaRaw(META_KEYS.runningSince, null);
    const r = await run([name, '--yes']);
    expect(r.err).toBe('');
    expect(r.code).toBe(RESTORE_EXIT.restored);
    expect(readMeta('example')).toBe('before');
    const pre = backupsList().find((f) => f.startsWith('pre-restore-'));
    expect(pre).toBe('pre-restore-20300915-110000+1000.db');
    expect(r.out).toContain(
      `Restored ${name}. The pre-restore copy is backups/${pre}. Start the app.`,
    );
    expect(readMeta('example', join(dataDir, 'backups', pre!))).toBe('after');
    expect(JSON.parse(readMeta(META_KEYS.restoreLast) ?? 'null')).toEqual({
      name,
      at: '2030-09-15T11:00:00+10:00',
    });
    expect(readMeta(META_KEYS.runningSince)).toBeUndefined();
    expect(existsSync(join(dataDir, 'finance.db-wal'))).toBe(false);
    expect(existsSync(join(dataDir, 'finance.db-shm'))).toBe(false);
    noStaging();
    // Undo with the pre-restore copy.
    const back = await run([pre!, '--yes']);
    expect(back.code).toBe(RESTORE_EXIT.restored);
    expect(readMeta('example')).toBe('after');
  });

  it('accepts a joinr-finance- download name and a path, anywhere', async () => {
    const name = seedWithBackup();
    setExample('after');
    expect((await run([`joinr-finance-${name}`, '--yes'])).code).toBe(RESTORE_EXIT.restored);
    expect(readMeta('example')).toBe('before');
    setExample('again');
    const elsewhere = join(tempDir, 'downloads');
    mkdirSync(elsewhere);
    copyFileSync(join(dataDir, 'backups', name), join(elsewhere, 'my copy.db'));
    const byPath = await run([join('downloads', 'my copy.db'), '--yes']);
    expect(byPath.code).toBe(RESTORE_EXIT.restored);
    expect(readMeta('example')).toBe('before');
    expect((JSON.parse(readMeta(META_KEYS.restoreLast)!) as { name: string }).name).toBe(
      'my copy.db',
    );
    // The original file is untouched (validated on a copy, no sidecars beside it).
    expect(readdirSync(elsewhere)).toEqual(['my copy.db']);
    // A downloaded file in the working folder, not in backups/.
    const dl = join(tempDir, `joinr-finance-${name}`);
    copyFileSync(join(dataDir, 'backups', name), dl);
    expect((await run([`joinr-finance-${name}`, '--yes'])).code).toBe(RESTORE_EXIT.restored);
  });

  it('prints one JSON object with --json', async () => {
    const name = seedWithBackup();
    const r = await run([name, '--json']);
    expect(r.code).toBe(RESTORE_EXIT.confirm);
    const body = JSON.parse(r.out) as {
      exitCode: number;
      summary: {
        backup: { name: string; level: number };
        live: { state: string };
        appLevel: number;
        marker: string;
      };
      messages: string[];
    };
    expect(body.exitCode).toBe(3);
    expect(body.summary.backup).toMatchObject({ name, level: COMMITTED_MIGRATION_COUNT });
    expect(body.summary.live.state).toBe('readable');
    expect(body.summary.appLevel).toBe(COMMITTED_MIGRATION_COUNT);
    expect(body.summary.marker).toBe('none');
    const done = JSON.parse((await run([name, '--json', '--yes'])).out) as {
      exitCode: number;
      preRestoreBackup: string;
    };
    expect(done.exitCode).toBe(0);
    expect(done.preRestoreBackup).toMatch(/^pre-restore-/);
  });

  it('restores into a fresh folder (no live database, no pre-restore copy)', async () => {
    const name = seedWithBackup();
    const source = join(tempDir, 'saved.db');
    copyFileSync(join(dataDir, 'backups', name), source);
    dataDir = join(tempDir, 'fresh');
    const r = await run([source, '--yes']);
    expect(r.code).toBe(RESTORE_EXIT.restored);
    expect(readMeta('example')).toBe('before');
    expect(backupsList().filter((f) => f.startsWith('pre-restore-'))).toEqual([]);
  });

  it('after a restored manual backup the app does not show the last run as failed', async () => {
    withDb((db) => {
      runMigrations(db, MIGRATIONS_DIR);
      recordStartup(db.db);
      seedGenericData(db.db);
    });
    const database = openDatabase(dataDir);
    let name: string;
    {
      const app = await buildApp({ config: testConfig(dataDir), db: database });
      const res = await app.inject({ method: 'POST', url: '/api/backups' });
      name = res.json<BackupNowResponse>().backup.name;
      await app.close();
    }
    expect((await run([name, '--yes'])).code).toBe(RESTORE_EXIT.restored);
    const again = openDatabase(dataDir);
    const app = await buildApp({ config: testConfig(dataDir), db: again });
    try {
      const body = (
        await app.inject({ method: 'GET', url: '/api/backups' })
      ).json<BackupsResponse>();
      expect(body.lastRun?.status).toBe('succeeded');
      expect(body.lastRun?.detail).toMatchObject({ name, kind: 'manual', verified: true });
      expect(body.app.restoredFrom).toEqual({ name, at: '2030-09-15T11:00:00+10:00' });
    } finally {
      await app.close();
    }
  });
});

/** Sets (or, with null, deletes) an app_meta key in the live database. */
function setMetaRaw(key: string, value: string | null): void {
  withDb((db) => {
    if (value === null) db.sqlite.prepare('DELETE FROM app_meta WHERE key = ?').run(key);
    else setMeta(db.db, key, value);
  });
}

describe('the app must be stopped', () => {
  it('exits 6 on the running marker; --force skips that check only', async () => {
    const name = seedWithBackup();
    setMetaRaw(META_KEYS.runningSince, '2030-09-15T00:00:00.000Z');
    const before = liveHashes(dataDir);
    const r = await run([name, '--yes']);
    expect(r.code).toBe(RESTORE_EXIT.running);
    expect(r.err).toContain(
      'The app appears to be running (or did not shut down cleanly). Stop the app; if it is stopped, re-run with --force.',
    );
    expect(liveHashes(dataDir)).toEqual(before);
    const forced = await run([name, '--yes', '--force']);
    expect(forced.code).toBe(RESTORE_EXIT.restored);
    expect(forced.out).toContain('Running marker: set, ignored (--force)');
    expect(readMeta(META_KEYS.runningSince)).toBeUndefined();
  });

  it('exits 6 when another connection holds the database open (idle, WAL), even with --force', async () => {
    const name = seedWithBackup();
    const holder = openDatabase(dataDir); // the server's pattern: WAL, open and idle
    try {
      holder.sqlite.prepare('SELECT count(*) FROM app_meta').get();
      const before = liveHashes(dataDir);
      const r = await run([name, '--yes', '--force']);
      expect(r.code).toBe(RESTORE_EXIT.running);
      expect(r.err).toContain('Another process has the database open');
      expect(liveHashes(dataDir)).toEqual(before);
      expect(backupsList().filter((f) => f.startsWith('pre-restore-'))).toEqual([]);
      noStaging();
    } finally {
      closeDatabase(holder);
    }
    expect((await run([name, '--yes'])).code).toBe(RESTORE_EXIT.restored);
  });
});

describe('invalid backups (exit 5), the live database untouched', () => {
  function candidate(name: string, mutate: (db: Database.Database) => void): string {
    const source = join(dataDir, 'backups', seedWithBackup());
    const path = join(tempDir, name);
    copyFileSync(source, path);
    const db = new Database(path);
    try {
      mutate(db);
    } finally {
      db.close();
    }
    return path;
  }

  async function expectInvalid(path: string, message: string): Promise<void> {
    const before = liveHashes(dataDir);
    const r = await run([path, '--yes', '--force']);
    expect(r.code).toBe(RESTORE_EXIT.invalid);
    expect(r.err).toContain(message);
    expect(liveHashes(dataDir)).toEqual(before);
    noStaging();
  }

  it('refuses a backup from a newer version (one more migration)', async () => {
    const path = candidate('newer.db', (db) =>
      db
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('f'.repeat(64), 4_000_000_000_000),
    );
    await expectInvalid(
      path,
      `This backup was made by a newer version of the app (database level ${COMMITTED_MIGRATION_COUNT + 1}; this app knows ${COMMITTED_MIGRATION_COUNT}). Install that version or newer, then restore.`,
    );
  });

  it('refuses a different lineage', async () => {
    const path = candidate('other.db', (db) =>
      db.prepare('UPDATE __drizzle_migrations SET created_at = 1 WHERE rowid = 1').run(),
    );
    await expectInvalid(path, 'This backup belongs to a different database');
  });

  it('refuses a file that is not a Joinr database', async () => {
    seedWithBackup();
    const path = join(tempDir, 'plain.db');
    const db = new Database(path);
    db.exec('CREATE TABLE t (x)');
    db.close();
    await expectInvalid(path, 'This file is not a Joinr Finance database');
    writeFileSync(join(tempDir, 'text.db'), 'hello, this is not SQLite at all');
    await expectInvalid(join(tempDir, 'text.db'), 'This file is not a SQLite database');
  });

  it('refuses a truncated backup', async () => {
    const name = seedWithBackup();
    const path = join(tempDir, 'truncated.db');
    copyFileSync(join(dataDir, 'backups', name), path);
    truncateSync(path, 3 * 4096);
    const before = liveHashes(dataDir);
    const r = await run([path, '--yes']);
    expect(r.code).toBe(RESTORE_EXIT.invalid);
    expect(liveHashes(dataDir)).toEqual(before);
  });

  it('refuses a WAL-mode path candidate with its -wal beside it', async () => {
    seedWithBackup();
    const walDir = join(tempDir, 'walcopy');
    mkdirSync(walDir);
    const holder = openDatabase(walDir); // WAL mode, writes left in the -wal
    try {
      runMigrations(holder, MIGRATIONS_DIR);
      recordStartup(holder.db);
      expect(existsSync(join(walDir, 'finance.db-wal'))).toBe(true);
      await expectInvalid(
        join(walDir, 'finance.db'),
        'This file is a live database with unsaved changes beside it: checkpoint it first, or restore a backup file',
      );
    } finally {
      closeDatabase(holder);
    }
  });
});

describe('a damaged live database', () => {
  it('exits 1 without --force (nothing changed); with --force sets it aside unverified and restores', async () => {
    const name = seedWithBackup();
    // Damage the live file: keep its header, garble the rest.
    const live = join(dataDir, 'finance.db');
    const bytes = readFileSync(live);
    bytes.fill(0x5a, 200);
    writeFileSync(live, bytes);
    const before = liveHashes(dataDir);
    const refused = await run([name, '--yes']);
    expect(refused.code).toBe(RESTORE_EXIT.failed);
    expect(refused.err).toContain(
      'The current database could not be backed up (it may be damaged). Re-run with --force to set it aside unverified and restore.',
    );
    expect(liveHashes(dataDir)).toEqual(before);

    const forced = await run([name, '--yes', '--force']);
    expect(forced.code).toBe(RESTORE_EXIT.restored);
    expect(forced.out).toContain('Current:  cannot be read');
    const folder = backupsList().find((f) => f.startsWith('.unverified-pre-restore-'));
    expect(folder).toBe('.unverified-pre-restore-20300915T010000Z');
    expect(readFileSync(join(dataDir, 'backups', folder!, 'finance.db')).equals(bytes)).toBe(true);
    expect(forced.out).toContain(`backups/${folder}/`);
    expect(readMeta('example')).toBe('before');
  });

  it('exits 1 with --force on a truncated live file too, and restores with it', async () => {
    const name = seedWithBackup();
    truncateSync(join(dataDir, 'finance.db'), 2 * 4096);
    expect((await run([name, '--yes'])).code).toBe(RESTORE_EXIT.failed);
    const forced = await run([name, '--yes', '--force']);
    expect(forced.code).toBe(RESTORE_EXIT.restored);
    expect(backupsList().some((f) => f.startsWith('.unverified-pre-restore-'))).toBe(true);
  });
});

describe('the pre-restore set and the candidate (Fixer SPEC-7)', () => {
  it('restoring the oldest of five pre-restore copies keeps that file', async () => {
    seedWithBackup();
    const names = withDb((db) =>
      [1, 2, 3, 4, 5].map(
        (i) => writeVerifiedBackup(db, dataDir, 'pre-restore', new Date(2030, 8, 15, 10, i)).name,
      ),
    );
    const oldest = names[0]!;
    const r = await run([oldest, '--yes']);
    expect(r.code).toBe(RESTORE_EXIT.restored);
    const pre = backupsList().filter((f) => f.startsWith('pre-restore-'));
    // The candidate stays (so restore.last names a file that exists); the new copy is added.
    expect(pre).toContain(oldest);
    expect(pre).toHaveLength(6);
    expect(JSON.parse(readMeta(META_KEYS.restoreLast) ?? '{}')).toMatchObject({ name: oldest });
    // The next pre-restore prune brings the set back to five.
    const again = await run([names[4]!, '--yes']);
    expect(again.code).toBe(RESTORE_EXIT.restored);
    const after = backupsList().filter((f) => f.startsWith('pre-restore-'));
    expect(after).toHaveLength(5);
    expect(after).not.toContain(oldest);
    expect(after).toContain(names[4]);
  });
});

describe('a failed checkpoint after the pre-restore copy (Fixer F7)', () => {
  it('exits 1, names the pre-restore copy, never sets the database aside, changes nothing', () => {
    const name = seedWithBackup();
    setExample('after');
    const before = liveHashes(dataDir);
    const out = restoreBackup(testConfig(dataDir), {
      backup: name,
      yes: true,
      force: true,
      cwd: tempDir,
      now: NOW,
      checkpoint: () => {
        throw Object.assign(new Error('database is locked /secret/path'), { code: 'SQLITE_BUSY' });
      },
    });
    expect(out.exitCode).toBe(RESTORE_EXIT.failed);
    const text = out.messages.join(' ');
    expect(text).toContain('could not be checkpointed');
    expect(text).toContain('Nothing was changed');
    expect(text).toMatch(/The pre-restore copy is backups\/pre-restore-\d{8}-\d{6}[+-]\d{4}\.db\./);
    expect(text).not.toContain('/secret/path');
    expect(out.unverifiedFolder).toBeNull();
    expect(backupsList().some((f) => f.startsWith('.unverified-pre-restore-'))).toBe(false);
    expect(liveHashes(dataDir)).toEqual(before);
    expect(readMeta('example')).toBe('after');
    noStaging();
  });
});

describe('the rollback case', () => {
  it('restores a pre-migrate copy one level behind, and says the app will update it', async () => {
    seedWithBackup();
    // A database one level behind, as the older version left it.
    const oldDir = join(tempDir, 'old');
    const migrations = join(tempDir, 'migrations-old');
    cpSync(MIGRATIONS_DIR, migrations, { recursive: true });
    const journalPath = join(migrations, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, COMMITTED_MIGRATION_COUNT - 1);
    writeFileSync(journalPath, JSON.stringify(journal));
    const name = withDb((db) => {
      runMigrations(db, migrations);
      recordStartup(db.db);
      return writeVerifiedBackup(db, dataDir, 'pre-migrate', TAKEN).name;
    }, oldDir);
    const r = await run([name, '--yes']);
    expect(r.code).toBe(RESTORE_EXIT.restored);
    expect(r.out).toContain(
      `The app will update the database from level ${COMMITTED_MIGRATION_COUNT - 1} to ${COMMITTED_MIGRATION_COUNT} when it starts (a pre-update backup is taken first).`,
    );
  });
});
