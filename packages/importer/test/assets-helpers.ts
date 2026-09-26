// Workbook mutations for the Stage 4 importer tests (stage-4.md §7.6): generic values only. Each
// keeps the workbook's own totals consistent, so the reconciliation stays clean where it should.
import type { CellObject, WorkBook } from 'xlsx';
import { SYNTHETIC_HISTORY_TMP } from '../src/testing/syntheticWorkbook';

export const num = (v: number, f?: string): CellObject =>
  f === undefined ? { t: 'n', v } : { t: 'n', v, f };
export const str = (v: string): CellObject => ({ t: 's', v });

export function set(wb: WorkBook, sheet: string, addr: string, cell: CellObject | null): void {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`no sheet ${sheet}`);
  if (cell === null) delete ws[addr];
  else ws[addr] = cell;
}

export function cellNumber(wb: WorkBook, sheet: string, addr: string): number {
  const c = wb.Sheets[sheet]?.[addr] as CellObject | undefined;
  if (!c || typeof c.v !== 'number') throw new Error(`${sheet}!${addr} is not a number`);
  return c.v;
}

/** Excel serial of a `YYYY-MM-DD` date (1900 system). */
export function serial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** The last frozen History row (a date in A without a formula), in the pre-rename sheet. */
export function lastFrozenHistoryRow(wb: WorkBook): number {
  const h = wb.Sheets[SYNTHETIC_HISTORY_TMP]!;
  let last = 0;
  for (let r = 3; r <= 300; r++) {
    const c = h[`A${r}`] as CellObject | undefined;
    if (c && c.t === 'n' && c.f === undefined) last = r;
  }
  if (last === 0) throw new Error('no frozen History row');
  return last;
}

/**
 * The live totals equal the last frozen History row's (SPEC-16): that row's Q becomes Super!B12
 * and its AB the property's current balance (Property!D29), and the Net Worth rolling row follows
 * (M and P), so nothing else in the reconciliation moves.
 */
export function withLiveTotalsUnchanged(wb: WorkBook): void {
  const h = wb.Sheets[SYNTHETIC_HISTORY_TMP]!;
  const row = lastFrozenHistoryRow(wb);
  const q = cellNumber(wb, 'Super', 'B12');
  const ab = cellNumber(wb, 'Property', 'D29');
  const oldQ = cellNumber(wb, SYNTHETIC_HISTORY_TMP, `Q${row}`);
  const oldAb = cellNumber(wb, SYNTHETIC_HISTORY_TMP, `AB${row}`);
  const x = cellNumber(wb, SYNTHETIC_HISTORY_TMP, `X${row}`);
  h[`Q${row}`] = num(q);
  h[`AB${row}`] = num(ab);
  h[`Z${row}`] = num(x + ab);
  // Net Worth rolling row K{n} mirrors History!A{n+1}.
  const rolling = row - 1;
  const n = cellNumber(wb, 'Net Worth', `N${rolling}`);
  const p = cellNumber(wb, 'Net Worth', `P${rolling}`);
  const abDelta = Math.abs(ab) - Math.abs(oldAb);
  set(wb, 'Net Worth', `M${rolling}`, num(q));
  set(wb, 'Net Worth', `N${rolling}`, num(n - abDelta));
  set(wb, 'Net Worth', `P${rolling}`, num(p + (q - oldQ) - abDelta));
}

/** SheetOptions ID 43 ("Retirement - Contributions in Savings Rate") in its template row. */
export function withRetirementContributions(yes: boolean) {
  return (wb: WorkBook): void => set(wb, 'SheetOptions', 'L45', str(yes ? 'Yes' : 'No'));
}

/** Tags the synthetic ETF ASX:DEF (ETFs row 2) as a Retirement holding. */
export function withRetirementTaggedEtf(wb: WorkBook): void {
  set(wb, 'ETFs', 'W2', str('Retirement'));
}

/** Other Assets totals and Net Worth follow a change of one row's cached value and gain. */
export function shiftOtherAssetTotals(wb: WorkBook, valueDelta: number, gainDelta: number): void {
  const d3 = cellNumber(wb, 'Other Assets', 'D3') + valueDelta;
  const d4 = cellNumber(wb, 'Other Assets', 'D4') + gainDelta;
  set(wb, 'Other Assets', 'D3', num(d3, 'sum(O:O)'));
  set(wb, 'Other Assets', 'D4', num(d4, 'sum(P:P)'));
  set(wb, 'Net Worth', 'C9', num(d3, "'Other Assets'!D3"));
  set(wb, 'Net Worth', 'D9', num(d4, "'Other Assets'!D4"));
  const c12 = cellNumber(wb, 'Net Worth', 'C12') + valueDelta;
  const d15 = cellNumber(wb, 'Net Worth', 'D15') + valueDelta;
  set(wb, 'Net Worth', 'C12', num(c12, 'sum(C4:C11)'));
  set(wb, 'Net Worth', 'D15', num(d15, 'C12+E23'));
}

/**
 * Other Assets row 9 (a manual row of 2 units) gets a negative hand price K of −5: the cached O
 * and P follow and so do the totals. The importer writes no price entry for it (a price entry is
 * never negative), and migration 0004 skips it the same way.
 */
export function withNegativeHandPrice(wb: WorkBook): void {
  set(wb, 'Other Assets', 'K9', num(-5));
  set(wb, 'Other Assets', 'O9', num(2 * -5));
  set(wb, 'Other Assets', 'P9', num(2 * -5 - 2 * 60));
  shiftOtherAssetTotals(wb, 2 * -5 - 2 * 55, 2 * -5 - 2 * 55);
}

export interface ForeignRow {
  row: number;
  currency: string;
  /** AUD per unit of the currency on the purchase date (GBX: per penny). */
  purchaseRate: number;
  /** AUD per unit of the currency today (GBX: per penny). */
  liveRate: number;
}

/**
 * Turns an AUD Other Assets row into a foreign-currency row: the cached N, O and P as the template
 * computes them with the given rates (M, J and K unchanged), and the totals follow.
 */
export function withForeignRow(f: ForeignRow) {
  return (wb: WorkBook): void => {
    const s = 'Other Assets';
    const m = cellNumber(wb, s, `M${f.row}`);
    const j = cellNumber(wb, s, `J${f.row}`);
    const k = cellNumber(wb, s, `K${f.row}`);
    const oldN = cellNumber(wb, s, `N${f.row}`);
    const oldO = cellNumber(wb, s, `O${f.row}`);
    const n = m * j * f.purchaseRate;
    const o = m * k * f.liveRate;
    set(wb, s, `I${f.row}`, str(f.currency));
    set(wb, s, `N${f.row}`, num(n, `IF(AND(J${f.row}<>"",M${f.row}>0),M${f.row}*J${f.row},"")`));
    set(wb, s, `O${f.row}`, num(o, `IF(M${f.row}<>"",M${f.row}*K${f.row},"")`));
    set(wb, s, `P${f.row}`, num(o - n, `IF(N${f.row}<>"",O${f.row}-N${f.row},"")`));
    shiftOtherAssetTotals(wb, o - oldO, o - n - (oldO - oldN));
  };
}

/** Applies several mutations in order. */
export function all(...fns: ((wb: WorkBook) => void)[]) {
  return (wb: WorkBook): void => {
    for (const fn of fns) fn(wb);
  };
}
