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
  SUPER_CONTRIBUTION_TYPES,
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
  | 'fire'
  // Stage 4 (stage-4.md §3.3).
  | 'super'
  | 'assets'
  // Stage 5 (stage-5.md §3.3).
  | 'history';

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
  // Stage 4 (stage-4.md §3.3): app-only (no workbook source).
  'otherAssets.stalePriceDays',
  'super.sgRate',
  'super.contributionsTaxRate',
  'super.concessionalCapCents',
  'super.concessionalCapFy',
  'super.importedContributionType',
  // Stage 5 (stage-5.md §3.3): app-only (no workbook source).
  'history.autoRecord',
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
  { key: 'pay.dayOfMonth', label: 'Pay day (day of the month)', category: 'pay', type: 'integer', min: 0, max: 28, source: so(2, 'Day of Month Paid'), defaultValue: null },
  { key: 'budget.useForInvestAmount', label: 'Use the budget for the amount to invest', category: 'budget', type: 'boolean', source: so(3, 'Use Budget Tab?'), defaultValue: null },
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
  { key: 'goals.houseDepositInvestmentShare', label: 'Share of investments counted toward goals', category: 'goals', type: 'ratio', min: 0, max: 1, source: so(28, 'House Deposit - Investment Contribution %'), defaultValue: null },
  { key: 'budget.emergencyFundMonths', label: 'Emergency fund (months of spending)', category: 'budget', type: 'integer', min: 0, source: so(30, 'Emergency Fund Duration'), defaultValue: null },
  { key: 'budget.autoInvestSplit', label: 'Automatic investment split', category: 'budget', type: 'boolean', source: so(33, 'Automatic Investment System'), defaultValue: null },
  { key: 'crypto.feeRate', label: 'Crypto fee', category: 'crypto', type: 'ratio', min: 0, max: 1, source: so(38, 'Crypto Fee (%)'), defaultValue: null },
  { key: 'savings.includeMortgagePrincipal', label: 'Count mortgage principal as savings', category: 'savings', type: 'boolean', source: so(41, 'Include Mortgage in Savings Rate?'), defaultValue: null },
  { key: 'allocation.otherAssets', label: 'Target allocation: other assets', category: 'allocation', type: 'ratio', min: 0, max: 1, source: so(42, 'Asset Allocations - Other Assets'), defaultValue: null },
  { key: 'savings.includeRetirementContributions', label: 'Count retirement contributions as savings', category: 'savings', type: 'boolean', source: so(43, 'Retirement - Contributions in Savings Rate'), defaultValue: null },
  { key: 'property.offsetsIncludeEmergencyFund', label: 'Offsets count toward the emergency fund', category: 'property', type: 'boolean', source: so(44, 'Cash - Offsets include emergency fund'), defaultValue: null },
  { key: 'investing.parcelFrequencyMonths', label: 'Investment parcel frequency (months)', category: 'investing', type: 'integer', min: 0, source: cell('SheetOptions', 'H13'), defaultValue: null },
  { key: 'investing.parcelAmountCents', label: 'Investment parcel amount', category: 'investing', type: 'money', min: 0, source: cell('SheetOptions', 'H19'), defaultValue: null },
  { key: 'investing.etfLimit', label: 'ETF limit', category: 'investing', type: 'integer', min: 0, source: cell('ETFs', 'L18'), defaultValue: null },
  { key: 'budget.includeSideIncome', label: 'Include side income', category: 'budget', type: 'boolean', source: cell('Budget', 'D4'), defaultValue: null },
  { key: 'budget.emergencyFundOverrideCents', label: 'Emergency fund override', category: 'budget', type: 'money', min: 0, source: cell('Budget', 'D3'), defaultValue: null, onlyWhenTyped: true },
  { key: 'charts.dateUnit', label: 'Chart grouping', category: 'charts', type: 'enum', enumValues: CHART_DATE_UNITS, source: cell('Net Worth', 'H60'), defaultValue: 'monthly' },
  { key: 'charts.unitCount', label: 'Groups shown in charts', category: 'charts', type: 'integer', min: 1, source: cell('Net Worth', 'H61'), defaultValue: null, onlyWhenTyped: true },
  { key: 'features.cash', label: 'Show the Cash page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C28'), defaultValue: true },
  { key: 'features.etfs', label: 'Show the ETFs page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C29'), defaultValue: true },
  { key: 'features.stocks', label: 'Show the Stocks page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C30'), defaultValue: true },
  { key: 'features.managedFunds', label: 'Show the Managed Funds page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C31'), defaultValue: true },
  { key: 'features.fire', label: 'Show the FIRE page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C32'), defaultValue: true },
  { key: 'features.budget', label: 'Show the Budget page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'C33'), defaultValue: true },
  { key: 'features.crypto', label: 'Show the Crypto page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E28'), defaultValue: true },
  { key: 'features.otherAssets', label: 'Show the Other Assets page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E29'), defaultValue: true },
  { key: 'features.property', label: 'Show the Property page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E30'), defaultValue: true },
  { key: 'features.sideIncome', label: 'Show the Side Income page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E32'), defaultValue: true },
  { key: 'features.retirement', label: 'Show the Super page', category: 'features', type: 'boolean', source: cell('First Time Setup', 'E33'), defaultValue: true },
  { key: 'fire.birthYear', label: 'Birth year', category: 'fire', type: 'integer', min: 1900, max: 2200, source: cell(FIRE_TAB_PREFIX, 'E6'), defaultValue: null },
  { key: 'fire.superContributionPerYearCents', label: 'Super contribution per year', category: 'fire', type: 'money', min: 0, source: cell(FIRE_TAB_PREFIX, 'E7'), defaultValue: null },
  { key: 'fire.inflationRate', label: 'Inflation rate', category: 'fire', type: 'ratio', source: cell(FIRE_TAB_PREFIX, 'E8'), defaultValue: null },
  { key: 'fire.withdrawalRate', label: 'Withdrawal rate', category: 'fire', type: 'ratio', source: cell(FIRE_TAB_PREFIX, 'E9'), defaultValue: null },
  { key: 'fire.preservationAge', label: 'Preservation age', category: 'fire', type: 'integer', min: 0, max: 120, source: cell(FIRE_TAB_PREFIX, 'E10'), defaultValue: null },
  { key: 'fire.yearlySpendOverrideCents', label: 'Yearly spend override', category: 'fire', type: 'money', min: 0, source: cell(FIRE_TAB_PREFIX, 'E48'), defaultValue: null, onlyWhenTyped: true },
  { key: 'savings.yearBasis', label: 'Year basis', category: 'savings', type: 'enum', enumValues: YEAR_BASES, source: null, defaultValue: 'fy' },
  { key: 'otherAssets.stalePriceDays', label: 'A price is stale after (days)', category: 'assets', type: 'integer', min: 1, max: 3650, source: null, defaultValue: 90 },
  { key: 'super.sgRate', label: 'Your employer’s SG rate', category: 'super', type: 'ratio', min: 0, max: 1, source: null, defaultValue: null },
  { key: 'super.contributionsTaxRate', label: 'Contributions tax', category: 'super', type: 'ratio', min: 0, max: 1, source: null, defaultValue: '0.15' },
  { key: 'super.concessionalCapCents', label: 'Concessional cap override (this financial year only)', category: 'super', type: 'money', min: 0, source: null, defaultValue: null },
  { key: 'super.concessionalCapFy', label: 'Concessional cap override: financial year', category: 'super', type: 'integer', min: 1900, max: 2200, source: null, defaultValue: null },
  { key: 'super.importedContributionType', label: 'Imported contributions are', category: 'super', type: 'enum', enumValues: SUPER_CONTRIBUTION_TYPES, source: null, defaultValue: 'salary_sacrifice' },
  { key: 'history.autoRecord', label: 'Record each month automatically on its last day', category: 'history', type: 'boolean', source: null, defaultValue: false },
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
 * (`savings.yearBasis`, the Stage 4 `otherAssets.*` and `super.*` keys) never do.
 */
export function isWorkbookSetting(key: SettingKey): boolean {
  return settingDef(key).source !== null;
}

/**
 * The keys the app edits (`PATCH /api/settings`). Stage 3 (stage-3.md §3.3): the Budget page edits
 * the first nine, the Cash page the next six. Stage 4 (stage-4.md §3.3) appends the Super page's
 * two workbook keys and the five editable app-only keys (`super.concessionalCapFy` is written by
 * the server with the cap, never edited). Stage 5 (stage-5.md §3.3, D86, D91) appends every other
 * key in registry order (the six workbook keys the app does not use included), then
 * `history.autoRecord`: 60 of the 61 keys.
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
  // Stage 4.
  'pay.grossAnnualSalaryCents',
  'tax.marginalRate',
  'otherAssets.stalePriceDays',
  'super.sgRate',
  'super.contributionsTaxRate',
  'super.concessionalCapCents',
  'super.importedContributionType',
  // Stage 5 (registry order).
  'goals.housePriceTargetCents',
  'returns.cashInterestRate',
  'investing.defaultBrokerageCents',
  'investing.allocationAggressiveness',
  'allocation.etf',
  'allocation.stock',
  'allocation.crypto',
  'allocation.cash',
  'goals.houseSavingsPerYearCents',
  'allocation.managedFund',
  'returns.marketReturn',
  'goals.houseDepositRatio',
  'crypto.feeRate',
  'allocation.otherAssets',
  'savings.includeRetirementContributions',
  'investing.parcelFrequencyMonths',
  'investing.parcelAmountCents',
  'investing.etfLimit',
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
  'history.autoRecord',
] as const satisfies readonly SettingKey[];
export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number];

export function isEditableSettingKey(value: unknown): value is EditableSettingKey {
  return typeof value === 'string' && (EDITABLE_SETTING_KEYS as readonly string[]).includes(value);
}

/**
 * The Settings page's groups (stage-5.md §3.3), in display order; each key is in exactly one group
 * (the anchor is `/settings#<id>`). `super.concessionalCapFy` is listed (read-only) beside the cap.
 */
export const SETTING_GROUPS = [
  {
    id: 'pay',
    label: 'Pay and tax',
    keys: [
      'pay.frequency',
      'pay.netPayCents',
      'pay.dayOfMonth',
      'pay.grossAnnualSalaryCents',
      'pay.jobStartDate',
      'tax.marginalRate',
    ],
  },
  {
    id: 'budget',
    label: 'Budget',
    keys: [
      'budget.useForInvestAmount',
      'budget.autoInvestSplit',
      'budget.includeSideIncome',
      'budget.emergencyFundMonths',
      'budget.emergencyFundOverrideCents',
    ],
  },
  {
    id: 'cash',
    label: 'Cash and savings',
    keys: [
      'savings.yearBasis',
      'savings.includeMortgagePrincipal',
      'goals.cashSavingsTargetCents',
      'goals.eoyCashGoalCents',
      'goals.houseDepositInvestmentShare',
      'property.offsetsIncludeEmergencyFund',
    ],
  },
  {
    id: 'allocation',
    label: 'Allocation targets',
    keys: [
      'allocation.etf',
      'allocation.stock',
      'allocation.crypto',
      'allocation.cash',
      'allocation.managedFund',
      'allocation.otherAssets',
    ],
  },
  {
    id: 'investing',
    label: 'Investing',
    keys: [
      'investing.defaultBrokerageCents',
      'investing.allocationAggressiveness',
      'investing.etfLimit',
      'returns.cashInterestRate',
      'returns.marketReturn',
      'crypto.feeRate',
    ],
  },
  {
    id: 'super',
    label: 'Super',
    keys: [
      'super.sgRate',
      'super.contributionsTaxRate',
      'super.concessionalCapCents',
      'super.concessionalCapFy',
      'super.importedContributionType',
    ],
  },
  { id: 'assets', label: 'Other assets', keys: ['otherAssets.stalePriceDays'] },
  {
    id: 'history',
    label: 'History and charts',
    keys: ['history.autoRecord', 'charts.dateUnit', 'charts.unitCount'],
  },
  {
    id: 'features',
    label: 'Pages',
    keys: [
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
    ],
  },
  {
    id: 'fire',
    label: 'FIRE (used from Stage 6)',
    keys: [
      'fire.birthYear',
      'fire.superContributionPerYearCents',
      'fire.inflationRate',
      'fire.withdrawalRate',
      'fire.preservationAge',
      'fire.yearlySpendOverrideCents',
    ],
  },
  {
    id: 'unused',
    label: 'Kept from the workbook (editable, not used by the app)',
    keys: [
      'goals.housePriceTargetCents',
      'goals.houseDepositRatio',
      'goals.houseSavingsPerYearCents',
      'investing.parcelFrequencyMonths',
      'investing.parcelAmountCents',
      'savings.includeRetirementContributions',
    ],
  },
] as const satisfies readonly { id: string; label: string; keys: readonly SettingKey[] }[];
export type SettingGroupId = (typeof SETTING_GROUPS)[number]['id'];

/** The group of a setting key (every key is in exactly one group). */
export function settingGroupOf(key: SettingKey): SettingGroupId {
  const group = SETTING_GROUPS.find((g) => (g.keys as readonly SettingKey[]).includes(key));
  if (!group) throw new RangeError(`Setting key in no group: ${key}`);
  return group.id;
}

/**
 * Display choices (D95, stage-5.md §3.3): an app edit of one never counts as app data, and a
 * re-import keeps the app value.
 */
export const PREFERENCE_SETTING_KEYS = [
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
] as const satisfies readonly SettingKey[];
export type PreferenceSettingKey = (typeof PREFERENCE_SETTING_KEYS)[number];

export function isPreferenceSettingKey(key: string): key is PreferenceSettingKey {
  return (PREFERENCE_SETTING_KEYS as readonly string[]).includes(key);
}

/**
 * Write-only bounds (`PATCH /api/settings` only; stage-5.md §3.3), on top of the registry. The
 * registry and `settingValueSchema` stay unchanged, so an imported value outside them still
 * imports. `charts.unitCount` takes the `count` query's range; the four ratios have no registry
 * bounds.
 */
export const SETTING_WRITE_BOUNDS: Readonly<
  Partial<Record<EditableSettingKey, { min: number; max: number }>>
> = {
  'charts.unitCount': { min: 1, max: 240 },
  'returns.cashInterestRate': { min: -1, max: 1 },
  'returns.marketReturn': { min: -1, max: 1 },
  'fire.inflationRate': { min: -1, max: 1 },
  'fire.withdrawalRate': { min: 0, max: 1 },
};

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
