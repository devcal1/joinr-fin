// The UI fixtures are typed with the frozen DTOs (`satisfies` in the source) and valid where a
// schema exists; they also cover every state the pages render.
import { describe, expect, it } from 'vitest';
import {
  CHECK_STATUSES,
  CHECK_UNITS,
  MARKET_DATA_MODES,
  PRICE_STATUSES,
  RECORD_ENTITIES,
  RECORD_ENTITY_IDS,
  ReconciliationReportSchema,
  RUN_STATUSES,
  API_ERROR_CODES,
  isApiErrorBody,
} from '../src/index';
import * as f from '../src/fixtures/index';

describe('record fixtures', () => {
  it('have one page per entity whose rows cover every registry column', () => {
    for (const id of RECORD_ENTITY_IDS) {
      const page = f.recordsPages[id];
      expect(page.entity.id).toBe(id);
      expect(page.columns).toEqual(RECORD_ENTITIES[id].columns);
      expect(page.rows.length, id).toBeGreaterThan(0);
      expect(page.entity.count).toBe(page.rows.length);
      for (const row of page.rows) {
        expect(Object.keys(row.cells).sort(), `${id} row ${row.id}`).toEqual(
          page.columns.map((c) => c.id).sort(),
        );
      }
    }
    expect(f.recordsIndex.entities.map((e) => e.id)).toEqual([...RECORD_ENTITY_IDS]);
    expect(f.recordsIndexEmpty.entities.every((e) => e.count === 0)).toBe(true);
    expect(f.recordsPageEmpty.rows).toEqual([]);
  });

  it('include every column type, nulls and flags', () => {
    const types = new Set(
      RECORD_ENTITY_IDS.flatMap((id) => f.recordsPages[id].columns.map((c) => c.type)),
    );
    expect([...types].sort()).toEqual(
      [
        'boolean',
        'date',
        'flags',
        'integer',
        'money',
        'month',
        'price',
        'quantity',
        'ratio',
        'setting',
        'text',
        'timestamp',
      ].sort(),
    );
    const settingTypes = new Set(f.recordsPages.settings.rows.map((r) => r.valueType));
    expect([...settingTypes].sort()).toEqual([
      'boolean',
      'date',
      'enum',
      'integer',
      'money',
      'ratio',
    ]);
  });
});

describe('import fixtures', () => {
  it('have valid reports covering every status and unit', () => {
    for (const report of [f.sampleReport, f.sampleDryRunReport]) {
      expect(ReconciliationReportSchema.safeParse(report).success).toBe(true);
    }
    expect(new Set(f.sampleReport.checks.map((c) => c.status))).toEqual(new Set(CHECK_STATUSES));
    expect(new Set(f.sampleReport.checks.map((c) => c.unit))).toEqual(new Set(CHECK_UNITS));
    expect(f.sampleDryRunReport.totals.unexplained).toBe(0);
    const totals = f.sampleReport.totals;
    expect(
      totals.match + totals.explained + totals.unexplained + totals.suspect + totals.info,
    ).toBe(f.sampleReport.checks.length);
  });

  it('cover every run status and keep summaries consistent with details', () => {
    expect(new Set(f.FIXTURE_COVERAGE.runStatuses)).toEqual(new Set(RUN_STATUSES));
    expect(f.importRunDryRun.dryRun).toBe(true);
    expect(f.importRunFailed.error?.code).toBe('INVALID_WORKBOOK');
    expect(f.importRunsEmpty.runs).toEqual([]);
    for (const list of [f.importRunsPopulated, f.importRunsInProgress, f.importRunsWithAppData]) {
      for (const run of list.runs) {
        expect(run).not.toHaveProperty('report');
        const detail = f.importRunDetails[run.id];
        expect(detail).toMatchObject(run);
      }
    }
    expect(f.importRunsInProgress.runs[0]?.status).toBe('running');
  });

  it('have runs responses with and without app-entered data', () => {
    for (const list of [f.importRunsEmpty, f.importRunsPopulated, f.importRunsInProgress]) {
      expect(list.hasAppData).toBe(false);
    }
    expect(f.importRunsWithAppData).toMatchObject({ hasImportedData: true, hasAppData: true });
    expect(f.apiErrors.appDataExists.error.code).toBe('IMPORT_APP_DATA_EXISTS');
    expect(API_ERROR_CODES).toContain(f.apiErrors.appDataExists.error.code);
  });
});

describe('price fixtures', () => {
  it('cover every price status and market data mode', () => {
    expect(new Set(f.FIXTURE_COVERAGE.priceStatuses)).toEqual(new Set(PRICE_STATUSES));
    expect(Object.keys(f.pricesByMode).sort()).toEqual([...MARKET_DATA_MODES].sort());
    for (const mode of MARKET_DATA_MODES) expect(f.pricesByMode[mode].mode).toBe(mode);
    expect(f.pricesEmpty.items).toEqual([]);
    expect(f.pricesRunning.running).toBe(true);
    expect(new Set(f.marketSeries.map((s) => s.status))).toEqual(
      new Set(['fresh', 'stale', 'failed']),
    );
    expect(f.marketSeriesEmpty.every((s) => s.status === 'none' && s.value === null)).toBe(true);
    expect(f.refreshResponse.summary.ok + f.refreshResponse.summary.failed).toBe(
      f.refreshResponse.summary.requested,
    );
  });

  it('order items held first, then by kind', () => {
    const held = f.priceItems.map((i) => i.held);
    expect(held).toEqual([...held].sort((a, b) => Number(b) - Number(a)));
  });
});

describe('status and error fixtures', () => {
  it('have the empty and populated header states', () => {
    expect(f.appStatusEmpty.prices.lastRefreshAt).toBeNull();
    expect(f.appStatusEmpty.snapshots.latestPeriod).toBeNull();
    expect(f.appStatusPopulated.import.hasImportedData).toBe(true);
    for (const body of Object.values(f.apiErrors)) expect(isApiErrorBody(body)).toBe(true);
  });
});
