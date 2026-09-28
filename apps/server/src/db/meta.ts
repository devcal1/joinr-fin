// app_meta helpers: small key/value facts about this installation.
import { eq } from 'drizzle-orm';
import type { Db } from './database';
import { appMeta } from './schema';

export const META_KEYS = {
  /** When this database was first started (set once). */
  createdAt: 'created_at',
  /** When the server last started (updated on every start). */
  lastStartedAt: 'last_started_at',
  /**
   * Stage 7 (stage-7.md §5.8): set while the server listens (ISO), deleted on a clean close. The
   * restore and import CLIs refuse while it is set; a crash leaves it (their `--force`).
   */
  runningSince: 'server.running_since',
  /** Stage 7 (stage-7.md §5.5 step 10): `{"name", "at"}` of the last restore into this database. */
  restoreLast: 'restore.last',
} as const;

export function getMeta(db: Db, key: string): string | undefined {
  return db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, key)).get()?.value;
}

export function setMeta(db: Db, key: string, value: string, now: Date = new Date()): void {
  const updatedAt = now.toISOString();
  db.insert(appMeta)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt } })
    .run();
}

export function deleteMeta(db: Db, key: string): void {
  db.delete(appMeta).where(eq(appMeta.key, key)).run();
}

/** Records `created_at` if absent and upserts `last_started_at`, in one transaction. */
export function recordStartup(db: Db, now: Date = new Date()): void {
  const iso = now.toISOString();
  db.transaction((tx) => {
    tx.insert(appMeta)
      .values({ key: META_KEYS.createdAt, value: iso, updatedAt: iso })
      .onConflictDoNothing()
      .run();
    tx.insert(appMeta)
      .values({ key: META_KEYS.lastStartedAt, value: iso, updatedAt: iso })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: iso, updatedAt: iso } })
      .run();
  });
}

/** `restore.last` as the About block shows it; null when absent or malformed. */
export function readRestoreLast(db: Db): { name: string; at: string } | null {
  const raw = getMeta(db, META_KEYS.restoreLast);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { name, at } = parsed as { name?: unknown; at?: unknown };
    return typeof name === 'string' && typeof at === 'string' ? { name, at } : null;
  } catch {
    return null;
  }
}
