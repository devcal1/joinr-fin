// The Super routes through buildApp + inject on the generic seed with a structural FAKE engine
// (stage-4.md §4.2, §4.5 steps 5–7, §3.4, §7.4 step 3): funds (an opening balance as a transfer in
// or a rollover, the SG-fund flag-only exception that keeps `origin`, the archive rule, FUND_IN_USE),
// the D69 balance log (upserts, a transfer in omitted keeps it and null clears it, the fund's
// denormalised copy, LAST_BALANCE_ENTRY, the marker), typed contributions (D71: an imported entry
// edited becomes typed), SG statements (an overlay: never app data) and the import lock. Generic
// values only.
import type {
  SgOverrideResponse,
  SuperBalancesResponse,
  SuperContributionMutationResponse,
  SuperFundMutationResponse,
  SuperPageResponse,
} from '@joinr/schema';
import { superBalanceEntries, superEntries, superFunds, superSgOverrides } from '@joinr/schema/db';
import { and, eq } from 'drizzle-orm';
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
const fund = (name = 'Example Super') =>
  db().select().from(superFunds).where(eq(superFunds.name, name)).get()!;
const entriesOf = (fundId: number) =>
  db()
    .select()
    .from(superBalanceEntries)
    .where(eq(superBalanceEntries.fundId, fundId))
    .orderBy(superBalanceEntries.asOf)
    .all();
const entry = (sheetRef: string) =>
  db().select().from(superEntries).where(eq(superEntries.sheetRef, sheetRef)).get()!;

async function createFund(over: Record<string, unknown> = {}) {
  return call<SuperFundMutationResponse>(ctx.app, {
    method: 'POST',
    url: '/api/super/funds',
    payload: {
      name: 'Second fund',
      receivesSg: false,
      openingBalanceCents: 1000000,
      asOf: '2026-09-01',
      openingIsRollover: false,
      ...over,
    },
  });
}

describe('GET /api/super', () => {
  it('answers the page with no-store', async () => {
    const res = await call<SuperPageResponse>(ctx.app, { method: 'GET', url: '/api/super' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.funds.map((f) => f.name)).toEqual(['Example Super']);
    expect(res.body.lastRun).toBe('2026-07-31');
    expect(res.body.notes.map((n) => n.periodMonth)).toEqual(['2026-06']);
  });
});

describe('POST /api/super/funds (§2.5 step 1, §4.5 step 5)', () => {
  it('creates an app fund with its opening balance as a transfer in (not a gain)', async () => {
    const res = await createFund();
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.fund).toMatchObject({
      name: 'Second fund',
      receivesSg: false,
      archived: false,
      balanceCents: 1000000,
      balanceAsOf: '2026-09-01',
      entryCount: 1,
      contributionCount: 0,
      sortOrder: 2,
      origin: 'app',
      sheetRef: null,
    });
    expect(entriesOf(res.body.fund.id)).toEqual([
      expect.objectContaining({
        asOf: '2026-09-01',
        balanceCents: 1000000,
        transferInCents: 1000000,
        origin: 'app',
      }),
    ]);
    expect(fund('Second fund')).toMatchObject({ balanceCents: 1000000, balanceAsOf: '2026-09-01' });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('a rollover from a fund on the page has no transfer in', async () => {
    const res = await createFund({ openingIsRollover: true });
    expect(entriesOf(res.body.fund.id)[0]!.transferInCents).toBeNull();
  });

  it('receiving SG clears the flag on the other funds, keeping their origin', async () => {
    const res = await createFund({ receivesSg: true });
    expect(res.body.fund.receivesSg).toBe(true);
    expect(fund()).toMatchObject({ receivesSg: false, origin: 'import' });
  });

  it('validates the body (400) with the §4.3 messages', async () => {
    const res = await createFund({ asOf: '2030-01-01', openingBalanceCents: -1, name: '' });
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    expect(errorOf(res.body).message).toContain('asOf');
    expect(errorOf(res.body).message).toContain('openingBalanceCents');
  });
});

describe('PUT /api/super/funds/:id (§3.4: the SG-fund exception)', () => {
  it('a receivesSg-only change keeps the origin (import-safe), setting it clears the others', async () => {
    const second = (await createFund({ receivesSg: false })).body.fund;
    const f = fund();
    // Turn the flag off on the workbook fund: flag only, origin kept.
    const off = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: f.name, receivesSg: false, archived: false },
    });
    expect(off.status).toBe(200);
    expect(off.body.fund).toMatchObject({ receivesSg: false, origin: 'import' });
    // Setting it on the app fund clears nothing else (already off); back on the workbook fund.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${second.id}`,
      payload: { name: second.name, receivesSg: true, archived: false },
    });
    expect(fund('Second fund')).toMatchObject({ receivesSg: true, origin: 'app' });
    const on = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: ` ${f.name} `, receivesSg: true, archived: false },
    });
    expect(on.body.fund).toMatchObject({ receivesSg: true, origin: 'import' });
    expect(fund('Second fund')).toMatchObject({ receivesSg: false, origin: 'app' });
  });

  it('on the seed alone, the SG flag edit leaves hasAppData false', async () => {
    const f = fund();
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: f.name, receivesSg: false, archived: false },
    });
    expect(fund().origin).toBe('import');
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('a rename makes the fund app; a no-op save writes nothing', async () => {
    const f = fund();
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: f.name, receivesSg: true, archived: false },
    });
    expect(fund().origin).toBe('import');
    const res = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: 'Renamed Super', receivesSg: true, archived: false },
    });
    expect(res.body.fund).toMatchObject({ name: 'Renamed Super', origin: 'app' });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
  });

  it('archiving needs a latest balance of 0 (400), then succeeds', async () => {
    const f = fund();
    const bad = await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: f.name, receivesSg: true, archived: true },
    });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'archived: enter a closing balance of $0 first',
    });
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-09-20', entries: [{ fundId: f.id, balanceCents: 0 }] },
    });
    const ok = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${f.id}`,
      payload: { name: f.name, receivesSg: false, archived: true },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.fund).toMatchObject({ archived: true, origin: 'app' });
  });

  it('404 for an unknown fund; 400 for a bad id or body', async () => {
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/funds/999',
      payload: { name: 'x', receivesSg: false, archived: false },
    });
    expect(missing.status).toBe(404);
    const bad = await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${fund().id}`,
      payload: { name: 'x', receivesSg: 'yes', archived: false },
    });
    expect(bad.status).toBe(400);
  });
});

describe('DELETE /api/super/funds/:id', () => {
  it('409 FUND_IN_USE while contributions name it; then cascades its log with the marker', async () => {
    const f = fund();
    const c = await call<SuperContributionMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/super/contributions',
      payload: {
        fundId: f.id,
        date: '2026-09-10',
        kind: 'salary_sacrifice',
        amountCents: 50000,
        note: null,
      },
    });
    const busy = await call(ctx.app, { method: 'DELETE', url: `/api/super/funds/${f.id}` });
    expect(busy.status).toBe(409);
    expect(errorOf(busy.body)).toEqual({
      code: 'FUND_IN_USE',
      message: 'This fund has 1 contribution; move or delete it first',
    });
    await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/contributions/${c.body.contribution.id}`,
    });
    const ok = await call(ctx.app, { method: 'DELETE', url: `/api/super/funds/${f.id}` });
    expect(ok.body).toEqual({ id: f.id });
    expect(entriesOf(f.id)).toEqual([]);
    // The reported gain (Super!B11) named the fund; it survives with no fund (set null).
    expect(entry('Super!B11').fundId).toBeNull();
    expect(readAppEditMarker(db())?.count).toBe(1);
  });

  it('an app fund deleted writes no marker', async () => {
    const created = (await createFund()).body.fund;
    await call(ctx.app, { method: 'DELETE', url: `/api/super/funds/${created.id}` });
    expect(readAppEditMarker(db())).toBeNull();
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });
});

describe('PUT /api/super/balances (D69)', () => {
  it('adds an entry, follows the latest entry, and leaves an unchanged entry alone', async () => {
    const f = fund();
    const same = await call<SuperBalancesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-08-31', entries: [{ fundId: f.id, balanceCents: 5060000 }] },
    });
    expect(same.status).toBe(200);
    expect(same.body.funds.map((x) => x.id)).toEqual([f.id]);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
    const res = await call<SuperBalancesResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { fundId: f.id, balanceCents: 5150000, transferInCents: 20000, note: 'Statement' },
        ],
      },
    });
    expect(res.body.funds[0]).toMatchObject({
      balanceCents: 5150000,
      balanceAsOf: '2026-09-20',
      entryCount: 3,
    });
    expect(fund()).toMatchObject({
      balanceCents: 5150000,
      balanceAsOf: '2026-09-20',
      origin: 'import',
    });
    expect(entriesOf(f.id).at(-1)).toMatchObject({
      transferInCents: 20000,
      note: 'Statement',
      origin: 'app',
    });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    // A back-dated entry does not move the copy.
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-06-30', entries: [{ fundId: f.id, balanceCents: 5020000 }] },
    });
    expect(fund()).toMatchObject({ balanceCents: 5150000, balanceAsOf: '2026-09-20' });
  });

  it('an omitted transfer in keeps the stored figure; null clears it', async () => {
    const f = fund();
    const put = (e: Record<string, unknown>) =>
      call(ctx.app, {
        method: 'PUT',
        url: '/api/super/balances',
        payload: { asOf: '2026-09-20', entries: [{ fundId: f.id, ...e }] },
      });
    const stored = () =>
      db()
        .select()
        .from(superBalanceEntries)
        .where(
          and(eq(superBalanceEntries.fundId, f.id), eq(superBalanceEntries.asOf, '2026-09-20')),
        )
        .get()!;
    await put({ balanceCents: 5100000, transferInCents: 30000, note: 'First' });
    await put({ balanceCents: 5110000 });
    expect(stored()).toMatchObject({
      balanceCents: 5110000,
      transferInCents: 30000,
      note: 'First',
    });
    await put({ balanceCents: 5110000, transferInCents: null, note: null });
    expect(stored()).toMatchObject({ transferInCents: null, note: null });
  });

  it('404 for an unknown fund (nothing written); 400 for a fund named twice', async () => {
    const f = fund();
    const missing = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { fundId: f.id, balanceCents: 1 },
          { fundId: 999, balanceCents: 1 },
        ],
      },
    });
    expect(missing.status).toBe(404);
    expect(entriesOf(f.id)).toHaveLength(2);
    const twice = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: {
        asOf: '2026-09-20',
        entries: [
          { fundId: f.id, balanceCents: 1 },
          { fundId: f.id, balanceCents: 2 },
        ],
      },
    });
    expect(errorOf(twice.body).message).toBe('entries: a fund appears twice');
  });
});

describe('DELETE /api/super/balance-entries/:id', () => {
  it('recomputes the copy, writes the marker for a workbook entry, and keeps the last one (409)', async () => {
    const f = fund();
    const [early, latest] = entriesOf(f.id) as [
      ReturnType<typeof entriesOf>[0],
      ReturnType<typeof entriesOf>[0],
    ];
    const res = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'DELETE',
      url: `/api/super/balance-entries/${latest.id}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.fund).toMatchObject({ id: f.id, entryCount: 1 });
    expect(fund()).toMatchObject({ balanceCents: 5000000, balanceAsOf: '2026-05-31' });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const last = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/balance-entries/${early.id}`,
    });
    expect(last.status).toBe(409);
    expect(errorOf(last.body)).toEqual({
      code: 'LAST_BALANCE_ENTRY',
      message: 'A fund keeps at least one balance',
    });
    const missing = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/balance-entries/${latest.id}`,
    });
    expect(missing.status).toBe(404);
  });
});

describe('contributions (D71)', () => {
  it('creates a typed contribution dated in its month; 404 for an unknown fund', async () => {
    const res = await call<SuperContributionMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/super/contributions',
      payload: {
        fundId: null,
        date: '2026-09-15',
        kind: 'after_tax',
        amountCents: 30000,
        note: 'From savings',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.contribution).toMatchObject({
      fundId: null,
      fundName: null,
      date: '2026-09-15',
      kind: 'after_tax',
      amountCents: 30000,
      note: 'From savings',
      origin: 'app',
      periodMonth: '2026-09',
      provisional: true,
    });
    const row = db()
      .select()
      .from(superEntries)
      .where(eq(superEntries.id, res.body.contribution.id))
      .get()!;
    expect(row).toMatchObject({ periodMonth: '2026-09', entryDate: '2026-09-15' });
    expect(await hasAppDataOf(ctx.app)).toBe(true);
    const missing = await call(ctx.app, {
      method: 'POST',
      url: '/api/super/contributions',
      payload: { fundId: 999, date: '2026-09-15', kind: 'after_tax', amountCents: 1, note: null },
    });
    expect(missing.status).toBe(404);
    const bad = await call(ctx.app, {
      method: 'POST',
      url: '/api/super/contributions',
      payload: {
        fundId: null,
        date: '2026-09-15',
        kind: 'voluntary_contribution',
        amountCents: 0,
        note: null,
      },
    });
    expect(bad.status).toBe(400);
  });

  it('an imported entry edited becomes the typed kind and app; a no-op save writes nothing', async () => {
    const imported = entry('History!R5');
    const res = await call<SuperContributionMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/contributions/${imported.id}`,
      payload: {
        fundId: null,
        date: '2026-07-31',
        kind: 'salary_sacrifice',
        amountCents: 28571,
        note: null,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.contribution).toMatchObject({
      kind: 'salary_sacrifice',
      amountCents: 28571,
      origin: 'app',
      estimate: false,
      sheetRef: 'History!R5',
    });
    // Saved again unchanged: nothing is written (the updated row keeps its values).
    const again = await call<SuperContributionMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/contributions/${imported.id}`,
      payload: {
        fundId: null,
        date: '2026-07-31',
        kind: 'salary_sacrifice',
        amountCents: 28571,
        note: '',
      },
    });
    expect(again.status).toBe(200);
    // A date in another month moves its period month.
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/contributions/${imported.id}`,
      payload: {
        fundId: fund().id,
        date: '2026-08-02',
        kind: 'salary_sacrifice',
        amountCents: 28571,
        note: null,
      },
    });
    expect(entry('History!R5')).toMatchObject({ periodMonth: '2026-08', fundId: fund().id });
  });

  it('a no-op save of an imported entry keeps its origin (only its typed reading changes it)', async () => {
    const created = await call<SuperContributionMutationResponse>(ctx.app, {
      method: 'POST',
      url: '/api/super/contributions',
      payload: {
        fundId: null,
        date: '2026-09-15',
        kind: 'after_tax',
        amountCents: 100,
        note: null,
      },
    });
    const id = created.body.contribution.id;
    db().update(superEntries).set({ origin: 'import' }).where(eq(superEntries.id, id)).run();
    await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/contributions/${id}`,
      payload: { fundId: null, date: '2026-09-15', kind: 'after_tax', amountCents: 100, note: ' ' },
    });
    expect(db().select().from(superEntries).where(eq(superEntries.id, id)).get()!.origin).toBe(
      'import',
    );
  });

  it('the reported gain is not a contribution (404); deleting a workbook entry writes the marker', async () => {
    const gain = entry('Super!B11');
    const notOne = await call(ctx.app, {
      method: 'PUT',
      url: `/api/super/contributions/${gain.id}`,
      payload: { fundId: null, date: '2026-09-15', kind: 'after_tax', amountCents: 1, note: null },
    });
    expect(notOne.status).toBe(404);
    const b16 = entry('Super!B16');
    const res = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/contributions/${b16.id}`,
    });
    expect(res.body).toEqual({ id: b16.id });
    expect(readAppEditMarker(db())?.count).toBe(1);
    const again = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/contributions/${b16.id}`,
    });
    expect(again.status).toBe(404);
  });
});

describe('SG statements (an overlay, §3.4)', () => {
  it('upserts by the month earned, is returned as a statement month and never counts as app data', async () => {
    const res = await call<SgOverrideResponse>(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-08',
      payload: { grossCents: 91000, note: 'Payslip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.month).toMatchObject({
      month: '2026-08',
      source: 'statement',
      grossCents: 91000,
      fundId: fund().id,
      note: 'Payslip',
    });
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-08',
      payload: { grossCents: 92000, note: null },
    });
    expect(db().select().from(superSgOverrides).all()).toEqual([
      expect.objectContaining({ periodMonth: '2026-08', grossCents: 92000, note: null }),
    ]);
    // This month is allowed; a later month is not.
    const now = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-09',
      payload: { grossCents: 1, note: null },
    });
    expect(now.status).toBe(200);
    const later = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-10',
      payload: { grossCents: 1, note: null },
    });
    expect(later.status).toBe(400);
    expect(errorOf(later.body).message).toBe('periodMonth: after this month');
    const badMonth = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-13',
      payload: { grossCents: 1, note: null },
    });
    expect(badMonth.status).toBe(400);
    expect(await hasAppDataOf(ctx.app)).toBe(false);
  });

  it('DELETE answers { periodMonth } and 404 when the month has no statement', async () => {
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/2026-07',
      payload: { grossCents: 1000, note: null },
    });
    const res = await call(ctx.app, { method: 'DELETE', url: '/api/super/sg/2026-07' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ periodMonth: '2026-07' });
    const again = await call(ctx.app, { method: 'DELETE', url: '/api/super/sg/2026-07' });
    expect(again.status).toBe(404);
  });

  it('refuses a month before 01/1900 (400, nothing written); 1900-01 is allowed', async () => {
    for (const month of ['0001-01', '1899-12']) {
      const res = await call(ctx.app, {
        method: 'PUT',
        url: `/api/super/sg/${month}`,
        payload: { grossCents: 1000, note: null },
      });
      expect(res.status, month).toBe(400);
      expect(errorOf(res.body)).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'periodMonth: must be on or after 01/1900',
      });
      const del = await call(ctx.app, { method: 'DELETE', url: `/api/super/sg/${month}` });
      expect(del.status, month).toBe(400);
    }
    expect(db().select().from(superSgOverrides).all()).toEqual([]);
    const ok = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/sg/1900-01',
      payload: { grossCents: 1000, note: null },
    });
    expect(ok.status).toBe(200);
  });
});

describe('opening balances and transfers in before the last recorded month (§4.5 step 5)', () => {
  // The seed's last recorded month runs to 31/07/2026.
  it('refuses a non-rollover opening balance dated on or before the last run (400)', async () => {
    for (const asOf of ['2026-07-31', '2026-07-10']) {
      const res = await createFund({ asOf });
      expect(res.status, asOf).toBe(400);
      expect(errorOf(res.body)).toEqual({
        code: 'VALIDATION_ERROR',
        message:
          'asOf: date the opening balance after 31/07/2026 (the last recorded month), or mark it a rollover',
      });
    }
    expect(db().select().from(superFunds).all()).toHaveLength(1);
  });

  it('allows a backdated rollover (no transfer in) and a backdated opening balance of 0', async () => {
    const rollover = await createFund({ asOf: '2026-07-10', openingIsRollover: true });
    expect(rollover.status).toBe(201);
    expect(entriesOf(rollover.body.fund.id)).toEqual([
      expect.objectContaining({ asOf: '2026-07-10', transferInCents: null }),
    ]);
    const empty = await createFund({
      name: 'Empty fund',
      asOf: '2026-07-10',
      openingBalanceCents: 0,
    });
    expect(empty.status).toBe(201);
    // After the last run, a non-rollover opening balance is a transfer in as before.
    const later = await createFund({ name: 'Later fund', asOf: '2026-08-01' });
    expect(later.status).toBe(201);
    expect(entriesOf(later.body.fund.id)[0]!.transferInCents).toBe(1000000);
  });

  it('refuses a new transfer in on or before the last run on an app fund; an imported fund keeps it', async () => {
    const app = (await createFund({ name: 'App fund', asOf: '2026-08-01' })).body.fund;
    const put = (fundId: number, asOf: string, e: Record<string, unknown>) =>
      call(ctx.app, {
        method: 'PUT',
        url: '/api/super/balances',
        payload: { asOf, entries: [{ fundId, balanceCents: 900000, ...e }] },
      });
    const bad = await put(app.id, '2026-07-20', { transferInCents: 50000 });
    expect(bad.status).toBe(400);
    expect(errorOf(bad.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message:
        'entries.0.transferInCents: date a transfer in after 31/07/2026 (the last recorded month)',
    });
    expect(entriesOf(app.id)).toHaveLength(1);
    // Without a transfer in, the backdated entry is fine; after the last run, the transfer is too.
    expect((await put(app.id, '2026-07-20', {})).status).toBe(200);
    expect((await put(app.id, '2026-08-20', { transferInCents: 50000 })).status).toBe(200);
    // The imported fund's closed-window transfers count (its money was in the sheet's Q).
    const imported = await put(fund().id, '2026-07-20', { transferInCents: 50000 });
    expect(imported.status).toBe(200);
  });
});

describe('an archived fund keeps a latest balance of 0 (§2.5 step 1)', () => {
  async function archivedFund() {
    const created = (await createFund({ name: 'Old fund', asOf: '2026-08-01' })).body.fund;
    await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-09-01', entries: [{ fundId: created.id, balanceCents: 0 }] },
    });
    const res = await call<SuperFundMutationResponse>(ctx.app, {
      method: 'PUT',
      url: `/api/super/funds/${created.id}`,
      payload: { name: created.name, receivesSg: false, archived: true },
    });
    expect(res.body.fund.archived).toBe(true);
    return created;
  }

  it('refuses a non-zero latest balance on an archived fund (400; nothing changes)', async () => {
    const old = await archivedFund();
    const before = entriesOf(old.id);
    const res = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-09-10', entries: [{ fundId: old.id, balanceCents: 1000 }] },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'entries.0.balanceCents: this fund is archived; unarchive it first',
    });
    expect(entriesOf(old.id)).toEqual(before);
    expect(fund('Old fund')).toMatchObject({ balanceCents: 0, balanceAsOf: '2026-09-01' });
    // Editing the closing entry to a non-zero balance is refused too.
    const edit = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-09-01', entries: [{ fundId: old.id, balanceCents: 5 }] },
    });
    expect(edit.status).toBe(400);
    expect(entriesOf(old.id)).toEqual(before);
  });

  it('allows a back-dated non-zero entry and a note on the closing 0', async () => {
    const old = await archivedFund();
    const back = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: { asOf: '2026-08-15', entries: [{ fundId: old.id, balanceCents: 1005000 }] },
    });
    expect(back.status).toBe(200);
    const note = await call(ctx.app, {
      method: 'PUT',
      url: '/api/super/balances',
      payload: {
        asOf: '2026-09-01',
        entries: [{ fundId: old.id, balanceCents: 0, note: 'Rolled over' }],
      },
    });
    expect(note.status).toBe(200);
    expect(fund('Old fund')).toMatchObject({ balanceCents: 0, balanceAsOf: '2026-09-01' });
  });

  it("refuses deleting an archived fund's closing 0 (400; the entry is kept)", async () => {
    const old = await archivedFund();
    const closing = entriesOf(old.id).at(-1)!;
    const res = await call(ctx.app, {
      method: 'DELETE',
      url: `/api/super/balance-entries/${closing.id}`,
    });
    expect(res.status).toBe(400);
    expect(errorOf(res.body)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'archived: this fund is archived; unarchive it first',
    });
    expect(entriesOf(old.id)).toHaveLength(2);
    expect(fund('Old fund')).toMatchObject({ balanceCents: 0, balanceAsOf: '2026-09-01' });
  });
});

describe('the import lock (§4.2)', () => {
  it('answers 409 IMPORT_IN_PROGRESS before anything else', async () => {
    importLock.tryAcquire();
    try {
      for (const [method, url] of [
        ['POST', '/api/super/funds'],
        ['PUT', '/api/super/funds/x'],
        ['DELETE', '/api/super/funds/1'],
        ['PUT', '/api/super/balances'],
        ['DELETE', '/api/super/balance-entries/1'],
        ['POST', '/api/super/contributions'],
        ['PUT', '/api/super/contributions/1'],
        ['DELETE', '/api/super/contributions/1'],
        ['PUT', '/api/super/sg/2026-13'],
        ['DELETE', '/api/super/sg/2026-01'],
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
