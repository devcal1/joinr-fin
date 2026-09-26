// Shared helpers for the Stage 3 cash-flow suites: hand-built engine results (so the DTO mapping is
// checked field by field before the engine lands), a fake DividendEventsService (the frozen §4.6
// interface) and an app on the generic seed with a FAKE engine. Generic values only.
import { join } from 'node:path';
import type {
  BudgetResult,
  CashKpisResult,
  EngineApi,
  SavingsPeriod,
  SideIncomeResult,
} from '@joinr/engine';
import type {
  ApiErrorBody,
  DividendEventsRefreshSummary,
  ImportRunsResponse,
  MarketDataMode,
} from '@joinr/schema';
import { seedGenericData } from '@joinr/schema/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { vi } from 'vitest';
import { buildApp, offServices, type ServicesFactory } from '../../src/app';
import type { Config } from '../../src/config';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import type { DividendEventsService } from '../../src/market/dividends/index';
import { MarketDataDisabledError } from '../../src/market/types';
import { importLock } from '../../src/routes/import';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { fakeEngine, neutralBudgetInvest, NOW } from '../investments/helpers';

export {
  AS_OF,
  emptyResult,
  fakeEngine,
  fakeMarket,
  NOW,
  summaryResult,
} from '../investments/helpers';
export type { FakeEngine } from '../investments/helpers';

// ─── Hand-built engine results ──────────────────────────────────────────────────────────────────

export function savingsPeriod(
  p: Partial<SavingsPeriod> & Pick<SavingsPeriod, 'periodMonth'>,
): SavingsPeriod {
  return {
    runDate: `${p.periodMonth}-28`,
    after: null,
    through: `${p.periodMonth}-28`,
    status: 'closed',
    cashCents: null,
    cashGainCents: null,
    cashGainRatio: null,
    addedInvestmentsCents: null,
    added: null,
    income: null,
    adjustmentCents: 0,
    raw: { incomeCents: null, savingsCents: null, savingsRatio: null, spendCents: null },
    adjusted: { incomeCents: null, savingsCents: null, savingsRatio: null, spendCents: null },
    ...p,
  };
}

export function kpisResult(p: Partial<CashKpisResult> = {}): CashKpisResult {
  return {
    ...fakeEngine().cashKpis({
      asOf: '2026-09-24',
      periods: [],
      yearBasis: 'fy',
      jobStartDate: null,
      currentCashCents: 0,
      eoyCashGoalCents: null,
      cashSavingsTargetCents: null,
    }),
    ...p,
  };
}

export function sideIncomeResult(p: Partial<SideIncomeResult> = {}): SideIncomeResult {
  return {
    ...fakeEngine().computeSideIncome({ asOf: '2026-09-24', snapshots: [], deposits: [] }),
    ...p,
  };
}

export function budgetResult(p: Partial<BudgetResult> = {}): BudgetResult {
  return {
    invest: neutralBudgetInvest(),
    annualIncomeCents: null,
    yearlySavingsCents: null,
    plannedSavingsRatio: null,
    unallocatedCents: null,
    emergencyFundBasisCents: 0,
    rows: [],
    yearlyExpenses: [],
    transfers: [],
    unassigned: { perPayCents: 0, monthlyCents: 0, rows: 0 },
    perPayTotalCents: null,
    byCategory: [],
    investManual: false,
    ...p,
  };
}

// ─── A fake dividend-events service (the frozen §4.6 interface) ─────────────────────────────────

export interface FakeDividendEvents extends DividendEventsService {
  refreshMock: ReturnType<typeof vi.fn>;
}

export function refreshSummary(
  p: Partial<DividendEventsRefreshSummary> = {},
): DividendEventsRefreshSummary {
  return {
    jobRunId: 7,
    requested: 3,
    ok: 2,
    failed: 1,
    skipped: 0,
    events: 5,
    durationMs: 120,
    ...p,
  };
}

export function fakeDividendEvents(
  o: {
    mode?: MarketDataMode;
    summary?: DividendEventsRefreshSummary;
    lastRefreshAt?: string | null;
    nextRefreshAt?: string | null;
    running?: boolean;
  } = {},
): FakeDividendEvents {
  const mode = o.mode ?? 'fake';
  const refreshMock = vi.fn(() =>
    mode === 'off'
      ? Promise.reject(new MarketDataDisabledError())
      : Promise.resolve(o.summary ?? refreshSummary()),
  );
  return {
    refresh: refreshMock,
    status: () => ({
      mode,
      running: o.running ?? false,
      lastRefreshAt: o.lastRefreshAt ?? null,
      nextRefreshAt: o.nextRefreshAt ?? null,
    }),
    refreshMock,
  };
}

// ─── An app on the generic seed ─────────────────────────────────────────────────────────────────

export interface TestApp {
  app: FastifyInstance;
  database: AppDatabase;
  config: Config;
  ids: Record<string, number>;
  close(): Promise<void>;
}

export async function startApp(
  o: {
    engine?: EngineApi;
    dividendEvents?: DividendEventsService;
    seed?: boolean;
    now?: () => Date;
    /** Stage 4: the services factory (e.g. a spy on the price job's notify). */
    services?: ServicesFactory;
  } = {},
): Promise<TestApp> {
  const tempDir = await makeTempDir();
  const config = testConfig(join(tempDir, 'data'));
  const database = openDatabase(config.dataDir);
  runMigrations(database, config.migrationsDir);
  const ids = o.seed === false ? {} : seedGenericData(database.db, { now: NOW }).instrumentIds;
  const events = o.dividendEvents;
  const app = await buildApp({
    config,
    db: database,
    now: o.now ?? (() => NOW),
    engine: o.engine ?? fakeEngine(),
    services:
      o.services ??
      (events ? (deps) => ({ ...offServices(deps), dividendEvents: events }) : undefined),
  });
  return {
    app,
    database,
    config,
    ids,
    close: async () => {
      importLock.release();
      await app.close();
      closeDatabase(database);
      await removeDir(tempDir);
    },
  };
}

export async function call<T = unknown>(
  app: FastifyInstance,
  opts: InjectOptions,
): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const res = await app.inject(opts);
  return {
    status: res.statusCode,
    body: (res.body === '' ? null : res.json()) as T,
    headers: res.headers,
  };
}

export function errorOf(body: unknown): ApiErrorBody['error'] {
  return (body as ApiErrorBody).error;
}

export async function hasAppDataOf(app: FastifyInstance): Promise<boolean> {
  const res = await app.inject({ method: 'GET', url: '/api/import/runs' });
  return res.json<ImportRunsResponse>().hasAppData;
}
