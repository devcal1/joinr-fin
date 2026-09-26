// Extractors (stage-1.md §4.3): every in-scope tab → the pure sheet model. No DB access.
import {
  ALLOCATION_AGGRESSIVENESS_SHEET_VALUES,
  BULLION_FEEDS,
  centsFromNumber,
  decimalFromNumber,
  isoMonthOf,
  addMonthsIso,
  normaliseSheetLabel,
  PAY_FREQUENCY_SHEET_VALUES,
  SETTINGS,
  settingValueSchema,
  type BudgetItemKind,
  type IsoDate,
  type Metal,
  type SettingDef,
  type SettingValue,
} from '@joinr/schema';
import { check, info } from './checks';
import { ExtractContext } from './context';
import { WorkbookFormatError } from './errors';
import {
  ANCHORS,
  BUDGET,
  CASH,
  columnRange,
  DIVIDENDS,
  FIRE_PREFIX,
  FREQUENCY_TEXT,
  HISTORY,
  HISTORY_HEADERS,
  HOLDING_TYPES,
  inSpillRange,
  INVESTMENTS,
  LIABILITIES,
  NET_WORTH,
  OPTIONAL_ANCHORS,
  OPTIONAL_SHEETS,
  OTHER_ASSETS,
  PROPERTY,
  REQUIRED_SHEETS,
  SHEET_OPTIONS,
  sheetRef,
  SIDE_INCOME,
  SUPER,
  WATCH_MAX_ROW,
  WATCH_TERMINATORS,
  type InvestmentLayout,
} from './layout';
import type {
  BudgetItemRow,
  CashAccountRow,
  DividendRow,
  IncomeStreamRow,
  LedgerRow,
  LoanRow,
  Meta,
  NoteRow,
  OtherAssetRow,
  PriceCell,
  PropertyRow,
  SettingPlan,
  SideIncomeDepositRow,
  SnapshotRow,
  SuperEntryRow,
  SuperFundRow,
  WatchRow,
  YearlyExpenseRow,
} from './model';
import { isErrorString, isSentinel, type SheetReader } from './reader';
import { SNAPSHOT_VALUE_COLUMNS } from '@joinr/schema';

// ─── Layout validation and metadata ─────────────────────────────────────────────────────────────

/** Required sheets, header anchors and the History header row (§4.2 rule 12, §4.3 History). */
export function validateLayout(r: SheetReader): void {
  const missing = REQUIRED_SHEETS.filter((s) => !r.has(s));
  if (missing.length > 0) {
    throw new WorkbookFormatError(
      `This is not a template v2.15 workbook: missing sheet${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`,
    );
  }
  const anchors = [...ANCHORS, ...OPTIONAL_ANCHORS.filter(([sheet]) => r.has(sheet))];
  for (const [sheet, addr, label] of anchors) {
    const text = r.text(sheet, addr);
    if (text === null || normaliseSheetLabel(text) !== normaliseSheetLabel(label)) {
      throw new WorkbookFormatError(
        `Unexpected layout: ${sheet}!${addr} should read "${label}" (template v2.15)`,
      );
    }
  }
  for (const [col, label] of Object.entries(HISTORY_HEADERS)) {
    const text = r.text(HISTORY.sheet, `${col}2`);
    if (text === null || normaliseSheetLabel(text) !== normaliseSheetLabel(label)) {
      throw new WorkbookFormatError(
        `Unexpected History layout: column ${col} should be "${label}"; the snapshot mapping would be shifted`,
      );
    }
  }
}

/** The server-local calendar date (not UTC) as YYYY-MM-DD. */
function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function readMeta(r: SheetReader, now: Date): Meta {
  const asOfSheet = r.date(NET_WORTH.sheet, NET_WORTH.asOf);
  return {
    asOf: asOfSheet ?? localIsoDate(now),
    asOfFromSheet: asOfSheet !== null,
    templateVersion: r.text(NET_WORTH.sheet, NET_WORTH.templateVersion),
    lastRun: r.date(NET_WORTH.sheet, NET_WORTH.lastRun),
    date1904: r.date1904,
    fireSheet: r.sheetNames.find((n) => n.startsWith(FIRE_PREFIX)) ?? null,
  };
}

// ─── Investments ────────────────────────────────────────────────────────────────────────────────

/** The last watch row (the row before the first terminator in column A). */
export function watchEnd(r: SheetReader, sheet: string): number {
  for (let row = 2; row <= WATCH_MAX_ROW; row++) {
    const a = r.text(sheet, `A${row}`);
    if (a !== null && WATCH_TERMINATORS.some((t) => a.startsWith(t))) return row - 1;
  }
  return WATCH_MAX_ROW;
}

const CROSS_TAB_RE = /^(?:'([^']+)'|([A-Za-z0-9_]+))!\$?[A-Z]{1,3}\$?\d+$/;

function crossTabOf(formula: string | null, sheet: string): string | null {
  if (formula === null) return null;
  const m = CROSS_TAB_RE.exec(formula.trim());
  const target = m ? (m[1] ?? m[2] ?? null) : null;
  return target !== null && target !== sheet ? target : null;
}

export function readPriceCell(
  ctx: ExtractContext,
  sheet: string,
  col: string,
  row: number,
): PriceCell {
  const addr = `${col}${row}`;
  const ref = sheetRef(sheet, addr);
  const c = ctx.r.cell(sheet, addr);
  const formula = c?.formula ?? null;
  const crossTab = crossTabOf(formula, sheet);
  const base = { formula, crossTab, sheetRef: ref };
  if (!c || c.v === null || (c.t === 's' && String(c.v).trim() === '')) {
    return { ...base, kind: 'blank', value: null, typed: false, raw: null };
  }
  const typedCell = formula === null && !inSpillRange(sheet, col, row);
  if (c.t === 'n' && typeof c.v === 'number' && Number.isFinite(c.v)) {
    return { ...base, kind: 'number', value: c.v, typed: typedCell, raw: null };
  }
  const text = String(c.v).trim();
  if (c.t === 'e' || isErrorString(text))
    return { ...base, kind: 'error', value: null, typed: false, raw: text };
  if (isSentinel(text)) return { ...base, kind: 'sentinel', value: null, typed: false, raw: text };
  const parsed = ctx.num(sheet, addr, 'holdings');
  if (parsed !== null)
    return { ...base, kind: 'number', value: parsed, typed: typedCell, raw: null };
  return { ...base, kind: 'text', value: null, typed: false, raw: text };
}

function frequencyMonths(ctx: ExtractContext, sheet: string, addr: string): number | null {
  const c = ctx.r.cell(sheet, addr);
  if (!c || c.v === null) return null;
  if (c.t === 'n' && typeof c.v === 'number') {
    return Number.isInteger(c.v) && c.v > 0 ? c.v : null;
  }
  const text = String(c.v).trim();
  if (text === '' || isSentinel(text) || isErrorString(text)) return null;
  const months = FREQUENCY_TEXT[text.toLowerCase()];
  if (months !== undefined) return months;
  ctx.push(
    info(
      `holdings.dividendFrequency.${sheetRef(sheet, addr)}`,
      'holdings',
      `Dividend frequency not recognised at ${sheetRef(sheet, addr)}`,
      'unsupported_value',
      'The dividend frequency text is not Monthly, Quarterly, Half-yearly or Yearly; stored as unknown',
      { sheetRef: sheetRef(sheet, addr) },
    ),
  );
  return null;
}

function readWatch(ctx: ExtractContext, l: InvestmentLayout): WatchRow[] {
  const { r } = ctx;
  const w = l.watch;
  const out: WatchRow[] = [];
  const end = watchEnd(r, l.sheet);
  for (let row = 2; row <= end; row++) {
    if (r.isBlank(l.sheet, `A${row}`)) continue;
    const symbol = r.text(l.sheet, `A${row}`)!;
    const sector = w.sector ? ctx.text(l.sheet, `${w.sector}${row}`) : null;
    const col = (c: string | null) =>
      c === null ? null : ctx.decimal(l.sheet, `${c}${row}`, 'holdings');
    const units = r.number(l.sheet, `${w.units}${row}`);
    out.push({
      kind: l.kind,
      sheet: l.sheet,
      row,
      sheetRef: sheetRef(l.sheet, `A${row}`),
      symbol,
      name: w.name ? ctx.text(l.sheet, `${w.name}${row}`) : null,
      quoteCurrency: (w.currency ? ctx.text(l.sheet, `${w.currency}${row}`) : null) ?? 'AUD',
      price: readPriceCell(ctx, l.sheet, w.price, row),
      heldUnits: units,
      heldUnitsError: r.isErrorValue(l.sheet, `${w.units}${row}`),
      targetRatio: col(w.target),
      sector,
      isRetirement: sector === 'Retirement',
      location: w.location ? ctx.text(l.sheet, `${w.location}${row}`) : null,
      mgmtFeeRatio: col(w.fee),
      regions: w.regions
        ? [col(w.regions[0]), col(w.regions[1]), col(w.regions[2]), col(w.regions[3])]
        : [null, null, null, null],
      dividendFreqMonths: w.freq ? frequencyMonths(ctx, l.sheet, `${w.freq}${row}`) : null,
      drp: w.drp ? r.bool(l.sheet, `${w.drp}${row}`) : null,
    });
  }
  return out;
}

function invalidLedgerRow(ctx: ExtractContext, ref: string, what: string): void {
  ctx.push(
    check({
      id: `ledgers.invalid.${ref}`,
      section: 'ledgers',
      label: `Ledger row ${ref} not imported`,
      sheetRef: ref,
      status: 'unexplained',
      reasonCode: 'unsupported_value',
      reason: `The row has ${what}; it was not imported`,
    }),
  );
}

function readLedger(
  ctx: ExtractContext,
  l: InvestmentLayout,
  cryptoFeeRate: string | null,
): LedgerRow[] {
  const { r } = ctx;
  const out: LedgerRow[] = [];
  const last = r.lastRow(l.sheet);
  const blanks: number[] = [];
  for (let row = l.ledgerHeader + 1; row <= last; row++) {
    if (r.isBlank(l.sheet, `A${row}`)) {
      blanks.push(row);
      continue;
    }
    const ref = sheetRef(l.sheet, `A${row}`);
    const symbol = r.text(l.sheet, `A${row}`)!;
    const date = r.date(l.sheet, `${l.ledger.date}${row}`);
    if (date === null) {
      invalidLedgerRow(ctx, ref, 'no valid date');
      continue;
    }
    const unitsBlank = r.isBlank(l.sheet, `${l.ledger.units}${row}`);
    const units = ctx.num(l.sheet, `${l.ledger.units}${row}`, 'ledgers');
    if (units === null && !unitsBlank) {
      invalidLedgerRow(ctx, ref, 'units that are not a number');
      continue;
    }
    const priceBlank = r.isBlank(l.sheet, `${l.ledger.price}${row}`);
    const price = ctx.num(l.sheet, `${l.ledger.price}${row}`, 'ledgers');
    if (price === null && !priceBlank) {
      invalidLedgerRow(ctx, ref, 'a price that is not a number');
      continue;
    }
    let feeCents = 0;
    let feeRate: string | null = null;
    let feeCell: number | null = null;
    if (l.ledger.fee !== null) {
      const feeAddr = `${l.ledger.fee}${row}`;
      feeCell = r.number(l.sheet, feeAddr);
      if (feeCell !== null) feeCents = centsFromNumber(feeCell);
      if (l.kind === 'crypto' && ctx.hasFormula(l.sheet, feeAddr) && cryptoFeeRate !== null) {
        feeRate = cryptoFeeRate;
      }
    }
    out.push({
      kind: l.kind,
      sheet: l.sheet,
      row,
      sheetRef: ref,
      symbol,
      date,
      units: units === null ? '0' : decimalFromNumber(units),
      price: price === null ? '0' : decimalFromNumber(price),
      feeCents,
      seq: 0,
      feeRate,
      feeCell,
      orderValueCell: r.number(l.sheet, `${l.ledger.orderValue}${row}`),
      flags: [],
      correctionId: null,
      skipped: false,
      original: null,
    });
  }
  const lastData = out.at(-1)?.row ?? 0;
  const interior = blanks.filter((b) => b < lastData);
  if (interior.length > 0) {
    const first = sheetRef(l.sheet, `A${interior[0]}`);
    ctx.push(
      info(
        `ledgers.skipped.${first}`,
        'ledgers',
        `Blank rows in the ${l.sheet} ledger`,
        'blank_row',
        `${interior.length} blank row(s) inside the table skipped`,
        {
          sheetRef: first,
          unit: 'count',
          expected: interior.length,
        },
      ),
    );
  }
  return out;
}

export function extractInvestments(
  ctx: ExtractContext,
  cryptoFeeRate: string | null,
): { watch: WatchRow[]; ledger: LedgerRow[] } {
  const watch: WatchRow[] = [];
  const ledger: LedgerRow[] = [];
  for (const l of INVESTMENTS) {
    watch.push(...readWatch(ctx, l));
    ledger.push(...readLedger(ctx, l, l.kind === 'crypto' ? cryptoFeeRate : null));
  }
  return { watch, ledger };
}

// ─── Dividends ──────────────────────────────────────────────────────────────────────────────────

function invalidRow(
  ctx: ExtractContext,
  section: 'dividends' | 'cash' | 'budget',
  ref: string,
  what: string,
): void {
  ctx.push(
    check({
      id: `${section}.invalid.${ref}`,
      section,
      label: `Row ${ref} not imported`,
      sheetRef: ref,
      status: 'unexplained',
      reasonCode: 'unsupported_value',
      reason: `The row has ${what}; it was not imported`,
    }),
  );
}

export function extractDividends(ctx: ExtractContext): DividendRow[] {
  const { r } = ctx;
  const s = DIVIDENDS.sheet;
  const out: DividendRow[] = [];
  const blanks: number[] = [];
  for (let row = DIVIDENDS.firstRow; row <= DIVIDENDS.lastRow; row++) {
    if (r.isBlank(s, `A${row}`)) {
      blanks.push(row);
      continue;
    }
    const ref = sheetRef(s, `A${row}`);
    const paymentDate = r.date(s, `A${row}`);
    if (paymentDate === null) {
      invalidRow(ctx, 'dividends', ref, 'no valid payment date');
      continue;
    }
    const ticker = r.text(s, `B${row}`);
    if (ticker === null) {
      invalidRow(ctx, 'dividends', ref, 'no ticker');
      continue;
    }
    const kindText = r.text(s, `C${row}`)?.toLowerCase() ?? '';
    const holdingKind = HOLDING_TYPES[kindText];
    if (holdingKind === undefined) {
      invalidRow(
        ctx,
        'dividends',
        ref,
        'a holding type that is not ETF, Stocks, Managed Fund or Crypto',
      );
      continue;
    }
    const netBlank = r.isBlank(s, `F${row}`);
    const net = ctx.num(s, `F${row}`, 'dividends');
    if (net === null && !netBlank) {
      invalidRow(ctx, 'dividends', ref, 'a net amount that is not a number');
      continue;
    }
    const price = r.cell(s, `G${row}`);
    const priceNum = r.number(s, `G${row}`);
    out.push({
      row,
      sheetRef: ref,
      paymentDate,
      ticker,
      holdingKind,
      exDate: r.date(s, `D${row}`),
      reinvested: r.bool(s, `E${row}`),
      netAmountCents: net === null ? 0 : centsFromNumber(net),
      priceAtEx: priceNum === null ? null : decimalFromNumber(priceNum),
      priceAtExManual: priceNum !== null && (price?.formula ?? null) === null,
      flags: [],
      correctionId: null,
      skipped: false,
      original: null,
      link: null,
    });
  }
  const lastData = out.at(-1)?.row ?? 0;
  const interior = blanks.filter((b) => b < lastData);
  if (interior.length > 0) {
    const first = sheetRef(s, `A${interior[0]}`);
    ctx.push(
      info(
        `dividends.skipped.${first}`,
        'dividends',
        'Blank rows in the dividends table',
        'blank_row',
        `${interior.length} blank row(s) inside the table skipped`,
        {
          sheetRef: first,
          unit: 'count',
          expected: interior.length,
        },
      ),
    );
  }
  return out;
}

// ─── Cash ───────────────────────────────────────────────────────────────────────────────────────

/** The row of the Cash tab's `ℹ️` terminator (its C cell holds the total). */
export function cashEnd(r: SheetReader): number {
  for (let row = CASH.firstRow; row <= CASH.maxRow; row++) {
    const a = r.text(CASH.sheet, `A${row}`);
    if (a !== null && a.startsWith('ℹ️')) return row;
  }
  return 13;
}

export function extractCash(ctx: ExtractContext): { accounts: CashAccountRow[]; notes: NoteRow[] } {
  const { r } = ctx;
  const s = CASH.sheet;
  const end = cashEnd(r);
  const accounts: CashAccountRow[] = [];
  const blanks: number[] = [];
  for (let row = CASH.firstRow; row < end; row++) {
    if (r.isBlank(s, `A${row}`)) {
      blanks.push(row);
      continue;
    }
    const balance = ctx.num(s, `C${row}`, 'cash');
    accounts.push({
      row,
      sheetRef: sheetRef(s, `A${row}`),
      name: r.text(s, `A${row}`)!,
      currency: ctx.text(s, `B${row}`) ?? 'AUD',
      balanceCents: balance === null ? 0 : centsFromNumber(balance),
      isOffset: r.bool(s, `E${row}`) ?? false,
    });
  }
  const lastData = accounts.at(-1)?.row ?? 0;
  const interior = blanks.filter((b) => b < lastData);
  if (interior.length > 0) {
    const first = sheetRef(s, `A${interior[0]}`);
    ctx.push(
      info(
        `cash.skipped.${first}`,
        'cash',
        'Blank rows in the cash accounts table',
        'blank_row',
        `${interior.length} blank row(s) inside the table skipped`,
        {
          sheetRef: first,
          unit: 'count',
          expected: interior.length,
        },
      ),
    );
  }
  const notes: NoteRow[] = [];
  for (let row = CASH.notesFrom; row <= CASH.notesTo; row++) {
    const note = r.text(s, `Q${row}`);
    if (note === null) continue;
    const date = r.date(s, `H${row}`);
    const ref = sheetRef(s, `Q${row}`);
    if (date === null) {
      ctx.push(
        info(
          `cash.skipped.${ref}`,
          'cash',
          `Spend note ${ref} has no date`,
          'blank_row',
          'A spend note without a date on the same row was skipped',
          { sheetRef: ref },
        ),
      );
      continue;
    }
    notes.push({ kind: 'spend', periodMonth: isoMonthOf(date), note, sheetRef: ref });
  }
  return { accounts, notes };
}

// ─── Side income ────────────────────────────────────────────────────────────────────────────────

/**
 * Side income (D57, stage-3.md §3.5 item 1): one dated deposit per non-zero numeric G/H cell of a
 * row with a date in F, dated min(F, the workbook as-of). Zero cells write nothing; the J notes
 * stay period notes.
 */
export function extractSideIncome(ctx: ExtractContext): {
  streams: IncomeStreamRow[];
  deposits: SideIncomeDepositRow[];
  notes: NoteRow[];
} {
  const { r } = ctx;
  const s = SIDE_INCOME.sheet;
  const streams: IncomeStreamRow[] = [
    { name: r.text(s, 'G1') ?? 'Side income 1', sheetRef: sheetRef(s, 'G1') },
    { name: r.text(s, 'H1') ?? 'Side income 2', sheetRef: sheetRef(s, 'H1') },
  ];
  const deposits: SideIncomeDepositRow[] = [];
  const notes: NoteRow[] = [];
  for (let row = SIDE_INCOME.firstRow; row <= SIDE_INCOME.lastRow; row++) {
    const end = r.date(s, `F${row}`);
    if (end === null) continue;
    const periodMonth = isoMonthOf(end);
    const depositDate = end > ctx.asOf ? ctx.asOf : end;
    const note = r.text(s, `J${row}`);
    let any = false;
    (['G', 'H'] as const).forEach((col, streamIndex) => {
      const n = ctx.num(s, `${col}${row}`, 'income');
      if (n === null) return;
      any = true;
      const amountCents = centsFromNumber(n);
      if (amountCents === 0) return;
      deposits.push({
        streamIndex,
        periodEnd: end,
        depositDate,
        amountCents,
        sheetRef: sheetRef(s, `${col}${row}`),
      });
    });
    if (note !== null)
      notes.push({ kind: 'side_income', periodMonth, note, sheetRef: sheetRef(s, `J${row}`) });
    if (!any && note === null) {
      const ref = sheetRef(s, `F${row}`);
      ctx.push(
        info(
          `income.skipped.${ref}`,
          'income',
          `Side income row ${ref} is empty`,
          'blank_row',
          'Both amounts are blank and there is no note; nothing imported for this period',
          { sheetRef: ref },
        ),
      );
    }
  }
  return { streams, deposits, notes };
}

// ─── Budget ─────────────────────────────────────────────────────────────────────────────────────

export function budgetEnd(r: SheetReader): number {
  for (let row = BUDGET.firstRow; row <= BUDGET.maxRow; row++) {
    const a = r.text(BUDGET.sheet, `A${row}`);
    if (a !== null && a.startsWith('Cash Savings -')) return row;
  }
  return 29;
}

function budgetKind(name: string): BudgetItemKind {
  if (name.startsWith('Yearly Expenses - Automatic')) return 'auto_yearly';
  if (name.startsWith('Investment Savings -')) return 'auto_invest';
  if (name.startsWith('Cash Savings -')) return 'auto_cash';
  return 'item';
}

/**
 * A budget row's stored monthly amount: an `item`'s C (blank → 0); the `auto_invest` row's C only
 * when it is typed, with no formula (D54, stage-3.md §3.5 item 4; the template's
 * `IF(... "Yes", ROUNDDOWN(...), 0)` formula stays null); null for the other derived rows.
 */
export function budgetMonthlyCents(
  ctx: ExtractContext,
  kind: BudgetItemKind,
  row: number,
): number | null {
  const addr = `C${row}`;
  if (kind === 'item') return centsFromNumber(ctx.num(BUDGET.sheet, addr, 'budget') ?? 0);
  if (kind !== 'auto_invest' || ctx.hasFormula(BUDGET.sheet, addr)) return null;
  const typed = ctx.num(BUDGET.sheet, addr, 'budget');
  return typed === null ? null : centsFromNumber(typed);
}

export function extractBudget(ctx: ExtractContext): {
  items: BudgetItemRow[];
  yearly: YearlyExpenseRow[];
} {
  const { r } = ctx;
  const s = BUDGET.sheet;
  const end = budgetEnd(r);
  const items: BudgetItemRow[] = [];
  for (let row = BUDGET.firstRow; row <= end; row++) {
    const name = ctx.text(s, `A${row}`);
    if (name === null) {
      const typedCategory = !r.isBlank(s, `G${row}`) && !ctx.hasFormula(s, `G${row}`);
      const c = r.number(s, `C${row}`);
      if (typedCategory || (c !== null && c !== 0)) {
        const ref = sheetRef(s, `A${row}`);
        ctx.push(
          info(
            `budget.skipped.${ref}`,
            'budget',
            `Budget row ${ref} has no name`,
            'unnamed_row',
            'The row has no item name but holds other content; it was not imported',
            { sheetRef: ref, expected: c === null ? null : centsFromNumber(c), unit: 'cents' },
          ),
        );
      }
      continue;
    }
    const kind = budgetKind(name);
    items.push({
      row,
      sheetRef: sheetRef(s, `A${row}`),
      name,
      kind,
      monthlyCents: budgetMonthlyCents(ctx, kind, row),
      category: ctx.text(s, `G${row}`),
      accountName: ctx.text(s, `F${row}`),
      cashAccountIndex: null,
      flags: [],
    });
  }
  const yearly: YearlyExpenseRow[] = [];
  for (let row = BUDGET.yearlyFrom; row <= BUDGET.yearlyTo; row++) {
    const name = ctx.text(s, `E${row}`);
    const cost = r.number(s, `F${row}`);
    if (name === null || cost === null) continue;
    yearly.push({
      row,
      sheetRef: sheetRef(s, `E${row}`),
      name,
      annualCents: centsFromNumber(cost),
    });
  }
  return { items, yearly };
}

// ─── Other assets ───────────────────────────────────────────────────────────────────────────────

const MF_PRICE_REF_RE = /^'?Managed Funds'?!\$?D\$?(\d+)$/;
const SAME_SHEET_REF_RE = /^(?:'?Other Assets'?!)?\$?([A-Z]{1,3})\$?(\d+)$/;

/** Follows `=K19` chains to a `'Managed Funds'!D<r>` feed of a bullion future (§4.4). */
export function bullionMetal(r: SheetReader, row: number): Metal | null {
  let addr = `K${row}`;
  const seen = new Set<string>([addr]);
  for (let depth = 0; depth <= 600; depth++) {
    const f = r.cell(OTHER_ASSETS.sheet, addr)?.formula?.trim() ?? null;
    if (f === null) return null;
    const mf = MF_PRICE_REF_RE.exec(f);
    if (mf) {
      const id = r.text('Managed Funds', `A${mf[1]}`);
      return id !== null && Object.hasOwn(BULLION_FEEDS, id) ? (BULLION_FEEDS[id] ?? null) : null;
    }
    const same = SAME_SHEET_REF_RE.exec(f);
    if (!same) return null;
    addr = `${same[1]}${same[2]}`;
    if (seen.has(addr)) return null;
    seen.add(addr);
  }
  return null;
}

export function extractOtherAssets(ctx: ExtractContext): OtherAssetRow[] {
  const { r } = ctx;
  const s = OTHER_ASSETS.sheet;
  const out: OtherAssetRow[] = [];
  const blanks: number[] = [];
  for (let row = OTHER_ASSETS.firstRow; row <= OTHER_ASSETS.lastRow; row++) {
    if (r.isBlank(s, `F${row}`)) {
      blanks.push(row);
      continue;
    }
    const description = r.text(s, `F${row}`)!;
    const link = r.cell(s, `F${row}`)?.link ?? null;
    const units = ctx.num(s, `H${row}`, 'other_assets');
    const sold = ctx.num(s, `L${row}`, 'other_assets');
    const price = ctx.num(s, `K${row}`, 'other_assets');
    const metal = bullionMetal(r, row);
    out.push({
      row,
      sheetRef: sheetRef(s, `F${row}`),
      description,
      url: link ?? (/^https?:\/\//i.test(description) ? description : null),
      purchaseDate: r.date(s, `G${row}`),
      units: units === null ? '0' : decimalFromNumber(units),
      soldUnits: sold === null ? '0' : decimalFromNumber(Math.abs(sold)),
      currency: ctx.text(s, `I${row}`) ?? 'AUD',
      unitCost: ctx.decimal(s, `J${row}`, 'other_assets'),
      unitPrice: price === null ? null : decimalFromNumber(price),
      priceSource: metal === null ? 'manual' : 'bullion',
      metal,
      unitOfMeasure: metal === null ? 'each' : 'oz',
      ozPerUnit: metal === null ? null : '1',
    });
  }
  const lastData = out.at(-1)?.row ?? 0;
  const interior = blanks.filter((b) => b < lastData);
  if (interior.length > 0) {
    const first = sheetRef(s, `F${interior[0]}`);
    ctx.push(
      info(
        `otherAssets.skipped.${first}`,
        'other_assets',
        'Blank rows in the other assets table',
        'blank_row',
        `${interior.length} blank row(s) inside the table skipped`,
        {
          sheetRef: first,
          unit: 'count',
          expected: interior.length,
        },
      ),
    );
  }
  return out;
}

// ─── Super ──────────────────────────────────────────────────────────────────────────────────────

/** The period super entries belong to: EDATE(last run, 1), else the as-of month (§4.3 Super). */
export function superEntryPeriod(meta: Meta): string {
  return isoMonthOf(meta.lastRun !== null ? addMonthsIso(meta.lastRun, 1) : meta.asOf);
}

export function extractSuper(
  ctx: ExtractContext,
  meta: Meta,
): { funds: SuperFundRow[]; entries: SuperEntryRow[]; notes: NoteRow[] } {
  const { r } = ctx;
  const s = SUPER.sheet;
  const funds: SuperFundRow[] = [];
  for (let row = SUPER.fundsFrom; row <= SUPER.fundsTo; row++) {
    if (r.isBlank(s, `A${row}`)) continue;
    const balance = ctx.num(s, `B${row}`, 'super');
    funds.push({
      row,
      sheetRef: sheetRef(s, `A${row}`),
      name: r.text(s, `A${row}`)!,
      balanceCents: balance === null ? 0 : centsFromNumber(balance),
    });
  }
  const period = superEntryPeriod(meta);
  const entries: SuperEntryRow[] = [];
  const gain = ctx.num(s, SUPER.reportedGain, 'super');
  if (gain !== null && gain !== 0) {
    entries.push({
      kind: 'reported_gain',
      periodMonth: period,
      amountCents: centsFromNumber(gain),
      sheetRef: sheetRef(s, SUPER.reportedGain),
    });
  }
  const voluntary = ctx.num(s, SUPER.voluntary, 'super');
  if (voluntary !== null && voluntary !== 0) {
    entries.push({
      kind: 'voluntary_contribution',
      periodMonth: period,
      amountCents: centsFromNumber(voluntary),
      sheetRef: sheetRef(s, SUPER.voluntary),
    });
  }
  const notes: NoteRow[] = [];
  for (let row = SUPER.notesFrom; row <= SUPER.notesTo; row++) {
    const note = r.text(s, `F${row}`);
    if (note === null) continue;
    const date = r.date(s, `E${row}`);
    if (date === null) continue;
    notes.push({
      kind: 'super_option',
      periodMonth: isoMonthOf(date),
      note,
      sheetRef: sheetRef(s, `F${row}`),
    });
  }
  return { funds, entries, notes };
}

// ─── Property, liabilities, spare liability ─────────────────────────────────────────────────────

const nonZero = (n: number | null): boolean => n !== null && n !== 0;
const absCents = (n: number | null): number | null =>
  n === null ? null : Math.abs(centsFromNumber(n));
const positiveInt = (n: number | null): number | null =>
  n !== null && Number.isInteger(n) && n > 0 ? n : null;

/** True when a Property slot holds a real property (§4.3 import predicate). */
export function propertySlotUsed(r: SheetReader, col: string): boolean {
  const s = PROPERTY.sheet;
  const rows = PROPERTY.rows;
  const n = (row: number) => r.number(s, `${col}${row}`);
  return (
    nonZero(n(rows.purchase)) ||
    nonZero(n(rows.current)) ||
    nonZero(n(rows.startBalance)) ||
    nonZero(n(rows.currentBalance)) ||
    r.date(s, `${col}${rows.purchaseDate}`) !== null
  );
}

export function propertyColumns(): string[] {
  return columnRange(PROPERTY.firstCol, PROPERTY.lastCol);
}

export function extractProperty(ctx: ExtractContext): {
  properties: PropertyRow[];
  loans: LoanRow[];
} {
  const { r } = ctx;
  const s = PROPERTY.sheet;
  const rows = PROPERTY.rows;
  const properties: PropertyRow[] = [];
  const loans: LoanRow[] = [];
  let placeholders = 0;
  propertyColumns().forEach((col, i) => {
    if (!propertySlotUsed(r, col)) {
      placeholders += 1;
      return;
    }
    const n = (row: number) => ctx.num(s, `${col}${row}`, 'property');
    const name = ctx.text(s, `${col}${rows.name}`) ?? `Property ${i + 1}`;
    properties.push({
      column: col,
      sheetRef: sheetRef(s, `${col}${rows.name}`),
      name,
      purchaseDate: r.date(s, `${col}${rows.purchaseDate}`),
      isPrimaryResidence: r.bool(s, `${col}${rows.primary}`) ?? false,
      purchaseValueCents: centsFromNumber(n(rows.purchase) ?? 0),
      currentValueCents: centsFromNumber(n(rows.current) ?? 0),
      netRentToDateCents: centsFromNumber(n(rows.netRent) ?? 0),
    });
    const start = n(rows.startBalance);
    const current = n(rows.currentBalance);
    if (!nonZero(start) && !nonZero(current)) return;
    const paidAddr = `${col}${rows.paid}`;
    const derived = ctx.hasFormula(s, paidAddr);
    const paidRef = sheetRef(s, paidAddr);
    if (derived) {
      ctx.push(
        info(
          `property.paymentsPaidDerived.${paidRef}`,
          'property',
          `Mortgage payments paid at ${paidRef} is a formula`,
          'derived_input',
          'Payments paid is derived from the balances; interest is not tracked',
          { sheetRef: paidRef },
        ),
      );
    }
    const rate = n(rows.rate);
    loans.push({
      propertyIndex: properties.length - 1,
      source: 'property',
      name: `${name} mortgage`,
      startDate: r.date(s, `${col}${rows.loanStart}`),
      interestPeriodsPerYear: positiveInt(n(rows.periods)),
      annualRate: rate === null ? null : decimalFromNumber(rate),
      paymentCents: absCents(n(rows.payment)),
      startBalanceCents: absCents(start),
      currentBalanceCents: absCents(current) ?? 0,
      paymentsPaidCents: absCents(n(rows.paid)),
      paymentsPaidDerived: derived,
      sheetRef: sheetRef(s, `${col}${rows.currentBalance}`),
    });
  });
  if (placeholders > 0) {
    ctx.push(
      info(
        'property.placeholderSlots',
        'property',
        'Unused property slots',
        'placeholder_slot',
        `${placeholders} template placeholder slot(s) skipped`,
        { unit: 'count', expected: placeholders },
      ),
    );
  }
  return { properties, loans };
}

/** True when LiabilitiesDebts column G is the template's CGT "future tax" slot (D2). */
export function cgtSlotSkipped(r: SheetReader): boolean {
  const g11 = r.text(LIABILITIES.sheet, `${LIABILITIES.cgtColumn}${LIABILITIES.rows.name}`);
  return g11 !== null && g11.endsWith(LIABILITIES.cgtSuffix);
}

export function extractLiabilities(ctx: ExtractContext): LoanRow[] {
  const { r } = ctx;
  const s = LIABILITIES.sheet;
  if (!r.has(s)) return [];
  const rows = LIABILITIES.rows;
  const skipG = cgtSlotSkipped(r);
  if (skipG) {
    const ref = sheetRef(s, `${LIABILITIES.cgtColumn}${rows.name}`);
    ctx.push(
      info(
        `liabilities.skipped.${ref}`,
        'net_worth',
        'Capital gains future-tax slot',
        'feature_dropped',
        'The Capital Gains tab is not rebuilt; this liabilities slot was skipped',
        { sheetRef: ref, refs: { decision: 'D2' } },
      ),
    );
  }
  const loans: LoanRow[] = [];
  LIABILITIES.columns.forEach((col, i) => {
    if (col === LIABILITIES.cgtColumn && skipG) return;
    const n = (row: number) => ctx.num(s, `${col}${row}`, 'net_worth');
    const start = n(rows.startBalance);
    const current = n(rows.currentBalance);
    if (!nonZero(start) && !nonZero(current)) return;
    const rate = n(rows.rate);
    loans.push({
      propertyIndex: null,
      source: 'liabilities',
      name: ctx.text(s, `${col}${rows.name}`) ?? `Loan ${i + 1}`,
      startDate: r.date(s, `${col}${rows.start}`),
      interestPeriodsPerYear: positiveInt(n(rows.periods)),
      annualRate: rate === null ? null : decimalFromNumber(rate),
      paymentCents: absCents(n(rows.payment)),
      startBalanceCents: absCents(start),
      currentBalanceCents: absCents(current) ?? 0,
      paymentsPaidCents: absCents(n(rows.paid)),
      paymentsPaidDerived: false,
      sheetRef: sheetRef(s, `${col}${rows.currentBalance}`),
    });
  });
  return loans;
}

/** Net Worth row 22, the spare manual liability (a loan when non-zero). */
export function extractSpareLiability(ctx: ExtractContext): LoanRow[] {
  const s = NET_WORTH.sheet;
  const row = NET_WORTH.spareRow;
  const initial = ctx.num(s, `C${row}`, 'net_worth');
  const paid = ctx.num(s, `D${row}`, 'net_worth');
  const current = ctx.num(s, `E${row}`, 'net_worth');
  if (!nonZero(initial) && !nonZero(current)) return [];
  return [
    {
      propertyIndex: null,
      source: 'net_worth',
      name: ctx.text(s, `B${row}`) ?? 'Other liability',
      startDate: null,
      interestPeriodsPerYear: null,
      annualRate: null,
      paymentCents: null,
      startBalanceCents: absCents(initial),
      currentBalanceCents: absCents(current ?? initial) ?? 0,
      paymentsPaidCents: absCents(paid),
      paymentsPaidDerived: false,
      sheetRef: sheetRef(s, `E${row}`),
    },
  ];
}

// ─── History ────────────────────────────────────────────────────────────────────────────────────

export interface HistoryRowRead {
  row: number;
  date: IsoDate;
  frozen: boolean;
}

/** History rows 3 → 300 with a date in A; frozen = no formula in B. */
export function historyRows(r: SheetReader): HistoryRowRead[] {
  const out: HistoryRowRead[] = [];
  for (let row = HISTORY.firstRow; row <= HISTORY.lastRow; row++) {
    const date = r.date(HISTORY.sheet, `A${row}`);
    if (date === null) continue;
    out.push({ row, date, frozen: (r.cell(HISTORY.sheet, `B${row}`)?.formula ?? null) === null });
  }
  return out;
}

export function extractSnapshots(ctx: ExtractContext): SnapshotRow[] {
  const { r } = ctx;
  const s = HISTORY.sheet;
  const frozen: SnapshotRow[] = [];
  for (const h of historyRows(r)) {
    const ref = sheetRef(s, `A${h.row}`);
    if (!h.frozen) {
      ctx.push(
        info(
          `snapshots.skipped.${ref}`,
          'snapshots',
          `History row ${h.row} is the live row`,
          'live_row_skipped',
          'The current month is still formulas (not recorded); it is not a snapshot',
          { sheetRef: ref },
        ),
      );
      continue;
    }
    const values: Record<string, number | string | null> = {};
    const raw: Record<string, number | null> = {};
    for (const c of SNAPSHOT_VALUE_COLUMNS) {
      const n = r.number(s, `${c.historyColumn}${h.row}`);
      raw[c.historyColumn] = n;
      values[c.dbColumn] =
        n === null ? null : c.type === 'money' ? centsFromNumber(n) : decimalFromNumber(n);
    }
    frozen.push({
      row: h.row,
      sheetRef: ref,
      runDate: h.date,
      periodMonth: isoMonthOf(h.date),
      values,
      raw,
    });
  }
  // One snapshot per month: keep the later run date (§4.3 History); snapshots.period reports it.
  const byMonth = new Map<string, SnapshotRow>();
  for (const snap of frozen) {
    const prev = byMonth.get(snap.periodMonth);
    if (!prev || snap.runDate >= prev.runDate) byMonth.set(snap.periodMonth, snap);
  }
  return frozen.filter((snap) => byMonth.get(snap.periodMonth) === snap);
}

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────

/** SheetOptions ID (column P) → row, rows 3 → 60. */
export function sheetOptionRows(r: SheetReader): Map<number, number> {
  const map = new Map<number, number>();
  for (let row = SHEET_OPTIONS.firstRow; row <= SHEET_OPTIONS.lastRow; row++) {
    const id = r.number(SHEET_OPTIONS.sheet, `P${row}`);
    if (id !== null && Number.isInteger(id) && !map.has(id)) map.set(id, row);
  }
  return map;
}

function lookupCaseInsensitive<T>(map: Readonly<Record<string, T>>, text: string): T | undefined {
  const key = Object.keys(map).find((k) => k.toLowerCase() === text.toLowerCase());
  return key === undefined ? undefined : map[key];
}

/** Parses a setting's source cell by the registry type (§2.5). */
export function parseSettingCell(
  def: SettingDef,
  r: SheetReader,
  sheet: string,
  addr: string,
): {
  status: 'value' | 'blank' | 'invalid';
  value: SettingValue | null;
  sheetValue: string | number | null;
} {
  const c = r.cell(sheet, addr);
  if (!c || r.isBlank(sheet, addr)) return { status: 'blank', value: null, sheetValue: null };
  const text = typeof c.v === 'string' ? c.v.trim() : null;
  const num =
    c.t === 'n' && typeof c.v === 'number'
      ? c.v
      : text !== null && !isErrorString(text)
        ? parseNumeric(text)
        : null;
  const sheetValue: string | number | null =
    def.type === 'date'
      ? r.date(sheet, addr)
      : typeof c.v === 'boolean'
        ? c.v
          ? 'TRUE'
          : 'FALSE'
        : c.v;
  let value: SettingValue | null = null;
  switch (def.type) {
    case 'money':
      value = num === null ? null : centsFromNumber(num);
      break;
    case 'ratio':
      value = num === null ? null : decimalFromNumber(num);
      break;
    case 'integer':
      value = num !== null && Math.abs(num - Math.round(num)) < 1e-9 ? Math.round(num) : null;
      break;
    case 'boolean':
      value = r.bool(sheet, addr);
      break;
    case 'date':
      value = r.date(sheet, addr);
      break;
    case 'enum': {
      if (text === null) break;
      if (def.key === 'pay.frequency')
        value = lookupCaseInsensitive(PAY_FREQUENCY_SHEET_VALUES, text) ?? null;
      else if (def.key === 'investing.allocationAggressiveness') {
        value = lookupCaseInsensitive(ALLOCATION_AGGRESSIVENESS_SHEET_VALUES, text) ?? null;
      } else value = (def.enumValues ?? []).find((v) => v === text.toLowerCase()) ?? null;
      break;
    }
  }
  if (value === null || !settingValueSchema(def.key).safeParse(value).success) {
    return { status: 'invalid', value: null, sheetValue };
  }
  return { status: 'value', value, sheetValue };
}

function parseNumeric(text: string): number | null {
  const m = /^-?\$?[\d,]*\.?\d+%?$/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  const percent = text.endsWith('%');
  const n = Number(text.replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return percent ? Number(decimalFromNumber(n / 100)) : n;
}

export function extractSettings(r: SheetReader, meta: Meta): SettingPlan[] {
  const idRows = sheetOptionRows(r);
  const plans: SettingPlan[] = [];
  for (const def of SETTINGS) {
    const src = def.source;
    if (src === null) continue;
    let sheet: string;
    let addr: string;
    let id: number | null = null;
    if ('id' in src) {
      id = src.id;
      const row = idRows.get(src.id);
      if (row === undefined) {
        plans.push({
          key: def.key,
          status: 'missing',
          value: null,
          sheetValue: null,
          sheetRef: null,
          sheetOptionsId: id,
          reason: `SheetOptions ID ${src.id} not found`,
        });
        continue;
      }
      sheet = SHEET_OPTIONS.sheet;
      addr = `L${row}`;
    } else {
      const tab = src.tab === FIRE_PREFIX ? meta.fireSheet : src.tab;
      if (tab === null || !r.has(tab)) {
        plans.push({
          key: def.key,
          status: 'missing',
          value: null,
          sheetValue: null,
          sheetRef: null,
          sheetOptionsId: null,
          reason: `The ${src.tab} tab is not in the workbook`,
        });
        continue;
      }
      sheet = tab;
      addr = src.cell;
    }
    const ref = sheetRef(sheet, addr);
    if (def.onlyWhenTyped && (r.cell(sheet, addr)?.formula ?? null) !== null) {
      plans.push({
        key: def.key,
        status: 'formula_default',
        value: null,
        sheetValue: null,
        sheetRef: ref,
        sheetOptionsId: id,
        reason: 'Default formula; no override',
      });
      continue;
    }
    const parsed = parseSettingCell(def, r, sheet, addr);
    plans.push({
      key: def.key,
      status: parsed.status,
      value: parsed.value,
      sheetValue: parsed.sheetValue,
      sheetRef: ref,
      sheetOptionsId: id,
      reason:
        parsed.status === 'blank'
          ? 'Blank in the workbook; nothing stored'
          : parsed.status === 'invalid'
            ? 'The value is not valid for this setting; nothing stored'
            : null,
    });
  }
  return plans;
}

/** The crypto % fee (SheetOptions ID 38) as a ratio string, for the fee authority rule. */
export function cryptoFeeRate(plans: readonly SettingPlan[]): string | null {
  const plan = plans.find((p) => p.key === 'crypto.feeRate');
  return plan?.status === 'value' && typeof plan.value === 'string' ? plan.value : null;
}

// ─── Everything ─────────────────────────────────────────────────────────────────────────────────

export { ExtractContext } from './context';
export { OPTIONAL_SHEETS };
