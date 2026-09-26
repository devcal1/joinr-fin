// The Stage 4 page builders (stage-4.md §4.4, §7.4 step 2): each DTO mapped field by field from a
// HAND-BUILT engine result on the generic seed (so the mapping is checked before the engine lands),
// the display fields the server adds (names, notes, origins, counts, the savings period of each
// contribution, the imported "payments paid"), the orders §4.4 fixes, the market tiles, and the
// Cash page's additive fields. Generic values only.
import type { EngineApi, OtherAssetsResult, PropertiesResult, SuperResult } from '@joinr/engine';
import type { MarketQuoteItem } from '@joinr/schema';
import {
  cashAccounts,
  loanOffsetLinks,
  loans,
  marketQuoteHistory,
  otherAssetPrices,
  otherAssets,
  otherAssetSales,
  properties,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOtherAssetsPage } from '../../src/assets/otherAssets';
import { buildPropertyPage } from '../../src/assets/property';
import { buildSuperPage } from '../../src/assets/super';
import { buildCashPage } from '../../src/cashflow/cash';
import { createFinanceContext, type FinanceDeps } from '../../src/cashflow/context';
import { AS_OF, fakeEngine, fakeMarket, NOW } from '../investments/helpers';
import { amortisation, otherAssetResult, superPeriod } from './helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

function deps(engine: EngineApi, series: MarketQuoteItem[] = []): FinanceDeps {
  const market = fakeMarket([], { mode: 'fake', lastRefreshAt: '2026-09-24T01:00:00.000Z' });
  return { database: t, market: { ...market, getSeries: () => series }, engine, now: () => NOW };
}

const idOf = {
  asset: (d: string) =>
    t.db.select().from(otherAssets).where(eq(otherAssets.description, d)).get()!.id,
  fund: () => t.db.select().from(superFunds).get()!.id,
  property: () => t.db.select().from(properties).get()!.id,
  loan: (name: string) => t.db.select().from(loans).where(eq(loans.name, name)).get()!.id,
  offsetAccount: () =>
    t.db.select().from(cashAccounts).where(eq(cashAccounts.isOffset, true)).get()!.id,
};

function quote(seriesId: string, value: string | null, status: MarketQuoteItem['status']) {
  return {
    seriesId,
    label: seriesId,
    value,
    unit: 'AUD',
    asOf: value === null ? null : '2026-09-24T00:30:00.000Z',
    fetchedAt: '2026-09-24T00:30:00.000Z',
    source: 'fake',
    status,
    lastError: null,
  } satisfies MarketQuoteItem;
}

// ─── Other Assets ───────────────────────────────────────────────────────────────────────────────

describe('GET /api/other-assets: the page builder', () => {
  function otherAssetsEngine(): EngineApi {
    const neutral = fakeEngine();
    return fakeEngine({
      computeOtherAssets: (input): OtherAssetsResult => {
        const watch = idOf.asset('Example watch');
        const bar = idOf.asset('Silver bar');
        const sale = t.db.select().from(otherAssetSales).get()!;
        return {
          ...neutral.computeOtherAssets(input),
          assets: [
            otherAssetResult({
              id: watch,
              remainingUnits: '0.5',
              costCents: 75000,
              unitPriceAud: '1800',
              valueCents: 90000,
              gainCents: 15000,
              gainRatio: '0.2',
              cagrRatio: '0.0521',
              effectiveDate: '2023-04-01',
              heldDays: 1272,
              priceStatus: 'manual',
              priceAsOf: '2026-08-31',
              sales: [
                {
                  id: sale.id,
                  saleDate: '2026-09-01',
                  units: '0.5',
                  proceedsCents: 95000,
                  costCents: 75000,
                  realisedCents: 20000,
                },
              ],
              realisedCents: 20000,
            }),
            otherAssetResult({
              id: bar,
              remainingUnits: '10',
              costCents: 35000,
              unitPriceAud: '50',
              valueCents: 50000,
              gainCents: 15000,
              gainRatio: '0.428571428571',
              effectiveDate: '2024-02-01',
              heldDays: 966,
              priceStatus: 'fresh',
              priceAsOf: '2026-09-24',
            }),
          ],
          totals: {
            valueCents: 140000,
            costCents: 110000,
            gainCents: 30000,
            gainRatio: '0.272727272727',
            realisedCents: 20000,
            proceedsCents: 95000,
            unpricedCount: 1,
            staleCount: 2,
            assumedDateCount: 3,
            fxMissingCount: 4,
            liveFxMissingCount: 5,
          },
          chart: [
            {
              label: 'Sep 2026',
              period: '2026-09',
              date: AS_OF,
              live: true,
              costCents: 110000,
              valueCents: 140000,
              gainCents: 30000,
              gainRatio: '0.272727272727',
            },
          ],
        };
      },
    });
  }

  beforeEach(() => {
    const watch = idOf.asset('Example watch');
    t.db
      .insert(otherAssetSales)
      .values({
        otherAssetId: watch,
        saleDate: '2026-09-01',
        units: '0.50',
        proceedsCents: 95000,
        note: 'To a friend',
        origin: 'app',
      })
      .run();
  });

  it('maps every asset field (engine figures, row display fields, counts)', () => {
    const page = buildOtherAssetsPage(
      createFinanceContext(deps(otherAssetsEngine(), [quote('XAG_AUD_OZ', '50', 'fresh')])),
    );
    const watch = idOf.asset('Example watch');
    expect(page.assets[0]).toEqual({
      id: watch,
      description: 'Example watch',
      url: null,
      note: null,
      purchaseDate: '2023-04-01',
      effectiveDate: '2023-04-01',
      dateAssumed: false,
      heldDays: 1272,
      units: '1',
      legacySoldUnits: '0',
      // Σ the recorded sales, normalised.
      soldUnits: '0.5',
      remainingUnits: '0.5',
      currency: 'AUD',
      unitCost: '1500',
      purchaseFxRate: null,
      purchaseFxSource: null,
      purchaseFxDate: null,
      priceSource: 'manual',
      metal: null,
      ozPerUnit: null,
      unitOfMeasure: 'each',
      // The latest entry at the as-of (the engine's input), in the asset's currency.
      unitPrice: '1800',
      priceAsOf: '2026-08-31',
      unitPriceAud: '1800',
      priceStatus: 'manual',
      costCents: 75000,
      valueCents: 90000,
      gainCents: 15000,
      gainRatio: '0.2',
      cagrRatio: '0.0521',
      realisedCents: 20000,
      saleCount: 1,
      priceEntryCount: 2,
      flags: [],
      sortOrder: 1,
      origin: 'import',
      sheetRef: 'Other Assets!F3',
    });
    // A bullion row never reports a hand price.
    expect(page.assets[1]).toMatchObject({
      description: 'Silver bar',
      url: 'https://example.com/silver-bar',
      priceSource: 'bullion',
      metal: 'silver',
      ozPerUnit: '1',
      unitOfMeasure: 'oz',
      unitPrice: null,
      unitPriceAud: '50',
      priceStatus: 'fresh',
      priceEntryCount: 0,
      saleCount: 0,
      soldUnits: '0',
    });
  });

  it('lists the price entries (asOf desc, then id desc) and the sales with their realised gains', () => {
    const watch = idOf.asset('Example watch');
    const box = t.db
      .insert(otherAssets)
      .values({ description: 'Sealed box', units: '1', currency: 'USD', sortOrder: 3 })
      .returning({ id: otherAssets.id })
      .get().id;
    t.db
      .insert(otherAssetPrices)
      .values({ otherAssetId: box, asOf: '2026-03-31', unitPrice: '120.50', origin: 'app' })
      .run();
    // A second asset's entry on the same date sorts by id (desc), in its own currency.
    const page = buildOtherAssetsPage(createFinanceContext(deps(otherAssetsEngine())));
    expect(page.priceEntries.map((p) => [p.asOf, p.unitPrice, p.currency, p.origin])).toEqual([
      ['2026-08-31', '1800', 'AUD', 'import'],
      ['2026-03-31', '120.5', 'USD', 'app'],
      ['2026-03-31', '1700', 'AUD', 'import'],
    ]);
    expect(page.priceEntries[0]).toEqual({
      id: expect.any(Number) as number,
      assetId: watch,
      asOf: '2026-08-31',
      unitPrice: '1800',
      currency: 'AUD',
      note: null,
      origin: 'import',
      sheetRef: 'Other Assets!F3',
    });
    const sale = t.db.select().from(otherAssetSales).get()!;
    expect(page.sales).toEqual([
      {
        id: sale.id,
        assetId: watch,
        saleDate: '2026-09-01',
        units: '0.5',
        proceedsCents: 95000,
        costCents: 75000,
        realisedCents: 20000,
        note: 'To a friend',
        origin: 'app',
      },
    ]);
  });

  it('maps the totals, the D73 date, the chart, the market and the settings slice', () => {
    const page = buildOtherAssetsPage(createFinanceContext(deps(otherAssetsEngine())));
    expect(page.asOf).toBe(AS_OF);
    expect(page.generatedAt).toBe(NOW.toISOString());
    expect(page.totals).toEqual({
      valueCents: 140000,
      costCents: 110000,
      gainCents: 30000,
      gainRatio: '0.272727272727',
      realisedCents: 20000,
      proceedsCents: 95000,
      unpricedCount: 1,
      staleCount: 2,
      assumedDateCount: 3,
      fxMissingCount: 4,
      liveFxMissingCount: 5,
    });
    expect(page.assumedDate).toBe('2026-05-31');
    expect(page.charts).toEqual({
      unit: 'monthly',
      count: null,
      points: [
        {
          label: 'Sep 2026',
          period: '2026-09',
          date: AS_OF,
          live: true,
          costCents: 110000,
          valueCents: 140000,
          gainCents: 30000,
          gainRatio: '0.272727272727',
        },
      ],
    });
    expect(page.market).toEqual({ mode: 'fake', lastRefreshAt: '2026-09-24T01:00:00.000Z' });
    expect(page.settings).toEqual({
      values: { 'otherAssets.stalePriceDays': null },
      origins: { 'otherAssets.stalePriceDays': null },
    });
  });

  it('always shows both spot tiles (silver, then gold) and the FX of the currencies in use', () => {
    t.db
      .insert(otherAssets)
      .values([
        { description: 'UK item', units: '1', currency: 'GBX', sortOrder: 5 },
        { description: 'US item', units: '1', currency: 'USD', sortOrder: 6 },
        { description: 'NZ item', units: '1', currency: 'NZD', sortOrder: 7 },
      ])
      .run();
    const page = buildOtherAssetsPage(
      createFinanceContext(
        deps(fakeEngine(), [
          quote('XAG_AUD_OZ', '50', 'fresh'),
          quote('XAU_AUD_OZ', null, 'none'),
          quote('AUDUSD', '0.64', 'stale'),
          quote('FX_GBPAUD', '2', 'fresh'),
        ]),
      ),
    );
    expect(page.spot).toEqual([
      { metal: 'silver', audPerOz: '50', asOf: '2026-09-24T00:30:00.000Z', status: 'fresh' },
      { metal: 'gold', audPerOz: null, asOf: null, status: 'none' },
    ]);
    expect(page.fx).toEqual([
      { currency: 'GBX', audPerUnit: '0.02', asOf: '2026-09-24T00:30:00.000Z', status: 'fresh' },
      { currency: 'NZD', audPerUnit: null, asOf: null, status: 'none' },
      { currency: 'USD', audPerUnit: '1.5625', asOf: '2026-09-24T00:30:00.000Z', status: 'stale' },
    ]);
    // No series stored at all: both tiles still show, with no value.
    const empty = buildOtherAssetsPage(createFinanceContext(deps(fakeEngine())));
    expect(empty.spot.map((s) => [s.metal, s.audPerOz, s.status])).toEqual([
      ['silver', null, 'none'],
      ['gold', null, 'none'],
    ]);
  });

  it('gives the spot history of the metals in use only', () => {
    t.db
      .insert(marketQuoteHistory)
      .values({
        seriesId: 'XAG_AUD_OZ',
        date: '2026-09-20',
        value: '49.5',
        source: 'fake',
        fetchedAt: '2026-09-20T00:00:00.000Z',
      })
      .run();
    const page = buildOtherAssetsPage(createFinanceContext(deps(fakeEngine())));
    expect(page.spotHistory).toEqual([
      { metal: 'silver', points: [{ date: '2026-09-20', audPerOz: '49.5' }] },
    ]);
  });
});

// ─── Super ──────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/super: the page builder', () => {
  function flows(sg: number) {
    return {
      sgGrossCents: sg,
      sgFundCents: Math.round(sg * 0.85),
      memberFundCents: 17000,
      memberNetPayCents: 20000,
      concessionalCents: 20000,
      nonConcessionalCents: 0,
      transferInCents: 0,
    };
  }

  function superEngine(): EngineApi {
    return fakeEngine({
      computeSuper: (input): SuperResult => {
        const fund = input.funds[0]!;
        const [early, late] = fund.balances as [
          (typeof fund.balances)[0],
          (typeof fund.balances)[0],
        ];
        const contributions = input.contributions.map((c) => ({
          id: c.id,
          fundId: c.fundId,
          date: c.date,
          kind: c.kind,
          amountCents: c.amountCents,
          estimate: c.kind === 'voluntary_contribution',
          preTaxCents: 28571,
          fundReceivesCents: 24285,
          netPayCostCents: c.amountCents,
          concessional: true,
        }));
        contributions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
        return {
          totalCents: 5060000,
          funds: [
            {
              id: fund.id,
              receivesSg: true,
              archived: false,
              balanceCents: 5060000,
              balanceAsOf: '2026-08-31',
              entries: [
                { ...early, flowsCents: null, gainCents: null },
                { ...late, flowsCents: 150000, gainCents: -90000 },
              ],
            },
          ],
          contributions,
          sgMonths: [
            {
              month: '2026-08',
              source: 'statement',
              grossCents: 90000,
              fundReceivesCents: 76500,
              fundId: fund.id,
              capFinancialYear: 2026,
            },
            {
              month: '2026-09',
              source: 'estimate',
              grossCents: 80000,
              fundReceivesCents: 68000,
              fundId: fund.id,
              capFinancialYear: 2026,
            },
          ],
          periods: [
            superPeriod({
              periodMonth: '2026-05',
              runDate: '2026-05-31',
              status: 'first',
              valueCents: 5000000,
            }),
            superPeriod({
              periodMonth: '2026-06',
              runDate: '2026-06-30',
              after: '2026-05-31',
              valueCents: 5030000,
              flows: flows(80000),
              gainFrom: '2026-05-31',
              changeCents: 30000,
              gainFlows: flows(80000),
              gainCents: -55000,
              gainRatio: '-0.0108',
              returnRatio: '-0.011',
            }),
            superPeriod({
              periodMonth: '2026-07',
              runDate: '2026-07-31',
              after: '2026-06-30',
              valueCents: 5060000,
            }),
            superPeriod({
              periodMonth: '2026-09',
              runDate: AS_OF,
              after: '2026-07-31',
              through: AS_OF,
              status: 'provisional',
              valueCents: 5060000,
              notUpdated: true,
            }),
          ],
          annualised: {
            cumulativeRatio: '-0.011',
            returnRatio: null,
            from: '2026-05-31',
            through: '2026-06-30',
            days: 30,
          },
          capYears: [
            {
              financialYear: 2026,
              start: '2026-07-01',
              end: '2027-07-01',
              complete: false,
              capCents: 3250000,
              capSource: 'statutory',
              sgGrossCents: 170000,
              sgFundCents: 144500,
              sgSource: 'mixed',
              salarySacrificeCents: 0,
              importedEstimateCents: 57142,
              totalCents: 227142,
              projectedCents: 1500000,
              ratio: '0.0698898',
              projectedRatio: '0.461538461538',
              status: 'under',
              nonConcessionalCents: 0,
              memberCents: 57142,
              memberFundCents: 48570,
              memberNetPayCents: 40000,
              estimateCount: 2,
            },
          ],
          chart: [
            {
              label: 'Sep 2026',
              period: '2026-09',
              date: AS_OF,
              live: true,
              valueCents: 5060000,
              gainCents: null,
              returnRatio: null,
              memberNetPayCents: 40000,
              memberFundCents: 48570,
              sgFundCents: 68000,
            },
          ],
          snapshot: {
            superValueCents: 5060000,
            superContribCents: 40000,
            superGainCents: null,
            superGainRatio: null,
          },
          flags: ['imported_estimates', 'balances_not_updated'],
        };
      },
    });
  }

  it('maps the funds (archived last, counts) and the balance log with its flows and gains', () => {
    const fund = idOf.fund();
    const archived = t.db
      .insert(superFunds)
      .values({ name: 'Old fund', balanceCents: 0, sortOrder: 0, archived: true, origin: 'app' })
      .returning({ id: superFunds.id })
      .get().id;
    t.db
      .insert(superBalanceEntries)
      .values({ fundId: archived, asOf: '2026-01-31', balanceCents: 0, origin: 'app' })
      .run();
    const neutral = fakeEngine();
    const engine = fakeEngine({
      computeSuper: (input) => {
        const r = superEngine().computeSuper({
          ...input,
          funds: input.funds.filter((f) => f.id === fund),
        });
        const old = neutral.computeSuper({
          ...input,
          funds: input.funds.filter((f) => f.id === archived),
        });
        return { ...r, funds: [...old.funds, ...r.funds] };
      },
    });
    const page = buildSuperPage(createFinanceContext(deps(engine)));
    expect(page.funds).toEqual([
      {
        id: fund,
        name: 'Example Super',
        receivesSg: true,
        archived: false,
        balanceCents: 5060000,
        balanceAsOf: '2026-08-31',
        entryCount: 2,
        // The seed's contributions name no fund; the reported gain is not a contribution.
        contributionCount: 0,
        sortOrder: 1,
        origin: 'import',
        sheetRef: 'Super!A2',
      },
      expect.objectContaining({ id: archived, archived: true, balanceCents: null, entryCount: 1 }),
    ]);
    const entries = page.balanceEntries.filter((e) => e.fundId === fund);
    expect(entries.map((e) => [e.asOf, e.flowsCents, e.gainCents])).toEqual([
      ['2026-08-31', 150000, -90000],
      ['2026-05-31', null, null],
    ]);
    expect(entries[1]).toEqual({
      id: expect.any(Number) as number,
      fundId: fund,
      asOf: '2026-05-31',
      balanceCents: 5000000,
      transferInCents: null,
      flowsCents: null,
      gainCents: null,
      note: 'Statement',
      origin: 'import',
      sheetRef: null,
    });
  });

  it("maps each contribution with its fund's name and the savings period it falls in", () => {
    const fund = idOf.fund();
    const typed = t.db
      .insert(superEntries)
      .values({
        periodMonth: '2026-09',
        kind: 'salary_sacrifice',
        fundId: fund,
        entryDate: '2026-09-15',
        amountCents: 50000,
        note: 'Bonus sacrifice',
        origin: 'app',
      })
      .returning({ id: superEntries.id })
      .get().id;
    const page = buildSuperPage(createFinanceContext(deps(superEngine())));
    expect(page.contributions.map((c) => [c.date, c.periodMonth, c.provisional])).toEqual([
      ['2026-09-15', '2026-09', true],
      ['2026-08-31', '2026-09', true],
      ['2026-07-31', '2026-07', false],
      ['2026-06-30', '2026-06', false],
      // The baseline's run date is the first period's.
      ['2026-05-31', '2026-05', false],
    ]);
    expect(page.contributions[0]).toEqual({
      id: typed,
      fundId: fund,
      fundName: 'Example Super',
      date: '2026-09-15',
      kind: 'salary_sacrifice',
      amountCents: 50000,
      estimate: false,
      preTaxCents: 28571,
      fundReceivesCents: 24285,
      netPayCostCents: 50000,
      concessional: true,
      periodMonth: '2026-09',
      provisional: true,
      note: 'Bonus sacrifice',
      origin: 'app',
      sheetRef: null,
    });
    expect(page.contributions[1]).toMatchObject({
      fundId: null,
      fundName: null,
      kind: 'voluntary_contribution',
      estimate: true,
      sheetRef: 'Super!B16',
      origin: 'import',
    });
  });

  it('maps the SG months (month desc, with the statement note) and the periods (newest first)', () => {
    t.db
      .insert(superSgOverrides)
      .values({
        periodMonth: '2026-08',
        grossCents: 90000,
        note: 'From the statement',
        origin: 'app',
      })
      .run();
    const page = buildSuperPage(createFinanceContext(deps(superEngine())));
    expect(page.sgMonths).toEqual([
      {
        month: '2026-09',
        source: 'estimate',
        grossCents: 80000,
        fundReceivesCents: 68000,
        fundId: idOf.fund(),
        capFinancialYear: 2026,
        note: null,
      },
      {
        month: '2026-08',
        source: 'statement',
        grossCents: 90000,
        fundReceivesCents: 76500,
        fundId: idOf.fund(),
        capFinancialYear: 2026,
        note: 'From the statement',
      },
    ]);
    expect(page.periods.map((p) => [p.periodMonth, p.status, p.notUpdated])).toEqual([
      ['2026-09', 'provisional', true],
      ['2026-07', 'closed', false],
      ['2026-06', 'closed', false],
      ['2026-05', 'first', false],
    ]);
    const june = page.periods[2]!;
    expect(june).toEqual({
      periodMonth: '2026-06',
      runDate: '2026-06-30',
      after: '2026-05-31',
      through: '2026-06-30',
      status: 'closed',
      valueCents: 5030000,
      notUpdated: false,
      flows: flows(80000),
      gainFrom: '2026-05-31',
      changeCents: 30000,
      gainFlows: flows(80000),
      gainCents: -55000,
      gainRatio: '-0.0108',
      returnRatio: '-0.011',
      // The seed's super_option note of that month.
      note: {
        periodMonth: '2026-06',
        kind: 'super_option',
        note: 'Switched to the balanced option',
        origin: 'import',
        sheetRef: 'Super!F3',
      },
    });
    expect(page.periods[0]!.note).toBeNull();
    expect(page.notes).toEqual([june.note]);
  });

  it('maps the annualised return, the cap years, the statutory figures, flags, chart and settings', () => {
    const page = buildSuperPage(createFinanceContext(deps(superEngine())));
    expect(page).toMatchObject({
      asOf: AS_OF,
      generatedAt: NOW.toISOString(),
      lastRun: '2026-07-31',
      totalCents: 5060000,
      annualised: {
        cumulativeRatio: '-0.011',
        returnRatio: null,
        from: '2026-05-31',
        through: '2026-06-30',
        days: 30,
      },
      capOverride: null,
      flags: ['imported_estimates', 'balances_not_updated'],
    });
    expect(page.capYears).toEqual([
      {
        financialYear: 2026,
        start: '2026-07-01',
        end: '2027-07-01',
        complete: false,
        capCents: 3250000,
        capSource: 'statutory',
        sgGrossCents: 170000,
        sgFundCents: 144500,
        sgSource: 'mixed',
        salarySacrificeCents: 0,
        importedEstimateCents: 57142,
        totalCents: 227142,
        projectedCents: 1500000,
        ratio: '0.0698898',
        projectedRatio: '0.461538461538',
        status: 'under',
        nonConcessionalCents: 0,
        memberCents: 57142,
        memberFundCents: 48570,
        memberNetPayCents: 40000,
        estimateCount: 2,
      },
    ]);
    expect(page.statutory).toEqual({
      // The statutory rate of the as-of's FY (FY2026–27: the table's last entry, 12 %).
      sgRatio: '0.12',
      contributionsTaxRatio: '0.15',
      checkedOn: '2026-09-26',
      paydaySuperStart: '2026-07-01',
      caps: [
        { financialYear: 2021, capCents: 2750000 },
        { financialYear: 2022, capCents: 2750000 },
        { financialYear: 2023, capCents: 2750000 },
        { financialYear: 2024, capCents: 3000000 },
        { financialYear: 2025, capCents: 3000000 },
        { financialYear: 2026, capCents: 3250000 },
      ],
      sgRates: [
        { financialYear: 2021, ratio: '0.1' },
        { financialYear: 2022, ratio: '0.105' },
        { financialYear: 2023, ratio: '0.11' },
        { financialYear: 2024, ratio: '0.115' },
        { financialYear: 2025, ratio: '0.12' },
      ],
    });
    expect(page.charts).toEqual({
      unit: 'monthly',
      count: null,
      points: [
        {
          label: 'Sep 2026',
          period: '2026-09',
          date: AS_OF,
          live: true,
          valueCents: 5060000,
          gainCents: null,
          returnRatio: null,
          memberNetPayCents: 40000,
          memberFundCents: 48570,
          sgFundCents: 68000,
        },
      ],
    });
    expect(page.settings.values).toEqual({
      'pay.grossAnnualSalaryCents': null,
      'tax.marginalRate': null,
      'pay.jobStartDate': '2020-01-06',
      'super.sgRate': null,
      'super.contributionsTaxRate': null,
      'super.concessionalCapCents': null,
      'super.importedContributionType': null,
    });
    expect(page.settings.origins['pay.jobStartDate']).toBe('import');
    expect(page.settings.origins['super.sgRate']).toBeNull();
  });

  it("uses your employer's SG rate when set, and the cap override with its FY", () => {
    const put = (key: string, value: unknown) =>
      t.sqlite
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at, origin) VALUES (?, ?, ?, 'app')`,
        )
        .run(key, JSON.stringify(value), NOW.toISOString());
    put('super.sgRate', '0.125');
    put('super.contributionsTaxRate', '0.3');
    put('super.concessionalCapCents', 3500000);
    put('super.concessionalCapFy', 2026);
    const page = buildSuperPage(createFinanceContext(deps(superEngine())));
    expect(page.statutory).toMatchObject({ sgRatio: '0.125', contributionsTaxRatio: '0.3' });
    expect(page.capOverride).toEqual({ cents: 3500000, financialYear: 2026 });
    expect(page.settings.values['super.concessionalCapCents']).toBe(3500000);
    // The FY key is server-written, not part of the page's editable slice.
    expect(page.settings.values).not.toHaveProperty('super.concessionalCapFy');
  });
});

// ─── Property ───────────────────────────────────────────────────────────────────────────────────

describe('GET /api/property: the page builder', () => {
  function propertyEngine(): EngineApi {
    const neutral = fakeEngine();
    return fakeEngine({
      computeProperty: (input): PropertiesResult => {
        const mortgage = input.loans[0]!;
        const car = input.loans[1]!;
        const [first, latest] = mortgage.entries as [
          (typeof mortgage.entries)[0],
          (typeof mortgage.entries)[0],
        ];
        const loanResult = (id: number, propertyId: number | null) => ({
          id,
          propertyId,
          balanceCents: 39800000,
          balanceAsOf: '2026-08-31',
          startBalanceCents: 45000000,
          paymentAnchorDate: '2020-03-15',
          offsetCents: 1000000,
          netBalanceCents: 38800000,
          excessOffsetCents: 0,
          entries: [
            {
              id: null,
              start: true,
              asOf: '2020-03-15',
              balanceCents: 45000000,
              paymentsCounted: null,
              repaymentsCents: null,
              repaymentsTyped: false,
              principalCents: null,
              interestFeesCents: null,
              cumulativePrincipalCents: 0,
              cumulativeInterestFeesCents: 0,
              flags: [],
            },
            {
              id: first.id,
              start: false,
              asOf: first.asOf,
              balanceCents: first.balanceCents,
              paymentsCounted: 74,
              repaymentsCents: 18500000,
              repaymentsTyped: false,
              principalCents: 5000000,
              interestFeesCents: 13500000,
              cumulativePrincipalCents: 5000000,
              cumulativeInterestFeesCents: 13500000,
              flags: [],
            },
            {
              id: latest.id,
              start: false,
              asOf: latest.asOf,
              balanceCents: latest.balanceCents,
              paymentsCounted: 3,
              repaymentsCents: 150000,
              repaymentsTyped: true,
              principalCents: 200000,
              interestFeesCents: -50000,
              cumulativePrincipalCents: 5200000,
              cumulativeInterestFeesCents: 13450000,
              flags: ['repayments_below_principal' as const],
            },
          ],
          repaymentsCents: 18650000,
          principalPaidCents: 5200000,
          interestFeesCents: 13450000,
          nextPeriodInterestCents: 194000,
          schedule: amortisation({
            points: [{ date: '2026-08-31', balanceCents: 38800000, interestCents: 0 }],
          }),
          scheduleWithoutOffset: amortisation({ payments: 250, totalInterestCents: 21000000 }),
          interestSavedCents: 1000000,
          monthsSaved: 10,
          flags: [],
        });
        return {
          ...neutral.computeProperty(input),
          properties: [
            {
              id: input.properties[0]!.id,
              isPrimaryResidence: true,
              valueCents: 60000000,
              valuationDate: '2026-08-31',
              purchaseValueCents: 50000000,
              netRentCents: 0,
              gainCents: 10000000,
              gainRatio: '0.2',
              cagrRatio: '0.0283',
              heldDays: 2384,
              loanIds: [mortgage.id],
              debtCents: 38800000,
              equityCents: 21200000,
              lvrRatio: '0.646666666667',
            },
          ],
          loans: [
            loanResult(mortgage.id, mortgage.propertyId),
            { ...loanResult(car.id, null), entries: [], flags: ['no_property'] },
          ],
          totals: {
            purchaseCents: 50000000,
            valueCents: 60000000,
            gainCents: 10000000,
            gainRatio: '0.2',
            mortgageCents: 39800000,
            offsetCents: 1000000,
            netMortgageCents: 38800000,
            principalPaidCents: 5200000,
            interestFeesCents: 13450000,
            repaymentsCents: 18650000,
            startBalanceCents: 45000000,
            lvrRatio: '0.646666666667',
            equityCents: 21200000,
          },
          chart: [
            {
              label: 'Sep 2026',
              period: '2026-09',
              date: AS_OF,
              live: true,
              valueCents: 60000000,
              purchaseCents: 50000000,
              mortgageCents: 39800000,
              equityCents: 21200000,
              lvrRatio: '0.646666666667',
              interestFeesCents: 13450000,
              principalPaidCents: 5200000,
            },
          ],
        };
      },
    });
  }

  beforeEach(() => {
    t.db
      .insert(loanOffsetLinks)
      .values({ accountId: idOf.offsetAccount(), loanId: idOf.loan('Example property mortgage') })
      .run();
  });

  it('maps the properties (engine figures, counts) and the valuations (asOf desc)', () => {
    const page = buildPropertyPage(createFinanceContext(deps(propertyEngine())));
    expect(page.properties).toEqual([
      {
        id: idOf.property(),
        name: 'Example property',
        purchaseDate: '2020-03-15',
        isPrimaryResidence: true,
        purchaseValueCents: 50000000,
        valueCents: 60000000,
        valuationDate: '2026-08-31',
        netRentToDateCents: 0,
        gainCents: 10000000,
        gainRatio: '0.2',
        cagrRatio: '0.0283',
        heldDays: 2384,
        debtCents: 38800000,
        equityCents: 21200000,
        lvrRatio: '0.646666666667',
        loanIds: [idOf.loan('Example property mortgage')],
        valuationCount: 2,
        note: null,
        sortOrder: 1,
        origin: 'import',
        sheetRef: 'Property!D15',
      },
    ]);
    expect(page.valuations.map((v) => [v.asOf, v.valueCents, v.note])).toEqual([
      ['2026-08-31', 60000000, null],
      ['2025-08-31', 58000000, 'Bank valuation'],
    ]);
  });

  it('maps every loan field; the imported "payments paid" only for a workbook loan', () => {
    const mortgage = idOf.loan('Example property mortgage');
    const page = buildPropertyPage(createFinanceContext(deps(propertyEngine())));
    expect(page.loans[0]).toEqual({
      id: mortgage,
      propertyId: idOf.property(),
      propertyName: 'Example property',
      name: 'Example property mortgage',
      lender: null,
      startDate: '2020-03-15',
      startBalanceCents: 45000000,
      annualRate: '0.06',
      compoundingPerYear: 12,
      paymentCents: 250000,
      paymentFrequency: 'monthly',
      paymentAnchorDate: '2020-03-15',
      balanceCents: 39800000,
      balanceAsOf: '2026-08-31',
      offsetCents: 1000000,
      netBalanceCents: 38800000,
      excessOffsetCents: 0,
      offsetAccountIds: [idOf.offsetAccount()],
      repaymentsCents: 18650000,
      principalPaidCents: 5200000,
      interestFeesCents: 13450000,
      nextPeriodInterestCents: 194000,
      schedule: {
        periodicRatio: '0.005',
        firstPaymentDate: '2026-10-15',
        firstPeriodInterestCents: 100000,
        payments: 240,
        payoffDate: '2046-09-15',
        totalInterestCents: 20000000,
        points: [{ date: '2026-08-31', balanceCents: 38800000, interestCents: 0 }],
        flag: null,
      },
      scheduleWithoutOffset: expect.objectContaining({
        payments: 250,
        totalInterestCents: 21000000,
      }) as unknown,
      interestSavedCents: 1000000,
      monthsSaved: 10,
      imported: { paymentsPaidCents: 5200000, paymentsPaidDerived: true },
      flags: [],
      entryCount: 2,
      note: null,
      sortOrder: 1,
      origin: 'import',
      sheetRef: 'Property!D28',
    });
    expect(page.loans[1]).toMatchObject({
      name: 'Example car loan',
      propertyId: null,
      propertyName: null,
      offsetAccountIds: [],
      flags: ['no_property'],
    });
    // A loan made in the app has no workbook figure.
    t.db.update(loans).set({ sheetRef: null, origin: 'app' }).where(eq(loans.id, mortgage)).run();
    const app = buildPropertyPage(createFinanceContext(deps(propertyEngine())));
    expect(app.loans[0]!.imported).toBeNull();
  });

  it('lists the log points asOf desc, the start point last with the loan origin and no actions', () => {
    const page = buildPropertyPage(createFinanceContext(deps(propertyEngine())));
    const mortgage = idOf.loan('Example property mortgage');
    expect(page.loanEntries.map((e) => [e.asOf, e.id === null, e.start])).toEqual([
      ['2026-08-31', false, false],
      ['2026-05-31', false, false],
      ['2020-03-15', true, true],
    ]);
    expect(page.loanEntries[0]).toEqual({
      id: expect.any(Number) as number,
      start: false,
      loanId: mortgage,
      asOf: '2026-08-31',
      balanceCents: 39800000,
      paymentsCounted: 3,
      repaymentsCents: 150000,
      repaymentsTyped: true,
      principalCents: 200000,
      interestFeesCents: -50000,
      cumulativePrincipalCents: 5200000,
      cumulativeInterestFeesCents: 13450000,
      flags: ['repayments_below_principal'],
      note: null,
      origin: 'import',
      sheetRef: 'Property!D28',
    });
    expect(page.loanEntries[1]).toMatchObject({ note: 'Statement', sheetRef: null });
    expect(page.loanEntries[2]).toMatchObject({
      id: null,
      start: true,
      loanId: mortgage,
      balanceCents: 45000000,
      note: null,
      origin: 'import',
      sheetRef: null,
    });
  });

  it('maps the offset accounts, the totals, the chart and the settings slice', () => {
    const page = buildPropertyPage(createFinanceContext(deps(propertyEngine())));
    expect(page.offsetAccounts).toEqual([
      {
        id: idOf.offsetAccount(),
        name: 'Example Bank – Offset',
        balanceCents: 1000000,
        balanceAsOf: '2026-08-31',
        linkedLoanId: idOf.loan('Example property mortgage'),
      },
    ]);
    expect(page.totals).toEqual({
      purchaseCents: 50000000,
      valueCents: 60000000,
      gainCents: 10000000,
      gainRatio: '0.2',
      mortgageCents: 39800000,
      offsetCents: 1000000,
      netMortgageCents: 38800000,
      principalPaidCents: 5200000,
      interestFeesCents: 13450000,
      repaymentsCents: 18650000,
      startBalanceCents: 45000000,
      lvrRatio: '0.646666666667',
      equityCents: 21200000,
    });
    expect(page.charts.points).toHaveLength(1);
    expect(page.charts.points[0]).toMatchObject({ live: true, lvrRatio: '0.646666666667' });
    expect(page).toMatchObject({ asOf: AS_OF, lastRun: '2026-07-31' });
    expect(page.settings).toEqual({
      values: {
        'savings.includeMortgagePrincipal': null,
        'property.offsetsIncludeEmergencyFund': null,
      },
      origins: {
        'savings.includeMortgagePrincipal': null,
        'property.offsetsIncludeEmergencyFund': null,
      },
    });
  });
});

// ─── The Cash page's Stage 4 fields (§3.2, §6.6) ────────────────────────────────────────────────

describe('GET /api/cash: the Stage 4 additive fields', () => {
  it("maps an offset account's linked loan, and staticUntilStage4 is always false", () => {
    const account = idOf.offsetAccount();
    const mortgage = idOf.loan('Example property mortgage');
    t.db.insert(loanOffsetLinks).values({ accountId: account, loanId: mortgage }).run();
    const page = buildCashPage(createFinanceContext(deps(fakeEngine())));
    expect(page.staticUntilStage4).toBe(false);
    const byId = new Map(page.accounts.map((a) => [a.id, a]));
    expect(byId.get(account)!.linkedLoan).toEqual({
      id: mortgage,
      name: 'Example property mortgage',
    });
    expect(page.accounts.filter((a) => a.linkedLoan !== null)).toHaveLength(1);
  });
});
