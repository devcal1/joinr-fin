// The Net Worth page's words (stage-5.md §6.3): the callouts under the hero (D84, D94), the donut's
// centre label and foot note (§5), the allocation words, the trend caption and the projection
// summary. Pure functions, no React.
import {
  monthEndOf,
  type ConsiderReason,
  type DecimalString,
  type IsoMonth,
  type MortgageLoanLineDto,
  type NetWorthPageResponse,
} from '@joinr/schema';
import { formatMoney, formatPercent } from '@joinr/ui';
import { ASSET_CLASS_LABELS } from '../investments/kinds';
import {
  STACK_LABELS,
  isStackClass,
  listWords,
  monthsWords,
  isAre,
  percentProse,
} from '../history/display';
import { blockedWaitingText } from '../history/historyText';

export const NO_MONTHS_NOTE =
  'No months recorded yet. Changes and history start after the first recorded month; record one on the History page.';
export const MARKET_OFF_NOTE = 'Market data is off: values use the last known prices.';
export const ASSETS_FOOTNOTE =
  'Property is at its full value; the mortgage is a liability. Offsets linked to a loan reduce it. Cash shows the accounts in credit; accounts in debit are a liability.';
export const STACK_CAPTION =
  'Property equity is net of the mortgage and linked offsets; cash is net of accounts in debit.';
export const EMPTY_DASHBOARD = 'Import the workbook or add accounts to see your net worth';

/** The recordable months whose last day has passed (they can only be recorded late). */
export function endedUnrecorded(
  page: Pick<NetWorthPageResponse, 'recordable' | 'asOf'>,
): IsoMonth[] {
  return page.recordable.filter((month) => monthEndOf(month) < page.asOf);
}

export type MonthCallout =
  { kind: 'note'; text: string } | { kind: 'important'; text: string } | null;

/**
 * An ended month not recorded while auto-record is off (§6.3 item 3, D84): a Note while nothing
 * was entered in the app (recording would block re-importing the workbook), Important after.
 */
export function unrecordedCallout(page: NetWorthPageResponse): MonthCallout {
  if (page.recordedToday || page.recorder.autoRecord.enabled) return null;
  const months = endedUnrecorded(page);
  if (months.length === 0) return null;
  const words = monthsWords(months);
  if (!page.hasAppData) {
    return {
      kind: 'note',
      text: `${words} ${isAre(months.length)} not recorded in the app. Recording adds app data and blocks re-importing the workbook: keep using the workbook until the cutover, or record ${months.length === 1 ? 'it' : 'them'} on the History page.`,
    };
  }
  return {
    kind: 'important',
    text: `${words} ${months.length === 1 ? 'has' : 'have'} not been recorded. Record ${months.length === 1 ? 'it' : 'them'} on the History page.`,
  };
}

/** Auto-record waits for an earlier missing month (D94, §6.3 item 3). */
export function blockedCallout(
  blocked: NetWorthPageResponse['recorder']['blocked'],
): string | null {
  return blockedWaitingText(blocked, ', on the History page');
}

/** "N holdings have no current price, so net worth may be understated." (the Stage 2 wording). */
export function pricesCallout(prices: NetWorthPageResponse['prices']): string | null {
  const parts: string[] = [];
  if (prices.unpricedCount > 0) {
    parts.push(
      prices.unpricedCount === 1
        ? '1 holding has no current price, so net worth may be understated.'
        : `${prices.unpricedCount} holdings have no current price, so net worth may be understated.`,
    );
  }
  if (prices.stalePriceCount > 0) {
    parts.push(
      prices.stalePriceCount === 1
        ? '1 price is stale.'
        : `${prices.stalePriceCount} prices are stale.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** True when there is nothing at all to show (no import, no accounts, §6.3 item 7). */
export function isEmptyDashboard(page: NetWorthPageResponse): boolean {
  return (
    page.lastRun === null &&
    page.assetsCents === 0 &&
    page.liabilitiesCents === 0 &&
    page.rolling.every((row) => row.status !== 'recorded')
  );
}

// ─── The distribution donut (§5) ────────────────────────────────────────────────────────────────

export interface DonutCentre {
  label: string;
  cents: number;
  /** "Net worth $X after property equity, other debts (−$Y)"; null when nothing is left out. */
  footNote: string | null;
}

/** "Net worth" when every class is drawn, else "Assets shown" with what is left out. */
export function donutCentre(page: NetWorthPageResponse): DonutCentre {
  const { distribution } = page;
  const netWorth = page.live.netWorth.netWorthCents;
  if (distribution.excluded.length === 0 && distribution.drawnCents === netWorth) {
    return { label: 'Net worth', cents: netWorth, footNote: null };
  }
  const left = distribution.excluded.map((e) =>
    isStackClass(e.key) ? STACK_LABELS[e.key].toLowerCase() : e.key,
  );
  const otherDebts = page.liabilities.find((l) => l.key === 'other_debts');
  if (otherDebts && otherDebts.balanceCents !== 0) left.push('other debts');
  const gap = distribution.drawnCents - netWorth;
  const after = left.length > 0 ? ` after ${listWords(left)}` : '';
  return {
    label: 'Assets shown',
    cents: distribution.drawnCents,
    footNote: `Net worth ${formatMoney(netWorth, { wholeDollars: true })}${after} (${formatMoney(-gap, { wholeDollars: true })})`,
  };
}

/** "Property equity is negative (−$X) and is left out of the chart." per excluded class. */
export function excludedNotes(page: NetWorthPageResponse): string[] {
  return page.distribution.excluded.map((e) => {
    const label = isStackClass(e.key) ? STACK_LABELS[e.key] : e.key;
    return `${label} is negative (${formatMoney(e.valueCents, { wholeDollars: true })}) and is left out of the chart.`;
  });
}

// ─── The liquid allocation (§6.3 item 4) ────────────────────────────────────────────────────────

/** The difference column in words: "Under by 9.0%", "Over by 12.3%", "On target"; null → null. */
export function allocationDifferenceText(deltaRatio: DecimalString | null): string | null {
  if (deltaRatio === null) return null;
  // deltaRatio = current − target (the Stage 2 ConsiderNextRow): negative is under target.
  const value = Number(deltaRatio);
  if (!Number.isFinite(value)) return null;
  const size = formatPercent(Math.abs(value));
  if (size === '0.0%') return 'On target';
  return value < 0 ? `Under by ${size}` : `Over by ${size}`;
}

/** "Targets add up to 102%: edit them in Settings"; null when they add up to 100 % (or none). */
export function targetSumWarning(sum: DecimalString | null): string | null {
  if (sum === null) return null;
  const value = Number(sum);
  if (!Number.isFinite(value) || Math.abs(value - 1) < 1e-9) return null;
  return `Targets add up to ${percentProse(sum)}: edit them in Settings`;
}

/** "Consider next: ETFs (most under target)" or "Cash first: below the emergency fund". */
export function considerNextText(
  reason: ConsiderReason,
  assetClass: NetWorthPageResponse['allocation']['assetClass'],
): string {
  if (reason === 'below_emergency_fund') return 'Cash first: below the emergency fund';
  if (reason === 'no_targets' || assetClass === null) {
    return 'Set allocation targets to get a suggestion';
  }
  return `Consider next: ${ASSET_CLASS_LABELS[assetClass]} (most under target)`;
}

// ─── Trends and the projection ──────────────────────────────────────────────────────────────────

/** "Trend: +$1,368 a month"; null without a slope (one point or none). */
export function trendCaption(slopePerMonthCents: number | null): string | null {
  if (slopePerMonthCents === null) return null;
  return `Trend: ${formatMoney(slopePerMonthCents, {
    wholeDollars: true,
    signDisplay: slopePerMonthCents === 0 ? 'auto' : 'always',
  })} a month`;
}

/** "Projection: 12 more months at $2,020 a month (your average savings)". */
export function projectionSummary(months: number, monthCents: number | null): string {
  const at =
    monthCents === null ? '' : ` at ${formatMoney(monthCents, { wholeDollars: true })} a month`;
  return `Projection: ${months} more ${months === 1 ? 'month' : 'months'}${at} (your average savings)`;
}

/** One loan's muted line: "<name> (<property>): $net (gross $X less offsets $Y)". */
export function mortgageLoanText(loan: MortgageLoanLineDto): string {
  const name = loan.propertyName ? `${loan.name} (${loan.propertyName})` : loan.name;
  const offsets =
    loan.offsetCents > 0
      ? ` (gross ${formatMoney(loan.grossCents)} less offsets ${formatMoney(loan.offsetCents)})`
      : '';
  return `${name}: ${formatMoney(loan.balanceCents)}${offsets}`;
}
