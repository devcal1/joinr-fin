// Cash KPIs (stage-3.md §2.6; D52, D59; §11 fixes 1, 2, 14, 15, 24, 25). Figures come from the
// adjusted savings unless a field says raw; averages, year sums and the trend use closed periods
// only; every cash projection uses the adjusted average cash gain and starts from `currentCashCents`
// (available cash, D59). Sums of periods add the per-period cents; averages and ratios use the
// unrounded values and round once.
import { addMonthsIso, JoinrDecimal, type IsoDate } from '@joinr/schema';
import {
  addDaysIso,
  ceilWhole,
  centsOf,
  dayNumber,
  dec,
  dollarsOf,
  mean,
  ratioString,
  sumCents,
  ZERO,
  type Dec,
} from './num';
import { inYear, monthsBetween, yearWindow } from './periods';
import type { CashKpisInput, CashKpisResult, Cents, SavingsFigures, SavingsPeriod } from './types';

/** Days per month for the trend: 365.25 / 12 (§2.6, §11 fix 1). */
const DAYS_PER_MONTH: Dec = new JoinrDecimal('365.25').div(12);
const AVERAGING_DAYS = 365;
const SPEND_WINDOW_DAYS = 185;
const TREND_PERIODS = 3;

/** Periods in run-date order (a stable sort; computeSavings already returns them so). */
export function byRunDate(periods: readonly SavingsPeriod[]): SavingsPeriod[] {
  return periods
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        (a.p.runDate < b.p.runDate ? -1 : a.p.runDate > b.p.runDate ? 1 : 0) || a.index - b.index,
    )
    .map((x) => x.p);
}

/**
 * A period's savings before rounding: ratio × income when it has a ratio (the ratio keeps 12
 * significant digits, so this restores the unrounded savings), else its cents.
 */
export function unroundedSavings(f: SavingsFigures): Dec | null {
  if (f.savingsCents === null) return null;
  if (f.savingsRatio !== null && f.incomeCents !== null) {
    return dec(f.savingsRatio, 'savings ratio').times(dollarsOf(f.incomeCents));
  }
  return dollarsOf(f.savingsCents);
}

/** A period's spend before rounding (income − savings), or null when the period has none. */
function unroundedSpend(f: SavingsFigures): Dec | null {
  const savings = unroundedSavings(f);
  if (f.spendCents === null || savings === null || f.incomeCents === null) return null;
  return dollarsOf(f.incomeCents).minus(savings);
}

/**
 * Σ savings / Σ income over the periods that have a savings figure (income-weighted, §11 fix 15);
 * null when there is none or the income sum is not positive.
 */
export function weightedRatio(figures: readonly SavingsFigures[]): string | null {
  let savings = ZERO;
  let income = ZERO;
  let any = false;
  for (const f of figures) {
    const s = unroundedSavings(f);
    if (s === null || f.incomeCents === null) continue;
    savings = savings.plus(s);
    income = income.plus(dollarsOf(f.incomeCents));
    any = true;
  }
  return any && income.greaterThan(0) ? ratioString(savings.div(income)) : null;
}

/** The ≤ 3-point savings-rate trend line (C39–C41 fixed): the points, the slope and a fit. */
export interface SavingsTrend {
  /** The last 3 closed periods with an (adjusted) rate, oldest first. */
  points: SavingsPeriod[];
  /** Mean rate of those points (C39); null without points. */
  mean: Dec | null;
  /** Least-squares slope per day; null with fewer than 2 points or one distinct date. */
  slopePerDay: Dec | null;
  /** The fitted rate at a run date; null without a slope. */
  fitAt: (runDate: IsoDate) => Dec | null;
}

export function savingsTrend(periods: readonly SavingsPeriod[]): SavingsTrend {
  const points = byRunDate(periods)
    .filter((p) => p.status === 'closed' && p.adjusted.savingsRatio !== null)
    .slice(-TREND_PERIODS);
  const ys = points.map((p) => dec(p.adjusted.savingsRatio!, 'savings ratio'));
  const xs = points.map((p) => new JoinrDecimal(dayNumber(p.runDate)));
  const my = mean(ys);
  const mx = mean(xs);
  let slopePerDay: Dec | null = null;
  if (points.length >= 2 && mx !== null && my !== null) {
    let num = ZERO;
    let den = ZERO;
    xs.forEach((x, i) => {
      num = num.plus(x.minus(mx).times(ys[i]!.minus(my)));
      den = den.plus(x.minus(mx).pow(2));
    });
    slopePerDay = den.isZero() ? null : num.div(den);
  }
  const slope = slopePerDay;
  return {
    points,
    mean: my,
    slopePerDay,
    fitAt: (runDate) =>
      slope === null || mx === null || my === null
        ? null
        : my.plus(slope.times(new JoinrDecimal(dayNumber(runDate)).minus(mx))),
  };
}

const centsOrNull = (d: Dec | null): Cents | null => (d === null ? null : centsOf(d));

export function cashKpis(input: CashKpisInput): CashKpisResult {
  const periods = byRunDate(input.periods);
  const recorded = periods.filter((p) => p.status !== 'provisional');
  const closed = periods.filter((p) => p.status === 'closed');
  const anchor = recorded.length === 0 ? null : recorded[recorded.length - 1]!.runDate;
  const year = yearWindow(anchor ?? input.asOf, input.yearBasis);
  const current = dollarsOf(input.currentCashCents, 'current cash');

  // C17, C18, C37: the last closed period (the sheet took its live row, §11 fix 14).
  const last = closed[closed.length - 1] ?? null;
  const lastPeriod =
    last === null
      ? null
      : {
          periodMonth: last.periodMonth,
          runDate: last.runDate,
          cashGainCents: last.cashGainCents,
          savingsCents: last.adjusted.savingsCents,
          savingsRatio: last.adjusted.savingsRatio,
          rawSavingsRatio: last.raw.savingsRatio,
        };

  // C19, C20: closed periods from max(anchor − 365 days, the job start date).
  let from: IsoDate | null = null;
  if (anchor !== null) {
    const floor = addDaysIso(anchor, -AVERAGING_DAYS);
    from = input.jobStartDate !== null && input.jobStartDate > floor ? input.jobStartDate : floor;
    dayNumber(from);
  }
  const win = from === null ? [] : closed.filter((p) => p.runDate >= from);
  const gains = win.filter((p) => p.cashGainCents !== null);
  const avgGain = mean(gains.map((p) => dollarsOf(p.cashGainCents!)));
  const avgGainAdjusted = mean(
    gains.map((p) => dollarsOf(p.cashGainCents!).minus(dollarsOf(p.adjustmentCents))),
  );
  const avgAdded = mean(
    win
      .filter((p) => p.addedInvestmentsCents !== null)
      .map((p) => dollarsOf(p.addedInvestmentsCents!)),
  );
  const avgSavings = mean(
    win.map((p) => unroundedSavings(p.adjusted)).filter((d): d is Dec => d !== null),
  );
  const avgSavingsRaw = mean(
    win.map((p) => unroundedSavings(p.raw)).filter((d): d is Dec => d !== null),
  );

  // C21, C42, C43 and the weighted rate (C38, §11 fix 15) over the year's closed periods.
  const inYearClosed = closed.filter((p) => inYear(p.runDate, year));
  const trend = savingsTrend(periods);
  const trendPerMonth = trend.slopePerDay === null ? null : trend.slopePerDay.times(DAYS_PER_MONTH);

  // C24–C27: the end-of-year projection from available cash (D59) at the adjusted rate (fix 25).
  const monthsToYearEnd = anchor === null ? null : monthsBetween(anchor, year.end);
  const projected =
    monthsToYearEnd === null || avgGainAdjusted === null
      ? null
      : avgGainAdjusted.times(monthsToYearEnd).plus(current);
  const goal = input.eoyCashGoalCents === null ? null : dollarsOf(input.eoyCashGoalCents, 'goal');

  // C30–C34: the cash target (reached first, §11 fix 24).
  let cashTarget: CashKpisResult['cashTarget'] = null;
  const targetCents = input.cashSavingsTargetCents;
  if (targetCents !== null && targetCents > 0) {
    const target = dollarsOf(targetCents, 'cash target');
    const progressRatio = ratioString(current.div(target));
    if (current.greaterThanOrEqualTo(target)) {
      cashTarget = {
        targetCents,
        progressRatio,
        monthsToTarget: null,
        arrival: null,
        status: 'reached',
      };
    } else if (avgGainAdjusted !== null && avgGainAdjusted.greaterThan(0) && anchor !== null) {
      const months = ceilWhole(target.minus(current).div(avgGainAdjusted));
      cashTarget = {
        targetCents,
        progressRatio,
        monthsToTarget: months,
        arrival: addMonthsIso(anchor, months),
        status: 'on_track',
      };
    } else {
      cashTarget = {
        targetCents,
        progressRatio,
        monthsToTarget: null,
        arrival: null,
        status: 'no_savings',
      };
    }
  }

  // Budget M4: closed periods with a run date after anchor − 185 days.
  const spendFloor = anchor === null ? null : addDaysIso(anchor, -SPEND_WINDOW_DAYS);
  const spendWin = spendFloor === null ? [] : closed.filter((p) => p.runDate > spendFloor);
  const spendOf = (pick: (p: SavingsPeriod) => SavingsFigures) =>
    mean(spendWin.map((p) => unroundedSpend(pick(p))).filter((d): d is Dec => d !== null));

  return {
    anchor,
    year,
    lastPeriod,
    avgWindow: from === null || win.length === 0 ? null : { from, periods: win.length },
    avgCashGainCents: centsOrNull(avgGain),
    avgCashGainAdjustedCents: centsOrNull(avgGainAdjusted),
    avgAddedInvestmentsCents: centsOrNull(avgAdded),
    avgSavingsCents: centsOrNull(avgSavings),
    avgSavingsRawCents: centsOrNull(avgSavingsRaw),
    predictedCashPerYearCents: avgGainAdjusted === null ? null : centsOf(avgGainAdjusted.times(12)),
    yearCashGainCents: sumCents(inYearClosed.map((p) => p.cashGainCents ?? 0)),
    yearSavingsCents: sumCents(inYearClosed.map((p) => p.adjusted.savingsCents ?? 0)),
    yearAddedInvestmentsCents: sumCents(inYearClosed.map((p) => p.addedInvestmentsCents ?? 0)),
    yearIncomeCents: sumCents(inYearClosed.map((p) => p.adjusted.incomeCents ?? 0)),
    yearPeriods: inYearClosed.length,
    yearSavingsRatio: weightedRatio(inYearClosed.map((p) => p.adjusted)),
    yearSavingsRawRatio: weightedRatio(inYearClosed.map((p) => p.raw)),
    last3SavingsRatio: trend.mean === null ? null : ratioString(trend.mean),
    trendPerMonth: trendPerMonth === null ? null : ratioString(trendPerMonth),
    trend:
      trendPerMonth === null
        ? null
        : trendPerMonth.greaterThan(0)
          ? 'increasing'
          : trendPerMonth.lessThan(0)
            ? 'decreasing'
            : 'flat',
    monthsToYearEnd,
    eoyProjectedCashCents: centsOrNull(projected),
    eoyGapPerMonthCents:
      projected === null || goal === null
        ? null
        : centsOf(projected.minus(goal).div(Math.max(1, monthsToYearEnd!))),
    eoyOnTarget: projected === null || goal === null ? null : projected.greaterThanOrEqualTo(goal),
    cashTarget,
    spend6mCents: centsOrNull(spendOf((p) => p.adjusted)),
    spend6mRawCents: centsOrNull(spendOf((p) => p.raw)),
    spend6mPeriods: spendWin.length,
  };
}
