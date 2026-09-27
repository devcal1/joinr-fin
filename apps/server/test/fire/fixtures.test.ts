// The fixture-consistency test (stage-6.md §3.6, §7.4 step 5), gated on FIRE_ENGINE_IMPLEMENTED:
// `projectFire` on each fixture's recorded input reproduces that fixture's projection, every money
// figure within 1 cent (the fixtures were made in doubles and rounded once), every other field
// exactly (statuses, missing lists, years, ages, phases, ratios' texts). A mismatch is a contract
// question for the coordinator (the fixtures are the Scaffolder's contract), not a test to loosen.
import { engine, FIRE_ENGINE_IMPLEMENTED } from '@joinr/engine';
import { fireFixtureInputs, firePages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { fireProjectionDto } from '../../src/fire/page';

/** Every difference between two JSON values: numbers under a `…Cents` key within 1 cent. */
function differences(ours: unknown, fixture: unknown, path = '', key = ''): string[] {
  if (typeof ours === 'number' && typeof fixture === 'number') {
    const tol = key.endsWith('Cents') ? 1 : 0;
    return Math.abs(ours - fixture) <= tol ? [] : [`${path}: ${ours} ≠ ${fixture}`];
  }
  if (Array.isArray(ours) && Array.isArray(fixture)) {
    if (ours.length !== fixture.length) {
      return [`${path}: length ${ours.length} ≠ ${fixture.length}`];
    }
    return ours.flatMap((v, i) => differences(v, fixture[i], `${path}[${i}]`, key));
  }
  if (
    ours !== null &&
    fixture !== null &&
    typeof ours === 'object' &&
    typeof fixture === 'object' &&
    !Array.isArray(ours) &&
    !Array.isArray(fixture)
  ) {
    const keys = new Set([...Object.keys(ours), ...Object.keys(fixture)]);
    return [...keys].flatMap((k) =>
      differences(
        (ours as Record<string, unknown>)[k],
        (fixture as Record<string, unknown>)[k],
        `${path}.${k}`,
        k,
      ),
    );
  }
  return Object.is(ours, fixture)
    ? []
    : [`${path}: ${JSON.stringify(ours)} ≠ ${JSON.stringify(fixture)}`];
}

describe('differences (the comparison itself)', () => {
  it('allows 1 cent on money only', () => {
    expect(differences({ aCents: 100 }, { aCents: 101 })).toEqual([]);
    expect(differences({ aCents: 100 }, { aCents: 102 })).toHaveLength(1);
    expect(differences({ year: 2030 }, { year: 2031 })).toHaveLength(1);
    expect(differences({ r: '0.04' }, { r: '0.040' })).toHaveLength(1);
    expect(differences({ a: [1] }, { a: [1, 2] })).toHaveLength(1);
    expect(differences({ a: null }, { a: 0 })).toHaveLength(1);
    expect(differences({ rows: [{ endCents: 5 }] }, { rows: [{ endCents: 6 }] })).toEqual([]);
  });
});

describe.skipIf(!FIRE_ENGINE_IMPLEMENTED)(
  'projectFire reproduces every firePages projection within 1 cent (§3.6)',
  () => {
    for (const [state, page] of Object.entries(firePages)) {
      it(state, () => {
        const input = fireFixtureInputs[state as keyof typeof firePages];
        const ours = fireProjectionDto(engine.projectFire(input));
        expect(differences(ours, page.projection, 'projection')).toEqual([]);
      });
    }
  },
);
