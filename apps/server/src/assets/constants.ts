// Stage 4 server constants (stage-4.md §3.3, §4.5): the settings each assets page edits, the spot
// series of each metal and the error messages the mutations share.
import type { EditableSettingKey, Metal } from '@joinr/schema';

/** The settings the Super page edits (§3.3). `pay.jobStartDate` is on the Budget page too. */
export const SUPER_PAGE_SETTING_KEYS = [
  'pay.grossAnnualSalaryCents',
  'tax.marginalRate',
  'pay.jobStartDate',
  'super.sgRate',
  'super.contributionsTaxRate',
  'super.concessionalCapCents',
  'super.importedContributionType',
] as const satisfies readonly EditableSettingKey[];

/** The settings the Other Assets page edits (§3.3). */
export const OTHER_ASSETS_PAGE_SETTING_KEYS = [
  'otherAssets.stalePriceDays',
] as const satisfies readonly EditableSettingKey[];

/** The settings the Property page edits (§3.3). Both are on the Cash page too. */
export const PROPERTY_PAGE_SETTING_KEYS = [
  'savings.includeMortgagePrincipal',
  'property.offsetsIncludeEmergencyFund',
] as const satisfies readonly EditableSettingKey[];

/** The AUD spot series of each metal (§4.5; the price service's derived series). */
export const SPOT_SERIES_BY_METAL: Readonly<Record<Metal, string>> = {
  silver: 'XAG_AUD_OZ',
  gold: 'XAU_AUD_OZ',
};

/** The spot tiles' order (§4.4: silver, then gold, always both). */
export const SPOT_METALS: readonly Metal[] = ['silver', 'gold'];

/** The spot history charts start at most this many months before the as-of date (§4.6 item 6). */
export const SPOT_HISTORY_MONTHS = 12;

/** The super entry kinds that are member contributions (never SG, never a reported gain). */
export const SUPER_CONTRIBUTION_KINDS = [
  'voluntary_contribution',
  'salary_sacrifice',
  'after_tax',
] as const;
export type SuperContributionKind = (typeof SUPER_CONTRIBUTION_KINDS)[number];
