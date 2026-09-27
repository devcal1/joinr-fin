// Resolving the FIRE inputs (stage-6.md §3.3, §4.5): for each field the query's value (a what-if,
// source 'what_if'), else the stored setting ('setting'; for the super contribution only an
// app-origin row, owner question 1 / D105), else the derived figure ('derived': spend, super
// contribution), else the registry default ('default': access age 60, extra savings 0), else null
// ('missing'). The market return reads the query, then `fire.marketReturn`, then
// `returns.marketReturn` (`settingKey` names the saved one); the cash rate is
// `returns.cashInterestRate`. `projectionInputOf` turns the resolved inputs and the derivation into
// `projectFire`'s input. Pure functions of their arguments (unit-tested on hand-built values).
import type { FireDerived, FireProjectionInput } from '@joinr/engine';
import {
  SETTINGS,
  type DecimalString,
  type FireAccessAgeReplacedDto,
  type FireInputsDto,
  type FireQuery,
  type IsoDate,
  type Origin,
  type SettingKey,
} from '@joinr/schema';
import { numberSetting, stringSetting, type SettingsValues } from '../db/queries/settings';
import { accessAgeReplaced } from './upgrade';

/** The FIRE settings as stored (every key read by the FIRE page). */
export interface SavedFireSettings {
  birthYear: number | null;
  accessAge: number | null;
  inflationRatio: DecimalString | null;
  withdrawalRatio: DecimalString | null;
  /** `fire.marketReturn`. */
  fireMarketReturnRatio: DecimalString | null;
  /** `returns.marketReturn` (the Investing group's workbook key; never written by FIRE). */
  marketReturnRatio: DecimalString | null;
  /** `returns.cashInterestRate`. */
  cashInterestRatio: DecimalString | null;
  /** `fire.yearlySpendOverrideCents` (either origin: the workbook's cell is only-when-typed). */
  spendOverrideCents: number | null;
  /** `fire.superContributionPerYearCents` with its origin. */
  superContribution: { cents: number; origin: Origin } | null;
  extraSavingsCents: number | null;
}

/** Reads the FIRE settings from the request context's settings and origins. */
export function savedFireSettings(
  values: SettingsValues,
  origins: ReadonlyMap<string, Origin>,
): SavedFireSettings {
  const contribution = numberSetting(values, 'fire.superContributionPerYearCents');
  const contributionOrigin = origins.get('fire.superContributionPerYearCents');
  return {
    birthYear: numberSetting(values, 'fire.birthYear'),
    accessAge: numberSetting(values, 'fire.preservationAge'),
    inflationRatio: stringSetting(values, 'fire.inflationRate'),
    withdrawalRatio: stringSetting(values, 'fire.withdrawalRate'),
    fireMarketReturnRatio: stringSetting(values, 'fire.marketReturn'),
    marketReturnRatio: stringSetting(values, 'returns.marketReturn'),
    cashInterestRatio: stringSetting(values, 'returns.cashInterestRate'),
    spendOverrideCents: numberSetting(values, 'fire.yearlySpendOverrideCents'),
    superContribution:
      contribution === null || contributionOrigin === undefined
        ? null
        : { cents: contribution, origin: contributionOrigin },
    extraSavingsCents: numberSetting(values, 'fire.extraSavingsPerYearCents'),
  };
}

const REGISTRY_DEFAULTS: ReadonlyMap<SettingKey, unknown> = new Map(
  SETTINGS.map((d) => [d.key, d.defaultValue]),
);

/** The registry default of a numeric key, or null. */
function numberDefault(key: SettingKey): number | null {
  const v = REGISTRY_DEFAULTS.get(key);
  return typeof v === 'number' ? v : null;
}

/** The registry default of a ratio key, or null. */
function ratioDefault(key: SettingKey): DecimalString | null {
  const v = REGISTRY_DEFAULTS.get(key);
  return typeof v === 'string' ? v : null;
}

function integerInput(
  key: SettingKey,
  what: number | undefined,
  saved: number | null,
): FireInputsDto['birthYear'] {
  if (what !== undefined) return { value: what, source: 'what_if', savedValue: saved };
  if (saved !== null) return { value: saved, source: 'setting', savedValue: saved };
  const fallback = numberDefault(key);
  return fallback !== null
    ? { value: fallback, source: 'default', savedValue: null }
    : { value: null, source: 'missing', savedValue: null };
}

function ratioInput(
  key: SettingKey,
  what: DecimalString | undefined,
  saved: DecimalString | null,
): FireInputsDto['inflationRate'] {
  if (what !== undefined) return { ratio: what, source: 'what_if', savedRatio: saved };
  if (saved !== null) return { ratio: saved, source: 'setting', savedRatio: saved };
  const fallback = ratioDefault(key);
  return fallback !== null
    ? { ratio: fallback, source: 'default', savedRatio: null }
    : { ratio: null, source: 'missing', savedRatio: null };
}

/**
 * Every FIRE input with its source (§4.5). `query` is the what-if (every field optional; `{}` gives
 * the saved plan); `marker` is the D98 app_meta marker (null when absent).
 */
export function resolveFireInputs(o: {
  saved: SavedFireSettings;
  derived: FireDerived;
  query: FireQuery;
  marker: FireAccessAgeReplacedDto | null;
}): FireInputsDto {
  const { saved, derived, query } = o;

  const accessAge = integerInput('fire.preservationAge', query.accessAge, saved.accessAge);

  // Market return: the query, then the FIRE key, then the Investing key (§3.3).
  const settingKey =
    saved.fireMarketReturnRatio !== null ? 'fire.marketReturn' : 'returns.marketReturn';
  const savedMarket = saved.fireMarketReturnRatio ?? saved.marketReturnRatio;
  const marketReturn: FireInputsDto['marketReturn'] = {
    ...(query.marketReturn !== undefined
      ? { ratio: query.marketReturn, source: 'what_if' as const, savedRatio: savedMarket }
      : savedMarket !== null
        ? { ratio: savedMarket, source: 'setting' as const, savedRatio: savedMarket }
        : { ratio: null, source: 'missing' as const, savedRatio: null }),
    settingKey,
  };

  // Spend (D97): the query, the override (either origin), the derived figure, else missing.
  const derivedSpend = derived.spend.yearlyCents;
  const savedSpend = saved.spendOverrideCents;
  const yearlySpend: FireInputsDto['yearlySpend'] =
    query.spend !== undefined
      ? {
          cents: query.spend,
          source: 'what_if',
          savedCents: savedSpend,
          derivedCents: derivedSpend,
        }
      : savedSpend !== null
        ? {
            cents: savedSpend,
            source: 'setting',
            savedCents: savedSpend,
            derivedCents: derivedSpend,
          }
        : derivedSpend !== null
          ? { cents: derivedSpend, source: 'derived', savedCents: null, derivedCents: derivedSpend }
          : { cents: null, source: 'missing', savedCents: null, derivedCents: null };

  // Super contribution (D99, owner question 1): only an app-origin row overrides; an import-origin
  // row is the workbook's figure, shown beside the derived one.
  const appContribution =
    saved.superContribution?.origin === 'app' ? saved.superContribution.cents : null;
  const workbookCents =
    saved.superContribution?.origin === 'import' ? saved.superContribution.cents : null;
  const derivedContribution = derived.superContribution.yearlyCents;
  const superContribution: FireInputsDto['superContribution'] =
    appContribution !== null
      ? {
          cents: appContribution,
          source: 'setting',
          savedCents: appContribution,
          derivedCents: derivedContribution,
          workbookCents,
        }
      : {
          cents: derivedContribution,
          source: 'derived',
          savedCents: null,
          derivedCents: derivedContribution,
          workbookCents,
        };

  // Extra savings: the query, the setting, else 0 (the server's default, §3.3).
  const savedExtra = saved.extraSavingsCents;
  const extraSavings: FireInputsDto['extraSavings'] =
    query.extraSavings !== undefined
      ? { cents: query.extraSavings, source: 'what_if', savedCents: savedExtra, derivedCents: null }
      : savedExtra !== null
        ? { cents: savedExtra, source: 'setting', savedCents: savedExtra, derivedCents: null }
        : { cents: 0, source: 'default', savedCents: null, derivedCents: null };

  return {
    birthYear: integerInput('fire.birthYear', undefined, saved.birthYear),
    accessAge: { ...accessAge, replaced: accessAgeReplaced(o.marker, saved.accessAge) },
    inflationRate: ratioInput('fire.inflationRate', query.inflationRate, saved.inflationRatio),
    withdrawalRate: ratioInput('fire.withdrawalRate', query.withdrawalRate, saved.withdrawalRatio),
    marketReturn,
    cashInterestRate: ratioInput('returns.cashInterestRate', undefined, saved.cashInterestRatio),
    yearlySpend,
    superContribution,
    extraSavings,
  };
}

/** Any what-if field given (§4.4 `whatIfActive`). */
export function isWhatIf(query: FireQuery): boolean {
  return Object.values(query).some((v) => v !== undefined);
}

/** `projectFire`'s input from the resolved inputs and the derivation (§4.5). */
export function projectionInputOf(
  asOf: IsoDate,
  derived: FireDerived,
  inputs: FireInputsDto,
): FireProjectionInput {
  return {
    asOf,
    birthYear: inputs.birthYear.value,
    accessAge: inputs.accessAge.value,
    inflationRatio: inputs.inflationRate.ratio,
    withdrawalRatio: inputs.withdrawalRate.ratio,
    preSuperCents: derived.preSuper.preSuperCents,
    preSuperDebtCents: derived.preSuper.debtCents,
    superCents: derived.preSuper.superCents,
    savingsPerYearCents: derived.savings.yearlyCents,
    extraSavingsPerYearCents: inputs.extraSavings.cents ?? 0,
    superContributionPerYearCents: inputs.superContribution.cents ?? 0,
    yearlySpendCents: inputs.yearlySpend.cents,
    growth: {
      cashWeightCents: derived.growth.cashWeightCents,
      marketWeightCents: derived.growth.marketWeightCents,
      cashInterestRatio: inputs.cashInterestRate.ratio,
      marketReturnRatio: inputs.marketReturn.ratio,
    },
  };
}
