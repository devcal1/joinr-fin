// Processing between extraction and writes (stage-1.md §4.4–§4.7): owner corrections (D27),
// feed-row exclusions (D22/D23), the instrument set, suspect flags (D26), dividend re-keying (D28),
// budget → cash account links and the account kinds kept across a re-import (D49); Stage 4: the
// balance-entry dates, the History-derived super contributions (D37 exclusion) and the fund that
// receives SG kept across a re-import (stage-4.md §3.5). Pure: no DB.
import {
  addMonthsIso,
  BULLION_FEEDS,
  compareDecimals,
  INSTRUMENT_KINDS,
  JoinrDecimal,
  multiplyToCents,
  normaliseDecimal,
  splitSymbol,
  type CashAccountKind,
  type CorrectionsFile,
  type DividendCorrection,
  type InstrumentKind,
  type LedgerSheet,
  type ReviewFlag,
  type TradeCorrection,
} from '@joinr/schema';
import { check, info } from './checks';
import type {
  Check,
  DividendRow,
  Exclusion,
  InstrumentDraft,
  LedgerRow,
  NoteRow,
  SnapshotRow,
  WorkbookModel,
} from './model';

// ─── Corrections (D27) ──────────────────────────────────────────────────────────────────────────

export interface CorrectionOutcome {
  id: string;
  target: 'trade' | 'dividend';
  matches: number;
  applied: boolean;
  skip: boolean;
  /** The matched row (when exactly one matched). */
  sheetRef: string | null;
  kind: InstrumentKind | null;
  /** Fields the correction sets, with the values as read. */
  before: Record<string, string | number | boolean | null>;
  reason: string;
}

const decimalEq = (a: string, b: string): boolean => {
  try {
    return compareDecimals(a, b) === 0;
  } catch {
    return false;
  }
};

function matchesTrade(c: TradeCorrection, row: LedgerRow): boolean {
  const m = c.match;
  return (
    m.sheet === row.sheet &&
    (m.row === undefined || m.row === row.row) &&
    m.symbol.trim() === row.symbol &&
    m.date === row.date &&
    (m.units === undefined || decimalEq(m.units, row.units)) &&
    (m.price === undefined || decimalEq(m.price, row.price))
  );
}

function matchesDividend(c: DividendCorrection, row: DividendRow): boolean {
  const m = c.match;
  return (
    (m.row === undefined || m.row === row.row) &&
    m.ticker.trim() === row.ticker &&
    m.paymentDate === row.paymentDate &&
    (m.netAmountCents === undefined || m.netAmountCents === row.netAmountCents)
  );
}

export function applyCorrections(
  model: WorkbookModel,
  file: CorrectionsFile | null,
): CorrectionOutcome[] {
  if (file === null) return [];
  const outcomes: CorrectionOutcome[] = [];
  for (const c of file.corrections) {
    if (c.target === 'trade') {
      const hits = model.ledger.filter((row) => matchesTrade(c, row));
      const row = hits.length === 1 ? hits[0]! : null;
      const outcome: CorrectionOutcome = {
        id: c.id,
        target: 'trade',
        matches: hits.length,
        applied: row !== null,
        skip: 'action' in c,
        sheetRef: row?.sheetRef ?? null,
        kind: row?.kind ?? null,
        before: {},
        reason: c.reason,
      };
      if (row !== null) {
        row.original ??= {
          date: row.date,
          units: row.units,
          price: row.price,
          feeCents: row.feeCents,
          feeRate: row.feeRate,
        };
        row.correctionId = row.correctionId === null ? c.id : `${row.correctionId},${c.id}`;
        if ('action' in c) {
          row.skipped = true;
        } else {
          const set = c.set;
          if (set.date !== undefined) {
            outcome.before.date = row.date;
            row.date = set.date;
          }
          if (set.units !== undefined) {
            outcome.before.units = row.units;
            row.units = normaliseDecimal(set.units);
          }
          if (set.price !== undefined) {
            outcome.before.price = row.price;
            row.price = normaliseDecimal(set.price);
          }
          if (set.feeCents !== undefined) {
            outcome.before.feeCents = row.feeCents;
            row.feeCents = set.feeCents;
            row.feeRate = null;
          }
        }
      }
      outcomes.push(outcome);
    } else {
      const hits = model.dividends.filter((row) => matchesDividend(c, row));
      const row = hits.length === 1 ? hits[0]! : null;
      const outcome: CorrectionOutcome = {
        id: c.id,
        target: 'dividend',
        matches: hits.length,
        applied: row !== null,
        skip: 'action' in c,
        sheetRef: row?.sheetRef ?? null,
        kind: row?.holdingKind ?? null,
        before: {},
        reason: c.reason,
      };
      if (row !== null) {
        row.original ??= {
          paymentDate: row.paymentDate,
          ticker: row.ticker,
          exDate: row.exDate,
          netAmountCents: row.netAmountCents,
          reinvested: row.reinvested,
        };
        row.correctionId = row.correctionId === null ? c.id : `${row.correctionId},${c.id}`;
        if ('action' in c) {
          row.skipped = true;
        } else {
          const set = c.set;
          if (set.paymentDate !== undefined) {
            outcome.before.paymentDate = row.paymentDate;
            row.paymentDate = set.paymentDate;
          }
          if (set.ticker !== undefined) {
            outcome.before.ticker = row.ticker;
            row.ticker = set.ticker.trim();
          }
          if (set.exDate !== undefined) {
            outcome.before.exDate = row.exDate;
            row.exDate = set.exDate;
          }
          if (set.netAmountCents !== undefined) {
            outcome.before.netAmountCents = row.netAmountCents;
            row.netAmountCents = set.netAmountCents;
          }
          if (set.reinvested !== undefined) {
            outcome.before.reinvested = row.reinvested;
            row.reinvested = set.reinvested;
          }
        }
      }
      outcomes.push(outcome);
    }
  }
  return outcomes;
}

// ─── Exclusions and the instrument set (§4.4) ───────────────────────────────────────────────────

/** Moved to `@joinr/schema` in Stage 2 (shared with the server); re-exported unchanged. */
export { splitSymbol };

export const instrumentKey = (kind: InstrumentKind, symbol: string): string => `${kind}|${symbol}`;

/** Sets `model.exclusions` and `model.instruments`; pushes info/unexplained lines. */
export function buildInstruments(model: WorkbookModel, checks: Check[]): void {
  const ledgerSymbols = new Set(
    model.ledger.filter((l) => !l.skipped).map((l) => instrumentKey(l.kind, l.symbol)),
  );
  const listedCodes = new Set(
    model.watch
      .filter((w) => w.kind === 'stock' || w.kind === 'etf')
      .map((w) => splitSymbol(w.symbol).code),
  );
  const exclusions: Exclusion[] = [];
  const excluded = new Set<string>();
  for (const w of model.watch) {
    if (w.kind !== 'managed_fund') continue;
    const empty = (w.heldUnits ?? 0) === 0 && !ledgerSymbols.has(instrumentKey(w.kind, w.symbol));
    if (!empty) continue;
    let exclusion: Exclusion | null = null;
    const base = {
      kind: w.kind,
      symbol: w.symbol,
      sheetRef: w.sheetRef,
      cachedPrice: w.price.value,
    };
    if (Object.hasOwn(BULLION_FEEDS, w.symbol)) {
      exclusion = { ...base, reasonCode: 'exclusion_d23', decision: 'D23' };
    } else if (listedCodes.has(w.symbol)) {
      exclusion = { ...base, reasonCode: 'exclusion_d22', decision: 'D22' };
    } else if (/=[FX]$/.test(w.symbol)) {
      exclusion = { ...base, reasonCode: 'feed_row', decision: null };
    }
    if (exclusion) {
      exclusions.push(exclusion);
      excluded.add(w.sheetRef);
    }
  }

  const drafts: InstrumentDraft[] = [];
  for (const kind of INSTRUMENT_KINDS) {
    const seen = new Set<string>();
    let order = 0;
    for (const w of model.watch) {
      if (w.kind !== kind || excluded.has(w.sheetRef)) continue;
      if (seen.has(w.symbol)) {
        checks.push(
          check({
            id: `holdings.duplicate.${w.sheetRef}`,
            section: 'holdings',
            label: `Watch row ${w.sheetRef} repeats an earlier row`,
            sheetRef: w.sheetRef,
            status: 'unexplained',
            reasonCode: 'unsupported_value',
            reason:
              'The same symbol appears twice in the watch table; only the first row was imported',
          }),
        );
        continue;
      }
      seen.add(w.symbol);
      const { exchange, code } = splitSymbol(w.symbol);
      if (kind === 'stock' && exchange === null) {
        checks.push(
          info(
            `holdings.noExchange.${w.sheetRef}`,
            'holdings',
            `Stock ${w.sheetRef} has no exchange prefix`,
            'unsupported_value',
            'The ticker has no exchange code (e.g. ASX:); it has no automatic price source',
            { sheetRef: w.sheetRef },
          ),
        );
      }
      if (w.price.crossTab !== null) {
        checks.push(
          info(
            `holdings.priceFormula.${w.price.sheetRef}`,
            'holdings',
            `Price at ${w.price.sheetRef} reads another tab`,
            'feed_row',
            `The price formula reads the ${w.price.crossTab} tab; it is ignored and the price service prices this instrument`,
            { sheetRef: w.price.sheetRef },
          ),
        );
      }
      order += 1;
      drafts.push({
        kind,
        symbol: w.symbol,
        exchange,
        code,
        name: w.name,
        quoteCurrency: w.quoteCurrency,
        isWatched: true,
        sortOrder: order,
        targetRatio: w.targetRatio,
        sector: w.sector,
        isRetirement: w.isRetirement,
        location: w.location,
        mgmtFeeRatio: w.mgmtFeeRatio,
        regionUsRatio: w.regions[0],
        regionAsiaRatio: w.regions[1],
        regionAusRatio: w.regions[2],
        regionOtherRatio: w.regions[3],
        dividendFreqMonths: w.dividendFreqMonths,
        drp: w.drp,
        sheetRef: w.sheetRef,
        watch: w,
      });
    }
    for (const l of model.ledger) {
      if (l.kind !== kind || l.skipped || seen.has(l.symbol)) continue;
      seen.add(l.symbol);
      const { exchange, code } = splitSymbol(l.symbol);
      order += 1;
      drafts.push({
        kind,
        symbol: l.symbol,
        exchange,
        code,
        name: null,
        quoteCurrency: 'AUD',
        isWatched: false,
        sortOrder: order,
        targetRatio: null,
        sector: null,
        isRetirement: false,
        location: null,
        mgmtFeeRatio: null,
        regionUsRatio: null,
        regionAsiaRatio: null,
        regionAusRatio: null,
        regionOtherRatio: null,
        dividendFreqMonths: null,
        drp: null,
        sheetRef: l.sheetRef,
        watch: null,
      });
    }
  }
  model.exclusions = exclusions;
  model.instruments = drafts;
}

// ─── Suspects (D26) ─────────────────────────────────────────────────────────────────────────────

export const PRICE_OUTLIER_HIGH = 4;
export const PRICE_OUTLIER_LOW = 0.25;
export const PRICE_OUTLIER_MIN_TRADES = 3;
const OVERSELL_TOLERANCE = new JoinrDecimal('-1e-9');

const add = (flags: ReviewFlag[], flag: ReviewFlag) => {
  if (!flags.includes(flag)) flags.push(flag);
};

function median(values: InstanceType<typeof JoinrDecimal>[]): InstanceType<typeof JoinrDecimal> {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2);
}

/** Row i breaks the date order while its neighbours are in order (§4.6). */
export function outOfOrderIndexes(dates: readonly string[]): number[] {
  const out: number[] = [];
  const n = dates.length;
  for (let i = 0; i < n; i++) {
    const d = dates[i]!;
    if (i === 0) {
      if (n >= 3 && d > dates[1]! && dates[1]! <= dates[2]!) out.push(i);
    } else if (i === n - 1) {
      if (n >= 3 && d < dates[i - 1]! && dates[i - 2]! <= dates[i - 1]!) out.push(i);
    } else {
      const prev = dates[i - 1]!;
      const next = dates[i + 1]!;
      if ((d < prev || d > next) && prev <= next) out.push(i);
    }
  }
  return out;
}

/** Assigns `seq` and suspect flags to ledger rows and dividends. */
export function flagSuspects(model: WorkbookModel): void {
  const sheets: LedgerSheet[] = ['Stocks', 'ETFs', 'Managed Funds', 'Crypto'];
  for (const sheet of sheets) {
    const rows = model.ledger.filter((l) => l.sheet === sheet && !l.skipped);
    rows.forEach((l, i) => (l.seq = i + 1));
    for (const i of outOfOrderIndexes(rows.map((l) => l.date))) add(rows[i]!.flags, 'out_of_order');
    const bySymbol = new Map<string, LedgerRow[]>();
    for (const l of rows) bySymbol.set(l.symbol, [...(bySymbol.get(l.symbol) ?? []), l]);
    for (const trades of bySymbol.values()) {
      if (trades.length >= PRICE_OUTLIER_MIN_TRADES) {
        for (const t of trades) {
          const others = trades.filter((o) => o !== t).map((o) => new JoinrDecimal(o.price));
          const m = median(others);
          if (m.lessThanOrEqualTo(0)) continue;
          const ratio = new JoinrDecimal(t.price).dividedBy(m);
          if (ratio.greaterThan(PRICE_OUTLIER_HIGH) || ratio.lessThan(PRICE_OUTLIER_LOW))
            add(t.flags, 'price_outlier');
        }
      }
      const ordered = [...trades].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq,
      );
      let running = new JoinrDecimal(0);
      let wasNegative = false;
      for (const t of ordered) {
        running = running.plus(new JoinrDecimal(t.units));
        const negative = running.lessThan(OVERSELL_TOLERANCE);
        if (negative && !wasNegative) add(t.flags, 'oversell');
        wasNegative = negative;
      }
    }
    for (const l of rows) {
      if (l.date > model.meta.asOf) add(l.flags, 'future_date');
      if (new JoinrDecimal(l.price).lessThanOrEqualTo(0)) add(l.flags, 'non_positive_price');
      if (new JoinrDecimal(l.units).isZero()) add(l.flags, 'zero_units');
    }
  }
}

// ─── Dividend re-keying (D28) and budget links ──────────────────────────────────────────────────

export function rekeyDividends(model: WorkbookModel): void {
  for (const d of model.dividends) {
    if (d.skipped) continue;
    const candidates = model.instruments.filter((i) => i.kind === d.holdingKind);
    const exact = candidates.find((i) => i.symbol === d.ticker);
    if (exact) {
      d.link = { symbol: exact.symbol, how: 'exact' };
      continue;
    }
    if (!d.ticker.includes(':')) {
      const byCode = candidates.filter((i) => i.code.toLowerCase() === d.ticker.toLowerCase());
      if (byCode.length === 1) {
        d.link = { symbol: byCode[0]!.symbol, how: 'rekeyed' };
        continue;
      }
    }
    d.link = null;
    add(d.flags, 'unmatched_ticker');
  }
}

export function linkBudgetAccounts(model: WorkbookModel): void {
  for (const item of model.budgetItems) {
    if (item.accountName === null) continue;
    const name = item.accountName.trim();
    const hits = model.cashAccounts
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.name.trim() === name);
    if (hits.length === 1) item.cashAccountIndex = hits[0]!.i;
    else add(item.flags, 'unmatched_account');
  }
}

// ─── Account kinds across a re-import (D49; stage-3.md §3.5 item 3) ────────────────────────────

/** An account as stored before the replace-all delete. */
export interface StoredAccountKind {
  name: string;
  sheetRef: string | null;
  kind: CashAccountKind;
}

export interface CarriedKinds {
  /** One kind per new account, in the new accounts' order (`bank` when nothing matched). */
  kinds: CashAccountKind[];
  /** Names of the stored non-bank accounts whose kind no new account took (stored order). */
  notCarried: string[];
}

/** A row as stored before the replace-all delete, or as imported: what the carry rules match on. */
export interface NamedRow {
  name: string;
  sheetRef: string | null;
}

/**
 * For each new row, the index of the stored row it continues (-1 for none): the stored row with
 * the same name when that name is unique among both the stored and the new rows, else the stored
 * row with the same sheet ref and name (a row added or removed above shifts the row-based refs, so
 * the name wins when it can). Each stored row is matched at most once. D49's rule for account
 * kinds, reused for the fund that receives SG (stage-4.md §3.5 item 3).
 */
export function matchStoredRows(stored: readonly NamedRow[], next: readonly NamedRow[]): number[] {
  const key = (name: string) => name.trim();
  const tally = (names: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1);
    return counts;
  };
  const storedNames = tally(stored.map((s) => s.name));
  const nextNames = tally(next.map((a) => a.name));
  const used = new Set<number>();
  return next.map((a) => {
    const name = key(a.name);
    const unique = storedNames.get(name) === 1 && nextNames.get(name) === 1;
    const index = unique
      ? stored.findIndex((s) => key(s.name) === name)
      : stored.findIndex(
          (s, i) =>
            !used.has(i) &&
            s.sheetRef !== null &&
            s.sheetRef === a.sheetRef &&
            key(s.name) === name,
        );
    if (index >= 0) used.add(index);
    return index;
  });
}

/**
 * A new account takes the kind of the stored account it continues (`matchStoredRows`). Everything
 * else is `bank`, the importer's default.
 */
export function carryAccountKinds(
  stored: readonly StoredAccountKind[],
  next: readonly NamedRow[],
): CarriedKinds {
  const matches = matchStoredRows(stored, next);
  const kinds = matches.map((index): CashAccountKind => (index < 0 ? 'bank' : stored[index]!.kind));
  const used = new Set(matches.filter((i) => i >= 0));
  const notCarried = stored.filter((s, i) => s.kind !== 'bank' && !used.has(i)).map((s) => s.name);
  return { kinds, notCarried };
}

// ─── The fund that receives SG across a re-import (stage-4.md §3.5 item 3) ─────────────────────

/** A super fund as stored before the replace-all delete. */
export interface StoredSuperFund extends NamedRow {
  receivesSg: boolean;
}

export interface CarriedSgFund {
  /** One flag per new fund, in the new funds' order. */
  receivesSg: boolean[];
  /** Stored funds that received SG and that no imported fund continues. */
  notCarried: number;
}

/**
 * The new fund that continues the stored SG fund (`matchStoredRows`: a unique name, else the same
 * sheet ref and name) receives SG; the flag is never set on any other fund.
 */
export function carrySgFund(
  stored: readonly StoredSuperFund[],
  next: readonly NamedRow[],
): CarriedSgFund {
  const matches = matchStoredRows(stored, next);
  const receivesSg = matches.map((index) => index >= 0 && stored[index]!.receivesSg);
  const used = new Set(matches.filter((i) => i >= 0));
  const notCarried = stored.filter((s, i) => s.receivesSg && !used.has(i)).length;
  return { receivesSg, notCarried };
}

// ─── Stage 4 dates and History-derived contributions (stage-4.md §3.5 items 2 and 4) ───────────

/** The latest kept snapshot (by run date), or null. */
export function latestSnapshot(snaps: readonly SnapshotRow[]): SnapshotRow | null {
  let best: SnapshotRow | null = null;
  for (const s of snaps) if (best === null || s.runDate >= best.runDate) best = s;
  return best;
}

/**
 * Balances unchanged since the last snapshot are dated at the last run date (`Net Worth!C51`), so
 * the provisional period counts a balance as updated only when it changed after that snapshot:
 * - every fund's entry, when the live total (`Super!B12`) equals the last frozen History row's Q;
 * - a property loan's entry, when the property loans' current balances add up to that row's |AB|
 *   and the loan started (if a start date is known) before the last run date.
 * Everything else keeps the workbook as-of. The last run date is never used when it is after the
 * as-of, so no entry is dated after the workbook's own date.
 */
export function dateBalanceEntries(model: WorkbookModel): void {
  const lastRun = model.meta.lastRun;
  const last = latestSnapshot(model.snapshots);
  if (lastRun === null || last === null || lastRun > model.meta.asOf) return;
  const q = last.values.super_value_cents;
  if (
    model.superFunds.length > 0 &&
    model.superTotalCents !== null &&
    typeof q === 'number' &&
    q === model.superTotalCents
  ) {
    for (const f of model.superFunds) f.balanceAsOf = lastRun;
  }
  const ab = last.values.mortgage_balance_cents;
  const propertyLoans = model.loans.filter((l) => l.propertyIndex !== null);
  const total = propertyLoans.reduce((s, l) => s + l.currentBalanceCents, 0);
  if (propertyLoans.length > 0 && typeof ab === 'number' && Math.abs(ab) === total) {
    for (const l of propertyLoans) {
      if (l.startDate === null || l.startDate < lastRun) l.balanceAsOf = lastRun;
    }
  }
}

/** The ledgers whose Retirement-tagged buys the template adds to History R (spec 04 §2.3). */
export const RETIREMENT_BUY_KINDS: readonly InstrumentKind[] = ['stock', 'etf', 'managed_fund'];

/** A trade as the D37 exclusion sees it. */
export interface RetirementTradeLike {
  kind: InstrumentKind;
  date: string;
  units: string;
  price: string;
  retirement: boolean;
}

/**
 * Σ units × price (cents) of buys of Retirement-tagged Stocks, ETFs and Managed Funds holdings
 * dated in `(from, to]`: what History R also holds when SheetOptions "Retirement - Contributions
 * in Savings Rate" is Yes (spec 04 §2.3).
 */
export function retirementBuysCents(
  trades: readonly RetirementTradeLike[],
  from: string,
  to: string,
): number {
  let total = 0;
  for (const t of trades) {
    if (!t.retirement || !RETIREMENT_BUY_KINDS.includes(t.kind)) continue;
    if (!(t.date > from && t.date <= to)) continue;
    if (!new JoinrDecimal(t.units).greaterThan(0)) continue;
    total += multiplyToCents(t.units, t.price);
  }
  return total;
}

/** The snapshot windows `(from, to]` in run-date order; the first starts one month earlier. */
export function snapshotWindows<T extends { runDate: string }>(
  snaps: readonly T[],
): { snap: T; from: string; to: string }[] {
  const ordered = [...snaps].sort((a, b) =>
    a.runDate < b.runDate ? -1 : a.runDate > b.runDate ? 1 : 0,
  );
  return ordered.map((snap, i) => ({
    snap,
    from: i === 0 ? addMonthsIso(snap.runDate, -1) : ordered[i - 1]!.runDate,
    to: snap.runDate,
  }));
}

/**
 * The contribution a History row's R stands for (stage-4.md §3.5 item 2): R in cents, less the
 * window's Retirement-tagged buys when `excludeRetirement` (D37; never below 0).
 */
export function derivedContributionCents(
  rCents: number,
  excludedCents: number,
  excludeRetirement: boolean,
): number {
  if (!excludeRetirement || excludedCents <= 0) return rCents;
  return Math.max(0, rCents - excludedCents);
}

/** True when SheetOptions "Retirement - Contributions in Savings Rate" is Yes. */
export function includesRetirementContributions(model: WorkbookModel): boolean {
  const plan = model.settings.find((p) => p.key === 'savings.includeRetirementContributions');
  return plan?.status === 'value' && plan.value === true;
}

/**
 * One `voluntary_contribution` per imported snapshot with a non-zero derived R (the frozen rows
 * after the one-per-month rule, the rows migration 0004 reads): its period, dated at its run date,
 * no fund, `sheet_ref` `History!R<row>`, appended in run-date order. Runs after corrections and
 * the instrument set (the D37 exclusion reads the imported trades and retirement tags).
 */
export function deriveHistoryContributions(model: WorkbookModel, checks: Check[]): void {
  const exclude = includesRetirementContributions(model);
  const retirement = new Set(
    model.instruments.filter((i) => i.isRetirement).map((i) => instrumentKey(i.kind, i.symbol)),
  );
  const trades: RetirementTradeLike[] = model.ledger
    .filter((l) => !l.skipped)
    .map((l) => ({
      kind: l.kind,
      date: l.date,
      units: l.units,
      price: l.price,
      retirement: retirement.has(instrumentKey(l.kind, l.symbol)),
    }));
  let excludedRows = 0;
  for (const { snap, from, to } of snapshotWindows(model.snapshots)) {
    const r = snap.values.super_contrib_cents;
    if (typeof r !== 'number' || r === 0) continue;
    const excluded = exclude ? retirementBuysCents(trades, from, to) : 0;
    const amount = derivedContributionCents(r, excluded, exclude);
    if (amount !== r) excludedRows += 1;
    if (amount === 0) continue;
    model.superEntries.push({
      kind: 'voluntary_contribution',
      periodMonth: snap.periodMonth,
      amountCents: amount,
      sheetRef: `History!R${snap.row}`,
      entryDate: snap.runDate,
    });
  }
  if (excludedRows > 0) {
    checks.push(
      info(
        'super.contributions.retirementExcluded',
        'super',
        'Retirement-tagged buys left out of the History contributions',
        'feature_dropped',
        `${excludedRows} History ${excludedRows === 1 ? 'row’s contribution includes' : 'rows’ contributions include'} buys of holdings tagged Retirement; those buys stay trades and were left out of the super contributions`,
        {
          unit: 'count',
          expected: excludedRows,
          refs: { decision: 'D37', entity: 'super-entries' },
        },
      ),
    );
  }
}

// ─── One row per period ─────────────────────────────────────────────────────────────────────────

/** Period notes: one per (period, kind); several notes in one month are joined. */
export function mergeNotes(notes: NoteRow[]): NoteRow[] {
  const byKey = new Map<string, NoteRow>();
  const out: NoteRow[] = [];
  for (const n of notes) {
    const key = `${n.periodMonth}|${n.kind}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.note = `${prev.note}\n${n.note}`;
      continue;
    }
    const copy = { ...n };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}
