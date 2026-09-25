// Processing between extraction and writes (stage-1.md §4.4–§4.7): owner corrections (D27),
// feed-row exclusions (D22/D23), the instrument set, suspect flags (D26), dividend re-keying (D28)
// and budget → cash account links. Pure: no DB.
import {
  BULLION_FEEDS,
  compareDecimals,
  INSTRUMENT_KINDS,
  JoinrDecimal,
  normaliseDecimal,
  splitSymbol,
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
  SideIncomeRow,
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

// ─── One row per period ─────────────────────────────────────────────────────────────────────────

/** Side income: one entry per (period, stream); the later row wins (unexplained otherwise). */
export function dedupeSideIncome(entries: SideIncomeRow[], checks: Check[]): SideIncomeRow[] {
  const byKey = new Map<string, SideIncomeRow>();
  const dups = new Map<string, string[]>();
  for (const e of entries) {
    const key = `${e.periodMonth}|${e.streamIndex}`;
    const prev = byKey.get(key);
    if (prev) dups.set(key, [...(dups.get(key) ?? [prev.sheetRef]), e.sheetRef]);
    byKey.set(key, e);
  }
  for (const [key, refs] of dups) {
    const [period, stream] = key.split('|');
    checks.push(
      check({
        id: `income.period.${period}.${Number(stream) + 1}`,
        section: 'income',
        label: `Side income ${period}: several rows in one month`,
        sheetRef: refs.at(-1) ?? null,
        status: 'unexplained',
        reasonCode: 'unsupported_value',
        reason: `Rows ${refs.join(', ')} fall in the same month; only the last was imported`,
      }),
    );
  }
  const kept = new Set(byKey.values());
  return entries.filter((e) => kept.has(e));
}

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
