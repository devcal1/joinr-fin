// Secrets are never stored (D24; stage-1.md §2.5): the SheetOptions ID 1 and ID 29 values appear in
// no text column of any table, import_runs.report_json included — also for dry and failed runs.
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSyntheticWorkbook, SYNTHETIC_FACTS } from '../src/testing/syntheticWorkbook';
import { reportOf, runImport } from './helpers';

function textValues(t: TestDb): string[] {
  const tables = t.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  const values: string[] = [];
  for (const { name } of tables) {
    for (const row of t.sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<
      string,
      unknown
    >[]) {
      for (const v of Object.values(row)) if (typeof v === 'string') values.push(v);
    }
  }
  return values;
}

describe('secrets never stored', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it('keeps the placeholder email and API key out of every table', () => {
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    reportOf(runImport(t.db, buildSyntheticWorkbook(), { dryRun: true }));
    const values = textValues(t);
    expect(values.length).toBeGreaterThan(100);
    // Sanity: the scan sees the stored reports.
    expect(values.filter((v) => v.startsWith('{"version":1'))).toHaveLength(2);
    for (const secret of SYNTHETIC_FACTS.secretValues) {
      expect(values.filter((v) => v.includes(secret))).toEqual([]);
      expect(JSON.stringify(report)).not.toContain(secret);
    }
  });

  it('never reports them, even when the secret cells hold other text', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        wb.Sheets.SheetOptions!.L3 = { t: 's', v: 'another.person@example.com' };
        wb.Sheets.SheetOptions!.L31 = { t: 's', v: 'sk-example-not-a-real-key' };
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    const text = JSON.stringify(report) + textValues(t).join('\n');
    expect(text).not.toContain('another.person@example.com');
    expect(text).not.toContain('sk-example-not-a-real-key');
  });
});
