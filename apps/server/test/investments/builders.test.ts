// The page, ledger, detail, chart and timing builders against the generic seed with a FAKE engine
// (a hand-built InvestmentsResult): the DTO mapping is checked field by field, and the engine
// inputs the server assembles (trades, prices, budget, consider-next) are checked as sent.
import {
  engine as realEngine,
  type BudgetInvestInput,
  type InvestmentsInput,
  type InvestmentsResult,
  type SeriesPoint,
} from '@joinr/engine';
import {
  JoinrDecimal,
  normaliseDecimal,
  type HoldingRowDto,
  type InstrumentKind,
  type PriceItem,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCharts, liveGainRatio } from '../../src/investments/charts';
import { createInvestmentsContext, type InvestmentsDeps } from '../../src/investments/context';
import { buildHoldingDetail } from '../../src/investments/detail';
import { tradeFlags } from '../../src/investments/mappers';
import { buildInvestmentPage } from '../../src/investments/page';
import { buildTradesResponse } from '../../src/investments/trades';
import {
  AS_OF,
  emptyResult,
  fakeEngine,
  fakeMarket,
  holdingResult,
  NOW,
  priceItem,
  summaryResult,
  type FakeEngine,
} from './helpers';

let t: TestDb;
let ids: Record<string, number>;

beforeEach(() => {
  t = createTestDb();
  ids = seedGenericData(t.db, { now: NOW }).instrumentIds;
});
afterEach(() => t.close());

const id = (symbol: string): number => {
  const v = ids[symbol];
  if (v === undefined) throw new Error(`no ${symbol}`);
  return v;
};

/** The ETF result the fake engine returns: ASX:DEF held, ASX:XYZ watching (listed first). */
function etfResult(): InvestmentsResult {
  const xyz = id('ASX:XYZ');
  const def = id('ASX:DEF');
  return {
    ...emptyResult('etf', AS_OF),
    holdings: [
      holdingResult({
        instrumentId: xyz,
        status: 'watching',
        currentRatio: '0',
        targetRatio: '0.6',
        differenceRatio: '-0.6',
        dividendsCents: 12000,
        realisedCents: 700,
      }),
      holdingResult({
        instrumentId: def,
        status: 'held',
        flags: ['stale_price'],
        netUnits: '10',
        openUnits: '10',
        price: '55',
        priceStatus: 'stale',
        valueCents: 55000,
        costCents: 51000,
        unrealisedCents: 4000,
        dividendsCents: 0,
        totalReturnCents: 4000,
        totalReturnRatio: '0.078431372549',
        realisedCents: 0,
        xirr: '0.0712',
        averagePrice: '50',
        currentRatio: '1',
        targetRatio: '0.4',
        differenceRatio: '0.6',
        dividendYieldRatio: '0.031',
        estMgmtFeeCents: 110,
        lastBuyDate: '2025-05-20',
        lastTradeDate: '2025-05-20',
      }),
    ],
    lots: [
      {
        tradeId: 6,
        instrumentId: def,
        tradeDate: '2025-05-20',
        seq: 6,
        units: '10',
        remainingUnits: '10',
        price: '50',
        feeCents: 1000,
        remainingCostCents: 51000,
        unrealisedCents: 4000,
        unrealisedRatio: '0.08',
        heldDays: 492,
        termIfSoldToday: 'long',
      },
      {
        tradeId: 5,
        instrumentId: xyz,
        tradeDate: '2024-07-01',
        seq: 5,
        units: '30',
        remainingUnits: '0',
        price: '100',
        feeCents: 1000,
        remainingCostCents: 0,
        unrealisedCents: null,
        unrealisedRatio: null,
        heldDays: 815,
        termIfSoldToday: 'long',
      },
    ],
    trades: [
      {
        tradeId: 5,
        side: 'buy',
        orderValueCents: 300000,
        feeCents: 1000,
        remainingUnits: '0',
        unrealisedCents: null,
        realisedCents: null,
        realisedShortCents: null,
        realisedLongCents: null,
        oversoldUnits: null,
      },
      {
        tradeId: 6,
        side: 'buy',
        orderValueCents: 50000,
        feeCents: 1000,
        remainingUnits: '10',
        unrealisedCents: 4000,
        realisedCents: null,
        realisedShortCents: null,
        realisedLongCents: null,
        oversoldUnits: '2',
      },
    ],
    dividends: [
      { dividendId: 1, instrumentId: xyz, unitsAtEx: '30', yieldRatio: '0.04' },
      { dividendId: 2, instrumentId: null, unitsAtEx: null, yieldRatio: null },
    ],
    summary: summaryResult({
      valueCents: 55000,
      costCents: 51000,
      unrealisedCents: 4000,
      totalReturnCents: 4000,
      totalReturnRatio: '0.078431372549',
      heldCount: 1,
      watchingCount: 1,
      stalePriceCount: 1,
      targetSumRatio: '1',
      targetCount: 2,
      estMgmtFeeCents: 110,
      lastBuyDate: '2025-05-20',
    }),
    allocation: {
      byHolding: [
        { key: String(def), label: 'ASX:DEF', currentRatio: '1', targetRatio: '0.4' },
        { key: String(xyz), label: 'ASX:XYZ', currentRatio: '0', targetRatio: '0.6' },
      ],
      bySector: [{ key: 'Retirement', label: 'Retirement', currentRatio: '1', targetRatio: '0.4' }],
      byRegion: [{ key: 'us', label: 'US', currentRatio: '0.5', targetRatio: '0.5' }],
    },
    realisedByFy: [
      { financialYear: 2026, shortTermCents: 0, longTermCents: 0, totalCents: 0, disposals: 0 },
    ],
  };
}

function engineFor(results: Partial<Record<InstrumentKind, InvestmentsResult>>): FakeEngine {
  return fakeEngine({
    computeInvestments: (input) => results[input.kind] ?? emptyResult(input.kind, input.asOf),
    contributionsAt: ({ dates }) => dates.map((_, i) => (i + 1) * 100),
    netPurchases: ({ windows }) => windows.map((_, i) => i * 10),
  });
}

function items(): PriceItem[] {
  return [
    priceItem({
      instrumentId: id('ASX:DEF'),
      symbol: 'ASX:DEF',
      held: true,
      heldUnits: '10',
      status: 'stale',
      price: '55',
      priceSource: 'yahoo',
      asOf: '2026-09-20T06:00:00.000Z',
      lastError: 'Symbol not found',
    }),
  ];
}

function deps(engine: FakeEngine, market = fakeMarket(items())): InvestmentsDeps {
  return { database: t, market, engine, now: () => NOW };
}

describe('buildInvestmentPage (fake engine)', () => {
  it('maps the engine result to the page DTO field by field', () => {
    const engine = engineFor({ etf: etfResult() });
    const market = fakeMarket(items(), {
      mode: 'live',
      running: true,
      lastRefreshAt: '2026-09-24T01:00:00.000Z',
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine, market)), 'etf');

    expect(page.kind).toBe('etf');
    expect(page.asOf).toBe(AS_OF);
    expect(page.generatedAt).toBe(NOW.toISOString());
    expect(page.prices).toEqual({
      mode: 'live',
      lastRefreshAt: '2026-09-24T01:00:00.000Z',
      running: true,
    });
    expect(page.summary).toEqual(etfResult().summary);
    expect(page.settings).toEqual({
      defaultBrokerageCents: null,
      cryptoFeeRate: '0.005',
      etfLimit: null,
    });

    // Held before watching, whatever the engine's order.
    expect(page.holdings.map((h) => h.symbol)).toEqual(['ASX:DEF', 'ASX:XYZ']);
    const def: HoldingRowDto = {
      instrumentId: id('ASX:DEF'),
      kind: 'etf',
      symbol: 'ASX:DEF',
      name: 'DEF Example ETF',
      note: null,
      watched: true,
      status: 'held',
      flags: ['stale_price'],
      units: '10',
      price: {
        price: '55',
        status: 'stale',
        source: 'yahoo',
        asOf: '2026-09-20T06:00:00.000Z',
        lastError: 'Symbol not found',
      },
      valueCents: 55000,
      costCents: 51000,
      unrealisedCents: 4000,
      dividendsCents: 0,
      totalReturnCents: 4000,
      totalReturnRatio: '0.078431372549',
      realisedCents: 0,
      xirr: '0.0712',
      averagePrice: '50',
      currentRatio: '1',
      targetRatio: '0.4',
      differenceRatio: '0.6',
      dividendYieldRatio: '0.031',
      sector: 'Retirement',
      regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' },
      mgmtFeeRatio: '0.002',
      estMgmtFeeCents: 110,
      lastBuyDate: '2025-05-20',
      lastTradeDate: '2025-05-20',
      // The holding's own $0 default fee (seeded) wins over the global brokerage.
      effectiveDefaultFee: { kind: 'flat', cents: 0 },
    };
    expect(page.holdings[0]).toEqual(def);
    expect(page.holdings[1]).toMatchObject({
      symbol: 'ASX:XYZ',
      status: 'watching',
      units: '0',
      dividendsCents: 12000,
      realisedCents: 700,
      // The price service does not list it here: no price.
      price: { price: null, status: 'none', source: null, asOf: null, lastError: null },
      effectiveDefaultFee: { kind: 'flat', cents: 0 },
    });

    expect(page.allocation).toEqual(etfResult().allocation);
    expect(page.realisedByFy).toEqual(etfResult().realisedByFy);
  });

  it('passes every instrument, trade and dividend of the kind to the engine, with prices', () => {
    const engine = engineFor({});
    buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');
    const inputs = engine.calls.computeInvestments.map((c) => c[0] as InvestmentsInput);
    // All four kinds feed the class values; each is computed once per request.
    expect(inputs.map((i) => i.kind).sort()).toEqual(['crypto', 'etf', 'managed_fund', 'stock']);
    const etf = inputs.find((i) => i.kind === 'etf')!;
    expect(etf.asOf).toBe(AS_OF);
    expect(etf.instruments.map((i) => i.symbol)).toEqual(['ASX:XYZ', 'ASX:DEF']);
    expect(etf.instruments[0]).toEqual({
      id: id('ASX:XYZ'),
      kind: 'etf',
      symbol: 'ASX:XYZ',
      name: 'XYZ Example ETF',
      watched: true,
      sortOrder: 1,
      targetRatio: '0.6',
      sector: 'Global shares',
      regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' },
      mgmtFeeRatio: '0.002',
      dividendFreqMonths: 6,
    });
    expect(etf.trades.map((t) => t.id).sort()).toEqual([5, 6]);
    expect(etf.trades.find((t) => t.id === 5)).toEqual({
      id: 5,
      instrumentId: id('ASX:XYZ'),
      tradeDate: '2024-07-01',
      units: '30',
      price: '100',
      feeCents: 1000,
      feeRate: null,
      seq: 5,
    });
    // Linked and unlinked dividends of the holding kind.
    expect(etf.dividends.map((d) => d.instrumentId)).toEqual([id('ASX:XYZ'), null]);
    expect([...etf.prices.entries()]).toEqual([[id('ASX:DEF'), { price: '55', status: 'stale' }]]);
    const crypto = inputs.find((i) => i.kind === 'crypto')!;
    expect(crypto.trades.find((t) => t.instrumentId === id('BTC'))).toMatchObject({
      feeCents: 2250,
      feeRate: '0.005',
    });
  });

  it('gives crypto no sector allocation', () => {
    const engine = engineFor({
      crypto: {
        ...emptyResult('crypto', AS_OF),
        allocation: { byHolding: [], bySector: [], byRegion: null },
      },
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'crypto');
    expect(page.allocation).toEqual({ byHolding: [], bySector: null, byRegion: null });
    const stock = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'stock');
    expect(stock.allocation.bySector).toEqual([]);
  });
});

describe('buildTiming (fake engine)', () => {
  it('builds the budget, optimiser, countdown and consider-next inputs from the live rows', () => {
    const engine = engineFor({
      etf: etfResult(),
      stock: { ...emptyResult('stock', AS_OF), summary: summaryResult({ valueCents: 20000 }) },
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');

    const input = engine.calls.budgetInvestment[0]![0] as BudgetInvestInput;
    // stage-3.md §4.5 (D59): the cash class is Total Cash (non-offset accounts, the loan you've
    // made included); the emergency-fund test cash leaves the loan out (offsets stay out, D56 off).
    const cash = 500000 + 2000000 + 300000;
    const emergencyFundCash = 500000 + 2000000;
    const other = 180000 + 46150; // 1 × 1800 + 10 × 46.15, AUD rows
    // Latest snapshot (2026-07, step 2): cash / (stocks + etf + crypto + cash + mf + other).
    const snapTotal = 170000 + 340000 + 800000 + 2600000 + 150000 + 200000;
    const ratio = (a: number, b: number) =>
      normaliseDecimal(new JoinrDecimal(a).div(b).toSignificantDigits(12));
    expect(input).toEqual({
      asOf: AS_OF,
      payFrequency: 'fortnightly',
      netPayCents: 300000,
      includeSideIncome: false,
      // The closed side-income periods from computeSideIncome (the fake engine has none).
      sideIncomePeriods: [],
      // budgetInvestInputOf maps every budget row (the automatic rows too) in sort order.
      items: [
        { kind: 'item', monthlyCents: 200000 },
        { kind: 'item', monthlyCents: 60000 },
        { kind: 'item', monthlyCents: 5000 },
        { kind: 'auto_yearly', monthlyCents: null },
        { kind: 'auto_invest', monthlyCents: null },
        { kind: 'auto_cash', monthlyCents: null },
      ],
      yearlyExpenseAnnualCents: [80000, 120000],
      autoInvestSplit: null,
      useBudgetForInvest: null,
      cashTargetRatio: null,
      aggressiveness: null,
      lastSnapshotCashShare: ratio(2600000, snapTotal),
      currentCashShare: ratio(cash, 55000 + 20000 + cash + other),
      cashCents: emergencyFundCash,
      emergencyFundMonths: null,
      emergencyFundOverrideCents: null,
      marginalTaxRate: null,
      // The latest stock or ETF BUY (the ASX:OLD sell is later but not a buy).
      lastPurchaseDate: '2025-06-16',
    });

    expect(engine.calls.parcelOptimiser[0]![0]).toEqual({
      monthlyInvestCents: null,
      brokerageCents: null,
      growthRatio: null,
      cashRateRatio: null,
    });
    expect(engine.calls.investCountdown[0]![0]).toEqual({
      asOf: AS_OF,
      monthlyInvestCents: null,
      plan: null,
      lastPurchaseDate: '2025-06-16',
      payDayOfMonth: 15,
      growthRatio: null,
      // D46: the budget switches, as sent to budgetInvestment.
      useBudgetForInvest: null,
      autoInvestSplit: null,
      // SheetOptions H12 (the fake engine answers null).
      cashDeficitMonths: null,
    });
    expect(engine.calls.cashDeficitMonths[0]![0]).toEqual({
      cashCents: cash,
      liquidTotalCents: 55000 + 20000 + cash + other,
      targetRatio: null,
      avgMonthlySavingsCents: null,
    });
    expect(engine.calls.considerNext[0]![0]).toEqual({
      classes: {
        etf: { valueCents: 55000, targetRatio: '0.6' },
        stock: { valueCents: 20000, targetRatio: null },
        crypto: { valueCents: 0, targetRatio: null },
        cash: { valueCents: cash, targetRatio: null },
        managed_fund: { valueCents: 0, targetRatio: null },
        other_assets: { valueCents: other, targetRatio: null },
      },
      cashCents: emergencyFundCash,
      emergencyFundCents: null,
    });
    expect(engine.calls.nextBuyHint[0]![0]).toMatchObject({ kind: 'etf', parcelCents: null });

    expect(page.timing).toEqual({
      monthlyInvestCents: null,
      budget: {
        monthlyIncomeCents: null,
        plannedSpendCents: 0,
        leftoverCents: null,
        emergencyFundCents: null,
        investShareRatio: null,
        investmentRowCents: null,
        sideIncomeInvestCents: 0,
        useBudget: null,
        source: 'live_budget',
      },
      plan: null,
      lastPurchaseDate: '2025-06-16',
      countdown: { state: 'unavailable' },
      considerNext: expect.objectContaining({ assetClass: null, reason: 'no_targets' }) as unknown,
      hint: { assetClass: null, instrumentId: null, symbol: null, parcelCents: null },
      // Null class targets are reported; allocation.etf is seeded.
      missing: [
        'allocation.stock',
        'allocation.crypto',
        'allocation.cash',
        'allocation.managedFund',
        'allocation.otherAssets',
      ],
      deferred: [],
      cashDeficitMonths: null,
    });
  });

  it('maps a waiting countdown, the plan, the hint symbol, merged missing keys and the cash-deficit wait', () => {
    const def = id('ASX:DEF');
    const engine = fakeEngine({
      computeInvestments: (input) => emptyResult(input.kind, input.asOf),
      budgetInvestment: () => ({
        monthlyIncomeCents: 650000,
        yearlyFundCents: 17000,
        plannedSpendCents: 282000,
        leftoverCents: 368000,
        emergencyFundCents: null,
        cashShareRatio: '0.5',
        investShareRatio: '0.5',
        investmentRowCents: 184000,
        cashRowCents: 184000,
        sideIncomeInvestCents: 0,
        monthlyInvestCents: 184000,
        missing: ['budget.emergencyFundMonths', 'tax.marginalRate'],
      }),
      parcelOptimiser: () => ({ months: 2, parcelCents: 368000, optimalParcelCents: 350000 }),
      investCountdown: () => ({
        state: 'wait',
        days: 12,
        nextPurchaseDate: '2026-10-06',
        periodDays: 60,
      }),
      considerNext: () => ({
        assetClass: 'etf',
        reason: 'most_underweight',
        rows: [
          {
            assetClass: 'cash',
            valueCents: 100,
            currentRatio: '0.1',
            targetRatio: '0.2',
            deltaRatio: '-0.1',
          },
        ],
      }),
      nextBuyHint: () => ({ assetClass: 'etf', instrumentId: def, parcelCents: 368000 }),
      cashKpis: (input) => ({ ...fakeEngine().cashKpis(input), avgSavingsCents: 250000 }),
      cashDeficitMonths: () => 5,
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');
    expect(page.timing.monthlyInvestCents).toBe(184000);
    expect(page.timing.plan).toEqual({
      months: 2,
      parcelCents: 368000,
      optimalParcelCents: 350000,
    });
    expect(page.timing.countdown).toEqual({
      state: 'wait',
      days: 12,
      nextPurchaseDate: '2026-10-06',
      periodDays: 60,
    });
    expect(page.timing.hint).toEqual({
      assetClass: 'etf',
      instrumentId: def,
      symbol: 'ASX:DEF',
      parcelCents: 368000,
    });
    expect(page.timing.budget.investmentRowCents).toBe(184000);
    // The engine's keys first, then the server's (null targets, plan inputs), deduplicated.
    expect(page.timing.missing).toEqual([
      'budget.emergencyFundMonths',
      'tax.marginalRate',
      'allocation.stock',
      'allocation.crypto',
      'allocation.cash',
      'allocation.managedFund',
      'allocation.otherAssets',
      'investing.defaultBrokerageCents',
      'returns.marketReturn',
      'returns.cashInterestRate',
    ]);
    // Stage 3 (§2.12): the cash-deficit wait is live, so nothing is deferred; the average savings
    // feed it and the countdown takes max(plan months, the wait).
    expect(page.timing.deferred).toEqual([]);
    expect(page.timing.cashDeficitMonths).toBe(5);
    expect(engine.calls.cashDeficitMonths[0]![0]).toMatchObject({ avgMonthlySavingsCents: 250000 });
    expect(engine.calls.investCountdown[0]![0]).toMatchObject({ cashDeficitMonths: 5 });
    expect(engine.calls.nextBuyHint[0]![0]).toMatchObject({ parcelCents: 368000 });
  });
});

describe('buildTiming: the automatic split off (D46)', () => {
  function putSetting(key: string, value: unknown): void {
    const row = {
      key,
      valueJson: JSON.stringify(value),
      updatedAt: NOW.toISOString(),
      origin: 'import' as const,
    };
    t.db
      .insert(settings)
      .values(row)
      .onConflictDoUpdate({ target: settings.key, set: { valueJson: row.valueJson } })
      .run();
  }

  it('passes the budget switches to the countdown and maps split_off', () => {
    putSetting('budget.useForInvestAmount', true);
    putSetting('budget.autoInvestSplit', false);
    const engine = fakeEngine({
      computeInvestments: (input) => emptyResult(input.kind, input.asOf),
      investCountdown: () => ({ state: 'split_off' }),
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');
    expect(engine.calls.investCountdown[0]![0]).toMatchObject({
      useBudgetForInvest: true,
      autoInvestSplit: false,
    });
    expect(page.timing.countdown).toEqual({ state: 'split_off' });
  });

  it('with the real budget and countdown: a $0 investment row reads split_off, not cash first', () => {
    putSetting('budget.useForInvestAmount', true);
    putSetting('budget.autoInvestSplit', false);
    putSetting('allocation.cash', '0.2');
    const engine = fakeEngine({
      computeInvestments: (input) => emptyResult(input.kind, input.asOf),
      budgetInvestment: realEngine.budgetInvestment,
      investCountdown: realEngine.investCountdown,
    });
    const page = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');
    // The seeded pay and budget items leave a positive leftover, all of it in the cash row.
    expect(page.timing.budget.leftoverCents).toBeGreaterThan(0);
    expect(page.timing.budget.investmentRowCents).toBe(0);
    expect(page.timing.monthlyInvestCents).toBe(0);
    expect(page.timing.countdown).toEqual({ state: 'split_off' });

    // The split on again: the same budget has an amount to invest, so no split_off.
    putSetting('budget.autoInvestSplit', true);
    const on = buildInvestmentPage(createInvestmentsContext(deps(engine)), 'etf');
    expect(on.timing.monthlyInvestCents).toBeGreaterThan(0);
    expect(on.timing.countdown.state).not.toBe('split_off');
  });
});

describe('buildCharts (fake engine)', () => {
  it('uses snapshot values, engine contributions and purchases, and appends a live point', () => {
    const engine = engineFor({ etf: etfResult() });
    const ctx = createInvestmentsContext(deps(engine));
    const charts = buildCharts(ctx, 'etf');
    expect(charts.unit).toBe('monthly');
    expect(charts.count).toBeNull();

    const runDates = ['2026-05-31', '2026-06-30', '2026-07-31'];
    expect(engine.calls.contributionsAt[0]![0]).toMatchObject({
      kind: 'etf',
      dates: [...runDates, AS_OF],
    });
    expect(engine.calls.purchaseWindows[0]).toEqual([runDates, AS_OF]);
    const points = engine.calls.compressSeries[0]![0] as SeriesPoint[];
    expect(points.map((p) => p.live)).toEqual([false, false, false, true]);
    expect(engine.calls.compressSeries[0]!.slice(1)).toEqual([
      'monthly',
      null,
      { value: 'end', contributions: 'end', gain: 'end', purchases: 'sum', idx: 'end' },
    ]);

    expect(charts.points).toEqual([
      ...[0, 1, 2].map((step) => ({
        label: runDates[step]!.slice(0, 7),
        period: runDates[step]!.slice(0, 7),
        date: runDates[step],
        live: false,
        valueCents: 300000 + step * 20000,
        contributionsCents: (step + 1) * 100,
        gainCents: 20000 + step * 2000,
        gainRatio: '0.071',
        netPurchasesCents: step * 10,
      })),
      {
        label: '2026-09',
        period: '2026-09',
        date: AS_OF,
        live: true,
        valueCents: 55000,
        contributionsCents: 400,
        gainCents: 4000,
        gainRatio: liveGainRatio(55000, 4000),
        netPurchasesCents: 30,
      },
    ]);
    expect(liveGainRatio(55000, 4000)).toBe(
      normaliseDecimal(new JoinrDecimal(4000).div(51000).toSignificantDigits(12)),
    );
    expect(liveGainRatio(0, 0)).toBeNull();
  });

  it('has no points when there is no history and nothing was traded', () => {
    t.sqlite.exec('DELETE FROM snapshots; DELETE FROM dividends; DELETE FROM trades;');
    const charts = buildCharts(createInvestmentsContext(deps(engineFor({}))), 'etf');
    expect(charts.points).toEqual([]);
  });

  it('adds no live point when a snapshot exists for the as-of month', () => {
    t.sqlite.exec(
      "UPDATE snapshots SET period_month = '2026-09', run_date = '2026-09-20' WHERE period_month = '2026-07'",
    );
    const engine = engineFor({});
    const charts = buildCharts(createInvestmentsContext(deps(engine)), 'etf');
    expect(charts.points.map((p) => p.live)).toEqual([false, false, false]);
    expect(engine.calls.purchaseWindows[0]).toEqual([
      ['2026-05-31', '2026-06-30', '2026-09-20'],
      null,
    ]);
  });
});

describe('buildTradesResponse and buildHoldingDetail (fake engine)', () => {
  it('lists the kind ledger newest first with engine results and live oversell flags', () => {
    const engine = engineFor({ etf: etfResult() });
    const res = buildTradesResponse(createInvestmentsContext(deps(engine)), 'etf');
    expect(res.kind).toBe('etf');
    expect(res.asOf).toBe(AS_OF);
    expect(res.trades.map((r) => r.id)).toEqual([6, 5]);
    expect(res.trades[0]).toEqual({
      id: 6,
      instrumentId: id('ASX:DEF'),
      symbol: 'ASX:DEF',
      kind: 'etf',
      tradeDate: '2025-05-20',
      side: 'buy',
      units: '10',
      price: '50',
      orderValueCents: 50000,
      fee: { kind: 'flat', cents: 1000 },
      feeCents: 1000,
      seq: 6,
      origin: 'import',
      sheetRef: 'ETFs!A28',
      note: null,
      // Stored flag ∪ the live oversell (the fake engine reports one here).
      flags: ['out_of_order', 'oversell'],
      correctionId: null,
      remainingUnits: '10',
      unrealisedCents: 4000,
      realisedCents: null,
      realisedShortCents: null,
      realisedLongCents: null,
      oversoldUnits: '2',
    });
  });

  it('shows a stored rate fee as a rate and a row the engine skipped with neutral results', () => {
    const engine = engineFor({ crypto: emptyResult('crypto', AS_OF) });
    const res = buildTradesResponse(createInvestmentsContext(deps(engine)), 'crypto');
    const btc = res.trades.find((r) => r.symbol === 'BTC')!;
    expect(btc).toMatchObject({
      side: 'buy',
      units: '0.05',
      fee: { kind: 'rate', rate: '0.005' },
      feeCents: 2250,
      orderValueCents: 450000,
      flags: [],
      remainingUnits: null,
    });
  });

  it('builds the holding detail from the kind result', () => {
    const engine = engineFor({ etf: etfResult() });
    const detail = buildHoldingDetail(createInvestmentsContext(deps(engine)), id('ASX:XYZ'))!;
    expect(detail.asOf).toBe(AS_OF);
    expect(detail.instrument).toMatchObject({
      id: id('ASX:XYZ'),
      kind: 'etf',
      symbol: 'ASX:XYZ',
      exchange: 'ASX',
      code: 'XYZ',
      watched: true,
      regions: { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' },
      defaultFee: null,
      effectiveDefaultFee: { kind: 'flat', cents: 0 },
      origin: 'import',
      tradeCount: 1,
      dividendCount: 1,
    });
    expect(detail.holding.status).toBe('watching');
    expect(detail.lots).toEqual([
      {
        tradeId: 5,
        tradeDate: '2024-07-01',
        units: '30',
        remainingUnits: '0',
        price: '100',
        feeCents: 1000,
        remainingCostCents: 0,
        unrealisedCents: null,
        unrealisedRatio: null,
        heldDays: 815,
        termIfSoldToday: 'long',
        status: 'closed',
      },
    ]);
    expect(detail.disposals).toEqual([]);
    expect(detail.trades.map((r) => r.id)).toEqual([5]);
    expect(detail.dividends).toEqual([
      {
        id: 1,
        paymentDate: '2025-07-15',
        exDate: '2025-06-30',
        reinvested: false,
        netAmountCents: 12000,
        priceAtEx: '100',
        unitsAtEx: '30',
        yieldRatio: '0.04',
        origin: 'import',
        sheetRef: 'Dividends!A4',
      },
    ]);
  });

  it('answers null for an unknown instrument', () => {
    expect(buildHoldingDetail(createInvestmentsContext(deps(engineFor({}))), 999)).toBeNull();
  });
});

describe('tradeFlags', () => {
  it('keeps the stored review flags but takes oversell from the live engine only', () => {
    // A stored oversell the live FIFO no longer finds (e.g. a same-day sell entered before its buy).
    expect(tradeFlags('["oversell","out_of_order"]', false)).toEqual(['out_of_order']);
    expect(tradeFlags('["oversell"]', false)).toEqual([]);
    expect(tradeFlags('["oversell"]', true)).toEqual(['oversell']);
    expect(tradeFlags(null, true)).toEqual(['oversell']);
    expect(tradeFlags('["out_of_order"]', true)).toEqual(['out_of_order', 'oversell']);
    expect(tradeFlags('not json', false)).toEqual([]);
  });
});
