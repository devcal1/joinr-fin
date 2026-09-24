// The synthetic workbook itself (stage-1.md §7.3 step 1): it writes, reads back as a template
// v2.15 export (History renamed), and keeps its formulas, cached values and quirks.
import {
  normaliseSheetLabel,
  SETTINGS,
  SHEET_OPTIONS_NOT_IMPORTED,
  SHEET_OPTIONS_VALIDATED,
} from '@joinr/schema';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../src/index';
import { colLetter, HISTORY_HEADERS as LAYOUT_HISTORY_HEADERS } from '../src/layout';
import {
  buildSyntheticWorkbook,
  HISTORY_HEADERS,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_FACTS,
  SYNTHETIC_HISTORY_TMP,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '../src/testing/syntheticWorkbook';

describe('buildSyntheticWorkbook', () => {
  const bytes = buildSyntheticWorkbook();
  const reader = readWorkbook(bytes);

  it('is implemented, and so is the importer', () => {
    expect(SYNTHETIC_WORKBOOK_IMPLEMENTED).toBe(true);
    expect(IMPORTER_IMPLEMENTED).toBe(true);
  });

  it('writes the History headers the importer maps', () => {
    expect(HISTORY_HEADERS).toHaveLength(36);
    HISTORY_HEADERS.forEach((label, i) => {
      const col = colLetter(1 + i);
      expect(LAYOUT_HISTORY_HEADERS[col]).toBe(label);
      expect(reader.text('History', `${col}2`)).toBe(label);
    });
  });

  it('writes the History sheet under its real name with cells, formulas and cached values', () => {
    expect(reader.sheetNames).toContain('History');
    expect(reader.sheetNames).not.toContain(SYNTHETIC_HISTORY_TMP);
    expect(reader.text('History', 'A2')).toBe('Month');
    expect(reader.date('History', 'A3')).toBe('2025-10-31');
    expect(reader.cell('History', 'B3')?.formula).toBeNull();
    const live = reader.cell('History', 'B8');
    expect(live?.formula).not.toBeNull();
    expect(typeof live?.v).toBe('number');
  });

  it('carries the template quirks the importer must handle', () => {
    // Error strings, sentinels, formula blanks, hyperlinks, booleans, typed vs formula prices.
    expect(reader.isErrorValue('ETFs', 'G3')).toBe(true);
    expect(reader.isErrorValue('Crypto', 'B2')).toBe(true);
    expect(reader.text('ETFs', 'D3')).toBe('-');
    expect(reader.cell('ETFs', 'D3')?.formula).toBe("'Managed Funds'!D5");
    expect(reader.cell('Stocks', 'B5')?.v).toBe('');
    expect(reader.isBlank('Stocks', 'B5')).toBe(true);
    expect(reader.cell('Other Assets', 'F6')?.link).toBe('https://example.com/print');
    expect(reader.bool('Cash', 'E6')).toBe(true);
    expect(reader.cell('Managed Funds', 'D2')?.formula).toBeNull();
    expect(reader.cell('Stocks', 'D2')?.formula).not.toBeNull();
    expect(reader.cell('Crypto', 'B3')).toBeNull();
    expect(reader.cell('Crypto', 'C3')?.formula).toBeNull();
    expect(reader.number('Managed Funds', 'C25')).toBe(-100.10000000000001);
    expect(reader.text('SheetOptions', 'K10')).toContain('\n');
  });

  it('uses the registry SheetOptions labels for IDs 1–44', () => {
    const labels = new Map<number, string>();
    for (const def of SETTINGS) {
      if (def.source !== null && 'id' in def.source)
        labels.set(def.source.id, def.source.sheetLabel);
    }
    for (const [id, d] of Object.entries(SHEET_OPTIONS_NOT_IMPORTED))
      labels.set(Number(id), d.sheetLabel);
    for (const [id, d] of Object.entries(SHEET_OPTIONS_VALIDATED))
      labels.set(Number(id), d.sheetLabel);
    for (let id = 1; id <= 44; id++) {
      const row = id + 2;
      expect(reader.number('SheetOptions', `P${row}`)).toBe(id);
      const k = reader.cell('SheetOptions', `K${row}`)?.v;
      expect(normaliseSheetLabel(String(k))).toBe(normaliseSheetLabel(labels.get(id) ?? ''));
    }
  });

  it('holds the placeholder secrets only in SheetOptions L3 and L31', () => {
    expect(reader.text('SheetOptions', 'L3')).toBe(SYNTHETIC_FACTS.secretValues[0]);
    expect(reader.text('SheetOptions', 'L31')).toBe(SYNTHETIC_FACTS.secretValues[1]);
  });

  it('lets mutate() edit the workbook before it is written', () => {
    const mutated = buildSyntheticWorkbook({
      mutate: (wb) => {
        expect(wb.SheetNames).toContain(SYNTHETIC_HISTORY_TMP);
        const ws = wb.Sheets.Cash!;
        ws.A2 = { t: 's', v: 'Example Bank – Renamed' };
      },
    });
    expect(readWorkbook(mutated).text('Cash', 'A2')).toBe('Example Bank – Renamed');
  });

  it('builds a faulty variant', () => {
    const faulty = readWorkbook(buildSyntheticWorkbook({ variant: 'faulty' }));
    expect(faulty.number('Stocks', 'G2')).toBe(161);
    // The duplicate month sits before the later run of the same month.
    expect(faulty.date('History', 'A6')).toBe('2026-01-15');
    expect(faulty.date('History', 'A7')).toBe('2026-01-31');
  });

  it('is a valid zip SheetJS reads without the rename trick', () => {
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames[0]).toBe('Net Worth');
  });
});
