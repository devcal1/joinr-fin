// `GET /api/fire` with a FAKE engine (stage-6.md §4.2–4.5, §7.4 steps 1–2): the DTO mapping field by
// field against hand-built engine results (nothing extra leaks), one projection for the saved plan
// and a second for the baseline while a what-if is active (every FireSummaryDto field), the query
// passed to the engine (normalised ratios), 400s for every query bound, `featureOn`, `hasAppData`,
// `isEmpty`, the D98 `replaced` block, and nothing saved by a what-if. Generic values only.
import type { FireDerived, FireProjection, FireProjectionInput } from '@joinr/engine';
import {
  CASHFLOW_MONEY_MAX,
  FIRE_EXTRA_SAVINGS_MAX_CENTS,
  type FirePageResponse,
  type SettingsPatchResponse,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { seedFireReplacedAge } from '@joinr/schema/testing';
import { asc } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { applySettingUpgrades } from '../../src/fire/upgrade';
import {
  fireDerivedDto,
  fireProjectionDto,
  fireSummaryDto,
  isFireEmpty,
} from '../../src/fire/page';
import {
  call,
  derivedOf,
  errorOf,
  fireFakeEngine,
  hasAppDataOf,
  NOW,
  projectionOf,
  startApp,
  type TestApp,
} from './helpers';

let ctx: TestApp | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const getFire = (t: TestApp, query = '') =>
  call<FirePageResponse>(t.app, { method: 'GET', url: `/api/fire${query}` });
const patch = (t: TestApp, values: Record<string, unknown>) =>
  call<SettingsPatchResponse>(t.app, {
    method: 'PATCH',
    url: '/api/settings',
    payload: { values },
  });
const projectCalls = (t: { engine: ReturnType<typeof fireFakeEngine> }) =>
  t.engine.calls.projectFire.map((c) => c[0] as FireProjectionInput);
const settingsDump = (t: TestApp) =>
  JSON.stringify(t.database.db.select().from(settings).orderBy(asc(settings.key)).all());

describe('the DTO mappers (§4.4, field by field)', () => {
  it('copy every field of the engine results and nothing else', () => {
    const extra = { unexpected: 1 };
    const derived = derivedOf();
    const leaky = {
      ...derived,
      ...extra,
      preSuper: { ...derived.preSuper, ...extra },
      rows: derived.rows.map((r) => ({ ...r, ...extra })),
      growth: {
        ...derived.growth,
        ...extra,
        weights: derived.growth.weights.map((w) => ({ ...w, ...extra })),
      },
    } as FireDerived;
    expect(fireDerivedDto(leaky)).toEqual(derived);
    const projection = projectionOf();
    const leakyProjection = {
      ...projection,
      ...extra,
      rows: projection.rows.map((r) => ({
        ...r,
        ...extra,
        preSuper: { ...r.preSuper, ...extra },
        super: { ...r.super, ...extra },
      })),
      milestones: projection.milestones.map((m) => ({ ...m, ...extra })),
      fire: { ...projection.fire!, ...extra },
      topUps: { ...projection.topUps!, ...extra },
    } as FireProjection;
    expect(fireProjectionDto(leakyProjection)).toEqual(projection);
  });

  it('keep the nulls of a needs_input projection', () => {
    const p = projectionOf({
      status: 'needs_input',
      missing: ['birthYear', 'withdrawalRate'],
      ageNow: null,
      accessYear: null,
      yearsToAccess: null,
      rates: null,
      target: null,
      fire: null,
      topUps: null,
      milestones: [],
      rows: [],
    });
    expect(fireProjectionDto(p)).toEqual(p);
  });

  it('the summary reads the FIRE year, age, needs and the spend', () => {
    expect(fireSummaryDto(projectionOf(), 2400000)).toEqual({
      status: 'on_track',
      fireYear: 2035,
      yearsToGo: 9,
      fireAge: 45,
      afterAccess: false,
      neededAtFireCents: 52000000,
      superNeededAtAccessCents: 60000000,
      superProjectedAtAccessCents: 61000000,
      yearlySpendCents: 2400000,
    });
    expect(
      fireSummaryDto(projectionOf({ status: 'not_reachable', fire: null, topUps: null }), null),
    ).toMatchObject({
      status: 'not_reachable',
      fireYear: null,
      yearsToGo: null,
      fireAge: null,
      afterAccess: null,
      yearlySpendCents: null,
    });
  });

  it('isEmpty: net worth 0, super 0 and no closed period', () => {
    const empty = derivedOf({
      preSuper: { ...derivedOf().preSuper, netWorthCents: 0, superCents: 0 },
      window: null,
    });
    expect(isFireEmpty(empty)).toBe(true);
    expect(isFireEmpty({ ...empty, window: derivedOf().window })).toBe(false);
    expect(isFireEmpty({ ...empty, preSuper: { ...empty.preSuper, superCents: 1 } })).toBe(false);
    expect(isFireEmpty({ ...empty, preSuper: { ...empty.preSuper, netWorthCents: -1 } })).toBe(
      false,
    );
  });
});

describe('GET /api/fire (§4.2, §4.5)', () => {
  it('answers the saved plan: inputs, derivation and projection, no baseline', async () => {
    const engine = fireFakeEngine();
    ctx = await startApp({ engine });
    const res = await getFire(ctx);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    expect(body.asOf).toBe('2026-09-24');
    expect(body.whatIfActive).toBe(false);
    expect(body.baseline).toBeNull();
    expect(body.isEmpty).toBe(false);
    expect(body.featureOn).toBe(true);
    expect(body.hasAppData).toBe(false);
    expect(body.derived).toEqual(derivedOf());
    expect(body.projection).toEqual(projectionOf());
    // The seed's settings (import origin) and the derived figures.
    expect(body.inputs).toMatchObject({
      birthYear: { value: 1990, source: 'setting' },
      accessAge: { value: 60, source: 'setting', replaced: null },
      inflationRate: { ratio: '0.025', source: 'setting' },
      withdrawalRate: { ratio: '0.04', source: 'setting' },
      marketReturn: { ratio: '0.07', source: 'setting', settingKey: 'returns.marketReturn' },
      cashInterestRate: { ratio: '0.04', source: 'setting' },
      yearlySpend: { cents: 2400000, source: 'derived' },
      superContribution: { cents: 1300000, source: 'derived', workbookCents: null },
      extraSavings: { cents: 0, source: 'default' },
    });
    // One derivation (the request context's) and one projection, on the resolved inputs.
    expect(engine.calls.deriveFireInputs).toHaveLength(1);
    expect(projectCalls({ engine })).toEqual([
      {
        asOf: '2026-09-24',
        birthYear: 1990,
        accessAge: 60,
        inflationRatio: '0.025',
        withdrawalRatio: '0.04',
        preSuperCents: 10000000,
        preSuperDebtCents: 22000000,
        superCents: 50000000,
        savingsPerYearCents: 4740000,
        extraSavingsPerYearCents: 0,
        superContributionPerYearCents: 1300000,
        yearlySpendCents: 2400000,
        growth: {
          cashWeightCents: 4000000,
          marketWeightCents: 56000000,
          cashInterestRatio: '0.04',
          marketReturnRatio: '0.07',
        },
      },
    ]);
  });

  it('the derivation reads the request context’s results (one derivation per request)', async () => {
    const base = fireFakeEngine();
    const seen: Record<string, unknown> = {};
    const tap =
      <
        K extends
          | 'composeSnapshot'
          | 'netWorthDashboard'
          | 'computeProperty'
          | 'computeSavings'
          | 'cashKpis'
          | 'computeSuper',
      >(
        k: K,
      ) =>
      (input: never) => {
        const out = (base[k] as (i: never) => unknown)(input);
        seen[k] = out;
        return out;
      };
    const engine = fireFakeEngine({
      composeSnapshot: tap('composeSnapshot'),
      netWorthDashboard: tap('netWorthDashboard'),
      computeProperty: tap('computeProperty'),
      computeSavings: tap('computeSavings'),
      cashKpis: tap('cashKpis'),
      computeSuper: tap('computeSuper'),
    } as never);
    ctx = await startApp({ engine });
    expect((await getFire(ctx)).status).toBe(200);
    expect(engine.calls.deriveFireInputs).toHaveLength(1);
    const input = engine.calls.deriveFireInputs[0]![0] as Parameters<
      typeof engine.deriveFireInputs
    >[0];
    const netWorth = seen.netWorthDashboard as ReturnType<typeof engine.netWorthDashboard>;
    const savings = seen.computeSavings as ReturnType<typeof engine.computeSavings>;
    expect(input.asOf).toBe('2026-09-24');
    // The live position: the snapshot composed at asOf (the seed's month is not recorded today).
    expect(input.figures).toBe(seen.composeSnapshot);
    expect(input.classes).toBe(netWorth.classes);
    expect(input.liabilities).toBe(netWorth.liabilities);
    expect(input.property).toBe(seen.computeProperty);
    expect(input.savings).toBe(savings.periods);
    expect(input.kpis).toBe(seen.cashKpis);
    expect(input.superResult).toBe(seen.computeSuper);
  });

  it('a what-if: the query in the projection, the saved plan in the baseline, nothing saved', async () => {
    // The fake answers a what-if (spend 5,000,000) with a later FIRE year than the saved plan.
    const whatIfProjection = projectionOf({
      fire: { yearsToGo: 12, year: 2038, age: 48, afterAccess: false, bridgeYears: 12 },
    });
    const engine = fireFakeEngine({
      projectFire: (input) =>
        input.yearlySpendCents === 5000000 ? whatIfProjection : projectionOf(),
    });
    ctx = await startApp({ engine });
    const before = settingsDump(ctx);
    const res = await getFire(
      ctx,
      '?spend=5000000&withdrawalRate=0.0350&inflationRate=0.03&marketReturn=.08&accessAge=65&extraSavings=-100000',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.whatIfActive).toBe(true);
    expect(res.body.projection).toEqual(whatIfProjection);
    expect(res.body.baseline).toEqual(fireSummaryDto(projectionOf(), 2400000));
    const [whatIf, saved] = projectCalls({ engine });
    expect(whatIf).toMatchObject({
      yearlySpendCents: 5000000,
      withdrawalRatio: '0.035',
      inflationRatio: '0.03',
      accessAge: 65,
      extraSavingsPerYearCents: -100000,
      growth: { marketReturnRatio: '0.08' },
    });
    expect(saved).toMatchObject({
      yearlySpendCents: 2400000,
      withdrawalRatio: '0.04',
      inflationRatio: '0.025',
      accessAge: 60,
      extraSavingsPerYearCents: 0,
      growth: { marketReturnRatio: '0.07' },
    });
    expect(projectCalls({ engine })).toHaveLength(2);
    expect(res.body.inputs.yearlySpend).toEqual({
      cents: 5000000,
      source: 'what_if',
      savedCents: null,
      derivedCents: 2400000,
    });
    expect(settingsDump(ctx)).toBe(before);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('a single what-if field is a what-if (extraSavings=0 included)', async () => {
    const engine = fireFakeEngine();
    ctx = await startApp({ engine });
    const res = await getFire(ctx, '?extraSavings=0');
    expect(res.body.whatIfActive).toBe(true);
    expect(res.body.baseline).not.toBeNull();
    expect(res.body.inputs.extraSavings.source).toBe('what_if');
  });

  it.each([
    ['spend=-1', 'spend'],
    ['spend=1.5', 'spend'],
    [`spend=${CASHFLOW_MONEY_MAX + 1}`, 'spend'],
    ['spend=abc', 'spend'],
    ['spend=', 'spend'],
    ['spend=%20', 'spend'],
    ['spend=0x10', 'spend'],
    ['spend=1e5', 'spend'],
    ['spend=%2B5', 'spend'],
    ['extraSavings=', 'extraSavings'],
    ['accessAge=', 'accessAge'],
    ['withdrawalRate=0', 'withdrawalRate'],
    ['withdrawalRate=-0.01', 'withdrawalRate'],
    ['withdrawalRate=1.01', 'withdrawalRate'],
    ['withdrawalRate=4%25', 'withdrawalRate'],
    ['withdrawalRate=1e-2', 'withdrawalRate'],
    ['inflationRate=-1', 'inflationRate'],
    ['inflationRate=1.5', 'inflationRate'],
    ['marketReturn=-1', 'marketReturn'],
    ['marketReturn=1.01', 'marketReturn'],
    ['accessAge=29', 'accessAge'],
    ['accessAge=100', 'accessAge'],
    ['accessAge=60.5', 'accessAge'],
    [`extraSavings=${FIRE_EXTRA_SAVINGS_MAX_CENTS + 1}`, 'extraSavings'],
    [`extraSavings=${-FIRE_EXTRA_SAVINGS_MAX_CENTS - 1}`, 'extraSavings'],
    ['extraSavings=1.5', 'extraSavings'],
    ['birthYear=1990', ''],
    ['foo=1', ''],
  ])('400 for %s', async (query, field) => {
    const engine = fireFakeEngine();
    ctx = await startApp({ engine });
    const res = await getFire(ctx, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    if (field !== '') expect(errorOf(res.body).message).toContain(field);
    expect(engine.calls.projectFire).toHaveLength(0);
  });

  it('accepts every query bound', async () => {
    const engine = fireFakeEngine();
    ctx = await startApp({ engine });
    for (const query of [
      'spend=0',
      `spend=${CASHFLOW_MONEY_MAX}`,
      'withdrawalRate=1',
      'withdrawalRate=0.0001',
      'inflationRate=-0.99',
      'inflationRate=1',
      'marketReturn=-0.5',
      'marketReturn=1',
      'accessAge=30',
      'accessAge=99',
      `extraSavings=${FIRE_EXTRA_SAVINGS_MAX_CENTS}`,
      `extraSavings=${-FIRE_EXTRA_SAVINGS_MAX_CENTS}`,
    ]) {
      expect((await getFire(ctx, `?${query}`)).status, query).toBe(200);
    }
  });

  it('features.fire false keeps the API answering (featureOn false)', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    expect((await patch(ctx, { 'features.fire': false })).status).toBe(200);
    const res = await getFire(ctx);
    expect(res.status).toBe(200);
    expect(res.body.featureOn).toBe(false);
    expect(res.body.projection.status).toBe('on_track');
    expect((await patch(ctx, { 'features.fire': true })).status).toBe(200);
    expect((await getFire(ctx)).body.featureOn).toBe(true);
  });

  it('hasAppData follows D34 (a workbook key edited in the app)', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    expect((await getFire(ctx)).body.hasAppData).toBe(false);
    await patch(ctx, { 'pay.netPayCents': 310000 });
    expect((await getFire(ctx)).body.hasAppData).toBe(true);
  });

  it('isEmpty on an empty derivation', async () => {
    const empty = derivedOf({
      preSuper: { ...derivedOf().preSuper, netWorthCents: 0, superCents: 0 },
      window: null,
      rows: [],
    });
    ctx = await startApp({ engine: fireFakeEngine({ derived: empty }), seed: false });
    const res = await getFire(ctx);
    expect(res.status).toBe(200);
    expect(res.body.isEmpty).toBe(true);
    // No settings at all: the access age reads its registry default.
    expect(res.body.inputs.accessAge).toMatchObject({ value: 60, source: 'default' });
    expect(res.body.inputs.birthYear).toMatchObject({ value: null, source: 'missing' });
  });

  it('the D98 note while the stored age is still 60, gone after an edit', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    seedFireReplacedAge(ctx.database.db);
    expect(applySettingUpgrades(ctx.database, NOW)).toHaveLength(1);
    const res = await getFire(ctx);
    expect(res.body.inputs.accessAge).toEqual({
      value: 60,
      source: 'setting',
      savedValue: 60,
      replaced: { from: 65, to: 60, at: NOW.toISOString() },
    });
    expect(res.body.hasAppData).toBe(false);
    await patch(ctx, { 'fire.preservationAge': 62 });
    const after = await getFire(ctx);
    expect(after.body.inputs.accessAge).toEqual({
      value: 62,
      source: 'setting',
      savedValue: 62,
      replaced: null,
    });
    // A preference key (D103): still no app data.
    expect(after.body.hasAppData).toBe(false);
  });

  it('PATCH bounds the access age below the horizon: 99 saves, 100 is a 400 (triage SPEC-2)', async () => {
    ctx = await startApp({ engine: fireFakeEngine() });
    expect((await patch(ctx, { 'fire.preservationAge': 99 })).status).toBe(200);
    const res = await patch(ctx, { 'fire.preservationAge': 100 });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(res.body).message).toContain('fire.preservationAge');
  });

  it('PATCH then GET shows the saved plan (the FIRE page’s Save)', async () => {
    const engine = fireFakeEngine();
    ctx = await startApp({ engine });
    const res = await patch(ctx, {
      'fire.yearlySpendOverrideCents': 4500000,
      'fire.marketReturn': '0.065',
      'fire.extraSavingsPerYearCents': 500000,
      'fire.withdrawalRate': '0.035',
    });
    expect(res.status).toBe(200);
    expect(res.body.hasAppData).toBe(false);
    const page = await getFire(ctx);
    expect(page.body.inputs).toMatchObject({
      yearlySpend: {
        cents: 4500000,
        source: 'setting',
        savedCents: 4500000,
        derivedCents: 2400000,
      },
      marketReturn: { ratio: '0.065', source: 'setting', settingKey: 'fire.marketReturn' },
      extraSavings: { cents: 500000, source: 'setting', savedCents: 500000 },
      withdrawalRate: { ratio: '0.035', source: 'setting' },
    });
    expect(projectCalls({ engine }).at(-1)).toMatchObject({
      yearlySpendCents: 4500000,
      extraSavingsPerYearCents: 500000,
      withdrawalRatio: '0.035',
      growth: { marketReturnRatio: '0.065' },
    });
    // "Use the derived figure": PATCH the override to null.
    await patch(ctx, { 'fire.yearlySpendOverrideCents': null });
    expect((await getFire(ctx)).body.inputs.yearlySpend).toMatchObject({
      cents: 2400000,
      source: 'derived',
    });
  });
});
