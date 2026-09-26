// D34 for the Stage 4 entities (stage-4.md §3.4, §4.5 "Cross-cutting", §7.4 step 4): `hasAppData`
// is true when a re-import would undo or lose something entered in the app. Every import-owned
// Stage 4 row made in the app counts (a sale and an offset link included); the overlays (SG
// statements), the app-only settings, the market series history and the SG-fund flag alone never
// count. Direct DB writes plus the flag-only route; generic values only.
import {
  cashAccounts,
  loanBalanceEntries,
  loanOffsetLinks,
  loans,
  marketQuoteHistory,
  otherAssetPrices,
  otherAssets,
  otherAssetSales,
  properties,
  propertyValuations,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
} from '@joinr/schema/db';
import { createTestDb, seedGenericData, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasAppData } from '../../src/db/queries/domain';
import { NOW } from '../investments/helpers';
import { assetsFakeEngine, call, hasAppDataOf, startApp } from './helpers';

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  seedGenericData(t.db, { now: NOW });
});
afterEach(() => t.close());

const first = {
  asset: () => t.db.select().from(otherAssets).get()!.id,
  fund: () => t.db.select().from(superFunds).get()!.id,
  property: () => t.db.select().from(properties).get()!.id,
  loan: () => t.db.select().from(loans).get()!.id,
  offsetAccount: () =>
    t.db.select().from(cashAccounts).where(eq(cashAccounts.isOffset, true)).get()!.id,
};

function setting(key: string, value: unknown): void {
  t.sqlite
    .prepare(`INSERT INTO settings (key, value_json, updated_at, origin) VALUES (?, ?, ?, 'app')`)
    .run(key, JSON.stringify(value), NOW.toISOString());
}

describe('hasAppData: never counted (overlays, caches, app-only settings)', () => {
  it('is false on the seed', () => {
    expect(hasAppData(t.db)).toBe(false);
  });

  it('an SG statement (overlay) written origin app', () => {
    t.db
      .insert(superSgOverrides)
      .values({ periodMonth: '2026-08', grossCents: 80000, origin: 'app' })
      .run();
    expect(hasAppData(t.db)).toBe(false);
  });

  it('the market series history', () => {
    t.db
      .insert(marketQuoteHistory)
      .values({
        seriesId: 'XAG_AUD_OZ',
        date: '2026-09-20',
        value: '50',
        source: 'fake',
        fetchedAt: NOW.toISOString(),
      })
      .run();
    expect(hasAppData(t.db)).toBe(false);
  });

  it('every Stage 4 app-only setting (the cap FY included)', () => {
    setting('otherAssets.stalePriceDays', 30);
    setting('super.sgRate', '0.125');
    setting('super.contributionsTaxRate', '0.15');
    setting('super.concessionalCapCents', 3000000);
    setting('super.concessionalCapFy', 2026);
    setting('super.importedContributionType', 'after_tax');
    expect(hasAppData(t.db)).toBe(false);
  });
});

describe('hasAppData: every import-owned Stage 4 entity made in the app counts', () => {
  const cases: [string, () => void][] = [
    [
      'an other-asset price entry',
      () =>
        t.db
          .insert(otherAssetPrices)
          .values({
            otherAssetId: first.asset(),
            asOf: '2026-09-20',
            unitPrice: '1',
            origin: 'app',
          })
          .run(),
    ],
    [
      'a sale',
      () =>
        t.db
          .insert(otherAssetSales)
          .values({
            otherAssetId: first.asset(),
            saleDate: '2026-09-20',
            units: '0.1',
            proceedsCents: 100,
            origin: 'app',
          })
          .run(),
    ],
    [
      'a super balance entry',
      () =>
        t.db
          .insert(superBalanceEntries)
          .values({ fundId: first.fund(), asOf: '2026-09-20', balanceCents: 1, origin: 'app' })
          .run(),
    ],
    [
      'a typed contribution',
      () =>
        t.db
          .insert(superEntries)
          .values({
            periodMonth: '2026-09',
            kind: 'salary_sacrifice',
            entryDate: '2026-09-20',
            amountCents: 100,
            origin: 'app',
          })
          .run(),
    ],
    [
      'a property valuation',
      () =>
        t.db
          .insert(propertyValuations)
          .values({
            propertyId: first.property(),
            asOf: '2026-09-20',
            valueCents: 1,
            origin: 'app',
          })
          .run(),
    ],
    [
      'a loan balance entry',
      () =>
        t.db
          .insert(loanBalanceEntries)
          .values({ loanId: first.loan(), asOf: '2026-09-20', balanceCents: 1, origin: 'app' })
          .run(),
    ],
    [
      'an offset link',
      () =>
        t.db
          .insert(loanOffsetLinks)
          .values({ accountId: first.offsetAccount(), loanId: first.loan(), origin: 'app' })
          .run(),
    ],
    [
      'an app other asset',
      () =>
        t.db
          .insert(otherAssets)
          .values({ description: 'Sealed box', units: '1', sortOrder: 9, origin: 'app' })
          .run(),
    ],
    [
      'an app super fund',
      () =>
        t.db
          .insert(superFunds)
          .values({ name: 'Second fund', balanceCents: 0, sortOrder: 9, origin: 'app' })
          .run(),
    ],
    [
      'an app property',
      () =>
        t.db.insert(properties).values({ name: 'Example unit', sortOrder: 9, origin: 'app' }).run(),
    ],
    [
      'an app loan',
      () =>
        t.db
          .insert(loans)
          .values({ name: 'Top-up', currentBalanceCents: 1, sortOrder: 9, origin: 'app' })
          .run(),
    ],
    ['a workbook salary edited', () => setting('pay.grossAnnualSalaryCents', 9000000)],
    ['a workbook marginal rate edited', () => setting('tax.marginalRate', '0.3')],
  ];
  for (const [what, write] of cases) {
    it(what, () => {
      write();
      expect(hasAppData(t.db)).toBe(true);
    });
  }
});

describe('the SG-fund flag alone (§3.4, the route)', () => {
  it('keeps hasAppData false; a rename makes it true', async () => {
    const app = await startApp({ engine: assetsFakeEngine() });
    try {
      const fund = app.database.db.select().from(superFunds).get()!;
      await call(app.app, {
        method: 'PUT',
        url: `/api/super/funds/${fund.id}`,
        payload: { name: fund.name, receivesSg: false, archived: false },
      });
      await call(app.app, {
        method: 'PUT',
        url: `/api/super/funds/${fund.id}`,
        payload: { name: fund.name, receivesSg: true, archived: false },
      });
      expect(await hasAppDataOf(app.app)).toBe(false);
      await call(app.app, {
        method: 'PUT',
        url: `/api/super/funds/${fund.id}`,
        payload: { name: 'Renamed', receivesSg: true, archived: false },
      });
      expect(await hasAppDataOf(app.app)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
