// Zod insert schemas ↔ Drizzle `$inferInsert`: a compile-time parity check (tsc runs over this
// file in `pnpm typecheck`) plus a runtime check that both sides list the same columns.
import { getTableColumns } from 'drizzle-orm';
import type { z } from 'zod';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as rows from '../src/rows';
import * as t from '../src/db/index';

type Out<S extends z.ZodType> = z.output<S>;

/**
 * An `integer` primary key is optional in Drizzle's insert type (SQLite would assign a rowid), but
 * `price_sources` and `prices` are keyed by their instrument, so the Zod schemas require it.
 */
type Simplify<T> = { [K in keyof T]: T[K] };
type KeyedByInstrument<T extends { instrumentId?: number }> = Simplify<
  Omit<T, 'instrumentId'> & { instrumentId: number }
>;
/** Stage 4: `loan_offset_links` is keyed by its account, so the Zod schema requires it. */
type KeyedByAccount<T extends { accountId?: number }> = Simplify<
  Omit<T, 'accountId'> & { accountId: number }
>;

describe('Zod insert schemas match the Drizzle tables', () => {
  it('has the same types (compile time)', () => {
    expectTypeOf<Out<typeof rows.newAppMetaSchema>>().toEqualTypeOf<
      typeof t.appMeta.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSettingSchema>>().toEqualTypeOf<
      typeof t.settings.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newInstrumentSchema>>().toEqualTypeOf<
      typeof t.instruments.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newPriceSourceSchema>>().toEqualTypeOf<
      KeyedByInstrument<typeof t.priceSources.$inferInsert>
    >();
    expectTypeOf<Out<typeof rows.newPriceSchema>>().toEqualTypeOf<
      KeyedByInstrument<typeof t.prices.$inferInsert>
    >();
    expectTypeOf<Out<typeof rows.newMarketQuoteSchema>>().toEqualTypeOf<
      typeof t.marketQuotes.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newTradeSchema>>().toEqualTypeOf<typeof t.trades.$inferInsert>();
    expectTypeOf<Out<typeof rows.newDividendSchema>>().toEqualTypeOf<
      typeof t.dividends.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newCashAccountSchema>>().toEqualTypeOf<
      typeof t.cashAccounts.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newBudgetItemSchema>>().toEqualTypeOf<
      typeof t.budgetItems.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newYearlyExpenseSchema>>().toEqualTypeOf<
      typeof t.yearlyExpenses.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newIncomeStreamSchema>>().toEqualTypeOf<
      typeof t.incomeStreams.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSideIncomeEntrySchema>>().toEqualTypeOf<
      typeof t.sideIncomeEntries.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newPeriodNoteSchema>>().toEqualTypeOf<
      typeof t.periodNotes.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSnapshotSchema>>().toEqualTypeOf<
      typeof t.snapshots.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newOtherAssetSchema>>().toEqualTypeOf<
      typeof t.otherAssets.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSuperFundSchema>>().toEqualTypeOf<
      typeof t.superFunds.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSuperEntrySchema>>().toEqualTypeOf<
      typeof t.superEntries.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newPropertySchema>>().toEqualTypeOf<
      typeof t.properties.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newLoanSchema>>().toEqualTypeOf<typeof t.loans.$inferInsert>();
    expectTypeOf<Out<typeof rows.newImportRunSchema>>().toEqualTypeOf<
      typeof t.importRuns.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newJobRunSchema>>().toEqualTypeOf<typeof t.jobRuns.$inferInsert>();
    // Stage 3 (migration 0003).
    expectTypeOf<Out<typeof rows.newCashBalanceEntrySchema>>().toEqualTypeOf<
      typeof t.cashBalanceEntries.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSideIncomeDepositSchema>>().toEqualTypeOf<
      typeof t.sideIncomeDeposits.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSavingsAdjustmentSchema>>().toEqualTypeOf<
      typeof t.savingsAdjustments.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSavingsGoalSchema>>().toEqualTypeOf<
      typeof t.savingsGoals.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newDividendEventSchema>>().toEqualTypeOf<
      typeof t.dividendEvents.$inferInsert
    >();
    // Stage 4 (migration 0004).
    expectTypeOf<Out<typeof rows.newOtherAssetPriceSchema>>().toEqualTypeOf<
      typeof t.otherAssetPrices.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newOtherAssetSaleSchema>>().toEqualTypeOf<
      typeof t.otherAssetSales.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSuperBalanceEntrySchema>>().toEqualTypeOf<
      typeof t.superBalanceEntries.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newSuperSgOverrideSchema>>().toEqualTypeOf<
      typeof t.superSgOverrides.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newPropertyValuationSchema>>().toEqualTypeOf<
      typeof t.propertyValuations.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newLoanBalanceEntrySchema>>().toEqualTypeOf<
      typeof t.loanBalanceEntries.$inferInsert
    >();
    expectTypeOf<Out<typeof rows.newLoanOffsetLinkSchema>>().toEqualTypeOf<
      KeyedByAccount<typeof t.loanOffsetLinks.$inferInsert>
    >();
    expectTypeOf<Out<typeof rows.newMarketQuoteHistorySchema>>().toEqualTypeOf<
      typeof t.marketQuoteHistory.$inferInsert
    >();
    // Stage 5 (migration 0005).
    expectTypeOf<Out<typeof rows.newSnapshotAuditSchema>>().toEqualTypeOf<
      typeof t.snapshotAudit.$inferInsert
    >();
    // Stage 9 (migration 0006).
    expectTypeOf<Out<typeof rows.newDayQuoteSchema>>().toEqualTypeOf<
      KeyedByInstrument<typeof t.dayQuotes.$inferInsert>
    >();
    expectTypeOf<Out<typeof rows.newSeriesDayQuoteSchema>>().toEqualTypeOf<
      typeof t.seriesDayQuotes.$inferInsert
    >();
  });

  it('covers every table and every column (runtime)', () => {
    const pairs: [z.ZodObject, Parameters<typeof getTableColumns>[0]][] = [
      [rows.newAppMetaSchema, t.appMeta],
      [rows.newSettingSchema, t.settings],
      [rows.newInstrumentSchema, t.instruments],
      [rows.newPriceSourceSchema, t.priceSources],
      [rows.newPriceSchema, t.prices],
      [rows.newMarketQuoteSchema, t.marketQuotes],
      [rows.newTradeSchema, t.trades],
      [rows.newDividendSchema, t.dividends],
      [rows.newCashAccountSchema, t.cashAccounts],
      [rows.newBudgetItemSchema, t.budgetItems],
      [rows.newYearlyExpenseSchema, t.yearlyExpenses],
      [rows.newIncomeStreamSchema, t.incomeStreams],
      [rows.newSideIncomeEntrySchema, t.sideIncomeEntries],
      [rows.newPeriodNoteSchema, t.periodNotes],
      [rows.newSnapshotSchema, t.snapshots],
      [rows.newOtherAssetSchema, t.otherAssets],
      [rows.newSuperFundSchema, t.superFunds],
      [rows.newSuperEntrySchema, t.superEntries],
      [rows.newPropertySchema, t.properties],
      [rows.newLoanSchema, t.loans],
      [rows.newImportRunSchema, t.importRuns],
      [rows.newJobRunSchema, t.jobRuns],
      [rows.newCashBalanceEntrySchema, t.cashBalanceEntries],
      [rows.newSideIncomeDepositSchema, t.sideIncomeDeposits],
      [rows.newSavingsAdjustmentSchema, t.savingsAdjustments],
      [rows.newSavingsGoalSchema, t.savingsGoals],
      [rows.newDividendEventSchema, t.dividendEvents],
      [rows.newOtherAssetPriceSchema, t.otherAssetPrices],
      [rows.newOtherAssetSaleSchema, t.otherAssetSales],
      [rows.newSuperBalanceEntrySchema, t.superBalanceEntries],
      [rows.newSuperSgOverrideSchema, t.superSgOverrides],
      [rows.newPropertyValuationSchema, t.propertyValuations],
      [rows.newLoanBalanceEntrySchema, t.loanBalanceEntries],
      [rows.newLoanOffsetLinkSchema, t.loanOffsetLinks],
      [rows.newMarketQuoteHistorySchema, t.marketQuoteHistory],
      [rows.newSnapshotAuditSchema, t.snapshotAudit],
      [rows.newDayQuoteSchema, t.dayQuotes],
      [rows.newSeriesDayQuoteSchema, t.seriesDayQuotes],
    ];
    expect(pairs).toHaveLength(Object.keys(t.tables).length);
    for (const [schema, table] of pairs) {
      expect(Object.keys(schema.shape).sort()).toEqual(Object.keys(getTableColumns(table)).sort());
    }
  });

  it('rejects malformed rows at the boundary', () => {
    const base = { instrumentId: 1, tradeDate: '2025-01-15', units: '10', price: '1.5', seq: 1 };
    expect(rows.newTradeSchema.safeParse(base).success).toBe(true);
    expect(rows.newTradeSchema.safeParse({ ...base, units: '10.0' }).success).toBe(false);
    expect(rows.newTradeSchema.safeParse({ ...base, tradeDate: '15/01/2025' }).success).toBe(false);
    expect(rows.newTradeSchema.safeParse({ ...base, reviewFlags: '[]' }).success).toBe(false);
    expect(rows.newTradeSchema.safeParse({ ...base, reviewFlags: '["oversell"]' }).success).toBe(
      true,
    );
    expect(rows.newTradeSchema.safeParse({ ...base, typo: 1 }).success).toBe(false);
    expect(
      rows.newLoanSchema.safeParse({ name: 'x', currentBalanceCents: -1, sortOrder: 1 }).success,
    ).toBe(false);
  });

  it('rejects zero deposits and adjustments and a non-positive goal target (Stage 3)', () => {
    const deposit = { streamId: 1, depositDate: '2026-07-31', amountCents: 50000 };
    expect(rows.newSideIncomeDepositSchema.safeParse(deposit).success).toBe(true);
    expect(
      rows.newSideIncomeDepositSchema.safeParse({ ...deposit, amountCents: -500 }).success,
    ).toBe(true);
    expect(rows.newSideIncomeDepositSchema.safeParse({ ...deposit, amountCents: 0 }).success).toBe(
      false,
    );
    const adjustment = { periodMonth: '2026-07', amountCents: -100000, note: 'Car sold' };
    expect(rows.newSavingsAdjustmentSchema.safeParse(adjustment).success).toBe(true);
    expect(
      rows.newSavingsAdjustmentSchema.safeParse({ ...adjustment, amountCents: 0 }).success,
    ).toBe(false);
    expect(rows.newSavingsAdjustmentSchema.safeParse({ ...adjustment, note: '' }).success).toBe(
      false,
    );
    const goal = { name: 'Holiday', targetCents: 500000, sortOrder: 1 };
    expect(rows.newSavingsGoalSchema.safeParse(goal).success).toBe(true);
    expect(rows.newSavingsGoalSchema.safeParse({ ...goal, targetCents: 0 }).success).toBe(false);
    const event = {
      instrumentId: 3,
      exDate: '2026-06-30',
      amountPerUnit: '0.5',
      currency: 'AUD',
      source: 'fake',
      fetchedAt: '2026-09-24T04:32:00.000Z',
    };
    expect(rows.newDividendEventSchema.safeParse(event).success).toBe(true);
    expect(rows.newDividendEventSchema.safeParse({ ...event, source: 'sheet2' }).success).toBe(
      false,
    );
    expect(rows.newDividendEventSchema.safeParse({ ...event, amountPerUnit: '0.50' }).success).toBe(
      false,
    );
  });

  it('bounds the Stage 4 log rows (stage-4.md §3.1)', () => {
    const price = { otherAssetId: 1, asOf: '2026-09-24', unitPrice: '120' };
    expect(rows.newOtherAssetPriceSchema.safeParse(price).success).toBe(true);
    expect(rows.newOtherAssetPriceSchema.safeParse({ ...price, unitPrice: '0' }).success).toBe(
      true,
    );
    expect(rows.newOtherAssetPriceSchema.safeParse({ ...price, unitPrice: '-1' }).success).toBe(
      false,
    );
    const sale = { otherAssetId: 1, saleDate: '2026-09-01', units: '2', proceedsCents: 50000 };
    expect(rows.newOtherAssetSaleSchema.safeParse(sale).success).toBe(true);
    expect(rows.newOtherAssetSaleSchema.safeParse({ ...sale, units: '0' }).success).toBe(false);
    expect(rows.newOtherAssetSaleSchema.safeParse({ ...sale, proceedsCents: -1 }).success).toBe(
      false,
    );
    const entry = { fundId: 1, asOf: '2026-08-31', balanceCents: 1000000, transferInCents: null };
    expect(rows.newSuperBalanceEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      rows.newSuperBalanceEntrySchema.safeParse({ ...entry, transferInCents: -5 }).success,
    ).toBe(false);
    expect(
      rows.newSuperSgOverrideSchema.safeParse({ periodMonth: '2026-08', grossCents: 90000 })
        .success,
    ).toBe(true);
    expect(
      rows.newLoanBalanceEntrySchema.safeParse({
        loanId: 1,
        asOf: '2026-08-31',
        balanceCents: -1,
      }).success,
    ).toBe(false);
    expect(rows.newLoanOffsetLinkSchema.safeParse({ loanId: 1 }).success).toBe(false);
    expect(rows.newLoanOffsetLinkSchema.safeParse({ accountId: 5, loanId: 1 }).success).toBe(true);
    expect(
      rows.newOtherAssetSchema.safeParse({
        description: 'Example watch',
        units: '1',
        sortOrder: 1,
        purchaseFxSource: 'guess',
      }).success,
    ).toBe(false);
  });
});
