// The FIRE page (stage-6.md §4.4–4.5): `GET /api/fire` builds a FirePageResponse from one request
// context (`ctx.fireDerived()`, the resolved inputs and `projectFire`); a what-if saves nothing
// (D100) and, while active, a second `projectFire` on the saved values gives the baseline. Every
// figure comes from the engine; the DTOs are copied field by field (engine Cents → number).
import type {
  FireDerived,
  FireMilestone,
  FirePeriodRow,
  FireProjection,
  FireRow,
} from '@joinr/engine';
import type {
  FireAccessAgeReplacedDto,
  FireDerivedDto,
  FireMilestoneDto,
  FirePageResponse,
  FirePeriodRowDto,
  FireProjectionDto,
  FireQuery,
  FireRowDto,
  FireSummaryDto,
} from '@joinr/schema';
import type { FinanceContext } from '../cashflow/context';
import { booleanSetting } from '../db/queries/settings';
import { isWhatIf, projectionInputOf, resolveFireInputs, savedFireSettings } from './inputs';

export interface FirePageExtra {
  /** `hasAppData` (D34), for the "Saving never blocks a re-import" line (D103). */
  hasAppData: boolean;
  /** The D98 app_meta marker (null when absent). */
  marker: FireAccessAgeReplacedDto | null;
}

// ─── DTO mapping (field by field) ───────────────────────────────────────────────────────────────

export function firePeriodRowDto(r: FirePeriodRow): FirePeriodRowDto {
  return {
    periodMonth: r.periodMonth,
    runDate: r.runDate,
    incomeCents: r.incomeCents,
    spendCents: r.spendCents,
    countedSpendCents: r.countedSpendCents,
    superNetPayCents: r.superNetPayCents,
    countedSavingsCents: r.countedSavingsCents,
    floored: r.floored,
  };
}

export function fireDerivedDto(d: FireDerived): FireDerivedDto {
  const p = d.preSuper;
  const c = d.superContribution;
  return {
    preSuper: {
      netWorthCents: p.netWorthCents,
      superCents: p.superCents,
      primaryResidenceCents: p.primaryResidenceCents,
      primaryResidenceDebtCents: p.primaryResidenceDebtCents,
      primaryResidenceLoanGrossCents: p.primaryResidenceLoanGrossCents,
      preSuperCents: p.preSuperCents,
      debtCents: p.debtCents,
      preSuperExHomeLoanCents: p.preSuperExHomeLoanCents,
    },
    window:
      d.window === null
        ? null
        : { from: d.window.from, through: d.window.through, periods: d.window.periods },
    rows: d.rows.map(firePeriodRowDto),
    spend: {
      yearlyCents: d.spend.yearlyCents,
      flooredPeriods: d.spend.flooredPeriods,
      rawYearlyCents: d.spend.rawYearlyCents,
    },
    savings: {
      yearlyCents: d.savings.yearlyCents,
      cappedPeriods: d.savings.cappedPeriods,
      superExcludedCents: d.savings.superExcludedCents,
      rawYearlyCents: d.savings.rawYearlyCents,
    },
    superContribution: {
      yearlyCents: c.yearlyCents,
      sgCents: c.sgCents,
      memberCents: c.memberCents,
      fromMonth: c.fromMonth,
      toMonth: c.toMonth,
      sgSource: c.sgSource,
      contributions: c.contributions,
    },
    growth: {
      weights: d.growth.weights.map((w) => ({
        key: w.key,
        valueCents: w.valueCents,
        rate: w.rate,
      })),
      cashWeightCents: d.growth.cashWeightCents,
      marketWeightCents: d.growth.marketWeightCents,
    },
  };
}

export function fireRowDto(r: FireRow): FireRowDto {
  const p = r.preSuper;
  const s = r.super;
  return {
    t: r.t,
    year: r.year,
    age: r.age,
    phase: r.phase,
    preSuper: {
      startCents: p.startCents,
      growthCents: p.growthCents,
      savedCents: p.savedCents,
      spentCents: p.spentCents,
      topUpCents: p.topUpCents,
      endCents: p.endCents,
    },
    super: {
      startCents: s.startCents,
      growthCents: s.growthCents,
      contributedCents: s.contributedCents,
      topUpCents: s.topUpCents,
      withdrawnCents: s.withdrawnCents,
      endCents: s.endCents,
    },
    helper:
      r.helper === null
        ? null
        : {
            neededCents: r.helper.neededCents,
            projectedCents: r.helper.projectedCents,
            gapCents: r.helper.gapCents,
          },
  };
}

function milestoneDto(m: FireMilestone): FireMilestoneDto {
  return { kind: m.kind, t: m.t, year: m.year, age: m.age };
}

export function fireProjectionDto(p: FireProjection): FireProjectionDto {
  return {
    status: p.status,
    missing: [...p.missing],
    ageNow: p.ageNow,
    accessYear: p.accessYear,
    yearsToAccess: p.yearsToAccess,
    rates:
      p.rates === null
        ? null
        : {
            nominalRatio: p.rates.nominalRatio,
            inflationRatio: p.rates.inflationRatio,
            realRatio: p.rates.realRatio,
            simpleRealRatio: p.rates.simpleRealRatio,
          },
    savingsPerYearCents: p.savingsPerYearCents,
    noSavingsHistory: p.noSavingsHistory,
    target:
      p.target === null
        ? null
        : {
            superAtAccessCents: p.target.superAtAccessCents,
            superAtFireStartCents: p.target.superAtFireStartCents,
          },
    fire:
      p.fire === null
        ? null
        : {
            yearsToGo: p.fire.yearsToGo,
            year: p.fire.year,
            age: p.fire.age,
            afterAccess: p.fire.afterAccess,
            bridgeYears: p.fire.bridgeYears,
          },
    topUps:
      p.topUps === null
        ? null
        : {
            years: p.topUps.years,
            perYearCents: p.topUps.perYearCents,
            lastCents: p.topUps.lastCents,
            totalCents: p.topUps.totalCents,
            level: p.topUps.level,
            endYear: p.topUps.endYear,
          },
    preSuper: {
      currentCents: p.preSuper.currentCents,
      neededAtFireCents: p.preSuper.neededAtFireCents,
      projectedAtFireCents: p.preSuper.projectedAtFireCents,
      progressRatio: p.preSuper.progressRatio,
    },
    super: {
      currentCents: p.super.currentCents,
      neededAtAccessCents: p.super.neededAtAccessCents,
      projectedAtAccessCents: p.super.projectedAtAccessCents,
      neededAtFireCents: p.super.neededAtFireCents,
      progressRatio: p.super.progressRatio,
    },
    milestones: p.milestones.map(milestoneDto),
    rows: p.rows.map(fireRowDto),
  };
}

/** The saved plan's summary (every tile's "Saved:" line, §4.4). */
export function fireSummaryDto(p: FireProjection, yearlySpendCents: number | null): FireSummaryDto {
  return {
    status: p.status,
    fireYear: p.fire?.year ?? null,
    yearsToGo: p.fire?.yearsToGo ?? null,
    fireAge: p.fire?.age ?? null,
    afterAccess: p.fire?.afterAccess ?? null,
    neededAtFireCents: p.preSuper.neededAtFireCents,
    superNeededAtAccessCents: p.super.neededAtAccessCents,
    superProjectedAtAccessCents: p.super.projectedAtAccessCents,
    yearlySpendCents,
  };
}

/** Net worth 0, super 0 and no closed period: the empty state (§4.4). */
export function isFireEmpty(derived: FireDerived): boolean {
  return (
    derived.preSuper.netWorthCents === 0 &&
    derived.preSuper.superCents === 0 &&
    derived.window === null
  );
}

export function buildFirePage(
  ctx: FinanceContext,
  query: FireQuery,
  extra: FirePageExtra,
): FirePageResponse {
  const derived = ctx.fireDerived();
  const saved = savedFireSettings(ctx.data.settings, ctx.data.settingOrigins);
  const inputs = resolveFireInputs({ saved, derived, query, marker: extra.marker });
  const projection = ctx.engine.projectFire(projectionInputOf(ctx.asOf, derived, inputs));
  const whatIfActive = isWhatIf(query);
  let baseline: FireSummaryDto | null = null;
  if (whatIfActive) {
    const savedInputs = resolveFireInputs({ saved, derived, query: {}, marker: extra.marker });
    baseline = fireSummaryDto(
      ctx.engine.projectFire(projectionInputOf(ctx.asOf, derived, savedInputs)),
      savedInputs.yearlySpend.cents,
    );
  }
  return {
    asOf: ctx.asOf,
    isEmpty: isFireEmpty(derived),
    whatIfActive,
    inputs,
    derived: fireDerivedDto(derived),
    projection: fireProjectionDto(projection),
    baseline,
    featureOn: booleanSetting(ctx.data.settings, 'features.fire') ?? true,
    hasAppData: extra.hasAppData,
  };
}
