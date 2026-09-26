// Replace-all writes inside the import transaction (stage-1.md §4.8, stage-3.md §3.5,
// stage-4.md §3.5). Every row is validated with its Zod insert schema first; instruments are
// upserted by (kind, symbol) so their ids (and the price data hanging off them) survive re-imports;
// cash account kinds (D49) and the fund that receives SG are carried over by name or sheet ref; the
// overlay tables (savings adjustments and goals, SG statements) and the caches (dividend events,
// the market series history) are never touched. Settings follow stage-3.md §3.3 and stage-5.md
// §3.5 item 1 (D87: an imported setting the workbook stops providing reads its default; D95: a
// display preference set in the app is kept).
import {
  compareDecimals,
  decimalFromNumber,
  derivePriceSource,
  isPreferenceSettingKey,
  isSettingKey,
  isWorkbookSetting,
  newBudgetItemSchema,
  newCashAccountSchema,
  newCashBalanceEntrySchema,
  newDividendSchema,
  newIncomeStreamSchema,
  newInstrumentSchema,
  newLoanBalanceEntrySchema,
  newLoanSchema,
  newOtherAssetPriceSchema,
  newOtherAssetSchema,
  newPeriodNoteSchema,
  newPriceSchema,
  newPriceSourceSchema,
  newPropertySchema,
  newPropertyValuationSchema,
  newSettingSchema,
  newSideIncomeDepositSchema,
  newSnapshotSchema,
  newSuperBalanceEntrySchema,
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
  loanBalanceEntries,
  loans,
  otherAssetPrices,
  otherAssets,
  periodNotes,
  priceSources,
  prices,
  properties,
  propertyValuations,
  settings,
  sideIncomeDeposits,
  snapshots,
  superBalanceEntries,
  superEntries,
  superFunds,
  trades,
  yearlyExpenses,
  type JoinrDb,
} from '@joinr/schema/db';
import { asc, eq, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import { WorkbookFormatError } from './errors';
import type { InstrumentDraft, OtherAssetRow, WorkbookModel } from './model';
import { carryAccountKinds, carrySgFund, instrumentKey } from './process';

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
  /** Setting keys the workbook provided (written, already equal, or kept as an app preference). */
  settingKeys: string[];
  /** Import-origin settings reset to their default: the workbook no longer provides them (D87). */
  settingsResetToDefault: string[];
  /** Preference keys whose app value the import kept (D95; stage-5.md §3.5 item 1). */
  keptAppPreferences: string[];
  /** Names of the stored non-bank accounts whose kind no imported account took (D49). */
  kindsNotCarried: string[];
  /** Stored funds that received SG and that no imported fund continues (stage-4.md §3.5 item 3). */
  sgFundNotCarried: number;
}

/**
 * True when a row gets its first price entry (stage-4.md §3.5 item 1): a manual row with a
 * price. A negative price cannot be a price entry (the extractor reports it).
 */
export function hasPriceEntry(a: OtherAssetRow): boolean {
  return (
    a.priceSource === 'manual' && a.unitPrice !== null && compareDecimals(a.unitPrice, '0') >= 0
  );
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

interface SettingsWrite {
  /** Keys the workbook provided (written, already equal, or kept as an app preference). */
  keys: string[];
  /** Import-origin rows removed because this workbook no longer provides their key (D87). */
  resetToDefault: string[];
  /** Preference keys whose app-origin row the import kept (D95). */
  keptAppPreferences: string[];
}

function writeSettings(tx: Tx, model: WorkbookModel, runStart: string): SettingsWrite {
  const keys: string[] = [];
  const kept: string[] = [];
  for (const plan of model.settings) {
    if (plan.status !== 'value' || plan.value === null) continue;
    const valueJson = JSON.stringify(plan.value);
    const current = tx.select().from(settings).where(eq(settings.key, plan.key)).get();
    keys.push(plan.key);
    // D95 (stage-5.md §3.3, §3.5 item 1): a display preference set in the app is kept; it never
    // counts as app data, so it never blocks the import that would otherwise overwrite it.
    if (current?.origin === 'app' && isPreferenceSettingKey(plan.key)) {
      kept.push(plan.key);
      continue;
    }
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
  }
  // Rows of workbook keys this workbook does not provide (a blank cell, an invalid value, or the
  // template formula of an "only when typed" override). App-only keys (no workbook source) and
  // unknown keys are never touched.
  // - An import-origin row is reset to the registry default (D87, settings rule 4).
  // - An app-origin row is removed (the D34 settings gap, stage-3.md §3.3 rule 3), so the
  //   database matches the workbook and stops counting as app data; except a preference key's,
  //   which the import keeps (D95).
  const provided = new Set(keys);
  const reset: string[] = [];
  for (const row of tx.select().from(settings).orderBy(asc(settings.key)).all()) {
    if (provided.has(row.key) || !isSettingKey(row.key) || !isWorkbookSetting(row.key)) continue;
    if (row.origin === 'app' && isPreferenceSettingKey(row.key)) {
      kept.push(row.key);
      continue;
    }
    if (row.origin === 'import') reset.push(row.key);
    tx.delete(settings).where(eq(settings.key, row.key)).run();
  }
  return { keys, resetToDefault: reset, keptAppPreferences: kept.sort() };
}

/** The stored accounts' kinds, read before the replace-all delete (D49). */
function storedAccountKinds(tx: Tx) {
  return tx
    .select({ name: cashAccounts.name, sheetRef: cashAccounts.sheetRef, kind: cashAccounts.kind })
    .from(cashAccounts)
    .orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.id))
    .all();
}

/** The stored funds and which one receives SG, read before the replace-all delete (§3.5 item 3). */
function storedSuperFunds(tx: Tx) {
  return tx
    .select({
      name: superFunds.name,
      sheetRef: superFunds.sheetRef,
      receivesSg: superFunds.receivesSg,
    })
    .from(superFunds)
    .orderBy(asc(superFunds.sortOrder), asc(superFunds.id))
    .all();
}

/** Replaces the imported data (inside `tx`). */
export function writeModel(tx: Tx, model: WorkbookModel, runStart: string): WriteResult {
  const carried = carryAccountKinds(storedAccountKinds(tx), model.cashAccounts);
  const sgFund = carrySgFund(storedSuperFunds(tx), model.superFunds);
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

  const otherAssetIds = model.otherAssets.map((a, i) =>
    insertId(
      tx
        .insert(otherAssets)
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
              purchaseFxRate: a.purchaseFxRate,
              purchaseFxSource: a.purchaseFxSource,
              purchaseFxDate: a.purchaseFxDate,
            },
            a.sheetRef,
          ),
        )
        .run(),
    ),
  );

  // D72: a manual row's price as the first entry of its price history, at the workbook as-of.
  model.otherAssets.forEach((a, i) => {
    if (!hasPriceEntry(a)) return;
    tx.insert(otherAssetPrices)
      .values(
        valid(
          newOtherAssetPriceSchema,
          {
            otherAssetId: otherAssetIds[i]!,
            asOf: model.meta.asOf,
            unitPrice: a.unitPrice,
            note: null,
            ...imported,
            sheetRef: a.sheetRef,
          },
          a.sheetRef,
        ),
      )
      .run();
  });

  const fundIds = model.superFunds.map((f, i) =>
    insertId(
      tx
        .insert(superFunds)
        .values(
          valid(
            newSuperFundSchema,
            {
              name: f.name,
              balanceCents: f.balanceCents,
              balanceAsOf: f.balanceAsOf,
              sortOrder: i + 1,
              archived: false,
              ...imported,
              sheetRef: f.sheetRef,
              receivesSg: sgFund.receivesSg[i] ?? false,
            },
            f.sheetRef,
          ),
        )
        .run(),
    ),
  );

  // D69: one balance entry per fund (the fund's balance and date are its denormalised copy).
  model.superFunds.forEach((f, i) => {
    tx.insert(superBalanceEntries)
      .values(
        valid(
          newSuperBalanceEntrySchema,
          {
            fundId: fundIds[i]!,
            asOf: f.balanceAsOf,
            balanceCents: f.balanceCents,
            transferInCents: null,
            note: null,
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
            entryDate: e.entryDate,
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

  // One valuation per property, at the workbook as-of (its value and date are the copy).
  model.properties.forEach((p, i) => {
    tx.insert(propertyValuations)
      .values(
        valid(
          newPropertyValuationSchema,
          {
            propertyId: propertyIds[i]!,
            asOf: model.meta.asOf,
            valueCents: p.currentValueCents,
            note: null,
            ...imported,
            sheetRef: p.sheetRef,
          },
          p.sheetRef,
        ),
      )
      .run();
  });

  const loanIds = model.loans.map((l, i) =>
    insertId(
      tx
        .insert(loans)
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
              // The sheet's "$/month" convention; the owner can change it in the app (§3.5 item 4).
              paymentFrequency: 'monthly',
              startBalanceCents: l.startBalanceCents,
              currentBalanceCents: l.currentBalanceCents,
              balanceAsOf: l.balanceAsOf,
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
        .run(),
    ),
  );

  // D66: one balance entry per loan, its current balance; no start entry (the loan's start fields
  // give the log's start point).
  model.loans.forEach((l, i) => {
    tx.insert(loanBalanceEntries)
      .values(
        valid(
          newLoanBalanceEntrySchema,
          {
            loanId: loanIds[i]!,
            asOf: l.balanceAsOf,
            balanceCents: l.currentBalanceCents,
            repaymentsCents: null,
            note: null,
            ...imported,
            sheetRef: l.sheetRef,
          },
          l.sheetRef,
        ),
      )
      .run();
  });

  const written = writeSettings(tx, model, runStart);
  return {
    instrumentIds: ids,
    priceTreatment,
    settingKeys: written.keys,
    settingsResetToDefault: written.resetToDefault,
    keptAppPreferences: written.keptAppPreferences,
    kindsNotCarried: carried.notCarried,
    sgFundNotCarried: sgFund.notCarried,
  };
}
