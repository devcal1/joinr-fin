// Golden-only helpers (stage-3.md §9.1, §9.3 rules 3–8): the sheet's Cash KPI and Side Income
// formulas over the sheet's own columns, restricted to the recorded (closed) rows, for the
// recomputed expectations. Floats, as the sheet computes; the tolerances of §9.5 apply.
import { addMonthsIso, type IsoDate } from '@joinr/schema';
import { addDaysIso, dayNumber } from '../../src/num';
import { monthsBetween, yearWindow } from '../../src/periods';
import type { CashflowSheet, SideIncomeRow } from './cashflowAdapter';

/** One Cash!H:P row with the income parts behind its savings rate (Cash!M). */
export interface CashRow {
  row: number;
  date: IsoDate;
  /** Cash!I … P (null when not numeric: the sheet's "-" or blank). */
  I: number | null;
  J: number | null;
  K: number | null;
  L: number | null;
  M: number | null;
  N: number | null;
  O: number | null;
  P: number | null;
  /** History!W + Side Income!I of the period + the "No" dividends in the window. */
  rawIncome: number;
  /** Reinvested or blank dividends in the window (§11 fix 12 adds them to the income). */
  otherDividends: number;
  otherDividendRows: number;
}

/** Cash rows 3 → 800 with a date in H; Cash row r is History row r and Side Income row r − 1. */
export function readCashRows(cf: CashflowSheet): CashRow[] {
  const wb = cf.wb;
  const out: CashRow[] = [];
  let prev: IsoDate | null = null;
  for (let r = 3; r <= 800; r++) {
    const date = wb.date('Cash', `H${r}`);
    if (date === null) break;
    const num = (col: string) => wb.number('Cash', `${col}${r}`);
    let cashDividends = 0;
    let otherDividends = 0;
    let otherDividendRows = 0;
    if (prev !== null) {
      for (const d of cf.sheet.dividendRows) {
        if (!(d.paymentDate > prev && d.paymentDate <= date)) continue;
        if (d.reinvested === false) cashDividends += d.net;
        else {
          otherDividends += d.net;
          otherDividendRows += 1;
        }
      }
    }
    out.push({
      row: r,
      date,
      I: num('I'),
      J: num('J'),
      K: num('K'),
      L: num('L'),
      M: num('M'),
      N: num('N'),
      O: num('O'),
      P: num('P'),
      rawIncome:
        (wb.number('History', `W${r}`) ?? 0) +
        (wb.number('Side Income', `I${r - 1}`) ?? 0) +
        cashDividends,
      otherDividends,
      otherDividendRows,
    });
    prev = date;
  }
  return out;
}

/** The adjusted savings rate of a row: N / (raw income + other dividends); null without one. */
export function adjustedRate(r: CashRow): number | null {
  const income = r.rawIncome + r.otherDividends;
  return r.N === null || !(income > 0) ? null : r.N / income;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** The recomputed KPI panel (rules 3–5, 8) on the calendar basis, as the sheet. */
export interface KpiExpectations {
  c17: number | null;
  c18: number | null;
  c19: number | null;
  c20: number | null;
  c21: number;
  c22: number | null;
  c24: number | null;
  c25: boolean | null;
  c27: number | null;
  c30: { status: 'reached' | 'on_track' | 'no_savings'; months: number | null };
  c33: IsoDate | null;
  c37: number | null;
  c38: number | null;
  c39: number | null;
  trendPerMonth: number | null;
  c42: number;
  c43: number;
  yearRows: number;
  m4: number | null;
}

/**
 * The Cash KPI formulas over the recorded rows: rows dated ≤ Net Worth!C51 after the first (the
 * baseline has no savings figures, §11 fixes 14 and 18). `currentCash` is Cash!C13 (available
 * cash equals Total Cash in the workbook, every account being a bank account).
 */
export function recomputeKpis(
  rows: readonly CashRow[],
  o: {
    lastRun: IsoDate;
    jobStart: IsoDate | null;
    currentCash: number;
    goal: number | null;
    target: number | null;
  },
): KpiExpectations {
  const closed = rows.slice(1).filter((r) => r.date <= o.lastRun);
  const last = closed.at(-1) ?? null;
  const floorDate = addDaysIso(o.lastRun, -365);
  const from = o.jobStart !== null && o.jobStart > floorDate ? o.jobStart : floorDate;
  const win = closed.filter((r) => r.date >= from && r.I !== null);
  const c19 = mean(win.filter((r) => r.J !== null).map((r) => r.J!));
  const c20 = mean(win.filter((r) => r.N !== null).map((r) => r.N!));
  const year = yearWindow(o.lastRun, 'calendar');
  const inYear = closed.filter((r) => r.date >= year.start && r.date < year.end);
  const months = monthsBetween(o.lastRun, year.end);
  const c24 = c19 === null ? null : months * c19 + o.currentCash;

  let c30: KpiExpectations['c30'] = { status: 'no_savings', months: null };
  let c33: IsoDate | null = null;
  if (o.target !== null && o.currentCash >= o.target) c30 = { status: 'reached', months: null };
  else if (o.target !== null && c19 !== null && c19 > 0) {
    const m = Math.ceil((o.target - o.currentCash) / c19);
    c30 = { status: 'on_track', months: m };
    c33 = addMonthsIso(o.lastRun, m);
  }

  const yearWithSavings = inYear.filter((r) => r.N !== null);
  const yearIncome = sum(yearWithSavings.map((r) => r.rawIncome + r.otherDividends));
  const withRate = closed.filter((r) => adjustedRate(r) !== null).slice(-3);
  const rates = withRate.map((r) => adjustedRate(r)!);
  let trendPerMonth: number | null = null;
  if (withRate.length >= 2) {
    const xs = withRate.map((r) => dayNumber(r.date));
    const mx = mean(xs)!;
    const my = mean(rates)!;
    const den = sum(xs.map((x) => (x - mx) ** 2));
    if (den > 0) {
      const slope = sum(xs.map((x, i) => (x - mx) * (rates[i]! - my))) / den;
      trendPerMonth = (slope * 365.25) / 12;
    }
  }
  const spendFloor = addDaysIso(o.lastRun, -185);
  const spend = closed.filter((r) => r.date > spendFloor && r.P !== null).map((r) => r.P!);

  return {
    c17: last?.J ?? null,
    c18: last?.N ?? null,
    c19,
    c20,
    c21: sum(inYear.filter((r) => r.J !== null).map((r) => r.J!)),
    c22: c19 === null ? null : c19 * 12,
    c24,
    c25: c24 === null || o.goal === null ? null : c24 >= o.goal,
    c27: c24 === null || o.goal === null ? null : (c24 - o.goal) / Math.max(1, months),
    c30,
    c33,
    c37: last?.M ?? null,
    c38: yearIncome > 0 ? sum(yearWithSavings.map((r) => r.N!)) / yearIncome : null,
    c39: mean(rates),
    trendPerMonth,
    c42: sum(inYear.filter((r) => r.N !== null).map((r) => r.N!)),
    c43: sum(inYear.filter((r) => r.L !== null).map((r) => r.L!)),
    yearRows: inYear.length,
    m4: mean(spend),
  };
}

/** The Side Income formulas over the closed rows (rules 6, 7): a blank closed row counts as 0. */
export interface SideIncomeExpectations {
  c3: number | null;
  c6: number | null;
  /** A filled row straddles the FY start (E < FY start ≤ F): C4 is recomputed by deposit date. */
  c4Straddles: boolean;
}

export function recomputeSideIncome(
  rows: readonly SideIncomeRow[],
  asOf: IsoDate,
): SideIncomeExpectations {
  const fy = yearWindow(asOf, 'fy');
  const closed = rows.filter((r) => !r.live);
  const startOf = (r: SideIncomeRow) => r.start ?? `${r.end.slice(0, 7)}-01`;
  const cutoff = addDaysIso(asOf, -365);
  return {
    c3: mean(
      closed.filter((r) => startOf(r) >= fy.start && startOf(r) < fy.end).map((r) => r.total ?? 0),
    ),
    c6: mean(closed.filter((r) => startOf(r) > cutoff).map((r) => r.total ?? 0)),
    c4Straddles: rows.some(
      (r) => (r.g !== null || r.h !== null) && startOf(r) < fy.start && fy.start <= r.end,
    ),
  };
}
