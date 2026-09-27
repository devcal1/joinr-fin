// D103 on re-import (stage-6.md §3.3, §3.5, §7.4 step 3) on the generic synthetic workbook: every
// `fire.*` key is a preference, so an app value (a FIRE page Save, "Use the workbook's figure", the
// D98 one-off's 60) is kept by a re-import with the count-only `settings.keptAppPreference` line,
// never counts as app data, and the two app-only keys (no workbook cell) are never touched. The
// importer itself is unchanged (the Stage 5 D95 rule); these tests pin it for the FIRE keys.
import { FIRE_TAB_PREFIX, isPreferenceSettingKey, isWorkbookSetting } from '@joinr/schema';
import { settings, type JoinrDb } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import type { WorkBook } from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSyntheticWorkbook } from '../src/testing/syntheticWorkbook';
import { num, set } from './assets-helpers';
import { checkById, problems, reportOf, runImport } from './helpers';

const LATER = () => new Date('2026-10-02T03:04:05.000Z');
const APP_AT = '2026-09-25T00:00:00.000Z';

const FIRE_WORKBOOK_KEYS = [
  'fire.birthYear',
  'fire.superContributionPerYearCents',
  'fire.inflationRate',
  'fire.withdrawalRate',
  'fire.preservationAge',
] as const;

function settingRow(db: JoinrDb, key: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get();
}

function setAppValue(db: JoinrDb, key: string, value: unknown): void {
  const valueJson = JSON.stringify(value);
  db.insert(settings)
    .values({ key, valueJson, updatedAt: APP_AT, origin: 'app' })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueJson, updatedAt: APP_AT, origin: 'app' },
    })
    .run();
}

/** Flips a row to origin app with its value unchanged ("Use the workbook's figure"). */
function adopt(db: JoinrDb, key: string): void {
  db.update(settings).set({ origin: 'app', updatedAt: APP_AT }).where(eq(settings.key, key)).run();
}

/** The FIRE tab's access age typed as 65. */
const withAccessAge65 = (wb: WorkBook): void => {
  const name = wb.SheetNames.find((n) => n.startsWith(FIRE_TAB_PREFIX))!;
  set(wb, name, 'E10', num(65));
};

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.close());

describe('D103: the fire.* keys are preferences', () => {
  it('all eight are preference keys; the workbook provides five of them', () => {
    const all = [
      ...FIRE_WORKBOOK_KEYS,
      'fire.yearlySpendOverrideCents',
      'fire.marketReturn',
      'fire.extraSavingsPerYearCents',
    ] as const;
    for (const key of all) expect(isPreferenceSettingKey(key), key).toBe(true);
    for (const key of FIRE_WORKBOOK_KEYS) expect(isWorkbookSetting(key), key).toBe(true);
    expect(isWorkbookSetting('fire.marketReturn')).toBe(false);
    expect(isWorkbookSetting('fire.extraSavingsPerYearCents')).toBe(false);
  });

  it('a first import writes the workbook’s FIRE inputs with import origin', () => {
    runImport(t.db, buildSyntheticWorkbook());
    for (const key of FIRE_WORKBOOK_KEYS) {
      expect(settingRow(t.db, key)?.origin, key).toBe('import');
    }
    // The spend override is the template formula in the synthetic workbook: only-when-typed.
    expect(settingRow(t.db, 'fire.yearlySpendOverrideCents')).toBeUndefined();
  });
});

describe('D103: a second import keeps an app fire.* row, with the info line', () => {
  it('keeps every app value of a workbook FIRE key the workbook provides differently', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'fire.birthYear', 1985);
    setAppValue(t.db, 'fire.inflationRate', '0.02');
    setAppValue(t.db, 'fire.withdrawalRate', '0.035');
    setAppValue(t.db, 'fire.preservationAge', 62);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'fire.birthYear')).toEqual({
      key: 'fire.birthYear',
      valueJson: '1985',
      updatedAt: APP_AT,
      origin: 'app',
    });
    expect(settingRow(t.db, 'fire.preservationAge')).toMatchObject({
      valueJson: '62',
      origin: 'app',
    });
    expect(checkById(report, 'settings.keptAppPreference')).toMatchObject({
      status: 'info',
      unit: 'count',
      actual: 4,
      refs: { decision: 'D95', entity: 'settings' },
    });
  });

  it('keeps the adopted workbook contribution (value unchanged, origin app)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const imported = settingRow(t.db, 'fire.superContributionPerYearCents')!;
    adopt(t.db, 'fire.superContributionPerYearCents');
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'fire.superContributionPerYearCents')).toMatchObject({
      valueJson: imported.valueJson,
      origin: 'app',
      updatedAt: APP_AT,
    });
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(1);
  });

  it('keeps the D98 upgrade row (60, app) over a workbook still holding 65', () => {
    runImport(t.db, buildSyntheticWorkbook({ mutate: withAccessAge65 }));
    expect(settingRow(t.db, 'fire.preservationAge')).toMatchObject({
      valueJson: '65',
      origin: 'import',
    });
    // What the server's one-off writes (stage-6.md §3.4).
    setAppValue(t.db, 'fire.preservationAge', 60);
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withAccessAge65 }), { now: LATER }),
    );
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'fire.preservationAge')).toMatchObject({
      valueJson: '60',
      origin: 'app',
    });
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(1);
  });

  it('never touches the app-only FIRE keys (no workbook cell)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'fire.marketReturn', '0.065');
    setAppValue(t.db, 'fire.extraSavingsPerYearCents', -250000);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'fire.marketReturn')).toMatchObject({
      valueJson: '"0.065"',
      origin: 'app',
      updatedAt: APP_AT,
    });
    expect(settingRow(t.db, 'fire.extraSavingsPerYearCents')).toMatchObject({
      valueJson: '-250000',
      origin: 'app',
    });
    expect(report.checks.some((c) => c.id === 'settings.keptAppPreference')).toBe(false);
  });

  it('keeps an app spend override the workbook does not provide (not removed by rule 3)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'fire.yearlySpendOverrideCents', 4000000);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'fire.yearlySpendOverrideCents')).toMatchObject({
      valueJson: '4000000',
      origin: 'app',
    });
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(1);
  });
});
