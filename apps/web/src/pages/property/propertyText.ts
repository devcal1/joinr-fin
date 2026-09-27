// The Property page's one open editor (stage-4.md §6.7), the row-action keys focus returns to, and
// the page's words and small models (§6.5, §6.9, D66–D68, D76): the estimated repayments the web
// shows as a placeholder (the engine's own payment grid, `paymentDatesBetween`), the payoff tile,
// the loan log's markers and the callouts' counts. No components (react-refresh).
import {
  paymentDatesBetween,
  type AmortisationDto,
  type EditableSettingKey,
  type IsoDate,
  type LoanBalanceEntryDto,
  type LoanDto,
  type LoanFlag,
  type PaymentFrequency,
  type PropertyDto,
  type PropertyPageResponse,
} from '@joinr/schema';
import { CHART_PALETTE, formatMoney } from '@joinr/ui';
import { plural } from '../../formatting';
import {
  durationText,
  monthsSoonerText,
  payoffMissingText,
  payoffText,
  wholeMonthsBetween,
  type MarkerId,
} from '../assets/display';

export type PropertyEditor =
  | { form: 'property'; property?: PropertyDto; opener: string }
  | { form: 'values'; opener: string }
  | { form: 'loan'; loan?: LoanDto; opener: string }
  | { form: 'loanBalances'; opener: string }
  | { form: 'loanEntry'; loan: LoanDto; entry?: LoanBalanceEntryDto; opener: string }
  | { form: 'offsets'; loan: LoanDto; opener: string }
  | { form: 'settings'; opener: string };

export function propertyActionKey(action: 'edit' | 'valuations', id: number): string {
  return `property-${action}-${id}`;
}

export function loanActionKey(action: 'edit' | 'update' | 'offsets', id: number): string {
  return `loan-${action}-${id}`;
}

export function loanEntryActionKey(action: 'edit' | 'delete', id: number): string {
  return `loan-entry-${action}-${id}`;
}

export function valuationActionKey(id: number): string {
  return `valuation-delete-${id}`;
}

export const NO_PROPERTIES = 'No properties yet.';
export const NO_MORTGAGE = 'No mortgage on this property.';
export const NO_LOANS = 'No loans yet. Add a loan to track its balance, interest and payoff date.';
export const DEFAULT_REPAYMENTS_NOTE =
  'Interest and fees are estimated from your repayments: the regular payment × the payments due. Enter the actual repayments on an entry to replace the estimate.';
export const PAYMENT_BELOW_INTEREST_NOTE =
  'The repayment does not cover the interest, so this loan never pays off at this rate.';
export const REPAYMENT_CHANGE_NOTE =
  'Changing the repayment re-estimates every entry without entered repayments. Enter the actual repayments on past entries to keep them.';
export const PRIMARY_RESIDENCE_NOTE = 'Counted in net worth; the FIRE planner leaves it out';
export const CHECK_FOOTNOTE =
  'The estimated repayments are below the principal repaid: enter the actual repayments for that period.';
export const BALANCE_INCREASED_NOTE = 'Balance went up (a redraw or added costs)';
export const PAST_POINTS_NOTE =
  'Past points come from your recorded months; the last point is live.';
export const OFFSET_POINTS_NOTE =
  'Past points are before offsets; the live point is net of your offsets.';
export const NO_OFFSET_ACCOUNTS = 'Mark an account as an offset on the Cash page first';
export const NET_RENT_HINT = 'Rent less costs, to date; may be negative';
export const REPAYMENTS_EMPTY_HINT = 'Leave empty to use the estimate';

/** The flags that stop a schedule, and the field each names (§6.5 item 3). */
const MISSING_FIELD_WORDS: Partial<Record<LoanFlag, string>> = {
  no_rate: 'interest rate',
  no_payment: 'repayment amount',
  no_compounding: 'compounding frequency',
};

/** "Example mortgage has no interest rate, so no payoff date is shown. Edit the loan to add it." */
export function missingFieldTexts(loans: readonly LoanDto[]): string[] {
  return loans.flatMap((loan) =>
    (['no_rate', 'no_payment', 'no_compounding'] as const)
      .filter((flag) => loan.flags.includes(flag))
      .map(
        (flag) =>
          `${loan.name} has no ${MISSING_FIELD_WORDS[flag] ?? flag}, so no payoff date is shown. Edit the loan to add it.`,
      ),
  );
}

/** "2 loans are not linked to a property. The app tracks mortgages only." */
export function loansWithoutPropertyText(count: number): string {
  return `${count === 1 ? '1 loan is' : `${count} loans are`} not linked to a property. The app tracks mortgages only.`;
}

/** "1 offset account is not linked to a loan: link it to lower the interest estimate." */
export function unlinkedOffsetText(count: number): string {
  return count === 1
    ? '1 offset account is not linked to a loan: link it to lower the interest estimate and bring the payoff date forward.'
    : `${count} offset accounts are not linked to a loan: link them to lower the interest estimate and bring the payoff date forward.`;
}

/** Mortgages first (by property order, as the DTO lists them), then loans without a property. */
export function mortgagesOf(page: Pick<PropertyPageResponse, 'loans'>): LoanDto[] {
  return page.loans.filter((l) => l.propertyId !== null);
}

/** A loan's log, oldest first: the start point (when the start fields give one) leads. */
export function loanLog(
  page: Pick<PropertyPageResponse, 'loanEntries'>,
  loanId: number,
): LoanBalanceEntryDto[] {
  return page.loanEntries
    .filter((e) => e.loanId === loanId)
    .sort((a, b) =>
      a.asOf === b.asOf ? Number(b.start) - Number(a.start) : a.asOf < b.asOf ? -1 : 1,
    );
}

/** True when an entry's repayments are the default estimate (not entered, not the start). */
export function isEstimatedRepayment(entry: LoanBalanceEntryDto): boolean {
  return !entry.start && !entry.repaymentsTyped && entry.repaymentsCents !== null;
}

/** The markers of a loan log row (UX-12): Loan start, Estimate (a default repayment), Check. */
export function loanEntryMarkers(entry: LoanBalanceEntryDto, estimateColumn = false): MarkerId[] {
  const ids: MarkerId[] = [];
  if (entry.start) ids.push('loanStart');
  if (!estimateColumn && isEstimatedRepayment(entry)) ids.push('estimate');
  if (entry.flags.includes('repayments_below_principal')) ids.push('check');
  return ids;
}

/** True when any stored entry uses the default repayments (the D66 callout). */
export function anyDefaultRepayments(page: Pick<PropertyPageResponse, 'loanEntries'>): boolean {
  return page.loanEntries.some(isEstimatedRepayment);
}

/** Offset accounts linked to no loan. */
export function unlinkedOffsets(page: Pick<PropertyPageResponse, 'offsetAccounts'>) {
  return page.offsetAccounts.filter((a) => a.linkedLoanId === null);
}

export interface RepaymentEstimate {
  payments: number;
  cents: number | null;
}

/**
 * The repayments the engine would assume for a new entry at `asOf` (UX-7): the loan's payment
 * dates in (previous point, asOf] × its regular payment. The previous point is the latest log
 * point strictly before `asOf` (the start point included); none → no payments.
 */
export function estimateRepayments(
  loan: Pick<LoanDto, 'paymentAnchorDate' | 'paymentFrequency' | 'paymentCents'>,
  log: readonly Pick<LoanBalanceEntryDto, 'asOf'>[],
  asOf: IsoDate,
): RepaymentEstimate {
  const previous = log
    .map((e) => e.asOf)
    .filter((date) => date < asOf)
    .sort()
    .at(-1);
  if (!previous) return { payments: 0, cents: loan.paymentCents === null ? null : 0 };
  const payments = paymentDatesBetween(
    loan.paymentAnchorDate,
    loan.paymentFrequency,
    previous,
    asOf,
  ).length;
  return { payments, cents: loan.paymentCents === null ? null : payments * loan.paymentCents };
}

/**
 * "Estimated 8,400.00 (3 payments)" (the money field already shows the "$", so the placeholder
 * leaves it out); without a regular payment "No regular repayment to estimate".
 */
export function estimatePlaceholder(estimate: RepaymentEstimate): string {
  if (estimate.cents === null) return 'No regular repayment to estimate';
  const amount = formatMoney(estimate.cents).replace(/^\$/, '');
  return `Estimated ${amount} (${plural(estimate.payments, 'payment')})`;
}

/** An existing entry's default: its counted payments × the regular payment. */
export function entryEstimate(
  loan: Pick<LoanDto, 'paymentCents'>,
  entry: Pick<LoanBalanceEntryDto, 'paymentsCounted'>,
): RepaymentEstimate {
  const payments = entry.paymentsCounted ?? 0;
  return { payments, cents: loan.paymentCents === null ? null : payments * loan.paymentCents };
}

export const PAYMENT_FREQUENCY_CHOICES: readonly PaymentFrequency[] = [
  'weekly',
  'fortnightly',
  'monthly',
];

/** The Paid off tile (§6.5 item 2): the latest payoff of the mortgages, or "—" with the reason. */
export function payoffTile(page: Pick<PropertyPageResponse, 'loans' | 'asOf'>): {
  value: string;
  hint: string;
} {
  const mortgages = page.loans.filter((l) => l.propertyId !== null);
  if (mortgages.length === 0) return { value: '—', hint: 'No mortgage' };
  const paid = mortgages.filter((l) => l.schedule?.payoffDate);
  if (paid.length === 0) {
    const reason = mortgages.map((l) => payoffMissingText(l.flags)).find((t) => t !== null);
    return { value: '—', hint: reason ?? 'No payoff date' };
  }
  const latest = [...paid].sort((a, b) =>
    (a.schedule?.payoffDate ?? '') < (b.schedule?.payoffDate ?? '') ? 1 : -1,
  )[0];
  const date = latest?.schedule?.payoffDate ?? page.asOf;
  const { month, inText } = payoffText(date, page.asOf);
  const parts: string[] = [inText];
  if (mortgages.length > 1) parts.push(`the latest of ${plural(mortgages.length, 'loan')}`);
  const missing = mortgages.length - paid.length;
  if (missing > 0) parts.push(`${missing} without a payoff date`);
  if (mortgages.length === 1 && latest && latest.monthsSaved !== null && latest.monthsSaved > 0) {
    parts.push(monthsSoonerText(latest.monthsSaved));
  }
  return { value: month, hint: parts.join(' · ') };
}

/** "In 19 years 3 months" from the as-of date to a payoff date. */
export function payoffIn(asOf: IsoDate, payoffDate: IsoDate): string {
  return `In ${durationText(wholeMonthsBetween(asOf, payoffDate))}`;
}

// ─── Settings and charts ────────────────────────────────────────────────────────────────────────

/** The Property page's settings (§3.3, §6.5 item 7): workbook keys, also on the Cash page. */
export const PROPERTY_SETTING_KEYS: readonly EditableSettingKey[] = [
  'savings.includeMortgagePrincipal',
  'property.offsetsIncludeEmergencyFund',
];

/** The Value and purchase price chart's series, in slot order: Value 1, Purchase price 2 (§5). */
export const VALUE_SERIES = [
  { name: 'Value', color: CHART_PALETTE[0] },
  { name: 'Purchase price', color: CHART_PALETTE[1] },
] as const;

/** The payoff projection's series, in slot order: with the offset 1, without it 2 (§5). */
export const PAYOFF_SERIES = {
  with: { name: 'With your offset', color: CHART_PALETTE[0] },
  without: { name: 'Without the offset', color: CHART_PALETTE[1] },
} as const;

/** The repaid-so-far series, in slot order: Principal slot 1, Interest and fees slot 2 (§5). */
export const REPAID_SERIES = {
  principal: { name: 'Principal', color: CHART_PALETTE[0] },
  interest: { name: 'Interest and fees', color: CHART_PALETTE[1] },
} as const;

export interface ProjectionRow {
  date: IsoDate;
  withCents: number | null;
  withoutCents: number | null;
}

/**
 * The two schedules' yearly points on one date axis. After a schedule's payoff date its balance is
 * 0 (repaid); a date inside its range that it has no point for (the other schedule's payoff) is
 * null: the table shows "—" and the chart bridges it (`bridgeGaps`).
 */
export function projectionRows(
  schedule: AmortisationDto | null,
  without: AmortisationDto | null,
): ProjectionRow[] {
  const dates = new Set<string>();
  for (const p of schedule?.points ?? []) dates.add(p.date);
  for (const p of without?.points ?? []) dates.add(p.date);
  const at = (s: AmortisationDto | null, date: string): number | null => {
    if (!s || s.points.length === 0) return null;
    const point = s.points.find((p) => p.date === date);
    if (point) return point.balanceCents;
    return s.payoffDate !== null && date > s.payoffDate ? 0 : null;
  };
  return [...dates].sort().map((date) => ({
    date,
    withCents: at(schedule, date),
    withoutCents: at(without, date),
  }));
}

/**
 * A chart series with its inner gaps bridged by straight lines between the neighbouring points
 * (by date), so a line never breaks where only the other schedule has a point. Leading and
 * trailing gaps stay gaps. Display only: the table keeps the gaps.
 */
export function bridgeGaps(
  dates: readonly IsoDate[],
  values: readonly (number | null)[],
): (number | null)[] {
  const day = (iso: IsoDate): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  return values.map((value, i) => {
    if (value !== null) return value;
    let before = i - 1;
    while (before >= 0 && values[before] === null) before -= 1;
    let after = i + 1;
    while (after < values.length && values[after] === null) after += 1;
    const a = values[before];
    const b = values[after];
    const da = dates[before];
    const db = dates[after];
    const d = dates[i];
    if (before < 0 || after >= values.length || a == null || b == null || !da || !db || !d) {
      return null;
    }
    const t = (day(d) - day(da)) / (day(db) - day(da));
    return a + (b - a) * t;
  });
}

/** The latest valuation date across the properties. */
export function latestValuationDate(properties: readonly PropertyDto[]): IsoDate | null {
  return (
    properties
      .map((p) => p.valuationDate)
      .sort()
      .at(-1) ?? null
  );
}
