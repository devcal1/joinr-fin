// The Settings API for the FIRE group (stage-6.md §3.3, §4.5, §7.4 step 4; D98, D103, D105) with a
// FAKE engine: `SettingDto.notice` (the D98 note while the stored age is still 60; the workbook note
// on an import-origin super contribution; null otherwise), the FIRE group's preference flags and
// readers, the two new keys at their write bounds, and a PATCH of every `fire.*` key leaving
// `hasAppData` false. Generic values only.
import {
  FIRE_EXTRA_SAVINGS_MAX_CENTS,
  SETTING_GROUPS,
  type SettingsPageResponse,
  type SettingsPatchResponse,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { seedFireReplacedAge } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { accessAgeNotice, proseDate, WORKBOOK_CONTRIBUTION_NOTICE } from '../../src/fire/notices';
import { applySettingUpgrades } from '../../src/fire/upgrade';
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

const getPage = (app: FastifyInstance) =>
  call<SettingsPageResponse>(app, { method: 'GET', url: '/api/settings' });
const patch = (app: FastifyInstance, values: Record<string, unknown>) =>
  call<SettingsPatchResponse>(app, { method: 'PATCH', url: '/api/settings', payload: { values } });
const noticeOf = async (app: FastifyInstance, key: string) =>
  (await getPage(app)).body.settings.find((s) => s.key === key)!.notice;

const FIRE_KEYS = SETTING_GROUPS.find((g) => g.id === 'fire')!.keys;

describe('the notices (§3.4, §4.5)', () => {
  it('every notice is null on the seed', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const body = (await getPage(ctx.app)).body;
    expect(body.settings.every((s) => s.notice === null)).toBe(true);
  });

  it('the D98 note on the access age while it is still 60, gone after an edit', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    seedFireReplacedAge(ctx.database.db);
    applySettingUpgrades(ctx.database, NOW);
    const notice = await noticeOf(ctx.app, 'fire.preservationAge');
    expect(notice).toBe(
      'Access age changed from 65 (the workbook) to 60 on 24 September 2026: 60 is the ' +
        'preservation age for anyone born after 30 June 1964; 65 is when super is released ' +
        'unconditionally.',
    );
    expect(notice).toBe(accessAgeNotice({ from: 65, to: 60, at: NOW.toISOString() }));
    // Only that field carries it.
    const withNotice = (await getPage(ctx.app)).body.settings.filter((s) => s.notice !== null);
    expect(withNotice.map((s) => s.key)).toEqual(['fire.preservationAge']);
    await patch(ctx.app, { 'fire.preservationAge': 58 });
    expect(await noticeOf(ctx.app, 'fire.preservationAge')).toBeNull();
    // Set back to 60 on purpose: the marker still exists, so the note shows again.
    await patch(ctx.app, { 'fire.preservationAge': 60 });
    expect(await noticeOf(ctx.app, 'fire.preservationAge')).not.toBeNull();
  });

  it('the workbook note on an import-origin super contribution, gone once it is yours', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    ctx.database.db
      .insert(settings)
      .values({
        key: 'fire.superContributionPerYearCents',
        valueJson: '150000',
        updatedAt: NOW.toISOString(),
        origin: 'import',
      })
      .run();
    expect(await noticeOf(ctx.app, 'fire.superContributionPerYearCents')).toBe(
      WORKBOOK_CONTRIBUTION_NOTICE,
    );
    expect(WORKBOOK_CONTRIBUTION_NOTICE).toBe(
      'From the workbook. The FIRE page uses your super contributions from the last 12 months unless you set a figure here.',
    );
    const res = await call(ctx.app, { method: 'POST', url: '/api/fire/use-workbook-contribution' });
    expect(res.status).toBe(200);
    expect(await noticeOf(ctx.app, 'fire.superContributionPerYearCents')).toBeNull();
  });

  it('prose dates: d MMMM yyyy on the server calendar', () => {
    expect(proseDate(new Date(2026, 8, 27, 12).toISOString())).toBe('27 September 2026');
    expect(proseDate(new Date(2030, 0, 1, 9).toISOString())).toBe('1 January 2030');
    expect(proseDate(new Date(2029, 11, 31, 23, 30).toISOString())).toBe('31 December 2029');
  });
});

describe('the FIRE group (§3.3, D103)', () => {
  it('eight preference keys, never workbook keys, read by FIRE', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const body = (await getPage(ctx.app)).body;
    expect(body.groups.find((g) => g.id === 'fire')).toMatchObject({ label: 'FIRE' });
    expect(FIRE_KEYS).toHaveLength(8);
    for (const key of FIRE_KEYS) {
      expect(
        body.settings.find((s) => s.key === key),
        key,
      ).toMatchObject({
        group: 'fire',
        preference: true,
        workbook: false,
        editable: true,
        usedOn: ['fire'],
      });
    }
    expect(body.settings.find((s) => s.key === 'fire.preservationAge')).toMatchObject({
      defaultValue: 60,
    });
  });

  it('the two new keys at their write bounds (and one step past)', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    for (const values of [
      { 'fire.marketReturn': '-1' },
      { 'fire.marketReturn': '1' },
      { 'fire.marketReturn': null },
      { 'fire.extraSavingsPerYearCents': FIRE_EXTRA_SAVINGS_MAX_CENTS },
      { 'fire.extraSavingsPerYearCents': -FIRE_EXTRA_SAVINGS_MAX_CENTS },
      { 'fire.extraSavingsPerYearCents': 0 },
      { 'fire.extraSavingsPerYearCents': null },
    ]) {
      const res = await patch(ctx.app, values);
      expect(res.status, JSON.stringify(values)).toBe(200);
    }
    for (const values of [
      { 'fire.marketReturn': '-1.01' },
      { 'fire.marketReturn': '1.01' },
      { 'fire.extraSavingsPerYearCents': FIRE_EXTRA_SAVINGS_MAX_CENTS + 1 },
      { 'fire.extraSavingsPerYearCents': -FIRE_EXTRA_SAVINGS_MAX_CENTS - 1 },
      { 'fire.extraSavingsPerYearCents': 1.5 },
    ]) {
      const res = await patch(ctx.app, values);
      expect(res.status, JSON.stringify(values)).toBe(400);
      expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    }
  });

  it('a PATCH of every fire.* key leaves hasAppData false (D103)', async () => {
    ctx = await startApp({ engine: historyFakeEngine() });
    const res = await patch(ctx.app, {
      'fire.birthYear': 1985,
      'fire.preservationAge': 62,
      'fire.inflationRate': '0.03',
      'fire.withdrawalRate': '0.035',
      'fire.yearlySpendOverrideCents': 4000000,
      'fire.superContributionPerYearCents': 1500000,
      'fire.marketReturn': '0.065',
      'fire.extraSavingsPerYearCents': -250000,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.settings.values).sort()).toEqual([...FIRE_KEYS].sort());
    for (const key of FIRE_KEYS) expect(res.body.settings.origins[key], key).toBe('app');
    expect(res.body.hasAppData).toBe(false);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});
