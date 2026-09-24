// The faulty synthetic variant (stage-1.md §7.3 step 6): each documented fault gets the expected
// status and reason; suspect rows are imported as-is (D26).
import { parseReviewFlags } from '@joinr/schema';
import { dividends, trades } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSyntheticWorkbook } from '../src/testing/syntheticWorkbook';
import { checkById, reportOf, runImport } from './helpers';
import type { ReconciliationReport } from '@joinr/schema';

describe('importWorkbook: faulty synthetic workbook', () => {
  let t: TestDb;
  let report: ReconciliationReport;
  beforeAll(() => {
    t = createTestDb();
    report = reportOf(runImport(t.db, buildSyntheticWorkbook({ variant: 'faulty' })));
  });
  afterAll(() => t.close());

  const flagsOf = (sheetRef: string) => {
    const row = t.db
      .select()
      .from(trades)
      .all()
      .find((x) => x.sheetRef === sheetRef);
    return row ? parseReviewFlags(row.reviewFlags) : null;
  };

  it('flags an out-of-order ledger row but imports it', () => {
    expect(flagsOf('ETFs!A29')).toEqual(['out_of_order']);
    expect(checkById(report, 'suspects.trades.ETFs!A29')).toMatchObject({
      status: 'suspect',
      reasonCode: 'suspect_row',
      refs: { entity: 'trades', flags: ['out_of_order'] },
    });
  });

  it('flags a price outlier', () => {
    expect(flagsOf('Managed Funds!A26')).toContain('price_outlier');
    expect(checkById(report, 'suspects.trades.Managed Funds!A26').status).toBe('suspect');
  });

  it('flags an oversell', () => {
    expect(flagsOf('Stocks!A28')).toContain('oversell');
    expect(flagsOf('Stocks!A26')).toEqual([]);
  });

  it('flags an unmatched dividend ticker', () => {
    const row = t.db
      .select()
      .from(dividends)
      .all()
      .find((d) => d.sheetRef === 'Dividends!A9');
    expect(row?.instrumentId).toBeNull();
    expect(parseReviewFlags(row!.reviewFlags)).toEqual(['unmatched_ticker']);
    expect(checkById(report, 'dividends.link.9')).toMatchObject({
      status: 'suspect',
      reasonCode: 'unmatched_dividend',
      expected: 'ZZZ',
      actual: null,
    });
  });

  it('reports a held-units mismatch as unexplained', () => {
    expect(checkById(report, 'holdings.units.stock.ASX:ABC')).toMatchObject({
      status: 'unexplained',
      expected: '161',
      actual: '160',
      diff: '-1',
    });
  });

  it('reports a movement mismatch as unexplained', () => {
    expect(checkById(report, 'movements.2025-12.etf')).toMatchObject({
      status: 'unexplained',
      diff: -10000,
    });
  });

  it('keeps the later snapshot of a duplicated month and reports the other', () => {
    expect(checkById(report, 'snapshots.period.2026-01')).toMatchObject({
      status: 'unexplained',
      actual: '2026-01-31',
    });
    expect(checkById(report, 'counts.snapshots')).toMatchObject({
      status: 'unexplained',
      expected: 6,
      actual: 5,
    });
    expect(checkById(report, 'snapshots.order').status).toBe('match');
  });

  it('keeps unrelated checks clean', () => {
    expect(checkById(report, 'holdings.units.stock.ASX:XYZ').status).toBe('match');
    expect(checkById(report, 'ledgers.orderValue.etf').status).toBe('match');
    expect(checkById(report, 'cash.total').status).toBe('match');
    expect(checkById(report, 'snapshots.values.2025-12').status).toBe('match');
  });
});
