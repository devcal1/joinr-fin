// The Cash page chart series (stage-3.md §2.13, §5): savings periods grouped like compressSeries
// (monthly, calendar quarter, or the year window on the year basis, D52). Cash is the group's
// last value; flows are sums; the rates are Σ savings / Σ income (income-weighted, §11 fix 15);
// the monthly unit carries the fitted 3-period trend line at its closed trend periods.
import type { ChartDateUnit, YearBasis } from '@joinr/schema';
import { ratioString } from './num';
import { byRunDate, savingsTrend, weightedRatio } from './kpis';
import { groupOf, keepLast } from './periods';
import type { CashflowChartPoint, Cents, SavingsPeriod } from './types';

/** Σ of the non-null values; null when every value is null (compressSeries' `sum`). */
function sumOrNull(values: readonly (Cents | null)[]): Cents | null {
  let total: Cents | null = null;
  for (const v of values) if (v !== null) total = (total ?? 0) + v;
  return total;
}

export function compressCashflow(i: {
  periods: readonly SavingsPeriod[];
  unit: ChartDateUnit;
  count: number | null;
  yearBasis: YearBasis;
}): CashflowChartPoint[] {
  // compressSeries' order: by period month, then date (the run-date order of computeSavings).
  const periods = byRunDate(i.periods)
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        (a.p.periodMonth < b.p.periodMonth ? -1 : a.p.periodMonth > b.p.periodMonth ? 1 : 0) ||
        a.index - b.index,
    )
    .map((x) => x.p);

  const groups: { key: string; label: string; periods: SavingsPeriod[] }[] = [];
  for (const p of periods) {
    const { key, label } = groupOf(p.periodMonth, p.runDate, i.unit, i.yearBasis);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.periods.push(p);
    else groups.push({ key, label, periods: [p] });
  }

  // The trend line (monthly only): its fitted value at each of its ≤ 3 closed periods.
  const trend = savingsTrend(i.periods);
  const trendPeriods = new Set(trend.points);

  return keepLast(groups, i.unit, i.count).map((g) => {
    const last = g.periods[g.periods.length - 1]!;
    const trendPeriod =
      i.unit === 'monthly' ? [...g.periods].reverse().find((p) => trendPeriods.has(p)) : undefined;
    const fitted = trendPeriod === undefined ? null : trend.fitAt(trendPeriod.runDate);
    return {
      label: g.label,
      period: last.periodMonth,
      date: last.runDate,
      live: last.status === 'provisional',
      cashCents: last.cashCents,
      cashGainCents: sumOrNull(g.periods.map((p) => p.cashGainCents)),
      addedInvestmentsCents: sumOrNull(g.periods.map((p) => p.addedInvestmentsCents)),
      adjustmentCents: g.periods.reduce((total, p) => total + p.adjustmentCents, 0),
      savingsCents: sumOrNull(g.periods.map((p) => p.adjusted.savingsCents)),
      savingsRawCents: sumOrNull(g.periods.map((p) => p.raw.savingsCents)),
      incomeCents: sumOrNull(g.periods.map((p) => p.adjusted.incomeCents)),
      savingsRatio: weightedRatio(g.periods.map((p) => p.adjusted)),
      savingsRawRatio: weightedRatio(g.periods.map((p) => p.raw)),
      trendRatio: fitted === null ? null : ratioString(fitted),
    };
  });
}
