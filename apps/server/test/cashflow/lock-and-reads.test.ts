// Cross-cutting route behaviour (stage-3.md §4.2, §4.5 step 0): every Stage 3 mutation but the
// suggestion refresh answers 409 IMPORT_IN_PROGRESS first (before parsing an :id or a body) while
// the upload import holds the lock; the four GETs answer 200 no-store with the fake engine; and
// `hasAppData` follows the §3.3–3.4 rules for every entity (§7.4 step 5).
import type { ApiErrorBody } from '@joinr/schema';
import {
  cashAccounts,
  dividendEvents,
  savingsAdjustments,
  savingsGoals,
  settings,
} from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasAppData } from '../../src/db/queries/domain';
import { importLock } from '../../src/routes/import';
import { call, fakeDividendEvents, hasAppDataOf, NOW, startApp, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startApp({ dividendEvents: fakeDividendEvents({ mode: 'fake' }) });
});
afterEach(async () => {
  await ctx.close();
});

const MUTATIONS: readonly {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
}[] = [
  { method: 'POST', url: '/api/cash/accounts', payload: {} },
  { method: 'PUT', url: '/api/cash/accounts/x', payload: {} },
  { method: 'DELETE', url: '/api/cash/accounts/0' },
  { method: 'PUT', url: '/api/cash/balances', payload: {} },
  { method: 'DELETE', url: '/api/cash/balance-entries/x' },
  { method: 'PUT', url: '/api/cash/adjustments/bad', payload: {} },
  { method: 'DELETE', url: '/api/cash/adjustments/bad' },
  { method: 'PUT', url: '/api/period-notes/other/bad', payload: {} },
  { method: 'POST', url: '/api/savings-goals', payload: {} },
  { method: 'PUT', url: '/api/savings-goals/x', payload: {} },
  { method: 'DELETE', url: '/api/savings-goals/x' },
  { method: 'POST', url: '/api/savings-goals/reorder', payload: {} },
  { method: 'POST', url: '/api/side-income/deposits', payload: {} },
  { method: 'PUT', url: '/api/side-income/deposits/x', payload: {} },
  { method: 'DELETE', url: '/api/side-income/deposits/x' },
  { method: 'POST', url: '/api/side-income/streams', payload: {} },
  { method: 'PUT', url: '/api/side-income/streams/x', payload: {} },
  { method: 'DELETE', url: '/api/side-income/streams/x' },
  { method: 'POST', url: '/api/budget/items', payload: {} },
  { method: 'PUT', url: '/api/budget/items/x', payload: {} },
  { method: 'DELETE', url: '/api/budget/items/x' },
  { method: 'POST', url: '/api/budget/items/reorder', payload: {} },
  { method: 'PUT', url: '/api/budget/auto/other', payload: {} },
  { method: 'POST', url: '/api/budget/yearly-expenses', payload: {} },
  { method: 'PUT', url: '/api/budget/yearly-expenses/x', payload: {} },
  { method: 'DELETE', url: '/api/budget/yearly-expenses/x' },
  { method: 'POST', url: '/api/dividends', payload: {} },
  { method: 'PUT', url: '/api/dividends/x', payload: {} },
  { method: 'DELETE', url: '/api/dividends/x' },
  { method: 'POST', url: '/api/dividends/suggestions/dismiss', payload: {} },
  { method: 'POST', url: '/api/dividends/suggestions/restore', payload: {} },
  { method: 'PATCH', url: '/api/settings', payload: {} },
];

describe('the import lock (§4.5 step 0)', () => {
  it('answers 409 IMPORT_IN_PROGRESS to every mutation, before any parsing', async () => {
    expect(importLock.tryAcquire()).toBe(true);
    for (const opts of MUTATIONS) {
      const res = await call<ApiErrorBody>(ctx.app, opts);
      expect(res.status, `${opts.method} ${opts.url}`).toBe(409);
      expect(res.body.error.code, `${opts.method} ${opts.url}`).toBe('IMPORT_IN_PROGRESS');
    }
  });

  it('lets the suggestion refresh run (it writes only the events cache)', async () => {
    expect(importLock.tryAcquire()).toBe(true);
    const res = await call(ctx.app, { method: 'POST', url: '/api/dividends/suggestions/refresh' });
    expect(res.status).toBe(200);
  });

  it('without the lock the same requests fail validation or lookup, never 409', async () => {
    for (const opts of MUTATIONS) {
      const res = await call(ctx.app, opts);
      expect([400, 404], `${opts.method} ${opts.url}`).toContain(res.status);
    }
  });
});

describe('the four pages (fake engine)', () => {
  it('answer 200 no-store', async () => {
    for (const url of ['/api/cash', '/api/side-income', '/api/budget', '/api/dividends']) {
      const res = await call<{ asOf: string; generatedAt: string }>(ctx.app, {
        method: 'GET',
        url,
      });
      expect(res.status, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.body.asOf, url).toBe('2026-09-24');
      expect(res.body.generatedAt, url).toBe(NOW.toISOString());
    }
  });
});

describe('hasAppData (§3.3 rule 2, §3.4)', () => {
  const db = () => ctx.database.db;
  const setSetting = (key: string, origin: 'app' | 'import') =>
    db()
      .insert(settings)
      .values({ key, valueJson: 'true', updatedAt: NOW.toISOString(), origin })
      .onConflictDoUpdate({ target: settings.key, set: { origin } })
      .run();

  it('is false on the seed, and an app-only setting leaves it false', async () => {
    expect(hasAppData(db())).toBe(false);
    db()
      .insert(settings)
      .values({
        key: 'savings.yearBasis',
        valueJson: '"calendar"',
        updatedAt: NOW.toISOString(),
        origin: 'app',
      })
      .run();
    expect(hasAppData(db())).toBe(false);
    // An unknown key cannot come from the workbook either.
    setSetting('legacy.unknownKey', 'app');
    expect(hasAppData(db())).toBe(false);
  });

  it('is true for an app-edited workbook setting', () => {
    setSetting('budget.includeSideIncome', 'app');
    expect(hasAppData(db())).toBe(true);
  });

  it('ignores the overlays and the dismissed flag', async () => {
    db()
      .insert(savingsAdjustments)
      .values({ periodMonth: '2026-06', amountCents: 5, note: 'x', origin: 'app' })
      .run();
    db()
      .insert(savingsGoals)
      .values({ name: 'Goal', targetCents: 5, sortOrder: 1, origin: 'app' })
      .run();
    db()
      .insert(dividendEvents)
      .values({
        instrumentId: ctx.ids['ASX:XYZ']!,
        exDate: '2026-09-01',
        amountPerUnit: '1',
        currency: 'AUD',
        source: 'fake',
        fetchedAt: NOW.toISOString(),
        dismissedAt: NOW.toISOString(),
      })
      .run();
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('a kind-only account edit keeps it false', async () => {
    const loan = db()
      .select()
      .from(cashAccounts)
      .where(eq(cashAccounts.kind, 'loan_receivable'))
      .get()!;
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/cash/accounts/${loan.id}`,
      payload: { name: loan.name, kind: 'other', isOffset: false, note: null },
    });
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('is true for an app row in every import-owned Stage 3 table', () => {
    for (const table of [
      'cash_accounts',
      'cash_balance_entries',
      'side_income_deposits',
      'income_streams',
      'period_notes',
      'budget_items',
      'yearly_expenses',
      'dividends',
    ]) {
      ctx.database.sqlite
        .prepare(`UPDATE "${table}" SET origin = 'app' WHERE id = (SELECT min(id) FROM "${table}")`)
        .run();
      expect(hasAppData(db()), table).toBe(true);
      ctx.database.sqlite.prepare(`UPDATE "${table}" SET origin = 'import'`).run();
      expect(hasAppData(db()), table).toBe(false);
    }
  });
});
