// Re-imports keep what the app owns (stage-1.md §4.4, §4.8): user manual prices, searched and
// user provider symbols, fetched prices and instrument ids; replace-all clears app rows in the
// domain tables.
import type { CellObject } from 'xlsx';
import { cashAccounts, instruments, priceSources, prices, settings } from '@joinr/schema/db';
import { createTestDb, type TestDb } from '@joinr/schema/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSyntheticWorkbook, SYNTHETIC_FACTS } from '../src/testing/syntheticWorkbook';
import { checkById, problems, reportOf, runImport } from './helpers';

const LATER = () => new Date('2026-04-02T03:04:05.000Z');

describe('importWorkbook: re-import', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  const idOf = (symbol: string) =>
    t.db
      .select()
      .from(instruments)
      .all()
      .find((i) => i.symbol === symbol)!.id;
  const sourceOf = (symbol: string) =>
    t.db
      .select()
      .from(priceSources)
      .where(eq(priceSources.instrumentId, idOf(symbol)))
      .get()!;
  const priceOf = (symbol: string) =>
    t.db
      .select()
      .from(prices)
      .where(eq(prices.instrumentId, idOf(symbol)))
      .get();

  it('keeps user overrides, searched ids and fetched prices', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const ids = t.db
      .select()
      .from(instruments)
      .all()
      .map((i) => [i.symbol, i.id]);
    // What the app did in between: a user manual price, a searched CoinGecko id, a user symbol,
    // a fresh fetched price.
    t.db
      .update(priceSources)
      .set({
        manualPrice: '13',
        manualPriceAsOf: '2026-03-25',
        manualOrigin: 'user',
        manualNote: 'from a statement',
      })
      .where(eq(priceSources.instrumentId, idOf('ASX:ABC')))
      .run();
    t.db
      .update(priceSources)
      .set({ providerSymbol: 'ethereum-classic-example', symbolOrigin: 'search' })
      .where(eq(priceSources.instrumentId, idOf('ETH')))
      .run();
    t.db
      .update(priceSources)
      .set({ provider: 'yahoo', providerSymbol: 'EXFUND.AX', symbolOrigin: 'user' })
      .where(eq(priceSources.instrumentId, idOf('EXAMPLEFUND')))
      .run();
    t.db
      .update(prices)
      .set({ price: '51.5', source: 'yahoo', asOf: '2026-03-30T06:00:00Z' })
      .where(eq(prices.instrumentId, idOf('ASX:DEF')))
      .run();

    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(
      t.db
        .select()
        .from(instruments)
        .all()
        .map((i) => [i.symbol, i.id]),
    ).toEqual(ids);
    expect(sourceOf('ASX:ABC')).toMatchObject({
      manualPrice: '13',
      manualOrigin: 'user',
      manualNote: 'from a statement',
      provider: 'yahoo',
      providerSymbol: 'ABC.AX',
    });
    expect(sourceOf('ETH')).toMatchObject({
      providerSymbol: 'ethereum-classic-example',
      symbolOrigin: 'search',
    });
    // A user-chosen source is kept; the typed workbook price is still re-imported as manual.
    expect(sourceOf('EXAMPLEFUND')).toMatchObject({
      provider: 'yahoo',
      providerSymbol: 'EXFUND.AX',
      symbolOrigin: 'user',
      manualPrice: '1.2345',
      manualOrigin: 'import',
    });
    expect(priceOf('ASX:DEF')).toMatchObject({ price: '51.5', source: 'yahoo' });
    // The actual side is read back from the database: the fetched price, not the workbook's.
    expect(checkById(report, 'holdings.price.etf.ASX:DEF')).toMatchObject({
      status: 'info',
      reasonCode: null,
      expected: '50.25',
      actual: '51.5',
      diff: '1.25',
      reason: expect.stringContaining('kept') as unknown,
    });
    expect(checkById(report, 'holdings.price.stock.ASX:ABC').status).toBe('match');
  });

  it('reports a kept user manual price that differs from the typed workbook price as info', () => {
    runImport(t.db, buildSyntheticWorkbook());
    t.db
      .update(priceSources)
      .set({ manualPrice: '1.5', manualPriceAsOf: '2026-03-25', manualOrigin: 'user' })
      .where(eq(priceSources.instrumentId, idOf('EXAMPLEFUND')))
      .run();
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(problems(report)).toEqual([]);
    expect(sourceOf('EXAMPLEFUND')).toMatchObject({ manualPrice: '1.5', manualOrigin: 'user' });
    expect(checkById(report, 'holdings.price.managed_fund.EXAMPLEFUND')).toMatchObject({
      status: 'info',
      expected: '1.2345',
      actual: '1.5',
      reason: 'Your manual price is kept; the workbook price is not used',
    });
  });

  it('gives the same price statuses when the same bytes are imported twice', () => {
    const first = reportOf(runImport(t.db, buildSyntheticWorkbook()));
    const second = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    const statuses = (r: typeof first) =>
      r.checks.filter((c) => c.id.startsWith('holdings.price.')).map((c) => [c.id, c.status]);
    expect(statuses(second)).toEqual(statuses(first));
    expect(checkById(second, 'holdings.price.etf.ASX:DEF').status).toBe('match');
  });

  it('fills in the workbook price on a failure-only prices row and keeps its fetch bookkeeping', () => {
    runImport(t.db, buildSyntheticWorkbook());
    t.db
      .update(prices)
      .set({
        price: null,
        asOf: null,
        source: null,
        lastAttemptAt: '2026-03-30T06:00:00Z',
        lastStatus: 'error',
        lastError: 'HTTP 500',
        consecutiveFailures: 2,
      })
      .where(eq(prices.instrumentId, idOf('ASX:DEF')))
      .run();
    const report = reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(priceOf('ASX:DEF')).toMatchObject({
      price: '50.25',
      source: 'sheet',
      asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/) as unknown,
      fetchedAt: LATER().toISOString(),
      lastAttemptAt: '2026-03-30T06:00:00Z',
      lastStatus: 'error',
      lastError: 'HTTP 500',
      consecutiveFailures: 2,
    });
    expect(checkById(report, 'holdings.price.etf.ASX:DEF')).toMatchObject({
      status: 'match',
      actual: '50.25',
    });
  });

  it('refreshes derived sources and clears an imported manual price the sheet no longer has', () => {
    runImport(t.db, buildSyntheticWorkbook());
    expect(sourceOf('EXAMPLEFUND')).toMatchObject({
      manualPrice: '1.2345',
      manualOrigin: 'import',
      provider: 'none',
    });
    const before = sourceOf('ASX:XYZ');
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        const cell: CellObject = {
          t: 'n',
          v: 1.2345,
          f: 'IFERROR(__xludf.DUMMYFUNCTION("price"),1.2345)',
        };
        wb.Sheets['Managed Funds']!.D2 = cell;
      },
    });
    reportOf(runImport(t.db, bytes, { now: LATER }));
    expect(sourceOf('EXAMPLEFUND')).toMatchObject({
      manualPrice: null,
      manualOrigin: null,
      manualPriceAsOf: null,
      updatedAt: LATER().toISOString(),
    });
    expect(priceOf('EXAMPLEFUND')).toMatchObject({ price: '1.2345', source: 'sheet' });
    // Unchanged rows keep their timestamps (idempotency).
    expect(sourceOf('ASX:XYZ')).toEqual(before);
  });

  it('replaces app rows in the domain tables and removes instruments that are gone', () => {
    runImport(t.db, buildSyntheticWorkbook());
    t.db
      .insert(cashAccounts)
      .values({ name: 'Added in the app', balanceCents: 100, sortOrder: 99, origin: 'app' })
      .run();
    t.db
      .insert(instruments)
      .values({
        kind: 'stock',
        symbol: 'ASX:APP',
        code: 'APP',
        exchange: 'ASX',
        sortOrder: 9,
        origin: 'app',
      })
      .run();
    reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    const names = t.db
      .select()
      .from(cashAccounts)
      .all()
      .map((a) => a.name);
    expect(names).toEqual([...SYNTHETIC_FACTS.cashAccounts]);
    expect(
      t.db
        .select()
        .from(cashAccounts)
        .all()
        .map((a) => a.id),
    ).toEqual([1, 2, 3, 4]);
    expect(
      t.db
        .select()
        .from(instruments)
        .all()
        .some((i) => i.symbol === 'ASX:APP'),
    ).toBe(false);
  });

  it('re-marks an app-entered setting as imported, even when the value is the same (D34)', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const [first] = t.db.select().from(settings).all();
    if (!first) throw new Error('the synthetic workbook imports settings');
    t.db.update(settings).set({ origin: 'app' }).where(eq(settings.key, first.key)).run();
    reportOf(runImport(t.db, buildSyntheticWorkbook(), { now: LATER }));
    expect(t.db.select().from(settings).where(eq(settings.key, first.key)).get()).toMatchObject({
      valueJson: first.valueJson,
      origin: 'import',
      updatedAt: LATER().toISOString(),
    });
  });

  it('updates settings only when the value changes', () => {
    runImport(t.db, buildSyntheticWorkbook());
    const before = t.db.select().from(settings).all();
    const bytes = buildSyntheticWorkbook({
      mutate: (wb) => {
        wb.Sheets.SheetOptions!.L4 = { t: 'n', v: 20 };
      },
    });
    reportOf(runImport(t.db, bytes, { now: LATER }));
    const after = new Map(
      t.db
        .select()
        .from(settings)
        .all()
        .map((s) => [s.key, s]),
    );
    for (const s of before) {
      if (s.key === 'pay.dayOfMonth') {
        expect(after.get(s.key)).toMatchObject({
          valueJson: '20',
          updatedAt: LATER().toISOString(),
        });
      } else {
        expect(after.get(s.key)).toEqual(s);
      }
    }
  });
});
