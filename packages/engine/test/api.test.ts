// The frozen public API (stage-2.md §2.2, stage-3.md §2.2, stage-4.md §2.2): the `engine` value satisfies
// EngineApi member by member, and the functions keep their exact signatures (checked by tsc in
// `pnpm typecheck`).
import { INSTRUMENT_KINDS } from '@joinr/schema';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from '../src/index';
import type { EngineApi } from '../src/index';

describe('@joinr/engine public API', () => {
  it('exposes every function as one EngineApi value (compile time and run time)', () => {
    expectTypeOf(api.engine).toExtend<EngineApi>();
    expectTypeOf(api.computeInvestments).toEqualTypeOf<EngineApi['computeInvestments']>();
    expectTypeOf(api.xirr).toEqualTypeOf<EngineApi['xirr']>();
    expectTypeOf(api.realisedByFinancialYear).toEqualTypeOf<EngineApi['realisedByFinancialYear']>();
    expectTypeOf(api.contributionsAt).toEqualTypeOf<EngineApi['contributionsAt']>();
    expectTypeOf(api.netPurchases).toEqualTypeOf<EngineApi['netPurchases']>();
    expectTypeOf(api.purchaseWindows).toEqualTypeOf<EngineApi['purchaseWindows']>();
    // Stage 3 appended optional inputs (compressSeries' yearBasis, investCountdown's
    // cashDeficitMonths); the implementations take them.
    expectTypeOf(api.compressSeries).toEqualTypeOf<EngineApi['compressSeries']>();
    expectTypeOf(api.budgetInvestment).toEqualTypeOf<EngineApi['budgetInvestment']>();
    expectTypeOf(api.parcelOptimiser).toEqualTypeOf<EngineApi['parcelOptimiser']>();
    expectTypeOf(api.investCountdown).toEqualTypeOf<EngineApi['investCountdown']>();
    expectTypeOf(api.considerNext).toEqualTypeOf<EngineApi['considerNext']>();
    expectTypeOf(api.nextBuyHint).toEqualTypeOf<EngineApi['nextBuyHint']>();
    expectTypeOf(api.assetClassOfKind).toEqualTypeOf<EngineApi['assetClassOfKind']>();
    expectTypeOf(api.sheetDate).toEqualTypeOf<EngineApi['sheetDate']>();
    // Stage 3.
    expectTypeOf(api.cashTotals).toEqualTypeOf<EngineApi['cashTotals']>();
    expectTypeOf(api.monthlyPayCents).toEqualTypeOf<EngineApi['monthlyPayCents']>();
    expectTypeOf(api.computeSavings).toEqualTypeOf<EngineApi['computeSavings']>();
    expectTypeOf(api.cashKpis).toEqualTypeOf<EngineApi['cashKpis']>();
    expectTypeOf(api.savingsGoals).toEqualTypeOf<EngineApi['savingsGoals']>();
    expectTypeOf(api.computeSideIncome).toEqualTypeOf<EngineApi['computeSideIncome']>();
    expectTypeOf(api.computeBudget).toEqualTypeOf<EngineApi['computeBudget']>();
    expectTypeOf(api.budgetInvestInputOf).toEqualTypeOf<EngineApi['budgetInvestInputOf']>();
    expectTypeOf(api.computeDividends).toEqualTypeOf<EngineApi['computeDividends']>();
    expectTypeOf(api.dividendSuggestions).toEqualTypeOf<EngineApi['dividendSuggestions']>();
    expectTypeOf(api.cashDeficitMonths).toEqualTypeOf<EngineApi['cashDeficitMonths']>();
    expectTypeOf(api.compressCashflow).toEqualTypeOf<EngineApi['compressCashflow']>();
    expectTypeOf(api.yearWindow).toEqualTypeOf<EngineApi['yearWindow']>();
    // Stage 4.
    expectTypeOf(api.computeOtherAssets).toEqualTypeOf<EngineApi['computeOtherAssets']>();
    expectTypeOf(api.otherAssetsCostHeldAt).toEqualTypeOf<EngineApi['otherAssetsCostHeldAt']>();
    expectTypeOf(api.computeSuper).toEqualTypeOf<EngineApi['computeSuper']>();
    expectTypeOf(api.computeProperty).toEqualTypeOf<EngineApi['computeProperty']>();
    expectTypeOf(api.amortise).toEqualTypeOf<EngineApi['amortise']>();
    expectTypeOf(api.assetsSnapshotColumns).toEqualTypeOf<EngineApi['assetsSnapshotColumns']>();

    const members: (keyof EngineApi)[] = [
      'computeInvestments',
      'xirr',
      'realisedByFinancialYear',
      'contributionsAt',
      'netPurchases',
      'purchaseWindows',
      'compressSeries',
      'budgetInvestment',
      'parcelOptimiser',
      'investCountdown',
      'considerNext',
      'nextBuyHint',
      'assetClassOfKind',
      'sheetDate',
      'cashTotals',
      'monthlyPayCents',
      'computeSavings',
      'cashKpis',
      'savingsGoals',
      'computeSideIncome',
      'computeBudget',
      'budgetInvestInputOf',
      'computeDividends',
      'dividendSuggestions',
      'cashDeficitMonths',
      'compressCashflow',
      'yearWindow',
      'computeOtherAssets',
      'otherAssetsCostHeldAt',
      'computeSuper',
      'computeProperty',
      'amortise',
      'assetsSnapshotColumns',
    ];
    expect(Object.keys(api.engine).sort()).toEqual([...members].sort());
    for (const name of members) expect(api.engine[name]).toBe(api[name]);
  });

  it('has the FIFO matching seam and the implementation flags', () => {
    expect(api.MATCHING_STRATEGIES).toEqual(['fifo']);
    expectTypeOf(api.ENGINE_IMPLEMENTED).toEqualTypeOf<boolean>();
    expectTypeOf(api.CASHFLOW_ENGINE_IMPLEMENTED).toEqualTypeOf<boolean>();
    expectTypeOf(api.ASSETS_ENGINE_IMPLEMENTED).toEqualTypeOf<boolean>();
  });

  it('gives the FY or calendar year containing a date (§2.3)', () => {
    expect(api.yearWindow('2026-09-25', 'fy')).toEqual({
      basis: 'fy',
      start: '2026-07-01',
      end: '2027-07-01',
      year: 2026,
    });
    expect(api.yearWindow('2026-06-30', 'fy')).toMatchObject({ start: '2025-07-01', year: 2025 });
    expect(api.yearWindow('2026-07-01', 'fy')).toMatchObject({ start: '2026-07-01', year: 2026 });
    expect(api.yearWindow('2026-09-25', 'calendar')).toEqual({
      basis: 'calendar',
      start: '2026-01-01',
      end: '2027-01-01',
      year: 2026,
    });
    expect(api.yearWindow('2026-12-31', 'calendar')).toMatchObject({ end: '2027-01-01' });
    expect(() => api.yearWindow('25/09/2026', 'fy')).toThrow(RangeError);
  });

  it('maps each kind to its asset class', () => {
    for (const kind of INSTRUMENT_KINDS) expect(api.assetClassOfKind(kind)).toBe(kind);
  });

  it('rolls DATE() overflow like the sheet', () => {
    expect(api.sheetDate(2026, 8, 17)).toBe('2026-08-17');
    expect(api.sheetDate(2026, 8, 33)).toBe('2026-09-02');
    expect(api.sheetDate(2026, 13, 1)).toBe('2027-01-01');
    expect(api.sheetDate(2026, 3, 0)).toBe('2026-02-28');
    expect(api.sheetDate(2024, 2, 30)).toBe('2024-03-01');
    expect(api.sheetDate(2026, 0, 15)).toBe('2025-12-15');
    expect(() => api.sheetDate(2026, 1.5, 1)).toThrow(RangeError);
  });
});
