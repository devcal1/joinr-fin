// Owner corrections (D27; stage-1.md §4.5) with synthetic corrections only: applied, unmatched,
// skipped, explained through "recompute without corrections", and invalid files.
import type { CorrectionsFile } from '@joinr/schema';
import { dividends, trades } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CorrectionsError, parseCorrectionsFile } from '../src/index';
import { buildSyntheticWorkbook } from '../src/testing/syntheticWorkbook';
import { checkById, reportOf, runImport } from './helpers';
import type { ReconciliationReport } from '@joinr/schema';

const FILE: CorrectionsFile = parseCorrectionsFile(
  JSON.stringify({
    version: 1,
    corrections: [
      {
        id: 'S1',
        target: 'trade',
        match: { sheet: 'Crypto', row: 19, symbol: 'BTC', date: '2026-01-25', units: '0.005' },
        set: { date: '2025-12-20' },
        reason: 'Synthetic: moves a trade across snapshot windows',
      },
      {
        id: 'S2',
        target: 'trade',
        match: { sheet: 'Stocks', symbol: 'ASX:ABC', date: '2025-10-10', price: '10.00' },
        set: { units: '101' },
        reason: 'Synthetic: a units fix',
      },
      {
        id: 'S3',
        target: 'trade',
        match: { sheet: 'ETFs', symbol: 'ASX:ZZZ', date: '2025-10-10' },
        set: { price: '1' },
        reason: 'Synthetic: matches nothing',
      },
      {
        id: 'S4',
        target: 'dividend',
        match: { ticker: 'ASX:XYZ', paymentDate: '2025-05-10', netAmountCents: 1000 },
        action: 'skip',
        reason: 'Synthetic: a duplicated dividend',
      },
      {
        id: 'S5',
        target: 'dividend',
        match: { row: 7, ticker: 'EXAMPLEFUND', paymentDate: '2026-02-10' },
        set: { netAmountCents: 600, reinvested: true },
        reason: 'Synthetic: an amount fix',
      },
      {
        id: 'S6',
        target: 'trade',
        match: { sheet: 'ETFs', symbol: 'ASX:DEF', date: '2026-02-03' },
        action: 'skip',
        reason: 'Synthetic: a row entered twice',
      },
    ],
  }),
);

describe('importWorkbook: corrections', () => {
  let t: TestDb;
  let report: ReconciliationReport;
  beforeAll(() => {
    t = createTestDb();
    report = reportOf(
      runImport(t.db, buildSyntheticWorkbook(), {
        corrections: FILE,
        correctionsSource: { name: 'synthetic-corrections.json', sha256: 'a'.repeat(64) },
      }),
    );
  });
  afterAll(() => t.close());

  it('summarises the corrections file', () => {
    expect(report.corrections).toEqual({
      name: 'synthetic-corrections.json',
      sha256: 'a'.repeat(64),
      entries: 6,
      applied: 5,
    });
  });

  it('applies a date correction and explains the moved movements', () => {
    expect(checkById(report, 'corrections.S1')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
      unit: 'date',
      expected: '2026-01-25',
      actual: '2025-12-20',
      sheetRef: 'Crypto!A19',
    });
    const row = t.db
      .select()
      .from(trades)
      .all()
      .find((x) => x.sheetRef === 'Crypto!A19');
    expect(row).toMatchObject({ tradeDate: '2025-12-20', correctionId: 'S1' });
    expect(checkById(report, 'movements.2025-12.crypto')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
    expect(checkById(report, 'movements.2026-01.crypto')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
    expect(checkById(report, 'holdings.units.crypto.BTC').status).toBe('match');
  });

  it('explains checks a units correction touches', () => {
    expect(checkById(report, 'corrections.S2')).toMatchObject({
      status: 'explained',
      expected: '100',
      actual: '101',
    });
    expect(checkById(report, 'holdings.units.stock.ASX:ABC')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
      expected: '160',
      actual: '161',
    });
    expect(checkById(report, 'ledgers.orderValue.stock')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
    expect(checkById(report, 'movements.2025-10.stocks')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
  });

  it('reports a correction that matches nothing as unexplained and changes nothing', () => {
    expect(checkById(report, 'corrections.S3')).toMatchObject({
      status: 'unexplained',
      reasonCode: 'correction_unmatched',
    });
    expect(report.totals.unexplained).toBe(1);
  });

  it('skips rows and explains the counts and totals', () => {
    expect(checkById(report, 'corrections.S4')).toMatchObject({
      status: 'explained',
      actual: 'skipped',
    });
    expect(checkById(report, 'counts.dividends')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
      expected: 4,
      actual: 3,
    });
    expect(checkById(report, 'dividends.fy.2024-2025.stock')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
    expect(checkById(report, 'counts.trades.etf')).toMatchObject({
      status: 'explained',
      expected: 6,
      actual: 5,
    });
    expect(checkById(report, 'holdings.units.etf.ASX:DEF')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
    expect(
      t.db
        .select()
        .from(trades)
        .all()
        .some((x) => x.sheetRef === 'ETFs!A29'),
    ).toBe(false);
  });

  it('applies dividend field corrections', () => {
    const row = t.db
      .select()
      .from(dividends)
      .all()
      .find((d) => d.sheetRef === 'Dividends!A7');
    expect(row).toMatchObject({ netAmountCents: 600, reinvested: true, correctionId: 'S5' });
    expect(checkById(report, 'corrections.S5')).toMatchObject({
      status: 'explained',
      expected: 'netAmountCents=550; reinvested=blank',
      actual: 'netAmountCents=600; reinvested=true',
    });
    expect(checkById(report, 'dividends.fy.2025-2026.managed_fund')).toMatchObject({
      status: 'explained',
      reasonCode: 'correction',
    });
  });

  it('matches several rows → unmatched', () => {
    const t2 = createTestDb();
    try {
      const file = parseCorrectionsFile(
        JSON.stringify({
          version: 1,
          corrections: [
            {
              id: 'M1',
              target: 'trade',
              match: { sheet: 'Stocks', symbol: 'ASX:ABC', date: '2025-10-10' },
              set: { units: '1' },
              reason: 'x',
            },
            {
              id: 'M2',
              target: 'trade',
              match: { sheet: 'Stocks', symbol: 'ASX:ABC', date: '2025-10-10' },
              set: { price: '1' },
              reason: 'y',
            },
          ],
        }),
      );
      // Two corrections on one row are fine; a match on several rows is not.
      const dup = buildSyntheticWorkbook({
        mutate: (wb) => {
          const ws = wb.Sheets.Stocks!;
          ws.A40 = { t: 's', v: 'ASX:ABC' };
          ws.B40 = { t: 'n', v: 45940 }; // the same date as row 23 (2025-10-10)
          ws.C40 = { t: 'n', v: 1 };
          ws.D40 = { t: 'n', v: 10 };
          ws['!ref'] = 'A1:T45';
        },
      });
      const r2 = reportOf(runImport(t2.db, dup, { corrections: file }));
      expect(checkById(r2, 'corrections.M1')).toMatchObject({
        status: 'unexplained',
        reasonCode: 'correction_unmatched',
      });
      expect(checkById(r2, 'corrections.M1').reason).toContain('matched 2 rows');
      // Two corrections on the same single row both apply.
      const t3 = createTestDb();
      try {
        const r3 = reportOf(runImport(t3.db, buildSyntheticWorkbook(), { corrections: file }));
        expect(checkById(r3, 'corrections.M1')).toMatchObject({ status: 'explained', actual: '1' });
        expect(checkById(r3, 'corrections.M2')).toMatchObject({ status: 'explained', actual: '1' });
        const row = t3.db
          .select()
          .from(trades)
          .all()
          .find((x) => x.sheetRef === 'Stocks!A23');
        expect(row).toMatchObject({ units: '1', price: '1', correctionId: 'M1,M2' });
        expect(checkById(r3, 'holdings.units.stock.ASX:ABC')).toMatchObject({
          status: 'explained',
          reasonCode: 'correction',
        });
      } finally {
        t3.close();
      }
    } finally {
      t2.close();
    }
  });
});

describe('parseCorrectionsFile', () => {
  it('rejects invalid JSON, unknown shapes and duplicate ids', () => {
    expect(() => parseCorrectionsFile('{')).toThrow(CorrectionsError);
    expect(() => parseCorrectionsFile('{"version":2,"corrections":[]}')).toThrow(CorrectionsError);
    const dup = {
      id: 'D',
      target: 'trade',
      match: { sheet: 'Stocks', symbol: 'A', date: '2026-01-01' },
      action: 'skip',
      reason: 'r',
    };
    expect(() =>
      parseCorrectionsFile(JSON.stringify({ version: 1, corrections: [dup, dup] })),
    ).toThrow(/duplicate/);
    try {
      parseCorrectionsFile('[]');
    } catch (e) {
      expect(e).toBeInstanceOf(CorrectionsError);
      expect((e as CorrectionsError).code).toBe('INVALID_CORRECTIONS');
    }
  });
});
