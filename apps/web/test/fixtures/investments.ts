// Supplementary investment fixtures for the web tests (stage-2.md §7.5 step 3): states the
// @joinr/schema fixtures do not cover, typed against the frozen DTOs. Generic values only.
import type {
  HoldingRowDto,
  InvestmentPageResponse,
  InvestmentTradesResponse,
  TradeRowDto,
} from '@joinr/schema';
import {
  INVESTMENT_FIXTURE_AS_OF,
  investmentPageNulls,
  investmentPages,
} from '@joinr/schema/fixtures';

const trade = (
  row: Omit<TradeRowDto, 'kind' | 'correctionId' | 'sheetRef' | 'origin'> & Partial<TradeRowDto>,
) =>
  ({
    kind: 'managed_fund',
    correctionId: null,
    sheetRef: null,
    origin: 'import',
    ...row,
  }) satisfies TradeRowDto;

const NO_RESULT = {
  realisedCents: null,
  realisedShortCents: null,
  realisedLongCents: null,
  oversoldUnits: null,
} as const;

/**
 * The ledger behind `investmentPageNulls` (managed funds): EXAMPLEFUND first bought on the as-of
 * date (under 90 days: its XIRR and the portfolio tile show "—"), EXAMPLEFUND3 held since 2024,
 * EXAMPLEFUND2 bought and fully sold.
 */
export const fundNullsTrades = {
  kind: 'managed_fund',
  asOf: INVESTMENT_FIXTURE_AS_OF,
  trades: [
    trade({
      id: 305,
      instrumentId: 5,
      symbol: 'EXAMPLEFUND',
      tradeDate: INVESTMENT_FIXTURE_AS_OF,
      side: 'buy',
      units: '1000',
      price: '1.5',
      orderValueCents: 150000,
      fee: { kind: 'flat', cents: 0 },
      feeCents: 0,
      seq: 4,
      origin: 'app',
      note: null,
      flags: [],
      remainingUnits: '1000',
      unrealisedCents: 0,
      ...NO_RESULT,
    }),
    trade({
      id: 304,
      instrumentId: 6,
      symbol: 'EXAMPLEFUND2',
      tradeDate: '2025-06-30',
      side: 'sell',
      units: '1000',
      price: '1.2',
      orderValueCents: 120000,
      fee: { kind: 'flat', cents: 0 },
      feeCents: 0,
      seq: 3,
      note: null,
      flags: [],
      remainingUnits: null,
      unrealisedCents: null,
      realisedCents: 20000,
      realisedShortCents: 0,
      realisedLongCents: 20000,
      oversoldUnits: null,
    }),
    trade({
      id: 302,
      instrumentId: 10,
      symbol: 'EXAMPLEFUND3',
      tradeDate: '2024-01-10',
      side: 'buy',
      units: '200',
      price: '2',
      orderValueCents: 40000,
      fee: { kind: 'flat', cents: 0 },
      feeCents: 0,
      seq: 2,
      note: null,
      flags: [],
      remainingUnits: '200',
      unrealisedCents: 4000,
      ...NO_RESULT,
    }),
    trade({
      id: 301,
      instrumentId: 6,
      symbol: 'EXAMPLEFUND2',
      tradeDate: '2023-05-01',
      side: 'buy',
      units: '1000',
      price: '1',
      orderValueCents: 100000,
      fee: { kind: 'flat', cents: 0 },
      feeCents: 0,
      seq: 1,
      note: null,
      flags: [],
      remainingUnits: '0',
      unrealisedCents: null,
      ...NO_RESULT,
    }),
  ],
} satisfies InvestmentTradesResponse;

/** The ETFs page with an ETF limit of 1: both counts are over it ("Over limit"). */
export const etfPageOverLimit = {
  ...investmentPages.etf,
  settings: { ...investmentPages.etf.settings, etfLimit: 1 },
} satisfies InvestmentPageResponse;

/** The ETFs page whose targets add up to 95 % (the warning under the holdings table). */
export const etfPageTargetsOff = {
  ...investmentPages.etf,
  summary: { ...investmentPages.etf.summary, targetSumRatio: '0.95' },
} satisfies InvestmentPageResponse;

/** The ETFs page while a price refresh runs, in test-price mode. */
export const etfPageRefreshing = {
  ...investmentPages.etf,
  prices: { mode: 'fake', lastRefreshAt: null, running: true },
} satisfies InvestmentPageResponse;

const WATCHING_ONLY_HOLDING = {
  ...investmentPages.stock.holdings[2]!,
} satisfies HoldingRowDto;

/** Stocks with one watched instrument and no trades at all (§6.8 "Watching-only"). */
export const stockPageWatchingOnly = {
  ...investmentPages.stock,
  summary: {
    ...investmentPages.stock.summary,
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
    watchingCount: 1,
    exitedCount: 0,
    targetSumRatio: '0.2',
    targetCount: 1,
    lastBuyDate: null,
  },
  holdings: [WATCHING_ONLY_HOLDING],
  allocation: {
    byHolding: [{ key: '13', label: 'ASX:GHI', currentRatio: '0', targetRatio: '0.2' }],
    bySector: [{ key: 'Health care', label: 'Health care', currentRatio: '0', targetRatio: '0.2' }],
    byRegion: null,
  },
  realisedByFy: [
    { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
  ],
  charts: { unit: 'monthly', count: null, points: [] },
} satisfies InvestmentPageResponse;

export const stockTradesEmpty = {
  kind: 'stock',
  asOf: INVESTMENT_FIXTURE_AS_OF,
  trades: [],
} satisfies InvestmentTradesResponse;

/** The nulls page (managed funds) re-exported for symmetry with its ledger above. */
export const fundNullsPage: InvestmentPageResponse = investmentPageNulls;
