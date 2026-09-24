// Pre-import backups (stage-1.md §3.4 step 5): a consistent copy of the live database via
// `VACUUM INTO`, kept in <DATA_DIR>/backups, newest 10 only.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDatabase } from './database';

export const BACKUPS_DIR_NAME = 'backups';
export const PRE_IMPORT_PREFIX = 'pre-import-';
export const PRE_IMPORT_KEEP = 10;

const BACKUP_NAME_RE = /^pre-import-\d{8}-\d{6}(?:-\d+)?\.db$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `pre-import-YYYYMMDD-HHmmss.db` in local time. */
export function preImportBackupName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${PRE_IMPORT_PREFIX}${date}-${time}.db`;
}

/**
 * Writes `<dataDir>/backups/pre-import-YYYYMMDD-HHmmss.db` (a suffix `-2`, `-3`, … when that
 * second already has one), deletes all but the newest 10 pre-import backups and returns the path.
 */
export function backupBeforeImport(
  database: AppDatabase,
  dataDir: string,
  now: Date = new Date(),
): string {
  const dir = join(dataDir, BACKUPS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const existing = new Set(readdirSync(dir));
  const base = preImportBackupName(now);
  let name = base;
  for (let i = 2; existing.has(name); i++) name = base.replace(/\.db$/, `-${i}.db`);
  const target = join(dir, name);
  database.sqlite.prepare('VACUUM INTO ?').run(target);
  prunePreImportBackups(dir, PRE_IMPORT_KEEP);
  return target;
}

/** Deletes the oldest pre-import backups beyond `keep` (by name, which sorts by time). */
export function prunePreImportBackups(dir: string, keep: number): string[] {
  const backups = readdirSync(dir)
    .filter((f) => BACKUP_NAME_RE.test(f))
    .sort(compareBackupNames);
  const removed = backups.slice(0, Math.max(0, backups.length - keep));
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return removed;
}

/** Orders by timestamp, then by the `-n` suffix numerically. */
function compareBackupNames(a: string, b: string): number {
  const key = (f: string): [string, number] => {
    const m = /^pre-import-(\d{8}-\d{6})(?:-(\d+))?\.db$/.exec(f);
    return [m?.[1] ?? '', Number(m?.[2] ?? 1)];
  };
  const [ta, na] = key(a);
  const [tb, nb] = key(b);
  return ta < tb ? -1 : ta > tb ? 1 : na - nb;
}
