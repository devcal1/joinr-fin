// The Property routes through buildApp + inject on the generic seed with a structural FAKE engine
// (stage-4.md §4.2, §4.5 steps 3, 7 and 8, §3.4, §7.4 step 3): properties and valuations (the
// denormalised value, PROPERTY_HAS_LOAN, LAST_BALANCE_ENTRY, the marker), loans (one stored entry
// at create, no start entry; a changed repayment writes nothing else), the D66 balance log (typed
// repayments: omitted keeps, null clears), the D67 offset links (replaced as a set, an account
// moves between loans, only offset accounts) and the Cash page's Offset flag removing a link.
// Generic values only.
import type {
  LoanBalancesResponse,
  LoanMutationResponse,
  LoanOffsetsResponse,
  PropertyMutationResponse,
  PropertyPageResponse,
  ValuationsResponse,
} from '@joinr/schema';
import {
  cashAccounts,
  loanBalanceEntries,
  loanOffsetLinks,
  loans,
  properties,
  propertyValuations,
} from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { importLock } from '../../src/routes/import';
import { assetsFakeEngine, call, errorOf, hasAppDataOf, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp({ engine: assetsFakeEngine() });
});
afterEach(async () => {
  await ctx.close();
});

const db = () => ctx.database.db;
const property = () => db().select().from(properties).get()!;
const loan = (name = 'Example property mortgage') =>
  db().select().from(loans).where(eq(loans.name, name)).get()!;
const offsetAccount = () =>
  db().select().from(cashAccounts).where(eq(cashAccounts.isOffset, true)).get()!;
const valuationsOf = (id: number) =>
  db()
    .select()
    .from(propertyValuations)
    .where(eq(propertyValuations.propertyId, id))
    .orderBy(propertyValuations.asOf)
    .all();
const entriesOf = (id: number) =>
  db()
    .select()
    .from(loanBalanceEntries)
    .where(eq(loanBalanceEntries.loanId, id))
    .orderBy(loanBalanceEntries.asOf)
    .all();
const links = () => db().select().from(loanOffsetLinks).all();

function propertyBody(over: Record<string, unknown> = {}) {
  const p = property();
  return {
    name: p.name,
    purchaseDate: p.purchaseDate,
    isPrimaryResidence: p.isPrimaryResidence,
    purchaseValueCents: p.purchaseValueCents,
    netRentToDateCents: p.netRentToDateCents,
    note: p.note,
    ...over,
  };
}

function loanBody(over: Record<string, unknown> = {}) {
  const l = loan();
  return {
    propertyId: l.propertyId,
    name: l.name,
    lender: l.lender,
    startDate: l.startDate,
    startBalanceCents: l.startBalanceCents,
    annualRate: l.annualRate,
    compoundingPerYear: l.interestPeriodsPerYear,
    paymentCents: l.paymentCents,
    paymentFrequency: l.paymentFrequency,
    note: l.note,
    ...over,
  };
}

async function newOffsetAccount(name = 'Second offset'): Promise<number> {
  const res = await call<{ account: { id: number } }>(ctx.app, {
    method: 'POST',
    url: '/api/cash/accounts',
    payload: {
      name,
      kind: 'bank',
      isOffset: true,
      note: null,
      openingBalanceCents: 250000,
      asOf: '2026-09-20',
    },
  });
  expect(res.status).toBe(201);
  return res.body.account.id;
}

describe('GET /api/property', () => {
  it('answers the page with no-store', async () => {
    const res = await call<PropertyPageResponse>(ctx.app, { method: 'GET', url: '/api/property' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.properties.map((p) => p.name)).toEqual(['Example property']);
    expect(res.body.loans.map((l) => l.name)).toEqual([
      'Example property mortgage',
      'Example car loan',
    ]);
    expect(res.body.offsetAccounts.map((a) => a.linkedLoanId)).toEqual([null]);
  });
});

describe('properties', () => {
  it('creates a property with its opening valuation (both app)', async () => {
    const res = await call<PropertyMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/property/properties',
      payload: {
        name: 'Example unit',
        purchaseDate: '2024-05-01',
        isPrimaryResidence: false,
        purchaseValueCents: 40000000,
        netRentToDateCents: -150000,
        note: null,
        valueCents: 42000000,
        asOf: '2026-09-01',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.property).toMatchObject({
      name: 'Example unit',
      isPrimaryResidence: false,
      purchaseValueCents: 40000000,
      valueCents: 42000000,
      valuationDate: '2026-09-01',
      netRentToDateCents: -150000,
      valuationCount: 1,
      sortOrder: 2,
      origin: 'app',
      sheetRef: null,
    });
    expect(valuationsOf(res.body.property.id)).toEqual([
      expect.objectContaining({ asOf: '2026-09-01', valueCents: 42000000, origin: 'app' }),
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('a no-op update keeps the origin; a change makes it app', async () => {
    const p = property();
    const same = await call<PropertyMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/properties/${p.id}`,
      payload: propertyBody({ name: ` ${p.name} `, note: '' }),
    });
    expect(same.status).toBe(200);
    expect(same.body.property.origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const res = await call<PropertyMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/properties/${p.id}`,
      payload: propertyBody({ netRentToDateCents: 500000 }),
    });
    expect(res.body.property).toMatchObject({ netRentToDateCents: 500000, origin: 'app' });
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/properties/999',
      payload: propertyBody(),
    });
    expect(missing.status).toBe(404);
  });

  it('409 PROPERTY_HAS_LOAN while a loan references it; then cascades its valuations', async () => {
    const p = property();
    const busy = await call(ctx.app, { method: 'DELETE', url: `/api/property/properties/${p.id}` });
    expect(busy.status).toBe(409);
    expect(errorOf(busy.body)).toEqual({
      code: 'PROPERTY_HAS_LOAN',
      message: 'This property has 1 loan; delete it first',
    });
    await call(ctx.app, { method: 'DELETE', url: `/api/property/loans/${loan().id}` });
    const ok = await call(ctx.app, { method: 'DELETE', url: `/api/property/properties/${p.id}` });
    expect(ok.body).toEqual({ id: p.id });
    expect(valuationsOf(p.id)).toEqual([]);
    // Both were workbook rows.
    expect(readAppEditMarker(db())?.count).toBe(2);
  });
});

describe('valuations', () => {
  it('upserts by (property, asOf), follows the latest entry and keeps the last one (409)', async () => {
    const p = property();
    const same = await call<ValuationsResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/property/valuations',
      payload: { asOf: '2026-08-31', entries: [{ propertyId: p.id, valueCents: 60000000 }] },
    });
    expect(same.status).toBe(200);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const res = await call<ValuationsResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/property/valuations',
      payload: {
        asOf: '2026-09-15',
        entries: [{ propertyId: p.id, valueCents: 61000000, note: 'Agent appraisal' }],
      },
    });
    expect(res.body.properties[0]).toMatchObject({
      valueCents: 61000000,
      valuationDate: '2026-09-15',
      valuationCount: 3,
    });
    expect(property()).toMatchObject({
      currentValueCents: 61000000,
      valuationDate: '2026-09-15',
      origin: 'import',
    });
    const [first, second, third] = valuationsOf(p.id) as [
      ReturnType<typeof valuationsOf>[0],
      ReturnType<typeof valuationsOf>[0],
      ReturnType<typeof valuationsOf>[0],
    ];
    // Deleting the latest recomputes the copy; a workbook entry writes the marker.
    const del = await call<PropertyMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/property/valuation-entries/${third.id}`,
    });
    expect(del.body.property).toMatchObject({ valueCents: 60000000, valuationCount: 2 });
    expect(readAppEditMarker(db())).toBeNull();
    await call(ctx.app, { method: 'DELETE', url: `/api/property/valuation-entries/${second.id}` });
    expect(property()).toMatchObject({ currentValueCents: 58000000, valuationDate: '2025-08-31' });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const last = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/property/valuation-entries/${first.id}`,
    });
    expect(errorOf(last.body)).toEqual({
      code: 'LAST_BALANCE_ENTRY',
      message: 'A property keeps at least one valuation',
    });
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/valuations',
      payload: { asOf: '2026-09-15', entries: [{ propertyId: 999, valueCents: 1 }] },
    });
    expect(missing.status).toBe(404);
  });
});

describe('loans (D66)', () => {
  it('a create writes the loan and one stored entry (no start entry)', async () => {
    const res = await call<LoanMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/property/loans',
      payload: {
        propertyId: property().id,
        name: 'Top-up loan',
        lender: 'Example Bank',
        startDate: '2026-01-15',
        startBalanceCents: 5000000,
        annualRate: '0.065',
        compoundingPerYear: 365,
        paymentCents: 40000,
        paymentFrequency: 'fortnightly',
        note: null,
        balanceCents: 4800000,
        asOf: '2026-09-15',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.loan).toMatchObject({
      name: 'Top-up loan',
      lender: 'Example Bank',
      propertyName: 'Example property',
      startDate: '2026-01-15',
      startBalanceCents: 5000000,
      annualRate: '0.065',
      compoundingPerYear: 365,
      paymentCents: 40000,
      paymentFrequency: 'fortnightly',
      balanceCents: 4800000,
      balanceAsOf: '2026-09-15',
      entryCount: 1,
      imported: null,
      origin: 'app',
      sheetRef: null,
    });
    expect(entriesOf(res.body.loan.id)).toEqual([
      expect.objectContaining({
        asOf: '2026-09-15',
        balanceCents: 4800000,
        repaymentsCents: null,
        origin: 'app',
      }),
    ]);
    expect(loan('Top-up loan')).toMatchObject({
      currentBalanceCents: 4800000,
      balanceAsOf: '2026-09-15',
      paymentsPaidCents: null,
    });
    const noProperty = await call(ctx.app, {
      method: 'POST',
      url: '/api/property/loans',
      payload: { ...loanBody({ propertyId: 999 }), balanceCents: 1, asOf: '2026-09-15' },
    });
    expect(noProperty.status).toBe(404);
  });

  it('an update with a new repayment writes only the loan (the log re-derives, D76)', async () => {
    const l = loan();
    const before = entriesOf(l.id);
    const same = await call<LoanMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${l.id}`,
      payload: loanBody({ annualRate: '0.060' }),
    });
    expect(same.body.loan.origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const res = await call<LoanMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${l.id}`,
      payload: loanBody({ paymentCents: 260000, paymentFrequency: 'fortnightly' }),
    });
    expect(res.body.loan).toMatchObject({
      paymentCents: 260000,
      paymentFrequency: 'fortnightly',
      origin: 'app',
    });
    expect(entriesOf(l.id)).toEqual(before);
    const badRate = await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${l.id}`,
      payload: loanBody({ compoundingPerYear: 0 }),
    });
    expect(badRate.status).toBe(400);
  });

  it('a delete cascades its entries and offset links; a workbook loan writes the marker', async () => {
    const l = loan();
    db().insert(loanOffsetLinks).values({ accountId: offsetAccount().id, loanId: l.id }).run();
    const res = await call(ctx.app, { method: 'DELETE', url: `/api/property/loans/${l.id}` });
    expect(res.body).toEqual({ id: l.id });
    expect(entriesOf(l.id)).toEqual([]);
    expect(links()).toEqual([]);
    expect(readAppEditMarker(db())?.count).toBe(1);
  });
});

describe('the loan balance log (D66)', () => {
  it('saves every loan at a shared date; repayments omitted keep, null clears; the copy follows', async () => {
    const l = loan();
    const car = loan('Example car loan');
    const res = await call<LoanBalancesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { loanId: l.id, balanceCents: 39600000, repaymentsCents: 500000, note: 'Statement' },
          { loanId: car.id, balanceCents: 1450000 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.loans.map((x) => [x.id, x.balanceCents, x.balanceAsOf])).toEqual([
      [l.id, 39600000, '2026-09-20'],
      [car.id, 1450000, '2026-09-20'],
    ]);
    expect(loan()).toMatchObject({ currentBalanceCents: 39600000, balanceAsOf: '2026-09-20' });
    const latest = () => entriesOf(l.id).at(-1)!;
    expect(latest()).toMatchObject({ repaymentsCents: 500000, note: 'Statement', origin: 'app' });
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: { asOf: '2026-09-20', entries: [{ loanId: l.id, balanceCents: 39550000 }] },
    });
    expect(latest()).toMatchObject({ balanceCents: 39550000, repaymentsCents: 500000 });
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: {
        asOf: '2026-09-20',
        entries: [{ loanId: l.id, balanceCents: 39550000, repaymentsCents: null }],
      },
    });
    expect(latest().repaymentsCents).toBeNull();
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/loan-balances',
      payload: { asOf: '2026-09-20', entries: [{ loanId: 999, balanceCents: 1 }] },
    });
    expect(missing.status).toBe(404);
  });

  it('edits one entry (balance, repayments, note); a no-op keeps the origin', async () => {
    const l = loan();
    const [early] = entriesOf(l.id) as [ReturnType<typeof entriesOf>[0]];
    const same = await call<LoanMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loan-balance-entries/${early.id}`,
      payload: { balanceCents: early.balanceCents, repaymentsCents: null, note: 'Statement' },
    });
    expect(same.status).toBe(200);
    expect(entriesOf(l.id)[0]!.origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const res = await call<LoanMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loan-balance-entries/${early.id}`,
      payload: { balanceCents: early.balanceCents, repaymentsCents: 1200000, note: null },
    });
    expect(res.body.loan.id).toBe(l.id);
    expect(entriesOf(l.id)[0]).toMatchObject({
      repaymentsCents: 1200000,
      note: null,
      origin: 'app',
    });
    // The copy still follows the latest entry.
    expect(loan()).toMatchObject({ currentBalanceCents: 39800000, balanceAsOf: '2026-08-31' });
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/loan-balance-entries/999',
      payload: { balanceCents: 1, repaymentsCents: null, note: null },
    });
    expect(missing.status).toBe(404);
  });

  it('deleting an entry recomputes the copy and keeps the last one (409)', async () => {
    const l = loan();
    const [early, latest] = entriesOf(l.id) as [
      ReturnType<typeof entriesOf>[0],
      ReturnType<typeof entriesOf>[0],
    ];
    const res = await call<LoanMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/property/loan-balance-entries/${latest.id}`,
    });
    expect(res.body.loan).toMatchObject({ balanceCents: 40000000, balanceAsOf: '2026-05-31' });
    expect(loan()).toMatchObject({ currentBalanceCents: 40000000, balanceAsOf: '2026-05-31' });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const last = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/property/loan-balance-entries/${early.id}`,
    });
    expect(errorOf(last.body)).toEqual({
      code: 'LAST_BALANCE_ENTRY',
      message: 'A loan keeps at least one balance',
    });
  });
});

describe('offset links (D67)', () => {
  it('links offset accounts as a set; an account linked to another loan moves', async () => {
    const mortgage = loan();
    const car = loan('Example car loan');
    const seedOffset = offsetAccount().id;
    const second = await newOffsetAccount();
    const res = await call<LoanOffsetsResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [seedOffset, second] },
    });
    expect(res.status).toBe(200);
    expect(res.body.loan).toMatchObject({
      id: mortgage.id,
      offsetAccountIds: [seedOffset, second],
      offsetCents: 1250000,
    });
    expect(res.body.offsetAccounts.map((a) => [a.id, a.linkedLoanId])).toEqual([
      [seedOffset, mortgage.id],
      [second, mortgage.id],
    ]);
    expect(links().map((l) => l.origin)).toEqual(['app', 'app']);
    // Move one account to the car loan: the mortgage keeps the other.
    const moved = await call<LoanOffsetsResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${car.id}/offsets`,
      payload: { accountIds: [second] },
    });
    expect(moved.body.loan.offsetAccountIds).toEqual([second]);
    expect(moved.body.offsetAccounts.map((a) => a.linkedLoanId)).toEqual([mortgage.id, car.id]);
    // An empty list unlinks everything on that loan.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [] },
    });
    expect(links().map((l) => [l.accountId, l.loanId])).toEqual([[second, car.id]]);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('refuses an account that is not an offset (400), repeats (400) and an unknown loan (404)', async () => {
    const mortgage = loan();
    const everyday = db()
      .select()
      .from(cashAccounts)
      .where(eq(cashAccounts.isOffset, false))
      .get()!;
    const notOffset = await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [offsetAccount().id, everyday.id] },
    });
    expect(notOffset.status).toBe(400);
    expect(errorOf(notOffset.body).message).toBe(
      `accountIds: ${everyday.id} is not an offset account`,
    );
    expect(links()).toEqual([]);
    const twice = await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [offsetAccount().id, offsetAccount().id] },
    });
    expect(errorOf(twice.body).message).toBe('accountIds: an account appears twice');
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/property/loans/999/offsets',
      payload: { accountIds: [] },
    });
    expect(missing.status).toBe(404);
  });

  it("turning an account's Offset flag off on the Cash page removes its link (same transaction)", async () => {
    const mortgage = loan();
    const account = offsetAccount();
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [account.id] },
    });
    // A rename alone keeps the link.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${account.id}`,
      payload: { name: 'Renamed offset', kind: account.kind, isOffset: true, note: null },
    });
    expect(links()).toHaveLength(1);
    const res = await call(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${account.id}`,
      payload: { name: 'Renamed offset', kind: account.kind, isOffset: false, note: null },
    });
    expect(res.status).toBe(200);
    expect(links()).toEqual([]);
    const page = await call<PropertyPageResponse>(ctx.app, { method: 'GET', url: '/api/property' });
    expect(page.body.offsetAccounts).toEqual([]);
    expect(page.body.loans[0]!.offsetAccountIds).toEqual([]);
  });

  it('deleting a linked cash account removes its link (cascade)', async () => {
    const mortgage = loan();
    const account = await newOffsetAccount('Throwaway offset');
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/property/loans/${mortgage.id}/offsets`,
      payload: { accountIds: [account] },
    });
    await call(ctx.app, { method: 'DELETE', url: `/api/cash/accounts/${account}` });
    expect(links()).toEqual([]);
  });
});

describe('the import lock (§4.2)', () => {
  it('answers 409 IMPORT_IN_PROGRESS before anything else', async () => {
    importLock.tryAcquire();
    try {
      for (const [method, url] of [
        ['POST', '/api/property/properties'],
        ['PUT', '/api/property/properties/x'],
        ['DELETE', '/api/property/properties/1'],
        ['PUT', '/api/property/valuations'],
        ['DELETE', '/api/property/valuation-entries/1'],
        ['POST', '/api/property/loans'],
        ['PUT', '/api/property/loans/1'],
        ['DELETE', '/api/property/loans/1'],
        ['PUT', '/api/property/loan-balances'],
        ['PUT', '/api/property/loan-balance-entries/1'],
        ['DELETE', '/api/property/loan-balance-entries/1'],
        ['PUT', '/api/property/loans/1/offsets'],
      ] as const) {
        const res = await call(ctx.app, { method, url, payload: {} });
        expect(res.status, `${method} ${url}`).toBe(409);
        expect(errorOf(res.body).code).toBe('IMPORT_IN_PROGRESS');
      }
    } finally {
      importLock.release();
    }
  });
});
