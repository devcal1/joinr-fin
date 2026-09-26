// The reconciliation report's checks (stage-1.md §4.9). The expected side is read from the
// workbook (independently of the extractors where the plan says so); the actual side is read back
// from the database inside the import transaction.
import {
  addMonthsIso,
  centsFromNumber,
  decimalFromNumber,
  INSTRUMENT_KINDS,
  JoinrDecimal,
  multiplyToCents,
  normaliseSheetLabel,
  REPORT_SECTIONS,
  SETTINGS,
  SHEET_OPTIONS_IDS,
  SHEET_OPTIONS_NOT_IMPORTED,
  SHEET_OPTIONS_VALIDATED,
  SNAPSHOT_VALUE_COLUMNS,
  type InstrumentKind,
  type PeriodNoteKind,
  type RecordEntityId,
  type ReviewFlag,
  type SettingDef,
  type SettingValue,
} from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
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
} from '@joinr/schema/db';
import {
  centsTolerance,
  check,
  decimalDiff,
  decimalToCents,
  info,
  RATIO_TOLERANCE,
  sumToCents,
  UNITS_TOLERANCE,
  withinCents,
  withinDecimal,
} from './checks';
import {
  budgetEnd,
  cashEnd,
  cgtSlotSkipped,
  historyRows,
  propertyColumns,
  propertySlotUsed,
  sheetOptionRows,
  watchEnd,
} from './extract';
import {
  BUDGET,
  CAPITAL_GAINS,
  CASH,
  DIVIDENDS,
  HISTORY,
  investmentLayout,
  LIABILITIES,
  MOVEMENT_COLUMNS,
  NET_WORTH,
  OTHER_ASSETS,
  PROPERTY,
  sheetRef,
  SIDE_INCOME,
  SUPER,
} from './layout';
import type { Check, Exclusion, LedgerRow, WorkbookModel } from './model';
import { instrumentKey, type CorrectionOutcome } from './process';
import type { SheetReader } from './reader';
import type { PriceTreatment, Tx, WriteResult } from './writer';

type Dec = InstanceType<typeof JoinrDecimal>;

const KIND_LABEL: Record<InstrumentKind, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  managed_fund: 'Managed funds',
  crypto: 'Crypto',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2025-12' → 'Dec 2025' (labels only; check ids keep the ISO month). */
function monthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : period;
}

const EXCLUSION_WORDS: Record<Exclusion['reasonCode'], string> = {
  exclusion_d23: 'bullion feed rows',
  exclusion_d22: 'duplicate listings',
  feed_row: 'price-feed rows',
};

const cents = (n: number | null): number => (n === null ? 0 : centsFromNumber(n));

/** A money check: match within tolerance, else `mismatch` decides the status. */
function money(
  base: { id: string; section: Check['section']; label: string; sheetRef?: string | null },
  expected: number,
  actual: number,
  n: number,
  mismatch: () => Partial<Check> & { status: Check['status'] } = () => ({ status: 'unexplained' }),
): Check {
  const diff = actual - expected;
  const ok = withinCents(expected, actual, n);
  const outcome = ok ? { status: 'match' as const } : mismatch();
  return check({ ...base, unit: 'cents', expected, actual, diff, ...outcome });
}

interface Db {
  instruments: (typeof instruments.$inferSelect)[];
  trades: (typeof trades.$inferSelect & {
    kind: InstrumentKind;
    symbol: string;
    retirement: boolean;
  })[];
  dividends: (typeof dividends.$inferSelect)[];
  cashAccounts: (typeof cashAccounts.$inferSelect)[];
  cashBalanceEntries: (typeof cashBalanceEntries.$inferSelect)[];
  budgetItems: (typeof budgetItems.$inferSelect)[];
  yearlyExpenses: (typeof yearlyExpenses.$inferSelect)[];
  incomeStreams: (typeof incomeStreams.$inferSelect)[];
  /** Side-income deposits (D57). */
  sideIncome: (typeof sideIncomeDeposits.$inferSelect)[];
  periodNotes: (typeof periodNotes.$inferSelect)[];
  snapshots: (typeof snapshots.$inferSelect)[];
  otherAssets: (typeof otherAssets.$inferSelect)[];
  superFunds: (typeof superFunds.$inferSelect)[];
  superEntries: (typeof superEntries.$inferSelect)[];
  properties: (typeof properties.$inferSelect)[];
  loans: (typeof loans.$inferSelect)[];
  settings: (typeof settings.$inferSelect)[];
  priceSources: (typeof priceSources.$inferSelect)[];
  prices: (typeof prices.$inferSelect)[];
}

function readBack(tx: Tx): Db {
  const inst = tx.select().from(instruments).all();
  const byId = new Map(inst.map((i) => [i.id, i]));
  return {
    instruments: inst,
    trades: tx
      .select()
      .from(trades)
      .all()
      .map((t) => {
        const i = byId.get(t.instrumentId)!;
        return { ...t, kind: i.kind, symbol: i.symbol, retirement: i.isRetirement };
      }),
    dividends: tx.select().from(dividends).all(),
    cashAccounts: tx.select().from(cashAccounts).all(),
    cashBalanceEntries: tx.select().from(cashBalanceEntries).all(),
    budgetItems: tx.select().from(budgetItems).all(),
    yearlyExpenses: tx.select().from(yearlyExpenses).all(),
    incomeStreams: tx.select().from(incomeStreams).all(),
    sideIncome: tx.select().from(sideIncomeDeposits).all(),
    periodNotes: tx.select().from(periodNotes).all(),
    snapshots: tx.select().from(snapshots).all(),
    otherAssets: tx.select().from(otherAssets).all(),
    superFunds: tx.select().from(superFunds).all(),
    superEntries: tx.select().from(superEntries).all(),
    properties: tx.select().from(properties).all(),
    loans: tx.select().from(loans).all(),
    settings: tx.select().from(settings).all(),
    priceSources: tx.select().from(priceSources).all(),
    prices: tx.select().from(prices).all(),
  };
}

export interface ReconcileInput {
  r: SheetReader;
  model: WorkbookModel;
  outcomes: CorrectionOutcome[];
  written: WriteResult;
  tx: Tx;
}

export interface ReconcileOutput {
  checks: Check[];
  counts: Partial<Record<RecordEntityId, number>>;
}

export function reconcile(input: ReconcileInput): ReconcileOutput {
  const db = readBack(input.tx);
  const ctx = { ...input, db };
  const holdings = holdingChecks(ctx);
  const checks: Check[] = [
    ...workbookChecks(ctx),
    ...countChecks(ctx),
    ...holdings.checks,
    ...ledgerChecks(ctx),
    ...movementChecks(ctx),
    ...dividendChecks(ctx),
    ...cashflowChecks(ctx),
    ...assetChecks(ctx),
    ...snapshotChecks(ctx),
    ...netWorthChecks(ctx, holdings),
    ...settingsChecks(ctx),
    ...exclusionChecks(ctx),
    ...correctionChecks(ctx),
    ...suspectChecks(ctx),
    ...input.model.checks,
  ];
  const order = new Map(REPORT_SECTIONS.map((s, i) => [s, i]));
  const sorted = checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => order.get(a.c.section)! - order.get(b.c.section)! || a.i - b.i)
    .map(({ c }) => c);
  const counts: Partial<Record<RecordEntityId, number>> = {
    instruments: db.instruments.length,
    trades: db.trades.length,
    dividends: db.dividends.length,
    'cash-accounts': db.cashAccounts.length,
    'cash-balance-entries': db.cashBalanceEntries.length,
    'budget-items': db.budgetItems.length,
    'yearly-expenses': db.yearlyExpenses.length,
    'income-streams': db.incomeStreams.length,
    'side-income': db.sideIncome.length,
    'period-notes': db.periodNotes.length,
    snapshots: db.snapshots.length,
    'other-assets': db.otherAssets.length,
    'super-funds': db.superFunds.length,
    'super-entries': db.superEntries.length,
    properties: db.properties.length,
    loans: db.loans.length,
    settings: db.settings.filter((s) => input.written.settingKeys.includes(s.key)).length,
  };
  return { checks: dedupeIds(sorted), counts };
}

/** Check ids must be unique; a repeated id gets a numeric suffix (defensive). */
function dedupeIds(checks: Check[]): Check[] {
  const seen = new Map<string, number>();
  return checks.map((c) => {
    const n = seen.get(c.id) ?? 0;
    seen.set(c.id, n + 1);
    return n === 0 ? c : { ...c, id: `${c.id}#${n + 1}` };
  });
}

type Ctx = ReconcileInput & { db: Db };

// ─── Workbook ───────────────────────────────────────────────────────────────────────────────────

function workbookChecks({ model }: Ctx): Check[] {
  const m = model.meta;
  const out: Check[] = [];
  const v = m.templateVersion;
  out.push(
    check({
      id: 'workbook.template',
      section: 'workbook',
      label: 'Template version',
      sheetRef: sheetRef(NET_WORTH.sheet, NET_WORTH.templateVersion),
      unit: 'text',
      expected: v,
      actual: v,
      status: v !== null && /^2\.15(\.|$)/.test(v) ? 'match' : 'info',
      reason:
        v !== null && /^2\.15(\.|$)/.test(v)
          ? null
          : 'Not template v2.15.x; the import follows the v2.15 layout',
    }),
  );
  out.push(
    check({
      id: 'workbook.asOf',
      section: 'workbook',
      label: 'Workbook as-of date',
      sheetRef: sheetRef(NET_WORTH.sheet, NET_WORTH.asOf),
      unit: 'date',
      expected: m.asOfFromSheet ? m.asOf : null,
      actual: m.asOf,
      status: m.asOfFromSheet ? 'match' : 'info',
      reason: m.asOfFromSheet ? null : 'No date in Net Worth!E52; the import date is used',
    }),
  );
  out.push(
    check({
      id: 'workbook.date1904',
      section: 'workbook',
      label: 'Date system',
      unit: 'text',
      expected: m.date1904 ? '1904' : '1900',
      actual: m.date1904 ? '1904' : '1900',
      status: m.date1904 ? 'info' : 'match',
      reason: m.date1904 ? 'The workbook uses the 1904 date system; dates were converted' : null,
    }),
  );
  out.push(
    check({
      id: 'workbook.historyHeaders',
      section: 'workbook',
      label: 'History column headers',
      sheetRef: sheetRef(HISTORY.sheet, 'B2'),
      unit: 'count',
      expected: SNAPSHOT_VALUE_COLUMNS.length,
      actual: SNAPSHOT_VALUE_COLUMNS.length,
      diff: 0,
      status: 'match',
    }),
  );
  return out;
}

// ─── Counts ─────────────────────────────────────────────────────────────────────────────────────

function sheetLedgerSymbols(r: SheetReader, kind: InstrumentKind): string[] {
  const l = investmentLayout(kind);
  const out: string[] = [];
  const last = r.lastRow(l.sheet);
  for (let row = l.ledgerHeader + 1; row <= last; row++) {
    if (!r.isBlank(l.sheet, `A${row}`)) out.push(r.text(l.sheet, `A${row}`)!);
  }
  return out;
}

function sheetWatchSymbols(r: SheetReader, kind: InstrumentKind): string[] {
  const l = investmentLayout(kind);
  const out: string[] = [];
  const end = watchEnd(r, l.sheet);
  for (let row = 2; row <= end; row++)
    if (!r.isBlank(l.sheet, `A${row}`)) out.push(r.text(l.sheet, `A${row}`)!);
  return out;
}

function countNotes(r: SheetReader, kind: PeriodNoteKind): number {
  const spec = {
    spend: { sheet: CASH.sheet, note: 'Q', date: 'H', from: CASH.notesFrom, to: CASH.notesTo },
    super_option: {
      sheet: SUPER.sheet,
      note: 'F',
      date: 'E',
      from: SUPER.notesFrom,
      to: SUPER.notesTo,
    },
    side_income: {
      sheet: SIDE_INCOME.sheet,
      note: 'J',
      date: 'F',
      from: SIDE_INCOME.firstRow,
      to: SIDE_INCOME.lastRow,
    },
  }[kind];
  let n = 0;
  for (let row = spec.from; row <= spec.to; row++) {
    if (
      !r.isBlank(spec.sheet, `${spec.note}${row}`) &&
      r.date(spec.sheet, `${spec.date}${row}`) !== null
    )
      n++;
  }
  return n;
}

function countCheck(
  entity: string,
  label: string,
  expected: number,
  actual: number,
  explain?: (shortfall: number) => Partial<Check> | null,
): Check {
  const base = {
    id: `counts.${entity}`,
    section: 'counts' as const,
    label,
    unit: 'count' as const,
    expected,
    actual,
    diff: actual - expected,
  };
  if (expected === actual) return check({ ...base, status: 'match' });
  const explained = explain?.(expected - actual) ?? null;
  return check({ ...base, status: 'unexplained', ...explained });
}

function countChecks({ r, model, db, outcomes }: Ctx): Check[] {
  const out: Check[] = [];
  for (const kind of INSTRUMENT_KINDS) {
    const watch = sheetWatchSymbols(r, kind);
    const watchSet = new Set(watch);
    const ledgerOnly = new Set(sheetLedgerSymbols(r, kind).filter((s) => !watchSet.has(s)));
    const expected = watch.length + ledgerOnly.size;
    const actual = db.instruments.filter((i) => i.kind === kind).length;
    const excl = model.exclusions.filter((e) => e.kind === kind);
    out.push(
      countCheck(
        `instruments.${kind}`,
        `Instruments: ${KIND_LABEL[kind]}`,
        expected,
        actual,
        (shortfall) => {
          if (excl.length === 0 || shortfall !== excl.length) return null;
          const byCode = new Map<Exclusion['reasonCode'], number>();
          for (const e of excl) byCode.set(e.reasonCode, (byCode.get(e.reasonCode) ?? 0) + 1);
          const codes = [...byCode.entries()]
            .map(([c, n]) => `${EXCLUSION_WORDS[c]} ×${n}`)
            .join(', ');
          // One reason code per check: the most frequent exclusion (the reason lists them all).
          const code = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0]![0];
          const decisions = [...new Set(excl.map((e) => e.decision).filter((d) => d !== null))];
          return {
            status: 'explained',
            reasonCode: code,
            reason: `Not imported as instruments: ${codes}`,
            refs: {
              entity: 'instruments',
              ...(decisions.length > 0 ? { decision: decisions.sort().join(', ') } : {}),
            },
          };
        },
      ),
    );
  }
  for (const kind of INSTRUMENT_KINDS) {
    const l = investmentLayout(kind);
    const expected = sheetLedgerSymbols(r, kind).length;
    const actual = db.trades.filter((t) => t.kind === kind).length;
    const skips = outcomes.filter(
      (o) => o.target === 'trade' && o.applied && o.skip && o.kind === kind,
    );
    const explainSkips = (shortfall: number) =>
      skips.length > 0 && shortfall === skips.length
        ? {
            status: 'explained' as const,
            reasonCode: 'correction' as const,
            reason: `Rows skipped by corrections ${skips.map((s) => s.id).join(', ')}`,
            refs: { correctionId: skips.map((s) => s.id).join(',') },
          }
        : null;
    out.push(
      countCheck(`trades.${kind}`, `Trades: ${KIND_LABEL[kind]}`, expected, actual, explainSkips),
    );
    if (r.has(CAPITAL_GAINS.sheet)) {
      const cg = r.number(CAPITAL_GAINS.sheet, `${CAPITAL_GAINS.column}${l.capitalGainsRow}`);
      if (cg !== null) {
        const c = countCheck(
          `trades.${kind}.capitalGains`,
          `Trades: ${KIND_LABEL[kind]} vs Capital Gains row count`,
          cg,
          actual,
          explainSkips,
        );
        out.push({
          ...c,
          sheetRef: sheetRef(CAPITAL_GAINS.sheet, `${CAPITAL_GAINS.column}${l.capitalGainsRow}`),
        });
      }
    }
  }
  {
    let expected = 0;
    for (let row = DIVIDENDS.firstRow; row <= DIVIDENDS.lastRow; row++)
      if (!r.isBlank(DIVIDENDS.sheet, `A${row}`)) expected++;
    const skips = outcomes.filter((o) => o.target === 'dividend' && o.applied && o.skip);
    out.push(
      countCheck('dividends', 'Dividends', expected, db.dividends.length, (shortfall) =>
        skips.length > 0 && shortfall === skips.length
          ? {
              status: 'explained',
              reasonCode: 'correction',
              reason: `Rows skipped by corrections ${skips.map((s) => s.id).join(', ')}`,
            }
          : null,
      ),
    );
  }
  {
    const end = cashEnd(r);
    let expected = 0;
    for (let row = CASH.firstRow; row < end; row++)
      if (!r.isBlank(CASH.sheet, `A${row}`)) expected++;
    out.push(countCheck('cash-accounts', 'Cash accounts', expected, db.cashAccounts.length));
    // D58: one balance entry per account.
    out.push(
      countCheck(
        'cash-balance-entries',
        'Cash balance entries',
        expected,
        db.cashBalanceEntries.length,
      ),
    );
  }
  {
    const end = budgetEnd(r);
    let expected = 0;
    for (let row = BUDGET.firstRow; row <= end; row++)
      if (!r.isBlank(BUDGET.sheet, `A${row}`)) expected++;
    out.push(countCheck('budget-items', 'Budget items', expected, db.budgetItems.length));
    let yearly = 0;
    for (let row = BUDGET.yearlyFrom; row <= BUDGET.yearlyTo; row++) {
      if (!r.isBlank(BUDGET.sheet, `E${row}`) && r.number(BUDGET.sheet, `F${row}`) !== null)
        yearly++;
    }
    out.push(countCheck('yearly-expenses', 'Yearly expenses', yearly, db.yearlyExpenses.length));
  }
  out.push(countCheck('income-streams', 'Income streams', 2, db.incomeStreams.length));
  {
    // D57: one deposit per non-zero numeric G/H cell of a row dated in F.
    let expected = 0;
    for (let row = SIDE_INCOME.firstRow; row <= SIDE_INCOME.lastRow; row++) {
      if (r.date(SIDE_INCOME.sheet, `F${row}`) === null) continue;
      for (const col of ['G', 'H']) {
        const n = r.number(SIDE_INCOME.sheet, `${col}${row}`);
        if (n !== null && centsFromNumber(n) !== 0) expected++;
      }
    }
    out.push(countCheck('side-income', 'Side income deposits', expected, db.sideIncome.length));
  }
  for (const kind of ['spend', 'super_option', 'side_income'] as const) {
    out.push(
      countCheck(
        `period-notes.${kind}`,
        `Period notes: ${kind.replace('_', ' ')}`,
        countNotes(r, kind),
        db.periodNotes.filter((n) => n.kind === kind).length,
      ),
    );
  }
  out.push(
    countCheck(
      'snapshots',
      'Snapshots',
      historyRows(r).filter((h) => h.frozen).length,
      db.snapshots.length,
    ),
  );
  {
    let expected = 0;
    for (let row = OTHER_ASSETS.firstRow; row <= OTHER_ASSETS.lastRow; row++)
      if (!r.isBlank(OTHER_ASSETS.sheet, `F${row}`)) expected++;
    out.push(countCheck('other-assets', 'Other assets', expected, db.otherAssets.length));
  }
  {
    let expected = 0;
    for (let row = SUPER.fundsFrom; row <= SUPER.fundsTo; row++)
      if (!r.isBlank(SUPER.sheet, `A${row}`)) expected++;
    out.push(countCheck('super-funds', 'Super funds', expected, db.superFunds.length));
    const entries = [SUPER.reportedGain, SUPER.voluntary].filter((a) => {
      const n = r.number(SUPER.sheet, a);
      return n !== null && n !== 0;
    }).length;
    out.push(countCheck('super-entries', 'Super entries', entries, db.superEntries.length));
  }
  {
    const slots = propertyColumns().filter((c) => propertySlotUsed(r, c));
    out.push(countCheck('properties', 'Properties', slots.length, db.properties.length));
    const nz = (s: string, a: string) => {
      const n = r.number(s, a);
      return n !== null && n !== 0;
    };
    let expectedLoans = slots.filter(
      (c) =>
        nz(PROPERTY.sheet, `${c}${PROPERTY.rows.startBalance}`) ||
        nz(PROPERTY.sheet, `${c}${PROPERTY.rows.currentBalance}`),
    ).length;
    if (r.has(LIABILITIES.sheet)) {
      const skipG = cgtSlotSkipped(r);
      for (const c of LIABILITIES.columns) {
        if (c === LIABILITIES.cgtColumn && skipG) continue;
        if (
          nz(LIABILITIES.sheet, `${c}${LIABILITIES.rows.startBalance}`) ||
          nz(LIABILITIES.sheet, `${c}${LIABILITIES.rows.currentBalance}`)
        )
          expectedLoans++;
      }
    }
    if (
      nz(NET_WORTH.sheet, `C${NET_WORTH.spareRow}`) ||
      nz(NET_WORTH.sheet, `E${NET_WORTH.spareRow}`)
    )
      expectedLoans++;
    out.push(countCheck('loans', 'Loans', expectedLoans, db.loans.length));
  }
  {
    const expected = model.settings.filter((p) => p.status === 'value').length;
    const provided = new Set<string>(
      model.settings.filter((p) => p.status === 'value').map((p) => p.key),
    );
    const actual = db.settings.filter((s) => provided.has(s.key)).length;
    out.push(countCheck('settings', 'Settings', expected, actual));
  }
  return out;
}

// ─── Holdings ───────────────────────────────────────────────────────────────────────────────────

interface HoldingValues {
  checks: Check[];
  /** App-side tab values (cents) per kind, and their sum of explained diffs. */
  valueByKind: Map<InstrumentKind, number>;
  explainedDiff: number;
  valueCells: number;
  /** Retirement-tagged holdings (Super auto lines), app side. */
  retirementCents: number;
}

function heldCorrectionRecompute(rows: LedgerRow[]): Dec {
  let total = new JoinrDecimal(0);
  for (const l of rows) total = total.plus(new JoinrDecimal((l.original ?? l).units));
  return total;
}

function holdingChecks({ r, model, db, written }: Ctx): HoldingValues {
  const out: Check[] = [];
  const valueByKind = new Map<InstrumentKind, number>();
  let explainedDiff = 0;
  let valueCells = 0;
  const excludedRefs = new Set(model.exclusions.map((e) => e.sheetRef));
  for (const kind of INSTRUMENT_KINDS) {
    const l = investmentLayout(kind);
    const watch = model.watch.filter((w) => w.kind === kind && !excludedRefs.has(w.sheetRef));
    // Units per watch row.
    for (const w of watch) {
      const inst = db.instruments.find((i) => i.kind === kind && i.symbol === w.symbol);
      if (!inst) continue;
      const tradesOf = db.trades.filter((t) => t.instrumentId === inst.id);
      const actual = tradesOf.reduce(
        (s, t) => s.plus(new JoinrDecimal(t.units)),
        new JoinrDecimal(0),
      );
      const actualStr = actual.isZero() ? '0' : actual.toFixed();
      const id = `holdings.units.${kind}.${w.symbol}`;
      const ref = sheetRef(l.sheet, `${l.watch.units}${w.row}`);
      const label = `Held units ${w.symbol}`;
      if (w.heldUnits === null) {
        const status = w.heldUnitsError ? 'explained' : actual.isZero() ? 'match' : 'unexplained';
        out.push(
          check({
            id,
            section: 'holdings',
            label,
            sheetRef: ref,
            unit: 'units',
            expected: null,
            actual: actualStr,
            status,
            reasonCode: w.heldUnitsError ? 'sheet_error_value' : null,
            reason: w.heldUnitsError ? 'The held-units cell is an error value' : null,
          }),
        );
        continue;
      }
      const expected = decimalFromNumber(w.heldUnits);
      const base = {
        id,
        section: 'holdings' as const,
        label,
        sheetRef: ref,
        unit: 'units' as const,
        expected,
        actual: actualStr,
        diff: decimalDiff(expected, actualStr),
      };
      if (withinDecimal(expected, actualStr, UNITS_TOLERANCE)) {
        out.push(check({ ...base, status: 'match' }));
        continue;
      }
      const rows = model.ledger.filter((x) => x.kind === kind && x.symbol === w.symbol);
      const corrected = rows.filter((x) => x.correctionId !== null);
      if (
        corrected.length > 0 &&
        withinDecimal(expected, heldCorrectionRecompute(rows).toFixed(), UNITS_TOLERANCE)
      ) {
        out.push(
          check({
            ...base,
            status: 'explained',
            reasonCode: 'correction',
            reason: `Corrected by ${corrected.map((x) => x.correctionId).join(', ')}`,
            refs: { correctionId: corrected.map((x) => x.correctionId).join(',') },
          }),
        );
      } else {
        out.push(check({ ...base, status: 'unexplained' }));
      }
    }
    // Tab value.
    const nonRetirement = watch.filter((w) => kind === 'crypto' || !w.isRetirement);
    const priced = nonRetirement.filter(
      (w) => w.price.kind === 'number' && w.price.value !== null && w.heldUnits !== null,
    );
    const actual = sumProducts(priced.map((w) => [w.heldUnits!, w.price.value!]));
    valueByKind.set(kind, actual);
    valueCells += priced.length;
    const expectedValue = r.number(l.sheet, l.totals.value);
    const erroredHeld = nonRetirement.filter(
      (w) => (w.heldUnits ?? 0) > 0 && w.price.kind !== 'number',
    );
    const valueCheck = money(
      {
        id: `holdings.value.${kind}`,
        section: 'holdings',
        label: `${KIND_LABEL[kind]} value`,
        sheetRef: sheetRef(l.sheet, l.totals.value),
      },
      cents(expectedValue),
      actual,
      Math.max(1, priced.length),
      () =>
        // The template's IFERROR collapses the whole tab total to 0 when a row errors; only then
        // is the difference explained.
        erroredHeld.length > 0 && Math.abs(cents(expectedValue)) <= centsTolerance(1)
          ? {
              status: 'explained',
              reasonCode: 'sheet_error_value',
              reason: `${erroredHeld.length} held row(s) have an error or placeholder price, which zeroes the sheet total; the app prices each instrument on its own`,
            }
          : { status: 'unexplained' },
    );
    if (valueCheck.status === 'explained') explainedDiff += Number(valueCheck.diff);
    out.push(valueCheck);
    // Gain: Stage 2.
    const gain = r.number(l.sheet, l.totals.gain);
    out.push(
      info(
        `holdings.gain.${kind}`,
        'holdings',
        `${KIND_LABEL[kind]} gain`,
        'derived_later_stage',
        'Gains need the Stage 2 cost-base engine',
        {
          sheetRef: sheetRef(l.sheet, l.totals.gain),
          unit: 'cents',
          expected: gain === null ? null : cents(gain),
        },
      ),
    );
    // Prices of held rows.
    for (const w of watch) {
      if ((w.heldUnits ?? 0) <= 0) continue;
      out.push(
        priceCheck(
          kind,
          w.symbol,
          w.price,
          written.priceTreatment.get(instrumentKey(kind, w.symbol)),
          db,
        ),
      );
    }
  }
  // Retirement-tagged holdings (Super auto lines, app side).
  let retirementCents = 0;
  for (const w of model.watch) {
    if (w.kind === 'crypto' || !w.isRetirement || excludedRefs.has(w.sheetRef)) continue;
    if (w.price.kind === 'number' && w.price.value !== null && w.heldUnits !== null) {
      retirementCents += sumProducts([[w.heldUnits, w.price.value]]);
    }
  }
  return { checks: out, valueByKind, explainedDiff, valueCells, retirementCents };
}

function sumProducts(pairs: [number, number][]): number {
  let total = new JoinrDecimal(0);
  for (const [a, b] of pairs) total = total.plus(new JoinrDecimal(a).times(new JoinrDecimal(b)));
  return decimalToCents(total);
}

function priceCheck(
  kind: InstrumentKind,
  symbol: string,
  p: WorkbookModel['watch'][number]['price'],
  treatment: PriceTreatment | undefined,
  db: Db,
): Check {
  const base = {
    id: `holdings.price.${kind}.${symbol}`,
    section: 'holdings' as const,
    label: `Price ${symbol}`,
    sheetRef: p.sheetRef,
    unit: 'units' as const,
  };
  if (p.kind !== 'number' || p.value === null) {
    return check({
      ...base,
      expected: p.raw,
      status: 'explained',
      reasonCode: 'sheet_error_value',
      reason: 'The sheet has no usable price here; the price service prices this instrument',
    });
  }
  const expected = decimalFromNumber(p.value);
  if (p.crossTab !== null) {
    return check({
      ...base,
      expected,
      status: 'explained',
      reasonCode: 'feed_row',
      reason: `The price is read from the ${p.crossTab} tab; ignored — the price service prices this instrument`,
    });
  }
  const inst = db.instruments.find((i) => i.kind === kind && i.symbol === symbol);
  // The actual side is always read back from the database (never from the workbook value).
  const stored = db.prices.find((x) => x.instrumentId === inst?.id);
  const source = db.priceSources.find((x) => x.instrumentId === inst?.id);
  const tol = new JoinrDecimal('1e-12');
  switch (treatment?.mode) {
    case 'seeded':
    case 'manual': {
      const actual =
        treatment.mode === 'seeded' ? (stored?.price ?? null) : (source?.manualPrice ?? null);
      if (actual === null) {
        return check({
          ...base,
          expected,
          status: 'unexplained',
          reason: 'The price was not stored',
        });
      }
      const ok = withinDecimal(expected, actual, tol);
      return check({
        ...base,
        expected,
        actual,
        diff: decimalDiff(expected, actual),
        status: ok ? 'match' : 'unexplained',
        reason:
          treatment.mode === 'seeded'
            ? 'Seeded as the workbook price'
            : 'A typed price: imported as a manual price',
      });
    }
    case 'kept':
    case 'manual_user': {
      const actual =
        treatment.mode === 'kept' ? (stored?.price ?? null) : (source?.manualPrice ?? null);
      if (actual === null) {
        return check({
          ...base,
          expected,
          status: 'info',
          reason: 'No price is stored yet; the price service will fetch it',
        });
      }
      if (withinDecimal(expected, actual, tol)) {
        return check({
          ...base,
          expected,
          actual,
          diff: decimalDiff(expected, actual),
          status: 'match',
          reason:
            treatment.mode === 'kept'
              ? `A ${stored?.source ?? 'stored'} price already exists and is kept; it equals the workbook price`
              : 'A typed price; the manual price entered in the app is kept and equals it',
        });
      }
      return check({
        ...base,
        expected,
        actual,
        diff: decimalDiff(expected, actual),
        status: 'info',
        reason:
          treatment.mode === 'kept'
            ? `The ${stored?.source ?? 'stored'} price already stored is kept; the workbook price is not used`
            : 'Your manual price is kept; the workbook price is not used',
      });
    }
    default:
      return check({
        ...base,
        expected,
        status: 'unexplained',
        reason: 'The price was not stored',
      });
  }
}

// ─── Ledgers and movements ──────────────────────────────────────────────────────────────────────

function sheetLedgerSum(
  r: SheetReader,
  kind: InstrumentKind,
  col: string | null,
): { cents: number; n: number } {
  if (col === null) return { cents: 0, n: 0 };
  const l = investmentLayout(kind);
  const values: number[] = [];
  const last = r.lastRow(l.sheet);
  for (let row = l.ledgerHeader + 1; row <= last; row++) {
    if (r.isBlank(l.sheet, `A${row}`)) continue;
    const n = r.number(l.sheet, `${col}${row}`);
    if (n !== null) values.push(n);
  }
  return { cents: sumToCents(values), n: values.length };
}

interface TradeLike {
  units: string;
  price: string;
  feeCents: number;
  feeRate: string | null;
}

function feeCents(rows: readonly TradeLike[]): number {
  let fixed = 0;
  let rated = new JoinrDecimal(0);
  for (const t of rows) {
    if (t.feeRate === null) fixed += t.feeCents;
    else rated = rated.plus(new JoinrDecimal(t.feeRate).times(t.units).times(t.price).abs());
  }
  return fixed + decimalToCents(rated);
}

const orderCents = (rows: readonly { units: string; price: string }[]): number =>
  rows.reduce((s, t) => s + multiplyToCents(t.units, t.price), 0);

/** Ledger rows as read (before corrections), including skipped ones. */
const uncorrected = (rows: readonly LedgerRow[]): TradeLike[] =>
  rows.map((l) => {
    const v = l.original ?? l;
    return { units: v.units, price: v.price, feeCents: v.feeCents, feeRate: v.feeRate };
  });

function ledgerChecks({ r, model, db }: Ctx): Check[] {
  const out: Check[] = [];
  for (const kind of INSTRUMENT_KINDS) {
    const l = investmentLayout(kind);
    const rows = db.trades.filter((t) => t.kind === kind);
    const modelRows = model.ledger.filter((x) => x.kind === kind);
    const corrected = modelRows.filter((x) => x.correctionId !== null);
    const explain = (expected: number, recompute: () => number, n: number) => () =>
      corrected.length > 0 && withinCents(expected, recompute(), n)
        ? {
            status: 'explained' as const,
            reasonCode: 'correction' as const,
            reason: `Corrected by ${corrected.map((x) => x.correctionId).join(', ')}`,
            refs: { correctionId: corrected.map((x) => x.correctionId).join(',') },
          }
        : { status: 'unexplained' as const };
    const ov = sheetLedgerSum(r, kind, l.ledger.orderValue);
    const nOv = Math.max(ov.n, rows.length, 1);
    out.push(
      money(
        {
          id: `ledgers.orderValue.${kind}`,
          section: 'ledgers',
          label: `${KIND_LABEL[kind]} order values`,
          sheetRef: sheetRef(l.sheet, `${l.ledger.orderValue}${l.ledgerHeader}`),
        },
        ov.cents,
        orderCents(rows),
        nOv,
        explain(ov.cents, () => orderCents(uncorrected(modelRows)), nOv),
      ),
    );
    const fees = sheetLedgerSum(r, kind, l.ledger.fee);
    const nFees = Math.max(fees.n, rows.length, 1);
    out.push(
      money(
        {
          id: `ledgers.fees.${kind}`,
          section: 'ledgers',
          label: `${KIND_LABEL[kind]} fees`,
          sheetRef:
            l.ledger.fee === null ? null : sheetRef(l.sheet, `${l.ledger.fee}${l.ledgerHeader}`),
        },
        fees.cents,
        feeCents(
          rows.map((t) => ({
            units: t.units,
            price: t.price,
            feeCents: t.feeCents,
            feeRate: t.feeRate,
          })),
        ),
        nFees,
        explain(fees.cents, () => feeCents(uncorrected(modelRows)), nFees),
      ),
    );
  }
  return out;
}

function movementChecks({ model, db }: Ctx): Check[] {
  const out: Check[] = [];
  const snaps = [...model.snapshots].sort((a, b) =>
    a.runDate < b.runDate ? -1 : a.runDate > b.runDate ? 1 : 0,
  );
  const retirement = new Set(
    db.instruments.filter((i) => i.isRetirement).map((i) => instrumentKey(i.kind, i.symbol)),
  );
  snaps.forEach((s, i) => {
    const from = i === 0 ? addMonthsIso(s.runDate, -1) : snaps[i - 1]!.runDate;
    const to = s.runDate;
    for (const kind of INSTRUMENT_KINDS) {
      const { column, label } = MOVEMENT_COLUMNS[kind];
      const expected = cents(s.raw[column] ?? null);
      const inWindow = db.trades.filter(
        (t) => t.kind === kind && !t.retirement && t.tradeDate > from && t.tradeDate <= to,
      );
      const actual = orderCents(inWindow);
      const n = Math.max(1, inWindow.length);
      out.push(
        money(
          {
            id: `movements.${s.periodMonth}.${label}`,
            section: 'movements',
            label: `${KIND_LABEL[kind]} movements ${monthLabel(s.periodMonth)}`,
            sheetRef: sheetRef(HISTORY.sheet, `${column}${s.row}`),
          },
          expected,
          actual,
          n,
          () => {
            const corrected = model.ledger.filter(
              (l) => l.kind === kind && l.correctionId !== null,
            );
            if (corrected.length > 0) {
              const original = model.ledger
                .filter((l) => l.kind === kind && !retirement.has(instrumentKey(l.kind, l.symbol)))
                .map((l) => l.original ?? l)
                .filter((v) => v.date > from && v.date <= to);
              if (withinCents(expected, orderCents(original), Math.max(1, original.length))) {
                return {
                  status: 'explained',
                  reasonCode: 'correction',
                  reason: `A corrected trade moved across snapshot windows (${corrected.map((l) => l.correctionId).join(', ')})`,
                  refs: { correctionId: corrected.map((l) => l.correctionId).join(',') },
                };
              }
            }
            if (i === 0)
              return {
                status: 'explained',
                reasonCode: 'first_snapshot_window',
                reason: 'The first snapshot window starts one month before the first run',
              };
            return { status: 'unexplained' };
          },
        ),
      );
    }
  });
  return out;
}

// ─── Dividends ──────────────────────────────────────────────────────────────────────────────────

function dividendChecks({ r, model, db }: Ctx): Check[] {
  const out: Check[] = [];
  const corrected = model.dividends.filter((d) => d.correctionId !== null);
  for (const row of DIVIDENDS.fyRows) {
    const label = r.text(DIVIDENDS.sheet, `K${row}`);
    const m = label === null ? null : /^(\d{4})\s*-\s*(\d{4})$/.exec(label);
    if (!m) continue;
    const y = Number(m[1]);
    const from = `${y}-07-01`;
    const to = `${y + 1}-07-01`;
    for (const kind of INSTRUMENT_KINDS) {
      const col = DIVIDENDS.fyColumns[kind];
      const expected = cents(r.number(DIVIDENDS.sheet, `${col}${row}`));
      const rows = db.dividends.filter(
        (d) => d.holdingKind === kind && d.paymentDate >= from && d.paymentDate < to,
      );
      const actual = rows.reduce((s, d) => s + d.netAmountCents, 0);
      const n = Math.max(1, rows.length);
      out.push(
        money(
          {
            id: `dividends.fy.${y}-${y + 1}.${kind}`,
            section: 'dividends',
            label: `${KIND_LABEL[kind]} dividends FY ${y}-${y + 1}`,
            sheetRef: sheetRef(DIVIDENDS.sheet, `${col}${row}`),
          },
          expected,
          actual,
          n,
          () => {
            if (corrected.length > 0) {
              const original = model.dividends
                .filter((d) => d.holdingKind === kind)
                .map((d) => d.original ?? d)
                .filter((d) => d.paymentDate >= from && d.paymentDate < to);
              const sum = original.reduce((s, d) => s + d.netAmountCents, 0);
              if (withinCents(expected, sum, n)) {
                return {
                  status: 'explained',
                  reasonCode: 'correction',
                  reason: `Corrected by ${corrected.map((d) => d.correctionId).join(', ')}`,
                };
              }
            }
            return { status: 'unexplained' };
          },
        ),
      );
    }
  }
  const instById = new Map(db.instruments.map((i) => [i.id, i]));
  for (const d of db.dividends) {
    const row = d.sheetRef ?? '';
    const linked = d.instrumentId === null ? null : (instById.get(d.instrumentId)?.symbol ?? null);
    const m = model.dividends.find((x) => x.sheetRef === d.sheetRef);
    const base = {
      id: `dividends.link.${row.replace(/^.*![A-Z]+/, '')}`,
      section: 'dividends' as const,
      label: `Dividend ${row} instrument`,
      sheetRef: d.sheetRef,
      unit: 'text' as const,
      expected: d.ticker,
      actual: linked,
      refs: { entity: 'dividends' as const, recordId: d.id },
    };
    if (linked === null) {
      out.push(
        check({
          ...base,
          status: 'suspect',
          reasonCode: 'unmatched_dividend',
          reason: 'No instrument of this holding type matches the ticker',
          refs: { ...base.refs, flags: ['unmatched_ticker'] },
        }),
      );
    } else if (m?.link?.how === 'rekeyed') {
      out.push(
        check({
          ...base,
          status: 'explained',
          reasonCode: 'dividend_rekeyed',
          reason: 'Linked by the ticker code without its exchange prefix',
          refs: { ...base.refs, decision: 'D28' },
        }),
      );
    } else {
      out.push(check({ ...base, status: 'match' }));
    }
  }
  return out;
}

// ─── Cash, income, budget ───────────────────────────────────────────────────────────────────────

function yearlyFundCents(annualCents: readonly number[]): number {
  const total = annualCents.reduce((s, c) => s + c, 0);
  const units = new JoinrDecimal(total).dividedBy(6000).toDecimalPlaces(0, JoinrDecimal.ROUND_UP);
  return units.times(500).toNumber();
}

function cashflowChecks({ r, model, db, written }: Ctx): Check[] {
  const out: Check[] = [];
  const end = cashEnd(r);
  const nonOffset = db.cashAccounts.filter((a) => !a.isOffset);
  out.push(
    money(
      {
        id: 'cash.total',
        section: 'cash',
        label: 'Cash total',
        sheetRef: sheetRef(CASH.sheet, `C${end}`),
      },
      cents(r.number(CASH.sheet, `C${end}`)),
      nonOffset.reduce((s, a) => s + a.balanceCents, 0),
      Math.max(1, nonOffset.length),
    ),
  );
  // D49: account kinds set in the app that no imported account could take over.
  const lost = written.kindsNotCarried;
  if (lost.length > 0) {
    const n = lost.length;
    out.push(
      info(
        'cash.kindsNotCarried',
        'cash',
        'Account kinds not carried over',
        null,
        `${n} account ${n === 1 ? 'kind' : 'kinds'} could not be carried over; set ${n === 1 ? 'it' : 'them'} again on the Cash page (${lost.join(', ')})`,
        { unit: 'count', expected: n, actual: 0, diff: -n, refs: { entity: 'cash-accounts' } },
      ),
    );
  }
  // Side income.
  const atAsOf = model.sideIncome.filter((d) => d.depositDate !== d.periodEnd).length;
  if (atAsOf > 0) {
    out.push(
      info(
        'income.datedAtAsOf',
        'income',
        'Side income dated at the workbook date',
        null,
        `${atAsOf} ${atAsOf === 1 ? 'deposit' : 'deposits'} of the current period ${atAsOf === 1 ? 'is' : 'are'} dated at the workbook's as-of date instead of the period end, which is later`,
        {
          sheetRef: sheetRef(NET_WORTH.sheet, NET_WORTH.asOf),
          unit: 'count',
          actual: atAsOf,
          refs: { entity: 'side-income' },
        },
      ),
    );
  }
  const streamIds = [...db.incomeStreams]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => s.id);
  let allCells = 0;
  (['G', 'H'] as const).forEach((col, i) => {
    const values: number[] = [];
    for (let row = SIDE_INCOME.firstRow; row <= SIDE_INCOME.lastRow; row++) {
      if (r.date(SIDE_INCOME.sheet, `F${row}`) === null) continue;
      const n = r.number(SIDE_INCOME.sheet, `${col}${row}`);
      if (n !== null) values.push(n);
    }
    allCells += values.length;
    const entries = db.sideIncome.filter((e) => e.streamId === streamIds[i]);
    out.push(
      money(
        {
          id: `income.stream.${i + 1}`,
          section: 'income',
          label: `Side income stream ${i + 1}`,
          sheetRef: sheetRef(SIDE_INCOME.sheet, `${col}1`),
        },
        sumToCents(values),
        entries.reduce((s, e) => s + e.amountCents, 0),
        Math.max(1, values.length),
      ),
    );
  });
  out.push(
    money(
      {
        id: 'income.total',
        section: 'income',
        label: 'Side income total',
        sheetRef: sheetRef(SIDE_INCOME.sheet, SIDE_INCOME.total),
      },
      cents(r.number(SIDE_INCOME.sheet, SIDE_INCOME.total)),
      db.sideIncome.reduce((s, e) => s + e.amountCents, 0),
      Math.max(1, allCells),
    ),
  );
  // Budget.
  const autoYearly = model.budgetItems.find((b) => b.kind === 'auto_yearly');
  const fund = yearlyFundCents(db.yearlyExpenses.map((y) => y.annualCents));
  if (autoYearly) {
    const addr = `C${autoYearly.row}`;
    out.push(
      money(
        {
          id: 'budget.yearlyFund',
          section: 'budget',
          label: 'Yearly expenses fund',
          sheetRef: sheetRef(BUDGET.sheet, addr),
        },
        cents(r.number(BUDGET.sheet, addr)),
        fund,
        1,
      ),
    );
  } else {
    out.push(
      info(
        'budget.yearlyFund',
        'budget',
        'Yearly expenses fund',
        null,
        'The budget has no "Yearly Expenses - Automatic" row',
        { unit: 'cents', actual: fund },
      ),
    );
  }
  const items = db.budgetItems.filter((b) => b.kind === 'item');
  const planned = items.reduce((s, b) => s + (b.monthlyCents ?? 0), 0) + (autoYearly ? fund : 0);
  const unnamed = model.checks
    .filter((c) => c.reasonCode === 'unnamed_row' && typeof c.expected === 'number')
    .reduce((s, c) => s + Number(c.expected), 0);
  const plannedExpected = cents(r.number(BUDGET.sheet, BUDGET.plannedSpend));
  out.push(
    money(
      {
        id: 'budget.plannedSpend',
        section: 'budget',
        label: 'Planned monthly spend',
        sheetRef: sheetRef(BUDGET.sheet, BUDGET.plannedSpend),
      },
      plannedExpected,
      planned,
      items.length + 1,
      () =>
        unnamed !== 0 && withinCents(plannedExpected, planned + unnamed, items.length + 1)
          ? {
              status: 'explained',
              reasonCode: 'unnamed_row',
              reason: 'Amounts on budget rows without a name are not imported',
            }
          : { status: 'unexplained' },
    ),
  );
  const accounts = new Map(db.cashAccounts.map((a) => [a.id, a.name]));
  for (const b of db.budgetItems) {
    if (b.accountName === null) continue;
    const row = (b.sheetRef ?? '').replace(/^.*![A-Z]+/, '');
    const linked = b.cashAccountId === null ? null : (accounts.get(b.cashAccountId) ?? null);
    const base = {
      id: `budget.account.${row}`,
      section: 'budget' as const,
      label: `Bank account for ${b.sheetRef}`,
      sheetRef: b.sheetRef,
      unit: 'text' as const,
      expected: b.accountName,
      actual: linked,
      refs: { entity: 'budget-items' as const, recordId: b.id },
    };
    out.push(
      linked === null
        ? check({
            ...base,
            status: 'suspect',
            reasonCode: 'unmatched_account',
            reason: 'No single cash account has this name',
            refs: { ...base.refs, flags: ['unmatched_account'] },
          })
        : check({ ...base, status: 'match' }),
    );
  }
  return out;
}

// ─── Other assets, super, property ──────────────────────────────────────────────────────────────

function otherAssetTotals(db: Db): { value: number; gain: number; nonAud: number; n: number } {
  // Template (spec 04 §1.3): M = IF(H>0, H-ABS(L), ""), N = IF(AND(J<>"",M>0), M*J, ""),
  // O = M*K, P = IF(AND(N<>"",O<>"",M>0), O-N, ""); D3 = SUM(O), D4 = SUM(P).
  let value = new JoinrDecimal(0);
  let gain = new JoinrDecimal(0);
  let nonAud = 0;
  for (const a of db.otherAssets) {
    if (a.currency !== 'AUD') {
      nonAud++;
      continue;
    }
    const units = new JoinrDecimal(a.units);
    if (units.lessThanOrEqualTo(0)) continue; // M is blank
    const remaining = units.minus(new JoinrDecimal(a.soldUnits).abs());
    const rowValue = remaining.times(new JoinrDecimal(a.unitPrice ?? '0'));
    value = value.plus(rowValue);
    if (a.unitCost !== null && remaining.greaterThan(0)) {
      gain = gain.plus(rowValue.minus(remaining.times(new JoinrDecimal(a.unitCost))));
    }
  }
  return {
    value: decimalToCents(value),
    gain: decimalToCents(gain),
    nonAud,
    n: db.otherAssets.length,
  };
}

function assetChecks({ r, db }: Ctx): Check[] {
  const out: Check[] = [];
  const oa = otherAssetTotals(db);
  const nonAud = (): Partial<Check> & { status: Check['status'] } => ({
    status: 'info',
    reason: `${oa.nonAud} non-AUD row(s): FX is not checked in Stage 1`,
  });
  const oaMismatch = oa.nonAud > 0 ? nonAud : () => ({ status: 'unexplained' as const });
  out.push(
    money(
      {
        id: 'otherAssets.value',
        section: 'other_assets',
        label: 'Other assets value',
        sheetRef: sheetRef(OTHER_ASSETS.sheet, 'D3'),
      },
      cents(r.number(OTHER_ASSETS.sheet, 'D3')),
      oa.value,
      Math.max(1, oa.n),
      oaMismatch,
    ),
  );
  out.push(
    money(
      {
        id: 'otherAssets.gain',
        section: 'other_assets',
        label: 'Other assets gain',
        sheetRef: sheetRef(OTHER_ASSETS.sheet, 'D4'),
      },
      cents(r.number(OTHER_ASSETS.sheet, 'D4')),
      oa.gain,
      Math.max(1, oa.n * 2),
      oaMismatch,
    ),
  );
  // Super.
  const auto = SUPER.autoLines.map((a) => r.number(SUPER.sheet, a) ?? 0);
  const totalCell = r.number(SUPER.sheet, SUPER.total) ?? 0;
  const expectedFunds = decimalToCents(
    auto.reduce((d, v) => d.minus(new JoinrDecimal(v)), new JoinrDecimal(totalCell)),
  );
  const funds = db.superFunds.reduce((s, f) => s + f.balanceCents, 0);
  out.push(
    money(
      {
        id: 'super.total',
        section: 'super',
        label: 'Super fund balances',
        sheetRef: sheetRef(SUPER.sheet, SUPER.total),
      },
      expectedFunds,
      funds,
      Math.max(1, db.superFunds.length + auto.length),
    ),
  );
  const entries = (kind: string) =>
    db.superEntries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amountCents, 0);
  out.push(
    money(
      {
        id: 'super.contribution',
        section: 'super',
        label: 'Voluntary super contributions',
        sheetRef: sheetRef(SUPER.sheet, SUPER.voluntary),
      },
      cents(r.number(SUPER.sheet, SUPER.voluntary)),
      entries('voluntary_contribution'),
      1,
    ),
  );
  out.push(
    money(
      {
        id: 'super.gain',
        section: 'super',
        label: 'Reported super gain',
        sheetRef: sheetRef(SUPER.sheet, SUPER.reportedGain),
      },
      cents(r.number(SUPER.sheet, SUPER.reportedGain)),
      entries('reported_gain'),
      1,
    ),
  );
  if (auto.some((v) => v !== 0)) {
    out.push(
      info(
        'super.autoLines',
        'super',
        'Retirement-tagged holdings',
        null,
        'Super includes holdings tagged Retirement (Stocks/ETFs/Managed Funds); they stay instruments',
        { sheetRef: sheetRef(SUPER.sheet, 'B8'), unit: 'cents', expected: sumToCents(auto) },
      ),
    );
  }
  // Property.
  const t = PROPERTY.totals;
  const propertyLoans = db.loans.filter((l) => l.propertyId !== null);
  out.push(
    money(
      {
        id: 'property.purchase',
        section: 'property',
        label: 'Property purchase values',
        sheetRef: sheetRef(PROPERTY.sheet, t.purchase),
      },
      cents(r.number(PROPERTY.sheet, t.purchase)),
      db.properties.reduce((s, p) => s + p.purchaseValueCents, 0),
      Math.max(1, db.properties.length),
    ),
  );
  out.push(
    money(
      {
        id: 'property.value',
        section: 'property',
        label: 'Property current values',
        sheetRef: sheetRef(PROPERTY.sheet, t.value),
      },
      cents(r.number(PROPERTY.sheet, t.value)),
      db.properties.reduce((s, p) => s + p.currentValueCents, 0),
      Math.max(1, db.properties.length),
    ),
  );
  out.push(
    money(
      {
        id: 'property.mortgage',
        section: 'property',
        label: 'Mortgage balances',
        sheetRef: sheetRef(PROPERTY.sheet, t.mortgage),
      },
      Math.abs(cents(r.number(PROPERTY.sheet, t.mortgage))),
      propertyLoans.reduce((s, l) => s + l.currentBalanceCents, 0),
      Math.max(1, propertyLoans.length),
    ),
  );
  out.push(
    money(
      {
        id: 'property.paid',
        section: 'property',
        label: 'Mortgage payments paid',
        sheetRef: sheetRef(PROPERTY.sheet, t.paid),
      },
      cents(r.number(PROPERTY.sheet, t.paid)),
      propertyLoans.reduce((s, l) => s + (l.paymentsPaidCents ?? 0), 0),
      Math.max(1, propertyLoans.length),
    ),
  );
  return out;
}

// ─── Snapshots ──────────────────────────────────────────────────────────────────────────────────

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const rowOf = (ref: string | null): number => Number((ref ?? '').replace(/^.*![A-Z]+/, ''));

function snapshotChecks({ r, db }: Ctx): Check[] {
  const out: Check[] = [];
  const frozen = historyRows(r).filter((h) => h.frozen);
  const unordered = frozen
    .filter((h, i) => i > 0 && h.date <= frozen[i - 1]!.date)
    .map((h) => h.row);
  out.push(
    check({
      id: 'snapshots.order',
      section: 'snapshots',
      label: 'Snapshot dates in order',
      sheetRef: sheetRef(HISTORY.sheet, 'A3'),
      unit: 'count',
      expected: frozen.length,
      actual: frozen.length - unordered.length,
      status: unordered.length === 0 ? 'match' : 'unexplained',
      reason:
        unordered.length === 0
          ? null
          : `History rows ${unordered.join(', ')} are not after the row above`,
    }),
  );
  const byMonth = new Map<string, number[]>();
  for (const h of frozen)
    byMonth.set(h.date.slice(0, 7), [...(byMonth.get(h.date.slice(0, 7)) ?? []), h.row]);
  for (const [period, rows] of byMonth) {
    const stored = db.snapshots.find((s) => s.periodMonth === period);
    out.push(
      check({
        id: `snapshots.period.${period}`,
        section: 'snapshots',
        label: `Snapshot ${monthLabel(period)}`,
        sheetRef: sheetRef(HISTORY.sheet, `A${rows.at(-1)!}`),
        unit: 'date',
        expected: frozen.find((h) => h.row === rows.at(-1))?.date ?? null,
        actual: stored?.runDate ?? null,
        status: rows.length === 1 && stored ? 'match' : 'unexplained',
        reason:
          rows.length === 1
            ? stored
              ? null
              : 'Not stored'
            : `History rows ${rows.join(', ')} are in the same month; the later run date was kept`,
      }),
    );
  }
  for (const s of db.snapshots) {
    const row = rowOf(s.sheetRef);
    const failing: string[] = [];
    const record = s as unknown as Record<string, number | string | null>;
    for (const c of SNAPSHOT_VALUE_COLUMNS) {
      const sheet = r.number(HISTORY.sheet, `${c.historyColumn}${row}`);
      const stored = record[snakeToCamel(c.dbColumn)] ?? null;
      let ok: boolean;
      if (sheet === null || stored === null) ok = sheet === null && stored === null;
      else if (c.type === 'money') ok = Math.abs(Number(stored) - centsFromNumber(sheet)) <= 1;
      else ok = withinDecimal(decimalFromNumber(sheet), String(stored), RATIO_TOLERANCE);
      if (!ok) failing.push(c.historyColumn);
    }
    out.push(
      check({
        id: `snapshots.values.${s.periodMonth}`,
        section: 'snapshots',
        label: `Snapshot ${monthLabel(s.periodMonth)} values`,
        sheetRef: s.sheetRef,
        unit: 'count',
        expected: SNAPSHOT_VALUE_COLUMNS.length,
        actual: SNAPSHOT_VALUE_COLUMNS.length - failing.length,
        diff: failing.length === 0 ? 0 : -failing.length,
        status: failing.length === 0 ? 'match' : 'unexplained',
        reason: failing.length === 0 ? null : `Columns ${failing.join(', ')} differ`,
        refs: { entity: 'snapshots', recordId: s.id },
      }),
    );
  }
  return out;
}

// ─── Net worth ──────────────────────────────────────────────────────────────────────────────────

function netWorthChecks(c: Ctx, holdings: HoldingValues): Check[] {
  const { r, db } = c;
  const out: Check[] = [];
  const s = NET_WORTH.sheet;
  // Rolling rows for frozen snapshots.
  const kRows = new Map<string, number>();
  for (let row = NET_WORTH.rollingFrom; row <= NET_WORTH.rollingTo; row++) {
    const d = r.date(s, `K${row}`);
    if (d === null) {
      if (r.isBlank(s, `K${row}`) && row > NET_WORTH.rollingFrom + 1 && kRows.size > 0) break;
      continue;
    }
    if (!kRows.has(d)) kRows.set(d, row);
  }
  for (const snap of [...db.snapshots].sort((a, b) => (a.runDate < b.runDate ? -1 : 1))) {
    const row = kRows.get(snap.runDate);
    if (row === undefined) {
      out.push(
        info(
          `netWorth.rolling.${snap.periodMonth}`,
          'net_worth',
          `Rolling net worth ${monthLabel(snap.periodMonth)}`,
          null,
          'No Net Worth rolling row for this snapshot date',
        ),
      );
      continue;
    }
    const v = (x: number | null) => x ?? 0;
    const assets =
      v(snap.stocksValueCents) +
      v(snap.etfValueCents) +
      v(snap.cryptoValueCents) +
      v(snap.cashValueCents) +
      v(snap.mfValueCents) +
      v(snap.otherValueCents);
    const total =
      assets +
      v(snap.superValueCents) -
      Math.abs(v(snap.liabilitiesBalanceCents)) -
      Math.abs(v(snap.mortgageBalanceCents)) +
      v(snap.propertyValueCents);
    out.push(
      money(
        {
          id: `netWorth.rolling.${snap.periodMonth}.assets`,
          section: 'net_worth',
          label: `Rolling assets ${monthLabel(snap.periodMonth)}`,
          sheetRef: sheetRef(s, `L${row}`),
        },
        cents(r.number(s, `L${row}`)),
        assets,
        6,
      ),
    );
    out.push(
      money(
        {
          id: `netWorth.rolling.${snap.periodMonth}.total`,
          section: 'net_worth',
          label: `Rolling net worth ${monthLabel(snap.periodMonth)}`,
          sheetRef: sheetRef(s, `P${row}`),
        },
        cents(r.number(s, `P${row}`)),
        total,
        10,
      ),
    );
  }
  // Headline lines.
  const cash = db.cashAccounts.filter((a) => !a.isOffset).reduce((x, a) => x + a.balanceCents, 0);
  const oa = otherAssetTotals(db);
  const nonAudSheet = db.otherAssets
    .filter((a) => a.currency !== 'AUD')
    .reduce((x, a) => x + cents(r.number(OTHER_ASSETS.sheet, `O${rowOf(a.sheetRef)}`)), 0);
  const other = oa.value + nonAudSheet;
  const superApp = db.superFunds.reduce((x, f) => x + f.balanceCents, 0) + holdings.retirementCents;
  const property = db.properties.reduce((x, p) => x + p.currentValueCents, 0);
  const a = NET_WORTH.assets;
  out.push(
    money(
      {
        id: 'netWorth.cash',
        section: 'net_worth',
        label: 'Net worth: cash',
        sheetRef: sheetRef(s, a.cash),
      },
      cents(r.number(s, a.cash)),
      cash,
      Math.max(1, db.cashAccounts.length),
    ),
  );
  out.push(
    money(
      {
        id: 'netWorth.super',
        section: 'net_worth',
        label: 'Net worth: super',
        sheetRef: sheetRef(s, a.super),
      },
      cents(r.number(s, a.super)),
      superApp,
      Math.max(1, db.superFunds.length + 3),
    ),
  );
  out.push(
    money(
      {
        id: 'netWorth.property',
        section: 'net_worth',
        label: 'Net worth: property',
        sheetRef: sheetRef(s, a.property),
      },
      cents(r.number(s, a.property)),
      property,
      Math.max(1, db.properties.length),
    ),
  );
  out.push(
    money(
      {
        id: 'netWorth.otherAssets',
        section: 'net_worth',
        label: 'Net worth: other assets',
        sheetRef: sheetRef(s, a.other),
      },
      cents(r.number(s, a.other)),
      other,
      Math.max(1, oa.n),
      () =>
        oa.nonAud > 0
          ? {
              status: 'info',
              reason:
                'Non-AUD rows use the workbook’s own FX conversion; FX is not checked in Stage 1',
            }
          : { status: 'unexplained' },
    ),
  );
  // Liabilities (D2: the skipped CGT slot is added back to the sheet side).
  const cgt =
    r.has(LIABILITIES.sheet) && cgtSlotSkipped(r)
      ? cents(
          r.number(LIABILITIES.sheet, `${LIABILITIES.cgtColumn}${LIABILITIES.rows.currentBalance}`),
        )
      : 0;
  if (cgt !== 0) {
    const ref = sheetRef(
      LIABILITIES.sheet,
      `${LIABILITIES.cgtColumn}${LIABILITIES.rows.currentBalance}`,
    );
    out.push(
      check({
        id: 'liabilities.cgtSlot',
        section: 'net_worth',
        label: 'Capital gains future tax (liabilities slot)',
        sheetRef: ref,
        unit: 'cents',
        expected: cgt,
        status: 'explained',
        reasonCode: 'feature_dropped',
        reason:
          'The Capital Gains tab is not rebuilt; this estimate is not a loan and is left out of liabilities',
        refs: { decision: 'D2' },
      }),
    );
  }
  const loansTotal = db.loans.reduce((x, l) => x + l.currentBalanceCents, 0);
  out.push(
    money(
      {
        id: 'netWorth.liabilities',
        section: 'net_worth',
        label: 'Net worth: liabilities',
        sheetRef: sheetRef(s, NET_WORTH.liabilities),
      },
      cents(r.number(s, NET_WORTH.liabilities)) + Math.abs(cgt),
      -loansTotal,
      Math.max(1, db.loans.length),
    ),
  );
  // Totals.
  const holdingsValue = [...holdings.valueByKind.values()].reduce((x, v) => x + v, 0);
  const totalAssets = holdingsValue + cash + other + superApp + property;
  const n =
    holdings.valueCells +
    db.cashAccounts.length +
    oa.n +
    db.superFunds.length +
    db.properties.length +
    3;
  const explainTotals = (expected: number, actual: number) => () => {
    const diff = actual - expected;
    return holdings.explainedDiff !== 0 &&
      Math.abs(diff - holdings.explainedDiff) <= centsTolerance(n)
      ? {
          status: 'explained' as const,
          reasonCode: 'sheet_error_value' as const,
          reason: 'The difference is the holdings value the sheet lost to error prices',
        }
      : oa.nonAud > 0
        ? { status: 'info' as const, reason: 'Non-AUD other assets: FX is not checked in Stage 1' }
        : { status: 'unexplained' as const };
  };
  const c12 = cents(r.number(s, NET_WORTH.totalAssets));
  out.push(
    money(
      {
        id: 'netWorth.totalAssets',
        section: 'net_worth',
        label: 'Total assets',
        sheetRef: sheetRef(s, NET_WORTH.totalAssets),
      },
      c12,
      totalAssets,
      n,
      explainTotals(c12, totalAssets),
    ),
  );
  const d15 = cents(r.number(s, NET_WORTH.total)) + Math.abs(cgt);
  const total = totalAssets - loansTotal;
  out.push(
    money(
      {
        id: 'netWorth.total',
        section: 'net_worth',
        label: 'Net worth',
        sheetRef: sheetRef(s, NET_WORTH.total),
      },
      d15,
      total,
      n + db.loans.length,
      explainTotals(d15, total),
    ),
  );
  const gainLabels = [
    'ETFs',
    'Stocks',
    'Managed funds',
    'Crypto',
    'Cash',
    'Other assets',
    'Super',
    'Property',
  ];
  const gainIds = [
    'etf',
    'stock',
    'managed_fund',
    'crypto',
    'cash',
    'otherAssets',
    'super',
    'property',
  ];
  NET_WORTH.gains.forEach((addr, i) => {
    const g = r.number(s, addr);
    out.push(
      info(
        `netWorth.gain.${gainIds[i]}`,
        'net_worth',
        `Net worth gain: ${gainLabels[i]}`,
        'derived_later_stage',
        'Gains are rebuilt in later stages',
        { sheetRef: sheetRef(s, addr), unit: 'cents', expected: g === null ? null : cents(g) },
      ),
    );
  });
  return out;
}

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────

function settingUnit(def: SettingDef): Check['unit'] {
  switch (def.type) {
    case 'money':
      return 'cents';
    case 'ratio':
      return 'ratio';
    case 'integer':
      return 'count';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

const display = (v: SettingValue | null): string | number | null =>
  v === null ? null : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;

function settingsChecks({ r, model, db }: Ctx): Check[] {
  const out: Check[] = [];
  const idRows = sheetOptionRows(r);
  const stored = new Map(db.settings.map((s) => [s.key, s]));
  const defsById = new Map<number, SettingDef>();
  for (const def of SETTINGS)
    if (def.source !== null && 'id' in def.source) defsById.set(def.source.id, def);
  const planFor = (key: string) => model.settings.find((p) => p.key === key);

  const valueCheck = (def: SettingDef, id: string, label: string, ref: string | null): Check => {
    const plan = planFor(def.key)!;
    const unit = settingUnit(def);
    const base = { id, section: 'settings' as const, label, sheetRef: plan.sheetRef ?? ref, unit };
    switch (plan.status) {
      case 'value': {
        const row = stored.get(def.key);
        const actual = row ? (JSON.parse(row.valueJson) as SettingValue) : null;
        const expected =
          def.type === 'enum' || def.type === 'boolean' ? plan.sheetValue : display(plan.value);
        const ok = actual !== null && JSON.stringify(actual) === JSON.stringify(plan.value);
        return check({
          ...base,
          expected,
          actual: display(actual),
          status: ok ? 'match' : 'unexplained',
          reason: ok ? null : 'The stored value differs from the workbook',
        });
      }
      case 'formula_default':
        return check({
          ...base,
          status: 'info',
          reasonCode: 'formula_default',
          reason: 'Default formula; no override',
        });
      case 'blank':
        return check({ ...base, status: 'info', reason: plan.reason });
      case 'missing':
        return check({
          ...base,
          status: def.source !== null && 'id' in def.source ? 'unexplained' : 'info',
          reasonCode: def.source !== null && 'id' in def.source ? 'template_mismatch' : null,
          reason: plan.reason,
        });
      default:
        return check({
          ...base,
          expected: plan.sheetValue,
          status: 'unexplained',
          reasonCode: 'unsupported_value',
          reason: plan.reason,
        });
    }
  };

  for (const id of SHEET_OPTIONS_IDS) {
    const row = idRows.get(id);
    const def = defsById.get(id);
    const notImported = SHEET_OPTIONS_NOT_IMPORTED[id];
    const validated = SHEET_OPTIONS_VALIDATED[id];
    const sheetLabel =
      def?.source !== null && def?.source && 'id' in def.source
        ? def.source.sheetLabel
        : (notImported?.sheetLabel ?? validated?.sheetLabel ?? '');
    const checkId = `settings.sheetOptions.${id}`;
    const label = notImported?.secret
      ? sheetLabel
      : `SheetOptions ID ${id}: ${def?.label ?? sheetLabel}`;
    if (row === undefined) {
      out.push(
        check({
          id: checkId,
          section: 'settings',
          label,
          status: 'unexplained',
          reasonCode: 'template_mismatch',
          reason: `ID ${id} is not in SheetOptions column P`,
        }),
      );
      continue;
    }
    const kRef = sheetRef('SheetOptions', `K${row}`);
    const k = r.text('SheetOptions', `K${row}`);
    if (k === null || normaliseSheetLabel(k) !== normaliseSheetLabel(sheetLabel)) {
      out.push(
        check({
          id: checkId,
          section: 'settings',
          label,
          sheetRef: kRef,
          status: 'unexplained',
          reasonCode: 'template_mismatch',
          reason: `The label for ID ${id} does not match the template`,
        }),
      );
      continue;
    }
    if (notImported) {
      if (notImported.secret) {
        out.push(
          check({
            id: checkId,
            section: 'settings',
            label,
            sheetRef: kRef,
            status: 'explained',
            reasonCode: notImported.reasonCode,
            reason: notImported.reason,
            refs: notImported.decision ? { decision: notImported.decision } : null,
          }),
        );
      } else {
        const cell = r.cell('SheetOptions', `L${row}`);
        const expected =
          cell === null || cell.v === null
            ? null
            : typeof cell.v === 'boolean'
              ? String(cell.v)
              : cell.v;
        out.push(
          check({
            id: checkId,
            section: 'settings',
            label,
            sheetRef: sheetRef('SheetOptions', `L${row}`),
            unit: 'text',
            expected,
            status: 'explained',
            reasonCode: notImported.reasonCode,
            reason: notImported.reason,
            refs: notImported.decision ? { decision: notImported.decision } : null,
          }),
        );
      }
      continue;
    }
    if (validated) {
      const v = r.text('SheetOptions', `L${row}`);
      out.push(
        check({
          id: checkId,
          section: 'settings',
          label,
          sheetRef: sheetRef('SheetOptions', `L${row}`),
          unit: 'text',
          expected: v,
          actual: validated.expected,
          status: v === validated.expected ? 'match' : 'unexplained',
          reasonCode: v === validated.expected ? null : 'unsupported_value',
          reason:
            v === validated.expected
              ? 'Checked, not stored (the app works in AUD)'
              : 'Only AUD is supported (D25)',
          refs: { decision: 'D25' },
        }),
      );
      continue;
    }
    if (def) out.push(valueCheck(def, checkId, label, sheetRef('SheetOptions', `L${row}`)));
  }
  for (const def of SETTINGS) {
    if (def.source === null || 'id' in def.source) continue;
    out.push(valueCheck(def, `settings.${def.key}`, def.label, null));
  }
  return out;
}

// ─── Exclusions, corrections, suspects ──────────────────────────────────────────────────────────

function exclusionChecks({ model }: Ctx): Check[] {
  return model.exclusions.map((e) =>
    check({
      id: `exclusions.${e.sheetRef}`,
      section: 'exclusions',
      label: `Feed row ${e.sheetRef} not imported`,
      sheetRef: e.sheetRef,
      unit: 'units',
      expected: e.cachedPrice === null ? null : decimalFromNumber(e.cachedPrice),
      status: 'explained',
      reasonCode: e.reasonCode,
      reason:
        e.reasonCode === 'exclusion_d23'
          ? 'A bullion futures feed row; bullion is priced from built-in series'
          : e.reasonCode === 'exclusion_d22'
            ? 'A duplicate price-feed row for a listed instrument; that instrument is priced on its own'
            : 'A price-feed row with no holdings',
      refs: e.decision ? { decision: e.decision } : null,
    }),
  );
}

const fieldToColumn: Record<string, string> = {
  date: 'tradeDate',
  units: 'units',
  price: 'price',
  feeCents: 'feeCents',
  paymentDate: 'paymentDate',
  ticker: 'ticker',
  exDate: 'exDate',
  netAmountCents: 'netAmountCents',
  reinvested: 'reinvested',
};

function correctionChecks({ outcomes, db }: Ctx): Check[] {
  return outcomes.map((o) => {
    const base = {
      id: `corrections.${o.id}`,
      section: 'corrections' as const,
      label: `Correction ${o.id}`,
      sheetRef: o.sheetRef,
    };
    if (!o.applied) {
      return check({
        ...base,
        status: 'unexplained',
        reasonCode: 'correction_unmatched',
        reason: `The correction matched ${o.matches} rows (it must match exactly one); nothing was changed`,
      });
    }
    const rows = (o.target === 'trade' ? db.trades : db.dividends) as unknown as (Record<
      string,
      string | number | boolean | null
    > & { id: number; correctionId: string | null })[];
    const row = rows.find((x) => (x.correctionId ?? '').split(',').includes(o.id));
    const entity: RecordEntityId = o.target === 'trade' ? 'trades' : 'dividends';
    if (o.skip) {
      return check({
        ...base,
        unit: 'text',
        expected: 'imported',
        actual: row ? 'imported' : 'skipped',
        status: row ? 'unexplained' : 'explained',
        reasonCode: 'correction',
        reason: o.reason,
        refs: { correctionId: o.id, entity },
      });
    }
    const fields = Object.keys(o.before);
    const show = (v: string | number | boolean | null | undefined) =>
      v === null || v === undefined ? 'blank' : String(v);
    const single = fields.length === 1 ? fields[0]! : null;
    const expected = single
      ? show(o.before[single])
      : fields.map((f) => `${f}=${show(o.before[f])}`).join('; ');
    const actual =
      row === undefined
        ? null
        : single
          ? show(row[fieldToColumn[single] ?? single])
          : fields.map((f) => `${f}=${show(row[fieldToColumn[f] ?? f])}`).join('; ');
    const unit =
      single === 'date' || single === 'paymentDate' || single === 'exDate' ? 'date' : 'text';
    return check({
      ...base,
      unit,
      expected,
      actual,
      status: row ? 'explained' : 'unexplained',
      reasonCode: 'correction',
      reason: o.reason,
      refs: { correctionId: o.id, entity, ...(row ? { recordId: row.id } : {}) },
    });
  });
}

function suspectChecks({ db }: Ctx): Check[] {
  const out: Check[] = [];
  for (const t of db.trades) {
    if (t.reviewFlags === null) continue;
    const flags = JSON.parse(t.reviewFlags) as ReviewFlag[];
    out.push(
      check({
        id: `suspects.trades.${t.sheetRef ?? t.id}`,
        section: 'suspects',
        label: `Trade ${t.sheetRef ?? t.id} flagged`,
        sheetRef: t.sheetRef,
        unit: 'text',
        actual: flags.join(', '),
        status: 'suspect',
        reasonCode: 'suspect_row',
        reason: 'Imported as-is; review this row',
        refs: { entity: 'trades', recordId: t.id, flags },
      }),
    );
  }
  return out;
}
