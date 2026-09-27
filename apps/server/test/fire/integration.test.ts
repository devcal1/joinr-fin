// Integration with the REAL engine (stage-6.md §7.4 step 6), gated on FIRE_ENGINE_IMPLEMENTED (and
// the Stage 2–5 flags), each with a fixed `now`: the generic seed reaches `on_track`; the synthetic
// workbook (access age 60, the FIRE page switched off) builds a full response with the workbook's
// super contribution beside the derived one; a what-if changes the projection and saves nothing
// (the settings table unchanged); a PATCH then a GET shows the saved plan. Generic values only.
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  engine,
  ENGINE_IMPLEMENTED,
  FIRE_ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  IMPORTER_STAGE4_IMPLEMENTED,
  IMPORTER_STAGE5_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import type { FirePageResponse, SettingsPatchResponse } from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { expectRowsAddUp, NOW, startApp, type TestApp } from './helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED &&
  FIRE_ENGINE_IMPLEMENTED;
const CAN_IMPORT =
  SYNTHETIC_WORKBOOK_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED &&
  IMPORTER_STAGE5_IMPLEMENTED;

const get = async (app: FastifyInstance, url: string) => {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json<FirePageResponse>();
};
const dump = (database: AppDatabase) =>
  JSON.stringify(database.db.select().from(settings).orderBy(asc(settings.key)).all());

describe.skipIf(!GATED)('the FIRE API with the real engine (seed)', { timeout: 60_000 }, () => {
  let ctx: TestApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('the generic seed reaches on_track at a fixed now', async () => {
    ctx = await startApp({ engine, now: () => NOW });
    const page = await get(ctx.app, '/api/fire');
    expect(page.asOf).toBe('2026-09-24');
    expect(page.isEmpty).toBe(false);
    expect(page.whatIfActive).toBe(false);
    expect(page.baseline).toBeNull();
    expect(page.projection.status).toBe('on_track');
    expect(page.projection.fire).not.toBeNull();
    expect(page.projection.fire!.year).toBeGreaterThan(2026);
    expect(page.projection.ageNow).toBe(36);
    expect(page.inputs.accessAge).toMatchObject({ value: 60, source: 'setting', replaced: null });
    expect(page.projection.rows.length).toBeGreaterThan(0);
    expectRowsAddUp(page.projection.rows);
    // The milestones in time order.
    const ts = page.projection.milestones.map((m) => m.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('a what-if changes the projection and saves nothing', async () => {
    ctx = await startApp({ engine, now: () => NOW });
    const saved = await get(ctx.app, '/api/fire');
    const before = dump(ctx.database);
    const spend = (saved.inputs.yearlySpend.cents ?? 0) * 2 + 1000000;
    const whatIf = await get(ctx.app, `/api/fire?spend=${spend}&withdrawalRate=0.035`);
    expect(whatIf.whatIfActive).toBe(true);
    expect(whatIf.inputs.yearlySpend).toMatchObject({ cents: spend, source: 'what_if' });
    expect(whatIf.projection.target?.superAtAccessCents).not.toBe(
      saved.projection.target?.superAtAccessCents,
    );
    expect(whatIf.baseline).toEqual({
      status: saved.projection.status,
      fireYear: saved.projection.fire?.year ?? null,
      yearsToGo: saved.projection.fire?.yearsToGo ?? null,
      fireAge: saved.projection.fire?.age ?? null,
      afterAccess: saved.projection.fire?.afterAccess ?? null,
      neededAtFireCents: saved.projection.preSuper.neededAtFireCents,
      superNeededAtAccessCents: saved.projection.super.neededAtAccessCents,
      superProjectedAtAccessCents: saved.projection.super.projectedAtAccessCents,
      yearlySpendCents: saved.inputs.yearlySpend.cents,
    });
    expect(dump(ctx.database)).toBe(before);
    expect(await get(ctx.app, '/api/fire')).toEqual(saved);
  });

  it('PATCH then GET shows the saved plan; hasAppData stays false (D103)', async () => {
    ctx = await startApp({ engine, now: () => NOW });
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        values: {
          'fire.yearlySpendOverrideCents': 5000000,
          'fire.extraSavingsPerYearCents': 500000,
          'fire.marketReturn': '0.065',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<SettingsPatchResponse>().hasAppData).toBe(false);
    const page = await get(ctx.app, '/api/fire');
    expect(page.inputs.yearlySpend).toMatchObject({ cents: 5000000, source: 'setting' });
    expect(page.inputs.extraSavings).toMatchObject({ cents: 500000, source: 'setting' });
    expect(page.inputs.marketReturn).toMatchObject({
      ratio: '0.065',
      settingKey: 'fire.marketReturn',
    });
    expect(page.projection.target?.superAtAccessCents).toBe(
      Math.round(5000000 / Number(page.inputs.withdrawalRate.ratio)),
    );
    expect(page.hasAppData).toBe(false);
    expectRowsAddUp(page.projection.rows);
  });

  const patchSettings = (app: FastifyInstance, values: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/settings', payload: { values } });

  it('extreme rates over a long horizon answer needs_input, never 500 (triage SPEC-1)', async () => {
    ctx = await startApp({ engine, now: () => NOW });
    const whatIf = await get(ctx.app, '/api/fire?marketReturn=-0.9');
    expect(whatIf.projection.status).toBe('needs_input');
    expect(whatIf.projection.missing).toEqual(['rates']);
    expect(whatIf.projection.rows).toEqual([]);
    const tinyWr = await get(ctx.app, '/api/fire?withdrawalRate=0.0000000001');
    expect(tinyWr.projection.status).toBe('needs_input');
    expect(tinyWr.projection.missing).toEqual(['withdrawalRate']);
    // Saved: the page keeps loading (and the saved extreme stays recoverable).
    expect((await patchSettings(ctx.app, { 'fire.inflationRate': '-0.9' })).statusCode).toBe(200);
    const saved = await get(ctx.app, '/api/fire');
    expect(saved.projection.status).toBe('needs_input');
    expect(saved.projection.missing).toEqual(['rates']);
  });

  it('an extreme rate pair answers needs_input, saved or as a what-if (triage CODE-1)', async () => {
    ctx = await startApp({ engine, now: () => NOW });
    const whatIf = await get(ctx.app, '/api/fire?inflationRate=-0.99&marketReturn=1');
    expect(whatIf.projection.status).toBe('needs_input');
    expect(whatIf.projection.missing).toContain('rates');
    const res = await patchSettings(ctx.app, {
      'fire.inflationRate': '-0.99',
      'fire.marketReturn': '1',
    });
    expect(res.statusCode).toBe(200);
    expect((await get(ctx.app, '/api/fire')).projection.status).toBe('needs_input');
    expect((await get(ctx.app, '/api/fire?spend=1000000')).projection.status).toBe('needs_input');
  });
});

describe.skipIf(!GATED || !CAN_IMPORT)(
  'the FIRE API with the real engine (synthetic workbook)',
  { timeout: 60_000 },
  () => {
    let tempDir: string | undefined;
    let app: FastifyInstance | undefined;
    afterEach(async () => {
      await app?.close();
      if (tempDir) await removeDir(tempDir);
      app = undefined;
      tempDir = undefined;
    });

    it('builds a full response (access age 60, the page switched off)', async () => {
      tempDir = await makeTempDir();
      const config = testConfig(join(tempDir, 'data'));
      const database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      app = await buildApp({ config, db: database, now: () => NOW });
      const upload = await app.inject({
        method: 'POST',
        url: '/api/import',
        payload: Buffer.from(buildSyntheticWorkbook()),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(upload.statusCode).toBe(201);
      const page = await get(app, '/api/fire');
      expect(page.featureOn).toBe(false);
      expect(page.hasAppData).toBe(false);
      expect(page.isEmpty).toBe(false);
      expect(page.inputs.accessAge).toMatchObject({ value: 60, replaced: null });
      expect(page.inputs.birthYear).toMatchObject({ value: 1990, source: 'setting' });
      // The workbook's typed super contribution is shown beside the derived one (D105).
      expect(page.inputs.superContribution).toMatchObject({
        source: 'derived',
        savedCents: null,
        workbookCents: 200000,
      });
      expect(page.inputs.superContribution.cents).toBe(page.derived.superContribution.yearlyCents);
      // The workbook's spend is the template formula: no override is stored.
      expect(page.inputs.yearlySpend.savedCents).toBeNull();
      expect(page.projection.status).not.toBe('needs_input');
      expectRowsAddUp(page.projection.rows);
    });
  },
);
