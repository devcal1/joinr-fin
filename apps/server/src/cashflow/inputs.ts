// The engine inputs the server builds from the loaded rows (stage-3.md §4.5 "Engine inputs built by
// the server"). Pure functions of the loaded data, the settings and the as-of date, so each row of
// the input table is unit-tested on its own; the request context (context.ts) memoises the engine
// calls that consume them. Stage 4 (stage-4.md §2.8, §4.5): the live savings input comes from the
// assets engines' results (no static imported parts any more), and the latest snapshot carries the
// offset figure; the Stage 4 engine inputs themselves are built in `assets/inputs.ts`. Stage 5
// (stage-5.md §4.5, D88b): recorded months pass their stored offset figure.
import type {
  BudgetRowInput,
  Cents,
  DividendEventInput,
  EngineCashAccount,
  OtherAssetsResult,
  PropertiesResult,
  SavingsLiveInput,
  SavingsSnapshotInput,
  SideIncomeInput,
  SideIncomeResult,
  SuperResult,
} from '@joinr/engine';
import { isPositiveDecimal, type IsoDate, type YearBasis } from '@joinr/schema';
import { booleanSetting, stringSetting, type SettingsValues } from '../db/queries/settings';
import { ratioOf } from '../investments/format';
import { offsetAccounts, offsetCentsAt } from '../assets/inputs';
import type {
  CashAccountRow,
  DividendEventRow,
  InstrumentRow,
  InvestmentData,
  SnapshotRow,
} from '../investments/load';

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
 * The snapshots for the savings engine (stage-5.md §4.5 "Savings: offsetCents", D88b; the Stage 4
 * rule generalised): each History row as `toSavingsSnapshot`, with `offsetCents`
 * - **the stored figure** on a non-migrated snapshot (every recorded month stores one, §4.3);
 * - on **the last migrated month** (the latest snapshot with source `migrated`; migrated months
 *   always sort before recorded ones, since recorded months block a re-import), the Stage 4
 *   derivation at its run date (`offsetCentsAt`: Σ today's offset accounts' latest balance entries
 *   on or before it, with the workbook-flag exception), so the first recorded month's Δ offsets is
 *   exact;
 * - null on every earlier migrated month (Δ offsets 0 between migrated months).
 * The seam is defined by source, not by a null value, and a correction can never set or clear an
 * offset figure on a migrated row, so no correction moves it. With no offset account and no stored
 * figure, everything stays null.
 */
export function savingsSnapshots(data: InvestmentData): SavingsSnapshotInput[] {
  const lastMigrated = latestSnapshot(data.snapshots.filter((s) => s.source === 'migrated'));
  const anyOffset = offsetAccounts(data).length > 0;
  return data.snapshots.map((s) => ({
    ...toSavingsSnapshot(s),
    offsetCents:
      s.source !== 'migrated'
        ? s.offsetCents
        : anyOffset && s === lastMigrated
          ? offsetCentsAt(data, s.runDate)
          : null,
  }));
}

/**
 * Whether the provisional period passes Σ offset accounts now (`liveSavingsInput.offsetCents`):
 * when any offset account exists, or when a recorded month stores an offset figure (so money
 * leaving the last offset account still reads as a Δ against the stored figure).
 */
export function liveOffsetsKnown(data: InvestmentData): boolean {
  return offsetAccounts(data).length > 0 || data.snapshots.some((s) => s.offsetCents !== null);
}

/**
 * The provisional period's live values (stage-4.md §2.8, §4.5), from the engine results only:
 * Total Cash (loans in, D59), the current monthly pay, the super contributions' net-pay cost since
 * the latest snapshot (D71), the property and mortgage parts, and Σ offset accounts now (null when
 * no offset account exists).
 */
export function liveSavingsInput(o: {
  totalCashCents: Cents;
  salaryMonthlyCents: Cents | null;
  superResult: SuperResult;
  property: PropertiesResult;
  /** `cashTotals().offsetCents` when any offset account exists, else null. */
  offsetCents: Cents | null;
}): SavingsLiveInput {
  return {
    cashCents: o.totalCashCents,
    salaryMonthlyCents: o.salaryMonthlyCents,
    superContribCents: o.superResult.snapshot.superContribCents,
    propertyPurchaseCents: o.property.savingsLive.propertyPurchaseCents,
    mortgageBalanceCents: o.property.savingsLive.mortgageBalanceCents,
    mortgagePrincipalPaidCents: o.property.savingsLive.mortgagePrincipalPaidCents,
    offsetCents: o.offsetCents,
  };
}

/**
 * The other-asset flows (§2.8): the engine's savings flows (FX-converted purchases at the
 * purchase-date rate, sales negative; undated and FX-missing assets left out).
 */
export function otherAssetFlows(
  result: OtherAssetsResult,
): { date: IsoDate; amountCents: Cents }[] {
  return result.savingsFlows.map((f) => ({ date: f.date, amountCents: f.amountCents }));
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
