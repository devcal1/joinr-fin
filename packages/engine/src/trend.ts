// The linear trend (stage-5.md §2.8): ordinary least squares of value (cents, decimals) on the day
// number of each date, over the non-null points. The dashboard fits the displayed chart groups, as
// a sheet trendline fits the chart's points (§5).
import { JoinrDecimal, type IsoDate } from '@joinr/schema';
import { roundCents } from './assetsCommon';
import { checkCents, dayNumber, decN, mean, ZERO, type Dec } from './num';
import type { Cents, TrendResult } from './types';

/** Days per month for the slope: 365.25 ÷ 12. */
const DAYS_PER_MONTH: Dec = new JoinrDecimal('365.25').div(12);

export function linearTrend(
  points: readonly { date: IsoDate; valueCents: Cents | null }[],
): TrendResult {
  const days = points.map((p) => dayNumber(p.date));
  const used = points
    .map((p, k) => ({ x: decN(days[k]!), v: p.valueCents }))
    .filter((p): p is { x: Dec; v: Cents } => p.v !== null)
    .map((p) => ({ x: p.x, y: decN(checkCents(p.v, 'trend value')) }));
  const none: TrendResult = {
    fittedCents: points.map(() => null),
    slopePerMonthCents: null,
    points: used.length,
  };
  if (used.length < 2) return none;
  const mx = mean(used.map((p) => p.x))!;
  const my = mean(used.map((p) => p.y))!;
  let num = ZERO;
  let den = ZERO;
  for (const p of used) {
    const dx = p.x.minus(mx);
    num = num.plus(dx.times(p.y.minus(my)));
    den = den.plus(dx.times(dx));
  }
  if (den.isZero()) return none; // a single distinct date
  const slope = num.div(den);
  return {
    fittedCents: points.map((p, k) =>
      p.valueCents === null ? null : roundCents(my.plus(slope.times(decN(days[k]!).minus(mx)))),
    ),
    slopePerMonthCents: roundCents(slope.times(DAYS_PER_MONTH)),
    points: used.length,
  };
}
