// Migration equivalence (stage-4.md §3.5 item 6, §7.6 step 2): a workbook imported by Stage 3 and
// upgraded by migration 0004 holds the same rows (ids aside) as the same workbook imported by the
// Stage 4 importer (see ./stage3-upgrade.ts for how the Stage 3 database is rebuilt). The D37
// exclusion is importer-only (the migration cannot see the trades' windows as the sheet did), so
// these workbooks have SheetOptions "Retirement - Contributions in Savings Rate" set to No.
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
import { stage3MigrationsDir, stage3Shape, upgradeFromStage3, withoutIds } from './stage3-upgrade';

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
