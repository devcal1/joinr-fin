// Stage 5 settings rules on re-import (stage-5.md §3.3, §3.5 items 1 and 3, §7.6) on the generic
// synthetic workbook: D87 (an import-origin row the workbook no longer provides reads its default),
// D95 (a display preference set in the app is kept), D91 (a workbook key the app does not use still
// follows the workbook-key rules), the Stage 3 rules unchanged, the report lines (counts only), the
// dry run and idempotency.
import type { WorkBook } from 'xlsx';
import {
  isPreferenceSettingKey,
  isSettingKey,
  isWorkbookSetting,
  PREFERENCE_SETTING_KEYS,
  settingDef,
  type ReconciliationReport,
} from '@joinr/schema';
import { DOMAIN_TABLES_DELETE_ORDER, instruments, settings, type JoinrDb } from '@joinr/schema/db';
import { createTestDb, dumpDomainTables, type TestDb } from '@joinr/schema/testing';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMPORTER_STAGE5_IMPLEMENTED } from '../src/testing/index';
import { buildSyntheticWorkbook } from '../src/testing/syntheticWorkbook';
import { all, num, set, str } from './assets-helpers';
import { checkById, problems, reportOf, runImport } from './helpers';

const LATER = () => new Date('2026-04-02T03:04:05.000Z');
const APP_AT = '2026-03-25T00:00:00.000Z';

it('is flagged implemented for the gated server suites (§3.5 item 5)', () => {
  expect(IMPORTER_STAGE5_IMPLEMENTED).toBe(true);
});

// ─── Workbook mutations (generic values; SheetOptions ID n sits in row n + 2) ───────────────────

/** SheetOptions ID 6 ("General Cash Savings Target", `goals.cashSavingsTargetCents`) blanked. */
const withCashTargetBlank = (wb: WorkBook): void => set(wb, 'SheetOptions', 'L8', null);
/** SheetOptions ID 7 ("Salary Frequency", `pay.frequency`) holding text no pay frequency matches. */
const withInvalidPayFrequency = (wb: WorkBook): void =>
  set(wb, 'SheetOptions', 'L9', str('Every so often'));
/** Budget D3 typed over its default formula (`budget.emergencyFundOverrideCents`). */
const withTypedEmergencyFund = (wb: WorkBook): void => set(wb, 'Budget', 'D3', num(7000));
/** Net Worth H60 ("Date Unit", `charts.dateUnit`) blanked. */
const withChartUnitBlank = (wb: WorkBook): void => set(wb, 'Net Worth', 'H60', null);

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

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

/** The server's `hasAppData` rule (stage-5.md §3.4): preference keys never count (D95). */
function hasAppRows(db: JoinrDb): boolean {
  const appSettings = db
    .select()
    .from(settings)
    .where(eq(settings.origin, 'app'))
    .all()
    .some((s) => isSettingKey(s.key) && isWorkbookSetting(s.key) && !isPreferenceSettingKey(s.key));
  if (appSettings) return true;
  return [instruments, ...DOMAIN_TABLES_DELETE_ORDER].some(
    (table) =>
      db
        .select({ origin: table.origin })
        .from(table)
        .where(eq(table.origin, 'app'))
        .limit(1)
        .get() !== undefined,
  );
}

const lineIds = (report: ReconciliationReport) =>
  report.checks
    .filter((c) => c.id === 'settings.resetToDefault' || c.id === 'settings.keptAppPreference')
    .map((c) => c.id);

function allSettings(db: JoinrDb) {
  return db.select().from(settings).orderBy(asc(settings.key)).all();
}

let t: TestDb;
beforeEach(() => {
  t = createTestDb();
});
afterEach(() => t.close());

describe('D87: an imported setting the workbook no longer provides (settings rule 4)', () => {
  it('a first import reports no line (nothing to reset or keep)', () => {
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    expect(problems(report)).toEqual([]);
    expect(lineIds(report)).toEqual([]);
  });

  it('a blanked cell resets the imported row to the default, with a count-only info line', () => {
    runImport(t.db, buildSyntheticWorkbook());
    expect(settingRow(t.db, 'goals.cashSavingsTargetCents')?.origin).toBe('import');
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withCashTargetBlank }), { now: LATER }),
    );
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'goals.cashSavingsTargetCents')).toBeUndefined();
    expect(settingDef('goals.cashSavingsTargetCents').defaultValue).toBeNull();
    expect(checkById(report, 'settings.resetToDefault')).toMatchObject({
      section: 'settings',
      status: 'info',
      unit: 'count',
      expected: null,
      actual: 1,
      reasonCode: null,
      refs: { decision: 'D87', entity: 'settings' },
    });
    expect(checkById(report, 'settings.sheetOptions.6')).toMatchObject({ status: 'info' });
    expect(lineIds(report)).toEqual(['settings.resetToDefault']);
    expect(hasAppRows(t.db)).toBe(false);
  });

  it('an "only when typed" override back to its formula resets the imported override', () => {
    runImport(t.db, buildSyntheticWorkbook({ mutate: withTypedEmergencyFund }));
    expect(settingRow(t.db, 'budget.emergencyFundOverrideCents')).toMatchObject({
      valueJson: '700000',
      origin: 'import',
    });
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'budget.emergencyFundOverrideCents')).toBeUndefined();
    expect(checkById(report, 'settings.budget.emergencyFundOverrideCents')).toMatchObject({
      status: 'info',
      reasonCode: 'formula_default',
    });
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(1);
  });

  it('an invalid value resets the imported row (and stays an unexplained line, as before)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    expect(settingRow(t.db, 'pay.frequency')?.origin).toBe('import');
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withInvalidPayFrequency }), {
        now: LATER,
      }),
    );
    expect(settingRow(t.db, 'pay.frequency')).toBeUndefined();
    expect(checkById(report, 'settings.sheetOptions.7')).toMatchObject({
      status: 'unexplained',
      reasonCode: 'unsupported_value',
    });
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(1);
  });

  it('counts every reset row once, in one line', () => {
    runImport(t.db, buildSyntheticWorkbook({ mutate: withTypedEmergencyFund }));
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: all(withCashTargetBlank) }), {
        now: LATER,
      }),
    );
    expect(problems(report)).toEqual([]);
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(2);
    expect(settingRow(t.db, 'goals.cashSavingsTargetCents')).toBeUndefined();
    expect(settingRow(t.db, 'budget.emergencyFundOverrideCents')).toBeUndefined();
  });

  it('resets an import-origin preference row too (D95 keeps app rows only)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    expect(settingRow(t.db, 'charts.dateUnit')?.origin).toBe('import');
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withChartUnitBlank }), { now: LATER }),
    );
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'charts.dateUnit')).toBeUndefined();
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(1);
    expect(lineIds(report)).toEqual(['settings.resetToDefault']);
  });

  it('the dry run reports the same line and writes nothing', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const before = allSettings(t.db);
    const dry = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withCashTargetBlank }), {
        dryRun: true,
        now: LATER,
      }),
    );
    expect(allSettings(t.db)).toEqual(before);
    expect(checkById(dry, 'settings.resetToDefault')).toMatchObject({ status: 'info', actual: 1 });
    const real = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withCashTargetBlank }), { now: LATER }),
    );
    expect(checkById(real, 'settings.resetToDefault')).toEqual(
      checkById(dry, 'settings.resetToDefault'),
    );
  });
});

describe('app rows (the Stage 3 rules, D91)', () => {
  it('an app row of a workbook key the workbook does not provide is removed (rule 3), not counted as a reset', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'budget.emergencyFundOverrideCents', 700000);
    expect(hasAppRows(t.db)).toBe(true);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'budget.emergencyFundOverrideCents')).toBeUndefined();
    expect(lineIds(report)).toEqual([]);
    expect(hasAppRows(t.db)).toBe(false);
  });

  it('an app row of a provided workbook key is replaced by the workbook value (origin import)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const imported = settingRow(t.db, 'pay.dayOfMonth')!;
    setAppValue(t.db, 'pay.dayOfMonth', 28);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'pay.dayOfMonth')).toMatchObject({
      valueJson: imported.valueJson,
      origin: 'import',
      updatedAt: LATER().toISOString(),
    });
    expect(lineIds(report)).toEqual([]);
  });

  it('an app row of an unused workbook key follows the workbook-key rules (D91)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const key = 'goals.housePriceTargetCents';
    const imported = settingRow(t.db, key)!;
    expect(imported.origin).toBe('import');
    setAppValue(t.db, key, 12_300_000);
    // A workbook key, not a preference: it counts as app data, so it blocks an unforced import.
    expect(isWorkbookSetting(key)).toBe(true);
    expect(isPreferenceSettingKey(key)).toBe(false);
    expect(hasAppRows(t.db)).toBe(true);
    // A forced import replaces it with the workbook value.
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, key)).toMatchObject({
      valueJson: imported.valueJson,
      origin: 'import',
    });
    expect(hasAppRows(t.db)).toBe(false);
  });

  it('app-only keys are never touched, whatever their origin', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'savings.yearBasis', 'calendar');
    setAppValue(t.db, 'history.autoRecord', true);
    // The server writes the cap FY; an import never provides it.
    t.db
      .insert(settings)
      .values({
        key: 'super.concessionalCapFy',
        valueJson: '2026',
        updatedAt: APP_AT,
        origin: 'import',
      })
      .run();
    const before = ['savings.yearBasis', 'history.autoRecord', 'super.concessionalCapFy'].map((k) =>
      settingRow(t.db, k),
    );
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withCashTargetBlank }), { now: LATER }),
    );
    expect(problems(report)).toEqual([]);
    expect(
      ['savings.yearBasis', 'history.autoRecord', 'super.concessionalCapFy'].map((k) =>
        settingRow(t.db, k),
      ),
    ).toEqual(before);
    // Only the blanked workbook key was reset.
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(1);
    expect(hasAppRows(t.db)).toBe(false);
  });
});

describe('D95: display preferences set in the app are kept on re-import', () => {
  it('keeps an app value the workbook provides differently, with a count-only info line', () => {
    runImport(t.db, buildSyntheticWorkbook());
    expect(settingRow(t.db, 'features.crypto')).toMatchObject({
      valueJson: 'true',
      origin: 'import',
    });
    setAppValue(t.db, 'features.crypto', false);
    setAppValue(t.db, 'charts.dateUnit', 'quarterly');
    // Preferences never count as app data, so this import is not blocked.
    expect(hasAppRows(t.db)).toBe(false);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'features.crypto')).toEqual({
      key: 'features.crypto',
      valueJson: 'false',
      updatedAt: APP_AT,
      origin: 'app',
    });
    expect(settingRow(t.db, 'charts.dateUnit')).toMatchObject({
      valueJson: '"quarterly"',
      origin: 'app',
    });
    expect(checkById(report, 'settings.keptAppPreference')).toMatchObject({
      section: 'settings',
      status: 'info',
      unit: 'count',
      expected: null,
      actual: 2,
      refs: { decision: 'D95', entity: 'settings' },
    });
    expect(lineIds(report)).toEqual(['settings.keptAppPreference']);
    // The per-key line explains the difference instead of failing it.
    expect(checkById(report, 'settings.features.crypto')).toMatchObject({
      status: 'info',
      expected: 'Yes',
      actual: 'No',
      refs: { decision: 'D95', entity: 'settings' },
    });
    expect(checkById(report, 'settings.charts.dateUnit')).toMatchObject({
      status: 'info',
      refs: { decision: 'D95', entity: 'settings' },
    });
  });

  it('keeps an app value equal to the workbook value (it stays an app row, and matches)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'features.etfs', true);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'features.etfs')).toMatchObject({ valueJson: 'true', origin: 'app' });
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(1);
    expect(
      report.checks.filter(
        (c) => c.section === 'settings' && c.status === 'info' && c.refs?.decision === 'D95',
      ),
    ).toHaveLength(1);
  });

  it('keeps an app value of a preference the workbook does not provide (not removed by rule 3)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    // Net Worth H61 holds its default formula, so the workbook never provides charts.unitCount.
    expect(settingRow(t.db, 'charts.unitCount')).toBeUndefined();
    setAppValue(t.db, 'charts.unitCount', 24);
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(settingRow(t.db, 'charts.unitCount')).toMatchObject({
      valueJson: '24',
      origin: 'app',
    });
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(1);
    expect(lineIds(report)).toEqual(['settings.keptAppPreference']);
  });

  it('keeps every preference key, and reports both lines together', () => {
    runImport(t.db, buildSyntheticWorkbook());
    for (const key of PREFERENCE_SETTING_KEYS) {
      const def = settingDef(key);
      setAppValue(
        t.db,
        key,
        def.type === 'boolean' ? false : def.type === 'integer' ? 6 : 'yearly',
      );
    }
    const report = reportOf(
      runImport(t.db, buildSyntheticWorkbook({ mutate: withCashTargetBlank }), { now: LATER }),
    );
    expect(problems(report)).toEqual([]);
    for (const key of PREFERENCE_SETTING_KEYS) {
      expect(settingRow(t.db, key)?.origin, key).toBe('app');
    }
    expect(checkById(report, 'settings.keptAppPreference').actual).toBe(
      PREFERENCE_SETTING_KEYS.length,
    );
    expect(checkById(report, 'settings.resetToDefault').actual).toBe(1);
    expect(lineIds(report)).toEqual(['settings.resetToDefault', 'settings.keptAppPreference']);
  });

  it('the dry run reports the kept line and writes nothing', () => {
    runImport(t.db, buildSyntheticWorkbook());
    setAppValue(t.db, 'features.crypto', false);
    const before = allSettings(t.db);
    const dry = reportOf(runImport(t.db, buildSyntheticWorkbook(), { dryRun: true, now: LATER }));
    expect(allSettings(t.db)).toEqual(before);
    expect(checkById(dry, 'settings.keptAppPreference')).toMatchObject({
      status: 'info',
      actual: 1,
    });
  });
});

describe('idempotency (§3.5 item 3)', () => {
  it('the same workbook twice gives identical dumps (ids included) and reports', () => {
    const bytes = buildSyntheticWorkbook();
    const first = reportOf(runImport(t.db, bytes));
    const dump = dumpDomainTables(t.db);
    const second = reportOf(runImport(t.db, bytes, { now: LATER }));
    expect(dumpDomainTables(t.db)).toEqual(dump);
    const view = (r: ReconciliationReport) =>
      r.checks.map((c) => [c.id, c.status, c.expected, c.actual]);
    expect(view(second)).toEqual(view(first));
    expect(allSettings(t.db).every((s) => s.origin === 'import')).toBe(true);
  });

  it('a blanked cell imported over a first import leaves the key unset; importing it again changes nothing', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const blanked = buildSyntheticWorkbook({ mutate: withCashTargetBlank });
    const reset = reportOf(runImport(t.db, blanked, { now: LATER }));
    expect(checkById(reset, 'settings.resetToDefault').actual).toBe(1);
    expect(settingRow(t.db, 'goals.cashSavingsTargetCents')).toBeUndefined();
    const dump = dumpDomainTables(t.db);
    const settingsAfter = allSettings(t.db);
    const again = reportOf(runImport(t.db, blanked, { now: LATER }));
    expect(problems(again)).toEqual([]);
    expect(lineIds(again)).toEqual([]);
    expect(dumpDomainTables(t.db)).toEqual(dump);
    expect(allSettings(t.db)).toEqual(settingsAfter);
  });

  it('a kept preference stays identical across repeated imports', () => {
    const bytes = buildSyntheticWorkbook();
    runImport(t.db, bytes);
    setAppValue(t.db, 'features.property', false);
    const first = reportOf(runImport(t.db, bytes, { now: LATER }));
    const settingsAfter = allSettings(t.db);
    const second = reportOf(runImport(t.db, bytes, { now: LATER }));
    expect(allSettings(t.db)).toEqual(settingsAfter);
    expect(checkById(second, 'settings.keptAppPreference')).toEqual(
      checkById(first, 'settings.keptAppPreference'),
    );
  });
});
