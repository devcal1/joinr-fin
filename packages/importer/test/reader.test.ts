// Reader rules (stage-1.md §4.2) on a small hand-built workbook, plus the pure helpers.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { crc32, deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { afterAll, describe, expect, it } from 'vitest';
import { parseNumericText } from '../src/context';
import { outOfOrderIndexes, splitSymbol } from '../src/process';
import { readMeta } from '../src/extract';
import { findWorkbookInDir, readWorkbook, WorkbookFormatError } from '../src/index';
import { isErrorString, isSentinel, openWorkbook } from '../src/reader';
import { buildSyntheticWorkbook } from '../src/testing/syntheticWorkbook';

function workbook(
  cells: Record<string, XLSX.CellObject>,
  opts: { date1904?: boolean } = {},
): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = { ...cells, '!ref': 'A1:Z50' };
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
  if (opts.date1904) wb.Workbook = { WBProps: { date1904: true } };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('readWorkbook', () => {
  const r = readWorkbook(
    workbook({
      A1: { t: 'n', v: -0.30000000000000004 },
      A2: { t: 'n', v: 46100 },
      A3: { t: 's', v: '#VALUE!' },
      A4: { t: 's', v: '#ERROR!' },
      A5: { t: 's', v: '', f: 'IF(B1="","","x")' },
      A6: { t: 's', v: '   ' },
      A7: { t: 'b', v: false },
      A8: { t: 's', v: 'Yes' },
      A9: { t: 's', v: ' no ' },
      A10: { t: 's', v: '5/2/2026' },
      A11: { t: 's', v: '31/2/2026' },
      A12: { t: 'n', v: 1.5, f: 'A1*2' },
      A13: { t: 's', v: 'Example', l: { Target: 'https://example.com/x' } },
      A14: { t: 's', v: '#N/A' },
      A15: { t: 'e', v: 0x0f },
      A16: { t: 's', v: '  padded text ' },
    }),
  );

  it('returns raw doubles for numbers', () => {
    expect(r.number('Sheet', 'A1')).toBe(-0.30000000000000004);
    expect(r.number('Sheet', 'A3')).toBeNull();
    expect(r.number('Sheet', 'Z50')).toBeNull();
  });

  it('reads serial dates in the 1900 system and d/m/yyyy text', () => {
    expect(r.date('Sheet', 'A2')).toBe('2026-03-19');
    expect(r.date('Sheet', 'A10')).toBe('2026-02-05');
    expect(r.date('Sheet', 'A11')).toBeNull();
    expect(r.date('Sheet', 'A16')).toBeNull();
  });

  it('honours the 1904 date system', () => {
    const r1904 = readWorkbook(workbook({ A1: { t: 'n', v: 0 } }, { date1904: true }));
    expect(r1904.date('Sheet', 'A1')).toBeNull(); // serial 0 is not a date
    const r2 = readWorkbook(workbook({ A1: { t: 'n', v: 1 } }, { date1904: true }));
    expect(r2.date('Sheet', 'A1')).toBe('1904-01-02');
  });

  it('treats error strings and error cells as error values', () => {
    expect(r.isErrorValue('Sheet', 'A3')).toBe(true);
    expect(r.isErrorValue('Sheet', 'A4')).toBe(true);
    expect(r.isErrorValue('Sheet', 'A14')).toBe(true);
    expect(r.isErrorValue('Sheet', 'A15')).toBe(true);
    expect(r.cell('Sheet', 'A15')?.v).toBe('#VALUE!');
    expect(r.isErrorValue('Sheet', 'A16')).toBe(false);
  });

  it('treats missing cells, formula blanks and whitespace as blank', () => {
    expect(r.isBlank('Sheet', 'Z40')).toBe(true);
    expect(r.isBlank('Sheet', 'A5')).toBe(true);
    expect(r.cell('Sheet', 'A5')?.formula).toBe('IF(B1="","","x")');
    expect(r.isBlank('Sheet', 'A6')).toBe(true);
    expect(r.text('Sheet', 'A6')).toBeNull();
    expect(r.isBlank('Sheet', 'A7')).toBe(false);
  });

  it('reads booleans and Yes/No text', () => {
    expect(r.bool('Sheet', 'A7')).toBe(false);
    expect(r.bool('Sheet', 'A8')).toBe(true);
    expect(r.bool('Sheet', 'A9')).toBe(false);
    expect(r.bool('Sheet', 'A16')).toBeNull();
  });

  it('exposes formulas, hyperlinks, trimmed text and the last row', () => {
    expect(r.cell('Sheet', 'A12')).toEqual({ t: 'n', v: 1.5, formula: 'A1*2', link: null });
    expect(r.cell('Sheet', 'A13')?.link).toBe('https://example.com/x');
    expect(r.text('Sheet', 'A16')).toBe('padded text');
    expect(r.lastRow('Sheet')).toBe(50);
    expect(r.has('Sheet')).toBe(true);
    expect(r.has('Nope')).toBe(false);
    expect(r.cell('Nope', 'A1')).toBeNull();
    expect(r.lastRow('Nope')).toBe(0);
  });
});

describe('value helpers', () => {
  it('recognises error strings and sentinels', () => {
    for (const s of ['#VALUE!', '#ERROR!', '#N/A', '#REF!', '#DIV/0!', '#NAME?'])
      expect(isErrorString(s)).toBe(true);
    for (const s of ['#1', 'VALUE!', '#value!', '']) expect(isErrorString(s)).toBe(false);
    for (const s of [
      '-',
      '—',
      'Enter Freq',
      'Enter DRP',
      'Loading..',
      'No Watch Price',
      'Please Enter',
    ]) {
      expect(isSentinel(s)).toBe(true);
    }
    expect(isSentinel('Quarterly')).toBe(false);
  });

  it('parses numbers stored as text', () => {
    expect(parseNumericText('$1,234.50')).toBe(1234.5);
    expect(parseNumericText('12%')).toBe(0.12);
    expect(parseNumericText('5.6%')).toBe(0.056);
    expect(parseNumericText('(5)')).toBe(-5);
    expect(parseNumericText('-$20')).toBe(-20);
    expect(parseNumericText('.5')).toBe(0.5);
    expect(parseNumericText('abc')).toBeNull();
    expect(parseNumericText('1.2.3')).toBeNull();
  });

  it('splits exchange-prefixed symbols', () => {
    expect(splitSymbol('ASX:ABC')).toEqual({ exchange: 'ASX', code: 'ABC' });
    expect(splitSymbol('EXAMPLEFUND')).toEqual({ exchange: null, code: 'EXAMPLEFUND' });
    expect(splitSymbol('SI=F')).toEqual({ exchange: null, code: 'SI=F' });
  });

  it('flags a row that breaks the date order while its neighbours are in order', () => {
    expect(outOfOrderIndexes(['2026-01-01', '2026-02-01', '2021-01-01', '2026-03-01'])).toEqual([
      2,
    ]);
    expect(outOfOrderIndexes(['2027-01-01', '2026-01-01', '2026-02-01'])).toEqual([0]);
    expect(outOfOrderIndexes(['2026-01-01', '2026-02-01', '2025-01-01'])).toEqual([2]);
    expect(outOfOrderIndexes(['2026-01-01', '2026-01-01', '2026-02-01'])).toEqual([]);
    expect(outOfOrderIndexes(['2026-01-01'])).toEqual([]);
  });
});

describe('findWorkbookInDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'joinr-find-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds exactly one .xlsx, ignoring lock files and folders', () => {
    expect(findWorkbookInDir(join(dir, 'missing'))).toEqual({ kind: 'none' });
    expect(findWorkbookInDir(dir)).toEqual({ kind: 'none' });
    writeFileSync(join(dir, '~$lock.xlsx'), 'x');
    mkdirSync(join(dir, 'folder.xlsx'));
    expect(findWorkbookInDir(dir)).toEqual({ kind: 'none' });
    writeFileSync(join(dir, 'a.xlsx'), 'x');
    expect(findWorkbookInDir(dir)).toEqual({ kind: 'found', path: join(dir, 'a.xlsx') });
    writeFileSync(join(dir, 'b.XLSX'), 'x');
    expect(findWorkbookInDir(dir)).toEqual({
      kind: 'multiple',
      paths: [join(dir, 'a.xlsx'), join(dir, 'b.XLSX')],
    });
  });
});

// ─── Zip pre-scan (SheetJS never sees non-zip bytes or unbounded entries) ───────────────────────

interface ZipEntry {
  name: string;
  data: Uint8Array;
  deflate?: boolean;
  /** Overrides the declared uncompressed size (a lying or oversized header). */
  declaredSize?: number;
  flags?: number;
}

/** A minimal zip writer, so the tests control every header field. */
function zip(entries: ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const body = e.deflate ? deflateRawSync(e.data) : Buffer.from(e.data);
    const size = e.declaredSize ?? e.data.length;
    const crc = crc32(e.data);
    const method = e.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

function timed(fn: () => void): { error: unknown; ms: number } {
  const t0 = performance.now();
  let error: unknown = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  return { error, ms: performance.now() - t0 };
}

describe('zip pre-scan', () => {
  const small = { name: 'a.xml', data: new TextEncoder().encode('<a/>'), deflate: true };

  it('still opens the synthetic workbook', () => {
    expect(() => readWorkbook(buildSyntheticWorkbook())).not.toThrow();
  });

  it('rejects a large CSV body at once instead of parsing it', () => {
    const csv = new TextEncoder().encode('1,2,3,4,5,6,7,8,9,1\n'.repeat(400_000)); // ~8 MB
    const { error, ms } = timed(() => readWorkbook(csv));
    expect(error).toBeInstanceOf(WorkbookFormatError);
    expect((error as Error).message).toBe('The file is not a readable .xlsx workbook');
    expect(ms).toBeLessThan(50);
  });

  it('rejects a zip whose declared uncompressed total is too large', () => {
    const bomb = zip([
      small,
      { name: 'pad.bin', data: new Uint8Array(1024), deflate: true, declaredSize: 300 * 2 ** 20 },
    ]);
    const { error, ms } = timed(() => readWorkbook(bomb));
    expect(error).toBeInstanceOf(WorkbookFormatError);
    expect(ms).toBeLessThan(1000);
  });

  it('rejects an entry that inflates past its declared size', () => {
    const liar = zip([
      small,
      { name: 'pad.bin', data: new Uint8Array(8 * 2 ** 20), deflate: true, declaredSize: 1024 },
    ]);
    expect(liar.length).toBeLessThan(64 * 1024); // high ratio on the wire
    const { error, ms } = timed(() => readWorkbook(liar));
    expect(error).toBeInstanceOf(WorkbookFormatError);
    expect(ms).toBeLessThan(1000);
  });

  it('rejects too many entries, encrypted entries and unknown methods', () => {
    const many = zip(
      Array.from({ length: 2001 }, (_, i) => ({ name: `e${i}`, data: new Uint8Array(1) })),
    );
    expect(() => readWorkbook(many)).toThrow(WorkbookFormatError);
    expect(() => readWorkbook(zip([{ ...small, flags: 1 }]))).toThrow(WorkbookFormatError);
    const stored = zip([{ name: 's', data: new Uint8Array(4), declaredSize: 8 }]);
    expect(() => readWorkbook(stored)).toThrow(WorkbookFormatError);
  });

  it('passes a well-formed zip on to SheetJS', () => {
    // A valid zip that is not a workbook still fails, but in the SheetJS step.
    expect(() => readWorkbook(zip([small]))).toThrow(WorkbookFormatError);
  });
});

describe('readMeta', () => {
  it('falls back to the local calendar date when Net Worth!E52 is blank', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, { '!ref': 'A1:E60' }, 'Net Worth');
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );
    const meta = readMeta(openWorkbook(bytes), new Date(2026, 0, 1, 0, 30));
    expect(meta).toMatchObject({ asOf: '2026-01-01', asOfFromSheet: false });
  });
});
