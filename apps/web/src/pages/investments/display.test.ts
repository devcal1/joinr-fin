import {
  investmentPageAllUnpriced,
  investmentPageNulls,
  investmentPageTiming,
  investmentPageUnpriced,
  investmentPages,
  investmentTrades,
} from '@joinr/schema/fixtures';
import type { InvestmentTimingDto } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  HOLDING_FLAG_BADGES,
  MISSING_INPUTS_LEAD,
  MISSING_SNAPSHOTS,
  SPLIT_OFF_LINK,
  assetClassText,
  chartCategory,
  countdownText,
  daysBetween,
  etfCounts,
  feeText,
  firstTradeDates,
  formatDifference,
  formatHoldingPrice,
  formatRatio,
  formatUnits,
  freshnessText,
  hasNoTrades,
  hintText,
  loadErrorTitle,
  loadingText,
  missingInputLabel,
  monthlyAmountText,
  parcelText,
  percentWords,
  priceCalloutText,
  returnDelta,
  targetsNeedCheck,
  termLabel,
  tradeActionKey,
  valueTileHint,
  xirrHiddenForHolding,
  xirrHiddenForKind,
} from './display';
import { ASSET_CLASS_LABELS, KIND_META } from './kinds';

const AS_OF = '2026-09-24';

describe('kinds', () => {
  it('maps each kind to its path, title and labels (§6.1)', () => {
    expect(KIND_META.stock).toMatchObject({
      path: '/stocks',
      title: 'Stocks',
      dividendsLabel: 'Dividends',
      noun: 'stock',
    });
    expect(KIND_META.etf).toMatchObject({
      path: '/etfs',
      title: 'ETFs',
      dividendsLabel: 'Distributions',
      noun: 'ETF',
    });
    expect(KIND_META.managed_fund).toMatchObject({
      path: '/managed-funds',
      title: 'Managed Funds',
      dividendsLabel: 'Distributions',
      noun: 'fund',
    });
    expect(KIND_META.crypto).toMatchObject({
      path: '/crypto',
      title: 'Crypto',
      dividendsLabel: 'Staking',
      noun: 'coin',
      yieldLabel: 'Staking yield',
    });
    expect(Object.values(ASSET_CLASS_LABELS)).toEqual([
      'ETFs',
      'Stocks',
      'Crypto',
      'Cash savings',
      'Managed funds',
      'Other assets',
    ]);
  });

  it('names the loading and error states', () => {
    expect(loadingText('etf')).toBe('Loading ETFs…');
    expect(loadErrorTitle('etf')).toBe('Could not load the ETFs');
    expect(loadingText('stock')).toBe('Loading stocks…');
  });
});

describe('numbers', () => {
  it('formats ratios, differences and percent words', () => {
    expect(formatRatio('0.074')).toBe('7.4%');
    expect(formatRatio('-0.021')).toBe('−2.1%');
    expect(formatRatio(null)).toBeNull();
    expect(formatDifference('0.104395604396')).toBe('+10.4%');
    expect(formatDifference('-0.224526873581')).toBe('−22.5%');
    expect(formatDifference('0')).toBe('0.0%');
    expect(percentWords('0.95')).toBe('95%');
    expect(percentWords('0.955')).toBe('95.5%');
    expect(percentWords('1')).toBe('100%');
  });

  it('shows units with the kind precision (stock/ETF 4, fund 6, crypto 8)', () => {
    expect(formatUnits('10.23456789', 'etf')).toBe('10.2346');
    expect(formatUnits('1500.123456', 'managed_fund')).toBe('1,500.123456');
    expect(formatUnits('0.06234567', 'crypto')).toBe('0.06234567');
    expect(formatUnits('110', 'stock')).toBe('110');
  });

  it('shows prices with up to 8 dp for crypto and funds', () => {
    expect(formatHoldingPrice('12.5', 'stock')).toBe('$12.50');
    expect(formatHoldingPrice('1.41666940991', 'managed_fund')).toBe('$1.41666941');
    expect(formatHoldingPrice('1.41666940991', 'etf')).toBe('$1.4167');
    expect(formatHoldingPrice('160000', 'crypto')).toBe('$160,000.00');
  });

  it('writes fees as money or a percentage', () => {
    expect(feeText({ kind: 'flat', cents: 1000 })).toBe('$10.00');
    expect(feeText({ kind: 'flat', cents: 0 })).toBe('$0.00');
    expect(feeText({ kind: 'rate', rate: '0.0025' })).toBe('0.25%');
  });

  it('builds the total return delta with an arrow direction and a word', () => {
    expect(returnDelta('0.141631799163')).toEqual({
      value: '+14.2%',
      direction: 'up',
      text: 'up on cost',
    });
    expect(returnDelta('-0.1')).toEqual({
      value: '−10.0%',
      direction: 'down',
      text: 'down on cost',
    });
    expect(returnDelta('0')).toMatchObject({ direction: 'flat', value: '0.0%' });
    expect(returnDelta(null)).toBeUndefined();
  });
});

describe('dates and the XIRR display rule', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-08-18', AS_OF)).toBe(37);
    expect(daysBetween('2025-09-24', AS_OF)).toBe(365);
    expect(daysBetween(AS_OF, AS_OF)).toBe(0);
  });

  it('finds each instrument’s first trade', () => {
    const firsts = firstTradeDates(investmentTrades.stock.trades);
    expect(firsts.get(1)).toBe('2024-06-03');
    expect(firsts.get(11)).toBe('2026-08-10');
    expect(firsts.get(2)).toBe('2023-11-01');
  });

  it('hides a held holding’s XIRR when its first trade is under 90 days before asOf', () => {
    const firsts = firstTradeDates(investmentTrades.stock.trades);
    const [abc, xyz, ghi] = investmentPages.stock.holdings;
    expect(xirrHiddenForHolding(abc!, firsts, AS_OF)).toBe(false);
    expect(xirrHiddenForHolding(xyz!, firsts, AS_OF)).toBe(true);
    expect(xirrHiddenForHolding(ghi!, firsts, AS_OF)).toBe(false); // watching
    // The 90-day boundary: 89 days hidden, 90 shown.
    const at = (date: string) => new Map([[1, date]]);
    const row = { instrumentId: 1, status: 'held' as const, lastTradeDate: null };
    expect(xirrHiddenForHolding(row, at('2026-06-27'), AS_OF)).toBe(true);
    expect(xirrHiddenForHolding(row, at('2026-06-26'), AS_OF)).toBe(false);
  });

  it('while the ledger loads, hides a holding traded in the last 90 days', () => {
    const [abc, xyz] = investmentPages.stock.holdings;
    expect(xirrHiddenForHolding(abc!, null, AS_OF)).toBe(true); // last trade 05/08/2026
    expect(xirrHiddenForHolding(xyz!, null, AS_OF)).toBe(true);
    expect(xirrHiddenForHolding(investmentPages.etf.holdings[1]!, null, AS_OF)).toBe(false);
  });

  it('applies the rule to the kind’s first trade for the portfolio tile', () => {
    expect(xirrHiddenForKind([], firstTradeDates(investmentTrades.stock.trades), AS_OF)).toBe(
      false,
    );
    expect(xirrHiddenForKind([], new Map([[5, AS_OF]]), AS_OF)).toBe(true);
    expect(xirrHiddenForKind([], new Map(), AS_OF)).toBe(false);
    // Without the ledger: the earliest last-trade date decides.
    expect(xirrHiddenForKind(investmentPageNulls.holdings, null, AS_OF)).toBe(false);
    expect(xirrHiddenForKind([{ lastTradeDate: AS_OF }], null, AS_OF)).toBe(true);
  });
});

describe('labels and callouts', () => {
  it('maps holding flags to status badges with words', () => {
    expect(HOLDING_FLAG_BADGES.unpriced).toEqual({ status: 'failed', label: 'No price' });
    expect(HOLDING_FLAG_BADGES.stale_price).toEqual({ status: 'stale', label: 'Stale' });
    expect(HOLDING_FLAG_BADGES.oversell).toEqual({ status: 'stop', label: 'Oversold' });
    expect(HOLDING_FLAG_BADGES.unwatched_held).toEqual({ status: 'check', label: 'Not watched' });
    expect(termLabel('short')).toBe('Short term');
    expect(termLabel('long')).toBe('Long term');
    expect(tradeActionKey('edit', 116)).toBe('edit-116');
  });

  it('adds " (live)" to the live chart point', () => {
    expect(chartCategory({ label: 'Sep 2026', live: true })).toBe('Sep 2026 (live)');
    expect(chartCategory({ label: 'Aug 2026', live: false })).toBe('Aug 2026');
  });

  it('writes the freshness line', () => {
    const prices = investmentPages.etf.prices;
    const sameDay = new Date(prices.lastRefreshAt!);
    expect(freshnessText(prices, sameDay)).toMatch(/^Prices \d{2}:\d{2}$/);
    expect(freshnessText(prices, new Date(sameDay.getTime() + 3 * 86_400_000))).toMatch(
      /^Prices \d{2}\/\d{2}\/2026$/,
    );
    expect(freshnessText({ ...prices, running: true }, sameDay)).toBe('Refreshing prices…');
    expect(freshnessText({ ...prices, lastRefreshAt: null }, sameDay)).toBe(
      'Prices not refreshed yet',
    );
  });

  it('explains unpriced and stale holdings in plain words', () => {
    expect(priceCalloutText(investmentPageUnpriced.holdings, investmentPageUnpriced.summary)).toBe(
      '1 holding has no price and is left out of the totals: ASX:DEF. 1 price is stale.',
    );
    expect(
      priceCalloutText(investmentPageAllUnpriced.holdings, investmentPageAllUnpriced.summary),
    ).toBe('2 holdings have no price and are left out of the totals: ASX:ABC, ASX:XYZ.');
    expect(priceCalloutText([], { unpricedCount: 0, stalePriceCount: 2 })).toBe(
      '2 prices are stale.',
    );
    expect(priceCalloutText(investmentPages.etf.holdings, investmentPages.etf.summary)).toBeNull();
  });

  it('writes the value tile hint', () => {
    expect(valueTileHint(investmentPages.etf.summary, 'etf', false)).toBe('2 holdings');
    expect(
      valueTileHint({ heldCount: 1, unpricedCount: 0, estMgmtFeeCents: null }, 'stock', false),
    ).toBe('1 holding');
    expect(valueTileHint(investmentPageAllUnpriced.summary, 'stock', false)).toBe(
      '2 held · 2 without a price',
    );
    expect(valueTileHint(investmentPages.managed_fund.summary, 'managed_fund', false)).toBe(
      '1 holding · est. fees $18/yr',
    );
    expect(valueTileHint(investmentPages.etf.summary, 'etf', true)).toBe('No trades yet');
  });

  it('knows a kind with no trades yet', () => {
    expect(hasNoTrades([{ lastTradeDate: null }])).toBe(true);
    expect(hasNoTrades([])).toBe(false);
    expect(hasNoTrades(investmentPages.stock.holdings)).toBe(false);
  });

  it('checks the target sum and the ETF counts', () => {
    expect(targetsNeedCheck('1')).toBe(false);
    expect(targetsNeedCheck('0')).toBe(false);
    expect(targetsNeedCheck('0.9999999999')).toBe(false);
    expect(targetsNeedCheck('0.95')).toBe(true);
    expect(etfCounts({ heldCount: 4, targetCount: 5 }, 6)).toEqual({
      text: '4 · target 5 · limit 6',
      overLimit: false,
    });
    expect(etfCounts({ heldCount: 4, targetCount: 7 }, 6).overLimit).toBe(true);
    expect(etfCounts({ heldCount: 7, targetCount: 5 }, 6).overLimit).toBe(true);
    expect(etfCounts({ heldCount: 4, targetCount: 5 }, null)).toEqual({
      text: '4 · target 5',
      overLimit: false,
    });
  });
});

describe('next buy', () => {
  const t = investmentPageTiming;

  it('writes the hint line for each consider-next reason', () => {
    expect(hintText(t.wait.timing, 'etf')).toBe('Consider ASX:DEF — $4,860.00 parcel');
    // Cash first: nothing to invest this month, so the suggestion waits for cash.
    expect(hintText(t.cash_first.timing, 'etf')).toBe('Next: ASX:DEF, once cash allows');
    expect(hintText(t.cash_first.timing, 'stock')).toBe('Next: ETFs, once cash allows');
    expect(hintText(investmentPages.stock.timing, 'stock')).toBe('Consider ETFs');
    expect(hintText(t.below_emergency_fund.timing, 'etf')).toBe(
      "Top up cash first: the cash that counts toward the emergency fund (not loans you've made) is below it ($21,000.00)",
    );
    expect(hintText(t.no_targets.timing, 'etf')).toBe('Set allocation targets to get a suggestion');
  });

  it('writes the countdown line for each state', () => {
    expect(countdownText(t.wait.timing.countdown, '2026-08-18', AS_OF)).toBe(
      'Wait 56 days (next buy 19/11/2026)',
    );
    expect(
      countdownText(
        { state: 'wait', days: 1, nextPurchaseDate: '2026-09-25', periodDays: 30 },
        '2026-08-18',
        AS_OF,
      ),
    ).toBe('Wait 1 day (next buy 25/09/2026)');
    expect(countdownText(t.invest.timing.countdown, '2026-08-18', AS_OF)).toBe(
      '37 days since the last buy: consider investing',
    );
    expect(countdownText(t.invest.timing.countdown, '2026-09-23', AS_OF)).toBe(
      '1 day since the last buy: consider investing',
    );
    expect(countdownText(t.cash_first.timing.countdown, null, AS_OF)).toBe(
      'Cash first: nothing is left to invest this month',
    );
    expect(countdownText(t.unavailable.timing.countdown, null, AS_OF)).toBe('Not available');
  });

  it('explains the monthly amount from the budget row or from income', () => {
    expect(monthlyAmountText(t.wait.timing)).toEqual({
      totalCents: 162000,
      breakdown: "$1,500.00 from the budget's investment row + $120.00 side income",
    });
    expect(monthlyAmountText(t.invest.timing)).toEqual({
      totalCents: 1000000,
      breakdown: '$9,750.00 of monthly income at the invest share + $250.00 side income',
    });
    expect(monthlyAmountText(t.unavailable.timing)).toBeNull();
  });

  it('shows nothing to invest as $0.00, with the negative source in words (cash first)', () => {
    expect(monthlyAmountText(t.cash_first.timing)).toEqual({
      totalCents: 0,
      breakdown: "the budget's investment row is −$1,000.00",
    });
    expect(monthlyAmountText(t.below_emergency_fund.timing)).toEqual({
      totalCents: 0,
      breakdown: "the budget's investment row is $0.00",
    });
    const income: InvestmentTimingDto = {
      ...t.cash_first.timing,
      budget: { ...t.cash_first.timing.budget, useBudget: false, sideIncomeInvestCents: 5000 },
      monthlyInvestCents: -20000,
    };
    expect(monthlyAmountText(income)).toEqual({
      totalCents: 0,
      breakdown: 'monthly income at the invest share is −$250.00; side income $50.00',
    });
  });

  it('says the automatic investment split is off instead of cash first (D46, D54)', () => {
    const off = t.split_off.timing;
    expect(countdownText(off.countdown, '2026-08-18', AS_OF)).toBe(
      'Automatic investment split is off and the investment amount is $0',
    );
    expect(SPLIT_OFF_LINK).toBe('Set an amount on the Budget page');
    expect(monthlyAmountText(off)).toEqual({
      totalCents: 0,
      breakdown: "the budget's automatic investment split is off",
    });
    // Waiting for cash would never end while the split is off: the plain suggestion shows.
    expect(hintText(off, 'etf')).toBe('Consider ASX:DEF');
    expect(hintText(off, 'stock')).toBe('Consider ETFs');
    // The cash-first wording is unchanged.
    expect(hintText(t.cash_first.timing, 'etf')).toBe('Next: ASX:DEF, once cash allows');
  });

  it('writes the parcel, the cash-deficit wait (Stage 3 §6.7) and the suggested class', () => {
    expect(parcelText(t.wait.timing.plan)).toBe('Every 3 months · $4,860.00');
    expect(parcelText(t.invest.timing.plan)).toBe('Every month · $10,000.00');
    expect(parcelText(null)).toBeNull();
    const deficit = t.cash_deficit.timing;
    expect(parcelText(deficit.plan, deficit.cashDeficitMonths)).toBe(
      'Every 5 months while cash tops up to its target (normally every 3 months) · $4,860.00',
    );
    // A wait no longer than the plan leaves the parcel line as it is.
    expect(parcelText(deficit.plan, 3)).toBe('Every 3 months · $4,860.00');
    expect(parcelText(deficit.plan, 2)).toBe('Every 3 months · $4,860.00');
    expect(MISSING_INPUTS_LEAD).toBe('Set them in Settings');
    expect(MISSING_SNAPSHOTS).toBe('Monthly snapshots are recorded on the History page.');
    expect(assetClassText(t.wait.timing)).toBe('ETFs: 10.4% now vs 60.0% target');
    expect(assetClassText(t.no_targets.timing)).toBeNull();
    const noTarget: InvestmentTimingDto = {
      ...t.wait.timing,
      considerNext: { ...t.wait.timing.considerNext, assetClass: 'other_assets' },
    };
    expect(assetClassText(noTarget)).toBe('Other assets: 4.4% now vs no target');
  });

  it('names the missing inputs', () => {
    expect(missingInputLabel('pay.netPayCents')).toBe('Net pay per pay');
    expect(missingInputLabel('budget.emergencyFundMonths')).toBe(
      'Emergency fund (months of spending)',
    );
    expect(missingInputLabel('budget.items')).toBe('Budget items');
    expect(missingInputLabel('snapshots')).toBe('Monthly snapshots');
    expect(missingInputLabel('investments.lastPurchaseDate')).toBe('An ETF or stock buy');
    expect(missingInputLabel('something.else')).toBe('something.else');
  });
});
