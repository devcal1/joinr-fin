// The Cash routes through buildApp + inject on the generic seed with a FAKE engine (stage-3.md
// §4.2, §4.5, §3.4, §7.4 step 3): accounts (the kind-only exception, no-op saves), balances (D58
// upserts and the account's latest balance), adjustments (closed periods only), period notes
// (recorded periods only), savings goals, the 404/400/409 shapes and the deletion marker.
import type {
  CashAccountMutationResponse,
  CashBalancesResponse,
  PeriodNoteResponse,
  SavingsGoalMutationResponse,
} from '@joinr/schema';
import {
  cashAccounts,
  cashBalanceEntries,
  periodNotes,
  savingsAdjustments,
  savingsGoals,
} from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppEditMarker } from '../../src/db/queries/domain';
import { call, errorOf, hasAppDataOf, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp();
});
afterEach(async () => {
  await ctx.close();
});

const db = () => ctx.database.db;

function account(name: string) {
  const row = db().select().from(cashAccounts).where(eq(cashAccounts.name, name)).get();
  if (!row) throw new Error(`no account ${name}`);
  return row;
}

const EVERYDAY = 'Example Bank – Everyday';
const LOAN = 'Loan to a friend';

function accountBody(a: ReturnType<typeof account>, over: Record<string, unknown> = {}) {
  return { name: a.name, kind: a.kind, isOffset: a.isOffset, note: a.note, ...over };
}

// ─── Accounts ───────────────────────────────────────────────────────────────────────────────────

describe('POST /api/cash/accounts', () => {
  it('creates an app account with its opening balance entry', async () => {
    const res = await call<CashAccountMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/cash/accounts',
      payload: {
        name: '  Cash at home ',
        kind: 'other',
        isOffset: false,
        note: '',
        openingBalanceCents: 20000,
        asOf: '2026-09-20',
      },
    });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.account).toMatchObject({
      name: 'Cash at home',
      kind: 'other',
      isOffset: false,
      currency: 'AUD',
      balanceCents: 20000,
      balanceAsOf: '2026-09-20',
      inTotalCash: true,
      countsForEmergencyFund: true,
      note: null,
      sortOrder: 5,
      origin: 'app',
      sheetRef: null,
      entryCount: 1,
      budgetRowCount: 0,
    });
    const entries = db()
      .select()
      .from(cashBalanceEntries)
      .where(eq(cashBalanceEntries.accountId, res.body.account.id))
      .all();
    expect(entries).toEqual([
      expect.objectContaining({ asOf: '2026-09-20', balanceCents: 20000, origin: 'app' }),
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('answers 400 with every issue', async () => {
    const res = await call(ctx.app, {
      method: 'POST',
      url: '/api/cash/accounts',
      payload: {
        name: '',
        kind: 'savings',
        isOffset: false,
        note: null,
        openingBalanceCents: 1.5,
        asOf: '2099-01-01',
      },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(res.body).message).toContain('name: is required');
    expect(errorOf(res.body).message).toContain('openingBalanceCents: must be whole cents');
    expect(errorOf(res.body).message).toContain('asOf: must not be after tomorrow');
  });
});

describe('PUT /api/cash/accounts/:id (§3.4 origin rules)', () => {
  it('a kind-only change keeps the workbook origin (re-import stays allowed)', async () => {
    const loan = account(LOAN);
    const res = await call<CashAccountMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${loan.id}`,
      payload: accountBody(loan, { kind: 'bank' }),
    });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      kind: 'bank',
      origin: 'import',
      countsForEmergencyFund: true,
    });
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('a no-op save writes nothing; a name, offset or note change makes the account app', async () => {
    const everyday = account(EVERYDAY);
    const same = await call(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${everyday.id}`,
      payload: accountBody(everyday, { name: ` ${everyday.name} `, note: '' }),
    });
    expect(same.status).toBe(200);
    expect(account(EVERYDAY).origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);

    const renamed = await call<CashAccountMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${everyday.id}`,
      payload: accountBody(everyday, { note: 'Main account', kind: 'other' }),
    });
    expect(renamed.body.account).toMatchObject({
      note: 'Main account',
      kind: 'other',
      origin: 'app',
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('answers 404 for an unknown account and 400 for a bad id', async () => {
    const body = accountBody(account(EVERYDAY));
    expect(
      (await call(ctx.app, { method: 'PUT', url: '/api/cash/accounts/999', payload: body })).status,
    ).toBe(404);
    expect(
      (await call(ctx.app, { method: 'PUT', url: '/api/cash/accounts/x', payload: body })).status,
    ).toBe(400);
  });
});

describe('DELETE /api/cash/accounts/:id', () => {
  it('refuses while budget rows use the account (409 ACCOUNT_IN_USE)', async () => {
    const res = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/cash/accounts/${account(EVERYDAY).id}`,
    });
    expect(res.status).toBe(409);
    expect(errorOf(res.body)).toEqual({
      code: 'ACCOUNT_IN_USE',
      message: 'This account is used by 2 budget rows; move them first',
    });
  });

  it('deletes a workbook account with its entries and writes the marker', async () => {
    const loan = account(LOAN);
    const res = await call(ctx.app, { method: 'DELETE', url: `/api/cash/accounts/${loan.id}` });
    expect(res).toMatchObject({ status: 200, body: { id: loan.id } });
    expect(
      db().select().from(cashBalanceEntries).where(eq(cashBalanceEntries.accountId, loan.id)).all(),
    ).toEqual([]);
    expect(readAppEditMarker(db())?.count).toBe(1);
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/cash/accounts/${loan.id}` })).status,
    ).toBe(404);
  });

  it('deletes an app account without a marker', async () => {
    const created = await call<CashAccountMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/cash/accounts',
      payload: {
        name: 'Temp',
        kind: 'bank',
        isOffset: false,
        note: null,
        openingBalanceCents: 0,
        asOf: '2026-09-24',
      },
    });
    await call(ctx.app, { method: 'DELETE', url: `/api/cash/accounts/${created.body.account.id}` });
    expect(readAppEditMarker(db())).toBeNull();
  });
});

// ─── Balances (D58) ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/cash/balances', () => {
  it('adds entries at a new date and moves each account to its latest balance', async () => {
    const everyday = account(EVERYDAY);
    const loan = account(LOAN);
    const res = await call<CashBalancesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/cash/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { accountId: loan.id, balanceCents: 250000, note: 'Repayment' },
          { accountId: everyday.id, balanceCents: 520000 },
        ],
      },
    });
    expect(res.status).toBe(200);
    // The page order (kind order, offsets last), the named accounts only.
    expect(res.body.accounts.map((a) => [a.name, a.balanceCents, a.balanceAsOf, a.origin])).toEqual(
      [
        [EVERYDAY, 520000, '2026-09-20', 'import'],
        [LOAN, 250000, '2026-09-20', 'import'],
      ],
    );
    expect(res.body.accounts[0]!.entryCount).toBe(3);
    const added = db()
      .select()
      .from(cashBalanceEntries)
      .where(eq(cashBalanceEntries.asOf, '2026-09-20'))
      .all();
    expect(added.map((e) => [e.balanceCents, e.note, e.origin])).toEqual([
      [250000, 'Repayment', 'app'],
      [520000, null, 'app'],
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('an older date only adds to the history', async () => {
    const everyday = account(EVERYDAY);
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/cash/balances',
      payload: { asOf: '2026-06-30', entries: [{ accountId: everyday.id, balanceCents: 400000 }] },
    });
    expect(account(EVERYDAY)).toMatchObject({ balanceCents: 500000, balanceAsOf: '2026-08-31' });
  });

  it('replaces the entry for the same date; an unchanged entry keeps its workbook origin', async () => {
    const everyday = account(EVERYDAY);
    const payload = (balanceCents: number) => ({
      asOf: '2026-08-31',
      entries: [{ accountId: everyday.id, balanceCents }],
    });
    await call(ctx.app, { method: 'PUT', url: '/api/cash/balances', payload: payload(500000) });
    const entryAt = () =>
      db()
        .select()
        .from(cashBalanceEntries)
        .where(
          and(
            eq(cashBalanceEntries.accountId, everyday.id),
            eq(cashBalanceEntries.asOf, '2026-08-31'),
          ),
        )
        .get()!;
    expect(entryAt().origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    await call(ctx.app, { method: 'PUT', url: '/api/cash/balances', payload: payload(510000) });
    expect(entryAt()).toMatchObject({ balanceCents: 510000, origin: 'app', sheetRef: 'Cash!A2' });
    // The account's copy follows without changing the account's origin.
    expect(account(EVERYDAY)).toMatchObject({ balanceCents: 510000, origin: 'import' });
  });

  it('answers 400 for a repeated account and 404 (writing nothing) for an unknown one', async () => {
    const everyday = account(EVERYDAY);
    const twice = await call(ctx.app, {
      method: 'PUT',
      url: '/api/cash/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { accountId: everyday.id, balanceCents: 1 },
          { accountId: everyday.id, balanceCents: 2 },
        ],
      },
    });
    expect(twice.status).toBe(400);
    expect(errorOf(twice.body).message).toBe('entries: an account appears twice');
    const before = db().select().from(cashBalanceEntries).all().length;
    const unknown = await call(ctx.app, {
      method: 'PUT',
      url: '/api/cash/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { accountId: everyday.id, balanceCents: 1 },
          { accountId: 999, balanceCents: 2 },
        ],
      },
    });
    expect(unknown.status).toBe(404);
    expect(db().select().from(cashBalanceEntries).all()).toHaveLength(before);
  });
});

describe('DELETE /api/cash/balance-entries/:id', () => {
  it('deletes a workbook entry (marker), recomputes the balance, and keeps the last one (409)', async () => {
    const everyday = account(EVERYDAY);
    const entries = db()
      .select()
      .from(cashBalanceEntries)
      .where(eq(cashBalanceEntries.accountId, everyday.id))
      .all();
    const latest = entries.find((e) => e.asOf === '2026-08-31')!;
    const res = await call<CashAccountMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/cash/balance-entries/${latest.id}`,
    });
    expect(res.status).toBe(200);
    // The earlier entry is now the latest.
    expect(res.body.account).toMatchObject({
      balanceCents: 450000,
      balanceAsOf: '2026-07-31',
      entryCount: 1,
    });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const last = entries.find((e) => e.asOf === '2026-07-31')!;
    const refused = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/cash/balance-entries/${last.id}`,
    });
    expect(refused.status).toBe(409);
    expect(errorOf(refused.body)).toEqual({
      code: 'LAST_BALANCE_ENTRY',
      message: 'An account keeps at least one balance',
    });
    expect(
      (await call(ctx.app, { method: 'DELETE', url: '/api/cash/balance-entries/999' })).status,
    ).toBe(404);
  });
});

// ─── Adjustments (D51) ──────────────────────────────────────────────────────────────────────────

describe('PUT/DELETE /api/cash/adjustments/:periodMonth', () => {
  it('saves an adjustment on a closed period (an overlay: no app data) and updates it', async () => {
    const put = (amountCents: number) =>
      call(ctx.app, {
        method: 'PUT',
        url: '/api/cash/adjustments/2026-06',
        payload: { amountCents, note: ' Car sold ' },
      });
    const res = await put(1000000);
    expect(res).toMatchObject({
      status: 200,
      body: { periodMonth: '2026-06', amountCents: 1000000, note: 'Car sold' },
    });
    await put(-5000);
    expect(db().select().from(savingsAdjustments).all()).toEqual([
      expect.objectContaining({ periodMonth: '2026-06', amountCents: -5000, note: 'Car sold' }),
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('refuses the baseline, the provisional and an unknown month (400), and a bad month', async () => {
    for (const month of ['2026-05', '2026-09', '2025-01']) {
      const res = await call(ctx.app, {
        method: 'PUT',
        url: `/api/cash/adjustments/${month}`,
        payload: { amountCents: 100, note: 'x' },
      });
      expect(res.status, month).toBe(400);
      expect(errorOf(res.body).message, month).toBe('periodMonth: not a recorded period');
    }
    const bad = await call(ctx.app, {
      method: 'PUT',
      url: '/api/cash/adjustments/2026-13',
      payload: { amountCents: 100, note: 'x' },
    });
    expect(bad.status).toBe(400);
    const zero = await call(ctx.app, {
      method: 'PUT',
      url: '/api/cash/adjustments/2026-06',
      payload: { amountCents: 0, note: '' },
    });
    expect(errorOf(zero.body).message).toBe('amountCents: must not be zero; note: is required');
  });

  it('deletes an adjustment, an orphan too; 404 when none', async () => {
    db()
      .insert(savingsAdjustments)
      .values({ periodMonth: '2025-12', amountCents: 5, note: 'Orphan' })
      .run();
    const res = await call(ctx.app, { method: 'DELETE', url: '/api/cash/adjustments/2025-12' });
    expect(res).toMatchObject({ status: 200, body: { periodMonth: '2025-12' } });
    expect(
      (await call(ctx.app, { method: 'DELETE', url: '/api/cash/adjustments/2025-12' })).status,
    ).toBe(404);
  });
});

// ─── Period notes ───────────────────────────────────────────────────────────────────────────────

describe('PUT /api/period-notes/:kind/:periodMonth', () => {
  const note = (kind: string, month: string) =>
    db()
      .select()
      .from(periodNotes)
      .where(and(eq(periodNotes.kind, kind as 'spend'), eq(periodNotes.periodMonth, month)))
      .get();

  it('adds a note on a recorded month (the baseline too), as app data', async () => {
    const res = await call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/spend/2026-05',
      payload: { note: ' Moved house ' },
    });
    expect(res.body.note).toEqual({
      periodMonth: '2026-05',
      kind: 'spend',
      note: 'Moved house',
      origin: 'app',
      sheetRef: null,
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('an unchanged workbook note keeps its origin; an edit makes it app; empty text deletes it', async () => {
    const same = await call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/spend/2026-07',
      payload: { note: 'Car service' },
    });
    expect(same.body.note).toMatchObject({ origin: 'import', sheetRef: 'Cash!Q3' });
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/side_income/2026-07',
      payload: { note: 'Two jobs' },
    });
    expect(note('side_income', '2026-07')).toMatchObject({ note: 'Two jobs', origin: 'app' });
    const removed = await call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/spend/2026-07',
      payload: { note: '' },
    });
    expect(removed.body).toEqual({ note: null });
    expect(note('spend', '2026-07')).toBeUndefined();
    expect(readAppEditMarker(db())?.count).toBe(1);
  });

  it('refuses the provisional month (400) and unknown note kinds (404)', async () => {
    const provisional = await call(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/spend/2026-09',
      payload: { note: 'x' },
    });
    expect(errorOf(provisional.body).message).toBe('periodMonth: not a recorded period');
    const other = await call(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/other/2026-07',
      payload: { note: 'x' },
    });
    expect(other.status).toBe(404);
  });

  // Stage 4 (stage-4.md §4.2, §4.5): the super investment-option log (D69).
  it('saves a super_option note on any month up to the as-of month and returns it', async () => {
    // The provisional month and a month no snapshot has are both fine for this kind.
    for (const month of ['2026-09', '2025-11']) {
      const res = await call<PeriodNoteResponse>(ctx.app, {
        method: 'PUT',
        url: `/api/period-notes/super_option/${month}`,
        payload: { note: ' Growth option ' },
      });
      expect(res.status).toBe(200);
      expect(res.body.note).toEqual({
        periodMonth: month,
        kind: 'super_option',
        note: 'Growth option',
        origin: 'app',
        sheetRef: null,
      });
    }
    expect(note('super_option', '2026-09')).toMatchObject({ origin: 'app' });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('keeps an unchanged workbook super_option note; refuses a month after the as-of month', async () => {
    const same = await call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/super_option/2026-06',
      payload: { note: 'Switched to the balanced option' },
    });
    expect(same.body.note).toMatchObject({ kind: 'super_option', origin: 'import' });
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const later = await call(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/super_option/2026-10',
      payload: { note: 'x' },
    });
    expect(later.status).toBe(400);
    expect(errorOf(later.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'periodMonth: after this month',
    });
    // Deleting the workbook note writes the marker.
    const removed = await call<PeriodNoteResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/period-notes/super_option/2026-06',
      payload: { note: '' },
    });
    expect(removed.body).toEqual({ note: null });
    expect(readAppEditMarker(db())?.count).toBe(1);
  });
});

// ─── Savings goals (D55) ────────────────────────────────────────────────────────────────────────

describe('savings goals', () => {
  const body = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    targetCents: 500000,
    targetDate: null,
    note: null,
    ...over,
  });

  it('creates, updates, reorders and deletes goals (an overlay: no app data)', async () => {
    const a = await call<SavingsGoalMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/savings-goals',
      payload: body('Holiday', { targetDate: '2027-06-30', note: 'Two weeks' }),
    });
    expect(a.status).toBe(201);
    expect(a.body.goal).toEqual({
      id: a.body.goal.id,
      name: 'Holiday',
      targetCents: 500000,
      targetDate: '2027-06-30',
      sortOrder: 1,
      note: 'Two weeks',
      allocatedCents: 0,
      remainingCents: 500000,
      progressRatio: '0',
      reached: false,
      monthsToGo: null,
      eta: null,
      onTrack: null,
      requiredPerMonthCents: null,
    });
    const b = await call<SavingsGoalMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/savings-goals',
      payload: body('Car'),
    });
    expect(b.body.goal.sortOrder).toBe(2);
    const updated = await call<SavingsGoalMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/savings-goals/${a.body.goal.id}`,
      payload: body('Holiday', { targetCents: 600000 }),
    });
    expect(updated.body.goal).toMatchObject({ targetCents: 600000, targetDate: null });
    const ids = [b.body.goal.id, a.body.goal.id];
    const reordered = await call(ctx.app, {
      method: 'POST',
      url: '/api/savings-goals/reorder',
      payload: { ids },
    });
    expect(reordered).toMatchObject({ status: 200, body: { ids } });
    expect(
      db()
        .select()
        .from(savingsGoals)
        .all()
        .map((g) => [g.id, g.sortOrder]),
    ).toEqual([
      [a.body.goal.id, 2],
      [b.body.goal.id, 1],
    ]);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const missing = await call(ctx.app, {
      method: 'POST',
      url: '/api/savings-goals/reorder',
      payload: { ids: [a.body.goal.id] },
    });
    expect(errorOf(missing.body).message).toBe('ids: must list every goal exactly once');
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/savings-goals/${a.body.goal.id}` }))
        .status,
    ).toBe(200);
    expect(
      (await call(ctx.app, { method: 'DELETE', url: `/api/savings-goals/${a.body.goal.id}` }))
        .status,
    ).toBe(404);
    expect(
      (await call(ctx.app, { method: 'PUT', url: '/api/savings-goals/999', payload: body('X') }))
        .status,
    ).toBe(404);
    expect(readAppEditMarker(db())).toBeNull();
  });

  it('validates the target and the date', async () => {
    const res = await call(ctx.app, {
      method: 'POST',
      url: '/api/savings-goals',
      payload: body('X', { targetCents: 0, targetDate: '2300-01-01' }),
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).message).toContain('targetCents: must be greater than zero');
  });
});
