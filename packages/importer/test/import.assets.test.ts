// Stage 4 importer changes (stage-4.md §3.5, §7.6) on the generic synthetic workbook: price
// entries for manual other assets (D72), the FX rate at purchase, one balance entry per fund, per
// property (a valuation) and per loan with the last-run date rule (SPEC-16), the Super!B16 entry
// date, History-derived contributions (one per kept snapshot; the D37 exclusion), the fund that
// receives SG kept across a re-import, and the new and re-pointed reconciliation checks.
import {
  loanBalanceEntries,
  loans,
  otherAssetPrices,
  otherAssets,
  propertyValuations,
  superBalanceEntries,
  superEntries,
  superFunds,
} from '@joinr/schema/db';
import { createTestDb, dumpDomainTables, type TestDb } from '@joinr/schema/testing';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lastDayOfMonth, purchaseFxRateOf } from '../src/extract';
import {
  carrySgFund,
  derivedContributionCents,
  matchStoredRows,
  retirementBuysCents,
  snapshotWindows,
  type RetirementTradeLike,
} from '../src/process';
import { IMPORTER_STAGE4_IMPLEMENTED } from '../src/testing/index';
import {
  buildSyntheticWorkbook,
  SYNTHETIC_FACTS,
  SYNTHETIC_HISTORY_TMP,
} from '../src/testing/syntheticWorkbook';
import {
  all,
  num,
  serial,
  set,
  shiftOtherAssetTotals,
  str,
  withForeignRow,
  withLiveTotalsUnchanged,
  withNegativeHandPrice,
  withRetirementContributions,
  withRetirementTaggedEtf,
} from './assets-helpers';
import { checkById, problems, reportOf, runImport } from './helpers';

const { asOf: AS_OF, lastRun: LAST_RUN } = SYNTHETIC_FACTS;
const LATER = () => new Date('2026-04-02T03:04:05.000Z');

it('is flagged implemented for the gated server suites (§3.5 item 7)', () => {
  expect(IMPORTER_STAGE4_IMPLEMENTED).toBe(true);
});

// ─── Pure helpers ────────────────────────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('derives the purchase rate as N ÷ (M × J) with 12 significant digits', () => {
    expect(purchaseFxRateOf(450, 1, '300')).toBe('1.5');
    expect(purchaseFxRateOf(10, 3, '2')).toBe('1.66666666667');
    // Per penny for a GBX row (N already carries the × 0.01).
    expect(purchaseFxRateOf(100 * 0.019, 1, '100')).toBe('0.019');
    expect(purchaseFxRateOf(null, 1, '300')).toBeNull();
    expect(purchaseFxRateOf(450, null, '300')).toBeNull();
    expect(purchaseFxRateOf(450, 1, null)).toBeNull();
    expect(purchaseFxRateOf(0, 0, '300')).toBeNull();
    expect(purchaseFxRateOf(450, 1, '0')).toBeNull();
    expect(purchaseFxRateOf(-450, 1, '300')).toBeNull();
  });

  it('knows the last day of a month', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('matches stored rows by a unique name, else by sheet ref and name', () => {
    const row = (name: string, sheetRef: string | null) => ({ name, sheetRef });
    // A unique name wins even when the row moved.
    expect(
      matchStoredRows(
        [row('Fund A', 'Super!A2'), row('Fund B', 'Super!A3')],
        [row('Fund B', 'Super!A2'), row(' Fund A ', 'Super!A4'), row('Fund C', 'Super!A3')],
      ),
    ).toEqual([1, 0, -1]);
    // A repeated name falls back to the sheet ref (each stored row matched once).
    expect(
      matchStoredRows(
        [row('Same', 'Super!A2'), row('Same', 'Super!A3')],
        [row('Same', 'Super!A3'), row('Same', 'Super!A2')],
      ),
    ).toEqual([1, 0]);
    expect(
      matchStoredRows([row('Same', 'Super!A2'), row('Same', null)], [row('Same', 'Super!A5')]),
    ).toEqual([-1]);
  });

  it('carries the SG flag to the continuing fund only, and counts one it cannot carry', () => {
    const fund = (name: string, sheetRef: string, receivesSg = false) => ({
      name,
      sheetRef,
      receivesSg,
    });
    expect(
      carrySgFund(
        [fund('Fund A', 'Super!A2'), fund('Fund B', 'Super!A3', true)],
        [
          { name: 'Fund B', sheetRef: 'Super!A2' },
          { name: 'Fund A', sheetRef: 'Super!A3' },
        ],
      ),
    ).toEqual({ receivesSg: [true, false], notCarried: 0 });
    expect(
      carrySgFund(
        [fund('Fund A', 'Super!A2', true)],
        [{ name: 'Fund A renamed', sheetRef: 'Super!A2' }],
      ),
    ).toEqual({ receivesSg: [false], notCarried: 1 });
    expect(carrySgFund([], [{ name: 'Fund A', sheetRef: 'Super!A2' }])).toEqual({
      receivesSg: [false],
      notCarried: 0,
    });
  });

  it('sums the Retirement-tagged buys of a window (Stocks, ETFs and Managed Funds only)', () => {
    const t = (over: Partial<RetirementTradeLike>): RetirementTradeLike => ({
      kind: 'etf',
      date: '2026-01-10',
      units: '2',
      price: '10.5',
      retirement: true,
      ...over,
    });
    const trades = [
      t({}),
      t({ kind: 'stock', units: '1', price: '4' }),
      t({ kind: 'managed_fund', units: '3', price: '1.1' }),
      t({ kind: 'crypto', units: '1', price: '100' }), // never in R
      t({ units: '-1' }), // a sell
      t({ retirement: false }), // not tagged
      t({ date: '2025-12-31' }), // before the window
      t({ date: '2026-02-01' }), // after the window
    ];
    expect(retirementBuysCents(trades, '2025-12-31', '2026-01-31')).toBe(2100 + 400 + 330);
    expect(retirementBuysCents(trades, '2026-01-31', '2026-02-28')).toBe(2100);
  });

  it('subtracts the exclusion from R only when switched on, never below 0', () => {
    expect(derivedContributionCents(10000, 495, true)).toBe(9505);
    expect(derivedContributionCents(10000, 495, false)).toBe(10000);
    expect(derivedContributionCents(500, 1000, true)).toBe(0);
    expect(derivedContributionCents(10000, 0, true)).toBe(10000);
  });

  it('builds the snapshot windows in run-date order, the first one month long', () => {
    const w = snapshotWindows([
      { runDate: '2026-02-28' },
      { runDate: '2025-12-31' },
      { runDate: '2026-01-31' },
    ]);
    expect(w.map(({ from, to }) => [from, to])).toEqual([
      ['2025-11-30', '2025-12-31'],
      ['2025-12-31', '2026-01-31'],
      ['2026-01-31', '2026-02-28'],
    ]);
  });
});

// ─── Imports ─────────────────────────────────────────────────────────────────────────────────────

describe('importWorkbook: Stage 4 rows', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  const assetsByRef = () =>
    new Map(
      t.db
        .select()
        .from(otherAssets)
        .all()
        .map((a) => [a.sheetRef, a]),
    );
  const fundRows = () => t.db.select().from(superFunds).orderBy(asc(superFunds.id)).all();
  const entryRows = () => t.db.select().from(superEntries).orderBy(asc(superEntries.id)).all();
  const loanRows = () => t.db.select().from(loans).orderBy(asc(loans.id)).all();

  describe('other assets (D72)', () => {
    it('writes one price entry per manual row with a price, never for bullion rows', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      expect(problems(report)).toEqual([]);
      const assets = assetsByRef();
      const entries = t.db.select().from(otherAssetPrices).orderBy(asc(otherAssetPrices.id)).all();
      expect(entries.map((e) => [e.sheetRef, e.asOf, e.unitPrice, e.note, e.origin])).toEqual([
        ['Other Assets!F3', AS_OF, '150', null, 'import'],
        ['Other Assets!F4', AS_OF, '25.5', null, 'import'],
        ['Other Assets!F6', AS_OF, '320', null, 'import'],
        ['Other Assets!F9', AS_OF, '55', null, 'import'],
      ]);
      for (const e of entries) {
        const asset = assets.get(e.sheetRef)!;
        expect(e.otherAssetId).toBe(asset.id);
        // The asset's price and date are the latest entry's (the denormalised copy).
        expect([asset.unitPrice, asset.unitPriceAsOf]).toEqual([e.unitPrice, e.asOf]);
      }
      expect(assets.get('Other Assets!F7')?.priceSource).toBe('bullion');
      expect(entries.some((e) => e.sheetRef === 'Other Assets!F7')).toBe(false);
      expect(checkById(report, 'counts.other-asset-prices')).toMatchObject({
        status: 'match',
        expected: 4,
        actual: 4,
      });
      // AUD rows carry no purchase rate.
      expect(
        [...assets.values()].every(
          (a) =>
            a.purchaseFxRate === null && a.purchaseFxSource === null && a.purchaseFxDate === null,
        ),
      ).toBe(true);
    });

    it('leaves a negative hand price out of the price history with an info line', () => {
      const bytes = buildSyntheticWorkbook({ mutate: withNegativeHandPrice });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(t.db.select().from(otherAssetPrices).all()).toHaveLength(3);
      expect(assetsByRef().get('Other Assets!F9')?.unitPrice).toBe('-5');
      expect(checkById(report, 'otherAssets.negativePrice.Other Assets!K9')).toMatchObject({
        status: 'info',
        reasonCode: 'unsupported_value',
      });
      expect(checkById(report, 'counts.other-asset-prices').status).toBe('match');
    });

    it('stores the FX rate at purchase from N ÷ (M × J) and checks value, gain and cost', () => {
      const bytes = buildSyntheticWorkbook({
        mutate: withForeignRow({ row: 6, currency: 'USD', purchaseRate: 1.5, liveRate: 1.6 }),
      });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(assetsByRef().get('Other Assets!F6')).toMatchObject({
        currency: 'USD',
        unitCost: '300',
        purchaseFxRate: '1.5',
        purchaseFxSource: 'import',
        purchaseFxDate: '2025-06-01',
      });
      // D3, D4 and Σ N through the sheet's own live rate O ÷ (M × K) and the imported purchase rate.
      expect(checkById(report, 'otherAssets.value')).toMatchObject({
        status: 'match',
        expected: 153000,
        actual: 153000,
      });
      expect(checkById(report, 'otherAssets.gain')).toMatchObject({
        status: 'match',
        expected: 17800,
        actual: 17800,
      });
      expect(checkById(report, 'otherAssets.cost')).toMatchObject({
        status: 'match',
        expected: 135200,
        actual: 135200,
      });
      expect(checkById(report, 'netWorth.otherAssets').status).toBe('match');
    });

    it('stores a GBX row’s per-penny rate and leaves the date of an undated row blank', () => {
      const bytes = buildSyntheticWorkbook({
        mutate: withForeignRow({ row: 3, currency: 'GBX', purchaseRate: 0.019, liveRate: 0.02 }),
      });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(assetsByRef().get('Other Assets!F3')).toMatchObject({
        currency: 'GBX',
        purchaseFxRate: '0.019',
        purchaseFxSource: 'import',
        purchaseFxDate: null,
      });
      for (const id of ['otherAssets.value', 'otherAssets.gain', 'otherAssets.cost']) {
        expect(checkById(report, id).status).toBe('match');
      }
    });

    it('leaves the rate for the backfill when the sheet has no cached purchase value', () => {
      const bytes = buildSyntheticWorkbook({
        mutate: all(
          withForeignRow({ row: 6, currency: 'USD', purchaseRate: 1.5, liveRate: 1.6 }),
          (wb) => {
            // GOOGLEFINANCE failed on the purchase date: N and P are error values.
            set(wb, 'Other Assets', 'N6', str('#N/A'));
            set(wb, 'Other Assets', 'P6', str('#N/A'));
            shiftOtherAssetTotals(wb, 0, -(512 - 450));
          },
        ),
      });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(assetsByRef().get('Other Assets!F6')).toMatchObject({
        purchaseFxRate: null,
        purchaseFxSource: null,
        purchaseFxDate: null,
      });
      // The row's cost is unknown on both sides; its value still goes through the live rate.
      expect(checkById(report, 'otherAssets.cost')).toMatchObject({
        status: 'match',
        expected: 135200 - 45000,
      });
      expect(checkById(report, 'otherAssets.value').status).toBe('match');
      expect(checkById(report, 'otherAssets.gain').status).toBe('match');
    });

    it('reports a non-AUD row without a cached value as info, never unexplained', () => {
      const bytes = buildSyntheticWorkbook({
        mutate: all(
          withForeignRow({ row: 6, currency: 'USD', purchaseRate: 1.5, liveRate: 1.6 }),
          (wb) => {
            set(wb, 'Other Assets', 'O6', str('#N/A'));
            set(wb, 'Other Assets', 'P6', str('#N/A'));
          },
        ),
      });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(assetsByRef().get('Other Assets!F6')?.purchaseFxRate).toBe('1.5');
      for (const id of ['otherAssets.value', 'otherAssets.gain', 'netWorth.otherAssets']) {
        expect(checkById(report, id)).toMatchObject({
          status: 'info',
          reason: expect.stringContaining('non-AUD') as unknown,
        });
      }
      expect(checkById(report, 'otherAssets.cost').status).toBe('match');
    });
  });

  describe('super (D69, D71)', () => {
    it('writes one balance entry per fund at the as-of when the live total moved', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      const funds = fundRows();
      const entries = t.db
        .select()
        .from(superBalanceEntries)
        .orderBy(asc(superBalanceEntries.id))
        .all();
      expect(entries.map((e) => [e.fundId, e.asOf, e.balanceCents, e.transferInCents])).toEqual(
        funds.map((f) => [f.id, AS_OF, f.balanceCents, null]),
      );
      expect(entries.map((e) => [e.sheetRef, e.origin, e.note])).toEqual([
        ['Super!A2', 'import', null],
        ['Super!A3', 'import', null],
      ]);
      expect(funds.map((f) => [f.balanceAsOf, f.receivesSg])).toEqual([
        [AS_OF, false],
        [AS_OF, false],
      ]);
      expect(checkById(report, 'counts.super-balance-entries')).toMatchObject({
        status: 'match',
        expected: 2,
      });
    });

    it('dates the funds’ entries at the last run when the live total equals the last snapshot’s', () => {
      const report = reportOf(
        runImport(t.db, buildSyntheticWorkbook({ mutate: withLiveTotalsUnchanged })),
      );
      expect(problems(report)).toEqual([]);
      const entries = t.db.select().from(superBalanceEntries).all();
      expect(entries.map((e) => e.asOf)).toEqual([LAST_RUN, LAST_RUN]);
      expect(fundRows().map((f) => f.balanceAsOf)).toEqual([LAST_RUN, LAST_RUN]);
    });

    it('dates the Super!B16 entry at min(its month end, the as-of)', () => {
      runImport(t.db, buildSyntheticWorkbook());
      const b16 = entryRows().find((e) => e.sheetRef === 'Super!B16')!;
      expect(b16).toMatchObject({
        kind: 'voluntary_contribution',
        periodMonth: '2026-03',
        entryDate: AS_OF,
        amountCents: 30000,
        fundId: null,
      });
      expect(entryRows().find((e) => e.sheetRef === 'Super!B11')).toMatchObject({
        kind: 'reported_gain',
        entryDate: null,
      });
      // A last run a month earlier: the period is February, whose end is before the as-of.
      const t2 = createTestDb();
      try {
        runImport(
          t2.db,
          buildSyntheticWorkbook({
            mutate: (wb) => set(wb, 'Net Worth', 'C51', num(serial('2026-01-31'))),
          }),
        );
        const earlier = t2.db
          .select()
          .from(superEntries)
          .all()
          .find((e) => e.sheetRef === 'Super!B16');
        expect(earlier).toMatchObject({ periodMonth: '2026-02', entryDate: '2026-02-28' });
      } finally {
        t2.close();
      }
    });

    it('derives one contribution per kept snapshot with a non-zero R', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      const derived = entryRows().filter((e) => e.sheetRef?.startsWith('History!R'));
      expect(
        derived.map((e) => [e.sheetRef, e.periodMonth, e.entryDate, e.amountCents, e.fundId]),
      ).toEqual([
        ['History!R4', '2025-11', '2025-11-30', 10000, null],
        ['History!R5', '2025-12', '2025-12-31', 10000, null],
        ['History!R6', '2026-01', '2026-01-31', 10000, null],
        ['History!R7', '2026-02', LAST_RUN, 10000, null],
      ]);
      expect(
        derived.every((e) => e.kind === 'voluntary_contribution' && e.origin === 'import'),
      ).toBe(true);
      expect(checkById(report, 'super.contributions.history')).toMatchObject({
        status: 'match',
        expected: 40000,
        actual: 40000,
      });
      expect(checkById(report, 'counts.super-entries')).toMatchObject({
        status: 'match',
        expected: 6,
        actual: 6,
      });
      // Re-pointed: B16 against its own entry, not every voluntary entry.
      expect(checkById(report, 'super.contribution')).toMatchObject({
        status: 'match',
        expected: 30000,
        actual: 30000,
      });
      expect(report.checks.some((c) => c.id === 'super.contributions.retirementExcluded')).toBe(
        false,
      );
    });

    it('derives one contribution for a month with two frozen rows (the kept one)', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook({ variant: 'faulty' })));
      const derived = entryRows().filter((e) => e.sheetRef?.startsWith('History!R'));
      expect(derived.map((e) => [e.sheetRef, e.periodMonth, e.entryDate])).toEqual([
        ['History!R4', '2025-11', '2025-11-30'],
        ['History!R5', '2025-12', '2025-12-31'],
        ['History!R7', '2026-01', '2026-01-31'],
        ['History!R8', '2026-02', LAST_RUN],
      ]);
      expect(checkById(report, 'super.contributions.history').status).toBe('match');
      expect(checkById(report, 'counts.super-entries').status).toBe('match');
    });

    it('leaves the window’s Retirement-tagged buys out when the D37 switch is Yes', () => {
      const bytes = buildSyntheticWorkbook({
        mutate: all(withRetirementContributions(true), withRetirementTaggedEtf),
      });
      const report = reportOf(runImport(t.db, bytes));
      const derived = entryRows().filter((e) => e.sheetRef?.startsWith('History!R'));
      // Jan: 0.1 × 49.50 of the tagged ETF; Feb: 0.2 × 50 (the Oct row's R is 0: no entry).
      expect(derived.map((e) => [e.sheetRef, e.amountCents])).toEqual([
        ['History!R4', 10000],
        ['History!R5', 10000],
        ['History!R6', 10000 - 495],
        ['History!R7', 10000 - 1000],
      ]);
      expect(checkById(report, 'super.contributions.retirementExcluded')).toMatchObject({
        status: 'info',
        reasonCode: 'feature_dropped',
        unit: 'count',
        expected: 2,
        refs: { decision: 'D37', entity: 'super-entries' },
      });
      expect(checkById(report, 'super.contributions.history')).toMatchObject({
        status: 'match',
        expected: 40000 - 1495,
        actual: 40000 - 1495,
      });
      expect(checkById(report, 'counts.super-entries').status).toBe('match');
    });

    it('keeps R whole when the switch is No, and writes no entry when the buys exceed it', () => {
      const off = buildSyntheticWorkbook({
        mutate: all(withRetirementContributions(false), withRetirementTaggedEtf),
      });
      const report = reportOf(runImport(t.db, off));
      const amounts = entryRows()
        .filter((e) => e.sheetRef?.startsWith('History!R'))
        .map((e) => e.amountCents);
      expect(amounts).toEqual([10000, 10000, 10000, 10000]);
      expect(report.checks.some((c) => c.id === 'super.contributions.retirementExcluded')).toBe(
        false,
      );
      const t2 = createTestDb();
      try {
        const exceeded = buildSyntheticWorkbook({
          mutate: all(withRetirementContributions(true), withRetirementTaggedEtf, (wb) =>
            set(wb, SYNTHETIC_HISTORY_TMP, 'R7', num(5)),
          ),
        });
        const r2 = reportOf(runImport(t2.db, exceeded));
        const refs = t2.db
          .select()
          .from(superEntries)
          .all()
          .filter((e) => e.sheetRef?.startsWith('History!R'))
          .map((e) => e.sheetRef);
        expect(refs).toEqual(['History!R4', 'History!R5', 'History!R6']);
        expect(checkById(r2, 'super.contributions.retirementExcluded').expected).toBe(2);
        expect(checkById(r2, 'super.contributions.history').status).toBe('match');
        expect(checkById(r2, 'counts.super-entries').status).toBe('match');
      } finally {
        t2.close();
      }
    });
  });

  describe('the fund that receives SG across a re-import (§3.5 item 3)', () => {
    const flag = (db: TestDb['db'], sheetRef: string) =>
      db
        .update(superFunds)
        .set({ receivesSg: true })
        .where(eq(superFunds.sheetRef, sheetRef))
        .run();
    const flagged = () => fundRows().map((f) => [f.name, f.receivesSg, f.origin]);

    it('carries the flag by a unique name, even when the fund moved', () => {
      runImport(t.db, buildSyntheticWorkbook());
      flag(t.db, 'Super!A3');
      // The fund moves up a row and a new fund takes its old row.
      const moved = buildSyntheticWorkbook({
        mutate: (wb) => {
          set(wb, 'Super', 'A2', str('Example Super Two'));
          set(wb, 'Super', 'A3', str('Example Super Three'));
          set(wb, 'Super', 'A4', str('Example Super'));
          set(wb, 'Super', 'B4', num(0));
        },
      });
      const report = reportOf(runImport(t.db, moved, { now: LATER }));
      expect(flagged()).toEqual([
        ['Example Super Two', true, 'import'],
        ['Example Super Three', false, 'import'],
        ['Example Super', false, 'import'],
      ]);
      expect(report.checks.some((c) => c.id === 'super.sgFundNotCarried')).toBe(false);
    });

    it('falls back to the sheet ref and name when fund names repeat', () => {
      const same = buildSyntheticWorkbook({
        mutate: (wb) => set(wb, 'Super', 'A3', str('Example Super')),
      });
      runImport(t.db, same);
      flag(t.db, 'Super!A3');
      runImport(t.db, same, { now: LATER });
      expect(fundRows().map((f) => [f.sheetRef, f.receivesSg])).toEqual([
        ['Super!A2', false],
        ['Super!A3', true],
      ]);
    });

    it('reports a flag it cannot carry over', () => {
      runImport(t.db, buildSyntheticWorkbook());
      flag(t.db, 'Super!A3');
      const renamed = buildSyntheticWorkbook({
        mutate: (wb) => set(wb, 'Super', 'A3', str('Example Super Renamed')),
      });
      const report = reportOf(runImport(t.db, renamed, { now: LATER }));
      expect(fundRows().some((f) => f.receivesSg)).toBe(false);
      expect(checkById(report, 'super.sgFundNotCarried')).toMatchObject({
        status: 'info',
        section: 'super',
        unit: 'count',
        expected: 1,
        reason:
          'The fund that receives SG could not be carried over; choose it again on the Super page',
      });
      expect(problems(report)).toEqual([]);
    });

    it('keeps re-imports idempotent with the flag set', () => {
      runImport(t.db, buildSyntheticWorkbook({ mutate: withLiveTotalsUnchanged }));
      flag(t.db, 'Super!A2');
      const before = dumpDomainTables(t.db);
      runImport(t.db, buildSyntheticWorkbook({ mutate: withLiveTotalsUnchanged }), { now: LATER });
      expect(dumpDomainTables(t.db)).toEqual(before);
    });
  });

  describe('property and loans (D66)', () => {
    it('writes one valuation per property and one balance entry per loan, no start entries', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      expect(problems(report)).toEqual([]);
      const valuations = t.db.select().from(propertyValuations).all();
      expect(valuations.map((v) => [v.asOf, v.valueCents, v.sheetRef, v.origin, v.note])).toEqual([
        [AS_OF, 52000000, 'Property!D15', 'import', null],
      ]);
      const [mortgage, car] = loanRows();
      expect(mortgage).toMatchObject({ paymentFrequency: 'monthly', interestPeriodsPerYear: 12 });
      const entries = t.db
        .select()
        .from(loanBalanceEntries)
        .orderBy(asc(loanBalanceEntries.id))
        .all();
      expect(
        entries.map((e) => [e.loanId, e.asOf, e.balanceCents, e.repaymentsCents, e.sheetRef]),
      ).toEqual([
        [mortgage!.id, AS_OF, 39500055, null, 'Property!D29'],
        [car!.id, AS_OF, 1500025, null, 'LiabilitiesDebts!C17'],
      ]);
      // The start fields stay on the loan (they give the log's start point).
      expect(mortgage).toMatchObject({
        startDate: '2025-12-15',
        startBalanceCents: 40000000,
        balanceAsOf: AS_OF,
      });
      for (const id of ['counts.property-valuations', 'counts.loan-balance-entries']) {
        expect(checkById(report, id).status).toBe('match');
      }
    });

    it('dates a property loan’s entry at the last run when the mortgage total is unchanged', () => {
      const report = reportOf(
        runImport(t.db, buildSyntheticWorkbook({ mutate: withLiveTotalsUnchanged })),
      );
      expect(problems(report)).toEqual([]);
      const entries = t.db
        .select()
        .from(loanBalanceEntries)
        .orderBy(asc(loanBalanceEntries.id))
        .all();
      // The car loan has no property: always the as-of.
      expect(entries.map((e) => e.asOf)).toEqual([LAST_RUN, AS_OF]);
      expect(loanRows().map((l) => l.balanceAsOf)).toEqual([LAST_RUN, AS_OF]);
      // The valuation always takes the as-of.
      expect(t.db.select().from(propertyValuations).all()[0]?.asOf).toBe(AS_OF);
    });

    it('applies the rule to a loan with no start date, not to one that started after the last run', () => {
      runImport(
        t.db,
        buildSyntheticWorkbook({
          mutate: all(withLiveTotalsUnchanged, (wb) => set(wb, 'Property', 'D24', str('-'))),
        }),
      );
      expect(loanRows()[0]).toMatchObject({ startDate: null, balanceAsOf: LAST_RUN });
      const t2 = createTestDb();
      try {
        runImport(
          t2.db,
          buildSyntheticWorkbook({
            mutate: all(withLiveTotalsUnchanged, (wb) =>
              set(wb, 'Property', 'D24', num(serial('2026-03-10'))),
            ),
          }),
        );
        const loan = t2.db.select().from(loans).orderBy(asc(loans.id)).all()[0];
        expect(loan).toMatchObject({ startDate: '2026-03-10', balanceAsOf: AS_OF });
        expect(t2.db.select().from(loanBalanceEntries).all()[0]?.asOf).toBe(AS_OF);
      } finally {
        t2.close();
      }
    });
  });

  it('is idempotent: two imports give identical Stage 4 rows (ids included)', () => {
    const bytes = buildSyntheticWorkbook({
      mutate: all(
        withLiveTotalsUnchanged,
        withForeignRow({ row: 6, currency: 'USD', purchaseRate: 1.5, liveRate: 1.6 }),
      ),
    });
    runImport(t.db, bytes);
    const first = dumpDomainTables(t.db);
    for (const table of [
      'other_asset_prices',
      'super_balance_entries',
      'property_valuations',
      'loan_balance_entries',
    ]) {
      expect(first[table]?.length).toBeGreaterThan(0);
    }
    runImport(t.db, bytes, { now: LATER });
    expect(dumpDomainTables(t.db)).toEqual(first);
  });
});
