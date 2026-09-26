// The Stage 4 engine inputs the server builds from the loaded rows (stage-4.md §4.5 "Engine inputs
// built by the server"). Pure functions of the loaded data, the market series and the as-of date,
// so each row of the input table is unit-tested on its own; the request context (cashflow/context)
// memoises the engine calls that consume them. The server never computes a figure here: it only
// picks the rows (the latest entry at a date, the linked offsets) the engine takes.
import type {
  EngineLoan,
  EngineOtherAsset,
  EngineOtherAssetPricing,
  EngineProperty,
  EngineSuperContribution,
  EngineSuperFund,
  OtherAssetsInput,
  PropertyInput,
  SuperInput,
} from '@joinr/engine';
import {
  addMonthsIso,
  JoinrDecimal,
  normaliseDecimal,
  OTHER_ASSET_STALE_DAYS_DEFAULT,
  SUPER_CONTRIBUTIONS_TAX_DEFAULT,
  SUPER_CONTRIBUTION_TYPES,
  type ChartDateUnit,
  type DecimalString,
  type IsoDate,
  type MarketQuoteItem,
  type Metal,
  type SuperContributionType,
} from '@joinr/schema';
import {
  chartDateUnitSetting,
  numberSetting,
  stringSetting,
  type SettingsValues,
} from '../db/queries/settings';
import { localIsoDate } from '../investments/format';
import type {
  CashAccountRow,
  InvestmentData,
  LoanRow,
  OtherAssetPriceRow,
  OtherAssetRow,
  OtherAssetSaleRow,
  SnapshotRow,
} from '../investments/load';
import {
  SPOT_HISTORY_MONTHS,
  SPOT_SERIES_BY_METAL,
  SUPER_CONTRIBUTION_KINDS,
  type SuperContributionKind,
} from './constants';

// ─── Shared rules ───────────────────────────────────────────────────────────────────────────────

/**
 * The latest entry of a log at `date` (stage-4.md §2.3): the latest dated on or before it; when
 * every entry is later, the earliest (so a fresh entry never makes a figure vanish). Null when the
 * log is empty. Ties on a date (never stored: `(parent, as_of)` is unique) take the higher id.
 */
export function latestEntryAt<T extends { asOf: IsoDate; id: number }>(
  entries: readonly T[],
  date: IsoDate,
): T | null {
  let latest: T | null = null;
  let earliest: T | null = null;
  for (const e of entries) {
    if (
      earliest === null ||
      e.asOf < earliest.asOf ||
      (e.asOf === earliest.asOf && e.id < earliest.id)
    ) {
      earliest = e;
    }
    if (e.asOf > date) continue;
    if (latest === null || e.asOf > latest.asOf || (e.asOf === latest.asOf && e.id > latest.id)) {
      latest = e;
    }
  }
  return latest ?? earliest;
}

/** Rows grouped by a key, each group in the input order. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** The charts setting pair (`charts.dateUnit ?? 'monthly'`, `charts.unitCount ?? null`). */
export function chartOf(s: SettingsValues): { unit: ChartDateUnit; count: number | null } {
  return {
    unit: chartDateUnitSetting(s) ?? 'monthly',
    count: numberSetting(s, 'charts.unitCount'),
  };
}

/** Snapshots in run-date order (then period). */
export function snapshotsByRunDate(snapshots: readonly SnapshotRow[]): SnapshotRow[] {
  return [...snapshots].sort((a, b) =>
    a.runDate !== b.runDate
      ? a.runDate < b.runDate
        ? -1
        : 1
      : a.periodMonth < b.periodMonth
        ? -1
        : a.periodMonth > b.periodMonth
          ? 1
          : 0,
  );
}

/** D73: the first snapshot's run date (the earliest), or null without snapshots. */
export function assumedDateOf(snapshots: readonly SnapshotRow[]): IsoDate | null {
  return snapshotsByRunDate(snapshots)[0]?.runDate ?? null;
}

// ─── Market series (spot and FX) ────────────────────────────────────────────────────────────────

/** The series by id (the price service's list). */
export function seriesById(series: readonly MarketQuoteItem[]): Map<string, MarketQuoteItem> {
  return new Map(series.map((s) => [s.seriesId, s]));
}

/** A quote's as-of (an ISO timestamp, or already a date) as a server-local calendar date. */
export function quoteLocalDate(asOf: string): IsoDate | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? null : localIsoDate(d);
}

/**
 * A metal's spot for the engine (§4.5): the series' value, the as-of's local date and `fresh` when
 * the status is `fresh`; null when the series has no value.
 */
export function spotOf(
  series: ReadonlyMap<string, MarketQuoteItem>,
  metal: Metal,
): { audPerOz: DecimalString; asOf: IsoDate; fresh: boolean } | null {
  const item = series.get(SPOT_SERIES_BY_METAL[metal]);
  if (!item || item.value === null || item.asOf === null) return null;
  const asOf = quoteLocalDate(item.asOf);
  if (asOf === null) return null;
  return { audPerOz: item.value, asOf, fresh: item.status === 'fresh' };
}

/** The series a currency's live AUD rate comes from (§4.5): USD → AUDUSD, GBX → FX_GBPAUD. */
export function fxSeriesIdOf(currency: string): string {
  if (currency === 'USD') return 'AUDUSD';
  return `FX_${currency === 'GBX' ? 'GBP' : currency}AUD`;
}

/**
 * The live AUD per 1 unit of `currency` from a stored series value (§4.5): USD → 1 ÷ AUDUSD (12
 * significant digits); GBX → FX_GBPAUD ÷ 100; another code C → FX_<C>AUD. Null when there is no
 * value (or it is not positive, for USD). Every stored value is used, stale or not.
 */
export function fxRateOf(
  series: ReadonlyMap<string, MarketQuoteItem>,
  currency: string,
): DecimalString | null {
  const value = series.get(fxSeriesIdOf(currency))?.value ?? null;
  if (value === null) return null;
  try {
    const v = new JoinrDecimal(value);
    if (!v.isFinite()) return null;
    if (currency === 'USD') {
      return v.greaterThan(0)
        ? normaliseDecimal(new JoinrDecimal(1).div(v).toSignificantDigits(12))
        : null;
    }
    return normaliseDecimal(currency === 'GBX' ? v.div(100) : v);
  } catch {
    return null;
  }
}

/** The foreign currencies the other assets use (not AUD), in code order. */
export function foreignCurrencies(assets: readonly OtherAssetRow[]): string[] {
  return [...new Set(assets.map((a) => a.currency).filter((c) => c !== 'AUD'))].sort();
}

/** `fxRates` for the engine: every foreign currency the assets use that has a live rate. */
export function fxRatesOf(
  assets: readonly OtherAssetRow[],
  series: ReadonlyMap<string, MarketQuoteItem>,
): Record<string, DecimalString> {
  const out: Record<string, DecimalString> = {};
  for (const ccy of foreignCurrencies(assets)) {
    const rate = fxRateOf(series, ccy);
    if (rate !== null) out[ccy] = rate;
  }
  return out;
}

/** The metals the bullion assets use (silver, then gold). */
export function metalsInUse(assets: readonly OtherAssetRow[]): Metal[] {
  const used = new Set(
    assets.filter((a) => a.priceSource === 'bullion' && a.metal !== null).map((a) => a.metal),
  );
  return (['silver', 'gold'] as const).filter((m) => used.has(m));
}

/**
 * Where the bullion spot charts start (§4.6 item 6): one year before `asOf`, or the earliest
 * bullion purchase date when that is later.
 */
export function spotHistoryFrom(assets: readonly OtherAssetRow[], asOf: IsoDate): IsoDate {
  const yearBefore = addMonthsIso(asOf, -SPOT_HISTORY_MONTHS);
  let earliest: IsoDate | null = null;
  for (const a of assets) {
    if (a.priceSource !== 'bullion' || a.purchaseDate === null) continue;
    if (earliest === null || a.purchaseDate < earliest) earliest = a.purchaseDate;
  }
  return earliest !== null && earliest > yearBefore ? earliest : yearBefore;
}

// ─── Other assets (§2.4, D72, D73) ──────────────────────────────────────────────────────────────

/** A price entry keyed as a log entry (the §2.3 rule reads `asOf`). */
export function latestPriceAt(
  prices: readonly OtherAssetPriceRow[],
  date: IsoDate,
): OtherAssetPriceRow | null {
  return latestEntryAt(prices, date);
}

/**
 * The asset's pricing (§4.5): manual → its latest price entry at `asOf` (none → no price); bullion
 * → the metal's spot series with the row's stored price as the fallback.
 */
export function otherAssetPricing(
  a: OtherAssetRow,
  prices: readonly OtherAssetPriceRow[],
  series: ReadonlyMap<string, MarketQuoteItem>,
  asOf: IsoDate,
): EngineOtherAssetPricing {
  if (a.priceSource === 'bullion') {
    // A bullion row always carries its metal and ounces (the refines; the importer's silver link
    // is 1 oz per unit). A row without a metal has no spot series to read.
    const metal = a.metal ?? 'silver';
    return {
      source: 'bullion',
      metal,
      ozPerUnit: a.ozPerUnit ?? '1',
      spot: a.metal === null ? null : spotOf(series, a.metal),
      fallbackUnitPrice: a.unitPrice,
      fallbackAsOf: a.unitPrice === null ? null : a.unitPriceAsOf,
    };
  }
  const latest = latestPriceAt(prices, asOf);
  return {
    source: 'manual',
    unitPrice: latest?.unitPrice ?? null,
    priceAsOf: latest?.asOf ?? null,
  };
}

export function toEngineOtherAsset(
  a: OtherAssetRow,
  o: {
    prices: readonly OtherAssetPriceRow[];
    sales: readonly OtherAssetSaleRow[];
    series: ReadonlyMap<string, MarketQuoteItem>;
    asOf: IsoDate;
  },
): EngineOtherAsset {
  return {
    id: a.id,
    purchaseDate: a.purchaseDate,
    units: a.units,
    legacySoldUnits: a.soldUnits,
    unitCost: a.unitCost,
    currency: a.currency,
    purchaseFxRate: a.currency === 'AUD' ? null : a.purchaseFxRate,
    pricing: otherAssetPricing(a, o.prices, o.series, o.asOf),
    sales: o.sales.map((s) => ({
      id: s.id,
      saleDate: s.saleDate,
      units: s.units,
      proceedsCents: s.proceedsCents,
    })),
  };
}

/** `computeOtherAssets`' input (§4.5): the assets in sort order, live FX, D73 and the history. */
export function buildOtherAssetsInput(
  data: InvestmentData,
  series: readonly MarketQuoteItem[],
  asOf: IsoDate,
): OtherAssetsInput {
  const byId = seriesById(series);
  const prices = groupBy(data.otherAssetPrices, (p) => p.otherAssetId);
  const sales = groupBy(data.otherAssetSales, (s) => s.otherAssetId);
  return {
    asOf,
    assets: data.otherAssets.map((a) =>
      toEngineOtherAsset(a, {
        prices: prices.get(a.id) ?? [],
        sales: sales.get(a.id) ?? [],
        series: byId,
        asOf,
      }),
    ),
    fxRates: fxRatesOf(data.otherAssets, byId),
    assumedDate: assumedDateOf(data.snapshots),
    stalePriceDays:
      numberSetting(data.settings, 'otherAssets.stalePriceDays') ?? OTHER_ASSET_STALE_DAYS_DEFAULT,
    snapshots: snapshotsByRunDate(data.snapshots).map((s) => ({
      periodMonth: s.periodMonth,
      runDate: s.runDate,
      otherValueCents: s.otherValueCents,
      otherGainCents: s.otherGainCents,
    })),
    chart: chartOf(data.settings),
  };
}

// ─── Super (§2.5, D69–D71) ──────────────────────────────────────────────────────────────────────

export function isContributionKind(kind: string): kind is SuperContributionKind {
  return (SUPER_CONTRIBUTION_KINDS as readonly string[]).includes(kind);
}

/** A contribution's date: its entry date, else the first day of its period month (§4.5). */
export function contributionDateOf(e: { entryDate: IsoDate | null; periodMonth: string }): IsoDate {
  return e.entryDate ?? `${e.periodMonth}-01`;
}

/** `super.importedContributionType ?? 'salary_sacrifice'` (D75). */
export function importedContributionTypeOf(s: SettingsValues): SuperContributionType {
  const v = stringSetting(s, 'super.importedContributionType');
  return (SUPER_CONTRIBUTION_TYPES as readonly string[]).includes(v ?? '')
    ? (v as SuperContributionType)
    : 'salary_sacrifice';
}

/** `super.contributionsTaxRate ?? SUPER_CONTRIBUTIONS_TAX_DEFAULT`. */
export function contributionsTaxRatioOf(s: SettingsValues): DecimalString {
  return stringSetting(s, 'super.contributionsTaxRate') ?? SUPER_CONTRIBUTIONS_TAX_DEFAULT;
}

/** The cap override with its FY (§3.3): null unless both keys are set. */
export function capOverrideOf(s: SettingsValues): { cents: number; financialYear: number } | null {
  const cents = numberSetting(s, 'super.concessionalCapCents');
  const financialYear = numberSetting(s, 'super.concessionalCapFy');
  return cents === null || financialYear === null ? null : { cents, financialYear };
}

/** `computeSuper`'s input (§4.5). */
export function buildSuperInput(data: InvestmentData, asOf: IsoDate): SuperInput {
  const s = data.settings;
  const entries = groupBy(data.superBalanceEntries, (e) => e.fundId);
  const funds: EngineSuperFund[] = data.superFunds.map((f) => ({
    id: f.id,
    receivesSg: f.receivesSg,
    archived: f.archived,
    balances: (entries.get(f.id) ?? []).map((e) => ({
      id: e.id,
      asOf: e.asOf,
      balanceCents: e.balanceCents,
      transferInCents: e.transferInCents,
    })),
  }));
  const contributions: EngineSuperContribution[] = [];
  for (const e of data.superEntries) {
    if (!isContributionKind(e.kind)) continue;
    contributions.push({
      id: e.id,
      fundId: e.fundId,
      date: contributionDateOf(e),
      kind: e.kind,
      amountCents: e.amountCents,
    });
  }
  return {
    asOf,
    snapshots: snapshotsByRunDate(data.snapshots).map((snap) => ({
      periodMonth: snap.periodMonth,
      runDate: snap.runDate,
      superValueCents: snap.superValueCents,
    })),
    funds,
    contributions,
    sgOverrides: data.superSgOverrides.map((o) => ({
      periodMonth: o.periodMonth,
      grossCents: o.grossCents,
    })),
    grossAnnualSalaryCents: numberSetting(s, 'pay.grossAnnualSalaryCents'),
    jobStartDate: stringSetting(s, 'pay.jobStartDate'),
    // Your employer's rate for every month; null → the statutory table by FY (§3.3).
    sgRatio: stringSetting(s, 'super.sgRate'),
    contributionsTaxRatio: contributionsTaxRatioOf(s),
    marginalTaxRatio: stringSetting(s, 'tax.marginalRate'),
    importedContributionType: importedContributionTypeOf(s),
    concessionalCapOverride: capOverrideOf(s),
    chart: chartOf(s),
  };
}

// ─── Property and loans (§2.6, D66–D68) ─────────────────────────────────────────────────────────

/**
 * Each loan's linked offsets (D67): the linked accounts (loan_offset_links) still flagged Offset,
 * at their current balance, in account order.
 */
export function linkedOffsetsByLoan(
  data: InvestmentData,
): Map<number, { accountId: number; balanceCents: number }[]> {
  const accounts = new Map(data.cashAccounts.map((a) => [a.id, a]));
  const out = new Map<number, { accountId: number; balanceCents: number }[]>();
  for (const link of data.loanOffsetLinks) {
    const account = accounts.get(link.accountId);
    if (!account || !account.isOffset) continue;
    const list = out.get(link.loanId) ?? [];
    list.push({ accountId: account.id, balanceCents: account.balanceCents });
    out.set(link.loanId, list);
  }
  return out;
}

/** Loans in the page order: mortgages by property order (then loan order), then the rest. */
export function loansInPageOrder(data: InvestmentData): LoanRow[] {
  const propertyIndex = new Map(data.properties.map((p, i) => [p.id, i]));
  const rank = (l: LoanRow) =>
    l.propertyId === null
      ? Number.MAX_SAFE_INTEGER
      : (propertyIndex.get(l.propertyId) ?? Number.MAX_SAFE_INTEGER);
  return data.loans
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map((x) => x.l);
}

/** `computeProperty`'s input (§4.5). */
export function buildPropertyInput(data: InvestmentData, asOf: IsoDate): PropertyInput {
  const valuations = groupBy(data.propertyValuations, (v) => v.propertyId);
  const entries = groupBy(data.loanBalanceEntries, (e) => e.loanId);
  const offsets = linkedOffsetsByLoan(data);
  const properties: EngineProperty[] = data.properties.map((p) => ({
    id: p.id,
    purchaseDate: p.purchaseDate,
    isPrimaryResidence: p.isPrimaryResidence,
    purchaseValueCents: p.purchaseValueCents,
    netRentToDateCents: p.netRentToDateCents,
    valuations: (valuations.get(p.id) ?? []).map((v) => ({
      id: v.id,
      asOf: v.asOf,
      valueCents: v.valueCents,
    })),
  }));
  const loans: EngineLoan[] = loansInPageOrder(data).map((l) => ({
    id: l.id,
    propertyId: l.propertyId,
    startDate: l.startDate,
    startBalanceCents: l.startBalanceCents,
    annualRate: l.annualRate,
    compoundingPerYear: l.interestPeriodsPerYear,
    paymentCents: l.paymentCents,
    paymentFrequency: l.paymentFrequency,
    entries: (entries.get(l.id) ?? []).map((e) => ({
      id: e.id,
      asOf: e.asOf,
      balanceCents: e.balanceCents,
      repaymentsCents: e.repaymentsCents,
    })),
    offsets: offsets.get(l.id) ?? [],
  }));
  return {
    asOf,
    properties,
    loans,
    snapshots: snapshotsByRunDate(data.snapshots).map((s) => ({
      periodMonth: s.periodMonth,
      runDate: s.runDate,
      propertyValueCents: s.propertyValueCents,
      propertyPurchaseCents: s.propertyPurchaseCents,
      mortgageBalanceCents: s.mortgageBalanceCents,
      mortgageInterestFeesCents: s.mortgageInterestFeesCents,
      mortgagePrincipalPaidCents: s.mortgagePrincipalPaidCents,
    })),
    chart: chartOf(data.settings),
  };
}

// ─── Offsets for the savings engine (§2.9, D78) ─────────────────────────────────────────────────

/** Every account flagged Offset (D56), in the loader's order. */
export function offsetAccounts(data: InvestmentData): CashAccountRow[] {
  return data.cashAccounts.filter((a) => a.isOffset);
}

/**
 * The latest snapshot's offset figure (§2.9, D78): Σ over today's offset accounts of each one's
 * latest balance entry on or before `date`. An account with no entry by then counts:
 * - **its earliest entry's balance** when the account is `origin 'import'` (its Offset flag is the
 *   workbook's and untouched: any change to the flag, name or note makes the account `app`). The
 *   workbook already kept that balance out of the stored cash (History N), and the importer dates
 *   the account's only entry at the workbook as-of, after the last run: counting it 0 would read
 *   the whole imported balance as money moved into the offset, which it is not;
 * - **0** otherwise (an account created in the app, or flagged Offset in the app): its balance
 *   was in no stored figure, so moving it into the offset is a real Δ (for a flag switched on, the
 *   Δ cancels the balance leaving Total Cash).
 * Known limit: renaming a workbook-flagged offset account makes it `app`, so it counts 0 again.
 */
export function offsetCentsAt(data: InvestmentData, date: IsoDate): number {
  const accounts = new Map(offsetAccounts(data).map((a) => [a.id, a]));
  type Entry = { asOf: IsoDate; id: number; balanceCents: number };
  const earlier = (a: Entry, b: Entry) => a.asOf < b.asOf || (a.asOf === b.asOf && a.id < b.id);
  const latest = new Map<number, Entry>();
  const earliest = new Map<number, Entry>();
  for (const e of data.balanceEntries) {
    if (!accounts.has(e.accountId)) continue;
    const first = earliest.get(e.accountId);
    if (!first || earlier(e, first)) earliest.set(e.accountId, e);
    if (e.asOf > date) continue;
    const prev = latest.get(e.accountId);
    if (!prev || earlier(prev, e)) latest.set(e.accountId, e);
  }
  let sum = 0;
  for (const [id, account] of accounts) {
    const entry = latest.get(id) ?? (account.origin === 'import' ? earliest.get(id) : undefined);
    sum += entry?.balanceCents ?? 0;
  }
  return sum;
}
