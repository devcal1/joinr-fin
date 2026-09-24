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

export const SUPER_ENTRY_KINDS = ['voluntary_contribution', 'reported_gain'] as const;
export type SuperEntryKind = (typeof SUPER_ENTRY_KINDS)[number];

export const OTHER_ASSET_PRICE_SOURCES = ['manual', 'bullion'] as const;
export type OtherAssetPriceSource = (typeof OTHER_ASSET_PRICE_SOURCES)[number];

export const METALS = ['silver', 'gold'] as const;
export type Metal = (typeof METALS)[number];

export const UNITS_OF_MEASURE = ['each', 'oz'] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const PAYMENT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const SNAPSHOT_SOURCES = ['migrated', 'recorded', 'lookback'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const IMPORT_TRIGGERS = ['cli', 'upload'] as const;
export type ImportTrigger = (typeof IMPORT_TRIGGERS)[number];

export const JOB_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGERS = ['schedule', 'startup', 'manual', 'import'] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

/** Stage 5 adds 'snapshot', Stage 7 'backup'. */
export const JOB_NAMES = ['prices'] as const;
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
