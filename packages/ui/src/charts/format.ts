// Value formatters for charts. Chart values are dollars (not cents) or ratios; these wrap the
// core formatters so tooltips, axes and tables print numbers the same way (STYLE_GUIDE §8).
import { MINUS, formatMoney, formatPercent } from '../core';
import type { ValueFormatter } from './types';

const plainNumber = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });

/** Replaces an ASCII hyphen-minus sign with U+2212. */
function withMinus(text: string): string {
  return text.replace(/^-/, MINUS);
}

/** Default formatter: en-AU grouping, up to 2 dp, U+2212 negatives. Non-finite → "—". */
export const formatChartNumber: ValueFormatter = (v) =>
  Number.isFinite(v) ? withMinus(plainNumber.format(v === 0 ? 0 : v)) : '—';

export interface MoneyFormatterOptions {
  /** Show cents ("$12,480.00"). Default false: whole dollars ("$12,480"). */
  cents?: boolean;
  signDisplay?: 'auto' | 'always' | 'never';
}

/** Dollars → "$12,480" (or "$12,480.00" with `cents`). Uses core `formatMoney`. */
export function moneyFormatter(options: MoneyFormatterOptions = {}): ValueFormatter {
  const { cents = false, signDisplay } = options;
  return (dollars) => {
    if (!Number.isFinite(dollars)) return '—';
    return formatMoney(Math.round(dollars * 100), { wholeDollars: !cents, signDisplay });
  };
}

const COMPACT_STEPS = [
  { at: 1e9, suffix: 'B', dp: 2 },
  { at: 1e6, suffix: 'M', dp: 2 },
  { at: 1e3, suffix: 'k', dp: 1 },
] as const;

/** Dollars → compact axis ticks: "$950", "$12.5k", "$1.25M", "−$3k". */
export const compactMoneyFormatter: ValueFormatter = (dollars) => {
  if (!Number.isFinite(dollars)) return '—';
  const abs = Math.abs(dollars);
  let body = plainNumber.format(Math.round(abs));
  // Largest step whose rounded figure is at least 1 (so 999,950 reads "$1M", not "$1,000k").
  for (const step of COMPACT_STEPS) {
    const scaled = Number((abs / step.at).toFixed(step.dp));
    if (scaled >= 1) {
      body = `${plainNumber.format(scaled)}${step.suffix}`;
      break;
    }
  }
  const isZero = body === '0';
  return `${dollars < 0 && !isZero ? MINUS : ''}$${body}`;
};

/** Ratio → "7.4%" (core `formatPercent`, one decimal). */
export const percentFormatter: ValueFormatter = (ratio) =>
  Number.isFinite(ratio) ? formatPercent(ratio) : '—';

/** Escapes text for the tooltip's HTML string. Labels are data, never markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
