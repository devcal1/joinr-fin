// The Super page's one open editor (stage-4.md §6.7), the row-action keys focus returns to, and the
// page's words (§6.4, §6.9). No components (react-refresh).
import {
  SUPER_CONTRIBUTION_TYPES,
  type DecimalString,
  type EditableSettingKey,
  type IsoMonth,
  type PeriodNoteDto,
  type SuperBalanceEntryDto,
  type SuperCapYearDto,
  type SuperContributionDto,
  type SuperContributionType,
  type SuperFundDto,
  type SuperPageResponse,
  type SuperPeriodDto,
  type SuperSgMonthDto,
} from '@joinr/schema';
import { formatDate, formatFinancialYear, formatMoney } from '@joinr/ui';
import { plural } from '../../formatting';
import { formatRate, percentText, type MarkerId } from '../assets/display';

export type SuperEditor =
  | { form: 'fund'; fund?: SuperFundDto; opener: string }
  | { form: 'balances'; opener: string }
  | { form: 'entry'; entry: SuperBalanceEntryDto; opener: string }
  | { form: 'contribution'; contribution?: SuperContributionDto; opener: string }
  | { form: 'statement'; month: SuperSgMonthDto; opener: string }
  | { form: 'note'; periodMonth?: IsoMonth; note?: PeriodNoteDto; opener: string }
  | { form: 'settings'; opener: string };

/** The Super page's settings (§3.3, §6.4 item 7), in the order the page lists them. */
export const SUPER_SETTING_KEYS: readonly EditableSettingKey[] = [
  'pay.grossAnnualSalaryCents',
  'tax.marginalRate',
  'pay.jobStartDate',
  'super.sgRate',
  'super.contributionsTaxRate',
  'super.concessionalCapCents',
  'super.importedContributionType',
];

export function fundActionKey(action: 'edit' | 'history', id: number): string {
  return `fund-${action}-${id}`;
}

export function entryActionKey(action: 'edit' | 'delete', id: number): string {
  return `super-entry-${action}-${id}`;
}

export function contributionActionKey(action: 'edit' | 'delete', id: number): string {
  return `contribution-${action}-${id}`;
}

export function sgActionKey(action: 'statement' | 'remove', month: string): string {
  return `sg-${action}-${month}`;
}

export function noteActionKey(month: string): string {
  return `super-note-${month}`;
}

export const NO_FUNDS = 'No super funds yet.';
export const NO_SALARY = 'Set your gross salary in Settings for this page to estimate employer SG.';
export const NO_SG_FUND = 'Choose the fund that receives employer SG.';
export const SG_FUND_KEPT = 'Choosing the SG fund keeps re-import available';
export const NO_MARGINAL_RATE =
  'Set your marginal tax rate in Settings for this page: salary-sacrifice contributions are left out of your savings rate until then, and imported contributions are not grossed up.';
export const NOT_UPDATED_NOTE =
  'Balances have not been updated since the last recorded month, so this month’s gain is not shown yet.';
export const STATEMENT_KEPT = 'Statement figures are kept when you re-import';
export const GAINS_FOOTNOTE =
  'Gains are derived: the change in balance minus employer SG and your contributions after contributions tax, and minus money moved in from outside. A month whose balance was not updated is merged into the next.';
export const RETURN_FOOTNOTE = 'Return per year chains each period’s Modified Dietz return.';
export const MERGED_NOTE = 'Merged into the next month';
export const SG_TRANSITION_NOTE =
  'Includes the April–June 2026 quarter’s SG, due by 28 July 2026 (the switch to Payday Super): the ATO counts a contribution in the year your fund receives it.';
export const SG_QUARTERLY_NOTE =
  'SG is counted at its quarterly due date; if your employer paid earlier, some may belong to the year before.';
export const ROLLOVER_HINT = 'Off: the opening balance is money you already had, not a gain';
export const ARCHIVE_HINT = 'Enter a closing balance of $0 first (after a rollover)';
export const SG_SWITCH_HINT = 'Only one fund at a time: choosing it here clears the others';
export const TRANSFER_HINT = 'Money moved in from a fund not on this page; not a gain';

/** The words for a contribution type (the form's choice). */
export const CONTRIBUTION_TYPE_LABELS: Readonly<Record<SuperContributionType, string>> = {
  salary_sacrifice: 'Salary sacrifice',
  after_tax: 'After-tax',
};

export const CONTRIBUTION_TYPES = SUPER_CONTRIBUTION_TYPES;

/** How imported (untyped) contributions are read (`super.importedContributionType`, D75). */
export function importedReadingOf(
  page: Pick<SuperPageResponse, 'settings'>,
): SuperContributionType {
  const value = page.settings.values['super.importedContributionType'];
  return value === 'after_tax' ? 'after_tax' : 'salary_sacrifice';
}

/** The marginal tax rate setting, or null. */
export function marginalRateOf(page: Pick<SuperPageResponse, 'settings'>): DecimalString | null {
  const value = page.settings.values['tax.marginalRate'];
  return typeof value === 'string' ? value : null;
}

/** "N imported contributions have no type: counted as …. Change this in Settings for this page." */
export function importedText(page: SuperPageResponse): string {
  const count = page.contributions.filter((c) => c.estimate).length;
  const reading =
    importedReadingOf(page) === 'after_tax'
      ? 'after-tax'
      : 'salary sacrifice, grossed up at your marginal tax rate';
  return `${count === 1 ? '1 imported contribution has' : `${count} imported contributions have`} no type: counted as ${reading}. Change this in Settings for this page.`;
}

/** The latest valuation period (with a gain), newest first; the provisional one when updated. */
export function latestGainPeriod(page: SuperPageResponse): SuperPeriodDto | null {
  return page.periods.find((p) => p.gainCents !== null) ?? null;
}

/** The provisional period, when the page has one. */
export function provisionalPeriod(page: SuperPageResponse): SuperPeriodDto | null {
  return page.periods.find((p) => p.status === 'provisional') ?? null;
}

/** The latest balance date of the funds held. */
export function latestBalanceDate(funds: readonly SuperFundDto[]): string | null {
  const dates = funds
    .filter((f) => !f.archived)
    .map((f) => f.balanceAsOf)
    .filter((d): d is string => d !== null);
  return dates.sort().at(-1) ?? null;
}

/**
 * Where the provisional gain is measured to (D79): the oldest latest balance of the funds held. The
 * engine counts SG and contributions only up to it; later ones wait for the next balance update.
 */
export function gainMeasuredTo(funds: readonly SuperFundDto[]): string | null {
  const dates = funds
    .filter((f) => !f.archived)
    .map((f) => f.balanceAsOf)
    .filter((d): d is string => d !== null);
  return dates.sort()[0] ?? null;
}

/** True when the cap year is the Payday Super transition year (it counts Apr–Jun 2026's SG). */
export function isTransitionYear(
  year: Pick<SuperCapYearDto, 'financialYear'>,
  paydaySuperStart: string,
): boolean {
  return year.financialYear === Number(paydaySuperStart.slice(0, 4));
}

/** "ATO figure for FY2026–27, checked 26/09/2026" or "Set by you for FY2026–27". */
export function capSourceText(year: SuperCapYearDto, checkedOn: string): string {
  const fy = formatFinancialYear(year.financialYear);
  return year.capSource === 'setting'
    ? `Set by you for ${fy}`
    : `ATO figure for ${fy}, checked ${formatDate(checkedOn)}`;
}

/** An FY after the statutory table uses its last entry: "check the ATO cap for FY2027–28". */
export function capBeyondTable(page: SuperPageResponse, year: SuperCapYearDto): string | null {
  if (year.capSource !== 'statutory') return null;
  const last = Math.max(...page.statutory.caps.map((c) => c.financialYear));
  return year.financialYear > last
    ? `Check the ATO cap for ${formatFinancialYear(year.financialYear)}`
    : null;
}

const OVER_CAP_TAX = 'Contributions over the cap are taxed at your marginal rate.';

/**
 * The near / over callout (one decimal, STYLE_GUIDE §8): near → "On track for 93.3% of the
 * concessional cap by 30 June. …"; over already → "Over the concessional cap by $X already. …";
 * projected over → "On track to go over the concessional cap by 30 June (104.2% of it). …".
 */
export function capWarningText(year: SuperCapYearDto): string | null {
  if (year.status === 'under') return null;
  const share = percentText(year.projectedRatio) ?? '—';
  if (year.status === 'near') {
    return `On track for ${share} of the concessional cap by 30 June. ${OVER_CAP_TAX}`;
  }
  if (year.totalCents > year.capCents) {
    return `Over the concessional cap by ${formatMoney(year.totalCents - year.capCents)} already. ${OVER_CAP_TAX}`;
  }
  return `On track to go over the concessional cap by 30 June (${share} of it). ${OVER_CAP_TAX}`;
}

/** The contribution form's hint naming the rates in use. */
export function contributionRatesHint(
  type: SuperContributionType,
  marginal: DecimalString | null,
  contributionsTax: DecimalString,
): string {
  if (type === 'after_tax') return 'Paid from your take-home pay; the fund receives it in full';
  if (marginal === null) return 'Set your marginal tax rate to see the take-home cost';
  return `Take-home cost at your ${formatRate(marginal) ?? ''} marginal rate; the fund receives it less ${formatRate(contributionsTax) ?? ''} contributions tax`;
}

/** The markers of a contribution row (Type cell: Estimate; Period cell: Provisional). */
export function contributionMarkers(c: SuperContributionDto): MarkerId[] {
  const ids: MarkerId[] = [];
  if (c.estimate) ids.push('estimate');
  if (c.provisional) ids.push('provisional');
  return ids;
}

/** The markers of a super period row (Provisional / Baseline / Not updated). */
export function periodMarkers(p: SuperPeriodDto): MarkerId[] {
  const ids: MarkerId[] = [];
  if (p.status === 'provisional') ids.push('provisional');
  if (p.status === 'first') ids.push('baseline');
  if (p.notUpdated) ids.push('notUpdated');
  return ids;
}

/** True when a valuation period's window was merged (it starts before the previous run date). */
export function isMerged(p: SuperPeriodDto): boolean {
  return p.gainFrom !== null && p.after !== null && p.gainFrom !== p.after;
}

/** The SG months' markers: Statement or Estimate (a none month has none). */
export function sgMarkers(month: SuperSgMonthDto): MarkerId[] {
  if (month.source === 'statement') return ['statement'];
  if (month.source === 'estimate') return ['estimate'];
  return [];
}

/** True when every SG month is an estimate: the column carries one foot-noted marker. */
export function allEstimates(months: readonly SuperSgMonthDto[]): boolean {
  return months.length > 0 && months.every((m) => m.source === 'estimate');
}

/** The months a super-option note may take: the as-of month back 24 months, and older noted ones. */
export function noteMonths(page: SuperPageResponse): IsoMonth[] {
  const [y = 0, m = 1] = page.asOf.split('-').map(Number);
  const months = new Set<IsoMonth>();
  for (let i = 0; i < 24; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  for (const note of page.notes) months.add(note.periodMonth);
  for (const period of page.periods) months.add(period.periodMonth);
  return [...months]
    .filter((month) => month <= page.asOf.slice(0, 7))
    .sort()
    .reverse();
}

/** "2 funds", "1 fund". */
export function fundsText(count: number): string {
  return plural(count, 'fund');
}
