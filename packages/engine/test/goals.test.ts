// Savings goals (stage-3.md §2.7; D55, D59; §7.3 step 5). Generic round figures.
import { describe, expect, it } from 'vitest';
import { savingsGoals, type SavingsGoalsInput } from '../src/index';

const input: SavingsGoalsInput = {
  anchor: '2026-08-31',
  goals: [
    { id: 1, targetCents: 300_000, targetDate: null },
    { id: 2, targetCents: 500_000, targetDate: '2027-02-28' },
    { id: 3, targetCents: 1_000_000, targetDate: '2026-12-31' },
  ],
  goalsCashCents: 1_200_000,
  emergencyFundCents: 500_000,
  investmentsValueCents: 4_000_000,
  investmentShareRatio: '0.05',
  avgCashGainAdjustedCents: 90_000,
  avgAddedInvestmentsCents: 200_000,
};
const goals = (over: Partial<SavingsGoalsInput> = {}) => savingsGoals({ ...input, ...over });

describe('savingsGoals (§2.7)', () => {
  it('saves available cash above the emergency fund plus a share of the investments', () => {
    const r = goals();
    // 1,200,000 − 500,000 + 5 % of 4,000,000 = 900,000; progress 90,000 + 5 % of 200,000.
    expect(r.savedCents).toBe(900_000);
    expect(r.monthlyProgressCents).toBe(100_000);
  });

  it('fills the goals in order: reached, partial, not started', () => {
    const [a, b, c] = goals().goals;
    expect(a).toEqual({
      id: 1,
      allocatedCents: 300_000,
      remainingCents: 0,
      progressRatio: '1',
      reached: true,
      monthsToGo: null,
      eta: null,
      onTrack: null,
      requiredPerMonthCents: null,
    });
    // 600,000 left for goal 2 (target 500,000): reached; 100,000 left for goal 3.
    expect(b).toMatchObject({
      allocatedCents: 500_000,
      remainingCents: 0,
      reached: true,
      onTrack: true,
    });
    expect(c).toMatchObject({
      allocatedCents: 100_000,
      remainingCents: 900_000,
      progressRatio: '0.1',
      reached: false,
    });
  });

  it('dates an unreached goal from the cumulative targets and the monthly progress', () => {
    const c = goals().goals[2]!;
    // Σ targets 1,800,000 − saved 900,000 = 900,000 at 100,000 a month: 9 months.
    expect(c).toMatchObject({ monthsToGo: 9, eta: '2027-05-31', onTrack: false });
    // Required: 900,000 over DATEDIF(31/08/2026, 31/12/2026) = 4 months.
    expect(c.requiredPerMonthCents).toBe(225_000);
    const later = goals({
      goals: [{ id: 3, targetCents: 1_000_000, targetDate: '2026-11-30' }],
    }).goals[0]!;
    // 100,000 needed: 1 month at 100,000 a month, well before the date; DATEDIF(31/08, 30/11) = 2.
    expect(later).toMatchObject({
      allocatedCents: 900_000,
      monthsToGo: 1,
      eta: '2026-09-30',
      onTrack: true,
      requiredPerMonthCents: 50_000,
    });
    // Rounded up to the cent: 100,000 over 3 months.
    const three = goals({ goals: [{ id: 3, targetCents: 1_000_000, targetDate: '2026-12-01' }] });
    expect(three.goals[0]!.requiredPerMonthCents).toBe(33_334);
  });

  it('keeps the investment share while cash is below the emergency fund (§11 fix 3)', () => {
    const r = goals({ goalsCashCents: 300_000 });
    expect(r.savedCents).toBe(200_000);
    expect(r.goals[0]).toMatchObject({ allocatedCents: 200_000, remainingCents: 100_000 });
    expect(goals({ emergencyFundCents: null }).savedCents).toBe(1_400_000);
    expect(goals({ investmentShareRatio: null }).savedCents).toBe(700_000);
  });

  it('gives no dates without progress, and a required amount even for a past date', () => {
    const none = goals({ avgCashGainAdjustedCents: null });
    expect(none.monthlyProgressCents).toBeNull();
    expect(none.goals[2]).toMatchObject({ monthsToGo: null, eta: null, onTrack: false });
    const losing = goals({ avgCashGainAdjustedCents: -50_000, avgAddedInvestmentsCents: 0 });
    expect(losing.monthlyProgressCents).toBe(-50_000);
    expect(losing.goals[2]).toMatchObject({ monthsToGo: null, eta: null });
    // A target date already past: the whole need in one month.
    const past = goals({ goals: [{ id: 9, targetCents: 2_000_000, targetDate: '2026-01-31' }] });
    expect(past.goals[0]).toMatchObject({ requiredPerMonthCents: 1_100_000, onTrack: false });
  });

  it('handles no goals and a zero saved amount', () => {
    expect(goals({ goals: [] }).goals).toEqual([]);
    const zero = goals({ goalsCashCents: 0, investmentsValueCents: 0 });
    expect(zero.savedCents).toBe(0);
    expect(zero.goals[0]).toMatchObject({
      allocatedCents: 0,
      progressRatio: '0',
      reached: false,
      monthsToGo: 3,
    });
  });
});
