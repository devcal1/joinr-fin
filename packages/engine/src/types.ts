// The engine's public types (stage-2.md §2.2, stage-3.md §2.2, stage-4.md §2.2 and stage-5.md §2.2,
// FROZEN). Names, fields and signatures here do not change; the engine owner adds internal modules
// freely.
// Imports: the `@joinr/schema` root only.
import type {
  AllocationAggressiveness,
  AssetClass,
  BudgetItemKind,
  CapitalGainTerm,
  CashAccountKind,
  ChartDateUnit,
  ConsiderReason,
  DecimalString,
  DividendSuggestionStatus,
  DrpAdvice,
  HoldingFlag,
  HoldingStatus,
  InstrumentKind,
  IsoDate,
  IsoMonth,
  KpiTrend,
  LoanEntryFlag,
  LoanFlag,
  Metal,
  NetWorthClass,
  NetWorthLiability,
  OtherAssetFlag,
  PayFrequency,
  PaymentFrequency,
  PriceStatus,
  SavingsPeriodStatus,
  SettingKey,
  SnapshotCheckColumn,
  SnapshotSource,
  SuperCapStatus,
  SuperContributionType,
  SuperFlag,
  TradeSide,
  YearBasis,
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
  /**
   * The cash the emergency-fund test compares (cashTotals.emergencyFundTestCents; stage-3.md §2.4,
   * §2.9 step 8). Stage 2 passed Σ non-offset cash accounts.
   */
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
  /**
   * Stage 3 (optional, appended; stage-3.md §2.13): the yearly unit groups by
   * yearWindow(date, yearBasis). Omitted → 'calendar', so every Stage 2 caller is unchanged.
   */
  yearBasis?: YearBasis,
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
  /**
   * Stage 3 (optional, appended; stage-3.md §2.12, SheetOptions H12): the cash-deficit wait.
   * periodDays = 30 × max(plan.months, cashDeficitMonths ?? 0). Omitted → the plan's months.
   */
  cashDeficitMonths?: number | null;
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

// ═══ Stage 3: cash flow and income (stage-3.md §2.2, FROZEN) ════════════════════════════════════

// ─── Cash accounts (§2.4) ───────────────────────────────────────────────────────────────────────

export interface EngineCashAccount {
  id: number;
  kind: CashAccountKind;
  isOffset: boolean;
  balanceCents: Cents;
}

export interface CashTotalsResult {
  /** Σ non-offset accounts (Cash!C13; D49 loans included). */
  totalCashCents: Cents;
  /** Non-offset subtotals. */
  byKind: Readonly<Record<CashAccountKind, Cents>>;
  /** Σ offset accounts (never in Total Cash). */
  offsetCents: Cents;
  /** = byKind.loan_receivable. */
  loansCents: Cents;
  /**
   * total − loans (the "Available cash" figure; D59: the EF test, goals, cash target and EOY goal
   * use it).
   */
  availableCashCents: Cents;
  /**
   * (loansCountForEmergencyFund ? total : available) + (offsetsIncludeEmergencyFund ? offsets : 0)
   * (D59, §11 fix 20, D56).
   */
  emergencyFundTestCents: Cents;
}

// ─── Savings engine (§2.5) ──────────────────────────────────────────────────────────────────────

/** One per snapshot (History row), any order. */
export interface SavingsSnapshotInput {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  /** History N. */
  cashValueCents: Cents | null;
  /** History R. */
  superContribCents: Cents | null;
  /** History W. */
  salaryMonthlyCents: Cents | null;
  /** History Y. */
  propertyPurchaseCents: Cents | null;
  /** History AB (≤ 0). */
  mortgageBalanceCents: Cents | null;
  /** History AD (cumulative). */
  mortgagePrincipalPaidCents: Cents | null;
  /**
   * Stage 4 (additive, stage-4.md §2.9): Σ offset accounts at the run date. Stage 4 passes it for
   * the latest snapshot only (null for every earlier one); null → no Δ offsets.
   */
  offsetCents?: Cents | null;
}

/** The provisional period's live values. */
export interface SavingsLiveInput {
  /** Total Cash now (cashTotals.totalCashCents; loans in, D59). */
  cashCents: Cents;
  /** monthlyPayCents(current pay settings) (§4.5). */
  salaryMonthlyCents: Cents | null;
  /** Voluntary contributions for months after the latest snapshot's (§4.5). */
  superContribCents: Cents;
  propertyPurchaseCents: Cents | null;
  mortgageBalanceCents: Cents | null;
  mortgagePrincipalPaidCents: Cents | null;
  /** Stage 4 (additive, §2.9): Σ offset accounts now (null when no offset account exists). */
  offsetCents?: Cents | null;
}

export interface SavingsInput {
  asOf: IsoDate;
  snapshots: readonly SavingsSnapshotInput[];
  /** Null → no provisional period. */
  live: SavingsLiveInput | null;
  /** Every trade of every kind (added investments). */
  trades: readonly EngineTrade[];
  /**
   * Other-asset flows. Stage 4 (stage-4.md §2.4 step 9, §11 fix 16): purchases positive, sales as
   * negative amounts (`computeOtherAssets(…).savingsFlows`).
   */
  otherAssetPurchases: readonly { date: IsoDate; amountCents: Cents }[];
  /** Deposits (D57). */
  sideIncome: readonly { date: IsoDate; amountCents: Cents }[];
  /** Income (§2.5 step 5). */
  dividends: readonly EngineDividend[];
  /** D51. */
  adjustments: readonly { periodMonth: IsoMonth; amountCents: Cents }[];
  /** savings.includeMortgagePrincipal (null → true). */
  includeMortgagePrincipal: boolean;
}

export interface SavingsFigures {
  incomeCents: Cents | null;
  savingsCents: Cents | null;
  savingsRatio: DecimalString | null;
  spendCents: Cents | null;
}

export interface SavingsPeriod {
  periodMonth: IsoMonth;
  /** Provisional: runDate = asOf. */
  runDate: IsoDate;
  /** The window (after, through]; the first period: after = null. */
  after: IsoDate | null;
  through: IsoDate;
  /** 'first' | 'closed' | 'provisional'. */
  status: SavingsPeriodStatus;
  cashCents: Cents | null;
  /** Cash J. */
  cashGainCents: Cents | null;
  /** Cash K. */
  cashGainRatio: DecimalString | null;
  /** Cash L (null for the first period). */
  addedInvestmentsCents: Cents | null;
  added: {
    tradesCents: Cents;
    otherAssetsCents: Cents;
    superCents: Cents;
    mortgagePrincipalCents: Cents;
    propertyDepositCents: Cents;
    /** Stage 4 (additive, §2.9, §11 fix 7): Δ offsets; 0 unless both sides are non-null. */
    offsetsCents: Cents;
  } | null;
  income: {
    salaryCents: Cents | null;
    sideIncomeCents: Cents;
    cashDividendsCents: Cents;
    otherDividendsCents: Cents;
  } | null;
  /** 0 when none. */
  adjustmentCents: Cents;
  /** As the sheet computes (Cash M, N, P). */
  raw: SavingsFigures;
  /** The app's figures (D51 + §11 fixes 12, 19). */
  adjusted: SavingsFigures;
}

export interface SavingsResult {
  /** Run-date order; the provisional period last. */
  periods: SavingsPeriod[];
}

// ─── Cash KPIs (§2.6) ───────────────────────────────────────────────────────────────────────────

export interface CashKpisInput {
  asOf: IsoDate;
  periods: readonly SavingsPeriod[];
  yearBasis: YearBasis;
  jobStartDate: IsoDate | null;
  /** Available cash now (cashTotals.availableCashCents; D59, §2.6). */
  currentCashCents: Cents;
  eoyCashGoalCents: Cents | null;
  cashSavingsTargetCents: Cents | null;
}

/** [start, end); year = the FY start year or the calendar year. */
export interface YearWindow {
  basis: YearBasis;
  start: IsoDate;
  end: IsoDate;
  year: number;
}

export interface CashKpisResult {
  /** The latest recorded snapshot's run date (Net Worth C51). */
  anchor: IsoDate | null;
  /** Containing the anchor (asOf when none). */
  year: YearWindow;
  /** C17, C18, C37. */
  lastPeriod: {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    cashGainCents: Cents | null;
    savingsCents: Cents | null;
    savingsRatio: DecimalString | null;
    rawSavingsRatio: DecimalString | null;
  } | null;
  /** The 12-month averaging window. */
  avgWindow: { from: IsoDate; periods: number } | null;
  /** C19 (closed periods only). */
  avgCashGainCents: Cents | null;
  /** Mean of (cash gain − adjustment). */
  avgCashGainAdjustedCents: Cents | null;
  avgAddedInvestmentsCents: Cents | null;
  /** C20 (adjusted). */
  avgSavingsCents: Cents | null;
  avgSavingsRawCents: Cents | null;
  /** C22 = avgCashGainAdjusted × 12 (§2.6). */
  predictedCashPerYearCents: Cents | null;
  /** C21, C42, C43. */
  yearCashGainCents: Cents;
  yearSavingsCents: Cents;
  yearAddedInvestmentsCents: Cents;
  yearIncomeCents: Cents;
  yearPeriods: number;
  /** C38 fixed: Σ savings / Σ income (adjusted). */
  yearSavingsRatio: DecimalString | null;
  yearSavingsRawRatio: DecimalString | null;
  /** C39 (closed). */
  last3SavingsRatio: DecimalString | null;
  /** C41 fixed: ratio change per month. */
  trendPerMonth: DecimalString | null;
  /** C40. */
  trend: KpiTrend | null;
  monthsToYearEnd: number | null;
  /** C24. */
  eoyProjectedCashCents: Cents | null;
  /** C27 fixed (÷ months left); positive = surplus. */
  eoyGapPerMonthCents: Cents | null;
  /** C25. */
  eoyOnTarget: boolean | null;
  /** C30–C34. */
  cashTarget: {
    targetCents: Cents;
    progressRatio: DecimalString;
    monthsToTarget: number | null;
    arrival: IsoDate | null;
    status: 'reached' | 'on_track' | 'no_savings';
  } | null;
  /** Budget M4. */
  spend6mCents: Cents | null;
  spend6mRawCents: Cents | null;
  spend6mPeriods: number;
}

// ─── Savings goals (§2.7, D55) ──────────────────────────────────────────────────────────────────

export interface SavingsGoalsInput {
  /** cashKpis.anchor ?? asOf. */
  anchor: IsoDate;
  /** Waterfall order. */
  goals: readonly { id: number; targetCents: Cents; targetDate: IsoDate | null }[];
  /** The cash base: available cash (D59; the server's rule, §4.5). */
  goalsCashCents: Cents;
  emergencyFundCents: Cents | null;
  /** Σ ETF, stock, fund and crypto values (priced). */
  investmentsValueCents: Cents;
  /** goals.houseDepositInvestmentShare (null → 0). */
  investmentShareRatio: DecimalString | null;
  avgCashGainAdjustedCents: Cents | null;
  avgAddedInvestmentsCents: Cents | null;
}

export interface SavingsGoalResult {
  id: number;
  allocatedCents: Cents;
  remainingCents: Cents;
  progressRatio: DecimalString;
  reached: boolean;
  monthsToGo: number | null;
  eta: IsoDate | null;
  onTrack: boolean | null;
  requiredPerMonthCents: Cents | null;
}

export interface SavingsGoalsResult {
  savedCents: Cents;
  monthlyProgressCents: Cents | null;
  goals: SavingsGoalResult[];
}

// ─── Side income (§2.8, D57) ────────────────────────────────────────────────────────────────────

export interface SideIncomeInput {
  asOf: IsoDate;
  snapshots: readonly { periodMonth: IsoMonth; runDate: IsoDate }[];
  deposits: readonly { id: number; streamId: number; date: IsoDate; amountCents: Cents }[];
}

export interface SideIncomePeriodResult {
  periodMonth: IsoMonth;
  /** [start, end] (inclusive dates, the sheet's E/F). */
  start: IsoDate;
  end: IsoDate;
  status: 'closed' | 'provisional';
  totalCents: Cents;
  byStream: { streamId: number; amountCents: Cents }[];
  depositIds: number[];
}

export interface SideIncomeResult {
  /** Oldest first; the provisional period last. */
  periods: SideIncomePeriodResult[];
  /** Deposits outside every period. */
  beforeFirstCents: Cents;
  afterAsOfCents: Cents;
  fy: { financialYear: number; start: IsoDate; end: IsoDate };
  /** C3 fixed. */
  avgPerPeriodThisFyCents: Cents | null;
  periodsThisFy: number;
  /** C4 fixed. */
  fyToDateCents: Cents;
  /** C5 = C3 × 12 (SheetOptions H27). */
  projectedYearCents: Cents | null;
  /** C6 fixed. */
  avg365Cents: Cents | null;
  periods365: number;
  /** C7. */
  lifetimeCents: Cents;
  byStreamLifetime: { streamId: number; amountCents: Cents }[];
}

// ─── Budget (§2.9) ──────────────────────────────────────────────────────────────────────────────

export interface BudgetRowInput {
  id: number | null;
  kind: BudgetItemKind;
  name: string | null;
  monthlyCents: Cents | null;
  category: string | null;
  accountId: number | null;
  accountName: string | null;
}

export interface BudgetInput extends Omit<BudgetInvestInput, 'items' | 'yearlyExpenseAnnualCents'> {
  /** Display order: items and the auto rows. */
  rows: readonly BudgetRowInput[];
  yearlyExpenses: readonly { id: number; name: string; annualCents: Cents }[];
}

export interface BudgetRowResult {
  id: number | null;
  kind: BudgetItemKind;
  name: string | null;
  /** Auto rows computed; a null item → 0. */
  monthlyCents: Cents;
  /** B. */
  incomeShareRatio: DecimalString | null;
  /** D, E. */
  weeklyCents: Cents;
  yearlyCents: Cents;
  category: string | null;
  accountId: number | null;
  accountName: string | null;
  savingsLine: boolean;
  /** Derived: auto rows; manual: auto_invest with the split off (D54). */
  derived: boolean;
  manual: boolean;
}

export interface BudgetTransferResult {
  accountId: number | null;
  accountName: string | null;
  perPayCents: Cents;
  monthlyCents: Cents;
  rows: number;
}

export interface BudgetResult {
  /** The shared D40 chain (B2, C24, J4, L7, D3, H41–H43, C28, C29, H2). */
  invest: BudgetInvestResult;
  /** F2. */
  annualIncomeCents: Cents | null;
  /** L9. */
  yearlySavingsCents: Cents | null;
  /** L11. */
  plannedSavingsRatio: DecimalString | null;
  /** Leftover − investment row − cash row (the $10 rounding); null without a leftover. */
  unallocatedCents: Cents | null;
  /**
   * Σ every item row (savings lines included) + yearly fund: the sheet's D3 basis (D61), so it
   * equals the planned spend.
   */
  emergencyFundBasisCents: Cents;
  rows: BudgetRowResult[];
  yearlyExpenses: { id: number; name: string; annualCents: Cents; monthlyCents: Cents }[];
  /** A35:B, first-appearance order. */
  transfers: BudgetTransferResult[];
  unassigned: { perPayCents: Cents; monthlyCents: Cents; rows: number };
  perPayTotalCents: Cents | null;
  byCategory: { category: string | null; monthlyCents: Cents }[];
  /** D54. */
  investManual: boolean;
}

// ─── Dividends (§2.10) and suggestions (§2.11) ──────────────────────────────────────────────────

export interface DividendHoldingInput {
  instrumentId: number;
  kind: InstrumentKind;
  dividendFreqMonths: number | null;
  drp: boolean | null;
  /** HoldingResult.netUnits. */
  unitsNow: DecimalString;
}

export interface DividendsInput {
  asOf: IsoDate;
  holdings: readonly DividendHoldingInput[];
  trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[];
}

export interface DividendFyRow {
  financialYear: number;
  byKind: Readonly<Record<InstrumentKind, Cents>>;
  totalCents: Cents;
}

export interface DividendMonthRow {
  month: IsoMonth;
  byKind: Readonly<Record<InstrumentKind, Cents>>;
  totalCents: Cents;
}

export interface DividendHoldingFyResult {
  instrumentId: number;
  kind: InstrumentKind;
  netThisFyCents: Cents;
  payments: number;
  frequencyMonths: number | null;
  drp: boolean | null;
  /** Dividends O. */
  yield365Ratio: DecimalString | null;
  /** Dividends N. */
  monthsToExtraUnit: number | null;
  /** Dividends R. */
  advice: DrpAdvice | null;
}

export interface DividendsResult {
  /** One per input dividend, input order (Stage 2 §2.9 rule). */
  rows: DividendResult[];
  /**
   * Newest first; asOf's FY and the 4 before it (zero rows kept), plus every older FY that has a
   * payment (§2.10).
   */
  byFinancialYear: DividendFyRow[];
  /** Oldest first; the 12 calendar months ending with asOf's month. */
  rolling12: DividendMonthRow[];
  /** Net desc, then instrumentId. */
  holdingsThisFy: DividendHoldingFyResult[];
  unlinkedThisFyCents: Cents;
  /** SheetOptions H30, H28. */
  kpis: {
    financialYear: number;
    thisFyCents: Cents;
    lastFyCents: Cents;
    allTimeCents: Cents;
    rolling12Cents: Cents;
    reinvestedThisFyCents: Cents;
    daysIntoFy: number;
    projectedFyCents: Cents | null;
  };
}

export interface DividendEventInput {
  instrumentId: number;
  exDate: IsoDate;
  amountPerUnit: DecimalString;
  currency: string;
  closeBeforeEx: DecimalString | null;
  dismissed: boolean;
}

export interface DividendSuggestionResult {
  instrumentId: number;
  exDate: IsoDate;
  amountPerUnit: DecimalString;
  unitsAtEx: DecimalString;
  estimatedNetCents: Cents;
  priceAtEx: DecimalString | null;
  yieldRatio: DecimalString | null;
  expectedPaymentDate: IsoDate;
  status: DividendSuggestionStatus;
}

// ─── Charts (§2.13) ─────────────────────────────────────────────────────────────────────────────

export interface CashflowChartPoint {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  cashCents: Cents | null;
  cashGainCents: Cents | null;
  addedInvestmentsCents: Cents | null;
  adjustmentCents: Cents;
  savingsCents: Cents | null;
  savingsRawCents: Cents | null;
  incomeCents: Cents | null;
  savingsRatio: DecimalString | null;
  savingsRawRatio: DecimalString | null;
  trendRatio: DecimalString | null;
}

// ─── Stage 3 function signatures (FROZEN) ───────────────────────────────────────────────────────

/** The server passes loansCountForEmergencyFund = false (D59, §11 fix 20, §4.5). */
export type CashTotalsFn = (i: {
  accounts: readonly EngineCashAccount[];
  offsetsIncludeEmergencyFund: boolean;
  loansCountForEmergencyFund: boolean;
}) => CashTotalsResult;
/**
 * Net pay × the template's pay-frequency factor (the same factors budgetInvestment uses); null
 * when either is null.
 */
export type MonthlyPayCentsFn = (i: {
  netPayCents: Cents | null;
  payFrequency: PayFrequency | null;
}) => Cents | null;
export type ComputeSavingsFn = (input: SavingsInput) => SavingsResult;
export type CashKpisFn = (input: CashKpisInput) => CashKpisResult;
export type SavingsGoalsFn = (input: SavingsGoalsInput) => SavingsGoalsResult;
export type ComputeSideIncomeFn = (input: SideIncomeInput) => SideIncomeResult;
export type ComputeBudgetFn = (input: BudgetInput) => BudgetResult;
/** The timing chain's exact input. */
export type BudgetInvestInputOfFn = (input: BudgetInput) => BudgetInvestInput;
export type ComputeDividendsFn = (input: DividendsInput) => DividendsResult;
export type DividendSuggestionsFn = (i: {
  asOf: IsoDate;
  events: readonly DividendEventInput[];
  trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[];
}) => DividendSuggestionResult[];
export type CashDeficitMonthsFn = (i: {
  cashCents: Cents;
  liquidTotalCents: Cents;
  targetRatio: DecimalString | null;
  avgMonthlySavingsCents: Cents | null;
}) => number | null;
export type CompressCashflowFn = (i: {
  periods: readonly SavingsPeriod[];
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
}) => CashflowChartPoint[];
export type YearWindowFn = (date: IsoDate, basis: YearBasis) => YearWindow;

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
  // Stage 3 (stage-3.md §2.2).
  cashTotals: CashTotalsFn;
  monthlyPayCents: MonthlyPayCentsFn;
  computeSavings: ComputeSavingsFn;
  cashKpis: CashKpisFn;
  savingsGoals: SavingsGoalsFn;
  computeSideIncome: ComputeSideIncomeFn;
  computeBudget: ComputeBudgetFn;
  budgetInvestInputOf: BudgetInvestInputOfFn;
  computeDividends: ComputeDividendsFn;
  dividendSuggestions: DividendSuggestionsFn;
  cashDeficitMonths: CashDeficitMonthsFn;
  compressCashflow: CompressCashflowFn;
  yearWindow: YearWindowFn;
  // Stage 4 (stage-4.md §2.2).
  computeOtherAssets: ComputeOtherAssetsFn;
  otherAssetsCostHeldAt: OtherAssetsCostHeldAtFn;
  computeSuper: ComputeSuperFn;
  computeProperty: ComputePropertyFn;
  amortise: AmortiseFn;
  assetsSnapshotColumns: AssetsSnapshotColumnsFn;
  // Stage 5 (stage-5.md §2.2).
  composeSnapshot: ComposeSnapshotFn;
  deriveSnapshotColumns: DeriveSnapshotColumnsFn;
  checkSnapshots: CheckSnapshotsFn;
  netWorthOf: NetWorthOfFn;
  netWorthDashboard: NetWorthDashboardFn;
  rollingNetWorth: RollingNetWorthFn;
  aggregateSnapshots: AggregateSnapshotsFn;
  linearTrend: LinearTrendFn;
  nextRecordMonth: NextRecordMonthFn;
  recordableMonths: RecordableMonthsFn;
  recordingsDue: RecordingsDueFn;
  suggestMarginalRate: SuggestMarginalRateFn;
}

// ═══ Stage 4: other assets, super and property (stage-4.md §2.2, FROZEN) ════════════════════════

// ─── Other assets (§2.4) ────────────────────────────────────────────────────────────────────────

export interface EngineOtherAssetSale {
  id: number;
  saleDate: IsoDate;
  units: DecimalString;
  proceedsCents: Cents;
}

export type EngineOtherAssetPricing =
  | {
      source: 'manual';
      /** The latest price entry, in the asset's currency. */
      unitPrice: DecimalString | null;
      priceAsOf: IsoDate | null;
    }
  | {
      source: 'bullion';
      metal: Metal;
      ozPerUnit: DecimalString;
      /** XAG/XAU_AUD_OZ (§4.5); null = no value. */
      spot: { audPerOz: DecimalString; asOf: IsoDate; fresh: boolean } | null;
      /** The row's last known AUD unit price (the import's cached price). */
      fallbackUnitPrice: DecimalString | null;
      fallbackAsOf: IsoDate | null;
    };

export interface EngineOtherAsset {
  id: number;
  /** Null → the D73 assumed date. */
  purchaseDate: IsoDate | null;
  /** Bought (template H). */
  units: DecimalString;
  /** The workbook's sold units (L): no proceeds known. */
  legacySoldUnits: DecimalString;
  /** Per unit, in `currency` (J). */
  unitCost: DecimalString | null;
  /** 'AUD', an ISO 4217 code, or 'GBX' (UK pence). */
  currency: string;
  /** AUD per 1 unit of `currency` at purchase; ignored for AUD. */
  purchaseFxRate: DecimalString | null;
  pricing: EngineOtherAssetPricing;
  sales: readonly EngineOtherAssetSale[];
}

export interface OtherAssetsInput {
  asOf: IsoDate;
  /** Display order. */
  assets: readonly EngineOtherAsset[];
  /** Live AUD per 1 unit by currency code ('GBX' = GBP ÷ 100); AUD implicit. */
  fxRates: Readonly<Record<string, DecimalString>>;
  /** D73: the first snapshot's run date; null without snapshots. */
  assumedDate: IsoDate | null;
  /** otherAssets.stalePriceDays ?? 90 (whole days ≥ 1). */
  stalePriceDays: number;
  /** History AJ, AK (chart history). */
  snapshots: readonly {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    otherValueCents: Cents | null;
    otherGainCents: Cents | null;
  }[];
  chart: { unit: ChartDateUnit; count: number | null };
}

/** The cost of the units sold (at purchase FX); realised = proceeds − cost. */
export interface OtherAssetSaleResult {
  id: number;
  saleDate: IsoDate;
  units: DecimalString;
  proceedsCents: Cents;
  costCents: Cents | null;
  realisedCents: Cents | null;
}

export interface OtherAssetResult {
  id: number;
  /** M = units − legacy sold − Σ sales (never below 0; 'oversold'). */
  remainingUnits: DecimalString;
  /** N = remaining × unit cost × purchase FX. */
  costCents: Cents | null;
  /** Today's AUD price per unit. */
  unitPriceAud: DecimalString | null;
  /** O = remaining × unitPriceAud. */
  valueCents: Cents | null;
  /** P = value − cost (both rounded: the row adds up). */
  gainCents: Cents | null;
  /** Q = unrounded gain ÷ unrounded cost. */
  gainRatio: DecimalString | null;
  /** R fixed: (value ÷ cost)^(365.25 ÷ heldDays) − 1. */
  cagrRatio: DecimalString | null;
  /** purchaseDate ?? assumedDate. */
  effectiveDate: IsoDate | null;
  /** D73. */
  dateAssumed: boolean;
  /** asOf − effectiveDate. */
  heldDays: number | null;
  /** §2.4 table. */
  priceStatus: PriceStatus;
  priceAsOf: IsoDate | null;
  /** Sale date order. */
  sales: OtherAssetSaleResult[];
  /** Σ non-null realised. */
  realisedCents: Cents;
  flags: OtherAssetFlag[];
}

export interface OtherAssetsChartPoint {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  costCents: Cents | null;
  valueCents: Cents | null;
  gainCents: Cents | null;
  gainRatio: DecimalString | null;
}

export interface OtherAssetsResult {
  /** Input order. */
  assets: OtherAssetResult[];
  totals: {
    /** D3 = Σ row values. */
    valueCents: Cents;
    /** Over rows with both a value and a cost; D4 = Σ gains. */
    costCents: Cents;
    gainCents: Cents;
    /** D5 = Σ unrounded gains ÷ Σ unrounded costs (those rows). */
    gainRatio: DecimalString | null;
    realisedCents: Cents;
    proceedsCents: Cents;
    unpricedCount: number;
    staleCount: number;
    assumedDateCount: number;
    /** Flag purchase_fx_missing (the cost is unknown). */
    fxMissingCount: number;
    /** Flag live_fx_missing (the value is unknown). */
    liveFxMissingCount: number;
  };
  /** Date, asset, id order. */
  savingsFlows: { assetId: number; date: IsoDate; amountCents: Cents; kind: 'purchase' | 'sale' }[];
  chart: OtherAssetsChartPoint[];
  /** History AJ, AK (= totals). */
  snapshot: { otherValueCents: Cents; otherGainCents: Cents };
}

// ─── Super (§2.5) ───────────────────────────────────────────────────────────────────────────────

export interface EngineSuperFund {
  id: number;
  receivesSg: boolean;
  archived: boolean;
  balances: readonly {
    id: number;
    asOf: IsoDate;
    balanceCents: Cents;
    /** Money moved in from outside the tracked funds (not a gain). */
    transferInCents: Cents | null;
  }[];
}

export interface EngineSuperContribution {
  id: number;
  fundId: number | null;
  date: IsoDate;
  kind: 'voluntary_contribution' | 'salary_sacrifice' | 'after_tax';
  amountCents: Cents;
}

export interface SuperInput {
  asOf: IsoDate;
  /** History Q. */
  snapshots: readonly {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    superValueCents: Cents | null;
    /** Stage 5 (D88a): the month's measured balance date (null/absent → runDate). */
    measuredThrough?: IsoDate | null;
  }[];
  funds: readonly EngineSuperFund[];
  /** Member contributions (never SG). */
  contributions: readonly EngineSuperContribution[];
  /** Statement figures (before contributions tax). */
  sgOverrides: readonly { periodMonth: IsoMonth; grossCents: Cents }[];
  /** pay.grossAnnualSalaryCents. */
  grossAnnualSalaryCents: Cents | null;
  /** pay.jobStartDate. */
  jobStartDate: IsoDate | null;
  /**
   * super.sgRate: your employer's rate for every month; null → SUPER_SG_RATES for each month's FY
   * (§3.2).
   */
  sgRatio: DecimalString | null;
  /** super.contributionsTaxRate ?? SUPER_CONTRIBUTIONS_TAX_DEFAULT. */
  contributionsTaxRatio: DecimalString;
  /** tax.marginalRate. */
  marginalTaxRatio: DecimalString | null;
  /** super.importedContributionType ?? 'salary_sacrifice'. */
  importedContributionType: SuperContributionType;
  /** super.concessionalCapCents + …CapFy (§3.3). */
  concessionalCapOverride: { cents: Cents; financialYear: number } | null;
  chart: { unit: ChartDateUnit; count: number | null };
}

export interface SuperContributionResult {
  id: number;
  fundId: number | null;
  date: IsoDate;
  kind: EngineSuperContribution['kind'];
  amountCents: Cents;
  /** An imported (untyped) entry read through importedContributionType. */
  estimate: boolean;
  /** The concessional amount (salary sacrifice, typed or read). */
  preTaxCents: Cents | null;
  /** After contributions tax where it applies. */
  fundReceivesCents: Cents;
  /** What it cost in take-home pay (the savings rate); null: §2.5. */
  netPayCostCents: Cents | null;
  concessional: boolean;
}

export interface SuperSgMonth {
  /** The month the SG was earned (as on a payslip). */
  month: IsoMonth;
  source: 'statement' | 'estimate' | 'none';
  grossCents: Cents;
  fundReceivesCents: Cents;
  fundId: number | null;
  /** The FY whose cap counts it (§2.5 step 7). */
  capFinancialYear: number;
}

export interface SuperFlows {
  sgGrossCents: Cents;
  sgFundCents: Cents;
  memberFundCents: Cents;
  memberNetPayCents: Cents;
  concessionalCents: Cents;
  nonConcessionalCents: Cents;
  /** Σ balance entries' transfers in (not gains). */
  transferInCents: Cents;
}

export interface SuperPeriod {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  /** The Stage 3 windows (§2.3). */
  after: IsoDate | null;
  through: IsoDate;
  /** 'first' | 'closed' | 'provisional'. */
  status: SavingsPeriodStatus;
  /** Q (provisional: Σ latest fund balances). */
  valueCents: Cents | null;
  /** Not a valuation point: its flows move to the next period. */
  notUpdated: boolean;
  /** The window's flows (null for the baseline). */
  flows: SuperFlows | null;
  /** The previous valuation point (start of the merged window). */
  gainFrom: IsoDate | null;
  /** Value − the value at gainFrom (valuation periods). */
  changeCents: Cents | null;
  /**
   * The flows over (gainFrom, through] (= flows when a closed period is not merged). The provisional
   * period counts SG and contributions only to the oldest latest balance of the open funds (D79).
   */
  gainFlows: SuperFlows | null;
  /** D69: change − gainFlows' sgFund, memberFund, transferIn. */
  gainCents: Cents | null;
  /** History T = gain ÷ (value − gain). */
  gainRatio: DecimalString | null;
  /** Modified Dietz for the merged window. */
  returnRatio: DecimalString | null;
}

export interface SuperFundResult {
  id: number;
  receivesSg: boolean;
  archived: boolean;
  balanceCents: Cents | null;
  balanceAsOf: IsoDate | null;
  /** asOf order. */
  entries: {
    id: number;
    asOf: IsoDate;
    balanceCents: Cents;
    transferInCents: Cents | null;
    flowsCents: Cents | null;
    gainCents: Cents | null;
  }[];
}

export interface SuperCapYear {
  /** [start, end), the FY start year. */
  financialYear: number;
  start: IsoDate;
  end: IsoDate;
  /** asOf ≥ end. */
  complete: boolean;
  capCents: Cents;
  capSource: 'statutory' | 'setting';
  /** SG counted in this FY so far (§2.5 step 7). */
  sgGrossCents: Cents;
  sgFundCents: Cents;
  sgSource: 'estimate' | 'statement' | 'mixed' | 'none';
  salarySacrificeCents: Cents;
  importedEstimateCents: Cents;
  totalCents: Cents;
  projectedCents: Cents;
  ratio: DecimalString;
  projectedRatio: DecimalString;
  status: SuperCapStatus;
  nonConcessionalCents: Cents;
  /** Σ pre-tax salary sacrifice (typed or read) + after-tax amounts. */
  memberCents: Cents;
  /** What the fund receives; the take-home cost (nulls count 0). */
  memberFundCents: Cents;
  memberNetPayCents: Cents;
  /** Untyped (imported) contributions dated in the FY. */
  estimateCount: number;
}

export interface SuperChartPoint {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  valueCents: Cents | null;
  gainCents: Cents | null;
  returnRatio: DecimalString | null;
  memberNetPayCents: Cents | null;
  memberFundCents: Cents | null;
  sgFundCents: Cents | null;
}

export interface SuperResult {
  /** Super!B12: Σ non-archived funds' latest balances ≤ asOf. */
  totalCents: Cents;
  funds: SuperFundResult[];
  /** Date desc, then id desc. */
  contributions: SuperContributionResult[];
  /** Every month the previous or the current FY's cap counts, up to asOf's. */
  sgMonths: SuperSgMonth[];
  /** Run-date order; the provisional last. */
  periods: SuperPeriod[];
  annualised: {
    cumulativeRatio: DecimalString | null;
    returnRatio: DecimalString | null;
    from: IsoDate | null;
    through: IsoDate | null;
    days: number | null;
  };
  /** [asOf's FY, the FY before]. */
  capYears: SuperCapYear[];
  chart: SuperChartPoint[];
  snapshot: {
    /** History Q, R. */
    superValueCents: Cents;
    superContribCents: Cents;
    /** History S, T (provisional). */
    superGainCents: Cents | null;
    superGainRatio: DecimalString | null;
  };
  flags: SuperFlag[];
  /**
   * Stage 5 (D88a): the provisional period's D79 cut-off (null: no provisional period, or no open
   * fund has a balance by asOf).
   */
  measuredThrough?: IsoDate | null;
}

// ─── Property and loans (§2.6, §2.7) ────────────────────────────────────────────────────────────

export interface EngineProperty {
  id: number;
  purchaseDate: IsoDate | null;
  isPrimaryResidence: boolean;
  purchaseValueCents: Cents;
  netRentToDateCents: Cents;
  valuations: readonly { id: number; asOf: IsoDate; valueCents: Cents }[];
}

/** repaymentsCents: typed or null. */
export interface EngineLoanEntry {
  id: number;
  asOf: IsoDate;
  balanceCents: Cents;
  repaymentsCents: Cents | null;
}

export interface EngineLoan {
  id: number;
  propertyId: number | null;
  /** Both set and before the first entry → the log's start point (§2.6). */
  startDate: IsoDate | null;
  startBalanceCents: Cents | null;
  annualRate: DecimalString | null;
  compoundingPerYear: number | null;
  paymentCents: Cents | null;
  paymentFrequency: PaymentFrequency;
  entries: readonly EngineLoanEntry[];
  /** Linked offset accounts' current balances (D67). */
  offsets: readonly { accountId: number; balanceCents: Cents }[];
}

export interface PropertyInput {
  asOf: IsoDate;
  properties: readonly EngineProperty[];
  loans: readonly EngineLoan[];
  /** History X, Y, AB, AC, AD. */
  snapshots: readonly {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    propertyValueCents: Cents | null;
    propertyPurchaseCents: Cents | null;
    mortgageBalanceCents: Cents | null;
    mortgageInterestFeesCents: Cents | null;
    mortgagePrincipalPaidCents: Cents | null;
  }[];
  chart: { unit: ChartDateUnit; count: number | null };
}

export interface AmortisationInput {
  balanceCents: Cents;
  annualRate: DecimalString;
  compoundingPerYear: number;
  paymentCents: Cents;
  paymentFrequency: PaymentFrequency;
  offsetCents: Cents;
  /** The payment grid's anchor (§2.3). */
  anchorDate: IsoDate;
  /** The balance's date: the first payment is the first grid date after it. */
  balanceDate: IsoDate;
}

export interface AmortisationResult {
  /** (1 + r/m)^(m/p) − 1. */
  periodicRatio: DecimalString;
  /** The first grid date after balanceDate. */
  firstPaymentDate: IsoDate;
  /** max(0, balance − offset) × periodic ratio. */
  firstPeriodInterestCents: Cents;
  payments: number | null;
  payoffDate: IsoDate | null;
  totalInterestCents: Cents | null;
  /** Yearly, cumulative interest. */
  points: { date: IsoDate; balanceCents: Cents; interestCents: Cents }[];
  flag: 'payment_below_interest' | 'never_repaid' | null;
}

export interface LoanEntryResult {
  /** Null = the loan's start point (its start fields). */
  id: number | null;
  start: boolean;
  asOf: IsoDate;
  balanceCents: Cents;
  paymentsCounted: number | null;
  repaymentsCents: Cents | null;
  repaymentsTyped: boolean;
  principalCents: Cents | null;
  interestFeesCents: Cents | null;
  cumulativePrincipalCents: Cents | null;
  cumulativeInterestFeesCents: Cents;
  flags: LoanEntryFlag[];
}

export interface LoanResult {
  id: number;
  propertyId: number | null;
  /** The latest entry ≤ asOf. */
  balanceCents: Cents;
  balanceAsOf: IsoDate;
  /** startBalance ?? the first entry's balance. */
  startBalanceCents: Cents;
  /** startDate ?? the first entry's date (§2.3). */
  paymentAnchorDate: IsoDate;
  offsetCents: Cents;
  /** max(0, b − o), max(0, o − b). */
  netBalanceCents: Cents;
  excessOffsetCents: Cents;
  /** asOf order. */
  entries: LoanEntryResult[];
  /** Cumulative (D66). */
  repaymentsCents: Cents;
  principalPaidCents: Cents;
  interestFeesCents: Cents;
  nextPeriodInterestCents: Cents | null;
  /** With the linked offsets. */
  schedule: AmortisationResult | null;
  /** Only when offsetCents > 0. */
  scheduleWithoutOffset: AmortisationResult | null;
  interestSavedCents: Cents | null;
  monthsSaved: number | null;
  flags: LoanFlag[];
}

export interface PropertyResultRow {
  id: number;
  isPrimaryResidence: boolean;
  /** The latest valuation ≤ asOf. */
  valueCents: Cents;
  valuationDate: IsoDate;
  purchaseValueCents: Cents;
  netRentCents: Cents;
  /** X21, X22. */
  gainCents: Cents;
  gainRatio: DecimalString | null;
  /** X23 fixed. */
  cagrRatio: DecimalString | null;
  heldDays: number | null;
  loanIds: number[];
  /** Net of linked offsets (D67). */
  debtCents: Cents;
  equityCents: Cents;
  lvrRatio: DecimalString | null;
}

export interface PropertyChartPoint {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  valueCents: Cents | null;
  purchaseCents: Cents | null;
  mortgageCents: Cents | null;
  equityCents: Cents | null;
  lvrRatio: DecimalString | null;
  interestFeesCents: Cents | null;
  principalPaidCents: Cents | null;
}

export interface PropertiesResult {
  /** Input order. */
  properties: PropertyResultRow[];
  /** Every loan; totals count those with a property. */
  loans: LoanResult[];
  totals: {
    /** F6, F7, F8, F9. */
    purchaseCents: Cents;
    valueCents: Cents;
    gainCents: Cents;
    gainRatio: DecimalString | null;
    /** |F10| gross, net. */
    mortgageCents: Cents;
    offsetCents: Cents;
    netMortgageCents: Cents;
    /** F11 (D66), AC, … */
    principalPaidCents: Cents;
    interestFeesCents: Cents;
    repaymentsCents: Cents;
    /** Net Worth C21. */
    startBalanceCents: Cents;
    /** F12 fixed, Z net. */
    lvrRatio: DecimalString | null;
    equityCents: Cents;
  };
  chart: PropertyChartPoint[];
  /** X, Y, Z, AA, AB, AC, AD, AE. */
  snapshot: {
    propertyValueCents: Cents;
    propertyPurchaseCents: Cents;
    propertyEquityCents: Cents;
    propertyGainCents: Cents;
    mortgageBalanceCents: Cents;
    mortgageInterestFeesCents: Cents;
    mortgagePrincipalPaidCents: Cents;
    propertyGainRatio: DecimalString;
    mortgageOffsetCents: Cents;
  };
  /** The Stage 3 SavingsLiveInput parts (§2.8). */
  savingsLive: {
    propertyPurchaseCents: Cents | null;
    mortgageBalanceCents: Cents | null;
    mortgagePrincipalPaidCents: Cents | null;
  };
}

// ─── The Stage 5 seam (§2.8) ────────────────────────────────────────────────────────────────────

export interface AssetsSnapshotColumns {
  superValueCents: Cents;
  superContribCents: Cents;
  superGainCents: Cents | null;
  superGainRatio: DecimalString | null;
  propertyValueCents: Cents;
  propertyPurchaseCents: Cents;
  propertyEquityCents: Cents;
  propertyGainCents: Cents;
  mortgageBalanceCents: Cents;
  mortgageInterestFeesCents: Cents;
  mortgagePrincipalPaidCents: Cents;
  propertyGainRatio: DecimalString;
  otherValueCents: Cents;
  otherGainCents: Cents;
  /** No History column yet: Stage 5 decides how to store it. */
  mortgageOffsetCents: Cents;
}

// ─── Stage 4 function signatures (FROZEN) ───────────────────────────────────────────────────────

export type ComputeOtherAssetsFn = (input: OtherAssetsInput) => OtherAssetsResult;
/** The chart's cost line (the sheet's Z, fixed), one per date. */
export type OtherAssetsCostHeldAtFn = (i: {
  assets: readonly EngineOtherAsset[];
  assumedDate: IsoDate | null;
  dates: readonly IsoDate[];
}) => Cents[];
export type ComputeSuperFn = (input: SuperInput) => SuperResult;
export type ComputePropertyFn = (input: PropertyInput) => PropertiesResult;
export type AmortiseFn = (input: AmortisationInput) => AmortisationResult;
export type AssetsSnapshotColumnsFn = (i: {
  otherAssets: OtherAssetsResult;
  super: SuperResult;
  property: PropertiesResult;
}) => AssetsSnapshotColumns;

// ═══ Stage 5: history, net worth and settings (stage-5.md §2.2, FROZEN) ═════════════════════════
// Stage 3–4 types changed additively: SuperInput.snapshots[].measuredThrough and
// SuperResult.measuredThrough (D88a, above). SavingsSnapshotInput.offsetCents keeps its type; the
// server now passes stored figures (§4.5).

// ─── Snapshot figures (§2.3): one History row plus the Stage 5 extras; camelCase of the table ───

export interface SnapshotFigures {
  /** B, C, D, E. */
  stocksValueCents: Cents | null;
  stocksGainCents: Cents | null;
  stocksGainRatio: DecimalString | null;
  stocksMovementsCents: Cents | null;
  /** F, G, H, I. */
  etfValueCents: Cents | null;
  etfGainCents: Cents | null;
  etfGainRatio: DecimalString | null;
  etfMovementsCents: Cents | null;
  /** J, K, L, M. */
  cryptoValueCents: Cents | null;
  cryptoGainCents: Cents | null;
  cryptoGainRatio: DecimalString | null;
  cryptoMovementsCents: Cents | null;
  /** N, O, P. */
  cashValueCents: Cents | null;
  cashGainCents: Cents | null;
  cashIncreaseRatio: DecimalString | null;
  /** Q, R, S, T. */
  superValueCents: Cents | null;
  superContribCents: Cents | null;
  superGainCents: Cents | null;
  superGainRatio: DecimalString | null;
  /** U, V (0 when recorded: D2). */
  liabilitiesBalanceCents: Cents | null;
  liabilitiesPaidCents: Cents | null;
  /** W. */
  salaryMonthlyCents: Cents | null;
  /** X … AE. */
  propertyValueCents: Cents | null;
  propertyPurchaseCents: Cents | null;
  propertyEquityCents: Cents | null;
  propertyGainCents: Cents | null;
  mortgageBalanceCents: Cents | null;
  mortgageInterestFeesCents: Cents | null;
  mortgagePrincipalPaidCents: Cents | null;
  propertyGainRatio: DecimalString | null;
  /** AF, AG, AH, AI. */
  mfValueCents: Cents | null;
  mfGainCents: Cents | null;
  mfGainRatio: DecimalString | null;
  mfMovementsCents: Cents | null;
  /** AJ, AK. */
  otherValueCents: Cents | null;
  otherGainCents: Cents | null;
  // Stage 5 extras (migration 0005; null on migrated rows, §3.1).
  /** D88b: Σ every offset account at the run date (cashTotals.offsetCents). */
  offsetCents: Cents | null;
  /** The offsets linked to property loans (already inside propertyEquityCents). */
  mortgageOffsetCents: Cents | null;
  /** Σ non-offset accounts with a negative balance (≤ 0; already inside cashValueCents). */
  cashDebtCents: Cents | null;
  /** D88a: the D79 cut-off when the month was recorded. */
  superMeasuredThrough: IsoDate | null;
}

export interface EngineSnapshot extends SnapshotFigures {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  /** 'migrated' | 'recorded' | 'lookback' | 'late'. */
  source: SnapshotSource;
}

// ─── The composer (§2.4) ────────────────────────────────────────────────────────────────────────

export interface ComposeSnapshotInput {
  periodMonth: IsoMonth;
  /** The date the results below were computed at (asOf). */
  runDate: IsoDate;
  /** The latest snapshot before this one (run-date order). */
  previous: { runDate: IsoDate; cashValueCents: Cents | null } | null;
  investments: Readonly<Record<InstrumentKind, InvestmentsResult>>;
  /** Every trade of the kind (movements). */
  trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>>;
  cash: CashTotalsResult;
  cashAccounts: readonly EngineCashAccount[];
  /** monthlyPayCents(the current pay settings). */
  salaryMonthlyCents: Cents | null;
  /** The Stage 4 seam at runDate. */
  assets: AssetsSnapshotColumns;
  /** SuperResult.measuredThrough at runDate. */
  superMeasuredThrough: IsoDate | null;
}

// ─── Checks (§2.5) ──────────────────────────────────────────────────────────────────────────────

export interface DerivedSnapshotColumns {
  stocksGainRatio: DecimalString;
  etfGainRatio: DecimalString;
  cryptoGainRatio: DecimalString;
  cashGainCents: Cents | null;
  cashIncreaseRatio: DecimalString;
  superGainRatio: DecimalString;
  propertyEquityCents: Cents | null;
  propertyGainRatio: DecimalString;
  mfGainRatio: DecimalString;
}

export interface SnapshotDifference {
  /** §3.2: the 9 derived + the 4 movement columns. */
  column: SnapshotCheckColumn;
  kind: 'derived' | 'movement';
  /** Money columns. */
  storedCents: Cents | null;
  recomputedCents: Cents | null;
  /** Ratio columns. */
  storedRatio: DecimalString | null;
  recomputedRatio: DecimalString | null;
}

export interface SnapshotCheckResult {
  /** Cells. */
  checked: number;
  matched: number;
  /** Run-date order, every snapshot. */
  rows: {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    source: SnapshotSource;
    checked: number;
    differences: SnapshotDifference[];
  }[];
}

// ─── Net worth (§2.6) ───────────────────────────────────────────────────────────────────────────

export interface NetWorthBreakdown {
  /** Net Worth L / D16: B + F + J + N + AF + AJ (cash net of accounts in debit). */
  liquidCents: Cents;
  /** Q. */
  superCents: Cents;
  /** X (gross value). */
  propertyCents: Cents;
  /** −|U| − |AB| (≤ 0; the gross mortgage, as the sheet's N). */
  liabilitiesCents: Cents;
  /** offsetCents ?? 0: every offset account (§2.6: linked ones net the mortgage). */
  offsetsCents: Cents;
  /** liquid + super + property + liabilities + offsets (the sheet's P + offsets). */
  netWorthCents: Cents;
  /** The value columns that were null and counted 0. */
  missing: (keyof SnapshotFigures)[];
}

/** gain % = gain ÷ (value − gain); null when undefined. */
export interface NetWorthClassRow {
  key: NetWorthClass;
  valueCents: Cents;
  gainCents: Cents | null;
  gainRatio: DecimalString | null;
}

export interface NetWorthLiabilityRow {
  key: NetWorthLiability;
  /** ≥ 0, the amount owed. */
  balanceCents: Cents;
  /**
   * Mortgages: gross |AB| and the linked offsets applied (§2.6 step 3); cash_debit and
   * other_debts: offset 0.
   */
  grossCents: Cents;
  offsetCents: Cents;
}

/** live − base; ratio = cents ÷ |base| (null when base is 0). */
export interface NetWorthChange {
  base: { periodMonth: IsoMonth; runDate: IsoDate; netWorthCents: Cents } | null;
  cents: Cents | null;
  ratio: DecimalString | null;
}

export interface DistributionSlice {
  key: NetWorthClass;
  valueCents: Cents;
  ratio: DecimalString;
}

export interface NetWorthDashboardInput {
  asOf: IsoDate;
  /** composeSnapshot at asOf. */
  live: SnapshotFigures;
  /** The provisional period's month (nextRecordMonth). */
  liveMonth: IsoMonth;
  snapshots: readonly EngineSnapshot[];
  /** Display only (the per-loan lines); every figure comes from `live` (§2.6). */
  property: PropertiesResult;
  cashAccounts: readonly EngineCashAccount[];
  /** The year savings rate (D52 basis) and the averages. */
  kpis: CashKpisResult;
  /** BudgetResult.plannedSavingsRatio (the gauge's target tick). */
  plannedSavingsRatio: DecimalString | null;
  /** The liquid allocation (Net Worth B36:E45). */
  considerNext: ConsiderNextResult;
}

export interface NetWorthDashboardResult {
  /** Of `live`. */
  breakdown: NetWorthBreakdown;
  /** assets − liabilities = breakdown.netWorthCents. */
  assetsCents: Cents;
  liabilitiesCents: Cents;
  /** NET_WORTH_CLASSES order, every class (0 kept). */
  classes: NetWorthClassRow[];
  /** NET_WORTH_LIABILITIES order, every kind (0 kept). */
  liabilities: NetWorthLiabilityRow[];
  /** C13 (assets − super). */
  assetsExSuperCents: Cents;
  /** Base: the latest snapshot with runDate < asOf (§2.6 step 4). */
  sinceLastRecord: NetWorthChange;
  /** Base: the latest snapshot whose periodMonth ends before year.start. */
  thisYear: NetWorthChange & { year: YearWindow };
  distribution: {
    /**
     * Every class's net value before the drop (NET_WORTH_STACK_ORDER, 0 and negatives kept; the
     * table view).
     */
    values: { key: NetWorthClass; valueCents: Cents }[];
    /** Every net value > 0 (up to 8, no fold; D93), in NET_WORTH_STACK_ORDER (§2.6 step 6). */
    slices: DistributionSlice[];
    /** Net values < 0 (not drawable). */
    excluded: { key: NetWorthClass; valueCents: Cents }[];
    /** Σ slices (the donut's centre, §5). */
    drawnCents: Cents;
  };
  /** cashKpis.yearSavingsRatio (D83, D52, D61). */
  savingsRate: {
    ratio: DecimalString | null;
    rawRatio: DecimalString | null;
    year: YearWindow;
    periods: number;
    targetRatio: DecimalString | null;
  };
  /** I1 fixed (§11 fix 7). */
  averageSavings: { monthCents: Cents | null; yearCents: Cents | null; periods: number };
  /** Passed through (the web shows it with the targets). */
  allocation: ConsiderNextResult;
}

export interface RollingNetWorthRow {
  periodMonth: IsoMonth;
  /** Projected rows: null. */
  runDate: IsoDate | null;
  status: 'recorded' | 'live' | 'projected';
  /** Recorded rows only. */
  source: SnapshotSource | null;
  /** Projected rows: null. */
  breakdown: NetWorthBreakdown | null;
  /** Q, R (vs the previous row). */
  growthCents: Cents | null;
  liquidGrowthCents: Cents | null;
  /** S: the savings period's adjusted / raw ratio. */
  savingsRatio: DecimalString | null;
  rawSavingsRatio: DecimalString | null;
  /** T: liquid while data exists, then the projection. */
  projectedLiquidCents: Cents | null;
}

export interface RollingNetWorthInput {
  snapshots: readonly EngineSnapshot[];
  live: { periodMonth: IsoMonth; runDate: IsoDate; figures: SnapshotFigures } | null;
  /** computeSavings(...).periods (matched by periodMonth). */
  savings: readonly SavingsPeriod[];
  /** Avg monthly savings (adjusted) and the horizon. */
  projection: { monthlyCents: Cents | null; months: number };
}

// ─── Aggregation (§2.7) ─────────────────────────────────────────────────────────────────────────

export interface SnapshotSeriesRow {
  periodMonth: IsoMonth;
  runDate: IsoDate;
  live: boolean;
  figures: SnapshotFigures;
}

export interface SnapshotGroup {
  label: string;
  period: IsoMonth;
  date: IsoDate;
  live: boolean;
  rows: number;
  /** Per SNAPSHOT_COLUMN_MODES; ratios recomputed from the group's cents. */
  figures: SnapshotFigures;
  /** Of `figures` (the group's last row). */
  netWorth: NetWorthBreakdown;
  /** Σ over the group's rows (vs each row's previous row). */
  growthCents: Cents | null;
  liquidGrowthCents: Cents | null;
}

// ─── Trend (§2.8) ───────────────────────────────────────────────────────────────────────────────

export interface TrendResult {
  /** One per input point (null where the input is null). */
  fittedCents: (Cents | null)[];
  /** Slope per day × 365.25 ÷ 12. */
  slopePerMonthCents: Cents | null;
  /** Non-null points used. */
  points: number;
}

// ─── Recording rules (§2.9) ─────────────────────────────────────────────────────────────────────

export interface RecordingDue {
  periodMonth: IsoMonth;
  source: 'recorded' | 'late';
}

export interface RecordingPlan {
  /** Ascending. */
  due: RecordingDue[];
  /**
   * The current month is due by the clock but an earlier recordable month is missing and not due
   * (§2.9; D94).
   */
  blocked: { periodMonth: IsoMonth; missing: IsoMonth[] } | null;
}

// ─── Tax suggestion (§2.10) ─────────────────────────────────────────────────────────────────────

export interface MarginalRateSuggestion {
  /** asOf's FY (start year). */
  financialYear: number;
  /** The table used (the nearest earlier one past the end). */
  tableFinancialYear: number;
  /** False when asOf's FY is after the last table. */
  tableCurrent: boolean;
  incomeCents: Cents;
  /**
   * The band holding the income: thresholdCents < income ≤ toCents (display adds $1 to the
   * threshold).
   */
  bracket: { thresholdCents: Cents; toCents: Cents | null; ratio: DecimalString };
  bracketRatio: DecimalString;
  /** The marginal levy rate: 0, 0.1 (shade-in) or 0.02. */
  medicare: {
    thresholdCents: Cents;
    thresholdFinancialYear: number;
    ratio: DecimalString;
    band: 'none' | 'shade_in' | 'full';
  };
  /** bracket + medicare.ratio: the "suggested" rate (D90; the bracket alone is offered too). */
  suggestedRatio: DecimalString;
  /** On incomeCents, for the hint. */
  incomeTaxCents: Cents;
  medicareLevyCents: Cents;
  /**
   * LITO_PHASE_OUT_FROM < income ≤ LITO_PHASE_OUT_TO: the hint says the offset (not built) would
   * add to the true marginal rate.
   */
  litoPhaseOut: boolean;
}

// ─── Stage 5 function signatures (FROZEN) ───────────────────────────────────────────────────────

export type ComposeSnapshotFn = (input: ComposeSnapshotInput) => SnapshotFigures;
/** previousCashValueCents undefined: no previous snapshot. */
export type DeriveSnapshotColumnsFn = (i: {
  figures: SnapshotFigures;
  previousCashValueCents: Cents | null | undefined;
}) => DerivedSnapshotColumns;
export type CheckSnapshotsFn = (i: {
  snapshots: readonly EngineSnapshot[];
  trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>>;
}) => SnapshotCheckResult;
export type NetWorthOfFn = (figures: SnapshotFigures) => NetWorthBreakdown;
export type NetWorthDashboardFn = (input: NetWorthDashboardInput) => NetWorthDashboardResult;
export type RollingNetWorthFn = (input: RollingNetWorthInput) => RollingNetWorthRow[];
export type AggregateSnapshotsFn = (i: {
  rows: readonly SnapshotSeriesRow[];
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
}) => SnapshotGroup[];
export type LinearTrendFn = (
  points: readonly { date: IsoDate; valueCents: Cents | null }[],
) => TrendResult;
export type NextRecordMonthFn = (
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
) => IsoMonth;
export type RecordableMonthsFn = (
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
) => IsoMonth[];
/** autoRecordSince null → { due: [], blocked: null } (auto-record off). */
export type RecordingsDueFn = (i: {
  snapshots: readonly { periodMonth: IsoMonth }[];
  today: IsoDate;
  /** The server's clock says the record hour has passed (§4.6). */
  recordTimeReached: boolean;
  autoRecordSince: IsoDate | null;
}) => RecordingPlan;
export type SuggestMarginalRateFn = (i: {
  incomeCents: Cents | null;
  asOf: IsoDate;
}) => MarginalRateSuggestion | null;
