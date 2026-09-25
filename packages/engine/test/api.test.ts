// The frozen public API (stage-2.md §2.2): the `engine` value satisfies EngineApi member by
// member, and the functions keep their exact signatures (checked by tsc in `pnpm typecheck`).
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
    expectTypeOf(api.compressSeries).toEqualTypeOf<EngineApi['compressSeries']>();
    expectTypeOf(api.budgetInvestment).toEqualTypeOf<EngineApi['budgetInvestment']>();
    expectTypeOf(api.parcelOptimiser).toEqualTypeOf<EngineApi['parcelOptimiser']>();
    expectTypeOf(api.investCountdown).toEqualTypeOf<EngineApi['investCountdown']>();
    expectTypeOf(api.considerNext).toEqualTypeOf<EngineApi['considerNext']>();
    expectTypeOf(api.nextBuyHint).toEqualTypeOf<EngineApi['nextBuyHint']>();
    expectTypeOf(api.assetClassOfKind).toEqualTypeOf<EngineApi['assetClassOfKind']>();
    expectTypeOf(api.sheetDate).toEqualTypeOf<EngineApi['sheetDate']>();

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
    ];
    expect(Object.keys(api.engine).sort()).toEqual([...members].sort());
    for (const name of members) expect(api.engine[name]).toBe(api[name]);
  });

  it('has the FIFO matching seam and the implementation flag', () => {
    expect(api.MATCHING_STRATEGIES).toEqual(['fifo']);
    expectTypeOf(api.ENGINE_IMPLEMENTED).toEqualTypeOf<boolean>();
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
