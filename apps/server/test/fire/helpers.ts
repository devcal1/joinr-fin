// Shared helpers for the Stage 6 FIRE server suites (stage-6.md §7.4): hand-built engine results
// (a derivation and a projection with every field set to a distinct generic value, so the DTO
// mapping tests catch a swapped field), the saved settings for the resolver tests, and a fake
// engine whose FIRE members answer those results on top of the Stage 5 rules. Generic values only.
import type { EngineApi, FireDerived, FireProjection } from '@joinr/engine';
import type { FireRowDto } from '@joinr/schema';
import { expect } from 'vitest';
import type { SavedFireSettings } from '../../src/fire/inputs';
import { historyFakeEngine } from '../history/helpers';
import type { FakeEngine } from '../investments/helpers';

export { call, errorOf, hasAppDataOf, NOW, startApp, type TestApp } from '../history/helpers';

/** A derivation with every field distinct (generic round figures). */
export function derivedOf(p: Partial<FireDerived> = {}): FireDerived {
  return {
    preSuper: {
      netWorthCents: 90000000,
      superCents: 50000000,
      primaryResidenceCents: 30000000,
      primaryResidenceDebtCents: -20000000,
      primaryResidenceLoanGrossCents: 21000000,
      preSuperCents: 10000000,
      debtCents: 22000000,
      preSuperExHomeLoanCents: 31000000,
    },
    window: { from: '2025-08-31', through: '2026-08-31', periods: 2 },
    rows: [
      {
        periodMonth: '2026-07',
        runDate: '2026-07-31',
        incomeCents: 600000,
        spendCents: 400000,
        countedSpendCents: 400000,
        superNetPayCents: 10000,
        countedSavingsCents: 190000,
        floored: false,
      },
      {
        periodMonth: '2026-08',
        runDate: '2026-08-31',
        incomeCents: 610000,
        spendCents: -50000,
        countedSpendCents: 0,
        superNetPayCents: 10000,
        countedSavingsCents: 600000,
        floored: true,
      },
    ],
    spend: { yearlyCents: 2400000, flooredPeriods: 1, rawYearlyCents: 2100000 },
    savings: {
      yearlyCents: 4740000,
      cappedPeriods: 1,
      superExcludedCents: 120000,
      rawYearlyCents: 5100000,
    },
    superContribution: {
      yearlyCents: 1300000,
      sgCents: 1000000,
      memberCents: 300000,
      fromMonth: '2025-09',
      toMonth: '2026-08',
      sgSource: 'mixed',
      contributions: 3,
    },
    growth: {
      weights: [
        { key: 'cash', valueCents: 4000000, rate: 'cash' },
        { key: 'etf', valueCents: 6000000, rate: 'market' },
        { key: 'super', valueCents: 50000000, rate: 'market' },
      ],
      cashWeightCents: 4000000,
      marketWeightCents: 56000000,
    },
    ...p,
  };
}

/** An on-track projection with every field distinct (generic round figures). */
export function projectionOf(p: Partial<FireProjection> = {}): FireProjection {
  return {
    status: 'on_track',
    missing: [],
    ageNow: 36,
    accessYear: 2050,
    yearsToAccess: 24,
    rates: {
      nominalRatio: '0.065',
      inflationRatio: '0.025',
      realRatio: '0.0390243902439',
      simpleRealRatio: '0.04',
    },
    savingsPerYearCents: 4740000,
    noSavingsHistory: false,
    target: { superAtAccessCents: 60000000, superAtFireStartCents: 45000000 },
    fire: { yearsToGo: 9, year: 2035, age: 45, afterAccess: false, bridgeYears: 15 },
    topUps: {
      years: 4,
      perYearCents: 1300000,
      lastCents: 700000,
      totalCents: 4600000,
      level: false,
      endYear: 2039,
    },
    preSuper: {
      currentCents: 10000000,
      neededAtFireCents: 52000000,
      projectedAtFireCents: 53000000,
      progressRatio: '0.192307692308',
    },
    super: {
      currentCents: 50000000,
      neededAtAccessCents: 60000000,
      projectedAtAccessCents: 61000000,
      neededAtFireCents: 45000000,
      progressRatio: '0.833333333333',
    },
    milestones: [
      { kind: 'today', t: 0, year: 2026, age: 36 },
      { kind: 'fire_start', t: 9, year: 2035, age: 45 },
    ],
    rows: [
      {
        t: 0,
        year: 2026,
        age: 36,
        phase: 'accumulation',
        preSuper: {
          startCents: 10000000,
          growthCents: 390000,
          savedCents: 4740000,
          spentCents: 0,
          topUpCents: 0,
          endCents: 15130000,
        },
        super: {
          startCents: 50000000,
          growthCents: 1950000,
          contributedCents: 1300000,
          topUpCents: 0,
          withdrawnCents: 0,
          endCents: 53250000,
        },
        helper: { neededCents: 70000000, projectedCents: 10000000, gapCents: 60000000 },
      },
      {
        t: 1,
        year: 2027,
        age: 37,
        phase: 'top_up',
        preSuper: {
          startCents: 15130000,
          growthCents: 590000,
          savedCents: 0,
          spentCents: 2400000,
          topUpCents: 1300000,
          endCents: 12020000,
        },
        super: {
          startCents: 53250000,
          growthCents: 2080000,
          contributedCents: 0,
          topUpCents: 1300000,
          withdrawnCents: 0,
          endCents: 56630000,
        },
        helper: null,
      },
    ],
    ...p,
  };
}

/** The seed's FIRE settings as the resolver reads them (plus overrides). */
export function savedOf(p: Partial<SavedFireSettings> = {}): SavedFireSettings {
  return {
    birthYear: 1990,
    accessAge: 60,
    inflationRatio: '0.025',
    withdrawalRatio: '0.04',
    fireMarketReturnRatio: null,
    marketReturnRatio: '0.07',
    cashInterestRatio: '0.04',
    spendOverrideCents: null,
    superContribution: null,
    extraSavingsCents: null,
    ...p,
  };
}

/** The Stage 5 fake engine with FIRE members answering the hand-built results (overrides win). */
export function fireFakeEngine(
  o: { derived?: FireDerived; projection?: FireProjection } & Partial<EngineApi> = {},
): FakeEngine {
  const { derived, projection, ...overrides } = o;
  return historyFakeEngine({
    deriveFireInputs: () => derived ?? derivedOf(),
    projectFire: () => projection ?? projectionOf(),
    ...overrides,
  });
}

/** Each row's flows add up to its end within 1 cent, and the next row starts where it ended. */
export function expectRowsAddUp(rows: readonly FireRowDto[]): void {
  rows.forEach((r, i) => {
    const p = r.preSuper;
    const s = r.super;
    const what = `row ${r.t}`;
    expect(
      Math.abs(
        p.startCents + p.growthCents + p.savedCents - p.spentCents - p.topUpCents - p.endCents,
      ),
      `${what} pre-super`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        s.startCents +
          s.growthCents +
          s.contributedCents +
          s.topUpCents -
          s.withdrawnCents -
          s.endCents,
      ),
      `${what} super`,
    ).toBeLessThanOrEqual(1);
    expect(r.t, what).toBe(i);
    const next = rows[i + 1];
    if (next) {
      expect(Math.abs(next.preSuper.startCents - p.endCents), what).toBeLessThanOrEqual(1);
      expect(Math.abs(next.super.startCents - s.endCents), what).toBeLessThanOrEqual(1);
    }
    if (r.helper) expect(r.helper.neededCents, what).toBeGreaterThanOrEqual(0);
  });
}
