// The Stage 6 FIRE fixtures (stage-6.md §3.6) are internally consistent: every row adds up within 1
// cent and starts where the previous one ended, the milestones are in time order, the derivation
// adds up (spend and savings from the months used, pre-super from net worth, the growth weights),
// each fixture's recorded projection input matches its page, a what-if carries a baseline, every
// status, phase, milestone kind and input source is covered, and `onTrack` is the hand-worked
// example of §10.1.
import { describe, expect, it } from 'vitest';
import {
  FIRE_INPUT_SOURCES,
  FIRE_MILESTONE_KINDS,
  FIRE_PHASES,
  FIRE_STATUSES,
  FIRE_WINDOW_STALE_DAYS,
  fireQuerySchema,
  isApiErrorBody,
  settingsPatchSchema,
  type FirePageResponse,
} from '../src/index';
import * as f from '../src/fixtures/index';

const pages = Object.entries(f.firePages) as [keyof typeof f.firePages, FirePageResponse][];
const within1 = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
const days = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

describe('firePages (§3.6)', () => {
  for (const [name, p] of pages) {
    describe(name, () => {
      it('rows add up within 1 cent and chain from one year to the next', () => {
        const { rows } = p.projection;
        rows.forEach((r, j) => {
          const a = r.preSuper;
          const b = r.super;
          within1(
            a.endCents,
            a.startCents + a.growthCents + a.savedCents - a.spentCents - a.topUpCents,
          );
          within1(
            b.endCents,
            b.startCents + b.growthCents + b.contributedCents + b.topUpCents - b.withdrawnCents,
          );
          expect(r.t).toBe(j);
          expect(r.year).toBe(Number(p.asOf.slice(0, 4)) + j);
          if (p.projection.ageNow !== null) expect(r.age).toBe(p.projection.ageNow + j);
          if (j > 0) {
            within1(a.startCents, rows[j - 1]!.preSuper.endCents);
            within1(b.startCents, rows[j - 1]!.super.endCents);
          }
          if (r.helper) expect(r.helper.neededCents).toBeGreaterThanOrEqual(0);
          if (r.phase === 'access' || r.phase === 'retired') expect(a.savedCents).toBe(0);
        });
        if (rows.length > 0) {
          expect(rows[0]!.preSuper.startCents).toBe(p.projection.preSuper.currentCents);
          expect(rows[0]!.super.startCents).toBe(p.projection.super.currentCents);
        }
      });

      it('milestones are in time order, today first, with their years and ages', () => {
        const ms = p.projection.milestones;
        const order = FIRE_MILESTONE_KINDS as readonly string[];
        for (let j = 1; j < ms.length; j++) {
          const [x, y] = [ms[j - 1]!, ms[j]!];
          expect(x.t < y.t || (x.t === y.t && order.indexOf(x.kind) < order.indexOf(y.kind))).toBe(
            true,
          );
        }
        if (ms.length > 0) expect(ms[0]).toMatchObject({ kind: 'today', t: 0 });
        for (const m of ms) {
          expect(m.year).toBe(Number(p.asOf.slice(0, 4)) + m.t);
          expect(m.age).toBe(p.projection.ageNow! + m.t);
        }
        const kinds = ms.map((m) => m.kind);
        expect(new Set(kinds).size).toBe(kinds.length);
        if (p.projection.fire) {
          if (p.projection.fire.yearsToGo > 0) expect(kinds).toContain('fire_start');
          else expect(kinds).not.toContain('fire_start');
        }
        if (p.projection.topUps) expect(kinds).toContain('top_ups_end');
        const n = p.projection.yearsToAccess;
        if (n !== null && n > 0 && p.projection.status !== 'needs_input') {
          expect(kinds).toContain('access');
        } else expect(kinds).not.toContain('access');
      });

      it('the status matches the projection', () => {
        const x = p.projection;
        switch (x.status) {
          case 'needs_input':
            expect(x.missing.length).toBeGreaterThan(0);
            expect(x.rows).toEqual([]);
            expect([x.fire, x.target, x.topUps, x.rates]).toEqual([null, null, null, null]);
            break;
          case 'spend_needed':
            expect(x.fire).toBeNull();
            expect(x.target).toBeNull();
            expect(x.rows.every((r) => r.phase === 'accumulation' && r.helper === null)).toBe(true);
            expect(x.milestones.map((m) => m.kind)).toEqual(['today', 'access']);
            break;
          case 'not_reachable':
            expect(x.fire).toBeNull();
            expect(x.rows.every((r) => r.phase === 'accumulation')).toBe(true);
            break;
          case 'fire':
            expect(x.fire?.yearsToGo).toBe(0);
            break;
          case 'on_track':
            expect(x.fire!.yearsToGo).toBeGreaterThan(0);
            break;
        }
        if (x.status !== 'needs_input') expect(x.missing).toEqual([]);
        if (x.fire) {
          const k = x.fire.yearsToGo;
          const n = x.yearsToAccess!;
          expect(x.fire.afterAccess).toBe(k > n);
          expect(x.fire.bridgeYears).toBe(Math.max(0, n - k));
          expect(x.rows).toHaveLength(Math.min(Math.max(n, k) + 1, 100 - x.ageNow!) + 1);
          const help = x.rows[k]!.helper!;
          expect(help.projectedCents).toBe(x.preSuper.projectedAtFireCents);
          expect(help.neededCents).toBe(x.preSuper.neededAtFireCents);
          expect(help.gapCents).toBeLessThanOrEqual(0);
          if (k > 0) expect(x.rows[k - 1]!.helper!.gapCents).toBeGreaterThan(0);
        }
        if (x.topUps) {
          expect(x.topUps.endYear).toBe(x.fire!.year + x.topUps.years);
          const paid = x.rows.reduce((a, r) => a + r.super.topUpCents, 0);
          expect(Math.abs(paid - x.topUps.totalCents)).toBeLessThanOrEqual(x.topUps.years);
          expect(x.rows.filter((r) => r.phase === 'top_up')).toHaveLength(x.topUps.years);
        }
        expect(x.savingsPerYearCents).toBe(
          Math.max(0, (p.derived.savings.yearlyCents ?? 0) + (p.inputs.extraSavings.cents ?? 0)),
        );
        expect(x.noSavingsHistory).toBe(p.derived.savings.yearlyCents === null);
      });

      it('the derivation adds up', () => {
        const d = p.derived;
        const ps = d.preSuper;
        expect(ps.preSuperCents).toBe(ps.netWorthCents - ps.superCents - ps.primaryResidenceCents);
        expect(ps.preSuperExHomeLoanCents).toBe(
          ps.preSuperCents + ps.primaryResidenceLoanGrossCents,
        );
        expect(ps.debtCents).toBeGreaterThanOrEqual(0);
        expect(d.rows.length).toBe(d.window?.periods ?? 0);
        if (d.window) {
          expect(d.window.through).toBe(d.rows.at(-1)!.runDate);
          expect(d.window.from <= d.rows[0]!.runDate).toBe(true);
        }
        for (const r of d.rows) {
          expect(r.countedSpendCents).toBe(Math.max(0, r.spendCents));
          expect(r.floored).toBe(r.spendCents < 0);
          expect(r.countedSavingsCents).toBe(
            r.incomeCents - r.countedSpendCents - r.superNetPayCents,
          );
        }
        const n = d.rows.length;
        const mean12 = (g: (r: (typeof d.rows)[number]) => number) =>
          (d.rows.reduce((a, r) => a + g(r), 0) / n) * 12;
        if (n > 0) {
          within1(
            d.spend.yearlyCents!,
            mean12((r) => r.countedSpendCents),
          );
          within1(
            d.savings.yearlyCents!,
            Math.max(
              0,
              mean12((r) => r.countedSavingsCents),
            ),
          );
          within1(
            d.spend.rawYearlyCents!,
            mean12((r) => r.spendCents),
          );
        } else {
          expect([d.spend.yearlyCents, d.savings.yearlyCents]).toEqual([null, null]);
        }
        expect(d.spend.flooredPeriods).toBe(d.rows.filter((r) => r.floored).length);
        const sc = d.superContribution;
        expect(sc.yearlyCents).toBe(sc.sgCents + sc.memberCents);
        const w = d.growth;
        const sum = (rate: 'cash' | 'market') =>
          w.weights.filter((x) => x.rate === rate).reduce((a, x) => a + x.valueCents, 0);
        expect(w.cashWeightCents).toBe(sum('cash'));
        expect(w.marketWeightCents).toBe(sum('market'));
        for (const x of w.weights) expect(x.valueCents).toBeGreaterThan(0);
        expect(p.isEmpty).toBe(ps.netWorthCents === 0 && ps.superCents === 0 && d.window === null);
      });

      it('has a recorded projection input that matches the page', () => {
        const input = f.fireFixtureInputs[name];
        expect(input.asOf).toBe(p.asOf);
        expect(input.birthYear).toBe(p.inputs.birthYear.value);
        expect(input.accessAge).toBe(p.inputs.accessAge.value);
        expect(input.inflationRatio).toBe(p.inputs.inflationRate.ratio);
        expect(input.withdrawalRatio).toBe(p.inputs.withdrawalRate.ratio);
        expect(input.preSuperCents).toBe(p.derived.preSuper.preSuperCents);
        expect(input.preSuperDebtCents).toBe(p.derived.preSuper.debtCents);
        expect(input.superCents).toBe(p.derived.preSuper.superCents);
        expect(input.savingsPerYearCents).toBe(p.derived.savings.yearlyCents);
        expect(input.extraSavingsPerYearCents).toBe(p.inputs.extraSavings.cents);
        expect(input.superContributionPerYearCents).toBe(p.inputs.superContribution.cents);
        expect(input.yearlySpendCents).toBe(p.inputs.yearlySpend.cents);
        expect(input.growth).toEqual({
          cashWeightCents: p.derived.growth.cashWeightCents,
          marketWeightCents: p.derived.growth.marketWeightCents,
          cashInterestRatio: p.inputs.cashInterestRate.ratio,
          marketReturnRatio: p.inputs.marketReturn.ratio,
        });
      });

      it('carries a baseline exactly while a what-if is active', () => {
        const sources = f.fireInputSourcesOf(p.inputs);
        expect(p.whatIfActive).toBe(sources.includes('what_if'));
        expect(p.baseline !== null).toBe(p.whatIfActive);
      });
    });
  }

  it('onTrack is the hand-worked example (§10.1)', () => {
    const x = f.firePages.onTrack.projection;
    expect(x.rates).toEqual({
      nominalRatio: '0.0608',
      inflationRatio: '0.02',
      realRatio: '0.04',
      simpleRealRatio: '0.0408',
    });
    expect(x.fire).toEqual({
      yearsToGo: 1,
      year: 2031,
      age: 56,
      afterAccess: false,
      bridgeYears: 4,
    });
    expect(x.target).toEqual({ superAtAccessCents: 80_000_000, superAtFireStartCents: 68_384_335 });
    expect(x.topUps).toEqual({
      years: 3,
      perYearCents: 2_000_000,
      lastCents: 238_635,
      totalCents: 4_238_635,
      level: false,
      endYear: 2034,
    });
    expect(x.preSuper.neededAtFireCents).toBe(18_503_916);
    expect(x.super).toMatchObject({ projectedAtAccessCents: 80_000_000, progressRatio: '0.75' });
    expect(x.rows[0]!.helper).toEqual({
      neededCents: 23_561_458,
      projectedCents: 15_000_000,
      gapCents: 8_561_458,
    });
    expect(x.rows[1]!.helper.gapCents).toBe(-96_084);
    expect(x.rows[4]!.super.endCents).toBe(80_000_000);
    expect(x.rows[4]!.preSuper.endCents).toBe(112_404);
    expect(x.rows.map((r) => r.phase)).toEqual([
      'accumulation',
      'top_up',
      'top_up',
      'top_up',
      'drawdown',
      'access',
      'access',
    ]);
    expect(x.milestones.map((m) => [m.kind, m.year])).toEqual([
      ['today', 2030],
      ['fire_start', 2031],
      ['top_ups_end', 2034],
      ['access', 2035],
    ]);
    const d = f.firePages.onTrack.derived;
    expect([d.spend.yearlyCents, d.spend.rawYearlyCents]).toEqual([4_000_000, 3_400_000]);
    expect([d.savings.yearlyCents, d.savings.rawYearlyCents]).toEqual([3_000_000, 3_840_000]);
    expect(d.savings.superExcludedCents).toBe(240_000);
    expect(d.superContribution).toMatchObject({
      yearlyCents: 2_000_000,
      fromMonth: '2029-03',
      toMonth: '2030-02',
    });
  });

  it('draws each state the plan lists', () => {
    const p = f.firePages;
    expect(p.fireNow.projection.status).toBe('fire');
    expect(p.afterAccess.projection.fire.afterAccess).toBe(true);
    expect(p.afterAccess.projection.rows.some((r) => r.phase === 'retired')).toBe(true);
    const atAccess = p.fireAtAccess.projection;
    expect(atAccess.fire.yearsToGo).toBe(atAccess.yearsToAccess);
    expect(atAccess.milestones.filter((m) => m.t === atAccess.yearsToAccess)).toHaveLength(2);
    expect(p.notReachable.projection.status).toBe('not_reachable');
    expect(p.spendNeeded.projection.status).toBe('spend_needed');
    expect(p.needsInput.projection.missing).toEqual(['birthYear', 'withdrawalRate']);
    expect(p.needsInputRates.projection.missing).toEqual(['marketReturn', 'cashInterestRate']);
    expect(p.spendOverride.inputs.yearlySpend.source).toBe('setting');
    expect(p.superContributionOverride.inputs.superContribution.source).toBe('setting');
    expect(p.marketReturnFire.inputs.marketReturn.settingKey).toBe('fire.marketReturn');
    expect(p.whatIf.whatIfActive).toBe(true);
    expect(p.whatIf.baseline.fireYear).not.toBe(p.whatIf.projection.fire.year);
    expect(p.whatIfStatusChange.baseline.status).toBe('on_track');
    expect(p.whatIfStatusChange.projection.status).toBe('not_reachable');
    expect(p.levelTopUps.projection.topUps.level).toBe(true);
    expect(p.noTopUps.projection.topUps).toBeNull();
    expect(p.noTopUps.projection.status).toBe('on_track');
    expect(p.accessReached.projection.yearsToAccess).toBeLessThanOrEqual(0);
    expect(p.negativePreSuper.derived.preSuper.preSuperCents).toBeLessThan(0);
    expect(p.negativePreSuper.derived.preSuper.debtCents).toBeGreaterThan(0);
    expect(p.superZero.derived.preSuper.superCents).toBe(0);
    expect(p.longHorizon.projection.rows.length).toBeGreaterThanOrEqual(70);
    expect(p.shortWindow.derived.window.periods).toBe(3);
    const stale = p.staleWindow;
    expect(days(stale.derived.window.through, stale.asOf)).toBeGreaterThan(FIRE_WINDOW_STALE_DAYS);
    expect(days(p.onTrack.derived.window.through, p.onTrack.asOf)).toBeLessThanOrEqual(
      FIRE_WINDOW_STALE_DAYS,
    );
    expect(p.upgradedAge.inputs.accessAge.replaced).toMatchObject({ from: 65, to: 60 });
    expect(p.upgradedAge.inputs.accessAge.value).toBe(60);
    expect(p.workbookContribution.inputs.superContribution).toMatchObject({
      source: 'derived',
      workbookCents: 1_500_000,
    });
    expect(p.noSavingsHistory.projection.noSavingsHistory).toBe(true);
    expect(p.noSavingsHistory.inputs.yearlySpend.source).toBe('setting');
    expect(p.empty.isEmpty).toBe(true);
    expect(p.featureOff.featureOn).toBe(false);
  });

  it('covers every status, phase, milestone kind and input source', () => {
    const c = f.FIXTURE_COVERAGE;
    expect([...c.fireStatuses].sort()).toEqual([...FIRE_STATUSES].sort());
    expect([...c.firePhases].sort()).toEqual([...FIRE_PHASES].sort());
    expect([...c.fireMilestoneKinds].sort()).toEqual([...FIRE_MILESTONE_KINDS].sort());
    expect([...c.fireInputSources].sort()).toEqual([...FIRE_INPUT_SOURCES].sort());
  });

  it('records an input for every fixture and nothing else', () => {
    expect(Object.keys(f.fireFixtureInputs).sort()).toEqual(Object.keys(f.firePages).sort());
  });

  it('has a settings PATCH example and a query validation error', () => {
    const r = f.fireSettingsPatchResponse;
    expect(settingsPatchSchema.safeParse({ values: r.settings.values }).success).toBe(true);
    expect(r.hasAppData).toBe(false);
    expect(isApiErrorBody(f.apiErrors.fireValidation)).toBe(true);
    const parsed = fireQuerySchema.safeParse({ withdrawalRate: '0', accessAge: '101' });
    expect(parsed.success).toBe(false);
    const message = parsed.success
      ? ''
      : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    expect(f.apiErrors.fireValidation.error.message).toBe(message);
  });
});
