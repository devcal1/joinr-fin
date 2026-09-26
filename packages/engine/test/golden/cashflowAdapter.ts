// The sheet-faithful cash-flow adapter (stage-3.md §9.1): reads the local workbook and builds the
// Stage 3 engine inputs the way the sheet computed them (no corrections file; the Stage 2 adapter's
// ledgers are reused). Template cell references only; every value is read at runtime and never
// printed.
import {
  addMonthsIso,
  centsFromNumber,
  decimalFromNumber,
  INSTRUMENT_KINDS,
  isoMonthOf,
  JoinrDecimal,
  type BudgetItemKind,
  type InstrumentKind,
  type IsoDate,
} from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';
import type {
  BudgetInput,
  BudgetRowInput,
  DividendHoldingInput,
  EngineDividend,
  EngineTrade,
  InvestmentsResult,
  SavingsInput,
  SavingsLiveInput,
  SavingsSnapshotInput,
  SideIncomeInput,
  SideIncomeResult,
} from '../../src/index';
import { addDaysIso } from '../../src/num';
import { historyRows, readTiming, Sheet } from './adapter';

/** A sheet number as cents, half away from zero (the importer's rounding); null when not numeric. */
export const cellCents = (n: number | null): number | null =>
  n === null ? null : centsFromNumber(n);

/** Sheets EOMONTH(date, 0). */
export function monthEnd(date: IsoDate): IsoDate {
  return addDaysIso(addMonthsIso(`${date.slice(0, 7)}-01`, 1), -1);
}

// ─── Template layout (generic template text and cell letters) ──────────────────────────────────

/** The DRP column of each holdings tab (Stocks T, ETFs Y, Managed Funds Y, Crypto P). */
const DRP_COLUMN: Readonly<Record<InstrumentKind, string>> = {
  stock: 'T',
  etf: 'Y',
  managed_fund: 'Y',
  crypto: 'P',
};
const BUDGET = { sheet: 'Budget', firstRow: 8, maxRow: 60, yearlyFrom: 32, yearlyTo: 60 };
const OTHER_ASSETS = { sheet: 'Other Assets', firstRow: 3, lastRow: 500 };
const SIDE_INCOME = { sheet: 'Side Income', firstRow: 2, lastRow: 799 };
const TRANSFERS = { firstRow: 35, lastRow: 59 };

export function budgetKindOf(name: string | null): BudgetItemKind {
  if (name === null) return 'item';
  if (name.startsWith('Yearly Expenses - Automatic')) return 'auto_yearly';
  if (name.startsWith('Investment Savings -')) return 'auto_invest';
  if (name.startsWith('Cash Savings -')) return 'auto_cash';
  return 'item';
}

// ─── History and the savings inputs ────────────────────────────────────────────────────────────

export interface HistoryRow {
  row: number;
  date: IsoDate;
  frozen: boolean;
}

export interface SideIncomeRow {
  row: number;
  start: IsoDate | null;
  end: IsoDate;
  g: number | null;
  h: number | null;
  total: number | null;
  /** The row after the last run (the sheet's unfilled current period). */
  live: boolean;
}

export interface BudgetSheetRow {
  row: number;
  input: BudgetRowInput;
  /** A name or a numeric C: the per-item B/D/E cells are compared. */
  compared: boolean;
}

export interface OtherAssetPurchase {
  row: number;
  date: IsoDate;
  amountCents: number;
}

/** Everything the cash-flow goldens read from the workbook, as engine inputs. */
export class CashflowSheet {
  readonly wb: WorkbookReader;
  readonly asOf: IsoDate;
  readonly lastRun: IsoDate;
  readonly history: HistoryRow[];
  readonly frozen: HistoryRow[];
  readonly live: HistoryRow | null;
  readonly trades: EngineTrade[];
  readonly dividends: EngineDividend[];
  readonly otherAssets: OtherAssetPurchase[];
  readonly sideIncomeRows: SideIncomeRow[];
  readonly deposits: { id: number; streamId: number; date: IsoDate; amountCents: number }[];
  readonly budgetRows: BudgetSheetRow[];

  constructor(readonly sheet: Sheet) {
    const wb = sheet.wb;
    this.wb = wb;
    this.asOf = sheet.asOf;
    const lastRun = wb.date('Net Worth', 'C51');
    if (lastRun === null) throw new Error('golden: Net Worth!C51 holds no date');
    this.lastRun = lastRun;
    this.history = historyRows(wb);
    this.frozen = this.history.filter((h) => h.frozen);
    this.live = this.history.filter((h) => !h.frozen).at(-1) ?? null;
    this.trades = INSTRUMENT_KINDS.flatMap((k) => sheet.tab(k).trades);
    // Every Dividends row of a known type, linked the sheet's way (exact ticker within its tab).
    this.dividends = INSTRUMENT_KINDS.flatMap((k) => sheet.tab(k).dividends);
    this.otherAssets = readOtherAssetPurchases(wb);
    this.sideIncomeRows = readSideIncomeRows(wb, lastRun);
    this.deposits = this.sideIncomeRows.flatMap((r) => {
      const date = r.end < this.asOf ? r.end : this.asOf;
      const out: { id: number; streamId: number; date: IsoDate; amountCents: number }[] = [];
      if (r.g !== null && r.g !== 0)
        out.push({ id: r.row * 10 + 1, streamId: 1, date, amountCents: centsFromNumber(r.g) });
      if (r.h !== null && r.h !== 0)
        out.push({ id: r.row * 10 + 2, streamId: 2, date, amountCents: centsFromNumber(r.h) });
      return out;
    });
    this.budgetRows = readBudgetRows(wb);
  }

  private historyCents(col: string, row: number): number | null {
    return cellCents(this.wb.number('History', `${col}${row}`));
  }

  /** §9.1: frozen History rows as snapshots, the live row (or none) as the live values. */
  savingsInput(): SavingsInput {
    const snapshots: SavingsSnapshotInput[] = this.frozen.map((h) => ({
      periodMonth: isoMonthOf(h.date),
      runDate: h.date,
      cashValueCents: this.historyCents('N', h.row),
      superContribCents: this.historyCents('R', h.row),
      salaryMonthlyCents: this.historyCents('W', h.row),
      propertyPurchaseCents: this.historyCents('Y', h.row),
      mortgageBalanceCents: this.historyCents('AB', h.row),
      mortgagePrincipalPaidCents: this.historyCents('AD', h.row),
    }));
    const l = this.live;
    const live: SavingsLiveInput | null =
      l === null
        ? null
        : {
            cashCents: cellCents(this.wb.number('Cash', 'C13')) ?? 0,
            salaryMonthlyCents: this.historyCents('W', l.row),
            superContribCents: this.historyCents('R', l.row) ?? 0,
            propertyPurchaseCents: this.historyCents('Y', l.row),
            mortgageBalanceCents: this.historyCents('AB', l.row),
            mortgagePrincipalPaidCents: this.historyCents('AD', l.row),
          };
    return {
      asOf: this.asOf,
      snapshots,
      live,
      trades: this.trades,
      otherAssetPurchases: this.otherAssets.map((p) => ({
        date: p.date,
        amountCents: p.amountCents,
      })),
      sideIncome: this.deposits.map((d) => ({ date: d.date, amountCents: d.amountCents })),
      dividends: this.dividends,
      adjustments: [],
      includeMortgagePrincipal: this.sheetOptionBool(41) ?? true,
    };
  }

  /** §9.1: the frozen History rows as the side-income snapshots, with the dated deposits. */
  sideIncomeInput(): SideIncomeInput {
    return {
      asOf: this.asOf,
      snapshots: this.frozen.map((h) => ({ periodMonth: isoMonthOf(h.date), runDate: h.date })),
      deposits: this.deposits,
    };
  }

  /** §9.1: the Budget rows and settings; the side income as the engine's closed periods. */
  budgetInput(
    side: SideIncomeResult,
    results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  ): BudgetInput {
    const timing = readTiming(this.wb, this.asOf);
    const t = timing.input;
    const yearlyExpenses: { id: number; name: string; annualCents: number }[] = [];
    for (let r = BUDGET.yearlyFrom; r <= BUDGET.yearlyTo; r++) {
      const name = this.wb.text(BUDGET.sheet, `E${r}`);
      const cost = this.wb.number(BUDGET.sheet, `F${r}`);
      if (name !== null && cost !== null)
        yearlyExpenses.push({ id: r, name, annualCents: centsFromNumber(cost) });
    }
    return {
      asOf: t.asOf,
      payFrequency: t.payFrequency,
      netPayCents: t.netPayCents,
      includeSideIncome: t.includeSideIncome,
      sideIncomePeriods: side.periods
        .filter((p) => p.status === 'closed')
        .map((p) => ({ periodStart: p.start, periodEnd: p.end, amountCents: p.totalCents })),
      rows: this.budgetRows.map((r) => r.input),
      yearlyExpenses,
      autoInvestSplit: t.autoInvestSplit,
      useBudgetForInvest: t.useBudgetForInvest,
      cashTargetRatio: t.cashTargetRatio,
      aggressiveness: t.aggressiveness,
      currentCashShare: t.currentCashShare,
      cashCents: t.cashCents,
      emergencyFundMonths: t.emergencyFundMonths,
      emergencyFundOverrideCents: t.emergencyFundOverrideCents,
      marginalTaxRate: t.marginalTaxRate,
      lastSnapshotCashShare:
        timing.recomputedH43 === null ? null : decimalFromNumber(timing.recomputedH43),
      lastPurchaseDate: lastStockOrEtfBuy(results),
    };
  }

  /** §9.1: the holdings' units (the tabs' held-units columns), frequency and DRP. */
  dividendHoldings(
    results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
  ): DividendHoldingInput[] {
    return INSTRUMENT_KINDS.flatMap((kind) => {
      const tab = this.sheet.tab(kind);
      const watchRow = new Map(tab.watch.map((w) => [w.instrumentId, w.row]));
      return tab.instruments.map((i) => {
        const row = watchRow.get(i.id);
        const units =
          row === undefined
            ? null
            : this.wb.number(tab.layout.sheet, `${tab.layout.watch.units}${row}`);
        const engineUnits =
          results.get(kind)!.holdings.find((h) => h.instrumentId === i.id)?.netUnits ?? '0';
        return {
          instrumentId: i.id,
          kind,
          dividendFreqMonths: i.dividendFreqMonths,
          drp:
            row === undefined ? null : this.wb.bool(tab.layout.sheet, `${DRP_COLUMN[kind]}${row}`),
          unitsNow: units === null ? engineUnits : decimalFromNumber(units),
        };
      });
    });
  }

  /** A SheetOptions yes/no setting found by its column-P ID (non-secret IDs only). */
  sheetOptionBool(id: 41): boolean | null {
    for (let r = 3; r <= 60; r++) {
      if (this.wb.number('SheetOptions', `P${r}`) === id)
        return this.wb.bool('SheetOptions', `L${r}`);
    }
    return null;
  }

  /**
   * §9.3 rule 2: the live row compares with the provisional period when nothing the sheet's live
   * window holds is dated after asOf (up to the live row's month end).
   */
  liveWindowClear(): boolean {
    if (this.live === null) return false;
    const liveRowEnd = this.live.date;
    const eom = monthEnd(this.asOf);
    const end = liveRowEnd > eom ? liveRowEnd : eom;
    const after = (d: IsoDate) => d > this.asOf && d <= end;
    return !(
      this.trades.some((t) => after(t.tradeDate)) ||
      this.otherAssets.some((p) => after(p.date)) ||
      this.deposits.some((d) => after(d.date)) ||
      this.sheet.dividendRows.some((d) => after(d.paymentDate))
    );
  }

  /** The Budget transfer list A35:B (account text, per pay), as the sheet shows it. */
  transfers(): { row: number; account: string; perPay: number | null }[] {
    const out: { row: number; account: string; perPay: number | null }[] = [];
    for (let r = TRANSFERS.firstRow; r <= TRANSFERS.lastRow; r++) {
      const account = this.wb.text(BUDGET.sheet, `A${r}`);
      if (account === null) continue;
      out.push({ row: r, account, perPay: this.wb.number(BUDGET.sheet, `B${r}`) });
    }
    return out;
  }

  /**
   * §9.1 cash-deficit inputs: the liquid total is the Σ of the Stage 2 golden's recomputed class
   * values (Stage 2 §9.3 rule 1: a tab with a held unpriced row, or no prices, sums its priced
   * value cells), with the cash class = Cash!C13.
   */
  liquidTotalCents(): number {
    const wb = this.wb;
    let total = 0;
    for (const kind of INSTRUMENT_KINDS) {
      const tab = this.sheet.tab(kind);
      const { sheet: s, watch: w } = tab.layout;
      const noPrices = tab.watch.every((x) => x.price === null);
      const heldUnpriced = tab.watch.some(
        (x) => x.price === null && (wb.number(s, `${w.units}${x.row}`) ?? 0) > 0,
      );
      let valueSum = 0;
      for (const x of tab.watch) {
        if (x.price === null) continue;
        valueSum += wb.number(s, `${w.value}${x.row}`) ?? 0;
      }
      total += noPrices || heldUnpriced ? valueSum : (wb.number(s, tab.layout.summary.value) ?? 0);
    }
    total += wb.number('Cash', 'C13') ?? 0;
    total += wb.number('Other Assets', 'D3') ?? 0;
    return centsFromNumber(total);
  }
}

/** The last ETF or stock buy (SheetOptions H20). */
export function lastStockOrEtfBuy(
  results: ReadonlyMap<InstrumentKind, InvestmentsResult>,
): IsoDate | null {
  const dates = (['stock', 'etf'] as const)
    .map((k) => results.get(k)!.summary.lastBuyDate)
    .filter((d): d is IsoDate => d !== null)
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Other Assets rows with a purchase date in G and currency AUD (or blank): (H − |L|) × J when H > 0
 * and something remains (the sheet's N guard); other currencies are left out (Stage 4 adds FX).
 */
function readOtherAssetPurchases(wb: WorkbookReader): OtherAssetPurchase[] {
  const s = OTHER_ASSETS.sheet;
  const out: OtherAssetPurchase[] = [];
  for (let r = OTHER_ASSETS.firstRow; r <= OTHER_ASSETS.lastRow; r++) {
    const date = wb.date(s, `G${r}`);
    const units = wb.number(s, `H${r}`);
    const cost = wb.number(s, `J${r}`);
    if (date === null || units === null || cost === null || !(units > 0)) continue;
    const currency = wb.text(s, `I${r}`);
    if (currency !== null && currency !== 'AUD') continue;
    const sold = Math.abs(wb.number(s, `L${r}`) ?? 0);
    const remaining = new JoinrDecimal(decimalFromNumber(units)).minus(decimalFromNumber(sold));
    if (!remaining.greaterThan(0)) continue;
    const dollars = remaining.times(decimalFromNumber(cost));
    out.push({
      row: r,
      date,
      amountCents: dollars.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber(),
    });
  }
  return out;
}

/** Side Income rows with a date in F (E start, G/H streams, I total). */
function readSideIncomeRows(wb: WorkbookReader, lastRun: IsoDate): SideIncomeRow[] {
  const s = SIDE_INCOME.sheet;
  const out: SideIncomeRow[] = [];
  for (let r = SIDE_INCOME.firstRow; r <= SIDE_INCOME.lastRow; r++) {
    const end = wb.date(s, `F${r}`);
    if (end === null) continue;
    out.push({
      row: r,
      start: wb.date(s, `E${r}`),
      end,
      g: wb.number(s, `G${r}`),
      h: wb.number(s, `H${r}`),
      total: wb.number(s, `I${r}`),
      live: end > lastRun,
    });
  }
  return out;
}

/**
 * Budget rows 8 → the `Cash Savings -` row: every row with a name, a numeric C or an account (the
 * sheet's transfer list reads F8:F29); the per-item B/D/E cells are compared on rows with a name or
 * a numeric C. The auto rows are found by their labels; the `auto_invest` amount is read only when
 * typed (D54), as the importer does.
 */
function readBudgetRows(wb: WorkbookReader): BudgetSheetRow[] {
  const s = BUDGET.sheet;
  let end = 29;
  for (let r = BUDGET.firstRow; r <= BUDGET.maxRow; r++) {
    const a = wb.text(s, `A${r}`);
    if (a !== null && a.startsWith('Cash Savings -')) {
      end = r;
      break;
    }
  }
  const out: BudgetSheetRow[] = [];
  for (let r = BUDGET.firstRow; r <= end; r++) {
    const name = wb.text(s, `A${r}`);
    const c = wb.number(s, `C${r}`);
    const account = wb.text(s, `F${r}`);
    if (name === null && c === null && account === null) continue;
    const kind = budgetKindOf(name);
    const typed = (wb.cell(s, `C${r}`)?.formula ?? null) === null;
    const monthlyCents =
      kind === 'item' ? cellCents(c) : kind === 'auto_invest' && typed ? cellCents(c) : null;
    out.push({
      row: r,
      input: {
        id: r,
        kind,
        name,
        monthlyCents,
        category: wb.text(s, `G${r}`),
        accountId: null,
        accountName: account,
      },
      compared: name !== null || c !== null,
    });
  }
  return out;
}
