// The finance loader (stage-2.md §4.5 step 2, stage-3.md §4.5 "One request context"): every row
// the investment and cash-flow pages and the timing chain need, read in ONE read transaction so a
// concurrent CLI import (another process) cannot give a mixed snapshot, plus the DB row → engine
// input conversions. The data is small (a personal ledger), so everything is loaded at once; the
// engine sorts trades itself.
import type { EngineDividend, EngineInstrument, EngineTrade } from '@joinr/engine';
import type { InstrumentKind, JobName } from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
  dividendEvents,
  dividends,
  incomeStreams,
  instruments,
  jobRuns,
  loans,
  otherAssets,
  periodNotes,
  properties,
  savingsAdjustments,
  savingsGoals,
  settings,
  sideIncomeDeposits,
  snapshots,
  superEntries,
  trades,
  yearlyExpenses,
  type TableRow,
} from '@joinr/schema/db';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/database';
import type { Tx } from '../db/queries/domain';
import { readSettings, type SettingsLog, type SettingsValues } from '../db/queries/settings';

export type InstrumentRow = TableRow<typeof instruments>;
export type TradeRow = TableRow<typeof trades>;
export type DividendRow = TableRow<typeof dividends>;
export type SnapshotRow = TableRow<typeof snapshots>;
export type CashAccountRow = TableRow<typeof cashAccounts>;
export type CashBalanceEntryRow = TableRow<typeof cashBalanceEntries>;
export type BudgetItemRow = TableRow<typeof budgetItems>;
export type YearlyExpenseRow = TableRow<typeof yearlyExpenses>;
export type IncomeStreamRow = TableRow<typeof incomeStreams>;
export type SideIncomeDepositRow = TableRow<typeof sideIncomeDeposits>;
export type PeriodNoteRow = TableRow<typeof periodNotes>;
export type SavingsAdjustmentRow = TableRow<typeof savingsAdjustments>;
export type SavingsGoalRow = TableRow<typeof savingsGoals>;
export type SuperEntryRow = TableRow<typeof superEntries>;
export type PropertyRow = TableRow<typeof properties>;
export type LoanRow = TableRow<typeof loans>;
export type OtherAssetRow = TableRow<typeof otherAssets>;
export type DividendEventRow = TableRow<typeof dividendEvents>;
export type JobRunRow = TableRow<typeof jobRuns>;

/** A `settings` row's stored origin (null value JSON included), by key. */
export type SettingOrigins = ReadonlyMap<string, TableRow<typeof settings>['origin']>;

export interface InvestmentData {
  /** Every instrument, in sortOrder then id. */
  instruments: InstrumentRow[];
  /** Every trade, by id. */
  trades: TradeRow[];
  /** Every dividend, by id. */
  dividends: DividendRow[];
  settings: SettingsValues;
  /** The stored origin of every `settings` row (a key never stored is absent). */
  settingOrigins: SettingOrigins;
  /** Every snapshot, by period. */
  snapshots: SnapshotRow[];
  // ─── Stage 3 (stage-3.md §4.5) ───
  /** Every cash account, in sortOrder then id. */
  cashAccounts: CashAccountRow[];
  /** Every balance entry (D58), by id. */
  balanceEntries: CashBalanceEntryRow[];
  /** Every budget row (items and auto rows), in sort_order then id. */
  budgetItems: BudgetItemRow[];
  /** Every yearly expense, in sort_order then id. */
  yearlyExpenses: YearlyExpenseRow[];
  /** Every income stream, in sort_order then id. */
  incomeStreams: IncomeStreamRow[];
  /** Every side-income deposit (D57), by id. */
  deposits: SideIncomeDepositRow[];
  /** Every period note, by id. */
  periodNotes: PeriodNoteRow[];
  /** Every savings adjustment (D51), by period. */
  adjustments: SavingsAdjustmentRow[];
  /** Every savings goal (D55), in the waterfall order (sort_order, then id). */
  goals: SavingsGoalRow[];
  /** Every super entry, by period then id. */
  superEntries: SuperEntryRow[];
  properties: PropertyRow[];
  loans: LoanRow[];
  /** Every other asset, in sort_order then id. */
  otherAssets: OtherAssetRow[];
  /** The dividend-events cache (D50), by instrument then ex-date. */
  dividendEvents: DividendEventRow[];
  /** The latest `dividends` job run, or null. */
  lastDividendsRun: JobRunRow | null;
}

/** The latest job run of `name` (by start time, then id), or null. */
export function latestJobRun(tx: Db | Tx, name: JobName): JobRunRow | null {
  return (
    tx
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.job, name))
      .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
      .limit(1)
      .get() ?? null
  );
}

function readSettingOrigins(tx: Db | Tx): Map<string, TableRow<typeof settings>['origin']> {
  return new Map(
    tx
      .select({ key: settings.key, origin: settings.origin })
      .from(settings)
      .all()
      .map((r) => [r.key, r.origin]),
  );
}

/** Every row the investment and cash-flow APIs read, from one consistent read snapshot. */
export function loadInvestmentData(db: Db, log?: SettingsLog): InvestmentData {
  return db.transaction(
    (tx) => ({
      instruments: tx
        .select()
        .from(instruments)
        .orderBy(asc(instruments.sortOrder), asc(instruments.id))
        .all(),
      trades: tx.select().from(trades).orderBy(asc(trades.id)).all(),
      dividends: tx.select().from(dividends).orderBy(asc(dividends.id)).all(),
      settings: readSettings(tx, log),
      settingOrigins: readSettingOrigins(tx),
      snapshots: tx.select().from(snapshots).orderBy(asc(snapshots.periodMonth)).all(),
      cashAccounts: tx
        .select()
        .from(cashAccounts)
        .orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.id))
        .all(),
      balanceEntries: tx
        .select()
        .from(cashBalanceEntries)
        .orderBy(asc(cashBalanceEntries.id))
        .all(),
      budgetItems: tx
        .select()
        .from(budgetItems)
        .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.id))
        .all(),
      yearlyExpenses: tx
        .select()
        .from(yearlyExpenses)
        .orderBy(asc(yearlyExpenses.sortOrder), asc(yearlyExpenses.id))
        .all(),
      incomeStreams: tx
        .select()
        .from(incomeStreams)
        .orderBy(asc(incomeStreams.sortOrder), asc(incomeStreams.id))
        .all(),
      deposits: tx.select().from(sideIncomeDeposits).orderBy(asc(sideIncomeDeposits.id)).all(),
      periodNotes: tx.select().from(periodNotes).orderBy(asc(periodNotes.id)).all(),
      adjustments: tx
        .select()
        .from(savingsAdjustments)
        .orderBy(asc(savingsAdjustments.periodMonth))
        .all(),
      goals: tx
        .select()
        .from(savingsGoals)
        .orderBy(asc(savingsGoals.sortOrder), asc(savingsGoals.id))
        .all(),
      superEntries: tx
        .select()
        .from(superEntries)
        .orderBy(asc(superEntries.periodMonth), asc(superEntries.id))
        .all(),
      properties: tx.select().from(properties).orderBy(asc(properties.id)).all(),
      loans: tx.select().from(loans).orderBy(asc(loans.id)).all(),
      otherAssets: tx
        .select()
        .from(otherAssets)
        .orderBy(asc(otherAssets.sortOrder), asc(otherAssets.id))
        .all(),
      dividendEvents: tx
        .select()
        .from(dividendEvents)
        .orderBy(asc(dividendEvents.instrumentId), asc(dividendEvents.exDate))
        .all(),
      lastDividendsRun: latestJobRun(tx, 'dividends'),
    }),
    { behavior: 'deferred' },
  );
}

// ─── Row → engine input ─────────────────────────────────────────────────────────────────────────

export function toEngineInstrument(r: InstrumentRow): EngineInstrument {
  return {
    id: r.id,
    kind: r.kind,
    symbol: r.symbol,
    name: r.name,
    watched: r.isWatched,
    sortOrder: r.sortOrder,
    targetRatio: r.targetRatio,
    sector: r.sector,
    regions: {
      us: r.regionUsRatio,
      asia: r.regionAsiaRatio,
      aus: r.regionAusRatio,
      other: r.regionOtherRatio,
    },
    mgmtFeeRatio: r.mgmtFeeRatio,
    dividendFreqMonths: r.dividendFreqMonths,
  };
}

/** Fee authority fields straight through (stage-1 §2.4): the engine decides from `feeRate`. */
export function toEngineTrade(r: TradeRow): EngineTrade {
  return {
    id: r.id,
    instrumentId: r.instrumentId,
    tradeDate: r.tradeDate,
    units: r.units,
    price: r.price,
    feeCents: r.feeCents,
    feeRate: r.feeRate,
    seq: r.seq,
  };
}

export function toEngineDividend(r: DividendRow): EngineDividend {
  return {
    id: r.id,
    instrumentId: r.instrumentId,
    holdingKind: r.holdingKind,
    paymentDate: r.paymentDate,
    exDate: r.exDate,
    reinvested: r.reinvested,
    netAmountCents: r.netAmountCents,
    priceAtEx: r.priceAtEx,
  };
}

/** The rows of one kind: its instruments, their trades and the dividends of that holding kind. */
export interface KindRows {
  instruments: InstrumentRow[];
  trades: TradeRow[];
  dividends: DividendRow[];
}

export function rowsOfKind(data: InvestmentData, kind: InstrumentKind): KindRows {
  const kindInstruments = data.instruments.filter((i) => i.kind === kind);
  const ids = new Set(kindInstruments.map((i) => i.id));
  return {
    instruments: kindInstruments,
    trades: data.trades.filter((t) => ids.has(t.instrumentId)),
    dividends: data.dividends.filter((d) => d.holdingKind === kind),
  };
}
