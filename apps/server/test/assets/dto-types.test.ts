// The Stage 4 engine results the DTOs mirror field by field (stage-4.md §4.4, §7.4 step 2):
// `@joinr/schema` cannot import the engine's types, so this type-level test (checked by the server
// typecheck) keeps each engine result assignable to its DTO (Cents → number), and back.
import type {
  AmortisationResult,
  OtherAssetsChartPoint,
  PropertiesResult,
  PropertyChartPoint,
  SuperCapYear,
  SuperChartPoint,
  SuperFlows,
} from '@joinr/engine';
import type {
  AmortisationDto,
  OtherAssetsChartPointDto,
  PropertyChartPointDto,
  PropertyTotalsDto,
  SuperCapYearDto,
  SuperChartPointDto,
  SuperFlowsDto,
} from '@joinr/schema';
import { describe, expectTypeOf, it } from 'vitest';

describe('Stage 4 engine results → DTOs (type level)', () => {
  it('OtherAssetsChartPoint is assignable to OtherAssetsChartPointDto', () => {
    expectTypeOf<OtherAssetsChartPoint>().toExtend<OtherAssetsChartPointDto>();
  });

  it('SuperFlows is assignable to SuperFlowsDto', () => {
    expectTypeOf<SuperFlows>().toExtend<SuperFlowsDto>();
  });

  it('SuperCapYear is assignable to SuperCapYearDto', () => {
    expectTypeOf<SuperCapYear>().toExtend<SuperCapYearDto>();
  });

  it('SuperChartPoint is assignable to SuperChartPointDto', () => {
    expectTypeOf<SuperChartPoint>().toExtend<SuperChartPointDto>();
  });

  it('AmortisationResult is assignable to AmortisationDto', () => {
    expectTypeOf<AmortisationResult>().toExtend<AmortisationDto>();
  });

  it("PropertiesResult['totals'] is assignable to PropertyTotalsDto", () => {
    expectTypeOf<PropertiesResult['totals']>().toExtend<PropertyTotalsDto>();
  });

  it('PropertyChartPoint is assignable to PropertyChartPointDto', () => {
    expectTypeOf<PropertyChartPoint>().toExtend<PropertyChartPointDto>();
  });

  it('and back: every DTO field exists on the engine result', () => {
    expectTypeOf<OtherAssetsChartPointDto>().toExtend<OtherAssetsChartPoint>();
    expectTypeOf<SuperFlowsDto>().toExtend<SuperFlows>();
    expectTypeOf<SuperCapYearDto>().toExtend<SuperCapYear>();
    expectTypeOf<SuperChartPointDto>().toExtend<SuperChartPoint>();
    expectTypeOf<AmortisationDto>().toExtend<AmortisationResult>();
    expectTypeOf<PropertyTotalsDto>().toExtend<PropertiesResult['totals']>();
    expectTypeOf<PropertyChartPointDto>().toExtend<PropertyChartPoint>();
  });
});
