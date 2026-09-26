// The engine results the DTOs mirror field by field (stage-3.md §4.4, §4.5 "Cross-cutting"):
// `@joinr/schema` cannot import the engine's types, so this type-level test (checked by the server
// typecheck) keeps each engine result assignable to its DTO.
import type {
  CashflowChartPoint,
  CashKpisResult,
  DividendsResult,
  YearWindow,
} from '@joinr/engine';
import type {
  CashChartPointDto,
  CashKpisDto,
  DividendsKpisDto,
  YearWindowDto,
} from '@joinr/schema';
import { describe, expectTypeOf, it } from 'vitest';

describe('engine results → DTOs (type level)', () => {
  it('CashKpisResult is assignable to CashKpisDto', () => {
    expectTypeOf<CashKpisResult>().toExtend<CashKpisDto>();
  });

  it('YearWindow is assignable to YearWindowDto', () => {
    expectTypeOf<YearWindow>().toExtend<YearWindowDto>();
  });

  it('CashflowChartPoint is assignable to CashChartPointDto', () => {
    expectTypeOf<CashflowChartPoint>().toExtend<CashChartPointDto>();
  });

  it("DividendsResult['kpis'] is assignable to DividendsKpisDto", () => {
    expectTypeOf<DividendsResult['kpis']>().toExtend<DividendsKpisDto>();
  });

  it('and back: every DTO field exists on the engine result', () => {
    expectTypeOf<CashKpisDto>().toExtend<CashKpisResult>();
    expectTypeOf<YearWindowDto>().toExtend<YearWindow>();
    expectTypeOf<CashChartPointDto>().toExtend<CashflowChartPoint>();
    expectTypeOf<DividendsKpisDto>().toExtend<DividendsResult['kpis']>();
  });
});
