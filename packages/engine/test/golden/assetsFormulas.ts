// Golden-only helpers (stage-4.md §9.1, §9.3): the sheet's RRI, NPER, CUMIPMT, EDATE and DATEDIF
// formulas, and the Other Assets cost lines over the sheet's own cells (the sheet's Z: `<` over the
// dated rows; the app's `≤` with the D73 assumed date). Floats, as the sheet computes. They
// validate the adapter and give the recomputed expectations of §9.3; nothing here is printed.
import { addMonthsIso, type IsoDate } from '@joinr/schema';
import { dayNumber } from '../../src/num';

/** Sheets RRI(n, pv, fv) = (fv ÷ pv)^(1 ÷ n) − 1; null where the sheet would show an error. */
export function rri(years: number, pv: number, fv: number): number | null {
  if (!(years > 0) || pv === 0 || fv / pv < 0) return null;
  return Math.pow(fv / pv, 1 / years) - 1;
}

/** The annualised growth of a value over a cost held `days` days (365.25-day years, §2.3). */
export function cagrFromCells(value: number, cost: number, days: number): number | null {
  return rri(days / 365.25, cost, value);
}

/** Sheets NPER(rate, pmt, pv) with fv = 0 and type 0 (pmt negative for a repayment). */
export function sheetNper(rate: number, pmt: number, pv: number): number | null {
  if (rate === 0) return pmt === 0 ? null : -pv / pmt;
  const inner = pmt / (pv * rate + pmt);
  if (!(inner > 0)) return null;
  return Math.log(inner) / Math.log(1 + rate);
}

/** Sheets CUMIPMT(rate, nper, pv, start, end, 0): the interest of periods start…end (negative). */
export function cumipmt(
  rate: number,
  nper: number,
  pv: number,
  start: number,
  end: number,
): number {
  const pmt = (pv * rate) / (1 - Math.pow(1 + rate, -nper));
  let balance = pv;
  let total = 0;
  for (let k = 1; k <= end; k++) {
    const interest = balance * rate;
    if (k >= start) total += interest;
    balance = balance + interest - pmt;
  }
  return -total;
}

/** Sheets EDATE(date, months): the months argument truncated toward zero, the day clamped. */
export function edate(date: IsoDate, months: number): IsoDate {
  return addMonthsIso(date, Math.trunc(months));
}

/** Sheets DATEDIF(from, to, "Y"): whole years. */
export function datedifYears(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

/** The 1900-system serial of a date (the sheet's number for it). */
export function sheetSerial(date: IsoDate): number {
  return dayNumber(date) + 25_569;
}

/** Sheets ROUNDUP(x, 0): away from zero. */
export function roundUp(x: number): number {
  return x < 0 ? -Math.ceil(-x) : Math.ceil(x);
}

/** One Other Assets row as the cost lines read it: its purchase date (G) and cached cost (N). */
export interface CostRow {
  purchaseDate: IsoDate | null;
  cost: number | null;
}

/** The sheet's Z: SUMIFS(N, G, "<"&date) (dated rows only, strictly before the date). */
export function costBefore(rows: readonly CostRow[], date: IsoDate): number {
  let total = 0;
  for (const r of rows) {
    if (r.purchaseDate !== null && r.cost !== null && r.purchaseDate < date) total += r.cost;
  }
  return total;
}

/**
 * The app's cost line recomputed from the sheet's N (§11 fix 13, D73): rows whose purchase date,
 * else `assumedDate` (null: undated rows left out), is on or before the date.
 */
export function costOnOrBefore(
  rows: readonly CostRow[],
  date: IsoDate,
  assumedDate: IsoDate | null,
): number {
  let total = 0;
  for (const r of rows) {
    const effective = r.purchaseDate ?? assumedDate;
    if (effective !== null && r.cost !== null && effective <= date) total += r.cost;
  }
  return total;
}

/** Σ N of the rows dated in `(after, through]` (the other-asset part of Cash!L). */
export function costDatedBetween(
  rows: readonly CostRow[],
  after: IsoDate,
  through: IsoDate,
): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (r.purchaseDate === null || r.cost === null) continue;
    if (r.purchaseDate > after && r.purchaseDate <= through) {
      total += r.cost;
      count += 1;
    }
  }
  return { total, count };
}
