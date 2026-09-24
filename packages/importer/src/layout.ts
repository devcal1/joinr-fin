// Template v2.15 layout constants (stage-1.md §4.2–§4.3). Column letters and anchor labels are
// generic template text; nothing here is owner data.
import type { InstrumentKind, LedgerSheet } from '@joinr/schema';

export const REQUIRED_SHEETS = [
  'Net Worth',
  'Cash',
  'Stocks',
  'Managed Funds',
  'ETFs',
  'Crypto',
  'Other Assets',
  'Side Income',
  'Super',
  'Budget',
  'Property',
  'SheetOptions',
  'Dividends',
  'History',
] as const;

export const OPTIONAL_SHEETS = {
  liabilities: 'LiabilitiesDebts',
  capitalGains: 'Capital Gains',
  firstTimeSetup: 'First Time Setup',
} as const;

/** The FIRE tab's name starts with this (the full name carries an emoji). */
export const FIRE_PREFIX = 'FIRE';

/** Header anchors: [sheet, cell, expected label]. A mismatch fails the import. */
export const ANCHORS: readonly [string, string, string][] = [
  ['Stocks', 'A1', 'Ticker'],
  ['Stocks', 'A22', 'Ticker'],
  ['Stocks', 'B22', 'Purchase Date'],
  ['ETFs', 'A1', 'Tick'],
  ['ETFs', 'A22', 'Ticker'],
  ['ETFs', 'B22', 'Order Date'],
  ['Managed Funds', 'A1', 'Fund ID'],
  ['Managed Funds', 'A22', 'Fund ID'],
  ['Crypto', 'A1', 'Ticker Code'],
  ['Crypto', 'A16', 'Ticker Code'],
  ['Dividends', 'A3', 'Payment Date'],
  ['Cash', 'A1', 'Bank'],
  ['Side Income', 'F1', 'Date'],
  ['Budget', 'A7', 'ITEM'],
  ['Budget', 'E31', 'Yearly Expenses'],
  ['Other Assets', 'F2', 'Description'],
  ['Super', 'A1', 'Super Accounts'],
  ['Property', 'C15', 'Update below monthly'],
  ['History', 'A2', 'Month'],
  ['SheetOptions', 'K2', 'Setting'],
  ['SheetOptions', 'P2', 'ID'],
];

export const OPTIONAL_ANCHORS: readonly [string, string, string][] = [
  ['LiabilitiesDebts', 'B11', 'Name:'],
  ['Capital Gains', 'Z8', 'ETF Rows'],
];

export interface InvestmentLayout {
  kind: InstrumentKind;
  sheet: LedgerSheet;
  /** Watch table columns. */
  watch: {
    symbol: 'A';
    name: string | null;
    currency: string | null;
    price: string;
    units: string;
    target: string | null;
    sector: string | null;
    location: string | null;
    fee: string | null;
    regions: [string, string, string, string] | null;
    freq: string | null;
    drp: string | null;
  };
  /** Ledger header row; data starts on the next row. */
  ledgerHeader: number;
  ledger: { date: 'B'; units: 'C'; price: 'D'; fee: string | null; orderValue: string };
  /** Cells holding the tab's value and gain totals. */
  totals: { value: string; gain: string };
  /** Capital Gains row counting this ledger. */
  capitalGainsRow: number;
}

export const INVESTMENTS: readonly InvestmentLayout[] = [
  {
    kind: 'stock',
    sheet: 'Stocks',
    watch: {
      symbol: 'A',
      name: 'B',
      currency: 'C',
      price: 'D',
      units: 'G',
      target: 'P',
      sector: 'R',
      location: null,
      fee: null,
      regions: null,
      freq: 'S',
      drp: 'T',
    },
    ledgerHeader: 22,
    ledger: { date: 'B', units: 'C', price: 'D', fee: 'E', orderValue: 'G' },
    totals: { value: 'E16', gain: 'E17' },
    capitalGainsRow: 9,
  },
  {
    kind: 'etf',
    sheet: 'ETFs',
    watch: {
      symbol: 'A',
      name: 'B',
      currency: 'C',
      price: 'D',
      units: 'F',
      target: 'O',
      sector: 'W',
      location: 'R',
      fee: 'Q',
      regions: ['S', 'T', 'U', 'V'],
      freq: 'X',
      drp: 'Y',
    },
    ledgerHeader: 22,
    ledger: { date: 'B', units: 'C', price: 'D', fee: 'E', orderValue: 'G' },
    totals: { value: 'F15', gain: 'F16' },
    capitalGainsRow: 8,
  },
  {
    kind: 'managed_fund',
    sheet: 'Managed Funds',
    watch: {
      symbol: 'A',
      name: 'B',
      currency: 'C',
      price: 'D',
      units: 'E',
      target: 'N',
      sector: 'V',
      location: 'Q',
      fee: 'P',
      regions: ['R', 'S', 'T', 'U'],
      freq: 'X',
      drp: 'Y',
    },
    ledgerHeader: 22,
    ledger: { date: 'B', units: 'C', price: 'D', fee: null, orderValue: 'F' },
    totals: { value: 'B16', gain: 'H16' },
    capitalGainsRow: 11,
  },
  {
    kind: 'crypto',
    sheet: 'Crypto',
    watch: {
      symbol: 'A',
      name: null,
      currency: null,
      price: 'B',
      units: 'D',
      target: 'M',
      sector: null,
      location: null,
      fee: null,
      regions: null,
      freq: 'O',
      drp: 'P',
    },
    ledgerHeader: 16,
    ledger: { date: 'B', units: 'C', price: 'D', fee: 'E', orderValue: 'G' },
    totals: { value: 'E9', gain: 'E10' },
    capitalGainsRow: 10,
  },
];

export const investmentLayout = (kind: InstrumentKind): InvestmentLayout =>
  INVESTMENTS.find((l) => l.kind === kind)!;

/** Watch tables start on row 2 and end before the first A cell starting with one of these. */
export const WATCH_TERMINATORS = ['Insert further rows', 'ℹ️'] as const;
/** Safety bound when no terminator is found. */
export const WATCH_MAX_ROW = 60;

/**
 * Known Google spill ranges (§4.2 rule 8): values here are formula results even without a
 * formula, never typed prices.
 */
export const SPILL_RANGES: Readonly<
  Record<string, readonly { col: string; from: number; to: number }[]>
> = {
  Crypto: [
    { col: 'B', from: 2, to: 7 },
    { col: 'C', from: 2, to: 7 },
  ],
};

export const inSpillRange = (sheet: string, col: string, row: number): boolean =>
  (SPILL_RANGES[sheet] ?? []).some((r) => r.col === col && row >= r.from && row <= r.to);

/** Managed Funds dividend frequency text → months. */
export const FREQUENCY_TEXT: Readonly<Record<string, number>> = {
  monthly: 1,
  quarterly: 3,
  'half-yearly': 6,
  yearly: 12,
};

/** Dividends Holding Type → instrument kind. */
export const HOLDING_TYPES: Readonly<Record<string, InstrumentKind>> = {
  etf: 'etf',
  stocks: 'stock',
  'managed fund': 'managed_fund',
  crypto: 'crypto',
};

export const DIVIDENDS = {
  sheet: 'Dividends',
  firstRow: 4,
  lastRow: 500,
  fyRows: [4, 5, 6, 7, 8],
  fyColumns: { etf: 'L', stock: 'M', managed_fund: 'N', crypto: 'O' } as Readonly<
    Record<InstrumentKind, string>
  >,
} as const;

export const CASH = { sheet: 'Cash', firstRow: 2, maxRow: 60, notesFrom: 3, notesTo: 800 } as const;
export const SIDE_INCOME = {
  sheet: 'Side Income',
  firstRow: 2,
  lastRow: 799,
  total: 'C7',
} as const;
export const BUDGET = {
  sheet: 'Budget',
  firstRow: 8,
  maxRow: 60,
  yearlyFrom: 32,
  yearlyTo: 60,
  plannedSpend: 'J4',
  yearlyFund: 'C24',
  emergencyOverride: 'D3',
  includeSideIncome: 'D4',
} as const;
export const OTHER_ASSETS = { sheet: 'Other Assets', firstRow: 3, lastRow: 500 } as const;
export const SUPER = {
  sheet: 'Super',
  fundsFrom: 2,
  fundsTo: 7,
  autoLines: ['B8', 'B9', 'B10'],
  reportedGain: 'B11',
  total: 'B12',
  voluntary: 'B16',
  notesFrom: 3,
  notesTo: 300,
} as const;
export const PROPERTY = {
  sheet: 'Property',
  firstCol: 'D',
  lastCol: 'O',
  rows: {
    name: 15,
    purchaseDate: 16,
    primary: 17,
    purchase: 18,
    current: 19,
    netRent: 20,
    loanStart: 24,
    periods: 25,
    rate: 26,
    payment: 27,
    startBalance: 28,
    currentBalance: 29,
    paid: 30,
  },
  totals: { purchase: 'F6', value: 'F7', mortgage: 'F10', paid: 'F11' },
} as const;
export const LIABILITIES = {
  sheet: 'LiabilitiesDebts',
  columns: ['C', 'D', 'E', 'F', 'G'],
  cgtColumn: 'G',
  cgtSuffix: 'Capital Gains - Future Tax',
  rows: {
    name: 11,
    start: 12,
    periods: 13,
    rate: 14,
    payment: 15,
    startBalance: 16,
    currentBalance: 17,
    paid: 18,
  },
} as const;
export const NET_WORTH = {
  sheet: 'Net Worth',
  templateVersion: 'C46',
  lastRun: 'C51',
  asOf: 'E52',
  dateUnit: 'H60',
  unitCount: 'H61',
  spareRow: 22,
  assets: {
    etf: 'C4',
    stock: 'C5',
    managed_fund: 'C6',
    crypto: 'C7',
    cash: 'C8',
    other: 'C9',
    super: 'C10',
    property: 'C11',
  },
  gains: ['D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'],
  totalAssets: 'C12',
  total: 'D15',
  liabilities: 'E23',
  rollingFrom: 2,
  rollingTo: 1299,
} as const;
export const HISTORY = { sheet: 'History', firstRow: 3, lastRow: 300 } as const;
export const SHEET_OPTIONS = { sheet: 'SheetOptions', firstRow: 3, lastRow: 60 } as const;
export const CAPITAL_GAINS = { sheet: 'Capital Gains', column: 'AA' } as const;

/**
 * History row-2 labels for columns B…AK (generic template text), compared with
 * normaliseSheetLabel. A shifted mapping would silently corrupt every snapshot.
 */
export const HISTORY_HEADERS: Readonly<Record<string, string>> = {
  B: 'Stocks Value',
  C: 'Gain ($)',
  D: 'Gain (%)',
  E: 'Stock Movements',
  F: 'ETF Value',
  G: 'Gain ($)',
  H: 'Gain (%)',
  I: 'ETF Movements',
  J: 'Crypto Value',
  K: 'Gain ($)',
  L: 'Gain (%)',
  M: 'Crypto Movements',
  N: 'Cash Value',
  O: 'Gain ($)',
  P: 'Increase (%)',
  Q: 'Super Value',
  R: 'Vol. Contrib. ($)',
  S: 'Gain ($)',
  T: 'Gain (%)',
  U: 'Liabilities Balance',
  V: 'Paid',
  W: 'Monthly ($)',
  X: 'Current Property ($)',
  Y: 'Purchase Value ($)',
  Z: 'Net Property Equity ($)',
  AA: 'Gains ($)',
  AB: 'Mortgage Balance',
  AC: 'Interest & Fees Paid',
  AD: 'Mortgage Paid (exc. I&F)',
  AE: 'Gains (%)',
  AF: 'M. Fund Value',
  AG: 'Gain ($)',
  AH: 'Gain (%)',
  AI: 'MF Movements',
  AJ: 'Other Assets Value',
  AK: 'Gain ($)',
};

/** History movement columns per instrument kind (§4.9 movements). */
export const MOVEMENT_COLUMNS: Readonly<Record<InstrumentKind, { column: string; label: string }>> =
  {
    stock: { column: 'E', label: 'stocks' },
    etf: { column: 'I', label: 'etf' },
    crypto: { column: 'M', label: 'crypto' },
    managed_fund: { column: 'AI', label: 'mf' },
  };

// ─── A1 helpers ─────────────────────────────────────────────────────────────────────────────────

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Columns from `from` to `to` inclusive (`D`…`O`). */
export function columnRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let c = colIndex(from); c <= colIndex(to); c++) out.push(colLetter(c));
  return out;
}

/** `"<Tab>!<A1>"`, the sheet_ref of a row's key cell. */
export const sheetRef = (sheet: string, addr: string): string => `${sheet}!${addr}`;
