// The engine inputs the server builds from the loaded rows (stage-3.md §4.5 "Engine inputs built by
// the server"). Pure functions of the loaded data, the settings and the as-of date, so each row of
// the input table is unit-tested on its own; the request context (context.ts) memoises the engine
// calls that consume them.
import type {
  BudgetRowInput,
  Cents,
  DividendEventInput,
  EngineCashAccount,
  SavingsLiveInput,
  SavingsSnapshotInput,
  SideIncomeInput,
  SideIncomeResult,
} from '@joinr/engine';
import {
  isoMonthOf,
  isPositiveDecimal,
  JoinrDecimal,
  multiplyToCents,
  type IsoDate,
  type YearBasis,
} from '@joinr/schema';
import { booleanSetting, stringSetting, type SettingsValues } from '../db/queries/settings';
import { ratioOf } from '../investments/format';
import type {
  CashAccountRow,
  DividendEventRow,
  InstrumentRow,
  InvestmentData,
  OtherAssetRow,
  SnapshotRow,
} from '../investments/load';
import { otherAssetValueCents } from '../records/index';

// ─── Settings with their Stage 3 defaults (§4.5 "settings") ─────────────────────────────────────

/** `savings.yearBasis ?? 'fy'` (D52). */
export function yearBasisOf(s: SettingsValues): YearBasis {
  return stringSetting(s, 'savings.yearBasis') === 'calendar' ? 'calendar' : 'fy';
}

/** `savings.includeMortgagePrincipal ?? true`. */
export function includeMortgagePrincipalOf(s: SettingsValues): boolean {
  return booleanSetting(s, 'savings.includeMortgagePrincipal') ?? true;
}

/** `property.offsetsIncludeEmergencyFund ?? false` (D56). */
export function offsetsIncludeEmergencyFundOf(s: SettingsValues): boolean {
  return booleanSetting(s, 'property.offsetsIncludeEmergencyFund') ?? false;
}

/** `budget.includeSideIncome ?? false` (D53). */
export function includeSideIncomeOf(s: SettingsValues): boolean {
  return booleanSetting(s, 'budget.includeSideIncome') ?? false;
}

// ─── Cash accounts (§2.4) ───────────────────────────────────────────────────────────────────────

export function toEngineCashAccount(a: CashAccountRow): EngineCashAccount {
  return { id: a.id, kind: a.kind, isOffset: a.isOffset, balanceCents: a.balanceCents };
}

// ─── Savings (§2.5) ─────────────────────────────────────────────────────────────────────────────

/** A History row as the savings engine reads it (N, R, W, Y, AB, AD). */
export function toSavingsSnapshot(s: SnapshotRow): SavingsSnapshotInput {
  return {
    periodMonth: s.periodMonth,
    runDate: s.runDate,
    cashValueCents: s.cashValueCents,
    superContribCents: s.superContribCents,
    salaryMonthlyCents: s.salaryMonthlyCents,
    propertyPurchaseCents: s.propertyPurchaseCents,
    mortgageBalanceCents: s.mortgageBalanceCents,
    mortgagePrincipalPaidCents: s.mortgagePrincipalPaidCents,
  };
}

/** The latest snapshot by run date (then period), or null. */
export function latestSnapshot(snapshots: readonly SnapshotRow[]): SnapshotRow | null {
  let best: SnapshotRow | null = null;
  for (const s of snapshots) {
    if (
      best === null ||
      s.runDate > best.runDate ||
      (s.runDate === best.runDate && s.periodMonth > best.periodMonth)
    ) {
      best = s;
    }
  }
  return best;
}

/**
 * Voluntary super contributions for the provisional period: Σ `super_entries` of kind
 * `voluntary_contribution` whose `period_month` is after the latest snapshot's and not after
 * `isoMonthOf(asOf)`.
 */
export function provisionalSuperContribCents(data: InvestmentData, asOf: IsoDate): Cents {
  const after = latestSnapshot(data.snapshots)?.periodMonth ?? null;
  const through = isoMonthOf(asOf);
  return data.superEntries
    .filter(
      (e) =>
        e.kind === 'voluntary_contribution' &&
        (after === null || e.periodMonth > after) &&
        e.periodMonth <= through,
    )
    .reduce((sum, e) => sum + e.amountCents, 0);
}

/**
 * The provisional period's live values (§4.5): Total Cash (loans in, D59), the current monthly
 * pay, the voluntary super since the latest snapshot, and the property and mortgage figures as
 * imported (static until Stage 4; null when there is no property or mortgage).
 */
export function liveSavingsInput(
  data: InvestmentData,
  o: { asOf: IsoDate; totalCashCents: Cents; salaryMonthlyCents: Cents | null },
): SavingsLiveInput {
  const mortgages = data.loans.filter((l) => l.propertyId !== null);
  return {
    cashCents: o.totalCashCents,
    salaryMonthlyCents: o.salaryMonthlyCents,
    superContribCents: provisionalSuperContribCents(data, o.asOf),
    propertyPurchaseCents:
      data.properties.length === 0
        ? null
        : data.properties.reduce((sum, p) => sum + p.purchaseValueCents, 0),
    mortgageBalanceCents:
      mortgages.length === 0 ? null : -mortgages.reduce((sum, l) => sum + l.currentBalanceCents, 0),
    // Payments paid − interest and fees (none are imported before Stage 4, so 0).
    mortgagePrincipalPaidCents:
      mortgages.length === 0
        ? null
        : mortgages.reduce((sum, l) => sum + (l.paymentsPaidCents ?? 0), 0),
  };
}

/**
 * Other-asset purchases (added investments): rows with a purchase date and currency AUD, valued
 * `(units − sold_units) × unit_cost`; other currencies (Stage 4 adds FX) and rows without a cost
 * are skipped.
 */
export function otherAssetPurchases(
  rows: readonly OtherAssetRow[],
): { date: IsoDate; amountCents: Cents }[] {
  const out: { date: IsoDate; amountCents: Cents }[] = [];
  for (const a of rows) {
    if (a.purchaseDate === null || a.currency !== 'AUD' || a.unitCost === null) continue;
    try {
      const remaining = new JoinrDecimal(a.units).minus(a.soldUnits).toFixed();
      out.push({ date: a.purchaseDate, amountCents: multiplyToCents(remaining, a.unitCost) });
    } catch {
      // A malformed stored decimal is left out rather than failing the page.
    }
  }
  return out;
}

/** Σ (units − sold) × unit price of the AUD other assets (the other-assets class value). */
export function otherAssetsValueCents(rows: readonly OtherAssetRow[]): Cents {
  return rows.reduce((sum, a) => sum + (otherAssetValueCents(a) ?? 0), 0);
}

// ─── Side income (§2.8) ─────────────────────────────────────────────────────────────────────────

export function sideIncomeInput(data: InvestmentData, asOf: IsoDate): SideIncomeInput {
  return {
    asOf,
    snapshots: data.snapshots.map((s) => ({ periodMonth: s.periodMonth, runDate: s.runDate })),
    deposits: data.deposits.map((d) => ({
      id: d.id,
      streamId: d.streamId,
      date: d.depositDate,
      amountCents: d.amountCents,
    })),
  };
}

/** budgetInvestment's side-income periods: the CLOSED periods only (§2.8). */
export function closedSideIncomePeriods(
  result: SideIncomeResult,
): { periodStart: IsoDate; periodEnd: IsoDate; amountCents: Cents }[] {
  return result.periods
    .filter((p) => p.status === 'closed')
    .map((p) => ({ periodStart: p.start, periodEnd: p.end, amountCents: p.totalCents }));
}

// ─── Budget (§2.9) ──────────────────────────────────────────────────────────────────────────────

/**
 * Every budget row in sort order (the loader's order); `accountName` = the linked account's name,
 * else the stored text.
 */
export function budgetRowsInput(data: InvestmentData): BudgetRowInput[] {
  const accounts = new Map(data.cashAccounts.map((a) => [a.id, a]));
  return data.budgetItems.map((r) => {
    const account = r.cashAccountId === null ? undefined : accounts.get(r.cashAccountId);
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      monthlyCents: r.monthlyCents,
      category: r.category,
      accountId: account ? account.id : null,
      accountName: account ? account.name : r.accountName,
    };
  });
}

// ─── Timing helpers (stage-2.md §2.12) ──────────────────────────────────────────────────────────

/** The latest ETF or stock BUY (SheetOptions H20). */
export function lastStockOrEtfBuy(data: InvestmentData): IsoDate | null {
  const ids = new Set(
    data.instruments.filter((i) => i.kind === 'stock' || i.kind === 'etf').map((i) => i.id),
  );
  let last: IsoDate | null = null;
  for (const t of data.trades) {
    if (!ids.has(t.instrumentId) || !isPositiveDecimal(t.units)) continue;
    if (last === null || t.tradeDate > last) last = t.tradeDate;
  }
  return last;
}

/**
 * cash / liquid assets at the latest snapshot (SheetOptions H43): cash_value / (stocks + etf +
 * crypto + cash + mf + other value). Null when there is no snapshot or the total is not positive.
 */
export function lastSnapshotCashShare(snapshots: readonly SnapshotRow[]): string | null {
  const latest = snapshots.reduce<SnapshotRow | null>(
    (best, s) => (best === null || s.periodMonth > best.periodMonth ? s : best),
    null,
  );
  if (!latest) return null;
  const v = (n: number | null) => n ?? 0;
  const total =
    v(latest.stocksValueCents) +
    v(latest.etfValueCents) +
    v(latest.cryptoValueCents) +
    v(latest.cashValueCents) +
    v(latest.mfValueCents) +
    v(latest.otherValueCents);
  return total > 0 ? ratioOf(v(latest.cashValueCents), total) : null;
}

// ─── Dividends (§2.10, §2.11) ───────────────────────────────────────────────────────────────────

export function toDividendEventInput(e: DividendEventRow): DividendEventInput {
  return {
    instrumentId: e.instrumentId,
    exDate: e.exDate,
    amountPerUnit: e.amountPerUnit,
    currency: e.currency,
    closeBeforeEx: e.closeBeforeEx,
    dismissed: e.dismissedAt !== null,
  };
}

/** Instruments in the dividend form's order: kind order (INSTRUMENT_KINDS), then id. */
export function instrumentsByKindThenId(
  rows: readonly InstrumentRow[],
  kindOrder: readonly string[],
): InstrumentRow[] {
  return [...rows].sort(
    (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.id - b.id,
  );
}
