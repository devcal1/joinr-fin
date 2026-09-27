// The D98 one-off (stage-6.md §3.4, FROZEN signature): an import-origin `fire.preservationAge` of
// FIRE_REPLACED_ACCESS_AGE becomes FIRE_DEFAULT_ACCESS_AGE once per database (an app row of a
// preference key, plus the FIRE_ACCESS_AGE_META_KEY marker in app_meta), so `data/` stays
// re-importable: a preference row never counts as app data and a re-import keeps it (D95, D103),
// and the marker (app_meta, never app data) stops a second replacement. Called by buildApp once at
// start and after every committed import (the upload route and the CLI; never a dry run).
// Synchronous, one IMMEDIATE transaction. Also here: reading the marker back (the FIRE page's
// `accessAge.replaced` and the Settings notice) and the one info log line.
import {
  FIRE_ACCESS_AGE_META_KEY,
  FIRE_DEFAULT_ACCESS_AGE,
  FIRE_REPLACED_ACCESS_AGE,
  type FireAccessAgeReplacedDto,
} from '@joinr/schema';
import { appMeta, settings } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { AppDatabase, Db } from '../db/database';
import type { Tx } from '../db/queries/domain';

export interface SettingUpgrade {
  key: 'fire.preservationAge';
  from: number;
  to: number;
  /** UTC ISO timestamp of `now`. */
  at: string;
}

const ACCESS_AGE_KEY = 'fire.preservationAge';

/** A stored value_json that is exactly the given integer (anything unparsable is not). */
function storedIntegerIs(valueJson: string, expected: number): boolean {
  try {
    return JSON.parse(valueJson) === expected;
  } catch {
    return false;
  }
}

/**
 * The marker, or null when absent or malformed (a malformed marker still stops a second
 * replacement: `applySettingUpgrades` checks only that the row exists).
 */
export function readAccessAgeMarker(db: Db | Tx): FireAccessAgeReplacedDto | null {
  const row = db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, FIRE_ACCESS_AGE_META_KEY))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<
      Record<keyof FireAccessAgeReplacedDto, unknown>
    >;
    const { from, to, at } = parsed;
    if (
      typeof from !== 'number' ||
      !Number.isSafeInteger(from) ||
      typeof to !== 'number' ||
      !Number.isSafeInteger(to) ||
      typeof at !== 'string' ||
      Number.isNaN(Date.parse(at))
    ) {
      return null;
    }
    return { from, to, at };
  } catch {
    return null;
  }
}

/**
 * The D98 note's data while it applies: the marker exists and the stored access age is still its
 * `to` (any origin); null once the owner changes the age (or the row is gone).
 */
export function accessAgeReplaced(
  marker: FireAccessAgeReplacedDto | null,
  storedAccessAge: number | null,
): FireAccessAgeReplacedDto | null {
  return marker !== null && storedAccessAge === marker.to ? marker : null;
}

export function applySettingUpgrades(database: AppDatabase, now: Date): SettingUpgrade[] {
  return database.db.transaction(
    (tx): SettingUpgrade[] => {
      // 1. Once per database.
      const marker = tx
        .select({ key: appMeta.key })
        .from(appMeta)
        .where(eq(appMeta.key, FIRE_ACCESS_AGE_META_KEY))
        .get();
      if (marker) return [];
      // 2. Only the imported 65; anything else (no row, another value, an app row) → nothing and no
      //    marker, so a later import of 65 is still replaced (3).
      const row = tx.select().from(settings).where(eq(settings.key, ACCESS_AGE_KEY)).get();
      if (
        !row ||
        row.origin !== 'import' ||
        !storedIntegerIs(row.valueJson, FIRE_REPLACED_ACCESS_AGE)
      ) {
        return [];
      }
      const at = now.toISOString();
      tx.update(settings)
        .set({ valueJson: JSON.stringify(FIRE_DEFAULT_ACCESS_AGE), origin: 'app', updatedAt: at })
        .where(eq(settings.key, ACCESS_AGE_KEY))
        .run();
      const upgrade: SettingUpgrade = {
        key: ACCESS_AGE_KEY,
        from: FIRE_REPLACED_ACCESS_AGE,
        to: FIRE_DEFAULT_ACCESS_AGE,
        at,
      };
      const value = JSON.stringify({
        from: upgrade.from,
        to: upgrade.to,
        at,
      } satisfies FireAccessAgeReplacedDto);
      tx.insert(appMeta).values({ key: FIRE_ACCESS_AGE_META_KEY, value, updatedAt: at }).run();
      return [upgrade];
    },
    { behavior: 'immediate' },
  );
}

/** The logger surface the upgrade line needs (Fastify's logger fits). */
export interface UpgradeLog {
  info(obj: Record<string, unknown>, msg: string): void;
}

/** One info line per upgrade: the key and the ages only (never another figure). */
export function logSettingUpgrades(log: UpgradeLog, upgrades: readonly SettingUpgrade[]): void {
  for (const u of upgrades) {
    log.info({ key: u.key, from: u.from, to: u.to }, 'setting upgraded once (D98)');
  }
}
