// app_meta helpers: small key/value facts about this installation.
import { eq } from 'drizzle-orm';
import type { Db } from './database';
import { appMeta } from './schema';

export const META_KEYS = {
  /** When this database was first started (set once). */
  createdAt: 'created_at',
  /** When the server last started (updated on every start). */
  lastStartedAt: 'last_started_at',
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
