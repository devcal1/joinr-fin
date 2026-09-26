// The clean synthetic workbook (stage-1.md §7.3 step 6): zero unexplained, the expected rows and
// counts, idempotent re-import, dry runs, and the run bookkeeping.
import { REPORT_SECTIONS, ReconciliationReportSchema, totalsOf } from '@joinr/schema';
import { importRuns, instruments, priceSources, prices, settings } from '@joinr/schema/db';
import {
  createTestDb,
  dumpDomainTables,
  dumpDomainTablesJson,
  type TestDb,
} from '@joinr/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMPORTER_VERSION } from '../src/index';
import { buildSyntheticWorkbook, SYNTHETIC_FACTS } from '../src/testing/syntheticWorkbook';
import { checkById, FIXED_NOW, problems, reportOf, runImport } from './helpers';

const CLEAN = buildSyntheticWorkbook();

describe('importWorkbook: clean synthetic workbook', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it('reconciles with zero unexplained checks and a valid report', () => {
    const result = runImport(t.db, CLEAN);
    const report = reportOf(result);
    expect(problems(report)).toEqual([]);
    expect(report.totals.unexplained).toBe(0);
    expect(report.totals).toEqual(totalsOf(report.checks));
    expect(ReconciliationReportSchema.safeParse(report).success).toBe(true);
    expect(new Set(report.checks.map((c) => c.id)).size).toBe(report.checks.length);
    // Sections appear in report order.
    const order = report.checks.map((c) => REPORT_SECTIONS.indexOf(c.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(report.workbook).toMatchObject({
      fileName: 'synthetic.xlsx',
      asOf: SYNTHETIC_FACTS.asOf,
      templateVersion: '2.15.4',
    });
    expect(report.corrections).toEqual({ name: null, sha256: null, entries: 0, applied: 0 });
  });

  it('writes the expected rows per entity', () => {
    const report = reportOf(runImport(t.db, CLEAN));
    expect(report.counts).toEqual({
      instruments: 8,
      trades: 17,
      dividends: 4,
      'cash-accounts': 4,
      'cash-balance-entries': 4,
      'budget-items': 8,
      'yearly-expenses': 3,
      'income-streams': 2,
      // Deposits (D57): the 7 non-zero of the 9 numeric Side Income G/H cells.
      'side-income': 7,
      'period-notes': 7,
      snapshots: 5,
      'other-assets': 6,
      'super-funds': 2,
      // Super!B11 and B16, plus the 4 History-derived contributions (Stage 4, §3.5 item 2).
      'super-entries': 6,
      properties: 1,
      loans: 2,
      settings: 50,
      // Stage 4 (stage-4.md §3.5): the 4 manual rows with a price, one entry per fund, property
      // and loan.
      'other-asset-prices': 4,
      'super-balance-entries': 2,
      'property-valuations': 1,
      'loan-balance-entries': 2,
    });
    const counts = report.checks.filter((c) => c.section === 'counts');
    expect(counts.every((c) => c.status === 'match' || c.status === 'explained')).toBe(true);
    expect(checkById(report, 'counts.instruments.managed_fund')).toMatchObject({
      status: 'explained',
      expected: 5,
      actual: 1,
      // Plain words, not reason codes.
      reason:
        'Not imported as instruments: bullion feed rows ×2, duplicate listings ×1, price-feed rows ×1',
    });
    const symbols = t.db
      .select()
      .from(instruments)
      .all()
      .map((i) => `${i.kind}:${i.symbol}:${i.isWatched ? 'w' : 'l'}`);
    expect(symbols).toEqual([
      'stock:ASX:ABC:w',
      'stock:ASX:XYZ:w',
      'etf:ASX:DEF:w',
      'etf:ASX:MNO:w',
      'etf:ASX:OLD:l',
      'managed_fund:EXAMPLEFUND:w',
      'crypto:BTC:w',
      'crypto:ETH:w',
    ]);
  });

  it('reports every snapshot value column as matching', () => {
    const report = reportOf(runImport(t.db, CLEAN));
    const values = report.checks.filter((c) => c.id.startsWith('snapshots.values.'));
    expect(values.map((c) => c.id)).toEqual(
      SYNTHETIC_FACTS.snapshotPeriods.map((p) => `snapshots.values.${p}`),
    );
    expect(values.every((c) => c.status === 'match' && c.actual === 36)).toBe(true);
    // Labels show month names (the ids keep the ISO month).
    for (const v of values) {
      expect(v.label).toMatch(
        /^Snapshot (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} values$/,
      );
    }
    expect(checkById(report, 'workbook.historyHeaders').status).toBe('match');
  });

  it('explains the template quirks it meets', () => {
    const report = reportOf(runImport(t.db, CLEAN));
    const expectCheck = (id: string, fields: Record<string, unknown>) =>
      expect(checkById(report, id)).toMatchObject(fields);
    expectCheck('holdings.value.etf', {
      status: 'explained',
      reasonCode: 'sheet_error_value',
      expected: 0,
      actual: 54270,
    });
    expectCheck('holdings.price.etf.ASX:MNO', {
      status: 'explained',
      reasonCode: 'sheet_error_value',
    });
    expectCheck('holdings.price.crypto.BTC', {
      status: 'explained',
      reasonCode: 'sheet_error_value',
    });
    expectCheck('holdings.priceFormula.ETFs!D3', { status: 'info', reasonCode: 'feed_row' });
    expectCheck('netWorth.totalAssets', {
      status: 'explained',
      reasonCode: 'sheet_error_value',
      diff: 54270,
    });
    expectCheck('netWorth.total', { status: 'explained', diff: 54270 });
    expectCheck('dividends.link.5', {
      status: 'explained',
      reasonCode: 'dividend_rekeyed',
      actual: 'ASX:DEF',
    });
    expectCheck('budget.account.13', {
      status: 'suspect',
      reasonCode: 'unmatched_account',
      label: 'Bank account for Budget!A13',
    });
    expectCheck('budget.skipped.Budget!A8', { status: 'info', reasonCode: 'unnamed_row' });
    expectCheck('property.placeholderSlots', {
      status: 'info',
      reasonCode: 'placeholder_slot',
      expected: 11,
    });
    expectCheck('property.paymentsPaidDerived.Property!D30', {
      status: 'info',
      reasonCode: 'derived_input',
    });
    expectCheck('snapshots.skipped.History!A8', { status: 'info', reasonCode: 'live_row_skipped' });
    for (const id of [
      'settings.budget.emergencyFundOverrideCents',
      'settings.charts.unitCount',
      'settings.fire.yearlySpendOverrideCents',
    ]) {
      expectCheck(id, {
        status: 'info',
        reasonCode: 'formula_default',
        expected: null,
        actual: null,
        diff: null,
      });
    }
    expectCheck('liabilities.skipped.LiabilitiesDebts!G11', {
      status: 'info',
      reasonCode: 'feature_dropped',
    });
    expectCheck('income.skipped.Side Income!F7', { status: 'info', reasonCode: 'blank_row' });
    expectCheck('ledgers.skipped.ETFs!A27', {
      status: 'info',
      reasonCode: 'blank_row',
      expected: 1,
    });
    const stored = t.db
      .select()
      .from(settings)
      .all()
      .map((s) => s.key);
    expect(stored).not.toContain('budget.emergencyFundOverrideCents');
    expect(stored).not.toContain('charts.unitCount');
    expect(stored).not.toContain('fire.yearlySpendOverrideCents');
  });

  it('records the run as succeeded with its totals and report', () => {
    const result = runImport(t.db, CLEAN);
    const runs = t.db.select().from(importRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: result.runId,
      status: 'succeeded',
      dryRun: false,
      trigger: 'cli',
      fileName: 'synthetic.xlsx',
      fileSize: CLEAN.byteLength,
      workbookAsOf: SYNTHETIC_FACTS.asOf,
      importerVersion: IMPORTER_VERSION,
      startedAt: FIXED_NOW.toISOString(),
      errorCode: null,
    });
    expect(runs[0]!.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(runs[0]!.totalsJson!)).toEqual(result.report!.totals);
    expect(JSON.parse(runs[0]!.reportJson!)).toEqual(result.report);
  });

  it('is idempotent: the same bytes twice give identical tables and checks', () => {
    const first = reportOf(runImport(t.db, CLEAN));
    const dump = dumpDomainTables(t.db);
    const second = reportOf(
      runImport(t.db, CLEAN, { now: () => new Date('2026-04-01T00:00:00.000Z') }),
    );
    expect(dumpDomainTables(t.db)).toEqual(dump);
    const view = (r: typeof first) =>
      r.checks.map((c) => [c.id, c.status, c.expected, c.actual, c.diff]);
    expect(view(second)).toEqual(view(first));
    expect(second.counts).toEqual(first.counts);
  });

  it('dry runs roll back but record the run', () => {
    reportOf(runImport(t.db, CLEAN));
    const before = dumpDomainTablesJson(t.db);
    const dry = runImport(t.db, CLEAN, {
      dryRun: true,
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });
    expect(dry.status).toBe('succeeded');
    expect(dry.dryRun).toBe(true);
    expect(dry.report?.totals.unexplained).toBe(0);
    expect(dumpDomainTablesJson(t.db)).toBe(before);
    const runs = t.db.select().from(importRuns).all();
    expect(runs.map((r) => [r.status, r.dryRun])).toEqual([
      ['succeeded', false],
      ['succeeded', true],
    ]);
  });

  it('dry runs on an empty database write nothing', () => {
    const dry = runImport(t.db, CLEAN, { dryRun: true });
    expect(dry.report?.counts.trades).toBe(17);
    expect(t.db.select().from(instruments).all()).toHaveLength(0);
    expect(t.db.select().from(settings).all()).toHaveLength(0);
  });

  it('seeds workbook prices and imports typed prices as manual prices', () => {
    runImport(t.db, CLEAN);
    const inst = new Map(
      t.db
        .select()
        .from(instruments)
        .all()
        .map((i) => [i.symbol, i.id]),
    );
    const allPrices = t.db.select().from(prices).all();
    const allSources = t.db.select().from(priceSources).all();
    const price = (s: string) => allPrices.find((p) => p.instrumentId === inst.get(s));
    const source = (s: string) => allSources.find((p) => p.instrumentId === inst.get(s));
    expect(price('ASX:ABC')).toMatchObject({
      price: '12.5',
      source: 'sheet',
      lastStatus: 'ok',
      asOf: `${SYNTHETIC_FACTS.asOf}T00:00:00Z`,
    });
    expect(source('ASX:ABC')).toMatchObject({
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
      symbolOrigin: 'derived',
      manualPrice: null,
    });
    // The gold-style ETF (D22): its own listing, no workbook price.
    expect(price('ASX:MNO')).toBeUndefined();
    expect(source('ASX:MNO')).toMatchObject({ provider: 'yahoo', providerSymbol: 'MNO.AX' });
    // A typed fund price: manual, no seeded price, no provider.
    expect(price('EXAMPLEFUND')).toBeUndefined();
    expect(source('EXAMPLEFUND')).toMatchObject({
      provider: 'none',
      manualPrice: '1.2345',
      manualOrigin: 'import',
      manualPriceAsOf: SYNTHETIC_FACTS.asOf,
    });
    // Crypto: known CoinGecko ids, no sheet price (an error value / a spill that was not exported).
    expect(source('BTC')).toMatchObject({ provider: 'coingecko', providerSymbol: 'bitcoin' });
    expect(price('BTC')).toBeUndefined();
    expect(price('ETH')).toBeUndefined();
  });
});
