// The read-only record browser (stage-1.md §2.6, §3.2): registry-driven queries and serialisation.
//
// Every entity in RECORD_ENTITIES has a loader that returns its rows as `RecordRow`s whose cells
// are keyed by the registry's column ids. Money is integer cents; quantities, prices and ratios
// are decimal strings; review flags are string arrays ([] when none).
import {
  isSettingKey,
  JoinrDecimal,
  multiplyToCents,
  parseReviewFlags,
  RECORD_ENTITIES,
  RECORD_ENTITY_IDS,
  RECORDS_PAGE_CAP,
  settingDef,
  SNAPSHOT_VALUE_COLUMNS,
  type RecordCell,
  type RecordColumnType,
  type RecordEntityId,
  type RecordEntitySummary,
  type RecordRow,
  type RecordsIndexResponse,
  type RecordsPageResponse,
} from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  dividends,
  incomeStreams,
  instruments,
  loans,
  otherAssets,
  periodNotes,
  priceSources,
  properties,
  settings,
  sideIncomeEntries,
  snapshots,
  superEntries,
  superFunds,
  trades,
  yearlyExpenses,
} from '@joinr/schema/db';
import { asc, count, eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/database';
import { heldUnitsByInstrument } from '../db/queries/holdings';

/** The Drizzle table behind each entity (counts). */
const ENTITY_TABLES: Readonly<Record<RecordEntityId, SQLiteTable>> = {
  instruments,
  trades,
  dividends,
  'cash-accounts': cashAccounts,
  'budget-items': budgetItems,
  'yearly-expenses': yearlyExpenses,
  'income-streams': incomeStreams,
  'side-income': sideIncomeEntries,
  'period-notes': periodNotes,
  snapshots,
  'other-assets': otherAssets,
  'super-funds': superFunds,
  'super-entries': superEntries,
  properties,
  loans,
  settings,
};

type Loader = (db: Db) => RecordRow[];

const flags = (value: string | null): string[] => {
  try {
    return parseReviewFlags(value);
  } catch {
    // A malformed column should not break the browser; the row simply shows no flags.
    return [];
  }
};

const row = (id: number | string, cells: Record<string, RecordCell>): RecordRow => ({
  id: String(id),
  cells,
});

const loadInstruments: Loader = (db) => {
  const held = heldUnitsByInstrument(db);
  return db
    .select({
      i: instruments,
      provider: priceSources.provider,
      providerSymbol: priceSources.providerSymbol,
    })
    .from(instruments)
    .leftJoin(priceSources, eq(priceSources.instrumentId, instruments.id))
    .orderBy(asc(instruments.sortOrder), asc(instruments.id))
    .all()
    .map(({ i, provider, providerSymbol }) =>
      row(i.id, {
        kind: i.kind,
        symbol: i.symbol,
        name: i.name,
        currency: i.quoteCurrency,
        watched: i.isWatched,
        heldUnits: held.get(i.id) ?? '0',
        targetRatio: i.targetRatio,
        sector: i.sector,
        retirement: i.isRetirement,
        mgmtFeeRatio: i.mgmtFeeRatio,
        location: i.location,
        regionUs: i.regionUsRatio,
        regionAsia: i.regionAsiaRatio,
        regionAus: i.regionAusRatio,
        regionOther: i.regionOtherRatio,
        dividendFreqMonths: i.dividendFreqMonths,
        drp: i.drp,
        provider,
        providerSymbol,
        origin: i.origin,
      }),
    );
};

const loadTrades: Loader = (db) =>
  db
    .select({ t: trades, symbol: instruments.symbol, kind: instruments.kind })
    .from(trades)
    .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
    .orderBy(asc(trades.id))
    .all()
    .map(({ t, symbol, kind }) =>
      row(t.id, {
        date: t.tradeDate,
        symbol,
        kind,
        units: t.units,
        price: t.price,
        orderValue: multiplyToCents(t.units, t.price),
        fee: t.feeCents,
        feeRate: t.feeRate,
        seq: t.seq,
        flags: flags(t.reviewFlags),
        correction: t.correctionId,
        sheetRef: t.sheetRef,
      }),
    );

const loadDividends: Loader = (db) =>
  db
    .select({ d: dividends, symbol: instruments.symbol })
    .from(dividends)
    .leftJoin(instruments, eq(instruments.id, dividends.instrumentId))
    .orderBy(asc(dividends.id))
    .all()
    .map(({ d, symbol }) =>
      row(d.id, {
        paymentDate: d.paymentDate,
        ticker: d.ticker,
        symbol,
        kind: d.holdingKind,
        exDate: d.exDate,
        reinvested: d.reinvested,
        netAmount: d.netAmountCents,
        priceAtEx: d.priceAtEx,
        flags: flags(d.reviewFlags),
        sheetRef: d.sheetRef,
      }),
    );

const loadCashAccounts: Loader = (db) =>
  db
    .select()
    .from(cashAccounts)
    .orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.id))
    .all()
    .map((c) =>
      row(c.id, {
        name: c.name,
        kind: c.kind,
        currency: c.currency,
        balance: c.balanceCents,
        offset: c.isOffset,
        balanceAsOf: c.balanceAsOf,
        sheetRef: c.sheetRef,
      }),
    );

const loadBudgetItems: Loader = (db) =>
  db
    .select({ b: budgetItems, linkedAccount: cashAccounts.name })
    .from(budgetItems)
    .leftJoin(cashAccounts, eq(cashAccounts.id, budgetItems.cashAccountId))
    .orderBy(asc(budgetItems.sortOrder), asc(budgetItems.id))
    .all()
    .map(({ b, linkedAccount }) =>
      row(b.id, {
        name: b.name,
        kind: b.kind,
        monthly: b.monthlyCents,
        category: b.category,
        account: b.accountName,
        linkedAccount,
        flags: flags(b.reviewFlags),
      }),
    );

const loadYearlyExpenses: Loader = (db) =>
  db
    .select()
    .from(yearlyExpenses)
    .orderBy(asc(yearlyExpenses.sortOrder), asc(yearlyExpenses.id))
    .all()
    .map((y) => row(y.id, { name: y.name, annual: y.annualCents }));

const loadIncomeStreams: Loader = (db) =>
  db
    .select()
    .from(incomeStreams)
    .orderBy(asc(incomeStreams.sortOrder), asc(incomeStreams.id))
    .all()
    .map((s) => row(s.id, { name: s.name, archived: s.archived }));

const loadSideIncome: Loader = (db) =>
  db
    .select({ e: sideIncomeEntries, stream: incomeStreams.name })
    .from(sideIncomeEntries)
    .innerJoin(incomeStreams, eq(incomeStreams.id, sideIncomeEntries.streamId))
    .orderBy(asc(sideIncomeEntries.id))
    .all()
    .map(({ e, stream }) =>
      row(e.id, {
        period: e.periodMonth,
        stream,
        start: e.periodStart,
        end: e.periodEnd,
        amount: e.amountCents,
      }),
    );

const loadPeriodNotes: Loader = (db) =>
  db
    .select()
    .from(periodNotes)
    .orderBy(asc(periodNotes.id))
    .all()
    .map((n) => row(n.id, { period: n.periodMonth, kind: n.kind, note: n.note }));

/** History DB column name → the Drizzle property that holds it. */
const SNAPSHOT_PROPERTY_BY_DB_COLUMN: ReadonlyMap<string, string> = new Map(
  Object.entries(getTableColumns(snapshots)).map(([property, column]) => [column.name, property]),
);

const loadSnapshots: Loader = (db) =>
  db
    .select()
    .from(snapshots)
    .orderBy(asc(snapshots.id))
    .all()
    .map((s) => {
      const values = s as unknown as Record<string, number | string | null>;
      const cells: Record<string, RecordCell> = {
        runDate: s.runDate,
        period: s.periodMonth,
        source: s.source,
      };
      for (const c of SNAPSHOT_VALUE_COLUMNS) {
        const property = SNAPSHOT_PROPERTY_BY_DB_COLUMN.get(c.dbColumn);
        cells[c.id] = property === undefined ? null : (values[property] ?? null);
      }
      return row(s.id, cells);
    });

/** Remaining units × unit price in cents; only for AUD rows (other currencies are not converted). */
function otherAssetValueCents(a: {
  units: string;
  soldUnits: string;
  unitPrice: string | null;
  currency: string;
}): number | null {
  if (a.unitPrice === null || a.currency !== 'AUD') return null;
  try {
    const remaining = new JoinrDecimal(a.units).minus(a.soldUnits).toFixed();
    return multiplyToCents(remaining, a.unitPrice);
  } catch {
    return null;
  }
}

const loadOtherAssets: Loader = (db) =>
  db
    .select()
    .from(otherAssets)
    .orderBy(asc(otherAssets.sortOrder), asc(otherAssets.id))
    .all()
    .map((a) =>
      row(a.id, {
        description: a.description,
        url: a.url,
        purchaseDate: a.purchaseDate,
        units: a.units,
        soldUnits: a.soldUnits,
        currency: a.currency,
        unitCost: a.unitCost,
        unitPrice: a.unitPrice,
        priceSource: a.priceSource,
        metal: a.metal,
        unitOfMeasure: a.unitOfMeasure,
        value: otherAssetValueCents(a),
      }),
    );

const loadSuperFunds: Loader = (db) =>
  db
    .select()
    .from(superFunds)
    .orderBy(asc(superFunds.sortOrder), asc(superFunds.id))
    .all()
    .map((f) => row(f.id, { name: f.name, balance: f.balanceCents, balanceAsOf: f.balanceAsOf }));

const loadSuperEntries: Loader = (db) =>
  db
    .select({ e: superEntries, fund: superFunds.name })
    .from(superEntries)
    .leftJoin(superFunds, eq(superFunds.id, superEntries.fundId))
    .orderBy(asc(superEntries.id))
    .all()
    .map(({ e, fund }) =>
      row(e.id, { period: e.periodMonth, kind: e.kind, fund, amount: e.amountCents }),
    );

const loadProperties: Loader = (db) =>
  db
    .select()
    .from(properties)
    .orderBy(asc(properties.sortOrder), asc(properties.id))
    .all()
    .map((p) =>
      row(p.id, {
        name: p.name,
        purchaseDate: p.purchaseDate,
        primaryResidence: p.isPrimaryResidence,
        purchaseValue: p.purchaseValueCents,
        currentValue: p.currentValueCents,
        netRent: p.netRentToDateCents,
      }),
    );

const loadLoans: Loader = (db) =>
  db
    .select({ l: loans, property: properties.name })
    .from(loans)
    .leftJoin(properties, eq(properties.id, loans.propertyId))
    .orderBy(asc(loans.sortOrder), asc(loans.id))
    .all()
    .map(({ l, property }) =>
      row(l.id, {
        name: l.name,
        property,
        startDate: l.startDate,
        annualRate: l.annualRate,
        periodsPerYear: l.interestPeriodsPerYear,
        payment: l.paymentCents,
        startBalance: l.startBalanceCents,
        currentBalance: l.currentBalanceCents,
        paymentsPaid: l.paymentsPaidCents,
        paymentsPaidDerived: l.paymentsPaidDerived,
      }),
    );

/** A stored `value_json` as a cell: scalars as they are, anything else as JSON text. */
function settingCell(valueJson: string): RecordCell {
  let value: unknown;
  try {
    value = JSON.parse(valueJson);
  } catch {
    return null;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value as RecordCell;
  }
  return JSON.stringify(value);
}

const loadSettings: Loader = (db) =>
  db
    .select()
    .from(settings)
    .orderBy(asc(settings.key))
    .all()
    .map((s) => {
      const def = isSettingKey(s.key) ? settingDef(s.key) : null;
      const record: RecordRow = {
        id: s.key,
        cells: {
          key: s.key,
          label: def?.label ?? s.key,
          category: def?.category ?? null,
          value: settingCell(s.valueJson),
          updatedAt: s.updatedAt,
        },
      };
      if (def) record.valueType = def.type;
      return record;
    });

const LOADERS: Readonly<Record<RecordEntityId, Loader>> = {
  instruments: loadInstruments,
  trades: loadTrades,
  dividends: loadDividends,
  'cash-accounts': loadCashAccounts,
  'budget-items': loadBudgetItems,
  'yearly-expenses': loadYearlyExpenses,
  'income-streams': loadIncomeStreams,
  'side-income': loadSideIncome,
  'period-notes': loadPeriodNotes,
  snapshots: loadSnapshots,
  'other-assets': loadOtherAssets,
  'super-funds': loadSuperFunds,
  'super-entries': loadSuperEntries,
  properties: loadProperties,
  loans: loadLoans,
  settings: loadSettings,
};

const DECIMAL_TYPES: ReadonlySet<RecordColumnType> = new Set(['quantity', 'price', 'ratio']);

/** Compares two non-null cells of one column type (decimal strings numerically). */
function compareCells(a: RecordCell, b: RecordCell, type: RecordColumnType): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'string' && typeof b === 'string') {
    if (DECIMAL_TYPES.has(type)) {
      try {
        return new JoinrDecimal(a).comparedTo(b);
      } catch {
        // fall through to text order
      }
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Orders rows by the entity's default sort column (nulls last in either direction). The sort is
 * stable, so rows with equal keys keep the loader's natural order (sheet order).
 */
export function sortRows(entity: RecordEntityId, rows: RecordRow[]): RecordRow[] {
  const meta = RECORD_ENTITIES[entity];
  const { columnId, desc = false } = meta.defaultSort;
  const type = meta.columns.find((c) => c.id === columnId)?.type ?? 'text';
  return [...rows].sort((ra, rb) => {
    const a = ra.cells[columnId] ?? null;
    const b = rb.cells[columnId] ?? null;
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    const c = compareCells(a, b, type);
    return desc ? -c : c;
  });
}

function countRows(db: Db, entity: RecordEntityId): number {
  return db.select({ n: count() }).from(ENTITY_TABLES[entity]).get()?.n ?? 0;
}

function summary(db: Db, entity: RecordEntityId): RecordEntitySummary {
  const meta = RECORD_ENTITIES[entity];
  return { id: entity, label: meta.label, group: meta.group, count: countRows(db, entity) };
}

/** `GET /api/records`: every entity in registry order with its row count. */
export function recordsIndex(db: Db): RecordsIndexResponse {
  return { entities: RECORD_ENTITY_IDS.map((id) => summary(db, id)) };
}

/** `GET /api/records/:entity`: the registry columns and all rows (default sort, capped). */
export function recordsPage(db: Db, entity: RecordEntityId): RecordsPageResponse {
  const rows = sortRows(entity, LOADERS[entity](db)).slice(0, RECORDS_PAGE_CAP);
  return {
    entity: summary(db, entity),
    columns: RECORD_ENTITIES[entity].columns.map((c) => ({ ...c })),
    rows,
  };
}
