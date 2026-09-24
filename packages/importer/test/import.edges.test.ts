// Edge cases on mutated synthetic workbooks (stage-1.md §4.2–§4.9, §7.3 step 6).
import type { CellObject, WorkBook } from 'xlsx';
import {
  importRuns,
  instruments,
  loans,
  otherAssets,
  priceSources,
  prices,
  settings,
} from '@joinr/schema/db';
import { createTestDb, dumpDomainTablesJson, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSyntheticWorkbook, SYNTHETIC_HISTORY_TMP } from '../src/testing/syntheticWorkbook';
import { checkById, problems, reportOf, runImport } from './helpers';

function set(wb: WorkBook, sheet: string, addr: string, cell: CellObject | null): void {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`no sheet ${sheet}`);
  if (cell === null) delete ws[addr];
  else ws[addr] = cell;
}

const num = (v: number, f?: string): CellObject =>
  f === undefined ? { t: 'n', v } : { t: 'n', v, f };
const str = (v: string, f?: string): CellObject =>
  f === undefined ? { t: 's', v } : { t: 's', v, f };

describe('importWorkbook: edge cases', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  const idOf = (symbol: string) =>
    t.db
      .select()
      .from(instruments)
      .all()
      .find((i) => i.symbol === symbol)!.id;

  it('treats every value in the crypto spill range as a formula result, never a manual price', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        set(wb, 'Crypto', 'B2', num(61000.5, 'IF(SheetOptions!$D$48="","CoinMarketCap","")'));
        set(wb, 'Crypto', 'B3', num(3100.25)); // a spilled value: no formula of its own
        set(wb, 'Crypto', 'E2', num(0.015 * 61000.5));
        set(wb, 'Crypto', 'E3', num(0.5 * 3100.25));
        const value = 0.015 * 61000.5 + 0.5 * 3100.25;
        set(wb, 'Crypto', 'E9', num(value, 'IFERROR(sum(E2:E7),"-")'));
        // Net Worth follows the crypto total.
        const nw = wb.Sheets['Net Worth']!;
        const c12 = (nw.C12 as CellObject).v as number;
        const d15 = (nw.D15 as CellObject).v as number;
        set(wb, 'Net Worth', 'C7', num(value, 'Crypto!E9'));
        set(wb, 'Net Worth', 'C12', num(c12 + value, 'sum(C4:C11)'));
        set(wb, 'Net Worth', 'D15', num(d15 + value, 'C12+E23'));
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    expect(problems(report)).toEqual([]);
    const eth = idOf('ETH');
    expect(
      t.db
        .select()
        .from(prices)
        .all()
        .find((p) => p.instrumentId === eth),
    ).toMatchObject({ price: '3100.25', source: 'sheet' });
    expect(
      t.db
        .select()
        .from(priceSources)
        .all()
        .find((p) => p.instrumentId === eth),
    ).toMatchObject({ manualPrice: null, manualOrigin: null });
    expect(checkById(report, 'holdings.price.crypto.ETH')).toMatchObject({
      status: 'match',
      expected: '3100.25',
      actual: '3100.25',
    });
    expect(checkById(report, 'holdings.price.crypto.BTC')).toMatchObject({
      status: 'match',
      actual: '61000.5',
    });
    expect(checkById(report, 'holdings.value.crypto').status).toBe('match');
  });

  it('reports a non-zero capital gains liabilities slot as explained and still reconciles liabilities', () => {
    const cgt = 1234.5;
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        set(wb, 'LiabilitiesDebts', 'G17', num(cgt, 'IF(SheetOptions!$L$39="Yes",1,0)'));
        const d3 = -(15000.25 + cgt);
        set(
          wb,
          'LiabilitiesDebts',
          'D3',
          num(d3, 'IF(\'First Time Setup\'!E31<>"No",-abs(sum(C17:G17)),0)'),
        );
        const nw = wb.Sheets['Net Worth']!;
        const e21 = (nw.E21 as CellObject).v as number;
        const c12 = (nw.C12 as CellObject).v as number;
        set(wb, 'Net Worth', 'E20', num(d3, 'abs(LiabilitiesDebts!D3)*-1'));
        set(wb, 'Net Worth', 'E23', num(d3 + e21, 'sum(E20:E22)'));
        set(wb, 'Net Worth', 'D15', num(c12 + d3 + e21, 'C12+E23'));
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    expect(problems(report)).toEqual([]);
    expect(checkById(report, 'liabilities.cgtSlot')).toMatchObject({
      status: 'explained',
      reasonCode: 'feature_dropped',
      expected: 123450,
      refs: { decision: 'D2' },
    });
    expect(checkById(report, 'netWorth.liabilities').status).toBe('match');
    expect(checkById(report, 'netWorth.total')).toMatchObject({ status: 'explained', diff: 54270 });
    expect(t.db.select().from(loans).all()).toHaveLength(2);
  });

  it('fails the import when two History value columns are swapped', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        const ws = wb.Sheets[SYNTHETIC_HISTORY_TMP]!;
        for (let r = 2; r <= 9; r++) {
          const b = ws[`B${r}`] as CellObject | undefined;
          const f = ws[`F${r}`] as CellObject | undefined;
          if (f) ws[`B${r}`] = f;
          if (b) ws[`F${r}`] = b;
        }
      },
    });
    const result = runImport(t.db, bytes);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_WORKBOOK');
    expect(result.error).toMatch(/History.*column B/);
    expect(t.db.select().from(instruments).all()).toHaveLength(0);
    expect(t.db.select().from(importRuns).all()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_WORKBOOK',
      reportJson: null,
    });
  });

  it('fails cleanly on bytes that are not a template workbook', () => {
    const before = dumpDomainTablesJson(t.db);
    for (const bytes of [
      new TextEncoder().encode('hello, not a workbook'),
      new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]),
    ]) {
      const result = runImport(t.db, bytes);
      expect(result).toMatchObject({
        status: 'failed',
        errorCode: 'INVALID_WORKBOOK',
        report: null,
      });
    }
    const missing = buildSyntheticWorkbook({
      mutate: (wb) => {
        wb.SheetNames = wb.SheetNames.filter((n) => n !== 'Budget');
        delete wb.Sheets.Budget;
      },
    });
    expect(runImport(t.db, missing)).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_WORKBOOK',
      error: expect.stringMatching(/Budget/) as unknown,
    });
    const shifted = buildSyntheticWorkbook({
      mutate: (wb) => set(wb, 'Stocks', 'A22', str('Symbol')),
    });
    expect(runImport(t.db, shifted)).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_WORKBOOK',
      error: expect.stringMatching(/Stocks!A22/) as unknown,
    });
    expect(dumpDomainTablesJson(t.db)).toBe(before);
    expect(
      t.db
        .select()
        .from(importRuns)
        .all()
        .every((r) => r.status === 'failed'),
    ).toBe(true);
  });

  it('stores a typed override and reports it as a match', () => {
    const bytes = buildSyntheticWorkbook({ mutate: (wb) => set(wb, 'Budget', 'D3', num(7000)) });
    const report = reportOf(runImport(t.db, bytes));
    expect(checkById(report, 'settings.budget.emergencyFundOverrideCents')).toMatchObject({
      status: 'match',
      expected: 700000,
      actual: 700000,
    });
    const row = t.db
      .select()
      .from(settings)
      .all()
      .find((s) => s.key === 'budget.emergencyFundOverrideCents');
    expect(row?.valueJson).toBe('700000');
  });

  it('checks SheetOptions labels and the AUD-only settings', () => {
    const clean = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    // A label with an internal newline, one with a trailing colon, and an en dash for a hyphen.
    for (const id of [8, 9, 16])
      expect(checkById(clean, `settings.sheetOptions.${id}`).status).toBe('match');
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        set(wb, 'SheetOptions', 'K4', str('Something Else'));
        set(wb, 'SheetOptions', 'L24', str('USD'));
        set(wb, 'SheetOptions', 'L9', str('Every Full Moon'));
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    expect(checkById(report, 'settings.sheetOptions.2')).toMatchObject({
      status: 'unexplained',
      reasonCode: 'template_mismatch',
    });
    expect(checkById(report, 'settings.sheetOptions.22')).toMatchObject({
      status: 'unexplained',
      reasonCode: 'unsupported_value',
      expected: 'USD',
    });
    expect(checkById(report, 'settings.sheetOptions.7')).toMatchObject({
      status: 'unexplained',
      reasonCode: 'unsupported_value',
    });
  });

  it('reports the secret settings without their values', () => {
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    for (const id of [1, 29]) {
      expect(checkById(report, `settings.sheetOptions.${id}`)).toMatchObject({
        status: 'explained',
        reasonCode: 'secret_not_imported',
        expected: null,
        actual: null,
        diff: null,
      });
    }
  });

  it('links bullion other assets to the built-in series and keeps hyperlinks', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const rows = t.db.select().from(otherAssets).all();
    const by = (ref: string) => rows.find((r) => r.sheetRef === ref)!;
    for (const ref of ['Other Assets!F7', 'Other Assets!F8']) {
      expect(by(ref)).toMatchObject({
        priceSource: 'bullion',
        metal: 'silver',
        unitOfMeasure: 'oz',
        ozPerUnit: '1',
        unitPrice: '50.5',
      });
    }
    expect(by('Other Assets!F8').soldUnits).toBe('1');
    expect(by('Other Assets!F3')).toMatchObject({
      priceSource: 'manual',
      metal: null,
      unitOfMeasure: 'each',
      url: null,
    });
    expect(by('Other Assets!F4').url).toBe('https://example.com/items/1');
    expect(by('Other Assets!F6').url).toBe('https://example.com/print');
  });

  it('does not treat a typed or cyclic price chain as bullion', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        set(wb, 'Other Assets', 'K7', num(50.5, 'K8'));
        set(wb, 'Other Assets', 'K8', num(50.5, 'K7'));
      },
    });
    runImport(t.db, bytes);
    const rows = t.db.select().from(otherAssets).all();
    expect(rows.filter((r) => r.priceSource === 'bullion')).toHaveLength(0);
  });

  it('excludes feed rows only while they are empty', () => {
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    expect(checkById(report, 'exclusions.Managed Funds!A3')).toMatchObject({
      status: 'explained',
      reasonCode: 'exclusion_d23',
      expected: '50.5',
      refs: { decision: 'D23' },
    });
    expect(checkById(report, 'exclusions.Managed Funds!A4')).toMatchObject({
      reasonCode: 'exclusion_d23',
    });
    expect(checkById(report, 'exclusions.Managed Funds!A5')).toMatchObject({
      reasonCode: 'exclusion_d22',
      refs: { decision: 'D22' },
    });
    expect(checkById(report, 'exclusions.Managed Funds!A6')).toMatchObject({
      reasonCode: 'feed_row',
    });
    // A feed row with units is a real holding.
    const t2 = createTestDb();
    try {
      const held = buildSyntheticWorkbook({
        mutate: (wb) => set(wb, 'Managed Funds', 'E6', num(5)),
      });
      const r2 = reportOf(runImport(t2.db, held));
      expect(r2.checks.some((c) => c.id === 'exclusions.Managed Funds!A6')).toBe(false);
      expect(
        t2.db
          .select()
          .from(instruments)
          .all()
          .some((i) => i.symbol === 'AUDUSD=X'),
      ).toBe(true);
    } finally {
      t2.close();
    }
  });

  it('parses numbers stored as text in input columns with an info line', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => set(wb, 'Cash', 'C3', str('$10,000.00')),
    });
    const report = reportOf(runImport(t.db, bytes));
    expect(checkById(report, 'cash.numericText.Cash!C3').status).toBe('info');
    expect(checkById(report, 'cash.total').status).toBe('match');
  });

  it('explains an errored tab value only when the sheet total collapsed to 0', () => {
    const clean = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    expect(checkById(clean, 'holdings.value.etf')).toMatchObject({
      status: 'explained',
      reasonCode: 'sheet_error_value',
      expected: 0,
    });
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        // A non-zero tab total that differs from the app sum: the IFERROR premise does not hold.
        set(wb, 'ETFs', 'F15', num(123.45, 'IFERROR(sum(F2:F12),0)'));
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    expect(checkById(report, 'holdings.value.etf')).toMatchObject({
      status: 'unexplained',
      reasonCode: null,
      expected: 12345,
    });
  });

  it('leaves an other-assets row without a unit cost out of the gain, as the sheet does', () => {
    const extra = { units: 3, price: 40 };
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        const oa = wb.Sheets['Other Assets']!;
        oa['!ref'] = (oa['!ref'] ?? 'A1:A1').replace(/\d+$/, (n) =>
          String(Math.max(Number(n), 12)),
        );
        set(wb, 'Other Assets', 'F12', str('Example Uncosted Item'));
        set(wb, 'Other Assets', 'H12', num(extra.units));
        set(wb, 'Other Assets', 'I12', str('AUD'));
        set(wb, 'Other Assets', 'K12', num(extra.price));
        set(wb, 'Other Assets', 'L12', num(0, 'IF($H12>0,0,"")'));
        set(wb, 'Other Assets', 'M12', num(extra.units, 'IF(AND(H12<>"",H12>0),H12-abs(L12),"")'));
        const d3 = (wb.Sheets['Other Assets']!.D3 as CellObject).v as number;
        set(wb, 'Other Assets', 'D3', num(d3 + extra.units * extra.price, 'sum(O:O)'));
      },
    });
    const report = reportOf(runImport(t.db, bytes));
    const row = t.db
      .select()
      .from(otherAssets)
      .all()
      .find((r) => r.sheetRef === 'Other Assets!F12');
    expect(row).toMatchObject({ unitCost: null, unitPrice: '40' });
    expect(checkById(report, 'otherAssets.value').status).toBe('match');
    expect(checkById(report, 'otherAssets.gain').status).toBe('match');
  });

  it('clears an INTERRUPTED mark set by a server start while the import ran', () => {
    let calls = 0;
    const now = () => {
      calls++;
      // The third call stamps finishedAt, just before the success update: a server starting
      // now would mark every running import INTERRUPTED (markInterruptedRuns).
      if (calls === 3) {
        t.db
          .update(importRuns)
          .set({ status: 'failed', errorCode: 'INTERRUPTED', error: 'interrupted' })
          .run();
      }
      return new Date('2026-03-21T01:02:03.000Z');
    };
    const result = runImport(t.db, buildSyntheticWorkbook(), { now });
    expect(result.status).toBe('succeeded');
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(t.db.select().from(importRuns).all()[0]).toMatchObject({
      status: 'succeeded',
      errorCode: null,
      error: null,
    });
  });

  it('reads a text dividend frequency and nulls placeholders', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const rows = t.db.select().from(instruments).all();
    expect(rows.find((i) => i.symbol === 'EXAMPLEFUND')).toMatchObject({
      dividendFreqMonths: 3,
      drp: null,
    });
    expect(rows.find((i) => i.symbol === 'ASX:ABC')).toMatchObject({
      dividendFreqMonths: null,
      drp: null,
      name: 'Example Resources Ltd',
    });
    expect(rows.find((i) => i.symbol === 'ASX:XYZ')).toMatchObject({
      dividendFreqMonths: 6,
      drp: true,
    });
    expect(rows.find((i) => i.symbol === 'ASX:DEF')).toMatchObject({
      regionUsRatio: '0.6',
      mgmtFeeRatio: '0.0018',
      location: 'Aus',
    });
    expect(rows.find((i) => i.symbol === 'ASX:MNO')?.dividendFreqMonths).toBeNull();
  });
});
