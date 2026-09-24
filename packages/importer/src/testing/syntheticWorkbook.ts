// The generic synthetic workbook (stage-1.md §7.3 step 1, §9.2): a template-v2.15 export with
// every sheet and anchor the importer reads, filled with generic data only. Cached cells (held
// units, totals, History, Net Worth rolling rows, Capital Gains counts, …) are computed from the
// same data, so the clean variant reconciles with zero unexplained differences.
//
// Imports only `xlsx` (no Vitest, no @joinr/*), so Playwright can load this file directly.
import * as XLSX from 'xlsx';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';

/** True once buildSyntheticWorkbook() works. */
export const SYNTHETIC_WORKBOOK_IMPLEMENTED: boolean = true;

/**
 * True only after the importer's own clean-synthetic-workbook import test passes; gates the
 * server integration test and the e2e setup import.
 */
export const IMPORTER_IMPLEMENTED: boolean = true;

/** SheetJS will not write a sheet named `History`; it is written under this name and renamed. */
export const SYNTHETIC_HISTORY_TMP = 'HistoryTmp';

export interface SyntheticWorkbookOptions {
  /** `clean` reconciles with zero unexplained; `faulty` adds the documented faults. */
  variant?: 'clean' | 'faulty';
  /** Edits the workbook before it is written (sees the History sheet as SYNTHETIC_HISTORY_TMP). */
  mutate?: (wb: WorkBook) => void;
}

/** Generic facts about the synthetic workbook (tests and e2e specs assert on these). */
export const SYNTHETIC_FACTS = {
  asOf: '2026-03-20',
  lastRun: '2026-02-28',
  /** The SheetOptions ID 1 and ID 29 values: never stored, logged or reported. */
  secretValues: ['someone@example.com', 'InsertHere'],
  symbols: {
    stock: ['ASX:ABC', 'ASX:XYZ'],
    etf: ['ASX:DEF', 'ASX:MNO', 'ASX:OLD'],
    managed_fund: ['EXAMPLEFUND'],
    crypto: ['BTC', 'ETH'],
  },
  cashAccounts: [
    'Example Bank – Everyday',
    'Example Bank – Savings',
    'Example Card – Credit',
    'Example Offset',
  ],
  snapshotPeriods: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
} as const;

// ─── Cells and sheets ───────────────────────────────────────────────────────────────────────────

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → spreadsheet serial (1900 system). */
function serial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY_MS);
}

/** EDATE: add whole months, clamping the day. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

function colLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

class SheetBuilder {
  private readonly cells: Record<string, CellObject> = {};
  private maxRow = 1;
  private maxCol = 0;

  set(addr: string, cell: CellObject): this {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) throw new Error(`bad address ${addr}`);
    this.maxRow = Math.max(this.maxRow, Number(m[2]));
    this.maxCol = Math.max(this.maxCol, colIndex(m[1]!));
    this.cells[addr] = cell;
    return this;
  }

  n(addr: string, v: number, f?: string): this {
    return this.set(addr, f === undefined ? { t: 'n', v } : { t: 'n', v, f });
  }

  s(addr: string, v: string, f?: string): this {
    return this.set(addr, f === undefined ? { t: 's', v } : { t: 's', v, f });
  }

  b(addr: string, v: boolean): this {
    return this.set(addr, { t: 'b', v });
  }

  /** A formula whose result is blank (Google exports these as `""`). */
  blank(addr: string, f: string): this {
    return this.set(addr, { t: 's', v: '', f });
  }

  link(addr: string, text: string, target: string): this {
    return this.set(addr, { t: 's', v: text, l: { Target: target } });
  }

  /** A number, a string, or nothing (undefined/null skip the cell). */
  value(addr: string, v: number | string | boolean | null | undefined, f?: string): this {
    if (v === null || v === undefined) return this;
    if (typeof v === 'number') return this.n(addr, v, f);
    if (typeof v === 'boolean') return this.b(addr, v);
    return this.s(addr, v, f);
  }

  build(): WorkSheet {
    const ws: WorkSheet = { ...this.cells };
    ws['!ref'] = `A1:${colLetter(this.maxCol)}${this.maxRow}`;
    return ws;
  }
}

// ─── Generic data ───────────────────────────────────────────────────────────────────────────────

interface LedgerDef {
  symbol: string;
  date: string;
  units: number;
  price: number;
  /** Typed brokerage (Stocks/ETFs). Crypto fees are always the % formula. */
  fee?: number;
}

type Ledger = (LedgerDef | null)[]; // null = a blank row inside the table

interface Data {
  stocks: Ledger;
  etfs: Ledger;
  mf: Ledger;
  crypto: Ledger;
  dividends: {
    date: string;
    ticker: string;
    type: string;
    exDate?: string;
    reinvested?: string;
    net: number;
    price?: number | string;
    priceFormula?: boolean;
  }[];
  history: { date: string; duplicate?: boolean }[];
  unitsOverride: Record<string, number>;
  movementDelta: { period: string; column: string; delta: number } | null;
}

const AS_OF = SYNTHETIC_FACTS.asOf;
const LAST_RUN = SYNTHETIC_FACTS.lastRun;
const LIVE_RUN = '2026-03-31';
const CRYPTO_FEE_RATE = 0.005;

function syntheticData(variant: 'clean' | 'faulty'): Data {
  const stocks: Ledger = [
    { symbol: 'ASX:ABC', date: '2025-10-10', units: 100, price: 10, fee: 9.5 },
    { symbol: 'ASX:XYZ', date: '2025-11-03', units: 1000, price: 3.5, fee: 9.5 },
    { symbol: 'ASX:ABC', date: '2025-12-05', units: 50, price: 11.2, fee: 9.5 },
    { symbol: 'ASX:XYZ', date: '2026-01-20', units: -200, price: 4.1, fee: 9.5 },
    { symbol: 'ASX:ABC', date: '2026-03-05', units: 10, price: 12.1, fee: 0 },
  ];
  const etfs: Ledger = [
    { symbol: 'ASX:OLD', date: '2025-10-02', units: 10, price: 20, fee: 9.5 },
    { symbol: 'ASX:DEF', date: '2025-10-20', units: 10.5, price: 48, fee: 9.5 },
    { symbol: 'ASX:OLD', date: '2025-11-15', units: -10, price: 22, fee: 9.5 },
    { symbol: 'ASX:MNO', date: '2025-12-10', units: 20, price: 30, fee: 9.5 },
    null,
    { symbol: 'ASX:DEF', date: '2026-01-12', units: 0.1, price: 49.5, fee: 0 },
    { symbol: 'ASX:DEF', date: '2026-02-03', units: 0.2, price: 50, fee: 0 },
  ];
  const mf: Ledger = [
    { symbol: 'EXAMPLEFUND', date: '2025-10-15', units: 1000, price: 1.1 },
    { symbol: 'EXAMPLEFUND', date: '2025-12-15', units: 400.123456, price: 1.2 },
    // Float noise as the sheets export it (a units cell holding -100.10000000000001).
    { symbol: 'EXAMPLEFUND', date: '2026-02-15', units: -100.10000000000001, price: 1.25 },
  ];
  const crypto: Ledger = [
    { symbol: 'BTC', date: '2025-10-05', units: 0.01, price: 60000 },
    { symbol: 'ETH', date: '2025-11-20', units: 0.5, price: 3000 },
    { symbol: 'BTC', date: '2026-01-25', units: 0.005, price: 65000 },
  ];
  const dividends: Data['dividends'] = [
    {
      date: '2026-01-15',
      ticker: 'DEF',
      type: 'ETF',
      exDate: '2025-12-30',
      reinvested: 'No',
      net: 12.34,
      price: 49.1,
    },
    {
      date: '2025-12-20',
      ticker: 'ASX:ABC',
      type: 'Stocks',
      reinvested: 'Yes',
      net: 25,
      price: 11.05,
      priceFormula: true,
    },
    {
      date: '2026-02-10',
      ticker: 'EXAMPLEFUND',
      type: 'Managed Fund',
      exDate: '2026-01-30',
      net: 5.5,
    },
    { date: '2025-05-10', ticker: 'ASX:XYZ', type: 'Stocks', net: 10, price: '#N/A' },
  ];
  const history: Data['history'] = [
    { date: '2025-10-31' },
    { date: '2025-11-30' },
    { date: '2025-12-31' },
    { date: '2026-01-31' },
    { date: LAST_RUN },
  ];
  const data: Data = {
    stocks,
    etfs,
    mf,
    crypto,
    dividends,
    history,
    unitsOverride: {},
    movementDelta: null,
  };
  if (variant === 'faulty') {
    // out_of_order: an old ETF buy between two recent rows.
    etfs.splice(6, 0, { symbol: 'ASX:DEF', date: '2025-09-01', units: 1, price: 45, fee: 0 });
    // price_outlier: a fourth fund trade at about 8× the median of the others.
    mf.push({ symbol: 'EXAMPLEFUND', date: '2026-02-20', units: 10, price: 9.99 });
    // oversell: selling more than is held.
    stocks.push({ symbol: 'ASX:XYZ', date: '2026-02-10', units: -2000, price: 4.2, fee: 9.5 });
    // An unmatched dividend ticker.
    dividends.push({ date: '2026-02-20', ticker: 'ZZZ', type: 'ETF', net: 3 });
    // A held-units cell that disagrees with the ledger.
    data.unitsOverride['ASX:ABC'] = 161;
    // A movement cell that disagrees with the ledger.
    data.movementDelta = { period: '2025-12', column: 'I', delta: 100 };
    // Two frozen History rows in one month.
    history.splice(3, 0, { date: '2026-01-15', duplicate: true });
  }
  return data;
}

const rows = (ledger: Ledger): LedgerDef[] => ledger.filter((r): r is LedgerDef => r !== null);

/** SUMIF-style held units (JS doubles, as the sheet computes them). */
function heldUnits(ledger: Ledger, symbol: string): number {
  let total = 0;
  for (const r of rows(ledger)) if (r.symbol === symbol) total += r.units;
  return total;
}

// ─── Sheets ─────────────────────────────────────────────────────────────────────────────────────

interface Totals {
  stocksValue: number;
  stocksGain: number;
  etfValue: number;
  etfGain: number;
  mfValue: number;
  mfGain: number;
  cryptoValue: number;
  cryptoGain: number;
  cash: number;
  otherValue: number;
  otherGain: number;
  superTotal: number;
  superGain: number;
  propertyPurchase: number;
  propertyValue: number;
  propertyGain: number;
  mortgageStart: number;
  mortgageBalance: number;
  mortgagePaid: number;
  loansBalance: number;
  loansPaid: number;
}

const LEDGER_FORMULA = (r: number) => `IF(D${r}<>"",C${r}*D${r},"")`;

function ledgerRows(
  sb: SheetBuilder,
  ledger: Ledger,
  first: number,
  cols: { fee: string | null; orderValue: string; cryptoFee?: boolean },
): void {
  ledger.forEach((t, i) => {
    const r = first + i;
    if (t === null) {
      sb.blank(`${cols.orderValue}${r}`, LEDGER_FORMULA(r));
      return;
    }
    sb.s(`A${r}`, t.symbol)
      .n(`B${r}`, serial(t.date))
      .n(`C${r}`, t.units)
      .n(`D${r}`, t.price)
      .n(`${cols.orderValue}${r}`, t.units * t.price, LEDGER_FORMULA(r));
    if (cols.cryptoFee) {
      sb.n(
        `E${r}`,
        Math.abs(CRYPTO_FEE_RATE * (t.units * t.price)),
        `IF(A${r}<>"",abs(SheetOptions!$L$40*$G${r}),"")`,
      );
    } else if (cols.fee !== null && t.fee !== undefined) {
      sb.n(`${cols.fee}${r}`, t.fee);
    }
  });
  // Trailing formula blanks, as the template has.
  const end = first + ledger.length;
  for (let r = end; r < end + 3; r++) sb.blank(`${cols.orderValue}${r}`, LEDGER_FORMULA(r));
}

const units = (d: Data, ledger: Ledger, symbol: string) =>
  d.unitsOverride[symbol] ?? heldUnits(ledger, symbol);

function stocksSheet(d: Data, t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  const headers = ['Ticker', 'Stock Name', 'Currency', 'Live Price (AUD)', '180D History'];
  headers.forEach((h, i) => sb.s(`${colLetter(i)}1`, h));
  sb.s('G1', 'Held Units').s('H1', 'Total Live Value ($)').s('P1', 'Target Allocation');
  sb.s('R1', 'Sector').s('S1', 'Dividend Freq (m)').s('T1', 'DRP On?');
  const watch = [
    {
      r: 2,
      symbol: 'ASX:ABC',
      name: 'Example Resources Ltd',
      price: 12.5,
      target: 0.5,
      sector: 'Mining',
      freq: 'Enter Freq',
      drp: 'Enter DRP',
    },
    {
      r: 4,
      symbol: 'ASX:XYZ',
      name: 'Example Retail Ltd',
      price: 4.321,
      target: 0.5,
      sector: 'Consumer',
      freq: 6,
      drp: 'Yes',
    },
  ];
  let value = 0;
  for (const w of watch) {
    const held = units(d, d.stocks, w.symbol);
    const f = (col: string) => `IFERROR(__xludf.DUMMYFUNCTION("${col}${w.r}"),0)`;
    sb.s(`A${w.r}`, w.symbol)
      .s(`B${w.r}`, w.name, f('GOOGLEFINANCE name '))
      .s(`C${w.r}`, 'AUD')
      .n(`D${w.r}`, w.price, f('GOOGLEFINANCE price '))
      .n(`G${w.r}`, held, `IF($A${w.r}<>"",SUMIF($A$23:$A500,A${w.r},$C$23:$C500),"")`)
      .n(`H${w.r}`, held * w.price, `IFERROR(G${w.r}*D${w.r},"-")`)
      .n(`P${w.r}`, w.target)
      .s(`R${w.r}`, w.sector)
      .value(`S${w.r}`, w.freq)
      .value(`T${w.r}`, w.drp);
    value += held * w.price;
  }
  for (const r of [3, 5, 6, 7, 8, 9, 10, 11, 12]) {
    sb.blank(`B${r}`, `IF($A${r}<>"","name","")`).blank(`D${r}`, `IF($A${r}<>"","price","")`);
    sb.blank(`G${r}`, `IF($A${r}<>"",SUMIF($A$23:$A500,A${r},$C$23:$C500),"")`);
  }
  sb.s(
    'A13',
    'Insert further rows by inserting rows and copying down formulas. Please note you must use an exchange code (ie. ASX) in front of all tickers',
  );
  sb.s('A14', 'ℹ️ Help', 'hyperlink("https://example.com/help","ℹ️ Help")');
  t.stocksValue = value;
  t.stocksGain = 123.45;
  sb.s('B16', 'CURRENT PORTFOLIO VALUE').n(
    'E16',
    value,
    'IFERROR(SUMIF($R$2:$R$12,"<>Retirement",$H$2:$H$12),0)',
  );
  sb.s('B17', 'Total Growth ($)').n('E17', t.stocksGain, 'IFERROR(sumifs(I2:I12,G2:G12,">0"),0)');
  sb.s('A21', '  Purchase History Table');
  ['Ticker', 'Purchase Date', 'Volume', 'Order Price (AUD)*', 'Brokerage', 'Sold Units'].forEach(
    (h, i) => sb.s(`${colLetter(i)}22`, h),
  );
  sb.s('G22', 'Order Value');
  ledgerRows(sb, d.stocks, 23, { fee: 'E', orderValue: 'G' });
  return sb.build();
}

function etfsSheet(d: Data, t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  const headers: Record<string, string> = {
    A: 'Tick',
    B: 'Fund Name',
    C: 'Currency',
    D: 'Live Price (AUD)',
    F: 'Held Units',
    G: 'Live Value',
    O: 'Target Alloc.',
    Q: 'MGT Fee',
    R: 'Location',
    S: '% - US',
    T: '% - Asia',
    U: '% - Aus',
    V: '% - EU/Other',
    W: 'Sector',
    X: 'Dividend Freq (m)',
    Y: 'DRP On?',
  };
  for (const [c, h] of Object.entries(headers)) sb.s(`${c}1`, h);
  // Row 2: a normal ETF. Row 3: the gold-style ETF priced through a Managed Funds feed row (D22),
  // whose price is the template's "-" sentinel, so the tab total collapses to 0 (template bug).
  const defUnits = units(d, d.etfs, 'ASX:DEF');
  const defPrice = 50.25;
  sb.s('A2', 'ASX:DEF')
    .s('B2', 'Example Global Shares ETF')
    .s('C2', 'AUD')
    .n('D2', defPrice, 'IFERROR(__xludf.DUMMYFUNCTION("price"),50.25)')
    .n('F2', defUnits, 'IF($A2<>"",SUMIF($A$23:$A500,A2,$C$23:$C500),"")')
    .n('G2', defUnits * defPrice, 'IFERROR(F2*D2,"-")')
    .n('O2', 0.7)
    .n('Q2', 0.0018)
    .s('R2', 'Aus')
    .n('S2', 0.6)
    .n('T2', 0.1)
    .n('U2', 0.05)
    .n('V2', 0.25)
    .s('W2', 'Global')
    .n('X2', 3)
    .s('Y2', 'Yes');
  const mnoUnits = units(d, d.etfs, 'ASX:MNO');
  sb.s('A3', 'ASX:MNO')
    .s('B3', 'Example Gold ETF')
    .s('C3', 'AUD')
    .s('D3', '-', "'Managed Funds'!D5")
    .s('E3', '-')
    .n('F3', mnoUnits, 'IF($A3<>"",SUMIF($A$23:$A500,A3,$C$23:$C500),"")')
    .s('G3', '#VALUE!', 'IFERROR(F3*D3,"-")')
    .s('I3', '#VALUE!')
    .n('O3', 0.3)
    .n('Q3', 0.0015)
    .s('R3', 'Aus')
    .s('W3', 'Gold')
    .n('X3', 0)
    .s('Y3', 'Enter DRP');
  for (let r = 4; r <= 11; r++) {
    sb.blank(`D${r}`, `IF($A${r}<>"","price","")`);
    sb.blank(`F${r}`, `IF($A${r}<>"",SUMIF($A$23:$A500,A${r},$C$23:$C500),"")`);
  }
  sb.s(
    'A12',
    'Insert further rows by inserting rows and copying down formulas. Please note you must use an exchange code (ie. ASX) in front of all ticker references',
  );
  sb.s('A13', 'ℹ️ Help');
  // The template's total: one error value in G zeroes the whole SUMIF (the sheet_error_value case).
  t.etfValue = 0;
  t.etfGain = 45.6;
  sb.s('B15', 'CURRENT PORTFOLIO VALUE: ').n(
    'F15',
    0,
    'IFERROR(SUMIF($W$2:$W$11,"<>Retirement",$G$2:$G$11),0)',
  );
  sb.s('B16', 'Total Return ($)').n(
    'F16',
    t.etfGain,
    'IFERROR(SUMIFS($H$2:$H$11,$F$2:$F$11,">0"),"-")',
  );
  sb.s('K18', 'ETF Limit').n('L18', 5);
  sb.s('A21', '  Purchase History Table');
  ['Ticker', 'Order Date', '△ Units', 'Order Price (AUD)*', 'Brokerage', 'Sold Units'].forEach(
    (h, i) => sb.s(`${colLetter(i)}22`, h),
  );
  sb.s('G22', 'Order Value');
  ledgerRows(sb, d.etfs, 23, { fee: 'E', orderValue: 'G' });
  return sb.build();
}

const FEED_PRICES = { silver: 50.5, gold: 4000.25, fx: 0.65 };

function managedFundsSheet(d: Data, t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  const headers: Record<string, string> = {
    A: 'Fund ID',
    B: 'Fund Name',
    C: 'Currency',
    D: 'Live Price (AUD)',
    E: 'Invested Units',
    F: 'Live Value',
    N: 'Target\nAllocation',
    P: 'MGT\nFee',
    Q: 'Location',
    R: '% - US',
    S: '% - Asia',
    T: '% - Aus',
    U: '% - EU/Other',
    V: 'Sector',
    X: 'Dividend Freq (m)',
    Y: 'DRP On?',
  };
  for (const [c, h] of Object.entries(headers)) sb.s(`${c}1`, h);
  const fundUnits = units(d, d.mf, 'EXAMPLEFUND');
  const fundPrice = 1.2345; // typed (no formula): a manual price
  sb.s('A2', 'EXAMPLEFUND')
    .s('B2', 'Example Managed Fund')
    .s('C2', 'AUD')
    .n('D2', fundPrice)
    .n('E2', fundUnits, 'IF($A2<>"",SUMIF($A$23:$A500,A2,$C$23:$C500),"")')
    .n('F2', fundUnits * fundPrice, 'IFERROR(IF($A2<>"",E2*D2,""),"-")')
    .n('N2', 1)
    .n('P2', 0.005)
    .s('Q2', 'World')
    .n('R2', 0.6)
    .n('S2', 0.1)
    .n('T2', 0.05)
    .n('U2', 0.25)
    .s('V2', 'World Index')
    .s('X2', 'Quarterly')
    .s('Y2', 'Enter DRP');
  // Feed rows: bullion futures (D23), a duplicate of the gold ETF (D22) and an FX feed.
  const feeds: [number, string, string, string, number | string][] = [
    [3, 'SI=F', 'Silver Price', 'USD', FEED_PRICES.silver],
    [4, 'GC=F', 'Gold Price', 'USD', FEED_PRICES.gold],
    [5, 'MNO', 'Example Gold ETF', 'AUD', '-'],
    [6, 'AUDUSD=X', 'AUD/USD', 'USD', FEED_PRICES.fx],
  ];
  for (const [r, id, name, ccy, price] of feeds) {
    sb.s(`A${r}`, id)
      .s(`B${r}`, name)
      .s(`C${r}`, ccy)
      .value(`D${r}`, price, 'IFERROR(__xludf.DUMMYFUNCTION("price"),"-")')
      .n(`E${r}`, 0, `IF($A${r}<>"",SUMIF($A$23:$A500,A${r},$C$23:$C500),"")`)
      .value(
        `F${r}`,
        typeof price === 'number' ? 0 : '-',
        `IFERROR(IF($A${r}<>"",E${r}*D${r},""),"-")`,
      )
      .n(`N${r}`, 0)
      .s(`X${r}`, 'Enter Freq')
      .s(`Y${r}`, 'Enter DRP');
  }
  for (let r = 7; r <= 11; r++)
    sb.blank(`E${r}`, `IF($A${r}<>"",SUMIF($A$23:$A500,A${r},$C$23:$C500),"")`);
  sb.s('A12', 'Insert further rows by inserting rows and copying down formulas');
  sb.s('A13', 'ℹ️ Help');
  t.mfValue = fundUnits * fundPrice;
  t.mfGain = 67.89;
  sb.s('B15', 'CURRENT FUNDS BALANCE').n(
    'B16',
    t.mfValue,
    'IFERROR(SUMIF($V$2:$V$11,"<>Retirement",$F$2:$F$11),0)',
  );
  sb.s('F16', 'Total Return ($)').n(
    'H16',
    t.mfGain,
    'IFERROR(SUMIFS($G$2:$G$11,$E$2:$E$11,">0"),0)',
  );
  sb.s('A21', '  Purchase History Table');
  ['Fund ID', 'Order Date', '△ Units', 'Order Price (AUD)*', 'Sold Units', 'Order Value'].forEach(
    (h, i) => sb.s(`${colLetter(i)}22`, h),
  );
  ledgerRows(sb, d.mf, 23, { fee: null, orderValue: 'F' });
  return sb.build();
}

function cryptoSheet(d: Data, t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  const headers: Record<string, string> = {
    A: 'Ticker Code',
    B: 'Live Price ($ AUD)',
    C: 'Live Price ($ USD)',
    D: 'Held Units',
    E: 'Live Value ($)',
    M: 'Desired Allocation',
    O: 'Dividend Freq (m)',
    P: 'DRP On?',
  };
  for (const [c, h] of Object.entries(headers)) sb.s(`${c}1`, h);
  // B2 is a single Google array formula spilling down B2:B7 (and C2 likewise). Here it failed
  // (#ERROR!) and the spill members were not exported; C3 is a spilled value with no formula.
  const btc = units(d, d.crypto, 'BTC');
  const eth = units(d, d.crypto, 'ETH');
  sb.s('A2', 'BTC')
    .s('B2', '#ERROR!', 'IF(SheetOptions!$D$48="","CoinMarketCap","")')
    .n('C2', 40000, 'IFERROR(IF(SheetOptions!$D$48="","usd",""),"")')
    .n('D2', btc, 'IF($A2<>"",SUMIF($A$17:$A500,A2,$C$17:$C500),"")')
    .s('E2', 'Loading..', 'IFERROR(IF(A2<>"",D2*B2,""),"Loading..")')
    .n('M2', 0.6)
    .s('O2', 'Enter Freq')
    .s('P2', 'Enter DRP');
  sb.s('A3', 'ETH')
    .n('C3', 2000)
    .n('D3', eth, 'IF($A3<>"",SUMIF($A$17:$A500,A3,$C$17:$C500),"")')
    .n('E3', 0, 'IFERROR(IF(A3<>"",D3*B3,""),"Loading..")')
    .n('M3', 0.4)
    .s('O3', 'Enter Freq')
    .s('P3', 'Enter DRP');
  for (let r = 4; r <= 7; r++)
    sb.blank(`D${r}`, `IF($A${r}<>"",SUMIF($A$17:$A500,A${r},$C$17:$C500),"")`);
  sb.s('A8', 'ℹ️ Help', 'hyperlink("https://example.com/help","ℹ️ Help")');
  t.cryptoValue = 0;
  t.cryptoGain = -12.5;
  sb.s('B9', 'CURRENT PORTFOLIO VALUE').n('E9', 0, 'IFERROR(sum(E2:E7),"-")');
  sb.s('B10', 'Total Return ($)').n('E10', t.cryptoGain, 'IFERROR(sum(F2:F7),0)');
  sb.s('A15', '  Purchase History Table');
  const headers16 = [
    'Ticker Code',
    'Order Date',
    '△ Units',
    'Order Price (AUD)',
    'Fee',
    'Sold Units',
    'Order Value',
  ];
  headers16.forEach((h, i) => sb.s(`${colLetter(i)}16`, h));
  ledgerRows(sb, d.crypto, 17, { fee: 'E', orderValue: 'G', cryptoFee: true });
  return sb.build();
}

const KINDS: Record<string, string> = {
  ETF: 'etf',
  Stocks: 'stock',
  'Managed Fund': 'managed_fund',
  Crypto: 'crypto',
};

function dividendsSheet(d: Data): WorkSheet {
  const sb = new SheetBuilder();
  const fyStartYear = Number(AS_OF.slice(0, 4)) - (Number(AS_OF.slice(5, 7)) >= 7 ? 0 : 1);
  sb.s('A1', 'FY Start:').n('B1', serial(`${fyStartYear}-07-01`), 'IF(MONTH(TODAY())>=7,1,0)');
  sb.s('D1', 'to').n('I1', serial(`${fyStartYear + 1}-07-01`), 'edate(B1,12)');
  sb.s('A2', 'Historical Dividends');
  const headers = [
    'Payment Date',
    'Ticker',
    'Holding Type',
    'Ex-Dividend',
    'Reinvested?\n(Mouse over for note)',
    'Net Amount (AUD)',
    'Price @ Dividend\n(Estimate)',
    'Units Held',
    'Net Yield',
  ];
  headers.forEach((h, i) => sb.s(`${colLetter(i)}3`, h));
  [
    'Auto Date',
    'Net ETF Dis.',
    'Net Stocks Div.',
    'Net MF Div.',
    'Net Crypto Stake',
    'Total Net Div.',
  ].forEach((h, i) => sb.s(`${colLetter(10 + i)}3`, h));
  // Row 4 is blank (formula blanks only), then the dividend rows.
  sb.blank('H4', 'IF(A4<>"",1,"")').blank('I4', 'IFERROR(IF(G4<>"",F4/(G4*H4),""),0)');
  d.dividends.forEach((div, i) => {
    const r = 5 + i;
    sb.n(`A${r}`, serial(div.date)).s(`B${r}`, div.ticker).s(`C${r}`, div.type);
    if (div.exDate) sb.n(`D${r}`, serial(div.exDate));
    if (div.reinvested) sb.s(`E${r}`, div.reinvested);
    sb.n(`F${r}`, div.net);
    if (typeof div.price === 'number') {
      sb.n(
        `G${r}`,
        div.price,
        div.priceFormula ? `IFERROR(__xludf.DUMMYFUNCTION("price B${r}"),0)` : undefined,
      );
    } else if (typeof div.price === 'string') {
      sb.s(`G${r}`, div.price, `IFERROR(__xludf.DUMMYFUNCTION("price B${r}"),"#N/A")`);
    }
  });
  // FY summary K4:P8 (the last five financial years, the current one last).
  const cols = { etf: 'L', stock: 'M', managed_fund: 'N', crypto: 'O' } as const;
  const total: Record<string, number> = { L: 0, M: 0, N: 0, O: 0, P: 0 };
  for (let k = 0; k < 5; k++) {
    const r = 4 + k;
    const y = fyStartYear - 4 + k;
    sb.s(`K${r}`, `${y}-${y + 1}`, `YEAR($B$1)-${4 - k}&"-"&YEAR($I$1)-${4 - k}`);
    const from = `${y}-07-01`;
    const to = `${y + 1}-07-01`;
    let rowTotal = 0;
    for (const [kind, col] of Object.entries(cols)) {
      let sum = 0;
      for (const div of d.dividends) {
        if (KINDS[div.type] === kind && div.date >= from && div.date < to) sum += div.net;
      }
      sb.n(`${col}${r}`, sum, `IF(K${r}<>"",SUMIFS($F$4:$F500,$C$4:$C500,"${kind}"),"")`);
      total[col] = (total[col] ?? 0) + sum;
      rowTotal += sum;
    }
    sb.n(`P${r}`, rowTotal, `IF(K${r}<>"",sum(L${r}:O${r}),"")`);
    total.P = (total.P ?? 0) + rowTotal;
  }
  sb.s('K11', 'TOTAL');
  for (const col of ['L', 'M', 'N', 'O', 'P'])
    sb.n(`${col}11`, total[col] ?? 0, `sum(${col}4:${col}10)`);
  return sb.build();
}

const CASH_ACCOUNTS: [number, string, string | null, number, boolean][] = [
  [2, 'Example Bank – Everyday', 'AUD', 1500.25, false],
  [3, 'Example Bank – Savings', null, 10000, false], // blank currency → AUD
  [5, 'Example Card – Credit', 'AUD', -350.5, false],
  [6, 'Example Offset', 'AUD', 5000, true],
];

function cashSheet(t: Totals, runs: string[]): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('A1', 'Bank')
    .s('B1', 'Currency')
    .s('C1', 'Balance')
    .s('D1', 'AUD Balance', 'SheetOptions!$L$24&" Balance"')
    .s('E1', 'Offset');
  let total = 0;
  for (const [r, name, ccy, balance, offset] of CASH_ACCOUNTS) {
    sb.s(`A${r}`, name)
      .value(`B${r}`, ccy)
      .n(`C${r}`, balance)
      .n(`D${r}`, balance, `IF($B${r}<>"",C${r},C${r})`)
      .b(`E${r}`, offset);
    if (!offset) total += balance;
  }
  sb.blank('D4', 'IF($B4<>"",C4,"")').b('E4', false);
  for (let r = 7; r <= 12; r++) sb.blank(`D${r}`, `IF($B${r}<>"",C${r},"")`).b(`E${r}`, false);
  t.cash = total;
  sb.s('A13', 'ℹ️ Help', 'hyperlink("https://example.com/help","ℹ️ Help")')
    .s('B13', 'Balance')
    .n('C13', total, 'sumifs($D$2:$D$12, $E$2:$E$12,FALSE)');
  // Cash history: H mirrors History!A; Q holds the spend notes.
  sb.s('H1', 'Cash History (Automatically Updated)')
    .s('H2', 'Date')
    .s('Q2', 'Spend Notes (Add any spend comments below)');
  runs.forEach((date, i) => sb.n(`H${3 + i}`, serial(date), `History!A${3 + i}`));
  sb.s('Q4', 'Example note: new laptop').s('Q6', 'Example note: holiday');
  return sb.build();
}

function sideIncomeSheet(runs: string[]): { ws: WorkSheet; total: number } {
  const sb = new SheetBuilder();
  sb.s('E1', 'Date Starting')
    .s('F1', 'Date')
    .s('G1', 'Side Income 1')
    .s('H1', 'Example Tutoring')
    .s('I1', 'Total Side $')
    .s('J1', 'Notes');
  // G/H per run; undefined = blank. The last run (the live month) has no amounts and no note.
  const amounts: [number | undefined, number | undefined, string | undefined][] = [
    [1000, 0, undefined],
    [0, 150, 'Example note: one-off job'],
    [250.5, undefined, undefined],
    [1200, 75.125, 'Example note: tutoring term'],
    [800.25, 60, undefined],
  ];
  let total = 0;
  runs.forEach((date, i) => {
    const r = 2 + i;
    const [g, h, note] = amounts[i] ?? [undefined, undefined, undefined];
    const start = `${date.slice(0, 8)}01`;
    sb.n(`E${r}`, serial(start), `F${r}-DAY(F${r})+1`).n(
      `F${r}`,
      serial(date),
      `History!A${3 + i}`,
    );
    sb.value(`G${r}`, g).value(`H${r}`, h);
    const rowTotal = (g ?? 0) + (h ?? 0);
    sb.n(`I${r}`, rowTotal, `IF(F${r}<>"",sum(G${r}:H${r}),"")`);
    total += rowTotal;
    if (note) sb.s(`J${r}`, note);
  });
  const end = 2 + runs.length;
  sb.blank(`E${end}`, `IF(F${end}<>"",$F${end - 1}+1,"")`)
    .blank(`F${end}`, 'History!A1')
    .blank(`I${end}`, `IF(F${end}<>"",sum(G${end}:H${end}),"")`);
  sb.s('A7', 'Total Historical Side Income').n('C7', total, 'sum($I$2:$I799)');
  return { ws: sb.build(), total };
}

function budgetSheet(): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('A1', 'MONTHLY BUDGET');
  sb.s('A3', 'Salary Frequency: ').s('B3', 'Monthly', 'SheetOptions!$L$9');
  sb.s('C3', 'Auto 3M Emergency Fund:', '"Auto "&SheetOptions!$L$32&"M Emergency Fund:"');
  sb.n('D3', 6000, 'roundup(SheetOptions!$L$32*sum(C8:C26)/1000,0)*1000'); // the default formula
  sb.s('C4', 'Include Side Income? ').s('D4', 'No');
  sb.s('J2', 'Planned Spend');
  ['ITEM', '% Allocation', 'Monthly $', 'Weekly $', 'Yearly $', 'Bank Account', 'Category'].forEach(
    (h, i) => sb.s(`${colLetter(i)}7`, h),
  );
  type Item = [string | null, number | null, string | null, string | null, string?];
  const items: Record<number, Item> = {
    8: [null, 0, null, 'Splurge'], // unnamed row that still holds a category
    9: ['Rent', 1200, 'Example Bank – Everyday', 'Living'],
    10: ['Phone', 45.5, 'Example Card – Credit', 'Bills'],
    12: ['Groceries', 600, 'Example Bank – Everyday', 'Living'],
    13: ['Streaming', 20, 'Old Account', 'Bills'], // a stale account name
    25: ['Splurge/Fun Money', null, null, null],
  };
  const yearly: [number, string, number][] = [
    [33, 'Car Registration', 800],
    [34, 'Insurance', 1200],
    [35, 'Gifts', 400],
  ];
  const yearlyTotal = yearly.reduce((s, [, , v]) => s + v, 0);
  const yearlyFund = Math.ceil(yearlyTotal / 60) * 5;
  let planned = 0;
  for (let r = 8; r <= 29; r++) {
    sb.n(`B${r}`, 0, `C${r}/$B$2`);
    const item = items[r];
    if (item) {
      const [name, monthly, account, category] = item;
      sb.value(`A${r}`, name)
        .value(`C${r}`, monthly)
        .value(`F${r}`, account)
        .value(`G${r}`, category);
      if (monthly !== null) planned += monthly;
    }
  }
  sb.s('A24', 'Yearly Expenses - Automatic')
    .n('C24', yearlyFund, 'ROUNDUP(sum($F$32:F60)/(5*12),0)*5')
    .s('F24', 'Example Bank – Savings')
    .s('G24', 'Expenses');
  planned += yearlyFund;
  sb.s(
    'A28',
    'Investment Savings - Automatic',
    '"Investment Savings - "&IF(SheetOptions!$L$35="Yes","Automatic","Manual")',
  )
    .n('C28', 500, 'IF(SheetOptions!$L$35="Yes",ROUNDDOWN($L$7/10*SheetOptions!$H$41,0)*10,0)')
    .s('F28', 'Example Bank – Savings')
    .s('G28', 'Savings');
  sb.s('A29', 'Cash Savings - Automatic')
    .n('C29', 0, 'IF(SheetOptions!$L$35="Yes",0,0)')
    .s('F29', 'Example Bank – Savings');
  sb.n('J4', planned, 'sum(C8:C27)');
  sb.s('E31', 'Yearly Expenses').s('F31', 'Year Cost').s('G31', 'Monthly');
  sb.blank('G32', 'IF(F32<>"",F32/12,"")');
  for (const [r, name, cost] of yearly)
    sb.s(`E${r}`, name)
      .n(`F${r}`, cost)
      .n(`G${r}`, cost / 12, `IF(F${r}<>"",F${r}/12,"")`);
  return sb.build();
}

interface OtherAsset {
  r: number;
  description: string;
  link?: string;
  date?: string;
  units: number;
  currency: string;
  cost: number;
  price: number;
  priceFormula?: string;
  sold?: number;
}

const OTHER_ASSETS: OtherAsset[] = [
  {
    r: 3,
    description: 'Example Collectible Card',
    units: 1,
    currency: 'AUD',
    cost: 100,
    price: 150,
    sold: 0,
  },
  {
    r: 4,
    description: 'https://example.com/items/1',
    units: 2,
    currency: 'AUD',
    cost: 20,
    price: 25.5,
  },
  {
    r: 6,
    description: 'Example Print',
    link: 'https://example.com/print',
    date: '2025-06-01',
    units: 1,
    currency: 'AUD',
    cost: 300,
    price: 320,
    sold: 0,
  },
  {
    r: 7,
    description: 'Example Silver Coin (1oz)',
    date: '2025-11-10',
    units: 10,
    currency: 'AUD',
    cost: 45,
    price: FEED_PRICES.silver,
    priceFormula: "'Managed Funds'!D3",
    sold: 0,
  },
  {
    r: 8,
    description: 'Example Silver Bar (5oz)',
    date: '2026-01-15',
    units: 5,
    currency: 'AUD',
    cost: 48,
    price: FEED_PRICES.silver,
    priceFormula: 'K7',
    sold: 1,
  },
  {
    r: 9,
    description: 'Example Board Game',
    units: 3,
    currency: 'AUD',
    cost: 60,
    price: 55,
    sold: 1,
  },
];

function otherAssetsSheet(t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('F1', 'MISCELLANEOUS ASSETS');
  [
    'Description',
    'Purchase Date',
    '△ Units',
    'Currency',
    'Unit Purchase Price',
    'Live Unit Price',
    'Sold Units',
    'Remain Balance',
  ].forEach((h, i) => sb.s(`${colLetter(5 + i)}2`, h));
  let value = 0;
  let cost = 0;
  for (const a of OTHER_ASSETS) {
    if (a.link) sb.link(`F${a.r}`, a.description, a.link);
    else sb.s(`F${a.r}`, a.description);
    if (a.date) sb.n(`G${a.r}`, serial(a.date));
    sb.n(`H${a.r}`, a.units)
      .s(`I${a.r}`, a.currency)
      .n(`J${a.r}`, a.cost)
      .n(`K${a.r}`, a.price, a.priceFormula);
    if (a.sold !== undefined) sb.n(`L${a.r}`, a.sold);
    const remaining = a.units - Math.abs(a.sold ?? 0);
    sb.n(`M${a.r}`, remaining, `IF(AND(H${a.r}<>"",H${a.r}>0),H${a.r}-abs(L${a.r}),"")`);
    value += remaining * a.price;
    cost += remaining * a.cost;
  }
  sb.blank('M5', 'IF(AND(H5<>"",H5>0),H5-abs(L5),"")');
  t.otherValue = value;
  t.otherGain = value - cost;
  sb.s('A3', 'CURRENT ASSET VALUES').n('D3', value, 'sum(O:O)');
  sb.s('A4', 'Total Return ($)').n('D4', t.otherGain, 'sum(P:P)');
  return sb.build();
}

function superSheet(t: Totals, runs: string[]): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('A1', 'Super Accounts').s('B1', 'Value').s('E1', 'Super History');
  sb.s('A2', 'Example Super').n('B2', 50000).s('A3', 'Example Super Two').n('B3', 12000.5);
  sb.s('A8', 'Stocks (Auto)').n(
    'B8',
    0,
    'IFERROR(SUMIF(Stocks!$R$2:$R$12,"Retirement",Stocks!$H$2:$H$12),0)',
  );
  sb.s('A9', 'Managed Funds (Auto)').n(
    'B9',
    0,
    "IFERROR(SUMIF('Managed Funds'!$V$2:$V$11,\"Retirement\",'Managed Funds'!$F$2:$F$11),0)",
  );
  sb.s('A10', 'ETFs (Auto)').n(
    'B10',
    0,
    'IFERROR(SUMIF(ETFs!$W$2:$W$11,"Retirement",ETFs!$G$2:$G$11),0)',
  );
  t.superGain = 250;
  sb.s('A11', 'Market Gains (see note)').n('B11', t.superGain);
  t.superTotal = 50000 + 12000.5;
  sb.s('A12', 'Total Value:').n('B12', t.superTotal, 'sum(B2:B10)');
  sb.s(
    'A15',
    'March Retirement Contributions',
    'TEXT(EDATE(\'Net Worth\'!C51,1),"MMMM")&" Retirement Contributions"',
  );
  sb.s('A16', 'Net Voluntary Contributions').n('B16', 300);
  sb.s('E2', 'Date').s('F2', 'Super Setting').s('G2', 'Vol. Contributions ($)');
  runs.forEach((date, i) => sb.n(`E${3 + i}`, serial(date), `History!$A$${3 + i}`));
  sb.s('F3', 'Balanced').s('F4', 'Balanced').s('F5', 'Growth');
  return sb.build();
}

function propertySheet(t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('B2', 'PROPERTY ASSETS').s('C5', 'PROPERTY OVERVIEW');
  const labels: Record<number, string> = {
    15: 'Update below monthly',
    16: 'Date of Purchase',
    17: 'Primary Residence (Yes/No)',
    18: 'Purchase Value ($)',
    19: 'Current Value ($)',
    20: 'Net Rent Profit To Date ($)',
    24: 'Mortgage Start Date',
    25: 'Interest Frequency (times/year)',
    26: 'Annual Interest Rate (%)',
    27: 'Your Regular Payment ($/month)',
    28: 'Start Mortgage Balance ($)',
    29: 'Current Mortgage Balance ($)',
    30: 'Mortgage Payments Paid ($)',
  };
  for (const [r, l] of Object.entries(labels)) sb.s(`C${r}`, l);
  const start = -400000;
  const current = -395000.55;
  sb.s('D15', 'Example House')
    .n('D16', serial('2025-12-01'))
    .s('D17', 'Yes')
    .n('D18', 500000)
    .n('D19', 520000)
    .n('D20', 0)
    .n('D24', serial('2025-12-15'))
    .n('D25', 12)
    .n('D26', 0.06)
    .n('D27', 2500)
    .n('D28', start)
    .n('D29', current)
    .n('D30', start - current, 'D28-D29'); // the owner-style formula: principal reduction only
  // Slots E…O are template placeholders.
  for (let c = colIndex('E'); c <= colIndex('O'); c++) {
    const col = colLetter(c);
    sb.s(`${col}15`, `Property ${c - colIndex('D') + 1}`)
      .s(`${col}16`, '-')
      .s(`${col}17`, 'No');
    for (const r of [18, 19, 20, 25, 26, 27, 28, 29, 30]) sb.n(`${col}${r}`, 0);
    sb.s(`${col}24`, '-');
  }
  t.propertyPurchase = 500000;
  t.propertyValue = 520000;
  t.propertyGain = 20000;
  t.mortgageStart = start;
  t.mortgageBalance = current;
  t.mortgagePaid = Math.abs(start - current);
  sb.s('C6', 'Total Purchased Value ($)').n('F6', 500000, 'sum(D18:O18)');
  sb.s('C7', 'Total Current Value ($)').n('F7', 520000, 'sum(D19:O19)');
  sb.s('C8', 'Total Gain ($)').n('F8', 20000, 'sum(D21:O21)');
  sb.s('C10', 'Current Mortgage Balance ($)').n('F10', -Math.abs(current), 'abs(sum(D29:O29))*-1');
  sb.s('C11', 'Current Mortgage Paid ($)').n(
    'F11',
    t.mortgagePaid,
    'IF(\'First Time Setup\'!E30<>"No",abs(sum(D30:O30)),0)',
  );
  return sb.build();
}

function liabilitiesSheet(t: Totals): WorkSheet {
  const sb = new SheetBuilder();
  const labels = [
    'Name:',
    'Loan Start Date',
    'Interest Frequency (times/year)',
    'Annual Interest Rate (%)',
    'Your Regular Payment ($/month)',
    'Start Loan Balance ($)',
    'Current Loan Balance ($)',
    'Loan Payments Paid ($)',
  ];
  labels.forEach((l, i) => sb.s(`B${11 + i}`, l));
  sb.s('C11', 'Example Car Loan')
    .n('C12', serial('2024-05-01'))
    .n('C13', 12)
    .n('C14', 0.07)
    .n('C15', 400)
    .n('C16', 20000)
    .n('C17', 15000.25)
    .n('C18', 4999.75);
  for (const col of ['D', 'E', 'F']) for (let r = 13; r <= 18; r++) sb.n(`${col}${r}`, 0);
  sb.s(
    'G11',
    'FIFO Capital Gains - Future Tax',
    'IF(SheetOptions!$L$39="No","Personal Loan 2","FIFO Capital Gains - Future Tax")',
  );
  for (let r = 13; r <= 18; r++)
    sb.n(`G${r}`, 0, r === 16 || r === 17 ? 'IF(SheetOptions!$L$39="Yes",0,0)' : undefined);
  t.loansBalance = 15000.25;
  t.loansPaid = 4999.75;
  sb.s('B3', 'Total Loan Balance Remaining ($)').n(
    'D3',
    -15000.25,
    'IF(\'First Time Setup\'!E31<>"No",-abs(sum(C17:G17)),0)',
  );
  sb.s('B5', 'Total Payments made ($)').n(
    'D5',
    4999.75,
    'IF(\'First Time Setup\'!E31<>"No",sum(C18:G18),0)',
  );
  return sb.build();
}

export const HISTORY_HEADERS: readonly string[] = [
  'Stocks Value', 'Gain ($)', 'Gain (%)', 'Stock Movements',
  'ETF Value', 'Gain ($)', 'Gain (%)', 'ETF Movements',
  'Crypto Value', 'Gain ($)', 'Gain (%)', 'Crypto Movements',
  'Cash Value', 'Gain ($)', 'Increase (%)',
  'Super Value', 'Vol. Contrib. ($)', 'Gain ($)', 'Gain (%)',
  'Liabilities Balance', 'Paid', 'Monthly ($)',
  'Current Property ($)', 'Purchase Value ($)', 'Net Property Equity ($)', 'Gains ($)',
  'Mortgage Balance', 'Interest & Fees Paid', 'Mortgage Paid (exc. I&F)', 'Gains (%)',
  'M. Fund Value', 'Gain ($)', 'Gain (%)', 'MF Movements',
  'Other Assets Value', 'Gain ($)',
]; // prettier-ignore

/** Σ units × price of a ledger's trades in (from, to] (JS doubles, as the sheet sums them). */
function movement(ledger: Ledger, from: string, to: string): number {
  let sum = 0;
  for (const t of rows(ledger)) if (t.date > from && t.date <= to) sum += t.units * t.price;
  return sum;
}

type HistoryValues = Record<string, number>;

function historyRowValues(d: Data, k: number, date: string, prev: string): HistoryValues {
  // Arbitrary but deterministic generic values with some float noise; movements come from the
  // ledgers; derived columns follow the template's own formulas.
  const v: HistoryValues = {};
  v.B = 800 + 312.37 * k + 0.1 + 0.2;
  v.C = v.B * 0.07;
  v.D = v.C / (v.B - v.C);
  v.E = movement(d.stocks, prev, date);
  v.F = 1500 + 45.05 * k + 1e-13;
  v.G = -20.2 + 3.3 * k;
  v.H = v.G / (v.F - v.G);
  v.I = movement(d.etfs, prev, date);
  v.J = 500 + 10.5 * k;
  v.K = -3.1 * k;
  v.L = v.K / (v.J - v.K);
  v.M = movement(d.crypto, prev, date);
  v.N = 9000.13 + 402.2 * k;
  v.O = 402.2;
  v.P = v.O / (v.N - v.O);
  v.Q = 55000 + 1000.01 * k;
  v.R = k === 1 ? 0 : 100;
  v.S = 150.5 * k;
  v.T = v.S / (v.Q - v.S);
  v.U = -(16000 - 200.05 * k);
  v.V = 200.05 * k;
  v.W = 6500.2500000000009;
  const owned = date >= '2025-12-01';
  v.X = owned ? 520000 : 0;
  v.Y = owned ? 500000 : 0;
  v.AB = owned ? -(399000 - 1000.11 * k) : 0;
  v.Z = v.X + v.AB;
  v.AA = v.X - v.Y;
  v.AC = owned ? 1500.4 : 0;
  v.AD = owned ? 1000.11 : 0;
  v.AE = owned ? v.AA / v.Y : 0;
  v.AF = 1100 + 120.3 * k;
  v.AG = 20.02 * k;
  v.AH = v.AG / (v.AF - v.AG);
  v.AI = movement(d.mf, prev, date);
  v.AJ = 1200 + 25.25 * k;
  v.AK = 90.5 + k;
  return v;
}

function historySheet(d: Data): {
  ws: WorkSheet;
  rolling: { date: string; L: number; M: number; N: number; O: number; P: number }[];
} {
  const sb = new SheetBuilder();
  sb.s('A1', "DON'T DELETE COLUMNS!")
    .s('B1', 'Stocks')
    .s('F1', 'ETFs')
    .s('J1', 'Crypto')
    .s('N1', 'Cash');
  sb.s('Q1', 'Super')
    .s('U1', 'Liabilities')
    .s('W1', 'Salaried Income')
    .s('X1', 'Property')
    .s('AF1', 'Managed Funds')
    .s('AJ1', 'Other Assets');
  sb.s('A2', 'Month');
  HISTORY_HEADERS.forEach((h, i) => sb.s(`${colLetter(1 + i)}2`, h));
  const rolling: { date: string; L: number; M: number; N: number; O: number; P: number }[] = [];
  let prev = addMonths(d.history[0]!.date, -1);
  d.history.forEach((h, i) => {
    const r = 3 + i;
    const v = historyRowValues(d, i + 1, h.date, prev);
    if (d.movementDelta && d.movementDelta.period === h.date.slice(0, 7)) {
      v[d.movementDelta.column] = (v[d.movementDelta.column] ?? 0) + d.movementDelta.delta;
    }
    sb.n(`A${r}`, serial(h.date));
    for (let c = 1; c <= HISTORY_HEADERS.length; c++) {
      const col = colLetter(c);
      sb.n(`${col}${r}`, v[col] ?? 0);
    }
    rolling.push(rollingOf(h.date, v));
    prev = h.date;
  });
  // The live row: formulas everywhere (not a frozen snapshot).
  const r = 3 + d.history.length;
  const live = historyRowValues(d, d.history.length + 1, LIVE_RUN, prev);
  sb.n(`A${r}`, serial(LIVE_RUN), `IF(COUNTIF($A$3:$A${r - 1},">0")>0,EOMONTH($A${r - 1},1),"")`);
  for (let c = 1; c <= HISTORY_HEADERS.length; c++) {
    const col = colLetter(c);
    sb.n(`${col}${r}`, live[col] ?? 0, `IF(A${r}<>"",WorkingSheet!$C$16,"")`);
  }
  rolling.push(rollingOf(LIVE_RUN, live));
  sb.blank(`A${r + 1}`, `IF(COUNTIF($A$3:$A${r},">0")>0,"","")`).blank(
    `B${r + 1}`,
    `IF(A${r + 1}<>"",1,"")`,
  );
  return { ws: sb.build(), rolling };
}

function rollingOf(date: string, v: HistoryValues) {
  const L = (v.B ?? 0) + (v.F ?? 0) + (v.J ?? 0) + (v.N ?? 0) + (v.AF ?? 0) + (v.AJ ?? 0);
  const M = v.Q ?? 0;
  const N = -Math.abs(v.U ?? 0) - Math.abs(v.AB ?? 0);
  const O = v.X ?? 0;
  return { date, L, M, N, O, P: M + N + L + O };
}

function netWorthSheet(t: Totals, rolling: ReturnType<typeof historySheet>['rolling']): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('B2', 'Total Assets').s('C3', 'Total ($)').s('D3', 'Gains ($)').s('E3', 'Gains (%)');
  const lines: [number, string, number, string, number, string][] = [
    [4, 'ETFs', t.etfValue, 'ETFs!F15', t.etfGain, 'ETFs!F16'],
    [5, 'Stocks', t.stocksValue, 'Stocks!E16', t.stocksGain, 'Stocks!E17'],
    [6, 'Managed Funds', t.mfValue, "'Managed Funds'!$B$16", t.mfGain, "'Managed Funds'!H16"],
    [7, 'Crypto', t.cryptoValue, 'Crypto!E9', t.cryptoGain, 'Crypto!E10'],
    [8, 'Cash Savings', t.cash, 'Cash!C13', 0, 'Cash!C17'],
    [9, 'Other Assets', t.otherValue, "'Other Assets'!D3", t.otherGain, "'Other Assets'!D4"],
    [10, 'Super', t.superTotal, 'Super!B12', t.superGain, 'Super!B11'],
    [11, 'Property', t.propertyValue, 'Property!F7', t.propertyGain, 'Property!F8'],
  ];
  let assets = 0;
  for (const [r, label, value, vf, gain, gf] of lines) {
    sb.s(`B${r}`, label).n(`C${r}`, value, vf).n(`D${r}`, gain, gf);
    assets += value;
  }
  sb.s('B12', 'Total Assets:').n('C12', assets, 'sum(C4:C11)');
  sb.s('B18', 'Total Liabilities')
    .s('B19', 'Name')
    .s('C19', 'Initial Debt')
    .s('D19', 'Paid')
    .s('E19', 'Current Debt');
  const e20 = -Math.abs(t.loansBalance);
  const e21 = -Math.abs(t.mortgageBalance);
  sb.s('B20', 'Loans (Auto)')
    .n(
      'C20',
      -Math.abs(-t.loansBalance - t.loansPaid),
      'abs(sum(LiabilitiesDebts!D3, -LiabilitiesDebts!D5))*-1',
    )
    .n('D20', t.loansPaid, 'abs(LiabilitiesDebts!D5)')
    .n('E20', e20, 'abs(LiabilitiesDebts!D3)*-1');
  sb.s('B21', 'Property (Auto)')
    .n(
      'C21',
      -Math.abs(t.mortgageStart),
      'IF(\'First Time Setup\'!E30<>"No",abs(sum(Property!$D$28:$O$28))*-1,0)',
    )
    .n('D21', t.mortgagePaid, 'abs(Property!$F$11)')
    .n('E21', e21, 'abs(Property!$F$10)*-1');
  sb.blank('E22', 'C22');
  const e23 = e20 + e21;
  sb.s('B23', 'Total:').n('E23', e23, 'sum(E20:E22)');
  sb.s('C15', 'Total Net Worth:').n('D15', assets + e23, 'C12+E23');
  sb.s('B46', 'Sheet Version').s('C46', '2.15.4');
  sb.s('B51', 'Last run:')
    .n('C51', serial(LAST_RUN))
    .s('D51', 'Alast:')
    .n('E51', 2 + rolling.length - 1);
  sb.s('D52', 'Todays Date').n('E52', serial(AS_OF), 'today()');
  sb.s('G60', 'Date Unit').s('H60', 'Monthly');
  sb.s('G61', '# of Units').n(
    'H61',
    12,
    'IF($H$60="Quarterly",8,IF($H$60="Monthly",12,COUNT(History!$A$3:$A1299)))',
  );
  sb.s('K1', 'Date')
    .s('L1', 'Assets\n(ex.Ret & Prop)')
    .s('M1', 'Retirement')
    .s('N1', 'Liabilities')
    .s('O1', 'Property')
    .s('P1', 'Rolling NW');
  rolling.forEach((row, i) => {
    const r = 2 + i;
    sb.n(`K${r}`, serial(row.date), `History!A${3 + i}`)
      .n(`L${r}`, row.L, `History!B${3 + i}`)
      .n(`M${r}`, row.M)
      .n(`N${r}`, row.N)
      .n(`O${r}`, row.O)
      .n(`P${r}`, row.P);
  });
  return sb.build();
}

/**
 * The template's SheetOptions column-K labels for IDs 1–44 (generic template text). ID 16 uses an
 * en dash instead of the template's hyphen, to exercise label normalisation.
 */
const SHEET_OPTION_LABELS: readonly string[] = [
  'Personal Gmail', 'Day of Month Paid', 'Use Budget Tab?', 'Employment Salary', 'House Price Target',
  'General Cash Savings Target', 'Salary Frequency', 'Net Regular Income\n(What hits your bank)',
  'Job Start Date:', 'Include Side Income in Budget Income?', 'Bank Interest Rate', 'Brokerage',
  'Allocation Aggressiveness', 'Create Calendar/Email reminder?', 'Asset Allocations - ETFs',
  'Asset Allocations – Stocks', 'Asset Allocations - Crypto', 'Asset Allocations - Cash Savings',
  'HELP Debt Remaining', 'HELP Debt Amount Paid', 'House Savings Target / Year', 'Currency Choice',
  'Asset Allocations - Managed Funds', 'EOY Cash Goal', 'Market Investment Return', 'Tax Bracket',
  'House Deposit - % Target', 'House Deposit - Investment Contribution %', 'CoinMarketCap API',
  'Emergency Fund Duration', 'Monthly Run Calendar Reminder', 'Minor Version Update Notification',
  'Automatic Investment System', 'Capital Gains - Calculation Style',
  'Capital Gains - Short Term Tax Rate', 'Capital Gains - Long Term Tax Rate',
  'Capital Gains - Show in Liabilities Tab', 'Crypto Fee (%)', 'Employment Salary Currency',
  'Crypto Pricing Source', 'Include Mortgage in Savings Rate?', 'Asset Allocations - Other Assets',
  'Retirement - Contributions in Savings Rate', 'Cash - Offsets include emergency fund',
]; // prettier-ignore

/** Generic values for IDs 1–44 (the ID 1 email and ID 29 key are the template placeholders). */
const SHEET_OPTION_VALUES: readonly (number | string)[] = [
  SYNTHETIC_FACTS.secretValues[0], 15, 'Yes', 90000, 0, 50000, 'Monthly', 5000,
  serial('2020-01-06'), 'Yes', 0.045, 5, 'Normal', 'No', 0.6, 0.1, 0.05, 0.15, 0, 0, 10000,
  'AUD', 0.05, 20000, 0.07, 0.325, 0.2, 0.1, SYNTHETIC_FACTS.secretValues[1], 3,
  'Last day of Month', 'Yes', 'Yes', 'FIFO', 0.3, 0.15, 'Yes', CRYPTO_FEE_RATE, 'AUD',
  'CoinMarketCap', 'No', 0.05, 'Yes', 'No',
]; // prettier-ignore

function sheetOptionsSheet(): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('K1', 'Set/Restore Settings Here')
    .s('K2', 'Setting')
    .s('L2', 'Value')
    .s('M2', 'Category')
    .s('P2', 'ID');
  SHEET_OPTION_LABELS.forEach((label, i) => {
    const r = 3 + i;
    sb.s(`K${r}`, label)
      .value(`L${r}`, SHEET_OPTION_VALUES[i])
      .s(`M${r}`, 'General')
      .n(`P${r}`, i + 1);
  });
  for (let id = 45; id <= 49; id++) sb.n(`P${id + 2}`, id);
  sb.s('G13', 'Automated Frequency').n('H13', 3);
  sb.s('G19', 'Automatic Parcel Amount').n('H19', 1000);
  return sb.build();
}

function firstTimeSetupSheet(): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('A26', 'Step 4');
  const left: [string, string][] = [['Cash', 'Yes'], ['ETFs', 'Yes'], ['Stocks', 'Yes'], ['Managed Funds', 'Yes'], ['FIRE 🔥 Dashboard', 'No'], ['Budget', 'Yes']]; // prettier-ignore
  const right: [string, string][] = [['Crypto', 'Yes'], ['Other Assets', 'Yes'], ['Property', 'Yes'], ['Liabilities/Debts', 'Yes'], ['Side Income', 'Yes'], ['Retirement', 'Yes']]; // prettier-ignore
  left.forEach(([l, v], i) => sb.s(`B${28 + i}`, l).s(`C${28 + i}`, v));
  right.forEach(([l, v], i) => sb.s(`D${28 + i}`, l).s(`E${28 + i}`, v));
  sb.s('B34', 'Capital Gains').s('C34', 'Yes');
  return sb.build();
}

function fireSheet(): WorkSheet {
  const sb = new SheetBuilder();
  sb.s('B5', 'FIRE Specific Settings');
  sb.s('B6', 'Year of DOB').n('E6', 1990);
  sb.s('B7', 'Total Yearly Super Contribution ($)').n('E7', 2000);
  sb.s('B8', 'Estimated inflation rate (%)').n('E8', 0.03);
  sb.s('B9', 'Estimated Withdrawal Rate (%)').n('E9', 0.04);
  sb.s('B10', 'Your Retirement Preservation/Access Age').n('E10', 60);
  sb.s('B48', 'Yearly spend at current lifestyle (See note)').n(
    'E48',
    -12345.6,
    'IFERROR(averageif(Cash!H3:H85,">"&\'Net Worth\'!C51-366,Cash!P3:P85)*12,0)',
  );
  return sb.build();
}

function capitalGainsSheet(d: Data): WorkSheet {
  const sb = new SheetBuilder();
  const counts: [number, string, number][] = [
    [8, 'ETF Rows', rows(d.etfs).length],
    [9, 'Share Rows', rows(d.stocks).length],
    [10, 'Crypto Row', rows(d.crypto).length],
    [11, 'Managed Fund Rows', rows(d.mf).length],
  ];
  let total = 0;
  for (const [r, label, n] of counts) {
    sb.s(`Z${r}`, label).n(`AA${r}`, n, `IFERROR(__xludf.DUMMYFUNCTION("COUNTA ${label}"),${n})`);
    total += n;
  }
  sb.s('Z12', 'Total Transactions').n('AA12', total, 'sum(AA8:AA11)');
  return sb.build();
}

// ─── Workbook ───────────────────────────────────────────────────────────────────────────────────

/** Builds the synthetic workbook object (History under SYNTHETIC_HISTORY_TMP). */
export function buildSyntheticWorkbookObject(variant: 'clean' | 'faulty' = 'clean'): WorkBook {
  const d = syntheticData(variant);
  const t = {} as Totals;
  // Cash/Side Income/Super history columns mirror History!A for the distinct months, plus the
  // live month.
  const runs = [...d.history.filter((h) => !h.duplicate).map((h) => h.date), LIVE_RUN];
  const history = historySheet(d);
  const sheets: [string, WorkSheet][] = [
    ['Welcome', new SheetBuilder().s('A1', 'Welcome').build()],
    ['First Time Setup', firstTimeSetupSheet()],
    ['Stocks', stocksSheet(d, t)],
    ['ETFs', etfsSheet(d, t)],
    ['Managed Funds', managedFundsSheet(d, t)],
    ['Crypto', cryptoSheet(d, t)],
    ['Cash', cashSheet(t, runs)],
    ['Other Assets', otherAssetsSheet(t)],
    ['Side Income', sideIncomeSheet(runs).ws],
    ['Super', superSheet(t, runs)],
    ['Budget', budgetSheet()],
    ['Property', propertySheet(t)],
    ['LiabilitiesDebts', liabilitiesSheet(t)],
    ['Capital Gains', capitalGainsSheet(d)],
    ['FIRE 🔥', fireSheet()],
    ['SheetOptions', sheetOptionsSheet()],
    ['Dividends', dividendsSheet(d)],
    [SYNTHETIC_HISTORY_TMP, history.ws],
  ];
  // Net Worth reads the other tabs' totals, so it is built last and placed first.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, netWorthSheet(t, history.rolling), 'Net Worth');
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
  return wb;
}

interface CfbEntry {
  content: Uint8Array | number[];
}
interface CfbContainer {
  FullPaths: string[];
  FileIndex: CfbEntry[];
}
interface CfbApi {
  read(data: Uint8Array, opts: { type: 'array' }): CfbContainer;
  write(cfb: CfbContainer, opts: { fileType: 'zip'; type: 'array' }): ArrayLike<number>;
}

function renameInZip(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const CFB = XLSX.CFB as CfbApi;
  const zip = CFB.read(bytes, { type: 'array' });
  let renamed = false;
  zip.FullPaths.forEach((path, i) => {
    if (!path.endsWith('xl/workbook.xml') && !path.endsWith('docProps/app.xml')) return;
    const entry = zip.FileIndex[i];
    if (!entry) return;
    const xml = new TextDecoder().decode(Uint8Array.from(entry.content));
    const next = path.endsWith('xl/workbook.xml')
      ? xml.replace(`name="${from}"`, `name="${to}"`)
      : xml.replace(`>${from}<`, `>${to}<`);
    if (path.endsWith('xl/workbook.xml')) renamed = next !== xml;
    entry.content = new TextEncoder().encode(next);
  });
  if (!renamed) throw new Error(`Sheet ${from} not found in the workbook`);
  return Uint8Array.from(CFB.write(zip, { fileType: 'zip', type: 'array' }));
}

/** The synthetic template-v2.15 workbook as xlsx bytes. */
export function buildSyntheticWorkbook(opts: SyntheticWorkbookOptions = {}): Uint8Array {
  const wb = buildSyntheticWorkbookObject(opts.variant ?? 'clean');
  opts.mutate?.(wb);
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const bytes = new Uint8Array(written);
  return wb.SheetNames.includes(SYNTHETIC_HISTORY_TMP)
    ? renameInZip(bytes, SYNTHETIC_HISTORY_TMP, 'History')
    : bytes;
}
