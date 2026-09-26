// Server golden (stage-3.md §9.4): the local workbook imported with corrections OFF → DB → the
// cash-flow API, compared with the workbook's own cached cells (read at runtime) or with
// expectations recomputed from the sheet's own columns where §9.3 says the sheet broke or mixed in
// its live row. Nothing here holds an owner value: only template cell references and rules. Gated
// on the Stage 3 engine and importer, and skipped when the workbook is absent. Prints counts only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import { importWorkbook, readWorkbook, type WorkbookReader } from '@joinr/importer';
import {
  describeWithLocalWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  addMonthsIso,
  centsFromNumber,
  type BudgetPageResponse,
  type CashPageResponse,
  type DividendsPageResponse,
  type InstrumentKind,
  type InvestmentPageResponse,
  type IsoDate,
  type SideIncomePageResponse,
} from '@joinr/schema';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';

// Stage 4 (stage-4.md §7.4 step 7): the provisional period's parts come from the assets engines.
const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED;

// ─── Counting (§9.3 rule 12) ────────────────────────────────────────────────────────────────────

type Reason =
  | 'first_period'
  | 'live_window'
  | 'broken_formula'
  | 'no_ex_date'
  | 'replaced_by_goals'
  | 'never'
  | 'defined_by_decision';
interface Tally {
  compared: number;
  recomputed: number;
  skipped: Partial<Record<Reason, number>>;
}
const tallies: Record<string, Tally> = {};
const tally = (area: string): Tally =>
  (tallies[area] ??= { compared: 0, recomputed: 0, skipped: {} });
const compared = (area: string, n = 1) => {
  tally(area).compared += n;
};
const recomputed = (area: string, n = 1) => {
  tally(area).recomputed += n;
};
const skipped = (area: string, reason: Reason, n = 1) => {
  const s = tally(area).skipped;
  s[reason] = (s[reason] ?? 0) + n;
};

// ─── Tolerances (§9.5): labels name template cells only, never values ───────────────────────────

const rel = (v: number) => 1e-9 * Math.abs(v);
function expectMoney(actual: number | null, sheetDollars: number | null, label: string, cents = 1) {
  if (sheetDollars === null) {
    expect(actual, label).toBeNull();
    return;
  }
  const want = centsFromNumber(sheetDollars);
  expect(actual, label).not.toBeNull();
  expect(Math.abs(actual! - want) <= Math.max(cents, rel(want)), label).toBe(true);
}
function expectRatio(actual: string | null, sheet: number | null, label: string, abs?: number) {
  if (sheet === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  const tol = abs ?? Math.max(1e-6, 1e-5 * Math.abs(sheet));
  expect(Math.abs(Number(actual) - sheet) <= Math.max(tol, rel(sheet)), label).toBe(true);
}

// ─── Date helpers (sheet semantics) ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayOf = (iso: IsoDate) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
/** EOMONTH(date, 0). */
const monthEnd = (iso: IsoDate): IsoDate =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
/** DATEDIF "M". */
function monthsBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}
const fyStartOf = (iso: IsoDate): IsoDate =>
  Number(iso.slice(5, 7)) >= 7
    ? `${iso.slice(0, 4)}-07-01`
    : `${Number(iso.slice(0, 4)) - 1}-07-01`;
const fyEndOf = (iso: IsoDate): IsoDate => `${Number(fyStartOf(iso).slice(0, 4)) + 1}-07-01`;
const mean = (a: readonly number[]) =>
  a.length === 0 ? null : a.reduce((s, x) => s + x, 0) / a.length;
const sum = (a: readonly number[]) => a.reduce((s, x) => s + x, 0);

// ─── The sheet's rows ───────────────────────────────────────────────────────────────────────────

interface CashRow {
  row: number;
  date: IsoDate;
  live: boolean;
  first: boolean;
  I: number | null;
  J: number | null;
  K: number | null;
  L: number | null;
  M: number | null;
  N: number | null;
  P: number | null;
  /** Raw income (N / M, or P + N): salary + side income + cash dividends. */
  income: number | null;
  /** Dividends paid in the row's window that are not marked "No" (reinvested or blank). */
  otherDividends: number;
  adjustedIncome: number | null;
  adjustedRate: number | null;
  adjustedSpend: number | null;
}

interface DividendSheetRow {
  date: IsoDate;
  type: string | null;
  reinvested: string | null;
  net: number;
}

function readDividendRows(r: WorkbookReader): DividendSheetRow[] {
  const out: DividendSheetRow[] = [];
  for (let row = 4; row <= 500; row++) {
    const date = r.date('Dividends', `A${row}`);
    if (date === null) continue;
    out.push({
      date,
      type: r.text('Dividends', `C${row}`),
      reinvested: r.text('Dividends', `E${row}`),
      net: r.number('Dividends', `F${row}`) ?? 0,
    });
  }
  return out;
}

function readCashRows(r: WorkbookReader, dividends: readonly DividendSheetRow[]): CashRow[] {
  const rows: CashRow[] = [];
  for (let row = 3; row <= 799; row++) {
    const date = r.date('History', `A${row}`);
    if (date === null) break;
    const n = (c: string) => r.number('Cash', `${c}${row}`);
    const N = n('N');
    const M = n('M');
    const P = n('P');
    const income =
      N !== null && P !== null ? N + P : N !== null && M !== null && M !== 0 ? N / M : null;
    rows.push({
      row,
      date,
      live: (r.cell('History', `B${row}`)?.formula ?? null) !== null,
      first: row === 3,
      I: n('I'),
      J: n('J'),
      K: n('K'),
      L: n('L'),
      M,
      N,
      P,
      income,
      otherDividends: 0,
      adjustedIncome: null,
      adjustedRate: null,
      adjustedSpend: null,
    });
  }
  rows.forEach((x, i) => {
    const prev = rows[i - 1];
    if (!prev) return;
    x.otherDividends = sum(
      dividends
        .filter((d) => d.date > prev.date && d.date <= x.date && d.reinvested !== 'No')
        .map((d) => d.net),
    );
    x.adjustedIncome = x.income === null ? null : x.income + x.otherDividends;
    x.adjustedRate =
      x.N === null || x.adjustedIncome === null || x.adjustedIncome <= 0
        ? null
        : x.N / x.adjustedIncome;
    x.adjustedSpend =
      x.N === null || x.adjustedIncome === null || x.adjustedIncome <= 0
        ? null
        : x.adjustedIncome - x.N;
  });
  return rows;
}

// ─── The test ───────────────────────────────────────────────────────────────────────────────────

describeWithLocalWorkbook('cash-flow server golden (import → DB → API)', (workbookPath) => {
  describe.skipIf(!GATED)('corrections off, market off, as of the workbook date', () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    let r: WorkbookReader;
    let asOf: IsoDate;
    let lastRun: IsoDate;
    let cashRows: CashRow[];
    let dividendRows: DividendSheetRow[];
    let cash: CashPageResponse;
    let side: SideIncomePageResponse;
    let budget: BudgetPageResponse;
    let dividends: DividendsPageResponse;
    let etf: InvestmentPageResponse;

    beforeAll(async () => {
      const bytes = new Uint8Array(readFileSync(workbookPath));
      r = readWorkbook(bytes);
      const e52 = r.date('Net Worth', 'E52');
      const c51 = r.date('Net Worth', 'C51');
      if (e52 === null || c51 === null) throw new Error('Net Worth!E52 or C51 is not a date');
      asOf = e52;
      lastRun = c51;
      const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
      const now = new Date(y, m - 1, d, 12, 0, 0);
      dividendRows = readDividendRows(r);
      cashRows = readCashRows(r, dividendRows);

      tempDir = await makeTempDir('joinr-golden-cashflow-');
      const config = testConfig(join(tempDir, 'data'));
      database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      const result = importWorkbook(database.db, {
        bytes,
        fileName: 'workbook.xlsx',
        trigger: 'cli',
        corrections: null,
        now: () => now,
      });
      expect(result.status).toBe('succeeded');
      app = await buildApp({ config, db: database, now: () => now });
      const get = async <T>(url: string): Promise<T> => {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        return res.json<T>();
      };
      cash = await get<CashPageResponse>('/api/cash');
      side = await get<SideIncomePageResponse>('/api/side-income');
      budget = await get<BudgetPageResponse>('/api/budget');
      dividends = await get<DividendsPageResponse>('/api/dividends');
      etf = await get<InvestmentPageResponse>('/api/investments/etf');
      expect(cash.asOf).toBe(asOf);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      if (tempDir) await removeDir(tempDir);
      for (const [area, t] of Object.entries(tallies)) {
        console.log(
          `[golden:server:cashflow] ${area} compared: ${t.compared} · skipped: ${JSON.stringify(t.skipped)} · recomputed: ${t.recomputed}`,
        );
      }
    });

    /**
     * Stage 4 (stage-4.md §9.3 rule 12): Σ row 31 (interest) of the used Property slots D…O (the
     * Stage 1 import predicate: a purchase or current value, a start or current balance, or a
     * purchase date). The provisional principal paid is start − current (D66), which equals the
     * live History AD whenever this Σ is ≥ 0; only a negative Σ makes the definitions differ.
     */
    function propertyInterestSum(): number {
      let sum = 0;
      for (let c = 'D'.charCodeAt(0); c <= 'O'.charCodeAt(0); c++) {
        const col = String.fromCharCode(c);
        const n = (row: number) => r.number('Property', `${col}${row}`);
        const nonZero = (v: number | null) => v !== null && v !== 0;
        const used =
          nonZero(n(18)) ||
          nonZero(n(19)) ||
          nonZero(n(28)) ||
          nonZero(n(29)) ||
          r.date('Property', `${col}16`) !== null;
        if (used) sum += n(31) ?? 0;
      }
      return sum;
    }

    /** Something dated in the live row's extra window (E52, EOMONTH(E52)] (§9.3 rule 2). */
    function liveWindowHasActivity(): boolean {
      const after = asOf;
      const through = monthEnd(asOf);
      const inWindow = (d: IsoDate | null) => d !== null && d > after && d <= through;
      for (const [sheet, first] of [
        ['ETFs', 23],
        ['Stocks', 23],
        ['Managed Funds', 23],
        ['Crypto', 17],
      ] as const) {
        for (let row = first; row <= 800; row++)
          if (inWindow(r.date(sheet, `B${row}`))) return true;
      }
      for (let row = 3; row <= 500; row++)
        if (inWindow(r.date('Other Assets', `G${row}`))) return true;
      if (dividendRows.some((d) => inWindow(d.date))) return true;
      return false;
    }

    it('Cash: Total Cash and every History row (§9.2, rules 1, 2, 8)', () => {
      const area = 'Cash history';
      expectMoney(cash.totals.totalCashCents, r.number('Cash', 'C13'), 'Cash!C13');
      // The import gives every account kind `bank`: available cash = Total Cash (D59, §9.4).
      expectMoney(cash.totals.availableCashCents, r.number('Cash', 'C13'), 'available = Cash!C13');
      expect(cash.goals.cashBasis).toBe('available');
      compared(area, 2);

      const byRun = new Map(cash.periods.map((p) => [p.runDate, p]));
      const provisional = cash.periods.find((p) => p.status === 'provisional');
      for (const x of cashRows) {
        skipped(area, 'never'); // Cash!O (projected cash) is never compared (rule 11)
        if (x.first) {
          skipped(area, 'first_period', 6);
          continue;
        }
        let period = byRun.get(x.date);
        if (x.live) {
          if (liveWindowHasActivity() || !provisional) {
            skipped(area, 'live_window', 6);
            continue;
          }
          // Stage 4 (§9.3 rule 12, narrowed): a negative interest Σ only.
          if (propertyInterestSum() < 0) {
            skipped(area, 'defined_by_decision', 6);
            continue;
          }
          period = provisional;
        }
        const at = (c: string) => `Cash!${c}${x.row}`;
        expect(period, at('H')).toBeDefined();
        expectMoney(period!.cashGainCents, x.J, at('J'));
        expectRatio(period!.cashGainRatio, x.K, at('K'));
        expectMoney(period!.addedInvestmentsCents, x.L, at('L'));
        expectRatio(period!.raw.savingsRatio, x.M, at('M'));
        expectMoney(period!.raw.savingsCents, x.N, at('N'));
        expectMoney(period!.raw.spendCents, x.P, at('P'));
        compared(area, 6);
        // Rule 8: the adjusted income adds the reinvested and blank dividends of the window.
        if (x.otherDividends !== 0) {
          expectMoney(period!.adjusted.incomeCents, x.adjustedIncome, `adjusted income ${x.row}`);
          recomputed(area);
        }
      }
    });

    it('Cash: the KPI panel on the FY basis, recomputed over the closed rows (rules 3–5)', () => {
      const area = 'Cash KPIs';
      const k = cash.kpis;
      const closed = cashRows.filter((x) => !x.first && !x.live && x.date <= lastRun);
      const currentCash = r.number('Cash', 'C13') ?? 0;
      expect(k.anchor).toBe(lastRun);
      expect(k.year).toEqual({
        basis: 'fy',
        start: fyStartOf(lastRun),
        end: fyEndOf(lastRun),
        year: Number(fyStartOf(lastRun).slice(0, 4)),
      });
      compared(area, 2);

      // C17, C18, C37: the last closed period.
      const last = closed.at(-1)!;
      expectMoney(k.lastPeriod?.cashGainCents ?? null, last.J, 'C17');
      expectMoney(k.lastPeriod?.savingsCents ?? null, last.N, 'C18');
      expectRatio(k.lastPeriod?.rawSavingsRatio ?? null, last.M, 'C37');
      expectRatio(k.lastPeriod?.savingsRatio ?? null, last.adjustedRate, 'C37 adjusted');
      recomputed(area, 3);

      // C19, C20, C22: the 12-month window (from max(anchor − 365, job start)).
      const jobStart = r.date('Budget', 'D2');
      const floor = Math.max(dayOf(lastRun) - 365, jobStart === null ? -Infinity : dayOf(jobStart));
      const win = closed.filter((x) => dayOf(x.date) >= floor && x.J !== null);
      const avgJ = mean(win.map((x) => x.J!));
      expect(k.avgWindow?.periods ?? 0).toBe(win.length);
      expectMoney(k.avgCashGainCents, avgJ, 'C19');
      expectMoney(k.avgCashGainAdjustedCents, avgJ, 'C19 adjusted (no adjustments)');
      expectMoney(k.avgSavingsCents, mean(win.filter((x) => x.N !== null).map((x) => x.N!)), 'C20');
      expectMoney(k.predictedCashPerYearCents, avgJ === null ? null : avgJ * 12, 'C22');
      recomputed(area, 3);

      // C21, C42, C43 and C38 over the FY of the anchor (the app's default basis, D52).
      const inYear = closed.filter((x) => x.date >= k.year.start && x.date < k.year.end);
      const n = inYear.length;
      expect(k.yearPeriods).toBe(n);
      expectMoney(k.yearCashGainCents, sum(inYear.map((x) => x.J ?? 0)), 'C21', Math.max(1, n));
      expectMoney(k.yearSavingsCents, sum(inYear.map((x) => x.N ?? 0)), 'C42', Math.max(1, n));
      expectMoney(
        k.yearAddedInvestmentsCents,
        sum(inYear.map((x) => x.L ?? 0)),
        'C43',
        Math.max(1, n),
      );
      const yearIncome = sum(inYear.map((x) => x.adjustedIncome ?? 0));
      expectRatio(
        k.yearSavingsRatio,
        n === 0 || yearIncome <= 0 ? null : sum(inYear.map((x) => x.N ?? 0)) / yearIncome,
        'C38 (income-weighted, fix 15)',
      );
      recomputed(area, 4);

      // C39 and the fixed C41 trend (rule 5): the last three closed rows with a rate.
      skipped(area, 'broken_formula', 2); // C40, C41 as cached
      const rated = closed.filter((x) => x.adjustedRate !== null).slice(-3);
      expectRatio(k.last3SavingsRatio, mean(rated.map((x) => x.adjustedRate!)), 'C39');
      let slope: number | null = null;
      if (rated.length >= 2) {
        const xs = rated.map((x) => dayOf(x.date));
        const ys = rated.map((x) => x.adjustedRate!);
        const mx = mean(xs)!;
        const my = mean(ys)!;
        const den = sum(xs.map((v) => (v - mx) ** 2));
        slope =
          den === 0
            ? null
            : (sum(xs.map((v, i) => (v - mx) * (ys[i]! - my))) / den) * (365.25 / 12);
      }
      expectRatio(k.trendPerMonth, slope, 'C41 fixed', 1e-6);
      recomputed(area, 2);

      // C24, C25, C27 (fix 2) and C30–C34 (fix 24) from available cash (= Cash!C13 here).
      const months = monthsBetween(lastRun, k.year.end);
      expect(k.monthsToYearEnd).toBe(months);
      const projected = avgJ === null ? null : months * avgJ + currentCash;
      expectMoney(k.eoyProjectedCashCents, projected, 'C24');
      const goal = r.number('Cash', 'C26');
      if (goal !== null && projected !== null) {
        expect(k.eoyOnTarget, 'C25').toBe(projected >= goal);
        expectMoney(k.eoyGapPerMonthCents, (projected - goal) / Math.max(1, months), 'C27');
      }
      compared(area, 1);
      recomputed(area, 3);
      const target = r.number('Cash', 'C31');
      if (target !== null && target > 0) {
        expectMoney(k.cashTarget?.targetCents ?? null, target, 'C31');
        expectRatio(k.cashTarget?.progressRatio ?? null, currentCash / target, 'C34');
        compared(area, 2);
        if (currentCash >= target) {
          expect(k.cashTarget?.status, 'C30').toBe('reached');
        } else if (avgJ !== null && avgJ > 0) {
          const m = Math.ceil((target - currentCash) / avgJ);
          expect(k.cashTarget?.status, 'C30').toBe('on_track');
          expect(k.cashTarget?.monthsToTarget, 'C30').toBe(m);
          expect(k.cashTarget?.arrival, 'C33').toBe(addMonthsIso(lastRun, m));
        } else {
          expect(k.cashTarget?.status, 'C30').toBe('no_savings');
        }
        recomputed(area, 2);
      }
      expectMoney(cash.totals.availableCashCents, r.number('Cash', 'C32'), 'C32');
      expectMoney(
        (cash.settings.values['goals.eoyCashGoalCents'] as number | null | undefined) ?? null,
        goal,
        'C26',
      );
      compared(area, 2);
      skipped(area, 'never', 3); // B15, C28, C35 (rule 11)
      skipped(area, 'replaced_by_goals', 8); // C45:C52 (D55)

      // Budget!M4: the 185-day spend, closed rows only (rule 3).
      const spendRows = closed.filter((x) => dayOf(x.date) > dayOf(lastRun) - 185);
      expect(k.spend6mPeriods).toBe(spendRows.filter((x) => x.adjustedSpend !== null).length);
      expectMoney(
        k.spend6mCents,
        mean(spendRows.filter((x) => x.adjustedSpend !== null).map((x) => x.adjustedSpend!)),
        'Budget!M4',
      );
      expectMoney(
        budget.actual.actualCents,
        mean(spendRows.filter((x) => x.adjustedSpend !== null).map((x) => x.adjustedSpend!)),
        'Budget!M4 (page)',
      );
      recomputed(area);
    });

    it('Side Income: periods and C3–C7 (rules 2, 6, 7)', () => {
      const area = 'Side Income';
      const S = 'Side Income';
      const fyStart = fyStartOf(asOf);
      const fyEnd = fyEndOf(asOf);
      interface SiRow {
        row: number;
        E: IsoDate;
        F: IsoDate;
        I: number;
        filled: boolean;
      }
      const rows: SiRow[] = [];
      for (let row = 2; row <= 799; row++) {
        const F = r.date(S, `F${row}`);
        const E = r.date(S, `E${row}`);
        if (F === null || E === null) break;
        rows.push({
          row,
          E,
          F,
          I: r.number(S, `I${row}`) ?? 0,
          filled: !r.isBlank(S, `G${row}`) || !r.isBlank(S, `H${row}`),
        });
      }
      const byEnd = new Map(side.periods.map((p) => [p.end, p]));
      const provisional = side.periods.find((p) => p.status === 'provisional');
      for (const x of rows) {
        if (x.F > lastRun) {
          // The live row: its start and total against the provisional period; its F is the month end.
          skipped(area, 'live_window');
          if (liveWindowHasActivity() || !provisional) {
            skipped(area, 'live_window', 2);
            continue;
          }
          expect(provisional.start, `Side Income!E${x.row}`).toBe(x.E);
          expectMoney(provisional.totalCents, x.I, `Side Income!I${x.row}`);
          compared(area, 2);
          continue;
        }
        const p = byEnd.get(x.F);
        expect(p, `Side Income!F${x.row}`).toBeDefined();
        expect(p!.start, `Side Income!E${x.row}`).toBe(x.E);
        expectMoney(p!.totalCents, x.I, `Side Income!I${x.row}`);
        compared(area, 3);
      }
      expectMoney(side.kpis.lifetimeCents, r.number(S, 'C7'), 'C7');
      compared(area);

      // C4 (rule 7): exact unless a filled row straddles the FY start.
      const straddles = rows.some((x) => x.filled && x.E < fyStart && fyStart <= x.F);
      if (straddles) {
        const byDate = rows.filter((x) => {
          const d = x.F < asOf ? x.F : asOf;
          return d >= fyStart && d < fyEnd;
        });
        expectMoney(side.kpis.fyToDateCents, sum(byDate.map((x) => x.I)), 'C4 by deposit date');
        recomputed(area);
      } else {
        expectMoney(side.kpis.fyToDateCents, r.number(S, 'C4'), 'C4');
        compared(area);
      }

      // C3, C5 = SheetOptions H27, C6 (rule 6): the closed rows only, a blank closed row as 0.
      const closed = rows.filter((x) => x.F <= lastRun);
      const c3 = mean(closed.filter((x) => x.E >= fyStart && x.E < fyEnd).map((x) => x.I));
      expectMoney(side.kpis.avgPerPeriodThisFyCents, c3, 'C3');
      expectMoney(side.kpis.projectedYearCents, c3 === null ? null : c3 * 12, 'C5');
      expectMoney(side.kpis.projectedYearCents, c3 === null ? null : c3 * 12, 'SheetOptions!H27');
      const c6 = mean(closed.filter((x) => dayOf(x.E) > dayOf(asOf) - 365).map((x) => x.I));
      expectMoney(side.kpis.avg365Cents, c6, 'C6');
      recomputed(area, 4);
    });

    it('Budget: the chain, the item rows and the payday transfers (rules 9, 14)', () => {
      const area = 'Budget';
      const B = 'Budget';
      const s = budget.summary;
      const includeSide = r.text(B, 'D4') === 'Yes';
      const factorOf: Readonly<Record<string, number>> = {
        'Twice Monthly': 2,
        '2-weeks': 4.34523783659 * 0.5,
        Weekly: 4.34523783659,
        '4-weeks': 1.0833333333,
      };
      let b2 = r.number(B, 'B2');
      if (includeSide) {
        // Rule 14: B2 with the fixed side-income average (the closed periods only).
        const pay = r.number(B, 'B4') ?? 0;
        b2 = pay * (factorOf[r.text(B, 'B3') ?? ''] ?? 1) + (side.kpis.avg365Cents ?? 0) / 100;
      }
      const tag = (n: number) => (includeSide ? recomputed(area, n) : compared(area, n));
      // In the rule-14 recompute branch the expectation's side-income mean is the API's rounded
      // avg365Cents, so × 12 can drift up to about 7 cents; otherwise the sheet cell is compared at
      // the §9.5 1 cent.
      const yearlyTolerance = includeSide ? 12 : 1;
      expectMoney(s.monthlyIncomeCents, b2, 'B2');
      expectMoney(s.annualIncomeCents, b2 === null ? null : b2 * 12, 'F2', yearlyTolerance);
      expectMoney(s.plannedSpendCents, r.number(B, 'J4'), 'J4');
      expectMoney(s.yearlyFundCents, r.number(B, 'C24'), 'C24');
      compared(area, 2);
      tag(2);
      const j4 = r.number(B, 'J4') ?? 0;
      const l7 = b2 === null ? null : b2 - j4;
      expectMoney(s.leftoverCents, includeSide ? l7 : r.number(B, 'L7'), 'L7');
      expectMoney(
        s.yearlySavingsCents,
        includeSide ? (l7 === null ? null : l7 * 12) : r.number(B, 'L9'),
        'L9',
        yearlyTolerance,
      );
      tag(2);
      if (!includeSide) {
        expectMoney(s.investmentRowCents, r.number(B, 'C28'), 'C28');
        expectMoney(s.cashRowCents, r.number(B, 'C29'), 'C29');
        expectRatio(s.plannedSavingsRatio, r.number(B, 'L11'), 'L11');
        compared(area, 3);
      } else {
        recomputed(area, 3);
      }
      // D3 (rule 9): as cached unless the last item row (27) holds an amount.
      const c27 = r.number(B, 'C27') ?? 0;
      if (c27 === 0) {
        expectMoney(s.emergencyFundCents, r.number(B, 'D3'), 'D3');
        compared(area);
      } else {
        let basis = 0;
        for (let row = 8; row <= 27; row++) basis += r.number(B, `C${row}`) ?? 0;
        const months = r.number('SheetOptions', 'L32') ?? 0;
        expectMoney(
          s.emergencyFundCents,
          Math.ceil((months * basis) / 1000) * 1000,
          'D3 fixed range',
        );
        recomputed(area);
      }

      // Per row B, D, E (the rows the API lists with a sheet reference and a numeric B).
      for (const row of budget.rows) {
        const m = /^Budget!A(\d+)$/.exec(row.sheetRef ?? '');
        if (!m) continue;
        const at = Number(m[1]);
        const sheetB = r.number(B, `B${at}`);
        if (sheetB === null) continue;
        const tagRow = includeSide ? recomputed : compared;
        if (!includeSide) expectRatio(row.incomeShareRatio, sheetB, `B${at}`);
        expectMoney(row.weeklyCents, r.number(B, `D${at}`), `D${at}`);
        expectMoney(row.yearlyCents, r.number(B, `E${at}`), `E${at}`);
        tagRow(area, 3);
      }

      // Payday transfers A35:B (first-appearance order).
      let i = 0;
      for (let row = 35; row <= 59; row++) {
        const name = r.text(B, `A${row}`);
        if (name === null || name.trim() === '') continue;
        const t = budget.transfers[i++];
        expect(t?.accountName?.trim(), `A${row}`).toBe(name.trim());
        expectMoney(t?.perPayCents ?? null, r.number(B, `B${row}`), `B${row}`);
        (includeSide ? recomputed : compared)(area, 2);
      }
    });

    it('Dividends: the FY table, the rolling 12 months, M89, H28 and H30', () => {
      const area = 'Dividends';
      const D = 'Dividends';
      const kinds: readonly [string, InstrumentKind][] = [
        ['L', 'etf'],
        ['M', 'stock'],
        ['N', 'managed_fund'],
        ['O', 'crypto'],
      ];
      // K4:K8 (K4 the oldest) = the first five rows of byFinancialYear, reversed.
      const five = dividends.byFinancialYear.slice(0, 5).reverse();
      expect(five).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const row = 4 + i;
        const fy = five[i]!;
        const label = r.text(D, `K${row}`) ?? '';
        expect(label.startsWith(`${fy.financialYear}-`), `K${row}`).toBe(true);
        for (const [col, kind] of kinds)
          expectMoney(fy.byKind[kind], r.number(D, `${col}${row}`), `${col}${row}`);
        expectMoney(fy.totalCents, r.number(D, `P${row}`), `P${row}`);
        compared(area, 6);
      }
      for (const [col, kind] of kinds) {
        expectMoney(sum(five.map((f) => f.byKind[kind])), r.number(D, `${col}11`), `${col}11`, 5);
      }
      expectMoney(sum(five.map((f) => f.totalCents)), r.number(D, 'P11'), 'P11', 5);
      compared(area, 5);

      // K30:P41 (K41 = EOMONTH(E52, 0)), oldest first.
      expect(dividends.rolling12).toHaveLength(12);
      dividends.rolling12.forEach((m, i) => {
        const row = 30 + i;
        expect(r.date(D, `K${row}`)?.slice(0, 7), `K${row}`).toBe(m.month);
        for (const [col, kind] of kinds)
          expectMoney(m.byKind[kind], r.number(D, `${col}${row}`), `${col}${row}`);
        expectMoney(m.totalCents, r.number(D, `P${row}`), `P${row}`);
        compared(area, 6);
      });

      // The per-holding FY table (K45:…) and its total M89 = this FY's net.
      if (r.isBlank(D, 'K45') || (r.text(D, 'K45') ?? '') === '') {
        expect(
          dividends.holdingsThisFy.length + (dividends.unlinkedThisFyCents === 0 ? 0 : 1),
        ).toBe(0);
      }
      expectMoney(dividends.kpis.thisFyCents, r.number(D, 'M89') ?? 0, 'M89');
      compared(area, 2);
      expect(dividends.kpis.daysIntoFy, 'SheetOptions!H30').toBe(r.number('SheetOptions', 'H30'));
      expectMoney(
        dividends.kpis.projectedFyCents,
        r.number('SheetOptions', 'H28'),
        'SheetOptions!H28',
      );
      compared(area, 2);
      // Per-row H/I: rows without an ex-date are skipped (rule 10); G is typed input (rule 11).
      for (let row = 4; row <= 500; row++) {
        if (r.date(D, `A${row}`) === null) continue;
        if (r.date(D, `D${row}`) === null) skipped(area, 'no_ex_date', 2);
        skipped(area, 'never');
      }
    });

    it('investment timing: the cash-deficit wait (rule 13) and the live budget', () => {
      const area = 'SheetOptions';
      const h12 = r.cell('SheetOptions', 'H12');
      if (h12 === null || h12.t !== 'n') {
        expect(etf.timing.cashDeficitMonths, 'SheetOptions!H12').toBeNull();
        compared(area);
      } else {
        // A numeric H12 (or the IFERROR 0): recomputed with the fixed formula over the liquid total.
        const target = Number(r.number('Net Worth', 'D41') ?? 0);
        const cashNow = cash.totals.totalCashCents / 100;
        const liquid = etf.timing.considerNext.rows.reduce((s2, x) => s2 + x.valueCents, 0) / 100;
        const avgSavings = (cash.kpis.avgSavingsCents ?? 0) / 100;
        const expected =
          liquid <= 0 || cashNow / liquid >= target || avgSavings <= 0
            ? null
            : Math.floor((target * liquid - cashNow) / avgSavings) + 1;
        expect(etf.timing.cashDeficitMonths, 'SheetOptions!H12 fixed').toBe(expected);
        recomputed(area);
      }
      expect(etf.timing.budget.source).toBe('live_budget');
      expect(etf.timing.deferred).toEqual([]);
      expectMoney(
        etf.timing.budget.plannedSpendCents,
        r.number('Budget', 'J4'),
        'Budget!J4 (timing)',
      );
      compared(area);
    });
  });
});
