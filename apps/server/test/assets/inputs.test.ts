// The Stage 4 engine inputs the server builds (stage-4.md §4.5 "Engine inputs built by the server",
// §7.4 step 1), row by row, on the generic seed: manual and bullion pricing (the series, the
// fallback), the live FX rates (USD from AUDUSD, a cross rate, GBX), the D73 assumed date, the
// super funds, contributions and settings (the cap override with its FY, `sgRatio` null while
// unset), the property input (offsets only for linked accounts still flagged Offset) and the
// "latest entry" rule. The request context's Stage 4 members (memoised engine calls, the class
// value, the live savings input, the History seam and the spot history) are checked with a FAKE
// engine that records its calls. Generic values only.
import type { EngineApi, OtherAssetsInput, PropertyInput, SuperInput } from '@joinr/engine';
import type { MarketQuoteItem, MarketQuoteStatus } from '@joinr/schema';
import {
  cashAccounts,
  loanOffsetLinks,
  loans,
  marketQuoteHistory,
  otherAssetPrices,
  otherAssets,
  otherAssetSales,
  settings,
  snapshots,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assumedDateOf,
  buildOtherAssetsInput,
  buildPropertyInput,
  buildSuperInput,
  capOverrideOf,
  contributionDateOf,
  fxRateOf,
  fxRatesOf,
  latestEntryAt,
  linkedOffsetsByLoan,
  loansInPageOrder,
  metalsInUse,
  quoteLocalDate,
  seriesById,
  spotHistoryFrom,
  spotOf,
} from '../../src/assets/inputs';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import { loadInvestmentData, type InvestmentData } from '../../src/investments/load';
import { AS_OF, fakeEngine, fakeMarket, NOW, type FakeEngine } from '../investments/helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

const data = (): InvestmentData => loadInvestmentData(t.db);

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

function quote(
  seriesId: string,
  value: string | null,
  status: MarketQuoteStatus = 'fresh',
  asOf: string | null = '2026-09-23T22:00:00.000Z',
): MarketQuoteItem {
  return {
    seriesId,
    label: seriesId,
    value,
    unit: 'AUD',
    asOf: value === null ? null : asOf,
    fetchedAt: asOf,
    source: 'fake',
    status,
    lastError: null,
  };
}

function assetId(description: string): number {
  return t.db
    .select({ id: otherAssets.id })
    .from(otherAssets)
    .where(eq(otherAssets.description, description))
    .get()!.id;
}

function addAsset(p: Partial<typeof otherAssets.$inferInsert> & { description: string }): number {
  return t.db
    .insert(otherAssets)
    .values({ units: '1', sortOrder: 10, origin: 'app', ...p })
    .returning({ id: otherAssets.id })
    .get().id;
}

// ─── The shared rules ───────────────────────────────────────────────────────────────────────────

describe('the latest entry of a log (§2.3)', () => {
  const log = [
    { id: 1, asOf: '2026-01-31' },
    { id: 2, asOf: '2026-03-31' },
    { id: 3, asOf: '2026-06-30' },
  ];

  it('is the latest dated on or before the date', () => {
    expect(latestEntryAt(log, '2026-03-31')?.id).toBe(2);
    expect(latestEntryAt(log, '2026-05-01')?.id).toBe(2);
    expect(latestEntryAt(log, '2027-01-01')?.id).toBe(3);
  });

  it('is the earliest when every entry is later, and null for an empty log', () => {
    expect(latestEntryAt(log, '2025-12-31')?.id).toBe(1);
    expect(latestEntryAt([], AS_OF)).toBeNull();
  });
});

describe('the D73 assumed date', () => {
  it('is the earliest snapshot run date, or null without snapshots', () => {
    expect(assumedDateOf(data().snapshots)).toBe('2026-05-31');
    t.db.delete(snapshots).run();
    expect(assumedDateOf(data().snapshots)).toBeNull();
    expect(buildOtherAssetsInput(data(), [], AS_OF).assumedDate).toBeNull();
  });
});

// ─── Market series (§4.5) ───────────────────────────────────────────────────────────────────────

describe('bullion spot from the series', () => {
  it('reads the value, the as-of local date and fresh from the status; null without a value', () => {
    const series = seriesById([
      quote('XAG_AUD_OZ', '50.25', 'fresh', '2026-09-24T01:00:00.000Z'),
      quote('XAU_AUD_OZ', '4000', 'stale', '2026-09-20T01:00:00.000Z'),
    ]);
    expect(spotOf(series, 'silver')).toEqual({
      audPerOz: '50.25',
      asOf: quoteLocalDate('2026-09-24T01:00:00.000Z'),
      fresh: true,
    });
    expect(spotOf(series, 'gold')).toMatchObject({ audPerOz: '4000', fresh: false });
    expect(spotOf(seriesById([quote('XAG_AUD_OZ', null, 'none')]), 'silver')).toBeNull();
    expect(spotOf(new Map(), 'gold')).toBeNull();
  });

  it('takes an ISO date as it is and a timestamp as its server-local date', () => {
    expect(quoteLocalDate('2026-09-24')).toBe('2026-09-24');
    const ts = new Date(2026, 8, 24, 9, 30).toISOString();
    expect(quoteLocalDate(ts)).toBe('2026-09-24');
    expect(quoteLocalDate('not a date')).toBeNull();
  });
});

describe('the live FX rates', () => {
  const series = seriesById([
    quote('AUDUSD', '0.65'),
    quote('FX_EURAUD', '1.7123'),
    quote('FX_GBPAUD', '2.0100', 'stale'),
    quote('FX_NZDAUD', null, 'none'),
  ]);

  it('USD is 1 ÷ AUDUSD at 12 significant digits; a cross rate as stored; GBX is GBP ÷ 100', () => {
    expect(fxRateOf(series, 'USD')).toBe('1.53846153846');
    expect(fxRateOf(series, 'EUR')).toBe('1.7123');
    // A stale value is still used (the DTO's fx list shows the status).
    expect(fxRateOf(series, 'GBX')).toBe('0.0201');
    expect(fxRateOf(series, 'GBP')).toBe('2.01');
    expect(fxRateOf(series, 'NZD')).toBeNull();
    expect(fxRateOf(series, 'JPY')).toBeNull();
    expect(fxRateOf(seriesById([quote('AUDUSD', '0')]), 'USD')).toBeNull();
  });

  it('lists every foreign currency the assets use that has a rate (AUD implicit)', () => {
    addAsset({ description: 'US item', currency: 'USD' });
    addAsset({ description: 'UK item', currency: 'GBX' });
    addAsset({ description: 'NZ item', currency: 'NZD' });
    expect(fxRatesOf(data().otherAssets, series)).toEqual({
      GBX: '0.0201',
      USD: '1.53846153846',
    });
  });
});

// ─── Other assets (§2.4) ────────────────────────────────────────────────────────────────────────

describe('the other-assets input', () => {
  it('maps the manual row: its latest price entry at the as-of, sold units and sales', () => {
    const watch = assetId('Example watch');
    // A later entry (tomorrow) is not the latest at the as-of; a sale is carried.
    t.db
      .insert(otherAssetPrices)
      .values({ otherAssetId: watch, asOf: '2026-09-25', unitPrice: '2000' })
      .run();
    t.db
      .insert(otherAssetSales)
      .values({ otherAssetId: watch, saleDate: '2026-09-01', units: '0.5', proceedsCents: 90000 })
      .run();
    t.db.update(otherAssets).set({ soldUnits: '0.25' }).where(eq(otherAssets.id, watch)).run();
    const input = buildOtherAssetsInput(data(), [], AS_OF);
    const a = input.assets.find((x) => x.id === watch)!;
    expect(a).toEqual({
      id: watch,
      purchaseDate: '2023-04-01',
      units: '1',
      legacySoldUnits: '0.25',
      unitCost: '1500',
      currency: 'AUD',
      purchaseFxRate: null,
      pricing: { source: 'manual', unitPrice: '1800', priceAsOf: '2026-08-31' },
      sales: [
        expect.objectContaining({ saleDate: '2026-09-01', units: '0.5', proceedsCents: 90000 }),
      ],
    });
  });

  it('a manual row without price entries has no price; one with only later entries takes the earliest', () => {
    const none = addAsset({ description: 'Unpriced' });
    const later = addAsset({ description: 'Priced tomorrow' });
    t.db
      .insert(otherAssetPrices)
      .values([
        { otherAssetId: later, asOf: '2026-09-25', unitPrice: '12' },
        { otherAssetId: later, asOf: '2026-09-26', unitPrice: '13' },
      ])
      .run();
    const input = buildOtherAssetsInput(data(), [], AS_OF);
    expect(input.assets.find((a) => a.id === none)!.pricing).toEqual({
      source: 'manual',
      unitPrice: null,
      priceAsOf: null,
    });
    expect(input.assets.find((a) => a.id === later)!.pricing).toEqual({
      source: 'manual',
      unitPrice: '12',
      priceAsOf: '2026-09-25',
    });
  });

  it('maps a bullion row to its spot series with the stored price as the fallback', () => {
    const bar = assetId('Silver bar');
    const withSpot = buildOtherAssetsInput(data(), [quote('XAG_AUD_OZ', '52', 'stale')], AS_OF);
    expect(withSpot.assets.find((a) => a.id === bar)!.pricing).toEqual({
      source: 'bullion',
      metal: 'silver',
      ozPerUnit: '1',
      spot: { audPerOz: '52', asOf: quoteLocalDate('2026-09-23T22:00:00.000Z'), fresh: false },
      fallbackUnitPrice: '46.15',
      fallbackAsOf: '2026-08-31',
    });
    const noSpot = buildOtherAssetsInput(data(), [], AS_OF);
    expect(noSpot.assets.find((a) => a.id === bar)!.pricing).toMatchObject({
      spot: null,
      fallbackUnitPrice: '46.15',
    });
    // Gold reads XAU_AUD_OZ, not the silver series.
    const coin = addAsset({
      description: 'Gold coin',
      priceSource: 'bullion',
      metal: 'gold',
      ozPerUnit: '0.5',
    });
    const gold = buildOtherAssetsInput(
      data(),
      [quote('XAG_AUD_OZ', '52'), quote('XAU_AUD_OZ', '4100')],
      AS_OF,
    );
    expect(gold.assets.find((a) => a.id === coin)!.pricing).toMatchObject({
      metal: 'gold',
      ozPerUnit: '0.5',
      spot: { audPerOz: '4100', fresh: true },
      fallbackUnitPrice: null,
      fallbackAsOf: null,
    });
  });

  it('passes the purchase rate for a foreign row only, and the live rates by currency', () => {
    const us = addAsset({
      description: 'US item',
      currency: 'USD',
      purchaseDate: '2025-02-01',
      unitCost: '100',
      purchaseFxRate: '1.6',
      purchaseFxSource: 'market',
      purchaseFxDate: '2025-01-31',
    });
    const odd = addAsset({ description: 'AUD with a stray rate', purchaseFxRate: '2' });
    const input = buildOtherAssetsInput(data(), [quote('AUDUSD', '0.625')], AS_OF);
    expect(input.assets.find((a) => a.id === us)).toMatchObject({
      currency: 'USD',
      purchaseFxRate: '1.6',
    });
    expect(input.assets.find((a) => a.id === odd)!.purchaseFxRate).toBeNull();
    expect(input.fxRates).toEqual({ USD: '1.6' });
  });

  it('carries the as-of, the D73 date, the stale days, AJ/AK by run date and the chart setting', () => {
    const input = buildOtherAssetsInput(data(), [], AS_OF);
    expect(input).toMatchObject({
      asOf: AS_OF,
      assumedDate: '2026-05-31',
      stalePriceDays: 90,
      chart: { unit: 'monthly', count: null },
    });
    expect(input.snapshots).toEqual([
      {
        periodMonth: '2026-05',
        runDate: '2026-05-31',
        otherValueCents: 200000,
        otherGainCents: 20000,
      },
      {
        periodMonth: '2026-06',
        runDate: '2026-06-30',
        otherValueCents: 200000,
        otherGainCents: 20000,
      },
      {
        periodMonth: '2026-07',
        runDate: '2026-07-31',
        otherValueCents: 200000,
        otherGainCents: 20000,
      },
    ]);
    // The assets in sort order.
    expect(input.assets.map((a) => a.id)).toEqual([
      assetId('Example watch'),
      assetId('Silver bar'),
    ]);
    putSetting('otherAssets.stalePriceDays', 30);
    putSetting('charts.dateUnit', 'quarterly');
    putSetting('charts.unitCount', 4);
    expect(buildOtherAssetsInput(data(), [], AS_OF)).toMatchObject({
      stalePriceDays: 30,
      chart: { unit: 'quarterly', count: 4 },
    });
  });

  it('the spot history starts a year back, or at the earliest bullion purchase when later', () => {
    const rows = data().otherAssets;
    // The seed's bar was bought 2024-02-01: a year before the as-of is later.
    expect(spotHistoryFrom(rows, AS_OF)).toBe('2025-09-24');
    t.db
      .update(otherAssets)
      .set({ purchaseDate: '2026-02-10' })
      .where(eq(otherAssets.description, 'Silver bar'))
      .run();
    expect(spotHistoryFrom(data().otherAssets, AS_OF)).toBe('2026-02-10');
    expect(metalsInUse(data().otherAssets)).toEqual(['silver']);
    addAsset({ description: 'Gold coin', priceSource: 'bullion', metal: 'gold', ozPerUnit: '1' });
    expect(metalsInUse(data().otherAssets)).toEqual(['silver', 'gold']);
  });
});

// ─── Super (§2.5) ───────────────────────────────────────────────────────────────────────────────

describe('the super input', () => {
  it('maps the funds with their balance log, and the member contributions only', () => {
    const fund = t.db.select().from(superFunds).get()!;
    t.db
      .insert(superBalanceEntries)
      .values({
        fundId: fund.id,
        asOf: '2026-09-10',
        balanceCents: 5200000,
        transferInCents: 100000,
        origin: 'app',
      })
      .run();
    // An undated entry reads the period's first day.
    t.db
      .insert(superEntries)
      .values({ periodMonth: '2026-04', kind: 'after_tax', fundId: fund.id, amountCents: 5000 })
      .run();
    const input = buildSuperInput(data(), AS_OF);
    expect(input.funds).toEqual([
      {
        id: fund.id,
        receivesSg: true,
        archived: false,
        balances: [
          expect.objectContaining({
            asOf: '2026-05-31',
            balanceCents: 5000000,
            transferInCents: null,
          }),
          expect.objectContaining({
            asOf: '2026-08-31',
            balanceCents: 5060000,
            transferInCents: null,
          }),
          expect.objectContaining({
            asOf: '2026-09-10',
            balanceCents: 5200000,
            transferInCents: 100000,
          }),
        ],
      },
    ]);
    // Never the reported gain (Super!B11).
    expect(input.contributions.map((c) => [c.kind, c.date, c.amountCents, c.fundId])).toEqual([
      ['after_tax', '2026-04-01', 5000, fund.id],
      ['voluntary_contribution', '2026-05-31', 20000, null],
      ['voluntary_contribution', '2026-06-30', 20000, null],
      ['voluntary_contribution', '2026-07-31', 20000, null],
      ['voluntary_contribution', '2026-08-31', 20000, null],
    ]);
    expect(contributionDateOf({ entryDate: null, periodMonth: '2026-02' })).toBe('2026-02-01');
    expect(input.snapshots.map((s) => [s.runDate, s.superValueCents])).toEqual([
      ['2026-05-31', 5000000],
      ['2026-06-30', 5030000],
      ['2026-07-31', 5060000],
    ]);
  });

  it('reads the pay and tax settings, and every Stage 4 key with its default', () => {
    const input = buildSuperInput(data(), AS_OF);
    expect(input).toMatchObject({
      asOf: AS_OF,
      grossAnnualSalaryCents: null,
      jobStartDate: '2020-01-06',
      // Unset: the statutory table by FY (§3.3).
      sgRatio: null,
      contributionsTaxRatio: '0.15',
      marginalTaxRatio: null,
      importedContributionType: 'salary_sacrifice',
      concessionalCapOverride: null,
      sgOverrides: [],
      chart: { unit: 'monthly', count: null },
    });
    putSetting('pay.grossAnnualSalaryCents', 9000000);
    putSetting('tax.marginalRate', '0.325');
    putSetting('super.sgRate', '0.125');
    putSetting('super.contributionsTaxRate', '0.3');
    putSetting('super.importedContributionType', 'after_tax');
    t.db
      .insert(superSgOverrides)
      .values({ periodMonth: '2026-08', grossCents: 90000, origin: 'app' })
      .run();
    expect(buildSuperInput(data(), AS_OF)).toMatchObject({
      grossAnnualSalaryCents: 9000000,
      marginalTaxRatio: '0.325',
      sgRatio: '0.125',
      contributionsTaxRatio: '0.3',
      importedContributionType: 'after_tax',
      sgOverrides: [{ periodMonth: '2026-08', grossCents: 90000 }],
    });
  });

  it('the cap override needs both the cents and its FY', () => {
    putSetting('super.concessionalCapCents', 3500000);
    expect(capOverrideOf(data().settings)).toBeNull();
    expect(buildSuperInput(data(), AS_OF).concessionalCapOverride).toBeNull();
    putSetting('super.concessionalCapFy', 2026);
    expect(buildSuperInput(data(), AS_OF).concessionalCapOverride).toEqual({
      cents: 3500000,
      financialYear: 2026,
    });
    putSetting('super.concessionalCapCents', null);
    expect(capOverrideOf(data().settings)).toBeNull();
  });
});

// ─── Property and loans (§2.6) ──────────────────────────────────────────────────────────────────

describe('the property input', () => {
  function offsetAccount(): number {
    return t.db
      .select({ id: cashAccounts.id })
      .from(cashAccounts)
      .where(eq(cashAccounts.isOffset, true))
      .get()!.id;
  }
  function mortgage(): number {
    return t.db
      .select({ id: loans.id })
      .from(loans)
      .where(eq(loans.name, 'Example property mortgage'))
      .get()!.id;
  }

  it('maps the properties with their valuations and the loans with their start fields and log', () => {
    const input = buildPropertyInput(data(), AS_OF);
    expect(input.properties).toEqual([
      expect.objectContaining({
        purchaseDate: '2020-03-15',
        isPrimaryResidence: true,
        purchaseValueCents: 50000000,
        netRentToDateCents: 0,
        valuations: [
          expect.objectContaining({ asOf: '2025-08-31', valueCents: 58000000 }),
          expect.objectContaining({ asOf: '2026-08-31', valueCents: 60000000 }),
        ],
      }),
    ]);
    expect(input.loans[0]).toMatchObject({
      id: mortgage(),
      startDate: '2020-03-15',
      startBalanceCents: 45000000,
      annualRate: '0.06',
      compoundingPerYear: 12,
      paymentCents: 250000,
      paymentFrequency: 'monthly',
      entries: [
        expect.objectContaining({
          asOf: '2026-05-31',
          balanceCents: 40000000,
          repaymentsCents: null,
        }),
        expect.objectContaining({ asOf: '2026-08-31', balanceCents: 39800000 }),
      ],
      offsets: [],
    });
    // The loan without a property comes last.
    expect(input.loans.map((l) => l.propertyId === null)).toEqual([false, true]);
    expect(input.snapshots[2]).toEqual({
      periodMonth: '2026-07',
      runDate: '2026-07-31',
      propertyValueCents: 60000000,
      propertyPurchaseCents: 50000000,
      mortgageBalanceCents: -39800000,
      mortgageInterestFeesCents: 150000,
      mortgagePrincipalPaidCents: 100000,
    });
  });

  it('offsets are the linked accounts still flagged Offset, at their current balance (D67)', () => {
    const account = offsetAccount();
    t.db.insert(loanOffsetLinks).values({ accountId: account, loanId: mortgage() }).run();
    expect(buildPropertyInput(data(), AS_OF).loans[0]!.offsets).toEqual([
      { accountId: account, balanceCents: 1000000 },
    ]);
    // A link whose account is no longer an offset is left out (the Cash page removes it too).
    t.db.update(cashAccounts).set({ isOffset: false }).where(eq(cashAccounts.id, account)).run();
    expect(buildPropertyInput(data(), AS_OF).loans[0]!.offsets).toEqual([]);
    expect(linkedOffsetsByLoan(data()).size).toBe(0);
  });

  it('orders loans by property order, then loans without a property', () => {
    const car = t.db.select().from(loans).where(eq(loans.name, 'Example car loan')).get()!;
    t.db.update(loans).set({ sortOrder: 0 }).where(eq(loans.id, car.id)).run();
    expect(loansInPageOrder(data()).map((l) => l.name)).toEqual([
      'Example property mortgage',
      'Example car loan',
    ]);
  });
});

// ─── The request context (§4.5 "One request context") ──────────────────────────────────────────

describe('the finance context (Stage 4 members)', () => {
  function deps(engine: EngineApi, series: MarketQuoteItem[] = []): FinanceDeps {
    const market = fakeMarket();
    return {
      database: t,
      market: { ...market, getSeries: () => series },
      engine,
      now: () => NOW,
    };
  }
  const first = <T>(engine: FakeEngine, key: keyof EngineApi): T => engine.calls[key][0]![0] as T;

  it('computes each assets engine once per request, from the built inputs', () => {
    const engine = fakeEngine();
    const ctx = createFinanceContext(deps(engine, [quote('XAG_AUD_OZ', '50')]));
    ctx.otherAssets();
    ctx.superResult();
    ctx.property();
    ctx.assetsSnapshot();
    ctx.classValues();
    ctx.savings();
    ctx.assetsSnapshot();
    expect(engine.calls.computeOtherAssets).toHaveLength(1);
    expect(engine.calls.computeSuper).toHaveLength(1);
    expect(engine.calls.computeProperty).toHaveLength(1);
    expect(engine.calls.assetsSnapshotColumns).toHaveLength(1);
    const oa = first<OtherAssetsInput>(engine, 'computeOtherAssets');
    expect(oa).toEqual(ctx.otherAssetsInput());
    expect(oa.assets[1]!.pricing).toMatchObject({ source: 'bullion', spot: { audPerOz: '50' } });
    expect(first<SuperInput>(engine, 'computeSuper')).toEqual(buildSuperInput(ctx.data, AS_OF));
    expect(first<PropertyInput>(engine, 'computeProperty')).toEqual(
      buildPropertyInput(ctx.data, AS_OF),
    );
    // The seam takes the three results.
    expect(first<{ otherAssets: unknown }>(engine, 'assetsSnapshotColumns')).toEqual({
      otherAssets: ctx.otherAssets(),
      super: ctx.superResult(),
      property: ctx.property(),
    });
  });

  it("the other-assets class value is the engine's total value (live spot and FX)", () => {
    const neutral = fakeEngine();
    const engine = fakeEngine({
      computeOtherAssets: (i) => {
        const r = neutral.computeOtherAssets(i);
        return { ...r, totals: { ...r.totals, valueCents: 123456 } };
      },
    });
    expect(createFinanceContext(deps(engine)).classValues().other_assets).toBe(123456);
  });

  it('reads the spot history of the metals in use from a year before the as-of', () => {
    t.db
      .insert(marketQuoteHistory)
      .values([
        { seriesId: 'XAG_AUD_OZ', date: '2025-09-01', value: '40', source: 'fake', fetchedAt: 'x' },
        { seriesId: 'XAG_AUD_OZ', date: '2026-09-01', value: '48', source: 'fake', fetchedAt: 'x' },
        { seriesId: 'XAG_AUD_OZ', date: '2026-09-02', value: '49', source: 'fake', fetchedAt: 'x' },
        {
          seriesId: 'XAU_AUD_OZ',
          date: '2026-09-02',
          value: '4000',
          source: 'fake',
          fetchedAt: 'x',
        },
      ])
      .run();
    const history = createFinanceContext(deps(fakeEngine())).spotHistory();
    expect(history).toEqual({
      XAG_AUD_OZ: [
        { date: '2026-09-01', value: '48' },
        { date: '2026-09-02', value: '49' },
      ],
    });
    // No bullion held: nothing is read.
    t.db.delete(otherAssets).where(eq(otherAssets.priceSource, 'bullion')).run();
    expect(createFinanceContext(deps(fakeEngine())).spotHistory()).toEqual({});
  });
});
