// Resolving the FIRE inputs (stage-6.md §3.3, §4.5, §7.4 step 1): every field's source order
// (query → setting → derived → default → missing), the app-origin-only rule for the super
// contribution (an import row is `workbookCents`, D105), the market return's `settingKey`, the D98
// `replaced` block, `projectionInputOf` (debts passed through), and the fixtures' recorded
// projection inputs reproduced from their own inputs and derivation. Pure functions; generic values.
import type { FireDerived } from '@joinr/engine';
import type { FireInputsDto } from '@joinr/schema';
import { fireFixtureInputs, firePages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import type { SettingsValues } from '../../src/db/queries/settings';
import {
  isWhatIf,
  projectionInputOf,
  resolveFireInputs,
  savedFireSettings,
} from '../../src/fire/inputs';
import { derivedOf, savedOf } from './helpers';

const MARKER = { from: 65, to: 60, at: '2026-09-01T00:00:00.000Z' };

const resolve = (p: Partial<Parameters<typeof resolveFireInputs>[0]> = {}) =>
  resolveFireInputs({ saved: savedOf(), derived: derivedOf(), query: {}, marker: null, ...p });

describe('savedFireSettings', () => {
  it('reads every FIRE key, with the super contribution’s origin', () => {
    const values = {
      'fire.birthYear': 1985,
      'fire.preservationAge': 62,
      'fire.inflationRate': '0.02',
      'fire.withdrawalRate': '0.035',
      'fire.marketReturn': '0.06',
      'returns.marketReturn': '0.07',
      'returns.cashInterestRate': '0.03',
      'fire.yearlySpendOverrideCents': 5000000,
      'fire.superContributionPerYearCents': 1200000,
      'fire.extraSavingsPerYearCents': -100000,
    } as unknown as SettingsValues;
    const origins = new Map([['fire.superContributionPerYearCents', 'import' as const]]);
    expect(savedFireSettings(values, origins)).toEqual({
      birthYear: 1985,
      accessAge: 62,
      inflationRatio: '0.02',
      withdrawalRatio: '0.035',
      fireMarketReturnRatio: '0.06',
      marketReturnRatio: '0.07',
      cashInterestRatio: '0.03',
      spendOverrideCents: 5000000,
      superContribution: { cents: 1200000, origin: 'import' },
      extraSavingsCents: -100000,
    });
  });

  it('unset keys read null', () => {
    const saved = savedFireSettings({} as SettingsValues, new Map());
    expect(Object.values(saved).every((v) => v === null)).toBe(true);
  });
});

describe('resolveFireInputs (§4.5)', () => {
  it('the saved plan: settings, the derived spend and contribution, the default extra savings', () => {
    expect(resolve()).toEqual({
      birthYear: { value: 1990, source: 'setting', savedValue: 1990 },
      accessAge: { value: 60, source: 'setting', savedValue: 60, replaced: null },
      inflationRate: { ratio: '0.025', source: 'setting', savedRatio: '0.025' },
      withdrawalRate: { ratio: '0.04', source: 'setting', savedRatio: '0.04' },
      marketReturn: {
        ratio: '0.07',
        source: 'setting',
        savedRatio: '0.07',
        settingKey: 'returns.marketReturn',
      },
      cashInterestRate: { ratio: '0.04', source: 'setting', savedRatio: '0.04' },
      yearlySpend: { cents: 2400000, source: 'derived', savedCents: null, derivedCents: 2400000 },
      superContribution: {
        cents: 1300000,
        source: 'derived',
        savedCents: null,
        derivedCents: 1300000,
        workbookCents: null,
      },
      extraSavings: { cents: 0, source: 'default', savedCents: null, derivedCents: null },
    } satisfies FireInputsDto);
  });

  it('a what-if wins over every setting and keeps the saved value beside it', () => {
    const inputs = resolve({
      saved: savedOf({ spendOverrideCents: 3000000, extraSavingsCents: 100000 }),
      query: {
        spend: 4500000,
        withdrawalRate: '0.035',
        inflationRate: '0.03',
        marketReturn: '0.08',
        accessAge: 65,
        extraSavings: -200000,
      },
    });
    expect(inputs.yearlySpend).toEqual({
      cents: 4500000,
      source: 'what_if',
      savedCents: 3000000,
      derivedCents: 2400000,
    });
    expect(inputs.withdrawalRate).toEqual({
      ratio: '0.035',
      source: 'what_if',
      savedRatio: '0.04',
    });
    expect(inputs.inflationRate).toEqual({ ratio: '0.03', source: 'what_if', savedRatio: '0.025' });
    expect(inputs.marketReturn).toEqual({
      ratio: '0.08',
      source: 'what_if',
      savedRatio: '0.07',
      settingKey: 'returns.marketReturn',
    });
    expect(inputs.accessAge).toEqual({
      value: 65,
      source: 'what_if',
      savedValue: 60,
      replaced: null,
    });
    expect(inputs.extraSavings).toEqual({
      cents: -200000,
      source: 'what_if',
      savedCents: 100000,
      derivedCents: null,
    });
    // Fields with no query field never become a what-if.
    expect(inputs.birthYear.source).toBe('setting');
    expect(inputs.cashInterestRate.source).toBe('setting');
    expect(inputs.superContribution.source).toBe('derived');
  });

  it('missing settings fall to the registry default (access age 60) or missing', () => {
    const inputs = resolve({
      saved: savedOf({
        birthYear: null,
        accessAge: null,
        inflationRatio: null,
        withdrawalRatio: null,
        marketReturnRatio: null,
        cashInterestRatio: null,
      }),
    });
    expect(inputs.birthYear).toEqual({ value: null, source: 'missing', savedValue: null });
    expect(inputs.accessAge).toEqual({
      value: 60,
      source: 'default',
      savedValue: null,
      replaced: null,
    });
    expect(inputs.inflationRate).toEqual({ ratio: null, source: 'missing', savedRatio: null });
    expect(inputs.withdrawalRate).toEqual({ ratio: null, source: 'missing', savedRatio: null });
    expect(inputs.marketReturn).toEqual({
      ratio: null,
      source: 'missing',
      savedRatio: null,
      settingKey: 'returns.marketReturn',
    });
    expect(inputs.cashInterestRate).toEqual({ ratio: null, source: 'missing', savedRatio: null });
  });

  it('spend: the override (either origin) wins over the derived figure; no window → missing', () => {
    expect(resolve({ saved: savedOf({ spendOverrideCents: 0 }) }).yearlySpend).toEqual({
      cents: 0,
      source: 'setting',
      savedCents: 0,
      derivedCents: 2400000,
    });
    const noWindow = derivedOf({
      window: null,
      rows: [],
      spend: { yearlyCents: null, flooredPeriods: 0, rawYearlyCents: null },
    });
    expect(resolve({ derived: noWindow }).yearlySpend).toEqual({
      cents: null,
      source: 'missing',
      savedCents: null,
      derivedCents: null,
    });
    expect(
      resolve({ derived: noWindow, saved: savedOf({ spendOverrideCents: 4000000 }) }).yearlySpend,
    ).toEqual({ cents: 4000000, source: 'setting', savedCents: 4000000, derivedCents: null });
  });

  it('super contribution: only an app-origin row overrides; an import row is the workbook’s', () => {
    const imported = resolve({
      saved: savedOf({ superContribution: { cents: 150000, origin: 'import' } }),
    });
    expect(imported.superContribution).toEqual({
      cents: 1300000,
      source: 'derived',
      savedCents: null,
      derivedCents: 1300000,
      workbookCents: 150000,
    });
    const app = resolve({
      saved: savedOf({ superContribution: { cents: 2000000, origin: 'app' } }),
    });
    expect(app.superContribution).toEqual({
      cents: 2000000,
      source: 'setting',
      savedCents: 2000000,
      derivedCents: 1300000,
      workbookCents: null,
    });
    // A zero derived figure is still the derived figure (never missing).
    const none = derivedOf({
      superContribution: { ...derivedOf().superContribution, yearlyCents: 0, sgSource: 'none' },
    });
    expect(resolve({ derived: none }).superContribution).toMatchObject({
      cents: 0,
      source: 'derived',
    });
  });

  it('market return: fire.marketReturn wins over returns.marketReturn (settingKey says which)', () => {
    const fire = resolve({ saved: savedOf({ fireMarketReturnRatio: '0.06' }) });
    expect(fire.marketReturn).toEqual({
      ratio: '0.06',
      source: 'setting',
      savedRatio: '0.06',
      settingKey: 'fire.marketReturn',
    });
    const whatIf = resolve({
      saved: savedOf({ fireMarketReturnRatio: '0.06' }),
      query: { marketReturn: '0.05' },
    });
    expect(whatIf.marketReturn).toEqual({
      ratio: '0.05',
      source: 'what_if',
      savedRatio: '0.06',
      settingKey: 'fire.marketReturn',
    });
    const onlyFire = resolve({
      saved: savedOf({ fireMarketReturnRatio: '0.06', marketReturnRatio: null }),
    });
    expect(onlyFire.marketReturn.settingKey).toBe('fire.marketReturn');
  });

  it('extra savings: the setting (signed) wins over the default 0', () => {
    expect(resolve({ saved: savedOf({ extraSavingsCents: -50000 }) }).extraSavings).toEqual({
      cents: -50000,
      source: 'setting',
      savedCents: -50000,
      derivedCents: null,
    });
  });

  it('the D98 note: present while the stored age is 60, gone after the owner changes it', () => {
    expect(resolve({ marker: MARKER }).accessAge.replaced).toEqual(MARKER);
    expect(
      resolve({ marker: MARKER, saved: savedOf({ accessAge: 58 }) }).accessAge.replaced,
    ).toBeNull();
    // A what-if does not hide the note (it follows the stored value).
    expect(resolve({ marker: MARKER, query: { accessAge: 65 } }).accessAge.replaced).toEqual(
      MARKER,
    );
    expect(resolve({ marker: null }).accessAge.replaced).toBeNull();
  });
});

describe('isWhatIf', () => {
  it('is true when any query field is given', () => {
    expect(isWhatIf({})).toBe(false);
    expect(isWhatIf({ spend: undefined })).toBe(false);
    expect(isWhatIf({ extraSavings: 0 })).toBe(true);
    expect(isWhatIf({ withdrawalRate: '0.04' })).toBe(true);
  });
});

describe('projectionInputOf (§4.5)', () => {
  it('passes the resolved values, the derivation’s figures, the debts and the weights', () => {
    const derived = derivedOf();
    const inputs = resolve({ query: { extraSavings: 50000 } });
    expect(projectionInputOf('2026-09-24', derived, inputs)).toEqual({
      asOf: '2026-09-24',
      birthYear: 1990,
      accessAge: 60,
      inflationRatio: '0.025',
      withdrawalRatio: '0.04',
      preSuperCents: 10000000,
      preSuperDebtCents: 22000000,
      superCents: 50000000,
      savingsPerYearCents: 4740000,
      extraSavingsPerYearCents: 50000,
      superContributionPerYearCents: 1300000,
      yearlySpendCents: 2400000,
      growth: {
        cashWeightCents: 4000000,
        marketWeightCents: 56000000,
        cashInterestRatio: '0.04',
        marketReturnRatio: '0.07',
      },
    });
  });

  it('keeps null savings (no closed period) and null spend for the engine to flag', () => {
    const derived = derivedOf({
      window: null,
      rows: [],
      spend: { yearlyCents: null, flooredPeriods: 0, rawYearlyCents: null },
      savings: { yearlyCents: null, cappedPeriods: 0, superExcludedCents: 0, rawYearlyCents: null },
    });
    const input = projectionInputOf('2026-09-24', derived, resolve({ derived }));
    expect(input.savingsPerYearCents).toBeNull();
    expect(input.yearlySpendCents).toBeNull();
    expect(input.horizonAge).toBeUndefined();
  });

  // The fixtures record each state's projectFire input (§3.6): the server's own mapping of each
  // fixture's inputs and derivation must give exactly that input, so the web states, the fixtures
  // and the server cannot drift apart.
  for (const [state, page] of Object.entries(firePages)) {
    it(`reproduces the recorded input of firePages.${state}`, () => {
      const recorded = fireFixtureInputs[state as keyof typeof firePages];
      expect(
        projectionInputOf(page.asOf, page.derived as FireDerived, page.inputs as FireInputsDto),
      ).toEqual(recorded);
    });
  }
});
