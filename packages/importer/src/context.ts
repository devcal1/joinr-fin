// Shared extraction helpers: typed reads of input cells with the §4.2 rules (sentinels and error
// values → null, numeric text parsed with an info line).
import {
  centsFromNumber,
  decimalFromNumber,
  type IsoDate,
  type ReportSection,
} from '@joinr/schema';
import { info } from './checks';
import { sheetRef } from './layout';
import type { Check } from './model';
import { isErrorString, isSentinel, type SheetReader } from './reader';

const NUMERIC_TEXT_RE = /^\(?-?\$?-?\d[\d,]*(?:\.\d+)?\)?%?$|^\(?-?\$?-?\.\d+\)?%?$/;

/** `$1,234.50` → 1234.5, `12%` → 0.12, `(5)` → -5; null when the text is not a number. */
export function parseNumericText(text: string): number | null {
  const s = text.trim().replace(/\s+/g, '');
  if (!NUMERIC_TEXT_RE.test(s)) return null;
  const negative = s.startsWith('(') || s.includes('-');
  const percent = s.endsWith('%');
  const digits = s.replace(/[()$,%-]/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const v = (negative ? -n : n) / (percent ? 100 : 1);
  return percent ? Number(decimalFromNumber(v)) : v;
}

export class ExtractContext {
  readonly checks: Check[] = [];

  constructor(
    readonly r: SheetReader,
    readonly asOf: IsoDate,
  ) {}

  push(c: Check): void {
    this.checks.push(c);
  }

  /**
   * A numeric input cell: the number, or numeric text parsed (with an info line). Null for
   * blanks, sentinels, error values and other text.
   */
  num(sheet: string, addr: string, section: ReportSection): number | null {
    const c = this.r.cell(sheet, addr);
    if (!c || c.v === null) return null;
    if (c.t === 'n' && typeof c.v === 'number') return Number.isFinite(c.v) ? c.v : null;
    if (c.t !== 's' || typeof c.v !== 'string') return null;
    const text = c.v.trim();
    if (text === '' || isSentinel(text) || isErrorString(text)) return null;
    const parsed = parseNumericText(text);
    if (parsed !== null) {
      this.push(
        info(
          `${section}.numericText.${sheetRef(sheet, addr)}`,
          section,
          `Number stored as text at ${sheetRef(sheet, addr)}`,
          null,
          'A numeric input holds text; it was parsed as a number',
          { sheetRef: sheetRef(sheet, addr), unit: 'none' },
        ),
      );
    }
    return parsed;
  }

  decimal(sheet: string, addr: string, section: ReportSection): string | null {
    const n = this.num(sheet, addr, section);
    return n === null ? null : decimalFromNumber(n);
  }

  cents(sheet: string, addr: string, section: ReportSection): number | null {
    const n = this.num(sheet, addr, section);
    return n === null ? null : centsFromNumber(n);
  }

  /** Text that is not blank, a sentinel or an error value. */
  text(sheet: string, addr: string): string | null {
    const t = this.r.text(sheet, addr);
    if (t === null || isSentinel(t) || isErrorString(t)) return null;
    return t;
  }

  date(sheet: string, addr: string): IsoDate | null {
    return this.r.date(sheet, addr);
  }

  /** True when the cell holds a formula. */
  hasFormula(sheet: string, addr: string): boolean {
    return (this.r.cell(sheet, addr)?.formula ?? null) !== null;
  }
}
