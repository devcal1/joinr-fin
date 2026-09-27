// FIRE API (stage-6.md §4.3–4.4, frozen): the `GET /api/fire` query schema (a what-if that is never
// saved, D100) and the response DTOs. Money is integer cents; ratios are decimal strings; dates
// IsoDate, months IsoMonth. Every DTO is declared field by field here (`@joinr/schema` cannot import
// the engine's types; the server type-checks the mapping: FireDerived, FirePeriodRow, FireRow and
// FireProjection are assignable to their DTOs). `POST /api/fire/use-workbook-contribution` answers
// `SettingsPatchResponse` (dto/cashflow.ts).
import { z } from 'zod';
import { compareDecimals, normaliseDecimal } from '../decimal';
import {
  FIRE_EXTRA_SAVINGS_MAX_CENTS,
  FIRE_HORIZON_AGE,
  type FireGrowthWeightKey,
  type FireInputSource,
  type FireMilestoneKind,
  type FireMissingInput,
  type FirePhase,
  type FireStatus,
} from '../fire';
import type { DecimalString, IsoDate, IsoMonth } from '../primitives';
import { CASHFLOW_MONEY_MAX } from './cashflow';

// ─── Query (§4.3) ───────────────────────────────────────────────────────────────────────────────

const PLAIN_SIGNED_DECIMAL_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A ratio in a query string (`'0.04'`, `'-0.01'`, `'.5'`): a plain decimal (no exponent, at most 30
 * characters), normalised (`'0.040'` → `'0.04'`), within the bounds: above `gt` (`must be above
 * 0`), at least `min` (`must be at least -1`), at most `max` (`must be at most 1`).
 */
export function ratioQuery(bounds: { gt?: number; min?: number; max?: number }) {
  return z
    .string()
    .trim()
    .max(30, { error: 'is too long' })
    .regex(PLAIN_SIGNED_DECIMAL_RE, { error: 'must be a plain decimal number such as 0.04' })
    .transform((v) => normaliseDecimal(v))
    .superRefine((v, ctx) => {
      if (bounds.gt !== undefined && compareDecimals(v, String(bounds.gt)) <= 0) {
        ctx.addIssue({ code: 'custom', message: `must be above ${bounds.gt}` });
      }
      if (bounds.min !== undefined && compareDecimals(v, String(bounds.min)) < 0) {
        ctx.addIssue({ code: 'custom', message: `must be at least ${bounds.min}` });
      }
      if (bounds.max !== undefined && compareDecimals(v, String(bounds.max)) > 0) {
        ctx.addIssue({ code: 'custom', message: `must be at most ${bounds.max}` });
      }
    });
}

/**
 * A whole number in a query string, or a JS integer (the web's what-if query objects hold numbers):
 * a string must be plain digits with an optional leading minus (no blank, hex, exponent or plus
 * sign; `z.coerce` accepted all of those, triage CODE-2), then within [min, max].
 */
export function intQuery(min: number, max: number) {
  return z
    .union([
      z.number(),
      z
        .string()
        .trim()
        .max(20, { error: 'is too long' })
        .regex(/^-?\d+$/, { error: 'must be a whole number' })
        .transform(Number),
    ])
    .pipe(z.number().int().min(min).max(max));
}

/**
 * The what-if access age's range (the query; the setting keeps its registry 0–120). The maximum is
 * one below the horizon: the engine needs the access age before it (triage SPEC-2).
 */
export const FIRE_QUERY_ACCESS_AGE_MIN = 30;
export const FIRE_QUERY_ACCESS_AGE_MAX = FIRE_HORIZON_AGE - 1;

/**
 * `GET /api/fire` query: every field optional; any field given makes a what-if (`whatIfActive`),
 * which is never saved (D100). Integers are strict whole numbers (`intQuery`).
 */
export const fireQuerySchema = z.strictObject({
  /** Cents a year. */
  spend: intQuery(0, CASHFLOW_MONEY_MAX).optional(),
  withdrawalRate: ratioQuery({ gt: 0, max: 1 }).optional(),
  inflationRate: ratioQuery({ gt: -1, max: 1 }).optional(),
  marketReturn: ratioQuery({ gt: -1, max: 1 }).optional(),
  accessAge: intQuery(FIRE_QUERY_ACCESS_AGE_MIN, FIRE_QUERY_ACCESS_AGE_MAX).optional(),
  /** Cents a year, signed. */
  extraSavings: intQuery(-FIRE_EXTRA_SAVINGS_MAX_CENTS, FIRE_EXTRA_SAVINGS_MAX_CENTS).optional(),
});
export type FireQuery = z.infer<typeof fireQuerySchema>;

// ─── Inputs (§4.4, §4.5) ────────────────────────────────────────────────────────────────────────

export interface FireMoneyInputDto {
  /** The value in use. */
  cents: number | null;
  source: FireInputSource;
  /** The stored setting. */
  savedCents: number | null;
  /** The derived figure (§2.4); null if none. */
  derivedCents: number | null;
}

export interface FireRatioInputDto {
  ratio: DecimalString | null;
  source: FireInputSource;
  savedRatio: DecimalString | null;
}

export interface FireIntegerInputDto {
  value: number | null;
  source: FireInputSource;
  savedValue: number | null;
}

export interface FireAccessAgeReplacedDto {
  from: number;
  to: number;
  /** The marker's UTC timestamp. */
  at: string;
}

export interface FireInputsDto {
  birthYear: FireIntegerInputDto;
  /** `replaced`: the D98 note, while the stored value is still `to`. */
  accessAge: FireIntegerInputDto & { replaced: FireAccessAgeReplacedDto | null };
  inflationRate: FireRatioInputDto;
  withdrawalRate: FireRatioInputDto;
  /** `settingKey`: whose value is in use. */
  marketReturn: FireRatioInputDto & { settingKey: 'fire.marketReturn' | 'returns.marketReturn' };
  /** `returns.cashInterestRate` (read only here). */
  cashInterestRate: FireRatioInputDto;
  /** D97. */
  yearlySpend: FireMoneyInputDto;
  /** D99; `workbookCents`: an import-origin value, shown as the workbook's figure (owner question 1). */
  superContribution: FireMoneyInputDto & { workbookCents: number | null };
  extraSavings: FireMoneyInputDto;
}

// ─── Derivation (= the engine's FireDerived, Cents → number) ────────────────────────────────────

export interface FirePeriodRowDto {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  incomeCents: number;
  spendCents: number;
  countedSpendCents: number;
  superNetPayCents: number;
  countedSavingsCents: number;
  floored: boolean;
}

export interface FireGrowthWeightDto {
  key: FireGrowthWeightKey;
  valueCents: number;
  rate: 'cash' | 'market';
}

export interface FireDerivedDto {
  preSuper: {
    netWorthCents: number;
    superCents: number;
    primaryResidenceCents: number;
    primaryResidenceDebtCents: number;
    primaryResidenceLoanGrossCents: number;
    preSuperCents: number;
    debtCents: number;
    preSuperExHomeLoanCents: number;
  };
  window: { from: IsoDate; through: IsoDate; periods: number } | null;
  rows: FirePeriodRowDto[];
  spend: { yearlyCents: number | null; flooredPeriods: number; rawYearlyCents: number | null };
  savings: {
    yearlyCents: number | null;
    cappedPeriods: number;
    superExcludedCents: number;
    rawYearlyCents: number | null;
  };
  superContribution: {
    yearlyCents: number;
    sgCents: number;
    memberCents: number;
    fromMonth: IsoMonth;
    toMonth: IsoMonth;
    sgSource: 'estimate' | 'statement' | 'mixed' | 'none';
    contributions: number;
  };
  growth: {
    weights: FireGrowthWeightDto[];
    cashWeightCents: number;
    marketWeightCents: number;
  };
}

// ─── Projection (= the engine's FireProjection, Cents → number) ─────────────────────────────────

export interface FireRowDto {
  t: number;
  year: number;
  age: number;
  phase: FirePhase;
  preSuper: {
    startCents: number;
    growthCents: number;
    savedCents: number;
    spentCents: number;
    topUpCents: number;
    endCents: number;
  };
  super: {
    startCents: number;
    growthCents: number;
    contributedCents: number;
    topUpCents: number;
    withdrawnCents: number;
    endCents: number;
  };
  helper: { neededCents: number; projectedCents: number; gapCents: number } | null;
}

export interface FireMilestoneDto {
  kind: FireMilestoneKind;
  t: number;
  year: number;
  age: number;
}

export interface FireProjectionDto {
  status: FireStatus;
  missing: FireMissingInput[];
  ageNow: number | null;
  accessYear: number | null;
  yearsToAccess: number | null;
  rates: {
    nominalRatio: DecimalString;
    inflationRatio: DecimalString;
    realRatio: DecimalString;
    simpleRealRatio: DecimalString;
  } | null;
  savingsPerYearCents: number;
  noSavingsHistory: boolean;
  target: { superAtAccessCents: number; superAtFireStartCents: number | null } | null;
  fire: {
    yearsToGo: number;
    year: number;
    age: number;
    afterAccess: boolean;
    bridgeYears: number;
  } | null;
  topUps: {
    years: number;
    perYearCents: number;
    lastCents: number;
    totalCents: number;
    level: boolean;
    endYear: number;
  } | null;
  preSuper: {
    currentCents: number;
    neededAtFireCents: number | null;
    projectedAtFireCents: number | null;
    progressRatio: DecimalString | null;
  };
  super: {
    currentCents: number;
    neededAtAccessCents: number | null;
    projectedAtAccessCents: number | null;
    neededAtFireCents: number | null;
    progressRatio: DecimalString | null;
  };
  milestones: FireMilestoneDto[];
  rows: FireRowDto[];
}

/** The saved settings' summary while a what-if is active; every tile's "Saved:" line. */
export interface FireSummaryDto {
  status: FireStatus;
  fireYear: number | null;
  yearsToGo: number | null;
  fireAge: number | null;
  afterAccess: boolean | null;
  neededAtFireCents: number | null;
  superNeededAtAccessCents: number | null;
  superProjectedAtAccessCents: number | null;
  yearlySpendCents: number | null;
}

export interface FirePageResponse {
  asOf: IsoDate;
  /** Net worth 0, super 0 and no closed period: the empty state (§6.3 item 8). */
  isEmpty: boolean;
  /** Any query field given. */
  whatIfActive: boolean;
  inputs: FireInputsDto;
  derived: FireDerivedDto;
  projection: FireProjectionDto;
  /** The saved settings' summary while a what-if is active. */
  baseline: FireSummaryDto | null;
  /** features.fire ?? true. */
  featureOn: boolean;
  /** For the "Saving never blocks a re-import" line (D103). */
  hasAppData: boolean;
}
