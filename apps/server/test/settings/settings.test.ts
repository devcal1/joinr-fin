// The Settings API (stage-5.md §3.3, §4.4, §4.5 "Settings", §7.4 step 5, D84–D95) with a FAKE
// engine: `GET /api/settings` (the groups, every key in registry order with its value, origin,
// group, editable and workbook flags, the locks, the preference flag and the pages that read it;
// the tax suggestion with and without a salary and which figure the current rate matches; the
// allocation sum; the recorder's status), SETTING_READERS against the page setting-key constants,
// and `PATCH /api/settings` of every editable key (the registry and write-only bounds, the
// AUTO_RECORD lock on `history.autoRecord`, `settingsChanged()` only when that key is written, the
// response returning every named key including keys on no page). Generic values only.
import { join } from 'node:path';
import type { MarginalRateSuggestion } from '@joinr/engine';
import {
  EDITABLE_SETTING_KEYS,
  PREFERENCE_SETTING_KEYS,
  SETTING_GROUPS,
  SETTING_KEYS,
  settingDef,
  TAX_RATES_CHECKED_ON,
  type EditableSettingKey,
  type SettingsPageResponse,
  type SettingsPatchResponse,
  type SettingValue,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { seedGenericData } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app';
import {
  OTHER_ASSETS_PAGE_SETTING_KEYS,
  PROPERTY_PAGE_SETTING_KEYS,
  SUPER_PAGE_SETTING_KEYS,
} from '../../src/assets/constants';
import { BUDGET_PAGE_SETTING_KEYS, CASH_PAGE_SETTING_KEYS } from '../../src/cashflow/constants';
import { AUTO_RECORD_LOCKED_MESSAGE } from '../../src/cashflow/mutations/settings';
import { closeDatabase, openDatabase, runMigrations } from '../../src/db/database';
import { SETTING_READER_PAGES, SETTING_READERS, settingReaders } from '../../src/settings/readers';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import {
  call,
  errorOf,
  hasAppDataOf,
  historyFakeEngine,
  NOW,
  startApp,
  type TestApp,
} from '../history/helpers';

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const suggestion = (p: Partial<MarginalRateSuggestion> = {}): MarginalRateSuggestion => ({
  financialYear: 2026,
  tableFinancialYear: 2026,
  tableCurrent: true,
  incomeCents: 10000000,
  bracket: { thresholdCents: 4500000, toCents: 13500000, ratio: '0.3' },
  bracketRatio: '0.3',
  medicare: { thresholdCents: 2801100, thresholdFinancialYear: 2025, ratio: '0.02', band: 'full' },
  suggestedRatio: '0.32',
  incomeTaxCents: 2000000,
  medicareLevyCents: 200000,
  litoPhaseOut: false,
  ...p,
});

function put(app: TestApp, key: string, value: unknown, origin: 'import' | 'app' = 'import'): void {
  const row = { key, valueJson: JSON.stringify(value), updatedAt: NOW.toISOString(), origin };
  app.database.db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson, origin } })
    .run();
}

const getPage = (app: FastifyInstance) =>
  call<SettingsPageResponse>(app, { method: 'GET', url: '/api/settings' });

describe('GET /api/settings (§4.4)', () => {
  it('lists every group and every key in registry order with its flags', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const res = await getPage(ctx.app);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    expect(body.groups).toEqual(
      SETTING_GROUPS.map((g) => ({ id: g.id, label: g.label, keys: [...g.keys] })),
    );
    expect(body.settings.map((s) => s.key)).toEqual([...SETTING_KEYS]);
    const byKey = new Map(body.settings.map((s) => [s.key, s]));
    // Editable: every key but the server-written cap FY (D91: the unused keys too).
    expect(body.settings.filter((s) => !s.editable).map((s) => s.key)).toEqual([
      'super.concessionalCapFy',
    ]);
    expect(byKey.get('super.concessionalCapFy')).toMatchObject({
      lockedBy: 'server',
      group: 'super',
    });
    expect(body.settings.filter((s) => s.lockedBy !== null)).toHaveLength(1);
    // Preference keys are never "workbook" (D95); app-only keys are not either.
    expect(body.settings.filter((s) => s.preference).map((s) => s.key)).toEqual([
      ...PREFERENCE_SETTING_KEYS,
    ]);
    expect(byKey.get('charts.dateUnit')).toMatchObject({ workbook: false, preference: true });
    expect(byKey.get('pay.netPayCents')).toMatchObject({ workbook: true, preference: false });
    expect(byKey.get('savings.yearBasis')).toMatchObject({ workbook: false, preference: false });
    expect(byKey.get('history.autoRecord')).toMatchObject({
      group: 'history',
      type: 'boolean',
      defaultValue: false,
      value: null,
      origin: null,
      lockedBy: null,
      usedOn: ['history'],
    });
    // The seeded workbook settings carry their origin and value.
    const seeded = body.settings.find((s) => s.origin === 'import')!;
    expect(seeded.value).not.toBeNull();
    // A key with registry details.
    expect(byKey.get('pay.dayOfMonth')).toMatchObject({
      label: settingDef('pay.dayOfMonth').label,
      type: 'integer',
      min: 0,
      max: 28,
      enumValues: null,
    });
    expect(byKey.get('charts.dateUnit')!.enumValues).toEqual(['monthly', 'quarterly', 'yearly']);
    // The unused workbook keys (D91) are used on no page.
    const unused = SETTING_GROUPS.find((g) => g.id === 'unused')!.keys;
    for (const key of unused) expect(byKey.get(key)!.usedOn, key).toEqual([]);
    expect(body.recorder).toEqual(ctx.app.recorder.status());
  });

  it('the tax suggestion: null without a salary (the engine is not asked)', async () => {
    const engine = historyFakeEngine({ suggestMarginalRate: () => suggestion() });
    ctx = await startApp({ engine });
    ctx.database.db.delete(settings).where(eq(settings.key, 'pay.grossAnnualSalaryCents')).run();
    const res = await getPage(ctx.app);
    expect(res.body.taxSuggestion).toBeNull();
    expect(engine.calls.suggestMarginalRate).toHaveLength(0);
  });

  it('the tax suggestion with a salary, and which figure the current rate matches (D90)', async () => {
    const engine = historyFakeEngine({ suggestMarginalRate: () => suggestion() });
    ctx = await startApp({ engine });
    put(ctx, 'pay.grossAnnualSalaryCents', 10000000);
    put(ctx, 'tax.marginalRate', '0.32');
    const res = await getPage(ctx.app);
    expect(engine.calls.suggestMarginalRate.at(-1)![0]).toEqual({
      incomeCents: 10000000,
      asOf: '2026-09-24',
    });
    expect(res.body.taxSuggestion).toEqual({
      ...suggestion(),
      checkedOn: TAX_RATES_CHECKED_ON,
      currentRatio: '0.32',
      matches: 'suggested',
    });
    put(ctx, 'tax.marginalRate', '0.3');
    expect((await getPage(ctx.app)).body.taxSuggestion).toMatchObject({ matches: 'bracket' });
    put(ctx, 'tax.marginalRate', '0.37');
    expect((await getPage(ctx.app)).body.taxSuggestion).toMatchObject({ matches: null });
    ctx.database.db.delete(settings).where(eq(settings.key, 'tax.marginalRate')).run();
    expect((await getPage(ctx.app)).body.taxSuggestion).toMatchObject({
      currentRatio: null,
      matches: null,
    });
  });

  it('the allocation sum: Σ of the set targets, null when none is set', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    for (const k of SETTING_KEYS.filter((k) => k.startsWith('allocation.'))) {
      ctx.database.db.delete(settings).where(eq(settings.key, k)).run();
    }
    expect((await getPage(ctx.app)).body.allocationSumRatio).toBeNull();
    put(ctx, 'allocation.etf', '0.62');
    put(ctx, 'allocation.cash', '0.4');
    expect((await getPage(ctx.app)).body.allocationSumRatio).toBe('1.02');
  });
});

describe('SETTING_READERS (§4.5)', () => {
  it('names a page for every key its settings section edits', () => {
    const pages: [string, readonly string[]][] = [
      ['budget', BUDGET_PAGE_SETTING_KEYS],
      ['cash', CASH_PAGE_SETTING_KEYS],
      ['super', SUPER_PAGE_SETTING_KEYS],
      ['other-assets', OTHER_ASSETS_PAGE_SETTING_KEYS],
      ['property', PROPERTY_PAGE_SETTING_KEYS],
    ];
    for (const [page, keys] of pages) {
      for (const key of keys)
        expect(SETTING_READERS[key as EditableSettingKey], `${page} ${key}`).toContain(page);
    }
  });

  it('covers every key with known page ids, in page order, without repeats', () => {
    expect(Object.keys(SETTING_READERS).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) {
      const readers = settingReaders(key);
      expect(new Set(readers).size, key).toBe(readers.length);
      expect(
        readers.every((p) => (SETTING_READER_PAGES as readonly string[]).includes(p)),
        key,
      ).toBe(true);
      expect(readers).toEqual(
        [...readers].sort(
          (a, b) =>
            SETTING_READER_PAGES.indexOf(a as never) - SETTING_READER_PAGES.indexOf(b as never),
        ),
      );
    }
    // The allocation targets are read by the dashboard's liquid allocation.
    expect(settingReaders('allocation.otherAssets')).toContain('net-worth');
    for (const key of SETTING_KEYS.filter(
      (k) => k.startsWith('features.') || k.startsWith('fire.'),
    )) {
      expect(settingReaders(key), key).toEqual([]);
    }
  });
});

// ─── PATCH /api/settings (§3.3, §4.5) ───────────────────────────────────────────────────────────

/** A valid value for every editable key (a non-default where one exists). */
function everyEditableValue(): Record<EditableSettingKey, SettingValue> {
  const out = {} as Record<EditableSettingKey, SettingValue>;
  for (const key of EDITABLE_SETTING_KEYS) {
    const def = settingDef(key);
    switch (def.type) {
      case 'money':
        out[key] = 123400;
        break;
      case 'ratio':
        out[key] = '0.25';
        break;
      case 'integer': {
        const min = def.min ?? 1;
        const max = def.max ?? min + 10;
        out[key] = Math.max(1, Math.min(max, min + 3));
        break;
      }
      case 'boolean':
        out[key] = def.defaultValue !== true;
        break;
      case 'enum':
        out[key] = def.enumValues![def.enumValues!.length - 1]!;
        break;
      case 'date':
        out[key] = '2021-02-01';
        break;
    }
  }
  return out;
}

describe('PATCH /api/settings (§3.3, §4.5)', () => {
  const patch = (app: FastifyInstance, values: Record<string, unknown>) =>
    call<SettingsPatchResponse>(app, {
      method: 'PATCH',
      url: '/api/settings',
      payload: { values },
    });

  it('writes every editable key in one PATCH and answers every named key', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const values = everyEditableValue();
    const res = await patch(ctx.app, values);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(new Set(Object.keys(res.body.settings.values))).toEqual(new Set(EDITABLE_SETTING_KEYS));
    for (const key of EDITABLE_SETTING_KEYS) {
      expect(res.body.settings.values[key], key).toEqual(values[key]);
      expect(res.body.settings.origins[key], key).toBe('app');
    }
    expect(res.body.hasAppData).toBe(true);
  });

  it('a key on no page answers its own slice; a preference key is not app data (D95)', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const res = await patch(ctx.app, { 'features.crypto': false });
    expect(res.body).toEqual({
      settings: { values: { 'features.crypto': false }, origins: { 'features.crypto': 'app' } },
      hasAppData: false,
    });
    const fire = await patch(ctx.app, { 'fire.birthYear': 1990 });
    expect(Object.keys(fire.body.settings.values)).toEqual(['fire.birthYear']);
    // A page key still brings its page's slice, plus the other named keys.
    const mixed = await patch(ctx.app, { 'super.sgRate': '0.12', 'charts.unitCount': 12 });
    expect(Object.keys(mixed.body.settings.values)).toEqual([
      ...SUPER_PAGE_SETTING_KEYS,
      'charts.unitCount',
    ]);
  });

  it('applies the registry and write-only bounds (the unused keys at their registry bounds)', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const ok: Record<string, unknown>[] = [
      { 'charts.unitCount': 1 },
      { 'charts.unitCount': 240 },
      { 'returns.cashInterestRate': '-1' },
      { 'fire.withdrawalRate': '1' },
      { 'goals.houseDepositRatio': '1' },
      { 'goals.housePriceTargetCents': 0 },
      { 'investing.parcelFrequencyMonths': 0 },
      { 'savings.includeRetirementContributions': true },
    ];
    for (const v of ok) expect((await patch(ctx.app, v)).status, JSON.stringify(v)).toBe(200);
    const bad: Record<string, unknown>[] = [
      { 'charts.unitCount': 0 },
      { 'charts.unitCount': 241 },
      { 'returns.marketReturn': '1.01' },
      { 'fire.inflationRate': '-1.5' },
      { 'fire.withdrawalRate': '-0.01' },
      { 'goals.houseDepositRatio': '1.01' },
      { 'goals.housePriceTargetCents': -1 },
      { 'investing.parcelFrequencyMonths': -1 },
      { 'history.autoRecord': 'yes' },
    ];
    for (const v of bad) {
      const res = await patch(ctx.app, v);
      expect(res.status, JSON.stringify(v)).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    }
  });

  it('calls settingsChanged() only when history.autoRecord is written', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const spy = vi.spyOn(ctx.app.recorder, 'settingsChanged');
    await patch(ctx.app, { 'charts.dateUnit': 'yearly' });
    expect(spy).not.toHaveBeenCalled();
    const on = await patch(ctx.app, { 'history.autoRecord': true });
    expect(on.status).toBe(200);
    expect(on.body.settings.values).toEqual({ 'history.autoRecord': true });
    expect(spy).toHaveBeenCalledTimes(1);
    // The same value again writes nothing, so the recorder is not told.
    await patch(ctx.app, { 'history.autoRecord': true });
    expect(spy).toHaveBeenCalledTimes(1);
    await patch(ctx.app, { 'history.autoRecord': false });
    expect(spy).toHaveBeenCalledTimes(2);
    // An app-only key: never app data (§3.4).
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});

describe('AUTO_RECORD locks the switch (§4.5, §4.6 item 1)', () => {
  it('shows the lock and refuses a write of history.autoRecord', async () => {
    const dir = await makeTempDir();
    const config = testConfig(join(dir, 'data'), { autoRecord: true });
    const database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    seedGenericData(database.db, { now: NOW });
    const app = await buildApp({
      config,
      db: database,
      now: () => NOW,
      engine: historyFakeEngine(),
    });
    try {
      const page = await getPage(app);
      expect(page.body.settings.find((s) => s.key === 'history.autoRecord')).toMatchObject({
        lockedBy: 'env',
        editable: true,
      });
      const spy = vi.spyOn(app.recorder, 'settingsChanged');
      const res = await call(app, {
        method: 'PATCH',
        url: '/api/settings',
        payload: { values: { 'history.autoRecord': true, 'charts.unitCount': 6 } },
      });
      expect(res.status).toBe(400);
      expect(errorOf(res.body)).toEqual({
        code: 'VALIDATION_ERROR',
        message: AUTO_RECORD_LOCKED_MESSAGE,
      });
      expect(AUTO_RECORD_LOCKED_MESSAGE).toBe(
        "values.history.autoRecord: set by the server's AUTO_RECORD",
      );
      expect(spy).not.toHaveBeenCalled();
      // Nothing was written (the whole PATCH is refused).
      expect(
        database.db.select().from(settings).where(eq(settings.key, 'charts.unitCount')).get(),
      ).toBeUndefined();
    } finally {
      await app.close();
      closeDatabase(database);
      await removeDir(dir);
    }
  });
});
