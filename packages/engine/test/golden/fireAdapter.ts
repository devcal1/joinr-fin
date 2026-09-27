// The FIRE golden adapter (stage-6.md §9.1): reads the local workbook's FIRE tab (inputs, outputs
// and the year grid), builds the sheet mode's input from the cached cells, and runs the app's raw
// input path (deriveFireInputs on the Stage 3 adapter's savings periods and cash KPIs, with neutral
// stand-ins for the figures, classes, properties and super, which the raw figures never read).
// Template cell references only; every value is read at runtime and never printed.
import { FIRE_TAB_PREFIX, type IsoDate } from '@joinr/schema';
import type { CellInfo, WorkbookReader } from '@joinr/importer';
import { cashKpis, computeSavings, deriveFireInputs } from '../../src/index';
import type {
  CashKpisResult,
  FireDerived,
  FireSheetCell,
  FireSheetColumn,
  FireSheetInput,
  SavingsResult,
  SuperResult,
} from '../../src/index';
import { emptyProperty, figures } from '../snapshotHelpers';
import type { Sheet } from './adapter';
import { CashflowSheet, cellCents } from './cashflowAdapter';
import { readCashRows, type CashRow } from './cashflowFormulas';
import { salaryOf } from './fireFormulas';

export const FIRE_OUTPUT_CELLS: readonly FireSheetCell[] = [
  'D2',
  'V3',
  'E52',
  'E53',
  'E54',
  'E55',
  'E56',
  'E57',
  'E60',
  'E61',
  'E62',
  'E63',
  'E64',
];
export const FIRE_KPI_CELLS: readonly FireSheetCell[] = ['C15', 'D15', 'E15', 'C16', 'D16', 'E16'];
export const FIRE_GRID_COLUMNS: readonly FireSheetColumn[] = [
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
  'V',
  'W',
  'X',
];
/** The grid's first row and the template's last (rows 4…85). */
export const GRID_FIRST_ROW = 4;
const GRID_LAST_ROW = 85;

/** A super result with nothing in it (the raw path never reads it). */
function neutralSuper(): SuperResult {
  return {
    totalCents: 0,
    funds: [],
    contributions: [],
    sgMonths: [],
    periods: [],
    annualised: { cumulativeRatio: null, returnRatio: null, from: null, through: null, days: null },
    capYears: [],
    chart: [],
    snapshot: {
      superValueCents: 0,
      superContribCents: 0,
      superGainCents: null,
      superGainRatio: null,
    },
    flags: [],
  };
}

/** A cached cell as the sheet mode writes it: numbers, texts ("" for blank), errors as text. */
export interface CachedCell {
  addr: string;
  value: number | string;
  isError: boolean;
  hasFormula: boolean;
  formula: string | null;
}

export class FireSheetTab {
  readonly wb: WorkbookReader;
  readonly name: string;
  readonly asOf: IsoDate;
  readonly lastRun: IsoDate;
  readonly cf: CashflowSheet;
  readonly cashRows: CashRow[];

  constructor(readonly sheet: Sheet) {
    this.wb = sheet.wb;
    const name = this.wb.sheetNames.find((n) => n.startsWith(FIRE_TAB_PREFIX));
    if (name === undefined) throw new Error('golden: no FIRE tab');
    this.name = name;
    this.asOf = sheet.asOf;
    this.cf = new CashflowSheet(sheet);
    this.lastRun = this.cf.lastRun;
    this.cashRows = readCashRows(this.cf);
  }

  cell(addr: string): CachedCell {
    const c: CellInfo | null = this.wb.cell(this.name, addr);
    const formula = c?.formula ?? null;
    const isError = this.wb.isErrorValue(this.name, addr);
    let value: number | string = '';
    if (c !== null && c.v !== null) {
      if (c.t === 'n' && typeof c.v === 'number') value = c.v;
      else if (c.t === 'b') value = c.v === true ? 'TRUE' : 'FALSE';
      else value = String(c.v);
    }
    return { addr, value, isError, hasFormula: formula !== null, formula };
  }

  number(addr: string): number | null {
    return this.wb.number(this.name, addr);
  }

  /** A date cell as its calendar year (E57, G), else the cell as it is. */
  yearCell(addr: string): CachedCell {
    const c = this.cell(addr);
    const iso = this.wb.date(this.name, addr);
    return iso === null ? c : { ...c, value: Number(iso.slice(0, 4)) };
  }

  /** The grid rows: row 4 down to the last row with a date in G. */
  gridRows(): number[] {
    const rows: number[] = [];
    for (let r = GRID_FIRST_ROW; r <= GRID_LAST_ROW; r++) {
      if (this.wb.date(this.name, `G${r}`) === null) break;
      rows.push(r);
    }
    return rows;
  }

  /** The sheet mode's input: the cached E6–E10, E45–E49, the salary and the disclaimer. */
  sheetInput(): FireSheetInput {
    const need = (addr: string) => {
      const v = this.number(addr);
      if (v === null) throw new Error(`golden: ${this.name}!${addr} is not a number`);
      return v;
    };
    const e47 = this.cell('E47');
    return {
      today: this.asOf,
      birthYear: need('E6'),
      superContributionPerYear: need('E7'),
      inflation: need('E8'),
      withdrawalRate: need('E9'),
      accessAge: need('E10'),
      preSuper: need('E45'),
      superBalance: need('E46'),
      savings: typeof e47.value === 'number' ? e47.value : e47.value,
      spend: need('E48'),
      growth: need('E49'),
      salary: salaryOf(this.wb),
      disclaimerAccepted: this.wb.text('SheetOptions', 'B49') === 'Yes',
    };
  }

  /** The Stage 3 savings periods and cash KPIs, as the cash-flow golden builds them. */
  cashflow(): { savings: SavingsResult; kpis: CashKpisResult } {
    const savings = computeSavings(this.cf.savingsInput());
    const kpis = cashKpis({
      asOf: this.asOf,
      periods: savings.periods,
      yearBasis: 'calendar',
      jobStartDate: this.wb.date('Budget', 'D2'),
      currentCashCents: cellCents(this.wb.number('Cash', 'C13')) ?? 0,
      eoyCashGoalCents: cellCents(this.wb.number('Cash', 'C26')),
      cashSavingsTargetCents: cellCents(this.wb.number('Cash', 'C31')),
    });
    return { savings, kpis };
  }

  /** The app's raw input path (§9.1): deriveFireInputs with neutral stand-ins. */
  derived(): FireDerived {
    const { savings, kpis } = this.cashflow();
    return deriveFireInputs({
      asOf: this.asOf,
      figures: figures(),
      classes: [],
      liabilities: [],
      property: emptyProperty(this.asOf),
      savings: savings.periods,
      kpis,
      superResult: neutralSuper(),
    });
  }
}
