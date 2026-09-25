// The engine's public types (stage-2.md §2.2, FROZEN). Names, fields and signatures here do not
// change; the engine owner adds internal modules freely. Imports: the `@joinr/schema` root only.
import type {
  AllocationAggressiveness,
  AssetClass,
  BudgetItemKind,
  CapitalGainTerm,
  ChartDateUnit,
  ConsiderReason,
  DecimalString,
  HoldingFlag,
  HoldingStatus,
  InstrumentKind,
  IsoDate,
  IsoMonth,
  PayFrequency,
  PriceStatus,
  SettingKey,
  TradeSide,
} from '@joinr/schema';

/** Integer cents (a safe integer). */
export type Cents = number;

/** D36: the matching seam; only FIFO exists. */
export type MatchingStrategy = 'fifo';

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────────

export interface EngineTrade {
  id: number;
  instrumentId: number;
  tradeDate: IsoDate;
  /** Signed; negative = sell; "0" rows are ignored. */
  units: DecimalString;
  /** AUD per unit. */
  price: DecimalString;
  /** Exact when feeRate is null (fee authority, §2.3). */
  feeCents: Cents;
  /** Crypto % fee: fee = |feeRate × units × price|. */
  feeRate: DecimalString | null;
  /** FIFO tie-break (entry order within the kind). */
  seq: number;
}

export interface EngineDividend {
  id: number;
  /** Null = unmatched ticker (D28). */
  instrumentId: number | null;
  holdingKind: InstrumentKind;
  paymentDate: IsoDate;
  exDate: IsoDate | null;
  reinvested: boolean | null;
  netAmountCents: Cents;
  priceAtEx: DecimalString | null;
}

export interface EngineRegions {
  us: DecimalString | null;
  asia: DecimalString | null;
  aus: DecimalString | null;
  other: DecimalString | null;
}

export interface EngineInstrument {
  id: number;
  kind: InstrumentKind;
  symbol: string;
  name: string | null;
  watched: boolean;
  sortOrder: number;
  targetRatio: DecimalString | null;
  sector: string | null;
  regions: EngineRegions;
  mgmtFeeRatio: DecimalString | null;
  dividendFreqMonths: number | null;
}

/** The effective price (manual wins). */
export interface EnginePrice {
  price: DecimalString | null;
  status: PriceStatus;
}

export interface InvestmentsInput {
  kind: InstrumentKind;
  asOf: IsoDate;
  /** Every instrument of `kind`. */
  instruments: readonly EngineInstrument[];
  /** Every trade of those instruments. */
  trades: readonly EngineTrade[];
  /** Every dividend with holdingKind === kind (linked or not). */
  dividends: readonly EngineDividend[];
  /** By instrument id; absent = no price. */
  prices: ReadonlyMap<number, EnginePrice>;
  /** Default 'fifo'. */
  matching?: MatchingStrategy;
}

// ─── Outputs ────────────────────────────────────────────────────────────────────────────────────

export interface LotResult {
  tradeId: number;
  instrumentId: number;
  tradeDate: IsoDate;
  seq: number;
  units: DecimalString;
  remainingUnits: DecimalString;
  price: DecimalString;
  /** The whole buy fee (authority fee, rounded). */
  feeCents: Cents;
  /** price × remaining + fee × remaining / units. */
  remainingCostCents: Cents;
  /** Null when unpriced or remaining = 0. */
  unrealisedCents: Cents | null;
  /** unrealised / (price × units): the sheet's per-parcel % (vs original cost). */
  unrealisedRatio: DecimalString | null;
  /** asOf − tradeDate. */
  heldDays: number;
  /** §2.5. */
  termIfSoldToday: CapitalGainTerm;
}

export interface DisposalResult {
  sellTradeId: number;
  lotTradeId: number;
  instrumentId: number;
  sellDate: IsoDate;
  acquiredDate: IsoDate;
  units: DecimalString;
  /** Each rounded once from decimals. */
  proceedsCents: Cents;
  costCents: Cents;
  gainCents: Cents;
  term: CapitalGainTerm;
  /** FY start year of sellDate. */
  financialYear: number;
}

export interface TradeResult {
  tradeId: number;
  side: TradeSide;
  /** |units × price|, fee excluded (the sheet's Order Value, unsigned). */
  orderValueCents: Cents;
  /** Authority fee, rounded once. */
  feeCents: Cents;
  /** Buys (its lot). */
  remainingUnits: DecimalString | null;
  unrealisedCents: Cents | null;
  /** Sells. */
  realisedCents: Cents | null;
  realisedShortCents: Cents | null;
  realisedLongCents: Cents | null;
  /** Sells: units matched to no lot. */
  oversoldUnits: DecimalString | null;
}

export interface HoldingResult {
  instrumentId: number;
  status: HoldingStatus;
  flags: HoldingFlag[];
  /** Σ trade units (the sheet's held units). */
  netUnits: DecimalString;
  /** Σ lot remaining units (never negative). */
  openUnits: DecimalString;
  price: DecimalString | null;
  priceStatus: PriceStatus;
  /** openUnits × price; null when unpriced. */
  valueCents: Cents | null;
  /** Σ lot remainingCost. */
  costCents: Cents;
  unrealisedCents: Cents | null;
  /** Σ linked net dividends/staking, all time. */
  dividendsCents: Cents;
  /** D41: unrealised + dividends; held and priced only. */
  totalReturnCents: Cents | null;
  /** totalReturn / cost (cost > 0). */
  totalReturnRatio: DecimalString | null;
  /** Σ disposals, all time. */
  realisedCents: Cents;
  xirr: DecimalString | null;
  /** Σ(price × remaining) / openUnits, fees excluded; null when openUnits = 0. */
  averagePrice: DecimalString | null;
  /** §2.8. */
  currentRatio: DecimalString | null;
  targetRatio: DecimalString | null;
  /** current − target. */
  differenceRatio: DecimalString | null;
  /** §2.9 (crypto: staking yield). */
  dividendYieldRatio: DecimalString | null;
  /** §2.8, when mgmtFeeRatio and value exist. */
  estMgmtFeeCents: Cents | null;
  lastBuyDate: IsoDate | null;
  lastTradeDate: IsoDate | null;
}

export interface SummaryResult {
  valueCents: Cents;
  costCents: Cents;
  unrealisedCents: Cents;
  dividendsHeldCents: Cents;
  totalReturnCents: Cents;
  totalReturnRatio: DecimalString | null;
  realisedCents: Cents;
  realisedThisFyCents: Cents;
  /** D43 portfolio XIRR. */
  xirr: DecimalString | null;
  /** The sheet's "1Y Inv. Rate", whole dollars rounded up. */
  investmentRatePerMonthCents: Cents | null;
  /** By holding kind (linked or not). */
  dividendsThisFyCents: Cents;
  dividendsAllTimeCents: Cents;
  heldCount: number;
  watchingCount: number;
  exitedCount: number;
  unpricedCount: number;
  stalePriceCount: number;
  /** Σ targets of watched instruments. */
  targetSumRatio: DecimalString;
  /** Targets > 0, plus held with current > 0 and target 0/null. */
  targetCount: number;
  /** Σ holdings' estMgmtFeeCents (null when none). */
  estMgmtFeeCents: Cents | null;
  lastBuyDate: IsoDate | null;
}

export interface AllocationSliceResult {
  key: string;
  label: string;
  currentRatio: DecimalString;
  targetRatio: DecimalString;
}

export interface AllocationResult {
  /** key = String(instrumentId), label = symbol. */
  byHolding: AllocationSliceResult[];
  /** label = sector, or 'Unassigned'. */
  bySector: AllocationSliceResult[];
  /** etf and managed_fund only (§2.8). */
  byRegion: AllocationSliceResult[] | null;
}

export interface FyRealisedRow {
  financialYear: number;
  shortTermCents: Cents;
  longTermCents: Cents;
  totalCents: Cents;
  disposals: number;
}

/** §2.9, one per input dividend, input order. */
export interface DividendResult {
  dividendId: number;
  instrumentId: number | null;
  unitsAtEx: DecimalString | null;
  yieldRatio: DecimalString | null;
}

export interface InvestmentsResult {
  kind: InstrumentKind;
  asOf: IsoDate;
  holdings: HoldingResult[];
  lots: LotResult[];
  disposals: DisposalResult[];
  trades: TradeResult[];
  dividends: DividendResult[];
  summary: SummaryResult;
  allocation: AllocationResult;
  realisedByFy: FyRealisedRow[];
}

// ─── History (§2.11) ────────────────────────────────────────────────────────────────────────────

/** (after, through]. */
export interface PurchaseWindow {
  after: IsoDate | null;
  through: IsoDate;
}

export interface SeriesPoint {
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  values: Readonly<Record<string, number | null>>;
}

export interface CompressedPoint {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  values: Record<string, number | null>;
}

// ─── Timing (§2.12) ─────────────────────────────────────────────────────────────────────────────

export type TimingInput =
  SettingKey | 'budget.items' | 'snapshots' | 'investments.lastPurchaseDate';

export interface BudgetInvestInput {
  asOf: IsoDate;
  payFrequency: PayFrequency | null;
  netPayCents: Cents | null;
  includeSideIncome: boolean;
  /** Σ streams per period. */
  sideIncomePeriods: readonly { periodStart: IsoDate; periodEnd: IsoDate; amountCents: Cents }[];
  items: readonly { kind: BudgetItemKind; monthlyCents: Cents | null }[];
  yearlyExpenseAnnualCents: readonly Cents[];
  autoInvestSplit: boolean | null;
  useBudgetForInvest: boolean | null;
  cashTargetRatio: DecimalString | null;
  aggressiveness: AllocationAggressiveness | null;
  /** cash / liquid assets at the latest snapshot. */
  lastSnapshotCashShare: DecimalString | null;
  /** Fallback when there is no snapshot; both null → 0 (§2.12 step 7). */
  currentCashShare: DecimalString | null;
  /** Σ non-offset cash accounts. */
  cashCents: Cents;
  emergencyFundMonths: number | null;
  emergencyFundOverrideCents: Cents | null;
  marginalTaxRate: DecimalString | null;
  /** Last ETF or stock BUY (SheetOptions H20). */
  lastPurchaseDate: IsoDate | null;
}

export interface BudgetInvestResult {
  monthlyIncomeCents: Cents | null;
  yearlyFundCents: Cents;
  plannedSpendCents: Cents;
  leftoverCents: Cents | null;
  /** Null when both the months and the override are null. */
  emergencyFundCents: Cents | null;
  cashShareRatio: DecimalString | null;
  investShareRatio: DecimalString | null;
  investmentRowCents: Cents | null;
  cashRowCents: Cents | null;
  sideIncomeInvestCents: Cents;
  /** D40. */
  monthlyInvestCents: Cents | null;
  missing: TimingInput[];
}

export interface ParcelPlan {
  months: number;
  parcelCents: Cents;
  optimalParcelCents: Cents;
}

export type Countdown =
  | { state: 'wait'; days: number; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'invest'; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'cash_first' }
  | { state: 'unavailable'; missing: TimingInput[] }
  /** D46 (appended): nothing to invest because the budget's automatic investment split is off. */
  | { state: 'split_off' };

export interface ConsiderNextRow {
  assetClass: AssetClass;
  valueCents: Cents;
  currentRatio: DecimalString;
  targetRatio: DecimalString | null;
  deltaRatio: DecimalString | null;
}

export interface ConsiderNextResult {
  assetClass: AssetClass | null;
  reason: ConsiderReason;
  rows: ConsiderNextRow[];
}

export interface NextBuyHintResult {
  assetClass: AssetClass | null;
  instrumentId: number | null;
  parcelCents: Cents | null;
}

// ─── Function signatures (FROZEN) ───────────────────────────────────────────────────────────────

export type ComputeInvestmentsFn = (input: InvestmentsInput) => InvestmentsResult;
/** Amounts in dollars; null when there is no root (§2.7). */
export type XirrFn = (flows: readonly { amount: number; date: IsoDate }[]) => number | null;
export type RealisedByFinancialYearFn = (
  disposals: readonly DisposalResult[],
  asOf: IsoDate,
) => FyRealisedRow[];
export type ContributionsAtFn = (i: {
  kind: InstrumentKind;
  trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[];
  dates: readonly IsoDate[];
}) => Cents[];
export type NetPurchasesFn = (i: {
  trades: readonly EngineTrade[];
  windows: readonly PurchaseWindow[];
}) => Cents[];
export type PurchaseWindowsFn = (
  runDates: readonly IsoDate[],
  liveThrough: IsoDate | null,
) => PurchaseWindow[];
export type CompressSeriesFn = (
  points: readonly SeriesPoint[],
  unit: ChartDateUnit,
  count: number | null,
  modes: Readonly<Record<string, 'end' | 'sum'>>,
) => CompressedPoint[];
export type BudgetInvestmentFn = (input: BudgetInvestInput) => BudgetInvestResult;
export type ParcelOptimiserFn = (i: {
  monthlyInvestCents: Cents | null;
  brokerageCents: Cents | null;
  growthRatio: DecimalString | null;
  cashRateRatio: DecimalString | null;
}) => ParcelPlan | null;
export type InvestCountdownFn = (i: {
  asOf: IsoDate;
  monthlyInvestCents: Cents | null;
  plan: ParcelPlan | null;
  lastPurchaseDate: IsoDate | null;
  payDayOfMonth: number | null;
  growthRatio: DecimalString | null;
  /**
   * D46 (optional, appended): the budget's two switches, as passed to budgetInvestment. Nothing to
   * invest with the budget driving the amount (true) and its automatic split off (false) is
   * `split_off`, not `cash_first`. Omitted → cash first, as before.
   */
  useBudgetForInvest?: boolean | null;
  autoInvestSplit?: boolean | null;
}) => Countdown;
export type ConsiderNextFn = (i: {
  classes: Readonly<Record<AssetClass, { valueCents: Cents; targetRatio: DecimalString | null }>>;
  cashCents: Cents;
  emergencyFundCents: Cents | null;
}) => ConsiderNextResult;
export type NextBuyHintFn = (i: {
  kind: InstrumentKind;
  considerNext: ConsiderNextResult;
  holdings: readonly HoldingResult[];
  parcelCents: Cents | null;
}) => NextBuyHintResult;
/** stock→'stock', etf→'etf', managed_fund→'managed_fund', crypto→'crypto'. */
export type AssetClassOfKindFn = (kind: InstrumentKind) => AssetClass;
/** Sheets DATE(): day/month overflow rolls over. */
export type SheetDateFn = (year: number, month: number, day: number) => IsoDate;

// ─── The function set as one value (server injection, §4.5) ─────────────────────────────────────

/** One member per engine function, same signature (index.ts's `engine` satisfies it). */
export interface EngineApi {
  computeInvestments: ComputeInvestmentsFn;
  xirr: XirrFn;
  realisedByFinancialYear: RealisedByFinancialYearFn;
  contributionsAt: ContributionsAtFn;
  netPurchases: NetPurchasesFn;
  purchaseWindows: PurchaseWindowsFn;
  compressSeries: CompressSeriesFn;
  budgetInvestment: BudgetInvestmentFn;
  parcelOptimiser: ParcelOptimiserFn;
  investCountdown: InvestCountdownFn;
  considerNext: ConsiderNextFn;
  nextBuyHint: NextBuyHintFn;
  assetClassOfKind: AssetClassOfKindFn;
  sheetDate: SheetDateFn;
}
