// The investment timing block (stage-2.md §2.12, §4.5 step 4): the server builds the engine inputs
// from the imported budget rows, settings and snapshots, then runs budgetInvestment →
// parcelOptimiser → investCountdown, considerNext over the six asset classes and nextBuyHint for
// the page's kind. Every figure comes from the engine; the server only assembles and labels.
import type {
  BudgetInvestInput,
  BudgetInvestResult,
  ConsiderNextResult,
  TimingInput,
} from '@joinr/engine';
import {
  ASSET_CLASSES,
  compareDecimals,
  isPositiveDecimal,
  type AssetClass,
  type DeferredTimingInput,
  type InstrumentKind,
  type InvestmentTimingDto,
  type IsoDate,
  type SettingKey,
} from '@joinr/schema';
import {
  aggressivenessSetting,
  booleanSetting,
  numberSetting,
  payFrequencySetting,
  stringSetting,
  type SettingsValues,
} from '../db/queries/settings';
import type { InvestmentsContext } from './context';
import { ratioOf } from './format';
import type { InvestmentData, SnapshotRow } from './load';

/** The setting holding each asset class's target (§2.12 "Allocation"). */
export const CLASS_TARGET_KEYS: Readonly<Record<AssetClass, SettingKey>> = {
  etf: 'allocation.etf',
  stock: 'allocation.stock',
  crypto: 'allocation.crypto',
  cash: 'allocation.cash',
  managed_fund: 'allocation.managedFund',
  other_assets: 'allocation.otherAssets',
};

/** The latest ETF or stock BUY (SheetOptions H20). */
export function lastStockOrEtfBuy(data: InvestmentData): IsoDate | null {
  const ids = new Set(
    data.instruments.filter((i) => i.kind === 'stock' || i.kind === 'etf').map((i) => i.id),
  );
  let last: IsoDate | null = null;
  for (const t of data.trades) {
    if (!ids.has(t.instrumentId) || !isPositiveDecimal(t.units)) continue;
    if (last === null || t.tradeDate > last) last = t.tradeDate;
  }
  return last;
}

/**
 * cash / liquid assets at the latest snapshot (SheetOptions H43): cash_value / (stocks + etf +
 * crypto + cash + mf + other value). Null when there is no snapshot or the total is not positive.
 */
export function lastSnapshotCashShare(snapshots: readonly SnapshotRow[]): string | null {
  const latest = snapshots.reduce<SnapshotRow | null>(
    (best, s) => (best === null || s.periodMonth > best.periodMonth ? s : best),
    null,
  );
  if (!latest) return null;
  const v = (n: number | null) => n ?? 0;
  const total =
    v(latest.stocksValueCents) +
    v(latest.etfValueCents) +
    v(latest.cryptoValueCents) +
    v(latest.cashValueCents) +
    v(latest.mfValueCents) +
    v(latest.otherValueCents);
  return total > 0 ? ratioOf(v(latest.cashValueCents), total) : null;
}

/** The six asset-class values: the four kinds' priced values, cash and other assets. */
export function classValues(ctx: InvestmentsContext): Record<AssetClass, number> {
  const kindValue = (k: InstrumentKind) => ctx.compute(k).summary.valueCents;
  return {
    etf: kindValue('etf'),
    stock: kindValue('stock'),
    crypto: kindValue('crypto'),
    cash: ctx.data.budget.cashCents,
    managed_fund: kindValue('managed_fund'),
    other_assets: ctx.data.budget.otherAssetsCents,
  };
}

export function budgetInvestInput(
  ctx: InvestmentsContext,
  values: Record<AssetClass, number>,
  lastPurchaseDate: IsoDate | null,
): BudgetInvestInput {
  const s = ctx.data.settings;
  const total = ASSET_CLASSES.reduce((sum, c) => sum + values[c], 0);
  return {
    asOf: ctx.asOf,
    payFrequency: payFrequencySetting(s),
    netPayCents: numberSetting(s, 'pay.netPayCents'),
    includeSideIncome: booleanSetting(s, 'budget.includeSideIncome') === true,
    sideIncomePeriods: ctx.data.budget.sideIncomePeriods,
    items: ctx.data.budget.items,
    yearlyExpenseAnnualCents: ctx.data.budget.yearlyExpenseAnnualCents,
    autoInvestSplit: booleanSetting(s, 'budget.autoInvestSplit'),
    useBudgetForInvest: booleanSetting(s, 'budget.useForInvestAmount'),
    cashTargetRatio: stringSetting(s, 'allocation.cash'),
    aggressiveness: aggressivenessSetting(s),
    lastSnapshotCashShare: lastSnapshotCashShare(ctx.data.snapshots),
    currentCashShare: total > 0 ? ratioOf(values.cash, total) : null,
    cashCents: ctx.data.budget.cashCents,
    emergencyFundMonths: numberSetting(s, 'budget.emergencyFundMonths'),
    emergencyFundOverrideCents: numberSetting(s, 'budget.emergencyFundOverrideCents'),
    marginalTaxRate: stringSetting(s, 'tax.marginalRate'),
    lastPurchaseDate,
  };
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

/** Cash is below its target share (the Stage 3 cash-deficit wait would apply; §1.5). */
function cashBelowTarget(consider: ConsiderNextResult): boolean {
  const cash = consider.rows.find((r) => r.assetClass === 'cash');
  return (
    cash !== undefined &&
    cash.targetRatio !== null &&
    compareDecimals(cash.currentRatio, cash.targetRatio) < 0
  );
}

export function buildTiming(ctx: InvestmentsContext, kind: InstrumentKind): InvestmentTimingDto {
  const { engine } = ctx;
  const s = ctx.data.settings;
  // Every kind feeds the class values (computed once per request).
  const values = classValues(ctx);
  const lastPurchaseDate = lastStockOrEtfBuy(ctx.data);

  const budgetInput = budgetInvestInput(ctx, values, lastPurchaseDate);
  const budget = engine.budgetInvestment(budgetInput);
  const growthRatio = stringSetting(s, 'returns.marketReturn');
  const plan = engine.parcelOptimiser({
    monthlyInvestCents: budget.monthlyInvestCents,
    brokerageCents: numberSetting(s, 'investing.defaultBrokerageCents'),
    growthRatio,
    cashRateRatio: stringSetting(s, 'returns.cashInterestRate'),
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
  });

  const classes = Object.fromEntries(
    ASSET_CLASSES.map((c) => [
      c,
      { valueCents: values[c], targetRatio: stringSetting(s, CLASS_TARGET_KEYS[c]) },
    ]),
  ) as Record<AssetClass, { valueCents: number; targetRatio: string | null }>;
  const consider = engine.considerNext({
    classes,
    cashCents: ctx.data.budget.cashCents,
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
  const deferred: DeferredTimingInput[] = cashBelowTarget(consider) ? ['cash_deficit_period'] : [];

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
      source: 'imported_budget',
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
    deferred,
  };
}
