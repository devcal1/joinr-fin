// The D98 one-off (stage-6.md §3.4, §7.4 step 3): `applySettingUpgrades` replaces an imported
// access age of 65 with 60 once per database (an app row of a preference key plus the app_meta
// marker), never touches anything else, and leaves `hasAppData` false; the marker reads back for the
// FIRE page and the Settings notice; one log line with the key and ages only; `buildApp` runs it at
// start. The import paths (upload route, CLI) are in import-upgrade.test.ts. Generic values only.
import { join } from 'node:path';
import {
  FIRE_ACCESS_AGE_META_KEY,
  FIRE_DEFAULT_ACCESS_AGE,
  FIRE_REPLACED_ACCESS_AGE,
} from '@joinr/schema';
import { appMeta, settings } from '@joinr/schema/db';
import {
  createTestDb,
  seedFireReplacedAge,
  seedGenericData,
  type TestDb,
} from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations } from '../../src/db/database';
import { hasAppData } from '../../src/db/queries/domain';
import {
  accessAgeReplaced,
  applySettingUpgrades,
  logSettingUpgrades,
  readAccessAgeMarker,
} from '../../src/fire/upgrade';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { fakeEngine, NOW } from '../investments/helpers';

const LATER = new Date('2026-10-01T02:03:04.000Z');
const KEY = 'fire.preservationAge';

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.close());

const row = () => t.db.select().from(settings).where(eq(settings.key, KEY)).get();
const marker = () =>
  t.db.select().from(appMeta).where(eq(appMeta.key, FIRE_ACCESS_AGE_META_KEY)).get();

function putAge(valueJson: string, origin: 'import' | 'app'): void {
  t.db
    .insert(settings)
    .values({ key: KEY, valueJson, updatedAt: NOW.toISOString(), origin })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson, origin } })
    .run();
}

describe('applySettingUpgrades (§3.4)', () => {
  it('the constants are the D98 pair', () => {
    expect([FIRE_REPLACED_ACCESS_AGE, FIRE_DEFAULT_ACCESS_AGE]).toEqual([65, 60]);
  });

  it('replaces an imported 65 with an app-origin 60 and writes the marker', () => {
    seedGenericData(t.db, { now: NOW });
    seedFireReplacedAge(t.db);
    expect(hasAppData(t.db)).toBe(false);
    const upgrades = applySettingUpgrades(t, LATER);
    expect(upgrades).toEqual([{ key: KEY, from: 65, to: 60, at: LATER.toISOString() }]);
    expect(row()).toMatchObject({ valueJson: '60', origin: 'app', updatedAt: LATER.toISOString() });
    expect(JSON.parse(marker()!.value)).toEqual({ from: 65, to: 60, at: LATER.toISOString() });
    expect(marker()!.updatedAt).toBe(LATER.toISOString());
    // A preference row (D103) and an app_meta marker: never app data.
    expect(hasAppData(t.db)).toBe(false);
    expect(readAccessAgeMarker(t.db)).toEqual({ from: 65, to: 60, at: LATER.toISOString() });
  });

  it('runs once per database: a second call (even over a re-imported 65) does nothing', () => {
    seedFireReplacedAge(t.db);
    expect(applySettingUpgrades(t, NOW)).toHaveLength(1);
    expect(applySettingUpgrades(t, LATER)).toEqual([]);
    expect(row()).toMatchObject({ valueJson: '60', origin: 'app', updatedAt: NOW.toISOString() });
    // An import that wrote 65 again (e.g. after the owner deleted the app row) is left alone.
    putAge('65', 'import');
    expect(applySettingUpgrades(t, LATER)).toEqual([]);
    expect(row()).toMatchObject({ valueJson: '65', origin: 'import' });
  });

  it('no row: nothing and no marker, so a later import of 65 is still replaced', () => {
    expect(applySettingUpgrades(t, NOW)).toEqual([]);
    expect(marker()).toBeUndefined();
    expect(row()).toBeUndefined();
    putAge('65', 'import');
    expect(applySettingUpgrades(t, LATER)).toHaveLength(1);
    expect(row()).toMatchObject({ valueJson: '60', origin: 'app' });
  });

  it.each([
    ['64 imported', '64', 'import'],
    ['66 imported', '66', 'import'],
    ['60 imported', '60', 'import'],
    ['65 set in the app', '65', 'app'],
    ['a text value', '"65"', 'import'],
    ['a malformed value', '{', 'import'],
  ] as const)('%s: nothing and no marker', (_label, valueJson, origin) => {
    putAge(valueJson, origin);
    expect(applySettingUpgrades(t, NOW)).toEqual([]);
    expect(row()).toMatchObject({ valueJson, origin });
    expect(marker()).toBeUndefined();
  });
});

describe('the marker read back (§3.4, §4.5)', () => {
  it('reads null when absent or malformed', () => {
    expect(readAccessAgeMarker(t.db)).toBeNull();
    for (const value of ['{', '{"from":65,"to":60}', '{"from":"65","to":60,"at":"2026-01-01"}']) {
      t.db
        .insert(appMeta)
        .values({ key: FIRE_ACCESS_AGE_META_KEY, value, updatedAt: NOW.toISOString() })
        .onConflictDoUpdate({ target: appMeta.key, set: { value } })
        .run();
      expect(readAccessAgeMarker(t.db), value).toBeNull();
    }
  });

  it('a malformed marker still stops a replacement (only its presence counts)', () => {
    t.db
      .insert(appMeta)
      .values({ key: FIRE_ACCESS_AGE_META_KEY, value: '{', updatedAt: NOW.toISOString() })
      .run();
    seedFireReplacedAge(t.db);
    expect(applySettingUpgrades(t, NOW)).toEqual([]);
  });

  it('applies while the stored age is still the marker’s `to`', () => {
    const m = { from: 65, to: 60, at: NOW.toISOString() };
    expect(accessAgeReplaced(m, 60)).toEqual(m);
    expect(accessAgeReplaced(m, 62)).toBeNull();
    expect(accessAgeReplaced(m, null)).toBeNull();
    expect(accessAgeReplaced(null, 60)).toBeNull();
  });
});

describe('logSettingUpgrades', () => {
  it('logs one info line per upgrade with the key and the ages only', () => {
    const info = vi.fn();
    logSettingUpgrades({ info }, []);
    expect(info).not.toHaveBeenCalled();
    logSettingUpgrades({ info }, [{ key: KEY, from: 65, to: 60, at: NOW.toISOString() }]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toEqual({ key: KEY, from: 65, to: 60 });
    expect(info.mock.calls[0]![1]).toMatch(/D98/);
  });
});

describe('buildApp runs the one-off at start (§3.4)', () => {
  it('upgrades a database imported while the server was down, once', async () => {
    const dir = await makeTempDir();
    try {
      const config = testConfig(join(dir, 'data'));
      const first = openDatabase(config.dataDir);
      runMigrations(first, config.migrationsDir);
      seedGenericData(first.db, { now: NOW });
      seedFireReplacedAge(first.db);
      let app = await buildApp({ config, db: first, now: () => NOW, engine: fakeEngine() });
      const stored = () => first.db.select().from(settings).where(eq(settings.key, KEY)).get();
      expect(stored()).toMatchObject({ valueJson: '60', origin: 'app' });
      expect(readAccessAgeMarker(first.db)).toEqual({ from: 65, to: 60, at: NOW.toISOString() });
      await app.close(); // closes the database

      // A restart: no second replacement.
      const again = openDatabase(config.dataDir);
      app = await buildApp({ config, db: again, now: () => LATER, engine: fakeEngine() });
      expect(applySettingUpgrades(again, LATER)).toEqual([]);
      expect(readAccessAgeMarker(again.db)?.at).toBe(NOW.toISOString());
      await app.close();
    } finally {
      await removeDir(dir);
    }
  });

  it('leaves a fresh database alone', async () => {
    const dir = await makeTempDir();
    try {
      const config = testConfig(join(dir, 'data'));
      const database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      const app = await buildApp({ config, db: database, now: () => NOW, engine: fakeEngine() });
      expect(readAccessAgeMarker(database.db)).toBeNull();
      await app.close();
    } finally {
      await removeDir(dir);
    }
  });
});
