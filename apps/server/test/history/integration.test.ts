// Integration with the REAL engine (stage-5.md §7.4 step 7), gated on HISTORY_ENGINE_IMPLEMENTED
// (and the Stage 2–4 flags): the generic seed (and the synthetic workbook once the Stage 5 importer
// lands) builds every Stage 5 response; a month recorded through the route (the real recorder,
// market off) equals the live row shown just before and closes every page's provisional period
// that day (its savings period equals the provisional period shown before); the dashboard then says
// "recorded today" with the change against the month before; and record → correct → delete leaves
// `dumpDomainTables` identical. Generic values only.
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
  IMPORTER_STAGE4_IMPLEMENTED,
  IMPORTER_STAGE5_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import type {
  CashPageResponse,
  CorrectionResponse,
  DeleteSnapshotResponse,
  HistoryPageResponse,
  HistorySeriesResponse,
  NetWorthPageResponse,
  PropertyPageResponse,
  RecordResponse,
  SavingsPeriodDto,
  SettingsPageResponse,
  SuperPageResponse,
} from '@joinr/schema';
import { dumpDomainTables, seedGenericData } from '@joinr/schema/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { AS_OF, NOW } from '../investments/helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED;
const CAN_IMPORT =
  SYNTHETIC_WORKBOOK_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED &&
  IMPORTER_STAGE5_IMPLEMENTED;

describe.skipIf(!GATED)('history API with the real engine', { timeout: 60_000 }, () => {
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

  /** Every Stage 5 response, with the invariants that hold for any data. */
  async function everyPage() {
    const netWorth = await get<NetWorthPageResponse>('/api/net-worth');
    expect(netWorth.assetsCents - netWorth.liabilitiesCents).toBe(
      netWorth.live.netWorth.netWorthCents,
    );
    const history = await get<HistoryPageResponse>('/api/history');
    // Every snapshot is checked; the headline counts are the rows' sums.
    expect(history.consistency.checked).toBe(
      history.snapshots.reduce((sum, x) => sum + x.check.checked, 0),
    );
    expect(history.consistency.checked).toBeGreaterThan(0);
    for (const unit of ['monthly', 'quarterly', 'yearly'] as const) {
      const series = await get<HistorySeriesResponse>(`/api/history/series?unit=${unit}`);
      expect(series.unit).toBe(unit);
      expect(series.groups.length).toBeGreaterThan(0);
    }
    const settingsPage = await get<SettingsPageResponse>('/api/settings');
    expect(settingsPage.settings).toHaveLength(63);
    return { netWorth, history, settingsPage };
  }

  const provisional = (cash: CashPageResponse): SavingsPeriodDto | undefined =>
    cash.periods.find((p) => p.status === 'provisional');

  it('builds every Stage 5 page on the seed', async () => {
    seedGenericData(database.db, { now: NOW });
    const { netWorth, history } = await everyPage();
    expect(netWorth.recordedToday).toBe(false);
    expect(netWorth.liveMonth).toBe('2026-08');
    expect(history.live?.periodMonth).toBe('2026-08');
    expect(history.snapshots).toHaveLength(3);
    // The seed's migrated months carry round generic ratios (not derived from their cents), so
    // only their count is asserted here; the synthetic workbook and the golden check reproduction.
    expect(history.consistency.migratedMonths).toBe(3);
    expect(netWorth.rolling.filter((r) => r.status === 'projected').length).toBeLessThanOrEqual(12);
  });

  it('a recorded month equals the live row and closes every provisional period that day', async () => {
    seedGenericData(database.db, { now: NOW });
    const before = await get<HistoryPageResponse>('/api/history');
    const cashBefore = await get<CashPageResponse>('/api/cash');
    const live = before.live!;
    const provisionalBefore = provisional(cashBefore)!;
    expect(provisionalBefore.periodMonth).toBe(live.periodMonth);

    const recorded = await inject<RecordResponse>(
      {
        method: 'POST',
        url: '/api/history/record',
        payload: { periodMonths: [live.periodMonth], note: null },
      },
      201,
    );
    expect(recorded.hasAppData).toBe(true);
    expect(recorded.recorded).toHaveLength(1);
    const month = recorded.recorded[0]!;
    expect(month).toMatchObject({
      periodMonth: live.periodMonth,
      runDate: AS_OF,
      source: 'lookback',
    });
    // Every figure equals the live row shown just before (market off: no price moved).
    expect(month.figures).toEqual(live.figures);
    expect(month.check.differences.filter((d) => d.kind === 'derived')).toEqual([]);

    // No provisional period that day; the new closed period equals the provisional one shown before.
    const cash = await get<CashPageResponse>('/api/cash');
    expect(provisional(cash)).toBeUndefined();
    const closed = cash.periods.find((p) => p.periodMonth === live.periodMonth)!;
    expect(closed.status).toBe('closed');
    expect(closed.adjusted).toEqual(provisionalBefore.adjusted);
    expect(closed.raw).toEqual(provisionalBefore.raw);
    const sup = await get<SuperPageResponse>('/api/super');
    expect(sup.periods.some((p) => p.status === 'provisional')).toBe(false);
    const property = await get<PropertyPageResponse>('/api/property');
    expect(property.lastRun).toBe(AS_OF);

    // The dashboard: recorded today, the change against the month before.
    const netWorth = await get<NetWorthPageResponse>('/api/net-worth');
    expect(netWorth.recordedToday).toBe(true);
    expect(netWorth.sinceLastRecord.base?.periodMonth).toBe('2026-07');
    expect(netWorth.charts.groups.some((g) => g.live)).toBe(false);
    // A second record of the month is refused.
    const again = await app.inject({
      method: 'POST',
      url: '/api/history/record',
      payload: { periodMonths: [live.periodMonth], note: null },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('SNAPSHOT_EXISTS');
  });

  it('record → correct → delete leaves the domain tables unchanged', async () => {
    seedGenericData(database.db, { now: NOW });
    const baseline = dumpDomainTables(database.db);
    const recorded = await inject<RecordResponse>(
      {
        method: 'POST',
        url: '/api/history/record',
        payload: { periodMonths: ['2026-09'], note: 'Test' },
      },
      201,
    );
    const month = recorded.recorded[0]!;
    expect(month.source).toBe('recorded');
    const corrected = await inject<CorrectionResponse>({
      method: 'PUT',
      url: '/api/history/snapshots/2026-09',
      payload: {
        values: { cashValueCents: (month.figures.cashValueCents ?? 0) + 100 },
        note: 'Fix',
      },
    });
    expect(corrected.snapshot.revision).toBe(1);
    expect(corrected.snapshot.check.differences.filter((d) => d.kind === 'derived')).toEqual([]);
    const deleted = await inject<DeleteSnapshotResponse>({
      method: 'DELETE',
      url: '/api/history/snapshots/2026-09',
    });
    expect(deleted.hasAppData).toBe(false);
    expect(dumpDomainTables(database.db)).toEqual(baseline);
    const history = await get<HistoryPageResponse>('/api/history');
    expect(history.audit.map((a) => a.action)).toEqual(['delete', 'correct', 'record']);
    expect(history.record.recordable).toContain('2026-09');
  });

  it.skipIf(!CAN_IMPORT)(
    'builds every Stage 5 page after importing the synthetic workbook',
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/import',
        payload: Buffer.from(buildSyntheticWorkbook()),
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(res.statusCode).toBe(201);
      const { history } = await everyPage();
      expect(history.snapshots.length).toBeGreaterThan(0);
      expect(history.snapshots.every((s) => s.source === 'migrated')).toBe(true);
      expect(history.consistency.derivedMatchedMonths).toBe(history.consistency.migratedMonths);
    },
  );
});
