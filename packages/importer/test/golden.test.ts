// Golden import of the owner's local workbook (stage-1.md §7.3 step 7). Skipped when the
// git-ignored reference/ folder has no single workbook. Every expected value is read from the
// workbook at runtime: this file holds no owner values, and the report is never written to disk.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INSTRUMENT_KINDS, type ReconciliationReport } from '@joinr/schema';
import {
  createTestDb,
  dumpDomainTables,
  type DomainDump,
  type TestDb,
} from '@joinr/schema/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CORRECTIONS_FILE_NAME,
  importWorkbook,
  parseCorrectionsFile,
  readWorkbook,
} from '../src/index';
import { historyRows } from '../src/extract';
import { investmentLayout } from '../src/layout';
import { openWorkbook } from '../src/reader';
import { describeWithLocalWorkbook, REFERENCE_DIR } from '../src/testing/localWorkbook';

const GOLDEN_TIMEOUT = 120_000;

describeWithLocalWorkbook('golden: the local workbook', (path) => {
  describe('import', { timeout: GOLDEN_TIMEOUT }, () => {
    let t: TestDb;
    let bytes: Uint8Array;
    let report: ReconciliationReport;
    let secondReport: ReconciliationReport;
    let firstDump: DomainDump;
    let elapsedMs = 0;

    beforeAll(() => {
      bytes = new Uint8Array(readFileSync(path));
      const correctionsPath = join(REFERENCE_DIR, CORRECTIONS_FILE_NAME);
      const corrections = existsSync(correctionsPath)
        ? parseCorrectionsFile(readFileSync(correctionsPath, 'utf8'))
        : null;
      t = createTestDb();
      const started = Date.now();
      const result = importWorkbook(t.db, {
        bytes,
        fileName: 'local.xlsx',
        trigger: 'cli',
        corrections,
      });
      elapsedMs = Date.now() - started;
      if (result.report === null)
        throw new Error(`golden import failed: ${result.errorCode ?? ''}`);
      report = result.report;
      firstDump = dumpDomainTables(t.db);
      // Idempotency: import the same bytes again.
      const again = importWorkbook(t.db, {
        bytes,
        fileName: 'local.xlsx',
        trigger: 'cli',
        corrections,
      });
      if (again.report === null) throw new Error('second golden import failed');
      secondReport = again.report;
    }, GOLDEN_TIMEOUT);

    afterAll(() => t.close());

    it('reconciles with zero unexplained checks, fast', () => {
      const unexplained = report.checks
        .filter((c) => c.status === 'unexplained')
        .map((c) => c.sheetRef ?? c.section);
      expect(unexplained).toEqual([]);
      expect(report.totals.unexplained).toBe(0);
      expect(elapsedMs).toBeLessThan(5_000);
    });

    it('writes as many trades as the workbook counts per ledger', () => {
      const r = readWorkbook(bytes);
      for (const kind of INSTRUMENT_KINDS) {
        const row = investmentLayout(kind).capitalGainsRow;
        const expected = r.number('Capital Gains', `AA${row}`);
        const check = report.checks.find((c) => c.id === `counts.trades.${kind}`);
        expect(check?.status === 'match' || check?.status === 'explained').toBe(true);
        if (expected !== null) expect(check?.actual).toBe(expected);
      }
    });

    it('stores one snapshot per frozen History row, with all 36 columns matching', () => {
      const frozen = historyRows(openWorkbook(bytes)).filter((h) => h.frozen);
      const values = report.checks.filter((c) => c.id.startsWith('snapshots.values.'));
      expect(values).toHaveLength(new Set(frozen.map((h) => h.date.slice(0, 7))).size);
      expect(values.length).toBeGreaterThan(0);
      expect(
        values.every((c) => c.status === 'match' && c.expected === 36 && c.actual === 36),
      ).toBe(true);
    });

    it('matches every held watch row’s units', () => {
      const units = report.checks.filter((c) => c.id.startsWith('holdings.units.'));
      expect(units.length).toBeGreaterThan(0);
      expect(units.every((c) => c.status === 'match')).toBe(true);
    });

    it('is idempotent: a second import leaves every table identical and the report stable', () => {
      expect(dumpDomainTables(t.db)).toEqual(firstDump);
      const view = (r: ReconciliationReport) =>
        r.checks.map((c) => [c.id, c.status, c.expected, c.actual]);
      expect(view(secondReport)).toEqual(view(report));
      expect(secondReport.totals).toEqual(report.totals);
    });
  });
});
