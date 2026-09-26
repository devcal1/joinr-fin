// Integration with the REAL engine (stage-3.md §7.4 step 7), gated on CASHFLOW_ENGINE_IMPLEMENTED:
// the generic seed (and the synthetic workbook once the Stage 3 importer lands) builds all four
// pages and the investment timing; a create/update/delete round trip per entity leaves the domain
// tables as they were (app rows deleted in the app write no marker). Stage 4 (stage-4.md §7.4 step 7):
// the shared finance context reads the other-assets class value and the provisional savings input
// from the assets engines, so the suite also waits for ASSETS_ENGINE_IMPLEMENTED.
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import type {
  BudgetItemMutationResponse,
  BudgetPageResponse,
  CashAccountMutationResponse,
  CashPageResponse,
  DepositMutationResponse,
  DividendMutationResponse,
  DividendsPageResponse,
  IncomeStreamMutationResponse,
  InvestmentPageResponse,
  SideIncomePageResponse,
  YearlyExpenseMutationResponse,
} from '@joinr/schema';
import { cashBalanceEntries } from '@joinr/schema/db';
import { dumpDomainTables, seedGenericData } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
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

// Stage 5 (stage-5.md §7.4 step 8, the Stage 4 FEAS-1 precedent): the finance context feeds the
// D88 figures (stored offsets, measured-through dates) into computeSavings and computeSuper, so the
// suite also waits for HISTORY_ENGINE_IMPLEMENTED.
const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED;
const CAN_IMPORT =
  SYNTHETIC_WORKBOOK_IMPLEMENTED && IMPORTER_IMPLEMENTED && IMPORTER_STAGE3_IMPLEMENTED;

describe.skipIf(!GATED)('cash-flow API with the real engine', { timeout: 60_000 }, () => {
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

  type Request = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object };
  async function inject<T>(opts: Request, status = 200): Promise<T> {
    const res = await app.inject(opts);
    expect(res.statusCode, `${opts.method} ${opts.url}: ${res.body}`).toBe(status);
    return res.json<T>();
  }
  const get = <T>(url: string) => inject<T>({ method: 'GET', url });

  async function pages() {
    return {
      cash: await get<CashPageResponse>('/api/cash'),
      side: await get<SideIncomePageResponse>('/api/side-income'),
      budget: await get<BudgetPageResponse>('/api/budget'),
      dividends: await get<DividendsPageResponse>('/api/dividends'),
    };
  }

  it('builds the four pages and the live timing on the generic seed', async () => {
    seedGenericData(database.db, { now: NOW });
    const { cash, side, budget, dividends } = await pages();

    expect(cash.asOf).toBe(AS_OF);
    // The seed: bank 25,000, an offset 10,000 (not in Total Cash) and a loan you've made 3,000.
    expect(cash.totals).toMatchObject({
      totalCashCents: 2800000,
      offsetCents: 1000000,
      loansCents: 300000,
      availableCashCents: 2500000,
      emergencyFundTestCents: 2500000,
    });
    expect(cash.totals.emergencyFund.loansIncluded).toBe(false);
    expect(cash.goals.cashBasis).toBe('available');
    // Three recorded months (the first a baseline) and the provisional period, newest first.
    expect(cash.periods.map((p) => p.status)).toEqual(['provisional', 'closed', 'closed', 'first']);
    expect(cash.periods[0]).toMatchObject({ runDate: AS_OF, cashCents: 2800000 });
    expect(cash.charts.points.at(-1)?.live).toBe(true);

    expect(side.deposits).toHaveLength(3);
    expect(side.kpis.lifetimeCents).toBe(145000);
    expect(side.deposits[0]).toMatchObject({ date: '2026-08-20', provisional: true });

    expect(budget.rows.map((r) => r.kind)).toEqual([
      'item',
      'item',
      'item',
      'auto_yearly',
      'auto_invest',
      'auto_cash',
    ]);
    expect(budget.summary.plannedSpendCents).toBe(
      budget.rows
        .filter((r) => r.kind === 'item' || r.kind === 'auto_yearly')
        .reduce((s, r) => s + r.monthlyCents, 0),
    );

    expect(dividends.dividends).toHaveLength(2);
    expect(dividends.byFinancialYear.length).toBeGreaterThanOrEqual(5);
    expect(dividends.rolling12).toHaveLength(12);
    expect(dividends.events.mode).toBe('off');
    expect(dividends.suggestions).toEqual([]);

    const etf = await get<InvestmentPageResponse>('/api/investments/etf');
    expect(etf.timing.budget.source).toBe('live_budget');
    expect(etf.timing.deferred).toEqual([]);
    expect(etf.timing.budget.plannedSpendCents).toBe(budget.summary.plannedSpendCents);
  });

  it('a create/update/delete round trip per entity leaves the domain tables unchanged', async () => {
    const { instrumentIds } = seedGenericData(database.db, { now: NOW });
    const before = dumpDomainTables(database.db);
    const cash = await get<CashPageResponse>('/api/cash');
    const account = cash.accounts[0]!;

    // A cash account.
    const created = await inject<CashAccountMutationResponse>(
      {
        method: 'POST',
        url: '/api/cash/accounts',
        payload: {
          name: 'Temp account',
          kind: 'other',
          isOffset: false,
          note: 'e2e-temp',
          openingBalanceCents: 100,
          asOf: AS_OF,
        },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/cash/accounts/${created.account.id}`,
      payload: { name: 'Temp account 2', kind: 'bank', isOffset: false, note: 'e2e-temp' },
    });
    await inject({ method: 'DELETE', url: `/api/cash/accounts/${created.account.id}` });

    // A balance entry on an existing account (the account's copy returns to its latest entry).
    await inject({
      method: 'PUT',
      url: '/api/cash/balances',
      payload: {
        asOf: AS_OF,
        entries: [{ accountId: account.id, balanceCents: 123456, note: 'e2e-temp' }],
      },
    });
    const entry = database.db
      .select()
      .from(cashBalanceEntries)
      .where(eq(cashBalanceEntries.asOf, AS_OF))
      .get()!;
    await inject({ method: 'DELETE', url: `/api/cash/balance-entries/${entry.id}` });

    // A stream with a deposit.
    const stream = await inject<IncomeStreamMutationResponse>(
      {
        method: 'POST',
        url: '/api/side-income/streams',
        payload: { name: 'Temp stream', archived: false },
      },
      201,
    );
    const deposit = await inject<DepositMutationResponse>(
      {
        method: 'POST',
        url: '/api/side-income/deposits',
        payload: { streamId: stream.stream.id, date: AS_OF, amountCents: 5000, note: 'e2e-temp' },
      },
      201,
    );
    expect(deposit.deposit.provisional).toBe(true);
    await inject({
      method: 'PUT',
      url: `/api/side-income/deposits/${deposit.deposit.id}`,
      payload: { streamId: stream.stream.id, date: AS_OF, amountCents: 6000, note: 'e2e-temp' },
    });
    await inject({ method: 'DELETE', url: `/api/side-income/deposits/${deposit.deposit.id}` });
    await inject({ method: 'DELETE', url: `/api/side-income/streams/${stream.stream.id}` });

    // A budget item and a yearly expense.
    const item = await inject<BudgetItemMutationResponse>(
      {
        method: 'POST',
        url: '/api/budget/items',
        payload: { name: 'Temp item', monthlyCents: 1000, category: 'Temp', accountId: account.id },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/budget/items/${item.row.id}`,
      payload: { name: 'Temp item', monthlyCents: 2000, category: null, accountId: null },
    });
    await inject({ method: 'DELETE', url: `/api/budget/items/${item.row.id}` });
    const yearly = await inject<YearlyExpenseMutationResponse>(
      {
        method: 'POST',
        url: '/api/budget/yearly-expenses',
        payload: { name: 'Temp', annualCents: 1200 },
      },
      201,
    );
    await inject({
      method: 'PUT',
      url: `/api/budget/yearly-expenses/${yearly.expense.id}`,
      payload: { name: 'Temp', annualCents: 2400 },
    });
    await inject({ method: 'DELETE', url: `/api/budget/yearly-expenses/${yearly.expense.id}` });

    // A dividend.
    const dividend = await inject<DividendMutationResponse>(
      {
        method: 'POST',
        url: '/api/dividends',
        payload: {
          instrumentId: instrumentIds['ASX:XYZ']!,
          paymentDate: '2026-09-15',
          exDate: '2026-09-01',
          reinvested: false,
          netAmountCents: 3000,
          note: 'e2e-temp',
        },
      },
      201,
    );
    expect(dividend.dividend.unitsAtEx).toBe('30');
    await inject({
      method: 'PUT',
      url: `/api/dividends/${dividend.dividend.id}`,
      payload: {
        instrumentId: instrumentIds['ASX:DEF']!,
        paymentDate: '2026-09-15',
        exDate: null,
        reinvested: null,
        netAmountCents: 3100,
        priceAtEx: '50',
        note: 'e2e-temp',
      },
    });
    await inject({ method: 'DELETE', url: `/api/dividends/${dividend.dividend.id}` });

    expect(dumpDomainTables(database.db)).toEqual(before);
    expect(readAppEditMarker(database.db)).toBeNull();
  });

  it.skipIf(!CAN_IMPORT)(
    'builds the four pages after importing the synthetic workbook',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/import',
        payload: Buffer.from(buildSyntheticWorkbook()),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(res.statusCode).toBe(201);
      const { cash, side, budget, dividends } = await pages();
      expect(cash.accounts.length).toBeGreaterThan(0);
      // One balance entry per imported account (D58).
      expect(cash.entries.length).toBe(cash.accounts.length);
      expect(cash.periods.length).toBeGreaterThan(0);
      expect(side.deposits.every((d) => d.amountCents !== 0 && d.origin === 'import')).toBe(true);
      expect(budget.rows.length).toBeGreaterThan(0);
      expect(dividends.byFinancialYear.length).toBeGreaterThanOrEqual(5);
      const etf = await get<InvestmentPageResponse>('/api/investments/etf');
      expect(etf.timing.budget.source).toBe('live_budget');
    },
  );
});
