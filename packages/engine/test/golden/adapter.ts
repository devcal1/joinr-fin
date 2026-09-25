// The sheet-faithful adapter (stage-2.md §9.1): reads the local workbook and builds engine inputs
// the way the sheet computed them (no corrections, no D28 re-keying), so cached cells can be
// compared. Template cell references only; every value is read at runtime and never printed.
import {
  ALLOCATION_AGGRESSIVENESS_SHEET_VALUES,
  centsFromNumber,
  decimalFromNumber,
  PAY_FREQUENCY_SHEET_VALUES,
  type AllocationAggressiveness,
  type AssetClass,
  type BudgetItemKind,
  type InstrumentKind,
  type IsoDate,
  type PayFrequency,
} from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';
import { computeInvestments } from '../../src/index';
import { dayNumber } from '../../src/num';
import type {
  BudgetInvestInput,
  EngineDividend,
  EngineInstrument,
  EnginePrice,
  EngineTrade,
  InvestmentsResult,
} from '../../src/index';

// ─── Template layout (generic template text and cell letters) ──────────────────────────────────

export interface TabLayout {
  kind: InstrumentKind;
  sheet: string;
  /** Dividends!C text for this tab. */
  type: string;
  watchMax: number;
  watch: {
    price: string;
    units: string;
    value: string;
    tr: string;
    trPct: string;
    xirr: string;
    div: string;
    divYield: string;
    ave: string;
    cur: string;
    target: string;
    diff: string;
    sector: string | null;
    regions: readonly [string, string, string, string] | null;
    mgmtFee: string | null;
    freq: string;
    estFee: string | null;
  };
  ledger: {
    first: number;
    fee: string | null;
    sold: string;
    order: string;
    unrealised: string;
    pct: string;
    remaining: string;
  };
  summary: {
    value: string;
    tr: string;
    trPct: string;
    simple: string;
    rate: string;
    hint: string | null;
    divAll: string | null;
    divAllFiveFy: boolean;
    divFy: string | null;
    heldCount: string | null;
    targetCount: string | null;
    /** Row of the regional current (the target is the next row); first column letter. */
    regionRow: number | null;
  };
  history: { date: string; value: string; first: number } | null;
  /** History column of this tab's frozen net purchases. */
  movements: string;
  /** History column of this tab's value (for the last-snapshot cash share denominator). */
  historyValue: string;
  /** Dividends!L..O column of this type (the FY table). */
  dividendFyColumn: string;
}

export const TABS: Readonly<Record<InstrumentKind, TabLayout>> = {
  stock: {
    kind: 'stock',
    sheet: 'Stocks',
    type: 'Stocks',
    watchMax: 12,
    watch: {
      price: 'D',
      units: 'G',
      value: 'H',
      tr: 'I',
      trPct: 'J',
      xirr: 'K',
      div: 'L',
      divYield: 'M',
      ave: 'N',
      cur: 'O',
      target: 'P',
      diff: 'Q',
      sector: 'R',
      regions: null,
      mgmtFee: null,
      freq: 'S',
      estFee: null,
    },
    ledger: {
      first: 23,
      fee: 'E',
      sold: 'F',
      order: 'G',
      unrealised: 'J',
      pct: 'K',
      remaining: 'L',
    },
    summary: {
      value: 'E16',
      tr: 'E17',
      trPct: 'E18',
      simple: 'H17',
      rate: 'H18',
      hint: 'H19',
      divAll: 'E19',
      divAllFiveFy: false,
      divFy: null,
      heldCount: null,
      targetCount: null,
      regionRow: null,
    },
    history: { date: 'O', value: 'P', first: 49 },
    movements: 'E',
    historyValue: 'B',
    dividendFyColumn: 'M',
  },
  etf: {
    kind: 'etf',
    sheet: 'ETFs',
    type: 'ETF',
    watchMax: 11,
    watch: {
      price: 'D',
      units: 'F',
      value: 'G',
      tr: 'H',
      trPct: 'I',
      xirr: 'J',
      div: 'K',
      divYield: 'L',
      ave: 'M',
      cur: 'N',
      target: 'O',
      diff: 'P',
      sector: 'W',
      regions: ['S', 'T', 'U', 'V'],
      mgmtFee: 'Q',
      freq: 'X',
      estFee: null,
    },
    ledger: {
      first: 23,
      fee: 'E',
      sold: 'F',
      order: 'G',
      unrealised: 'J',
      pct: 'K',
      remaining: 'L',
    },
    summary: {
      value: 'F15',
      tr: 'F16',
      trPct: 'F17',
      simple: 'I16',
      rate: 'I19',
      hint: 'I17',
      divAll: 'F19',
      divAllFiveFy: true,
      divFy: 'F18',
      heldCount: 'L16',
      targetCount: 'L17',
      regionRow: 12,
    },
    history: { date: 'O', value: 'P', first: 49 },
    movements: 'I',
    historyValue: 'F',
    dividendFyColumn: 'L',
  },
  managed_fund: {
    kind: 'managed_fund',
    sheet: 'Managed Funds',
    type: 'Managed Fund',
    watchMax: 11,
    watch: {
      price: 'D',
      units: 'E',
      value: 'F',
      tr: 'G',
      trPct: 'H',
      xirr: 'I',
      div: 'J',
      divYield: 'K',
      ave: 'L',
      cur: 'M',
      target: 'N',
      diff: 'O',
      sector: 'V',
      regions: ['R', 'S', 'T', 'U'],
      mgmtFee: 'P',
      freq: 'X',
      estFee: 'W',
    },
    ledger: {
      first: 23,
      fee: null,
      sold: 'E',
      order: 'F',
      unrealised: 'I',
      pct: 'J',
      remaining: 'K',
    },
    summary: {
      value: 'B16',
      tr: 'H16',
      trPct: 'H17',
      simple: 'J16',
      rate: 'J17',
      hint: null,
      divAll: 'J18',
      divAllFiveFy: true,
      divFy: 'H18',
      heldCount: null,
      targetCount: null,
      regionRow: 12,
    },
    history: { date: 'N', value: 'O', first: 23 },
    movements: 'AI',
    historyValue: 'AF',
    dividendFyColumn: 'N',
  },
  crypto: {
    kind: 'crypto',
    sheet: 'Crypto',
    type: 'Crypto',
    watchMax: 7,
    watch: {
      price: 'B',
      units: 'D',
      value: 'E',
      tr: 'F',
      trPct: 'G',
      xirr: 'H',
      div: 'I',
      divYield: 'J',
      ave: 'K',
      cur: 'N',
      target: 'M',
      diff: 'L',
      sector: null,
      regions: null,
      mgmtFee: null,
      freq: 'O',
      estFee: null,
    },
    ledger: {
      first: 17,
      fee: 'E',
      sold: 'F',
      order: 'G',
      unrealised: 'J',
      pct: 'K',
      remaining: 'L',
    },
    summary: {
      value: 'E9',
      tr: 'E10',
      trPct: 'E11',
      simple: 'H10',
      rate: 'H11',
      hint: 'H12',
      divAll: null,
      divAllFiveFy: false,
      divFy: null,
      heldCount: null,
      targetCount: null,
      regionRow: null,
    },
    history: null,
    movements: 'M',
    historyValue: 'J',
    dividendFyColumn: 'O',
  },
};

/** Capital Gains block order and the AA row holding each block's row count. */
export const CG_BLOCKS: readonly { kind: InstrumentKind; countCell: string }[] = [
  { kind: 'etf', countCell: 'AA8' },
  { kind: 'stock', countCell: 'AA9' },
  { kind: 'crypto', countCell: 'AA10' },
  { kind: 'managed_fund', countCell: 'AA11' },
];

/** Net Worth B38:B43 rows per asset class (ASSET_CLASSES order). */
export const NET_WORTH_CLASS_ROWS: Readonly<Record<AssetClass, number>> = {
  etf: 38,
  stock: 39,
  crypto: 40,
  cash: 41,
  managed_fund: 42,
  other_assets: 43,
};

const WATCH_TERMINATORS = ['Insert further rows', 'ℹ️'];
const LEDGER_LAST_ROW = 500;
const DIVIDENDS = { sheet: 'Dividends', first: 4, last: 500 };
const FREQUENCY_TEXT: Readonly<Record<string, number>> = {
  monthly: 1,
  quarterly: 3,
  'half-yearly': 6,
  yearly: 12,
};
const TYPE_TO_KIND: Readonly<Record<string, InstrumentKind>> = {
  Stocks: 'stock',
  ETF: 'etf',
  'Managed Fund': 'managed_fund',
  Crypto: 'crypto',
};

// ─── Sheet rows ─────────────────────────────────────────────────────────────────────────────────

export interface WatchRow {
  row: number;
  symbol: string;
  /** Cached live price when numeric > 0. */
  price: number | null;
  instrumentId: number;
}

export interface LedgerRow {
  row: number;
  symbol: string;
  tradeId: number;
  instrumentId: number;
  date: IsoDate;
  units: number;
  price: number;
  fee: number;
}

export interface SheetTab {
  layout: TabLayout;
  watch: WatchRow[];
  ledger: LedgerRow[];
  instruments: EngineInstrument[];
  trades: EngineTrade[];
  /** Every Dividends row of this tab's type, linked the sheet's way (exact symbol). */
  dividends: EngineDividend[];
  prices: Map<number, EnginePrice>;
  /** Symbols of the watch rows. */
  watchedSymbols: Set<string>;
  symbolOf: Map<number, string>;
  /** Dividends!B of each dividend (by id = sheet row). */
  dividendTickers: Map<number, string>;
}

/** Dividends!A4:F500 rows (the sheet's own columns). */
export interface DividendRow {
  row: number;
  paymentDate: IsoDate;
  ticker: string;
  type: string;
  exDate: IsoDate | null;
  reinvested: boolean | null;
  net: number;
  priceAtEx: number | null;
}

export class Sheet {
  readonly asOf: IsoDate;
  readonly dividendRows: DividendRow[];
  private readonly tabs = new Map<InstrumentKind, SheetTab>();

  constructor(readonly wb: WorkbookReader) {
    const asOf = wb.date('Net Worth', 'E52');
    if (asOf === null) throw new Error('golden: Net Worth!E52 holds no date');
    this.asOf = asOf;
    this.dividendRows = readDividendRows(wb);
  }

  tab(kind: InstrumentKind): SheetTab {
    let t = this.tabs.get(kind);
    if (!t) {
      t = readTab(this.wb, TABS[kind], this.dividendRows);
      this.tabs.set(kind, t);
    }
    return t;
  }

  /** The engine on the sheet-faithful input (optionally with D28 re-linked dividends). */
  run(kind: InstrumentKind, opts: { relink?: boolean } = {}): InvestmentsResult {
    const t = this.tab(kind);
    return computeInvestments({
      kind,
      asOf: this.asOf,
      instruments: t.instruments,
      trades: t.trades,
      dividends: opts.relink ? relinkByCode(t) : t.dividends,
      prices: t.prices,
    });
  }
}

function positive(n: number | null): number | null {
  return n !== null && n > 0 ? n : null;
}

function ratioCell(wb: WorkbookReader, sheet: string, addr: string): string | null {
  const n = wb.number(sheet, addr);
  return n === null ? null : decimalFromNumber(n);
}

function frequencyMonths(wb: WorkbookReader, sheet: string, addr: string): number | null {
  const n = wb.number(sheet, addr);
  if (n !== null) return Number.isInteger(n) && n > 0 ? n : null;
  const text = wb.text(sheet, addr);
  return text === null ? null : (FREQUENCY_TEXT[text.toLowerCase()] ?? null);
}

function readDividendRows(wb: WorkbookReader): DividendRow[] {
  const out: DividendRow[] = [];
  for (let r = DIVIDENDS.first; r <= DIVIDENDS.last; r++) {
    const paymentDate = wb.date(DIVIDENDS.sheet, `A${r}`);
    const ticker = wb.text(DIVIDENDS.sheet, `B${r}`);
    const type = wb.text(DIVIDENDS.sheet, `C${r}`);
    const net = wb.number(DIVIDENDS.sheet, `F${r}`);
    if (paymentDate === null || ticker === null || type === null || net === null) continue;
    out.push({
      row: r,
      paymentDate,
      ticker,
      type,
      exDate: wb.date(DIVIDENDS.sheet, `D${r}`),
      reinvested: wb.bool(DIVIDENDS.sheet, `E${r}`),
      net,
      priceAtEx: positive(wb.number(DIVIDENDS.sheet, `G${r}`)),
    });
  }
  return out;
}

const KIND_ID_BASE: Readonly<Record<InstrumentKind, number>> = {
  stock: 1_000,
  etf: 2_000,
  managed_fund: 3_000,
  crypto: 4_000,
};

function readTab(wb: WorkbookReader, l: TabLayout, dividendRows: readonly DividendRow[]): SheetTab {
  const s = l.sheet;
  const w = l.watch;
  const base = KIND_ID_BASE[l.kind];

  // Ledger rows first (a feed row is a zero-unit watch row with no ledger rows, D22/D23).
  const raw: Omit<LedgerRow, 'tradeId' | 'instrumentId'>[] = [];
  for (let r = l.ledger.first; r <= LEDGER_LAST_ROW; r++) {
    const symbol = wb.text(s, `A${r}`);
    if (symbol === null) continue;
    const date = wb.date(s, `B${r}`);
    const units = wb.number(s, `C${r}`);
    const price = wb.number(s, `D${r}`);
    if (date === null || units === null || price === null) continue;
    const fee = l.ledger.fee === null ? 0 : (wb.number(s, `${l.ledger.fee}${r}`) ?? 0);
    raw.push({ row: r, symbol, date, units, price, fee });
  }
  const ledgerSymbols = new Set(raw.map((x) => x.symbol));

  const instruments: EngineInstrument[] = [];
  const idOf = new Map<string, number>();
  const watch: WatchRow[] = [];
  const prices = new Map<number, EnginePrice>();
  for (let r = 2; r <= l.watchMax; r++) {
    const symbol = wb.text(s, `A${r}`);
    if (symbol === null) continue;
    if (WATCH_TERMINATORS.some((t) => symbol.startsWith(t))) break;
    const units = wb.number(s, `${w.units}${r}`) ?? 0;
    if (l.kind === 'managed_fund' && units === 0 && !ledgerSymbols.has(symbol)) continue;
    if (idOf.has(symbol)) continue;
    const id = base + r;
    idOf.set(symbol, id);
    const price = positive(wb.number(s, `${w.price}${r}`));
    if (price !== null) prices.set(id, { price: decimalFromNumber(price), status: 'fresh' });
    watch.push({ row: r, symbol, price, instrumentId: id });
    const region = (i: 0 | 1 | 2 | 3) =>
      w.regions === null ? null : ratioCell(wb, s, `${w.regions[i]}${r}`);
    instruments.push({
      id,
      kind: l.kind,
      symbol,
      name: null,
      watched: true,
      sortOrder: instruments.length + 1,
      targetRatio: ratioCell(wb, s, `${w.target}${r}`),
      sector: w.sector === null ? null : wb.text(s, `${w.sector}${r}`),
      regions: { us: region(0), asia: region(1), aus: region(2), other: region(3) },
      mgmtFeeRatio: w.mgmtFee === null ? null : ratioCell(wb, s, `${w.mgmtFee}${r}`),
      dividendFreqMonths: frequencyMonths(wb, s, `${w.freq}${r}`),
    });
  }
  // Ledger-only symbols become unwatched instruments.
  for (const x of raw) {
    if (idOf.has(x.symbol)) continue;
    const id = base + 500 + idOf.size;
    idOf.set(x.symbol, id);
    instruments.push({
      id,
      kind: l.kind,
      symbol: x.symbol,
      name: null,
      watched: false,
      sortOrder: instruments.length + 1,
      targetRatio: null,
      sector: null,
      regions: { us: null, asia: null, aus: null, other: null },
      mgmtFeeRatio: null,
      dividendFreqMonths: null,
    });
  }

  const ledger: LedgerRow[] = raw.map((x) => ({
    ...x,
    tradeId: base * 1_000 + x.row,
    instrumentId: idOf.get(x.symbol)!,
  }));
  const trades: EngineTrade[] = ledger.map((x, index) => {
    const units = decimalFromNumber(x.units);
    const price = decimalFromNumber(x.price);
    const orderValue = Math.abs(x.units * x.price);
    // Crypto: the ledger's cached fee as a rate of the order value (12 significant digits).
    const feeRate =
      l.kind === 'crypto' && x.fee !== 0 && orderValue > 0
        ? decimalFromNumber(x.fee / orderValue)
        : null;
    return {
      id: x.tradeId,
      instrumentId: x.instrumentId,
      tradeDate: x.date,
      units,
      price,
      feeCents: centsFromNumber(x.fee),
      feeRate,
      seq: index + 1,
    };
  });

  const dividends: EngineDividend[] = dividendRows
    .filter((d) => d.type === l.type)
    .map((d) => ({
      id: d.row,
      instrumentId: idOf.get(d.ticker) ?? null,
      holdingKind: l.kind,
      paymentDate: d.paymentDate,
      exDate: d.exDate,
      reinvested: d.reinvested,
      netAmountCents: centsFromNumber(d.net),
      priceAtEx: d.priceAtEx === null ? null : decimalFromNumber(d.priceAtEx),
    }));

  return {
    layout: l,
    watch,
    ledger,
    instruments,
    trades,
    dividends,
    prices,
    watchedSymbols: new Set(watch.map((x) => x.symbol)),
    symbolOf: new Map(instruments.map((i) => [i.id, i.symbol])),
    dividendTickers: new Map(
      dividendRows.filter((d) => d.type === l.type).map((d) => [d.row, d.ticker]),
    ),
  };
}

/** D28: link an unmatched dividend by code within the holding kind (`ASX:ABC` ↔ `ABC`). */
export function relinkByCode(t: SheetTab): EngineDividend[] {
  return t.dividends.map((d) => {
    const ticker = t.dividendTickers.get(d.id);
    if (d.instrumentId !== null || ticker === undefined) return d;
    const match = t.instruments.find((i) => i.symbol === ticker || codeOf(i.symbol) === ticker);
    return match ? { ...d, instrumentId: match.id } : d;
  });
}

/** `ASX:ABC` → `ABC`; a symbol without an exchange is its own code. */
export function codeOf(symbol: string): string {
  const i = symbol.indexOf(':');
  return i < 0 ? symbol : symbol.slice(i + 1);
}

// ─── Snapshot dates and History ───────────────────────────────────────────────────────────────

/** The tab's history block rows (date + cached contributions), live row included. */
export function historyBlock(
  wb: WorkbookReader,
  l: TabLayout,
): { row: number; date: IsoDate; value: number | null }[] {
  if (l.history === null) return [];
  const out: { row: number; date: IsoDate; value: number | null }[] = [];
  for (let r = l.history.first; r <= 500; r++) {
    const date = wb.date(l.sheet, `${l.history.date}${r}`);
    if (date === null) break;
    out.push({ row: r, date, value: wb.number(l.sheet, `${l.history.value}${r}`) });
  }
  return out;
}

/** History rows 3 → 300 with a date in A; frozen = no formula in B. */
export function historyRows(wb: WorkbookReader): { row: number; date: IsoDate; frozen: boolean }[] {
  const out: { row: number; date: IsoDate; frozen: boolean }[] = [];
  for (let r = 3; r <= 300; r++) {
    const date = wb.date('History', `A${r}`);
    if (date === null) continue;
    out.push({ row: r, date, frozen: (wb.cell('History', `B${r}`)?.formula ?? null) === null });
  }
  return out;
}

// ─── Timing inputs (§9.1 table) ─────────────────────────────────────────────────────────────────

/** SheetOptions ID → row (column P), rows 3 → 60, as the importer finds them. */
function sheetOptionRow(wb: WorkbookReader, id: number): number | null {
  for (let r = 3; r <= 60; r++) if (wb.number('SheetOptions', `P${r}`) === id) return r;
  return null;
}

/** Column L of a non-secret SheetOptions ID (3, 13, 30 or 2 only; never 1 or 29). */
function sheetOptionL(
  wb: WorkbookReader,
  id: 2 | 3 | 13 | 30,
): { row: number; addr: string } | null {
  const row = sheetOptionRow(wb, id);
  return row === null ? null : { row, addr: `L${row}` };
}

function yesNo(wb: WorkbookReader, sheet: string, addr: string): boolean | null {
  return wb.bool(sheet, addr);
}

function budgetKind(name: string | null): BudgetItemKind {
  if (name === null) return 'item';
  if (name.startsWith('Yearly Expenses - Automatic')) return 'auto_yearly';
  if (name.startsWith('Investment Savings -')) return 'auto_invest';
  if (name.startsWith('Cash Savings -')) return 'auto_cash';
  return 'item';
}

export interface SideIncomeRow {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amount: number;
}

export interface TimingSheet {
  input: Omit<BudgetInvestInput, 'lastPurchaseDate'>;
  payDayOfMonth: number | null;
  /** Kept side-income rows (unfilled ones dropped), with their sheet totals. */
  sideIncome: SideIncomeRow[];
  classTargets: Record<AssetClass, string | null>;
  otherAssetsCents: number;
  /** The recomputed last-snapshot cash share (History N / Net Worth L at Net Worth!C51). */
  recomputedH43: number | null;
}

export function readTiming(wb: WorkbookReader, asOf: IsoDate): TimingSheet {
  const frequencyText = wb.text('Budget', 'B3');
  const payFrequency: PayFrequency | null =
    frequencyText === null ? null : (PAY_FREQUENCY_SHEET_VALUES[frequencyText] ?? null);
  const netPay = wb.number('Budget', 'B4');

  const useBudgetCell = sheetOptionL(wb, 3);
  const aggressivenessCell = sheetOptionL(wb, 13);
  const monthsCell = sheetOptionL(wb, 30);
  const payDayCell = sheetOptionL(wb, 2);
  const aggressivenessText =
    aggressivenessCell === null ? null : wb.text('SheetOptions', aggressivenessCell.addr);
  const aggressiveness: AllocationAggressiveness | null =
    aggressivenessText === null
      ? null
      : (ALLOCATION_AGGRESSIVENESS_SHEET_VALUES[aggressivenessText] ?? null);
  const months = monthsCell === null ? null : wb.number('SheetOptions', monthsCell.addr);
  const payDay = payDayCell === null ? null : wb.number('SheetOptions', payDayCell.addr);

  // Budget rows 8 → the row before "Cash Savings -" (the importer's range and kind rule).
  let end = 29;
  for (let r = 8; r <= 60; r++) {
    const a = wb.text('Budget', `A${r}`);
    if (a !== null && a.startsWith('Cash Savings -')) {
      end = r - 1;
      break;
    }
  }
  const items: { kind: BudgetItemKind; monthlyCents: number | null }[] = [];
  for (let r = 8; r <= end; r++) {
    const kind = budgetKind(wb.text('Budget', `A${r}`));
    if (kind !== 'item') continue;
    const c = wb.number('Budget', `C${r}`);
    items.push({ kind, monthlyCents: c === null ? null : centsFromNumber(c) });
  }
  const yearly: number[] = [];
  for (let r = 32; r <= 60; r++) {
    const name = wb.text('Budget', `E${r}`);
    const cost = wb.number('Budget', `F${r}`);
    if (name !== null && cost !== null) yearly.push(centsFromNumber(cost));
  }
  const override = wb.cell('Budget', 'D3');
  const overrideCents =
    override !== null && override.formula === null && typeof override.v === 'number'
      ? centsFromNumber(override.v)
      : null;

  const sideIncome: SideIncomeRow[] = [];
  for (let r = 2; r <= 799; r++) {
    const periodEnd = wb.date('Side Income', `F${r}`);
    if (periodEnd === null) continue;
    if (wb.isBlank('Side Income', `G${r}`) && wb.isBlank('Side Income', `H${r}`)) continue;
    const periodStart = wb.date('Side Income', `E${r}`) ?? `${periodEnd.slice(0, 7)}-01`;
    sideIncome.push({ periodStart, periodEnd, amount: wb.number('Side Income', `I${r}`) ?? 0 });
  }

  const classTargets = Object.fromEntries(
    Object.entries(NET_WORTH_CLASS_ROWS).map(([cls, row]) => [
      cls,
      ratioCell(wb, 'Net Worth', `D${row}`),
    ]),
  ) as Record<AssetClass, string | null>;

  return {
    input: {
      asOf,
      payFrequency,
      netPayCents: netPay === null ? null : centsFromNumber(netPay),
      includeSideIncome: yesNo(wb, 'Budget', 'D4') === true,
      sideIncomePeriods: sideIncome.map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        amountCents: centsFromNumber(p.amount),
      })),
      items,
      yearlyExpenseAnnualCents: yearly,
      autoInvestSplit: yesNo(wb, 'Budget', 'F4'),
      useBudgetForInvest:
        useBudgetCell === null ? null : yesNo(wb, 'SheetOptions', useBudgetCell.addr),
      cashTargetRatio: classTargets.cash,
      aggressiveness,
      lastSnapshotCashShare: null,
      currentCashShare: ratioCell(wb, 'Net Worth', 'C41'),
      cashCents: centsFromNumber(wb.number('Cash', 'C13') ?? 0),
      emergencyFundMonths: months === null || !Number.isInteger(months) ? null : months,
      emergencyFundOverrideCents: overrideCents,
      marginalTaxRate: ratioCell(wb, 'SheetOptions', 'H31'),
    },
    payDayOfMonth: payDay === null || !Number.isInteger(payDay) ? null : payDay,
    sideIncome,
    classTargets,
    otherAssetsCents: centsFromNumber(wb.number('Other Assets', 'D3') ?? 0),
    recomputedH43: recomputeH43(wb),
  };
}

/** SheetOptions H43 recomputed: History!N ÷ Net Worth!L at the rows dated Net Worth!C51. */
function recomputeH43(wb: WorkbookReader): number | null {
  const lastRun = wb.date('Net Worth', 'C51');
  if (lastRun === null) return null;
  let cash: number | null = null;
  for (let r = 3; r <= 300; r++) {
    if (wb.date('History', `A${r}`) === lastRun) {
      cash = wb.number('History', `N${r}`);
      break;
    }
  }
  let liquid: number | null = null;
  for (let r = 1; r <= 400; r++) {
    if (wb.date('Net Worth', `K${r}`) === lastRun) {
      liquid = wb.number('Net Worth', `L${r}`);
      break;
    }
  }
  if (cash === null || liquid === null || liquid === 0) return null;
  return cash / liquid;
}

/** The FY start year of the first Dividends!K4:K8 label (`2022-2023` → 2022). */
export function fiveFyWindowStart(wb: WorkbookReader): number | null {
  const label = wb.text('Dividends', 'K4');
  const m = label === null ? null : /^(\d{4})/.exec(label);
  return m ? Number(m[1]) : null;
}

export function kindOfType(type: string): InstrumentKind | null {
  return TYPE_TO_KIND[type] ?? null;
}

/** Excel/Sheets serial of an ISO date. */
export function serialOf(date: IsoDate): number {
  return dayNumber(date) + 25_569;
}
