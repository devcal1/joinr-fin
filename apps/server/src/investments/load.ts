// The investments loader (stage-2.md §4.5 step 2, §2.12): every row the investment pages need,
// read in ONE read transaction so a concurrent CLI import (another process) cannot give a mixed
// snapshot, plus the DB row → engine input conversions. The data is small (a personal ledger), so
// every kind is loaded at once; the engine sorts trades itself.
import type { EngineDividend, EngineInstrument, EngineTrade } from '@joinr/engine';
import type { BudgetItemKind, InstrumentKind, IsoDate } from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  dividends,
  instruments,
  otherAssets,
  sideIncomeEntries,
  snapshots,
  trades,
  yearlyExpenses,
  type TableRow,
} from '@joinr/schema/db';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/database';
import type { Tx } from '../db/queries/domain';
import { readSettings, type SettingsLog, type SettingsValues } from '../db/queries/settings';
import { otherAssetValueCents } from '../records/index';

export type InstrumentRow = TableRow<typeof instruments>;
export type TradeRow = TableRow<typeof trades>;
export type DividendRow = TableRow<typeof dividends>;
export type SnapshotRow = TableRow<typeof snapshots>;

/** One filled side-income period: Σ of its streams (stage-2.md §2.12). */
export interface SideIncomePeriod {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amountCents: number;
}

/** The imported budget inputs of the timing block (static until Stage 3). */
export interface BudgetRows {
  /** Budget rows of kind `item` only (the `auto_*` rows are derived). */
  items: { kind: BudgetItemKind; monthlyCents: number | null }[];
  yearlyExpenseAnnualCents: number[];
  /** Σ per `period_month`, in period order. */
  sideIncomePeriods: SideIncomePeriod[];
  /** Σ non-offset cash account balances (the imported balances until Stage 3). */
  cashCents: number;
  /** Σ (units − sold) × unit price of the AUD other assets (static until Stage 4). */
  otherAssetsCents: number;
}

export interface InvestmentData {
  /** Every instrument, in sortOrder then id. */
  instruments: InstrumentRow[];
  /** Every trade, by id. */
  trades: TradeRow[];
  /** Every dividend, by id. */
  dividends: DividendRow[];
  settings: SettingsValues;
  /** Every snapshot, by period. */
  snapshots: SnapshotRow[];
  budget: BudgetRows;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** `2026-02` → `2026-02-28`. */
export function lastDayOfMonth(month: string): IsoDate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad(day, 2)}`;
}

/** Side-income entries summed per period over their streams (only filled periods exist). */
export function sideIncomePeriodsOf(
  rows: readonly {
    periodMonth: string;
    periodStart: string | null;
    periodEnd: string | null;
    amountCents: number;
  }[],
): SideIncomePeriod[] {
  const byMonth = new Map<string, { start: string | null; end: string | null; amount: number }>();
  for (const r of rows) {
    const cur = byMonth.get(r.periodMonth) ?? { start: null, end: null, amount: 0 };
    if (r.periodStart !== null && (cur.start === null || r.periodStart < cur.start)) {
      cur.start = r.periodStart;
    }
    if (r.periodEnd !== null && (cur.end === null || r.periodEnd > cur.end)) cur.end = r.periodEnd;
    cur.amount += r.amountCents;
    byMonth.set(r.periodMonth, cur);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, v]) => ({
      periodStart: v.start ?? `${month}-01`,
      periodEnd: v.end ?? lastDayOfMonth(month),
      amountCents: v.amount,
    }));
}

function readBudget(tx: Db | Tx): BudgetRows {
  const items = tx
    .select({ kind: budgetItems.kind, monthlyCents: budgetItems.monthlyCents })
    .from(budgetItems)
    .where(eq(budgetItems.kind, 'item'))
    .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.id))
    .all();
  const yearly = tx
    .select({ annualCents: yearlyExpenses.annualCents })
    .from(yearlyExpenses)
    .orderBy(asc(yearlyExpenses.sortOrder), asc(yearlyExpenses.id))
    .all()
    .map((r) => r.annualCents);
  const side = sideIncomePeriodsOf(
    tx
      .select({
        periodMonth: sideIncomeEntries.periodMonth,
        periodStart: sideIncomeEntries.periodStart,
        periodEnd: sideIncomeEntries.periodEnd,
        amountCents: sideIncomeEntries.amountCents,
      })
      .from(sideIncomeEntries)
      .all(),
  );
  const cashCents = tx
    .select({ balanceCents: cashAccounts.balanceCents })
    .from(cashAccounts)
    .where(eq(cashAccounts.isOffset, false))
    .all()
    .reduce((sum, r) => sum + r.balanceCents, 0);
  const otherAssetsCents = tx
    .select()
    .from(otherAssets)
    .all()
    .reduce((sum, a) => sum + (otherAssetValueCents(a) ?? 0), 0);
  return {
    items,
    yearlyExpenseAnnualCents: yearly,
    sideIncomePeriods: side,
    cashCents,
    otherAssetsCents,
  };
}

/** Every row the investments API reads, from one consistent read snapshot. */
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
      snapshots: tx.select().from(snapshots).orderBy(asc(snapshots.periodMonth)).all(),
      budget: readBudget(tx),
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
