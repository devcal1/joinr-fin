// Migration equivalence (stage-4.md §3.5 item 6, §7.6 step 2): a workbook imported by Stage 3 and
// upgraded by migration 0004 holds the same rows (ids aside) as the same workbook imported by the
// Stage 4 importer (see ./stage3-upgrade.ts for how the Stage 3 database is rebuilt). The D37
// exclusion is importer-only (the migration cannot see the trades' windows as the sheet did), so
// these workbooks have SheetOptions "Retirement - Contributions in Savings Rate" set to No. The
// 0004 → 0005 equivalence (stage-5.md §3.5 item 4) follows the same pattern, at the end.
import { createTestDb, dumpDomainTables, type DomainDump } from '@joinr/schema/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSyntheticWorkbook,
  SYNTHETIC_FACTS,
  type SyntheticWorkbookOptions,
} from '../src/testing/syntheticWorkbook';
import {
  all,
  withLiveTotalsUnchanged,
  withNegativeHandPrice,
  withRetirementContributions,
} from './assets-helpers';
import { reportOf, runImport } from './helpers';
import {
  stage3MigrationsDir,
  stage3Shape,
  stage4MigrationsDir,
  stage4Shape,
  STAGE5_SNAPSHOT_COLUMNS,
  upgradeFrom,
  upgradeFromStage3,
  withoutIds,
} from './stage3-upgrade';

let stage3: ReturnType<typeof stage3MigrationsDir>;
beforeAll(() => {
  stage3 = stage3MigrationsDir();
});
afterAll(() => stage3.remove());

function stage4Import(opts: SyntheticWorkbookOptions): { dump: DomainDump; asOf: string } {
  const t = createTestDb();
  try {
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(opts)));
    return { dump: dumpDomainTables(t.db), asOf: report.workbook.asOf! };
  } finally {
    t.close();
  }
}

const switchOff = withRetirementContributions(false);

const VARIANTS: { name: string; opts: SyntheticWorkbookOptions; lastRunDated: boolean }[] = [
  { name: 'the clean workbook', opts: { mutate: switchOff }, lastRunDated: false },
  {
    name: 'live totals equal to the last frozen row’s (SPEC-16)',
    opts: { mutate: all(switchOff, withLiveTotalsUnchanged) },
    lastRunDated: true,
  },
  {
    name: 'two frozen rows in one month (the faulty variant; SPEC-12, FEAS-7)',
    opts: { variant: 'faulty', mutate: switchOff },
    lastRunDated: false,
  },
  {
    name: 'the faulty variant with unchanged live totals',
    opts: { variant: 'faulty', mutate: all(switchOff, withLiveTotalsUnchanged) },
    lastRunDated: true,
  },
  {
    name: 'a negative hand price (no price entry either way; Fixer round 1)',
    opts: { mutate: all(switchOff, withNegativeHandPrice) },
    lastRunDated: false,
  },
];

describe('migration 0004 ≡ the Stage 4 importer (ids aside)', () => {
  for (const v of VARIANTS) {
    it(v.name, () => {
      const { dump, asOf } = stage4Import(v.opts);
      // Not vacuous: every converted table has rows, and the date rule is exercised.
      for (const table of [
        'other_asset_prices',
        'super_balance_entries',
        'property_valuations',
        'loan_balance_entries',
      ]) {
        expect(dump[table]!.length, table).toBeGreaterThan(0);
      }
      expect(
        dump.super_entries!.filter((e) => String(e.sheet_ref).startsWith('History!R')),
      ).toHaveLength(4);
      const fundDates = new Set(dump.super_balance_entries!.map((e) => e.as_of));
      expect([...fundDates]).toEqual([v.lastRunDated ? SYNTHETIC_FACTS.lastRun : asOf]);

      const upgraded = upgradeFromStage3(stage3.dir, stage3Shape(dump, asOf), asOf);
      expect(Object.keys(upgraded).sort()).toEqual(Object.keys(dump).sort());
      expect(withoutIds(upgraded)).toEqual(withoutIds(dump));
    });
  }

  it('would catch a difference (the comparison is not vacuous)', () => {
    const { dump, asOf } = stage4Import({ mutate: switchOff });
    const upgraded = upgradeFromStage3(stage3.dir, stage3Shape(dump, asOf), asOf);
    upgraded.super_entries = upgraded.super_entries!.map((e) =>
      e.sheet_ref === 'Super!B16' ? { ...e, entry_date: null } : e,
    );
    expect(withoutIds(upgraded)).not.toEqual(withoutIds(dump));
  });
});

// Stage 5 (stage-5.md §3.5 item 4): the Stage 5 importer's Drizzle inserts name every column, so
// it cannot write into a 0004 schema. The 0004 database is rebuilt from the Stage 5 import's dump
// without the six new snapshot columns, upgraded through 0005 and compared (ids aside).
const STAGE5_VARIANTS: { name: string; opts: SyntheticWorkbookOptions }[] = [
  { name: 'the clean workbook', opts: {} },
  { name: 'unchanged live totals', opts: { mutate: withLiveTotalsUnchanged } },
  {
    name: 'two frozen rows in one month (the faulty duplicate-month variant)',
    opts: { variant: 'faulty' },
  },
];

describe('migration 0005 ≡ the Stage 5 importer (ids aside)', () => {
  let stage4: ReturnType<typeof stage4MigrationsDir>;
  beforeAll(() => {
    stage4 = stage4MigrationsDir();
  });
  afterAll(() => stage4.remove());

  for (const v of STAGE5_VARIANTS) {
    it(v.name, () => {
      const { dump, asOf } = stage4Import(v.opts);
      const snaps = dump.snapshots ?? [];
      // Not vacuous: snapshots exist, and the importer leaves the new columns null (revision 0).
      expect(snaps.length).toBeGreaterThan(0);
      for (const s of snaps) {
        expect(STAGE5_SNAPSHOT_COLUMNS.map((c) => s[c])).toEqual([null, null, null, null, null, 0]);
        expect([s.source, s.origin, s.recorded_at]).toEqual(['migrated', 'import', null]);
      }
      const older = stage4Shape(dump);
      expect(Object.keys(older.snapshots![0]!)).not.toContain('revision');

      const upgraded = upgradeFrom(stage4.dir, older, asOf);
      expect(Object.keys(upgraded).sort()).toEqual(Object.keys(dump).sort());
      expect(withoutIds(upgraded)).toEqual(withoutIds(dump));
    });
  }

  it('the faulty variant keeps one snapshot per month either way', () => {
    const { dump, asOf } = stage4Import({ variant: 'faulty' });
    const months = (d: typeof dump) => (d.snapshots ?? []).map((s) => s.period_month).sort();
    const upgraded = upgradeFrom(stage4.dir, stage4Shape(dump), asOf);
    expect(new Set(months(dump)).size).toBe(months(dump).length);
    expect(months(upgraded)).toEqual(months(dump));
  });

  it('would catch a difference (the comparison is not vacuous)', () => {
    const { dump, asOf } = stage4Import({});
    const upgraded = upgradeFrom(stage4.dir, stage4Shape(dump), asOf);
    const first = upgraded.snapshots![0]!;
    upgraded.snapshots = upgraded.snapshots!.map((s) => (s === first ? { ...s, revision: 1 } : s));
    expect(withoutIds(upgraded)).not.toEqual(withoutIds(dump));
  });
});
