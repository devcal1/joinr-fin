// The per-loan lines under Mortgages on `GET /api/net-worth` (stage-5.md §6.3 item 4, §2.6 step 2;
// Fixer round 1, SPEC-1 / CODE-2 / STYLE-2) with the REAL engine on the generic seed: the loans with
// a property only, in page order, each loan's linked offsets capped at its balance, the gross lines
// adding up to the Mortgages row, and [] when they would contradict the table. Generic values only.
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  engine as realEngine,
  ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import type { NetWorthPageResponse } from '@joinr/schema';
import { cashAccounts, loanBalanceEntries, loanOffsetLinks, loans } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceContext } from '../../src/cashflow/context';
import { mortgageLoanLines } from '../../src/history/pages';
import { call, fakeMarket, NOW, startApp, type TestApp } from './helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED;

describe.skipIf(!GATED)('Mortgages: the per-loan lines (§6.3 item 4)', { timeout: 60_000 }, () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await startApp({ engine: realEngine });
  });
  afterEach(async () => {
    await ctx.close();
  });

  const page = async () =>
    (await call<NetWorthPageResponse>(ctx.app, { method: 'GET', url: '/api/net-worth' })).body;

  /** A second loan on the seed's property with a small balance, the offset account linked to it. */
  function addSecondMortgage(): void {
    const db = ctx.database.db;
    const first = db.select().from(loans).where(eq(loans.name, 'Example property mortgage')).get()!;
    const loanId = db
      .insert(loans)
      .values({
        propertyId: first.propertyId,
        name: 'Example second mortgage',
        startDate: '2025-01-15',
        interestPeriodsPerYear: 12,
        annualRate: '0.06',
        paymentCents: 20000,
        paymentFrequency: 'monthly',
        startBalanceCents: 600000,
        currentBalanceCents: 500000,
        balanceAsOf: '2026-08-31',
        sortOrder: 3,
        origin: 'app',
        sheetRef: null,
      })
      .returning({ id: loans.id })
      .get().id;
    db.insert(loanBalanceEntries)
      .values({
        loanId,
        asOf: '2026-08-31',
        balanceCents: 500000,
        repaymentsCents: null,
        note: null,
        origin: 'app',
        sheetRef: null,
      })
      .run();
    const offset = db.select().from(cashAccounts).where(eq(cashAccounts.isOffset, true)).get()!;
    db.insert(loanOffsetLinks)
      .values({ accountId: offset.id, loanId, origin: 'app', sheetRef: null })
      .run();
  }

  it('lists the loans with a property, each offset capped at its balance, adding up to the row', async () => {
    addSecondMortgage();
    const body = await page();
    const mortgages = body.liabilities.find((l) => l.key === 'mortgages')!;
    const lines = body.mortgageLoans!;
    // The car loan has no property: it counts nowhere (D2), so it has no line.
    expect(lines.map((l) => l.name)).toEqual([
      'Example property mortgage',
      'Example second mortgage',
    ]);
    expect(lines.every((l) => l.propertyName === 'Example property')).toBe(true);
    const second = lines[1]!;
    // The linked offset account holds more than this loan's balance: capped per loan.
    expect(second).toMatchObject({ grossCents: 500000, offsetCents: 500000, balanceCents: 0 });
    expect(lines[0]!.offsetCents).toBe(0);
    for (const l of lines) expect(l.balanceCents).toBe(l.grossCents - l.offsetCents);
    expect(lines.reduce((s, l) => s + l.grossCents, 0)).toBe(mortgages.grossCents);
  });

  it('one mortgage and no link: one line with no offset', async () => {
    const body = await page();
    const mortgages = body.liabilities.find((l) => l.key === 'mortgages')!;
    expect(body.mortgageLoans).toHaveLength(1);
    expect(body.mortgageLoans![0]).toMatchObject({
      name: 'Example property mortgage',
      grossCents: mortgages.grossCents,
      offsetCents: 0,
      balanceCents: mortgages.grossCents,
    });
  });

  it('lines that would contradict the Mortgages row are not sent', () => {
    const finance = createFinanceContext({
      database: ctx.database,
      market: fakeMarket(),
      engine: realEngine,
      now: () => NOW,
    });
    const lines = mortgageLoanLines(finance, 0);
    expect(lines).toEqual([]);
    const gross = mortgageLoanLines(finance, 39800000);
    expect(gross.map((l) => l.grossCents)).toEqual([39800000]);
  });
});
