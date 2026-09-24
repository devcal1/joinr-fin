// The pure sheet model the extractors produce (stage-1.md §4.3) and the processing steps
// (corrections, exclusions, suspects, re-keying) refine before anything is written.
import type {
  BudgetItemKind,
  InstrumentKind,
  IsoDate,
  IsoMonth,
  LedgerSheet,
  Metal,
  OtherAssetPriceSource,
  PeriodNoteKind,
  ReasonCode,
  ReconciliationCheck,
  ReviewFlag,
  SettingKey,
  SettingValue,
  SuperEntryKind,
  UnitOfMeasure,
} from '@joinr/schema';

export type Check = ReconciliationCheck;

export interface Meta {
  asOf: IsoDate;
  asOfFromSheet: boolean;
  templateVersion: string | null;
  lastRun: IsoDate | null;
  date1904: boolean;
  fireSheet: string | null;
}

export type PriceCellKind = 'number' | 'error' | 'sentinel' | 'blank' | 'text';

export interface PriceCell {
  kind: PriceCellKind;
  /** The cached numeric value (AUD). */
  value: number | null;
  /** Numeric, no formula, outside a known spill range: a manual price. */
  typed: boolean;
  formula: string | null;
  /** The tab a plain cross-tab reference formula points at (e.g. `'Managed Funds'!D5`). */
  crossTab: string | null;
  /** The cell text (error value or sentinel) when not numeric. */
  raw: string | null;
  sheetRef: string;
}

export interface WatchRow {
  kind: InstrumentKind;
  sheet: LedgerSheet;
  row: number;
  sheetRef: string;
  symbol: string;
  name: string | null;
  quoteCurrency: string;
  price: PriceCell;
  /** The cached held-units cell. */
  heldUnits: number | null;
  heldUnitsError: boolean;
  targetRatio: string | null;
  sector: string | null;
  isRetirement: boolean;
  location: string | null;
  mgmtFeeRatio: string | null;
  regions: [string | null, string | null, string | null, string | null];
  dividendFreqMonths: number | null;
  drp: boolean | null;
}

export interface TradeValues {
  date: IsoDate;
  units: string;
  price: string;
  feeCents: number;
  /** Crypto % fee (ratio) when the fee cell is the template formula. */
  feeRate: string | null;
}

export interface LedgerRow extends TradeValues {
  kind: InstrumentKind;
  sheet: LedgerSheet;
  row: number;
  sheetRef: string;
  symbol: string;
  /** 1-based order among the written rows of this tab's ledger (set after corrections). */
  seq: number;
  /** Cached fee and order-value cells (sheet side of the ledger checks). */
  feeCell: number | null;
  orderValueCell: number | null;
  flags: ReviewFlag[];
  correctionId: string | null;
  /** Skipped by a correction (`action: skip`): not written. */
  skipped: boolean;
  /** The values as read, when a correction changed them. */
  original: TradeValues | null;
}

export interface InstrumentDraft {
  kind: InstrumentKind;
  symbol: string;
  exchange: string | null;
  code: string;
  name: string | null;
  quoteCurrency: string;
  isWatched: boolean;
  sortOrder: number;
  targetRatio: string | null;
  sector: string | null;
  isRetirement: boolean;
  location: string | null;
  mgmtFeeRatio: string | null;
  regionUsRatio: string | null;
  regionAsiaRatio: string | null;
  regionAusRatio: string | null;
  regionOtherRatio: string | null;
  dividendFreqMonths: number | null;
  drp: boolean | null;
  sheetRef: string;
  watch: WatchRow | null;
}

export interface Exclusion {
  kind: InstrumentKind;
  symbol: string;
  sheetRef: string;
  reasonCode: Extract<ReasonCode, 'exclusion_d22' | 'exclusion_d23' | 'feed_row'>;
  decision: 'D22' | 'D23' | null;
  cachedPrice: number | null;
}

export interface DividendValues {
  paymentDate: IsoDate;
  ticker: string;
  exDate: IsoDate | null;
  netAmountCents: number;
  reinvested: boolean | null;
}

export interface DividendRow extends DividendValues {
  row: number;
  sheetRef: string;
  holdingKind: InstrumentKind;
  priceAtEx: string | null;
  priceAtExManual: boolean;
  flags: ReviewFlag[];
  correctionId: string | null;
  skipped: boolean;
  original: DividendValues | null;
  /** Set by re-keying (D28). */
  link: { symbol: string; how: 'exact' | 'rekeyed' } | null;
}

export interface CashAccountRow {
  row: number;
  sheetRef: string;
  name: string;
  currency: string;
  balanceCents: number;
  isOffset: boolean;
}

export interface NoteRow {
  kind: PeriodNoteKind;
  periodMonth: IsoMonth;
  note: string;
  sheetRef: string;
}

export interface BudgetItemRow {
  row: number;
  sheetRef: string;
  name: string;
  kind: BudgetItemKind;
  monthlyCents: number | null;
  category: string | null;
  accountName: string | null;
  /** Index into cashAccounts, set by linking. */
  cashAccountIndex: number | null;
  flags: ReviewFlag[];
}

export interface YearlyExpenseRow {
  row: number;
  sheetRef: string;
  name: string;
  annualCents: number;
}

export interface IncomeStreamRow {
  name: string;
  sheetRef: string;
}

export interface SideIncomeRow {
  streamIndex: number;
  periodMonth: IsoMonth;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  amountCents: number;
  sheetRef: string;
}

export interface OtherAssetRow {
  row: number;
  sheetRef: string;
  description: string;
  url: string | null;
  purchaseDate: IsoDate | null;
  units: string;
  soldUnits: string;
  currency: string;
  unitCost: string | null;
  unitPrice: string | null;
  priceSource: OtherAssetPriceSource;
  metal: Metal | null;
  unitOfMeasure: UnitOfMeasure;
  ozPerUnit: string | null;
}

export interface SuperFundRow {
  row: number;
  sheetRef: string;
  name: string;
  balanceCents: number;
}

export interface SuperEntryRow {
  kind: SuperEntryKind;
  periodMonth: IsoMonth;
  amountCents: number;
  sheetRef: string;
}

export interface PropertyRow {
  column: string;
  sheetRef: string;
  name: string;
  purchaseDate: IsoDate | null;
  isPrimaryResidence: boolean;
  purchaseValueCents: number;
  currentValueCents: number;
  netRentToDateCents: number;
}

export interface LoanRow {
  /** Index into properties (mortgages), else null. */
  propertyIndex: number | null;
  source: 'property' | 'liabilities' | 'net_worth';
  name: string;
  startDate: IsoDate | null;
  interestPeriodsPerYear: number | null;
  annualRate: string | null;
  paymentCents: number | null;
  startBalanceCents: number | null;
  currentBalanceCents: number;
  paymentsPaidCents: number | null;
  paymentsPaidDerived: boolean;
  sheetRef: string;
}

export interface SnapshotRow {
  row: number;
  sheetRef: string;
  runDate: IsoDate;
  periodMonth: IsoMonth;
  /** DB column (snake_case) → stored value (cents or ratio string), null when blank. */
  values: Record<string, number | string | null>;
  /** History column letter → cached number (null when not numeric). */
  raw: Record<string, number | null>;
}

export type SettingPlanStatus =
  | 'value' // stored
  | 'formula_default' // "only when typed" override holding the template formula
  | 'blank' // nothing in the cell
  | 'invalid' // present but not a valid value
  | 'missing'; // the source tab/row is absent

export interface SettingPlan {
  key: SettingKey;
  status: SettingPlanStatus;
  value: SettingValue | null;
  /** The sheet value as shown in the report (null for blanks). */
  sheetValue: string | number | null;
  sheetRef: string | null;
  /** SheetOptions ID when the source is SheetOptions. */
  sheetOptionsId: number | null;
  reason: string | null;
}

export interface WorkbookModel {
  meta: Meta;
  watch: WatchRow[];
  ledger: LedgerRow[];
  instruments: InstrumentDraft[];
  exclusions: Exclusion[];
  dividends: DividendRow[];
  cashAccounts: CashAccountRow[];
  notes: NoteRow[];
  budgetItems: BudgetItemRow[];
  yearlyExpenses: YearlyExpenseRow[];
  streams: IncomeStreamRow[];
  sideIncome: SideIncomeRow[];
  otherAssets: OtherAssetRow[];
  superFunds: SuperFundRow[];
  superEntries: SuperEntryRow[];
  properties: PropertyRow[];
  loans: LoanRow[];
  snapshots: SnapshotRow[];
  settings: SettingPlan[];
  /** Info/skip/unexplained lines found while extracting (no DB side). */
  checks: Check[];
}
