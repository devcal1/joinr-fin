// The Stage 6 engine results the DTOs mirror field by field (stage-6.md §4.4, §7.4 step 2):
// `@joinr/schema` cannot import the engine's types, so this type-level test (checked by the server
// typecheck) keeps each engine result assignable to its DTO (Cents → number), and back.
import type {
  FireDerived,
  FireMilestone,
  FirePeriodRow,
  FireProjection,
  FireProjectionInput,
  FireRow,
} from '@joinr/engine';
import type {
  FireDerivedDto,
  FireMilestoneDto,
  FirePeriodRowDto,
  FireProjectionDto,
  FireRowDto,
} from '@joinr/schema';
import type { FireFixtureProjectionInput } from '@joinr/schema/fixtures';
import { describe, expectTypeOf, it } from 'vitest';

describe('Stage 6 engine results → DTOs (type level)', () => {
  it('FireDerived is assignable to FireDerivedDto, and back', () => {
    expectTypeOf<FireDerived>().toExtend<FireDerivedDto>();
    expectTypeOf<FireDerivedDto>().toExtend<FireDerived>();
  });

  it('FirePeriodRow is assignable to FirePeriodRowDto, and back', () => {
    expectTypeOf<FirePeriodRow>().toExtend<FirePeriodRowDto>();
    expectTypeOf<FirePeriodRowDto>().toExtend<FirePeriodRow>();
  });

  it('FireRow is assignable to FireRowDto, and back', () => {
    expectTypeOf<FireRow>().toExtend<FireRowDto>();
    expectTypeOf<FireRowDto>().toExtend<FireRow>();
  });

  it('FireProjection is assignable to FireProjectionDto, and back', () => {
    expectTypeOf<FireProjection>().toExtend<FireProjectionDto>();
    expectTypeOf<FireProjectionDto>().toExtend<FireProjection>();
  });

  it('FireMilestone is assignable to FireMilestoneDto, and back', () => {
    expectTypeOf<FireMilestone>().toExtend<FireMilestoneDto>();
    expectTypeOf<FireMilestoneDto>().toExtend<FireMilestone>();
  });

  it('the fixtures’ recorded input is a FireProjectionInput, and back', () => {
    expectTypeOf<FireFixtureProjectionInput>().toExtend<FireProjectionInput>();
    expectTypeOf<FireProjectionInput>().toExtend<FireFixtureProjectionInput>();
  });
});
