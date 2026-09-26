// The investment timing block (stage-2.md §2.12, §4.5 step 4; live from Stage 3, stage-3.md §4.5):
// the server builds the engine inputs from the live budget (the same BudgetInput the Budget page
// uses), the live cash balances, the settings and the snapshots, then runs budgetInvestment →
// parcelOptimiser → investCountdown (with the cash-deficit wait, SheetOptions H12), considerNext
// over the six asset classes and nextBuyHint for the page's kind. Every figure comes from the
// engine; the server only assembles and labels.
import type { BudgetInvestInput, BudgetInvestResult, TimingInput } from '@joinr/engine';
import {
  ASSET_CLASSES,
  type AssetClass,
  type InstrumentKind,
  type InvestmentTimingDto,
  type IsoDate,
  type SettingKey,
} from '@joinr/schema';
import {
  booleanSetting,
  numberSetting,
  stringSetting,
  type SettingsValues,
} from '../db/queries/settings';
import type { InvestmentsContext } from './context';

/** The setting holding each asset class's target (§2.12 "Allocation"). */
export const CLASS_TARGET_KEYS: Readonly<Record<AssetClass, SettingKey>> = {
  etf: 'allocation.etf',
  stock: 'allocation.stock',
  crypto: 'allocation.crypto',
  cash: 'allocation.cash',
  managed_fund: 'allocation.managedFund',
  other_assets: 'allocation.otherAssets',
};

/**
 * The timing chain's budgetInvestment input: `budgetInvestInputOf` of the same live BudgetInput
 * the Budget page uses (stage-3.md §4.5).
 */
export function budgetInvestInput(ctx: InvestmentsContext): BudgetInvestInput {
  return ctx.budgetInvestInput();
}

/** Inputs the server itself reports missing (null settings), in a fixed order after the engine's. */
function serverMissing(
  s: SettingsValues,
  budget: BudgetInvestResult,
  lastPurchaseDate: IsoDate | null,
): TimingInput[] {
  const out: TimingInput[] = [];
  for (const c of ASSET_CLASSES) {
    const key = CLASS_TARGET_KEYS[c];
    if (s[key] === null) out.push(key);
  }
  // The parcel plan and the countdown only matter when there is something to invest.
  if (budget.monthlyInvestCents !== null && budget.monthlyInvestCents > 0) {
    for (const key of [
      'investing.defaultBrokerageCents',
      'returns.marketReturn',
      'returns.cashInterestRate',
      'pay.dayOfMonth',
    ] as const) {
      if (s[key] === null) out.push(key);
    }
    if (lastPurchaseDate === null) out.push('investments.lastPurchaseDate');
  }
  return out;
}

export function buildTiming(ctx: InvestmentsContext, kind: InstrumentKind): InvestmentTimingDto {
  const { engine } = ctx;
  const s = ctx.data.settings;
  // Every kind feeds the class values (computed once per request).
  const values = ctx.classValues();
  const lastPurchaseDate = ctx.lastPurchaseDate();
  const budgetInput = budgetInvestInput(ctx);
  const budget = ctx.budgetInvest();
  const growthRatio = stringSetting(s, 'returns.marketReturn');
  const plan = engine.parcelOptimiser({
    monthlyInvestCents: budget.monthlyInvestCents,
    brokerageCents: numberSetting(s, 'investing.defaultBrokerageCents'),
    growthRatio,
    cashRateRatio: stringSetting(s, 'returns.cashInterestRate'),
  });
  // SheetOptions H12 (§2.12): the cash class (Total Cash, D59) against the liquid total.
  const cashDeficitMonths = engine.cashDeficitMonths({
    cashCents: values.cash,
    liquidTotalCents: ASSET_CLASSES.reduce((sum, c) => sum + values[c], 0),
    targetRatio: stringSetting(s, 'allocation.cash'),
    avgMonthlySavingsCents: ctx.kpis().avgSavingsCents,
  });
  const countdown = engine.investCountdown({
    asOf: ctx.asOf,
    monthlyInvestCents: budget.monthlyInvestCents,
    plan,
    lastPurchaseDate,
    payDayOfMonth: numberSetting(s, 'pay.dayOfMonth'),
    growthRatio,
    // D46: the budget's switches, so an automatic split that is off reads as such.
    useBudgetForInvest: budgetInput.useBudgetForInvest,
    autoInvestSplit: budgetInput.autoInvestSplit,
    cashDeficitMonths,
  });

  const classes = Object.fromEntries(
    ASSET_CLASSES.map((c) => [
      c,
      { valueCents: values[c], targetRatio: stringSetting(s, CLASS_TARGET_KEYS[c]) },
    ]),
  ) as Record<AssetClass, { valueCents: number; targetRatio: string | null }>;
  const consider = engine.considerNext({
    classes,
    // The emergency-fund test cash (§2.4): the same value the budget's 100 %-to-cash rule uses.
    cashCents: ctx.cashTotals().emergencyFundTestCents,
    emergencyFundCents: budget.emergencyFundCents,
  });
  const hint = engine.nextBuyHint({
    kind,
    considerNext: consider,
    holdings: ctx.compute(kind).holdings,
    parcelCents: plan?.parcelCents ?? null,
  });

  const missing = [
    ...new Set<string>([
      ...budget.missing,
      ...(countdown.state === 'unavailable' ? countdown.missing : []),
      ...serverMissing(s, budget, lastPurchaseDate),
    ]),
  ];

  return {
    monthlyInvestCents: budget.monthlyInvestCents,
    budget: {
      monthlyIncomeCents: budget.monthlyIncomeCents,
      plannedSpendCents: budget.plannedSpendCents,
      leftoverCents: budget.leftoverCents,
      emergencyFundCents: budget.emergencyFundCents,
      investShareRatio: budget.investShareRatio,
      investmentRowCents: budget.investmentRowCents,
      sideIncomeInvestCents: budget.sideIncomeInvestCents,
      useBudget: booleanSetting(s, 'budget.useForInvestAmount'),
      source: 'live_budget',
    },
    plan: plan
      ? {
          months: plan.months,
          parcelCents: plan.parcelCents,
          optimalParcelCents: plan.optimalParcelCents,
        }
      : null,
    lastPurchaseDate,
    countdown:
      countdown.state === 'unavailable'
        ? { state: 'unavailable' }
        : countdown.state === 'cash_first' || countdown.state === 'split_off'
          ? { state: countdown.state }
          : countdown.state === 'invest'
            ? {
                state: 'invest',
                nextPurchaseDate: countdown.nextPurchaseDate,
                periodDays: countdown.periodDays,
              }
            : {
                state: 'wait',
                days: countdown.days,
                nextPurchaseDate: countdown.nextPurchaseDate,
                periodDays: countdown.periodDays,
              },
    considerNext: {
      assetClass: consider.assetClass,
      reason: consider.reason,
      rows: consider.rows.map((r) => ({
        assetClass: r.assetClass,
        valueCents: r.valueCents,
        currentRatio: r.currentRatio,
        targetRatio: r.targetRatio,
        deltaRatio: r.deltaRatio,
      })),
    },
    hint: {
      assetClass: hint.assetClass,
      instrumentId: hint.instrumentId,
      symbol:
        hint.instrumentId === null
          ? null
          : (ctx.instrumentById.get(hint.instrumentId)?.symbol ?? null),
      parcelCents: hint.parcelCents,
    },
    missing,
    // Stage 3: the cash-deficit wait is live (cashDeficitMonths), so nothing is deferred.
    deferred: [],
    cashDeficitMonths,
  };
}
