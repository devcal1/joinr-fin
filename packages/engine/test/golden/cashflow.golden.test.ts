// Cash-flow goldens (stage-3.md §9.2–§9.5): the Stage 3 engine on sheet-faithful inputs against
// the local workbook's cached cells. Skipped when reference/ holds no single workbook. Every
// expected value is read at runtime; this file holds template cell references and rules only,
// and prints counts only (compared, skipped by reason, recomputed).
import {
  centsFromNumber,
  decimalFromNumber,
  INSTRUMENT_KINDS,
  type InstrumentKind,
  type IsoDate,
} from '@joinr/schema';
import { readWorkbook } from '@joinr/importer';
import { describeWithLocalWorkbook, readLocalWorkbookBytes } from '@joinr/importer/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cashDeficitMonths,
  cashKpis,
  computeBudget,
  computeDividends,
  computeSavings,
  computeSideIncome,
  type BudgetResult,
  type CashKpisResult,
  type DividendHoldingInput,
  type DividendsResult,
  type InvestmentsResult,
  type SavingsResult,
  type SideIncomeResult,
} from '../../src/index';
import { addDaysIso } from '../../src/num';
import { Sheet } from './adapter';
import { cellCents, CashflowSheet, monthEnd } from './cashflowAdapter';
import {
  adjustedRate,
  readCashRows,
  recomputeKpis,
  recomputeSideIncome,
  type CashRow,
  type KpiExpectations,
} from './cashflowFormulas';
import { CashflowTally } from './cashflowTally';

const GOLDEN_TIMEOUT = 120_000;

/** Dividends!L..O per holding type (Dividends!C text), P the total. */
const DIVIDEND_COLUMNS: readonly { col: string; kind: InstrumentKind }[] = [
  { col: 'L', kind: 'etf' },
  { col: 'M', kind: 'stock' },
  { col: 'N', kind: 'managed_fund' },
  { col: 'O', kind: 'crypto' },
];
const WEEKS_PER_MONTH = 4.34523783659;
/** Budget!B35's per-pay factor of the monthly amounts, by Budget!B3 text. */
const PER_PAY: Readonly<Record<string, (monthly: number) => number>> = {
  'Twice Monthly': (m) => 0.5 * m,
  Weekly: (m) => m / WEEKS_PER_MONTH,
  '2-weeks': (m) => (2 * m) / WEEKS_PER_MONTH,
  '4-weeks': (m) => (4 * m) / WEEKS_PER_MONTH,
};

describeWithLocalWorkbook('golden: the cash-flow engine against the local workbook', () => {
  describe('cached cells', { timeout: GOLDEN_TIMEOUT }, () => {
    let cf: CashflowSheet;
    let results: Map<InstrumentKind, InvestmentsResult>;
    let savings: SavingsResult;
    let kpis: CashKpisResult;
    let side: SideIncomeResult;
    let budget: BudgetResult;
    let dividends: DividendsResult;
    let holdings: DividendHoldingInput[];
    let cashRows: CashRow[];
    let expected: KpiExpectations;
    const tallies: CashflowTally[] = [];
    const tallyOf = (area: string) => {
      const t = new CashflowTally(area);
      tallies.push(t);
      return t;
    };

    beforeAll(() => {
      const bytes = readLocalWorkbookBytes();
      if (bytes === null) throw new Error('golden: the local workbook could not be read');
      const sheet = new Sheet(readWorkbook(bytes));
      cf = new CashflowSheet(sheet);
      const wb = cf.wb;
      results = new Map(INSTRUMENT_KINDS.map((k) => [k, sheet.run(k)]));
      savings = computeSavings(cf.savingsInput());
      kpis = cashKpis({
        asOf: cf.asOf,
        periods: savings.periods,
        yearBasis: 'calendar', // the sheet's Cash KPIs use the calendar year
        jobStartDate: wb.date('Budget', 'D2'),
        currentCashCents: cellCents(wb.number('Cash', 'C13')) ?? 0,
        eoyCashGoalCents: cellCents(wb.number('Cash', 'C26')),
        cashSavingsTargetCents: cellCents(wb.number('Cash', 'C31')),
      });
      side = computeSideIncome(cf.sideIncomeInput());
      budget = computeBudget(cf.budgetInput(side, results));
      holdings = cf.dividendHoldings(results);
      dividends = computeDividends({
        asOf: cf.asOf,
        holdings,
        trades: cf.trades,
        dividends: cf.dividends,
      });
      cashRows = readCashRows(cf);
      expected = recomputeKpis(cashRows, {
        lastRun: cf.lastRun,
        jobStart: wb.date('Budget', 'D2'),
        currentCash: wb.number('Cash', 'C13') ?? 0,
        goal: wb.number('Cash', 'C26'),
        target: wb.number('Cash', 'C31'),
      });
    }, GOLDEN_TIMEOUT);

    afterAll(() => {
      // Counts only (§9.3 rule 12): never a value, a symbol or a name.
      for (const t of tallies) console.log(t.line());
    });

    it('Cash history: J, K, L, M, N and P per History row (rules 1, 2, 8)', () => {
      const t = tallyOf('Cash history');
      compareCashHistory(cf, savings, cashRows, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Cash KPI panel on the calendar basis (rules 3–5, 8, 11)', () => {
      const t = tallyOf('Cash KPI panel');
      compareKpiPanel(cf, savings, kpis, expected, t);
      expect(t.failures).toEqual([]);
    });

    it('Side Income: the periods and the KPIs (rules 2, 6, 7)', () => {
      const t = tallyOf('Side Income');
      compareSideIncome(cf, side, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Budget: the chain, the item rows and the payday transfers (rules 3, 9, 14)', () => {
      const t = tallyOf('Budget');
      compareBudget(cf, budget, kpis, expected, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('Dividends: the rows, the FY table, the rolling 12 months and this FY (rule 10)', () => {
      const t = tallyOf('Dividends');
      compareDividends(cf, dividends, holdings, t);
      expect(t.failures).toEqual([]);
      expect(t.compared).toBeGreaterThan(0);
    });

    it('SheetOptions: the cash-deficit wait and the dividend projection (rule 13)', () => {
      const t = tallyOf('SheetOptions');
      compareSheetOptions(cf, dividends, expected, t);
      expect(t.failures).toEqual([]);
    });
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** A money cell the sheet may show as "-" (null ↔ null exactly). */
function moneyOrNull(
  t: CashflowTally,
  ref: string,
  sheet: number | null,
  engine: number | null,
  recomputed = false,
): void {
  if (sheet === null) t.exact(ref, null, engine, recomputed);
  else t.money(ref, sheet, engine, recomputed);
}

/** A ratio cell the sheet may show as "-" (null ↔ null exactly). */
function ratioOrNull(
  t: CashflowTally,
  ref: string,
  sheet: number | null,
  engine: string | null,
  recomputed = false,
): void {
  if (sheet === null) t.exact(ref, null, engine, recomputed);
  else t.ratio(ref, sheet, engine, recomputed);
}

// ─── Cash history (§9.2; rules 1, 2, 8) ────────────────────────────────────────────────────────

function compareCashHistory(
  cf: CashflowSheet,
  savings: SavingsResult,
  rows: readonly CashRow[],
  t: CashflowTally,
): void {
  const recorded = new Map(
    savings.periods.filter((p) => p.status !== 'provisional').map((p) => [p.runDate, p]),
  );
  const provisional = savings.periods.find((p) => p.status === 'provisional') ?? null;
  const liveClear = cf.liveWindowClear();
  rows.forEach((r, i) => {
    t.skip('never'); // Cash!O (projected cash): always equals I (rule 11)
    const at = (col: string, what: string) => `Cash!${col}${r.row} ${what}`;
    if (i === 0) {
      t.skip('first_period', 6); // rule 1: the baseline
      return;
    }
    const isLive = cf.live !== null && r.row === cf.live.row;
    if (isLive && (!liveClear || provisional === null)) {
      t.skip('live_window', 6); // rule 2
      return;
    }
    const p = isLive ? provisional : recorded.get(r.date);
    if (p === undefined || p === null) {
      t.failures.push(at('H', 'has no engine period'));
      return;
    }
    moneyOrNull(t, at('J', 'cash gain'), r.J, p.cashGainCents);
    ratioOrNull(t, at('K', 'cash gain %'), r.K, p.cashGainRatio);
    moneyOrNull(t, at('L', 'added investments'), r.L, p.addedInvestmentsCents);
    ratioOrNull(t, at('M', 'savings rate'), r.M, p.raw.savingsRatio);
    moneyOrNull(t, at('N', 'savings'), r.N, p.raw.savingsCents);
    moneyOrNull(t, at('P', 'spend'), r.P, p.raw.spendCents);
    // Rule 8: a reinvested or blank dividend in the window also counts in the adjusted income.
    if (r.otherDividendRows > 0) {
      const income = r.rawIncome + r.otherDividends;
      ratioOrNull(
        t,
        at('M', 'adjusted savings rate'),
        adjustedRate(r),
        p.adjusted.savingsRatio,
        true,
      );
      moneyOrNull(
        t,
        at('P', 'adjusted spend'),
        r.N === null || !(income > 0) ? null : income - r.N,
        p.adjusted.spendCents,
        true,
      );
    }
  });
}

// ─── Cash KPI panel (§9.2; rules 3–5, 8, 11) ───────────────────────────────────────────────────

/** Rule 5: C41 regresses a range that does not start at the savings-rate column. */
function c41Broken(cf: CashflowSheet): boolean {
  const formula = cf.wb.cell('Cash', 'C41')?.formula ?? null;
  if (formula === null) return false;
  const first = /INDIRECT\(\s*"([A-Z]+)"/i.exec(formula);
  const rateColumn = ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].find(
    (c) => cf.wb.text('Cash', `${c}2`) === 'Savings Rate',
  );
  return first === null || rateColumn === undefined || first[1]!.toUpperCase() !== rateColumn;
}

const trendWord = (v: string | number | null) =>
  v === null ? null : Number(v) > 0 ? 'Increasing!' : 'Decreasing!';

function compareKpiPanel(
  cf: CashflowSheet,
  savings: SavingsResult,
  kpis: CashKpisResult,
  e: KpiExpectations,
  t: CashflowTally,
): void {
  const wb = cf.wb;
  const cell = (addr: string) => wb.number('Cash', addr);
  // Rule 3: with a live row, the cells that include it are recomputed over the closed rows.
  const rc = cf.live !== null;
  const pick = <T>(recomputed: T, cached: T): T => (rc ? recomputed : cached);

  // Compared as cached: the goal and target settings, the current cash and the target progress.
  t.money(
    'Cash!C26 end-of-year goal (the goal the projection used)',
    cell('C26'),
    cellCents(cell('C26')),
  );
  t.money('Cash!C31 cash target', cell('C31'), kpis.cashTarget?.targetCents ?? null);
  t.money('Cash!C32 current cash', cell('C32'), savings.periods.at(-1)?.cashCents ?? null);
  t.ratio('Cash!C34 % of target', cell('C34'), kpis.cashTarget?.progressRatio ?? null);

  moneyOrNull(
    t,
    'Cash!C17 last cash gain',
    pick(e.c17, cell('C17')),
    kpis.lastPeriod?.cashGainCents ?? null,
    rc,
  );
  moneyOrNull(
    t,
    'Cash!C18 last savings',
    pick(e.c18, cell('C18')),
    kpis.lastPeriod?.savingsCents ?? null,
    rc,
  );
  moneyOrNull(
    t,
    'Cash!C19 cash saved per month',
    pick(e.c19, cell('C19')),
    kpis.avgCashGainCents,
    rc,
  );
  moneyOrNull(t, 'Cash!C20 saved per month', pick(e.c20, cell('C20')), kpis.avgSavingsCents, rc);
  t.sumMoney(
    'Cash!C21 cash gain this year',
    pick(e.c21, cell('C21')),
    kpis.yearCashGainCents,
    e.yearRows,
    rc,
  );
  moneyOrNull(
    t,
    'Cash!C22 predicted cash per year',
    pick(e.c22, cell('C22')),
    kpis.predictedCashPerYearCents,
    rc,
  );
  // C24, C25 and C27 are always recomputed: C27 divides by the months left (§11 fix 2).
  moneyOrNull(t, 'Cash!C24 end-of-year projection', e.c24, kpis.eoyProjectedCashCents, true);
  t.exact('Cash!C25 on target', e.c25, kpis.eoyOnTarget, true);
  moneyOrNull(t, 'Cash!C27 gap per month (fixed)', e.c27, kpis.eoyGapPerMonthCents, true);
  // C30, C33 with the §11 fix 24 precedence (reached first).
  t.check(
    'Cash!C30 time to the cash target',
    kpis.cashTarget !== null &&
      kpis.cashTarget.status === e.c30.status &&
      kpis.cashTarget.monthsToTarget === e.c30.months,
    true,
  );
  t.exact('Cash!C33 date of arrival', e.c33, kpis.cashTarget?.arrival ?? null, true);
  ratioOrNull(
    t,
    'Cash!C37 last savings rate',
    pick(e.c37, cell('C37')),
    kpis.lastPeriod?.rawSavingsRatio ?? null,
    rc,
  );
  // C38 income-weighted (§11 fix 15) and C39 over closed rows, on the adjusted income (rule 8).
  t.rate('Cash!C38 year savings rate (weighted)', e.c38, kpis.yearSavingsRatio, true);
  ratioOrNull(t, 'Cash!C39 3-month rate', pick(e.c39, cell('C39')), kpis.last3SavingsRatio, rc);
  // Rule 5: the sheet's C40/C41 regress the wrong columns; the fixed trend is recomputed.
  if (c41Broken(cf)) t.skip('broken_formula', 2);
  else t.exact('Cash!C40 trend', trendWord(e.trendPerMonth), trendWord(kpis.trendPerMonth), true);
  t.rate('Cash!C41 (fixed) trend per month', e.trendPerMonth, kpis.trendPerMonth, true);
  t.sumMoney(
    'Cash!C42 savings this year',
    pick(e.c42, cell('C42')),
    kpis.yearSavingsCents,
    e.yearRows,
    rc,
  );
  t.sumMoney(
    'Cash!C43 added this year',
    pick(e.c43, cell('C43')),
    kpis.yearAddedInvestmentsCents,
    e.yearRows,
    rc,
  );

  // Rule 11: never compared (the next-invest date, the sparklines); the house block (D55).
  t.skip('never', 3); // B15, C28, C35
  t.skip('replaced_by_goals', 8); // C45–C52
}

// ─── Side Income (§9.2; rules 2, 6, 7) ─────────────────────────────────────────────────────────

function compareSideIncome(cf: CashflowSheet, side: SideIncomeResult, t: CashflowTally): void {
  const wb = cf.wb;
  const liveClear = cf.liveWindowClear();
  const closed = new Map(side.periods.filter((p) => p.status === 'closed').map((p) => [p.end, p]));
  const provisional = side.periods.find((p) => p.status === 'provisional') ?? null;
  for (const r of cf.sideIncomeRows) {
    const at = (col: string, what: string) => `Side Income!${col}${r.row} ${what}`;
    if (r.live) {
      // Rule 2: its start and total are the provisional period's; its end is its month end.
      if (!liveClear || provisional === null) {
        t.skip('live_window', 3);
        continue;
      }
      t.exact(at('E', 'start'), r.start, provisional.start);
      t.skip('live_window'); // F
      t.money(at('I', 'total'), r.total ?? 0, provisional.totalCents);
      continue;
    }
    const p = closed.get(r.end);
    if (p === undefined) {
      t.failures.push(at('F', 'has no engine period'));
      continue;
    }
    t.exact(at('E', 'start'), r.start, p.start);
    t.exact(at('F', 'end'), r.end, p.end);
    t.money(at('I', 'total'), r.total ?? 0, p.totalCents);
  }

  const e = recomputeSideIncome(cf.sideIncomeRows, cf.asOf);
  const hasLive = cf.sideIncomeRows.some((r) => r.live);
  const n = cf.sideIncomeRows.length;
  const cell = (addr: string) => wb.number('Side Income', addr);
  // Rule 6: C3, C5, C6 and SheetOptions!H27 counted the unfilled live row as 0.
  const c3 = hasLive ? e.c3 : cell('C3');
  moneyOrNull(
    t,
    'Side Income!C3 average per period this FY',
    c3,
    side.avgPerPeriodThisFyCents,
    hasLive,
  );
  moneyOrNull(
    t,
    'Side Income!C5 projected this FY',
    hasLive ? (e.c3 === null ? null : e.c3 * 12) : cell('C5'),
    side.projectedYearCents,
    hasLive,
  );
  moneyOrNull(
    t,
    'Side Income!C6 365-day average',
    hasLive ? e.c6 : cell('C6'),
    side.avg365Cents,
    hasLive,
  );
  moneyOrNull(
    t,
    'SheetOptions!H27 projected side income',
    hasLive ? (e.c3 === null ? null : e.c3 * 12) : wb.number('SheetOptions', 'H27'),
    side.projectedYearCents,
    hasLive,
  );
  // Rule 7: C4 exact unless a filled row straddles the FY start (then by deposit date).
  if (e.c4Straddles) {
    const fyStart = side.fy.start;
    const byDate = cf.deposits
      .filter((d) => d.date >= fyStart && d.date < side.fy.end && d.date <= cf.asOf)
      .reduce((a, d) => a + d.amountCents, 0);
    t.exact('Side Income!C4 FY to date (by deposit date)', byDate, side.fyToDateCents, true);
  } else {
    t.sumMoney('Side Income!C4 FY to date', cell('C4'), side.fyToDateCents, n);
  }
  t.sumMoney('Side Income!C7 lifetime', cell('C7'), side.lifetimeCents, n);
}

// ─── Budget (§9.2; rules 3, 9, 14) ─────────────────────────────────────────────────────────────

function compareBudget(
  cf: CashflowSheet,
  budget: BudgetResult,
  kpis: CashKpisResult,
  e: KpiExpectations,
  t: CashflowTally,
): void {
  const wb = cf.wb;
  const cell = (addr: string) => wb.number('Budget', addr);
  const inv = budget.invest;

  // Rule 14: with side income in the budget, B2 took the cached C6 (the unfilled row as 0).
  const rule14 = wb.bool('Budget', 'D4') === true;
  const b2Cached = cell('B2');
  const c6Fixed = recomputeSideIncome(cf.sideIncomeRows, cf.asOf).c6 ?? 0;
  const b2 =
    rule14 && b2Cached !== null
      ? b2Cached - (wb.number('Side Income', 'C6') ?? 0) + c6Fixed
      : b2Cached;
  const j4 = cell('J4');
  const l7 = rule14 ? (b2 === null || j4 === null ? null : b2 - j4) : cell('L7');
  const splitOn = wb.bool('Budget', 'F4') === true;
  const h41 = wb.number('SheetOptions', 'H41') ?? 0;
  const h42 = wb.number('SheetOptions', 'H42') ?? 0;
  const tens = (x: number) => Math.trunc(x) * 10;
  const c28 = rule14 ? (l7 === null ? null : splitOn ? tens((l7 / 10) * h41) : 0) : cell('C28');
  const c29 = rule14
    ? l7 === null || c28 === null
      ? null
      : splitOn
        ? tens((l7 / 10) * h42)
        : tens((l7 - c28) / 10)
    : cell('C29');

  t.money('Budget!B2 monthly income', b2, inv.monthlyIncomeCents, rule14);
  t.money(
    'Budget!F2 annual income',
    rule14 ? (b2 === null ? null : b2 * 12) : cell('F2'),
    budget.annualIncomeCents,
    rule14,
  );
  // Rule 9: D3 compares as cached unless the last item row (which SUM(C8:C26) leaves out) is
  // non-zero; then it is the sheet's formula over every item row (the Stage 2 range fix).
  const investRow = cf.budgetRows.find((r) => r.input.kind === 'auto_invest')?.row ?? null;
  const lastItem = investRow === null ? null : cell(`C${investRow - 1}`);
  const rule9 = lastItem !== null && lastItem !== 0 && cell('D3') !== null;
  const months = inv.emergencyFundCents === null ? null : budgetMonths(cf);
  const d3 =
    rule9 && months !== null && j4 !== null ? Math.ceil((months * j4) / 1000) * 1000 : cell('D3');
  t.money('Budget!D3 emergency fund', d3, inv.emergencyFundCents, rule9);
  t.money('Budget!J4 planned spend', j4, inv.plannedSpendCents);
  t.money('Budget!L7 leftover', l7, inv.leftoverCents, rule14);
  t.money(
    'Budget!L9 yearly savings',
    rule14 ? (l7 === null ? null : l7 * 12) : cell('L9'),
    budget.yearlySavingsCents,
    rule14,
  );
  t.money('Budget!C24 yearly fund', cell('C24'), inv.yearlyFundCents);
  t.money('Budget!C28 investment row', c28, inv.investmentRowCents, rule14);
  t.money('Budget!C29 cash row', c29, inv.cashRowCents, rule14);
  t.ratio(
    'Budget!L11 planned savings rate',
    rule14 ? (b2 === null || c28 === null || c29 === null ? null : (c28 + c29) / b2) : cell('L11'),
    budget.plannedSavingsRatio,
    rule14,
  );
  // Rule 3: the actual spend (M4) included the live row.
  const hasLive = cf.live !== null;
  moneyOrNull(
    t,
    'Budget!M4 actual spend (6 months)',
    hasLive ? e.m4 : cell('M4'),
    kpis.spend6mRawCents,
    hasLive,
  );

  // Per item row: B (share of income), D (weekly), E (yearly).
  const monthlyOf = (row: number, kind: string): number =>
    rule14 && kind === 'auto_invest'
      ? (c28 ?? 0)
      : rule14 && kind === 'auto_cash'
        ? (c29 ?? 0)
        : (cell(`C${row}`) ?? 0);
  for (const r of cf.budgetRows.filter((x) => x.compared)) {
    const engineRow = budget.rows.find((x) => x.id === r.row);
    const at = (col: string, what: string) => `Budget!${col}${r.row} ${what}`;
    if (engineRow === undefined) {
      t.failures.push(at('A', 'has no engine row'));
      continue;
    }
    const share = rule14
      ? b2 === null || b2 === 0
        ? null
        : monthlyOf(r.row, r.input.kind) / b2
      : (cell(`B${r.row}`) ?? 0);
    t.ratio(at('B', 'share of income'), share, engineRow.incomeShareRatio, rule14);
    t.money(at('D', 'weekly'), cell(`D${r.row}`) ?? 0, engineRow.weeklyCents);
    t.money(at('E', 'yearly'), cell(`E${r.row}`) ?? 0, engineRow.yearlyCents);
  }

  // The payday transfers (A35:B): first-appearance order, the account text and the per-pay amount.
  const sheetTransfers = cf.transfers();
  const frequency = wb.text('Budget', 'B3') ?? '';
  sheetTransfers.forEach((s, i) => {
    const engineTransfer = budget.transfers[i];
    t.exact(`Budget!A${s.row} account`, s.account, engineTransfer?.accountName?.trim() ?? null);
    const group = cf.budgetRows.filter((r) => r.input.accountName === s.account);
    const recomputed =
      rule14 && group.some((r) => r.input.kind === 'auto_invest' || r.input.kind === 'auto_cash');
    const perPay = recomputed
      ? (PER_PAY[frequency] ?? ((m: number) => m))(
          group.reduce((a, r) => a + monthlyOf(r.row, r.input.kind), 0),
        )
      : s.perPay;
    t.money(`Budget!B${s.row} per pay`, perPay, engineTransfer?.perPayCents ?? null, recomputed);
  });
  if (budget.transfers.length !== sheetTransfers.length)
    t.failures.push('Budget!A35:A59 transfer count');
}

/** SheetOptions ID 30 (emergency-fund months), column L found by the column-P ID. */
function budgetMonths(cf: CashflowSheet): number | null {
  for (let r = 3; r <= 60; r++) {
    if (cf.wb.number('SheetOptions', `P${r}`) === 30) return cf.wb.number('SheetOptions', `L${r}`);
  }
  return null;
}

// ─── Dividends (§9.2; rule 10) ─────────────────────────────────────────────────────────────────

function compareDividends(
  cf: CashflowSheet,
  dividends: DividendsResult,
  holdings: readonly DividendHoldingInput[],
  t: CashflowTally,
): void {
  const wb = cf.wb;
  const cell = (addr: string) => wb.number('Dividends', addr);
  const rows = cf.sheet.dividendRows;

  // Per row: H (units at the ex-date) and I (the yield); G is typed input (rule 11).
  for (const d of rows) {
    t.skip('never'); // G
    if (d.exDate === null) {
      t.skip('no_ex_date', 2); // rule 10: the sheet shows 0 and 0, the engine null
      continue;
    }
    const engineRow = dividends.rows.find((x) => x.dividendId === d.row);
    t.units(
      `Dividends!H${d.row} units at the ex-date`,
      cell(`H${d.row}`) ?? 0,
      engineRow?.unitsAtEx ?? '0',
    );
    const sheetYield = cell(`I${d.row}`);
    if (sheetYield === null)
      t.exact(`Dividends!I${d.row} yield`, null, engineRow?.yieldRatio ?? null);
    else t.ratio(`Dividends!I${d.row} yield`, sheetYield, engineRow?.yieldRatio ?? '0');
  }

  // K4:P8, the five FYs by label (K4 the oldest), and their Σ in row 11.
  const fyOf = (date: IsoDate) =>
    Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1;
  const five = new Set<number>();
  for (let row = 4; row <= 8; row++) {
    const label = wb.text('Dividends', `K${row}`);
    const fy = label === null ? null : Number(/^(\d{4})/.exec(label)?.[1] ?? NaN);
    const engineRow = dividends.byFinancialYear.find((x) => x.financialYear === fy) ?? null;
    if (engineRow !== null) five.add(engineRow.financialYear);
    t.exact(
      `Dividends!K${row} FY`,
      label,
      engineRow === null ? null : `${engineRow.financialYear}-${engineRow.financialYear + 1}`,
    );
    const n = rows.filter((d) => fyOf(d.paymentDate) === fy).length;
    for (const { col, kind } of DIVIDEND_COLUMNS) {
      t.sumMoney(
        `Dividends!${col}${row} ${kind}`,
        cell(`${col}${row}`) ?? 0,
        engineRow?.byKind[kind] ?? null,
        n,
      );
    }
    t.sumMoney(`Dividends!P${row} total`, cell(`P${row}`) ?? 0, engineRow?.totalCents ?? null, n);
  }
  const fiveRows = dividends.byFinancialYear.filter((x) => five.has(x.financialYear));
  const nFive = rows.filter((d) => five.has(fyOf(d.paymentDate))).length;
  for (const { col, kind } of DIVIDEND_COLUMNS) {
    t.sumMoney(
      `Dividends!${col}11 ${kind} (five FYs)`,
      cell(`${col}11`) ?? 0,
      fiveRows.reduce((a, x) => a + x.byKind[kind], 0),
      nFive,
    );
  }
  t.sumMoney(
    'Dividends!P11 total (five FYs)',
    cell('P11') ?? 0,
    fiveRows.reduce((a, x) => a + x.totalCents, 0),
    nFive,
  );

  // K30:P41, the rolling 12 calendar months ending with the as-of month (TODAY() = E52).
  for (let i = 0; i < 12; i++) {
    const row = 30 + i;
    const month = dividends.rolling12[i] ?? null;
    t.exact(
      `Dividends!K${row} month end`,
      wb.date('Dividends', `K${row}`),
      month === null ? null : monthEnd(`${month.month}-01`),
    );
    const n =
      month === null ? 0 : rows.filter((d) => d.paymentDate.slice(0, 7) === month.month).length;
    for (const { col, kind } of DIVIDEND_COLUMNS) {
      t.sumMoney(
        `Dividends!${col}${row} ${kind}`,
        cell(`${col}${row}`) ?? 0,
        month?.byKind[kind] ?? null,
        n,
      );
    }
    t.sumMoney(`Dividends!P${row} total`, cell(`P${row}`) ?? 0, month?.totalCents ?? null, n);
  }

  // K45:R88, this FY by ticker (M89 its total).
  compareThisFy(cf, dividends, holdings, t);
  const thisFy = rows.filter((d) => d.paymentDate >= fyStartOf(cf.asOf)).length;
  t.sumMoney('Dividends!M89 this FY total', cell('M89') ?? 0, dividends.kpis.thisFyCents, thisFy);
}

function fyStartOf(date: IsoDate): IsoDate {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
}

/**
 * K45:R88. An empty table (no payment this FY) must match an empty engine table. A filled row is
 * compared per ticker linked the sheet's way (exact symbol): M (net this FY), P (frequency) and Q
 * (DRP) as cached; N, O and R recomputed with the fixed yield mean (payments with a yield only,
 * §11 fix 23) over the sheet's own I column.
 */
function compareThisFy(
  cf: CashflowSheet,
  dividends: DividendsResult,
  holdings: readonly DividendHoldingInput[],
  t: CashflowTally,
): void {
  const wb = cf.wb;
  if (wb.text('Dividends', 'K45') === null) {
    t.exact('Dividends!K45 this FY by holding (empty)', 0, dividends.holdingsThisFy.length);
    return;
  }
  const symbolOf = new Map<number, string>();
  for (const kind of INSTRUMENT_KINDS) {
    for (const [id, symbol] of cf.sheet.tab(kind).symbolOf) symbolOf.set(id, symbol);
  }
  const cutoff = addDaysIso(cf.asOf, -365);
  for (let row = 45; row <= 88; row++) {
    const ticker = wb.text('Dividends', `K${row}`);
    if (ticker === null) break;
    const at = (col: string, what: string) => `Dividends!${col}${row} ${what}`;
    const h = dividends.holdingsThisFy.find((x) => symbolOf.get(x.instrumentId) === ticker);
    if (h === undefined) {
      t.failures.push(at('K', 'has no linked engine holding'));
      continue;
    }
    t.money(at('M', 'net this FY'), wb.number('Dividends', `M${row}`), h.netThisFyCents);
    const freq = wb.number('Dividends', `P${row}`);
    t.exact(at('P', 'frequency'), freq !== null && freq > 0 ? freq : null, h.frequencyMonths);
    t.exact(at('Q', 'DRP'), wb.bool('Dividends', `Q${row}`), h.drp);
    const yields = cf.sheet.dividendRows
      .filter((d) => d.ticker === ticker && d.paymentDate > cutoff && d.paymentDate <= cf.asOf)
      .map((d) => ({
        i: wb.number('Dividends', `I${d.row}`),
        h: wb.number('Dividends', `H${d.row}`),
        g: d.priceAtEx,
      }))
      .filter((x) => x.i !== null && x.h !== null && x.h > 0 && x.g !== null)
      .map((x) => x.i!);
    const meanYield =
      yields.length === 0 ? null : yields.reduce((a, b) => a + b, 0) / yields.length;
    const f = h.frequencyMonths;
    t.ratio(
      at('O', 'yield (12 months, annualised)'),
      meanYield === null || f === null ? null : (meanYield * 12) / f,
      h.yield365Ratio,
      true,
    );
    const units = Number(holdings.find((x) => x.instrumentId === h.instrumentId)?.unitsNow ?? 0);
    const n =
      f === null || meanYield === null || !(meanYield > 0) || !(units > 0)
        ? null
        : Math.ceil(f / (meanYield * units));
    t.exact(at('N', 'months to +1 unit'), n, h.monthsToExtraUnit, true);
    const advice =
      h.drp === null || n === null
        ? null
        : n < 6 && !h.drp
          ? 'switch_on'
          : n >= 6 && h.drp
            ? 'switch_off'
            : 'keep';
    t.exact(at('R', 'DRP advice'), advice, h.advice, true);
  }
}

// ─── SheetOptions (§9.2; rule 13) ──────────────────────────────────────────────────────────────

function compareSheetOptions(
  cf: CashflowSheet,
  dividends: DividendsResult,
  e: KpiExpectations,
  t: CashflowTally,
): void {
  const wb = cf.wb;
  const cash = cellCents(wb.number('Cash', 'C13')) ?? 0;
  const liquid = cf.liquidTotalCents();
  const targetCell = wb.number('Net Worth', 'D41');
  const target = targetCell === null ? null : decimalFromNumber(targetCell);
  const engine = cashDeficitMonths({
    cashCents: cash,
    liquidTotalCents: liquid,
    targetRatio: target,
    avgMonthlySavingsCents: e.c20 === null ? null : centsFromNumber(e.c20),
  });
  if (wb.text('SheetOptions', 'H12') === '-') {
    t.exact('SheetOptions!H12 cash-deficit wait ("-")', null, engine);
  } else {
    // Rule 13: the fixed formula (§11 fix 16) over the §9.1 inputs and the closed-row C20.
    const c = cash / 100;
    const l = liquid / 100;
    const expectedMonths =
      targetCell === null || e.c20 === null || !(e.c20 > 0) || !(l > 0) || c / l >= targetCell
        ? null
        : Math.floor((targetCell * l - c) / e.c20) + 1;
    t.exact('SheetOptions!H12 cash-deficit wait (fixed)', expectedMonths, engine, true);
  }
  t.money(
    'SheetOptions!H28 projected FY dividends',
    wb.number('SheetOptions', 'H28'),
    dividends.kpis.projectedFyCents,
  );
  t.exact(
    'SheetOptions!H30 days into the FY',
    wb.number('SheetOptions', 'H30'),
    dividends.kpis.daysIntoFy,
  );
}
