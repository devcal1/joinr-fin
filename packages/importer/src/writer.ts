// Replace-all writes inside the import transaction (stage-1.md §4.8, stage-3.md §3.5). Every row
// is validated with its Zod insert schema first; instruments are upserted by (kind, symbol) so
// their ids (and the price data hanging off them) survive re-imports; cash account kinds are
// carried over by name or sheet ref (D49); the overlay tables (savings adjustments and goals, the
// dividend-events cache) are never touched.
import {
  decimalFromNumber,
  derivePriceSource,
  isSettingKey,
  isWorkbookSetting,
  newBudgetItemSchema,
  newCashAccountSchema,
  newCashBalanceEntrySchema,
  newDividendSchema,
  newIncomeStreamSchema,
  newInstrumentSchema,
  newLoanSchema,
  newOtherAssetSchema,
  newPeriodNoteSchema,
  newPriceSchema,
  newPriceSourceSchema,
  newPropertySchema,
  newSettingSchema,
  newSideIncomeDepositSchema,
  newSnapshotSchema,
  newSuperEntrySchema,
  newSuperFundSchema,
  newTradeSchema,
  newYearlyExpenseSchema,
  serialiseReviewFlags,
} from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
  DOMAIN_TABLES_DELETE_ORDER,
  dividends,
  incomeStreams,
  instruments,
  loans,
  otherAssets,
  periodNotes,
  priceSources,
  prices,
  properties,
  settings,
  sideIncomeDeposits,
  snapshots,
  superEntries,
  superFunds,
  trades,
  yearlyExpenses,
  type JoinrDb,
} from '@joinr/schema/db';
import { asc, eq, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import { WorkbookFormatError } from './errors';
import type { InstrumentDraft, WorkbookModel } from './model';
import { carryAccountKinds, instrumentKey } from './process';

export type Tx = Parameters<Parameters<JoinrDb['transaction']>[0]>[0];

/** How the importer treated an instrument's sheet price (§4.4). */
export type PriceTreatment =
  | { mode: 'seeded'; price: string } // a new `prices` row from the workbook
  | { mode: 'kept'; price: string; source: string | null } // a prices row already existed
  | { mode: 'manual'; price: string } // typed price → manual price (manual_origin 'import')
  | { mode: 'manual_user'; price: string } // typed, but a user override is kept
  | { mode: 'none' };

export interface WriteResult {
  instrumentIds: Map<string, number>;
  priceTreatment: Map<string, PriceTreatment>;
  /** Setting keys the workbook provided (written or already equal). */
  settingKeys: string[];
  /** Names of the stored non-bank accounts whose kind no imported account took (D49). */
  kindsNotCarried: string[];
}

function valid<S extends z.ZodType>(schema: S, row: unknown, ref: string): z.output<S> {
  const result = schema.safeParse(row);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue && issue.path.length > 0 ? ` (${issue.path.map(String).join('.')})` : '';
    throw new WorkbookFormatError(`${ref} holds a value the app cannot store${field}`);
  }
  return result.data;
}

const insertId = (result: { lastInsertRowid: number | bigint }): number =>
  Number(result.lastInsertRowid);

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function instrumentRow(d: InstrumentDraft) {
  return {
    kind: d.kind,
    symbol: d.symbol,
    exchange: d.exchange,
    code: d.code,
    name: d.name,
    quoteCurrency: d.quoteCurrency,
    isWatched: d.isWatched,
    sortOrder: d.sortOrder,
    targetRatio: d.targetRatio,
    sector: d.sector,
    isRetirement: d.isRetirement,
    location: d.location,
    mgmtFeeRatio: d.mgmtFeeRatio,
    regionUsRatio: d.regionUsRatio,
    regionAsiaRatio: d.regionAsiaRatio,
    regionAusRatio: d.regionAusRatio,
    regionOtherRatio: d.regionOtherRatio,
    dividendFreqMonths: d.dividendFreqMonths,
    drp: d.drp,
    note: null,
    origin: 'import' as const,
    sheetRef: d.sheetRef,
  };
}

function upsertInstruments(tx: Tx, model: WorkbookModel): Map<string, number> {
  const existing = new Map(
    tx
      .select()
      .from(instruments)
      .all()
      .map((r) => [instrumentKey(r.kind, r.symbol), r]),
  );
  const ids = new Map<string, number>();
  for (const d of model.instruments) {
    const row = valid(newInstrumentSchema, instrumentRow(d), d.sheetRef);
    const key = instrumentKey(d.kind, d.symbol);
    const found = existing.get(key);
    if (found) {
      const changed = (Object.keys(row) as (keyof typeof row)[]).some((k) => found[k] !== row[k]);
      if (changed) tx.update(instruments).set(row).where(eq(instruments.id, found.id)).run();
      ids.set(key, found.id);
    } else {
      ids.set(key, insertId(tx.insert(instruments).values(row).run()));
    }
  }
  const keep = [...ids.values()];
  if (keep.length === 0) tx.delete(instruments).run();
  else tx.delete(instruments).where(notInArray(instruments.id, keep)).run();
  return ids;
}

function writePricing(
  tx: Tx,
  model: WorkbookModel,
  ids: Map<string, number>,
  runStart: string,
): Map<string, PriceTreatment> {
  const asOf = model.meta.asOf;
  const treatment = new Map<string, PriceTreatment>();
  for (const d of model.instruments) {
    const key = instrumentKey(d.kind, d.symbol);
    const id = ids.get(key)!;
    const derived = derivePriceSource(d);
    const price = d.watch?.price;
    const sheetPrice =
      price &&
      price.kind === 'number' &&
      price.value !== null &&
      price.value > 0 &&
      price.crossTab === null
        ? decimalFromNumber(price.value)
        : null;
    const typed = sheetPrice !== null && price!.typed;
    const current = tx.select().from(priceSources).where(eq(priceSources.instrumentId, id)).get();
    const manual =
      current?.manualOrigin === 'user'
        ? {
            manualPrice: current.manualPrice,
            manualPriceAsOf: current.manualPriceAsOf,
            manualOrigin: current.manualOrigin,
            manualNote: current.manualNote,
          }
        : typed
          ? {
              manualPrice: sheetPrice,
              manualPriceAsOf: asOf,
              manualOrigin: 'import' as const,
              manualNote: null,
            }
          : { manualPrice: null, manualPriceAsOf: null, manualOrigin: null, manualNote: null };
    const provider =
      current && current.symbolOrigin !== 'derived'
        ? {
            provider: current.provider,
            providerSymbol: current.providerSymbol,
            symbolOrigin: current.symbolOrigin,
          }
        : {
            provider: derived.provider,
            providerSymbol: derived.providerSymbol,
            symbolOrigin: 'derived' as const,
          };
    const next = { instrumentId: id, ...provider, ...manual };
    if (!current) {
      tx.insert(priceSources)
        .values(valid(newPriceSourceSchema, { ...next, updatedAt: runStart }, d.sheetRef))
        .run();
    } else {
      const changed = (Object.keys(next) as (keyof typeof next)[]).some(
        (k) => current[k] !== next[k],
      );
      if (changed) {
        tx.update(priceSources)
          .set(valid(newPriceSourceSchema, { ...next, updatedAt: runStart }, d.sheetRef))
          .where(eq(priceSources.instrumentId, id))
          .run();
      }
    }
    if (sheetPrice === null) {
      treatment.set(key, { mode: 'none' });
    } else if (typed) {
      treatment.set(
        key,
        current?.manualOrigin === 'user'
          ? { mode: 'manual_user', price: sheetPrice }
          : { mode: 'manual', price: sheetPrice },
      );
    } else {
      const existing = tx.select().from(prices).where(eq(prices.instrumentId, id)).get();
      if (existing && existing.price !== null) {
        treatment.set(key, { mode: 'kept', price: sheetPrice, source: existing.source });
      } else if (existing) {
        // A failure-only row (no price yet): fill in the workbook price and keep the fetch
        // bookkeeping (last attempt, status, error, failure count).
        const row = {
          instrumentId: id,
          price: sheetPrice,
          nativePrice: null,
          nativeCurrency: null,
          fxRate: null,
          asOf: `${asOf}T00:00:00Z`,
          fetchedAt: runStart,
          source: 'sheet' as const,
          lastAttemptAt: existing.lastAttemptAt,
          lastStatus: existing.lastStatus,
          lastError: existing.lastError,
          consecutiveFailures: existing.consecutiveFailures,
        };
        tx.update(prices)
          .set(valid(newPriceSchema, row, price!.sheetRef))
          .where(eq(prices.instrumentId, id))
          .run();
        treatment.set(key, { mode: 'seeded', price: sheetPrice });
      } else {
        const row = {
          instrumentId: id,
          price: sheetPrice,
          nativePrice: null,
          nativeCurrency: null,
          fxRate: null,
          asOf: `${asOf}T00:00:00Z`,
          fetchedAt: runStart,
          source: 'sheet' as const,
          lastAttemptAt: null,
          lastStatus: 'ok' as const,
          lastError: null,
          consecutiveFailures: 0,
        };
        tx.insert(prices)
          .values(valid(newPriceSchema, row, price!.sheetRef))
          .run();
        treatment.set(key, { mode: 'seeded', price: sheetPrice });
      }
    }
  }
  return treatment;
}

function writeSettings(tx: Tx, model: WorkbookModel, runStart: string): string[] {
  const keys: string[] = [];
  for (const plan of model.settings) {
    if (plan.status !== 'value' || plan.value === null) continue;
    const valueJson = JSON.stringify(plan.value);
    const current = tx.select().from(settings).where(eq(settings.key, plan.key)).get();
    const row = valid(
      newSettingSchema,
      { key: plan.key, valueJson, updatedAt: runStart, origin: 'import' },
      plan.sheetRef ?? plan.key,
    );
    if (!current) tx.insert(settings).values(row).run();
    // An app-entered value is replaced even when it equals the sheet's, so it stops counting as
    // app data (D34) once a CLI `--replace-app-data` import has run.
    else if (current.valueJson !== valueJson || current.origin !== 'import')
      tx.update(settings).set(row).where(eq(settings.key, plan.key)).run();
    keys.push(plan.key);
  }
  // The D34 settings gap (stage-3.md §3.3 rule 3): an app-entered value of a workbook key that
  // this workbook does not provide (e.g. an emergency-fund override while the sheet holds the
  // default formula) is removed, so the database matches the workbook and stops counting as app
  // data. App-only keys (no workbook source) and imported rows are left alone.
  const provided = new Set(keys);
  for (const row of tx.select().from(settings).where(eq(settings.origin, 'app')).all()) {
    if (provided.has(row.key) || !isSettingKey(row.key) || !isWorkbookSetting(row.key)) continue;
    tx.delete(settings).where(eq(settings.key, row.key)).run();
  }
  return keys;
}

/** The stored accounts' kinds, read before the replace-all delete (D49). */
function storedAccountKinds(tx: Tx) {
  return tx
    .select({ name: cashAccounts.name, sheetRef: cashAccounts.sheetRef, kind: cashAccounts.kind })
    .from(cashAccounts)
    .orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.id))
    .all();
}

/** Replaces the imported data (inside `tx`). */
export function writeModel(tx: Tx, model: WorkbookModel, runStart: string): WriteResult {
  const carried = carryAccountKinds(storedAccountKinds(tx), model.cashAccounts);
  for (const table of DOMAIN_TABLES_DELETE_ORDER) tx.delete(table).run();
  const ids = upsertInstruments(tx, model);
  const priceTreatment = writePricing(tx, model, ids, runStart);
  const imported = { origin: 'import' as const };

  const cashIds = model.cashAccounts.map((a, i) =>
    insertId(
      tx
        .insert(cashAccounts)
        .values(
          valid(
            newCashAccountSchema,
            {
              name: a.name,
              kind: carried.kinds[i] ?? 'bank',
              currency: a.currency,
              balanceCents: a.balanceCents,
              balanceAsOf: model.meta.asOf,
              isOffset: a.isOffset,
              archived: false,
              sortOrder: i + 1,
              note: null,
              ...imported,
              sheetRef: a.sheetRef,
            },
            a.sheetRef,
          ),
        )
        .run(),
    ),
  );

  // D58: one balance entry per account, at the workbook as-of.
  model.cashAccounts.forEach((a, i) => {
    tx.insert(cashBalanceEntries)
      .values(
        valid(
          newCashBalanceEntrySchema,
          {
            accountId: cashIds[i]!,
            asOf: model.meta.asOf,
            balanceCents: a.balanceCents,
            note: null,
            ...imported,
            sheetRef: a.sheetRef,
          },
          a.sheetRef,
        ),
      )
      .run();
  });

  model.budgetItems.forEach((b, i) => {
    tx.insert(budgetItems)
      .values(
        valid(
          newBudgetItemSchema,
          {
            name: b.name,
            kind: b.kind,
            monthlyCents: b.monthlyCents,
            category: b.category,
            accountName: b.accountName,
            cashAccountId:
              b.cashAccountIndex === null ? null : (cashIds[b.cashAccountIndex] ?? null),
            sortOrder: i + 1,
            reviewFlags: serialiseReviewFlags(b.flags),
            ...imported,
            sheetRef: b.sheetRef,
          },
          b.sheetRef,
        ),
      )
      .run();
  });

  model.yearlyExpenses.forEach((y, i) => {
    tx.insert(yearlyExpenses)
      .values(
        valid(
          newYearlyExpenseSchema,
          {
            name: y.name,
            annualCents: y.annualCents,
            sortOrder: i + 1,
            ...imported,
            sheetRef: y.sheetRef,
          },
          y.sheetRef,
        ),
      )
      .run();
  });

  const streamIds = model.streams.map((s, i) =>
    insertId(
      tx
        .insert(incomeStreams)
        .values(
          valid(
            newIncomeStreamSchema,
            { name: s.name, sortOrder: i + 1, archived: false, ...imported, sheetRef: s.sheetRef },
            s.sheetRef,
          ),
        )
        .run(),
    ),
  );

  // D57: dated deposits (`side_income_entries` is no longer written).
  for (const d of model.sideIncome) {
    tx.insert(sideIncomeDeposits)
      .values(
        valid(
          newSideIncomeDepositSchema,
          {
            streamId: streamIds[d.streamIndex]!,
            depositDate: d.depositDate,
            amountCents: d.amountCents,
            note: null,
            ...imported,
            sheetRef: d.sheetRef,
          },
          d.sheetRef,
        ),
      )
      .run();
  }

  for (const n of model.notes) {
    tx.insert(periodNotes)
      .values(
        valid(
          newPeriodNoteSchema,
          {
            periodMonth: n.periodMonth,
            kind: n.kind,
            note: n.note,
            ...imported,
            sheetRef: n.sheetRef,
          },
          n.sheetRef,
        ),
      )
      .run();
  }

  for (const t of model.ledger) {
    if (t.skipped) continue;
    tx.insert(trades)
      .values(
        valid(
          newTradeSchema,
          {
            instrumentId: ids.get(instrumentKey(t.kind, t.symbol))!,
            tradeDate: t.date,
            units: t.units,
            price: t.price,
            feeCents: t.feeCents,
            feeRate: t.feeRate,
            seq: t.seq,
            reviewFlags: serialiseReviewFlags(t.flags),
            correctionId: t.correctionId,
            note: null,
            ...imported,
            sheetRef: t.sheetRef,
          },
          t.sheetRef,
        ),
      )
      .run();
  }

  for (const d of model.dividends) {
    if (d.skipped) continue;
    tx.insert(dividends)
      .values(
        valid(
          newDividendSchema,
          {
            instrumentId:
              d.link === null
                ? null
                : (ids.get(instrumentKey(d.holdingKind, d.link.symbol)) ?? null),
            ticker: d.ticker,
            holdingKind: d.holdingKind,
            paymentDate: d.paymentDate,
            exDate: d.exDate,
            reinvested: d.reinvested,
            netAmountCents: d.netAmountCents,
            priceAtEx: d.priceAtEx,
            priceAtExManual: d.priceAtExManual,
            reviewFlags: serialiseReviewFlags(d.flags),
            correctionId: d.correctionId,
            note: null,
            ...imported,
            sheetRef: d.sheetRef,
          },
          d.sheetRef,
        ),
      )
      .run();
  }

  for (const s of model.snapshots) {
    const values: Record<string, number | string | null> = {};
    for (const [col, v] of Object.entries(s.values)) values[snakeToCamel(col)] = v;
    tx.insert(snapshots)
      .values(
        valid(
          newSnapshotSchema,
          {
            runDate: s.runDate,
            periodMonth: s.periodMonth,
            source: 'migrated',
            recordedAt: null,
            ...imported,
            sheetRef: s.sheetRef,
            ...values,
          },
          s.sheetRef,
        ),
      )
      .run();
  }

  model.otherAssets.forEach((a, i) => {
    tx.insert(otherAssets)
      .values(
        valid(
          newOtherAssetSchema,
          {
            description: a.description,
            url: a.url,
            purchaseDate: a.purchaseDate,
            units: a.units,
            soldUnits: a.soldUnits,
            currency: a.currency,
            unitCost: a.unitCost,
            unitPrice: a.unitPrice,
            unitPriceAsOf: a.unitPrice === null ? null : model.meta.asOf,
            priceSource: a.priceSource,
            metal: a.metal,
            unitOfMeasure: a.unitOfMeasure,
            ozPerUnit: a.ozPerUnit,
            sortOrder: i + 1,
            note: null,
            ...imported,
            sheetRef: a.sheetRef,
          },
          a.sheetRef,
        ),
      )
      .run();
  });

  model.superFunds.forEach((f, i) => {
    tx.insert(superFunds)
      .values(
        valid(
          newSuperFundSchema,
          {
            name: f.name,
            balanceCents: f.balanceCents,
            balanceAsOf: model.meta.asOf,
            sortOrder: i + 1,
            archived: false,
            ...imported,
            sheetRef: f.sheetRef,
          },
          f.sheetRef,
        ),
      )
      .run();
  });

  for (const e of model.superEntries) {
    tx.insert(superEntries)
      .values(
        valid(
          newSuperEntrySchema,
          {
            periodMonth: e.periodMonth,
            kind: e.kind,
            fundId: null,
            entryDate: null,
            amountCents: e.amountCents,
            note: null,
            ...imported,
            sheetRef: e.sheetRef,
          },
          e.sheetRef,
        ),
      )
      .run();
  }

  const propertyIds = model.properties.map((p, i) =>
    insertId(
      tx
        .insert(properties)
        .values(
          valid(
            newPropertySchema,
            {
              name: p.name,
              purchaseDate: p.purchaseDate,
              isPrimaryResidence: p.isPrimaryResidence,
              purchaseValueCents: p.purchaseValueCents,
              currentValueCents: p.currentValueCents,
              valuationDate: model.meta.asOf,
              netRentToDateCents: p.netRentToDateCents,
              sortOrder: i + 1,
              archived: false,
              note: null,
              ...imported,
              sheetRef: p.sheetRef,
            },
            p.sheetRef,
          ),
        )
        .run(),
    ),
  );

  model.loans.forEach((l, i) => {
    tx.insert(loans)
      .values(
        valid(
          newLoanSchema,
          {
            propertyId: l.propertyIndex === null ? null : (propertyIds[l.propertyIndex] ?? null),
            name: l.name,
            lender: null,
            startDate: l.startDate,
            interestPeriodsPerYear: l.interestPeriodsPerYear,
            annualRate: l.annualRate,
            paymentCents: l.paymentCents,
            paymentFrequency: 'monthly',
            startBalanceCents: l.startBalanceCents,
            currentBalanceCents: l.currentBalanceCents,
            balanceAsOf: model.meta.asOf,
            paymentsPaidCents: l.paymentsPaidCents,
            paymentsPaidDerived: l.paymentsPaidDerived,
            sortOrder: i + 1,
            archived: false,
            note: null,
            ...imported,
            sheetRef: l.sheetRef,
          },
          l.sheetRef,
        ),
      )
      .run();
  });

  const settingKeys = writeSettings(tx, model, runStart);
  return {
    instrumentIds: ids,
    priceTreatment,
    settingKeys,
    kindsNotCarried: carried.notCarried,
  };
}
