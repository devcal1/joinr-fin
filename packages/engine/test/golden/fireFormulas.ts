// Golden-only helpers (stage-6.md §9.1, §9.3 rules 3–5): the FIRE tab's input formulas recomputed
// from the workbook's own cells: E45 (pre-super net worth), E49 (the growth blend) and the E47/E48
// averages over the sheet's window (all rows, the live row included) and over the recorded (closed)
// rows without the baseline (the app's window). Floats, as the sheet computes; the tolerances of
// §9.5 apply. Template cell references only; every value is read at runtime and never printed.
import type { IsoDate } from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';
import { addDaysIso } from '../../src/num';
import type { CashRow } from './cashflowFormulas';

/** Property columns D…O (one property per column). */
const PROPERTY_COLUMNS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
/** SheetOptions IDs (column P) of the cash rate and the market return; never IDs 1 and 29. */
const SHEET_OPTION_IDS = { salary: 4, cashRate: 11, marketReturn: 25 } as const;

/** Column L of a SheetOptions ID found through column P (the importer's lookup). */
export function sheetOptionNumber(
  wb: WorkbookReader,
  id: (typeof SHEET_OPTION_IDS)[keyof typeof SHEET_OPTION_IDS],
): number | null {
  for (let r = 3; r <= 60; r++) {
    if (wb.number('SheetOptions', `P${r}`) === id) return wb.number('SheetOptions', `L${r}`);
  }
  return null;
}

export const salaryOf = (wb: WorkbookReader): number | null =>
  sheetOptionNumber(wb, SHEET_OPTION_IDS.salary);

/** E45 = Net Worth!D16 + Net Worth!E23 + SUMIF(Property!D17:O17, "No", Property!D19:O19). */
export function sheetE45(wb: WorkbookReader): number {
  const nw = (a: string) => wb.number('Net Worth', a) ?? 0;
  let investmentProperty = 0;
  for (const c of PROPERTY_COLUMNS) {
    if (wb.text('Property', `${c}17`) === 'No')
      investmentProperty += wb.number('Property', `${c}19`) ?? 0;
  }
  return nw('D16') + nw('E23') + investmentProperty;
}

/** E49 = (C8 × cash rate + ΣC4:C6 × market return) ÷ (C8 + ΣC4:C6) (Net Worth cells). */
export function sheetE49(wb: WorkbookReader): number | null {
  const nw = (a: string) => wb.number('Net Worth', a) ?? 0;
  const cashRate = sheetOptionNumber(wb, SHEET_OPTION_IDS.cashRate);
  const market = sheetOptionNumber(wb, SHEET_OPTION_IDS.marketReturn);
  if (cashRate === null || market === null) return null;
  const invested = nw('C4') + nw('C5') + nw('C6');
  const den = nw('C8') + invested;
  return den === 0 ? null : (nw('C8') * cashRate + invested * market) / den;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

export interface AverageHelpers {
  /** The sheet's own rule over every row dated after C51 − 365 (live row included): MAX(avg N × 12, 0). */
  e47All: number | null;
  /** The same over the closed rows without the baseline (the app's window). */
  e47Closed: number | null;
  /** AVERAGEIF over the rows dated after C51 − 366 of P × 12 (live row included). */
  e48All: number | null;
  e48Closed: number | null;
  /** Rows in the closed windows (for the adapter's sanity checks). */
  closedRows: { e47: number; e48: number };
}

/** E47/E48 over Cash!H/N/P (rules 3 and 4). `rows` starts at the baseline row (Cash row 3). */
export function averageHelpers(rows: readonly CashRow[], lastRun: IsoDate): AverageHelpers {
  const after = (days: number) => addDaysIso(lastRun, -days);
  const all = (days: number) => rows.filter((r) => r.date > after(days));
  const closed = (days: number) =>
    rows.slice(1).filter((r) => r.date > after(days) && r.date <= lastRun);
  const nOf = (xs: readonly CashRow[]) => xs.filter((r) => r.N !== null).map((r) => r.N!);
  const pOf = (xs: readonly CashRow[]) => xs.filter((r) => r.P !== null).map((r) => r.P!);
  const yearly = (m: number | null, floor: boolean) =>
    m === null ? null : floor ? Math.max(m * 12, 0) : m * 12;
  return {
    e47All: yearly(mean(nOf(all(365))), true),
    e47Closed: yearly(mean(nOf(closed(365))), true),
    e48All: yearly(mean(pOf(all(366))), false),
    e48Closed: yearly(mean(pOf(closed(366))), false),
    closedRows: { e47: nOf(closed(365)).length, e48: pOf(closed(366)).length },
  };
}
