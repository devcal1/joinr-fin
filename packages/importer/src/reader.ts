// Workbook reader (stage-1.md §4.2): SheetJS read once, then typed cell access. Numbers are the
// raw doubles (`v`, never the formatted `w`); dates are 1900-system serials; Google error values
// arrive as strings; formula blanks arrive as "".
import * as XLSX from 'xlsx';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';
import { excelSerialToIsoDate, isIsoDateString, type IsoDate } from '@joinr/schema';
import { WorkbookFormatError } from './errors';
import { assertSafeZip } from './zipGuard';

export interface CellInfo {
  t: 'n' | 's' | 'b' | 'e' | 'z';
  v: number | string | boolean | null;
  /** The cell's formula (without `=`); for a member of an array range, the anchor's formula. */
  formula: string | null;
  /** Hyperlink target. */
  link: string | null;
}

/** Read access to a parsed workbook (reused by Stage 2+ golden tests). */
export interface WorkbookReader {
  sheetNames: readonly string[];
  has(sheet: string): boolean;
  cell(sheet: string, addr: string): CellInfo | null;
  number(sheet: string, addr: string): number | null;
  text(sheet: string, addr: string): string | null;
  date(sheet: string, addr: string): IsoDate | null;
  bool(sheet: string, addr: string): boolean | null;
  isBlank(sheet: string, addr: string): boolean;
  isErrorValue(sheet: string, addr: string): boolean;
  lastRow(sheet: string): number;
}

/** Google Sheets error values exported as strings (`#VALUE!`, `#ERROR!`, `#N/A`, …). */
export const ERROR_STRING_RE = /^#(?:[A-Z0-9/]+[!?]|N\/A)$/;

/** Placeholder texts the template shows instead of a value; read as null (§4.2 rule 7). */
export const SENTINELS: ReadonlySet<string> = new Set([
  '-',
  '—',
  'Loading..',
  'Loading...',
  'No Price',
  'No Watch Price',
  'Please Enter',
  'Enter Freq',
  'Enter DRP',
  'Manually enter',
  'Update CGT',
  'API Key Needed',
  'Old Sheet',
  'Accept Disclaimer',
]);

export const isErrorString = (s: string): boolean => ERROR_STRING_RE.test(s.trim());
export const isSentinel = (s: string): boolean => SENTINELS.has(s.trim());

/** SheetJS error codes (t:'e') → their text. */
const ERROR_CODES: Readonly<Record<number, string>> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
};

/** The largest serial a date may have (31/12/9999). */
const MAX_SERIAL = 2_958_465;

const D_M_Y_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** A parsed workbook: the frozen WorkbookReader plus the workbook's date system. */
export class SheetReader implements WorkbookReader {
  readonly sheetNames: readonly string[];
  readonly date1904: boolean;
  private readonly wb: WorkBook;

  constructor(wb: WorkBook) {
    this.wb = wb;
    this.sheetNames = [...wb.SheetNames];
    this.date1904 = wb.Workbook?.WBProps?.date1904 === true;
  }

  has(sheet: string): boolean {
    return Object.hasOwn(this.wb.Sheets, sheet);
  }

  private sheet(sheet: string): WorkSheet | undefined {
    return this.has(sheet) ? this.wb.Sheets[sheet] : undefined;
  }

  private raw(sheet: string, addr: string): CellObject | undefined {
    const ws = this.sheet(sheet);
    if (!ws) return undefined;
    const c = ws[addr] as CellObject | undefined;
    return c !== undefined && typeof c === 'object' && 't' in c ? c : undefined;
  }

  cell(sheet: string, addr: string): CellInfo | null {
    const c = this.raw(sheet, addr);
    if (!c) return null;
    let formula: string | null = c.f ?? null;
    if (formula === null && typeof c.F === 'string') {
      const anchor = this.raw(sheet, c.F.split(':')[0] ?? '');
      formula = anchor?.f ?? c.F;
    }
    const link = c.l?.Target ?? null;
    switch (c.t) {
      case 'n':
        return { t: 'n', v: typeof c.v === 'number' ? c.v : Number(c.v), formula, link };
      case 's':
        return { t: 's', v: typeof c.v === 'string' ? c.v : String(c.v ?? ''), formula, link };
      case 'b':
        return { t: 'b', v: c.v === true, formula, link };
      case 'e': {
        const text = typeof c.w === 'string' ? c.w : (ERROR_CODES[Number(c.v)] ?? '#ERROR!');
        return { t: 'e', v: text, formula, link };
      }
      case 'd': {
        const ms = c.v instanceof Date ? c.v.getTime() : Number.NaN;
        const serial = (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
        return { t: 'n', v: serial, formula, link };
      }
      default:
        return { t: 'z', v: null, formula, link };
    }
  }

  number(sheet: string, addr: string): number | null {
    const c = this.cell(sheet, addr);
    return c?.t === 'n' && typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : null;
  }

  text(sheet: string, addr: string): string | null {
    const c = this.cell(sheet, addr);
    if (!c || c.v === null) return null;
    if (c.t === 'b') return c.v === true ? 'TRUE' : 'FALSE';
    const s = String(c.v).trim();
    return s === '' ? null : s;
  }

  date(sheet: string, addr: string): IsoDate | null {
    const c = this.cell(sheet, addr);
    if (!c) return null;
    if (c.t === 'n' && typeof c.v === 'number') {
      if (!Number.isFinite(c.v) || c.v < 1 || c.v > MAX_SERIAL) return null;
      return excelSerialToIsoDate(c.v, this.date1904);
    }
    if (c.t === 's' && typeof c.v === 'string') {
      const m = D_M_Y_RE.exec(c.v.trim());
      if (!m) return null;
      const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
      return isIsoDateString(iso) ? iso : null;
    }
    return null;
  }

  bool(sheet: string, addr: string): boolean | null {
    const c = this.cell(sheet, addr);
    if (!c) return null;
    if (c.t === 'b') return c.v === true;
    if (c.t === 's' && typeof c.v === 'string') {
      const s = c.v.trim().toLowerCase();
      if (s === 'yes' || s === 'true') return true;
      if (s === 'no' || s === 'false') return false;
    }
    return null;
  }

  isBlank(sheet: string, addr: string): boolean {
    const c = this.cell(sheet, addr);
    if (!c || c.t === 'z' || c.v === null) return true;
    return c.t === 's' && typeof c.v === 'string' && c.v.trim() === '';
  }

  isErrorValue(sheet: string, addr: string): boolean {
    const c = this.cell(sheet, addr);
    if (!c) return false;
    if (c.t === 'e') return true;
    return c.t === 's' && typeof c.v === 'string' && isErrorString(c.v);
  }

  lastRow(sheet: string): number {
    const ref = this.sheet(sheet)?.['!ref'];
    if (typeof ref !== 'string') return 0;
    return XLSX.utils.decode_range(ref).e.r + 1;
  }
}

/** Parses workbook bytes (throws WorkbookFormatError when SheetJS cannot read them). */
export function openWorkbook(bytes: Uint8Array): SheetReader {
  // Only a bounded, well-formed zip reaches SheetJS (no CSV/HTML sniffing, no zip bombs).
  assertSafeZip(bytes);
  let wb: WorkBook;
  try {
    wb = XLSX.read(bytes, {
      type: 'array',
      cellFormula: true,
      cellDates: false,
      cellNF: false,
      cellText: false,
      cellStyles: false,
    });
  } catch {
    throw new WorkbookFormatError('The file is not a readable .xlsx workbook');
  }
  if (!Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new WorkbookFormatError('The file is not a readable .xlsx workbook');
  }
  return new SheetReader(wb);
}

/** Reads workbook bytes into a WorkbookReader (§4.1). */
export function readWorkbook(bytes: Uint8Array): WorkbookReader {
  return openWorkbook(bytes);
}
