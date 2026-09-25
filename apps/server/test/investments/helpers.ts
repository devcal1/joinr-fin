// Shared helpers for the investments suites: a fake engine (neutral answers plus a units-only
// holdings model, so tests that do not depend on real FIFO run before the engine lands), result
// builders, a fake price service and a service factory that spies on notifyInstrumentsChanged.
// Generic values only.
import {
  assetClassOfKind,
  sheetDate,
  type EngineApi,
  type HoldingResult,
  type InvestmentsInput,
  type InvestmentsResult,
  type SummaryResult,
  type TradeResult,
} from '@joinr/engine';
import {
  ASSET_CLASSES,
  JoinrDecimal,
  multiplyToCents,
  normaliseDecimal,
  tradeFeeCents,
  type DecimalValue,
  type InstrumentKind,
  type PriceItem,
  type PricesResponse,
} from '@joinr/schema';
import { vi } from 'vitest';
import { offServices, type AppServices, type ServiceDeps } from '../../src/app';
import type { MarketDataService, MarketDataStatus } from '../../src/market/types';

/** Local noon, so the server-local as-of date is the same calendar day in every time zone. */
export const NOW = new Date(2026, 8, 24, 12, 0, 0);
export const AS_OF = '2026-09-24';

export function holdingResult(
  p: Partial<HoldingResult> & Pick<HoldingResult, 'instrumentId'>,
): HoldingResult {
  return {
    status: 'watching',
    flags: [],
    netUnits: '0',
    openUnits: '0',
    price: null,
    priceStatus: 'none',
    valueCents: null,
    costCents: 0,
    unrealisedCents: null,
    dividendsCents: 0,
    totalReturnCents: null,
    totalReturnRatio: null,
    realisedCents: 0,
    xirr: null,
    averagePrice: null,
    currentRatio: null,
    targetRatio: null,
    differenceRatio: null,
    dividendYieldRatio: null,
    estMgmtFeeCents: null,
    lastBuyDate: null,
    lastTradeDate: null,
    ...p,
  };
}

export function summaryResult(p: Partial<SummaryResult> = {}): SummaryResult {
  return {
    valueCents: 0,
    costCents: 0,
    unrealisedCents: 0,
    dividendsHeldCents: 0,
    totalReturnCents: 0,
    totalReturnRatio: null,
    realisedCents: 0,
    realisedThisFyCents: 0,
    xirr: null,
    investmentRatePerMonthCents: null,
    dividendsThisFyCents: 0,
    dividendsAllTimeCents: 0,
    heldCount: 0,
    watchingCount: 0,
    exitedCount: 0,
    unpricedCount: 0,
    stalePriceCount: 0,
    targetSumRatio: '0',
    targetCount: 0,
    estMgmtFeeCents: null,
    lastBuyDate: null,
    ...p,
  };
}

export function emptyResult(kind: InstrumentKind, asOf: string): InvestmentsResult {
  return {
    kind,
    asOf,
    holdings: [],
    lots: [],
    disposals: [],
    trades: [],
    dividends: [],
    summary: summaryResult(),
    allocation: { byHolding: [], bySector: [], byRegion: null },
    realisedByFy: [],
  };
}

/**
 * A units-only model (NOT FIFO): trades in date order, buys before sells on a date; a sell beyond
 * the units held is oversold. Holdings carry status, units, the value at the given price and the
 * `oversell` flag; every other figure is neutral. Enough for mutation mechanics and statuses.
 */
export function unitsOnlyCompute(input: InvestmentsInput): InvestmentsResult {
  const sorted = [...input.trades].sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
    const sa = new JoinrDecimal(a.units).isNegative() ? 1 : 0;
    const sb = new JoinrDecimal(b.units).isNegative() ? 1 : 0;
    return sa - sb || a.seq - b.seq || a.id - b.id;
  });
  const held = new Map<number, DecimalValue>();
  const oversoldIds = new Set<number>();
  const trades: TradeResult[] = [];
  for (const t of sorted) {
    const units = new JoinrDecimal(t.units);
    if (units.isZero()) continue;
    const sell = units.isNegative();
    const h = held.get(t.instrumentId) ?? new JoinrDecimal(0);
    let oversold: string | null = null;
    if (sell) {
      const q = units.abs();
      if (q.greaterThan(h)) {
        oversold = normaliseDecimal(q.minus(h));
        oversoldIds.add(t.instrumentId);
        held.set(t.instrumentId, new JoinrDecimal(0));
      } else {
        held.set(t.instrumentId, h.minus(q));
      }
    } else {
      held.set(t.instrumentId, h.plus(units));
    }
    trades.push({
      tradeId: t.id,
      side: sell ? 'sell' : 'buy',
      orderValueCents: multiplyToCents(normaliseDecimal(units.abs()), t.price),
      feeCents: tradeFeeCents(t),
      remainingUnits: null,
      unrealisedCents: null,
      realisedCents: sell ? 0 : null,
      realisedShortCents: sell ? 0 : null,
      realisedLongCents: sell ? 0 : null,
      oversoldUnits: oversold,
    });
  }
  const holdings = [...input.instruments]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((i) => {
      const open = held.get(i.id) ?? new JoinrDecimal(0);
      const price = input.prices.get(i.id)?.price ?? null;
      const isHeld = open.greaterThan(0);
      return holdingResult({
        instrumentId: i.id,
        status: isHeld ? 'held' : i.watched ? 'watching' : 'exited',
        flags: oversoldIds.has(i.id) ? ['oversell'] : [],
        netUnits: normaliseDecimal(open),
        openUnits: normaliseDecimal(open),
        price,
        valueCents: price === null ? null : multiplyToCents(normaliseDecimal(open), price),
        targetRatio: i.targetRatio,
      });
    });
  return { ...emptyResult(input.kind, input.asOf), holdings, trades };
}

export type FakeEngine = EngineApi & { calls: Record<keyof EngineApi, unknown[][]> };

/** Every engine function with neutral answers; `overrides` replace any of them. Calls are recorded. */
export function fakeEngine(overrides: Partial<EngineApi> = {}): FakeEngine {
  const base: EngineApi = {
    computeInvestments: unitsOnlyCompute,
    xirr: () => null,
    realisedByFinancialYear: () => [],
    contributionsAt: ({ dates }) => dates.map(() => 0),
    netPurchases: ({ windows }) => windows.map(() => 0),
    purchaseWindows: (runDates, liveThrough) => [
      ...runDates.map((through, i) => ({ after: i === 0 ? null : runDates[i - 1]!, through })),
      ...(liveThrough === null ? [] : [{ after: runDates.at(-1) ?? null, through: liveThrough }]),
    ],
    compressSeries: (points) =>
      points.map((p) => ({
        label: p.period,
        period: p.period,
        date: p.date,
        live: p.live,
        values: { ...p.values },
      })),
    budgetInvestment: () => ({
      monthlyIncomeCents: null,
      yearlyFundCents: 0,
      plannedSpendCents: 0,
      leftoverCents: null,
      emergencyFundCents: null,
      cashShareRatio: null,
      investShareRatio: null,
      investmentRowCents: null,
      cashRowCents: null,
      sideIncomeInvestCents: 0,
      monthlyInvestCents: null,
      missing: [],
    }),
    parcelOptimiser: () => null,
    investCountdown: () => ({ state: 'unavailable', missing: [] }),
    considerNext: ({ classes }) => ({
      assetClass: null,
      reason: 'no_targets',
      rows: ASSET_CLASSES.map((assetClass) => ({
        assetClass,
        valueCents: classes[assetClass].valueCents,
        currentRatio: '0',
        targetRatio: classes[assetClass].targetRatio,
        deltaRatio: null,
      })),
    }),
    nextBuyHint: ({ considerNext }) => ({
      assetClass: considerNext.assetClass,
      instrumentId: null,
      parcelCents: null,
    }),
    assetClassOfKind,
    sheetDate,
    ...overrides,
  };
  const calls = {} as Record<keyof EngineApi, unknown[][]>;
  const wrapped = {} as Record<keyof EngineApi, unknown>;
  for (const key of Object.keys(base) as (keyof EngineApi)[]) {
    calls[key] = [];
    const fn = base[key] as (...args: unknown[]) => unknown;
    wrapped[key] = (...args: unknown[]) => {
      calls[key].push(args);
      return fn(...args);
    };
  }
  return { ...(wrapped as unknown as EngineApi), calls };
}

export function priceItem(p: Partial<PriceItem> & Pick<PriceItem, 'instrumentId'>): PriceItem {
  return {
    kind: 'etf',
    symbol: 'ASX:ABC',
    name: null,
    watched: true,
    held: false,
    heldUnits: '0',
    provider: 'none',
    providerSymbol: null,
    symbolOrigin: 'derived',
    status: 'none',
    price: null,
    priceSource: null,
    asOf: null,
    fetched: null,
    manual: null,
    lastAttemptAt: null,
    lastError: null,
    consecutiveFailures: 0,
    ...p,
  };
}

/** A price service stub: fixed items and status; the write methods are not used. */
export function fakeMarket(
  items: PriceItem[] = [],
  status: Partial<MarketDataStatus> = {},
): MarketDataService & { notify: ReturnType<typeof vi.fn> } {
  const st: MarketDataStatus = {
    mode: 'off',
    running: false,
    lastRefreshAt: null,
    nextRefreshAt: null,
    ...status,
  };
  const prices = (): PricesResponse => ({
    mode: st.mode,
    refreshIntervalMinutes: 0,
    running: st.running,
    lastRun: null,
    nextRefreshAt: null,
    items,
    series: [],
  });
  const notify = vi.fn();
  const unused = () => {
    throw new Error('not used in these tests');
  };
  return {
    refresh: unused,
    getPrices: prices,
    getSeries: () => [],
    setManualPrice: unused,
    clearManualPrice: unused,
    setPriceSource: unused,
    notifyInstrumentsChanged: notify,
    status: () => st,
    notify,
  };
}

/** `offServices` with a spy on `market.notifyInstrumentsChanged`. */
export function spyServices(): {
  factory: (deps: ServiceDeps) => AppServices;
  notify: ReturnType<typeof vi.fn>;
} {
  const notify = vi.fn();
  return {
    notify,
    factory: (deps) => {
      const services = offServices(deps);
      const market = services.market;
      return {
        ...services,
        market: {
          ...market,
          notifyInstrumentsChanged: () => {
            notify();
            market.notifyInstrumentsChanged();
          },
        },
      };
    },
  };
}
