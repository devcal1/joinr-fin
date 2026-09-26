// Savings goals (stage-3.md §2.7; D55, D59; §11 fix 3): what is saved toward goals (available cash
// above the emergency fund, plus a share of the investments, kept even below the fund), filled
// into the goals in list order (a waterfall), with an ETA from the monthly progress that feeds
// them. No hard-coded 65 % and no house-price settings.
import { addMonthsIso } from '@joinr/schema';
import { ceilWhole, centsOf, checkCents, dec, dollarsOf, ratioString, ZERO } from './num';
import { monthsBetween } from './periods';
import type { SavingsGoalResult, SavingsGoalsInput, SavingsGoalsResult } from './types';

export function savingsGoals(input: SavingsGoalsInput): SavingsGoalsResult {
  const share =
    input.investmentShareRatio === null
      ? ZERO
      : dec(input.investmentShareRatio, 'investment share');
  const cashAboveFund = Math.max(
    0,
    checkCents(input.goalsCashCents, 'goals cash') - (input.emergencyFundCents ?? 0),
  );
  const savedCents =
    cashAboveFund +
    centsOf(share.times(dollarsOf(input.investmentsValueCents, 'investments value')));
  const monthlyProgressCents =
    input.avgCashGainAdjustedCents === null
      ? null
      : checkCents(input.avgCashGainAdjustedCents, 'average cash gain') +
        centsOf(share.times(dollarsOf(input.avgAddedInvestmentsCents ?? 0, 'average added')));

  let pool = savedCents;
  let cumulative = 0;
  const goals: SavingsGoalResult[] = input.goals.map((g) => {
    const target = checkCents(g.targetCents, `goal ${g.id} target`);
    const allocatedCents = Math.max(0, Math.min(target, pool));
    pool -= allocatedCents;
    cumulative += target;
    const reached = allocatedCents >= target;
    // What the goals up to and including this one still need.
    const need = cumulative - savedCents;
    const monthsToGo =
      reached || monthlyProgressCents === null || monthlyProgressCents <= 0
        ? null
        : ceilWhole(dollarsOf(need).div(dollarsOf(monthlyProgressCents)));
    const eta = monthsToGo === null ? null : addMonthsIso(input.anchor, monthsToGo);
    const onTrack = g.targetDate === null ? null : reached || (eta !== null && eta <= g.targetDate);
    const requiredPerMonthCents =
      reached || g.targetDate === null
        ? null
        : ceilWhole(
            dollarsOf(need)
              .times(100)
              .div(Math.max(1, monthsBetween(input.anchor, g.targetDate))),
          );
    return {
      id: g.id,
      allocatedCents,
      remainingCents: target - allocatedCents,
      progressRatio:
        target > 0 ? ratioString(dollarsOf(allocatedCents).div(dollarsOf(target))) : '1',
      reached,
      monthsToGo,
      eta,
      onTrack,
      requiredPerMonthCents,
    };
  });
  return { savedCents, monthlyProgressCents, goals };
}
