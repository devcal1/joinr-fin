// The sheet-faithful history adapter (stage-5.md §9.1): the frozen History rows as the importer
// stores them (cents, 12-significant-digit ratios, source 'migrated', no extras), the Stage 2–4
// adapters' results, and the live composition at the workbook's as-of. Template cell references
// only; every value is read at runtime and never printed.
import {
  centsFromNumber,
  decimalFromNumber,
  INSTRUMENT_KINDS,
  isoMonthOf,
  SNAPSHOT_FIGURE_COLUMNS,
  type ChartDateUnit,
  type InstrumentKind,
  type IsoDate,
  type SnapshotFigureKey,
} from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';
import {
  assetsSnapshotColumns,
  cashKpis,
  cashTotals,
  composeSnapshot,
  computeOtherAssets,
  computeProperty,
  computeSavings,
  computeSuper,
  monthlyPayCents,
  nextRecordMonth,
  type CashKpisResult,
  type EngineCashAccount,
  type EngineSnapshot,
  type EngineTrade,
  type InvestmentsResult,
  type OtherAssetsResult,
  type PropertiesResult,
  type SavingsResult,
  type SnapshotFigures,
  type SuperResult,
} from '../../src/index';
import { readTiming, Sheet } from './adapter';
import { AssetsSheet, type AssetsHistoryRow } from './assetsAdapter';
import { CashflowSheet } from './cashflowAdapter';

// ─── Template layout ────────────────────────────────────────────────────────────────────────────

/** History B…AK, one letter per figure column (SNAPSHOT_FIGURE_COLUMNS' first 36, table order). */
const LETTERS = [
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF',
  'AG',
  'AH',
  'AI',
  'AJ',
  'AK',
] as const;

/** A History column: its letter, the figure key and how the importer stores it. */
export interface HistoryColumn {
  letter: string;
  key: SnapshotFigureKey;
  ratio: boolean;
}
export const HISTORY_COLUMNS: readonly HistoryColumn[] = LETTERS.map((letter, k) => {
  const key = SNAPSHOT_FIGURE_COLUMNS[k]!;
  return { letter, key, ratio: key.endsWith('Ratio') };
});
export const columnOf = (key: SnapshotFigureKey): HistoryColumn =>
  HISTORY_COLUMNS.find((c) => c.key === key)!;

/** The Cash tab's accounts: rows 2 → the `ℹ️` terminator (A name, C balance, E offset). */
const CASH = { sheet: 'Cash', firstRow: 2, maxRow: 60 } as const;

/** Net Worth!H60 chart units (the template's texts). */
const UNIT_TEXT: Readonly<Record<string, ChartDateUnit>> = {
  Monthly: 'monthly',
  Quarterly: 'quarterly',
  Yearly: 'yearly',
};

// ─── The adapter ────────────────────────────────────────────────────────────────────────────────

export class HistorySheet {
  readonly wb: WorkbookReader;
  readonly asOf: IsoDate;
  readonly lastRun: IsoDate;
  readonly cf: CashflowSheet;
  readonly assets: AssetsSheet;
  /** The frozen rows the importer keeps (one per month; the later run date wins). */
  readonly kept: AssetsHistoryRow[];
  /** The live History row (formulas), if any. */
  readonly live: AssetsHistoryRow | null;
  readonly snapshots: EngineSnapshot[];
  readonly trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>>;
  readonly investments: Readonly<Record<InstrumentKind, InvestmentsResult>>;
  readonly savings: SavingsResult;
  readonly accounts: EngineCashAccount[];
  readonly otherAssets: OtherAssetsResult;
  readonly super: SuperResult;
  readonly property: PropertiesResult;

  constructor(readonly sheet: Sheet) {
    this.wb = sheet.wb;
    this.asOf = sheet.asOf;
    this.cf = new CashflowSheet(sheet);
    this.lastRun = this.cf.lastRun;
    this.assets = new AssetsSheet(sheet);
    this.kept = this.assets.kept;
    this.live = this.assets.live;
    this.snapshots = this.kept.map((h) => this.snapshotOf(h));
    this.trades = Object.fromEntries(
      INSTRUMENT_KINDS.map((k) => [k, sheet.tab(k).trades]),
    ) as Record<InstrumentKind, EngineTrade[]>;
    this.investments = Object.fromEntries(INSTRUMENT_KINDS.map((k) => [k, sheet.run(k)])) as Record<
      InstrumentKind,
      InvestmentsResult
    >;
    this.savings = computeSavings(this.cf.savingsInput());
    this.accounts = readCashAccounts(this.wb);
    this.otherAssets = computeOtherAssets(this.assets.otherAssetsInput());
    this.super = computeSuper(this.assets.superInput());
    this.property = computeProperty(this.assets.propertyInput());
  }

  /** A History cell as the importer stores it: cents or a ratio string; null when blank. */
  stored(col: HistoryColumn, row: number): number | string | null {
    const n = this.wb.number('History', `${col.letter}${row}`);
    if (n === null) return null;
    return col.ratio ? decimalFromNumber(n) : centsFromNumber(n);
  }

  /** §9.1: a frozen row as a migrated snapshot (every column B–AK; the extras null). */
  private snapshotOf(h: AssetsHistoryRow): EngineSnapshot {
    const figures = Object.fromEntries(SNAPSHOT_FIGURE_COLUMNS.map((k) => [k, null])) as Record<
      SnapshotFigureKey,
      unknown
    >;
    for (const col of HISTORY_COLUMNS) figures[col.key] = this.stored(col, h.row);
    return {
      ...(figures as unknown as SnapshotFigures),
      periodMonth: isoMonthOf(h.date),
      runDate: h.date,
      source: 'migrated',
    };
  }

  /** The Cash KPIs on a year basis (the job start from Budget!D2, as the Stage 3 golden). */
  kpis(yearBasis: 'fy' | 'calendar'): CashKpisResult {
    const cents = (n: number | null) => (n === null ? null : centsFromNumber(n));
    return cashKpis({
      asOf: this.asOf,
      periods: this.savings.periods,
      yearBasis,
      jobStartDate: this.wb.date('Budget', 'D2'),
      currentCashCents: cents(this.wb.number('Cash', 'C13')) ?? 0,
      eoyCashGoalCents: cents(this.wb.number('Cash', 'C26')),
      cashSavingsTargetCents: cents(this.wb.number('Cash', 'C31')),
    });
  }

  /** §9.1: `composeSnapshot` at the as-of from the Stage 2–4 adapters' results. */
  compose(): SnapshotFigures {
    const last = this.snapshots.at(-1) ?? null;
    const timing = readTiming(this.wb, this.asOf).input;
    return composeSnapshot({
      periodMonth: nextRecordMonth(this.snapshots, this.asOf),
      runDate: this.asOf,
      previous:
        last === null ? null : { runDate: last.runDate, cashValueCents: last.cashValueCents },
      investments: this.investments,
      trades: this.trades,
      cash: cashTotals({
        accounts: this.accounts,
        offsetsIncludeEmergencyFund: false,
        loansCountForEmergencyFund: false,
      }),
      cashAccounts: this.accounts,
      salaryMonthlyCents: monthlyPayCents({
        netPayCents: timing.netPayCents,
        payFrequency: timing.payFrequency,
      }),
      assets: assetsSnapshotColumns({
        otherAssets: this.otherAssets,
        super: this.super,
        property: this.property,
      }),
      superMeasuredThrough: this.super.measuredThrough ?? null,
    });
  }

  /** Net Worth!H60 and H61 (the chart unit and count). */
  chartSettings(): { unit: ChartDateUnit; count: number | null } {
    const text = this.wb.text('Net Worth', 'H60');
    const unit = text === null ? 'monthly' : (UNIT_TEXT[text] ?? 'monthly');
    const count = this.wb.number('Net Worth', 'H61');
    return { unit, count: count === null ? null : Math.round(count) };
  }
}

function readCashAccounts(wb: WorkbookReader): EngineCashAccount[] {
  const out: EngineCashAccount[] = [];
  for (let row = CASH.firstRow; row <= CASH.maxRow; row++) {
    const name = wb.text(CASH.sheet, `A${row}`);
    if (name !== null && name.startsWith('ℹ️')) break;
    if (wb.isBlank(CASH.sheet, `A${row}`)) continue;
    const balance = wb.number(CASH.sheet, `C${row}`);
    out.push({
      id: row,
      kind: 'bank',
      isOffset: wb.bool(CASH.sheet, `E${row}`) ?? false,
      balanceCents: balance === null ? 0 : centsFromNumber(balance),
    });
  }
  return out;
}
