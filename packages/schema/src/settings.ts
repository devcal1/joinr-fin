// The settings registry (stage-1.md §2.5). Key order = display order.
//
// `sheetLabel` is the template's SheetOptions column-K label for that ID, copied verbatim from the
// template (generic template text). SheetOptions IDs are read from column P (stable across
// template versions); the setting row is wherever that ID sits.
import { z } from 'zod';
import {
  ALLOCATION_AGGRESSIVENESS,
  CHART_DATE_UNITS,
  PAY_FREQUENCIES,
  YEAR_BASES,
  type AllocationAggressiveness,
  type PayFrequency,
  type ReasonCode,
} from './enums';
import { CentsSchema, DecimalStringSchema, IsoDateSchema } from './primitives';

export type SettingType = 'money' | 'ratio' | 'integer' | 'boolean' | 'enum' | 'date';
export type SettingCategory =
  | 'pay'
  | 'budget'
  | 'goals'
  | 'allocation'
  | 'returns'
  | 'investing'
  | 'crypto'
  | 'savings'
  | 'property'
  | 'charts'
  | 'features'
  | 'fire';

export const SETTING_KEYS = [
  'pay.dayOfMonth',
  'budget.useForInvestAmount',
  'pay.grossAnnualSalaryCents',
  'goals.housePriceTargetCents',
  'goals.cashSavingsTargetCents',
  'pay.frequency',
  'pay.netPayCents',
  'pay.jobStartDate',
  'returns.cashInterestRate',
  'investing.defaultBrokerageCents',
  'investing.allocationAggressiveness',
  'allocation.etf',
  'allocation.stock',
  'allocation.crypto',
  'allocation.cash',
  'goals.houseSavingsPerYearCents',
  'allocation.managedFund',
  'goals.eoyCashGoalCents',
  'returns.marketReturn',
  'tax.marginalRate',
  'goals.houseDepositRatio',
  'goals.houseDepositInvestmentShare',
  'budget.emergencyFundMonths',
  'budget.autoInvestSplit',
  'crypto.feeRate',
  'savings.includeMortgagePrincipal',
  'allocation.otherAssets',
  'savings.includeRetirementContributions',
  'property.offsetsIncludeEmergencyFund',
  'investing.parcelFrequencyMonths',
  'investing.parcelAmountCents',
  'investing.etfLimit',
  'budget.includeSideIncome',
  'budget.emergencyFundOverrideCents',
  'charts.dateUnit',
  'charts.unitCount',
  'features.cash',
  'features.etfs',
  'features.stocks',
  'features.managedFunds',
  'features.fire',
  'features.budget',
  'features.crypto',
  'features.otherAssets',
  'features.property',
  'features.sideIncome',
  'features.retirement',
  'fire.birthYear',
  'fire.superContributionPerYearCents',
  'fire.inflationRate',
  'fire.withdrawalRate',
  'fire.preservationAge',
  'fire.yearlySpendOverrideCents',
  // Stage 3 (stage-3.md §3.3): app-only (no workbook source).
  'savings.yearBasis',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** money = integer cents · ratio = decimal string · integer · boolean · enum string · IsoDate. */
export type SettingValue = number | string | boolean;

export type SettingSource =
  { tab: 'SheetOptions'; id: number; sheetLabel: string } | { tab: string; cell: string } | null;

export interface SettingDef {
  key: SettingKey;
  label: string;
  category: SettingCategory;
  type: SettingType;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  source: SettingSource;
  defaultValue: SettingValue | null;
  /**
   * "Only when typed" override: a typed number is stored; the template's default formula (or a
   * blank) stores nothing and reports `formula_default` info (§2.5).
   */
  onlyWhenTyped?: true;
}

/** The FIRE tab's name starts with this (the full name carries an emoji). */
export const FIRE_TAB_PREFIX = 'FIRE';

const so = (id: number, sheetLabel: string): SettingSource => ({
  tab: 'SheetOptions',
  id,
  sheetLabel,
});
const cell = (tab: string, address: string): SettingSource => ({ tab, cell: address });

// prettier-ignore
export const SETTINGS: readonly SettingDef[] = [
  { key: 'pay.dayOfMonth', label: 'Day of month paid', category: 'pay', type: 'integer', min: 0, max: 28, source: so(2, 'Day of Month Paid'), defaultValue: null },
  { key: 'budget.useForInvestAmount', label: 'Use the budget for the invest amount', category: 'budget', type: 'boolean', source: so(3, 'Use Budget Tab?'), defaultValue: null },
  { key: 'pay.grossAnnualSalaryCents', label: 'Gross annual salary', category: 'pay', type: 'money', min: 0, source: so(4, 'Employment Salary'), defaultValue: null },
  { key: 'goals.housePriceTargetCents', label: 'House price target', category: 'goals', type: 'money', min: 0, source: so(5, 'House Price Target'), defaultValue: null },
  { key: 'goals.cashSavingsTargetCents', label: 'Cash savings target', category: 'goals', type: 'money', min: 0, source: so(6, 'General Cash Savings Target'), defaultValue: null },
  { key: 'pay.frequency', label: 'Pay frequency', category: 'pay', type: 'enum', enumValues: PAY_FREQUENCIES, source: so(7, 'Salary Frequency'), defaultValue: null },
  { key: 'pay.netPayCents', label: 'Net pay per pay', category: 'pay', type: 'money', min: 0, source: so(8, 'Net Regular Income\n(What hits your bank)'), defaultValue: null },
  { key: 'pay.jobStartDate', label: 'Job start date', category: 'pay', type: 'date', source: so(9, 'Job Start Date:'), defaultValue: null },
  { key: 'returns.cashInterestRate', label: 'Cash interest rate', category: 'returns', type: 'ratio', source: so(11, 'Bank Interest Rate'), defaultValue: null },
  { key: 'investing.defaultBrokerageCents', label: 'Default brokerage', category: 'investing', type: 'money', min: 0, source: so(12, 'Brokerage'), defaultValue: null },
  { key: 'investing.allocationAggressiveness', label: 'Allocation aggressiveness', category: 'investing', type: 'enum', enumValues: ALLOCATION_AGGRESSIVENESS, source: so(13, 'Allocation Aggressiveness'), defaultValue: null },
  { key: 'allocation.etf', label: 'Target allocation: ETFs', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(15, 'Asset Allocations - ETFs'), defaultValue: null },
  { key: 'allocation.stock', label: 'Target allocation: stocks', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(16, 'Asset Allocations - Stocks'), defaultValue: null },
  { key: 'allocation.crypto', label: 'Target allocation: crypto', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(17, 'Asset Allocations - Crypto'), defaultValue: null },
  { key: 'allocation.cash', label: 'Target allocation: cash savings', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(18, 'Asset Allocations - Cash Savings'), defaultValue: null },
  { key: 'goals.houseSavingsPerYearCents', label: 'House savings target per year', category: 'goals', type: 'money', min: 0, source: so(21, 'House Savings Target / Year'), defaultValue: null },
  { key: 'allocation.managedFund', label: 'Target allocation: managed funds', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(23, 'Asset Allocations - Managed Funds'), defaultValue: null },
  { key: 'goals.eoyCashGoalCents', label: 'End-of-year cash goal', category: 'goals', type: 'money', min: 0, source: so(24, 'EOY Cash Goal'), defaultValue: null },
  { key: 'returns.marketReturn', label: 'Market investment return', category: 'returns', type: 'ratio', source: so(25, 'Market Investment Return'), defaultValue: null },
  { key: 'tax.marginalRate', label: 'Marginal tax rate', category: 'pay', type: 'ratio', min: 0, max: 1, source: so(26, 'Tax Bracket'), defaultValue: null },
  { key: 'goals.houseDepositRatio', label: 'House deposit target', category: 'goals', type: 'ratio', min: 0, max: 1, source: so(27, 'House Deposit - % Target'), defaultValue: null },
  { key: 'goals.houseDepositInvestmentShare', label: 'Savings goals: share of investments counted', category: 'goals', type: 'ratio', min: 0, max: 1, source: so(28, 'House Deposit - Investment Contribution %'), defaultValue: null },
  { key: 'budget.emergencyFundMonths', label: 'Emergency fund (months)', category: 'budget', type: 'integer', min: 0, source: so(30, 'Emergency Fund Duration'), defaultValue: null },
  { key: 'budget.autoInvestSplit', label: 'Automatic investment split', category: 'budget', type: 'boolean', source: so(33, 'Automatic Investment System'), defaultValue: null },
  { key: 'crypto.feeRate', label: 'Crypto fee', category: 'crypto', type: 'ratio', min: 0, max: 1, source: so(38, 'Crypto Fee (%)'), defaultValue: null },
  { key: 'savings.includeMortgagePrincipal', label: 'Include mortgage principal in savings rate', category: 'savings', type: 'boolean', source: so(41, 'Include Mortgage in Savings Rate?'), defaultValue: null },
  { key: 'allocation.otherAssets', label: 'Target allocation: other assets', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(42, 'Asset Allocations - Other Assets'), defaultValue: null },
  { key: 'savings.includeRetirementContributions', label: 'Include retirement contributions in savings rate', category: 'savings', type: 'boolean', source: so(43, 'Retirement - Contributions in Savings Rate'), defaultValue: null },
  { key: 'property.offsetsIncludeEmergencyFund', label: 'Offsets include the emergency fund', category: 'property', type: 'boolean', source: so(44, 'Cash - Offsets include emergency fund'), defaultValue: null },
  { key: 'investing.parcelFrequencyMonths', label: 'Investment parcel frequency (months)', category: 'investing', type: 'integer', min: 0, source: cell('SheetOptions', 'H13'), defaultValue: null },
  { key: 'investing.parcelAmountCents', label: 'Investment parcel amount', category: 'investing', type: 'money', min: 0, source: cell('SheetOptions', 'H19'), defaultValue: null },
  { key: 'investing.etfLimit', label: 'ETF limit', category: 'investing', type: 'integer', min: 0, source: cell('ETFs', 'L18'), defaultValue: null },
  { key: 'budget.includeSideIncome', label: 'Include side income in the budget', category: 'budget', type: 'boolean', source: cell('Budget', 'D4'), defaultValue: null },
  { key: 'budget.emergencyFundOverrideCents', label: 'Emergency fund override', category: 'budget', type: 'money', min: 0, source: cell('Budget', 'D3'), defaultValue: null, onlyWhenTyped: true },
  { key: 'charts.dateUnit', label: 'Chart date unit', category: 'charts', type: 'enum', enumValues: CHART_DATE_UNITS, source: cell('Net Worth', 'H60'), defaultValue: 'monthly' },
  { key: 'charts.unitCount', label: 'Chart unit count', category: 'charts', type: 'integer', min: 1, source: cell('Net Worth', 'H61'), defaultValue: null, onlyWhenTyped: true },
  { key: 'features.cash', label: 'Feature: cash', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C28'), defaultValue: true },
  { key: 'features.etfs', label: 'Feature: ETFs', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C29'), defaultValue: true },
  { key: 'features.stocks', label: 'Feature: stocks', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C30'), defaultValue: true },
  { key: 'features.managedFunds', label: 'Feature: managed funds', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C31'), defaultValue: true },
  { key: 'features.fire', label: 'Feature: FIRE', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C32'), defaultValue: true },
  { key: 'features.budget', label: 'Feature: budget', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C33'), defaultValue: true },
  { key: 'features.crypto', label: 'Feature: crypto', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E28'), defaultValue: true },
  { key: 'features.otherAssets', label: 'Feature: other assets', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E29'), defaultValue: true },
  { key: 'features.property', label: 'Feature: property', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E30'), defaultValue: true },
  { key: 'features.sideIncome', label: 'Feature: side income', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E32'), defaultValue: true },
  { key: 'features.retirement', label: 'Feature: retirement', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E33'), defaultValue: true },
  { key: 'fire.birthYear', label: 'Birth year', category: 'fire', type: 'integer', min: 1900, max: 2200, source: cell(FIRE_TAB_PREFIX, 'E6'), defaultValue: null },
  { key: 'fire.superContributionPerYearCents', label: 'Super contribution per year', category: 'fire', type: 'money', min: 0, source: cell(FIRE_TAB_PREFIX, 'E7'), defaultValue: null },
  { key: 'fire.inflationRate', label: 'Inflation rate', category: 'fire', type: 'ratio', source: cell(FIRE_TAB_PREFIX, 'E8'), defaultValue: null },
  { key: 'fire.withdrawalRate', label: 'Withdrawal rate', category: 'fire', type: 'ratio', source: cell(FIRE_TAB_PREFIX, 'E9'), defaultValue: null },
  { key: 'fire.preservationAge', label: 'Preservation age', category: 'fire', type: 'integer', min: 0, max: 120, source: cell(FIRE_TAB_PREFIX, 'E10'), defaultValue: null },
  { key: 'fire.yearlySpendOverrideCents', label: 'Yearly spend override', category: 'fire', type: 'money', min: 0, source: cell(FIRE_TAB_PREFIX, 'E48'), defaultValue: null, onlyWhenTyped: true },
  { key: 'savings.yearBasis', label: 'Year for the cash figures', category: 'savings', type: 'enum', enumValues: YEAR_BASES, source: null, defaultValue: 'fy' },
];

const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTINGS.map((s) => [s.key, s]));

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && SETTINGS_BY_KEY.has(value);
}

/** The definition of a setting key (throws for an unknown key). */
export function settingDef(key: SettingKey): SettingDef {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new RangeError(`Unknown setting key: ${key}`);
  return def;
}

/**
 * True for a key the workbook provides (its registry `source` is set): an import writes it, so an
 * in-app edit of it counts as app data (D34, stage-3.md §3.3 rule 2). App-only keys
 * (`savings.yearBasis`) never do.
 */
export function isWorkbookSetting(key: SettingKey): boolean {
  return settingDef(key).source !== null;
}

/**
 * The keys the app edits in Stage 3 (`PATCH /api/settings`; stage-3.md §3.3). The Budget page
 * edits the first nine, the Cash page the rest. Stage 5 extends the list to every key.
 */
export const EDITABLE_SETTING_KEYS = [
  'pay.frequency',
  'pay.netPayCents',
  'pay.dayOfMonth',
  'pay.jobStartDate',
  'budget.includeSideIncome',
  'budget.emergencyFundMonths',
  'budget.emergencyFundOverrideCents',
  'budget.autoInvestSplit',
  'budget.useForInvestAmount',
  'goals.cashSavingsTargetCents',
  'goals.eoyCashGoalCents',
  'goals.houseDepositInvestmentShare',
  'savings.includeMortgagePrincipal',
  'savings.yearBasis',
  'property.offsetsIncludeEmergencyFund',
] as const satisfies readonly SettingKey[];
export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number];

export function isEditableSettingKey(value: unknown): value is EditableSettingKey {
  return typeof value === 'string' && (EDITABLE_SETTING_KEYS as readonly string[]).includes(value);
}

/** SheetOptions ID (column P) → the setting stored from it. */
export const SETTING_BY_SHEET_OPTIONS_ID: ReadonlyMap<number, SettingDef> = new Map(
  SETTINGS.flatMap((s) =>
    s.source !== null && 'id' in s.source ? [[s.source.id, s] as const] : [],
  ),
);

/** The Zod schema of one setting's value (`value_json` after JSON.parse). */
export function settingValueSchema(key: SettingKey): z.ZodType<SettingValue> {
  const def = settingDef(key);
  switch (def.type) {
    case 'money': {
      let s = CentsSchema;
      if (def.min !== undefined) s = s.min(def.min);
      if (def.max !== undefined) s = s.max(def.max);
      return s;
    }
    case 'ratio':
      return DecimalStringSchema;
    case 'integer': {
      let s = z.number().int();
      if (def.min !== undefined) s = s.min(def.min);
      if (def.max !== undefined) s = s.max(def.max);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'enum':
      return z.enum((def.enumValues ?? []) as [string, ...string[]]);
    case 'date':
      return IsoDateSchema;
  }
}

export interface NotImportedSheetOption {
  sheetLabel: string;
  reasonCode: ReasonCode;
  reason: string;
  decision?: string;
  /** The value cell (column L) is never read for this ID. */
  secret?: true;
}

/** SheetOptions IDs that are reported but never stored (§2.5). */
// prettier-ignore
export const SHEET_OPTIONS_NOT_IMPORTED: Readonly<Record<number, NotImportedSheetOption>> = {
  1: { sheetLabel: 'Personal Gmail', reasonCode: 'secret_not_imported', reason: 'Personal contact detail; not imported', decision: 'D24', secret: true },
  10: { sheetLabel: 'Include Side Income in Budget Income?', reasonCode: 'setting_not_imported', reason: 'No formula consumer; Budget D4 is the effective switch' },
  14: { sheetLabel: 'Create Calendar/Email reminder?', reasonCode: 'feature_dropped', reason: 'Email and calendar reminders are not rebuilt' },
  19: { sheetLabel: 'HELP Debt Remaining', reasonCode: 'obsolete_setting', reason: 'Obsolete; moved to the liabilities tab in the template' },
  20: { sheetLabel: 'HELP Debt Amount Paid', reasonCode: 'obsolete_setting', reason: 'Obsolete; moved to the liabilities tab in the template' },
  29: { sheetLabel: 'CoinMarketCap API', reasonCode: 'secret_not_imported', reason: 'API key; not imported (crypto prices come from CoinGecko)', decision: 'D24', secret: true },
  31: { sheetLabel: 'Monthly Run Calendar Reminder', reasonCode: 'feature_dropped', reason: 'Email and calendar reminders are not rebuilt' },
  32: { sheetLabel: 'Minor Version Update Notification', reasonCode: 'feature_dropped', reason: 'The template version check is not rebuilt' },
  34: { sheetLabel: 'Capital Gains - Calculation Style', reasonCode: 'feature_dropped', reason: 'The Capital Gains tab is not rebuilt', decision: 'D2' },
  35: { sheetLabel: 'Capital Gains - Short Term Tax Rate', reasonCode: 'feature_dropped', reason: 'The Capital Gains tab is not rebuilt', decision: 'D2' },
  36: { sheetLabel: 'Capital Gains - Long Term Tax Rate', reasonCode: 'feature_dropped', reason: 'The Capital Gains tab is not rebuilt', decision: 'D2' },
  37: { sheetLabel: 'Capital Gains - Show in Liabilities Tab', reasonCode: 'feature_dropped', reason: 'The Capital Gains tab is not rebuilt', decision: 'D2' },
  40: { sheetLabel: 'Crypto Pricing Source', reasonCode: 'feature_dropped', reason: 'Crypto prices always come from CoinGecko', decision: 'D24' },
};

/** SheetOptions IDs that are checked but not stored: the value must be AUD (D25). */
// prettier-ignore
export const SHEET_OPTIONS_VALIDATED: Readonly<Record<number, { sheetLabel: string; expected: 'AUD' }>> = {
  22: { sheetLabel: 'Currency Choice', expected: 'AUD' },
  39: { sheetLabel: 'Employment Salary Currency', expected: 'AUD' },
};

/** Every SheetOptions ID the template defines a setting for. */
export const SHEET_OPTIONS_IDS: readonly number[] = Array.from({ length: 44 }, (_, i) => i + 1);

/** Sheet text of the Salary Frequency setting (ID 7) → PAY_FREQUENCIES. */
export const PAY_FREQUENCY_SHEET_VALUES: Readonly<Record<string, PayFrequency>> = {
  Monthly: 'monthly',
  '4-weeks': 'four_weekly',
  '2-weeks': 'fortnightly',
  Weekly: 'weekly',
  'Twice Monthly': 'twice_monthly',
};

/** Sheet text of the Allocation Aggressiveness setting (ID 13). */
export const ALLOCATION_AGGRESSIVENESS_SHEET_VALUES: Readonly<
  Record<string, AllocationAggressiveness>
> = { Light: 'light', Normal: 'normal', Aggressive: 'aggressive' };

/**
 * Normalises a sheet label for comparison: lower-case; en and em dashes → `-`; runs of whitespace
 * (incl. newlines) → one space; trimmed; one trailing `:` removed.
 */
export function normaliseSheetLabel(label: string): string {
  const s = label.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  return s.endsWith(':') ? s.slice(0, -1).trimEnd() : s;
}
