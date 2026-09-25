// Display helpers for the investment pages (stage-2.md §6.3–6.8): text for the tiles, the
// next-buy card, the price callout and the tables. Pure functions, no React.
import {
  AMOUNT_MODE_UNIT_DP,
  isSettingKey,
  percentTextFromRatio,
  settingDef,
  type CapitalGainTerm,
  type CountdownDto,
  type DecimalString,
  type FeeSpec,
  type HoldingFlag,
  type HoldingRowDto,
  type InstrumentKind,
  type InvestmentChartPointDto,
  type InvestmentPageResponse,
  type InvestmentSummaryDto,
  type InvestmentTimingDto,
  type IsoDate,
  type TradeRowDto,
  type TradeSide,
} from '@joinr/schema';
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
  type StatDelta,
  type StatusKind,
} from '@joinr/ui';
import { formatTimeOrDate, plural } from '../../formatting';
import { ASSET_CLASS_LABELS, ASSET_CLASS_OF_KIND, KIND_META } from './kinds';

// ─── Numbers ────────────────────────────────────────────────────────────────────────────────────

/** A ratio string as a percent with one decimal ("0.074" → "7.4%"); null → null. */
export function formatRatio(
  ratio: DecimalString | null,
  options: { dp?: number; signDisplay?: 'auto' | 'always' } = {},
): string | null {
  if (ratio === null) return null;
  const value = Number(ratio);
  if (!Number.isFinite(value)) return ratio;
  return formatPercent(value, options);
}

/** A signed difference ("+10.4%", "−22.5%"); zero shows no sign. */
export function formatDifference(ratio: DecimalString | null): string | null {
  if (ratio === null) return null;
  return Number(ratio) === 0 ? formatRatio(ratio) : formatRatio(ratio, { signDisplay: 'always' });
}

/** A return ratio as a tile's delta: the arrow, the signed percent and a word (§6.3 item 3). */
export function returnDelta(ratio: DecimalString | null): StatDelta | undefined {
  if (ratio === null) return undefined;
  const value = Number(ratio);
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return {
    value: formatRatio(ratio, { signDisplay: value === 0 ? 'auto' : 'always' }) ?? ratio,
    direction,
    text: direction === 'up' ? 'up on cost' : direction === 'down' ? 'down on cost' : 'flat',
  };
}

/** A ratio in prose, without a trailing ".0": 0.95 → "95%", 0.955 → "95.5%". */
export function percentWords(ratio: DecimalString | number): string {
  return formatPercent(Number(ratio)).replace(/\.0%$/, '%');
}

/** True when a ratio or money figure is below zero. */
export function isNegative(value: DecimalString | number | null): boolean {
  return value !== null && Number(value) < 0;
}

/** The unit display precision of a kind (stock and ETF 4, fund 6, crypto 8). */
export function unitDp(kind: InstrumentKind): number {
  return AMOUNT_MODE_UNIT_DP[kind];
}

/** Units with the kind's precision: "1,500.123456", "0.06234567". */
export function formatUnits(units: DecimalString, kind: InstrumentKind): string {
  try {
    return formatQuantity(units, { maxDp: unitDp(kind) });
  } catch {
    return units;
  }
}

/** A unit price: 2–4 dp (crypto and managed funds up to 8). */
export function formatHoldingPrice(price: DecimalString, kind: InstrumentKind): string {
  try {
    return formatPrice(price, { maxDp: kind === 'crypto' || kind === 'managed_fund' ? 8 : 4 });
  } catch {
    return price;
  }
}

/** A fee as the owner reads it: "$10.00" (flat) or "0.5%" (rate). */
export function feeText(fee: FeeSpec): string {
  return fee.kind === 'flat' ? formatMoney(fee.cents) : `${percentTextFromRatio(fee.rate)}%`;
}

/** Σ of integer cents. */
export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ─── Dates ──────────────────────────────────────────────────────────────────────────────────────

function utcDay(date: IsoDate): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(utcDay(to) - utcDay(from));
}

/** "1 day", "12 days". */
export function dayCount(days: number): string {
  return plural(days, 'day');
}

// ─── The XIRR display rule (§6.3 item 4, §11 fix 22) ─────────────────────────────────────────────

/** A holding (or a kind) first traded fewer days than this before `asOf` shows "—", not its XIRR. */
export const XIRR_MIN_HELD_DAYS = 90;
export const HELD_UNDER_90_DAYS = 'Held under 90 days';

/** Each instrument's first trade date, from a ledger. */
export function firstTradeDates(trades: readonly TradeRowDto[]): Map<number, IsoDate> {
  const firsts = new Map<number, IsoDate>();
  for (const trade of trades) {
    const current = firsts.get(trade.instrumentId);
    if (current === undefined || trade.tradeDate < current) {
      firsts.set(trade.instrumentId, trade.tradeDate);
    }
  }
  return firsts;
}

function under90(date: IsoDate, asOf: IsoDate): boolean {
  return daysBetween(date, asOf) < XIRR_MIN_HELD_DAYS;
}

/**
 * True when a held holding's XIRR is hidden: its first trade is under 90 days before `asOf`.
 * The first trade comes from the ledger (`firstTrades`); while the ledger is still loading
 * (`null`), a holding traded in the last 90 days is hidden too, so an extreme figure never flashes.
 */
export function xirrHiddenForHolding(
  holding: Pick<HoldingRowDto, 'instrumentId' | 'status' | 'lastTradeDate'>,
  firstTrades: ReadonlyMap<number, IsoDate> | null,
  asOf: IsoDate,
): boolean {
  if (holding.status !== 'held') return false;
  if (firstTrades) {
    const first = firstTrades.get(holding.instrumentId);
    return first !== undefined && under90(first, asOf);
  }
  return holding.lastTradeDate !== null && under90(holding.lastTradeDate, asOf);
}

/** The portfolio tile's rule: the kind's first trade is under 90 days before `asOf`. */
export function xirrHiddenForKind(
  holdings: readonly Pick<HoldingRowDto, 'lastTradeDate'>[],
  firstTrades: ReadonlyMap<number, IsoDate> | null,
  asOf: IsoDate,
): boolean {
  const dates = firstTrades
    ? [...firstTrades.values()]
    : // No ledger yet: every instrument's first trade is on or before its last trade.
      holdings.flatMap((h) => (h.lastTradeDate === null ? [] : [h.lastTradeDate]));
  if (dates.length === 0) return false;
  const first = dates.reduce((min, date) => (date < min ? date : min));
  return under90(first, asOf);
}

// ─── Badges and labels ──────────────────────────────────────────────────────────────────────────

/** The holding flags as status badges (§6.3 item 4). */
export const HOLDING_FLAG_BADGES: Readonly<
  Record<HoldingFlag, { status: StatusKind; label: string }>
> = {
  unpriced: { status: 'failed', label: 'No price' },
  stale_price: { status: 'stale', label: 'Stale' },
  oversell: { status: 'stop', label: 'Oversold' },
  unwatched_held: { status: 'check', label: 'Not watched' },
};

export function sideLabel(side: TradeSide): string {
  return side === 'buy' ? 'Buy' : 'Sell';
}

export function termLabel(term: CapitalGainTerm): string {
  return term === 'short' ? 'Short term' : 'Long term';
}

/** A chart category: the period label, with " (live)" on the live point (§5). */
export function chartCategory(point: Pick<InvestmentChartPointDto, 'label' | 'live'>): string {
  return point.live ? `${point.label} (live)` : point.label;
}

export const LIVE_POINT_NOTE = "The last point uses today's prices.";

/**
 * The Value and Gain charts' note when held holdings have no price: the live point comes from the
 * summary, which leaves them out, so the line would otherwise seem to fall (§5, §11 fix 1).
 * Null when every held holding is priced.
 */
export function unpricedLivePointNote(unpricedCount: number): string | null {
  if (unpricedCount <= 0) return null;
  return unpricedCount === 1
    ? '1 holding without a price is left out of the last point.'
    : `${unpricedCount} holdings without a price are left out of the last point.`;
}

// ─── Header, tiles and callouts ─────────────────────────────────────────────────────────────────

/** "Prices 14:32", "Prices 22/09/2026", "Refreshing prices…" or "Prices not refreshed yet". */
export function freshnessText(prices: InvestmentPageResponse['prices'], now: Date): string {
  if (prices.running) return 'Refreshing prices…';
  const when = formatTimeOrDate(prices.lastRefreshAt, now);
  return when ? `Prices ${when}` : 'Prices not refreshed yet';
}

/**
 * "1 holding has no price and is left out of the totals: ASX:ABC. 2 prices are stale."
 * Null when every held price is fresh.
 */
export function priceCalloutText(
  holdings: readonly Pick<HoldingRowDto, 'symbol' | 'flags'>[],
  summary: Pick<InvestmentSummaryDto, 'unpricedCount' | 'stalePriceCount'>,
): string | null {
  const parts: string[] = [];
  const unpriced = summary.unpricedCount;
  if (unpriced > 0) {
    const symbols = holdings.filter((h) => h.flags.includes('unpriced')).map((h) => h.symbol);
    const list = symbols.length ? `: ${symbols.join(', ')}` : '';
    parts.push(
      unpriced === 1
        ? `1 holding has no price and is left out of the totals${list}.`
        : `${unpriced} holdings have no price and are left out of the totals${list}.`,
    );
  }
  const stale = summary.stalePriceCount;
  if (stale > 0) parts.push(stale === 1 ? '1 price is stale.' : `${stale} prices are stale.`);
  return parts.length ? parts.join(' ') : null;
}

/** The Portfolio value tile's hint (§6.3 item 3, §6.8). */
export function valueTileHint(
  summary: Pick<InvestmentSummaryDto, 'heldCount' | 'unpricedCount' | 'estMgmtFeeCents'>,
  kind: InstrumentKind,
  noTrades: boolean,
): string {
  if (noTrades) return 'No trades yet';
  let hint =
    summary.unpricedCount > 0
      ? `${summary.heldCount} held · ${summary.unpricedCount} without a price`
      : plural(summary.heldCount, 'holding');
  if (kind === 'managed_fund' && summary.estMgmtFeeCents !== null) {
    hint += ` · est. fees ${formatMoney(summary.estMgmtFeeCents, { wholeDollars: true })}/yr`;
  }
  return hint;
}

/** True when the kind has instruments but not one trade yet (the watching-only state, §6.8). */
export function hasNoTrades(holdings: readonly Pick<HoldingRowDto, 'lastTradeDate'>[]): boolean {
  return holdings.length > 0 && holdings.every((h) => h.lastTradeDate === null);
}

/** Targets that add up to neither 0 nor 100 % (±1e-9) get a warning under the table. */
export function targetsNeedCheck(targetSumRatio: DecimalString): boolean {
  const sum = Number(targetSumRatio);
  return Math.abs(sum) > 1e-9 && Math.abs(sum - 1) > 1e-9;
}

/** The ETF counts tile: "4 · target 5 · limit 6", and whether either count is over the limit. */
export function etfCounts(
  summary: Pick<InvestmentSummaryDto, 'heldCount' | 'targetCount'>,
  etfLimit: number | null,
): { text: string; overLimit: boolean } {
  const base = `${summary.heldCount} · target ${summary.targetCount}`;
  if (etfLimit === null) return { text: base, overLimit: false };
  return {
    text: `${base} · limit ${etfLimit}`,
    overLimit: summary.heldCount > etfLimit || summary.targetCount > etfLimit,
  };
}

// ─── Next buy (§6.3 item 5) ─────────────────────────────────────────────────────────────────────

/** The hint line, by `considerNext.reason` and `hint`. */
export function hintText(timing: InvestmentTimingDto, kind: InstrumentKind): string {
  const { considerNext, hint, budget } = timing;
  // Nothing is left to invest this month: the suggestion waits for cash, not a buy now. With the
  // automatic split off (D46) waiting for cash would never end, so the plain suggestion shows.
  const cashFirst = timing.countdown.state === 'cash_first';
  switch (considerNext.reason) {
    case 'below_emergency_fund':
      return budget.emergencyFundCents === null
        ? 'Top up cash first: cash is below the emergency fund'
        : `Top up cash first: cash is below the emergency fund (${formatMoney(budget.emergencyFundCents)})`;
    case 'no_targets':
      return 'Set allocation targets to get a suggestion';
    default: {
      const assetClass = considerNext.assetClass;
      if (
        assetClass === ASSET_CLASS_OF_KIND[kind] &&
        hint.instrumentId !== null &&
        hint.symbol !== null
      ) {
        if (cashFirst) return `Next: ${hint.symbol}, once cash allows`;
        return hint.parcelCents === null
          ? `Consider ${hint.symbol}`
          : `Consider ${hint.symbol} — ${formatMoney(hint.parcelCents)} parcel`;
      }
      if (assetClass === null) return 'Set allocation targets to get a suggestion';
      return cashFirst
        ? `Next: ${ASSET_CLASS_LABELS[assetClass]}, once cash allows`
        : `Consider ${ASSET_CLASS_LABELS[assetClass]}`;
    }
  }
}

/** D46: the status line when the budget's automatic investment split is off, and why. */
export const SPLIT_OFF_STATUS = 'Automatic investment split is off';
export const SPLIT_OFF_NOTE =
  'The budget sends the whole leftover to cash, so there is no monthly amount to invest.';

/** The countdown line (ETFs page). */
export function countdownText(
  countdown: CountdownDto,
  lastPurchaseDate: IsoDate | null,
  asOf: IsoDate,
): string {
  switch (countdown.state) {
    case 'wait':
      return `Wait ${dayCount(countdown.days)} (next buy ${formatDate(countdown.nextPurchaseDate)})`;
    case 'invest':
      return lastPurchaseDate === null
        ? 'Consider investing'
        : `${dayCount(daysBetween(lastPurchaseDate, asOf))} since the last buy: consider investing`;
    case 'cash_first':
      return 'Cash first: nothing is left to invest this month';
    case 'split_off':
      return SPLIT_OFF_STATUS;
    default:
      return 'Not available';
  }
}

/**
 * The monthly amount to invest and where it comes from; null when it is not available. Nothing to
 * invest (≤ 0, the cash-first state) shows $0.00, with the negative source in the words: a
 * negative "amount to invest" would read as an error. With the budget's automatic split off (D46)
 * the words say so instead of a $0.00 investment row.
 */
export function monthlyAmountText(
  timing: InvestmentTimingDto,
): { totalCents: number; breakdown: string } | null {
  const total = timing.monthlyInvestCents;
  if (total === null) return null;
  const side = timing.budget.sideIncomeInvestCents;
  if (total <= 0) {
    const source =
      timing.countdown.state === 'split_off'
        ? "the budget's automatic investment split is off"
        : timing.budget.useBudget === true
          ? `the budget's investment row is ${formatMoney(timing.budget.investmentRowCents ?? total - side)}`
          : `monthly income at the invest share is ${formatMoney(total - side)}`;
    return {
      totalCents: 0,
      breakdown: side === 0 ? source : `${source}; side income ${formatMoney(side)}`,
    };
  }
  const breakdown =
    timing.budget.useBudget === true
      ? `${formatMoney(timing.budget.investmentRowCents ?? total - side)} from the budget's investment row + ${formatMoney(side)} side income`
      : `${formatMoney(total - side)} of monthly income at the invest share + ${formatMoney(side)} side income`;
  return { totalCents: total, breakdown };
}

/** "Every 3 months · $4,860.00 (estimate; optimal $3,943.60)"; null without a plan. */
export function parcelText(plan: InvestmentTimingDto['plan']): string | null {
  if (plan === null) return null;
  const every = plan.months === 1 ? 'Every month' : `Every ${plan.months} months`;
  return `${every} · ${formatMoney(plan.parcelCents)} (estimate; optimal ${formatMoney(plan.optimalParcelCents)})`;
}

/** The suggested class, current vs target: "ETFs: 10.4% now vs 60.0% target"; null without one. */
export function assetClassText(timing: InvestmentTimingDto): string | null {
  const assetClass = timing.considerNext.assetClass;
  if (assetClass === null) return null;
  const row = timing.considerNext.rows.find((r) => r.assetClass === assetClass);
  const label = ASSET_CLASS_LABELS[assetClass];
  if (!row) return label;
  const target = formatRatio(row.targetRatio);
  return `${label}: ${formatRatio(row.currentRatio) ?? '—'} now vs ${target === null ? 'no target' : `${target} target`}`;
}

const TIMING_INPUT_LABELS: Readonly<Record<string, string>> = {
  'budget.items': 'Budget items',
  snapshots: 'Monthly snapshots',
  'investments.lastPurchaseDate': 'An ETF or stock buy',
};

/** A missing timing input in words: the setting's label, or the three non-setting inputs. */
export function missingInputLabel(key: string): string {
  const known = TIMING_INPUT_LABELS[key];
  if (known) return known;
  return isSettingKey(key) ? settingDef(key).label : key;
}

export const MISSING_INPUTS_FOOTER =
  'Set these in the workbook and re-import (only while no app edits exist), or on the Settings page in Stage 5.';
export const DEFERRED_CASH_NOTE =
  'Cash is below its target; the cash-first wait is added in Stage 3.';
export const IMPORTED_BUDGET_NOTE = 'From the imported budget; the live budget arrives in Stage 3.';

// ─── Kind words ─────────────────────────────────────────────────────────────────────────────────

/** "Loading ETFs…" */
export function loadingText(kind: InstrumentKind): string {
  return `Loading ${KIND_META[kind].plural}…`;
}

/** "Could not load the ETFs" */
export function loadErrorTitle(kind: InstrumentKind): string {
  return `Could not load the ${KIND_META[kind].plural}`;
}

/** A ledger button's `data-trade-action`, so focus can return to the button that opened a form. */
export function tradeActionKey(action: 'edit' | 'delete', tradeId: number): string {
  return `${action}-${tradeId}`;
}
