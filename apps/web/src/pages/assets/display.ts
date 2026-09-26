// Display helpers shared by the Other Assets, Super and Property pages (stage-4.md §6.1, §6.3–6.5):
// the status markers (defined once, UX-12), rate words (`formatRate`, UX-15), payment and
// compounding frequencies, the payoff text, the FX line, the short name of a URL-named item, the
// cap status words and a few number helpers. Pure functions, no React.
import {
  ANNUALISED_MIN_DAYS,
  percentTextFromRatio,
  ratioFromPercentText,
  type DecimalString,
  type IsoDate,
  type LoanFlag,
  type PaymentFrequency,
  type SuperCapStatus,
  type UnitOfMeasure,
} from '@joinr/schema';
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
  formatQuantity,
  type PillTone,
  type StatusKind,
  type StatusTone,
} from '@joinr/ui';
import { plural } from '../../formatting';

// ─── Status markers (§6.1 UX-12: defined once) ──────────────────────────────────────────────────

export type MarkerId =
  | 'assumed'
  | 'estimate'
  | 'statement'
  | 'noPriceYet'
  | 'stale'
  | 'spot'
  | 'lastKnown'
  | 'provisional'
  | 'baseline'
  | 'notUpdated'
  | 'check'
  | 'loanStart';

export type MarkerSpec =
  | { kind: 'badge'; status: StatusKind; label: string }
  | { kind: 'pill'; tone: PillTone; label: string };

/**
 * Every state marker the assets pages show. Assumed and Estimate are `pending` (one word,
 * "Estimate", everywhere); Statement is `recorded`; an unpriced item is a not-applicable pill "No
 * price yet" (not the red "No price" of the price pages). Other Assets rows never show "Manual".
 */
export const MARKERS: Readonly<Record<MarkerId, MarkerSpec>> = {
  assumed: { kind: 'badge', status: 'pending', label: 'Assumed' },
  estimate: { kind: 'badge', status: 'pending', label: 'Estimate' },
  statement: { kind: 'badge', status: 'recorded', label: 'Statement' },
  noPriceYet: { kind: 'pill', tone: 'na', label: 'No price yet' },
  stale: { kind: 'badge', status: 'stale', label: 'Stale' },
  spot: { kind: 'badge', status: 'fresh', label: 'Spot' },
  lastKnown: { kind: 'badge', status: 'stale', label: 'Last known' },
  provisional: { kind: 'badge', status: 'pending', label: 'Provisional' },
  baseline: { kind: 'badge', status: 'recorded', label: 'Baseline' },
  notUpdated: { kind: 'badge', status: 'pending', label: 'Not updated' },
  check: { kind: 'badge', status: 'check', label: 'Check' },
  loanStart: { kind: 'pill', tone: 'teal', label: 'Loan start' },
};

// ─── Rates and percentages ──────────────────────────────────────────────────────────────────────

/**
 * An interest, SG, contributions-tax or marginal rate as lenders and the ATO quote them (UX-15, an
 * explicit exception to one decimal): up to 2 dp, trailing zeros dropped ("0.0589" → "5.89%",
 * "0.12" → "12%", "0.115" → "11.5%"). Use it only for those rates; other percentages keep one
 * decimal. Null → null.
 */
export function formatRate(ratio: DecimalString | null): string | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  if (!Number.isFinite(value)) return null;
  return formatPercent(value, { dp: 2 }).replace(/\.?0+%$/, '%');
}

/** A percentage with one decimal ("0.085" → "8.5%"); null → null. */
export function percentText(ratio: DecimalString | null): string | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  return Number.isFinite(value) ? formatPercent(value) : null;
}

/** A ratio in prose with no trailing ".0": 0.93 → "93%", 0.935 → "93.5%". */
export function percentWords(ratio: DecimalString | number): string {
  return formatPercent(Number(ratio)).replace(/\.0%$/, '%');
}

/** True when an annualised figure is hidden: held for fewer than 90 days (the Stage 2 rule). */
export function annualisedHidden(days: number | null): boolean {
  return days !== null && days < ANNUALISED_MIN_DAYS;
}

export const HELD_UNDER_90_DAYS = 'Held under 90 days';
export const NEEDS_90_DAYS = 'Needs 90 days of history';

// ─── Frequencies ────────────────────────────────────────────────────────────────────────────────

export const PAYMENT_FREQUENCY_LABELS: Readonly<Record<PaymentFrequency, string>> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
};

/** The lowercase word for prose: "$2,800.00 monthly". */
export const PAYMENT_FREQUENCY_WORDS: Readonly<Record<PaymentFrequency, string>> = {
  weekly: 'weekly',
  fortnightly: 'fortnightly',
  monthly: 'monthly',
};

const COMPOUNDING_LABELS: Readonly<Record<number, string>> = {
  12: 'Monthly',
  26: 'Fortnightly',
  52: 'Weekly',
  365: 'Daily',
};

/** The loan form's compounding choice: "Monthly" … "Daily", else "4 times a year". */
export function compoundingLabel(perYear: number): string {
  const known = COMPOUNDING_LABELS[perYear];
  if (known) return known;
  return perYear === 1 ? 'Once a year' : `${perYear} times a year`;
}

/** "compounding monthly", "compounding 4 times a year". */
export function compoundingWords(perYear: number): string {
  const known = COMPOUNDING_LABELS[perYear];
  return `compounding ${known ? known.toLowerCase() : compoundingLabel(perYear)}`;
}

/** "6% a year, compounding monthly"; without a rate null. */
export function interestRateText(
  annualRate: DecimalString | null,
  compoundingPerYear: number | null,
): string | null {
  const rate = formatRate(annualRate);
  if (rate === null) return null;
  return compoundingPerYear === null
    ? `${rate} a year`
    : `${rate} a year, ${compoundingWords(compoundingPerYear)}`;
}

/** "$2,800.00 monthly"; without a payment null. */
export function repaymentText(cents: number | null, frequency: PaymentFrequency): string | null {
  return cents === null ? null : `${formatMoney(cents)} ${PAYMENT_FREQUENCY_WORDS[frequency]}`;
}

// ─── Payoff ─────────────────────────────────────────────────────────────────────────────────────

/** Whole months from `from` to `to` (DATEDIF "M": a month counts once its day is reached). */
export function wholeMonthsBetween(from: IsoDate, to: IsoDate): number {
  const [fy = 0, fm = 1, fd = 1] = from.split('-').map(Number);
  const [ty = 0, tm = 1, td = 1] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

/** "24 years 6 months", "1 year", "5 months", "0 months". */
export function durationText(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return plural(rest, 'month');
  if (rest === 0) return plural(years, 'year');
  return `${plural(years, 'year')} ${plural(rest, 'month')}`;
}

/** The payoff month ("Mar 2051") and "In 24 years 6 months" from the as-of date. */
export function payoffText(payoffDate: IsoDate, asOf: IsoDate): { month: string; inText: string } {
  return {
    month: formatMonth(payoffDate),
    inText: `In ${durationText(wholeMonthsBetween(asOf, payoffDate))}`,
  };
}

/** "8 months sooner with your offset". */
export function monthsSoonerText(months: number): string {
  return `${plural(months, 'month')} sooner with your offset`;
}

/** Why a loan has no payoff date or no schedule, in words. */
export const LOAN_FLAG_WORDS: Readonly<Record<LoanFlag, string>> = {
  no_property: 'Not linked to a property',
  no_rate: 'No interest rate',
  no_compounding: 'No compounding frequency',
  no_payment: 'No repayment amount',
  payment_below_interest: 'The repayment does not cover the interest',
  never_repaid: 'Not repaid within 100 years at this repayment',
};

/** The words for the first flag that stops a payoff date, or null. */
export function payoffMissingText(flags: readonly LoanFlag[]): string | null {
  const order: LoanFlag[] = [
    'payment_below_interest',
    'never_repaid',
    'no_rate',
    'no_payment',
    'no_compounding',
    'no_property',
  ];
  const flag = order.find((f) => flags.includes(f));
  return flag ? LOAN_FLAG_WORDS[flag] : null;
}

// ─── Other assets: names, units, prices and FX ──────────────────────────────────────────────────

/** True when an item's description is itself a link (it is shown by its short name). */
export function isUrlName(description: string): boolean {
  return /^https?:\/\/\S+$/i.test(description.trim());
}

export const SHORT_NAME_MAX = 48;

/**
 * The name an item is shown by: a URL-named item's host and path without the scheme or "www.",
 * ellipsised at 48 characters ("example.com/items/1"); any other description unchanged.
 */
export function shortName(description: string): string {
  const text = description.trim();
  if (!isUrlName(text)) return text;
  let short: string;
  try {
    const url = new URL(text);
    short = `${url.host}${url.pathname}`.replace(/\/$/, '');
  } catch {
    short = text.replace(/^https?:\/\//i, '');
  }
  short = short.replace(/^www\./i, '');
  return short.length > SHORT_NAME_MAX ? `${short.slice(0, SHORT_NAME_MAX - 1)}…` : short;
}

/** "10 oz", "1", "2.5". */
export function unitsText(units: DecimalString, unitOfMeasure: UnitOfMeasure): string {
  let text: string;
  try {
    text = formatQuantity(units);
  } catch {
    text = units;
  }
  return unitOfMeasure === 'oz' ? `${text} oz` : text;
}

/** A price in a currency's units, 2–4 dp without a symbol: "400.00", "1.5381". */
export function plainPrice(value: DecimalString): string {
  try {
    return formatQuantity(value, { minDp: 2, maxDp: 4 });
  } catch {
    return value;
  }
}

/** A unit cost in its own currency: AUD "$400.00"; otherwise "400.00 USD". */
export function unitCostText(unitCost: DecimalString, currency: string): string {
  return currency === 'AUD' ? `$${plainPrice(unitCost)}` : `${plainPrice(unitCost)} ${currency}`;
}

/** The currency the FX field and line speak in: GBX (UK pence) is quoted per pound. */
export function fxQuoteCurrency(currency: string): string {
  return currency === 'GBX' ? 'GBP' : currency;
}

/** A stored per-unit rate as quoted (GBX: the per-penny rate × 100 = per pound). */
export function quotedFxRate(currency: string, rate: DecimalString): DecimalString {
  return currency === 'GBX' ? percentTextFromRatio(rate) : rate;
}

/** The typed quote back to the stored rate (GBX: ÷ 100, exact on the string); null if invalid. */
export function storedFxRate(currency: string, quoted: DecimalString): DecimalString | null {
  if (currency !== 'GBX') return quoted;
  return ratioFromPercentText(quoted, 18);
}

/** "1 USD = A$1.5381 on 10/05/2024"; GBX: "1 GBP = A$1.9012" (the stored rate × 100). */
export function fxLine(currency: string, rate: DecimalString, date: IsoDate | null): string {
  const line = `1 ${fxQuoteCurrency(currency)} = A$${plainPrice(quotedFxRate(currency, rate))}`;
  return date ? `${line} on ${formatDate(date)}` : line;
}

/** "N items", "1 item". */
export function itemsText(count: number): string {
  return plural(count, 'item');
}

// ─── Super ──────────────────────────────────────────────────────────────────────────────────────

export const CAP_STATUS_BADGES: Readonly<
  Record<SuperCapStatus, { status: 'go' | 'check' | 'stop'; label: string; tone: StatusTone }>
> = {
  under: { status: 'go', label: 'Under', tone: 'go' },
  near: { status: 'check', label: 'Near', tone: 'check' },
  over: { status: 'stop', label: 'Over', tone: 'stop' },
};

export const SG_SOURCE_WORDS: Readonly<
  Record<'estimate' | 'statement' | 'mixed' | 'none', string>
> = {
  estimate: 'Estimated',
  statement: 'From statements',
  mixed: 'Partly from statements',
  none: 'None',
};

export const CONTRIBUTION_KIND_LABELS: Readonly<
  Record<'voluntary_contribution' | 'salary_sacrifice' | 'after_tax', string>
> = {
  salary_sacrifice: 'Salary sacrifice',
  after_tax: 'After-tax',
  voluntary_contribution: 'Imported',
};

/** "Jun 2026"; an unparsable month is returned as is. */
export function monthLabel(month: string): string {
  try {
    return formatMonth(month);
  } catch {
    return month;
  }
}

/** "Jul 2024" from a date. */
export function monthOfDate(date: IsoDate): string {
  return monthLabel(date.slice(0, 7));
}

// ─── Numbers ────────────────────────────────────────────────────────────────────────────────────

/** Σ of integer cents (nulls count 0). */
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

/** A chart category: the label, and " (live)" on the live point (§5). */
export function chartCategory(point: { label: string; live: boolean }): string {
  return point.live ? `${point.label} (live)` : point.label;
}

export const LIVE_POINT_NOTE = "The last point is live: it uses today's prices and balances.";
export const NO_HISTORY_NOTE =
  'History starts after the first recorded month (Stage 5 records months).';
export const PROVISIONAL_NOTE =
  'The current period stays provisional until a month is recorded (Stage 5).';
