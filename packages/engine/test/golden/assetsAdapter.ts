// The sheet-faithful Stage 4 adapter (stage-4.md §9.1): reads the local workbook and builds the
// Other Assets, Super and Property engine inputs the way the sheet computed them (no corrections
// file). Where the sheet holds no date (a fund or loan balance, the Super!B16 contribution), the
// importer's rules date it (§3.5 items 2 and 4). Template cell references only; every value is read
// at runtime and never printed.
import {
  addMonthsIso,
  BULLION_FEEDS,
  centsFromNumber,
  decimalFromNumber,
  isoMonthOf,
  JoinrDecimal,
  OTHER_ASSET_STALE_DAYS_DEFAULT,
  SUPER_CONTRIBUTIONS_TAX_DEFAULT,
  type InstrumentKind,
  type IsoDate,
  type Metal,
  type PaymentFrequency,
} from '@joinr/schema';
import type { WorkbookReader } from '@joinr/importer';
import type {
  AmortisationInput,
  EngineLoan,
  EngineOtherAsset,
  EngineProperty,
  EngineSuperContribution,
  EngineSuperFund,
  OtherAssetsInput,
  PropertyInput,
  SuperInput,
} from '../../src/index';
import { historyRows, type Sheet } from './adapter';
import { monthEnd } from './cashflowAdapter';
import type { CostRow } from './assetsFormulas';

// ─── Template layout (generic template text and cell letters) ──────────────────────────────────

export const OTHER_ASSETS = {
  sheet: 'Other Assets',
  firstRow: 3,
  lastRow: 500,
  /** The hidden history block Y:AC starts here; Y<r> = History!A<r − 1>. */
  historyFirstRow: 4,
} as const;

export const SUPER = {
  sheet: 'Super',
  fundsFrom: 2,
  fundsTo: 7,
  autoLines: ['B8', 'B9', 'B10'],
  reportedGain: 'B11',
  total: 'B12',
  voluntary: 'B16',
  slope: 'B19',
} as const;

export const PROPERTY = {
  sheet: 'Property',
  columns: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
  rows: {
    purchaseDate: 16,
    primary: 17,
    purchase: 18,
    value: 19,
    netRent: 20,
    gain: 21,
    gainRatio: 22,
    simpleAnnual: 23,
    loanStart: 24,
    compounding: 25,
    rate: 26,
    payment: 27,
    startBalance: 28,
    balance: 29,
    paid: 30,
    interest: 31,
    periodInterest: 32,
    futureInterest: 33,
    lvr: 34,
    payoff: 35,
  },
  /** The hidden history block Z:AF: Property row r ↔ History row r − 2. */
  historyOffset: 2,
} as const;

/** SheetOptions IDs (column P) the adapter reads; never IDs 1 and 29. */
const SHEET_OPTION_IDS = { salary: 4, jobStart: 9, marginalRate: 26, retirement: 43 } as const;

const MF_PRICE_REF_RE = /^'?Managed Funds'?!\$?D\$?(\d+)$/;
const SAME_SHEET_REF_RE = /^(?:'?Other Assets'?!)?\$?([A-Z]{1,3})\$?(\d+)$/;
const RETIREMENT_BUY_KINDS: readonly InstrumentKind[] = ['stock', 'etf', 'managed_fund'];
const SHEET_MODE_FREQUENCIES: Readonly<Record<number, PaymentFrequency>> = {
  12: 'monthly',
  26: 'fortnightly',
  52: 'weekly',
};

/** A sheet number as cents, half away from zero; null when not numeric. */
const cents = (n: number | null): number | null => (n === null ? null : centsFromNumber(n));
const absCents = (n: number | null): number | null =>
  n === null ? null : Math.abs(centsFromNumber(n));
const nonZero = (n: number | null): boolean => n !== null && n !== 0;

// ─── Sheet rows ─────────────────────────────────────────────────────────────────────────────────

export interface AssetsHistoryRow {
  row: number;
  date: IsoDate;
  frozen: boolean;
}

/** One Other Assets data row: the inputs and the cached M…R the goldens compare. */
export interface OtherAssetSheetRow {
  row: number;
  purchaseDate: IsoDate | null;
  currency: string;
  metal: Metal | null;
  units: number | null;
  unitCost: number | null;
  price: number | null;
  M: number | null;
  N: number | null;
  O: number | null;
  P: number | null;
  Q: number | null;
  R: number | null;
  asset: EngineOtherAsset;
}

/** One used Property slot (a column D…O meeting the Stage 1 import predicate). */
export interface PropertySlot {
  col: string;
  id: number;
  property: EngineProperty;
  loan: EngineLoan | null;
}

export class AssetsSheet {
  readonly wb: WorkbookReader;
  readonly asOf: IsoDate;
  readonly lastRun: IsoDate | null;
  /** Every History row with a date (frozen and live). */
  readonly history: AssetsHistoryRow[];
  /** The frozen rows kept by the importer's one-per-month rule (the later run date wins). */
  readonly kept: AssetsHistoryRow[];
  /** The live History row (formulas), if any. */
  readonly live: AssetsHistoryRow | null;
  readonly otherAssets: OtherAssetSheetRow[];
  readonly slots: PropertySlot[];

  constructor(readonly sheet: Sheet) {
    const wb = sheet.wb;
    this.wb = wb;
    this.asOf = sheet.asOf;
    this.lastRun = wb.date('Net Worth', 'C51');
    this.history = historyRows(wb);
    this.kept = keepOnePerMonth(this.history.filter((h) => h.frozen));
    this.live = this.history.filter((h) => !h.frozen).at(-1) ?? null;
    this.otherAssets = readOtherAssets(wb, this.asOf);
    this.slots = readPropertySlots(wb, this.asOf);
    this.dateLoanEntries();
  }

  /** The D73 assumed date: the earliest kept snapshot's run date. */
  get assumedDate(): IsoDate | null {
    return this.kept[0]?.date ?? null;
  }

  /** The chart the goldens read: monthly, every snapshot plus the live point (SPEC-3). */
  get chart(): { unit: 'monthly'; count: number } {
    return { unit: 'monthly', count: this.kept.length + 1 };
  }

  historyCents(col: string, row: number): number | null {
    return cents(this.wb.number('History', `${col}${row}`));
  }

  /** The last run date when it applies to entry dates (set and not after the as-of). */
  private get usableLastRun(): IsoDate | null {
    return this.lastRun !== null && this.lastRun <= this.asOf ? this.lastRun : null;
  }

  // ─── Other assets ───

  /** Live AUD per unit by currency: the sheet's own O ÷ (M × K) (§9.1). */
  fxRates(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.otherAssets) {
      if (r.currency === 'AUD' || Object.hasOwn(out, r.currency)) continue;
      if (r.O === null || r.M === null || r.price === null || r.M * r.price === 0) continue;
      const rate = r.O / (r.M * r.price);
      if (rate > 0) out[r.currency] = decimalFromNumber(rate);
    }
    return out;
  }

  otherAssetsInput(
    assets: readonly EngineOtherAsset[] = this.otherAssets.map((r) => r.asset),
  ): OtherAssetsInput {
    return {
      asOf: this.asOf,
      assets,
      fxRates: this.fxRates(),
      assumedDate: this.assumedDate,
      stalePriceDays: OTHER_ASSET_STALE_DAYS_DEFAULT,
      snapshots: this.kept.map((h) => ({
        periodMonth: isoMonthOf(h.date),
        runDate: h.date,
        otherValueCents: this.historyCents('AJ', h.row),
        otherGainCents: this.historyCents('AK', h.row),
      })),
      chart: this.chart,
    };
  }

  /** The rows as the cost lines read them (G and the cached N). */
  costRows(): CostRow[] {
    return this.otherAssets.map((r) => ({ purchaseDate: r.purchaseDate, cost: r.N }));
  }

  // ─── Super ───

  /** A SheetOptions cell found by its column-P ID (the importer's lookup). */
  private sheetOption(id: number): string | null {
    for (let r = 3; r <= 60; r++) {
      if (this.wb.number('SheetOptions', `P${r}`) === id) return `L${r}`;
    }
    return null;
  }

  /** D37: SheetOptions "Retirement - Contributions in Savings Rate" is Yes. */
  get retirementContributions(): boolean {
    const addr = this.sheetOption(SHEET_OPTION_IDS.retirement);
    return addr !== null && this.wb.bool('SheetOptions', addr) === true;
  }

  /** Σ units × price (cents) of buys of Retirement-tagged holdings dated in `(from, to]`. */
  retirementBuysCents(from: IsoDate, to: IsoDate): number {
    let total = new JoinrDecimal(0);
    for (const kind of RETIREMENT_BUY_KINDS) {
      const tab = this.sheet.tab(kind);
      const tagged = new Set(
        tab.instruments.filter((i) => i.sector === 'Retirement').map((i) => i.id),
      );
      for (const t of tab.trades) {
        if (!tagged.has(t.instrumentId) || !(t.tradeDate > from && t.tradeDate <= to)) continue;
        const units = new JoinrDecimal(t.units);
        if (units.greaterThan(0)) total = total.plus(units.times(t.price));
      }
    }
    return total.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  }

  /** The windows of the kept snapshots `(from, to]`; the first starts a month earlier. */
  snapshotWindows(): { row: AssetsHistoryRow; from: IsoDate; to: IsoDate }[] {
    return this.kept.map((row, i) => ({
      row,
      from: i === 0 ? addMonthsIso(row.date, -1) : this.kept[i - 1]!.date,
      to: row.date,
    }));
  }

  /** The contribution a kept History row stands for: R less the D37 buys (never below 0). */
  derivedContributionCents(row: AssetsHistoryRow, from: IsoDate, to: IsoDate): number | null {
    const r = this.historyCents('R', row.row);
    if (r === null || r === 0) return null;
    if (!this.retirementContributions) return r;
    const excluded = this.retirementBuysCents(from, to);
    return excluded <= 0 ? r : Math.max(0, r - excluded);
  }

  /** Super!B16's date: min(the last day of EDATE(C51, 1)'s month, the as-of) (§3.5 item 2). */
  get voluntaryDate(): IsoDate {
    const period = isoMonthOf(this.lastRun !== null ? addMonthsIso(this.lastRun, 1) : this.asOf);
    const end = monthEnd(`${period}-01`);
    return end < this.asOf ? end : this.asOf;
  }

  superContributions(): EngineSuperContribution[] {
    const out: EngineSuperContribution[] = [];
    for (const w of this.snapshotWindows()) {
      const amount = this.derivedContributionCents(w.row, w.from, w.to);
      if (amount === null || amount === 0) continue;
      out.push({
        id: 1_000 + w.row.row,
        fundId: null,
        date: w.row.date,
        kind: 'voluntary_contribution',
        amountCents: amount,
      });
    }
    const voluntary = this.wb.number(SUPER.sheet, SUPER.voluntary);
    if (voluntary !== null && voluntary !== 0) {
      out.push({
        id: 16,
        fundId: null,
        date: this.voluntaryDate,
        kind: 'voluntary_contribution',
        amountCents: centsFromNumber(voluntary),
      });
    }
    return out;
  }

  /** Funds A2:A7 with one balance entry each, dated by the importer's rule (§3.5 item 2). */
  superFunds(): EngineSuperFund[] {
    const s = SUPER.sheet;
    const rows: { row: number; balanceCents: number }[] = [];
    for (let r = SUPER.fundsFrom; r <= SUPER.fundsTo; r++) {
      if (this.wb.isBlank(s, `A${r}`)) continue;
      rows.push({ row: r, balanceCents: cents(this.wb.number(s, `B${r}`)) ?? 0 });
    }
    const last = this.kept.at(-1);
    const q = last === undefined ? null : this.historyCents('Q', last.row);
    const total = cents(this.wb.number(s, SUPER.total));
    const lastRun = this.usableLastRun;
    const asOf =
      lastRun !== null && rows.length > 0 && q !== null && total !== null && q === total
        ? lastRun
        : this.asOf;
    return rows.map((f) => ({
      id: f.row,
      receivesSg: false,
      archived: false,
      balances: [{ id: f.row, asOf, balanceCents: f.balanceCents, transferInCents: null }],
    }));
  }

  superInput(): SuperInput {
    const opt = (id: number) => this.sheetOption(id);
    const salaryAddr = opt(SHEET_OPTION_IDS.salary);
    const jobAddr = opt(SHEET_OPTION_IDS.jobStart);
    const marginalAddr = opt(SHEET_OPTION_IDS.marginalRate);
    const salary = salaryAddr === null ? null : this.wb.number('SheetOptions', salaryAddr);
    const marginal = marginalAddr === null ? null : this.wb.number('SheetOptions', marginalAddr);
    return {
      asOf: this.asOf,
      snapshots: this.kept.map((h) => ({
        periodMonth: isoMonthOf(h.date),
        runDate: h.date,
        superValueCents: this.historyCents('Q', h.row),
      })),
      funds: this.superFunds(),
      contributions: this.superContributions(),
      sgOverrides: [],
      grossAnnualSalaryCents: salary === null ? null : centsFromNumber(salary),
      jobStartDate: jobAddr === null ? null : this.wb.date('SheetOptions', jobAddr),
      sgRatio: null,
      contributionsTaxRatio: SUPER_CONTRIBUTIONS_TAX_DEFAULT,
      marginalTaxRatio: marginal === null ? null : decimalFromNumber(marginal),
      importedContributionType: 'salary_sacrifice',
      concessionalCapOverride: null,
      chart: this.chart,
    };
  }

  // ─── Property ───

  /**
   * The property loans' entries are dated at the last run when their balances add up to the last
   * kept row's |AB| and each started (if known) before it (§3.5 item 4); else at the as-of.
   */
  private dateLoanEntries(): void {
    const loans = this.slots.flatMap((s) => (s.loan === null ? [] : [s.loan]));
    const last = this.kept.at(-1);
    const ab = last === undefined ? null : this.historyCents('AB', last.row);
    const total = loans.reduce((sum, l) => sum + l.entries[0]!.balanceCents, 0);
    const lastRun = this.usableLastRun;
    if (lastRun === null || loans.length === 0 || ab === null || Math.abs(ab) !== total) return;
    for (const slot of this.slots) {
      const l = slot.loan;
      if (l === null || !(l.startDate === null || l.startDate < lastRun)) continue;
      slot.loan = { ...l, entries: l.entries.map((e) => ({ ...e, asOf: lastRun })) };
    }
  }

  propertyInput(): PropertyInput {
    return {
      asOf: this.asOf,
      properties: this.slots.map((s) => s.property),
      loans: this.slots.flatMap((s) => (s.loan === null ? [] : [s.loan])),
      snapshots: this.kept.map((h) => ({
        periodMonth: isoMonthOf(h.date),
        runDate: h.date,
        propertyValueCents: this.historyCents('X', h.row),
        propertyPurchaseCents: this.historyCents('Y', h.row),
        mortgageBalanceCents: this.historyCents('AB', h.row),
        mortgageInterestFeesCents: this.historyCents('AC', h.row),
        mortgagePrincipalPaidCents: this.historyCents('AD', h.row),
      })),
      chart: this.chart,
    };
  }

  /**
   * Sheet mode (§2.7, §9.1): the slot's loan paid at its compounding frequency (12, 26 or 52 only),
   * the payment = the sheet's monthly payment × 12 ÷ frequency, rounded half away from zero to whole
   * cents; null when the frequency is another one (`sheet_mode_unavailable`).
   */
  sheetModeLoan(slot: PropertySlot): AmortisationInput | null {
    const l = slot.loan;
    const p = PROPERTY.rows;
    const frequency = l?.compoundingPerYear ?? null;
    if (l === null || frequency === null || !Object.hasOwn(SHEET_MODE_FREQUENCIES, frequency)) {
      return null;
    }
    const rate = this.wb.number(PROPERTY.sheet, `${slot.col}${p.rate}`);
    const monthly = this.wb.number(PROPERTY.sheet, `${slot.col}${p.payment}`);
    const balance = absCents(this.wb.number(PROPERTY.sheet, `${slot.col}${p.balance}`));
    if (rate === null || monthly === null || balance === null) return null;
    const paymentCents = new JoinrDecimal(decimalFromNumber(Math.abs(monthly)))
      .times(12)
      .div(frequency)
      .times(100)
      .toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP)
      .toNumber();
    return {
      balanceCents: balance,
      annualRate: decimalFromNumber(rate),
      compoundingPerYear: frequency,
      paymentCents,
      paymentFrequency: SHEET_MODE_FREQUENCIES[frequency]!,
      offsetCents: 0,
      anchorDate: this.asOf,
      balanceDate: this.asOf,
    };
  }

  /** Every used slot's row-30 cell is a formula of its own rows 28 and 29 only (§9.3 rule 6). */
  principalOnlyPayments(): boolean {
    const loanSlots = this.slots.filter((s) => s.loan !== null);
    return loanSlots.every((s) => {
      const formula =
        this.wb.cell(PROPERTY.sheet, `${s.col}${PROPERTY.rows.paid}`)?.formula ?? null;
      if (formula === null) return false;
      const refs = [...formula.matchAll(/(?:'?[A-Za-z ]+'?!)?\$?([A-Z]{1,3})\$?(\d+)/g)];
      if (refs.length === 0 || /!/.test(formula)) return false;
      return refs.every(
        (m) =>
          m[1] === s.col &&
          (Number(m[2]) === PROPERTY.rows.startBalance || Number(m[2]) === PROPERTY.rows.balance),
      );
    });
  }
}

// ─── Readers ────────────────────────────────────────────────────────────────────────────────────

/** The importer's one-per-month rule: per month the frozen row with the later run date. */
function keepOnePerMonth(frozen: readonly AssetsHistoryRow[]): AssetsHistoryRow[] {
  const byMonth = new Map<string, AssetsHistoryRow>();
  for (const h of frozen) {
    const prev = byMonth.get(isoMonthOf(h.date));
    if (prev === undefined || h.date >= prev.date) byMonth.set(isoMonthOf(h.date), h);
  }
  return frozen
    .filter((h) => byMonth.get(isoMonthOf(h.date)) === h)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
}

/** Follows `=K19` chains to a `'Managed Funds'!D<r>` bullion feed (the Stage 1 link rule). */
function bullionMetal(wb: WorkbookReader, row: number): Metal | null {
  let addr = `K${row}`;
  const seen = new Set<string>([addr]);
  for (let depth = 0; depth <= 600; depth++) {
    const f = wb.cell(OTHER_ASSETS.sheet, addr)?.formula?.trim() ?? null;
    if (f === null) return null;
    const mf = MF_PRICE_REF_RE.exec(f);
    if (mf) {
      const id = wb.text('Managed Funds', `A${mf[1]}`);
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

/** A non-AUD row's AUD per unit at purchase: the sheet's N ÷ (M × J), 12 significant digits. */
function purchaseRateOf(n: number | null, m: number | null, j: number | null): string | null {
  if (n === null || m === null || j === null || m * j === 0) return null;
  const rate = n / (m * j);
  return rate > 0 ? decimalFromNumber(rate) : null;
}

function readOtherAssets(wb: WorkbookReader, asOf: IsoDate): OtherAssetSheetRow[] {
  const s = OTHER_ASSETS.sheet;
  const out: OtherAssetSheetRow[] = [];
  for (let row = OTHER_ASSETS.firstRow; row <= OTHER_ASSETS.lastRow; row++) {
    if (wb.isBlank(s, `F${row}`)) continue;
    const num = (col: string) => wb.number(s, `${col}${row}`);
    const units = num('H');
    const unitCost = num('J');
    const price = num('K');
    const sold = Math.abs(num('L') ?? 0);
    const currency = wb.text(s, `I${row}`) ?? 'AUD';
    const purchaseDate = wb.date(s, `G${row}`);
    const metal = bullionMetal(wb, row);
    const M = num('M');
    const N = num('N');
    const asset: EngineOtherAsset = {
      id: row,
      purchaseDate,
      units: units === null ? '0' : decimalFromNumber(units),
      legacySoldUnits: decimalFromNumber(sold),
      unitCost: unitCost === null ? null : decimalFromNumber(unitCost),
      currency,
      purchaseFxRate: currency === 'AUD' ? null : purchaseRateOf(N, M, unitCost),
      pricing:
        metal === null
          ? // A blank K is 0 in the sheet's O = M × K (sheet-faithful, §9.1). The app reads a blank
            // K as unpriced ("No price yet"); the server golden checks that (§9.3 rule 17).
            { source: 'manual', unitPrice: decimalFromNumber(price ?? 0), priceAsOf: asOf }
          : {
              source: 'bullion',
              metal,
              ozPerUnit: '1',
              spot:
                price === null ? null : { audPerOz: decimalFromNumber(price), asOf, fresh: true },
              fallbackUnitPrice: price === null ? null : decimalFromNumber(price),
              fallbackAsOf: price === null ? null : asOf,
            },
      sales: [],
    };
    out.push({
      row,
      purchaseDate,
      currency,
      metal,
      units,
      unitCost,
      price,
      M,
      N,
      O: num('O'),
      P: num('P'),
      Q: num('Q'),
      R: num('R'),
      asset,
    });
  }
  return out;
}

/** True when a Property slot holds a real property (the Stage 1 import predicate). */
function slotUsed(wb: WorkbookReader, col: string): boolean {
  const p = PROPERTY.rows;
  const n = (row: number) => wb.number(PROPERTY.sheet, `${col}${row}`);
  return (
    nonZero(n(p.purchase)) ||
    nonZero(n(p.value)) ||
    nonZero(n(p.startBalance)) ||
    nonZero(n(p.balance)) ||
    wb.date(PROPERTY.sheet, `${col}${p.purchaseDate}`) !== null
  );
}

function readPropertySlots(wb: WorkbookReader, asOf: IsoDate): PropertySlot[] {
  const s = PROPERTY.sheet;
  const p = PROPERTY.rows;
  const out: PropertySlot[] = [];
  PROPERTY.columns.forEach((col, i) => {
    if (!slotUsed(wb, col)) return;
    const n = (row: number) => wb.number(s, `${col}${row}`);
    const id = i + 1;
    const property: EngineProperty = {
      id,
      purchaseDate: wb.date(s, `${col}${p.purchaseDate}`),
      isPrimaryResidence: wb.bool(s, `${col}${p.primary}`) ?? false,
      purchaseValueCents: cents(n(p.purchase)) ?? 0,
      netRentToDateCents: cents(n(p.netRent)) ?? 0,
      valuations: [{ id, asOf, valueCents: cents(n(p.value)) ?? 0 }],
    };
    const start = n(p.startBalance);
    const current = n(p.balance);
    let loan: EngineLoan | null = null;
    if (nonZero(start) || nonZero(current)) {
      const rate = n(p.rate);
      const compounding = n(p.compounding);
      loan = {
        id,
        propertyId: id,
        startDate: wb.date(s, `${col}${p.loanStart}`),
        startBalanceCents: absCents(start),
        annualRate: rate === null ? null : decimalFromNumber(rate),
        compoundingPerYear:
          compounding !== null && Number.isInteger(compounding) && compounding > 0
            ? compounding
            : null,
        paymentCents: absCents(n(p.payment)),
        paymentFrequency: 'monthly',
        entries: [{ id, asOf, balanceCents: absCents(current) ?? 0, repaymentsCents: null }],
        offsets: [],
      };
    }
    out.push({ col, id, property, loan });
  });
  return out;
}
