// SETTING_READERS (stage-5.md §4.5 "Settings", §6.5 item 9, D86): the pages that read each setting,
// by page id (apps/web's `PAGES`), so the Settings page can link back ("Used on Budget, Cash"). A
// page that edits a key in its own settings section always reads it (a test checks every page
// setting-key constant against this map). The six workbook keys the app does not use (D91), the
// page switches (navigation only) and the FIRE keys (Stage 6) are read by no page yet.
import type { SettingKey } from '@joinr/schema';

/** The page ids `usedOn` may name (apps/web `PAGES`). */
export const SETTING_READER_PAGES = [
  'net-worth',
  'history',
  'stocks',
  'etfs',
  'managed-funds',
  'crypto',
  'cash',
  'side-income',
  'dividends',
  'budget',
  'other-assets',
  'super',
  'property',
  'fire',
] as const;
export type SettingReaderPage = (typeof SETTING_READER_PAGES)[number];

/** The investment pages: their timing block reads the budget, pay and allocation settings. */
const INVESTMENT_PAGES = ['stocks', 'etfs', 'managed-funds', 'crypto'] as const;

/** Every page with a chart that follows `charts.dateUnit` and `charts.unitCount`. */
const CHART_PAGES = [
  'net-worth',
  'history',
  ...INVESTMENT_PAGES,
  'cash',
  'side-income',
  'other-assets',
  'super',
  'property',
] as const;

const ALLOCATION_READERS = [...INVESTMENT_PAGES, 'net-worth'] as const;

/** Page ids per key, in `PAGES` order (a key read by no page has []). */
export const SETTING_READERS: Readonly<Record<SettingKey, readonly SettingReaderPage[]>> = {
  'pay.dayOfMonth': ['budget', ...INVESTMENT_PAGES],
  'budget.useForInvestAmount': [...INVESTMENT_PAGES, 'budget'],
  'pay.grossAnnualSalaryCents': ['super'],
  'goals.housePriceTargetCents': [],
  'goals.cashSavingsTargetCents': ['cash'],
  'pay.frequency': ['net-worth', ...INVESTMENT_PAGES, 'cash', 'budget'],
  'pay.netPayCents': ['net-worth', ...INVESTMENT_PAGES, 'cash', 'budget'],
  'pay.jobStartDate': ['cash', 'budget', 'super'],
  'returns.cashInterestRate': [...INVESTMENT_PAGES],
  'investing.defaultBrokerageCents': [...INVESTMENT_PAGES],
  'investing.allocationAggressiveness': [...INVESTMENT_PAGES, 'budget'],
  'allocation.etf': ALLOCATION_READERS,
  'allocation.stock': ALLOCATION_READERS,
  'allocation.crypto': ALLOCATION_READERS,
  'allocation.cash': [...ALLOCATION_READERS, 'budget'],
  'goals.houseSavingsPerYearCents': [],
  'allocation.managedFund': ALLOCATION_READERS,
  'goals.eoyCashGoalCents': ['cash'],
  'returns.marketReturn': [...INVESTMENT_PAGES],
  'tax.marginalRate': ['budget', 'super'],
  'goals.houseDepositRatio': [],
  'goals.houseDepositInvestmentShare': ['cash'],
  'budget.emergencyFundMonths': [...INVESTMENT_PAGES, 'cash', 'budget'],
  'budget.autoInvestSplit': [...INVESTMENT_PAGES, 'budget'],
  'crypto.feeRate': ['crypto'],
  'savings.includeMortgagePrincipal': ['net-worth', 'cash', 'property'],
  'allocation.otherAssets': ALLOCATION_READERS,
  'savings.includeRetirementContributions': [],
  'property.offsetsIncludeEmergencyFund': [...INVESTMENT_PAGES, 'cash', 'budget', 'property'],
  'investing.parcelFrequencyMonths': [],
  'investing.parcelAmountCents': [],
  'investing.etfLimit': ['etfs'],
  'budget.includeSideIncome': [...INVESTMENT_PAGES, 'budget'],
  'budget.emergencyFundOverrideCents': [...INVESTMENT_PAGES, 'cash', 'budget'],
  'charts.dateUnit': CHART_PAGES,
  'charts.unitCount': CHART_PAGES,
  'features.cash': [],
  'features.etfs': [],
  'features.stocks': [],
  'features.managedFunds': [],
  'features.fire': [],
  'features.budget': [],
  'features.crypto': [],
  'features.otherAssets': [],
  'features.property': [],
  'features.sideIncome': [],
  'features.retirement': [],
  'fire.birthYear': [],
  'fire.superContributionPerYearCents': [],
  'fire.inflationRate': [],
  'fire.withdrawalRate': [],
  'fire.preservationAge': [],
  'fire.yearlySpendOverrideCents': [],
  'savings.yearBasis': ['net-worth', 'history', 'cash'],
  'otherAssets.stalePriceDays': ['other-assets'],
  'super.sgRate': ['super'],
  'super.contributionsTaxRate': ['super'],
  'super.concessionalCapCents': ['super'],
  'super.concessionalCapFy': ['super'],
  'super.importedContributionType': ['super'],
  'history.autoRecord': ['history'],
};

/** The readers of a key in `PAGES` order (a fresh array for a DTO). */
export function settingReaders(key: SettingKey): string[] {
  const readers = new Set<string>(SETTING_READERS[key]);
  return SETTING_READER_PAGES.filter((p) => readers.has(p));
}
