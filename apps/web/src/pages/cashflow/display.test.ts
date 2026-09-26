import { CASHFLOW_MONEY_MAX } from '@joinr/schema';
import { budgetPages, cashPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import {
  aboutMonth,
  accountGroupOf,
  checkProblemText,
  checkSummaryText,
  dateSpan,
  daysSince,
  emergencyFundBasisText,
  emergencyFundStatus,
  eventsFreshnessText,
  frequencyText,
  gapPerMonthText,
  periodLabel,
  periodStatusBadge,
  rateNeedsCheck,
  rateText,
  sourceLabel,
  sumCents,
  tomorrowOf,
  transfersHeading,
  trendDelta,
  trendPointsText,
  yearLabel,
  yearLastDay,
  yesNo,
} from './display';
import { diffSettings, draftOf, parseDraft, settingText } from './settingsDraft';
import { reorderIds, spendingLines, splitLines, splitText } from '../budget/budgetModel';

const M = '−';

describe('cash-flow display helpers', () => {
  it('labels periods, years and spans (STYLE_GUIDE §8)', () => {
    expect(periodLabel('2026-08')).toBe('Aug 2026');
    expect(yearLabel({ basis: 'fy', year: 2026 })).toBe('FY2026–27');
    expect(yearLabel({ basis: 'calendar', year: 2026 })).toBe('2026');
    expect(yearLastDay({ end: '2027-07-01' })).toBe('2027-06-30');
    expect(yearLastDay({ end: '2027-01-01' })).toBe('2026-12-31');
    expect(dateSpan('2021-03-16', '2021-04-15')).toBe('16/03/2021 – 15/04/2021');
    expect(tomorrowOf('2026-12-31')).toBe('2027-01-01');
    expect(aboutMonth('2027-03-31')).toBe('About Mar 2027');
  });

  it('badges the provisional and baseline periods only', () => {
    expect(periodStatusBadge('provisional')).toEqual({ status: 'pending', label: 'Provisional' });
    expect(periodStatusBadge('first')).toEqual({ status: 'recorded', label: 'Baseline' });
    expect(periodStatusBadge('closed')).toBeNull();
  });

  it('rates, the check rule and the trend in points per month', () => {
    expect(rateText('0.375')).toBe('37.5%');
    expect(rateText(null)).toBeNull();
    expect(rateNeedsCheck('1.9')).toBe(true);
    expect(rateNeedsCheck('-0.05')).toBe(true);
    expect(rateNeedsCheck('1')).toBe(false);
    expect(rateNeedsCheck('0')).toBe(false);
    expect(rateNeedsCheck(null)).toBe(false);
    expect(trendPointsText('-0.015')).toBe(`${M}1.5 points / month`);
    expect(trendPointsText('0.004')).toBe('+0.4 points / month');
    expect(trendPointsText('0')).toBe('0.0 points / month');
    expect(trendPointsText('-0.0001')).toBe('0.0 points / month');
    expect(trendPointsText(null)).toBeNull();
    expect(trendDelta('increasing')).toMatchObject({ direction: 'up', text: 'Increasing' });
    expect(trendDelta('decreasing')).toMatchObject({ direction: 'down', text: 'Decreasing' });
    expect(trendDelta('flat')).toMatchObject({ direction: 'flat', text: 'Flat' });
    expect(trendDelta(null)).toBeUndefined();
  });

  it('the emergency fund status and basis (D56, D59)', () => {
    expect(emergencyFundStatus({ covered: true, shortfallCents: 0 })).toEqual({
      status: 'go',
      label: 'Covered',
    });
    expect(emergencyFundStatus({ covered: false, shortfallCents: 210_000 })).toEqual({
      status: 'check',
      label: 'Short by $2,100',
    });
    expect(emergencyFundStatus({ covered: null, shortfallCents: null })).toBeNull();
    expect(emergencyFundBasisText({ loansIncluded: false, offsetsIncluded: false })).toBe(
      "Total cash except loans you've made (credit cards and other accounts count)",
    );
    expect(emergencyFundBasisText({ loansIncluded: true, offsetsIncluded: true })).toBe(
      'Total cash, plus offsets',
    );
  });

  it('money and words', () => {
    expect(gapPerMonthText(31_000)).toBe('$310.00 a month ahead');
    expect(gapPerMonthText(-31_000)).toBe('$310.00 a month behind');
    expect(sumCents([100, null, -50])).toBe(50);
    expect(sourceLabel('import')).toBe('Workbook');
    expect(sourceLabel('app')).toBe('App');
    expect(yesNo(null)).toBe('Unknown');
    expect(yesNo(true)).toBe('Yes');
    expect(frequencyText(3)).toBe('Every 3 months');
    expect(frequencyText(1)).toBe('Every month');
    expect(frequencyText(0)).toBeNull();
    expect(accountGroupOf({ kind: 'bank', isOffset: true })).toBe('offset');
    expect(accountGroupOf({ kind: 'loan_receivable', isOffset: false })).toBe('loan_receivable');
  });

  it('the payday transfer heading names the pay frequency', () => {
    expect(transfersHeading('monthly')).toBe('Payday transfers (monthly)');
    expect(transfersHeading('fortnightly')).toBe('Payday transfers (fortnightly)');
    expect(transfersHeading('weekly')).toBe('Payday transfers (weekly)');
    expect(transfersHeading('four_weekly')).toBe('Payday transfers (four-weekly)');
    expect(transfersHeading('twice_monthly')).toBe('Payday transfers (twice-monthly)');
    expect(transfersHeading(null)).toBe('Payday transfers');
  });

  it('the Yahoo freshness line and check results', () => {
    const now = new Date(2026, 8, 24, 15, 0);
    expect(
      eventsFreshnessText({ running: true, lastRefreshAt: null, instrumentsCovered: 0 }, now),
    ).toBe('Checking Yahoo…');
    expect(
      eventsFreshnessText({ running: false, lastRefreshAt: null, instrumentsCovered: 0 }, now),
    ).toBe('Yahoo not checked yet');
    const today = new Date(2026, 8, 24, 9, 5).toISOString();
    expect(
      eventsFreshnessText({ running: false, lastRefreshAt: today, instrumentsCovered: 4 }, now),
    ).toBe('Yahoo checked 09:05 · 4 holdings');
    const old = new Date(2026, 8, 12, 9, 5).toISOString();
    expect(daysSince(old, now)).toBe(12);
    expect(
      eventsFreshnessText({ running: false, lastRefreshAt: old, instrumentsCovered: 4 }, now),
    ).toBe('Yahoo last checked 12 days ago');
    expect(checkSummaryText({ requested: 4, ok: 4 }, 2)).toBe('Checked 4 holdings: 2 suggestions');
    expect(checkProblemText({ failed: 0, skipped: 0 })).toBeNull();
    expect(checkProblemText({ failed: 2, skipped: 1 })).toBe('2 holdings failed; 1 skipped.');
  });
});

describe('page settings drafts (§3.3)', () => {
  const slice = cashPages.populated.settings;

  it('shows stored values in words', () => {
    expect(settingText('goals.cashSavingsTargetCents', 5_000_000)).toBe('$50,000.00');
    expect(settingText('goals.houseDepositInvestmentShare', '0.2')).toBe('20%');
    expect(settingText('savings.includeMortgagePrincipal', true)).toBe('Yes');
    expect(settingText('savings.yearBasis', 'calendar')).toBe('Calendar year');
    expect(settingText('pay.frequency', 'fortnightly')).toBe('Fortnightly');
    expect(settingText('pay.jobStartDate', '2020-01-06')).toBe('06/01/2020');
    expect(settingText('pay.dayOfMonth', 15)).toBe('15');
    expect(settingText('goals.eoyCashGoalCents', null)).toBeNull();
  });

  it('round-trips a draft; an untouched form changes nothing', () => {
    const keys = [
      'goals.cashSavingsTargetCents',
      'goals.houseDepositInvestmentShare',
      'savings.includeMortgagePrincipal',
      'savings.yearBasis',
    ] as const;
    const drafts = Object.fromEntries(keys.map((k) => [k, draftOf(k, slice.values[k] ?? null)]));
    expect(drafts['goals.houseDepositInvestmentShare']).toBe('20');
    expect(diffSettings(keys, slice, drafts)).toEqual({ values: {}, errors: {} });
    expect(
      diffSettings(keys, slice, { ...drafts, 'goals.houseDepositInvestmentShare': '20.0' }).values,
    ).toEqual({});
    expect(
      diffSettings(keys, slice, { ...drafts, 'savings.yearBasis': 'calendar' }).values,
    ).toEqual({
      'savings.yearBasis': 'calendar',
    });
    // Clearing a money value stores null.
    expect(
      diffSettings(keys, slice, { ...drafts, 'goals.cashSavingsTargetCents': null }).values,
    ).toEqual({ 'goals.cashSavingsTargetCents': null });
  });

  it('parses and validates by type', () => {
    expect(parseDraft('goals.houseDepositInvestmentShare', '12.5')).toEqual({
      ok: true,
      value: '0.125',
    });
    expect(parseDraft('goals.houseDepositInvestmentShare', '120')).toEqual({
      ok: false,
      message: 'Enter a percentage from 0 to 100',
    });
    expect(parseDraft('pay.dayOfMonth', '29')).toEqual({
      ok: false,
      message: 'Enter a whole number from 0 to 28',
    });
    expect(parseDraft('pay.dayOfMonth', '1.5')).toEqual({
      ok: false,
      message: 'Enter a whole number',
    });
    expect(parseDraft('budget.emergencyFundMonths', '6')).toEqual({ ok: true, value: 6 });
    expect(parseDraft('budget.autoInvestSplit', 'no')).toEqual({ ok: true, value: false });
    expect(parseDraft('pay.frequency', 'weekly')).toEqual({ ok: true, value: 'weekly' });
    expect(parseDraft('pay.netPayCents', 650_000)).toEqual({ ok: true, value: 650_000 });
    expect(parseDraft('pay.netPayCents', null)).toEqual({ ok: true, value: null });
  });

  it('mirrors the server write bounds: money up to $100m, the fund months up to 1200', () => {
    expect(parseDraft('pay.netPayCents', CASHFLOW_MONEY_MAX)).toEqual({
      ok: true,
      value: CASHFLOW_MONEY_MAX,
    });
    expect(parseDraft('pay.netPayCents', CASHFLOW_MONEY_MAX + 1)).toEqual({
      ok: false,
      message: 'Enter an amount up to $100,000,000',
    });
    expect(parseDraft('goals.eoyCashGoalCents', Number.MAX_SAFE_INTEGER)).toEqual({
      ok: false,
      message: 'Enter an amount up to $100,000,000',
    });
    expect(parseDraft('budget.emergencyFundMonths', '1200')).toEqual({ ok: true, value: 1200 });
    expect(parseDraft('budget.emergencyFundMonths', '1201')).toEqual({
      ok: false,
      message: 'Enter a whole number from 0 to 1200',
    });
    expect(parseDraft('budget.emergencyFundMonths', '100000000000')).toEqual({
      ok: false,
      message: 'Enter a whole number from 0 to 1200',
    });
    // A registry maximum keeps its own message.
    expect(parseDraft('pay.dayOfMonth', '1201')).toEqual({
      ok: false,
      message: 'Enter a whole number from 0 to 28',
    });
  });
});

describe('budget table lines (§6.5 item 4)', () => {
  it('spending holds the items and the yearly row; the split its rows and the rounding line', () => {
    const page = budgetPages.autoSplit;
    const spending = spendingLines(page);
    expect(spending.map((l) => l.label)).toEqual([
      'Rent',
      'Groceries',
      'Phone',
      'Emergency fund top-up',
      'Gym',
      'Yearly expenses (automatic)',
    ]);
    expect(sumCents(spending.map((l) => l.monthlyCents))).toBe(page.summary.plannedSpendCents);
    const split = splitLines(page);
    expect(split.map((l) => l.label)).toEqual([
      'Investment savings (automatic)',
      'Cash savings (automatic)',
      'Unallocated (rounding)',
    ]);
    expect(sumCents(split.map((l) => l.monthlyCents))).toBe(page.summary.leftoverCents);
    // No rounding line when nothing is unallocated.
    const exact = { ...page, summary: { ...page.summary, unallocatedCents: 0 } };
    expect(splitLines(exact).map((l) => l.key)).not.toContain('unallocated');
  });

  it('reorders by swapping neighbours and names the split', () => {
    const lines = spendingLines(budgetPages.autoSplit);
    expect(reorderIds(lines, 1, -1)).toEqual([12, 11, 13, 14, 15, 16]);
    expect(reorderIds(lines, 5, 1)).toBeNull();
    expect(splitText(budgetPages.autoSplit.summary)).toBe(
      'Split: 65% investments / 35% cash (target cash 15%, normal)',
    );
    expect(splitText(budgetPages.manualSplit.summary)).toBeNull();
  });
});
