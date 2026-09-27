// One request's view of the finance data (stage-2.md §4.5 steps 1–3, stage-3.md §4.5 "One request
// context"): the prices (first, from the price service), every row the investment and cash-flow
// pages and the timing chain need (one read transaction), the as-of date and the engine results,
// each computed at most once per request. The server adds only display fields; every figure comes
// from the engine. Stage 4 (stage-4.md §4.5): the market series (first, beside the prices), the
// other-assets, super and property engines, the History seam, and the live savings input and the
// other-assets class value taken from them. Stage 5 (stage-5.md §4.5): the snapshots in run-date
// order, the live snapshot composed at asOf, the net-worth dashboard, the rolling table and the
// snapshot checks; the D88 figures (stored offsets, measured-through dates) reach the savings and
// super engines through their inputs. Stage 6 (stage-6.md §4.5): the FIRE derivation (`fireDerived`).
import { engine as defaultEngine } from '@joinr/engine';
import type {
  AssetsSnapshotColumns,
  ComposeSnapshotInput,
  ConsiderNextResult,
  EngineSnapshot,
  NetWorthDashboardResult,
  RollingNetWorthRow,
  SnapshotCheckResult,
  SnapshotFigures,
  BudgetInput,
  BudgetInvestInput,
  BudgetInvestResult,
  BudgetResult,
  CashKpisResult,
  CashTotalsResult,
  Cents,
  DividendsResult,
  EngineApi,
  EnginePrice,
  FireDerived,
  InvestmentsResult,
  OtherAssetsInput,
  OtherAssetsResult,
  PropertiesResult,
  PropertyInput,
  SavingsResult,
  SideIncomeResult,
  SuperInput,
  SuperResult,
} from '@joinr/engine';
import {
  ASSET_CLASSES,
  INSTRUMENT_KINDS,
  NET_WORTH_PROJECTION_MONTHS,
  type AssetClass,
  type DecimalString,
  type InstrumentKind,
  type IsoDate,
  type IsoMonth,
  type MarketQuoteItem,
  type PriceItem,
} from '@joinr/schema';
import { SPOT_SERIES_BY_METAL } from '../assets/constants';
import {
  buildOtherAssetsInput,
  buildPropertyInput,
  buildSuperInput,
  metalsInUse,
  spotHistoryFrom,
} from '../assets/inputs';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDatabase } from '../db/database';
import {
  aggressivenessSetting,
  booleanSetting,
  numberSetting,
  payFrequencySetting,
  stringSetting,
} from '../db/queries/settings';
import { engineSnapshots, figuresOf, tradesByKind } from '../history/inputs';
import { localIsoDate, ratioOf } from '../investments/format';
import { CLASS_TARGET_KEYS } from '../investments/timing';
import {
  loadInvestmentData,
  rowsOfKind,
  toEngineDividend,
  toEngineInstrument,
  toEngineTrade,
  type InstrumentRow,
  type InvestmentData,
  type KindRows,
} from '../investments/load';
import { readQuoteHistory } from '../market/history';
import type { MarketDataService, MarketDataStatus } from '../market/types';
import { LOANS_COUNT_FOR_EMERGENCY_FUND } from './constants';
import {
  budgetRowsInput,
  closedSideIncomePeriods,
  includeMortgagePrincipalOf,
  includeSideIncomeOf,
  lastSnapshotCashShare,
  lastStockOrEtfBuy,
  liveOffsetsKnown,
  liveSavingsInput,
  offsetsIncludeEmergencyFundOf,
  otherAssetFlows,
  savingsSnapshots,
  sideIncomeInput,
  toEngineCashAccount,
  yearBasisOf,
} from './inputs';

/** What the finance routes and builders depend on (injected by the route plugins). */
export interface FinanceDeps {
  database: AppDatabase;
  market: MarketDataService;
  engine: EngineApi;
  /** The clock: `asOf` is its server-local calendar date. */
  now: () => Date;
}

export interface FinanceContext {
  engine: EngineApi;
  now: Date;
  asOf: IsoDate;
  data: InvestmentData;
  market: MarketDataStatus;
  /** Price items by instrument id (manual wins; from the price service). */
  priceItems: ReadonlyMap<number, PriceItem>;
  instrumentById: ReadonlyMap<number, InstrumentRow>;
  rows(kind: InstrumentKind): KindRows;
  /** `computeInvestments` for a kind, computed once per request. */
  compute(kind: InstrumentKind): InvestmentsResult;
  // ─── Stage 3 (each computed once per request) ───
  /** `cashTotals` with the D59 constant and the D56 setting. */
  cashTotals(): CashTotalsResult;
  /** The six asset-class values: the four kinds' priced values, Total Cash and other assets. */
  classValues(): Record<AssetClass, Cents>;
  /** The latest ETF or stock BUY (SheetOptions H20). */
  lastPurchaseDate(): IsoDate | null;
  sideIncome(): SideIncomeResult;
  savings(): SavingsResult;
  kpis(): CashKpisResult;
  /** The live Budget input: the Budget page and the timing chain use the same one (§4.5). */
  budgetInput(): BudgetInput;
  budget(): BudgetResult;
  /** `budgetInvestInputOf(budgetInput())`: the timing chain's exact budgetInvestment input. */
  budgetInvestInput(): BudgetInvestInput;
  /** `budgetInvestment(budgetInvestInput())`: the timing chain's budget. */
  budgetInvest(): BudgetInvestResult;
  dividends(): DividendsResult;
  // ─── Stage 4 (stage-4.md §4.5; each computed once per request) ───
  /** The price service's market series (spot, FX), read before the transaction. */
  series: MarketQuoteItem[];
  otherAssetsInput(): OtherAssetsInput;
  /** `computeOtherAssets` (live spot and FX). */
  otherAssets(): OtherAssetsResult;
  superInput(): SuperInput;
  /** `computeSuper`. */
  superResult(): SuperResult;
  propertyInput(): PropertyInput;
  /** `computeProperty` (with the linked offsets, D67). */
  property(): PropertiesResult;
  /** `assetsSnapshotColumns` of the three: the live History columns (the Stage 5 seam, §2.8). */
  assetsSnapshot(): AssetsSnapshotColumns;
  /**
   * The bullion spot series' daily history for the metals in use (`readQuoteHistory`), from one
   * year before `asOf` (or the earliest bullion purchase date when later), by series id.
   */
  spotHistory(): Record<string, { date: IsoDate; value: DecimalString }[]>;
  // ─── Stage 5 (stage-5.md §4.5; each computed once per request) ───
  /** `monthlyPayCents` of the current pay settings (History W; the savings live input). */
  salaryMonthly(): Cents | null;
  /** Every snapshot as the engine takes it, in run-date order (then period month). */
  snapshots(): EngineSnapshot[];
  /** The latest snapshot's run date, or null. */
  lastRun(): IsoDate | null;
  /** `nextRecordMonth(snapshots, asOf)`: the provisional period's month (§2.9). */
  liveMonth(): IsoMonth;
  /** `recordableMonths(snapshots, asOf)`. */
  recordable(): IsoMonth[];
  /** `composeSnapshot`'s input for `periodMonth` at asOf (the previous snapshot: the latest). */
  composeInput(periodMonth: IsoMonth): ComposeSnapshotInput;
  /** `composeSnapshot` for `periodMonth` at asOf (memoised per month). */
  compose(periodMonth: IsoMonth): SnapshotFigures;
  /**
   * The live snapshot: `compose(liveMonth())`; null when asOf ≤ the last run (no provisional
   * period: the month was recorded today).
   */
  composeLive(): SnapshotFigures | null;
  /**
   * The figures the dashboard shows: the live snapshot, else the latest snapshot's figures (so the
   * page still shows today's position when a month was recorded today).
   */
  dashboardFigures(): SnapshotFigures;
  /** The liquid allocation (the Stage 2 timing chain's `considerNext`, as the investment pages). */
  considerNext(): ConsiderNextResult;
  /** `netWorthDashboard`. */
  netWorth(): NetWorthDashboardResult;
  /** `rollingNetWorth` (recorded, live and 12 projected rows). */
  rolling(): RollingNetWorthRow[];
  /** `checkSnapshots` over every snapshot and every trade. */
  check(): SnapshotCheckResult;
  // ─── Stage 6 (stage-6.md §4.5; computed once per request) ───
  /**
   * `deriveFireInputs` of dashboardFigures(), netWorth().classes and .liabilities, property(),
   * savings().periods, kpis() and superResult().
   */
  fireDerived(): FireDerived;
}

/** The finance deps a route plugin builds from its options (the real engine and clock by default). */
export function financeDeps(opts: {
  database: AppDatabase;
  market: MarketDataService;
  now?: () => Date;
  engine?: EngineApi;
}): FinanceDeps {
  return {
    database: opts.database,
    market: opts.market,
    engine: opts.engine ?? defaultEngine,
    now: opts.now ?? (() => new Date()),
  };
}

/** The effective prices of the given instruments, as the engine takes them (§2.13). */
export function enginePrices(
  instrumentIds: Iterable<number>,
  priceItems: ReadonlyMap<number, PriceItem>,
): Map<number, EnginePrice> {
  const out = new Map<number, EnginePrice>();
  for (const id of instrumentIds) {
    const item = priceItems.get(id);
    if (item) out.set(id, { price: item.price, status: item.status });
  }
  return out;
}

/** A lazily computed value, evaluated at most once. */
function once<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

export function createFinanceContext(deps: FinanceDeps, log?: FastifyBaseLogger): FinanceContext {
  const { engine } = deps;
  const now = deps.now();
  const asOf = localIsoDate(now);
  // 1. Prices (the price service reads its own tables), then 2. the rows in one read transaction.
  const prices = deps.market.getPrices();
  const priceItems = new Map(prices.items.map((i) => [i.instrumentId, i]));
  const series = deps.market.getSeries();
  const data = loadInvestmentData(deps.database.db, log);
  const s = data.settings;
  const instrumentById = new Map(data.instruments.map((i) => [i.id, i]));
  const rowsMemo = new Map<InstrumentKind, KindRows>();
  const resultMemo = new Map<InstrumentKind, InvestmentsResult>();

  const rows = (kind: InstrumentKind): KindRows => {
    let r = rowsMemo.get(kind);
    if (!r) {
      r = rowsOfKind(data, kind);
      rowsMemo.set(kind, r);
    }
    return r;
  };

  const compute = (kind: InstrumentKind): InvestmentsResult => {
    let result = resultMemo.get(kind);
    if (!result) {
      const r = rows(kind);
      result = engine.computeInvestments({
        kind,
        asOf,
        instruments: r.instruments.map(toEngineInstrument),
        trades: r.trades.map(toEngineTrade),
        dividends: r.dividends.map(toEngineDividend),
        prices: enginePrices(
          r.instruments.map((i) => i.id),
          priceItems,
        ),
      });
      resultMemo.set(kind, result);
    }
    return result;
  };

  const cashTotals = once(() =>
    engine.cashTotals({
      accounts: data.cashAccounts.map(toEngineCashAccount),
      offsetsIncludeEmergencyFund: offsetsIncludeEmergencyFundOf(s),
      loansCountForEmergencyFund: LOANS_COUNT_FOR_EMERGENCY_FUND,
    }),
  );

  // ─── Stage 4 (§4.5) ───
  const otherAssetsInput = once(() => buildOtherAssetsInput(data, series, asOf));
  const otherAssets = once(() => engine.computeOtherAssets(otherAssetsInput()));
  const superInput = once(() => buildSuperInput(data, asOf));
  const superResult = once(() => engine.computeSuper(superInput()));
  const propertyInput = once(() => buildPropertyInput(data, asOf));
  const property = once(() => engine.computeProperty(propertyInput()));
  const assetsSnapshot = once(() =>
    engine.assetsSnapshotColumns({
      otherAssets: otherAssets(),
      super: superResult(),
      property: property(),
    }),
  );
  const spotHistory = once(() => {
    const ids = metalsInUse(data.otherAssets).map((m) => SPOT_SERIES_BY_METAL[m]);
    return ids.length === 0
      ? {}
      : readQuoteHistory(deps.database.db, ids, spotHistoryFrom(data.otherAssets, asOf));
  });

  const classValues = once((): Record<AssetClass, Cents> => {
    const kindValue = (k: InstrumentKind) => compute(k).summary.valueCents;
    return {
      etf: kindValue('etf'),
      stock: kindValue('stock'),
      crypto: kindValue('crypto'),
      // Net worth keeps loans you've made (D59): the cash class is Total Cash.
      cash: cashTotals().totalCashCents,
      managed_fund: kindValue('managed_fund'),
      // Stage 4 (§4.5): the engine's value with live spot and FX (Stage 3 summed stored prices).
      other_assets: otherAssets().totals.valueCents,
    };
  });

  const lastPurchaseDate = once(() => lastStockOrEtfBuy(data));

  const sideIncome = once(() => engine.computeSideIncome(sideIncomeInput(data, asOf)));

  const salaryMonthly = once(() =>
    engine.monthlyPayCents({
      netPayCents: numberSetting(s, 'pay.netPayCents'),
      payFrequency: payFrequencySetting(s),
    }),
  );

  const savings = once(() =>
    engine.computeSavings({
      asOf,
      snapshots: savingsSnapshots(data),
      live: liveSavingsInput({
        // The savings engine keeps loans in (D59).
        totalCashCents: cashTotals().totalCashCents,
        salaryMonthlyCents: salaryMonthly(),
        superResult: superResult(),
        property: property(),
        // Stage 5 (§4.5, D88b): known when an offset account exists or a month stores a figure.
        offsetCents: liveOffsetsKnown(data) ? cashTotals().offsetCents : null,
      }),
      trades: data.trades.map(toEngineTrade),
      otherAssetPurchases: otherAssetFlows(otherAssets()),
      sideIncome: data.deposits.map((d) => ({ date: d.depositDate, amountCents: d.amountCents })),
      dividends: data.dividends.map(toEngineDividend),
      adjustments: data.adjustments.map((a) => ({
        periodMonth: a.periodMonth,
        amountCents: a.amountCents,
      })),
      includeMortgagePrincipal: includeMortgagePrincipalOf(s),
    }),
  );

  const kpis = once(() =>
    engine.cashKpis({
      asOf,
      periods: savings().periods,
      yearBasis: yearBasisOf(s),
      jobStartDate: stringSetting(s, 'pay.jobStartDate'),
      // D59: the cash target and the end-of-year goal start from available cash.
      currentCashCents: cashTotals().availableCashCents,
      eoyCashGoalCents: numberSetting(s, 'goals.eoyCashGoalCents'),
      cashSavingsTargetCents: numberSetting(s, 'goals.cashSavingsTargetCents'),
    }),
  );

  const budgetInput = once((): BudgetInput => {
    const values = classValues();
    const total = ASSET_CLASSES.reduce((sum, c) => sum + values[c], 0);
    return {
      asOf,
      payFrequency: payFrequencySetting(s),
      netPayCents: numberSetting(s, 'pay.netPayCents'),
      includeSideIncome: includeSideIncomeOf(s),
      sideIncomePeriods: closedSideIncomePeriods(sideIncome()),
      rows: budgetRowsInput(data),
      yearlyExpenses: data.yearlyExpenses.map((y) => ({
        id: y.id,
        name: y.name,
        annualCents: y.annualCents,
      })),
      autoInvestSplit: booleanSetting(s, 'budget.autoInvestSplit'),
      useBudgetForInvest: booleanSetting(s, 'budget.useForInvestAmount'),
      cashTargetRatio: stringSetting(s, 'allocation.cash'),
      aggressiveness: aggressivenessSetting(s),
      lastSnapshotCashShare: lastSnapshotCashShare(data.snapshots),
      currentCashShare: total > 0 ? ratioOf(values.cash, total) : null,
      // The emergency-fund test cash (§2.4, §2.9 step 8): available cash (+ offsets, D56).
      cashCents: cashTotals().emergencyFundTestCents,
      emergencyFundMonths: numberSetting(s, 'budget.emergencyFundMonths'),
      emergencyFundOverrideCents: numberSetting(s, 'budget.emergencyFundOverrideCents'),
      marginalTaxRate: stringSetting(s, 'tax.marginalRate'),
      lastPurchaseDate: lastPurchaseDate(),
    };
  });

  const budget = once(() => engine.computeBudget(budgetInput()));

  const budgetInvestInput = once(() => engine.budgetInvestInputOf(budgetInput()));
  const budgetInvest = once(() => engine.budgetInvestment(budgetInvestInput()));

  const dividends = once(() => {
    const netUnits = new Map<number, string>();
    for (const kind of INSTRUMENT_KINDS) {
      for (const h of compute(kind).holdings) netUnits.set(h.instrumentId, h.netUnits);
    }
    return engine.computeDividends({
      asOf,
      holdings: data.instruments.map((i) => ({
        instrumentId: i.id,
        kind: i.kind,
        dividendFreqMonths: i.dividendFreqMonths,
        drp: i.drp,
        unitsNow: netUnits.get(i.id) ?? '0',
      })),
      trades: data.trades.map(toEngineTrade),
      dividends: data.dividends.map(toEngineDividend),
    });
  });

  // ─── Stage 5 (stage-5.md §4.5) ───
  const snapshots = once(() => engineSnapshots(data.snapshots));
  const lastRun = once(() => snapshots().at(-1)?.runDate ?? null);
  const liveMonth = once(() => engine.nextRecordMonth(snapshots(), asOf));
  const recordable = once(() => engine.recordableMonths(snapshots(), asOf));
  const trades = once(() => tradesByKind(data));

  const composeInput = (periodMonth: IsoMonth): ComposeSnapshotInput => {
    const previous = snapshots().at(-1) ?? null;
    return {
      periodMonth,
      runDate: asOf,
      previous:
        previous === null
          ? null
          : { runDate: previous.runDate, cashValueCents: previous.cashValueCents },
      investments: {
        stock: compute('stock'),
        etf: compute('etf'),
        managed_fund: compute('managed_fund'),
        crypto: compute('crypto'),
      },
      trades: trades(),
      cash: cashTotals(),
      cashAccounts: data.cashAccounts.map(toEngineCashAccount),
      salaryMonthlyCents: salaryMonthly(),
      assets: assetsSnapshot(),
      superMeasuredThrough: superResult().measuredThrough ?? null,
    };
  };
  const composed = new Map<IsoMonth, SnapshotFigures>();
  const compose = (periodMonth: IsoMonth): SnapshotFigures => {
    let figures = composed.get(periodMonth);
    if (!figures) {
      figures = engine.composeSnapshot(composeInput(periodMonth));
      composed.set(periodMonth, figures);
    }
    return figures;
  };
  const composeLive = once((): SnapshotFigures | null => {
    const last = lastRun();
    return last !== null && asOf <= last ? null : compose(liveMonth());
  });
  const dashboardFigures = once((): SnapshotFigures => {
    const live = composeLive();
    if (live) return live;
    // No provisional period: the latest snapshot (there is one, since asOf ≤ its run date).
    return figuresOf(snapshots().at(-1)!);
  });

  const considerNext = once((): ConsiderNextResult => {
    const values = classValues();
    const classes = Object.fromEntries(
      ASSET_CLASSES.map((c) => [
        c,
        { valueCents: values[c], targetRatio: stringSetting(s, CLASS_TARGET_KEYS[c]) },
      ]),
    ) as Record<AssetClass, { valueCents: Cents; targetRatio: DecimalString | null }>;
    return engine.considerNext({
      classes,
      // The emergency-fund test cash (stage-2.md §2.4), as the investment pages' timing chain.
      cashCents: cashTotals().emergencyFundTestCents,
      emergencyFundCents: budgetInvest().emergencyFundCents,
    });
  });

  const netWorth = once(() =>
    engine.netWorthDashboard({
      asOf,
      live: dashboardFigures(),
      liveMonth: liveMonth(),
      snapshots: snapshots(),
      property: property(),
      cashAccounts: data.cashAccounts.map(toEngineCashAccount),
      kpis: kpis(),
      plannedSavingsRatio: budget().plannedSavingsRatio,
      considerNext: considerNext(),
    }),
  );

  const rolling = once(() => {
    const live = composeLive();
    return engine.rollingNetWorth({
      snapshots: snapshots(),
      live: live === null ? null : { periodMonth: liveMonth(), runDate: asOf, figures: live },
      savings: savings().periods,
      projection: { monthlyCents: kpis().avgSavingsCents, months: NET_WORTH_PROJECTION_MONTHS },
    });
  });

  const check = once(() => engine.checkSnapshots({ snapshots: snapshots(), trades: trades() }));

  // ─── Stage 6 (stage-6.md §4.5) ───
  const fireDerived = once((): FireDerived =>
    engine.deriveFireInputs({
      asOf,
      figures: dashboardFigures(),
      classes: netWorth().classes,
      liabilities: netWorth().liabilities,
      property: property(),
      savings: savings().periods,
      kpis: kpis(),
      superResult: superResult(),
    }),
  );

  return {
    engine,
    now,
    asOf,
    data,
    market: deps.market.status(),
    priceItems,
    instrumentById,
    rows,
    compute,
    cashTotals,
    classValues,
    lastPurchaseDate,
    sideIncome,
    savings,
    kpis,
    budgetInput,
    budget,
    budgetInvestInput,
    budgetInvest,
    dividends,
    series,
    otherAssetsInput,
    otherAssets,
    superInput,
    superResult,
    propertyInput,
    property,
    assetsSnapshot,
    spotHistory,
    salaryMonthly,
    snapshots,
    lastRun,
    liveMonth,
    recordable,
    composeInput,
    compose,
    composeLive,
    dashboardFigures,
    considerNext,
    netWorth,
    rolling,
    check,
    fireDerived,
  };
}
