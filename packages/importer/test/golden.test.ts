// Golden import of the owner's local workbook (stage-1.md §7.3 step 7; the Stage 4 rows and the
// migration equivalence, stage-4.md §7.6; the Stage 5 settings lines and the 0005 equivalence,
// stage-5.md §7.6). Skipped when the git-ignored reference/ folder has no
// single workbook. Every expected value and rule input is read from the workbook at runtime: this
// file holds no owner values, and the report is never written to disk.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { centsFromNumber, INSTRUMENT_KINDS, type ReconciliationReport } from '@joinr/schema';
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
import {
  stage3MigrationsDir,
  stage3Shape,
  stage4MigrationsDir,
  stage4Shape,
  upgradeFromStage3,
  upgradeFrom,
  withoutIds,
} from './stage3-upgrade';

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

    it('writes one balance entry per account and dated deposits, never after the as-of (Stage 3)', () => {
      for (const id of [
        'counts.cash-accounts',
        'counts.cash-balance-entries',
        'counts.side-income',
        'income.stream.1',
        'income.stream.2',
        'income.total',
      ]) {
        expect(report.checks.find((c) => c.id === id)?.status).toBe('match');
      }
      expect(report.counts['cash-balance-entries']).toBe(report.counts['cash-accounts']);
      const asOf = report.workbook.asOf;
      const entries = firstDump.cash_balance_entries ?? [];
      expect(entries.length).toBe(report.counts['cash-accounts']);
      expect(entries.every((e) => e.as_of === asOf && e.origin === 'import')).toBe(true);
      const deposits = firstDump.side_income_deposits ?? [];
      expect(deposits.length).toBe(report.counts['side-income']);
      expect(
        deposits.every(
          (d) =>
            typeof d.deposit_date === 'string' &&
            asOf !== null &&
            d.deposit_date <= asOf &&
            d.amount_cents !== 0 &&
            d.origin === 'import',
        ),
      ).toBe(true);
      expect(firstDump.side_income_entries).toEqual([]);
      // Kinds as imported: every account is a bank account until the owner sets them.
      expect((firstDump.cash_accounts ?? []).every((a) => a.kind === 'bank')).toBe(true);
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

    it('writes the Stage 4 rows by their rules (stage-4.md §3.5)', () => {
      for (const id of [
        'counts.other-asset-prices',
        'counts.super-balance-entries',
        'counts.property-valuations',
        'counts.loan-balance-entries',
        'counts.super-entries',
        'super.contribution',
        'super.contributions.history',
        'otherAssets.cost',
      ]) {
        expect(report.checks.find((c) => c.id === id)?.status, id).toBe('match');
      }
      const r = openWorkbook(bytes);
      const asOf = report.workbook.asOf!;
      const lastRun = r.date('Net Worth', 'C51');
      const frozen = historyRows(r).filter((h) => h.frozen);
      const last = frozen.reduce((a, b) => (b.date >= a.date ? b : a));
      const cellCents = (sheet: string, addr: string) => {
        const n = r.number(sheet, addr);
        return n === null ? null : centsFromNumber(n);
      };
      const lastRunUsable = lastRun !== null && lastRun <= asOf;
      const rows = (table: string) => firstDump[table] ?? [];

      // Funds (§3.5 item 2): the last run when the live total equals the last frozen row's Q.
      const q = cellCents('History', `Q${last.row}`);
      const fundDate =
        lastRunUsable && q !== null && q === cellCents('Super', 'B12') ? lastRun : asOf;
      expect(rows('super_balance_entries').length).toBe(rows('super_funds').length);
      for (const e of rows('super_balance_entries')) {
        expect([e.as_of, e.transfer_in_cents, e.origin]).toEqual([fundDate, null, 'import']);
      }
      expect(rows('super_funds').every((f) => f.balance_as_of === fundDate)).toBe(true);

      // Loans (§3.5 item 4): one entry each, the current balance; the last-run rule for property
      // loans whose total equals the last frozen row's |AB| and that started before it.
      const ab = cellCents('History', `AB${last.row}`);
      const propertyLoans = rows('loans').filter((l) => l.property_id !== null);
      const unchanged =
        lastRunUsable &&
        ab !== null &&
        propertyLoans.length > 0 &&
        propertyLoans.reduce((s, l) => s + (l.current_balance_cents as number), 0) === Math.abs(ab);
      const loanEntries = rows('loan_balance_entries');
      expect(loanEntries.length).toBe(rows('loans').length);
      for (const l of rows('loans')) {
        const date =
          unchanged &&
          l.property_id !== null &&
          (l.start_date === null || (l.start_date as string) < lastRun)
            ? lastRun
            : asOf;
        const entries = loanEntries.filter((e) => e.loan_id === l.id);
        expect(entries.map((e) => [e.as_of, e.balance_cents, e.repayments_cents])).toEqual([
          [date, l.current_balance_cents, null],
        ]);
        expect(l.balance_as_of).toBe(date);
      }

      // Valuations and price entries at the as-of.
      expect(rows('property_valuations').length).toBe(rows('properties').length);
      expect(rows('property_valuations').every((v) => v.as_of === asOf)).toBe(true);
      expect(rows('other_asset_prices').every((p) => p.as_of === asOf)).toBe(true);

      // The live contribution: min(its month end, the as-of).
      const b16 = rows('super_entries').find((e) => e.sheet_ref === 'Super!B16');
      if (b16) {
        const [y, m] = String(b16.period_month).split('-').map(Number) as [number, number];
        const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        expect(b16.entry_date).toBe(monthEnd < asOf ? monthEnd : asOf);
      }
      // History-derived contributions: each at its own kept snapshot's run date and period.
      const derived = rows('super_entries').filter((e) =>
        String(e.sheet_ref).startsWith('History!R'),
      );
      for (const e of derived) {
        const row = Number(String(e.sheet_ref).slice('History!R'.length));
        const date = r.date('History', `A${row}`);
        expect([e.entry_date, e.period_month, e.fund_id]).toEqual([date, date?.slice(0, 7), null]);
        expect(frozen.some((h) => h.row === row)).toBe(true);
      }
      expect(new Set(derived.map((e) => e.period_month)).size).toBe(derived.length);
    });

    it('matches migration 0004 run on a Stage 3 import of the same workbook (§3.5 item 6)', () => {
      // The D37 exclusion is importer-only: skip when the import applied it.
      if (report.checks.some((c) => c.id === 'super.contributions.retirementExcluded')) return;
      const asOf = report.workbook.asOf!;
      const stage3 = stage3MigrationsDir();
      try {
        const upgraded = upgradeFromStage3(stage3.dir, stage3Shape(firstDump, asOf), asOf);
        expect(withoutIds(upgraded)).toEqual(withoutIds(firstDump));
      } finally {
        stage3.remove();
      }
    });

    it('reports no settings reset or kept preference on a fresh import or its repeat (stage-5.md §3.5)', () => {
      for (const r of [report, secondReport]) {
        expect(
          r.checks.filter(
            (c) => c.id === 'settings.resetToDefault' || c.id === 'settings.keptAppPreference',
          ),
        ).toEqual([]);
      }
      expect((firstDump.settings ?? []).every((s) => s.origin === 'import')).toBe(true);
    });

    it('matches migration 0005 run on a Stage 4 import of the same workbook (stage-5.md §3.5 item 4)', () => {
      const asOf = report.workbook.asOf!;
      const snaps = firstDump.snapshots ?? [];
      expect(snaps.length).toBeGreaterThan(0);
      expect(snaps.every((s) => s.offset_cents === null && s.revision === 0)).toBe(true);
      const stage4 = stage4MigrationsDir();
      try {
        const upgraded = upgradeFrom(stage4.dir, stage4Shape(firstDump), asOf);
        expect(withoutIds(upgraded)).toEqual(withoutIds(firstDump));
      } finally {
        stage4.remove();
      }
    });
  });
});
