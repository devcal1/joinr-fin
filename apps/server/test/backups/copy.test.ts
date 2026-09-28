// The verified copy (stage-7.md §5.3, §5.11): a copy passes its check and has no sidecars; the
// copy is self-consistent (no running marker; its own run succeeded; other running rows failed as
// interrupted); a copy is refused and deleted when its check fails, when the migration count
// differs, when space is short; a failure never prunes; a failed delete in the prune is logged and
// skipped; the leftover cleanup.
process.env.TZ = 'Australia/Melbourne';

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { BACKUP_FAILURE_MESSAGES } from '@joinr/schema';
import { jobRuns } from '@joinr/schema/db';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_SPACE_MARGIN_BYTES,
  BackupError,
  cleanLeftovers,
  writeVerifiedBackup,
  writeVerifiedBackupWith,
} from '../../src/backups/copy';
import { BACKUPS_DIR_NAME, formatBackupName } from '../../src/backups/names';
import { META_KEYS, setMeta } from '../../src/db/meta';
import { makeLiveDb, recordingLogger, type LiveDb } from './helpers';

const AT = new Date(2030, 8, 15, 2, 30, 0);

let live: LiveDb;

beforeEach(async () => {
  live = await makeLiveDb({ seed: true });
});

afterEach(async () => {
  await live.cleanup();
});

const backupsDir = (): string => join(live.dataDir, BACKUPS_DIR_NAME);
const listing = (): string[] => (existsSync(backupsDir()) ? readdirSync(backupsDir()).sort() : []);

function expectBackupError(fn: () => unknown, reason: BackupError['reason']): BackupError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BackupError);
    const e = err as BackupError;
    expect(e.reason).toBe(reason);
    expect(e.message).toBe(BACKUP_FAILURE_MESSAGES[reason]);
    expect(e.statusCode).toBe(500);
    expect(e.code).toBe('BACKUP_FAILED');
    return e;
  }
  throw new Error('expected a BackupError');
}

/** Overwrites the middle of page 2 onwards with garbage (the temp copy's check must fail). */
function corrupt(path: string): void {
  const fd = openSync(path, 'r+');
  try {
    const junk = Buffer.alloc(4096 * 3, 0xa5);
    writeSync(fd, junk, 0, junk.length, 4096 + 100);
  } finally {
    closeSync(fd);
  }
}

describe('writeVerifiedBackup', () => {
  it('writes a verified, self-contained copy with no sidecars', () => {
    const w = writeVerifiedBackup(live.database, live.dataDir, 'manual', AT);
    expect(w.name).toBe('manual-20300915-023000+1000.db');
    expect(w.path).toBe(join(backupsDir(), w.name));
    expect(listing()).toEqual([w.name]);
    expect(w.sizeBytes).toBeGreaterThan(0);
    expect(w.pruned).toEqual([]);
    const copy = new Database(w.path, { readonly: true });
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
      const header = copy.prepare('SELECT count(*) AS n FROM instruments').get() as { n: number };
      expect(header.n).toBeGreaterThan(0);
    } finally {
      copy.close();
    }
    for (const suffix of ['-wal', '-shm', '-journal']) {
      expect(existsSync(`${w.path}${suffix}`)).toBe(false);
    }
  });

  it('makes the copy self-consistent (its own run succeeded, others interrupted, no marker)', () => {
    setMeta(live.database.db, META_KEYS.runningSince, '2030-09-14T16:00:00.000Z');
    const insert = (job: string) =>
      live.database.db
        .insert(jobRuns)
        .values({ job, trigger: 'schedule', startedAt: AT.toISOString(), status: 'running' })
        .returning({ id: jobRuns.id })
        .get().id;
    const own = insert('backup');
    const other = insert('prices');
    const w = writeVerifiedBackup(live.database, live.dataDir, 'nightly', AT, {
      jobRunId: own,
      slot: '2030-09-15T02:30:00+10:00',
    });
    const copy = new Database(w.path, { readonly: true });
    try {
      expect(
        copy.prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEYS.runningSince),
      ).toBeUndefined();
      const ownRow = copy.prepare('SELECT * FROM job_runs WHERE id = ?').get(own) as {
        status: string;
        finished_at: string;
        detail_json: string;
        error: string | null;
      };
      expect(ownRow.status).toBe('succeeded');
      expect(ownRow.finished_at).toBe(AT.toISOString());
      expect(ownRow.error).toBeNull();
      expect(JSON.parse(ownRow.detail_json)).toEqual({
        kind: 'nightly',
        name: w.name,
        slot: '2030-09-15T02:30:00+10:00',
        verified: true,
      });
      const otherRow = copy.prepare('SELECT status, error FROM job_runs WHERE id = ?').get(other);
      expect(otherRow).toEqual({ status: 'failed', error: 'interrupted' });
    } finally {
      copy.close();
    }
    // The live database is left as it was.
    const liveRow = live.database.db.select().from(jobRuns).where(eq(jobRuns.id, own)).get();
    expect(liveRow?.status).toBe('running');
  });

  it('refuses and deletes a copy that fails its integrity check, and never prunes', () => {
    const old = Array.from({ length: 11 }, (_, i) =>
      formatBackupName('manual', new Date(2030, 0, 1 + i)),
    );
    mkdirSync(backupsDir(), { recursive: true });
    for (const n of old) writeFileSync(join(backupsDir(), n), 'x');
    expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, { beforeVerify: corrupt }),
      'verify_failed',
    );
    expect(listing()).toEqual(old.sort());
  });

  it('refuses a copy whose migration count differs', () => {
    expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'nightly', AT, {
          beforeVerify: (path) => {
            const db = new Database(path);
            db.exec(
              'DELETE FROM __drizzle_migrations WHERE rowid = (SELECT max(rowid) FROM __drizzle_migrations)',
            );
            db.close();
          },
        }),
      'verify_failed',
    );
    expect(listing()).toEqual([]);
  });

  it('refuses a copy without app_meta.created_at', () => {
    expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'nightly', AT, {
          beforeVerify: (path) => {
            const db = new Database(path);
            db.prepare('DELETE FROM app_meta WHERE key = ?').run(META_KEYS.createdAt);
            db.close();
          },
        }),
      'verify_failed',
    );
    expect(listing()).toEqual([]);
  });

  it('refuses when space is short (twice the database plus the margin)', () => {
    expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, {
          statfs: () => BACKUP_SPACE_MARGIN_BYTES,
        }),
      'no_space',
    );
    expect(listing()).toEqual([]);
    // statfs unavailable → the check is skipped.
    expect(
      writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, { statfs: () => null }).name,
    ).toBe('manual-20300915-023000+1000.db');
  });

  it('maps a copy error to its category and never carries its message', () => {
    const secret = join(live.tempDir, 'private', 'path');
    const e = expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, {
          copy: () => {
            throw Object.assign(new Error(`EACCES: permission denied, open '${secret}'`), {
              code: 'EACCES',
            });
          },
        }),
      'io',
    );
    expect(e.message).not.toContain(secret);
    expect(e.causeCode).toBe('EACCES');
    const full = expectBackupError(
      () =>
        writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, {
          copy: () => {
            throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
          },
        }),
      'no_space',
    );
    expect(full.causeCode).toBe('SQLITE_FULL');
    expect(listing()).toEqual([]);
  });

  it('works through an async copy seam', async () => {
    const pending = writeVerifiedBackupWith(live.database, live.dataDir, 'manual', AT, {
      copy: async (sqlite, target) => {
        await new Promise((r) => setTimeout(r, 5));
        sqlite.prepare('VACUUM INTO ?').run(target);
      },
    });
    expect(pending).toBeInstanceOf(Promise);
    const w = await pending;
    expect(listing()).toEqual([w.name]);
  });

  it('prunes only its own kind after a verified copy', () => {
    mkdirSync(backupsDir(), { recursive: true });
    const manual = Array.from({ length: 10 }, (_, i) =>
      formatBackupName('manual', new Date(2030, 0, 1 + i)),
    );
    const other = [
      formatBackupName('pre-import', new Date(2029, 0, 1)),
      formatBackupName('nightly', new Date(2020, 0, 1, 2, 30)),
      'manual-copy.db',
    ];
    for (const n of [...manual, ...other]) writeFileSync(join(backupsDir(), n), 'x');
    const w = writeVerifiedBackup(live.database, live.dataDir, 'manual', AT);
    expect(w.pruned).toEqual([manual[0]]);
    expect(listing()).toEqual([...manual.slice(1), ...other, w.name].sort());
  });

  it('logs and skips a delete that fails (EBUSY) in the prune; the run still succeeds', () => {
    mkdirSync(backupsDir(), { recursive: true });
    const manual = Array.from({ length: 11 }, (_, i) =>
      formatBackupName('manual', new Date(2030, 0, 1 + i)),
    );
    for (const n of manual) writeFileSync(join(backupsDir(), n), 'x');
    const log = recordingLogger();
    const w = writeVerifiedBackup(live.database, live.dataDir, 'manual', AT, {
      log,
      unlink: (path) => {
        if (path.endsWith(manual[0]!)) {
          throw Object.assign(new Error(`EBUSY: resource busy '${path}'`), { code: 'EBUSY' });
        }
      },
    });
    expect(w.pruned).toEqual([manual[1]]);
    const warn = log.calls.find((c) => c.level === 'warn');
    expect(warn?.obj).toEqual({ code: 'EBUSY', file: manual[0] });
    expect(JSON.stringify(log.calls)).not.toContain(live.tempDir.replace(/\\/g, '\\\\'));
  });

  it('never overwrites a copy of the same second', () => {
    const a = writeVerifiedBackup(live.database, live.dataDir, 'manual', AT);
    const b = writeVerifiedBackup(live.database, live.dataDir, 'manual', AT);
    expect(a.name).toBe('manual-20300915-023000+1000.db');
    expect(b.name).toBe('manual-20300915-023000+1000-2.db');
  });
});

describe('cleanLeftovers', () => {
  it('deletes every partial and restoring file, and leaves everything else', () => {
    mkdirSync(backupsDir(), { recursive: true });
    const partials = [
      '.manual-20300915-023000+1000.db.partial',
      '.manual-20300915-023000+1000.db.partial-wal',
      '.manual-20300915-023000+1000.db.partial-shm',
      '.manual-20300915-023000+1000.db.partial-journal',
    ];
    for (const n of partials) writeFileSync(join(backupsDir(), n), 'x');
    const kept = ['manual-20300915-023000+1000.db', 'notes.txt', '.hidden-note'];
    for (const n of kept) writeFileSync(join(backupsDir(), n), 'x');
    const folder = join(backupsDir(), '.unverified-pre-restore-20300915T000000Z');
    mkdirSync(folder);
    writeFileSync(join(folder, 'finance.db'), 'x');
    const restoring = ['.finance.db.restoring', '.finance.db.restoring-journal'];
    for (const n of restoring) writeFileSync(join(live.dataDir, n), 'x');
    writeFileSync(join(live.dataDir, 'import-corrections.json'), '{}');

    const removed = cleanLeftovers(live.dataDir);
    expect(removed.sort()).toEqual([...partials, ...restoring].sort());
    expect(listing()).toEqual([...kept, '.unverified-pre-restore-20300915T000000Z'].sort());
    expect(existsSync(join(folder, 'finance.db'))).toBe(true);
    expect(existsSync(join(live.dataDir, 'import-corrections.json'))).toBe(true);
    expect(existsSync(join(live.dataDir, 'finance.db'))).toBe(true);
  });

  it('is a no-op without a backups folder', () => {
    expect(cleanLeftovers(join(live.tempDir, 'missing'))).toEqual([]);
  });
});
