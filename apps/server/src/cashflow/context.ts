// One request's view of the finance data (stage-2.md §4.5 steps 1–3, stage-3.md §4.5 "One request
// context"): the prices (first, from the price service), every row the investment and cash-flow
// pages and the timing chain need (one read transaction), the as-of date and the engine results,
// each computed at most once per request. The server adds only display fields; every figure comes
// from the engine.
import { engine as defaultEngine } from '@joinr/engine';
import type {
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
  InvestmentsResult,
  SavingsResult,
  SideIncomeResult,
} from '@joinr/engine';
import {
  ASSET_CLASSES,
  INSTRUMENT_KINDS,
  type AssetClass,
  type InstrumentKind,
  type IsoDate,
  type PriceItem,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDatabase } from '../db/database';
import {
  aggressivenessSetting,
  booleanSetting,
  numberSetting,
  payFrequencySetting,
  stringSetting,
} from '../db/queries/settings';
import { localIsoDate, ratioOf } from '../investments/format';
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
import type { MarketDataService, MarketDataStatus } from '../market/types';
import { LOANS_COUNT_FOR_EMERGENCY_FUND } from './constants';
import {
  budgetRowsInput,
  closedSideIncomePeriods,
  includeMortgagePrincipalOf,
  includeSideIncomeOf,
  lastSnapshotCashShare,
  lastStockOrEtfBuy,
  liveSavingsInput,
  offsetsIncludeEmergencyFundOf,
  otherAssetPurchases,
  otherAssetsValueCents,
  sideIncomeInput,
  toEngineCashAccount,
  toSavingsSnapshot,
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

  const classValues = once((): Record<AssetClass, Cents> => {
    const kindValue = (k: InstrumentKind) => compute(k).summary.valueCents;
    return {
      etf: kindValue('etf'),
      stock: kindValue('stock'),
      crypto: kindValue('crypto'),
      // Net worth keeps loans you've made (D59): the cash class is Total Cash.
      cash: cashTotals().totalCashCents,
      managed_fund: kindValue('managed_fund'),
      other_assets: otherAssetsValueCents(data.otherAssets),
    };
  });

  const lastPurchaseDate = once(() => lastStockOrEtfBuy(data));

  const sideIncome = once(() => engine.computeSideIncome(sideIncomeInput(data, asOf)));

  const savings = once(() =>
    engine.computeSavings({
      asOf,
      snapshots: data.snapshots.map(toSavingsSnapshot),
      live: liveSavingsInput(data, {
        asOf,
        // The savings engine keeps loans in (D59).
        totalCashCents: cashTotals().totalCashCents,
        salaryMonthlyCents: engine.monthlyPayCents({
          netPayCents: numberSetting(s, 'pay.netPayCents'),
          payFrequency: payFrequencySetting(s),
        }),
      }),
      trades: data.trades.map(toEngineTrade),
      otherAssetPurchases: otherAssetPurchases(data.otherAssets),
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
  };
}
