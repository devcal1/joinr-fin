// Every enum of the data model (stage-1.md §2.3, frozen). Plain tuples: no imports, so the Drizzle
// table files (loaded by drizzle-kit) and the web bundle can both use them.
// Stages 2–6 may append values; they never remove or rename one (no SQL CHECK constraints).

export const INSTRUMENT_KINDS = ['stock', 'etf', 'managed_fund', 'crypto'] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

export const ORIGINS = ['import', 'app'] as const;
export type Origin = (typeof ORIGINS)[number];

export const PRICE_PROVIDERS = ['yahoo', 'coingecko', 'none'] as const;
export type PriceProvider = (typeof PRICE_PROVIDERS)[number];

export const SYMBOL_ORIGINS = ['derived', 'search', 'user'] as const;
export type SymbolOrigin = (typeof SYMBOL_ORIGINS)[number];

export const MANUAL_ORIGINS = ['import', 'user'] as const;
export type ManualOrigin = (typeof MANUAL_ORIGINS)[number];

/** Where a cached price came from. */
export const PRICE_SOURCES = ['yahoo', 'coingecko', 'fake', 'sheet'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const FETCH_STATUSES = ['ok', 'error', 'never'] as const;
export type FetchStatus = (typeof FETCH_STATUSES)[number];

/** Computed per item, never stored (§5.6). */
export const PRICE_STATUSES = ['fresh', 'stale', 'failed', 'manual', 'none'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];

export const MARKET_DATA_MODES = ['live', 'fake', 'off'] as const;
export type MarketDataMode = (typeof MARKET_DATA_MODES)[number];

export const REVIEW_FLAGS = [
  'out_of_order',
  'price_outlier',
  'oversell',
  'future_date',
  'non_positive_price',
  'zero_units',
  'unmatched_ticker',
  'unmatched_account',
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const CASH_ACCOUNT_KINDS = ['bank', 'credit_card', 'loan_receivable', 'other'] as const;
export type CashAccountKind = (typeof CASH_ACCOUNT_KINDS)[number];

export const BUDGET_ITEM_KINDS = ['item', 'auto_yearly', 'auto_invest', 'auto_cash'] as const;
export type BudgetItemKind = (typeof BUDGET_ITEM_KINDS)[number];

export const PERIOD_NOTE_KINDS = ['spend', 'super_option', 'side_income'] as const;
export type PeriodNoteKind = (typeof PERIOD_NOTE_KINDS)[number];

/**
 * Stage 4 appends the typed member contributions (D71): `voluntary_contribution` is an imported
 * (untyped) entry, read through the `super.importedContributionType` setting.
 */
export const SUPER_ENTRY_KINDS = [
  'voluntary_contribution',
  'reported_gain',
  'salary_sacrifice',
  'after_tax',
] as const;
export type SuperEntryKind = (typeof SUPER_ENTRY_KINDS)[number];

export const OTHER_ASSET_PRICE_SOURCES = ['manual', 'bullion'] as const;
export type OtherAssetPriceSource = (typeof OTHER_ASSET_PRICE_SOURCES)[number];

export const METALS = ['silver', 'gold'] as const;
export type Metal = (typeof METALS)[number];

export const UNITS_OF_MEASURE = ['each', 'oz'] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const PAYMENT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

/** Stage 5 appends 'late' (D82: caught up at start-up or at a later wake-up). */
export const SNAPSHOT_SOURCES = ['migrated', 'recorded', 'lookback', 'late'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const IMPORT_TRIGGERS = ['cli', 'upload'] as const;
export type ImportTrigger = (typeof IMPORT_TRIGGERS)[number];

export const JOB_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGERS = ['schedule', 'startup', 'manual', 'import'] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

/** Stage 3 adds 'dividends' (the dividend-events job); Stage 5 adds 'snapshot', Stage 7 'backup'. */
export const JOB_NAMES = ['prices', 'dividends', 'snapshot', 'backup'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const CHECK_STATUSES = ['match', 'explained', 'unexplained', 'suspect', 'info'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const REPORT_SECTIONS = [
  'workbook',
  'counts',
  'holdings',
  'ledgers',
  'movements',
  'dividends',
  'cash',
  'income',
  'budget',
  'other_assets',
  'super',
  'property',
  'snapshots',
  'net_worth',
  'settings',
  'exclusions',
  'corrections',
  'suspects',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/**
 * Report reason codes. placeholder_slot: an unused template slot skipped; unnamed_row: a row with
 * a blank key cell that still holds other typed content; formula_default: an "only when typed"
 * override cell holds the template's default formula, so nothing is stored; derived_input: an
 * input cell holds a formula instead of a typed value and was imported as its cached result.
 */
export const REASON_CODES = [
  'correction',
  'correction_unmatched',
  'exclusion_d22',
  'exclusion_d23',
  'feed_row',
  'secret_not_imported',
  'setting_not_imported',
  'obsolete_setting',
  'feature_dropped',
  'sheet_error_value',
  'sheet_bug',
  'first_snapshot_window',
  'live_row_skipped',
  'blank_row',
  'suspect_row',
  'dividend_rekeyed',
  'unmatched_dividend',
  'unmatched_account',
  'rounding',
  'derived_later_stage',
  'template_mismatch',
  'unsupported_value',
  'placeholder_slot',
  'unnamed_row',
  'formula_default',
  'derived_input',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const PAY_FREQUENCIES = [
  'monthly',
  'four_weekly',
  'fortnightly',
  'weekly',
  'twice_monthly',
] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const ALLOCATION_AGGRESSIVENESS = ['light', 'normal', 'aggressive'] as const;
export type AllocationAggressiveness = (typeof ALLOCATION_AGGRESSIVENESS)[number];

export const CHART_DATE_UNITS = ['monthly', 'quarterly', 'yearly'] as const;
export type ChartDateUnit = (typeof CHART_DATE_UNITS)[number];

// ─── Stage 2: investments (stage-2.md §3.2) ─────────────────────────────────────────────────────

export const TRADE_SIDES = ['buy', 'sell'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

/** D38: a trade is entered as units, or as a dollar amount (units = amount ÷ price). */
export const QUANTITY_MODES = ['units', 'amount'] as const;
export type QuantityMode = (typeof QUANTITY_MODES)[number];

export const FEE_KINDS = ['flat', 'rate'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const HOLDING_STATUSES = ['held', 'watching', 'exited'] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export const HOLDING_FLAGS = ['unpriced', 'stale_price', 'oversell', 'unwatched_held'] as const;
export type HoldingFlag = (typeof HOLDING_FLAGS)[number];

export const CAPITAL_GAIN_TERMS = ['short', 'long'] as const;
export type CapitalGainTerm = (typeof CAPITAL_GAIN_TERMS)[number];

/** Net Worth B38:B43 order. */
export const ASSET_CLASSES = [
  'etf',
  'stock',
  'crypto',
  'cash',
  'managed_fund',
  'other_assets',
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const CONSIDER_REASONS = ['below_emergency_fund', 'most_underweight', 'no_targets'] as const;
export type ConsiderReason = (typeof CONSIDER_REASONS)[number];

/**
 * `split_off` (D46, appended): nothing to invest because the budget drives the amount and its
 * automatic investment split is off (the whole leftover goes to cash), not a bare cash first.
 */
export const COUNTDOWN_STATES = [
  'wait',
  'invest',
  'cash_first',
  'unavailable',
  'split_off',
] as const;
export type CountdownState = (typeof COUNTDOWN_STATES)[number];

/** Timing inputs Stage 2 does not have yet (the cash-deficit wait needs the Stage 3 savings engine). */
export const DEFERRED_TIMING_INPUTS = ['cash_deficit_period'] as const;
export type DeferredTimingInput = (typeof DEFERRED_TIMING_INPUTS)[number];

// ─── Stage 3: cash flow and income (stage-3.md §3.2) ────────────────────────────────────────────

/** D52: the Cash year figures use the Australian FY by default, or the calendar year. */
export const YEAR_BASES = ['fy', 'calendar'] as const;
export type YearBasis = (typeof YEAR_BASES)[number];

/** The first snapshot is the baseline; the current period stays provisional until recorded. */
export const SAVINGS_PERIOD_STATUSES = ['first', 'closed', 'provisional'] as const;
export type SavingsPeriodStatus = (typeof SAVINGS_PERIOD_STATUSES)[number];

/** The 3-month savings-rate trend (Cash C40). */
export const KPI_TRENDS = ['increasing', 'decreasing', 'flat'] as const;
export type KpiTrend = (typeof KPI_TRENDS)[number];

/** A Yahoo dividend suggestion (D50). */
export const DIVIDEND_SUGGESTION_STATUSES = ['due', 'upcoming', 'dismissed'] as const;
export type DividendSuggestionStatus = (typeof DIVIDEND_SUGGESTION_STATUSES)[number];

/** The DRP advice of the per-holding FY table (Dividends R). */
export const DRP_ADVICE = ['switch_on', 'switch_off', 'keep'] as const;
export type DrpAdvice = (typeof DRP_ADVICE)[number];

/** The budget's automatic rows: a subset of BUDGET_ITEM_KINDS. */
export const BUDGET_AUTO_KINDS = [
  'auto_yearly',
  'auto_invest',
  'auto_cash',
] as const satisfies readonly BudgetItemKind[];
export type BudgetAutoKind = (typeof BUDGET_AUTO_KINDS)[number];

/** The period notes the app edits (`PUT /api/period-notes/:kind/:periodMonth`). */
export const EDITABLE_NOTE_KINDS = [
  'spend',
  'side_income',
  // Stage 4 (stage-4.md §3.2): the super investment-option log (D69).
  'super_option',
] as const satisfies readonly PeriodNoteKind[];
export type EditableNoteKind = (typeof EDITABLE_NOTE_KINDS)[number];

// ─── Stage 4: other assets, super and property (stage-4.md §3.2) ────────────────────────────────

/** How a typed member contribution was paid (D71); also how imported (untyped) ones are read. */
export const SUPER_CONTRIBUTION_TYPES = [
  'salary_sacrifice',
  'after_tax',
] as const satisfies readonly SuperEntryKind[];
export type SuperContributionType = (typeof SUPER_CONTRIBUTION_TYPES)[number];

/** Where an other asset's FX rate at purchase came from (§3.1, §4.6). */
export const FX_RATE_SOURCES = ['import', 'market', 'user'] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/** Why an other asset's figures are null, stale, assumed or partial (§2.4). */
export const OTHER_ASSET_FLAGS = [
  'no_purchase_date',
  'no_cost',
  'purchase_fx_missing',
  'live_fx_missing',
  'unpriced',
  'stale_price',
  'spot_unavailable',
  'legacy_sold',
  'oversold',
] as const;
export type OtherAssetFlag = (typeof OTHER_ASSET_FLAGS)[number];

/** Super page conditions (§2.5). */
export const SUPER_FLAGS = [
  'no_salary',
  'no_sg_fund',
  'no_marginal_rate',
  'balances_not_updated',
  'imported_estimates',
] as const;
export type SuperFlag = (typeof SUPER_FLAGS)[number];

/** The concessional cap meter's status (D70; `near` from SUPER_CAP_WARNING_RATIO). */
export const SUPER_CAP_STATUSES = ['under', 'near', 'over'] as const;
export type SuperCapStatus = (typeof SUPER_CAP_STATUSES)[number];

/** Loan conditions (§2.6, §2.7). */
export const LOAN_FLAGS = [
  'no_property',
  'no_rate',
  'no_compounding',
  'no_payment',
  'payment_below_interest',
  'never_repaid',
] as const;
export type LoanFlag = (typeof LOAN_FLAGS)[number];

/** A loan balance-log entry's checks (§2.6 step 3). */
export const LOAN_ENTRY_FLAGS = ['repayments_below_principal', 'balance_increased'] as const;
export type LoanEntryFlag = (typeof LOAN_ENTRY_FLAGS)[number];

// ─── Stage 5: history, net worth and settings (stage-5.md §3.2) ─────────────────────────────────

/** What a snapshot_audit row records. */
export const SNAPSHOT_AUDIT_ACTIONS = ['record', 'correct', 'delete'] as const;
export type SnapshotAuditAction = (typeof SNAPSHOT_AUDIT_ACTIONS)[number];

/** Who started a record (a correction or a delete is always 'manual'). */
export const RECORD_TRIGGERS = ['manual', 'schedule', 'startup'] as const;
export type RecordTrigger = (typeof RECORD_TRIGGERS)[number];

/** The dashboard's asset classes (no folded class: D93). */
export const NET_WORTH_CLASSES = [
  'etf',
  'stock',
  'managed_fund',
  'crypto',
  'cash',
  'offsets',
  'other_assets',
  'super',
  'property',
] as const;
export type NetWorthClass = (typeof NET_WORTH_CLASSES)[number];

/** The dashboard's liabilities (other_debts: History U, LiabilitiesDebts, not rebuilt; D2). */
export const NET_WORTH_LIABILITIES = ['mortgages', 'cash_debit', 'other_debts'] as const;
export type NetWorthLiability = (typeof NET_WORTH_LIABILITIES)[number];

/** The snapshot columns the consistency check recomputes: the 9 derived + the 4 movement columns. */
export const SNAPSHOT_CHECK_COLUMNS = [
  'stocksGainRatio',
  'etfGainRatio',
  'cryptoGainRatio',
  'cashGainCents',
  'cashIncreaseRatio',
  'superGainRatio',
  'propertyEquityCents',
  'propertyGainRatio',
  'mfGainRatio',
  'stocksMovementsCents',
  'etfMovementsCents',
  'cryptoMovementsCents',
  'mfMovementsCents',
] as const;
export type SnapshotCheckColumn = (typeof SNAPSHOT_CHECK_COLUMNS)[number];
