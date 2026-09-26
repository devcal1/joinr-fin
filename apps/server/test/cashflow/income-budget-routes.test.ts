// The Side Income, Budget, Dividends and Settings routes through buildApp + inject on the generic
// seed with a FAKE engine (stage-3.md §4.2, §4.5, §3.3–3.4, §7.4 step 3): origin rules and no-op
// saves, the marker keyed on `sheet_ref`, the 409s, the dividend price auto-fill from the events
// cache, the automatic budget rows (D54) and the settings PATCH for both key classes.
import type {
  BudgetItemMutationResponse,
  DepositMutationResponse,
  DividendMutationResponse,
  IncomeStreamMutationResponse,
  SettingsPatchResponse,
  YearlyExpenseMutationResponse,
} from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  dividendEvents,
  dividends,
  incomeStreams,
  settings,
  sideIncomeDeposits,
  yearlyExpenses,
} from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { call, errorOf, hasAppDataOf, NOW, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp();
});
afterEach(async () => {
  await ctx.close();
});

const db = () => ctx.database.db;
const marker = () => readAppEditMarker(db())?.count ?? 0;

function stream(name: string) {
  return db().select().from(incomeStreams).where(eq(incomeStreams.name, name)).get()!;
}
function budgetRow(name: string) {
  return db().select().from(budgetItems).where(eq(budgetItems.name, name)).get()!;
}
function everyday() {
  return db().select().from(cashAccounts).where(eq(cashAccounts.sortOrder, 1)).get()!;
}

// ─── Side income (D57) ──────────────────────────────────────────────────────────────────────────

describe('side-income deposits', () => {
  it('creates an app deposit (201) and validates the stream, the amount and the date', async () => {
    const s1 = stream('Side income 1');
    const res = await call<DepositMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/side-income/deposits',
      payload: { streamId: s1.id, date: '2026-09-10', amountCents: -5000, note: 'Refund' },
    });
    expect(res.status).toBe(201);
    expect(res.body.deposit).toEqual({
      id: res.body.deposit.id,
      streamId: s1.id,
      streamName: 'Side income 1',
      date: '2026-09-10',
      amountCents: -5000,
      note: 'Refund',
      origin: 'app',
      sheetRef: null,
      // The fake engine has no periods.
      periodMonth: null,
      provisional: false,
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    const unknown = await call(ctx.app, {
      method: 'POST',
      url: '/api/side-income/deposits',
      payload: { streamId: 999, date: '2026-09-10', amountCents: 5, note: null },
    });
    expect(unknown.status).toBe(404);
    const zero = await call(ctx.app, {
      method: 'POST',
      url: '/api/side-income/deposits',
      payload: { streamId: s1.id, date: '2026-09-26', amountCents: 0, note: null },
    });
    expect(errorOf(zero.body).message).toBe(
      'date: must not be after tomorrow; amountCents: must not be zero',
    );
  });

  it('a no-op save keeps the workbook origin; a change makes it app; a workbook delete writes the marker', async () => {
    const d = db()
      .select()
      .from(sideIncomeDeposits)
      .where(eq(sideIncomeDeposits.depositDate, '2026-06-30'))
      .get()!;
    const body = {
      streamId: d.streamId,
      date: d.depositDate,
      amountCents: d.amountCents,
      note: '',
    };
    await call(ctx.app, { method: 'PUT', url: `/api/side-income/deposits/${d.id}`, payload: body });
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const changed = await call<DepositMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/side-income/deposits/${d.id}`,
      payload: { ...body, amountCents: 51000 },
    });
    expect(changed.body.deposit).toMatchObject({
      amountCents: 51000,
      origin: 'app',
      sheetRef: 'Side Income!G2',
    });
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/side-income/deposits/${d.id}` })).status,
    ).toBe(200);
    expect(marker()).toBe(1);
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/side-income/deposits/${d.id}` })).status,
    ).toBe(404);
  });
});

describe('side-income streams', () => {
  it('creates, renames and archives a stream; refuses to delete one with deposits (409)', async () => {
    const created = await call<IncomeStreamMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/side-income/streams',
      payload: { name: 'Consulting', archived: false },
    });
    expect(created.status).toBe(201);
    expect(created.body.stream).toEqual({
      id: created.body.stream.id,
      name: 'Consulting',
      sortOrder: 3,
      archived: false,
      origin: 'app',
      sheetRef: null,
      depositCount: 0,
      lifetimeCents: 0,
    });
    const s1 = stream('Side income 1');
    const same = await call<IncomeStreamMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/side-income/streams/${s1.id}`,
      payload: { name: 'Side income 1', archived: false },
    });
    expect(same.body.stream).toMatchObject({ origin: 'import', depositCount: 2 });
    const archived = await call<IncomeStreamMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/side-income/streams/${s1.id}`,
      payload: { name: 'Side income 1', archived: true },
    });
    expect(archived.body.stream).toMatchObject({ archived: true, origin: 'app' });
    const inUse = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/side-income/streams/${s1.id}`,
    });
    expect(inUse.status).toBe(409);
    expect(errorOf(inUse.body)).toEqual({
      code: 'STREAM_IN_USE',
      message: 'This stream has 2 deposits',
    });
    const gone = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/side-income/streams/${created.body.stream.id}`,
    });
    expect(gone.status).toBe(200);
    expect(marker()).toBe(0);
  });
});

// ─── Budget ─────────────────────────────────────────────────────────────────────────────────────

describe('budget items', () => {
  it('creates an app item linked to an account (201); 404 for an unknown account', async () => {
    const account = everyday();
    const res = await call<BudgetItemMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/budget/items',
      payload: { name: 'Gym', monthlyCents: 6000, category: 'Health', accountId: account.id },
    });
    expect(res.status).toBe(201);
    expect(res.body.row).toMatchObject({
      kind: 'item',
      name: 'Gym',
      storedMonthlyCents: 6000,
      monthlyCents: 6000,
      category: 'Health',
      accountId: account.id,
      accountName: account.name,
      accountLinked: true,
      derived: false,
      flags: [],
      sortOrder: 7,
      origin: 'app',
      sheetRef: null,
    });
    const unknown = await call(ctx.app, {
      method: 'POST',
      url: '/api/budget/items',
      payload: { name: 'Gym', monthlyCents: 6000, category: null, accountId: 999 },
    });
    expect(unknown.status).toBe(404);
  });

  it('a no-op save keeps the origin and flags; a change clears them; "no account" keeps a stale name', async () => {
    const phone = budgetRow('Phone');
    const body = { name: 'Phone', monthlyCents: 5000, category: 'Bills', accountId: null };
    await call(ctx.app, { method: 'PUT', url: `/api/budget/items/${phone.id}`, payload: body });
    expect(budgetRow('Phone')).toMatchObject({
      origin: 'import',
      reviewFlags: '["unmatched_account"]',
    });
    const res = await call<BudgetItemMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/budget/items/${phone.id}`,
      payload: { ...body, monthlyCents: 5500 },
    });
    expect(res.body.row).toMatchObject({
      monthlyCents: 5500,
      accountId: null,
      accountName: 'Example Bank – Old',
      accountLinked: false,
      flags: [],
      origin: 'app',
    });
    // Linking it sets the id and the account's name.
    const linked = await call<BudgetItemMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/budget/items/${phone.id}`,
      payload: { ...body, monthlyCents: 5500, accountId: everyday().id },
    });
    expect(linked.body.row).toMatchObject({
      accountId: everyday().id,
      accountName: everyday().name,
    });
  });

  it('refuses the automatic rows on the items routes (400) and deletes an item with the marker', async () => {
    const auto = budgetRow('Cash Savings - Automatic');
    const put = await call(ctx.app, {
      method: 'PUT',
      url: `/api/budget/items/${auto.id}`,
      payload: { name: 'X', monthlyCents: 0, category: null, accountId: null },
    });
    expect(errorOf(put.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'id: an automatic row',
    });
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/budget/items/${auto.id}` })).status,
    ).toBe(400);
    const rent = budgetRow('Rent');
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/budget/items/${rent.id}` })).status,
    ).toBe(200);
    expect(marker()).toBe(1);
  });

  it('reorders the items and the yearly row; moved rows become app', async () => {
    const [rent, groceries, phone, yearly] = [
      'Rent',
      'Groceries',
      'Phone',
      'Yearly Expenses - Automatic',
    ].map(budgetRow);
    const ids = [groceries!.id, rent!.id, phone!.id, yearly!.id];
    const res = await call(ctx.app, {
      method: 'POST',
      url: '/api/budget/items/reorder',
      payload: { ids },
    });
    expect(res).toMatchObject({ status: 200, body: { ids } });
    expect(budgetRow('Groceries')).toMatchObject({ sortOrder: 1, origin: 'app' });
    expect(budgetRow('Rent')).toMatchObject({ sortOrder: 2, origin: 'app' });
    expect(budgetRow('Phone')).toMatchObject({ sortOrder: 3, origin: 'import' });
    expect(budgetRow('Investment Savings - Automatic')).toMatchObject({
      sortOrder: 5,
      origin: 'import',
    });
    const missing = await call(ctx.app, {
      method: 'POST',
      url: '/api/budget/items/reorder',
      payload: { ids: [rent!.id] },
    });
    expect(errorOf(missing.body).message).toBe(
      'ids: must list every budget item and the yearly row exactly once',
    );
  });
});

describe('PUT /api/budget/auto/:kind', () => {
  it('sets the D54 amount on the investment row only; category and account on any', async () => {
    const res = await call<BudgetItemMutationResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/budget/auto/auto_invest',
      payload: { category: 'Investing', accountId: null, manualMonthlyCents: 100000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.row).toMatchObject({
      kind: 'auto_invest',
      storedMonthlyCents: 100000,
      category: 'Investing',
      origin: 'app',
    });
    // Omitted keeps the stored amount.
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/budget/auto/auto_invest',
      payload: { category: 'Investing', accountId: null },
    });
    expect(budgetRow('Investment Savings - Automatic').monthlyCents).toBe(100000);
    const cash = await call(ctx.app, {
      method: 'PUT',
      url: '/api/budget/auto/auto_cash',
      payload: { category: null, accountId: null, manualMonthlyCents: 5 },
    });
    expect(errorOf(cash.body).message).toBe(
      'manualMonthlyCents: only the investment row takes an amount',
    );
    for (const kind of ['item', 'auto_other']) {
      const res404 = await call(ctx.app, {
        method: 'PUT',
        url: `/api/budget/auto/${kind}`,
        payload: { category: null, accountId: null },
      });
      expect(res404.status, kind).toBe(404);
    }
  });

  it('creates a missing automatic row on first save', async () => {
    db().delete(budgetItems).where(eq(budgetItems.kind, 'auto_cash')).run();
    const res = await call<BudgetItemMutationResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/budget/auto/auto_cash',
      payload: { category: 'Savings', accountId: everyday().id },
    });
    expect(res.body.row).toMatchObject({
      kind: 'auto_cash',
      name: 'Cash Savings - Automatic',
      storedMonthlyCents: null,
      category: 'Savings',
      accountId: everyday().id,
      origin: 'app',
    });
  });
});

describe('yearly expenses', () => {
  it('creates, updates (no-op keeps the origin) and deletes (marker for a workbook row)', async () => {
    const created = await call<YearlyExpenseMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/budget/yearly-expenses',
      payload: { name: 'Gifts', annualCents: 60000 },
    });
    expect(created.status).toBe(201);
    expect(created.body.expense).toMatchObject({
      name: 'Gifts',
      annualCents: 60000,
      sortOrder: 3,
      origin: 'app',
    });
    const rego = db()
      .select()
      .from(yearlyExpenses)
      .where(eq(yearlyExpenses.name, 'Car registration'))
      .get()!;
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/budget/yearly-expenses/${rego.id}`,
      payload: { name: 'Car registration', annualCents: 80000 },
    });
    expect(
      db().select().from(yearlyExpenses).where(eq(yearlyExpenses.id, rego.id)).get()!.origin,
    ).toBe('import');
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/budget/yearly-expenses/${rego.id}` }))
        .status,
    ).toBe(200);
    expect(marker()).toBe(1);
    expect(
      (await call(ctx.app, { method: 'DELETE', url: '/api/budget/yearly-expenses/999' })).status,
    ).toBe(404);
  });
});

// ─── Dividends ──────────────────────────────────────────────────────────────────────────────────

describe('dividends', () => {
  const xyz = () => ctx.ids['ASX:XYZ']!;
  const cacheEvent = (exDate: string, close: string | null) =>
    db()
      .insert(dividendEvents)
      .values({
        instrumentId: xyz(),
        exDate,
        amountPerUnit: '1.2',
        currency: 'AUD',
        closeBeforeEx: close,
        closeDate: null,
        source: 'fake',
        fetchedAt: NOW.toISOString(),
      })
      .run();
  const body = (over: Record<string, unknown> = {}) => ({
    instrumentId: xyz(),
    paymentDate: '2026-09-15',
    exDate: '2026-09-01',
    reinvested: false,
    netAmountCents: 3600,
    note: null,
    ...over,
  });

  it('fills an omitted price from the events cache; a typed price is manual', async () => {
    cacheEvent('2026-09-01', '104.5');
    const filled = await call<DividendMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/dividends',
      payload: body(),
    });
    expect(filled.status).toBe(201);
    expect(filled.body.dividend).toMatchObject({
      instrumentId: xyz(),
      symbol: 'ASX:XYZ',
      ticker: 'ASX:XYZ',
      holdingKind: 'etf',
      priceAtEx: '104.5',
      priceAtExManual: false,
      financialYear: 2026,
      origin: 'app',
    });
    const typed = await call<DividendMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/dividends',
      payload: body({ priceAtEx: '103' }),
    });
    expect(typed.body.dividend).toMatchObject({ priceAtEx: '103', priceAtExManual: true });
    const none = await call<DividendMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/dividends',
      payload: body({ exDate: '2026-08-01' }),
    });
    expect(none.body.dividend).toMatchObject({ priceAtEx: null, priceAtExManual: false });
  });

  it('validates the holding and the dates', async () => {
    expect(
      (
        await call(ctx.app, {
          method: 'POST',
          url: '/api/dividends',
          payload: body({ instrumentId: 999 }),
        })
      ).status,
    ).toBe(404);
    const late = await call(ctx.app, {
      method: 'POST',
      url: '/api/dividends',
      payload: body({ exDate: '2026-09-20', netAmountCents: 0 }),
    });
    expect(errorOf(late.body).message).toBe(
      'netAmountCents: must not be zero; exDate: after the payment date',
    );
  });

  it('a no-op save keeps the row; an edit clears flags; a new holding moves the ticker and kind', async () => {
    const stored = db().select().from(dividends).where(eq(dividends.ticker, 'XYZ')).get()!;
    const same = {
      instrumentId: stored.instrumentId,
      paymentDate: stored.paymentDate,
      exDate: stored.exDate,
      reinvested: stored.reinvested,
      netAmountCents: stored.netAmountCents,
      priceAtEx: stored.priceAtEx,
      note: '',
    };
    await call(ctx.app, { method: 'PUT', url: `/api/dividends/${stored.id}`, payload: same });
    // The form echoes the stored price: no change (its flag is kept).
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const withoutPrice: Record<string, unknown> = { ...same };
    delete withoutPrice.priceAtEx;
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/dividends/${stored.id}`,
      payload: withoutPrice,
    });
    // Omitted with no cached event keeps the workbook's price on the same holding and ex-date.
    expect(db().select().from(dividends).where(eq(dividends.id, stored.id)).get()).toMatchObject({
      priceAtEx: '100',
      origin: 'import',
    });
    const abc = ctx.ids['ASX:ABC']!;
    const moved = await call<DividendMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/dividends/${stored.id}`,
      payload: { ...same, instrumentId: abc },
    });
    expect(moved.body.dividend).toMatchObject({
      instrumentId: abc,
      ticker: 'ASX:ABC',
      holdingKind: 'stock',
      // The echoed price keeps the stored row's flag.
      priceAtEx: '100',
      priceAtExManual: false,
      origin: 'app',
    });
    const unlinked = db().select().from(dividends).where(eq(dividends.ticker, 'ZZZ')).get()!;
    const linked = await call<DividendMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/dividends/${unlinked.id}`,
      payload: { ...same, instrumentId: xyz(), paymentDate: unlinked.paymentDate, exDate: null },
    });
    expect(linked.body.dividend).toMatchObject({ flags: [], ticker: 'ASX:XYZ', origin: 'app' });
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/dividends/${unlinked.id}` })).status,
    ).toBe(200);
    expect(marker()).toBe(1);
  });
});

// ─── Settings (§3.3) ────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/settings', () => {
  const patch = (values: Record<string, unknown>) =>
    call<SettingsPatchResponse>(ctx.app, {
      method: 'PATCH',
      url: '/api/settings',
      payload: { values },
    });
  const row = (key: string) => db().select().from(settings).where(eq(settings.key, key)).get();

  it('an app-only key never blocks a re-import', async () => {
    const res = await patch({ 'savings.yearBasis': 'calendar' });
    expect(res.status).toBe(200);
    expect(res.body.hasAppData).toBe(false);
    expect(res.body.settings.values['savings.yearBasis']).toBe('calendar');
    expect(res.body.settings.origins['savings.yearBasis']).toBe('app');
    // The Cash page's slice.
    expect(Object.keys(res.body.settings.values)).toEqual([
      'goals.cashSavingsTargetCents',
      'goals.eoyCashGoalCents',
      'goals.houseDepositInvestmentShare',
      'savings.includeMortgagePrincipal',
      'savings.yearBasis',
      'property.offsetsIncludeEmergencyFund',
    ]);
  });

  it('a workbook key edit is app data; an unchanged value writes nothing', async () => {
    const same = await patch({
      'pay.frequency': 'fortnightly',
      'budget.emergencyFundOverrideCents': null,
    });
    expect(same.body.hasAppData).toBe(false);
    expect(row('pay.frequency')?.origin).toBe('import');
    expect(row('budget.emergencyFundOverrideCents')).toBeUndefined();
    const changed = await patch({ 'budget.includeSideIncome': true });
    expect(changed.body.hasAppData).toBe(true);
    expect(row('budget.includeSideIncome')).toMatchObject({
      valueJson: 'true',
      origin: 'app',
      updatedAt: NOW.toISOString(),
    });
    // The Budget page's slice.
    expect(changed.body.settings.values['budget.includeSideIncome']).toBe(true);
    expect(changed.body.settings.values['pay.frequency']).toBe('fortnightly');
    const cleared = await patch({ 'pay.dayOfMonth': null });
    expect(row('pay.dayOfMonth')).toMatchObject({ valueJson: 'null', origin: 'app' });
    expect(cleared.body.settings.values['pay.dayOfMonth']).toBeNull();
  });

  it('refuses keys it does not edit and invalid values', async () => {
    const res = await patch({ 'allocation.etf': '0.5', 'pay.dayOfMonth': 40 });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).message).toContain('values.allocation.etf: not editable here');
    expect(errorOf(res.body).message).toContain('values.pay.dayOfMonth');
  });

  it('refuses values outside the write bounds and stores nothing (a page could no longer load)', async () => {
    const share = 'goals.houseDepositInvestmentShare';
    const shareBefore = row(share);
    const payBefore = row('pay.netPayCents');
    const outOfRange = await patch({ [share]: '25' });
    expect(outOfRange.status).toBe(400);
    expect(errorOf(outOfRange.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(outOfRange.body).message).toContain(`values.${share}: must be between 0 and 1`);
    const huge = await patch({ 'pay.netPayCents': Number.MAX_SAFE_INTEGER });
    expect(huge.status).toBe(400);
    expect(errorOf(huge.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(huge.body).message).toContain('values.pay.netPayCents: is too large');
    const months = await patch({ 'budget.emergencyFundMonths': 1201 });
    expect(months.status).toBe(400);
    expect(errorOf(months.body).message).toContain(
      'values.budget.emergencyFundMonths: must be at most 1200',
    );
    expect(row(share)).toEqual(shareBefore);
    expect(row('pay.netPayCents')).toEqual(payBefore);
    expect(marker()).toBe(0);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});
