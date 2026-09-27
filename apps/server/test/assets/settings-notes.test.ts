// Stage 4 changes to the Stage 3 settings and period-note routes (stage-4.md §3.3, §4.5 step 7,
// §7.4 step 3): the settings slice of every page a PATCH names (Budget, Cash, Super, Other Assets,
// Property; Stage 5 adds the named keys themselves, stage-5.md §4.5), a PATCH of the 22 page keys, the server-written cap FY (with the cap; null when it
// is cleared; never editable), and the `super_option` note kind (returned, not null; any month up to
// the as-of month, while `spend` and `side_income` keep their recorded-period rule). Generic values
// only.
import {
  EDITABLE_SETTING_KEYS,
  type EditableSettingKey,
  type PeriodNoteResponse,
  type SettingsPatchResponse,
  type SettingValue,
} from '@joinr/schema';
import { periodNotes, settings } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OTHER_ASSETS_PAGE_SETTING_KEYS,
  PROPERTY_PAGE_SETTING_KEYS,
  SUPER_PAGE_SETTING_KEYS,
} from '../../src/assets/constants';
import { BUDGET_PAGE_SETTING_KEYS, CASH_PAGE_SETTING_KEYS } from '../../src/cashflow/constants';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { assetsFakeEngine, call, errorOf, hasAppDataOf, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp({ engine: assetsFakeEngine() });
});
afterEach(async () => {
  await ctx.close();
});

const db = () => ctx.database.db;
const stored = (key: string) => db().select().from(settings).where(eq(settings.key, key)).get();

async function patch(values: Record<string, unknown>) {
  return call<SettingsPatchResponse>(ctx.app, {
    method: 'PATCH',
    url: '/api/settings',
    payload: { values },
  });
}

/**
 * The Stage 3–4 editable keys: the first 22 of EDITABLE_SETTING_KEYS, every one on a page (Stage 5
 * appends every other key, stage-5.md §3.3; those sit on the Settings page only).
 */
const PAGE_KEYS = EDITABLE_SETTING_KEYS.slice(0, 22);
const ALL_PAGE_KEYS = [
  ...BUDGET_PAGE_SETTING_KEYS,
  ...CASH_PAGE_SETTING_KEYS,
  ...SUPER_PAGE_SETTING_KEYS,
  ...OTHER_ASSETS_PAGE_SETTING_KEYS,
  ...PROPERTY_PAGE_SETTING_KEYS,
];

/** A valid, non-default value for every Stage 3–4 editable key. */
const EVERY_KEY: Partial<Record<EditableSettingKey, SettingValue>> = {
  'pay.frequency': 'monthly',
  'pay.netPayCents': 450000,
  'pay.dayOfMonth': 20,
  'pay.jobStartDate': '2021-02-01',
  'budget.includeSideIncome': true,
  'budget.emergencyFundMonths': 4,
  'budget.emergencyFundOverrideCents': 1500000,
  'budget.autoInvestSplit': true,
  'budget.useForInvestAmount': false,
  'goals.cashSavingsTargetCents': 2000000,
  'goals.eoyCashGoalCents': 3000000,
  'goals.houseDepositInvestmentShare': '0.5',
  'savings.includeMortgagePrincipal': true,
  'savings.yearBasis': 'calendar',
  'property.offsetsIncludeEmergencyFund': true,
  'pay.grossAnnualSalaryCents': 9000000,
  'tax.marginalRate': '0.325',
  'otherAssets.stalePriceDays': 60,
  'super.sgRate': '0.12',
  'super.contributionsTaxRate': '0.15',
  'super.concessionalCapCents': 3000000,
  'super.importedContributionType': 'after_tax',
};

describe('the settings slice of every named page (§3.3)', () => {
  it('lists the five pages’ keys (Cash explicit); every page key is editable', () => {
    // Stage 6 (stage-6.md §3.3): 62 with the two FIRE keys.
    expect(EDITABLE_SETTING_KEYS).toHaveLength(62);
    expect(CASH_PAGE_SETTING_KEYS).toHaveLength(6);
    expect(SUPER_PAGE_SETTING_KEYS).toHaveLength(7);
    expect(OTHER_ASSETS_PAGE_SETTING_KEYS).toEqual(['otherAssets.stalePriceDays']);
    expect(PROPERTY_PAGE_SETTING_KEYS).toEqual([
      'savings.includeMortgagePrincipal',
      'property.offsetsIncludeEmergencyFund',
    ]);
    // The page keys are exactly the Stage 3–4 editable keys (a subset of the 62 editable keys);
    // the Stage 5 keys are edited on the Settings page only.
    const onPages = new Set<string>(ALL_PAGE_KEYS);
    expect([...onPages].sort()).toEqual([...PAGE_KEYS].sort());
    const editable = new Set<string>(EDITABLE_SETTING_KEYS);
    expect(ALL_PAGE_KEYS.filter((k) => !editable.has(k))).toEqual([]);
  });

  it('a Super key answers the Super slice; a shared key brings both pages', async () => {
    const sg = await patch({ 'super.sgRate': '0.125' });
    expect(sg.status).toBe(200);
    expect(Object.keys(sg.body.settings.values)).toEqual([...SUPER_PAGE_SETTING_KEYS]);
    expect(sg.body.settings.values['super.sgRate']).toBe('0.125');
    expect(sg.body.settings.origins['super.sgRate']).toBe('app');
    // pay.jobStartDate is on the Budget and Super pages.
    const job = await patch({ 'pay.jobStartDate': '2021-02-01' });
    expect(Object.keys(job.body.settings.values)).toEqual([
      ...BUDGET_PAGE_SETTING_KEYS,
      ...SUPER_PAGE_SETTING_KEYS.filter((k) => k !== 'pay.jobStartDate'),
    ]);
  });

  it('a key on no page answers itself beside the named pages’ slices (stage-5.md §4.5)', async () => {
    const res = await patch({ 'otherAssets.stalePriceDays': 45, 'features.budget': false });
    expect(Object.keys(res.body.settings.values)).toEqual([
      'otherAssets.stalePriceDays',
      'features.budget',
    ]);
    expect(res.body.settings.origins['features.budget']).toBe('app');
  });

  it('the Other Assets and Property keys answer their slices (Property keys also bring Cash)', async () => {
    const stale = await patch({ 'otherAssets.stalePriceDays': 30 });
    expect(stale.body.settings).toEqual({
      values: { 'otherAssets.stalePriceDays': 30 },
      origins: { 'otherAssets.stalePriceDays': 'app' },
    });
    const principal = await patch({ 'savings.includeMortgagePrincipal': true });
    expect(Object.keys(principal.body.settings.values)).toEqual([...CASH_PAGE_SETTING_KEYS]);
    expect(principal.body.settings.values['savings.includeMortgagePrincipal']).toBe(true);
  });

  it('a PATCH of the 22 Stage 3–4 editable keys writes them all and answers every slice', async () => {
    const res = await patch(EVERY_KEY);
    expect(res.status).toBe(200);
    // The named-keys rule (stage-5.md §4.5): every page slice holding a named key, plus the named
    // keys themselves; here both are the 22 page keys.
    expect(new Set(Object.keys(res.body.settings.values))).toEqual(new Set(PAGE_KEYS));
    for (const key of PAGE_KEYS) {
      expect(res.body.settings.values[key], key).toEqual(EVERY_KEY[key]);
      expect(res.body.settings.origins[key], key).toBe('app');
    }
    // Workbook keys among them: re-import is blocked.
    expect(res.body.hasAppData).toBe(true);
    expect(JSON.parse(stored('super.concessionalCapFy')!.valueJson)).toBe(2026);
  });
});

describe('the concessional cap override and its FY (§3.3, §4.5 step 7)', () => {
  it('writes the as-of FY with the cap, and null when the cap is cleared; both app-only', async () => {
    const res = await patch({ 'super.concessionalCapCents': 3500000 });
    expect(res.status).toBe(200);
    expect(stored('super.concessionalCapFy')).toMatchObject({ valueJson: '2026', origin: 'app' });
    expect(res.body.hasAppData).toBe(false);
    const page = await call<{ capOverride: unknown }>(ctx.app, {
      method: 'GET',
      url: '/api/super',
    });
    expect(page.body.capOverride).toEqual({ cents: 3500000, financialYear: 2026 });
    await patch({ 'super.concessionalCapCents': null });
    expect(stored('super.concessionalCapFy')!.valueJson).toBe('null');
    const cleared = await call<{ capOverride: unknown }>(ctx.app, {
      method: 'GET',
      url: '/api/super',
    });
    expect(cleared.body.capOverride).toBeNull();
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('a PATCH that does not name the cap leaves its FY alone; the FY key is not editable', async () => {
    await patch({ 'super.concessionalCapCents': 3500000 });
    await patch({ 'super.sgRate': '0.12' });
    expect(stored('super.concessionalCapFy')!.valueJson).toBe('2026');
    const bad = await patch({ 'super.concessionalCapFy': 2025 });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body).code).toBe('VALIDATION_ERROR');
  });

  it('refuses values outside the registry bounds', async () => {
    expect((await patch({ 'otherAssets.stalePriceDays': 0 })).status).toBe(400);
    expect((await patch({ 'otherAssets.stalePriceDays': 3651 })).status).toBe(400);
    expect((await patch({ 'super.sgRate': '1.5' })).status).toBe(400);
    expect(
      (await patch({ 'super.importedContributionType': 'voluntary_contribution' })).status,
    ).toBe(400);
  });
});

describe('the super_option note kind (§4.2, §4.5 step 7)', () => {
  async function putNote(kind: string, month: string, note: string) {
    return call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/period-notes/${kind}/${month}`,
      payload: { note },
    });
  }
  const noteRow = (month: string) =>
    db()
      .select()
      .from(periodNotes)
      .where(and(eq(periodNotes.kind, 'super_option'), eq(periodNotes.periodMonth, month)))
      .get();

  it('is returned (not null) for any month up to the as-of month', async () => {
    const res = await putNote('super_option', '2026-09', 'Moved to high growth');
    expect(res.status).toBe(200);
    expect(res.body.note).toEqual({
      periodMonth: '2026-09',
      kind: 'super_option',
      note: 'Moved to high growth',
      origin: 'app',
      sheetRef: null,
    });
    // A month with no snapshot (not a recorded period) is fine for this kind.
    const old = await putNote('super_option', '2025-01', 'Opened the account');
    expect(old.status).toBe(200);
    const later = await putNote('super_option', '2026-10', 'Too early');
    expect(later.status).toBe(400);
    expect(errorOf(later.body).message).toBe('periodMonth: after this month');
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    const page = await call<{ notes: { periodMonth: string }[] }>(ctx.app, {
      method: 'GET',
      url: '/api/super',
    });
    expect(page.body.notes.map((n) => n.periodMonth)).toEqual(['2026-09', '2026-06', '2025-01']);
  });

  it("'' deletes a workbook note with the marker; spend keeps the recorded-period rule", async () => {
    const res = await putNote('super_option', '2026-06', '');
    expect(res.status).toBe(200);
    expect(res.body.note).toBeNull();
    expect(noteRow('2026-06')).toBeUndefined();
    expect(readAppEditMarker(db())?.count).toBe(1);
    const spend = await putNote('spend', '2026-09', 'Not a recorded period');
    expect(spend.status).toBe(400);
    const other = await putNote('other', '2026-07', 'x');
    expect(other.status).toBe(404);
  });

  it('editing a workbook note makes it app; an unchanged note writes nothing', async () => {
    await putNote('super_option', '2026-06', 'Switched to the balanced option');
    expect(noteRow('2026-06')!.origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    await putNote('super_option', '2026-06', 'Switched to balanced, then growth');
    expect(noteRow('2026-06')).toMatchObject({ origin: 'app', sheetRef: 'Super!F3' });
  });
});
