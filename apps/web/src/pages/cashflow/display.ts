// Display helpers shared by the cash-flow pages (stage-3.md §6.3–6.6, §6.10): period and year
// labels, rate and trend text, status and advice words, kind and frequency labels, and the
// transfer headings. Pure functions, no React.
import type {
  AllocationAggressiveness,
  CashAccountKind,
  DecimalString,
  DividendSuggestionStatus,
  DrpAdvice,
  InstrumentKind,
  IsoDate,
  IsoMonth,
  KpiTrend,
  Origin,
  PayFrequency,
  SavingsPeriodStatus,
  YearBasis,
  YearWindowDto,
} from '@joinr/schema';
import {
  CHART_PALETTE,
  formatDate,
  formatFinancialYear,
  formatMoney,
  formatMonth,
  formatPercent,
  type StatDelta,
  type StatusKind,
} from '@joinr/ui';
import { formatTimeOrDate, parseTimestamp, plural } from '../../formatting';

// ─── Periods and years ──────────────────────────────────────────────────────────────────────────

/** A snapshot month: '2026-08' → "Aug 2026". */
export function periodLabel(periodMonth: IsoMonth): string {
  try {
    return formatMonth(periodMonth);
  } catch {
    return periodMonth;
  }
}

/** A year window's name: the FY basis → "FY2026–27", the calendar basis → "2026". */
export function yearLabel(year: Pick<YearWindowDto, 'basis' | 'year'>): string {
  return year.basis === 'fy' ? formatFinancialYear(year.year) : String(year.year);
}

/** The last day of a year window (its end is exclusive): "30 June 2027" style is left to callers. */
export function yearLastDay(year: Pick<YearWindowDto, 'end'>): IsoDate {
  const [y = 0, m = 1, d = 1] = year.end.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1, d - 1));
  return last.toISOString().slice(0, 10);
}

/** The calendar date after `today` ('YYYY-MM-DD'): the latest date a cash-flow entry accepts. */
export function tomorrowOf(today: IsoDate): IsoDate {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** A period's date span: "16/03/2021 – 15/04/2021". */
export function dateSpan(start: IsoDate, end: IsoDate): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export const YEAR_BASIS_LABELS: Readonly<Record<YearBasis, string>> = {
  fy: 'Financial year',
  calendar: 'Calendar year',
};

/** The status badge a savings period's first cell carries (the baseline and provisional rows). */
export function periodStatusBadge(
  status: SavingsPeriodStatus,
): { status: StatusKind; label: string } | null {
  if (status === 'provisional') return { status: 'pending', label: 'Provisional' };
  if (status === 'first') return { status: 'recorded', label: 'Baseline' };
  return null;
}

// ─── Rates, trends and money words ──────────────────────────────────────────────────────────────

/** A ratio at one decimal ("0.375" → "37.5%"); null → null. */
export function rateText(ratio: DecimalString | null): string | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  return Number.isFinite(value) ? formatPercent(value) : null;
}

/**
 * True when a savings rate needs a check: above 100 % or below 0 % (a one-off inflow or outflow,
 * D51). The badge links to a visible foot note.
 */
export function rateNeedsCheck(ratio: DecimalString | null): boolean {
  if (ratio === null) return false;
  const value = Number(ratio);
  return Number.isFinite(value) && (value > 1 || value < 0);
}

export const RATE_CHECK_NOTE =
  'Check: a one-off inflow or outflow usually causes a rate above 100 % or below 0 %; add an adjustment.';

/** The trend as percentage points per month: "−1.5 points / month", "+0.4 points / month". */
export function trendPointsText(trendPerMonth: DecimalString | null): string | null {
  if (trendPerMonth === null) return null;
  const value = Number(trendPerMonth);
  if (!Number.isFinite(value)) return null;
  const points = formatPercent(value, { signDisplay: 'always' }).replace('%', '');
  return `${points.replace(/^\+0\.0$|^−0\.0$/, '0.0')} points / month`;
}

export const TREND_WORDS: Readonly<Record<KpiTrend, string>> = {
  increasing: 'Increasing',
  decreasing: 'Decreasing',
  flat: 'Flat',
};

/** The trend tile's delta: an arrow and the word (a rising savings rate is good news). */
export function trendDelta(trend: KpiTrend | null): StatDelta | undefined {
  if (trend === null) return undefined;
  return {
    value: '',
    direction: trend === 'increasing' ? 'up' : trend === 'decreasing' ? 'down' : 'flat',
    text: TREND_WORDS[trend],
  };
}

/** "1 month", "7 months". */
export function monthsText(months: number): string {
  return plural(months, 'month');
}

/** "Covered" or "Short by $X" (the emergency-fund tile). */
export function emergencyFundStatus(fund: {
  covered: boolean | null;
  shortfallCents: number | null;
}): { status: StatusKind; label: string } | null {
  if (fund.covered === null) return null;
  if (fund.covered) return { status: 'go', label: 'Covered' };
  return {
    status: 'check',
    label: `Short by ${formatMoney(fund.shortfallCents ?? 0, { wholeDollars: true })}`,
  };
}

/** What the emergency-fund test counts, in words (D59, D56). */
export function emergencyFundBasisText(fund: {
  loansIncluded: boolean;
  offsetsIncluded: boolean;
}): string {
  const base = fund.loansIncluded
    ? 'Total cash'
    : "Total cash except loans you've made (credit cards and other accounts count)";
  return fund.offsetsIncluded ? `${base}, plus offsets` : base;
}

/** "About Mar 2027" for an estimated month. */
export function aboutMonth(date: IsoDate): string {
  return `About ${periodLabel(date.slice(0, 7))}`;
}

/** A signed amount with its word: surplus (≥ 0) or gap (< 0) per month. */
export function gapPerMonthText(cents: number): string {
  return cents >= 0
    ? `${formatMoney(cents)} a month ahead`
    : `${formatMoney(-cents)} a month behind`;
}

// ─── Labels ─────────────────────────────────────────────────────────────────────────────────────

export const CASH_KIND_LABELS: Readonly<Record<CashAccountKind, string>> = {
  bank: 'Bank account',
  credit_card: 'Credit card',
  loan_receivable: "Loan you've made",
  other: 'Other',
};

/** Account groups in page order: the four kinds, then offsets (never in Total cash). */
export type AccountGroupId = CashAccountKind | 'offset';

export const ACCOUNT_GROUPS: readonly { id: AccountGroupId; title: string }[] = [
  { id: 'bank', title: 'Bank accounts' },
  { id: 'credit_card', title: 'Credit cards' },
  { id: 'loan_receivable', title: "Loans you've made" },
  { id: 'other', title: 'Other' },
  { id: 'offset', title: 'Offset accounts (not in Total cash)' },
];

export function accountGroupOf(account: {
  kind: CashAccountKind;
  isOffset: boolean;
}): AccountGroupId {
  return account.isOffset ? 'offset' : account.kind;
}

/** "Workbook" for imported rows, "App" for rows entered here. */
export function sourceLabel(origin: Origin | null): string {
  return origin === 'app' ? 'App' : 'Workbook';
}

export const PAY_FREQUENCY_LABELS: Readonly<Record<PayFrequency, string>> = {
  monthly: 'Monthly',
  twice_monthly: 'Twice a month',
  fortnightly: 'Fortnightly',
  weekly: 'Weekly',
  four_weekly: 'Every four weeks',
};

/** The lowercase frequency word for prose: "fortnightly", "twice-monthly". */
export const PAY_FREQUENCY_WORDS: Readonly<Record<PayFrequency, string>> = {
  monthly: 'monthly',
  twice_monthly: 'twice-monthly',
  fortnightly: 'fortnightly',
  weekly: 'weekly',
  four_weekly: 'four-weekly',
};

/** "Payday transfers (fortnightly)"; without a pay frequency just "Payday transfers". */
export function transfersHeading(frequency: PayFrequency | null): string {
  return frequency === null
    ? 'Payday transfers'
    : `Payday transfers (${PAY_FREQUENCY_WORDS[frequency]})`;
}

export const AGGRESSIVENESS_WORDS: Readonly<Record<AllocationAggressiveness, string>> = {
  light: 'light',
  normal: 'normal',
  aggressive: 'aggressive',
};

/** Dividend holding kinds as the FY table's column headers. */
export const DIVIDEND_KIND_HEADERS: Readonly<Record<InstrumentKind, string>> = {
  etf: 'ETFs',
  stock: 'Stocks',
  managed_fund: 'Managed funds',
  crypto: 'Crypto staking',
};

/** One holding's kind, for the holding list and the ledger: "ETF", "Stock". */
export const HOLDING_KIND_LABELS: Readonly<Record<InstrumentKind, string>> = {
  etf: 'ETF',
  stock: 'Stock',
  managed_fund: 'Managed fund',
  crypto: 'Crypto',
};

/** The legend and table order of the dividend kinds (§5). */
export const DIVIDEND_KIND_LEGEND_ORDER: readonly InstrumentKind[] = [
  'etf',
  'stock',
  'managed_fund',
  'crypto',
];

/**
 * The stacking order (bottom to top, left to right): stocks, ETFs, managed funds, crypto, so the
 * ETF segment separates violet (stocks) from fuchsia (crypto) (§5, STYLE_GUIDE §6.1 known limit).
 */
export const DIVIDEND_KIND_SERIES_ORDER: readonly InstrumentKind[] = [
  'stock',
  'etf',
  'managed_fund',
  'crypto',
];

/** Each kind keeps one palette slot across both dividend charts: ETF 1, stocks 2, funds 3, crypto 4. */
export const DIVIDEND_KIND_COLORS: Readonly<Record<InstrumentKind, string>> = {
  etf: CHART_PALETTE[0] ?? '#07AE8B',
  stock: CHART_PALETTE[1] ?? '#7744DD',
  managed_fund: CHART_PALETTE[2] ?? '#EB6903',
  crypto: CHART_PALETTE[3] ?? '#D946EF',
};

export const DRP_ADVICE_BADGES: Readonly<Record<DrpAdvice, { status: StatusKind; label: string }>> =
  {
    switch_on: { status: 'check', label: 'Switch DRP on' },
    switch_off: { status: 'check', label: 'Switch DRP off' },
    keep: { status: 'go', label: 'Keep' },
  };

export const SUGGESTION_STATUS_WORDS: Readonly<Record<DividendSuggestionStatus, string>> = {
  due: 'Due',
  upcoming: 'Upcoming',
  dismissed: 'Dismissed',
};

/** Yes / No / Unknown for a nullable flag (Reinvested, DRP). */
export function yesNo(value: boolean | null): string {
  return value === null ? 'Unknown' : value ? 'Yes' : 'No';
}

/** "Every 3 months", "Every month", or null without a frequency. */
export function frequencyText(months: number | null): string | null {
  if (months === null || months <= 0) return null;
  return months === 1 ? 'Every month' : `Every ${months} months`;
}

// ─── Yahoo checks ───────────────────────────────────────────────────────────────────────────────

/** Days since a timestamp, by local calendar day (0 = today). Null when it does not parse. */
export function daysSince(timestamp: string | null, now: Date): number | null {
  const date = parseTimestamp(timestamp);
  if (!date) return null;
  const day = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(now) - day(date)) / 86_400_000);
}

/** Events older than this many days read "Yahoo last checked N days ago" (§6.10). */
export const EVENTS_STALE_DAYS = 7;

/** The freshness line under the Dividends header. */
export function eventsFreshnessText(
  events: { running: boolean; lastRefreshAt: string | null; instrumentsCovered: number },
  now: Date,
): string {
  if (events.running) return 'Checking Yahoo…';
  const when = formatTimeOrDate(events.lastRefreshAt, now);
  if (!when) return 'Yahoo not checked yet';
  const days = daysSince(events.lastRefreshAt, now);
  if (days !== null && days > EVENTS_STALE_DAYS) return `Yahoo last checked ${days} days ago`;
  return `Yahoo checked ${when} · ${plural(events.instrumentsCovered, 'holding')}`;
}

/** "Checked 4 holdings: 2 suggestions" (the check result callout). */
export function checkSummaryText(
  summary: { requested: number; ok: number },
  suggestions: number,
): string {
  return `Checked ${plural(summary.requested, 'holding')}: ${plural(suggestions, 'suggestion')}`;
}

/** A failed or partial run's counts: "1 holding failed; 2 skipped." */
export function checkProblemText(summary: { failed: number; skipped: number }): string | null {
  const parts: string[] = [];
  if (summary.failed > 0) parts.push(`${plural(summary.failed, 'holding')} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  return parts.length ? `${parts.join('; ')}.` : null;
}

// ─── Numbers ────────────────────────────────────────────────────────────────────────────────────

/** Σ of integer cents. */
export function sumCents(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Cents → dollars for a chart (null stays a gap). */
export function toDollars(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/** A decimal ratio as a chart number (null stays a gap). */
export function toRatio(ratio: DecimalString | null): number | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  return Number.isFinite(value) ? value : null;
}

/** True for a negative figure. */
export function isNegative(value: number | DecimalString | null): boolean {
  return value !== null && Number(value) < 0;
}
