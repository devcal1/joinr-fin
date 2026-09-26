// Golden-only helpers (stage-5.md §9.1): the sheet's History, Net Worth and WorkingSheet formulas
// over the sheet's own doubles, for the recomputed expectations (other units, the closed-row
// average) and the adapter validations. Floats, as the sheet computes; the §9.5 tolerances apply.
import type { IsoDate, IsoMonth } from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';

/** The sheet's History ratio `IFERROR(g ÷ (v − g), 0)` over doubles (blank = 0). */
export function sheetRatioOf(gain: number | null, value: number | null): number {
  const g = gain ?? 0;
  const den = (value ?? 0) - g;
  return den === 0 ? 0 : g / den;
}

/** One History row's doubles by column letter (blank → null). */
export type HistoryDoubles = (letter: string) => number | null;

export function historyDoubles(wb: WorkbookReader, row: number): HistoryDoubles {
  return (letter) => wb.number('History', `${letter}${row}`);
}

/** The rolling table's L…P of one History row (Net Worth!L:P over History, blank = 0). */
export function rollingOf(h: HistoryDoubles): {
  L: number;
  M: number;
  N: number;
  O: number;
  P: number;
} {
  const z = (letter: string) => h(letter) ?? 0;
  const L = z('B') + z('F') + z('J') + z('N') + z('AF') + z('AJ');
  const M = z('Q');
  const N = -Math.abs(z('U')) - Math.abs(z('AB'));
  const O = z('X');
  return { L, M, N, O, P: L + M + N + O };
}

/** A recomputation group key: a calendar quarter, a calendar year or a financial year. */
export function groupKey(month: IsoMonth, unit: 'quarterly' | 'calendar' | 'fy'): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (unit === 'quarterly') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (unit === 'calendar') return String(y);
  return `FY${m >= 7 ? y : y - 1}`;
}

/** compressTable's `End` and `Sum` over a group's rows (in order). */
export function compress(values: readonly (number | null)[], mode: 'End' | 'Sum'): number | null {
  if (mode === 'End') return values.at(-1) ?? null;
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/**
 * The WorkingSheet History block's mode per History column (its compressTable calls): `Sum` for
 * E, I, M, R, W and AI; `End` for every other column (the cash gain O included).
 */
export const SHEET_BLOCK_SUM_COLUMNS: ReadonlySet<string> = new Set([
  'E',
  'I',
  'M',
  'R',
  'W',
  'AI',
]);

/** A full month name label ("March 2024") → `2024-03`; null when it does not parse. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function monthOfLabel(label: string | null): IsoMonth | null {
  if (label === null) return null;
  const m = /^([A-Za-z]+) (\d{4})$/.exec(label.trim());
  if (!m) return null;
  const k = MONTH_NAMES.indexOf(m[1]!);
  return k < 0 ? null : `${m[2]!}-${String(k + 1).padStart(2, '0')}`;
}

/**
 * Cash!C38: AVERAGEIFS(Cash!M, Cash!H, ≥ 1 January of YEAR(C51), < 1 January of the next year) over
 * the Cash rows (a simple mean of monthly rates; the live row included).
 */
export function calendarMeanRate(wb: WorkbookReader, lastRun: IsoDate): number | null {
  const year = lastRun.slice(0, 4);
  const rates: number[] = [];
  for (let r = 3; r <= 800; r++) {
    const date = wb.date('Cash', `H${r}`);
    if (date === null) break;
    const m = wb.number('Cash', `M${r}`);
    if (date.slice(0, 4) === year && m !== null) rates.push(m);
  }
  return rates.length === 0 ? null : rates.reduce((a, b) => a + b, 0) / rates.length;
}
