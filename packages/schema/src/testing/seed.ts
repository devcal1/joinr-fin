// Generic seed data (stage-1.md §7.2): a small, fully generic data set that puts rows in every
// table, for server/web tests and `pnpm seed:dev`. Idempotent: it clears the tables first.
// Values are round and made up; symbols are the generic test symbols only.
import { sql } from 'drizzle-orm';
import {
  appMeta,
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
  DOMAIN_TABLES_DELETE_ORDER,
  dividends,
  importRuns,
  incomeStreams,
  instruments,
  jobRuns,
  loanBalanceEntries,
  loans,
  marketQuoteHistory,
  marketQuotes,
  otherAssetPrices,
  otherAssets,
  periodNotes,
  prices,
  priceSources,
  properties,
  propertyValuations,
  savingsAdjustments,
  savingsGoals,
  settings,
  sideIncomeDeposits,
  snapshotAudit,
  snapshots,
  superBalanceEntries,
  superEntries,
  superFunds,
  superSgOverrides,
  trades,
  yearlyExpenses,
  type JoinrDb,
} from '../db/index';
import type { ReconciliationReport } from '../dto/report';
import { totalsOf } from '../dto/report';
import { JoinrDecimal, normaliseDecimal } from '../decimal';
import type { InstrumentKind } from '../enums';
import { serialiseReviewFlags } from '../rows';

export interface SeedOptions {
  /** Clock for freshness-relative timestamps (default: now). */
  now?: Date;
}

export interface SeedResult {
  /** Instrument ids by symbol. */
  instrumentIds: Record<string, number>;
  importRunId: number;
  jobRunId: number;
}

/** The workbook "as of" date the seed pretends it was imported from. */
export const SEED_WORKBOOK_AS_OF = '2026-08-31';

/** The app_meta key the seed writes (so app_meta has a row too). */
export const SEED_META_KEY = 'seed';

const SEED_SHA = 'a'.repeat(64);

function iso(d: Date): string {
  return d.toISOString();
}

function isoDateLocal(d: Date): string {
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}`;
}

/**
 * Deletes every row the seed writes (everything except other app_meta keys), plus the Stage 3
 * overlays (savings adjustments and goals), the Stage 4 overlay (SG statements) and series
 * history, and the Stage 5 snapshot audit log, so a seeded database starts without them.
 */
export function clearSeededTables(db: JoinrDb): void {
  db.transaction((tx) => {
    for (const table of DOMAIN_TABLES_DELETE_ORDER) tx.delete(table).run();
    tx.delete(savingsAdjustments).run();
    tx.delete(savingsGoals).run();
    tx.delete(superSgOverrides).run();
    tx.delete(marketQuoteHistory).run();
    tx.delete(snapshotAudit).run();
    tx.delete(instruments).run(); // cascades price_sources, prices and dividend_events
    tx.delete(marketQuotes).run();
    tx.delete(settings).run();
    tx.delete(importRuns).run();
    tx.delete(jobRuns).run();
    tx.run(sql`DELETE FROM app_meta WHERE key = ${SEED_META_KEY}`);
  });
}

interface SeedInstrument {
  kind: InstrumentKind;
  symbol: string;
  exchange: string | null;
  code: string;
  name: string | null;
  isWatched: boolean;
  targetRatio: string | null;
  sector: string | null;
  isRetirement?: boolean;
  /** D38 (Stage 2): the holding's own default fee. */
  defaultFeeCents?: number;
  defaultFeeRate?: string;
}

// prettier-ignore
const INSTRUMENTS: readonly SeedInstrument[] = [
  { kind: 'stock', symbol: 'ASX:ABC', exchange: 'ASX', code: 'ABC', name: 'ABC Example Ltd', isWatched: true, targetRatio: '0.5', sector: 'Materials' },
  { kind: 'stock', symbol: 'ASX:OLD', exchange: 'ASX', code: 'OLD', name: null, isWatched: false, targetRatio: null, sector: null },
  { kind: 'etf', symbol: 'ASX:XYZ', exchange: 'ASX', code: 'XYZ', name: 'XYZ Example ETF', isWatched: true, targetRatio: '0.6', sector: 'Global shares' },
  { kind: 'etf', symbol: 'ASX:DEF', exchange: 'ASX', code: 'DEF', name: 'DEF Example ETF', isWatched: true, targetRatio: '0.4', sector: 'Retirement', isRetirement: true, defaultFeeCents: 0 },
  { kind: 'managed_fund', symbol: 'EXAMPLEFUND', exchange: null, code: 'EXAMPLEFUND', name: 'Example Managed Fund', isWatched: true, targetRatio: '1', sector: null },
  { kind: 'managed_fund', symbol: 'EXAMPLEFUND2', exchange: null, code: 'EXAMPLEFUND2', name: 'Example Managed Fund 2', isWatched: true, targetRatio: null, sector: null },
  { kind: 'crypto', symbol: 'BTC', exchange: null, code: 'BTC', name: null, isWatched: true, targetRatio: '0.7', sector: null, defaultFeeRate: '0.0025' },
  { kind: 'crypto', symbol: 'ETH', exchange: null, code: 'ETH', name: null, isWatched: true, targetRatio: '0.3', sector: null },
];

const SHEET_OF: Record<InstrumentKind, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  managed_fund: 'Managed Funds',
  crypto: 'Crypto',
};

/**
 * Replaces the seeded tables with the generic data set. Price statuses covered (relative to
 * `now`): fresh (ASX:ABC, BTC), stale (ASX:XYZ from the workbook, ETH fetched two days ago),
 * failed (ASX:DEF), manual (EXAMPLEFUND), none (ASX:OLD, EXAMPLEFUND2). Default fees (D38): $0 flat on
 * ASX:DEF and a rate on BTC; every other instrument uses the global default. Every row keeps
 * origin 'import' (no app rows), so an import after seeding is still allowed.
 *
 * Stage 3 (stage-3.md §3.6): four cash accounts (a bank, a savings account, an offset and a loan
 * you've made), one balance entry per account plus an earlier one for the everyday account, and
 * the side income as dated deposits (the Stage 1 period entries are no longer seeded: the server
 * reads deposits). No overlays and no dividend events.
 *
 * Stage 4 (stage-4.md §3.6): "Example watch" has two price entries (the latest equals its unit
 * price; the bullion row has none); "Example Super" receives SG and has two balance entries (the
 * latest equals its balance), the Super!B16 contribution is dated, and each seeded snapshot's
 * History R becomes a contribution (History!R3–R5); "Example property" has two valuations (the
 * latest equals its value); each loan keeps its start fields (the log's start point) and has two
 * stored entries (the latest equals its current balance). No sales, SG statements, offset links or
 * series history; every row keeps origin 'import'.
 */
export function seedGenericData(db: JoinrDb, options: SeedOptions = {}): SeedResult {
  const now = options.now ?? new Date();
  const nowIso = iso(now);
  const minutesAgo = (m: number) => iso(new Date(now.getTime() - m * 60_000));
  const asOfTs = `${SEED_WORKBOOK_AS_OF}T00:00:00.000Z`;

  clearSeededTables(db);

  return db.transaction((tx) => {
    tx.insert(appMeta).values({ key: SEED_META_KEY, value: 'generic', updatedAt: nowIso }).run();

    // Instruments, sorted per kind in sheet order.
    const ids: Record<string, number> = {};
    const sortByKind: Partial<Record<InstrumentKind, number>> = {};
    INSTRUMENTS.forEach((inst, i) => {
      const sortOrder = (sortByKind[inst.kind] = (sortByKind[inst.kind] ?? 0) + 1);
      const row = tx
        .insert(instruments)
        .values({
          ...inst,
          isRetirement: inst.isRetirement ?? false,
          defaultFeeCents: inst.defaultFeeCents ?? null,
          defaultFeeRate: inst.defaultFeeRate ?? null,
          sortOrder,
          quoteCurrency: 'AUD',
          dividendFreqMonths: inst.kind === 'crypto' ? null : 6,
          drp: inst.kind === 'crypto' ? null : false,
          location: inst.kind === 'etf' ? 'Australia' : null,
          mgmtFeeRatio: inst.kind === 'etf' ? '0.002' : null,
          regionUsRatio: inst.kind === 'etf' ? '0.5' : null,
          regionAsiaRatio: inst.kind === 'etf' ? '0.1' : null,
          regionAusRatio: inst.kind === 'etf' ? '0.3' : null,
          regionOtherRatio: inst.kind === 'etf' ? '0.1' : null,
          origin: 'import',
          sheetRef: `${SHEET_OF[inst.kind]}!A${inst.isWatched ? sortOrder + 1 : 30 + i}`,
        })
        .returning({ id: instruments.id })
        .get();
      ids[inst.symbol] = row.id;
    });
    const id = (symbol: string): number => {
      const v = ids[symbol];
      if (v === undefined) throw new Error(`seed: no instrument ${symbol}`);
      return v;
    };

    // Price sources.
    const source = (
      symbol: string,
      provider: 'yahoo' | 'coingecko' | 'none',
      providerSymbol: string | null,
      manual?: { price: string; asOf: string; note: string | null },
    ) =>
      tx
        .insert(priceSources)
        .values({
          instrumentId: id(symbol),
          provider,
          providerSymbol,
          symbolOrigin: 'derived',
          manualPrice: manual?.price ?? null,
          manualPriceAsOf: manual?.asOf ?? null,
          manualOrigin: manual ? 'import' : null,
          manualNote: manual?.note ?? null,
          updatedAt: nowIso,
        })
        .run();
    source('ASX:ABC', 'yahoo', 'ABC.AX');
    source('ASX:OLD', 'yahoo', 'OLD.AX');
    source('ASX:XYZ', 'yahoo', 'XYZ.AX');
    source('ASX:DEF', 'yahoo', 'DEF.AX');
    source('EXAMPLEFUND', 'none', null, {
      price: '1.5',
      asOf: isoDateLocal(new Date(now.getTime() - 3 * 86_400_000)),
      note: 'Unit price from the fund statement',
    });
    source('EXAMPLEFUND2', 'none', null);
    source('BTC', 'coingecko', 'bitcoin');
    source('ETH', 'coingecko', 'ethereum');

    // Prices: fresh, stale (sheet), stale (old fetch), failed.
    tx.insert(prices)
      .values([
        {
          instrumentId: id('ASX:ABC'),
          price: '12.5',
          nativePrice: '12.5',
          nativeCurrency: 'AUD',
          fxRate: '1',
          asOf: minutesAgo(30),
          fetchedAt: minutesAgo(29),
          source: 'yahoo',
          lastAttemptAt: minutesAgo(29),
          lastStatus: 'ok',
          consecutiveFailures: 0,
        },
        {
          instrumentId: id('ASX:XYZ'),
          price: '105',
          asOf: asOfTs,
          fetchedAt: nowIso,
          source: 'sheet',
          lastStatus: 'ok',
        },
        {
          instrumentId: id('ASX:DEF'),
          price: null,
          lastAttemptAt: minutesAgo(29),
          lastStatus: 'error',
          lastError: 'Symbol not found',
          consecutiveFailures: 2,
        },
        {
          instrumentId: id('BTC'),
          price: '100000',
          nativePrice: '100000',
          nativeCurrency: 'AUD',
          fxRate: '1',
          asOf: minutesAgo(20),
          fetchedAt: minutesAgo(19),
          source: 'coingecko',
          lastAttemptAt: minutesAgo(19),
          lastStatus: 'ok',
        },
        {
          instrumentId: id('ETH'),
          price: '4000',
          nativePrice: '4000',
          nativeCurrency: 'AUD',
          fxRate: '1',
          asOf: minutesAgo(2 * 24 * 60),
          fetchedAt: minutesAgo(2 * 24 * 60),
          source: 'coingecko',
          lastAttemptAt: minutesAgo(2 * 24 * 60),
          lastStatus: 'ok',
        },
      ])
      .run();

    // Market series.
    const quote = (seriesId: string, value: string, unit: string, src: string) => ({
      seriesId,
      value,
      unit,
      asOf: minutesAgo(30),
      fetchedAt: minutesAgo(29),
      source: src,
      lastAttemptAt: minutesAgo(29),
      lastStatus: 'ok' as const,
    });
    tx.insert(marketQuotes)
      .values([
        quote('AUDUSD', '0.65', 'USD per AUD', 'yahoo'),
        quote('SI_USD_OZ', '30', 'USD per oz', 'yahoo'),
        quote('GC_USD_OZ', '2600', 'USD per oz', 'yahoo'),
        quote('XAG_AUD_OZ', '46.153846153846', 'AUD per oz', 'derived'),
        quote('XAU_AUD_OZ', '4000', 'AUD per oz', 'derived'),
      ])
      .run();

    // Trades: buys, a sell (ASX:OLD fully exited), a rate-fee crypto buy and a flagged row.
    let seq = 0;
    const trade = (
      symbol: string,
      tradeDate: string,
      units: string,
      price: string,
      feeCents: number,
      extra: { feeRate?: string; flags?: ('out_of_order' | 'price_outlier')[] } = {},
    ) => {
      seq += 1;
      const kind = INSTRUMENTS.find((i) => i.symbol === symbol)!.kind;
      return {
        instrumentId: id(symbol),
        tradeDate,
        units,
        price,
        feeCents,
        feeRate: extra.feeRate ?? null,
        seq,
        reviewFlags: serialiseReviewFlags(extra.flags ?? []),
        origin: 'import' as const,
        sheetRef: `${SHEET_OF[kind]}!A${22 + seq}`,
      };
    };
    tx.insert(trades)
      .values([
        trade('ASX:ABC', '2025-01-15', '100', '10', 1000),
        trade('ASX:ABC', '2025-06-16', '50', '12', 1000),
        trade('ASX:OLD', '2024-03-01', '20', '5', 1000),
        trade('ASX:OLD', '2025-02-03', '-20', '6', 1000),
        trade('ASX:XYZ', '2024-07-01', '30', '100', 1000),
        trade('ASX:DEF', '2025-05-20', '10', '50', 1000, { flags: ['out_of_order'] }),
        trade('EXAMPLEFUND', '2024-09-10', '1000', '1.5', 0),
        trade('BTC', '2024-11-11', '0.05', '90000', 2250, { feeRate: '0.005' }),
        trade('ETH', '2025-03-03', '1.25', '3000', 1875, { feeRate: '0.005' }),
      ])
      .run();

    // Dividends: one linked, one unmatched.
    tx.insert(dividends)
      .values([
        {
          instrumentId: id('ASX:XYZ'),
          ticker: 'XYZ',
          holdingKind: 'etf',
          paymentDate: '2025-07-15',
          exDate: '2025-06-30',
          reinvested: false,
          netAmountCents: 12000,
          priceAtEx: '100',
          priceAtExManual: false,
          origin: 'import',
          sheetRef: 'Dividends!A4',
        },
        {
          instrumentId: null,
          ticker: 'ZZZ',
          holdingKind: 'etf',
          paymentDate: '2025-08-15',
          exDate: null,
          reinvested: null,
          netAmountCents: 5000,
          priceAtEx: null,
          reviewFlags: serialiseReviewFlags(['unmatched_ticker']),
          origin: 'import',
          sheetRef: 'Dividends!A5',
        },
      ])
      .run();

    // Cash accounts, each with its balance entry (D58) at the workbook as-of.
    const cash = (
      name: string,
      balanceCents: number,
      sortOrder: number,
      extra: { isOffset?: boolean; kind?: 'bank' | 'loan_receivable' } = {},
    ) => {
      const sheetRef = `Cash!A${sortOrder + 1}`;
      const accountId = tx
        .insert(cashAccounts)
        .values({
          name,
          kind: extra.kind ?? 'bank',
          balanceCents,
          balanceAsOf: SEED_WORKBOOK_AS_OF,
          isOffset: extra.isOffset ?? false,
          sortOrder,
          origin: 'import',
          sheetRef,
        })
        .returning({ id: cashAccounts.id })
        .get().id;
      return { accountId, sheetRef };
    };
    const everyday = cash('Example Bank – Everyday', 500000, 1);
    const savingsAccount = cash('Example Bank – Savings', 2000000, 2);
    const offset = cash('Example Bank – Offset', 1000000, 3, { isOffset: true });
    const loan = cash('Loan to a friend', 300000, 4, { kind: 'loan_receivable' });
    const entry = (
      account: { accountId: number; sheetRef: string },
      asOf: string,
      balanceCents: number,
    ) => ({
      accountId: account.accountId,
      asOf,
      balanceCents,
      note: null,
      origin: 'import' as const,
      sheetRef: account.sheetRef,
    });
    tx.insert(cashBalanceEntries)
      .values([
        // An earlier balance, so the everyday account's history chart has two points.
        entry(everyday, '2026-07-31', 450000),
        entry(everyday, SEED_WORKBOOK_AS_OF, 500000),
        entry(savingsAccount, SEED_WORKBOOK_AS_OF, 2000000),
        entry(offset, SEED_WORKBOOK_AS_OF, 1000000),
        entry(loan, SEED_WORKBOOK_AS_OF, 300000),
      ])
      .run();

    // Budget items and yearly expenses.
    tx.insert(budgetItems)
      .values([
        {
          name: 'Rent',
          kind: 'item',
          monthlyCents: 200000,
          category: 'Housing',
          accountName: 'Example Bank – Everyday',
          cashAccountId: everyday.accountId,
          sortOrder: 1,
          origin: 'import',
          sheetRef: 'Budget!A8',
        },
        {
          name: 'Groceries',
          kind: 'item',
          monthlyCents: 60000,
          category: 'Food',
          accountName: 'Example Bank – Everyday',
          cashAccountId: everyday.accountId,
          sortOrder: 2,
          origin: 'import',
          sheetRef: 'Budget!A9',
        },
        {
          name: 'Phone',
          kind: 'item',
          monthlyCents: 5000,
          category: 'Bills',
          accountName: 'Example Bank – Old',
          cashAccountId: null,
          sortOrder: 3,
          reviewFlags: serialiseReviewFlags(['unmatched_account']),
          origin: 'import',
          sheetRef: 'Budget!A10',
        },
        {
          name: 'Yearly Expenses - Automatic',
          kind: 'auto_yearly',
          monthlyCents: null,
          sortOrder: 4,
          origin: 'import',
          sheetRef: 'Budget!A24',
        },
        {
          name: 'Investment Savings - Automatic',
          kind: 'auto_invest',
          monthlyCents: null,
          sortOrder: 5,
          origin: 'import',
          sheetRef: 'Budget!A28',
        },
        {
          name: 'Cash Savings - Automatic',
          kind: 'auto_cash',
          monthlyCents: null,
          sortOrder: 6,
          origin: 'import',
          sheetRef: 'Budget!A29',
        },
      ])
      .run();
    tx.insert(yearlyExpenses)
      .values([
        {
          name: 'Car registration',
          annualCents: 80000,
          sortOrder: 1,
          origin: 'import',
          sheetRef: 'Budget!E32',
        },
        {
          name: 'Insurance',
          annualCents: 120000,
          sortOrder: 2,
          origin: 'import',
          sheetRef: 'Budget!E33',
        },
      ])
      .run();

    // Side income.
    const stream = (name: string, sortOrder: number) =>
      tx
        .insert(incomeStreams)
        .values({
          name,
          sortOrder,
          origin: 'import',
          sheetRef: `Side Income!${sortOrder === 1 ? 'G' : 'H'}1`,
        })
        .returning({ id: incomeStreams.id })
        .get().id;
    const s1 = stream('Side income 1', 1);
    const s2 = stream('Side income 2', 2);
    // Side income as dated deposits (D57): two at the Jun and Jul 2026 period ends, plus one after
    // the last snapshot (the provisional period). The Stage 1 period entries (side_income_entries)
    // are no longer seeded: the server reads deposits (stage-3.md §4.5).
    tx.insert(sideIncomeDeposits)
      .values([
        {
          streamId: s1,
          depositDate: '2026-06-30',
          amountCents: 50000,
          origin: 'import',
          sheetRef: 'Side Income!G2',
        },
        {
          streamId: s1,
          depositDate: '2026-07-31',
          amountCents: 75000,
          origin: 'import',
          sheetRef: 'Side Income!G3',
        },
        {
          streamId: s2,
          depositDate: '2026-08-20',
          amountCents: 20000,
          origin: 'import',
          sheetRef: 'Side Income!H4',
        },
      ])
      .run();

    // Period notes, one per kind.
    tx.insert(periodNotes)
      .values([
        {
          periodMonth: '2026-07',
          kind: 'spend',
          note: 'Car service',
          origin: 'import',
          sheetRef: 'Cash!Q3',
        },
        {
          periodMonth: '2026-06',
          kind: 'super_option',
          note: 'Switched to the balanced option',
          origin: 'import',
          sheetRef: 'Super!F3',
        },
        {
          periodMonth: '2026-07',
          kind: 'side_income',
          note: 'One-off consulting job',
          origin: 'import',
          sheetRef: 'Side Income!J3',
        },
      ])
      .run();

    // Snapshots: three migrated months.
    const snapshot = (runDate: string, row: number, step: number) => ({
      runDate,
      periodMonth: runDate.slice(0, 7),
      source: 'migrated' as const,
      recordedAt: null,
      origin: 'import' as const,
      sheetRef: `History!A${row}`,
      stocksValueCents: 150000 + step * 10000,
      stocksGainCents: 10000 + step * 1000,
      stocksGainRatio: '0.07',
      stocksMovementsCents: 0,
      etfValueCents: 300000 + step * 20000,
      etfGainCents: 20000 + step * 2000,
      etfGainRatio: '0.071',
      etfMovementsCents: step === 0 ? 300000 : 0,
      cryptoValueCents: 800000,
      cryptoGainCents: 100000,
      cryptoGainRatio: '0.125',
      cryptoMovementsCents: 0,
      cashValueCents: 2500000 + step * 50000,
      cashGainCents: step === 0 ? null : 50000,
      cashIncreaseRatio: step === 0 ? null : '0.02',
      superValueCents: 5000000 + step * 30000,
      superContribCents: 20000,
      superGainCents: 10000,
      superGainRatio: '0.002',
      liabilitiesBalanceCents: -1500000,
      liabilitiesPaidCents: 0,
      salaryMonthlyCents: 600000,
      propertyValueCents: 60000000,
      propertyPurchaseCents: 50000000,
      propertyEquityCents: 20000000 + step * 100000,
      propertyGainCents: 10000000,
      mortgageBalanceCents: -40000000 + step * 100000,
      mortgageInterestFeesCents: 150000,
      mortgagePrincipalPaidCents: 100000,
      propertyGainRatio: '0.2',
      mfValueCents: 150000,
      mfGainCents: 0,
      mfGainRatio: '0',
      mfMovementsCents: 0,
      otherValueCents: 200000,
      otherGainCents: 20000,
    });
    tx.insert(snapshots)
      .values([
        snapshot('2026-05-31', 3, 0),
        snapshot('2026-06-30', 4, 1),
        snapshot('2026-07-31', 5, 2),
      ])
      .run();

    // Other assets: a manual one and a bullion-linked one.
    tx.insert(otherAssets)
      .values([
        {
          description: 'Example watch',
          url: null,
          purchaseDate: '2023-04-01',
          units: '1',
          soldUnits: '0',
          currency: 'AUD',
          unitCost: '1500',
          unitPrice: '1800',
          unitPriceAsOf: SEED_WORKBOOK_AS_OF,
          priceSource: 'manual',
          unitOfMeasure: 'each',
          sortOrder: 1,
          origin: 'import',
          sheetRef: 'Other Assets!F3',
        },
        {
          description: 'Silver bar',
          url: 'https://example.com/silver-bar',
          purchaseDate: '2024-02-01',
          units: '10',
          soldUnits: '0',
          currency: 'AUD',
          unitCost: '35',
          unitPrice: '46.15',
          unitPriceAsOf: SEED_WORKBOOK_AS_OF,
          priceSource: 'bullion',
          metal: 'silver',
          unitOfMeasure: 'oz',
          ozPerUnit: '1',
          sortOrder: 2,
          origin: 'import',
          sheetRef: 'Other Assets!F4',
        },
      ])
      .run();
    // D72: the manual asset's price history (an earlier quote and the workbook's price).
    const watch = tx
      .select({ id: otherAssets.id })
      .from(otherAssets)
      .where(sql`${otherAssets.sheetRef} = 'Other Assets!F3'`)
      .get()!.id;
    tx.insert(otherAssetPrices)
      .values([
        {
          otherAssetId: watch,
          asOf: '2026-03-31',
          unitPrice: '1700',
          note: 'Dealer quote',
          origin: 'import',
          sheetRef: null,
        },
        {
          otherAssetId: watch,
          asOf: SEED_WORKBOOK_AS_OF,
          unitPrice: '1800',
          note: null,
          origin: 'import',
          sheetRef: 'Other Assets!F3',
        },
      ])
      .run();

    // Super.
    const fund = tx
      .insert(superFunds)
      .values({
        name: 'Example Super',
        balanceCents: 5060000,
        balanceAsOf: SEED_WORKBOOK_AS_OF,
        sortOrder: 1,
        origin: 'import',
        sheetRef: 'Super!A2',
        receivesSg: true,
      })
      .returning({ id: superFunds.id })
      .get().id;
    // D69: the fund's balance log (the first snapshot's balance and the workbook's balance).
    tx.insert(superBalanceEntries)
      .values([
        {
          fundId: fund,
          asOf: '2026-05-31',
          balanceCents: 5000000,
          transferInCents: null,
          note: 'Statement',
          origin: 'import',
          sheetRef: null,
        },
        {
          fundId: fund,
          asOf: SEED_WORKBOOK_AS_OF,
          balanceCents: 5060000,
          transferInCents: null,
          note: null,
          origin: 'import',
          sheetRef: 'Super!A2',
        },
      ])
      .run();
    tx.insert(superEntries)
      .values([
        {
          periodMonth: '2026-09',
          kind: 'voluntary_contribution',
          fundId: null,
          // min(the period month's end, the workbook as-of) (stage-4.md §3.5 item 2).
          entryDate: SEED_WORKBOOK_AS_OF,
          amountCents: 20000,
          origin: 'import',
          sheetRef: 'Super!B16',
        },
        {
          periodMonth: '2026-09',
          kind: 'reported_gain',
          fundId: fund,
          amountCents: 10000,
          origin: 'import',
          sheetRef: 'Super!B11',
        },
        // One History-derived contribution per seeded snapshot, at its run date (§3.5 item 2).
        ...(
          [
            ['2026-05-31', 3],
            ['2026-06-30', 4],
            ['2026-07-31', 5],
          ] as const
        ).map(([runDate, row]) => ({
          periodMonth: runDate.slice(0, 7),
          kind: 'voluntary_contribution' as const,
          fundId: null,
          entryDate: runDate,
          amountCents: 20000,
          origin: 'import' as const,
          sheetRef: `History!R${row}`,
        })),
      ])
      .run();

    // Property and loans.
    const property = tx
      .insert(properties)
      .values({
        name: 'Example property',
        purchaseDate: '2020-03-15',
        isPrimaryResidence: true,
        purchaseValueCents: 50000000,
        currentValueCents: 60000000,
        valuationDate: SEED_WORKBOOK_AS_OF,
        netRentToDateCents: 0,
        sortOrder: 1,
        origin: 'import',
        sheetRef: 'Property!D15',
      })
      .returning({ id: properties.id })
      .get().id;
    tx.insert(propertyValuations)
      .values([
        {
          propertyId: property,
          asOf: '2025-08-31',
          valueCents: 58000000,
          note: 'Bank valuation',
          origin: 'import',
          sheetRef: null,
        },
        {
          propertyId: property,
          asOf: SEED_WORKBOOK_AS_OF,
          valueCents: 60000000,
          note: null,
          origin: 'import',
          sheetRef: 'Property!D15',
        },
      ])
      .run();
    const loanIds = tx
      .insert(loans)
      .values([
        {
          propertyId: property,
          name: 'Example property mortgage',
          startDate: '2020-03-15',
          interestPeriodsPerYear: 12,
          annualRate: '0.06',
          paymentCents: 250000,
          paymentFrequency: 'monthly',
          startBalanceCents: 45000000,
          currentBalanceCents: 39800000,
          balanceAsOf: SEED_WORKBOOK_AS_OF,
          paymentsPaidCents: 5200000,
          paymentsPaidDerived: true,
          sortOrder: 1,
          origin: 'import',
          sheetRef: 'Property!D28',
        },
        {
          propertyId: null,
          name: 'Example car loan',
          startDate: '2024-01-10',
          interestPeriodsPerYear: 12,
          annualRate: '0.08',
          paymentCents: 50000,
          paymentFrequency: 'monthly',
          startBalanceCents: 2000000,
          currentBalanceCents: 1500000,
          balanceAsOf: SEED_WORKBOOK_AS_OF,
          paymentsPaidCents: 500000,
          sortOrder: 2,
          origin: 'import',
          sheetRef: 'LiabilitiesDebts!C11',
        },
      ])
      .returning({ id: loans.id })
      .all()
      .map((l) => l.id);
    // D66: each loan's balance log (an earlier balance and the current one); the start fields give
    // the log's start point, so no start entry is stored.
    const [mortgage, carLoan] = loanIds as [number, number];
    tx.insert(loanBalanceEntries)
      .values([
        {
          loanId: mortgage,
          asOf: '2026-05-31',
          balanceCents: 40000000,
          repaymentsCents: null,
          note: 'Statement',
          origin: 'import',
          sheetRef: null,
        },
        {
          loanId: mortgage,
          asOf: SEED_WORKBOOK_AS_OF,
          balanceCents: 39800000,
          repaymentsCents: null,
          note: null,
          origin: 'import',
          sheetRef: 'Property!D28',
        },
        {
          loanId: carLoan,
          asOf: '2025-12-31',
          balanceCents: 1700000,
          repaymentsCents: null,
          note: null,
          origin: 'import',
          sheetRef: null,
        },
        {
          loanId: carLoan,
          asOf: SEED_WORKBOOK_AS_OF,
          balanceCents: 1500000,
          repaymentsCents: null,
          note: null,
          origin: 'import',
          sheetRef: 'LiabilitiesDebts!C11',
        },
      ])
      .run();

    // Settings: one of each value type.
    const setting = (key: string, value: unknown) => ({
      key,
      valueJson: JSON.stringify(value),
      updatedAt: nowIso,
      origin: 'import' as const,
    });
    tx.insert(settings)
      .values([
        setting('pay.dayOfMonth', 15),
        setting('pay.frequency', 'fortnightly'),
        setting('pay.netPayCents', 300000),
        setting('pay.jobStartDate', '2020-01-06'),
        setting('allocation.etf', '0.6'),
        setting('features.cash', true),
        setting('crypto.feeRate', '0.005'),
      ])
      .run();

    // One import run with a small report, and one price job run.
    const checks: ReconciliationReport['checks'] = [
      {
        id: 'counts.trades.stock',
        section: 'counts',
        label: 'Stock trades',
        sheetRef: 'Stocks!A22',
        unit: 'count',
        expected: 4,
        actual: 4,
        diff: 0,
        status: 'match',
        reasonCode: null,
        reason: null,
        refs: { entity: 'trades' },
      },
      {
        id: 'cash.total',
        section: 'cash',
        label: 'Cash total',
        sheetRef: 'Cash!C13',
        unit: 'cents',
        expected: 2800000,
        actual: 2800000,
        diff: 0,
        status: 'match',
        reasonCode: null,
        reason: null,
        refs: null,
      },
      {
        id: 'dividends.link.5',
        section: 'dividends',
        label: 'Dividend ticker ZZZ',
        sheetRef: 'Dividends!A5',
        unit: 'text',
        expected: 'ZZZ',
        actual: null,
        diff: null,
        status: 'suspect',
        reasonCode: 'unmatched_dividend',
        reason: 'No instrument matches this ticker',
        refs: { entity: 'dividends', flags: ['unmatched_ticker'] },
      },
      {
        id: 'holdings.gain.stock',
        section: 'holdings',
        label: 'Stocks gain',
        sheetRef: 'Stocks!E17',
        unit: 'cents',
        expected: 10000,
        actual: null,
        diff: null,
        status: 'info',
        reasonCode: 'derived_later_stage',
        reason: 'Gains need the Stage 2 FIFO engine',
        refs: null,
      },
    ];
    const totals = totalsOf(checks);
    const report: ReconciliationReport = {
      version: 1,
      generatedAt: nowIso,
      workbook: {
        fileName: 'example-workbook.xlsx',
        sha256: SEED_SHA,
        sizeBytes: 123456,
        asOf: SEED_WORKBOOK_AS_OF,
        templateVersion: '2.15.4',
      },
      corrections: { name: null, sha256: null, entries: 0, applied: 0 },
      counts: { instruments: 8, trades: 9, dividends: 2, 'cash-accounts': 4 },
      totals,
      checks,
    };
    const importRunId = tx
      .insert(importRuns)
      .values({
        startedAt: minutesAgo(60),
        finishedAt: minutesAgo(59),
        status: 'succeeded',
        dryRun: false,
        trigger: 'cli',
        fileName: 'example-workbook.xlsx',
        fileSha256: SEED_SHA,
        fileSize: 123456,
        workbookAsOf: SEED_WORKBOOK_AS_OF,
        correctionsName: null,
        correctionsSha256: null,
        importerVersion: '1.0.0',
        totalsJson: JSON.stringify(totals),
        reportJson: JSON.stringify(report),
      })
      .returning({ id: importRuns.id })
      .get().id;
    const jobRunId = tx
      .insert(jobRuns)
      .values({
        job: 'prices',
        trigger: 'schedule',
        startedAt: minutesAgo(30),
        finishedAt: minutesAgo(29),
        status: 'partial',
        detailJson: JSON.stringify({
          requested: 6,
          ok: 3,
          failed: 1,
          skipped: 2,
          byProvider: { yahoo: { ok: 1, failed: 1 }, coingecko: { ok: 2, failed: 0 } },
        }),
        error: null,
      })
      .returning({ id: jobRuns.id })
      .get().id;

    return { instrumentIds: ids, importRunId, jobRunId };
  });
}

/**
 * Stage 5 (stage-5.md §3.6, testing only): inserts one `recorded` snapshot for `periodMonth` with
 * generic figures, origin `app`, the four extras set (offsets $15,000 of which $10,000 are linked
 * to the mortgage, an account $300 in debit, super measured four days before the run date) and one
 * audit `record` row. The derived columns follow the stage-5.md §2.5 rules against the latest
 * snapshot before it (its `cash_value_cents`). Returns the new ids.
 */
export function seedRecordedMonth(
  db: JoinrDb,
  { periodMonth, runDate }: { periodMonth: string; runDate: string },
): { snapshotId: number; auditId: number } {
  const ratio = (g: number, v: number): string =>
    v - g === 0
      ? '0'
      : normaliseDecimal(
          new JoinrDecimal(g).div(v - g).toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP),
        );
  const previous = db
    .select({ cash: snapshots.cashValueCents, runDate: snapshots.runDate })
    .from(snapshots)
    .all()
    .filter((r) => r.runDate <= runDate)
    .sort((a, b) => (a.runDate < b.runDate ? -1 : a.runDate > b.runDate ? 1 : 0))
    .at(-1);
  const cash = 2700000;
  const previousCash = previous?.cash ?? null;
  const cashGain = previousCash === null ? null : cash - previousCash;
  const property = 60300000;
  const mortgage = -39600000;
  const linked = 1000000;
  const recordedAt = `${runDate}T13:00:05.000Z`;
  const measured = new Date(`${runDate}T00:00:00.000Z`);
  measured.setUTCDate(measured.getUTCDate() - 4);
  const row = {
    runDate,
    periodMonth,
    source: 'recorded' as const,
    recordedAt,
    origin: 'app' as const,
    sheetRef: null,
    stocksValueCents: 185000,
    stocksGainCents: 13000,
    stocksGainRatio: ratio(13000, 185000),
    stocksMovementsCents: 0,
    etfValueCents: 370000,
    etfGainCents: 26000,
    etfGainRatio: ratio(26000, 370000),
    etfMovementsCents: 0,
    cryptoValueCents: 800000,
    cryptoGainCents: 100000,
    cryptoGainRatio: ratio(100000, 800000),
    cryptoMovementsCents: 0,
    cashValueCents: cash,
    cashGainCents: cashGain,
    cashIncreaseRatio: cashGain === null ? '0' : ratio(cashGain, cash),
    superValueCents: 5120000,
    superContribCents: 20000,
    superGainCents: 10000,
    superGainRatio: ratio(10000, 5120000),
    liabilitiesBalanceCents: 0,
    liabilitiesPaidCents: 0,
    salaryMonthlyCents: 600000,
    propertyValueCents: property,
    propertyPurchaseCents: 50000000,
    propertyEquityCents: property + mortgage + linked,
    propertyGainCents: property - 50000000,
    mortgageBalanceCents: mortgage,
    mortgageInterestFeesCents: 450000,
    mortgagePrincipalPaidCents: 400000,
    propertyGainRatio: ratio(property - 50000000, property),
    mfValueCents: 150000,
    mfGainCents: 0,
    mfGainRatio: '0',
    mfMovementsCents: 0,
    otherValueCents: 200000,
    otherGainCents: 20000,
    offsetCents: 1500000,
    mortgageOffsetCents: linked,
    cashDebtCents: -30000,
    superMeasuredThrough: measured.toISOString().slice(0, 10),
    note: null,
    revision: 0,
  };
  return db.transaction((tx) => {
    const snapshotId = tx.insert(snapshots).values(row).returning({ id: snapshots.id }).get().id;
    const auditId = tx
      .insert(snapshotAudit)
      .values({
        periodMonth,
        snapshotId,
        action: 'record',
        trigger: 'manual',
        at: recordedAt,
        changesJson: null,
        snapshotJson: JSON.stringify({ id: snapshotId, ...row }),
        note: null,
        detailJson: JSON.stringify({
          pricesAsOf: null,
          marketMode: 'off',
          pricesRefreshed: false,
          pricesAgeMs: null,
          jobRunId: null,
        }),
      })
      .returning({ id: snapshotAudit.id })
      .get().id;
    return { snapshotId, auditId };
  });
}
