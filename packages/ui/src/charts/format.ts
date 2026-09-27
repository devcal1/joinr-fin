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

/** The number of ticks the finest likely axis has over its extent (ECharts aims for about 5). */
const AXIS_TICKS_FINEST = 10;
/** The most decimals a compact figure ("$1.125k") or a dollar figure ("$0.25") ever shows. */
const AXIS_MAX_DP = 3;

/** The nice step (1, 2, 5 × 10ⁿ) at or below `raw`, as ECharts rounds its tick intervals. */
function niceStepBelow(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const fraction = raw / base;
  const nice = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1;
  return nice * base;
}

/** The fewest decimals (0 to AXIS_MAX_DP) that write `value` exactly. */
function decimalsFor(value: number): number {
  for (let dp = 0; dp < AXIS_MAX_DP; dp += 1) {
    const scaled = value * 10 ** dp;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return dp;
  }
  return AXIS_MAX_DP;
}

const axisNumberFormats = new Map<string, Intl.NumberFormat>();
function axisNumber(minDp: number, maxDp: number): Intl.NumberFormat {
  const key = `${minDp}:${maxDp}`;
  let format = axisNumberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-AU', {
      minimumFractionDigits: minDp,
      maximumFractionDigits: maxDp,
    });
    axisNumberFormats.set(key, format);
  }
  return format;
}

/**
 * A compact money formatter for one axis (STYLE-5, stage-6.md §6.9 C): its precision keeps adjacent
 * ticks distinct for the axis `extent` (`[min, max]` in dollars, in either order). The formatter
 * estimates the finest tick step ECharts could choose for that extent (about 10 ticks, rounded
 * down to 1, 2 or 5 × 10ⁿ) and shows as many decimals as that step needs in each figure's unit:
 * "$1.25k" beside "$1.5k" on a $0–$2k axis, "$0.50" beside "$1.00" on a $0–$4 axis (cents always
 * with two decimals, STYLE_GUIDE §8), "$950" and "$1.2M" as before on wide axes. Zero is "$0";
 * negatives carry U+2212. An empty or non-finite extent gives `compactMoneyFormatter`.
 */
export function compactAxisFormatter(extent: readonly [number, number]): ValueFormatter {
  const [a, b] = extent;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return compactMoneyFormatter;
  const span = Math.abs(b - a);
  const reach = Math.max(Math.abs(a), Math.abs(b));
  // A flat axis (one value): ECharts spreads ticks around it, about a fifth of its size apart.
  const width = span > 0 ? span : reach;
  if (width === 0) return compactMoneyFormatter;
  const step = niceStepBelow(width / AXIS_TICKS_FINEST);

  return (dollars) => {
    if (!Number.isFinite(dollars)) return '—';
    const abs = Math.abs(dollars);
    if (abs < step / 2) return '$0';
    const unit = COMPACT_STEPS.find((s) => abs >= s.at);
    let body: string;
    if (unit) {
      const dp = decimalsFor(step / unit.at);
      body = `${axisNumber(0, dp).format(abs / unit.at)}${unit.suffix}`;
    } else if (step < 1) {
      // Dollars and cents: always two decimals, never "$0.5".
      body = axisNumber(2, 2).format(abs);
    } else {
      body = axisNumber(0, 0).format(abs);
    }
    return `${dollars < 0 ? MINUS : ''}$${body}`;
  };
}

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
