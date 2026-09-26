// Integration with the REAL engine (stage-4.md §7.4 step 5), gated on ASSETS_ENGINE_IMPLEMENTED
// (with the Stage 2–3 flags): the generic seed (and the synthetic workbook once the Stage 4
// importer lands) builds the Other Assets, Super and Property pages and the Cash page; a
// create/update/delete round trip per Stage 4 entity leaves `dumpDomainTables` identical (app rows
// deleted in the app write no marker); and the provisional savings period moves by exactly a new
// contribution's net-pay cost and a new loan entry's principal. Generic values only.
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  IMPORTER_STAGE4_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  multiplyToCents,
  type CashPageResponse,
  type LoanMutationResponse,
  type OtherAssetMutationResponse,
  type OtherAssetsPageResponse,
  type PropertyMutationResponse,
  type PropertyPageResponse,
  type SavingsPeriodDto,
  type SuperContributionMutationResponse,
  type SuperFundMutationResponse,
  type SuperPageResponse,
} from '@joinr/schema';
import {
  loanBalanceEntries,
  otherAssetPrices,
  propertyValuations,
  superBalanceEntries,
} from '@joinr/schema/db';
import { dumpDomainTables, seedGenericData } from '@joinr/schema/testing';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { AS_OF, NOW } from './helpers';

const GATED = ENGINE_IMPLEMENTED && CASHFLOW_ENGINE_IMPLEMENTED && ASSETS_ENGINE_IMPLEMENTED;
const CAN_IMPORT =
  SYNTHETIC_WORKBOOK_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED;

describe.skipIf(!GATED)('assets API with the real engine', { timeout: 60_000 }, () => {
  let tempDir: string;
  let database: AppDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    const config = testConfig(join(tempDir, 'data'));
    database = openDatabase(config.dataDir);
    runMigrations(database, config.migrationsDir);
    app = await buildApp({ config, db: database, now: () => NOW });
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(database);
    await removeDir(tempDir);
  });

  type Request = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    payload?: object;
  };
  async function inject<T>(opts: Request, status = 200): Promise<T> {
    const res = await app.inject(opts);
    expect(res.statusCode, `${opts.method} ${opts.url}: ${res.body}`).toBe(status);
    return res.json<T>();
  }
  const get = <T>(url: string) => inject<T>({ method: 'GET', url });

  async function pages() {
    return {
      other: await get<OtherAssetsPageResponse>('/api/other-assets'),
      sup: await get<SuperPageResponse>('/api/super'),
      property: await get<PropertyPageResponse>('/api/property'),
      cash: await get<CashPageResponse>('/api/cash'),
    };
  }

  const provisional = (cash: CashPageResponse): SavingsPeriodDto =>
    cash.periods.find((p) => p.status === 'provisional')!;

  it('builds the three pages and the Cash page on the generic seed', async () => {
    seedGenericData(database.db, { now: NOW });
    const { other, sup, property, cash } = await pages();

    // Other assets: the seed's watch (hand-priced) and bar (bullion at the seed's stored silver
    // spot, which is not fresh: stale).
    expect(other.asOf).toBe(AS_OF);
    expect(other.assumedDate).toBe('2026-05-31');
    expect(other.assets.map((a) => a.description)).toEqual(['Example watch', 'Silver bar']);
    expect(other.assets[0]).toMatchObject({
      priceStatus: 'manual',
      unitPrice: '1800',
      valueCents: 180000,
      costCents: 150000,
      gainCents: 30000,
    });
    const silver = other.spot[0]!;
    expect(silver.metal).toBe('silver');
    expect(silver.audPerOz).not.toBeNull();
    const bar = other.assets[1]!;
    // Spot × 1 oz per unit (the engine keeps 12 significant digits).
    expect(Math.abs(Number(bar.unitPriceAud) / Number(silver.audPerOz) - 1)).toBeLessThan(1e-10);
    expect(bar).toMatchObject({
      priceStatus: 'stale',
      valueCents: multiplyToCents('10', silver.audPerOz!),
      costCents: 35000,
    });
    expect(bar.flags).toContain('stale_price');
    expect(other.totals.valueCents).toBe(other.assets.reduce((s, a) => s + (a.valueCents ?? 0), 0));
    expect(other.spot.map((s) => s.metal)).toEqual(['silver', 'gold']);
    expect(other.charts.points.at(-1)).toMatchObject({
      live: true,
      valueCents: other.totals.valueCents,
    });

    // Super: one fund at its latest entry; the provisional period last-first.
    expect(sup.totalCents).toBe(5060000);
    expect(sup.funds.map((f) => [f.name, f.balanceCents, f.entryCount])).toEqual([
      ['Example Super', 5060000, 2],
    ]);
    expect(sup.periods.map((p) => p.status)).toEqual(['provisional', 'closed', 'closed', 'first']);
    expect(sup.contributions).toHaveLength(4);
    expect(sup.contributions.every((c) => c.estimate && c.kind === 'voluntary_contribution')).toBe(
      true,
    );
    // Every valuation period adds up: change − SG − yours − transfers = gain.
    for (const p of sup.periods) {
      if (p.gainCents === null || p.changeCents === null || p.gainFlows === null) continue;
      expect(
        p.changeCents -
          p.gainFlows.sgFundCents -
          p.gainFlows.memberFundCents -
          p.gainFlows.transferInCents,
      ).toBe(p.gainCents);
    }
    expect(sup.capYears.map((y) => y.financialYear)).toEqual([2026, 2025]);
    expect(sup.notes.map((n) => n.periodMonth)).toEqual(['2026-06']);

    // Property: the seed's property and mortgage; the car loan has no property.
    expect(property.properties[0]).toMatchObject({ valueCents: 60000000, valuationCount: 2 });
    const mortgage = property.loans[0]!;
    expect(mortgage).toMatchObject({
      name: 'Example property mortgage',
      balanceCents: 39800000,
      startBalanceCents: 45000000,
      principalPaidCents: 5200000,
      paymentAnchorDate: '2020-03-15',
    });
    expect(property.loans[1]!.flags).toContain('no_property');
    // The start point plus the stored entries, per loan.
    const mortgageLog = property.loanEntries.filter((e) => e.loanId === mortgage.id);
    expect(mortgageLog.map((e) => e.start)).toEqual([false, false, true]);
    expect(property.totals.mortgageCents).toBe(39800000);

    // Cash: the provisional period's parts come from the live engines.
    expect(cash.staticUntilStage4).toBe(false);
    // §2.9: the seed's offset account (10,000) is flagged Offset by the workbook (origin import)
    // and has no entry on or before the last run date, so the latest snapshot's offset figure is
    // its imported balance (the workbook already kept it out of the stored cash): nothing moved.
    expect(provisional(cash).added).toMatchObject({ superCents: 20000, offsetsCents: 0 });
    expect(
      cash.periods.filter((p) => p.status === 'closed').every((p) => p.added!.offsetsCents === 0),
    ).toBe(true);
  });

  it('a create/update/delete round trip per entity leaves the domain tables unchanged', async () => {
    seedGenericData(database.db, { now: NOW });
    const before = dumpDomainTables(database.db);
    const start = await pages();
    const watch = start.other.assets[0]!;
    const fund = start.sup.funds[0]!;
    const house = start.property.properties[0]!;
    const mortgage = start.property.loans[0]!;
    const offset = start.property.offsetAccounts[0]!;

    // An other asset with a sale and a second price.
    const asset = await inject<OtherAssetMutationResponse>(
      {
        method: 'POST',
        url: '/api/other-assets',
        payload: {
          description: 'Sealed box',
          url: '',
          note: 'e2e-temp',
          purchaseDate: '2025-06-01',
          units: '3',
          currency: 'AUD',
          unitCost: '100',
          purchaseFxRate: null,
          priceSource: 'manual',
          metal: null,
          ozPerUnit: null,
          price: { unitPrice: '150', asOf: '2026-09-01' },
        },
      },
      201,
    );
    const id = asset.asset.id;
    await inject({
      method: 'PUT',
      url: `/api/other-assets/${id}`,
      payload: {
        description: 'Sealed box',
        url: 'https://example.com/box',
        note: 'e2e-temp',
        purchaseDate: '2025-06-01',
        units: '3',
        currency: 'AUD',
        unitCost: '110',
        purchaseFxRate: null,
        priceSource: 'manual',
        metal: null,
        ozPerUnit: null,
      },
    });
    const sold = await inject<OtherAssetMutationResponse>(
      {
        method: 'POST',
        url: `/api/other-assets/${id}/sales`,
        payload: { saleDate: '2026-09-10', units: '1', proceedsCents: 20000, note: 'e2e-temp' },
      },
      201,
    );
    expect(sold.asset).toMatchObject({ remainingUnits: '2', saleCount: 1 });
    expect(sold.asset.realisedCents).toBe(20000 - 11000);
    await inject({ method: 'DELETE', url: `/api/other-assets/${id}` });

    // A price on the seeded watch (its copy returns to its latest entry).
    await inject({
      method: 'PUT',
      url: '/api/other-assets/prices',
      payload: {
        asOf: AS_OF,
        entries: [{ assetId: watch.id, unitPrice: '1850', note: 'e2e-temp' }],
      },
    });
    const price = database.db
      .select()
      .from(otherAssetPrices)
      .where(and(eq(otherAssetPrices.otherAssetId, watch.id), eq(otherAssetPrices.asOf, AS_OF)))
      .get()!;
    await inject({ method: 'DELETE', url: `/api/other-assets/price-entries/${price.id}` });

    // A super fund with a second balance.
    const created = await inject<SuperFundMutationResponse>(
      {
        method: 'POST',
        url: '/api/super/funds',
        payload: {
          name: 'Temp fund',
          receivesSg: false,
          openingBalanceCents: 100000,
          asOf: '2026-09-01',
          openingIsRollover: false,
        },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/super/funds/${created.fund.id}`,
      payload: { name: 'Temp fund 2', receivesSg: false, archived: false },
    });
    await inject({
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: AS_OF, entries: [{ fundId: created.fund.id, balanceCents: 0 }] },
    });
    await inject({
      method: 'PUT',
      url: `/api/super/funds/${created.fund.id}`,
      payload: { name: 'Temp fund 2', receivesSg: false, archived: true },
    });
    await inject({ method: 'DELETE', url: `/api/super/funds/${created.fund.id}` });

    // A balance on the seeded fund.
    await inject({
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: AS_OF, entries: [{ fundId: fund.id, balanceCents: 5100000 }] },
    });
    const balance = database.db
      .select()
      .from(superBalanceEntries)
      .where(and(eq(superBalanceEntries.fundId, fund.id), eq(superBalanceEntries.asOf, AS_OF)))
      .get()!;
    await inject({ method: 'DELETE', url: `/api/super/balance-entries/${balance.id}` });

    // A contribution, an SG statement and an option note.
    const c = await inject<SuperContributionMutationResponse>(
      {
        method: 'POST',
        url: '/api/super/contributions',
        payload: {
          fundId: fund.id,
          date: AS_OF,
          kind: 'after_tax',
          amountCents: 10000,
          note: 'e2e-temp',
        },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/super/contributions/${c.contribution.id}`,
      payload: {
        fundId: null,
        date: AS_OF,
        kind: 'salary_sacrifice',
        amountCents: 12000,
        note: null,
      },
    });
    await inject({ method: 'DELETE', url: `/api/super/contributions/${c.contribution.id}` });
    await inject({
      method: 'PUT',
      url: '/api/super/sg/2026-09',
      payload: { grossCents: 90000, note: 'e2e-temp' },
    });
    await inject({ method: 'DELETE', url: '/api/super/sg/2026-09' });
    await inject({
      method: 'PUT',
      url: '/api/period-notes/super_option/2026-09',
      payload: { note: 'e2e-temp' },
    });
    await inject({
      method: 'PUT',
      url: '/api/period-notes/super_option/2026-09',
      payload: { note: '' },
    });

    // A property with a second valuation.
    const p = await inject<PropertyMutationResponse>(
      {
        method: 'POST',
        url: '/api/property/properties',
        payload: {
          name: 'Temp unit',
          purchaseDate: '2024-05-01',
          isPrimaryResidence: false,
          purchaseValueCents: 30000000,
          netRentToDateCents: 0,
          note: 'e2e-temp',
          valueCents: 31000000,
          asOf: '2026-09-01',
        },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/property/properties/${p.property.id}`,
      payload: {
        name: 'Temp unit',
        purchaseDate: '2024-05-01',
        isPrimaryResidence: false,
        purchaseValueCents: 30000000,
        netRentToDateCents: -5000,
        note: 'e2e-temp',
      },
    });
    await inject({
      method: 'PUT',
      url: '/api/property/valuations',
      payload: { asOf: AS_OF, entries: [{ propertyId: p.property.id, valueCents: 31500000 }] },
    });
    // A loan on it, with a second entry edited then deleted.
    const loan = await inject<LoanMutationResponse>(
      {
        method: 'POST',
        url: '/api/property/loans',
        payload: {
          propertyId: p.property.id,
          name: 'Temp loan',
          lender: null,
          startDate: '2024-05-01',
          startBalanceCents: 24000000,
          annualRate: '0.06',
          compoundingPerYear: 12,
          paymentCents: 150000,
          paymentFrequency: 'monthly',
          note: 'e2e-temp',
          balanceCents: 23500000,
          asOf: '2026-09-01',
        },
      },
      201,
    );
    expect(loan.loan.schedule).not.toBeNull();
    await inject({
      method: 'PUT',
      url: `/api/property/loans/${loan.loan.id}`,
      payload: {
        propertyId: p.property.id,
        name: 'Temp loan',
        lender: 'Example Bank',
        startDate: '2024-05-01',
        startBalanceCents: 24000000,
        annualRate: '0.061',
        compoundingPerYear: 12,
        paymentCents: 150000,
        paymentFrequency: 'fortnightly',
        note: 'e2e-temp',
      },
    });
    await inject({
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: { asOf: AS_OF, entries: [{ loanId: loan.loan.id, balanceCents: 23450000 }] },
    });
    const loanEntry = database.db
      .select()
      .from(loanBalanceEntries)
      .where(and(eq(loanBalanceEntries.loanId, loan.loan.id), eq(loanBalanceEntries.asOf, AS_OF)))
      .get()!;
    await inject({
      method: 'PUT',
      url: `/api/property/loan-balance-entries/${loanEntry.id}`,
      payload: { balanceCents: 23450000, repaymentsCents: 80000, note: 'e2e-temp' },
    });
    await inject({ method: 'DELETE', url: `/api/property/loan-balance-entries/${loanEntry.id}` });
    // The property keeps its loan (409) until the loan goes.
    const busy = await app.inject({
      method: 'DELETE',
      url: `/api/property/properties/${p.property.id}`,
    });
    expect(busy.statusCode).toBe(409);
    await inject({ method: 'DELETE', url: `/api/property/loans/${loan.loan.id}` });
    await inject({ method: 'DELETE', url: `/api/property/properties/${p.property.id}` });

    // A valuation and a loan entry on the seeded property and mortgage.
    await inject({
      method: 'PUT',
      url: '/api/property/valuations',
      payload: { asOf: AS_OF, entries: [{ propertyId: house.id, valueCents: 61000000 }] },
    });
    const valuation = database.db
      .select()
      .from(propertyValuations)
      .where(and(eq(propertyValuations.propertyId, house.id), eq(propertyValuations.asOf, AS_OF)))
      .get()!;
    await inject({ method: 'DELETE', url: `/api/property/valuation-entries/${valuation.id}` });
    await inject({
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: { asOf: AS_OF, entries: [{ loanId: mortgage.id, balanceCents: 39700000 }] },
    });
    const mortgageEntry = database.db
      .select()
      .from(loanBalanceEntries)
      .where(and(eq(loanBalanceEntries.loanId, mortgage.id), eq(loanBalanceEntries.asOf, AS_OF)))
      .get()!;
    await inject({
      method: 'DELETE',
      url: `/api/property/loan-balance-entries/${mortgageEntry.id}`,
    });

    // An offset link, then unlinked.
    const linked = await inject<{ loan: { offsetCents: number; netBalanceCents: number } }>({
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [offset.id] },
    });
    expect(linked.loan.offsetCents).toBe(offset.balanceCents);
    expect(linked.loan.netBalanceCents).toBe(mortgage.balanceCents - offset.balanceCents);
    await inject({
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [] },
    });

    expect(dumpDomainTables(database.db)).toEqual(before);
    expect(readAppEditMarker(database.db)).toBeNull();
  });

  it("moves the provisional savings period by a contribution's net-pay cost and an entry's principal", async () => {
    seedGenericData(database.db, { now: NOW });
    await inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { values: { 'tax.marginalRate': '0.3', 'savings.includeMortgagePrincipal': true } },
    });
    const before = provisional(await get<CashPageResponse>('/api/cash'));

    const c = await inject<SuperContributionMutationResponse>(
      {
        method: 'POST',
        url: '/api/super/contributions',
        payload: {
          fundId: null,
          date: AS_OF,
          kind: 'salary_sacrifice',
          amountCents: 100000,
          note: null,
        },
      },
      201,
    );
    expect(c.contribution.provisional).toBe(true);
    const netPay = c.contribution.netPayCostCents!;
    expect(netPay).toBe(70000);
    const afterContribution = provisional(await get<CashPageResponse>('/api/cash'));
    expect(afterContribution.added!.superCents).toBe(before.added!.superCents + netPay);
    expect(afterContribution.added!.mortgagePrincipalCents).toBe(
      before.added!.mortgagePrincipalCents,
    );

    const property = await get<PropertyPageResponse>('/api/property');
    const mortgage = property.loans[0]!;
    await inject({
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: {
        asOf: AS_OF,
        entries: [{ loanId: mortgage.id, balanceCents: mortgage.balanceCents - 150000 }],
      },
    });
    const afterEntry = provisional(await get<CashPageResponse>('/api/cash'));
    expect(afterEntry.added!.mortgagePrincipalCents).toBe(
      afterContribution.added!.mortgagePrincipalCents + 150000,
    );
    expect(afterEntry.added!.superCents).toBe(afterContribution.added!.superCents);
  });

  it('a body too large for safe cents is refused, and every page still answers (Fixer round 1)', async () => {
    seedGenericData(database.db, { now: NOW });
    const base = {
      description: 'Huge lot',
      url: '',
      note: null,
      purchaseDate: '2025-06-01',
      currency: 'AUD',
      purchaseFxRate: null,
      price: null,
    };
    for (const payload of [
      {
        ...base,
        units: '100000',
        unitCost: '1000000000',
        priceSource: 'manual',
        metal: null,
        ozPerUnit: null,
      },
      {
        ...base,
        units: '1000000000',
        unitCost: '1',
        priceSource: 'bullion',
        metal: 'silver',
        ozPerUnit: '1000000',
      },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/other-assets', payload });
      expect(res.statusCode, res.body).toBe(400);
    }
    for (const url of [
      '/api/other-assets',
      '/api/cash',
      '/api/budget',
      '/api/investments/stock',
      '/api/super',
      '/api/property',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("a fund added after the last recorded month changes no period's gain (§2.5 step 1)", async () => {
    seedGenericData(database.db, { now: NOW });
    // Update the seed's fund first, so the provisional period is a valuation point.
    const seeded = (await get<SuperPageResponse>('/api/super')).funds[0]!;
    await inject({
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: AS_OF, entries: [{ fundId: seeded.id, balanceCents: 5100000 }] },
    });
    const before = await get<SuperPageResponse>('/api/super');
    expect(before.periods[0]).toMatchObject({ status: 'provisional', notUpdated: false });
    // Opened with the latest balances: an older opening date would move the provisional gain's
    // measured end back to it (the oldest latest balance of the open funds, D79).
    await inject(
      {
        method: 'POST',
        url: '/api/super/funds',
        payload: {
          name: 'Temp fund',
          receivesSg: false,
          openingBalanceCents: 1000000,
          asOf: AS_OF,
          openingIsRollover: false,
        },
      },
      201,
    );
    const after = await get<SuperPageResponse>('/api/super');
    expect(after.totalCents).toBe(before.totalCents + 1000000);
    const gains = (page: SuperPageResponse) =>
      page.periods.map((p) => [p.periodMonth, p.status, p.notUpdated, p.gainCents]);
    expect(gains(after)).toEqual(gains(before));
    // Closed periods keep their returns too; the provisional return's Modified Dietz denominator
    // counts half the transfer in, so only its ratio may move.
    const closedReturns = (page: SuperPageResponse) =>
      page.periods.filter((p) => p.status !== 'provisional').map((p) => p.returnRatio);
    expect(closedReturns(after)).toEqual(closedReturns(before));
    // A backdated opening balance (not a rollover) is refused, so no closed period can move.
    const backdated = await app.inject({
      method: 'POST',
      url: '/api/super/funds',
      payload: {
        name: 'Backdated fund',
        receivesSg: false,
        openingBalanceCents: 1000000,
        asOf: '2026-07-15',
        openingIsRollover: false,
      },
    });
    expect(backdated.statusCode).toBe(400);
  });

  describe('Δ offsets in the provisional period (§2.9, D78)', () => {
    it("counts an app-created offset account's opening balance, and nothing from the imported one", async () => {
      seedGenericData(database.db, { now: NOW });
      const before = provisional(await get<CashPageResponse>('/api/cash'));
      expect(before.added!.offsetsCents).toBe(0);
      await inject(
        {
          method: 'POST',
          url: '/api/cash/accounts',
          payload: {
            name: 'New offset',
            kind: 'bank',
            isOffset: true,
            note: null,
            openingBalanceCents: 250000,
            asOf: AS_OF,
          },
        },
        201,
      );
      const after = provisional(await get<CashPageResponse>('/api/cash'));
      expect(after.added!.offsetsCents).toBe(250000);
      // An offset stays out of Total Cash (D56).
      expect(after.cashCents).toBe(before.cashCents);
    });

    it('switching Offset on for an imported account gives a Δ that cancels its Total Cash drop', async () => {
      seedGenericData(database.db, { now: NOW });
      const cashPage = await get<CashPageResponse>('/api/cash');
      const before = provisional(cashPage);
      const savings = cashPage.accounts.find((a) => a.name === 'Example Bank – Savings')!;
      expect(savings.isOffset).toBe(false);
      await inject({
        method: 'PUT',
        url: `/api/cash/accounts/${savings.id}`,
        payload: { name: savings.name, kind: savings.kind, isOffset: true, note: savings.note },
      });
      const after = provisional(await get<CashPageResponse>('/api/cash'));
      expect(after.cashCents).toBe(before.cashCents! - savings.balanceCents);
      expect(after.added!.offsetsCents).toBe(before.added!.offsetsCents + savings.balanceCents);
      expect(after.raw.savingsCents).toBe(before.raw.savingsCents);
    });

    it.skipIf(!CAN_IMPORT)(
      'reads no Δ offsets right after importing a workbook with an Offset account',
      async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/import',
          payload: Buffer.from(buildSyntheticWorkbook()),
          headers: { 'content-type': 'application/octet-stream' },
        });
        expect(res.statusCode).toBe(201);
        const cash = await get<CashPageResponse>('/api/cash');
        expect(cash.accounts.some((a) => a.isOffset)).toBe(true);
        expect(provisional(cash).added!.offsetsCents).toBe(0);
      },
    );
  });

  it.skipIf(!CAN_IMPORT)(
    'builds the three pages and the Cash page after importing the synthetic workbook',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/import',
        payload: Buffer.from(buildSyntheticWorkbook()),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(res.statusCode).toBe(201);
      const { other, sup, property, cash } = await pages();
      expect(other.assets.length).toBeGreaterThan(0);
      expect(other.assets.every((a) => a.origin === 'import')).toBe(true);
      expect(other.priceEntries.length).toBeGreaterThan(0);
      expect(other.totals.valueCents).toBe(
        other.assets.reduce((s, a) => s + (a.valueCents ?? 0), 0),
      );
      expect(sup.funds.length).toBeGreaterThan(0);
      expect(sup.balanceEntries.length).toBe(sup.funds.length);
      expect(sup.periods.length).toBeGreaterThan(0);
      expect(property.properties.length).toBeGreaterThan(0);
      expect(property.valuations.length).toBe(property.properties.length);
      expect(cash.staticUntilStage4).toBe(false);
      expect(cash.periods.length).toBeGreaterThan(0);
      const runs = await get<{ hasAppData: boolean }>('/api/import/runs');
      expect(runs.hasAppData).toBe(false);
    },
  );
});
